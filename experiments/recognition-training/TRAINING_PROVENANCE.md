# TileNet training-source provenance

The copied architectural and optimization contract in `tilenet_model.py` and
`trainer.py` is reviewed against FENShot revision
`f964fd16de798f73db3ea0f9f1e374e4052a2665`. Issue #38 records that this
training tree is byte-identical to the pinned FENShot 0.1.4 tag.

| Input            | Immutable URL                                                                                                                | SHA-256                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Upstream trainer | `https://raw.githubusercontent.com/scoriiu/fenshot/f964fd16de798f73db3ea0f9f1e374e4052a2665/tools/tile-classifier/train.py`  | `4191ba14716963dfad4a47f08b4b33cc26127243a0cef5d2f5036ec0c703754e` |
| Training README  | `https://raw.githubusercontent.com/scoriiu/fenshot/f964fd16de798f73db3ea0f9f1e374e4052a2665/tools/tile-classifier/README.md` | `2b1eff29a19162f8f535988cf4c031162cb8053dccebe8e26330a7f04e946a4a` |
| License          | `https://raw.githubusercontent.com/scoriiu/fenshot/f964fd16de798f73db3ea0f9f1e374e4052a2665/LICENSE`                         | `8685a531431b51328047797bc4b3574db3039a8abffb86a8b4d46b55dd5f6360` |

The experiment keeps the upstream TileNet layer shapes, 13-class order,
preprocessing surface, AdamW values, batch size, label smoothing, cosine
schedule, fixed photometric augmentation, fp32 softmax export and opset-17
ONNX schema. It changes device selection only: CUDA is required for declared
training runs and fails closed when unavailable. It also adds deterministic
checkpoint/recovery state, input validation, bounded execution and provenance
reports required by this repository.

## FENShot license

```text
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
