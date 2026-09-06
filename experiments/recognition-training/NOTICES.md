# Recognition-training source notices

The external glyph sources are downloaded only into ignored `data/source-cache/`.
They are pinned to Lila revision
[`2e48c25007bc3344411811a24cd6cab666c67cbf`](https://github.com/lichess-org/lila/tree/2e48c25007bc3344411811a24cd6cab666c67cbf)
and are verified against the aggregate SHA-256 locks in `source-lock.mjs` before
any board is generated.

The primary notice is Lila's
[`COPYING.md`](https://github.com/lichess-org/lila/blob/2e48c25007bc3344411811a24cd6cab666c67cbf/COPYING.md),
whose locked SHA-256 is `d5b0b45dd3dc8430e5b826ba788e62137eae938319a16d4ed5c9e4d5b2899da9`.
Its exceptions table identifies the permitted source directories used here:

- `public/piece/chessnut`: Alexis Luengas, Apache-2.0.
- `public/piece/fantasy`, `public/piece/spatial`, and `public/piece/celtic`:
  Maurizio Monge, MIT. The full Monge author family is train-only.
- `public/piece/firi`: James Faure, CC-BY-4.0, dev-only.
- `public/piece/rhosgfx`: RhosGFX, CC0-1.0, held-out test-only.

The source lock deliberately excludes Lila's default AGPL material and every
GPL, non-commercial, non-derivative, or otherwise unverified piece family.
It also does not use `packages/test-fixtures/corpus/v1`: that frozen evaluation
corpus cannot be an input to generation, training, or tuning.

The generated boards are new synthetic raster renderings. They combine a locked
glyph family with generated square treatments, deterministic downsampling and
speckle. Before rendering each white silhouette, the generator draws a fixed
0.75-pixel dark (`#2b2926`) contour at its four cardinal offsets, followed by
the unchanged source glyph. This makes white ink visible on generated paper in
all source families and roles; it does not alter any locked SVG. No source book
page, user data, or original glyph SVG is committed in the generated artifacts.
`source-lock.mjs` records the SHA-256 of every SVG as well as each family
aggregate, and `fetch:sources` refuses a cache whose notice or any asset does
not match those locks.
