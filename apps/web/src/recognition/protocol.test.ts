import { describe, expect, it } from 'vitest';

import { isWorkerRequest, isWorkerResponse } from './protocol';

function validBoard() {
  return {
    kind: 'board' as const,
    board: {
      placement: '8/8/8/8/8/8/8/8',
      confidences: new Array(64).fill(0.9) as number[],
      minConfidence: 0.9,
      meanConfidence: 0.9,
      reliable: true,
      corners: { x0: 0, y0: 0, x1: 100, y1: 100 },
      proposedOrientation: 'white' as const,
    },
  };
}

describe('isWorkerRequest', () => {
  it('accepts a valid recognize message', () => {
    expect(
      isWorkerRequest({
        type: 'recognize',
        requestId: 1,
        width: 10,
        height: 10,
        data: new Uint8ClampedArray(400),
      }),
    ).toBe(true);
  });

  it('accepts a valid cancel message', () => {
    expect(isWorkerRequest({ type: 'cancel', requestId: 1 })).toBe(true);
  });

  it.each([
    null,
    undefined,
    42,
    'recognize',
    {},
    { type: 'recognize' },
    { type: 'recognize', requestId: 1, width: 10, height: 10 },
    { type: 'recognize', requestId: 1, width: 10, height: 10, data: [1, 2, 3] },
    { type: 'recognize', requestId: 'one', width: 10, height: 10, data: new Uint8ClampedArray(4) },
    {
      type: 'recognize',
      requestId: 1,
      width: Number.NaN,
      height: 10,
      data: new Uint8ClampedArray(4),
    },
    { type: 'cancel' },
    { type: 'cancel', requestId: 'x' },
    { type: 'unknown', requestId: 1 },
  ])('rejects malformed message %#', (candidate) => {
    expect(isWorkerRequest(candidate)).toBe(false);
  });
});

describe('isWorkerResponse', () => {
  it('accepts a valid phase message', () => {
    expect(isWorkerResponse({ type: 'phase', requestId: 1, phase: 'loading-model' })).toBe(true);
    expect(isWorkerResponse({ type: 'phase', requestId: 1, phase: 'recognizing' })).toBe(true);
  });

  it('accepts a valid no-board result message', () => {
    expect(
      isWorkerResponse({
        type: 'result',
        requestId: 1,
        outcome: { kind: 'no-board' },
        inferenceMs: 12,
        coldStart: false,
        recognizerVersion: 'v1',
      }),
    ).toBe(true);
  });

  it('accepts a valid board result message', () => {
    expect(
      isWorkerResponse({
        type: 'result',
        requestId: 1,
        outcome: validBoard(),
        inferenceMs: 12,
        coldStart: true,
        recognizerVersion: 'v1',
      }),
    ).toBe(true);
  });

  it('accepts a valid error message', () => {
    expect(
      isWorkerResponse({ type: 'error', requestId: 1, code: 'timeout', message: 'nope' }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    42,
    {},
    { type: 'phase', requestId: 1, phase: 'bogus' },
    { type: 'phase', requestId: 'x', phase: 'recognizing' },
    {
      type: 'result',
      requestId: 1,
      outcome: { kind: 'bogus' },
      inferenceMs: 1,
      coldStart: false,
      recognizerVersion: 'v1',
    },
    {
      type: 'result',
      requestId: 1,
      outcome: { kind: 'no-board' },
      inferenceMs: 1,
      coldStart: false,
    },
    {
      type: 'result',
      requestId: 1,
      outcome: { kind: 'board', board: { ...validBoard().board, confidences: [1, 2] } },
      inferenceMs: 1,
      coldStart: false,
      recognizerVersion: 'v1',
    },
    {
      type: 'result',
      requestId: 1,
      outcome: { kind: 'board', board: { ...validBoard().board, proposedOrientation: 'sideways' } },
      inferenceMs: 1,
      coldStart: false,
      recognizerVersion: 'v1',
    },
    { type: 'error', requestId: 1, code: 'bogus-code', message: 'nope' },
    { type: 'error', requestId: 1, code: 'timeout' },
    { type: 'unknown', requestId: 1 },
  ])('rejects malformed message %#', (candidate) => {
    expect(isWorkerResponse(candidate)).toBe(false);
  });
});
