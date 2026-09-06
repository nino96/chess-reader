// @ts-check
import { FAMILIES } from './sources.mjs';
export const SPLITS = {
  train: { count: 4096, seed: 3830 },
  dev: { count: 384, seed: 3831 },
  test: { count: 384, seed: 3832 },
};
/** @type {Array<{id: string, style: 'flat'|'hatch'|'halftone', reduction: number, speckle: boolean}>} */
export const CONDITIONS = [
  { id: 'pristine', style: 'flat', reduction: 1, speckle: false },
  { id: 'hatch', style: 'hatch', reduction: 0.82, speckle: true },
  { id: 'low-fidelity', style: 'halftone', reduction: 0.64, speckle: true },
];
/** @typedef {keyof typeof SPLITS} Split */
/** @param {string} split */
export function familiesFor(split) {
  return Object.entries(FAMILIES)
    .filter(([, v]) => v.split === split)
    .map(([k]) => k);
}
/** @param {Split} split @param {number} index */
export function assignment(split, index) {
  const families = familiesFor(split);
  if (!families.length) throw new Error('No families');
  const condition = CONDITIONS[Math.floor(index / families.length) % CONDITIONS.length];
  const family = families[index % families.length];
  if (!condition || !family) throw new Error('Incomplete assignment');
  return {
    family,
    condition,
  };
}
/** @param {Split} split @param {number} index */
export function boardSeed(split, index) {
  const base = SPLITS[split].seed;
  return (base ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
}
