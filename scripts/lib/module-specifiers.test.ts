import { describe, expect, it } from 'vitest';
import { extractModuleSpecifiers } from './module-specifiers';

describe('extractModuleSpecifiers', () => {
  it('returns real module references without matching examples in comments or strings', () => {
    const source = `
      // Example only: from '@app/app/commented-out'
      const documentation = "from '@app/plugins/string-example'";
      import '@app/app/side-effect';
      import value from '@app/app/static';
      export { other } from '@app/plugins/re-export';
      const lazy = import('@app/settings/dynamic');
    `;

    expect(extractModuleSpecifiers(source)).toEqual([
      '@app/app/side-effect',
      '@app/app/static',
      '@app/plugins/re-export',
      '@app/settings/dynamic',
    ]);
  });
});
