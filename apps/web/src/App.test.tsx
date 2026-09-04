import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./capabilities/CapabilityDiagnostics', () => ({
  CapabilityDiagnostics: () => <section data-testid="capability-diagnostics" />,
}));

vi.mock('./study/StudyWorkspace', () => ({
  StudyWorkspace: () => (
    <div data-testid="study-workspace">
      <section data-testid="pdf-reader">
        <h2>Book</h2>
      </section>
    </div>
  ),
}));

import { App } from './App';

describe('App', () => {
  it('composes the app shell with the study workspace, install, and capability diagnostics', () => {
    render(<App />);

    expect(screen.getByTestId('app-shell')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Chess Reader' })).toBeVisible();
    expect(screen.getByTestId('study-workspace')).toBeVisible();
    expect(screen.getByTestId('install-panel')).toBeVisible();
    expect(screen.getByTestId('capability-diagnostics')).toBeVisible();
  });

  it('keeps headings in document order: book, then install', () => {
    render(<App />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    const names = headings.map((heading) => heading.textContent);
    expect(names.indexOf('Book')).toBeLessThan(names.indexOf('Install'));
  });
});
