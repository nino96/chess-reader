# Preparation pilot report — issue #41

Result: the acquisition, extraction and review pilot is executed. The full
data-qualification gate **fails**, as intended for an insufficient pilot; no
training or model-performance claim follows. See [plan](PLAN.md),
[machine-readable evidence](preparation-report.json),
[public sample registry](public-samples.json) and [provenance lock](provenance-lock.json).

## Scope and measured coverage

Issue #41 separates dataset preparation from the completed frozen #38/#40
experiments. The starting commit is `c613aed15dfe4ec9e85b7557b01805c4fb3be187`;
new tooling is identified by hashes, not misrepresented as committed there.
Existing localization, preprocessing and adaptation reports were reused by
hash, with no unchanged inference rerun. PR #39 remains unmerged and #24 open.

Three rights-reviewed public originals were acquired, with 36 selected PDF
pages rasterized and visually inspected. Twelve boards were extracted from two
works: six each from Capablanca and Staunton. The Lasker selection remained
front matter and provided a negative page, not a third board-design sample.
The fixed page budget was not expanded to hide that low yield. Title-page
inspection identifies Lasker's publisher as E. P. Dutton & Company and Staunton's
1848 volume as the second edition. Their source records and jurisdiction limits
remain attached; this is not worldwide model-distribution clearance.

`sources.json` is the immutable pre-acquisition catalog bound by the intake
lock: its publisher field still records `pending-title-page-review`. The
title-page findings above are subsequent visual-review annotations, not a
silent rewrite of that acquisition identity. Any expansion must version the
catalog and carry these annotations forward; review of later additions and
edition-specific rights remains distinct from reading the publisher imprint.

| Measured axis                                  | Pilot result                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Accepted boards / other regions                | 12 / one text-page negative and one derived partial board                                |
| Book/design independence                       | Two board-bearing works; typefoundry lineage unresolved                                  |
| Print and color                                | 12 hatched, cream-paper boards; zero pristine flat or colored-board cases                |
| Density                                        | Four single-piece, seven 2–8-piece, one 9–20-piece; zero dense boards                    |
| Class coverage                                 | 36 occupied squares; white knight absent; 732 empty squares                              |
| Geometry                                       | Exact rectangles, original pages, one negative, one partial; no real multiple-board page |
| Train / dev / qualification / clean regression | 0 / 0 / 0 / 0; all 14 records are exposed diagnostics                                    |

The proposed 1,200/240/240/120 sets and 6/3/3 independent components remain
targets, not populated or frozen sets. Unknown lineage prevents inventing
independence from different book titles. Pretrained-model overlap remains
unknown. These missing cells are continuing work on #41, not waived gates.

## Labels and visual artifacts

The lead and source-research agent transcribed proposals using visible pieces
and adjacent notation, then inspected all 64 squares. This is agent visual
review, **not owner/human certification**. Independent review resolved a rook
proposal that was wrong in both rank and color using the book's printed piece
key. Earlier proposals and four intermediate quarantines are retained. Final
decisions accept all 14 regions, with zero pending owner questions. Single-piece
instructional diagrams were not repaired into legally playable positions.

Open the ignored `work/review-final.html` for crop/grid/placement, diagnostic
tile and degradation sheets; `work/review/*-pages.png` provides page context.
The exact local proposals and decisions are hash-bound in the public report.
The public registry contains geometry and hashes, not automatic label approval.
No model-assisted inference was executed; the proposal schema supports it with
explicit model/preprocessing hashes for later use.

Native and degraded pairs were visually inspected. The half-resolution/blur
variants illustrate stroke loss, but have not been matched to a measured real
scan stratum. They cannot establish realistic augmentation fidelity. Diagnostic
grayscale tiles are not a FENShot preprocessing-parity claim. The perceptual
screen flags many visually different sparse boards because their grids dominate
the small hash; these are similarity proposals, not confirmed duplicates. All
remain in the same diagnostic group, with zero cross-split pairs.

## Resources and reproducibility

The three originals total 69,900,178 bytes. Successful download wall time was
19.21 seconds; an initial default-user-agent 403 was corrected with an identified
project user agent, without changing TLS. The first 36-page raster pass took
42.749 seconds; the byte-identical replay took 42.683 seconds. Extraction was
also replayed against immutable outputs. Total cached originals and local
artifacts, including superseded reviews, occupy 135,104,544 bytes (about
129 MiB), below the 1 GiB ceiling. No GPU seconds, model inference or API image
uploads were consumed. The original training ledger is unchanged.

Environment: Linux ARM64, CPython 3.12.3, Pillow 10.2.0, Poppler 24.02.0;
renderer executable hashes, source/rights hashes, generated artifact hashes,
schema, commands and reused evidence hashes are in `preparation-report.json`.
No packages were installed. Source bytes, raster pages, labels and review
images remain ignored local artifacts; they are not bundled into production.

## Verification and limits

Executed commands are documented in [README](README.md#environment-and-commands).
The offline suite passes 14 tests covering bounded intake, corruption, unknown
sources, redirects, timeout, symlink/traversal, immutable publication, recovery,
64-square labels, geometry/orientation, stale and forged reviews, split leakage
and exposure. Intake verification, final extraction replay, review verification,
Python compilation, `pnpm check`, local Markdown file links and diff checks pass.
The real audit passes integrity and preservation; `audit.py --revision final
--qualify` exits 1 with all full-data gates unmet, not a green qualification.

Staged-policy stage 0 only: product/unit/browser/recognition suites for unchanged
production were not rerun. Model adaptation, full qualification, browser model
qualification and physical iPad testing were not reached. No model is ready for
promotion. The next authorized preparation increment needs the missing real
coverage and lineage review; the bounded future adaptation in the plan remains
a proposal requiring a separate execution decision.

Independent agents supplied public-source/ChessVision research, intake tooling
and tests, tooling review, and a visual tiebreak. The lead owned issue scope,
integration, final labels, data gates and verification. See the separate
[ChessVision assessment](CHESSVISION.md): exportable fine-tuning is advertised,
but unseen-book accuracy, training inventory and offline redistribution terms
are not established by the marketing material.
