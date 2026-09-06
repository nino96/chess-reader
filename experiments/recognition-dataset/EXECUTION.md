## Pre-training augmentation amendment — 2026-09-06

At the owner's request to address print degradation and geometric/alignment errors, the two full-run slots below are now a **same-seed controlled comparison**: `real-only` versus `degraded`, both seed 4101, 40 epochs, 420 seconds each. The 60-second mechanics/recovery pilot uses the degraded path. This replaces the previous two real-only seeds before any GPU training; the unchanged dev baseline has been observed, but no adaptation or reserved-set scoring has occurred. No data membership, labels or selection criteria change. One seed per recipe is exploratory, not a replicated augmentation conclusion.

The degraded run samples 50% original reviewed real boards and 50% deterministic, visually reviewed train-only variants: print-resolution loss/blur/contrast, small affine and projective alignment errors, and a combined compression/grain/geometry variant. Do not apply unvalidated large warps or arbitrary 3D textures. Reference dev inputs remain byte-identical. Augmentation images never count as independent source boards. Keep the original 1260-second aggregate ceiling (354.078 seconds previously charged + at most 900 new seconds).

Save a reusable, hash-bound recovered FENShot PyTorch checkpoint locally, verify it against the shipped ONNX, and load this exact base for both recipes. No recovered or adapted model publication is implied.

Current reviewed allocation: 96 train (84 modern + 12 public historic), 22 source-held-out dev, 22 reserved (17 occupied diagrams + five distinct empty-background cases, reported separately). These are 140 image instances, not 140 independent publishers/positions or production qualification.

---

## Owner-authorized execution amendment — 2026-09-06

This amendment supersedes the preparation-only/no-training restriction below for a NEW isolated feasibility run under this same issue. The owner requested actual dataset building and training; do not open another issue for this work. Historical pilot and original/v2/v3 protocols/results stay frozen. #24 stays open, #39 unmerged, production/corpus v1 unchanged, physical iPad deferred. #37 remains the merged prerequisite; reusing hash-pinned experiment code is not a request to merge #39.

### Deliver now

- Acquire and label modern external documents, using the existing intake/review tools: prioritize Commons Chess.pdf / Chess puzzles.pdf, CTAN chessboard / MPchess documentation and the identified CC-BY PLOS article. Review precise artwork scope and separate access, evaluation, training, crop redistribution and weight-publication decisions. Public-domain-only sourcing is not required. No private inputs, paid APIs, uploads, permission emails or model publication.
- First modern milestone 60–100 unique boards; aim for a 300-board real-document feasibility collection, approximately 180 train/60 dev/60 held-out where source groups allow. Real examples go INTO training. These are collection targets, not claims that any count guarantees generalization.
- Acquisition ceiling for this increment: 10 sources, 512 MiB downloaded, 64 MiB/original, 180 selected pages (no whole-book preprocessing), 2 GiB local artifacts, 30 seconds/page and 20 minutes rasterization, up to one working day acquisition/annotation. Stop by coverage benefit, never pad with similar old scans.
- Minimum entry to the small learning experiment: 120 distinct reviewed boards; at least 60 train, 20 source-held-out dev, 20 reserved held-out; at least four provisional visual/document components overall and two train components. All twelve colored pieces must occur in train and dev, with modern dense and flat-board examples. Exact geometry, 64-square labels, actual FENShot preprocessing, source/label/tensor hashes and independent conflict review must pass. These are feasibility safeguards, NOT production qualification thresholds. If unmet, no misleading training run just to show activity.
- Labels may be agent-assisted with recorded visual verification and an independent audit; ambiguous labels quarantined. Human-certified production qualification is a later gate. The historic exposed pilot may be explicitly allocated to TRAIN only, with its source/artwork group kept out of evaluation. Uncertain family assignments are allowed for exploratory feasibility if marked provisional, not claimed proven independence.
- Explicit split-rule amendment: original images/derivatives, shared artwork and related document editions/sequences remain grouped. Repeated piece placement alone is an audit field, not a transitive edge joining unrelated books. Record cross-split position repeats and a position-disjoint sensitivity subset. No random page/crop splits. Reserve held-out source groups before model inference; no post-score split changes.
- Preserve the larger 1200/240/240/120 qualification goal. It no longer blocks this separately labeled feasibility experiment. Do not claim its accuracy/confidence/device gates are passed or relaxed.

### Bounded training now authorized after the feasibility data gate

Reuse the shipped FENShot fused TileNet, exact preprocessing and export; no architecture search. Before GPU execution, freeze actual data/rights/split hashes, recipe, checkpoint rule, budgets and baseline inputs in a new lock. Initial real-only training avoids inventing augmentation fidelity. Profile mechanics first; the full run must have enough declared optimization steps to be interpretable.

The existing 1260-second aggregate training ceiling is unchanged: prior charge354.078s; new maximum900s (60s mechanics + two420s full seeds4101/4102). Failures count. A mechanics failure blocks full runs; a budget-truncated trajectory is reported incomplete/inconclusive rather than architecture failure. No extra seeds/sweeps.

Proposed fixed recipe to freeze with the data: AdamW fp32 batch512 LR1e-5 cosine to1e-6 WD1e-4,40epochs, at least200 full-run optimizer updates, family-balanced sampling, class-balanced loss; earliest lowest family-balanced class-balanced development loss selects the checkpoint. More conservative adaptation is an explicit prospective change from #40, not a rewritten comparison.

Measure unchanged FENShot and both seeds on identical new real dev tensors. Report all learning curves and raw exact, reliable exact, confident wrong, occupied/class/color/family/density results and paired gains/losses on clean baseline-correct cases. Preserve >=5pp degraded improvement, no lost working clean cases and no reliable-wrong increase as recommendation criteria, separate from successful completion of the experiment. Freeze candidates before any reserved evaluation. Failed offline candidates do not trigger unchanged browser/product reruns. No production promotion without existing qualification gates.

### Acceptance for this increment

- [ ] Source-diverse real dataset with measured counts, rights/notice/hash records, visual reviews, source-group train/dev/held-out allocation and actual model-input parity.
- [ ] Bounded training actually executed if the declared feasibility data gate passes, or specific unmet data/compute blocker with artifacts if it cannot.
- [ ] Unchanged-baseline comparison, all-seed curves, useful/inconclusive/failed-recommendation distinction, and exact resource ledger.
- [ ] Narrow tests, pnpm check, source/split/review/preprocessing integrity and frozen-input preservation; no new issue or altered production.

---

## Historical preparation scope and completed pilot (retained)
