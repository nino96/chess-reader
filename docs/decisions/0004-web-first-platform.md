# ADR 0004: Use a web-first PWA with a thin Android wrapper

Status: accepted
Date: 2026-09-03

## Context

The product must run on laptops and iPad as well as Android. The earlier design
used native Kotlin/Compose, Readium Kotlin, AndroidX PDF, Room, ONNX Runtime
Android, and a native Stockfish build. A separate web client would duplicate the
reader, overlay, recognition coordination, board, persistence, and engine UI.

The core dependencies all have viable browser implementations: PDF.js, EPUB
renderers, fenshot/ONNX Runtime Web, and Stockfish WebAssembly.

## Decision

- Make a TypeScript/React progressive web app the primary product.
- Use browser standards and capability probes rather than platform detection.
- Package the same production build in a thin Capacitor Android wrapper.
- Keep platform-specific file/lifecycle behavior behind narrow adapters.
- Require laptop, iPad, browser-engine, and Android-wrapper evidence before the
  first release.

## Consequences

Most implementation and tests are shared across targets. Browser storage,
background suspension, and WebAssembly capabilities become explicit design
concerns. Native Android rendering and engine performance are traded for one
coherent product and substantially less duplicated work.
