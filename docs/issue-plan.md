# Ordered implementation issues

The implementation backlog is maintained as real GitHub issues. The issues are
numbered in dependency order and scoped for one coding-agent task/pull request
each. Follow each issue's explicit `Depends on` section; independent work may run
in parallel once its prerequisites are merged.

## Web foundation and readers

1. [#1 Bootstrap the TypeScript PWA and cross-browser CI baseline](https://github.com/nino96/chess-reader/issues/1)
2. [#2 Define portable domain contracts and IndexedDB persistence](https://github.com/nino96/chess-reader/issues/2)
3. [#3 Implement browser storage capabilities, OPFS journaling, re-link, and backup](https://github.com/nino96/chess-reader/issues/3)
4. [#4 Implement local PDF/EPUB import and the book library](https://github.com/nino96/chess-reader/issues/4)
5. [#5 Add the PDF.js reader, capture, and locator restoration](https://github.com/nino96/chess-reader/issues/5)
6. [#6 Run the Readium Web vs EPUB.js bake-off and record the decision](https://github.com/nino96/chess-reader/issues/6)
7. [#7 Implement the selected EPUB reader adapter](https://github.com/nino96/chess-reader/issues/7)
8. [#8 Build the reader shell and movable board overlay](https://github.com/nino96/chess-reader/issues/8)

## Offline recognition and tappable diagrams

9. [#9 Integrate and evaluate offline fenshot recognition](https://github.com/nino96/chess-reader/issues/9)
10. [#10 Implement the recognition coordinator and durable result cache](https://github.com/nino96/chess-reader/issues/10)
11. [#11 Add tappable PDF diagram hotspots](https://github.com/nino96/chess-reader/issues/11)
12. [#12 Add tappable EPUB diagram hotspots](https://github.com/nino96/chess-reader/issues/12)
13. [#13 Add fast manual diagram selection as a fallback](https://github.com/nino96/chess-reader/issues/13)

## Board and move exploration

14. [#14 Implement the interactive board and position editor](https://github.com/nino96/chess-reader/issues/14)
15. [#15 Add legal move play with one undoable line](https://github.com/nino96/chess-reader/issues/15)
16. [#16 Restore reading and chess sessions across browser lifecycle events](https://github.com/nino96/chess-reader/issues/16)
17. [#17 Add branching move variations](https://github.com/nino96/chess-reader/issues/17)

## Engine, offline hardening, and releases

18. [#18 Integrate the offline Stockfish Web Worker runtime](https://github.com/nino96/chess-reader/issues/18)
19. [#19 Add configurable multi-PV Stockfish analysis](https://github.com/nino96/chess-reader/issues/19)
20. [#20 Harden offline PWA updates, storage recovery, and deployment headers](https://github.com/nino96/chess-reader/issues/20)
21. [#21 Package the PWA as an Android 12+ app with Capacitor](https://github.com/nino96/chess-reader/issues/21)
22. [#22 Complete cross-platform release qualification](https://github.com/nino96/chess-reader/issues/22)

## Recommended agent workflow

1. Assign one issue to one agent/task.
2. Ask it to read `README.md`, `docs/architecture.md`,
   `docs/platform-limitations.md`, `docs/evaluation.md`, all accepted ADRs, and
   the issue body.
3. Require the smallest focused pull request that satisfies the issue's
   acceptance criteria and supplies the evaluation evidence requested in the
   issue.
4. Run the standard fast checks locally, then the issue-specific browser,
   fixture, security, performance, and real-device gates.
5. Review and merge the prerequisite before assigning a dependent issue.
6. If implementation evidence invalidates an architectural choice, add or
   supersede an ADR in the same pull request instead of silently diverging.

Issue #6 is deliberately a decision-producing spike. Issue #15 deliberately
ships only one undoable line, while #17 adds branch variations. Issue #21 is the
first task that requires Android tooling; the preceding product remains a
complete browser/PWA implementation.
