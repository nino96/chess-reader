# Chess Reader

Chess Reader is a local-first progressive web app for studying DRM-free PDF
and EPUB chess books. It detects diagrams in the content being read, makes them
tappable, and opens a movable analysis board over the still-active reader.

The same web application is intended to run in laptop browsers, as an installed
web app on iPad, and inside a thin Capacitor wrapper for a sideloaded Android
application.

The project currently contains architecture, risk analysis, evaluation gates,
and an ordered implementation backlog.

## Product boundaries

- Modern Chromium, Firefox, and Safari, including iPadOS 17+
- Android 12+ through a thin web-native wrapper
- PDF and EPUB; no DjVu
- Local-first and usable offline after installation
- No account, telemetry, cloud library, or required recognition server
- Current-content recognition rather than whole-book pre-processing
- Automatic diagram hotspots with manual region selection as a fallback
- Editable positions, legal move exploration, variations, and Stockfish

## Project documents

- [Architecture](docs/architecture.md)
- [Browser and iPad limitations](docs/platform-limitations.md)
- [Test and evaluation strategy](docs/evaluation.md)
- [Architecture decisions](docs/decisions/)
- [Ordered GitHub issue plan](docs/issue-plan.md)

## Working agreement for coding agents

Implementation issues are intentionally ordered. An agent taking an issue
should read the architecture, platform limitations, evaluation strategy, and
all accepted decision records; confirm its explicit dependencies are complete;
keep the change scoped to one issue; and attach the required automated and
device evidence to its pull request. Product-slice issues preserve an
end-to-end user workflow; focused infrastructure issues prove their behavior
through the nearest working slice.

An implementation change that weakens an evaluation gate requires an explicit
architecture-decision update. A bug fix must add a minimized regression fixture
whenever the input can be legally committed.
