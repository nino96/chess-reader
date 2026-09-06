# TileNet browser evaluation harness

This evaluation-only harness runs frozen TileNet ONNX files through the same
ONNX Runtime Web contract used by the application: single-threaded WASM,
`tiles` fp32 `[64,1024]` input, `probs` fp32 `[64,13]` output, class order
`1KQRBNPkqrbnp`, and the unchanged `0.7` confidence floor. It does not alter or
import a candidate into the production recognizer.

Candidate models, frozen vectors, local configuration and generated reports
belong under the ignored `experiments/recognition-training/runs/` tree. The
Playwright driver exposes only the exact files declared in the local config as
same-origin routes. The worker verifies their SHA-256 values before creating a
session or running inference. A blanket route guard fails any request to a
different origin.

## Frozen inputs

Set `CHESS_READER_TRAINING_BROWSER_CONFIG` to an ignored JSON file matching
`local-config.example.json`. Paths are resolved relative to that file. The
candidate freeze has this exact shape:

```json
{
  "schemaVersion": 1,
  "runKind": "full",
  "frozenAt": "2026-09-05T00:00:00.000Z",
  "protocolSha256": "64 lowercase hexadecimal characters",
  "testManifestSha256": "64 lowercase hexadecimal characters",
  "candidates": [
    {
      "id": "shipped",
      "seed": null,
      "modelPath": "../models/shipped.onnx",
      "sha256": "64 lowercase hexadecimal characters",
      "bytes": 1289483
    },
    {
      "id": "tilenet-3801",
      "seed": 3801,
      "modelPath": "../models/tilenet-3801.onnx",
      "sha256": "64 lowercase hexadecimal characters",
      "bytes": 1
    },
    {
      "id": "tilenet-3802",
      "seed": 3802,
      "modelPath": "../models/tilenet-3802.onnx",
      "sha256": "64 lowercase hexadecimal characters",
      "bytes": 1
    }
  ]
}
```

A full freeze requires exactly the shipped control and seeds 3801 and 3802,
and binds the held-out vector manifest with `testManifestSha256`. A pilot freeze
may contain its separately declared pilot candidates and may set the test hash
to `null`. Every candidate entry is evaluated; the harness has no best-result
selection option.

Each vector wrapper has this exact shape:

```json
{
  "schemaVersion": 1,
  "id": "held-out-v1",
  "role": "held-out-test",
  "dtype": "float32-le",
  "shape": [1, 64, 1024],
  "byteLength": 262144,
  "sha256": "64 lowercase hexadecimal characters",
  "labels": [
    {
      "boardId": "opaque-board-1",
      "classes": [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0
      ]
    }
  ]
}
```

`classes` must contain exactly 64 integers in A1..H8 order. The wrapper binds
the raw little-endian fp32 file
produced by the dataset pipeline without regenerating preprocessing per model
or browser. The committed dataset manifest remains the source of provenance,
family membership, generator identity and split locking; this wrapper is only
the browser boundary.

## Commands

Run these from the repository root after candidates and all test identities are
frozen. Do not run a full config while training or selection is still changing.

```sh
pnpm --dir apps/web exec tsc -p ../../experiments/recognition-training/browser/tsconfig.json
pnpm --dir apps/web exec vitest run --config ../../experiments/recognition-training/browser/vitest.config.ts
CHESS_READER_TRAINING_BROWSER_CONFIG=experiments/recognition-training/runs/local-config.json \
  pnpm --dir apps/web exec playwright test --config ../../experiments/recognition-training/browser/playwright.config.ts
```

The browser command runs Chromium, Firefox and WebKit. For every candidate and
vector role it performs one complete pass, three fresh session initializations,
and repeated warm inference on at most the first four frozen boards. It reports
raw exact-board and square accuracy, confidence-qualified accuracy, reliable
wrong boards, a 13-by-13 confusion matrix, minimum/mean confidence and latency
distributions. Reports contain opaque board IDs and measurements, never vector
values, predicted class sequences, FENs, source filenames or absolute paths.

Each candidate also receives browser checks for cancellation between board
batches, timeout termination and clean recovery, model-integrity failure before
inference, warm offline inference and zero requests to another origin.
Cancellation cannot interrupt a synchronous WASM call already executing, so it
suppresses that result and prevents all remaining board calls. Warm offline
means the worker, model, vectors and ORT session initialized before Playwright
disabled networking. This is no claim of cold offline reload readiness, which
depends on the later service-worker work. Playwright WebKit is not physical-iPad
evidence; physical iPad remains deferred and unrun for this experiment.
