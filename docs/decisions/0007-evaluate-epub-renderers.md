# ADR 0007: Select the EPUB renderer through a scored implementation spike

Status: accepted process; implementation choice pending
Date: 2026-09-03

## Context

Readium Web has strong publication/navigation concepts but normally consumes a
web publication manifest supplied over HTTP. EPUB.js can open a local
ArrayBuffer directly, which fits an offline local-file PWA, but needs its own
security, maintenance, locator, and compatibility evaluation.

## Decision

Implement a time-boxed vertical slice with both Readium Web/Thorium Web and
EPUB.js. Score local opening, offline behavior, reflow/fixed layout, locator
restore, image/coordinate access, hostile-content isolation, accessibility,
iPad memory/performance, maintenance, and integration complexity.

Record raw results and replace this pending decision with a concrete ADR. Do not
silently choose a renderer or weaken a gate to make one pass.

## Consequences

EPUB implementation starts one issue later, but the project avoids locking its
most uncertain reader dependency based on a README comparison alone.
