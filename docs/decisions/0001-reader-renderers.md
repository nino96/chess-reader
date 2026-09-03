# ADR 0001: Separate EPUB and PDF renderers behind one reader contract

Status: superseded by ADR 0004
Date: 2026-09-03

## Context

The app needs EPUB reflow/locators and PDF page bitmap/coordinate APIs. Readium
Kotlin supports both formats, but its open PDF adapter uses PdfiumAndroid and
AndroidPdfViewer, which Readium currently describes as unmaintained. The current
AndroidX PDF API supports Android 12, exposes bitmap sources for recognition,
and reports visible-page locations and zoom in view coordinates.

## Decision

- Use Readium Kotlin for EPUB publication parsing and navigation.
- Use AndroidX PDF for PDF parsing, display, bounded page rendering, and
  page/view coordinate conversion.
- Hide both behind `ReaderSurface` and format-specific adapters.
- Store format-native stable locators, never a fake common page number.

## Consequences

The app avoids an unmaintained PDF renderer and gets first-class recognition
inputs, but it integrates two navigation implementations. Contract and
instrumentation tests are required to make reader behavior consistent. The
AndroidX PDF dependency must remain isolated because its API is still maturing.
