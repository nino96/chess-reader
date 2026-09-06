# Real printed-diagram dataset project

Status: preparation only, 2026-09-06. Tracks [#41](https://github.com/nino96/chess-reader/issues/41), parent [#24](https://github.com/nino96/chess-reader/issues/24).
No training is authorized by this protocol. This is a new issue, because both
[#38](https://github.com/nino96/chess-reader/issues/38) and
[#40](https://github.com/nino96/chess-reader/issues/40) have completed frozen
experiments. PR #37 is merged at `ccc575ffecbc98dd10bd8f497887d0e481bc1b77`.
PR #39 remains open/unmerged. Its reports are read-only evidence, not an
implementation dependency requiring its merge. Corpus v1, all original/v2/v3
inputs, protocols and results, and production stay unchanged. Physical iPad is
deferred/unrun; #24 remains open. This project implements only staged policy
stage 0, outside the PWA and without new runtime dependencies.

## Why these data

Reuse [#24 localization](../../docs/investigations/issue-24-localization.md),
[v2 failure analysis](../recognition-training/v2/FAILURE_ANALYSIS.md), and
the completed [#40 comparison](../recognition-training/v3/REPORT.md), with
file hashes in the preparation report. Do not rerun unchanged inference.

| Failure axis  | Existing public evidence                                                                                                         | Acquisition consequence                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Localization  | Matched hatch case: 2/48 normal versus 47/48 true-corner exact reads; expanded corpus 9/42 normal versus 24/42 true-corner reads | Retain page, loose selection, exact grid, multiple/partial boards and negatives with independently reviewed bounds. A crop score is not detection evidence.        |
| Preprocessing | First experiment lost embedded SVG CSS fills; corrected v2 verified source/tensor fidelity but still failed                      | Start with original raster scans; compare source, crop, actual grayscale 32-pixel tiles and reconstruction. Preserve native resolution and record every transform. |
| Shape         | v2 unseen-family/class failures; v3 both seeds have a zero-exact development family                                              | Prioritize independent printed glyph designs and compare all twelve pieces; author or font name alone does not establish design independence.                      |
| Color         | v3 white errors 792 shipped versus 850/857 adapted, black errors 607 versus 591/591                                              | Cover hollow/filled pieces on both square tones, thin strokes, hatching through white pieces and grayscale contrast.                                               |
| Degradation   | v3 degraded raw exact 77/255 shipped versus 90/89 adapted; pristine 56/129 versus 55/52                                          | Pair real scan quality strata with clean cases; no claim degradation alone explains family errors. Acquisition selection must not depend only on model failures.   |

On identical 384 development boards, v3 adaptations improve raw exactness only
from 133 to 145/141 while confident wrong boards rise from 6 to 81/86 and
occupied accuracy falls. New data must protect working cases and expose
overconfidence. No architecture limit is established by those experiments.

[CVChess](https://arxiv.org/html/2511.11522v2) studies physical boards. Its new
445 photographs cover only 89 board states and perform much worse than its
original test distribution. Use its lesson about correlated samples and
distribution shift, not its 3D photographs as the printed-diagram reference.
This project does not reopen an architecture search.

The [ChessVision.dev review](CHESSVISION.md) records advertised paid pretrained
inference and exportable custom fine-tuning, with undocumented data/runtime and
evaluation details kept explicit. No paid service or external model lane starts.

## Public acquisition sources and rights decisions

The acquisition catalog will pin direct URLs, source-page revisions, attribution,
publication/edition, rights basis, scope of jurisdiction, exact original and
rights-snapshot SHA-256 values. A missing hash means not acquired, never a
placeholder hash. Training eligibility and model-distribution status are
separate fields. Public availability is not permission. A public-domain mark is
a status assertion, not a newly granted worldwide license.

Initial real sources are the Commons-hosted original scans of Capablanca,
_Chess Fundamentals_ (Harcourt, Brace, 1921), Staunton, _The Chess-Player's
Handbook_ (Bohn, 1848), and Lasker, _Manual of Chess_ (1927; publisher verified
from title page at intake). Their file-specific records assert public-domain
status in the US and source country; preserve term-length limitations rather
than claiming worldwide clearance. Commons permits download/reuse under each
file's rights statement. Scan-page metadata is separately licensed; keep full
snapshots local and publish attributed factual summaries and hashes only.

Reserve Murray, _A History of Chess_ (Clarendon, 1913), and Brunet i Bellet,
_El ajedrez_ (L'Avens, 1890), for a later source/lineage review. Historical or
nonstandard boards are not ordinary 8x8 training examples. BNE/Google/Internet
Archive hosting terms are separate from work copyright; prefer the reviewed
Commons original endpoint and do not silently substitute a mirror.

Project Gutenberg's Capablanca/Staunton editions are useful notation aids only
after matching their diagrams to the exact scan. Their US-only catalog status
does not grant unrestricted worldwide use. Re-editions/retyped diagrams stay
in the same connected source group. Modern publisher books require explicit
reusable terms or a documented source-specific training basis before intake.
No purchase, access-control bypass, contacting rights holders or use of
user-supplied materials is part of this preparation.

## Coverage and allocation

The pilot targets 12 visually verified boards across three real works, plus
page/negative/partial examples. It measures yield, not recognition quality.
It can finish with a truthful smaller verified set and quarantined remainder;
it cannot waive the production-data gates below. All pilot examples are
exposed preparation diagnostics and cannot later be fresh qualification.

The subsequent dataset target is 1,200 train, 240 source-held-out development,
240 frozen qualification, and 120 clean regression boards. At least 12
reviewed design/source components total: six train, three dev, three test;
at least two works per evaluation component when available. Clean regression
draws only from reserved evaluation components, never train. These are targets,
not acquired counts. Do not inflate groups with many pages from one book.

| Axis                   | Required strata                                                                           | Target check before training                                                       | Pilot role                                               |
| ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Design and publication | Different engravers/artists, printers/publishers, related editions                        | 6/3/3 independent reviewed components; no component above 25% of a split           | Three works; independence must be inspected, not assumed |
| Print                  | Clean flat gray; white/black; thin/thick diagonal hatch; halftone                         | At least 30 real dev and 30 real test boards per major available print stratum     | Measure which are genuinely present                      |
| Fidelity               | Native clean; low resolution; optical blur; bleed-through; skew; compression; paper noise | At least 20 real evaluation boards per supported defect; count overlaps explicitly | Native scans plus paired illustrative transforms         |
| Color                  | Monochrome, gray, cream paper; colored board and low contrast                             | At least 20 real evaluation boards in each claimed supported color stratum         | Old scans do not establish modern colored-board coverage |
| Density                | Sparse 2–8, medium 9–20, dense 21–32; promotions separate                                 | At least 40 boards per density in dev/test; every class/color represented          | Select before model scoring                              |
| Geometry               | Exact, loose, full page, multiple, partial, negative, both orientations                   | At least 30 negatives, 20 partial, 20 multiple pages per eval split                | Store source-page coordinates and roles                  |

Report measured counts including zeros; unmet rows block training qualification,
not source acquisition. Piece square counts cannot substitute for independent
board or source counts. Historic books alone are not a representative modern
book corpus. Modern/color coverage remains a named requirement on this issue.

## Leakage prevention and frozen sets

Build connected components over work, edition/translation, printer/publisher
relationships where artwork is shared, piece-design lineage, derivative source,
duplicate image hashes and visually flagged near-duplicates. Resolve ambiguous
lineage by co-grouping or quarantine. Different authors are not proof of
independent typefoundry artwork. Position duplicates across books are flagged
and excluded across split boundaries; related game sequences also stay together.
Use exact pixel hashes plus perceptual comparison; review similarity matches,
never automatically infer independent lineage from a low similarity score.

Reserve whole components before selecting pages. Train sees only train;
checkpoint/recipe decisions see dev. Clean regression freezes independently of
candidate outputs and retains all cases the unchanged baseline gets right.
Freeze qualification source IDs, labels, bounds, pixels, transforms, schema,
split components and tool hashes before any candidate inference. Acquisition
and visual truth review may see test images; model developers must not see test
predictions until all candidates/thresholds are frozen. An exposure ledger marks
pilot and historical samples diagnostic; v3 qualification remains untouched.

No new set claims universal pretrained independence. FENShot's full original
book inventory is unknown; historic books may occur in it. FENShot/Lichess
artwork and public comparator inventories have known or unknown overlap,
recorded per source and model. Unknown is not false. New book/design holds test
project-specific transfer; they do not prove foundation-model novelty.

## Labeling and review workflow

1. Register a rights-reviewed source; stream bounded original and rights bytes,
   verify content type/magic and SHA-256, publish atomically without overwrite.
2. Rasterize only explicitly selected pages with a pixel/page/time cap. Save
   exact unmodified page and candidate board rectangle. No whole-book scan.
3. Propose geometry from image/grid tools or manual selection. Save origin,
   pixel rectangle, orientation and partial/negative status separately.
4. Use adjacent notation or a verified move sequence where available to propose
   placement; record the exact source locator and interpretation. Model output
   is an optional independently tagged proposal with model/preprocess hash.
   Do not fabricate side-to-move/castling/en-passant/counters from an image.
5. Visually inspect all 64 squares against the original crop, with coordinates
   and a separate placement overlay. Record reviewer, decision and image/label
   hashes. Model agreement and chess legality only prioritize review. An
   impossible study diagram may be printed truth; never repair it silently.
6. Quarantine unreadable squares, uncertain color/orientation/geometry or
   notation mismatch. Confirmed edits supersede proposals explicitly. No
   automatic acceptance from confidence or model consensus.
7. Prioritize one representative per design/defect, model disagreements and
   uncertain notation. Let the agent complete straightforward visual review;
   ask the owner only unresolved material ambiguities. Stop at a maximum
   owner queue of 12 boards or 30 minutes. Never grow the queue to hit counts.

Pilot artifacts include source/page contacts, 8x8 grid crops, proposed labels,
review decisions, actual 32x32 grayscale tile mosaics, and native versus degraded
pairs. Originals, crops and label payloads remain ignored local data. Checked-in
reports contain public source provenance, hashes and aggregate status only.
The pilot has no model-inference requirement and consumes no training budget.

## Real reference and synthetic gaps

At least 75% of each future train batch and all primary dev/qualification boards
are real published diagrams. Synthetic-only results are separate supplemental
strata. Reuse only eligible train artwork; never synthesize a held-out design
into train. Start with at most one derived low-resolution/blur pair per pilot
board to inspect fidelity, not to enlarge sample counts.

Compare native crops, transformation outputs and serialized tensors side by
side: stroke continuity/width, hollow-piece interiors, hatch spacing/angle,
foreground/background tone, borders and sampling aliasing. Calibrate any later
degradation parameters from measured real strata, not visual plausibility alone.
No claimed realistic blur/scan simulation until reviewed against a real match.
Synthetic variants stay with their parent in one split and retain parent hashes.

## Stage-0 budget, data gates and stopping rules

Preparation ceiling: four hours active work; public acquisition at most 256 MiB
across three original PDFs and rights snapshots; each original at most 64 MiB;
local pilot artifacts at most 1 GiB; at most 36 selected PDF pages, 12 accepted
boards and 12 queued boards. Network timeout 60 seconds per object and one
retry only for transient failure. Rasterization at most 10 MP/page, one page
per process, 30 seconds/page, 10 CPU minutes total. No GPU training or model
search. Report actual wall times/storage/tool versions and any budget stop.

Pilot gates: every original/derivative hash verifies; no missing rights basis;
all accepted labels have complete visual decisions; geometry stays in bounds;
every accepted placement has exactly 64 squares; zero unresolved labels enter
an accepted set; byte-identical replay of extraction; leakage validator rejects
cross-component duplicates; corrupted bytes, unknown sources, traversal,
timeouts, stale review hashes and overwrite attempts fail closed. Tests are
offline. Any gate failure blocks expansion until resolved within this budget.

Expansion proposal: at most two working days acquisition/review, 2 GiB originals,
4 GiB total artifacts, 48 works screened and 12 independent accepted components.
Stop when coverage gates pass or budget expires; report unfilled cells. This
future expansion is not silently executed by the small pilot.

## Subsequent bounded adaptation proposal (not execution)

Only after stage 0 passes, predeclare one new data-only FENShot adaptation
experiment. Reuse the proven fused-weight reconstruction and unchanged
architecture, input preprocessing, optimizer recipe and confidence 0.7 from
#40. No new architecture, localizer, scratch arm or parameter sweep. A new
experiment needs a separate execution decision; #40's unused wall-time ceiling
does not authorize another run. Total ceiling must not exceed the existing
1,260 GPU seconds, including pilot/failures. The retained #40 charge is
354.078 seconds, leaving 905.922 seconds. Proposed additional ceiling: one
60-second mechanics pilot (seed 4100) and two 420-second full seeds (4101/4102),
900 seconds total including failures, at most twelve epochs each. Combined
charge could therefore be at most 1,254.078 seconds. This reservation is a
proposal, not authorization to consume the remaining budget. Preserve AdamW,
batch 512, fp32, LR 1e-4 cosine to 1e-6, weight decay 1e-4, no label smoothing,
and earliest minimum equally family-averaged class-balanced dev-loss checkpoint.

Compare unchanged shipped FENShot and both predeclared adapted seeds on identical
hashed real dev inputs. Keep all seeds and failure records. Both seeds must
improve degraded exact-board accuracy by at least five percentage points, have
no lost baseline-correct clean board, no occupied/class collapse and no increase
in reliable-wrong outputs. Preserve the #40 pristine tolerance as an additional
ceiling, not a license to lose known working cases. Require an uncertainty
interval from source-group bootstrap alongside paired board changes; too few
independent groups means inconclusive. Select by the frozen dev rule only.

Only surviving frozen candidates see new qualification once: retain at least
95% reliable exact boards, 99.5% confident-correct squares, zero reliable wrong,
and report occupied/class/color/design/degradation/orientation breakdowns.
Localization is a separate page score using predicted geometry, never oracle
crop performance. Failure stops offline. Browser smoke/qualification then
product/offline/device gates apply only at their staged-policy trigger.

## Preparation acceptance

- Concrete source catalog, rights/hash records and measured coverage gaps.
- Reversible tested acquisition/extraction and visual review workflow exercised
  on a small public pilot, with explicit quarantine and review decisions.
- Executable label/hash/split validation and clean/dev/qualification lock design.
- Local review artifacts and a reproducible preparation report with actual
  commands, environment, resource use, reached/unrun gates and limitations.
- `pnpm check`, narrow tooling tests, local links and diff/preservation checks.
  Product/browser suites are not applicable because production is unchanged.
- No training, model publication, private intake, production changes, merge or
  physical-device claim. This deliverable prepares a dataset project; it does
  not claim the full future dataset or recognition viability is complete.
