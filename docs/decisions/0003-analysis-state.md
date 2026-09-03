# ADR 0003: Persist a move tree while initially exposing a single line

Status: accepted
Date: 2026-09-03

## Context

The first move-exploration milestone needs only one undoable line. Branching
variations are explicitly a later issue. Persisting a flat move array first
would require a disruptive migration when branches arrive.

## Decision

- Persist an immutable initial full FEN and parent-linked UCI move nodes.
- During the single-line milestone, the use case permits at most one child per
  node and replaces/truncates continuation after playing from an earlier ply.
- The variation issue later permits multiple ordered children and supplies
  branch navigation UI.
- Derive SAN for presentation instead of storing it as authoritative state.

## Consequences

The initial UI stays simple while storage is already compatible with analysis
trees. The first implementation must test tree persistence even though it only
creates a line.
