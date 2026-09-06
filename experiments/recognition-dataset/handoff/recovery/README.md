# Reusable shipped FENShot recovery

`fenshot-recovered.pt` is the pre-finetuning Torch state recovered from the
shipped `@scoriiu/fenshot@0.1.4/model/chess-tiles-v2.onnx`. It is **not** an
adapted candidate, original training checkpoint, or optimizer state. Keep the
adjacent byte-preserved JSON report with it. Future runs load this state rather
than reconstructing the ONNX graph again.

| Artifact              | SHA-256                                                            |
| --------------------- | ------------------------------------------------------------------ |
| Recovered Torch state | `e0e215b88cd0a927aa713953a1e6342ea19b1624d782a81a1ec843fa3882415f` |
| Recovery report       | `e245ffc0ba7b0639e59a4375f7d0345d946b88bdcf5316eaa93b0859f16df524` |
| Shipped ONNX          | `883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d` |

Provenance: upstream
[`scoriiu/fenshot` at `5e68f7a04e1261328572caf74a2d4a44a342a6c7`](https://github.com/scoriiu/fenshot/tree/5e68f7a04e1261328572caf74a2d4a44a342a6c7).
Its package includes `model/` under the root MIT grant without a model-specific
exclusion; the README explicitly describes shipping trained weights, not the
training artwork. The full copyright/permission notice is retained in
[LICENSE](LICENSE), consistent with accepted
[ADR 0005](../../../../docs/decisions/0005-browser-recognition.md).
This does not establish a complete upstream training-data inventory or promise
pretrained-disjoint evaluation. No real-document adaptation weights or dataset
pixels are included here.

The JSON report binds reconstruction/trainer hashes, class order, parameter
count and recorded CPU ONNX parity. Hash verification below does not rerun
inference or re-certify that historical parity:

```sh
python3 experiments/recognition-dataset/handoff/preserve_base.py --verify
python3 experiments/recognition-dataset/handoff/preserve_base.py --restore
```

Restore is idempotent and refuses conflicting existing bytes. The existing
trainer then loads `work/modern/base/` with strict state and source-hash checks.
The tracked copy is never a training output destination.
