# ADR 0002: Prove an offline fenshot-derived recognizer before considering LAN

Status: superseded by ADR 0005
Date: 2026-09-03

## Context

The app should work entirely offline and recognize only the currently visible
content, with low perceived delay. A server would simplify Python model reuse
but introduces connectivity, privacy, deployment, and failure-mode costs.

`scoriiu/fenshot` is MIT licensed and specifically supports book diagrams. It
uses deterministic board detection plus a roughly 1.3 MB ONNX classifier and
returns per-square confidence. This is small enough to justify a native Android
proof before adding any server dependency.

## Decision

- Port/validate the board-detection and tensor preprocessing in Kotlin.
- Run the upstream model with ONNX Runtime Android.
- Reuse upstream golden fixtures and add book-page fixtures.
- Benchmark cold and warm latency, memory, and accuracy on a physical device.
- Optimize CPU/XNNPACK first; try NNAPI only when measurement justifies it.
- Keep `DiagramRecognizer` implementation-neutral.
- Do not add a LAN recognizer unless the recorded device results fail the agreed
  quality gate after reasonable on-device optimization.

## Consequences

The default app remains private, offline, and simple to operate. The recognition
spike has more native integration work than calling a server, but it is bounded
by a small model and reproducible upstream tests. The interface preserves a LAN
escape hatch without making it part of the initial product.
