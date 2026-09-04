/**
 * Integration test for the in-memory walking slice. The reader gets a fake
 * document handle, capture is stubbed, and the recognizer is the scripted fake
 * that the browser E2E path also uses, so this proves the wiring rules:
 * request identity, cancellation, staleness after a page change, and that a
 * user edit is never overwritten by a late result.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { capturePdfRegion } from '../capture/capturePdfRegion';
import type { PdfDocumentHandle, RenderedPage, RenderPageOptions } from '../reader/pdfDocument';
import { createScriptedRecognizer, type FakeRecognizerScript } from '../recognition/fakeRecognizer';
import type { CapturedRegion, DiagramRecognizer } from './contracts';
import { StudyWorkspace } from './StudyWorkspace';

const PLACEMENT_A = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';
const PLACEMENT_B = '4k3/8/8/8/8/8/8/4K3';

function createFakeHandle(pageCount = 2): PdfDocumentHandle {
  return {
    pageCount,
    getPageSize: () => Promise.resolve({ widthPt: 612, heightPt: 792 }),
    renderPage: (_pageIndex: number, opts: RenderPageOptions) =>
      Promise.resolve<RenderedPage>({
        canvas: {} as unknown as HTMLCanvasElement,
        width: Math.round(612 * opts.scale),
        height: Math.round(792 * opts.scale),
        release: vi.fn(),
      }),
    dispose: vi.fn(),
  };
}

const fakeCapture: typeof capturePdfRegion = (_doc, locator, normalizedRect, options) => {
  if (options.signal.aborted) {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return Promise.reject(error);
  }
  const region: CapturedRegion = {
    width: 64,
    height: 64,
    data: new Uint8ClampedArray(64 * 64 * 4),
    sourceRect: { x: 0, y: 0, width: 64, height: 64 },
    normalizedRect,
    locator,
  };
  return Promise.resolve(region);
};

function makePdfFile(): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'book.pdf', {
    type: 'application/pdf',
  });
}

interface Harness {
  readonly recognizer: DiagramRecognizer;
}

function renderWorkspace(script: FakeRecognizerScript): Harness {
  const recognizer = createScriptedRecognizer(script);
  const openDocument = vi.fn().mockImplementation(() => Promise.resolve(createFakeHandle()));
  render(
    <StudyWorkspace
      recognizerFactory={() => recognizer}
      capture={fakeCapture}
      openDocument={openDocument}
    />,
  );
  return { recognizer };
}

async function openBookOnPage(pageIndex: number): Promise<void> {
  await userEvent.upload(screen.getByTestId('pdf-open-input'), makePdfFile());
  await waitFor(() => {
    expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent('Page 1 of 2');
  });
  await waitFor(() => {
    expect(screen.getByTestId('selection-toggle')).toBeEnabled();
  });
  for (let i = 0; i < pageIndex; i += 1) {
    await userEvent.click(screen.getByTestId('pdf-page-next'));
  }
  await waitFor(() => {
    expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent(
      `Page ${String(pageIndex + 1)} of 2`,
    );
  });
}

/** Turns selection mode on and confirms the default keyboard rectangle. */
async function selectDefaultRectangle(): Promise<void> {
  const toggle = screen.getByTestId('selection-toggle');
  if (toggle.getAttribute('aria-pressed') !== 'true') {
    await userEvent.click(toggle);
  }
  const layer = screen.getByTestId('selection-layer');
  expect(layer).toHaveAttribute('data-active', 'true');
  layer.focus();
  fireEvent.keyDown(layer, { key: 'ArrowRight' });
  fireEvent.keyDown(layer, { key: 'Enter' });
}

function status(): HTMLElement {
  return screen.getByTestId('recognition-status');
}

// jsdom + Testing Library user events make the multi-step journeys slow on CI machines.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StudyWorkspace', () => {
  it('starts idle with selection unavailable until a book is open', () => {
    renderWorkspace({ steps: [{ outcome: 'no-board' }] });
    expect(status()).toHaveAttribute('data-phase', 'idle');
    expect(screen.getByTestId('selection-toggle')).toBeDisabled();
    expect(screen.queryByTestId('floating-board')).not.toBeInTheDocument();
  });

  it('runs the full path: select, recognize, show the board, edit, flip, close', async () => {
    renderWorkspace({
      steps: [
        {
          delayMs: 0,
          outcome: 'board',
          placement: PLACEMENT_A,
          reliable: true,
          proposedOrientation: 'black',
        },
      ],
    });
    await openBookOnPage(1);
    await selectDefaultRectangle();

    // Selection mode turns itself off once a rectangle is confirmed.
    expect(screen.getByTestId('selection-toggle')).toHaveAttribute('aria-pressed', 'false');

    await waitFor(() => {
      expect(status()).toHaveAttribute('data-phase', 'done');
    });
    expect(status()).toHaveAttribute('data-reliable', 'true');
    expect(status()).toHaveAttribute('data-cold-start', 'true');
    expect(status().getAttribute('data-total-ms')).toMatch(/^\d+$/);

    const board = screen.getByTestId('floating-board');
    expect(board).toHaveAttribute('data-placement', PLACEMENT_A);
    expect(board).toHaveAttribute('data-orientation', 'black');

    await userEvent.click(screen.getByTestId('palette-wN'));
    await userEvent.click(screen.getByTestId('board-square-e4'));
    expect(board).toHaveAttribute(
      'data-placement',
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B1N3/5N2/PPPP1PPP/RNBQK2R',
    );

    await userEvent.click(screen.getByTestId('board-flip'));
    expect(board).toHaveAttribute('data-orientation', 'white');

    await userEvent.click(screen.getByTestId('board-close'));
    expect(screen.queryByTestId('floating-board')).not.toBeInTheDocument();
  });

  it('reports no-board and error outcomes without opening a board', async () => {
    renderWorkspace({
      steps: [
        { delayMs: 0, outcome: 'no-board' },
        { delayMs: 0, outcome: 'error', errorCode: 'runtime-failure' },
      ],
    });
    await openBookOnPage(1);

    await selectDefaultRectangle();
    await waitFor(() => {
      expect(status()).toHaveAttribute('data-phase', 'no-board');
    });
    expect(screen.queryByTestId('floating-board')).not.toBeInTheDocument();

    await selectDefaultRectangle();
    await waitFor(() => {
      expect(status()).toHaveAttribute('data-phase', 'error');
    });
    expect(status()).toHaveTextContent(/failed/i);
    expect(screen.queryByTestId('floating-board')).not.toBeInTheDocument();
  });

  it('cancel aborts the pending request and no board appears', async () => {
    renderWorkspace({ steps: [{ outcome: 'never' }] });
    await openBookOnPage(1);
    await selectDefaultRectangle();

    await waitFor(() => {
      expect(status()).toHaveAttribute('data-phase', 'recognizing');
    });
    await userEvent.click(screen.getByTestId('recognition-cancel'));
    expect(status()).toHaveAttribute('data-phase', 'cancelled');
    expect(screen.queryByTestId('recognition-cancel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('floating-board')).not.toBeInTheDocument();
  });

  it('a page change makes the pending request stale so its result is never applied', async () => {
    renderWorkspace({
      // Long enough that the page change below always lands before the fake settles,
      // even on a loaded CI machine; the wait after it is what proves staleness.
      steps: [{ delayMs: 2000, outcome: 'board', placement: PLACEMENT_A }],
    });
    await openBookOnPage(1);
    await selectDefaultRectangle();
    await waitFor(() => {
      expect(status()).toHaveAttribute('data-phase', 'recognizing');
    });

    await userEvent.click(screen.getByTestId('pdf-page-prev'));
    await waitFor(() => {
      expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent('Page 1 of 2');
    });
    await waitFor(() => {
      expect(status()).toHaveAttribute('data-phase', 'cancelled');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2300));
    });
    expect(status()).toHaveAttribute('data-phase', 'cancelled');
    expect(screen.queryByTestId('floating-board')).not.toBeInTheDocument();
  });

  it('a newer selection wins over a slower one and a user edit survives the late result', async () => {
    renderWorkspace({
      steps: [
        { delayMs: 2000, outcome: 'board', placement: PLACEMENT_A },
        { delayMs: 0, outcome: 'board', placement: PLACEMENT_B },
      ],
    });
    await openBookOnPage(1);

    await selectDefaultRectangle();
    await waitFor(() => {
      expect(status()).toHaveAttribute('data-phase', 'recognizing');
    });
    await selectDefaultRectangle();

    await waitFor(() => {
      expect(screen.getByTestId('floating-board')).toHaveAttribute('data-placement', PLACEMENT_B);
    });

    await userEvent.click(screen.getByTestId('palette-wQ'));
    await userEvent.click(screen.getByTestId('board-square-d1'));
    const edited = '4k3/8/8/8/8/8/8/3QK3';
    expect(screen.getByTestId('floating-board')).toHaveAttribute('data-placement', edited);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2300));
    });
    expect(screen.getByTestId('floating-board')).toHaveAttribute('data-placement', edited);
    expect(status()).toHaveAttribute('data-phase', 'done');
  });

  it('disposes the recognizer on unmount', async () => {
    const recognizer = createScriptedRecognizer({ steps: [{ outcome: 'never' }] });
    const dispose = vi.spyOn(recognizer, 'dispose');
    const { unmount } = render(
      <StudyWorkspace
        recognizerFactory={() => recognizer}
        capture={fakeCapture}
        openDocument={() => Promise.resolve(createFakeHandle())}
      />,
    );
    await Promise.resolve();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
