import { describe, expect, it } from 'vitest';

import { isFakeRecognizerScript } from './testHooks';

describe('isFakeRecognizerScript', () => {
  it('accepts a minimal valid script', () => {
    expect(isFakeRecognizerScript({ steps: [{ outcome: 'no-board' }] })).toBe(true);
  });

  it('accepts a fully populated valid script', () => {
    expect(
      isFakeRecognizerScript({
        version: 'v1',
        defaultDelayMs: 100,
        steps: [
          {
            delayMs: 50,
            phases: ['loading-model', 'recognizing'],
            outcome: 'board',
            placement: '8/8/8/8/8/8/8/8',
            confidences: new Array(64).fill(0.9),
            reliable: true,
            proposedOrientation: 'black',
            errorCode: 'timeout',
          },
        ],
      }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    42,
    'steps',
    {},
    { steps: [] },
    { steps: 'nope' },
    { version: 1, steps: [{ outcome: 'board' }] },
    { defaultDelayMs: 'slow', steps: [{ outcome: 'board' }] },
    { steps: [{ outcome: 'bogus' }] },
    { steps: [{ outcome: 'board', delayMs: 'fast' }] },
    { steps: [{ outcome: 'board', phases: ['bogus-phase'] }] },
    { steps: [{ outcome: 'board', confidences: ['not-a-number'] }] },
    { steps: [{ outcome: 'board', reliable: 'yes' }] },
    { steps: [{ outcome: 'board', proposedOrientation: 'sideways' }] },
    { steps: [{ outcome: 'board', errorCode: 'oops' }] },
    { steps: [{}] },
  ])('rejects malformed script %#', (candidate) => {
    expect(isFakeRecognizerScript(candidate)).toBe(false);
  });
});
