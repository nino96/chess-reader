import { describe, expect, it } from 'vitest';

import { measureInput, type MetricAnnotation, type MetricPrediction } from '../src/corpus-metrics';

const placement = '4k3/8/8/8/8/8/8/4K3';
const truth: MetricAnnotation = {
  id: 'one',
  corners: { x0: 0, y0: 0, x1: 400, y1: 400 },
  renderedPlacement: placement,
  orientation: 'white',
};
const prediction: MetricPrediction = {
  corners: truth.corners,
  placement,
  minConfidence: 0.95,
  meanConfidence: 0.95,
  confidences: Array<number>(64).fill(0.95),
  orientation: 'white',
  orientationAmbiguous: false,
};
const input = { width: 800, height: 800, oracle: false };

describe('corpus observation accounting', () => {
  it('never credits oracle geometry as detection or alignment evidence', () => {
    const result = measureInput([truth], [prediction], { ...input, oracle: true });
    expect(result.exactBoards).toBe(1);
    expect(result.squareAccuracy).toBe(1);
    expect(result.matchedBoards).toBeNull();
    expect(result.detectionPrecision).toBeNull();
    expect(result.detectionRecall).toBeNull();
    expect(result.gridAlignedBoards).toBeNull();
    expect(result.records[0]?.comparison?.iou).toBeNull();
    expect(result.records[0]?.nearestTruth).toBeNull();
  });

  it('keeps missed boards in square and board denominators on a multi-board page', () => {
    const second = { ...truth, id: 'two', corners: { x0: 400, y0: 400, x1: 800, y1: 800 } };
    const result = measureInput([truth, second], [prediction], input);
    expect(result).toMatchObject({
      expectedBoards: 2,
      matchedBoards: 1,
      missedBoards: 1,
      exactBoards: 1,
      exactBoardAccuracy: 0.5,
      squareAccuracy: 0.5,
      detectionRecall: 0.5,
    });
    const missed = measureInput([truth, second], [], input);
    expect(missed).toMatchObject({
      noBoard: true,
      missedBoards: 2,
      squareAccuracy: 0,
      exactBoardAccuracy: 0,
      detectionPrecision: null,
    });
  });

  it('matches decreasing IoU deterministically and counts duplicate predictions as false positives', () => {
    const shifted = { ...prediction, corners: { x0: 2, y0: 2, x1: 402, y1: 402 } };
    const result = measureInput([truth], [shifted, prediction], input);
    expect(result).toMatchObject({
      matchedBoards: 1,
      duplicateBoards: 1,
      falsePositiveBoards: 1,
      detectionPrecision: 0.5,
      exactBoards: 1,
      reliableWrongBoards: 1,
    });
    expect(result.records[0]?.duplicate).toBe(true);
    expect(result.records[1]?.matchedAnnotationId).toBe('one');
  });

  it('retains external and wrong boxes without allowing nearest-truth classification to inflate accuracy', () => {
    const result = measureInput(
      [truth],
      [{ ...prediction, corners: { x0: -100, y0: 0, x1: 300, y1: 400 } }],
      input,
    );
    expect(result).toMatchObject({
      matchedBoards: 0,
      missedBoards: 1,
      falsePositiveBoards: 1,
      outOfImagePredictions: 1,
      exactBoards: 0,
      correctSquares: 0,
      reliableWrongBoards: 1,
    });
    expect(result.records[0]?.nearestTruth?.exact).toBe(true);
    expect(result.records[0]?.comparison).toBeNull();
  });

  it('distinguishes IoU detection from tighter grid alignment and wrong-square confidence', () => {
    const result = measureInput(
      [truth],
      [
        {
          ...prediction,
          placement: '8/8/8/8/8/8/8/4K3',
          corners: { x0: 10, y0: 0, x1: 410, y1: 400 },
        },
      ],
      input,
    );
    expect(result).toMatchObject({
      matchedBoards: 1,
      gridAlignedBoards: 0,
      exactBoards: 0,
      correctSquares: 63,
      reliableWrongBoards: 1,
    });
    expect(result.records[0]?.comparison?.mismatchIndicesTopLeft).toEqual([4]);
  });

  it('counts every output on no-complete-board negatives and partials as a false positive', () => {
    expect(measureInput([], [prediction], input)).toMatchObject({
      expectedBoards: 0,
      falsePositiveBoards: 1,
      reliableWrongBoards: 1,
      exactBoardAccuracy: null,
      squareAccuracy: null,
    });
    expect(measureInput([], [], input)).toMatchObject({
      falsePositiveBoards: 0,
      noBoard: true,
      reliableWrongBoards: 0,
    });
  });

  it('separates orientation ambiguity and mistakes from image-relative classification', () => {
    expect(measureInput([truth], [{ ...prediction, orientation: 'black' }], input)).toMatchObject({
      exactBoards: 1,
      correctOrientations: 0,
      identifiableOrientations: 1,
      reliableWrongBoards: 0,
      reliableWrongStudyPositions: 1,
    });
    expect(
      measureInput(
        [{ ...truth, orientation: 'ambiguous' }],
        [{ ...prediction, orientationAmbiguous: true }],
        input,
      ),
    ).toMatchObject({
      exactBoards: 1,
      identifiableOrientations: 0,
      ambiguousTruthBoards: 1,
      ambiguityAcknowledged: 1,
    });
    expect(
      measureInput([truth], [{ ...prediction, orientationAmbiguous: true }], input)
        .correctOrientations,
    ).toBe(0);
  });

  it('scores a black-oriented rendered placement before orientation canonicalization', () => {
    const rotated = '3K4/8/8/8/8/8/8/3k4';
    const annotation = { ...truth, orientation: 'black' as const, renderedPlacement: rotated };
    expect(
      measureInput(
        [annotation],
        [{ ...prediction, placement: rotated, orientation: 'black' }],
        input,
      ),
    ).toMatchObject({ exactBoards: 1, correctOrientations: 1, reliableWrongStudyPositions: 0 });
    expect(
      measureInput([annotation], [{ ...prediction, orientation: 'black' }], input),
    ).toMatchObject({ exactBoards: 0, correctOrientations: 1, reliableWrongStudyPositions: 1 });
  });

  it('retains unreliable incorrect predictions and uses the unchanged 0.7 floor', () => {
    const wrong = {
      ...prediction,
      placement: '8/8/8/8/8/8/8/8',
      minConfidence: 0.699,
      meanConfidence: 0.699,
      confidences: Array<number>(64).fill(0.699),
    };
    expect(measureInput([truth], [wrong], input)).toMatchObject({
      unreliablePredictions: 1,
      reliableWrongBoards: 0,
      correctSquares: 62,
    });
    expect(
      measureInput(
        [truth],
        [
          {
            ...wrong,
            minConfidence: 0.7,
            meanConfidence: 0.7,
            confidences: Array<number>(64).fill(0.7),
          },
        ],
        input,
      ).reliableWrongBoards,
    ).toBe(1);
  });

  it('rejects malformed evidence rather than silently counting it as recognition abstention', () => {
    expect(() => measureInput([truth], [{ ...prediction, placement: '8/8' }], input)).toThrow();
    expect(() => measureInput([truth], [{ ...prediction, meanConfidence: NaN }], input)).toThrow();
    expect(() => measureInput([truth], [{ ...prediction, confidences: [] }], input)).toThrow();
    expect(() => measureInput([truth], [{ ...prediction, minConfidence: 0.7 }], input)).toThrow(
      'Contradictory',
    );
    expect(() => measureInput([truth, truth], [prediction], input)).toThrow();
    expect(() => measureInput([truth], [], { ...input, oracle: true })).toThrow();
    expect(() => measureInput([truth], [prediction], { ...input, width: 0 })).toThrow();
  });

  it('never emits placements in its raw metrics artifact', () => {
    const result = JSON.stringify(measureInput([truth], [prediction], input));
    expect(result).not.toContain(placement);
    expect(result).not.toContain('renderedPlacement');
  });
});
