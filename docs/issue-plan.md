# Ordered implementation issues

The implementation backlog is maintained as real GitHub issues. It is ordered
around early testable product slices, with focused infrastructure and evaluation
issues placed immediately before the slices that need them. Follow each issue's
explicit `Depends on` section; independent work may run in parallel after its
prerequisites are merged.

## First usable PDF loop

1. [#1 Bootstrap a runnable PWA, preview deployment, and fast test loop](https://github.com/nino96/chess-reader/issues/1)
2. [#2 Walking slice: turn a selected PDF diagram into an editable board](https://github.com/nino96/chess-reader/issues/2)
3. [#3 Make the PDF-to-board slice installable, offline, and restorable](https://github.com/nino96/chess-reader/issues/3)

Issue #2 deliberately crosses the reader, capture, recognition, and board
layers with temporary in-memory state. It exists to expose integration,
performance, and interaction risks before the project invests in generalized
infrastructure. Issue #3 makes that same path a useful offline prototype.

## Durable and low-friction PDF product

4. [#4 Harden browser book storage, import journaling, and re-linking](https://github.com/nino96/chess-reader/issues/4)
5. [#5 Grow the PDF slice into a usable local book reader](https://github.com/nino96/chess-reader/issues/5)
6. [#6 Harden offline recognition and its durable result cache](https://github.com/nino96/chess-reader/issues/6)
7. [#7 Vertical slice: make PDF diagrams automatically tappable](https://github.com/nino96/chess-reader/issues/7)
8. [#8 Productionize the overlay board and full position editor](https://github.com/nino96/chess-reader/issues/8)
9. [#9 Vertical slice: play one legal, undoable line](https://github.com/nino96/chess-reader/issues/9)
10. [#10 Restore complete PDF study sessions across browser lifecycle events](https://github.com/nino96/chess-reader/issues/10)

## EPUB through the proven workflow

11. [#11 Spike Readium Web vs EPUB.js through the working study flow](https://github.com/nino96/chess-reader/issues/11)
12. [#12 Vertical slice: add production EPUB reading and manual diagram capture](https://github.com/nino96/chess-reader/issues/12)
13. [#13 Vertical slice: make EPUB diagrams automatically tappable](https://github.com/nino96/chess-reader/issues/13)
14. [#14 Unify and harden reader, overlay, touch, and accessibility behavior](https://github.com/nino96/chess-reader/issues/14)

The renderer bake-off in #11 is a decision-producing spike, but it must exercise
the existing diagram-to-board path. This prevents a renderer from winning an
isolated API comparison while failing the actual product interaction.

## Study and engine

15. [#15 Vertical slice: add branching move variations](https://github.com/nino96/chess-reader/issues/15)
16. [#16 Vertical slice: add first offline Stockfish analysis](https://github.com/nino96/chess-reader/issues/16)
17. [#17 Extend Stockfish with MultiPV, safe tuning, and optimized variants](https://github.com/nino96/chess-reader/issues/17)

Issue #9 intentionally ships only one undoable line. Branches stay in #15. The
first engine slice in #16 intentionally uses a portable single-thread build and
one PV; configuration and threaded/SIMD variants follow in #17.

## Resilience and distribution

18. [#18 Harden production offline updates, headers, and asset integrity](https://github.com/nino96/chess-reader/issues/18)
19. [#19 Harden iPad/browser storage recovery, backup, and migrations](https://github.com/nino96/chess-reader/issues/19)
20. [#20 Vertical slice: package and validate the Android 12+ app](https://github.com/nino96/chess-reader/issues/20)
21. [#21 Close cross-platform UX, performance, security, and licensing gaps](https://github.com/nino96/chess-reader/issues/21)
22. [#22 Qualify the first cross-platform release](https://github.com/nino96/chess-reader/issues/22)

## Product checkpoints

| After issue | What the owner can test |
| --- | --- |
| #1 | Open the deployed responsive shell and capability diagnostics on laptop/iPad |
| #2 | Select a PDF diagram, recognize locally, and correct the floating board |
| #3 | Install it, go offline, relaunch, and recover that PDF/board |
| #7 | Tap PDF diagrams directly, with manual selection as fallback |
| #9 | Play and undo one legal continuation |
| #12 | Use the same manual study flow with EPUB |
| #13 | Tap EPUB diagrams directly |
| #15 | Explore branch variations |
| #16 | Run basic offline Stockfish analysis |
| #17 | Configure MultiPV/engine resources and add a PV explicitly |
| #20 | Complete the same workflow in a sideloaded Android APK |
| #22 | Install the qualified reproducible release |

## Recommended agent workflow

1. Assign one issue to one agent/task.
2. Ask it to read `README.md`, `docs/architecture.md`,
   `docs/platform-limitations.md`, `docs/evaluation.md`, all accepted ADRs, and
   the issue body.
3. For a vertical slice, preserve the complete working path even when internals
   are deliberately narrow. For supporting work, prove it through the nearest
   existing product path rather than only isolated unit tests.
4. Require the smallest focused pull request that satisfies the acceptance
   criteria and supplies the requested automated and real-device evidence.
5. Run narrow checks during implementation and the issue-specific browser,
   fixture, security, performance, and device gates before completion.
6. Review and merge prerequisites before assigning a dependent issue.
7. If evidence invalidates an architectural choice, add or supersede an ADR in
   the same pull request instead of silently diverging.
