import { expect, test } from '@playwright/test';
import {
  assessCandidateCase,
  assessCandidateObservation,
  candidateEvaluationContext,
  parseCandidateEvaluationMode,
  type RawCandidateObservation,
} from './localized.assessment';

const EXPECTED_PLACEMENT = '8/8/8/8/8/8/8/8';
const WRONG_PLACEMENT = '8/8/8/8/8/8/8/7K';

const valid: RawCandidateObservation = {
  session: 0,
  run: 0,
  phase: 'done',
  placement: EXPECTED_PLACEMENT,
  reliable: 'true',
  totalMs: '120',
  stageMs: '80',
  cold: 'true',
  version: 'upstream/candidate-v1',
};

test('candidate evaluation mode is explicit and fail-closed', () => {
  expect(parseCandidateEvaluationMode('measurement')).toBe('measurement');
  expect(parseCandidateEvaluationMode('qualification')).toBe('qualification');
  expect(() => parseCandidateEvaluationMode(undefined)).toThrow(/explicitly set/);
  expect(() => parseCandidateEvaluationMode('observe')).toThrow(/explicitly set/);
  expect(candidateEvaluationContext('measurement')).toEqual({
    mode: 'measurement',
    command: 'pnpm eval:recognition',
    reportSubdirectory: '',
  });
  expect(candidateEvaluationContext('qualification')).toEqual({
    mode: 'qualification',
    command: 'pnpm eval:recognition:qualify',
    reportSubdirectory: 'qualification',
  });
});

test('missing, NaN, and error protocol states fail infrastructure assessment', () => {
  const observation = assessCandidateObservation(
    {
      ...valid,
      placement: '',
      reliable: null,
      totalMs: '',
      stageMs: 'NaN',
      cold: 'yes',
      version: null,
    },
    EXPECTED_PLACEMENT,
    'upstream/candidate-v1',
  );
  expect(observation.infrastructureFailures).toEqual([
    'reliable-missing-or-invalid',
    'placement-missing-or-invalid',
    'total-ms-missing-or-invalid',
    'stage-ms-missing-or-invalid',
    'cold-start-missing-or-invalid',
    'recognizer-version-mismatch',
  ]);
  expect(
    assessCandidateObservation(
      { ...valid, phase: 'error', placement: null, reliable: null },
      EXPECTED_PLACEMENT,
      'upstream/candidate-v1',
    ).infrastructureFailures,
  ).toContain('recognizer-error');
  expect(
    assessCandidateObservation(
      { ...valid, version: 'other/candidate-v1' },
      EXPECTED_PLACEMENT,
      'upstream/candidate-v1',
    ).infrastructureFailures,
  ).toEqual(['recognizer-version-mismatch']);
});

test('the actual UI no-board contract is a safe measured abstention that does not qualify', () => {
  const observation = assessCandidateObservation(
    { ...valid, phase: 'no-board', placement: null, reliable: null },
    EXPECTED_PLACEMENT,
    'upstream/candidate-v1',
  );
  expect(observation.infrastructureFailures).toEqual([]);
  expect(observation.safetyFailures).toEqual([]);
  expect(observation.qualificationFailures).toEqual(['candidate-not-exact']);
  expect(
    assessCandidateObservation(
      { ...valid, phase: 'no-board', reliable: 'true' },
      EXPECTED_PLACEMENT,
      'upstream/candidate-v1',
    ).infrastructureFailures,
  ).toEqual(['no-board-reliable-present', 'no-board-placement-present']);
});

test('reliable wrong result fails safety and qualification', () => {
  const observation = assessCandidateObservation(
    { ...valid, placement: WRONG_PLACEMENT },
    EXPECTED_PLACEMENT,
    'upstream/candidate-v1',
  );
  expect(observation.safetyFailures).toEqual(['reliable-wrong']);
  expect(observation.qualificationFailures).toEqual(['candidate-not-exact']);
});

test('case assessment requires every run and the fresh-session cold sequence', () => {
  const first = assessCandidateObservation(valid, EXPECTED_PLACEMENT, 'upstream/candidate-v1');
  const second = assessCandidateObservation(
    { ...valid, run: 1, cold: 'false' },
    EXPECTED_PLACEMENT,
    'upstream/candidate-v1',
  );
  const observations = [first, second];
  expect(assessCandidateCase(observations, [], 1, 2)).toEqual({
    infrastructure: { status: 'PASS', failures: [] },
    safety: { status: 'PASS', failures: [] },
    qualification: { status: 'PASS', failures: [] },
  });
  expect(assessCandidateCase(observations.slice(0, 1), [], 1, 2).infrastructure).toEqual({
    status: 'FAIL',
    failures: ['observation-count-or-identity-invalid', 'session-0-run-1:missing'],
  });
  expect(assessCandidateCase([first, first], [], 1, 2).infrastructure).toEqual({
    status: 'FAIL',
    failures: ['observation-count-or-identity-invalid', 'session-0-run-1:missing'],
  });
  expect(
    assessCandidateCase(
      [
        assessCandidateObservation(
          { ...valid, cold: 'false' },
          EXPECTED_PLACEMENT,
          'upstream/candidate-v1',
        ),
        second,
      ],
      [],
      1,
      2,
    ).infrastructure.failures,
  ).toEqual(['session-0-run-0:cold-sequence-invalid']);
  const externalRequest = assessCandidateCase(observations, ['non-same-origin-request-1'], 1, 2);
  expect(externalRequest.infrastructure.status).toBe('FAIL');
  expect(externalRequest.qualification.status).toBe('FAIL');
});
