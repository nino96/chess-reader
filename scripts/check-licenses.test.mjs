// @ts-check
import { describe, expect, it } from 'vitest';

import { findViolations, isAllowed, parseLicenseExpression } from './check-licenses.mjs';

const ALLOWLIST = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause']);

describe('parseLicenseExpression', () => {
  it('parses a plain license identifier', () => {
    expect(parseLicenseExpression('MIT')).toEqual({ type: 'plain', license: 'MIT' });
  });

  it('parses a parenthesized OR expression', () => {
    expect(parseLicenseExpression('(MIT OR Apache-2.0)')).toEqual({
      type: 'or',
      licenses: ['MIT', 'Apache-2.0'],
    });
  });

  it('parses an OR expression without surrounding parentheses', () => {
    expect(parseLicenseExpression('MIT OR Apache-2.0')).toEqual({
      type: 'or',
      licenses: ['MIT', 'Apache-2.0'],
    });
  });

  it('parses a parenthesized AND expression', () => {
    expect(parseLicenseExpression('(MIT AND Apache-2.0)')).toEqual({
      type: 'and',
      licenses: ['MIT', 'Apache-2.0'],
    });
  });
});

describe('isAllowed', () => {
  it('allows a plain license on the allowlist', () => {
    expect(isAllowed('MIT', ALLOWLIST)).toBe(true);
  });

  it('rejects a plain license not on the allowlist', () => {
    expect(isAllowed('GPL-3.0-only', ALLOWLIST)).toBe(false);
  });

  it('allows an OR expression when at least one alternative is allowed', () => {
    expect(isAllowed('(MIT OR GPL-3.0-only)', ALLOWLIST)).toBe(true);
  });

  it('rejects an OR expression when no alternative is allowed', () => {
    expect(isAllowed('(GPL-3.0-only OR AGPL-3.0-only)', ALLOWLIST)).toBe(false);
  });

  it('allows an AND expression only when every part is allowed', () => {
    expect(isAllowed('(MIT AND Apache-2.0)', ALLOWLIST)).toBe(true);
    expect(isAllowed('(MIT AND GPL-3.0-only)', ALLOWLIST)).toBe(false);
  });
});

describe('findViolations', () => {
  const validData = {
    MIT: [{ name: 'react', versions: ['19.2.8'] }],
    'GPL-3.0-only': [{ name: 'bad-package', versions: ['1.0.0'] }],
  };

  it('reports packages whose license is outside the allowlist', () => {
    const violations = findViolations(validData, ALLOWLIST, []);
    expect(violations).toEqual([
      { name: 'bad-package', versions: ['1.0.0'], license: 'GPL-3.0-only' },
    ]);
  });

  it('does not report packages covered by the allowlist', () => {
    const violations = findViolations({ MIT: validData.MIT }, ALLOWLIST, []);
    expect(violations).toEqual([]);
  });

  it('honours a reviewed exception matching name and license', () => {
    const violations = findViolations(validData, ALLOWLIST, [
      { name: 'bad-package', license: 'GPL-3.0-only', issue: 'https://example.invalid/issues/1' },
    ]);
    expect(violations).toEqual([]);
  });

  it('does not apply an exception whose name or license does not match', () => {
    const violations = findViolations(validData, ALLOWLIST, [
      { name: 'other-package', license: 'GPL-3.0-only', issue: 'https://example.invalid/issues/1' },
    ]);
    expect(violations).toEqual([
      { name: 'bad-package', versions: ['1.0.0'], license: 'GPL-3.0-only' },
    ]);
  });

  it('rejects a non-object top-level shape with a clear error', () => {
    expect(() => findViolations(null, ALLOWLIST, [])).toThrow(/object/i);
    expect(() => findViolations('not-json-shaped', ALLOWLIST, [])).toThrow(/object/i);
  });

  it('rejects a license group that is not an array', () => {
    expect(() => findViolations({ MIT: 'not-an-array' }, ALLOWLIST, [])).toThrow(/array/i);
  });

  it('rejects a package entry missing a valid name or versions', () => {
    expect(() => findViolations({ MIT: [{ name: 'x' }] }, ALLOWLIST, [])).toThrow(/versions/i);
    expect(() => findViolations({ MIT: [{ versions: ['1.0.0'] }] }, ALLOWLIST, [])).toThrow(
      /versions/i,
    );
  });
});
