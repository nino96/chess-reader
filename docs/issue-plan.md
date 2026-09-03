# Ordered implementation issues

The repository's implementation backlog is maintained as real GitHub issues.
They are intentionally numbered in dependency order and are suitable for one
coding-agent task/PR each. Unless an issue explicitly says otherwise, complete
and merge each predecessor before starting the next issue.

## Foundation and reading

1. [#1 Bootstrap the Android 12+ project and CI baseline](https://github.com/nino96/chess-reader/issues/1)
2. [#2 Define core domain contracts and Room persistence](https://github.com/nino96/chess-reader/issues/2)
3. [#3 Implement SAF import and the local book library](https://github.com/nino96/chess-reader/issues/3)
4. [#4 Add the AndroidX PDF reader with locator restoration](https://github.com/nino96/chess-reader/issues/4)
5. [#5 Add the Readium EPUB reader with stable locators](https://github.com/nino96/chess-reader/issues/5)
6. [#6 Build the reader shell and movable analysis-panel overlay](https://github.com/nino96/chess-reader/issues/6)

## Diagram recognition

7. [#7 Prove and benchmark the offline diagram recognizer](https://github.com/nino96/chess-reader/issues/7)
8. [#8 Implement current-content recognition coordination and caching](https://github.com/nino96/chess-reader/issues/8)
9. [#9 Make PDF diagrams automatically tappable](https://github.com/nino96/chess-reader/issues/9)
10. [#10 Make EPUB diagrams automatically tappable](https://github.com/nino96/chess-reader/issues/10)
11. [#11 Add manual board-region selection as the recognition fallback](https://github.com/nino96/chess-reader/issues/11)

## Board and move exploration

12. [#12 Implement the interactive board and full position editor](https://github.com/nino96/chess-reader/issues/12)
13. [#13 Support legal moves in a single undoable line](https://github.com/nino96/chess-reader/issues/13)
14. [#14 Restore diagram analysis sessions across navigation and process death](https://github.com/nino96/chess-reader/issues/14)
15. [#15 Add branching analysis variations](https://github.com/nino96/chess-reader/issues/15)

## Engine and release

16. [#16 Package Stockfish reproducibly and implement a lifecycle-safe UCI controller](https://github.com/nino96/chess-reader/issues/16)
17. [#17 Add configurable Stockfish analysis to the overlay board](https://github.com/nino96/chess-reader/issues/17)
18. [#18 Harden, license, and produce the first reproducible sideloaded APK](https://github.com/nino96/chess-reader/issues/18)

## Recommended agent workflow

1. Assign one issue to one agent/task.
2. Ask it to read `docs/architecture.md`, all accepted ADRs, and the issue body.
3. Require a focused pull request with the issue's verification evidence.
4. Review and merge it before assigning the next issue.
5. If implementation evidence invalidates an architectural choice, add or
   supersede an ADR in the same pull request rather than silently diverging.
