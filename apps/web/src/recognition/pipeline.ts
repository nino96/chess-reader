/**
 * Pure recognition core: bounded region -> fenshot detection/classification ->
 * the study contract's `RecognitionOutcome`. No worker globals, no ONNX
 * Runtime, no DOM canvas -- this module is exercised directly in Node/jsdom
 * with a fake classifier (see pipeline.test.ts) and again inside the worker
 * with the real ONNX classifier (see workerCore.ts).
 *
 * Orientation: `resolveOrientation` upstream can return either the as-read
 * placement or its 180-degree rotation depending on which reads more
 * "natural" pawn advance. The study contract requires `placement` to always
 * stay exactly as read (white-at-bottom of the *image*, not of chess
 * convention) so a user's manual flip is the only thing that ever changes it;
 * only `resolveOrientation(...).orientation` is used here, and its returned
 * `placement` is discarded.
 */
import {
  rgbaToGray,
  recognizeGray,
  resolveOrientation,
  type TileClassifier,
} from '@scoriiu/fenshot';

import type { BoardCornersPx, RecognitionOutcome } from '../study/contracts';

/** The pixel fields `runRecognition` needs; a structural subset of `CapturedRegion`. */
export interface RecognitionRegion {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Bounds mirrored from docs/architecture.md §8 / platform-limitations §5: a
 *  region must be large enough to plausibly contain a board and small enough
 *  to bound worker memory and inference time. */
export const MIN_REGION_DIMENSION_PX = 8;
export const MAX_REGION_DIMENSION_PX = 4096;

/** Throws a descriptive `Error` when `region` cannot possibly be valid RGBA
 *  pixel data. Never inspects pixel content, so it never logs image bytes. */
export function validateRegion(region: RecognitionRegion): void {
  const { width, height, data } = region;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`region dimensions must be integers, got ${String(width)}x${String(height)}`);
  }
  if (width < MIN_REGION_DIMENSION_PX || height < MIN_REGION_DIMENSION_PX) {
    throw new Error(
      `region dimensions must be at least ${String(MIN_REGION_DIMENSION_PX)}px, got ${String(width)}x${String(height)}`,
    );
  }
  if (width > MAX_REGION_DIMENSION_PX || height > MAX_REGION_DIMENSION_PX) {
    throw new Error(
      `region dimensions must be at most ${String(MAX_REGION_DIMENSION_PX)}px, got ${String(width)}x${String(height)}`,
    );
  }
  const expectedLength = width * height * 4;
  if (data.length !== expectedLength) {
    throw new Error(
      `region data length ${String(data.length)} does not match ${String(width)}x${String(height)} RGBA`,
    );
  }
}

/**
 * Detects and classifies a chessboard in `region`. `classify` is injected so
 * this stays platform-independent: the worker supplies a real ONNX
 * classifier, tests supply a scripted one.
 */
export async function runRecognition(
  region: RecognitionRegion,
  classify: TileClassifier,
): Promise<RecognitionOutcome> {
  validateRegion(region);
  const gray = rgbaToGray(region.data, region.width, region.height);
  const scan = await recognizeGray(gray, classify);
  if (!scan) {
    return { kind: 'no-board' };
  }
  const { orientation } = resolveOrientation(scan.placement);
  const corners: BoardCornersPx = {
    x0: scan.corners.x0,
    y0: scan.corners.y0,
    x1: scan.corners.x1,
    y1: scan.corners.y1,
  };
  return {
    kind: 'board',
    board: {
      placement: scan.placement,
      confidences: scan.confidences,
      minConfidence: scan.minConfidence,
      meanConfidence: scan.meanConfidence,
      reliable: scan.reliable,
      corners,
      proposedOrientation: orientation,
    },
  };
}
