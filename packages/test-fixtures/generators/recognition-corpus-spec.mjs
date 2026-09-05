// @ts-check
/**
 * Locked input matrix for recognition corpus v1 (issue #34).
 *
 * Keep this file declarative: the renderer consumes these exact values and the
 * corpus tests assert their coverage. Changing any value creates different
 * fixture bytes and requires a new corpus version rather than silently tuning v1.
 */

export const CORPUS_ID = 'printed-book-recognition';
export const CORPUS_VERSION = 1;
export const CORPUS_SEED = 0x34c0ffee;
export const PAGE_WIDTH = 768;
export const PAGE_HEIGHT = 1024;

export const POSITIONS = Object.freeze({
  italian: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R',
  queenlessMiddlegame: '2r2rk1/pp1b1ppp/2n1pn2/2pp4/3P4/2PBPN2/PP3PPP/2R2RK1',
  rookEndgame: '8/2p2pk1/3p2p1/1p1P4/1P3P2/2P3P1/5K2/4R3',
  pawnEndgame: '8/5pk1/3p2p1/3Pp3/4P3/5P2/5KPP/8',
  pawnless: '4r1k1/2q2rb1/2n3n1/8/3N4/2N2Q2/2R3B1/4R1K1',
  opening: 'rnbqk2r/pppp1ppp/5n2/4p3/2B1P1b1/5N2/PPPP1PPP/RNBQ1RK1',
  ambiguousPawnless: 'r5kr/8/8/3Nn3/3nN3/8/8/R5KR',
});

/** @typedef {'white' | 'black' | 'ambiguous'} Orientation */
/** @typedef {'flat' | 'hatch' | 'halftone'} SquareStyleKind */
/** @typedef {'sparse' | 'medium' | 'dense'} PatternDensity */
/**
 * @typedef {object} BoardSpec
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} size
 * @property {string} placement
 * @property {Orientation} orientation
 * @property {{kind: SquareStyleKind, gray?: number, angle?: 0 | 45 | 90 | 135, density?: PatternDensity}} style
 * @property {boolean} labels
 * @property {number} borderWidth
 */
/**
 * @typedef {object} PageSpec
 * @property {string} id
 * @property {readonly string[]} tags
 * @property {readonly BoardSpec[]} boards
 * @property {'book' | 'text-negative' | 'grid-negative' | 'partial'} layout
 * @property {number} [sourceLayoutSeedOffset]
 * @property {{lowResolution?: number, contrast?: number, speckle?: number, seedOffset?: number}} [degradation]
 */

/** @type {readonly PageSpec[]} */
export const PAGE_SPECS = Object.freeze([
  {
    id: 'flat-gray-middlegame-white',
    tags: [
      'complete-page',
      'flat',
      'grayscale',
      'middlegame',
      'white-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    sourceLayoutSeedOffset: 1,
    boards: [
      {
        id: 'board-1',
        x: 184,
        y: 270,
        size: 400,
        placement: POSITIONS.italian,
        orientation: 'white',
        style: { kind: 'flat', gray: 0.68 },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'flat-dark-endgame-black',
    tags: [
      'complete-page',
      'flat',
      'grayscale',
      'endgame',
      'black-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 398,
        y: 410,
        size: 320,
        placement: POSITIONS.rookEndgame,
        orientation: 'black',
        style: { kind: 'flat', gray: 0.48 },
        labels: true,
        borderWidth: 3,
      },
    ],
  },
  {
    id: 'hatch-0-dense-opening-white',
    tags: [
      'complete-page',
      'hatch',
      'hatch-0',
      'dense',
      'opening',
      'white-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 92,
        y: 350,
        size: 384,
        placement: POSITIONS.opening,
        orientation: 'white',
        style: { kind: 'hatch', angle: 0, density: 'dense' },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'hatch-45-sparse-middlegame-black',
    tags: [
      'complete-page',
      'hatch',
      'hatch-45',
      'sparse',
      'middlegame',
      'black-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 160,
        y: 245,
        size: 448,
        placement: POSITIONS.queenlessMiddlegame,
        orientation: 'black',
        style: { kind: 'hatch', angle: 45, density: 'sparse' },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'hatch-90-medium-endgame-white',
    tags: [
      'complete-page',
      'hatch',
      'hatch-90',
      'medium',
      'endgame',
      'white-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 430,
        y: 320,
        size: 288,
        placement: POSITIONS.pawnEndgame,
        orientation: 'white',
        style: { kind: 'hatch', angle: 90, density: 'medium' },
        labels: true,
        borderWidth: 1,
      },
    ],
  },
  {
    id: 'hatch-135-dense-pawnless-black',
    tags: [
      'complete-page',
      'hatch',
      'hatch-135',
      'dense',
      'pawnless',
      'black-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 90,
        y: 300,
        size: 352,
        placement: POSITIONS.pawnless,
        orientation: 'black',
        style: { kind: 'hatch', angle: 135, density: 'dense' },
        labels: true,
        borderWidth: 3,
      },
    ],
  },
  {
    id: 'halftone-middlegame-white',
    tags: [
      'complete-page',
      'halftone',
      'medium',
      'middlegame',
      'white-orientation',
      'labels',
      'no-border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 176,
        y: 300,
        size: 416,
        placement: POSITIONS.queenlessMiddlegame,
        orientation: 'white',
        style: { kind: 'halftone', density: 'medium' },
        labels: true,
        borderWidth: 0,
      },
    ],
  },
  {
    id: 'scan-low-resolution-flat-black',
    tags: [
      'complete-page',
      'flat',
      'low-resolution',
      'scan-degraded',
      'speckle',
      'endgame',
      'black-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    degradation: { lowResolution: 192, contrast: 0.82, speckle: 0.008, seedOffset: 8 },
    boards: [
      {
        id: 'board-1',
        x: 450,
        y: 360,
        size: 256,
        placement: POSITIONS.rookEndgame,
        orientation: 'black',
        style: { kind: 'flat', gray: 0.58 },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'scan-hatch-45-white',
    tags: [
      'complete-page',
      'hatch',
      'hatch-45',
      'medium',
      'scan-degraded',
      'low-contrast',
      'speckle',
      'middlegame',
      'white-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    degradation: { lowResolution: 384, contrast: 0.72, speckle: 0.014, seedOffset: 9 },
    boards: [
      {
        id: 'board-1',
        x: 216,
        y: 300,
        size: 336,
        placement: POSITIONS.italian,
        orientation: 'white',
        style: { kind: 'hatch', angle: 45, density: 'medium' },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'two-boards-flat-hatch',
    tags: [
      'complete-page',
      'multiple-boards',
      'flat',
      'hatch',
      'hatch-90',
      'sparse',
      'white-orientation',
      'black-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 80,
        y: 155,
        size: 280,
        placement: POSITIONS.opening,
        orientation: 'white',
        style: { kind: 'flat', gray: 0.64 },
        labels: true,
        borderWidth: 2,
      },
      {
        id: 'board-2',
        x: 444,
        y: 615,
        size: 240,
        placement: POSITIONS.pawnEndgame,
        orientation: 'black',
        style: { kind: 'hatch', angle: 90, density: 'sparse' },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'two-boards-halftone-ambiguous',
    tags: [
      'complete-page',
      'multiple-boards',
      'halftone',
      'hatch',
      'hatch-135',
      'dense',
      'pawnless',
      'ambiguous-orientation',
      'piece-only-ambiguity',
      'white-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    boards: [
      {
        id: 'board-1',
        x: 60,
        y: 180,
        size: 320,
        placement: POSITIONS.ambiguousPawnless,
        orientation: 'ambiguous',
        style: { kind: 'halftone', density: 'dense' },
        labels: false,
        borderWidth: 1,
      },
      {
        id: 'board-2',
        x: 420,
        y: 620,
        size: 280,
        placement: POSITIONS.pawnless,
        orientation: 'white',
        style: { kind: 'hatch', angle: 135, density: 'dense' },
        labels: true,
        borderWidth: 3,
      },
    ],
  },
  {
    id: 'negative-text-only',
    tags: ['complete-page', 'negative', 'text-only', 'no-board'],
    layout: 'text-negative',
    boards: [],
  },
  {
    id: 'negative-table-grid',
    tags: ['complete-page', 'negative', 'grid', 'table', 'no-board'],
    layout: 'grid-negative',
    boards: [],
  },
  {
    id: 'partial-board-crop',
    tags: ['complete-page', 'partial-board', 'hatch', 'hatch-45', 'sparse', 'not-complete-truth'],
    layout: 'partial',
    boards: [
      {
        id: 'partial-1',
        x: -90,
        y: 300,
        size: 400,
        placement: POSITIONS.italian,
        orientation: 'white',
        style: { kind: 'hatch', angle: 45, density: 'sparse' },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'matched-hatch-45-middlegame-white',
    tags: [
      'complete-page',
      'matched-style-pair',
      'hatch',
      'hatch-45',
      'medium',
      'middlegame',
      'white-orientation',
      'labels',
      'border',
    ],
    layout: 'book',
    sourceLayoutSeedOffset: 1,
    boards: [
      {
        id: 'board-1',
        x: 184,
        y: 270,
        size: 400,
        placement: POSITIONS.italian,
        orientation: 'white',
        style: { kind: 'hatch', angle: 45, density: 'medium' },
        labels: true,
        borderWidth: 2,
      },
    ],
  },
  {
    id: 'partial-board-bottom-ranks',
    tags: [
      'complete-page',
      'partial-board',
      'flat',
      'grayscale',
      'missing-bottom-ranks',
      'not-complete-truth',
    ],
    layout: 'partial',
    boards: [
      {
        id: 'partial-1',
        x: 192,
        y: 842,
        size: 384,
        placement: POSITIONS.rookEndgame,
        orientation: 'black',
        style: { kind: 'flat', gray: 0.58 },
        labels: false,
        borderWidth: 0,
      },
    ],
  },
]);
