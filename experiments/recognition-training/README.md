# Issue #38: bounded TileNet retraining

This directory holds a local training experiment, not a production recognizer.
Its dependency, [PR #37](https://github.com/nino96/chess-reader/pull/37), was
confirmed merged at `ccc575ffecbc98dd10bd8f497887d0e481bc1b77` before branching
from updated `origin/main`. The [#35 comparison](../../docs/investigations/issue-35-comparison.md)
and [ADR 0005](../../docs/decisions/0005-browser-recognition.md) remain the
architectural constraints. [#24](https://github.com/nino96/chess-reader/issues/24)
stays open; physical-iPad execution is **deferred/unrun**.

## Predeclared experiment

[protocol.json](protocol.json) freezes seeds, budgets, architecture, export
tolerances, checkpoint selection and promotion rules before the pilot. The
pilot uses seed 38 and only development inputs. The two full runs use seeds
3801 and 3802, twelve epochs each, AdamW, and the unchanged 321,805-parameter
TileNet. The earliest checkpoint with minimum development cross-entropy wins
within each seed. Both selected candidates must be frozen before any held-out
or corpus-v1 inference. Every seed is reported; there is no post-test winner
selection, threshold adjustment, recipe revision or training extension.

Training budgets are 600 seconds for the pilot and 2,700 seconds for each full
seed, including training, development validation and checkpoint work. Setup,
source download, generation and browser evaluation have separate accounting;
they do not justify extending an exhausted training budget. An interrupted or
failed run is retained as such. Recovery preserves optimizer, scheduler and
random-number state as well as model weights.

## Data and interpretation

The owner selected synthetic-first data. Source artwork must have immutable
revision URLs, locally verified SHA-256, an explicit compatible license and
the required notices before rendering. Generated diagrams, caches, vectors,
checkpoints and ONNX candidates remain ignored. Committed manifests and reports
identify inputs by hashes and opaque sample identities, without copying input
images, label sequences, FENs or private file paths into metric artifacts.

Whole glyph/source families define the development training, development
validation and held-out roles. Every board contributes all its tiles to just
one role. The generator uses the pinned FENShot preprocessing and produces
little-endian fp32 `[boards,64,1024]` vectors in A1-through-H8 order. Class order
is `1KQRBNPkqrbnp`. The classifier/export interface remains
`tiles [N,1024] -> probs [N,13]`, opset 17, with confidence floor 0.7.

Corpus v1 and every historical baseline are preserved byte-for-byte. Corpus v1
is excluded from training, development validation, selection and tuning. Its
already-public results are historical regression evidence, not a new
generalization test. The separate `regression.ts` preparation command requires
both frozen full-run candidates and checks the original corpus/page hashes.

Synthetic held-out styles can measure transfer across the declared families;
they cannot establish real scanned-book representativeness. This experiment
does not infer detection, orientation, complete PDF capture, iPad performance
or product qualification from exact-crop classification.

## Public-domain material

Public-domain chess books are accessible. For example, Project Gutenberg's
[Chess Fundamentals catalogue entry](https://www.gutenberg.org/ebooks/33870)
identifies its edition as public domain in the USA and supplies downloadable
formats. Its [chess catalogue](https://www.gutenberg.org/ebooks/subject/1677)
also includes older instructional works. Catalogue availability alone is not
the source-asset review required by this repository: the exact edition, image
origin, applicable rights, byte hashes and labels must be recorded first.

For this bounded experiment, no book acquisition is necessary. A later,
separately locked experiment under #24 should add verified real print diagrams
to test the gap between synthetic rendering and scans. Such images must never
be added after looking at this experiment's test outcomes and presented as the
same untouched test set.

## Evaluation and promotion

The shipped weights and both candidates receive identical frozen vectors and
preprocessing. Reports retain raw argmax exact/square accuracy, per-class
errors, confidence, reliable exact/wrong counts and latency distributions.
Low-confidence outputs remain failures: promotion requires at least 95%
reliable exact boards, at least 99.5% correct squares at confidence 0.7 or
higher, zero reliable wrong boards, and no material corpus-v1 regression as
defined in the protocol. Raw accuracy alone cannot pass these gates.

Each candidate also needs fp32 PyTorch/ONNX parity, schema/operator/sidecar
validation, CPU inference and real ORT-Web WASM execution in Chromium, Firefox
and WebKit. The isolated browser harness verifies hashes, cancellation,
timeout/recovery, warm offline inference and zero external requests. Warm
offline inference is not cold offline reload readiness; that product behavior
remains #3. Ordinary `pnpm eval:recognition` retains the real PDF selection,
worker and editable-board checkpoint. Experimental vectors do not replace it.

A passing classifier may justify a separately scoped learned-localizer
experiment. Failed exact crops require inspecting retained mismatches: missing
glyph coverage calls for a new corpus/test lock; evidence of square ambiguity
that board context could resolve may justify a separate whole-board model.
Neither alternative architecture is trained here. No candidate is shipped or
published, and no result authorizes production adoption.

See [environment.md](environment.md) for the isolated Python setup. Exact
execution commands and measured outcomes accompany the final evidence report.
