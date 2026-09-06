# Printed-diagram dataset and bounded adaptation (#41)

**Current work continues in [#42](https://github.com/nino96/chess-reader/issues/42).**
Start with the [durable handoff and owner commands](handoff/README.md).
The reports below preserve the completed #41 increment, not a claim that
generalized recognition or the full dataset is finished.

The owner-authorized [execution amendment](EXECUTION.md) now extends #41 to
modern real-document collection and a bounded adaptation experiment. It
supersedes the historical preparation-only restriction below for the new
version only. The original pilot, plan, source lock and reports remain intact.

For the actual modern collection, split counts, training commands and results,
see the [execution report](EXECUTION-REPORT.md) and fixed
[feasibility protocol](feasibility-protocol.json).

## Saved FENShot recovery base

The reusable, pre-finetuning PyTorch checkpoint is saved locally at
`experiments/recognition-dataset/work/modern/base/fenshot-recovered.pt`, with
provenance and recorded ONNX parity in the adjacent `fenshot-recovered.json`.
Its SHA-256 is
`e0e215b88cd0a927aa713953a1e6342ea19b1624d782a81a1ec843fa3882415f`.
This is the recovered shipped FENShot base, not a trained candidate or an
optimizer/resume checkpoint.

The feasibility trainer loads this saved base through
[`recover_fenshot.py`](recover_fenshot.py)'s `load_recovered`, checking its hash
and pinned model/reconstruction identities. It does not reconstruct the base
for each run. Future issues should reuse this checkpoint and keep both files
together; do not overwrite them with fine-tuned weights. The working copies
remain ignored, but the owner's subsequent check-in authorization preserves
the exact base and manifest under [handoff/recovery](handoff/recovery/README.md),
with the upstream MIT notice and a verified, non-overwriting restore command.

To explicitly recheck CPU parity against the original development inputs:

```sh
experiments/recognition-training/.venv/bin/python experiments/recognition-dataset/recover_fenshot.py --verify
```

Start with the [plan](PLAN.md), [public source catalog](sources.json),
[download/provenance lock](provenance-lock.json), [pilot report](REPORT.md), and
[ChessVision.dev review](CHESSVISION.md). This isolated project follows
[issue #41](https://github.com/nino96/chess-reader/issues/41), not a new #38/#40
training attempt. All original experiments and production remain unchanged.

## Modern increment verification

The modern data and completed training evidence are in
[EXECUTION-REPORT.md](EXECUTION-REPORT.md), [results-public.json](results-public.json)
and [learning-curves.csv](learning-curves.csv). Use system Python for
Pillow/Poppler tests and the existing training environment for NumPy/Torch tests:

```sh
python3 -m unittest discover -s experiments/recognition-dataset/tests -p 'test_modern*.py' -v
python3 -m unittest discover -s experiments/recognition-dataset/tests -p 'test_assemble_feasibility.py' -v
python3 -m unittest discover -s experiments/recognition-dataset/tests -p 'test_degrade_real.py' -v
experiments/recognition-training/.venv/bin/python -m unittest experiments/recognition-dataset/tests/test_feasibility_train.py experiments/recognition-dataset/tests/test_recover_fenshot.py -v
python3 -m unittest discover -s experiments/recognition-dataset/verification -v
node experiments/recognition-dataset/tests/preprocess.test.mjs
python3 experiments/recognition-dataset/preflight_feasibility.py verify
python3 experiments/recognition-dataset/verification/verify_page_provenance.py --verify experiments/recognition-dataset/work/modern/page-provenance-audit.json
pnpm check
```

## Historical pilot tools

`intake.py` accepts only catalogued, rights-reviewed HTTPS sources on the two
Commons hosts. It validates URLs/redirects, PDF/HTML types, magic, size, original
SHA-256 and aggregate download limits. Atomic exclusive publication prevents
overwriting prior bytes; a successful lock is required before extraction.
`--verify` is offline. A failed intake leaves only unpublished or hash-checked
partial work; it never publishes a success lock. Rerun only after reviewing the
error, with at most the predeclared retry. This pilot corrected the default
urllib user agent after a 403; it did not disable TLS or bypass access controls.

`pilot.py` rasterizes only the selected PDF ordinals in `pilot-pages.json`, at
1800 pixels long edge with one bounded subprocess per page. The original PDF
and raster bytes remain distinct. It extracts proposed pixel rectangles from
ignored `work/regions.json`, creates contacts and grid/crop/tensor/degradation
sheets, and records explicit accepted/quarantined decisions. `--revision` makes
new review artifacts without replacing prior proposals or decisions. Template
fields and review rules are described in [the plan](PLAN.md#labeling-and-review-workflow).

Label proposals are manual visual or notation-assisted in the executed pilot.
The schema accepts model proposals only with model/preprocess hashes, but no
model proposal or inference was executed here. The grayscale 32x32 tile mosaic
is a diagnostic serialization, **not a claim of parity with FENShot's exact
preprocessing**. No training consumes it. Degradation pairs are illustrative,
not yet calibrated to measured scan distributions.

`audit.py` verifies intake/reviews, runs split isolation on actual pilot records,
counts labels/coverage, screens perceptual duplicates, checks preserved paths
against the starting commit and writes a public-safe hashed report. `--qualify`
exits 1 because the measured pilot lacks the full independent data set. A
successful integrity audit is not a passing data-qualification result.

## Historical pilot environment and commands

Executed with system CPython 3.12.3, Pillow 10.2.0 and Poppler 24.02.0 on Linux
ARM64. These are existing system research tools; no package was installed or
training environment changed. The report records renderer executable hashes.
Reproduction requires these versions and matching generated hashes; a different
renderer/Pillow build needs a new version and visual review. Acquisition's hard
wall deadline uses POSIX signals in the main thread; unsupported environments
are not qualified by this pilot. PWA dependencies remain pinned and unchanged.

```sh
# First acquisition only; requires public network access. Refuses an existing lock.
python3 experiments/recognition-dataset/intake.py --acquire
# Subsequent integrity check: no network.
python3 experiments/recognition-dataset/intake.py --verify

# Fixed 36-page extraction; exact replay is allowed, differing output rejected.
python3 experiments/recognition-dataset/pilot.py render

# Local reviewed proposals already exist in work/regions.json in this workspace.
python3 experiments/recognition-dataset/pilot.py extract --revision final
# Review each sheet first. This example records one explicit visual decision.
python3 experiments/recognition-dataset/pilot.py review --revision final --id public-a-01 --reviewer lead-visual --decision accepted
python3 experiments/recognition-dataset/pilot.py verify --revision final
python3 experiments/recognition-dataset/audit.py --revision final
python3 experiments/recognition-dataset/audit.py --revision final --qualify
# Expected last-command exit: 1, with unmet full-data gates reported.

python3 -m unittest discover -s experiments/recognition-dataset/tests -p 'test_intake.py' -v
python3 -m unittest discover -s experiments/recognition-dataset/tests -p 'test_pilot.py' -v
python3 -m py_compile experiments/recognition-dataset/intake.py experiments/recognition-dataset/pilot.py experiments/recognition-dataset/audit.py
pnpm check
git diff --check
```

Do not run `review` to approve unseen images. On a fresh checkout, acquire and
render first, then recreate local proposals using the public sample registry
and source pages; proposed placements and review decisions are local review
artifacts, not automatically accepted ground truth. This workspace preserves
the actual payloads and earlier revisions. Public hashes bind them for review.
The original reports under `recognition-training/` are reused, not rerun.

## Historical pilot local handoff

Open `work/review-final.html` for board sheets and `work/review/*-pages.png` for
the 36-page contacts. `work/manifest-final.json` contains exact proposed labels,
source/page/region hashes and notation/visual evidence. `work/decisions-final/`
contains final decisions. Earlier `manifest.json`, `manifest-v2.json`,
`proposals-*.json` and `decisions-v2/` retain the rejected/uncertain proposals.
`work/preparation-final.json` contains aggregate verification and artifact hashes.
These paths are ignored, and the acquisition path has no local-book input option.

The full clean regression, source-held-out development and frozen qualification
sets remain gated project work, with target memberships and stopping rules in
the plan. None of the exposed pilot samples can become fresh qualification.
[#42](https://github.com/nino96/chess-reader/issues/42) now tracks the missing
modern/color/density/design coverage and qualification freeze. No model/API
call, new architecture, paid subscription or GPU training is part of this pilot.
