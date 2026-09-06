/** Post-freeze preparation only: corpus v1 never enters development data. */
import { execFileSync } from 'node:child_process';
import { writeImmutable } from './immutable-artifact.ts';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type * as Canvas from '@napi-rs/canvas';
import type * as Fenshot from '@scoriiu/fenshot';

const root = import.meta.dirname;
const fixtures = resolve(root, '../../packages/test-fixtures');
const requireFixture = createRequire(resolve(fixtures, 'package.json'));
const canvas = requireFixture('@napi-rs/canvas') as typeof Canvas;
const fenshotModelPath = requireFixture.resolve('@scoriiu/fenshot/model/chess-tiles-v2.onnx');
const fenshot = (await import(resolve(dirname(fenshotModelPath), '../dist/tiles.js'))) as Pick<
  typeof Fenshot,
  'extractTiles' | 'rgbaToGray'
>;
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const classes = '1KQRBNPkqrbnp';

interface LockedPage {
  id: string;
  path: string;
  sha256: string;
  annotations: {
    id: string;
    kind: string;
    pixelRect: { x: number; y: number; width: number; height: number };
    renderedPlacement: string | null;
  }[];
}

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid freeze object');
  return value as Record<string, unknown>;
};
const freezeBytes = await readFile(resolve(root, 'runs/candidates.freeze.json'));
const freeze = object(JSON.parse(freezeBytes.toString()) as unknown);
const evidence = object(
  JSON.parse(await readFile(resolve(root, 'runs/candidates.evidence.json'), 'utf8')) as unknown,
);
if (
  evidence['freezeFileSha256'] !== hash(freezeBytes) ||
  freeze['schemaVersion'] !== 1 ||
  freeze['runKind'] !== 'full' ||
  freeze['protocolSha256'] !== hash(await readFile(resolve(root, 'protocol.json'))) ||
  freeze['testManifestSha256'] !==
    hash(await readFile(resolve(root, 'data/full/vectors.manifest.json'))) ||
  !Array.isArray(freeze['candidates']) ||
  freeze['candidates'].length !== 3
)
  throw new Error('Authenticated complete freeze required');
const expected = new Map<string, number | null>([
  ['shipped', null],
  ['tilenet-full-3801', 3801],
  ['tilenet-full-3802', 3802],
]);
for (const value of freeze['candidates'] as unknown[]) {
  const candidate = object(value);
  const id = candidate['id'];
  if (
    typeof id !== 'string' ||
    !expected.has(id) ||
    candidate['seed'] !== expected.get(id) ||
    typeof candidate['modelPath'] !== 'string'
  )
    throw new Error('Invalid frozen candidate identity');
  const bytes = await readFile(resolve(root, 'runs', candidate['modelPath']));
  if (hash(bytes) !== candidate['sha256'] || bytes.length !== candidate['bytes'])
    throw new Error('Frozen model changed');
  expected.delete(id);
}
if (expected.size !== 0) throw new Error('Missing frozen candidates');

const manifestBytes = await readFile(resolve(fixtures, 'corpus/v1/manifest.json'));
if (hash(manifestBytes) !== '767c0e91c7c685495a8d1be37fc8605208ca9e2dc6b672c39ea2d47567189b7a') {
  throw new Error('Historical corpus manifest changed');
}
// The exact pinned hash authenticates this previously validated repository schema.
const manifest = JSON.parse(manifestBytes.toString()) as { pages: LockedPage[] };
const chunks: Buffer[] = [];
const boards: { id: string; family: string; labels: number[] }[] = [];
for (const page of manifest.pages) {
  const bytes = await readFile(resolve(fixtures, page.path));
  if (hash(bytes) !== page.sha256) throw new Error('Historical page hash changed');
  const image = await canvas.loadImage(bytes);
  const surface = canvas.createCanvas(image.width, image.height);
  const context = surface.getContext('2d');
  context.drawImage(image, 0, 0);
  for (const annotation of page.annotations) {
    if (annotation.kind !== 'complete' || annotation.renderedPlacement === null) continue;
    const { x, y, width, height } = annotation.pixelRect;
    const rgba = context.getImageData(x, y, width, height).data;
    const gray = fenshot.rgbaToGray(rgba, width, height);
    const vectors = fenshot.extractTiles(gray, { x0: 0, y0: 0, x1: width, y1: height });
    const buffer = Buffer.alloc(vectors.length * 4);
    vectors.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
    chunks.push(buffer);
    const labels = annotation.renderedPlacement
      .split('/')
      .reverse()
      .flatMap((rank) =>
        Array.from(rank).flatMap((token) =>
          /^[1-8]$/.test(token) ? Array<number>(Number(token)).fill(0) : [classes.indexOf(token)],
        ),
      );
    if (labels.length !== 64 || labels.some((label) => label < 0))
      throw new Error('Invalid regression labels');
    boards.push({
      id: `v1-${hash(Buffer.from(`${page.id}/${annotation.id}`)).slice(0, 16)}`,
      family: 'historical-corpus-v1',
      labels,
    });
  }
}
if (new Set(boards.map(({ id }) => id)).size !== boards.length)
  throw new Error('Duplicate historical board identity');
if (boards.length !== 14) throw new Error('Incomplete historical exact-bound set');
const output = resolve(root, 'data/regression');
await mkdir(output, { recursive: true });
const vectorBytes = Buffer.concat(chunks);
await writeImmutable(resolve(output, 'regression.vectors.f32le'), vectorBytes);
await writeImmutable(
  resolve(output, 'regression.labels.json'),
  Buffer.from(JSON.stringify({ schemaVersion: 1, split: 'corpus-v1-regression', boards })),
);
await writeImmutable(
  resolve(output, 'vectors.manifest.json'),
  Buffer.from(
    JSON.stringify(
      {
        schemaVersion: 1,
        id: 'corpus-v1-regression',
        role: 'corpus-v1-regression',
        dtype: 'float32-le',
        shape: [boards.length, 64, 1024],
        byteLength: vectorBytes.length,
        sha256: hash(vectorBytes),
        labels: boards.map((board) => ({ boardId: board.id, classes: board.labels })),
      },
      null,
      2,
    ) + '\n',
  ),
);
console.log(
  JSON.stringify({
    boards: boards.length,
    vectorsSha256: hash(vectorBytes),
    corpusManifestSha256: hash(manifestBytes),
  }),
);

const provenance = {
  schemaVersion: 1,
  role: 'post-freeze-regression-provenance',
  command: 'node experiments/recognition-training/regression.ts',
  preparationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  recordedAfterInitialInference: true,
  note: 'Provenance guard added after initial regression preparation; hashes verify the bytes used in browser evaluation. This is not a pretraining test lock.',
  corpusManifestSha256: hash(manifestBytes),
  regressionScriptSha256: hash(await readFile(new URL('./regression.ts', import.meta.url))),
  preprocessingSha256: hash(await readFile(resolve(dirname(fenshotModelPath), '../dist/tiles.js'))),
  canvasPackageSha256: hash(await readFile(requireFixture.resolve('@napi-rs/canvas/package.json'))),
  vectorsSha256: hash(vectorBytes),
  labelsSha256: hash(await readFile(resolve(output, 'regression.labels.json'))),
  wrapperSha256: hash(await readFile(resolve(output, 'vectors.manifest.json'))),
  freezeFileSha256: hash(freezeBytes),
  boards: boards.length,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
};
// Git HEAD can advance during review; the immutable byte/source identities cannot.
const evidencePath = resolve(root, 'runs/regression.evidence.json');
try {
  const prior = object(JSON.parse(await readFile(evidencePath, 'utf8')) as unknown);
  provenance.preparationCommit = String(prior['preparationCommit']);
} catch (error: unknown) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}
await writeImmutable(evidencePath, Buffer.from(JSON.stringify(provenance, null, 2) + '\n'));
