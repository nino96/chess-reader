# @chess-reader/test-fixtures

Synthetic and licensed fixtures with a provenance manifest, per the contract in
[`docs/fixtures.md`](../../docs/fixtures.md). Nothing under this package is a
user's copyrighted book; see that document for the rules every fixture here
must follow.

## What's here

- `manifest.json` -- the fixture manifest (schema: `manifest.schema.json`,
  mirrored verbatim from `docs/fixtures.md` §5). Every fixture file is listed
  here with its sha256, provenance, and expected/tolerance values.
- `pdf/pdf-synthetic-diagram-01.pdf` -- a deterministic, synthetic 2-page PDF:
  page 0 is plain text with no diagram (a negative fixture); page 1 has a
  printed-book-style chess diagram (flat-gray dark squares, vector piece
  glyphs) between two paragraphs of text.
- `pdf/pdf-synthetic-hatched-01.pdf` -- the same layout, position, and glyphs
  with 45-degree hatched dark squares; a locked diagnostic pair for issue #24.
- `generators/make-diagram-pdf.mjs` -- the committed generator that produces
  the PDF above, byte-for-byte reproducibly. `generators/lib/layout.mjs`
  holds the page/board geometry as the single source of truth shared by the
  generator and the tests; `generators/lib/svg-shapes.mjs` is a small in-file
  SVG parser for the piece glyphs (`<path>`/`<line>`/`<circle>`/`<ellipse>`
  with `style`/`fill`/`stroke` attributes -- see the file for exactly what
  subset it supports).
- `assets/pieces/chessnut/` -- the 12 piece SVGs (`wK`..`bP`) from the
  [chessnut-pieces](https://github.com/LexLuengas/chessnut-pieces) set
  (Apache-2.0), plus its `LICENSE.txt`/`COPYRIGHT.txt` and a `PROVENANCE.md`
  recording the exact commit, retrieval date, and a sha256 of every file.
- `src/index.ts` -- `loadManifest()`/`getFixture(id)` (runtime-validated
  against the schema, no external dependency) and `fixturePath()`.
- `tests/manifest.test.ts` -- the manifest validates, every listed file
  exists with the sha256 it claims, nothing under `pdf/` is untracked, and
  the committed PDF is byte-identical to what the generator produces today.
- `tests/diagram-recognition.test.ts` -- the real-model golden test: renders
  `pdf-synthetic-diagram-01.pdf` with `pdfjs-dist` in Node, crops the board
  (manifest `expected.boardRect`, padded 3% to mimic a hand-drawn selection),
  and runs `@scoriiu/fenshot`'s actual `recognizeGray` + ONNX classifier
  pipeline against it -- the same core `apps/web/src/recognition/pipeline.ts`
  calls. A second case crops page 0's title line and asserts no board is
  found there.
- `tests/localization-diagnostic.test.ts` -- compares unchanged FENShot with
  ground-truth corners and a bounds-rejection control on identical pixels.
  See the [diagnosis](../../docs/investigations/issue-24-localization.md) for
  the optional 96-capture sweep and recorded evidence.

## Regenerating the PDF

```sh
pnpm --filter @chess-reader/test-fixtures generate
# or directly:
node generators/make-diagram-pdf.mjs [outputPath]
```

Regeneration is deterministic (fixed Info-dict dates/producer/creator, no
random trailer ID): running it twice, or via `tests/manifest.test.ts`,
produces byte-identical output. The script prints the output's sha256 and
computed geometry (`boardRect`, `placement`, `negativeTextRect`) as JSON.

If you change the generator, `manifest.json`'s `sha256` field must be updated
to match (`tests/manifest.test.ts` enforces this).

## Running the tests

From this package:

```sh
pnpm exec vitest run
# a single file:
pnpm exec vitest run tests/diagram-recognition.test.ts
```

`tests/diagram-recognition.test.ts` loads a real ONNX Runtime session
(`@scoriiu/fenshot`'s `chess-tiles-v2.onnx`) and renders a PDF page with
`@napi-rs/canvas`, so it only runs under Vitest (fenshot's build uses
extensionless relative imports that plain `node` cannot resolve, and Vitest's
`server.deps.inline` config in `vitest.config.ts` is what makes them
resolvable at all). It prints one JSON line per case with the crop size and
measured latency (`totalMs`, `inferenceMs`, `inferenceCalls`); there is no
latency threshold, only a correctness assertion.

## Diagram style: what worked and what did not

The notes below describe the original style exploration, not evidence that
hatched recognition passes. The committed issue #2 golden fixture is flat
gray. The issue #24 [controlled experiment](../../docs/investigations/issue-24-localization.md)
now distinguishes localization failure from the classifier's smaller residual
error and confidence limitations on the separate hatched fixture.

The issue's style guidance suggested a thin outer board border and ~80%
piece scale. Empirically:

- **A drawn border broke detection.** Even a 0.5pt border reliably pulled
  fenshot's gradient-peak board finder off by roughly a quarter square on
  this hatch texture -- its own documentation calls exactly this a known
  failure mode of hatched book diagrams. The result was either a whole
  rank/file shift in the read placement, or enough tiles below the 0.7
  reliability floor to fail `reliable === true`. The final diagram has no
  drawn border.
- **Hatch line width/gap** were matched proportionally to
  `@scoriiu/fenshot`'s own training corpus generator
  (`tools/tile-classifier/generate-corpus.ts`'s `proceduralHatchBoard`:
  square = 64px, line width 1-3px, gap 5-11px). The final values are line
  width `1/64` and gap `11/64` of the square size (the sparser end of that
  range); a mid-range gap (`8/64`, `9/64`) either left some tile confidences
  below 0.7 or, in one case, broke board detection outright, and a thicker
  line (`3/64`) caused several outright misreads.
- **Piece scale is 88%** of the square, not the suggested ~80%: more piece
  area and less hatched background per occupied tile measurably raised tile
  confidence. This and the missing border are recorded in
  `manifest.json`'s `limitations` array.
- **The remaining wrinkle is fenshot's own tile-extraction resize**
  (`extractBoardImage`'s bilinear downsample from the detected board region
  to 256x256): visually confirmed harmless at full capture resolution, it
  reintroduces hatch-like artifacts into some downsampled tiles, most
  visible on tiles farthest from the board's near edge. The classifier is
  trained to be robust to exactly this kind of resize artifact (its corpus
  includes "resize round-trips" as a degradation), and the final result
  on the committed flat-gray golden fixture reads all 64 tiles correctly.
  This does not establish hatch robustness or prove the source of residual
  low-resolution errors.

## Provenance summary

- **`pdf-synthetic-diagram-01.pdf`**: synthetic, generated in-repo, CC0-1.0
  (see `manifest.json`). Contains no third-party text or images other than
  the piece glyphs below.
- **Piece glyphs**: [chessnut-pieces](https://github.com/LexLuengas/chessnut-pieces)
  by Alexis Luengas, Apache License 2.0, commit
  `2b8eaf14a31edad7e9deb53b1473e1d4857868a9`, retrieved 2026-09-04. Full
  attribution, license text, and per-file sha256 in
  `assets/pieces/chessnut/PROVENANCE.md`.
