// @ts-check
/**
 * Fails the build when a production dependency's license is outside the
 * allowlist recorded in `docs/dependency-policy.md`. See that document for
 * the rationale and for how to record a reviewed exception.
 *
 * Usage: `node scripts/check-licenses.mjs` (wired to `pnpm check:licenses`).
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * @typedef {{ readonly type: 'plain', readonly license: string }} PlainLicenseExpression
 * @typedef {{ readonly type: 'or', readonly licenses: readonly string[] }} OrLicenseExpression
 * @typedef {{ readonly type: 'and', readonly licenses: readonly string[] }} AndLicenseExpression
 * @typedef {PlainLicenseExpression | OrLicenseExpression | AndLicenseExpression} ParsedLicenseExpression
 */

/**
 * @typedef {object} LicensedPackage
 * @property {string} name
 * @property {readonly string[]} versions
 */

/**
 * @typedef {{ readonly [licenseExpression: string]: readonly LicensedPackage[] }} LicensesByExpression
 */

/**
 * @typedef {object} LicenseException
 * @property {string} name
 * @property {string} license
 * @property {string} issue
 */

/**
 * @typedef {object} LicenseViolation
 * @property {string} name
 * @property {readonly string[]} versions
 * @property {string} license
 */

/**
 * License expressions allowed in shipped (production) code. See
 * `docs/dependency-policy.md` for the reasoning behind each entry and for
 * licenses that require manual review instead of being added here.
 */
const ALLOWLIST = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'Python-2.0',
  'CC-BY-4.0',
]);

/**
 * Reviewed exceptions. Each entry must cite the issue that recorded the
 * review decision. Empty until a first exception is actually needed.
 *
 * @type {readonly LicenseException[]}
 */
const EXCEPTIONS = [];

/**
 * Parses a (possibly compound) SPDX-style license expression as reported by
 * `pnpm licenses list --json`. Only simple, single-operator `OR`/`AND`
 * expressions are supported, optionally wrapped in one pair of parentheses
 * (for example `(MIT OR Apache-2.0)`). Anything else is treated as a single
 * plain license identifier.
 *
 * @param {string} licenseExpression
 * @returns {ParsedLicenseExpression}
 */
export function parseLicenseExpression(licenseExpression) {
  const trimmed = licenseExpression.trim();
  const unwrapped =
    trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1).trim() : trimmed;

  if (unwrapped.includes(' OR ')) {
    return { type: 'or', licenses: unwrapped.split(' OR ').map((part) => part.trim()) };
  }
  if (unwrapped.includes(' AND ')) {
    return { type: 'and', licenses: unwrapped.split(' AND ').map((part) => part.trim()) };
  }
  return { type: 'plain', license: unwrapped };
}

/**
 * Decides whether a license expression is fully covered by the allowlist. An
 * `OR` expression passes when at least one alternative is allowed; an `AND`
 * expression passes only when every part is allowed.
 *
 * @param {string} licenseExpression
 * @param {ReadonlySet<string>} allowlist
 * @returns {boolean}
 */
export function isAllowed(licenseExpression, allowlist) {
  const parsed = parseLicenseExpression(licenseExpression);
  switch (parsed.type) {
    case 'plain':
      return allowlist.has(parsed.license);
    case 'or':
      return parsed.licenses.some((license) => allowlist.has(license));
    case 'and':
      return parsed.licenses.every((license) => allowlist.has(license));
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is LicensedPackage}
 */
function isLicensedPackageShape(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const name = value['name'];
  const versions = value['versions'];
  return (
    typeof name === 'string' &&
    Array.isArray(versions) &&
    versions.every((version) => typeof version === 'string')
  );
}

/**
 * Validates that `pnpm licenses list --json` produced the documented shape:
 * an object keyed by license expression, whose values are arrays of package
 * entries carrying at least a string `name` and a string-array `versions`.
 * Throws a descriptive `TypeError` otherwise so a broken/changed `pnpm`
 * output fails loudly instead of silently reporting zero violations.
 *
 * @param {unknown} data
 * @returns {LicensesByExpression}
 */
function validateLicensesShape(data) {
  if (!isPlainObject(data)) {
    throw new TypeError(
      'Expected `pnpm licenses list --json` output to be an object keyed by license expression.',
    );
  }

  /** @type {Record<string, LicensedPackage[]>} */
  const result = {};
  for (const [licenseExpression, packages] of Object.entries(data)) {
    if (!Array.isArray(packages)) {
      throw new TypeError(
        `Expected license group "${licenseExpression}" to be an array of packages.`,
      );
    }
    /** @type {LicensedPackage[]} */
    const validatedPackages = [];
    for (const candidate of packages) {
      if (!isLicensedPackageShape(candidate)) {
        throw new TypeError(
          `Expected each package under license "${licenseExpression}" to have a string "name" and a string-array "versions".`,
        );
      }
      validatedPackages.push(candidate);
    }
    result[licenseExpression] = validatedPackages;
  }
  return result;
}

/**
 * Compares every production package's license expression against the
 * allowlist, applying reviewed exceptions first. Throws if `licensesData`
 * does not match the shape produced by `pnpm licenses list --json`.
 *
 * @param {unknown} licensesData
 * @param {ReadonlySet<string>} allowlist
 * @param {readonly LicenseException[]} exceptions
 * @returns {LicenseViolation[]}
 */
export function findViolations(licensesData, allowlist, exceptions) {
  const validated = validateLicensesShape(licensesData);

  /** @type {LicenseViolation[]} */
  const violations = [];
  for (const [licenseExpression, packages] of Object.entries(validated)) {
    for (const pkg of packages) {
      const isExempt = exceptions.some(
        (exception) => exception.name === pkg.name && exception.license === licenseExpression,
      );
      if (isExempt) {
        continue;
      }
      if (!isAllowed(licenseExpression, allowlist)) {
        violations.push({ name: pkg.name, versions: pkg.versions, license: licenseExpression });
      }
    }
  }
  return violations;
}

/**
 * @param {string} value
 * @param {number} width
 * @returns {string}
 */
function pad(value, width) {
  return value.length >= width ? `${value} ` : value.padEnd(width);
}

/**
 * @param {readonly LicenseViolation[]} violations
 * @returns {void}
 */
function printViolationsTable(violations) {
  console.error('The following production dependencies use a license outside the allowed list:');
  console.error('');
  const header = `${pad('package', 30)}${pad('version(s)', 20)}license`;
  console.error(header);
  console.error('-'.repeat(header.length));
  for (const violation of violations) {
    console.error(
      `${pad(violation.name, 30)}${pad(violation.versions.join(', '), 20)}${violation.license}`,
    );
  }
  console.error('');
  console.error(
    'See docs/dependency-policy.md for the allowlist and how to record a reviewed exception (name, license, issue).',
  );
}

/**
 * Runs `pnpm licenses list --json --prod` and returns the parsed (but not
 * yet shape-validated) JSON output. Windows cannot execute `pnpm`/`pnpm.cmd`
 * directly without a shell, so on `win32` the full command line is passed as
 * a single string with `shell: true`; on POSIX platforms the executable and
 * arguments are passed separately with no shell.
 *
 * @returns {unknown}
 */
function getProductionLicenses() {
  const pnpmArgs = ['licenses', 'list', '--json', '--prod'];
  const isWindows = process.platform === 'win32';

  /** @type {string} */
  let stdout;
  try {
    stdout = isWindows
      ? execFileSync(['pnpm', ...pnpmArgs].join(' '), [], {
          encoding: 'utf8',
          shell: true,
          windowsHide: true,
        })
      : execFileSync('pnpm', pnpmArgs, { encoding: 'utf8' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run "pnpm licenses list --json --prod": ${message}`);
  }

  try {
    return /** @type {unknown} */ (JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse "pnpm licenses list --json --prod" output as JSON: ${message}`,
    );
  }
}

/**
 * @returns {void}
 */
function main() {
  try {
    const licensesData = getProductionLicenses();
    const violations = findViolations(licensesData, ALLOWLIST, EXCEPTIONS);
    if (violations.length > 0) {
      printViolationsTable(violations);
      process.exitCode = 1;
      return;
    }

    const validated = validateLicensesShape(licensesData);
    const packageCount = Object.values(validated).reduce(
      (total, packages) => total + packages.length,
      0,
    );
    console.log(
      `check:licenses passed - ${packageCount} production package(s), all licenses allowed.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`check:licenses failed: ${message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
const isMainModule =
  invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath);
if (isMainModule) {
  main();
}
