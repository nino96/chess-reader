// @ts-check

export const LILA_REVISION = '2e48c25007bc3344411811a24cd6cab666c67cbf';
export const LIVIUS_REVISION = 'af40ea51e87eddee1ae7ee35ae312893a1271233';
export const PIECE_CODES = /** @type {const} */ ([
  'wK',
  'wQ',
  'wR',
  'wB',
  'wN',
  'wP',
  'bK',
  'bQ',
  'bR',
  'bB',
  'bN',
  'bP',
]);
export const CLASS_ORDER = '1KQRBNPkqrbnp';

/** @typedef {'train' | 'dev' | 'test'} Split */
/** @typedef {'lila-svg' | 'github-svg' | 'oga-single-color-svg' | 'oga-png-archive'} SourceKind */
/** @typedef {{split: Split, artistGroup: string, license: string, kind: SourceKind, revision: string, sourcePage: string, path?: string, group?: string, caveat?: string}} Source */

export const FAMILIES = /** @type {Readonly<Record<string, Source>>} */ (
  Object.freeze({
    chessnut: lila('train', 'Alexis Luengas', 'Apache-2.0', 'chessnut'),
    fantasy: lila('train', 'Maurizio Monge', 'MIT', 'fantasy', 'Monge'),
    cburnett: lila('train', 'Colin M.L. Burnett', 'GPL-2.0-or-later', 'cburnett'),
    merida: lila('train', 'Armando Hernandez Marroquin', 'GPL-2.0-or-later', 'merida'),
    'kiwen-suwi': lila('train', 'neverRare', 'CC-BY-4.0', 'kiwen-suwi'),
    livius: {
      split: 'train',
      artistGroup: 'Martin Sedlák',
      license: 'CC0-1.0',
      kind: 'github-svg',
      revision: LIVIUS_REVISION,
      sourcePage: `https://github.com/kmar/chess_svg_piece_sets/tree/${LIVIUS_REVISION}/livius`,
    },
    mpchess: lila('dev', 'Maxime Chupin', 'GPL-3.0-or-later', 'mpchess'),
    femrek: {
      split: 'dev',
      artistGroup: 'femrek',
      license: 'CC0-1.0',
      kind: 'oga-single-color-svg',
      revision: 'page-published-2024-03-18; bytes locked by sha256',
      sourcePage: 'https://opengameart.org/content/chess-pieces-in-svg-format',
    },
    lyricsz: {
      split: 'dev',
      artistGroup: 'Lyricsz',
      license: 'CC0-1.0',
      kind: 'oga-png-archive',
      revision: 'page-published-2025-09-05; archive locked by sha256',
      sourcePage: 'https://opengameart.org/content/2d-chess',
    },
    totoy: lila(
      'test',
      'Kosal Sen',
      'CC-BY-4.0',
      'totoy',
      undefined,
      'Lila lists this CC-BY-4.0 row under Exceptions (non-free); preserve that caveat.',
    ),
    papercut: lila(
      'test',
      'Nikolay Anzarov',
      'CC-BY-4.0',
      'papercut',
      undefined,
      'Lila lists this CC-BY-4.0 row under Exceptions (non-free); preserve that caveat.',
    ),
    pirouetti: lila('test', 'pirouetti', 'AGPL-3.0-or-later', 'pirouetti'),
  })
);

/**
 * @param {Split} split
 * @param {string} artistGroup
 * @param {string} license
 * @param {string} path
 * @param {string | undefined} [group]
 * @param {string | undefined} [caveat]
 * @returns {Source}
 */
function lila(split, artistGroup, license, path, group, caveat) {
  return {
    split,
    artistGroup,
    license,
    kind: 'lila-svg',
    revision: LILA_REVISION,
    sourcePage: `https://github.com/lichess-org/lila/tree/${LILA_REVISION}/public/piece/${path}`,
    path,
    ...(group ? { group } : {}),
    ...(caveat ? { caveat } : {}),
  };
}

export const OGA_FILES = Object.freeze({
  B: 'https://opengameart.org/sites/default/files/bishop_0.svg',
  K: 'https://opengameart.org/sites/default/files/king_1.svg',
  N: 'https://opengameart.org/sites/default/files/knight_3.svg',
  P: 'https://opengameart.org/sites/default/files/pawn.svg',
  Q: 'https://opengameart.org/sites/default/files/queen.svg',
  R: 'https://opengameart.org/sites/default/files/rok.svg',
});
export const LYRICSZ_ARCHIVE = 'https://opengameart.org/sites/default/files/chess_4.zip';
export const LYRICSZ_ARCHIVE_SHA256 =
  'd1b2845ce0d03d1ab924550f6804daafd0c358244f308636761f0454ce3d6309';
