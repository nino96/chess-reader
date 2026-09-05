/**
 * Issue #35 evaluation-only board localizer.
 *
 * This module deliberately has no manifest/annotation input and does not use
 * classifier confidence to choose geometry.  It searches pixels for complete,
 * axis-aligned 8x8 checkerboards and hands at most four independent boxes to
 * the unchanged FENShot tile classifier used by the evaluation harness.
 */
import type { BoardCorners, GrayImage, RecognitionResult } from '@scoriiu/fenshot';

export const LOCALIZATION_VERSION = 'integral-checkerboard-v1' as const;

// Product capture targets a 1024px long edge, but integer rounding and future
// adapters can legally exceed it. Match the existing recognition protocol's
// hard safety bound while the low-pass search remains fixed at 256px.
const MAX_IMAGE_DIMENSION = 4096;
const MAX_SEARCH_DIMENSION = 256;
const MIN_BOARD_DIMENSION = 64;
const MAX_RESULTS = 4;
const COARSE_SCALE_FACTOR = 1.1;
const COARSE_POSITION_DIVISOR = 4;
const MAX_COARSE_CANDIDATES = 48;
const MIN_CONTRAST = 14;
const MIN_SCORE = 1.15;
const MIN_SUPPORTED_LINES = 8;
const AMBIGUITY_SCORE_RATIO = 0.035;

interface IntegralImage {
  readonly width: number;
  readonly height: number;
  readonly sums: Float64Array;
}

interface Candidate {
  readonly x: number;
  readonly y: number;
  readonly side: number;
  readonly score: number;
}

function abortError(): DOMException {
  return new DOMException('Recognition localization was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw abortError();
  }
}

function validateGrayImage(gray: GrayImage): void {
  const { width, height, data } = gray;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Gray image dimensions must be positive integers.');
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new RangeError(`Gray image dimensions must be at most ${MAX_IMAGE_DIMENSION}px.`);
  }
  if (!(data instanceof Float32Array) || data.length !== width * height) {
    throw new RangeError('Gray image data length must equal width * height.');
  }
  for (const value of data) {
    if (!Number.isFinite(value) || value < 0 || value > 255) {
      throw new RangeError('Gray image samples must be finite values from 0 through 255.');
    }
  }
}

/** Block-average to a fixed ceiling. This is both a low-pass filter and a hard
 * cap on the number of locations examined by the coarse-to-fine search. */
function lowPass(gray: GrayImage): { readonly image: GrayImage; readonly scale: number } {
  const scale = Math.max(1, Math.ceil(Math.max(gray.width, gray.height) / MAX_SEARCH_DIMENSION));
  if (scale === 1) return { image: gray, scale };

  // Ignore at most scale-1 trailing pixels instead of padding a partial block;
  // every reduced-space square then maps to an unclamped in-bounds square.
  const width = Math.floor(gray.width / scale);
  const height = Math.floor(gray.height / scale);
  const data = new Float32Array(width * height);
  for (let oy = 0; oy < height; oy += 1) {
    const y0 = oy * scale;
    const y1 = y0 + scale;
    for (let ox = 0; ox < width; ox += 1) {
      const x0 = ox * scale;
      const x1 = x0 + scale;
      let sum = 0;
      for (let y = y0; y < y1; y += 1) {
        const offset = y * gray.width;
        for (let x = x0; x < x1; x += 1) sum += gray.data[offset + x] ?? 0;
      }
      data[oy * width + ox] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return { image: { data, width, height }, scale };
}

function makeIntegral(image: GrayImage): IntegralImage {
  const stride = image.width + 1;
  const sums = new Float64Array(stride * (image.height + 1));
  for (let y = 0; y < image.height; y += 1) {
    let row = 0;
    for (let x = 0; x < image.width; x += 1) {
      row += image.data[y * image.width + x] ?? 0;
      sums[(y + 1) * stride + x + 1] = (sums[y * stride + x + 1] ?? 0) + row;
    }
  }
  return { width: image.width, height: image.height, sums };
}

function rectangleMean(
  integral: IntegralImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const ax = Math.max(0, Math.min(integral.width, Math.floor(x0)));
  const ay = Math.max(0, Math.min(integral.height, Math.floor(y0)));
  const bx = Math.max(ax + 1, Math.min(integral.width, Math.ceil(x1)));
  const by = Math.max(ay + 1, Math.min(integral.height, Math.ceil(y1)));
  const stride = integral.width + 1;
  const sum =
    (integral.sums[by * stride + bx] ?? 0) -
    (integral.sums[ay * stride + bx] ?? 0) -
    (integral.sums[by * stride + ax] ?? 0) +
    (integral.sums[ay * stride + ax] ?? 0);
  return sum / ((bx - ax) * (by - ay));
}

function median4(a: number, b: number, c: number, d: number): number {
  const values = [a, b, c, d].sort((left, right) => left - right);
  return ((values[1] ?? 0) + (values[2] ?? 0)) / 2;
}

/** Estimate each square's background from four small interior-corner patches.
 * Chess pieces occupy the center most heavily, so this is less piece-sensitive
 * than averaging the whole square. */
function cellBackground(
  integral: IntegralImage,
  x: number,
  y: number,
  cell: number,
  insetFraction: number,
  patchFraction: number,
): number {
  const patch = Math.max(1, cell * patchFraction);
  const inset = cell * insetFraction;
  const far = cell - inset - patch;
  return median4(
    rectangleMean(integral, x + inset, y + inset, x + inset + patch, y + inset + patch),
    rectangleMean(integral, x + far, y + inset, x + far + patch, y + inset + patch),
    rectangleMean(integral, x + inset, y + far, x + inset + patch, y + far + patch),
    rectangleMean(integral, x + far, y + far, x + far + patch, y + far + patch),
  );
}

function checkerPatternScore(
  integral: IntegralImage,
  x: number,
  y: number,
  side: number,
  insetFraction: number,
  patchFraction: number,
): number {
  if (x < 0 || y < 0 || x + side > integral.width || y + side > integral.height) return -Infinity;
  const cell = side / 8;
  if (cell < 3) return -Infinity;

  const values = new Float64Array(64);
  let lightSum = 0;
  let darkSum = 0;
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const index = rank * 8 + file;
      const value = cellBackground(
        integral,
        x + file * cell,
        y + rank * cell,
        cell,
        insetFraction,
        patchFraction,
      );
      values[index] = value;
      if ((rank + file) % 2 === 0) lightSum += value;
      else darkSum += value;
    }
  }

  const lightMean = lightSum / 32;
  const darkMean = darkSum / 32;
  const contrast = lightMean - darkMean;
  // Printed chess diagrams have light a8/h1 squares. Requiring that sign also
  // rejects equally plausible one-square shifts instead of using abs(contrast).
  if (contrast < MIN_CONTRAST) return -Infinity;

  let residual = 0;
  let supportedRows = 0;
  let supportedFiles = 0;
  const supportFloor = contrast * 0.3;
  for (let rank = 0; rank < 8; rank += 1) {
    let signed = 0;
    for (let file = 0; file < 8; file += 1) {
      const value = values[rank * 8 + file] ?? 0;
      const expected = (rank + file) % 2 === 0 ? lightMean : darkMean;
      const delta = value - expected;
      residual += delta * delta;
      signed += ((rank + file) % 2 === 0 ? 1 : -1) * value;
    }
    if (signed / 4 >= supportFloor) supportedRows += 1;
  }
  for (let file = 0; file < 8; file += 1) {
    let signed = 0;
    for (let rank = 0; rank < 8; rank += 1) {
      const value = values[rank * 8 + file] ?? 0;
      signed += ((rank + file) % 2 === 0 ? 1 : -1) * value;
    }
    if (signed / 4 >= supportFloor) supportedFiles += 1;
  }
  if (supportedRows < MIN_SUPPORTED_LINES || supportedFiles < MIN_SUPPORTED_LINES) return -Infinity;

  const rms = Math.sqrt(residual / 64);
  const coverage = (supportedRows + supportedFiles) / 16;
  return (contrast / (rms + 6)) * coverage;
}

function candidateScore(integral: IntegralImage, x: number, y: number, side: number): number {
  return checkerPatternScore(integral, x, y, side, 0.12, 0.16);
}

function insertCandidate(candidates: Candidate[], candidate: Candidate, limit: number): void {
  if (!Number.isFinite(candidate.score)) return;
  let index = candidates.findIndex((current) => candidate.score > current.score);
  if (index < 0) index = candidates.length;
  candidates.splice(index, 0, candidate);
  if (candidates.length > limit) candidates.length = limit;
}

function insertCoarseCandidate(candidates: Candidate[], candidate: Candidate): void {
  if (!Number.isFinite(candidate.score)) return;
  const overlappingIndex = candidates.findIndex(
    (current) => intersectionOverUnion(current, candidate) >= 0.75,
  );
  if (overlappingIndex >= 0) {
    const overlapping = candidates[overlappingIndex];
    if (overlapping !== undefined && overlapping.score >= candidate.score) return;
    candidates.splice(overlappingIndex, 1);
  }
  insertCandidate(candidates, candidate, MAX_COARSE_CANDIDATES);
}

function intersectionOverUnion(a: Candidate, b: Candidate): number {
  const overlapWidth = Math.max(0, Math.min(a.x + a.side, b.x + b.side) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.side, b.y + b.side) - Math.max(a.y, b.y));
  const intersection = overlapWidth * overlapHeight;
  return intersection / (a.side * a.side + b.side * b.side - intersection);
}

function materiallyDifferent(a: Candidate, b: Candidate): boolean {
  const tolerance = Math.max(1.5, Math.min(a.side, b.side) / 32);
  return (
    Math.abs(a.x - b.x) > tolerance ||
    Math.abs(a.y - b.y) > tolerance ||
    Math.abs(a.side - b.side) > tolerance * 2
  );
}

function coarseSearch(integral: IntegralImage, minSide: number, signal?: AbortSignal): Candidate[] {
  const candidates: Candidate[] = [];
  const maximumSide = Math.min(integral.width, integral.height);
  let side = minSide;
  let work = 0;
  while (side <= maximumSide) {
    const integerSide = Math.min(maximumSide, Math.round(side));
    const step = Math.max(2, Math.round(integerSide / (8 * COARSE_POSITION_DIVISOR)));
    for (let y = 0; y + integerSide <= integral.height; y += step) {
      for (let x = 0; x + integerSide <= integral.width; x += step) {
        if ((work++ & 1023) === 0) throwIfAborted(signal);
        insertCoarseCandidate(candidates, {
          x,
          y,
          side: integerSide,
          score: candidateScore(integral, x, y, integerSide),
        });
      }
    }
    if (integerSide === maximumSide) break;
    side = Math.min(maximumSide, Math.max(integerSide + 1, side * COARSE_SCALE_FACTOR));
  }
  return candidates;
}

function refine(
  integral: IntegralImage,
  coarse: readonly Candidate[],
  signal?: AbortSignal,
): Candidate[] {
  const refined: Candidate[] = [];
  let work = 0;
  for (const seed of coarse) {
    const radius = Math.max(2, Math.ceil(seed.side / 16));
    const sizeRadius = Math.max(2, Math.ceil(seed.side / 12));
    for (
      let side = Math.max(24, seed.side - sizeRadius);
      side <= seed.side + sizeRadius;
      side += 1
    ) {
      if (side > integral.width || side > integral.height) continue;
      for (let y = seed.y - radius; y <= seed.y + radius; y += 1) {
        if (y < 0 || y + side > integral.height) continue;
        for (let x = seed.x - radius; x <= seed.x + radius; x += 1) {
          if (x < 0 || x + side > integral.width) continue;
          if ((work++ & 511) === 0) throwIfAborted(signal);
          insertCandidate(refined, { x, y, side, score: candidateScore(integral, x, y, side) }, 96);
        }
      }
    }
  }
  return refined;
}

function selectUnambiguous(candidates: readonly Candidate[]): Candidate[] {
  const selected: Candidate[] = [];
  const suppressed = new Set<number>();
  for (let index = 0; index < candidates.length; index += 1) {
    if (suppressed.has(index)) continue;
    const candidate = candidates[index];
    if (candidate === undefined || candidate.score < MIN_SCORE) continue;

    let ambiguous = false;
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
      const other = candidates[otherIndex];
      if (other === undefined) continue;
      const overlap = intersectionOverUnion(candidate, other);
      if (overlap < 0.72) continue;
      if (
        materiallyDifferent(candidate, other) &&
        (candidate.score - other.score) / candidate.score <= AMBIGUITY_SCORE_RATIO
      ) {
        ambiguous = true;
      }
      if (overlap >= 0.45) suppressed.add(otherIndex);
    }
    if (!ambiguous) selected.push(candidate);
    if (selected.length >= MAX_RESULTS) break;
  }
  return selected;
}

function gridLineScore(integral: IntegralImage, x: number, y: number, side: number): number {
  const cell = side / 8;
  const near = Math.max(1, cell * 0.04);
  const far = Math.max(near + 1, cell * 0.12);
  const spans = [
    [0.08, 0.32],
    [0.68, 0.92],
  ] as const;
  let score = 0;
  let samples = 0;
  for (let line = 1; line < 8; line += 1) {
    const verticalX = x + line * cell;
    const horizontalY = y + line * cell;
    for (let square = 0; square < 8; square += 1) {
      for (const [from, to] of spans) {
        const sampleY0 = y + (square + from) * cell;
        const sampleY1 = y + (square + to) * cell;
        const sampleX0 = x + (square + from) * cell;
        const sampleX1 = x + (square + to) * cell;
        score += Math.abs(
          rectangleMean(integral, verticalX - far, sampleY0, verticalX - near, sampleY1) -
            rectangleMean(integral, verticalX + near, sampleY0, verticalX + far, sampleY1),
        );
        score += Math.abs(
          rectangleMean(integral, sampleX0, horizontalY - far, sampleX1, horizontalY - near) -
            rectangleMean(integral, sampleX0, horizontalY + near, sampleX1, horizontalY + far),
        );
        samples += 2;
      }
    }
  }
  return score / samples;
}

function gridEdgeScore(gray: GrayImage, x: number, y: number, side: number): number {
  const cell = side / 8;
  const x0 = Math.ceil(x);
  const x1 = Math.floor(x + side);
  const y0 = Math.ceil(y);
  const y1 = Math.floor(y + side);
  let score = 0;
  let samples = 0;
  for (let line = 1; line < 8; line += 1) {
    const verticalX = Math.round(x + line * cell);
    const horizontalY = Math.round(y + line * cell);
    if (verticalX > 0 && verticalX < gray.width) {
      for (let sampleY = y0; sampleY < y1; sampleY += 2) {
        score += Math.abs(
          (gray.data[sampleY * gray.width + verticalX] ?? 0) -
            (gray.data[sampleY * gray.width + verticalX - 1] ?? 0),
        );
        samples += 1;
      }
    }
    if (horizontalY > 0 && horizontalY < gray.height) {
      for (let sampleX = x0; sampleX < x1; sampleX += 2) {
        score += Math.abs(
          (gray.data[horizontalY * gray.width + sampleX] ?? 0) -
            (gray.data[(horizontalY - 1) * gray.width + sampleX] ?? 0),
        );
        samples += 1;
      }
    }
  }
  return samples === 0 ? 0 : score / samples;
}

/** Recover pixel precision lost to the bounded low-pass image. This examines
 * only a scale-sized neighborhood around each already accepted pixel-only
 * candidate; it cannot introduce a new board or use classifier output. */
function refineAtNativeResolution(
  gray: GrayImage,
  candidates: readonly Candidate[],
  scale: number,
  signal?: AbortSignal,
): Candidate[] {
  if (scale === 1) return [...candidates];
  const integral = makeIntegral(gray);
  const refined: Candidate[] = [];
  let work = 0;
  for (const candidate of candidates) {
    const mapped = {
      x: candidate.x * scale,
      y: candidate.y * scale,
      side: candidate.side * scale,
      score: -Infinity,
    };
    let positionBest = mapped;
    const positionRadius = Math.min(32, scale * 3);
    for (let y = mapped.y - positionRadius; y <= mapped.y + positionRadius; y += 1) {
      for (let x = mapped.x - positionRadius; x <= mapped.x + positionRadius; x += 1) {
        if ((work++ & 255) === 0) throwIfAborted(signal);
        const score = checkerPatternScore(integral, x, y, mapped.side, 0.02, 0.08);
        if (score > positionBest.score) positionBest = { x, y, side: mapped.side, score };
      }
    }
    if (!Number.isFinite(positionBest.score)) continue;

    let best = mapped;
    for (let side = mapped.side - scale; side <= mapped.side + scale; side += 1) {
      for (let y = positionBest.y - 2; y <= positionBest.y + 2; y += 1) {
        for (let x = positionBest.x - 2; x <= positionBest.x + 2; x += 1) {
          if ((work++ & 255) === 0) throwIfAborted(signal);
          const checkerScore = candidateScore(integral, x, y, side);
          const completenessScore = checkerPatternScore(integral, x, y, side, 0.02, 0.08);
          const scored = {
            x,
            y,
            side,
            score:
              checkerScore === -Infinity || completenessScore === -Infinity
                ? -Infinity
                : checkerScore +
                  completenessScore * 4 +
                  gridLineScore(integral, x, y, side) / 10 +
                  gridEdgeScore(gray, x, y, side),
          };
          if (scored.score > best.score) best = scored;
        }
      }
    }
    if (Number.isFinite(best.score)) refined.push(best);
  }
  return refined;
}

/** Locate up to four complete axis-aligned 8x8 boards from pixels alone. */
export function locateBoards(gray: GrayImage, signal?: AbortSignal): readonly BoardCorners[] {
  throwIfAborted(signal);
  validateGrayImage(gray);
  if (gray.width < MIN_BOARD_DIMENSION || gray.height < MIN_BOARD_DIMENSION) return [];

  const lowPassResult = lowPass(gray);
  throwIfAborted(signal);
  const integral = makeIntegral(lowPassResult.image);
  const minSide = Math.max(24, Math.ceil(MIN_BOARD_DIMENSION / lowPassResult.scale));
  const coarse = coarseSearch(integral, minSide, signal);
  const refined = refine(integral, coarse, signal);
  throwIfAborted(signal);

  const native = refineAtNativeResolution(
    gray,
    selectUnambiguous(refined),
    lowPassResult.scale,
    signal,
  );
  throwIfAborted(signal);

  return native.map(({ x, y, side }) => {
    const x0 = x;
    const y0 = y;
    return {
      x0,
      y0,
      x1: x + side,
      y1: y + side,
    };
  });
}

function classifyWithAbort(
  classify: (corners: BoardCorners) => Promise<RecognitionResult>,
  corners: BoardCorners,
  signal?: AbortSignal,
): Promise<RecognitionResult> {
  throwIfAborted(signal);
  if (signal === undefined) return classify(corners);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void classify(corners)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
  });
}

/** Classify detector-selected geometry without confidence-based re-ranking.
 * Low-confidence reads are returned unchanged so the evaluation can report
 * honest abstention/reliability at FENShot's existing 0.7 threshold. */
export async function recognizeLocalized(
  gray: GrayImage,
  classify: (corners: BoardCorners) => Promise<RecognitionResult>,
  signal?: AbortSignal,
): Promise<readonly (RecognitionResult & { readonly corners: BoardCorners })[]> {
  const corners = locateBoards(gray, signal);
  const results: (RecognitionResult & { readonly corners: BoardCorners })[] = [];
  for (const boardCorners of corners) {
    throwIfAborted(signal);
    const result = await classifyWithAbort(classify, boardCorners, signal);
    throwIfAborted(signal);
    results.push({ ...result, corners: boardCorners });
  }
  return results;
}
