import { execFileSync } from 'node:child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig } from 'vitest/config';
import { fixedGitExecutable } from './build/lib/fixed-executables';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

const PLUGINS_PRO_STUB_ID = '\0virtual:plugins-pro-stub';

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(packageJson.version),
    __VERSION_DATE__: JSON.stringify(new Date().toISOString()),
    __COMMIT_HASH__: JSON.stringify(execFileSync(fixedGitExecutable(), ['rev-parse', '--short', 'HEAD']).toString().trim()),
    __IS_PRO__: JSON.stringify(false),
    __EDITION__: JSON.stringify('oss'),
    __PROPAGATOR_BACKEND__: JSON.stringify('sgp4'),
  },
  plugins: [
    {
      name: 'stub-plugins-pro',
      enforce: 'pre',
      async resolveId(id, importer) {
        if (!id.includes('plugins-pro/')) {
          return null;
        }

        const resolved = await this.resolve(id, importer, { skipSelf: true });

        if (resolved) {
          return resolved;
        }

        return PLUGINS_PRO_STUB_ID;
      },
      load(id) {
        if (id === PLUGINS_PRO_STUB_ID) {
          return 'export default {};';
        }

        return null;
      },
    },
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/polyfills.js', './test/vitest-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'html', 'text'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/**',
        'src/lib/external/**',
        'test/**',
        'dist/**',
        'src/engine/ootk/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.js',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/__tests__/**',
        '**/test.ts',
        '**/test.js',
        '**/*.stories.ts',
        '**/*.stories.js',
        // Third-party external plugins are not held to the host coverage ratchet.
        'src/plugins-external/**',
      ],
      reportOnFailure: true,
      // Re-baselined against the full src denominator (coverage.include now counts every
      // src file, not just imported ones). Actuals: lines 72.13 / statements 72.16 /
      // functions 74.45 / branches 58.02. Post-Wave-1 actuals are lines 72.80 /
      // statements 72.83 / functions 75.32 / branches 59.02.
      thresholds: {
        statements: 72,
        branches: 58,
        functions: 74,
        lines: 72,
      },
    },
    include: ['**/?(*.)+(test).?(m)[jt]s?(x)'],
    exclude: [
      'node_modules/**',
      'offline/**',
      'dist/**',
      'src/admin/**',
      'src/engine/ootk/**',
      // External plugin tests run in the plugin's own repo CI, not the host suite.
      'src/plugins-external/**',
      // Bare "test.ts" files are CLI commands/tooling (e.g. the plugin CLI's
      // `test` command), not vitest suites. Real tests are named "*.test.ts".
      '**/test.ts',
      // CI helper scripts (e.g. the plugins-pro supgp logic tests) use Node's
      // built-in `node:test` runner and run in their own repo CI, not vitest.
      '**/.github/**',
    ],
  },
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, './src'),
      '@engine': path.resolve(__dirname, './src/engine'),
      '@ootk': path.resolve(__dirname, './src/engine/ootk'),
      '@plugins-pro': path.resolve(__dirname, './src/plugins-pro'),
      '@plugins-external': path.resolve(__dirname, './src/plugins-external'),
      '@public': path.resolve(__dirname, './public'),
      '@css': path.resolve(__dirname, './public/css'),
      '@test': path.resolve(__dirname, './test'),
      '@wallpapers': path.resolve(__dirname, './src/app/ui/default-wallpapers.ts'),
    },
  },
});
