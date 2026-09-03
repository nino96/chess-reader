# ADR 0006: Combine OPFS, re-linking, and backup for durable local data

Status: accepted
Date: 2026-09-03

## Context

Browser storage can be quota-limited, evicted under pressure, cleared by the
user, or unavailable in private mode. Safari cannot be assumed to retain an
external file handle. A useful offline reader must recover without pretending
these constraints do not exist.

## Decision

- Store structured state in IndexedDB and managed book bytes in OPFS.
- Request persistent storage from a user gesture and show whether it was
  granted.
- Support reference/re-link mode for users who do not want managed copies.
- Reconnect re-selected books using their content hash.
- Journal cross-store imports and recover incomplete operations.
- Provide versioned metadata/study backup and atomic validated restore.
- Keep original user books outside the backup by default.

## Consequences

The app remains useful on iPad even when durable external handles are absent.
Imports and storage UI are more involved, but quota failure, eviction, and user
data clearing have explicit recovery paths. No design can recover unexported
data after the user clears the origin, so backup status is visible product
state.
