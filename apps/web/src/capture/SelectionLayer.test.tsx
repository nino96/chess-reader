import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectionLayer } from './SelectionLayer';

const displaySize = { width: 400, height: 300 };

function mockBoundingRect(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: displaySize.width,
    bottom: displaySize.height,
    width: displaySize.width,
    height: displaySize.height,
    toJSON: () => undefined,
  });
}

beforeEach(() => {
  mockBoundingRect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function pointerDown(target: Element, x: number, y: number): void {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, pointerId: 1 });
}
function pointerMove(target: Element, x: number, y: number): void {
  fireEvent.pointerMove(target, { clientX: x, clientY: y, pointerId: 1 });
}
function pointerUp(target: Element, x: number, y: number): void {
  fireEvent.pointerUp(target, { clientX: x, clientY: y, pointerId: 1 });
}

describe('SelectionLayer inactive', () => {
  it('has pointer-events none behavior and never calls onSelect', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active={false} displaySize={displaySize} onSelect={onSelect} />);

    const layer = screen.getByTestId('selection-layer');
    expect(layer).toHaveAttribute('data-active', 'false');
    expect(screen.queryByTestId('selection-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-rect')).not.toBeInTheDocument();

    pointerDown(layer, 10, 10);
    pointerMove(layer, 100, 100);
    pointerUp(layer, 100, 100);

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('SelectionLayer pointer drag', () => {
  it('yields the normalized rect for a bottom-right drag', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active displaySize={displaySize} onSelect={onSelect} />);
    const layer = screen.getByTestId('selection-layer');
    expect(layer).toHaveAttribute('data-active', 'true');

    pointerDown(layer, 20, 30);
    pointerMove(layer, 120, 150);
    pointerUp(layer, 120, 150);

    expect(onSelect).toHaveBeenCalledWith({ x: 20, y: 30, width: 100, height: 120 });
  });

  it('yields the normalized rect for a top-left drag (reversed direction)', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active displaySize={displaySize} onSelect={onSelect} />);
    const layer = screen.getByTestId('selection-layer');

    pointerDown(layer, 200, 200);
    pointerMove(layer, 100, 120);
    pointerUp(layer, 100, 120);

    expect(onSelect).toHaveBeenCalledWith({ x: 100, y: 120, width: 100, height: 80 });
  });

  it('ignores a drag smaller than the minimum selection size', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active displaySize={displaySize} onSelect={onSelect} />);
    const layer = screen.getByTestId('selection-layer');

    pointerDown(layer, 50, 50);
    pointerMove(layer, 55, 55);
    pointerUp(layer, 55, 55);

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('selection-rect')).not.toBeInTheDocument();
  });

  it('clears the in-progress rect on pointer cancel without calling onSelect', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active displaySize={displaySize} onSelect={onSelect} />);
    const layer = screen.getByTestId('selection-layer');

    pointerDown(layer, 20, 30);
    pointerMove(layer, 120, 150);
    fireEvent.pointerCancel(layer, { pointerId: 1 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('selection-rect')).not.toBeInTheDocument();
  });

  it('clamps a drag that extends past the page bounds', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active displaySize={displaySize} onSelect={onSelect} />);
    const layer = screen.getByTestId('selection-layer');

    pointerDown(layer, 350, 250);
    pointerMove(layer, 500, 500);
    pointerUp(layer, 500, 500);

    expect(onSelect).toHaveBeenCalledWith({ x: 350, y: 250, width: 50, height: 50 });
  });

  it('shows the drag rectangle with the expected geometry while dragging', () => {
    render(<SelectionLayer active displaySize={displaySize} onSelect={vi.fn()} />);
    const layer = screen.getByTestId('selection-layer');

    pointerDown(layer, 20, 30);
    pointerMove(layer, 120, 150);

    const rect = screen.getByTestId('selection-rect');
    expect(rect.style.left).toBe('20px');
    expect(rect.style.top).toBe('30px');
    expect(rect.style.width).toBe('100px');
    expect(rect.style.height).toBe('120px');
  });
});

describe('SelectionLayer keyboard path', () => {
  it('moves a default centered rectangle with arrow keys', () => {
    render(<SelectionLayer active displaySize={displaySize} onSelect={vi.fn()} />);
    const layer = screen.getByTestId('selection-layer');
    layer.focus();

    fireEvent.keyDown(layer, { key: 'ArrowRight' });

    const rect = screen.getByTestId('selection-rect');
    // Default centered rect: width 100 (25% of 400), x = (400-100)/2 = 150; +8 step.
    expect(rect.style.left).toBe('158px');
  });

  it('resizes with Shift+Arrow', () => {
    render(<SelectionLayer active displaySize={displaySize} onSelect={vi.fn()} />);
    const layer = screen.getByTestId('selection-layer');
    layer.focus();

    fireEvent.keyDown(layer, { key: 'ArrowRight', shiftKey: true });

    const rect = screen.getByTestId('selection-rect');
    // Default centered rect: width 100 (25% of 400); +8 step from Shift+ArrowRight.
    expect(rect.style.width).toBe('108px');
  });

  it('confirms the current rect with Enter', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active displaySize={displaySize} onSelect={onSelect} />);
    const layer = screen.getByTestId('selection-layer');
    layer.focus();

    fireEvent.keyDown(layer, { key: 'ArrowRight' });
    fireEvent.keyDown(layer, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledTimes(1);
    const [rect] = onSelect.mock.calls[0] as [
      { x: number; y: number; width: number; height: number },
    ];
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(75);
  });

  it('cancels and clears the rect with Escape', () => {
    const onCancel = vi.fn();
    render(
      <SelectionLayer active displaySize={displaySize} onSelect={vi.fn()} onCancel={onCancel} />,
    );
    const layer = screen.getByTestId('selection-layer');
    layer.focus();

    fireEvent.keyDown(layer, { key: 'ArrowRight' });
    expect(screen.getByTestId('selection-rect')).toBeInTheDocument();

    fireEvent.keyDown(layer, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('selection-rect')).not.toBeInTheDocument();
  });
});

describe('SelectionLayer accessibility', () => {
  it('exposes application role, an aria-label, and a described hint only while active', () => {
    render(<SelectionLayer active displaySize={displaySize} onSelect={vi.fn()} />);
    const layer = screen.getByTestId('selection-layer');

    expect(layer).toHaveAttribute('role', 'application');
    expect(layer).toHaveAttribute('aria-label');
    const hint = screen.getByTestId('selection-hint');
    expect(layer.getAttribute('aria-describedby')).toBe(hint.id);
    expect(layer).toHaveAttribute('tabIndex', '0');
  });

  it('is not focusable and has no application role while inactive', () => {
    render(<SelectionLayer active={false} displaySize={displaySize} onSelect={vi.fn()} />);
    const layer = screen.getByTestId('selection-layer');

    expect(layer).not.toHaveAttribute('role');
    expect(layer).not.toHaveAttribute('tabIndex');
  });

  it('disables interaction while disabled even if active', () => {
    const onSelect = vi.fn();
    render(<SelectionLayer active displaySize={displaySize} onSelect={onSelect} disabled />);
    const layer = screen.getByTestId('selection-layer');

    pointerDown(layer, 20, 30);
    pointerMove(layer, 120, 150);
    pointerUp(layer, 120, 150);
    fireEvent.keyDown(layer, { key: 'ArrowRight' });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('selection-rect')).not.toBeInTheDocument();
  });
});
