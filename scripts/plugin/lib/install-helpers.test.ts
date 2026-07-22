import { deriveName } from './install-helpers';

describe('plugin install name derivation', () => {
  it('normalizes repository URLs and trailing separators', () => {
    expect(deriveName('https://github.com/example/My Plugin.git////')).toBe('my-plugin');
  });

  it('handles a very long malformed path in linear time and rejects an empty name', () => {
    expect(() => deriveName('/'.repeat(100_000))).toThrow('Could not derive a plugin name');
  });
});
