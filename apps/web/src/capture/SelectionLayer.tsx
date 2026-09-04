import { useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import './SelectionLayer.css';
import type { DisplayRect } from '../study/contracts';
import { clampDisplayRect, normalizeDragRect } from './geometry';

export interface SelectionLayerSize {
  readonly width: number;
  readonly height: number;
}

export interface SelectionLayerProps {
  /** Whether manual selection is currently offered. Inactive: fully transparent to pointer events. */
  readonly active: boolean;
  /** The size (CSS px) of the page element this layer sits on top of. */
  readonly displaySize: SelectionLayerSize;
  /** Called once with a normalized-then-clamped rectangle when a selection is confirmed. */
  readonly onSelect: (rect: DisplayRect) => void;
  /** Called when the user cancels via Escape. */
  readonly onCancel?: () => void;
  readonly disabled?: boolean;
}

/** Drags/keyboard rectangles smaller than this (CSS px) on either edge are ignored. */
const MIN_SELECTION_PX = 24;

/** Keyboard move/resize step, in CSS px. */
const KEYBOARD_STEP_PX = 8;

function defaultCenteredRect(displaySize: SelectionLayerSize): DisplayRect {
  const width = Math.max(MIN_SELECTION_PX, displaySize.width * 0.25);
  const height = Math.max(MIN_SELECTION_PX, displaySize.height * 0.25);
  const rect: DisplayRect = {
    x: (displaySize.width - width) / 2,
    y: (displaySize.height - height) / 2,
    width,
    height,
  };
  return clampDisplayRect(rect, displaySize);
}

/**
 * `Element.setPointerCapture`/`releasePointerCapture` are always present on the real DOM
 * lib types, but jsdom (our unit-test environment) does not implement them. This narrower,
 * intentionally-optional view lets the call sites below guard at runtime without an
 * `@typescript-eslint/no-unnecessary-optional-chain` false positive.
 */
interface OptionalPointerCapture {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

function setPointerCaptureSafely(target: Element, pointerId: number): void {
  (target as OptionalPointerCapture).setPointerCapture?.(pointerId);
}

function releasePointerCaptureSafely(target: Element, pointerId: number): void {
  (target as OptionalPointerCapture).releasePointerCapture?.(pointerId);
}

const SELECTION_ARIA_LABEL =
  'Diagram selection. Drag, or use arrow keys to move, Shift plus arrow keys to resize, Enter to confirm, Escape to cancel.';

export function SelectionLayer({
  active,
  displaySize,
  onSelect,
  onCancel,
  disabled = false,
}: SelectionLayerProps) {
  const [rect, setRect] = useState<DisplayRect | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const hintId = useId();

  // Reset internal state exactly when a relevant prop actually changes, using React's
  // "adjust state during render" pattern (see react.dev "You Might Not Need an Effect")
  // instead of a `useEffect`, so this never fires as a separate post-commit render pass.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active && rect !== null) {
      setRect(null);
    }
    // `dragStartRef` is intentionally left as-is here: refs must not be written during
    // render (see react-hooks/refs), but it is harmless to leave stale — it is only ever
    // read from pointer handlers, which are not attached at all while `!active`, and the
    // next real `handlePointerDown` always overwrites it before it is read again.
  }

  const [prevDisplaySize, setPrevDisplaySize] = useState(displaySize);
  if (
    prevDisplaySize.width !== displaySize.width ||
    prevDisplaySize.height !== displaySize.height
  ) {
    setPrevDisplaySize(displaySize);
    if (rect) {
      setRect(clampDisplayRect(rect, displaySize));
    }
  }

  function toLocalPoint(event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled) {
      return;
    }
    const point = toLocalPoint(event);
    dragStartRef.current = point;
    setRect({ x: point.x, y: point.y, width: 0, height: 0 });
    setPointerCaptureSafely(event.currentTarget, event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || !dragStartRef.current) {
      return;
    }
    const point = toLocalPoint(event);
    const dragRect = clampDisplayRect(normalizeDragRect(dragStartRef.current, point), displaySize);
    setRect(dragRect);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    releasePointerCaptureSafely(event.currentTarget, event.pointerId);
    dragStartRef.current = null;
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || !dragStartRef.current) {
      return;
    }
    const point = toLocalPoint(event);
    const dragRect = clampDisplayRect(normalizeDragRect(dragStartRef.current, point), displaySize);
    endDrag(event);
    if (dragRect.width >= MIN_SELECTION_PX && dragRect.height >= MIN_SELECTION_PX) {
      setRect(dragRect);
      onSelect(dragRect);
    } else {
      setRect(null);
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragStartRef.current) {
      return;
    }
    endDrag(event);
    setRect(null);
  }

  function applyMove(dx: number, dy: number): void {
    setRect((prev) => {
      const base = prev ?? defaultCenteredRect(displaySize);
      return clampDisplayRect({ ...base, x: base.x + dx, y: base.y + dy }, displaySize);
    });
  }

  function applyResize(dw: number, dh: number): void {
    setRect((prev) => {
      const base = prev ?? defaultCenteredRect(displaySize);
      const width = Math.max(MIN_SELECTION_PX, base.width + dw);
      const height = Math.max(MIN_SELECTION_PX, base.height + dh);
      return clampDisplayRect({ ...base, width, height }, displaySize);
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (disabled) {
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        if (event.shiftKey) {
          applyResize(-KEYBOARD_STEP_PX, 0);
        } else {
          applyMove(-KEYBOARD_STEP_PX, 0);
        }
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (event.shiftKey) {
          applyResize(KEYBOARD_STEP_PX, 0);
        } else {
          applyMove(KEYBOARD_STEP_PX, 0);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (event.shiftKey) {
          applyResize(0, -KEYBOARD_STEP_PX);
        } else {
          applyMove(0, -KEYBOARD_STEP_PX);
        }
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (event.shiftKey) {
          applyResize(0, KEYBOARD_STEP_PX);
        } else {
          applyMove(0, KEYBOARD_STEP_PX);
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (rect) {
          onSelect(rect);
        }
        break;
      case 'Escape':
        event.preventDefault();
        setRect(null);
        dragStartRef.current = null;
        onCancel?.();
        break;
      default:
        break;
    }
  }

  if (!active) {
    // Fully inert: no role, no handlers, no tabIndex. `.selection-layer` (without
    // `[data-active="true"]`) is also `pointer-events: none` in CSS as a second guard.
    return <div className="selection-layer" data-testid="selection-layer" data-active="false" />;
  }

  return (
    // `role="application"` is the deliberate, spec-required pattern for this custom
    // drag/keyboard rectangle-selection widget (see the module doc and the task's a11y
    // requirements): it tells assistive tech that this region defines its own keyboard
    // interaction model (arrows/Shift+arrows/Enter/Escape) rather than being read as
    // static content. jsx-a11y's static interactive-role list does not include
    // "application" (it has no default ARIA APG interaction pattern of its own), so it
    // flags the handlers/tabIndex placed alongside it here; that is expected for this role.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="selection-layer"
      data-testid="selection-layer"
      data-active="true"
      role="application"
      aria-label={SELECTION_ARIA_LABEL}
      aria-describedby={hintId}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see role="application" note above.
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <p id={hintId} data-testid="selection-hint" className="selection-hint">
        Drag to select the diagram, or use arrow keys to move, Shift+arrow to resize, Enter to
        confirm, Escape to cancel.
      </p>
      {rect && (
        <div
          data-testid="selection-rect"
          className="selection-rect"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="selection-handle selection-handle--nw" />
          <span className="selection-handle selection-handle--ne" />
          <span className="selection-handle selection-handle--sw" />
          <span className="selection-handle selection-handle--se" />
        </div>
      )}
    </div>
  );
}
