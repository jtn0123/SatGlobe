import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Scoped runner for the vendored ootk astrodynamics suite (src/engine/ootk).
 * The host config (vitest.config.ts) excludes this tree so app runs stay
 * fast, but the propagation math shipping in the bundle - including any local
 * modifications since vendoring - still needs CI coverage. Run with:
 *   npx vitest run --config vitest.ootk.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      // ootk's internal alias (its own tsconfig maps @src -> its src dir).
      '@src': fileURLToPath(new URL('./src/engine/ootk/src', import.meta.url)),
    },
  },
  test: {
    include: ['src/engine/ootk/src/**/*.test.ts'],
    environment: 'node',
    // The vendored tests are jest-style: describe/it/expect as globals.
    globals: true,
    testTimeout: 20000,
  },
});
