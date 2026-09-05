/** Observation-only scoring for the locked #34 corpus. No recognizer tuning here.
 * Placements enter the scorer but are never included in its returned artifact.
 */
export interface Corners {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MetricAnnotation {
  id: string;
  corners: Corners;
  renderedPlacement: string;
  orientation: 'white' | 'black' | 'ambiguous';
}

export interface MetricPrediction {
  corners: Corners;
  placement: string;
  minConfidence: number;
  meanConfidence: number;
  confidences: readonly number[];
  orientation: 'white' | 'black';
  orientationAmbiguous: boolean;
}

export const MATCH_IOU = 0.9;
/** Additional diagnostic, in fractions of a truth square; not a product gate. */
export const GRID_ERROR_SQUARES = 0.08;
export const RELIABILITY_FLOOR = 0.7;

function squares(placement: string): string[] {
  const ranks = placement.split('/');
  if (ranks.length !== 8 || !/^[prnbqkPRNBQK1-8/]+$/.test(placement)) {
    throw new Error('Invalid placement in measurement input');
  }
  const expanded = ranks.map((rank) =>
    Array.from(rank).flatMap((piece) =>
      /^[1-8]$/.test(piece) ? Array<string>(Number(piece)).fill('.') : [piece],
    ),
  );
  if (expanded.some((rank) => rank.length !== 8)) throw new Error('Invalid placement rank');
  return expanded.flat();
}

function validCorners(c: Corners): boolean {
  return [c.x0, c.y0, c.x1, c.y1].every(Number.isFinite) && c.x1 > c.x0 && c.y1 > c.y0;
}

export function rectangleIou(a: Corners, b: Corners): number {
  const overlap =
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return overlap / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - overlap);
}

function gridError(a: Corners, b: Corners): number {
  return Math.max(
    (Math.abs(a.x0 - b.x0) * 8) / (b.x1 - b.x0),
    (Math.abs(a.x1 - b.x1) * 8) / (b.x1 - b.x0),
    (Math.abs(a.y0 - b.y0) * 8) / (b.y1 - b.y0),
    (Math.abs(a.y1 - b.y1) * 8) / (b.y1 - b.y0),
  );
}

function compare(prediction: MetricPrediction, annotation: MetricAnnotation) {
  const actual = squares(prediction.placement);
  const expected = squares(annotation.renderedPlacement);
  const mismatchIndicesTopLeft = expected.flatMap((piece, index) =>
    actual[index] === piece ? [] : [index],
  );
  return {
    annotationId: annotation.id,
    iou: rectangleIou(prediction.corners, annotation.corners),
    gridErrorSquares: gridError(prediction.corners, annotation.corners),
    mismatchIndicesTopLeft,
    correctSquares: 64 - mismatchIndicesTopLeft.length,
    exact: mismatchIndicesTopLeft.length === 0,
    orientationCorrect:
      annotation.orientation === 'ambiguous'
        ? null
        : !prediction.orientationAmbiguous && prediction.orientation === annotation.orientation,
    expectedOrientationAmbiguous: annotation.orientation === 'ambiguous',
  };
}

/** Greedy one-to-one matching: decreasing IoU, then prediction/annotation index.
 * A below-threshold prediction is a false positive AND leaves the truth missed.
 * Oracle runs require one supplied board; detection fields are null throughout.
 */
export function measureInput(
  annotations: readonly MetricAnnotation[],
  predictions: readonly MetricPrediction[],
  input: { width: number; height: number; oracle: boolean },
) {
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    throw new Error('Invalid measurement dimensions');
  }
  if (input.oracle && (annotations.length !== 1 || predictions.length !== 1)) {
    throw new Error('Oracle measurement requires one annotation and one classification');
  }
  if (new Set(annotations.map((a) => a.id)).size !== annotations.length)
    throw new Error('Duplicate annotation id');
  for (const annotation of annotations) {
    if (!validCorners(annotation.corners)) throw new Error('Invalid annotation geometry');
    squares(annotation.renderedPlacement);
  }
  for (const prediction of predictions) {
    if (!validCorners(prediction.corners)) throw new Error('Invalid prediction geometry');
    if (
      prediction.confidences.length !== 64 ||
      ![prediction.minConfidence, prediction.meanConfidence, ...prediction.confidences].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1,
      )
    ) {
      throw new Error('Invalid confidence measurement');
    }
    const actualMin = Math.min(...prediction.confidences);
    const actualMean = prediction.confidences.reduce((sum, value) => sum + value, 0) / 64;
    if (
      Math.abs(actualMin - prediction.minConfidence) > 1e-6 ||
      Math.abs(actualMean - prediction.meanConfidence) > 1e-6
    ) {
      throw new Error('Contradictory confidence aggregates');
    }
    squares(prediction.placement);
  }
  const pairs = predictions
    .flatMap((prediction, p) =>
      annotations.map((annotation, a) => ({
        p,
        a,
        iou: rectangleIou(prediction.corners, annotation.corners),
      })),
    )
    .sort((a, b) => b.iou - a.iou || a.p - b.p || a.a - b.a);
  const matched = new Map<number, number>();
  const usedAnnotations = new Set<number>();
  for (const pair of pairs) {
    if (
      (input.oracle || pair.iou >= MATCH_IOU) &&
      !matched.has(pair.p) &&
      !usedAnnotations.has(pair.a)
    ) {
      matched.set(pair.p, pair.a);
      usedAnnotations.add(pair.a);
    }
  }
  const records = predictions.map((prediction, index) => {
    const annotationIndex = matched.get(index);
    const annotation = annotationIndex === undefined ? undefined : annotations[annotationIndex];
    const nearest = pairs.find((pair) => pair.p === index);
    const nearestAnnotation = nearest === undefined ? undefined : annotations[nearest.a];
    const comparison = annotation ? compare(prediction, annotation) : null;
    const reliable = prediction.minConfidence >= RELIABILITY_FLOOR;
    const duplicate =
      !input.oracle &&
      annotation === undefined &&
      pairs.some(
        (pair) => pair.p === index && pair.iou >= MATCH_IOU && usedAnnotations.has(pair.a),
      );
    return {
      index,
      corners: prediction.corners,
      inImage:
        prediction.corners.x0 >= 0 &&
        prediction.corners.y0 >= 0 &&
        prediction.corners.x1 <= input.width &&
        prediction.corners.y1 <= input.height,
      minConfidence: prediction.minConfidence,
      meanConfidence: prediction.meanConfidence,
      confidences: [...prediction.confidences],
      reliable,
      reliableWrong: reliable && !comparison?.exact,
      reliableWrongStudyPosition:
        reliable && (!comparison?.exact || comparison.orientationCorrect === false),
      orientation: prediction.orientation,
      orientationAmbiguous: prediction.orientationAmbiguous,
      matchedAnnotationId: annotation?.id ?? null,
      duplicate,
      comparison: comparison && {
        ...comparison,
        iou: input.oracle ? null : comparison.iou,
        gridErrorSquares: input.oracle ? null : comparison.gridErrorSquares,
      },
      // Diagnostic comparison only. It does NOT earn accuracy or detection credit.
      nearestTruth:
        input.oracle || !nearestAnnotation ? null : compare(prediction, nearestAnnotation),
    };
  });
  const sum = (predicate: (r: (typeof records)[number]) => boolean) =>
    records.filter(predicate).length;
  const correctSquares = records.reduce(
    (total, r) => total + (r.comparison?.correctSquares ?? 0),
    0,
  );
  const exactBoards = sum((r) => r.comparison?.exact === true);
  const identifiableOrientations = annotations.filter((a) => a.orientation !== 'ambiguous').length;
  return {
    oracle: input.oracle,
    expectedBoards: annotations.length,
    predictions: predictions.length,
    noBoard: predictions.length === 0,
    matchedBoards: input.oracle ? null : matched.size,
    missedBoards: input.oracle ? null : annotations.length - matched.size,
    falsePositiveBoards: input.oracle ? null : predictions.length - matched.size,
    duplicateBoards: input.oracle ? null : sum((r) => r.duplicate),
    detectionPrecision:
      input.oracle || predictions.length === 0 ? null : matched.size / predictions.length,
    detectionRecall:
      input.oracle || annotations.length === 0 ? null : matched.size / annotations.length,
    gridAlignedBoards: input.oracle
      ? null
      : sum(
          (r) =>
            r.comparison !== null &&
            (r.comparison.gridErrorSquares ?? Infinity) <= GRID_ERROR_SQUARES,
        ),
    exactBoards,
    exactBoardAccuracy: annotations.length === 0 ? null : exactBoards / annotations.length,
    correctSquares,
    expectedSquares: annotations.length * 64,
    squareAccuracy: annotations.length === 0 ? null : correctSquares / (annotations.length * 64),
    reliablePredictions: sum((r) => r.reliable),
    unreliablePredictions: sum((r) => !r.reliable),
    reliableExactBoards: sum((r) => r.reliable && r.comparison?.exact === true),
    reliableWrongBoards: sum((r) => r.reliableWrong),
    reliableWrongStudyPositions: sum((r) => r.reliableWrongStudyPosition),
    identifiableOrientations,
    correctOrientations: sum((r) => r.comparison?.orientationCorrect === true),
    ambiguousTruthBoards: annotations.length - identifiableOrientations,
    ambiguousPredictions: sum((r) => r.orientationAmbiguous),
    ambiguityAcknowledged: sum(
      (r) => r.comparison?.expectedOrientationAmbiguous === true && r.orientationAmbiguous,
    ),
    outOfImagePredictions: sum((r) => !r.inImage),
    records,
  };
}

export type InputMetrics = ReturnType<typeof measureInput>;
