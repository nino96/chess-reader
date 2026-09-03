import { useCallback, useEffect, useId, useState } from 'react';

import './CapabilityDiagnostics.css';
import {
  CAPABILITY_IDS,
  CAPABILITY_LABELS,
  createBrowserProbeEnvironment,
  probeCapabilities,
  requestPersistentStorage,
  type CapabilityId,
  type CapabilityReport,
  type CapabilityStatus,
  type ProbeEnvironment,
} from './probes';

export interface CapabilityDiagnosticsProps {
  environment?: ProbeEnvironment;
  timeoutMs?: number;
}

type ReportsById = ReadonlyMap<CapabilityId, CapabilityReport>;

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  supported: 'Supported',
  unsupported: 'Unsupported',
  unknown: 'Unknown',
  error: 'Error',
};

const CHECKING_LABEL = 'Checking…';

function toReportMap(results: readonly CapabilityReport[]): ReportsById {
  const next = new Map<CapabilityId, CapabilityReport>();
  for (const report of results) {
    next.set(report.id, report);
  }
  return next;
}

export function CapabilityDiagnostics(props: CapabilityDiagnosticsProps = {}) {
  const { timeoutMs } = props;
  const [environment] = useState<ProbeEnvironment>(
    () => props.environment ?? createBrowserProbeEnvironment(),
  );
  const [reports, setReports] = useState<ReportsById>(new Map());
  const [isProbing, setIsProbing] = useState(true);
  const [runToken, setRunToken] = useState(0);
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const options =
      timeoutMs === undefined
        ? { signal: controller.signal }
        : { signal: controller.signal, timeoutMs };

    probeCapabilities(environment, options)
      .then((results) => {
        if (cancelled) {
          return;
        }
        setReports(toReportMap(results));
        setIsProbing(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setIsProbing(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `environment` is captured once via lazy state init.
  }, [runToken, timeoutMs]);

  const handleRerun = useCallback(() => {
    setIsProbing(true);
    setRunToken((token) => token + 1);
  }, []);

  const handleRequestPersist = useCallback(() => {
    requestPersistentStorage(environment)
      .then((report) => {
        setReports((prev) => {
          const next = new Map(prev);
          next.set(report.id, report);
          return next;
        });
      })
      .catch(() => undefined);
  }, [environment]);

  const supportedCount = [...reports.values()].filter(
    (report) => report.status === 'supported',
  ).length;
  const total = CAPABILITY_IDS.length;
  const summaryText = isProbing
    ? 'Checking capabilities…'
    : `${String(supportedCount)} of ${String(total)} capabilities supported`;

  const persistenceReport = reports.get('storage-persistence');
  const persistenceApiAvailable = environment.storage?.persist !== undefined;
  const canRequestPersist =
    persistenceApiAvailable &&
    persistenceReport !== undefined &&
    persistenceReport.status !== 'unknown';
  const requestPersistDisabled = isProbing || !canRequestPersist;

  return (
    <section
      className="capability-diagnostics"
      data-testid="capability-diagnostics"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>Local capability diagnostics</h2>
      <p>
        These checks run only in this browser. They never send book content, images, positions, or
        files anywhere; they only confirm which offline-readiness capabilities this browser actually
        supports.
      </p>
      <p className="capability-summary" aria-live="polite" data-testid="capability-summary">
        {summaryText}
      </p>
      <div className="capability-actions">
        <button type="button" data-testid="capability-rerun" onClick={handleRerun}>
          Re-run diagnostic
        </button>
        <button
          type="button"
          data-testid="capability-request-persist"
          onClick={handleRequestPersist}
          disabled={requestPersistDisabled}
        >
          Request persistent storage
        </button>
      </div>
      <ul className="capability-list" aria-busy={isProbing}>
        {CAPABILITY_IDS.map((id) => {
          const report = reports.get(id);
          const status: CapabilityStatus | 'probing' = report?.status ?? 'probing';
          const statusLabel = report ? STATUS_LABEL[report.status] : CHECKING_LABEL;
          const detail = report?.detail ?? 'Checking this capability…';
          const label = report?.label ?? CAPABILITY_LABELS[id];
          return (
            <li
              key={id}
              className="capability-row"
              data-testid={`capability-${id}`}
              data-status={status}
            >
              <span className="capability-label">{label}</span>
              <span className={`capability-badge capability-badge--${status}`}>{statusLabel}</span>
              <span className="capability-detail">{detail}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
