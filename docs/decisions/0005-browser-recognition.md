# ADR 0005: Run fenshot directly in a browser worker

Status: accepted
Date: 2026-09-03

## Context

The earlier Android design required porting fenshot preprocessing and board
detection to Kotlin. The web-first platform can use the original TypeScript
implementation and its small ONNX model directly.

## Decision

- Pin and use the MIT-licensed fenshot package and model.
- Run ONNX Runtime Web with WebAssembly as the compatibility baseline.
- Perform recognition in a dedicated worker and self-host all runtime/model
  assets.
- Treat WebGPU or threaded WASM only as measured optional acceleration.
- Preserve `DiagramRecognizer` so another implementation remains possible.

## Consequences

The implementation stays close to upstream golden behavior and works offline
on Safari/iPad without a Kotlin port. Worker, canvas, and asset-cache behavior
must be evaluated on real iPad hardware.
