import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createScriptedRecognizer, type FakeRecognizerScript } from './fakeRecognizer';

import type { RecognitionRequest } from '../study/contracts';

function makeRequest(requestId: number, width = 64, height = 64): RecognitionRequest {
  return {
    requestId,
    region: {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      sourceRect: { x: 0, y: 0, width, height },
      normalizedRect: { x: 0, y: 0, width: 1, height: 1 },
      locator: { format: 'pdf', pageIndex: 0 },
    },
  };
}

describe('createScriptedRecognizer: behaviors not covered by the shared contract suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is driven by a plain JSON-serializable script (Playwright addInitScript-safe)', () => {
    const script: FakeRecognizerScript = {
      version: 'v1',
      defaultDelayMs: 5,
      steps: [{ outcome: 'no-board' }],
    };
    const roundTripped = JSON.parse(JSON.stringify(script)) as FakeRecognizerScript;
    expect(() => createScriptedRecognizer(roundTripped)).not.toThrow();
  });

  it('repeats the last step for calls beyond the script length', async () => {
    const script: FakeRecognizerScript = {
      steps: [
        { outcome: 'no-board', delayMs: 1 },
        { outcome: 'board', delayMs: 1 },
      ],
    };
    const recognizer = createScriptedRecognizer(script, { now: () => Date.now() });

    const first = recognizer.recognize(makeRequest(1), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5);
    expect((await first).outcome.kind).toBe('no-board');

    const second = recognizer.recognize(makeRequest(2), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5);
    expect((await second).outcome.kind).toBe('board');

    // Third call: script only has 2 steps, so the last one (board) repeats.
    const third = recognizer.recognize(makeRequest(3), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5);
    expect((await third).outcome.kind).toBe('board');

    recognizer.dispose();
  });

  it('fills in sensible default confidences/corners for an unspecified board step', async () => {
    const recognizer = createScriptedRecognizer(
      { steps: [{ outcome: 'board', delayMs: 1 }] },
      { now: () => Date.now() },
    );
    const promise = recognizer.recognize(makeRequest(1, 40, 80), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5);
    const result = await promise;

    expect(result.outcome.kind).toBe('board');
    if (result.outcome.kind === 'board') {
      expect(result.outcome.board.confidences).toHaveLength(64);
      expect(result.outcome.board.reliable).toBe(true);
      expect(result.outcome.board.corners).toEqual({ x0: 0, y0: 0, x1: 40, y1: 80 });
      expect(result.outcome.board.proposedOrientation).toBe('white');
    }
    expect(result.timing.inferenceMs).toBe(1);
    recognizer.dispose();
  });

  it('throws when constructed with an empty steps array', () => {
    expect(() => createScriptedRecognizer({ steps: [] })).toThrow(/steps/);
  });
});
