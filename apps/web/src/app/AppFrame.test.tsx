import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppFrame } from './AppFrame';

function renderFrame() {
  return render(
    <AppFrame>
      <section aria-labelledby="a-heading">
        <h2 id="a-heading">Section A</h2>
        <p>content</p>
      </section>
      <section aria-labelledby="b-heading">
        <h2 id="b-heading">Section B</h2>
        <p>content</p>
      </section>
    </AppFrame>,
  );
}

describe('AppFrame', () => {
  it('renders the banner, main, and contentinfo landmarks with a single h1', () => {
    renderFrame();

    expect(screen.getByRole('banner')).toBeVisible();
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('contentinfo')).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Chess Reader' })).toBeVisible();
  });

  it('orders headings h1 then h2s in document order', () => {
    renderFrame();

    const headings = screen.getAllByRole('heading');
    expect(headings.map((heading) => heading.tagName)).toEqual(['H1', 'H2', 'H2']);
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Chess Reader',
      'Section A',
      'Section B',
    ]);
  });

  it('wraps everything in the app shell test hook', () => {
    renderFrame();
    expect(screen.getByTestId('app-shell')).toBeVisible();
    expect(screen.getByTestId('app-header')).toBeVisible();
  });

  it('makes the skip link the first tab stop and moves focus to main on activation', async () => {
    const user = userEvent.setup();
    renderFrame();

    await user.tab();
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skipLink).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('shows build info in the footer using Vite mode and a version fallback', () => {
    renderFrame();
    const footer = screen.getByTestId('app-footer');
    expect(footer.textContent).toContain('test');
    expect(footer.textContent).toMatch(/v(dev|\S+)/);
  });
});
