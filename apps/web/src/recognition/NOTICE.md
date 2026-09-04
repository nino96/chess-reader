# Third-party notices for apps/web/src/recognition

This directory bundles and runs two third-party components entirely offline
in the browser. Both are MIT-licensed; their license texts and attribution
are reproduced below per `docs/dependency-policy.md` §4 ("the upstream
license text and any required NOTICE content, copied into the repository
rather than linked"). Exact provenance (upstream URL, tag/commit, SHA-256) is
recorded in `assets.ts` and re-verified at build time by `assets.test.ts`.

## @scoriiu/fenshot 0.1.4

- Upstream: https://github.com/scoriiu/fenshot
- npm package: `@scoriiu/fenshot@0.1.4`
- Git tag: `v0.1.4`, commit `5e68f7a04e1261328572caf74a2d4a44a342a6c7`
- Bundled asset: `model/chess-tiles-v2.onnx` (the tile classifier model)
- License: MIT

```
MIT License

Copyright (c) 2026 SORTINO LABS S.R.L. (coachess.app)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

fenshot's own detection algorithm is itself a port of
`Elucidation/tensorflow_chessbot` (MIT); see `node_modules/@scoriiu/fenshot/README.md`
"Credits" for that chain. No additional redistribution obligation attaches to
this repository beyond the notice above, since we depend on the published
npm package rather than vendoring tensorflow_chessbot directly.

## onnxruntime-web 1.29.0

- Upstream: https://github.com/microsoft/onnxruntime
- npm package: `onnxruntime-web@1.29.0`
- Bundled asset: `dist/ort-wasm-simd-threaded.wasm` (the WebAssembly runtime binary)
- License: MIT

```
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
