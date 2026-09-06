# Continue recognition work in #42

**Active outcome:** [#42](https://github.com/nino96/chess-reader/issues/42), better
recognition on independent printed books/designs without sacrificing working
cases. The completed #38/#40 experiments and #41 increment did not achieve that
outcome. Keep #24 open, PR #39 unmerged, production/corpus v1 unchanged and
physical-iPad testing deferred.

Use branch `issue-42-recognition-handoff`. It includes the historical research
dependencies without merging PR #39. A new session should first read the issue,
AGENTS.md, repository sources of truth, this handoff and the
[actual results](../EXECUTION-REPORT.md). Do not rerun completed training or
recreate the recovered base to establish that the pipeline still works.

## What is reusable

- [Public source catalog](../modern-sources.json), source-specific rights,
  extraction/page plans and visual-review tools in the parent directory.
- [Public annotation index](records/index.json): 13 exact JSON snapshots,
  records for 140 reviewed images, geometry, proposals/corrections, decisions, split and
  preprocessing metadata. These are factual labels and our review evidence,
  **not document pixels or human-certified qualification**.
- [Recovered shipped FENShot base](recovery/README.md), with MIT notice,
  original provenance report and exact SHA-256. No adapted weights published.
- [Pretraining freeze](evidence/pretraining-lock.json),
  [post-training page provenance audit](evidence/page-provenance-audit.json),
  [aggregate results](../results-public.json) and
  [full learning curves](../learning-curves.csv). The page-index metadata
  discrepancy remains visible; do not rewrite history to hide it.

Originals, pages, crops, tensors, visual sheets and adapted checkpoints remain
ignored/local. They survive a new session in the **same checkout**, but do not
follow a fresh clone/worktree. Public metadata snapshots preserve previous
review decisions; verify regenerated image hashes before reusing those decisions.
Never substitute newly rendered pixels under old labels/hashes silently.
Scoped Git attributes preserve raw evidence bytes (including the original CSV
line endings and one accepted proposal's extra EOF newline); these snapshots
are deliberately excluded from automatic reformatting.

Offline integrity and idempotent restoration, from repository root:

```sh
python3 experiments/recognition-dataset/handoff/export_public_records.py --verify
python3 experiments/recognition-dataset/handoff/preserve_evidence.py --verify
python3 experiments/recognition-dataset/handoff/preserve_base.py --verify
python3 experiments/recognition-dataset/handoff/export_public_records.py --restore
python3 experiments/recognition-dataset/handoff/preserve_base.py --restore
```

Restoration refuses conflicting bytes. It does not restore document pixels,
tensor banks or run ledgers. On a fresh machine, pinned application dependencies
come from `pnpm install --frozen-lockfile`; Python training dependencies and
platform limitations are recorded in
[requirements.lock](../../recognition-training/requirements.lock) and
[environment.md](../../recognition-training/environment.md). Extraction also
needs Pillow and Poppler. Do not claim a fresh environment is ready merely
because metadata restoration passed.

## Owner-operated downloads — no AI polling required

You do **not** need to read Python code. The next working session prepares a
small, rights-reviewed public-source catalog and gives you its filename. You
can start the job, close the AI chat, and later inspect status. The computer
must remain awake; the process does not run on a remote server.

For the already-reviewed catalog, the exact interface is:

```sh
python3 experiments/recognition-dataset/handoff/acquisition_job.py --start --job publicbatch01
python3 experiments/recognition-dataset/handoff/acquisition_job.py --status --job publicbatch01
python3 experiments/recognition-dataset/handoff/acquisition_job.py --stop --job publicbatch01
python3 experiments/recognition-dataset/handoff/acquisition_job.py --resume --job publicbatch01
```

**Do not run that example to expand the dataset:** the default catalog contains
the five sources already acquired. It is a recovery/smoke-test queue, not new
coverage. For the next reviewed catalog, add `--catalog RELATIVE_CATALOG_PATH`
to start/resume and use a new job name. The session preparing the catalog must
provide the complete command, not ask the owner to design or edit the catalog.

Status reports completed/pending sources, whether the worker is alive and any
pause reason. Downloaded objects and state live only under ignored
`work/jobs/JOB/`; existing dataset/cache files are not overwritten. Stop is
cooperative: an in-flight object has a bounded request timeout. Resume checks
hashes and refuses concurrent workers or changed catalogs. No automatic retry
loop, source discovery, rights approval, page extraction, labeling, API call or
training happens in this job. A download failure is a pause, not accepted data.

Limits are 10 reviewed sources per catalog, 64 MiB per PDF, 4 MiB per rights
object, 60 seconds per request, a conservative 512 MiB transfer reservation
ceiling including failed attempts, a 48-hour job cutoff and 4 GiB aggregate
local dataset storage. These are safety maxima, not a reason to spend two days
downloading ten small PDFs. Agent-assisted source discovery and visual review
are separate work; they cannot be replaced by a sleeping downloader.

## Next session's actual work

The owner approved a **new** ceiling of two working days acquisition/review,
4 GiB local dataset storage and 30 minutes aggregate local GPU time, failures
included. Old run slots/ledger remain terminal. Prepare the next batch and new
ledger within those limits; do not spend this allocation replaying the old
experiment. Do not use paid APIs, send permission emails or upload images.

The present 96 training boards contain just two provisional source/design
groups. The next marginal gain is new rights-cleared modern artwork, square
backgrounds and troublesome piece-color/shape conditions—not more transforms
of the same 84 Wikibooks diagrams. Follow #42's source-held-out data and model
gates. The 1,200/240/240/120 train/dev/qualification/clean targets remain
unfulfilled, not waived by this handoff. A limit can justify a specific pause;
a pipeline test does not justify closing the recognition goal.

Suggested next-session instruction:

> Continue #42 on issue-42-recognition-handoff. Read the checked-in handoff and
> reuse existing public annotations, evidence and recovered FENShot base. Own
> the next source-diverse acquisition batch, review and subsequent bounded
> adaptation under the approved budget. Keep the recognition outcome open;
> do not stop successfully at another pipeline milestone.

## Handoff checks

```sh
python3 -m unittest discover -s experiments/recognition-dataset/handoff -v
python3 experiments/recognition-dataset/handoff/export_public_records.py --verify --compare-workspace
python3 experiments/recognition-dataset/preflight_feasibility.py verify
pnpm check
git diff --check
```

This consolidation changes research tooling/docs only. It does not claim new
training, improved recognition, fresh qualification or browser/device evidence.

Validation on 2026-09-06: 16 handoff tests and five provenance/export tests
passed, including real detached start and stop/resume on temporary cached
synthetic fixtures with no network. Three pinned-preprocessing Node tests
passed. Fresh-directory restoration verified all 13 public records and the
two recovery files; strict Torch loading verified 321,485 base parameters
without reconstruction. All 44 frozen inputs and the retained 163-page /
128-crop provenance audit still verify. `pnpm check` and `check:licenses`
passed (the latter needed subprocess permission after sandbox EPERM), as did
104 local file-link checks and `git diff --check`. Live download/network
reliability, new-source coverage and fresh-machine image reconstruction were
not re-tested. No unchanged product/browser suite or physical iPad run was
needed for this isolated handoff. Independent source/licensing review and
initial tooling work were delegated; the lead revised and validated the
integrated downloader, preservation tools and handoff.
