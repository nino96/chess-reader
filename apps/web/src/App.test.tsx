import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./capabilities/CapabilityDiagnostics', () => ({
  CapabilityDiagnostics: () => <section data-testid="capability-diagnostics" />,
}));

import { App } from './App';

describe('App', () => {
  it('composes the app shell with library, install, and capability diagnostics sections', () => {
    render(<App />);

    expect(screen.getByTestId('app-shell')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Chess Reader' })).toBeVisible();
    expect(screen.getByTestId('library-empty')).toBeVisible();
    expect(screen.getByTestId('install-panel')).toBeVisible();
    expect(screen.getByTestId('capability-diagnostics')).toBeVisible();
  });

  it('keeps headings in document order: library, then install', () => {
    render(<App />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    const names = headings.map((heading) => heading.textContent);
    expect(names.indexOf('Library')).toBeLessThan(names.indexOf('Install'));
  });
});
