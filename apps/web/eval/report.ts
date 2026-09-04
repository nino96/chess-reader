import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Nearest-rank percentile on an ascending array; `null` for an empty input. */
export function percentile(sortedAscending: readonly number[], fraction: number): number | null {
  if (sortedAscending.length === 0) {
    return null;
  }
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(fraction * sortedAscending.length) - 1),
  );
  return sortedAscending[index] ?? null;
}

export interface DistributionSummary {
  readonly count: number;
  readonly min: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

export function summarize(values: readonly number[]): DistributionSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? null,
  };
}

export function writeJsonReport(path: string, report: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
