/**
 * The issue #2 walking slice, wired end to end:
 *
 *   PdfReader (current page) -> SelectionLayer (manual rectangle)
 *     -> capturePdfRegion (bounded source pixels)
 *     -> DiagramRecognizer (worker, or the scripted fake under E2E)
 *     -> FloatingBoard (editable placement + orientation)
 *
 * State lives in memory only (durability is issue #3). Every recognition
 * request carries a monotonically increasing id and its own AbortController;
 * a result is applied only if it is still the newest request, the page it was
 * captured from is still displayed, and the user has not closed the flow. A
 * user edit on the board is therefore never overwritten by a late result.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { FloatingBoard } from '../board/FloatingBoard';
import { capturePdfRegion } from '../capture/capturePdfRegion';
import { displayRectToNormalized } from '../capture/geometry';
import { SelectionLayer } from '../capture/SelectionLayer';
import { PdfReader, type PageDisplayInfo } from '../reader/PdfReader';
import type { PdfDocumentHandle } from '../reader/pdfDocument';
import { createRecognizer } from '../recognition/recognizerFactory';
import './StudyWorkspace.css';
import {
  RecognitionError,
  type BoardOrientation,
  type DiagramRecognizer,
  type DisplayRect,
  type PdfPageLocator,
  type PlacementFen,
  type RecognitionPhase,
  type RecognitionTiming,
} from './contracts';

export type StudyPhase =
  'idle' | 'capturing' | RecognitionPhase | 'done' | 'no-board' | 'error' | 'cancelled';

export interface RecognitionStatus {
  readonly phase: StudyPhase;
  readonly message: string;
  readonly timing?: RecognitionTiming | undefined;
  readonly reliable?: boolean | undefined;
  readonly recognizerVersion?: string | undefined;
}

export interface BoardState {
  readonly placement: PlacementFen;
  readonly orientation: BoardOrientation;
  readonly confidences: readonly number[] | undefined;
  readonly reliable: boolean | undefined;
  /** Where to float the panel, chosen once when the board opens. */
  readonly defaultPosition: { readonly x: number; readonly y: number } | undefined;
}

export interface StudyWorkspaceProps {
  /** Injectable recognizer factory (tests); defaults to the worker/E2E seam factory. */
  readonly recognizerFactory?: () => DiagramRecognizer;
  /** Injectable capture (tests); defaults to the real PDF.js-backed capture. */
  readonly capture?: typeof capturePdfRegion;
  /** Injectable document opener, forwarded to the reader (tests). */
  readonly openDocument?: NonNullable<Parameters<typeof PdfReader>[0]['openDocument']>;
}

interface ActiveRequest {
  readonly id: number;
  readonly locator: PdfPageLocator;
  readonly controller: AbortController;
}

const IDLE_STATUS: RecognitionStatus = {
  phase: 'idle',
  message: 'Turn on selection mode, then drag a rectangle around a printed diagram.',
};

const PHASE_MESSAGES: Record<Exclude<StudyPhase, 'idle' | 'done' | 'error'>, string> = {
  capturing: 'Capturing the selected region…',
  'loading-model': 'Loading the local recognition model (first use only)…',
  recognizing: 'Recognizing the diagram on this device…',
  'no-board':
    'No chessboard was found in that selection. Try a tighter rectangle around the diagram.',
  cancelled: 'Recognition cancelled.',
};

function describeError(error: unknown): string {
  if (error instanceof RecognitionError) {
    switch (error.code) {
      case 'timeout':
        return 'Recognition took too long and was stopped. Try again with a smaller selection.';
      case 'worker-unavailable':
        return 'The local recognition worker could not start in this browser. Reload and try again.';
      case 'asset-integrity':
        return 'The bundled recognition model failed its integrity check, so it was not run. Reinstall or update the app.';
      case 'aborted':
        return PHASE_MESSAGES.cancelled;
      case 'runtime-failure':
        return 'Recognition failed on this device. Try again or select a different region.';
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return PHASE_MESSAGES.cancelled;
  }
  return 'Capturing the selection failed. Try again.';
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof RecognitionError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

const BOARD_PANEL_WIDTH_PX = 22 * 16;
const BOARD_PANEL_MARGIN_PX = 16;

/**
 * Prefer floating the board beside the displayed page (the page is centered and
 * usually narrower than the viewport once it is fitted to the height), so the
 * panel does not cover the reader controls or the diagram itself. Returns
 * `undefined` to accept the panel's own default when there is no room; the
 * panel also clamps itself inside the viewport and docks to the bottom on
 * compact screens regardless of this hint.
 */
function chooseBoardPosition(workspace: HTMLElement | null): { x: number; y: number } | undefined {
  if (!workspace || typeof window === 'undefined') {
    return undefined;
  }
  const container = workspace.querySelector<HTMLElement>('[data-testid="pdf-page-container"]');
  if (!container) {
    return undefined;
  }
  const rect = container.getBoundingClientRect();
  const y = Math.max(BOARD_PANEL_MARGIN_PX, rect.top);
  if (rect.right + BOARD_PANEL_MARGIN_PX + BOARD_PANEL_WIDTH_PX <= window.innerWidth) {
    return { x: rect.right + BOARD_PANEL_MARGIN_PX, y };
  }
  if (rect.left - BOARD_PANEL_MARGIN_PX - BOARD_PANEL_WIDTH_PX >= 0) {
    return { x: rect.left - BOARD_PANEL_MARGIN_PX - BOARD_PANEL_WIDTH_PX, y };
  }
  return undefined;
}

export function StudyWorkspace({
  recognizerFactory,
  capture = capturePdfRegion,
  openDocument,
}: StudyWorkspaceProps = {}) {
  const [recognizer, setRecognizer] = useState<DiagramRecognizer | null>(null);
  const [documentHandle, setDocumentHandle] = useState<PdfDocumentHandle | null>(null);
  const [pageInfo, setPageInfo] = useState<PageDisplayInfo | null>(null);
  const [selectionActive, setSelectionActive] = useState(false);
  const [status, setStatus] = useState<RecognitionStatus>(IDLE_STATUS);
  const [board, setBoard] = useState<BoardState | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const requestCounter = useRef(0);
  const activeRequest = useRef<ActiveRequest | null>(null);

  // Captured once, at first render, and deliberately never refreshed: this effect
  // must create the recognizer exactly once per real mount and always use whichever
  // factory the component was first given, not react to `recognizerFactory` changing
  // identity across re-renders (which never legitimately happens here — production
  // never passes it, and every test passes one factory for the component's whole
  // life). A ref, not a dependency, is also what keeps this effect's dependency
  // array `[]` correct rather than needing an exhaustive-deps suppression.
  const recognizerFactoryRef = useRef(recognizerFactory);

  // Creates the recognizer and disposes it on unmount. The creation happens
  // *inside* this effect rather than via a `useState` lazy initializer on purpose:
  // React's StrictMode deliberately runs a mount -> cleanup -> mount rehearsal in
  // development to catch effects that don't clean up safely. With the recognizer
  // created once outside this effect and only *disposed* here, that rehearsal's
  // phantom cleanup permanently disposed the one and only instance, with nothing
  // recreating it — so every real recognition request afterward failed instantly
  // and silently as "aborted" (surfaced to the user as "Recognition cancelled").
  // Creating a fresh instance here means the rehearsal's sequence (create A,
  // dispose A, create B) always leaves a live, undisposed instance by the time a
  // user can possibly interact with the page. In a production build, and in this
  // component's own tests, there is no rehearsal, so this simply runs once.
  useEffect(() => {
    const instance = (recognizerFactoryRef.current ?? createRecognizer)();
    setRecognizer(instance);
    return () => {
      activeRequest.current?.controller.abort();
      instance.dispose();
    };
  }, []);

  const cancelActiveRequest = useCallback((reason: 'cancelled' | 'silent') => {
    const active = activeRequest.current;
    if (!active) {
      return;
    }
    activeRequest.current = null;
    active.controller.abort();
    if (reason === 'cancelled') {
      setStatus({ phase: 'cancelled', message: PHASE_MESSAGES.cancelled });
    }
  }, []);

  const handleDocumentChange = useCallback(
    (doc: PdfDocumentHandle | null) => {
      cancelActiveRequest('silent');
      setDocumentHandle(doc);
      setPageInfo(null);
      setSelectionActive(false);
      setStatus(IDLE_STATUS);
    },
    [cancelActiveRequest],
  );

  const handlePageDisplayed = useCallback(
    (info: PageDisplayInfo) => {
      setPageInfo(info);
      const active = activeRequest.current;
      if (active && active.locator.pageIndex !== info.locator.pageIndex) {
        // The page the selection came from is no longer displayed: its result is stale.
        cancelActiveRequest('cancelled');
      }
    },
    [cancelActiveRequest],
  );

  const handleSelect = useCallback(
    (rect: DisplayRect) => {
      // `recognizer` is briefly null between mount and the recognizer-creation
      // effect settling; unreachable in practice (selecting requires a book to
      // already be open and displayed, which takes far longer), but this keeps
      // the type honest and fails safe if it ever were reached.
      if (!documentHandle || !pageInfo || !recognizer) {
        return;
      }
      // TypeScript cannot carry the null-check above through the async closure
      // below on its own; a freshly bound local const makes the narrowing stick.
      const activeRecognizer = recognizer;
      cancelActiveRequest('silent');
      setSelectionActive(false);

      const id = ++requestCounter.current;
      const controller = new AbortController();
      const locator = pageInfo.locator;
      const request: ActiveRequest = { id, locator, controller };
      activeRequest.current = request;
      const normalizedRect = displayRectToNormalized(rect, {
        width: pageInfo.displayWidth,
        height: pageInfo.displayHeight,
      });

      const isCurrent = (): boolean =>
        activeRequest.current === request && !controller.signal.aborted;

      setStatus({ phase: 'capturing', message: PHASE_MESSAGES.capturing });

      void (async () => {
        try {
          const region = await capture(documentHandle, locator, normalizedRect, {
            signal: controller.signal,
          });
          if (!isCurrent()) {
            return;
          }
          setStatus({ phase: 'recognizing', message: PHASE_MESSAGES.recognizing });
          const result = await activeRecognizer.recognize(
            { requestId: id, region },
            controller.signal,
            (phase) => {
              if (isCurrent()) {
                setStatus({ phase, message: PHASE_MESSAGES[phase] });
              }
            },
          );
          if (!isCurrent() || result.requestId !== id) {
            return;
          }
          activeRequest.current = null;
          if (result.outcome.kind === 'no-board') {
            setStatus({
              phase: 'no-board',
              message: PHASE_MESSAGES['no-board'],
              timing: result.timing,
              recognizerVersion: result.recognizerVersion,
            });
            return;
          }
          const recognized = result.outcome.board;
          setBoard({
            placement: recognized.placement,
            orientation: recognized.proposedOrientation,
            confidences: recognized.confidences,
            reliable: recognized.reliable,
            // Chosen here, when the board opens, rather than during render: the
            // reader's page is laid out now, and a ref must not be read while
            // rendering.
            defaultPosition: chooseBoardPosition(workspaceRef.current),
          });
          setStatus({
            phase: 'done',
            message: `Recognized in ${String(Math.round(result.timing.totalMs))} ms${
              recognized.reliable ? '' : ' — check the marked squares'
            }.`,
            timing: result.timing,
            reliable: recognized.reliable,
            recognizerVersion: result.recognizerVersion,
          });
        } catch (error) {
          if (!isCurrent()) {
            // A cancelled or superseded request never reports; the newer request owns the status.
            return;
          }
          activeRequest.current = null;
          if (isAbortLike(error)) {
            setStatus({ phase: 'cancelled', message: PHASE_MESSAGES.cancelled });
            return;
          }
          setStatus({ phase: 'error', message: describeError(error) });
        }
      })();
    },
    [cancelActiveRequest, capture, documentHandle, pageInfo, recognizer],
  );

  const handleCancelClick = useCallback(() => {
    cancelActiveRequest('cancelled');
  }, [cancelActiveRequest]);

  const handlePlacementChange = useCallback((placement: PlacementFen) => {
    setBoard((current) => (current ? { ...current, placement, confidences: undefined } : current));
  }, []);

  const handleOrientationChange = useCallback((orientation: BoardOrientation) => {
    setBoard((current) => (current ? { ...current, orientation } : current));
  }, []);

  const handleBoardClose = useCallback(() => {
    setBoard(null);
  }, []);

  const inFlight =
    status.phase === 'capturing' ||
    status.phase === 'loading-model' ||
    status.phase === 'recognizing';
  const selectionAvailable = documentHandle !== null && pageInfo !== null && recognizer !== null;

  return (
    <div className="study-workspace" data-testid="study-workspace" ref={workspaceRef}>
      <div className="study-toolbar" role="group" aria-label="Diagram selection">
        <button
          type="button"
          data-testid="selection-toggle"
          aria-pressed={selectionActive}
          disabled={!selectionAvailable}
          onClick={() => {
            setSelectionActive((active) => !active);
          }}
        >
          {selectionActive ? 'Selection mode on' : 'Select a diagram'}
        </button>
        {inFlight ? (
          <button type="button" data-testid="recognition-cancel" onClick={handleCancelClick}>
            Cancel recognition
          </button>
        ) : null}
        <p
          className="recognition-status"
          role="status"
          data-testid="recognition-status"
          data-phase={status.phase}
          data-total-ms={status.timing ? String(Math.round(status.timing.totalMs)) : undefined}
          data-inference-ms={
            status.timing ? String(Math.round(status.timing.inferenceMs)) : undefined
          }
          data-cold-start={status.timing ? String(status.timing.coldStart) : undefined}
          data-reliable={status.reliable === undefined ? undefined : String(status.reliable)}
          data-recognizer-version={status.recognizerVersion ?? recognizer?.version}
        >
          {status.message}
        </p>
      </div>
      <PdfReader
        {...(openDocument ? { openDocument } : {})}
        selectionActive={selectionActive}
        onDocumentChange={handleDocumentChange}
        onPageDisplayed={handlePageDisplayed}
        renderOverlay={(info) => (
          <SelectionLayer
            active={selectionActive}
            displaySize={{ width: info.displayWidth, height: info.displayHeight }}
            onSelect={handleSelect}
            onCancel={() => {
              setSelectionActive(false);
            }}
          />
        )}
      />
      {board ? (
        <FloatingBoard
          {...(board.defaultPosition ? { defaultPosition: board.defaultPosition } : {})}
          placement={board.placement}
          orientation={board.orientation}
          confidences={board.confidences}
          reliable={board.reliable}
          status={status.phase === 'done' ? status.message : undefined}
          onPlacementChange={handlePlacementChange}
          onOrientationChange={handleOrientationChange}
          onClose={handleBoardClose}
        />
      ) : null}
    </div>
  );
}
