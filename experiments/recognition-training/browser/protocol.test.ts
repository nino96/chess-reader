import { describe, expect, it } from 'vitest';

import { isWorkerRequest, isWorkerResponse } from './protocol';

describe('recognition training browser protocol', () => {
  it('accepts the exact bounded initialize contract', () => {
    expect(
      isWorkerRequest({
        type: 'initialize',
        requestId: 1,
        modelUrl: '/model.onnx',
        modelSha256: 'a'.repeat(64),
        vectorsUrl: '/vectors.f32',
        vectorsSha256: 'b'.repeat(64),
        boardCount: 2,
      }),
    ).toBe(true);
    expect(
      isWorkerRequest({
        type: 'initialize',
        requestId: 1,
        modelUrl: '/model.onnx',
        modelSha256: 'a'.repeat(64),
        vectorsUrl: '/vectors.f32',
        vectorsSha256: 'b'.repeat(64),
        boardCount: 2,
        leaked: true,
      }),
    ).toBe(false);
  });

  it('rejects malformed and out-of-contract inference results', () => {
    const valid = {
      type: 'result',
      requestId: 2,
      boardIndexes: [0],
      classes: Array<number>(64).fill(0),
      confidences: Array<number>(64).fill(0.7),
      inferenceMs: [1],
    };
    expect(isWorkerResponse(valid)).toBe(true);
    expect(isWorkerResponse({ ...valid, leaked: true })).toBe(false);
    expect(isWorkerResponse({ ...valid, classes: Array<number>(63).fill(0) })).toBe(false);
    expect(isWorkerResponse({ ...valid, confidences: [...valid.confidences.slice(1), 1.1] })).toBe(
      false,
    );
  });

  it('validates exact bounded lifecycle responses', () => {
    const ready = {
      type: 'ready',
      requestId: 1,
      initializationMs: 1,
      modelSha256: 'a'.repeat(64),
      runtimeSha256: 'b'.repeat(64),
    };
    expect(isWorkerResponse(ready)).toBe(true);
    expect(isWorkerResponse({ ...ready, initializationMs: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isWorkerResponse({ ...ready, modelSha256: 'not-a-hash' })).toBe(false);
    expect(isWorkerResponse({ type: 'disposed', requestId: 1, leaked: true })).toBe(false);
    expect(
      isWorkerResponse({
        type: 'error',
        requestId: 1,
        code: 'runtime',
        message: 'x'.repeat(301),
      }),
    ).toBe(false);
  });

  it('requires finite nonnegative request ids and board indexes', () => {
    expect(isWorkerRequest({ type: 'run', requestId: 3, boardIndexes: [0, 1] })).toBe(true);
    expect(isWorkerRequest({ type: 'run', requestId: 3, boardIndexes: [-1] })).toBe(false);
    expect(isWorkerRequest({ type: 'cancel', requestId: Number.NaN })).toBe(false);
  });
});
