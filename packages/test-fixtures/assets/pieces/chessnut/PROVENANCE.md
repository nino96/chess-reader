# Chessnut piece set provenance

- **Source**: https://github.com/LexLuengas/chessnut-pieces
- **Commit**: `2b8eaf14a31edad7e9deb53b1473e1d4857868a9` (the repository's `master`
  branch tip at retrieval time, per
  `https://api.github.com/repos/LexLuengas/chessnut-pieces/commits/master`)
- **Retrieved**: 2026-09-04
- **License**: Apache License 2.0 (`LICENSE.txt`, fetched from the same commit)
- **Copyright**: `Copyright 2015 Alexis Luengas` (`COPYRIGHT.txt`, fetched from the
  same commit)

Every SVG below was fetched unmodified from
`https://raw.githubusercontent.com/LexLuengas/chessnut-pieces/master/<name>.svg`
at the commit above. They are redistributed here under the Apache-2.0 license;
this file plus `LICENSE.txt` and `COPYRIGHT.txt` carry that license's required
attribution and notice. `generators/lib/svg-shapes.mjs` parses these files
in-repo to draw piece glyphs onto the synthetic diagram fixture
(`pdf/pdf-synthetic-diagram-01.pdf`); no bitmap or copy of the artwork itself
is redistributed beyond these source files.

## SHA-256 of each retrieved file

| File          | SHA-256                                                          |
| ------------- | ---------------------------------------------------------------- |
| wK.svg        | e50809e91a15790c8d81d3f199bf569f0eb5a09c472a0415944e8c9e3cfcddd0 |
| wQ.svg        | 2395664337bea8f13093858320cce6075d80f8086e6aa47e122ce556262b4d6b |
| wR.svg        | e7fb8605a9318ef50e497a97680e4722d3eabc1e9ab6e4e9f594b8f2ca2022e5 |
| wB.svg        | 14cd4828240708d4d8431034537e2a5fb662d5054246fef681b172680cae9fcd |
| wN.svg        | adc921896bb6e6547828f2a6eb3d5195dd1b7ac8e8c1d2a9085583e4d4d81b68 |
| wP.svg        | 0cf9dfe2f7b3ab11a7fdb13bf350f32e7a6c94e193fc023933e129ec02eeed8d |
| bK.svg        | 220d75890b4368f0309bab0be40ac1dac6809508f5e1ecb119d35d225bf01f90 |
| bQ.svg        | 0308426c9cfafabdce64600cbe90c193fc6ef7665f072b43d4dc82b5c1047670 |
| bR.svg        | ad18856a97edf53281acc40e1e6e4f7021ed01fad380fff7e09e63465b3bb462 |
| bB.svg        | f835819861774dcacef7370ed2c23d4022ef6c2b17383a6a79c5f683d105e8b6 |
| bN.svg        | acabd5a82666927d850a9eaab6f3766ef196a999dd3c6de0f927a8f12dacd356 |
| bP.svg        | 073fb7b38b2ebe66ee54854fa492da6cc04e6d92bc679c860b77c254fa1d46ce |
| LICENSE.txt   | cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 |
| COPYRIGHT.txt | a66f251bcdb99479c102695a75ba292244ccf45f1f2710af552acdf4887e4f90 |

Re-fetch and re-hash to verify:

```sh
curl -sf https://raw.githubusercontent.com/LexLuengas/chessnut-pieces/2b8eaf14a31edad7e9deb53b1473e1d4857868a9/wK.svg | sha256sum
```
