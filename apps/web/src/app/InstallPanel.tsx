import { useEffect, useState } from 'react';

/**
 * The `beforeinstallprompt` event is a non-standard extension that is not part of
 * `lib.dom.d.ts`. It is typed locally rather than by augmenting global event maps, since it
 * is only ever consumed through the injected `installPromptTarget` (a capability probe, not
 * a global browser assumption).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return typeof (event as { prompt?: unknown }).prompt === 'function';
}

export interface InstallPanelProps {
  /**
   * Injectable `matchMedia` probe, defaulting to `window.matchMedia`. Used only as a runtime
   * capability check (display-mode), never for browser-name detection.
   */
  matchMedia?: (query: string) => MediaQueryList;
  /**
   * Injectable target that dispatches `beforeinstallprompt`, defaulting to `window`.
   */
  installPromptTarget?: EventTarget;
}

function getDefaultMatchMedia(): ((query: string) => MediaQueryList) | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return undefined;
  }
  return window.matchMedia.bind(window);
}

function getDefaultInstallPromptTarget(): EventTarget | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function probeStandaloneDisplayMode(
  matchMediaFn: ((query: string) => MediaQueryList) | undefined,
): boolean {
  if (!matchMediaFn) {
    return false;
  }
  try {
    return matchMediaFn('(display-mode: standalone)').matches;
  } catch {
    // Some test/browser environments (e.g. jsdom without a polyfill) throw on matchMedia.
    // Treat that as "cannot determine installed state" rather than crashing the page.
    return false;
  }
}

function probeNavigatorStandalone(): boolean {
  return typeof navigator !== 'undefined' && navigator.standalone === true;
}

export function InstallPanel({ matchMedia, installPromptTarget }: InstallPanelProps) {
  const target = installPromptTarget ?? getDefaultInstallPromptTarget();
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | null>(null);

  useEffect(() => {
    if (!target) {
      return;
    }
    const handleBeforeInstallPrompt = (event: Event) => {
      if (!isBeforeInstallPromptEvent(event)) {
        return;
      }
      event.preventDefault();
      setDeferredEvent(event);
    };
    target.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      target.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [target]);

  const installed =
    probeStandaloneDisplayMode(matchMedia ?? getDefaultMatchMedia()) || probeNavigatorStandalone();

  const handleInstallClick = async () => {
    if (!deferredEvent) {
      return;
    }
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    setOutcome(choice.outcome);
    setDeferredEvent(null);
  };

  return (
    <section aria-labelledby="install-heading" data-testid="install-panel" className="panel">
      <h2 id="install-heading">Install</h2>
      <dl className="install-meta">
        <div>
          <dt>App</dt>
          <dd>Chess Reader</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{installed ? 'Installed' : 'Not installed'}</dd>
        </div>
      </dl>
      {installed ? (
        <p>Chess Reader is running as an installed app.</p>
      ) : outcome ? (
        <p role="status" data-testid="install-outcome">
          {outcome === 'accepted'
            ? 'You accepted the install prompt.'
            : 'You dismissed the install prompt.'}
        </p>
      ) : deferredEvent ? (
        <button
          type="button"
          data-testid="install-button"
          onClick={() => {
            void handleInstallClick();
          }}
        >
          Install Chess Reader
        </button>
      ) : (
        <p>Use your browser&rsquo;s Install or Add to Home Screen option.</p>
      )}
    </section>
  );
}
