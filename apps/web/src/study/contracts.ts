/**
 * Shared contracts for the issue #2 walking slice:
 *   PDF page -> manual rectangle selection -> bounded capture -> worker recognition
 *   -> floating editable board.
 *
 * These types are the only coupling between the reader, capture, recognition, and
 * board modules. Keep them free of DOM, React, PDF.js, ONNX, and fenshot types so
 * each module can be tested in isolation and replaced later behind an adapter.
 */

/** A rectangle in CSS pixels relative to the displayed page element's top-left corner. */
export interface DisplayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A rectangle normalized to the page's own coordinate space: every field is in
 * `[0, 1]`, measured from the page's top-left corner, with `y` growing downward.
 * This is the portable form that later issues persist (see docs/architecture.md §6).
 */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A rectangle in integer source pixels of a rendered page bitmap. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Zero-based page index inside the currently open PDF. Format-native; never reused for EPUB. */
export interface PdfPageLocator {
  readonly format: 'pdf';
  readonly pageIndex: number;
}

/**
 * Raw RGBA pixels captured from the selected region at a bounded resolution.
 * `data` is a `Uint8ClampedArray` of length `width * height * 4`, exactly like
 * `ImageData.data`, so it can be posted to a worker (transfer the underlying buffer).
 */
export interface CapturedRegion {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** Where in the source page bitmap the pixels came from. */
  readonly sourceRect: PixelRect;
  /** The same region in normalized page coordinates. */
  readonly normalizedRect: NormalizedRect;
  readonly locator: PdfPageLocator;
}

/**
 * Input handed to the recognizer. Identity fields let the caller reject a result
 * that arrives after the page or selection changed.
 */
export interface RecognitionRequest {
  /** Monotonic per-client id; results carrying an older id are discarded. */
  readonly requestId: number;
  readonly region: CapturedRegion;
}

/**
 * FEN piece-placement field (ranks 8..1 separated by "/", digits for empty runs),
 * always expressed as if white were at the bottom of the image.
 */
export type PlacementFen = string;

/** Board bounding box inside the captured region, in captured-region pixels. */
export interface BoardCornersPx {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface RecognizedBoard {
  readonly placement: PlacementFen;
  /** Per-square argmax confidence in A1..H8 rank-major order (64 entries, 0..1). */
  readonly confidences: readonly number[];
  readonly minConfidence: number;
  readonly meanConfidence: number;
  /** `false` when any square is below the recognizer's confidence floor. */
  readonly reliable: boolean;
  readonly corners: BoardCornersPx;
  /** Orientation proposed from pawn-advance direction; the user can still flip. */
  readonly proposedOrientation: BoardOrientation;
}

export type BoardOrientation = 'white' | 'black';

export type RecognitionOutcome =
  { readonly kind: 'board'; readonly board: RecognizedBoard } | { readonly kind: 'no-board' };

export interface RecognitionTiming {
  /** Wall-clock milliseconds from request post to result receipt, measured by the caller. */
  readonly totalMs: number;
  /** Milliseconds spent inside the worker on inference only, reported by the worker. */
  readonly inferenceMs: number;
  /** True when this request paid the model/runtime initialization cost. */
  readonly coldStart: boolean;
}

export interface RecognitionSuccess {
  readonly requestId: number;
  readonly outcome: RecognitionOutcome;
  readonly timing: RecognitionTiming;
  /** Recognizer implementation/model identity, e.g. "fenshot-0.1.4/chess-tiles-v2". */
  readonly recognizerVersion: string;
}

export type RecognitionErrorCode =
  'aborted' | 'timeout' | 'worker-unavailable' | 'asset-integrity' | 'runtime-failure';

export class RecognitionError extends Error {
  readonly code: RecognitionErrorCode;
  readonly requestId: number;

  constructor(code: RecognitionErrorCode, requestId: number, message: string) {
    super(message);
    this.name = 'RecognitionError';
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * The narrow recognizer contract the UI depends on. The production implementation
 * talks to a dedicated worker; tests and the browser E2E path use a deterministic
 * fake that can be slow, cancelled, or complete out of order.
 */
export interface DiagramRecognizer {
  readonly version: string;
  /**
   * Resolves with the outcome for `request.requestId`. Rejects with a
   * `RecognitionError` whose `code` is `'aborted'` when `signal` aborts first.
   * Implementations must never resolve a request after it was aborted.
   */
  recognize(
    request: RecognitionRequest,
    signal: AbortSignal,
    onPhase?: (phase: RecognitionPhase) => void,
  ): Promise<RecognitionSuccess>;
  /** Releases the worker and any pending requests (they reject with `'aborted'`). */
  dispose(): void;
}

/**
 * Recognizer progress phases reported through `onPhase` while a request is in
 * flight. `loading-model` is only reported for a cold start.
 */
export type RecognitionPhase = 'loading-model' | 'recognizing';

/** Bounded capture ceiling: the long edge of a captured region never exceeds this. */
export const MAX_CAPTURE_LONG_EDGE_PX = 1024;

/**
 * Coordinate tolerance from docs/evaluation.md §7: rectangles stay within 4 CSS px
 * or 1% of the displayed board size, whichever is larger.
 */
export const RECT_TOLERANCE_CSS_PX = 4;
export const RECT_TOLERANCE_FRACTION = 0.01;
