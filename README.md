# Chess Reader

Chess Reader is a local-first Android app for studying DRM-free PDF and EPUB
chess books. It detects diagrams on the page being read, makes them tappable,
and opens a movable analysis board over the still-active book reader.

The project currently contains architecture and an ordered implementation
backlog. Android project bootstrapping is intentionally tracked as the first
implementation issue because this workstation does not have the Android SDK.

## Product boundaries

- Android 12 (API 31) and newer
- Personal, sideloaded use initially
- PDF and EPUB; no DjVu
- Offline-first with no accounts, telemetry, or required server
- Current-page recognition rather than whole-book pre-processing
- Automatic diagram hotspots with manual region selection as a fallback
- Editable positions, legal move exploration, and later Stockfish analysis

## Project documents

- [Architecture](docs/architecture.md)
- [Architecture decisions](docs/decisions/)
- [Ordered GitHub issue plan](docs/issue-plan.md)

## Working agreement for coding agents

Implementation issues are intentionally ordered. An agent taking an issue
should read the architecture and all accepted decision records, confirm that
the preceding issue is complete, keep the change scoped to one issue, and
include the verification required by that issue in its pull request.

