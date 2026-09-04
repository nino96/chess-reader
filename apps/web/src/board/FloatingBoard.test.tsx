import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FloatingBoard, type FloatingBoardProps } from './FloatingBoard';
import { EMPTY_PLACEMENT, START_PLACEMENT } from './placement';

const WIDE_QUERY = '(min-width: 900px)';

interface FakeMediaQueryList {
  matches: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  fireChange: (matches: boolean) => void;
}

function mockMatchMedia(initialMatches: boolean): FakeMediaQueryList {
  const listeners = new Set<() => void>();
  const mql: FakeMediaQueryList = {
    matches: initialMatches,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    fireChange: (matches) => {
      act(() => {
        mql.matches = matches;
        for (const listener of listeners) {
          listener();
        }
      });
    },
  };
  const matchMediaMock = vi.fn((query: string) => {
    if (query !== WIDE_QUERY) {
      throw new Error(`Unexpected media query: ${query}`);
    }
    return mql as unknown as MediaQueryList;
  });
  window.matchMedia = matchMediaMock;
  return mql;
}

function noop() {
  /* no-op */
}

function focusElement(element: HTMLElement) {
  act(() => {
    element.focus();
  });
}

function renderBoard(overrides: Partial<FloatingBoardProps> = {}) {
  const onPlacementChange = vi.fn();
  const onOrientationChange = vi.fn();
  const onClose = vi.fn();

  const props: FloatingBoardProps = {
    placement: EMPTY_PLACEMENT,
    orientation: 'white',
    onPlacementChange,
    onOrientationChange,
    onClose,
    ...overrides,
  };

  const utils = render(<FloatingBoard {...props} />);
  return { ...utils, onPlacementChange, onOrientationChange, onClose, props };
}

afterEach(() => {
  window.matchMedia = undefined as unknown as typeof window.matchMedia;
  vi.restoreAllMocks();
});

describe('FloatingBoard squares and orientation', () => {
  it('renders all 64 squares with a8 top-left for white orientation', () => {
    renderBoard({ orientation: 'white' });
    const grid = screen.getByRole('group', { name: 'Board' });
    const buttons = within(grid).getAllByRole('button');
    expect(buttons).toHaveLength(64);
    expect(buttons[0]).toHaveAttribute('data-testid', 'board-square-a8');
    expect(buttons[63]).toHaveAttribute('data-testid', 'board-square-h1');
    expect(screen.getByTestId('board-square-e4')).toHaveAccessibleName('e4, empty');
  });

  it('renders all 64 squares with h1 top-left for black orientation', () => {
    renderBoard({ orientation: 'black' });
    const grid = screen.getByRole('group', { name: 'Board' });
    const buttons = within(grid).getAllByRole('button');
    expect(buttons).toHaveLength(64);
    expect(buttons[0]).toHaveAttribute('data-testid', 'board-square-h1');
    expect(buttons[63]).toHaveAttribute('data-testid', 'board-square-a8');
  });

  it('labels an occupied square with its piece', () => {
    renderBoard({ placement: START_PLACEMENT });
    expect(screen.getByTestId('board-square-e1')).toHaveAccessibleName('e1, white king');
    expect(screen.getByTestId('board-square-e8')).toHaveAccessibleName('e8, black king');
  });

  it('shows the orientation text and flips on click', async () => {
    const user = userEvent.setup();
    const { onOrientationChange } = renderBoard({ orientation: 'white' });
    expect(screen.getByTestId('board-orientation')).toHaveTextContent('White at bottom');
    expect(screen.getByTestId('board-flip')).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByTestId('board-flip'));
    expect(onOrientationChange).toHaveBeenCalledWith('black');
  });

  it('shows aria-pressed true and "Black at bottom" when oriented black', () => {
    renderBoard({ orientation: 'black' });
    expect(screen.getByTestId('board-orientation')).toHaveTextContent('Black at bottom');
    expect(screen.getByTestId('board-flip')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('FloatingBoard palette editing', () => {
  it('sets a square to the selected palette piece on click', async () => {
    const user = userEvent.setup();
    const { onPlacementChange } = renderBoard({ placement: EMPTY_PLACEMENT });

    await user.click(screen.getByTestId('palette-wN'));
    await user.click(screen.getByTestId('board-square-e4'));

    expect(onPlacementChange).toHaveBeenCalledWith('8/8/8/8/4N3/8/8/8');
  });

  it('clears a square using the empty palette item', async () => {
    const user = userEvent.setup();
    const { onPlacementChange } = renderBoard({ placement: START_PLACEMENT });

    await user.click(screen.getByTestId('palette-empty'));
    await user.click(screen.getByTestId('board-square-a1'));

    expect(onPlacementChange).toHaveBeenCalledWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR');
  });

  it('does not change placement when clicking a square with no palette selection', async () => {
    const user = userEvent.setup();
    const { onPlacementChange } = renderBoard({ placement: EMPTY_PLACEMENT });

    await user.click(screen.getByTestId('board-square-e4'));

    expect(onPlacementChange).not.toHaveBeenCalled();
  });

  it('marks the selected palette item as checked', async () => {
    const user = userEvent.setup();
    renderBoard();
    const wnButton = screen.getByTestId('palette-wN');
    expect(wnButton).toHaveAttribute('aria-checked', 'false');
    await user.click(wnButton);
    expect(wnButton).toHaveAttribute('aria-checked', 'true');
  });

  it('resets to the empty placement via the clear button', async () => {
    const user = userEvent.setup();
    const { onPlacementChange } = renderBoard({ placement: START_PLACEMENT });
    await user.click(screen.getByTestId('board-clear'));
    expect(onPlacementChange).toHaveBeenCalledWith(EMPTY_PLACEMENT);
  });

  it('resets to the start placement via the start button', async () => {
    const user = userEvent.setup();
    const { onPlacementChange } = renderBoard({ placement: EMPTY_PLACEMENT });
    await user.click(screen.getByTestId('board-start'));
    expect(onPlacementChange).toHaveBeenCalledWith(START_PLACEMENT);
  });
});

describe('FloatingBoard keyboard navigation', () => {
  it('moves focus across squares with arrow keys and applies the palette on Enter', async () => {
    const user = userEvent.setup();
    const { onPlacementChange } = renderBoard({ placement: EMPTY_PLACEMENT, orientation: 'white' });

    await user.click(screen.getByTestId('palette-wQ'));

    const a8 = screen.getByTestId('board-square-a8');
    focusElement(a8);
    expect(a8).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('board-square-b8')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('board-square-b7')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onPlacementChange).toHaveBeenCalledWith('8/1Q6/8/8/8/8/8/8');
  });

  it('does not move focus past the edge of the board', async () => {
    const user = userEvent.setup();
    renderBoard({ orientation: 'white' });
    const a8 = screen.getByTestId('board-square-a8');
    focusElement(a8);
    await user.keyboard('{ArrowUp}');
    expect(a8).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(a8).toHaveFocus();
  });

  it('moves focus across the palette with arrow keys and selects on Space', async () => {
    const user = userEvent.setup();
    renderBoard();
    const wk = screen.getByTestId('palette-wK');
    focusElement(wk);
    expect(wk).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('palette-wQ')).toHaveFocus();

    await user.keyboard(' ');
    expect(screen.getByTestId('palette-wQ')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('FloatingBoard confidence marking', () => {
  it('marks confidence index 0 (a1) and confidence index 63 (h8) as low confidence', () => {
    const confidences = Array.from({ length: 64 }, () => 0.99);
    confidences[0] = 0.1;
    confidences[63] = 0.1;

    renderBoard({ confidences, orientation: 'white' });

    expect(screen.getByTestId('board-square-a1')).toHaveAttribute('data-low-confidence', 'true');
    expect(screen.getByTestId('board-square-h8')).toHaveAttribute('data-low-confidence', 'true');
    expect(screen.getByTestId('board-square-a8')).not.toHaveAttribute('data-low-confidence');
    expect(screen.getByTestId('board-square-h1')).not.toHaveAttribute('data-low-confidence');
  });

  it('appends "(low confidence)" to the accessible name of a marked square', () => {
    const confidences = Array.from({ length: 64 }, () => 0.99);
    confidences[0] = 0.1; // a1

    renderBoard({ confidences, placement: EMPTY_PLACEMENT });

    expect(screen.getByTestId('board-square-a1')).toHaveAccessibleName(
      'a1, empty (low confidence)',
    );
  });

  it('respects a custom lowConfidenceThreshold', () => {
    const confidences = Array.from({ length: 64 }, () => 0.5);
    const first = renderBoard({ confidences, lowConfidenceThreshold: 0.4 });
    expect(screen.getByTestId('board-square-a1')).not.toHaveAttribute('data-low-confidence');
    first.unmount();

    renderBoard({ confidences, lowConfidenceThreshold: 0.6 });
    expect(screen.getByTestId('board-square-a1')).toHaveAttribute('data-low-confidence', 'true');
  });

  it('shows the low-confidence warning only when reliable is false', () => {
    const { rerender } = render(
      <FloatingBoard
        placement={EMPTY_PLACEMENT}
        orientation="white"
        reliable={true}
        onPlacementChange={noop}
        onOrientationChange={noop}
        onClose={noop}
      />,
    );
    expect(screen.queryByText(/Low-confidence squares are marked/)).not.toBeInTheDocument();

    rerender(
      <FloatingBoard
        placement={EMPTY_PLACEMENT}
        orientation="white"
        reliable={false}
        onPlacementChange={noop}
        onOrientationChange={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText(/Low-confidence squares are marked/)).toBeInTheDocument();
  });

  it('shows the status text in the status line', () => {
    renderBoard({ status: 'Recognized in 800 ms' });
    expect(screen.getByTestId('board-status')).toHaveTextContent('Recognized in 800 ms');
  });
});

describe('FloatingBoard close and focus management', () => {
  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const { onClose } = renderBoard();
    await user.click(screen.getByTestId('board-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', () => {
    const { onClose } = renderBoard();
    fireEvent.keyDown(screen.getByTestId('floating-board'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the panel on mount and restores it on unmount', () => {
    function Harness({ showBoard }: { showBoard: boolean }) {
      return (
        <div>
          <button data-testid="outside">Outside</button>
          {showBoard ? (
            <FloatingBoard
              placement={EMPTY_PLACEMENT}
              orientation="white"
              onPlacementChange={noop}
              onOrientationChange={noop}
              onClose={noop}
            />
          ) : null}
        </div>
      );
    }

    const { rerender } = render(<Harness showBoard={false} />);
    const outside = screen.getByTestId('outside');
    focusElement(outside);
    expect(outside).toHaveFocus();

    rerender(<Harness showBoard={true} />);
    expect(outside).not.toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);

    // Unmount only the FloatingBoard (not the whole tree) to verify it restores
    // focus to the element that had it before the panel opened.
    rerender(<Harness showBoard={false} />);
    expect(outside).toHaveFocus();
  });
});

describe('FloatingBoard pointer routing', () => {
  it('stops pointerdown, touchstart, and wheel from reaching an ancestor handler', () => {
    const onPointerDown = vi.fn();
    const onTouchStart = vi.fn();
    const onWheel = vi.fn();

    render(
      <div onPointerDown={onPointerDown} onTouchStart={onTouchStart} onWheel={onWheel}>
        <FloatingBoard
          placement={EMPTY_PLACEMENT}
          orientation="white"
          onPlacementChange={noop}
          onOrientationChange={noop}
          onClose={noop}
        />
      </div>,
    );

    const panel = screen.getByTestId('floating-board');
    fireEvent.pointerDown(panel);
    fireEvent.touchStart(panel);
    fireEvent.wheel(panel);

    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onTouchStart).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
  });
});

describe('FloatingBoard layout and dragging', () => {
  it('is bottom-docked on narrow viewports and the handle is inert', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });

    renderBoard({ defaultPosition: { x: 10, y: 10 } });

    const panel = screen.getByTestId('floating-board');
    expect(panel).toHaveAttribute('data-docked', 'bottom');
    const handle = screen.getByTestId('board-handle');
    expect(handle).toBeDisabled();
    expect(panel.style.left).toBe('');
    expect(panel.style.top).toBe('');

    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
  });

  it('floats at the given position and updates it by dragging the handle on wide viewports', () => {
    mockMatchMedia(true);
    renderBoard({ defaultPosition: { x: 50, y: 60 } });

    const panel = screen.getByTestId('floating-board');
    expect(panel).toHaveAttribute('data-docked', 'none');
    expect(panel.style.left).toBe('50px');
    expect(panel.style.top).toBe('60px');

    const handle = screen.getByTestId('board-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(panel.style.left).toBe('80px');
    expect(panel.style.top).toBe('105px');
  });

  it('moves the panel with arrow keys on the handle when floating', () => {
    mockMatchMedia(true);
    renderBoard({ defaultPosition: { x: 50, y: 60 } });

    const panel = screen.getByTestId('floating-board');
    const handle = screen.getByTestId('board-handle');
    focusElement(handle);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(panel.style.left).toBe('66px');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(panel.style.top).toBe('76px');
  });

  it('switches docked mode when the media query change fires', () => {
    const mql = mockMatchMedia(true);
    renderBoard({ defaultPosition: { x: 50, y: 60 } });
    const panel = screen.getByTestId('floating-board');
    expect(panel).toHaveAttribute('data-docked', 'none');

    mql.fireChange(false);
    expect(panel).toHaveAttribute('data-docked', 'bottom');
  });
});

describe('FloatingBoard accessible names', () => {
  it('gives every interactive control an accessible name', () => {
    renderBoard({ placement: START_PLACEMENT, status: 'Recognized in 800 ms' });
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).toHaveAccessibleName();
    }
    const radios = screen.getAllByRole('radio');
    for (const radio of radios) {
      expect(radio).toHaveAccessibleName();
    }
  });

  it('exposes the expected top-level named controls', () => {
    renderBoard();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start position' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Piece palette' })).toBeInTheDocument();
  });
});
