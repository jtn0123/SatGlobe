import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixedGitExecutable, fixedPackageExecutable } from '../lib/fixed-executables';

describe('fixed executable resolution', () => {
  it('resolves package CLIs from the locked local installation', () => {
    const tsx = fixedPackageExecutable('tsx');
    const vitest = fixedPackageExecutable('vitest');

    expect(isAbsolute(tsx)).toBe(true);
    expect(isAbsolute(vitest)).toBe(true);
    expect(tsx).toMatch(/[\\/]node_modules[\\/]tsx[\\/]/u);
    expect(vitest).toMatch(/[\\/]node_modules[\\/]vitest[\\/]/u);
  });

  it('resolves Git from an explicit system location', () => {
    expect(fixedGitExecutable()).toMatch(/^(?:[A-Z]:\\|\/)/u);
  });
});
