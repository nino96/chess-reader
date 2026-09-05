/** Verify protected historical inputs and production files against issue #38's base. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const base = 'ccc575ffecbc98dd10bd8f497887d0e481bc1b77';
const protectedPaths = [
  'packages/test-fixtures',
  'docs/eval-baselines',
  'apps/web/src',
  'pnpm-lock.yaml',
];
const entries = execFileSync(
  'git',
  ['ls-tree', '-r', '--name-only', base, '--', ...protectedPaths],
  { cwd: root, encoding: 'utf8' },
)
  .trim()
  .split('\n');
if (entries.length < 100) throw new Error('Incomplete preservation inventory');
const identities = entries.map((path) => {
  const expected = execFileSync('git', ['show', `${base}:${path}`], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
  const actual = readFileSync(resolve(root, path));
  if (!actual.equals(expected)) throw new Error('Protected source or historical baseline changed');
  return { path, sha256: createHash('sha256').update(actual).digest('hex'), bytes: actual.length };
});
const report = {
  schemaVersion: 1,
  command: 'node experiments/recognition-training/verify-preservation.ts',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  baseCommit: base,
  status: 'passed',
  protectedFiles: identities.length,
  inventorySha256: createHash('sha256').update(JSON.stringify(identities)).digest('hex'),
  protectedPaths,
};
mkdirSync(resolve(import.meta.dirname, 'reports'), { recursive: true });
writeFileSync(
  resolve(import.meta.dirname, 'reports/preservation.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
