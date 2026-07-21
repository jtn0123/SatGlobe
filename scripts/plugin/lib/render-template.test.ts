import { kebabCase } from './render-template';

describe('plugin template name normalization', () => {
  it('removes the conventional prefix and surrounding separators', () => {
    expect(kebabCase('keeptrack-plugin- My Example Plugin ')).toBe('my-example-plugin');
  });

  it('handles long runs of separators without regex backtracking', () => {
    expect(kebabCase(`${'-'.repeat(100_000)}name${'-'.repeat(100_000)}`)).toBe('name');
  });
});
