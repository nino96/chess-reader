import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { PAGE_SPECS } from '../generators/recognition-corpus-spec.mjs';
import { getFixture } from '../src/index';
import {
  CORPUS_MANIFEST_PATH,
  corpusPath,
  expandCorpusPlacement,
  loadCorpus,
  parseCorpusManifest,
} from '../src/corpus';

const execFileAsync = promisify(execFile);

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function rotatePlacement(placement: string): readonly (string | null)[] {
  return [...expandCorpusPlacement(placement)].reverse();
}

describe('printed-book recognition corpus v1', () => {
  it('loads through the strict runtime boundary and rejects changed lock fields', () => {
    const corpus = loadCorpus();
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.corpusVersion).toBe(1);
    expect(corpus.lockedBeforeTuning).toBe(true);
    expect(corpus.coordinateSystem).toBe('top-left-image-pixels');
    expect(corpus.matching.iouThreshold).toBe(0.9);
    expect(corpus.matching.tieBreakers).toEqual(['prediction-index', 'annotation-index']);
    expect(corpus.tolerance.gridErrorSquares).toBe(0.08);

    const changed = structuredClone(corpus) as unknown as Record<string, unknown>;
    changed['lockedBeforeTuning'] = false;
    expect(() => parseCorpusManifest(changed)).toThrow(/lockedBeforeTuning/);

    expect(() => corpusPath('../../outside.png')).toThrow(/escapes/);
  });

  it('locks every page hash, PNG dimensions, and root fixture entry', async () => {
    const corpus = loadCorpus();
    expect(corpus.pages).toHaveLength(16);
    for (const page of corpus.pages) {
      const path = corpusPath(page.path);
      expect(existsSync(path), page.path).toBe(true);
      expect(sha256(path), page.id).toBe(page.sha256);
      const image = await loadImage(path);
      expect([image.width, image.height], page.id).toEqual([page.width, page.height]);
      const fixture = getFixture(`recognition-corpus-v1-${page.id}`);
      expect(fixture.path).toBe(page.path);
      expect(fixture.sha256).toBe(page.sha256);
      expect(fixture.contentType).toBe('image/png');
    }
    expect(sha256(corpusPath(corpus.contactSheet.path))).toBe(corpus.contactSheet.sha256);
    expect(getFixture('recognition-corpus-v1-manifest').path).toBe(CORPUS_MANIFEST_PATH);
    expect(getFixture('recognition-corpus-v1-contact-sheet').sha256).toBe(
      corpus.contactSheet.sha256,
    );
  });

  it('keeps geometry, placements, orientations, and partial truth internally consistent', () => {
    const corpus = loadCorpus();
    let completeCount = 0;
    let partialCount = 0;
    for (const page of corpus.pages) {
      for (const annotation of page.annotations) {
        const { x, y, width, height } = annotation.pixelRect;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(page.width);
        expect(y + height).toBeLessThanOrEqual(page.height);
        if (annotation.kind === 'partial') {
          partialCount += 1;
          expect(annotation.canonicalPlacement).toBeNull();
          expect(annotation.renderedPlacement).toBeNull();
          continue;
        }
        completeCount += 1;
        expect(expandCorpusPlacement(annotation.canonicalPlacement ?? '')).toHaveLength(64);
        const rendered = expandCorpusPlacement(annotation.renderedPlacement ?? '');
        expect(rendered).toHaveLength(64);
        if (annotation.orientation === 'black') {
          expect(rendered).toEqual(rotatePlacement(annotation.canonicalPlacement ?? ''));
        } else {
          expect(rendered).toEqual(expandCorpusPlacement(annotation.canonicalPlacement ?? ''));
        }
      }
    }
    expect(completeCount).toBe(14);
    expect(partialCount).toBe(2);
  });

  it('covers the matrix fixed before measurement', () => {
    const corpus = loadCorpus();
    const tags = new Set(corpus.pages.flatMap((page) => page.tags));
    for (const required of [
      'flat',
      'grayscale',
      'hatch-0',
      'hatch-45',
      'hatch-90',
      'hatch-135',
      'sparse',
      'medium',
      'dense',
      'halftone',
      'scan-degraded',
      'low-resolution',
      'multiple-boards',
      'negative',
      'text-only',
      'grid',
      'partial-board',
      'white-orientation',
      'black-orientation',
      'ambiguous-orientation',
      'pawnless',
      'endgame',
      'middlegame',
      'opening',
      'labels',
      'border',
      'no-border',
    ]) {
      expect(tags.has(required), required).toBe(true);
    }
    expect(corpus.pages.filter((page) => page.tags.includes('multiple-boards'))).toHaveLength(2);
    expect(corpus.pages.filter((page) => page.tags.includes('no-board'))).toHaveLength(2);
    expect(corpus.generation.pieceStyles.map((style) => style.id)).toEqual(['chessnut']);
    expect(corpus.generation.exclusions.join(' ')).toMatch(/second piece style/i);

    const flat = corpus.pages.find((page) => page.id === 'flat-gray-middlegame-white');
    const hatch = corpus.pages.find((page) => page.id === 'matched-hatch-45-middlegame-white');
    expect(flat?.annotations[0]?.pixelRect).toEqual(hatch?.annotations[0]?.pixelRect);
    expect(flat?.annotations[0]?.canonicalPlacement).toBe(
      hatch?.annotations[0]?.canonicalPlacement,
    );
    expect(flat?.generator.seed).toBe(hatch?.generator.seed);

    const ambiguous = corpus.pages
      .flatMap((page) => page.annotations)
      .find((annotation) => annotation.orientation === 'ambiguous');
    expect(ambiguous?.hasCoordinateLabels).toBe(false);
  });

  it('regenerates all locked corpus outputs byte-for-byte', async () => {
    const corpus = loadCorpus();
    const tempDir = await mkdtemp(join(tmpdir(), 'chess-reader-corpus-v1-'));
    try {
      await execFileAsync(process.execPath, [
        corpusPath('generators/make-recognition-corpus.mjs'),
        tempDir,
      ]);
      const generatedFiles = [
        'manifest.json',
        'contact-sheet.png',
        'OVERVIEW.md',
        ...corpus.pages.map((page) => join('pages', basename(page.path))),
      ];
      const mismatches: {
        file: string;
        expectedSha256: string;
        actualSha256: string;
        changedChannels: number | null;
        maximumChannelDifference: number | null;
      }[] = [];
      for (const relativePath of generatedFiles) {
        const regenerated = await readFile(join(tempDir, relativePath));
        const committed = await readFile(corpusPath(join('corpus/v1', relativePath)));
        if (regenerated.equals(committed)) continue;
        let changedChannels: number | null = null;
        let maximumChannelDifference: number | null = null;
        if (relativePath.endsWith('.png')) {
          const pixels = async (bytes: Buffer) => {
            const image = await loadImage(bytes);
            const canvas = createCanvas(image.width, image.height);
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, image.width, image.height).data;
          };
          const [expected, actual] = await Promise.all([pixels(committed), pixels(regenerated)]);
          changedChannels = 0;
          maximumChannelDifference = 0;
          for (let index = 0; index < expected.length; index += 1) {
            const difference = Math.abs((expected[index] ?? 0) - (actual[index] ?? 0));
            if (difference > 0) changedChannels += 1;
            maximumChannelDifference = Math.max(maximumChannelDifference, difference);
          }
        }
        mismatches.push({
          file: relativePath,
          expectedSha256: createHash('sha256').update(committed).digest('hex'),
          actualSha256: createHash('sha256').update(regenerated).digest('hex'),
          changedChannels,
          maximumChannelDifference,
        });
      }
      // Retain exact-byte enforcement while distinguishing encoding from raster drift.
      expect(mismatches, JSON.stringify({ corpusRegenerationMismatches: mismatches })).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps the generator specification and manifest page order aligned', () => {
    expect(loadCorpus().pages.map((page) => page.id)).toEqual(PAGE_SPECS.map((page) => page.id));
  });
});
