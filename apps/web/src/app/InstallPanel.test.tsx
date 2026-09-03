import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InstallPanel } from './InstallPanel';

class FakeBeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;

  constructor(outcome: 'accepted' | 'dismissed') {
    super('beforeinstallprompt', { cancelable: true });
    this.prompt = vi.fn().mockResolvedValue(undefined);
    this.userChoice = Promise.resolve({ outcome, platform: 'web' });
  }
}

function fakeMatchMedia(standalone: boolean) {
  return (query: string): MediaQueryList =>
    ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }) as MediaQueryList;
}

describe('InstallPanel', () => {
  it('shows generic guidance and no button when not installed and no prompt captured', () => {
    render(
      <InstallPanel matchMedia={fakeMatchMedia(false)} installPromptTarget={new EventTarget()} />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Install' })).toBeVisible();
    expect(
      screen.getByText('Use your browser’s Install or Add to Home Screen option.', {
        exact: false,
      }),
    ).toBeVisible();
    expect(screen.queryByTestId('install-button')).not.toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeVisible();
  });

  it('shows an install button once beforeinstallprompt is captured and reports the outcome on click', async () => {
    const user = userEvent.setup();
    const target = new EventTarget();
    render(<InstallPanel matchMedia={fakeMatchMedia(false)} installPromptTarget={target} />);

    const event = new FakeBeforeInstallPromptEvent('accepted');
    act(() => {
      target.dispatchEvent(event);
    });

    const button = await screen.findByTestId('install-button');
    expect(button).toBeVisible();

    await user.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('install-outcome')).toHaveTextContent(
        'You accepted the install prompt.',
      );
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('install-button')).not.toBeInTheDocument();
  });

  it('shows the installed state when the display-mode probe reports standalone', () => {
    render(
      <InstallPanel matchMedia={fakeMatchMedia(true)} installPromptTarget={new EventTarget()} />,
    );

    expect(screen.getByText('Installed')).toBeVisible();
    expect(screen.getByText('Chess Reader is running as an installed app.')).toBeVisible();
    expect(screen.queryByTestId('install-button')).not.toBeInTheDocument();
  });

  it('tolerates a missing matchMedia capability by treating the app as not installed', () => {
    render(<InstallPanel installPromptTarget={new EventTarget()} />);
    expect(screen.getByText('Not installed')).toBeVisible();
  });
});
