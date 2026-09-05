/** Runtime-validated access to the locked printed-book recognition corpus. */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORPUS_MANIFEST_PATH = 'corpus/v1/manifest.json';
const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type CorpusOrientation = 'white' | 'black' | 'ambiguous';
export type CorpusAnnotationKind = 'complete' | 'partial';
export type CorpusPatternDensity = 'sparse' | 'medium' | 'dense';

export interface CorpusPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type CorpusSquareStyle =
  | { readonly kind: 'flat'; readonly gray: number }
  | {
      readonly kind: 'hatch';
      readonly angle: 0 | 45 | 90 | 135;
      readonly density: CorpusPatternDensity;
    }
  | { readonly kind: 'halftone'; readonly density: CorpusPatternDensity };

export interface CorpusAnnotation {
  readonly id: string;
  readonly kind: CorpusAnnotationKind;
  /** Top-left coordinates in the page image's native pixels. */
  readonly pixelRect: CorpusPixelRect;
  /** Standard rank-8-to-rank-1 FEN piece-placement field; null for partial truth. */
  readonly canonicalPlacement: string | null;
  /** FEN-shaped rows in raw top-to-bottom, left-to-right image order. */
  readonly renderedPlacement: string | null;
  readonly orientation: CorpusOrientation;
  readonly pieceStyle: 'chessnut';
  readonly squareStyle: CorpusSquareStyle;
  readonly hasCoordinateLabels: boolean;
  readonly borderWidthPx: number;
}

export interface CorpusPage {
  readonly id: string;
  /** Package-root-relative path, suitable for `corpusPath(page.path)`. */
  readonly path: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly tags: readonly string[];
  readonly generator: {
    readonly spec: string;
    readonly seed: number;
    readonly degradation: Readonly<Record<string, unknown>> | null;
  };
  readonly annotations: readonly CorpusAnnotation[];
}

export interface CorpusManifest {
  readonly schemaVersion: 1;
  readonly corpusId: 'printed-book-recognition';
  readonly corpusVersion: 1;
  readonly lockedBeforeTuning: true;
  readonly coordinateSystem: 'top-left-image-pixels';
  readonly pageWidth: 768;
  readonly pageHeight: 1024;
  readonly matching: {
    readonly rule: 'one-to-one-descending-iou';
    readonly iouThreshold: number;
    readonly tieBreakers: readonly string[];
    readonly duplicatePredictions: 'failure';
    readonly partialAnnotations: 'excluded-from-complete-truth';
  };
  readonly tolerance: {
    readonly rectanglePixels: number;
    readonly gridErrorSquares: number;
  };
  readonly generation: {
    readonly generator: string;
    readonly spec: string;
    readonly seed: number;
    readonly renderer: string;
    readonly pieceStyles: readonly {
      readonly id: string;
      readonly license: string;
      readonly provenance: string;
    }[];
    readonly exclusions: readonly string[];
  };
  readonly contactSheet: {
    readonly path: string;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
  };
  readonly pages: readonly CorpusPage[];
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PLACEMENT_TOKEN_PATTERN = /^[prnbqkPRNBQK1-8]$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid recognition corpus manifest at ${path}: ${message}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) fail(path, 'expected an object');
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'unexpected property');
  }
  for (const key of keys) {
    if (!(key in value)) fail(path, `missing required property "${key}"`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string');
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    fail(path, `must be an integer at least ${String(minimum)}`);
  }
  return value;
}

function stringArray(value: unknown, path: string, minimum = 0): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    !value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    fail(path, `must be an array of at least ${String(minimum)} non-empty strings`);
  }
  return value as string[];
}

/** Expands and validates a FEN piece-placement field to exactly 64 image-order squares. */
export function expandCorpusPlacement(placement: string): readonly (string | null)[] {
  const ranks = placement.split('/');
  if (ranks.length !== 8) fail('placement', 'must contain exactly eight ranks');
  const squares: (string | null)[] = [];
  ranks.forEach((rank, rankIndex) => {
    let rankWidth = 0;
    for (const token of rank) {
      if (!PLACEMENT_TOKEN_PATTERN.test(token))
        fail(`placement.rank[${String(rankIndex)}]`, `invalid token "${token}"`);
      if (/^[1-8]$/.test(token)) {
        const count = Number(token);
        squares.push(...Array(count).fill(null));
        rankWidth += count;
      } else {
        squares.push(token);
        rankWidth += 1;
      }
    }
    if (rankWidth !== 8)
      fail(`placement.rank[${String(rankIndex)}]`, 'must expand to eight squares');
  });
  if (squares.length !== 64) fail('placement', 'must expand to exactly 64 squares');
  return squares;
}

function validateRect(
  value: unknown,
  path: string,
  pageWidth: number,
  pageHeight: number,
): CorpusPixelRect {
  const rect = objectAt(value, path);
  exactKeys(rect, ['x', 'y', 'width', 'height'], path);
  const x = integer(rect['x'], `${path}.x`);
  const y = integer(rect['y'], `${path}.y`);
  const width = integer(rect['width'], `${path}.width`, 1);
  const height = integer(rect['height'], `${path}.height`, 1);
  if (x + width > pageWidth || y + height > pageHeight)
    fail(path, 'must remain inside the page image');
  return { x, y, width, height };
}

function validateSquareStyle(value: unknown, path: string): CorpusSquareStyle {
  const style = objectAt(value, path);
  const kind = style['kind'];
  if (kind === 'flat') {
    exactKeys(style, ['kind', 'gray'], path);
    const gray = style['gray'];
    if (typeof gray !== 'number' || gray < 0 || gray > 1)
      fail(`${path}.gray`, 'must be between 0 and 1');
    return { kind, gray };
  }
  if (kind === 'hatch') {
    exactKeys(style, ['kind', 'angle', 'density'], path);
    const angle = style['angle'];
    if (angle !== 0 && angle !== 45 && angle !== 90 && angle !== 135)
      fail(`${path}.angle`, 'must be 0, 45, 90, or 135');
    const density = validateDensity(style['density'], `${path}.density`);
    return { kind, angle, density };
  }
  if (kind === 'halftone') {
    exactKeys(style, ['kind', 'density'], path);
    return { kind, density: validateDensity(style['density'], `${path}.density`) };
  }
  return fail(`${path}.kind`, 'must be flat, hatch, or halftone');
}

function validateDensity(value: unknown, path: string): CorpusPatternDensity {
  if (value !== 'sparse' && value !== 'medium' && value !== 'dense')
    fail(path, 'must be sparse, medium, or dense');
  return value;
}

function validateAnnotation(
  value: unknown,
  path: string,
  width: number,
  height: number,
): CorpusAnnotation {
  const annotation = objectAt(value, path);
  exactKeys(
    annotation,
    [
      'id',
      'kind',
      'pixelRect',
      'canonicalPlacement',
      'renderedPlacement',
      'orientation',
      'pieceStyle',
      'squareStyle',
      'hasCoordinateLabels',
      'borderWidthPx',
    ],
    path,
  );
  const id = nonEmptyString(annotation['id'], `${path}.id`);
  const kind = annotation['kind'];
  if (kind !== 'complete' && kind !== 'partial')
    fail(`${path}.kind`, 'must be complete or partial');
  const pixelRect = validateRect(annotation['pixelRect'], `${path}.pixelRect`, width, height);
  const orientation = annotation['orientation'];
  if (orientation !== 'white' && orientation !== 'black' && orientation !== 'ambiguous')
    fail(`${path}.orientation`, 'must be white, black, or ambiguous');
  const canonicalPlacement = annotation['canonicalPlacement'];
  const renderedPlacement = annotation['renderedPlacement'];
  if (kind === 'partial') {
    if (canonicalPlacement !== null || renderedPlacement !== null)
      fail(path, 'partial annotations must omit placement truth with null values');
  } else {
    if (typeof canonicalPlacement !== 'string' || typeof renderedPlacement !== 'string')
      fail(path, 'complete annotations require canonical and rendered placements');
    expandCorpusPlacement(canonicalPlacement);
    expandCorpusPlacement(renderedPlacement);
    if (pixelRect.width !== pixelRect.height || pixelRect.width % 8 !== 0)
      fail(
        `${path}.pixelRect`,
        'complete board truth must be a square divisible into eight integer squares',
      );
  }
  if (annotation['pieceStyle'] !== 'chessnut')
    fail(`${path}.pieceStyle`, 'must be chessnut in corpus v1');
  if (typeof annotation['hasCoordinateLabels'] !== 'boolean')
    fail(`${path}.hasCoordinateLabels`, 'must be boolean');
  const borderWidthPx = integer(annotation['borderWidthPx'], `${path}.borderWidthPx`);
  return {
    id,
    kind,
    pixelRect,
    canonicalPlacement: canonicalPlacement as string | null,
    renderedPlacement: renderedPlacement as string | null,
    orientation,
    pieceStyle: 'chessnut',
    squareStyle: validateSquareStyle(annotation['squareStyle'], `${path}.squareStyle`),
    hasCoordinateLabels: annotation['hasCoordinateLabels'],
    borderWidthPx,
  };
}

function validatePage(
  value: unknown,
  path: string,
  pageWidth: number,
  pageHeight: number,
): CorpusPage {
  const page = objectAt(value, path);
  exactKeys(
    page,
    ['id', 'path', 'sha256', 'width', 'height', 'tags', 'generator', 'annotations'],
    path,
  );
  const id = nonEmptyString(page['id'], `${path}.id`);
  if (!ID_PATTERN.test(id)) fail(`${path}.id`, 'must be lower-kebab-case');
  const relativePath = nonEmptyString(page['path'], `${path}.path`);
  if (relativePath !== `corpus/v1/pages/${id}.png`)
    fail(`${path}.path`, 'must be the canonical corpus/v1 page path for this id');
  const hash = nonEmptyString(page['sha256'], `${path}.sha256`);
  if (!SHA256_PATTERN.test(hash)) fail(`${path}.sha256`, 'must be a lowercase SHA-256');
  const width = integer(page['width'], `${path}.width`, 1);
  const height = integer(page['height'], `${path}.height`, 1);
  if (width !== pageWidth || height !== pageHeight)
    fail(path, 'page dimensions must match the corpus dimensions');
  const tags = stringArray(page['tags'], `${path}.tags`, 1);
  const generator = objectAt(page['generator'], `${path}.generator`);
  exactKeys(generator, ['spec', 'seed', 'degradation'], `${path}.generator`);
  const spec = nonEmptyString(generator['spec'], `${path}.generator.spec`);
  const seed = integer(generator['seed'], `${path}.generator.seed`);
  const degradation = generator['degradation'];
  if (degradation !== null && !isObject(degradation))
    fail(`${path}.generator.degradation`, 'must be an object or null');
  const rawAnnotations = page['annotations'];
  if (!Array.isArray(rawAnnotations)) fail(`${path}.annotations`, 'must be an array');
  const annotations = rawAnnotations.map((annotation, index) =>
    validateAnnotation(annotation, `${path}.annotations[${String(index)}]`, width, height),
  );
  const annotationIds = new Set<string>();
  for (const annotation of annotations) {
    if (annotationIds.has(annotation.id))
      fail(`${path}.annotations`, `duplicate annotation id "${annotation.id}"`);
    annotationIds.add(annotation.id);
  }
  return {
    id,
    path: relativePath,
    sha256: hash,
    width,
    height,
    tags,
    generator: { spec, seed, degradation: degradation as Readonly<Record<string, unknown>> | null },
    annotations,
  };
}

/** Validates untrusted parsed JSON and returns the typed corpus manifest. */
export function parseCorpusManifest(value: unknown): CorpusManifest {
  const manifest = objectAt(value, '$');
  exactKeys(
    manifest,
    [
      'schemaVersion',
      'corpusId',
      'corpusVersion',
      'lockedBeforeTuning',
      'coordinateSystem',
      'pageWidth',
      'pageHeight',
      'matching',
      'tolerance',
      'generation',
      'contactSheet',
      'pages',
    ],
    '$',
  );
  if (manifest['schemaVersion'] !== 1) fail('$.schemaVersion', 'must be exactly 1');
  if (manifest['corpusId'] !== 'printed-book-recognition')
    fail('$.corpusId', 'must identify the printed-book recognition corpus');
  if (manifest['corpusVersion'] !== 1) fail('$.corpusVersion', 'must be exactly 1');
  if (manifest['lockedBeforeTuning'] !== true) fail('$.lockedBeforeTuning', 'must be true');
  if (manifest['coordinateSystem'] !== 'top-left-image-pixels')
    fail('$.coordinateSystem', 'must be top-left-image-pixels');
  if (manifest['pageWidth'] !== 768 || manifest['pageHeight'] !== 1024)
    fail('$', 'v1 page dimensions must be 768 x 1024');

  const matching = objectAt(manifest['matching'], '$.matching');
  exactKeys(
    matching,
    ['rule', 'iouThreshold', 'tieBreakers', 'duplicatePredictions', 'partialAnnotations'],
    '$.matching',
  );
  if (
    matching['rule'] !== 'one-to-one-descending-iou' ||
    matching['duplicatePredictions'] !== 'failure' ||
    matching['partialAnnotations'] !== 'excluded-from-complete-truth'
  )
    fail('$.matching', 'does not match the locked v1 matching rule');
  if (matching['iouThreshold'] !== 0.9)
    fail('$.matching.iouThreshold', 'must be exactly 0.9 in corpus v1');
  const tieBreakers = stringArray(matching['tieBreakers'], '$.matching.tieBreakers', 1);
  if (tieBreakers.join(',') !== 'prediction-index,annotation-index')
    fail('$.matching.tieBreakers', 'must use prediction index then annotation index');

  const tolerance = objectAt(manifest['tolerance'], '$.tolerance');
  exactKeys(tolerance, ['rectanglePixels', 'gridErrorSquares'], '$.tolerance');
  const rectanglePixels = integer(tolerance['rectanglePixels'], '$.tolerance.rectanglePixels');
  const gridErrorSquares = tolerance['gridErrorSquares'];
  if (gridErrorSquares !== 0.08) {
    fail('$.tolerance.gridErrorSquares', 'must be exactly 0.08 in corpus v1');
  }

  const generation = objectAt(manifest['generation'], '$.generation');
  exactKeys(
    generation,
    ['generator', 'spec', 'seed', 'renderer', 'pieceStyles', 'exclusions'],
    '$.generation',
  );
  const rawPieceStyles = generation['pieceStyles'];
  if (!Array.isArray(rawPieceStyles) || rawPieceStyles.length === 0)
    fail('$.generation.pieceStyles', 'must be a non-empty array');
  const pieceStyles = rawPieceStyles.map((raw, index) => {
    const style = objectAt(raw, `$.generation.pieceStyles[${String(index)}]`);
    exactKeys(style, ['id', 'license', 'provenance'], `$.generation.pieceStyles[${String(index)}]`);
    return {
      id: nonEmptyString(style['id'], `$.generation.pieceStyles[${String(index)}].id`),
      license: nonEmptyString(
        style['license'],
        `$.generation.pieceStyles[${String(index)}].license`,
      ),
      provenance: nonEmptyString(
        style['provenance'],
        `$.generation.pieceStyles[${String(index)}].provenance`,
      ),
    };
  });
  const generationValue = {
    generator: nonEmptyString(generation['generator'], '$.generation.generator'),
    spec: nonEmptyString(generation['spec'], '$.generation.spec'),
    seed: integer(generation['seed'], '$.generation.seed'),
    renderer: nonEmptyString(generation['renderer'], '$.generation.renderer'),
    pieceStyles,
    exclusions: stringArray(generation['exclusions'], '$.generation.exclusions'),
  };

  const contact = objectAt(manifest['contactSheet'], '$.contactSheet');
  exactKeys(contact, ['path', 'sha256', 'width', 'height'], '$.contactSheet');
  const contactHash = nonEmptyString(contact['sha256'], '$.contactSheet.sha256');
  if (!SHA256_PATTERN.test(contactHash))
    fail('$.contactSheet.sha256', 'must be a lowercase SHA-256');
  const contactSheet = {
    path: nonEmptyString(contact['path'], '$.contactSheet.path'),
    sha256: contactHash,
    width: integer(contact['width'], '$.contactSheet.width', 1),
    height: integer(contact['height'], '$.contactSheet.height', 1),
  };

  const rawPages = manifest['pages'];
  if (!Array.isArray(rawPages) || rawPages.length === 0)
    fail('$.pages', 'must be a non-empty array');
  const pages = rawPages.map((page, index) =>
    validatePage(page, `$.pages[${String(index)}]`, 768, 1024),
  );
  const pageIds = new Set<string>();
  for (const page of pages) {
    if (pageIds.has(page.id)) fail('$.pages', `duplicate page id "${page.id}"`);
    pageIds.add(page.id);
  }

  return {
    schemaVersion: 1,
    corpusId: 'printed-book-recognition',
    corpusVersion: 1,
    lockedBeforeTuning: true,
    coordinateSystem: 'top-left-image-pixels',
    pageWidth: 768,
    pageHeight: 1024,
    matching: {
      rule: 'one-to-one-descending-iou',
      iouThreshold: matching['iouThreshold'],
      tieBreakers,
      duplicatePredictions: 'failure',
      partialAnnotations: 'excluded-from-complete-truth',
    },
    tolerance: { rectanglePixels, gridErrorSquares },
    generation: generationValue,
    contactSheet,
    pages,
  };
}

/** Resolves a package-root-relative corpus path for Node-based tests/evaluations. */
export function corpusPath(relativePath: string): string {
  const resolved = resolve(FIXTURES_ROOT, relativePath);
  const fromRoot = relative(FIXTURES_ROOT, resolved);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Corpus path escapes the fixture package: ${relativePath}`);
  }
  return resolved;
}

/** Reads and runtime-validates corpus/v1/manifest.json. */
export function loadCorpus(): CorpusManifest {
  const source = readFileSync(corpusPath(CORPUS_MANIFEST_PATH), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${CORPUS_MANIFEST_PATH} is not valid JSON: ${message}`);
  }
  return parseCorpusManifest(parsed);
}
