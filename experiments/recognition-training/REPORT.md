# Issue #38: TileNet training result

**STOP: neither predeclared seed meets the held-out classifier promotion gate.**
The CUDA experiment completed successfully, but its synthetic-first development
corpus did not produce a classifier that generalizes to the locked Rhosgfx
family. No model is adopted or published. Production recognition remains
unchanged, [#24](https://github.com/nino96/chess-reader/issues/24) stays open,
and physical-iPad testing is **deferred/unrun**.

[PR #37](https://github.com/nino96/chess-reader/pull/37) was merged at
`ccc575ffecbc98dd10bd8f497887d0e481bc1b77` before this branch was created from
updated `origin/main`. The [#35 comparison](../../docs/investigations/issue-35-comparison.md)
and [ADR 0005](../../docs/decisions/0005-browser-recognition.md) remain applicable.

## Frozen design and data

The [protocol](protocol.json) was committed at `5f6233476bdc09d0ea28da715142cbf3bc5a9b7e`
before the CUDA pilot. It declares unchanged TileNet (321,805 parameters),
fp32 opset 17, `tiles [N,1024] -> probs [N,13]`, class order `1KQRBNPkqrbnp`,
confidence floor 0.7, seeds 3801/3802, twelve epochs and development-loss-only
checkpoint selection. No threshold, augmentation, source, epoch or architecture
was changed after test outcomes became available.

The [dataset manifest](manifests/dataset-v1.json),
[sample inventory](manifests/samples-v1.json), and
[pretraining held-out lock](manifests/test-lock-v1.json) identify 4,096 training,
256 development and 256 test boards. All tiles from a board stay together.
Training uses Chessnut and three Maurizio Monge families, with the Monge author
family kept wholly in training. Firi is development-only; Rhosgfx is test-only.
All roles include flat/hatch/halftone and the declared degradations. This tests
transfer to one unseen source family, not unseen degradation regimes or real
scanned books. Positions are synthetic and are not constrained to legal games.

The dataset SHA-256 is
`10b347f5f88693fd18d63b49b4b2f81156cf673820145c82949e1d425743a401`.
Every downloaded SVG has a pinned revision, byte hash and license evidence in
[source-lock.mjs](source-lock.mjs) and [NOTICES.md](NOTICES.md). Sources are
Apache-2.0, MIT, CC-BY-4.0 and CC0-1.0; notices describe the print derivatives.
The full upstream TileNet MIT notice is in [TRAINING_PROVENANCE.md](TRAINING_PROVENANCE.md).
No book bytes or experimental weights are committed.

Corpus v1 never entered training, development validation, checkpoint selection
or tuning. Its post-freeze exact-bound vectors use pinned upstream grayscale
and tile extraction. All candidates receive identical vector bytes, whose hash
is `7c2edc21aef5b2b1f9d994e31cd72f968f2b93aac6ed992a4a89062fc97e9974`.
The shipped control reproduces the historical 8/14 raw exact and 881/896
correct-square counts. Native-canvas preprocessing is not claimed byte-identical
to every browser-canvas decoding path; the unchanged product evaluation separately
exercises the existing browser capture path. Public corpus-v1 outcomes are
regression evidence, not a fresh generalization test.

## CUDA execution and export

The local NVIDIA GB10 ran Python 3.12.3, PyTorch 2.10.0+cu128 (CUDA runtime
12.8), ONNX 1.18.0 and CPU ONNX Runtime 1.22.1. Driver 580.159.03 reports CUDA
13.0. The PyTorch build warned that its advertised capability range ends at
12.0 while this GPU reports 12.1; actual CUDA execution and recovery passed.
The [hashed environment lock](requirements.lock) contains 36 resolved ARM64
wheels. [environment.md](environment.md) records setup and exact commands.

| Run           |   Selected epoch | Training/development/export seconds | Attempt wall seconds | ONNX bytes |
| ------------- | ---------------: | ----------------------------------: | -------------------: | ---------: |
| Pilot seed 38 | Development only |                               2.087 |                3.428 |  1,288,448 |
| Seed 3801     |          6 of 12 |                             230.596 |              231.929 |  1,288,448 |
| Seed 3802     |          9 of 12 |                             233.326 |              234.594 |  1,288,448 |

Both full runs were made at `d838cf14c676a8cc0eb247f74d7f6faeba76679b`, within
2,700 seconds per seed. No full run was extended. The successful pilot verified
exact checkpoint recovery across model, optimizer, scheduler, RNG and losses.
Both candidates passed ONNX checking, no-external-sidecar checks, schema/operator
validation, CPU inference and PyTorch/ONNX parity on 64 frozen training vectors
at predeclared `atol=1e-5`, `rtol=1e-4`. Full epoch losses, source/data hashes,
checkpoint identities, environment and parity errors are in
[3801](reports/full-3801.json) and [3802](reports/full-3802.json).

The [candidate freeze](reports/candidates-freeze.json) was written after both
runs completed and before any held-out or corpus-v1 inference. Seed 3801's ONNX
SHA-256 is `1397e6f5dcf45ebb4a3111ba4de754df661bab343bdec560ffe675b917fdae2d`;
seed 3802's is `91f176d32e3f351727bcb8989939129ee7015ed4caaac5e68c7eea36c4bfd14f`.
The shipped control is 1,289,483 bytes with SHA-256
`883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d`.

Failed attempts are retained, not replaced with passing summaries:

- [Pilot attempt 1](reports/pilot-attempt-1.json) stopped before an optimizer
  update because the loss omitted the model forward call. A real optimizer-step
  regression test was added.
- [Pilot attempt 2](reports/pilot-attempt-2.json) exposed CUDA RNG restoration
  requiring a CPU ByteTensor. A minimized regression test was added. Its report
  is explicitly reconstructed from retained checkpoints and the observed error.
- The [successful pilot](reports/pilot.json) and
  [pilot browser validation](reports/pilot-browser-validation.json) retain the
  initial metadata-filename failure and its focused correction.
- [Full browser attempt 1](reports/full-browser-attempt-1.json) rejected duplicate
  historical annotation IDs before execution. The wrapper now hashes page plus
  annotation identity; vector bytes are unchanged.

The first two pilot failures did not record complete attempt wall time. Their
known timings and missing accounting are explicit in the reports, so an exact
all-attempt aggregate under the 6,000-second ceiling cannot be reconstructed.
The successful pilot and both full runs have complete timing evidence; this
limitation is not concealed by treating failed attempts as zero cost.

## Accuracy and decision

CPU held-out results are [shipped](reports/cpu-shipped.json),
[3801](reports/cpu-tilenet-full-3801.json), and
[3802](reports/cpu-tilenet-full-3802.json). The unchanged promotion targets require
at least 244/256 reliable exact boards, at least 16,303/16,384 correct squares
at confidence ≥0.7, zero reliable wrong boards, and no corpus-v1 regression.
Low-confidence outputs remain failures even when argmax is correct.

| Locked held-out set | Raw exact boards |    Raw correct squares | Confidence-qualified correct squares | Reliable exact | Reliable wrong |
| ------------------- | ---------------: | ---------------------: | -----------------------------------: | -------------: | -------------: |
| Shipped             |            2/256 | 14,372/16,384 (87.72%) |               13,384/16,384 (81.69%) |              0 |              1 |
| Seed 3801           |            0/256 | 13,062/16,384 (79.72%) |               12,542/16,384 (76.55%) |              0 |              0 |
| Seed 3802           |            0/256 | 13,127/16,384 (80.12%) |               12,530/16,384 (76.48%) |              0 |              0 |

| Corpus-v1 exact bounds | Raw exact boards | Raw correct squares | Reliable exact | Reliable wrong |
| ---------------------- | ---------------: | ------------------: | -------------: | -------------: |
| Shipped                |             8/14 |    881/896 (98.33%) |              4 |              0 |
| Seed 3801              |            12/14 |    894/896 (99.78%) |              9 |              0 |
| Seed 3802              |            12/14 |    894/896 (99.78%) |              8 |              0 |

Both candidates improve this public regression set, but fail the untouched
held-out set decisively. There is no post-test seed selection. Neither candidate
is eligible for a later integration decision.

The [post-freeze mismatch analysis](mismatch-analysis.md) records per-class
counts and systematic glyph collapses. Empty squares make up 71.75% of test
squares; non-empty accuracy is only 28.22%/29.62% for the two seeds. Missing
source/print-family coverage is the supported working explanation, with the
one-family and synthetic-rendering limitations stated explicitly. These results
do not supply evidence sufficient to justify a whole-board/context model.

Apply #38's coverage decision trigger: a future experiment under #24 should
broaden the licensed development corpus and declare a new untouched test lock
before training. The learned-localizer trigger is not met because the classifier
failed; no learned localizer or whole-board model is trained or opened here.
Synthetic generation was enough to execute this bounded experiment and expose
its coverage gap. Verified public-domain print diagrams would help a future
real-book evaluation; [the source discussion](README.md#public-domain-material)
explains access and provenance requirements.
