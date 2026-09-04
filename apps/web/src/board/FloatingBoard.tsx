import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';

import type { BoardOrientation, PlacementFen } from '../study/contracts';
import './FloatingBoard.css';
import {
  EMPTY_PLACEMENT,
  START_PLACEMENT,
  boardIndexToConfidenceIndex,
  displayOrder,
  flipOrientation,
  parsePlacement,
  pieceLabel,
  serializePlacement,
  setSquare,
  squareName,
  type BoardSquares,
  type Piece,
  type Square,
} from './placement';

export interface FloatingBoardProps {
  /** Controlled FEN piece-placement field. */
  placement: PlacementFen;
  /** Controlled board orientation. */
  orientation: BoardOrientation;
  /**
   * Per-square confidence, 64 entries in A1..H8 rank-major order (index 0 = a1,
   * index 7 = h1, index 8 = a2, ... index 63 = h8) -- the same order as
   * `RecognizedBoard.confidences` in apps/web/src/study/contracts.ts. This is
   * NOT the same order as `BoardSquares` (which is FEN/a8-first order); the
   * component converts internally via `boardIndexToConfidenceIndex`.
   */
  confidences?: readonly number[] | undefined;
  reliable?: boolean | undefined;
  lowConfidenceThreshold?: number;
  /** Short status line shown in the panel header, e.g. "Recognized in 800 ms". */
  status?: string | undefined;
  onPlacementChange: (next: PlacementFen) => void;
  onOrientationChange: (next: BoardOrientation) => void;
  onClose: () => void;
  /** CSS px within the viewport; only used on larger (floating) screens. */
  defaultPosition?: { x: number; y: number } | undefined;
}

type Docked = 'bottom' | 'none';

interface PaletteItem {
  readonly id: string;
  readonly piece: Piece | null;
}

const PALETTE_ITEMS: readonly PaletteItem[] = [
  { id: 'wK', piece: 'wK' },
  { id: 'wQ', piece: 'wQ' },
  { id: 'wR', piece: 'wR' },
  { id: 'wB', piece: 'wB' },
  { id: 'wN', piece: 'wN' },
  { id: 'wP', piece: 'wP' },
  { id: 'bK', piece: 'bK' },
  { id: 'bQ', piece: 'bQ' },
  { id: 'bR', piece: 'bR' },
  { id: 'bB', piece: 'bB' },
  { id: 'bN', piece: 'bN' },
  { id: 'bP', piece: 'bP' },
  { id: 'empty', piece: null },
];

const WIDE_MEDIA_QUERY = '(min-width: 900px)';
const HANDLE_STEP_PX = 16;
const DEFAULT_PANEL_WIDTH_PX = 22 * 16;
const DEFAULT_MARGIN_PX = 16;

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function computeInitialDocked(): Docked {
  if (typeof window === 'undefined') {
    return 'bottom';
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(WIDE_MEDIA_QUERY).matches ? 'none' : 'bottom';
  }
  return window.innerWidth >= 900 ? 'none' : 'bottom';
}

function computeDefaultPosition(defaultPosition?: { x: number; y: number }): {
  x: number;
  y: number;
} {
  if (defaultPosition) {
    return defaultPosition;
  }
  if (typeof window === 'undefined') {
    return { x: DEFAULT_MARGIN_PX, y: DEFAULT_MARGIN_PX };
  }
  const x = Math.max(
    DEFAULT_MARGIN_PX,
    window.innerWidth - DEFAULT_PANEL_WIDTH_PX - DEFAULT_MARGIN_PX,
  );
  return { x, y: DEFAULT_MARGIN_PX };
}

function safeParsePlacement(placement: PlacementFen): BoardSquares {
  try {
    return parsePlacement(placement);
  } catch {
    return parsePlacement(EMPTY_PLACEMENT);
  }
}

export function FloatingBoard(props: FloatingBoardProps) {
  const {
    placement,
    orientation,
    confidences,
    reliable,
    lowConfidenceThreshold = 0.7,
    status,
    onPlacementChange,
    onOrientationChange,
    onClose,
    defaultPosition,
  } = props;

  const headingId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const squareRefs = useRef<(HTMLButtonElement | null)[]>(Array.from({ length: 64 }, () => null));
  const paletteRefs = useRef<(HTMLButtonElement | null)[]>(
    Array.from({ length: PALETTE_ITEMS.length }, () => null),
  );

  const [docked, setDocked] = useState<Docked>(() => computeInitialDocked());
  const [position, setPosition] = useState(() => computeDefaultPosition(defaultPosition));
  const [selectedPaletteIndex, setSelectedPaletteIndex] = useState<number | null>(null);
  const [paletteFocusIndex, setPaletteFocusIndex] = useState(0);
  const [squareFocusPosition, setSquareFocusPosition] = useState(0);

  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const squares = useMemo(() => safeParsePlacement(placement), [placement]);
  const order = useMemo(() => displayOrder(orientation), [orientation]);

  const lowConfidenceBoardIndexes = useMemo(() => {
    if (!confidences) {
      return new Set<number>();
    }
    const marked = new Set<number>();
    for (let boardIndex = 0; boardIndex < 64; boardIndex += 1) {
      const confidenceIndex = boardIndexToConfidenceIndex(boardIndex);
      const value = confidences[confidenceIndex];
      if (value !== undefined && value < lowConfidenceThreshold) {
        marked.add(boardIndex);
      }
    }
    return marked;
  }, [confidences, lowConfidenceThreshold]);

  // Track viewport width to decide bottom-anchored vs. floating layout.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(WIDE_MEDIA_QUERY);
    const handleChange = () => {
      setDocked(mql.matches ? 'none' : 'bottom');
    };
    handleChange();
    mql.addEventListener('change', handleChange);
    return () => {
      mql.removeEventListener('change', handleChange);
    };
  }, []);

  // Focus management: move focus into the panel on mount, restore on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const target = closeButtonRef.current ?? handleRef.current;
    target?.focus();
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, []);

  const applyToSquare = useCallback(
    (boardIndex: number) => {
      if (selectedPaletteIndex === null) {
        return;
      }
      const item = PALETTE_ITEMS[selectedPaletteIndex];
      if (!item) {
        return;
      }
      const next = setSquare(squares, boardIndex, item.piece);
      onPlacementChange(serializePlacement(next));
    },
    [onPlacementChange, selectedPaletteIndex, squares],
  );

  const handleSquareClick = useCallback(
    (position_: number, boardIndex: number) => {
      setSquareFocusPosition(position_);
      applyToSquare(boardIndex);
    },
    [applyToSquare],
  );

  const handleSquareKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, position_: number, boardIndex: number) => {
      const row = Math.floor(position_ / 8);
      const col = position_ % 8;
      let nextPosition: number | null = null;

      switch (event.key) {
        case 'ArrowLeft':
          if (col > 0) nextPosition = position_ - 1;
          break;
        case 'ArrowRight':
          if (col < 7) nextPosition = position_ + 1;
          break;
        case 'ArrowUp':
          if (row > 0) nextPosition = position_ - 8;
          break;
        case 'ArrowDown':
          if (row < 7) nextPosition = position_ + 8;
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          applyToSquare(boardIndex);
          return;
        default:
          return;
      }

      if (nextPosition !== null) {
        event.preventDefault();
        setSquareFocusPosition(nextPosition);
        squareRefs.current[nextPosition]?.focus();
      }
    },
    [applyToSquare],
  );

  const handlePaletteSelect = useCallback((index: number) => {
    setSelectedPaletteIndex(index);
    setPaletteFocusIndex(index);
  }, []);

  const handlePaletteKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = index > 0 ? index - 1 : null;
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = index < PALETTE_ITEMS.length - 1 ? index + 1 : null;
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          handlePaletteSelect(index);
          return;
        default:
          return;
      }
      if (nextIndex !== null) {
        event.preventDefault();
        setPaletteFocusIndex(nextIndex);
        paletteRefs.current[nextIndex]?.focus();
      }
    },
    [handlePaletteSelect],
  );

  const handleFlip = useCallback(() => {
    onOrientationChange(flipOrientation(orientation));
  }, [onOrientationChange, orientation]);

  const handleClear = useCallback(() => {
    onPlacementChange(EMPTY_PLACEMENT);
  }, [onPlacementChange]);

  const handleStart = useCallback(() => {
    onPlacementChange(START_PLACEMENT);
  }, [onPlacementChange]);

  const stopPropagationHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation();
    },
    onTouchStart: (event: ReactTouchEvent<HTMLElement>) => {
      event.stopPropagation();
    },
    onWheel: (event: ReactWheelEvent<HTMLElement>) => {
      event.stopPropagation();
    },
  };

  const clampPosition = useCallback((x: number, y: number): { x: number; y: number } => {
    if (typeof window === 'undefined') {
      return { x, y };
    }
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? DEFAULT_PANEL_WIDTH_PX;
    const height = rect?.height ?? 0;
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);
    return { x: clamp(x, 0, maxX), y: clamp(y, 0, maxY) };
  }, []);

  const handleHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (docked !== 'none') {
        return;
      }
      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
      };
      // jsdom (unit tests) does not implement pointer capture; guard so drag
      // still works there via directly-targeted synthetic events.
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [docked, position.x, position.y],
  );

  const handleHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const drag = dragState.current;
      if (drag?.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setPosition(clampPosition(drag.originX + dx, drag.originY + dy));
    },
    [clampPosition],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const drag = dragState.current;
    if (drag?.pointerId === event.pointerId) {
      dragState.current = null;
    }
  }, []);

  const handleHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (docked !== 'none') {
        return;
      }
      let dx = 0;
      let dy = 0;
      switch (event.key) {
        case 'ArrowLeft':
          dx = -HANDLE_STEP_PX;
          break;
        case 'ArrowRight':
          dx = HANDLE_STEP_PX;
          break;
        case 'ArrowUp':
          dy = -HANDLE_STEP_PX;
          break;
        case 'ArrowDown':
          dy = HANDLE_STEP_PX;
          break;
        default:
          return;
      }
      event.preventDefault();
      setPosition((prev) => clampPosition(prev.x + dx, prev.y + dy));
    },
    [clampPosition, docked],
  );

  const handlePanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  const files =
    orientation === 'white'
      ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
  const rankLabelForRow = (row: number): number => {
    const boardIndex = order[row * 8];
    if (boardIndex === undefined) {
      return 0;
    }
    const name = squareName(boardIndex);
    return Number(name.slice(1));
  };

  // A floating panel is bounded by the space left below its own top edge and made
  // scrollable (see the CSS), so a panel taller than the viewport never pushes its
  // lower controls (the palette) off-screen where nothing can reach them.
  const panelStyle: CSSProperties =
    docked === 'none'
      ? {
          left: position.x,
          top: position.y,
          maxHeight: `calc(100vh - ${String(Math.max(0, Math.round(position.y)))}px - ${String(
            DEFAULT_MARGIN_PX,
          )}px)`,
        }
      : {};

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- standard dialog Escape-to-close pattern; the keydown listener only reads the key and calls onClose.
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      data-testid="floating-board"
      data-placement={placement}
      data-orientation={orientation}
      data-docked={docked}
      className="floating-board"
      style={panelStyle}
      onKeyDown={handlePanelKeyDown}
      {...stopPropagationHandlers}
    >
      <header className="floating-board-header">
        <button
          ref={closeButtonRef}
          type="button"
          data-testid="board-close"
          className="floating-board-close"
          onClick={onClose}
        >
          Close
        </button>
        <h2 id={headingId} className="floating-board-title">
          Board editor
        </h2>
        <button
          ref={handleRef}
          type="button"
          aria-label="Move board"
          data-testid="board-handle"
          className="floating-board-handle"
          disabled={docked === 'bottom'}
          onPointerDown={handleHandlePointerDown}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleHandleKeyDown}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      </header>

      <div className="floating-board-status" data-testid="board-status" role="status">
        {status !== undefined && status.length > 0 ? <p>{status}</p> : null}
        {reliable === false ? (
          <p className="floating-board-warning">Low-confidence squares are marked — check them</p>
        ) : null}
      </div>

      <div className="floating-board-content">
        <div className="floating-board-toolbar">
          <button
            type="button"
            data-testid="board-flip"
            aria-pressed={orientation === 'black'}
            onClick={handleFlip}
          >
            Flip
          </button>
          <span data-testid="board-orientation" className="floating-board-orientation-text">
            {orientation === 'white' ? 'White at bottom' : 'Black at bottom'}
          </span>
          <button type="button" data-testid="board-clear" onClick={handleClear}>
            Clear board
          </button>
          <button type="button" data-testid="board-start" onClick={handleStart}>
            Start position
          </button>
        </div>

        <div className="floating-board-grid-wrapper">
          <div className="floating-board-file-labels" aria-hidden="true">
            <span className="floating-board-corner" />
            {files.map((file) => (
              <span key={file} className="floating-board-file-label">
                {file}
              </span>
            ))}
          </div>
          <div className="floating-board-grid" role="group" aria-label="Board">
            {Array.from({ length: 8 }, (_, row) => row).map((row) => (
              <div className="floating-board-row" key={row}>
                <span className="floating-board-rank-label" aria-hidden="true">
                  {rankLabelForRow(row)}
                </span>
                {Array.from({ length: 8 }, (_, col) => col).map((col) => {
                  const position_ = row * 8 + col;
                  const boardIndex = order[position_];
                  if (boardIndex === undefined) {
                    return null;
                  }
                  const name = squareName(boardIndex);
                  const piece: Square = squares[boardIndex] ?? null;
                  const file = boardIndex % 8;
                  const rank = 8 - Math.floor(boardIndex / 8);
                  const isDark = (file + rank) % 2 === 1;
                  const isLowConfidence = lowConfidenceBoardIndexes.has(boardIndex);
                  const label = piece
                    ? `${name}, ${pieceLabel(piece)}${isLowConfidence ? ' (low confidence)' : ''}`
                    : `${name}, empty${isLowConfidence ? ' (low confidence)' : ''}`;
                  return (
                    <button
                      key={name}
                      ref={(el) => {
                        squareRefs.current[position_] = el;
                      }}
                      type="button"
                      data-testid={`board-square-${name}`}
                      data-piece={piece ?? ''}
                      data-low-confidence={isLowConfidence ? 'true' : undefined}
                      className={`floating-board-square${isDark ? ' floating-board-square--dark' : ' floating-board-square--light'}${isLowConfidence ? ' floating-board-square--low-confidence' : ''}`}
                      aria-label={label}
                      tabIndex={squareFocusPosition === position_ ? 0 : -1}
                      onClick={() => {
                        handleSquareClick(position_, boardIndex);
                      }}
                      onFocus={() => {
                        setSquareFocusPosition(position_);
                      }}
                      onKeyDown={(event) => {
                        handleSquareKeyDown(event, position_, boardIndex);
                      }}
                    >
                      {piece ? <PieceIcon piece={piece} /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div
          className="floating-board-palette"
          data-testid="board-palette"
          role="radiogroup"
          aria-label="Piece palette"
        >
          {PALETTE_ITEMS.map((item, index) => {
            const checked = selectedPaletteIndex === index;
            const label = item.piece ? pieceLabel(item.piece) : 'empty (eraser)';
            return (
              <button
                key={item.id}
                ref={(el) => {
                  paletteRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={label}
                data-testid={`palette-${item.id}`}
                className={`floating-board-palette-item${checked ? ' floating-board-palette-item--selected' : ''}`}
                tabIndex={paletteFocusIndex === index ? 0 : -1}
                onClick={() => {
                  handlePaletteSelect(index);
                }}
                onFocus={() => {
                  setPaletteFocusIndex(index);
                }}
                onKeyDown={(event) => {
                  handlePaletteKeyDown(event, index);
                }}
              >
                {item.piece ? <PieceIcon piece={item.piece} /> : <span aria-hidden="true">✕</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PieceIcon({ piece }: { piece: Piece }) {
  const isWhite = piece.startsWith('w');
  const letter = piece.slice(1);
  return (
    <svg viewBox="0 0 32 32" className="piece-icon" aria-hidden="true" focusable="false">
      <circle
        cx="16"
        cy="16"
        r="13"
        className={
          isWhite
            ? 'piece-icon-disc piece-icon-disc--white'
            : 'piece-icon-disc piece-icon-disc--black'
        }
      />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        className={
          isWhite
            ? 'piece-icon-letter piece-icon-letter--white'
            : 'piece-icon-letter piece-icon-letter--black'
        }
      >
        {letter}
      </text>
    </svg>
  );
}
