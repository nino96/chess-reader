/**
 * Structural tests for the fixture corpus itself (docs/fixtures.md): the manifest
 * validates, every listed file exists with the hash it claims, nothing under
 * `pdf/` is untracked by the manifest, and the committed PDF is byte-identical to
 * what its generator produces today (the determinism `docs/fixtures.md` §1
 * requires of a synthetic fixture).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  BOARD_RECT_PT,
  NEGATIVE_TEXT_RECT_PT,
  toNormalizedRect,
} from '../generators/lib/layout.mjs';
import { fixturePath, getFixture, loadManifest } from '../src/index';

const execFileAsync = promisify(execFile);

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('manifest.json', () => {
  it('validates against the fixture manifest schema', () => {
    expect(() => loadManifest()).not.toThrow();
    const manifest = loadManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fixtures.length).toBeGreaterThan(0);
  });

  it('lists every fixture file with a matching sha256 and an existing path', () => {
    const manifest = loadManifest();
    for (const fixture of manifest.fixtures) {
      const absolutePath = fixturePath(fixture.path);
      expect(existsSync(absolutePath), `${fixture.path} does not exist`).toBe(true);
      expect(sha256Of(absolutePath), `sha256 mismatch for ${fixture.path}`).toBe(fixture.sha256);
    }
  });

  it('tracks every file under pdf/ in the manifest', () => {
    const manifest = loadManifest();
    const trackedPaths = new Set(manifest.fixtures.map((fixture) => fixture.path));
    const pdfDir = fixturePath('pdf');
    const entries = existsSync(pdfDir) ? readdirSync(pdfDir) : [];
    for (const entry of entries) {
      expect(trackedPaths.has(`pdf/${entry}`), `pdf/${entry} is not listed in manifest.json`).toBe(
        true,
      );
    }
  });

  it("pdf-synthetic-diagram-01's boardRect matches the generator's own geometry", () => {
    const fixture = getFixture('pdf-synthetic-diagram-01');
    const expected = fixture.expected as {
      readonly boardRect: { x: number; y: number; width: number; height: number };
    };
    const computedBoardRect = toNormalizedRect(BOARD_RECT_PT);
    expect(expected.boardRect.x).toBeCloseTo(computedBoardRect.x, 10);
    expect(expected.boardRect.y).toBeCloseTo(computedBoardRect.y, 10);
    expect(expected.boardRect.width).toBeCloseTo(computedBoardRect.width, 10);
    expect(expected.boardRect.height).toBeCloseTo(computedBoardRect.height, 10);

    // Sanity check on the sibling rect the golden test uses for its negative case:
    // it must be a real (non-degenerate) region of page 0.
    const negativeRect = toNormalizedRect(NEGATIVE_TEXT_RECT_PT);
    expect(negativeRect.width).toBeGreaterThan(0);
    expect(negativeRect.height).toBeGreaterThan(0);
  });

  it('regenerates pdf-synthetic-diagram-01.pdf byte-for-byte', async () => {
    const generatorPath = fixturePath('generators/make-diagram-pdf.mjs');
    const tempDir = await mkdtemp(join(tmpdir(), 'chess-reader-fixture-regen-'));
    const outputPath = join(tempDir, 'pdf-synthetic-diagram-01.pdf');
    try {
      await execFileAsync(process.execPath, [generatorPath, outputPath]);
      const regenerated = await readFile(outputPath);
      const committed = await readFile(fixturePath('pdf/pdf-synthetic-diagram-01.pdf'));
      expect(regenerated.equals(committed)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});
