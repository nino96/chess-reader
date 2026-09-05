import { isValidPlacement } from '../src/board/placement';

export const CANDIDATE_EVALUATION_MODES = ['measurement', 'qualification'] as const;

export type CandidateEvaluationMode = (typeof CANDIDATE_EVALUATION_MODES)[number];

export interface CandidateEvaluationContext {
  readonly mode: CandidateEvaluationMode;
  readonly command: 'pnpm eval:recognition' | 'pnpm eval:recognition:qualify';
  readonly reportSubdirectory: '' | 'qualification';
}

export interface RawCandidateObservation {
  readonly session: number;
  readonly run: number;
  readonly phase: string | null;
  readonly placement: string | null;
  readonly reliable: string | null;
  readonly totalMs: string | null;
  readonly stageMs: string | null;
  readonly cold: string | null;
  readonly version: string | null;
}

export interface CandidateObservation {
  readonly session: number;
  readonly run: number;
  readonly phase: 'done' | 'no-board' | 'error' | null;
  readonly exact: boolean;
  readonly reliable: boolean | null;
  readonly totalMs: number | null;
  readonly stageMs: number | null;
  readonly cold: boolean | null;
  readonly version: string | null;
  readonly infrastructureFailures: readonly string[];
  readonly safetyFailures: readonly string[];
  readonly qualificationFailures: readonly string[];
}

export interface CandidateCaseAssessment {
  readonly infrastructure: {
    readonly status: 'PASS' | 'FAIL';
    readonly failures: readonly string[];
  };
  readonly safety: { readonly status: 'PASS' | 'FAIL'; readonly failures: readonly string[] };
  readonly qualification: {
    readonly status: 'PASS' | 'FAIL';
    readonly failures: readonly string[];
  };
}

export function parseCandidateEvaluationMode(value: unknown): CandidateEvaluationMode {
  if (value === 'measurement' || value === 'qualification') return value;
  throw new Error(
    'Candidate evaluation mode must be explicitly set to measurement or qualification',
  );
}

export function candidateEvaluationContext(value: unknown): CandidateEvaluationContext {
  const mode = parseCandidateEvaluationMode(value);
  return mode === 'measurement'
    ? { mode, command: 'pnpm eval:recognition', reportSubdirectory: '' }
    : {
        mode,
        command: 'pnpm eval:recognition:qualify',
        reportSubdirectory: 'qualification',
      };
}

function parseBoolean(value: string | null, field: string, failures: string[]): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  failures.push(`${field}-missing-or-invalid`);
  return null;
}

function parseDuration(value: string | null, field: string, failures: string[]): number | null {
  if (value === null || value.trim() === '') {
    failures.push(`${field}-missing-or-invalid`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    failures.push(`${field}-missing-or-invalid`);
    return null;
  }
  return parsed;
}

export function assessCandidateObservation(
  raw: RawCandidateObservation,
  expectedPlacement: string,
  expectedVersion: string,
): CandidateObservation {
  const infrastructureFailures: string[] = [];
  const phase =
    raw.phase === 'done' || raw.phase === 'no-board' || raw.phase === 'error' ? raw.phase : null;
  if (phase === null) infrastructureFailures.push('phase-missing-or-invalid');
  if (phase === 'error') infrastructureFailures.push('recognizer-error');

  let reliable: boolean | null = null;
  if (phase === 'done') {
    reliable = parseBoolean(raw.reliable, 'reliable', infrastructureFailures);
    if (raw.placement === null || !isValidPlacement(raw.placement)) {
      infrastructureFailures.push('placement-missing-or-invalid');
    }
  } else if (phase === 'no-board') {
    if (raw.reliable !== null) infrastructureFailures.push('no-board-reliable-present');
    if (raw.placement !== null) infrastructureFailures.push('no-board-placement-present');
  }
  const totalMs = parseDuration(raw.totalMs, 'total-ms', infrastructureFailures);
  const stageMs = parseDuration(raw.stageMs, 'stage-ms', infrastructureFailures);
  const cold = parseBoolean(raw.cold, 'cold-start', infrastructureFailures);
  if (raw.version !== expectedVersion) {
    infrastructureFailures.push('recognizer-version-mismatch');
  }
  const exact = phase === 'done' && raw.placement === expectedPlacement;
  const safetyFailures = reliable === true && !exact ? ['reliable-wrong'] : [];
  const qualificationFailures = phase === 'done' && exact ? [] : ['candidate-not-exact'];

  return {
    session: raw.session,
    run: raw.run,
    phase,
    exact,
    reliable,
    totalMs,
    stageMs,
    cold,
    version: raw.version,
    infrastructureFailures,
    safetyFailures,
    qualificationFailures,
  };
}

function observationFailure(observation: CandidateObservation, reason: string): string {
  return `session-${String(observation.session)}-run-${String(observation.run)}:${reason}`;
}

export function assessCandidateCase(
  observations: readonly CandidateObservation[],
  harnessFailures: readonly string[],
  sessions = 3,
  runsPerSession = 2,
): CandidateCaseAssessment {
  const infrastructureFailures = [...harnessFailures];
  const safetyFailures: string[] = [];
  const qualificationFailures: string[] = [];
  const byKey = new Map(
    observations.map((observation) => [
      `${String(observation.session)}/${String(observation.run)}`,
      observation,
    ]),
  );

  if (observations.length !== sessions * runsPerSession || byKey.size !== observations.length) {
    infrastructureFailures.push('observation-count-or-identity-invalid');
  }
  for (const observation of observations) {
    for (const reason of observation.infrastructureFailures) {
      infrastructureFailures.push(observationFailure(observation, reason));
    }
    for (const reason of observation.safetyFailures) {
      safetyFailures.push(observationFailure(observation, reason));
    }
    for (const reason of observation.qualificationFailures) {
      qualificationFailures.push(observationFailure(observation, reason));
    }
    if (
      !Number.isInteger(observation.session) ||
      observation.session < 0 ||
      observation.session >= sessions ||
      !Number.isInteger(observation.run) ||
      observation.run < 0 ||
      observation.run >= runsPerSession
    ) {
      infrastructureFailures.push(observationFailure(observation, 'observation-identity-invalid'));
    } else if (observation.cold !== (observation.run === 0)) {
      infrastructureFailures.push(observationFailure(observation, 'cold-sequence-invalid'));
    }
  }
  for (let session = 0; session < sessions; session += 1) {
    for (let run = 0; run < runsPerSession; run += 1) {
      const observation = byKey.get(`${String(session)}/${String(run)}`);
      if (!observation) {
        infrastructureFailures.push(`session-${String(session)}-run-${String(run)}:missing`);
      }
    }
  }

  const combinedQualificationFailures = [
    ...infrastructureFailures,
    ...safetyFailures,
    ...qualificationFailures,
  ];
  return {
    infrastructure: {
      status: infrastructureFailures.length === 0 ? 'PASS' : 'FAIL',
      failures: infrastructureFailures,
    },
    safety: {
      status: safetyFailures.length === 0 ? 'PASS' : 'FAIL',
      failures: safetyFailures,
    },
    qualification: {
      status: combinedQualificationFailures.length === 0 ? 'PASS' : 'FAIL',
      failures: combinedQualificationFailures,
    },
  };
}
