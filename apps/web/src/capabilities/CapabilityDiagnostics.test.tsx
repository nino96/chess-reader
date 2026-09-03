import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilityDiagnostics } from './CapabilityDiagnostics';
import { CAPABILITY_IDS, probeCapabilities, requestPersistentStorage } from './probes';
import type * as ProbesModule from './probes';
import type { CapabilityReport, ProbeEnvironment } from './probes';

vi.mock('./probes', async (importOriginal) => {
  const actual = await importOriginal<typeof ProbesModule>();
  return {
    ...actual,
    probeCapabilities: vi.fn(),
    requestPersistentStorage: vi.fn(),
  };
});

const probeCapabilitiesMock = vi.mocked(probeCapabilities);
const requestPersistentStorageMock = vi.mocked(requestPersistentStorage);

function fakeEnvironment(): ProbeEnvironment {
  return {
    indexedDB: undefined,
    storage: {
      getDirectory: undefined,
      estimate: undefined,
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(true),
    },
    maxTouchPoints: undefined,
    matchMedia: undefined,
    webAssembly: undefined,
    crossOriginIsolated: undefined,
    hasSharedArrayBuffer: false,
    createProbeWorker: undefined,
    now: () => 0,
  };
}

const ALL_SUPPORTED_REPORTS: readonly CapabilityReport[] = [
  {
    id: 'indexeddb',
    label: 'IndexedDB',
    status: 'supported',
    detail: 'IndexedDB open/write/delete succeeded.',
  },
  {
    id: 'opfs',
    label: 'Origin Private File System',
    status: 'supported',
    detail: 'OPFS root directory handle opened successfully.',
  },
  {
    id: 'workers',
    label: 'Module workers',
    status: 'supported',
    detail: 'Module worker round-trip succeeded in 5 ms.',
  },
  {
    id: 'webassembly',
    label: 'WebAssembly',
    status: 'supported',
    detail: 'WebAssembly validation and instantiation succeeded.',
  },
  {
    id: 'storage-estimate',
    label: 'Storage estimate',
    status: 'supported',
    detail: 'Usage 1.2 MB of 58.4 GB estimated quota.',
  },
  {
    id: 'storage-persistence',
    label: 'Storage persistence',
    status: 'unsupported',
    detail: 'Best-effort storage; the browser may evict data under pressure.',
  },
  {
    id: 'touch',
    label: 'Touch input',
    status: 'unsupported',
    detail: 'No touch or coarse pointer input was detected; this is informational only.',
  },
  {
    id: 'cross-origin-isolation',
    label: 'Cross-origin isolation',
    status: 'unknown',
    detail: 'This browser does not report cross-origin isolation status.',
  },
];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  probeCapabilitiesMock.mockReset();
  requestPersistentStorageMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CapabilityDiagnostics', () => {
  it('renders one row per capability with the expected test ids and statuses', async () => {
    probeCapabilitiesMock.mockResolvedValueOnce(ALL_SUPPORTED_REPORTS);
    render(<CapabilityDiagnostics environment={fakeEnvironment()} />);

    await screen.findByText('5 of 8 capabilities supported');

    expect(CAPABILITY_IDS).toHaveLength(8);
    for (const report of ALL_SUPPORTED_REPORTS) {
      const row = screen.getByTestId(`capability-${report.id}`);
      expect(row).toHaveAttribute('data-status', report.status);
      expect(row).toHaveTextContent(report.detail);
    }
  });

  it('shows a checking summary while the initial probe run is in flight', () => {
    const deferred = createDeferred<readonly CapabilityReport[]>();
    probeCapabilitiesMock.mockReturnValueOnce(deferred.promise);
    render(<CapabilityDiagnostics environment={fakeEnvironment()} />);

    expect(screen.getByTestId('capability-summary')).toHaveTextContent('Checking capabilities…');
    expect(screen.getByTestId('capability-indexeddb')).toHaveAttribute('data-status', 'probing');
  });

  it('re-runs the probe when the re-run button is clicked', async () => {
    const user = userEvent.setup();
    probeCapabilitiesMock.mockResolvedValueOnce(ALL_SUPPORTED_REPORTS);
    render(<CapabilityDiagnostics environment={fakeEnvironment()} />);
    await screen.findByText('5 of 8 capabilities supported');

    const secondRun: readonly CapabilityReport[] = ALL_SUPPORTED_REPORTS.map((report) =>
      report.id === 'storage-persistence' ? { ...report, status: 'supported' as const } : report,
    );
    probeCapabilitiesMock.mockResolvedValueOnce(secondRun);

    await user.click(screen.getByTestId('capability-rerun'));

    await screen.findByText('6 of 8 capabilities supported');
    expect(probeCapabilitiesMock).toHaveBeenCalledTimes(2);
  });

  it('never applies a stale first run that resolves after a re-run', async () => {
    const user = userEvent.setup();
    const first = createDeferred<readonly CapabilityReport[]>();
    const second = createDeferred<readonly CapabilityReport[]>();
    probeCapabilitiesMock.mockReturnValueOnce(first.promise);
    render(<CapabilityDiagnostics environment={fakeEnvironment()} />);

    probeCapabilitiesMock.mockReturnValueOnce(second.promise);
    await user.click(screen.getByTestId('capability-rerun'));

    const secondReports = ALL_SUPPORTED_REPORTS.map((report) =>
      report.id === 'indexeddb' ? { ...report, detail: 'from the second run' } : report,
    );
    second.resolve(secondReports);
    await screen.findByText('from the second run');

    const staleReports = ALL_SUPPORTED_REPORTS.map((report) =>
      report.id === 'indexeddb' ? { ...report, detail: 'from the stale first run' } : report,
    );
    first.resolve(staleReports);

    // Give any (incorrect) stale update a chance to land, then assert it did not.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('from the stale first run')).not.toBeInTheDocument();
    expect(screen.getByTestId('capability-indexeddb')).toHaveTextContent('from the second run');
  });

  it('does not throw or warn when unmounted while probing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deferred = createDeferred<readonly CapabilityReport[]>();
    probeCapabilitiesMock.mockReturnValueOnce(deferred.promise);

    const { unmount } = render(<CapabilityDiagnostics environment={fakeEnvironment()} />);
    expect(() => {
      unmount();
    }).not.toThrow();

    deferred.resolve(ALL_SUPPORTED_REPORTS);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('updates the persistence row after requesting persistent storage', async () => {
    const user = userEvent.setup();
    probeCapabilitiesMock.mockResolvedValueOnce(ALL_SUPPORTED_REPORTS);
    requestPersistentStorageMock.mockResolvedValueOnce({
      id: 'storage-persistence',
      label: 'Storage persistence',
      status: 'supported',
      detail: 'Persistent storage granted.',
    });

    render(<CapabilityDiagnostics environment={fakeEnvironment()} />);
    await screen.findByText('5 of 8 capabilities supported');

    const persistButton = screen.getByTestId('capability-request-persist');
    expect(persistButton).toBeEnabled();
    await user.click(persistButton);

    await waitFor(() => {
      expect(screen.getByTestId('capability-storage-persistence')).toHaveAttribute(
        'data-status',
        'supported',
      );
    });
    expect(screen.getByTestId('capability-storage-persistence')).toHaveTextContent(
      'Persistent storage granted.',
    );
  });

  it('disables the persist button while probing and when the API is unavailable', async () => {
    const deferred = createDeferred<readonly CapabilityReport[]>();
    probeCapabilitiesMock.mockReturnValueOnce(deferred.promise);
    const env = fakeEnvironment();
    render(<CapabilityDiagnostics environment={env} />);
    expect(screen.getByTestId('capability-request-persist')).toBeDisabled();

    deferred.resolve(ALL_SUPPORTED_REPORTS);
    await screen.findByText('5 of 8 capabilities supported');
    expect(screen.getByTestId('capability-request-persist')).toBeEnabled();
  });

  it('keeps the persist button disabled when the environment has no persist API', async () => {
    probeCapabilitiesMock.mockResolvedValueOnce(ALL_SUPPORTED_REPORTS);
    const env: ProbeEnvironment = {
      ...fakeEnvironment(),
      storage: {
        getDirectory: undefined,
        estimate: undefined,
        persisted: undefined,
        persist: undefined,
      },
    };
    render(<CapabilityDiagnostics environment={env} />);
    await screen.findByText('5 of 8 capabilities supported');
    expect(screen.getByTestId('capability-request-persist')).toBeDisabled();
  });
});
