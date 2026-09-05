// @ts-check

import { CLASS_BY_FEN, DATASET_SEED } from '../source-lock.mjs';

/** @param {number} seed */
export function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/** @param {number} min @param {number} max @param {() => number} random */
export function integer(min, max, random) {
  return min + Math.floor(random() * (max - min + 1));
}

/** @param {'train' | 'dev' | 'test'} split @param {number} index */
export function sampleSeed(split, index) {
  const splitSalt = split === 'train' ? 0 : split === 'dev' ? 0x5f3759df : 0x7f4a7c15;
  return (DATASET_SEED ^ ((index + 1) * 0x9e3779b9) ^ splitSalt) >>> 0;
}

/** @param {() => number} random */
export function randomPosition(random) {
  const labels = Array.from({ length: 64 }, () => 0);
  /** @param {string} piece */
  const place = (piece) => {
    let square = integer(0, 63, random);
    while (labels[square] !== 0) square = integer(0, 63, random);
    const classIndex = CLASS_BY_FEN[piece];
    if (classIndex === undefined) throw new Error(`No class for ${piece}`);
    labels[square] = classIndex;
  };
  place('K');
  place('k');
  const piecePool = ['Q', 'R', 'B', 'N', 'P', 'P', 'P', 'q', 'r', 'b', 'n', 'p', 'p', 'p'];
  const pieces = integer(2, 30, random);
  for (let index = 0; index < pieces; index += 1) {
    const piece = piecePool[integer(0, piecePool.length - 1, random)];
    if (piece === undefined) throw new Error('Piece pool unexpectedly empty');
    place(piece);
  }
  return labels;
}
