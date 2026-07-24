import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Configuration } from '@rspack/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildConfig, PropagatorBackend } from '../lib/config-manager';
import { ProfileLoader } from '../lib/profile-loader';
import { assertPropagatorBundleProfile, inspectPropagatorBundle } from '../lib/propagator-bundle-guard';
import {
  OOTK_EXTERNAL_EXPORTS_REQUEST,
  OOTK_WASM_PROPAGATOR_REQUEST,
  PROPAGATOR_RUNTIME_REQUEST,
  PROPAGATOR_WORKER_HANDLER_REQUEST,
  SGP4_WASM_WORKER_ENTRY_NAMES,
} from '../lib/propagator-build-profile';
import { WebpackManager } from '../webpack-manager';

const temporaryDirs: string[] = [];

const configFor = (backend: PropagatorBackend): BuildConfig => ({
  edition: backend === 'sgp4' ? 'satglobe' : 'pro',
  envFilePath: '.env',
  favIconPath: 'public/img/favicons/favicon.ico',
  isPro: backend !== 'sgp4',
  isWatch: false,
  loadingScreenCssPath: 'public/css/loading-screen.css',
  mode: 'production',
  primaryLogoPath: 'public/img/logo-primary.png',
  propagatorBackend: backend,
  secondaryLogoPath: 'public/img/logo-secondary.png',
  settingsPath: 'public/settings/settingsOverride.js',
  styleCssPath: 'public/css/style.css',
  textLogoPath: 'public/img/logo.png',
  wallpapersPath: 'src/app/ui/default-wallpapers.ts',
});

const compilerNamed = (configs: Configuration[], name: string): Configuration => {
  const config = configs.find((candidate) => candidate.name === name);

  if (!config) {
    throw new Error(`Missing compiler ${name}`);
  }

  return config;
};

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('propagator build profile', () => {
  it('reads the real SatGlobe and upstream wasm backend flags from their profiles', () => {
    const loader = new ProfileLoader(process.cwd());

    expect(loader.loadProfile('satglobe').propagatorBackend).toBe('sgp4');
    expect(loader.loadProfile('pro').propagatorBackend).toBe('sgp4-xp-wasm');
  });

  it('replaces all four optional runtime boundaries in every pure-SGP4 compiler', () => {
    const configs = WebpackManager.createConfig(configFor('sgp4'));
    const expectedTargets = new Map([
      [PROPAGATOR_RUNTIME_REQUEST, 'propagator-backend-runtime-disabled.ts'],
      [PROPAGATOR_WORKER_HANDLER_REQUEST, 'sgp4-wasm-backend-handler-disabled.ts'],
      [OOTK_EXTERNAL_EXPORTS_REQUEST, 'disabled.ts'],
      [OOTK_WASM_PROPAGATOR_REQUEST, 'Sgp4WasmPropagator.disabled.ts'],
    ]);

    for (const config of configs) {
      const aliases = config.resolve?.alias as Record<string, string>;

      for (const [request, target] of expectedTargets) {
        expect(basename(aliases[request])).toBe(target);
      }
    }
  });

  it('keeps the original loader and vendored exports in a wasm-enabled profile', () => {
    const configs = WebpackManager.createConfig(configFor('sgp4-xp-wasm'));

    for (const config of configs) {
      const aliases = config.resolve?.alias as Record<string, string>;

      expect(aliases[PROPAGATOR_RUNTIME_REQUEST]).toBeUndefined();
      expect(aliases[PROPAGATOR_WORKER_HANDLER_REQUEST]).toBeUndefined();
      expect(aliases[OOTK_EXTERNAL_EXPORTS_REQUEST]).toBeUndefined();
      expect(aliases[OOTK_WASM_PROPAGATOR_REQUEST]).toBeUndefined();
    }
  });

  it('inventories one main surface and every one of the nine worker variants', () => {
    const configs = WebpackManager.createConfig(configFor('sgp4'));
    const main = compilerNamed(configs, 'MainFiles');
    const workers = compilerNamed(configs, 'WebWorkers');
    const entries = workers.entry as Record<string, string[]>;

    expect(main.entry).toEqual({ main: ['./src/main.ts'] });
    expect(SGP4_WASM_WORKER_ENTRY_NAMES).toHaveLength(9);

    const workerFilesUsingHandler = Object.entries(entries)
      .filter(([, [entry]]) => readFileSync(resolve(entry.replace(/^\.\//u, '')), 'utf8')
        .includes('from \'./shared/sgp4-wasm-backend-handler\''))
      .map(([name]) => name)
      .sort();

    expect(workerFilesUsingHandler).toEqual([...SGP4_WASM_WORKER_ENTRY_NAMES].sort());
    expect(readFileSync(resolve('src/keeptrack.ts'), 'utf8')).toContain('propagatorBackendRuntime');
    expect(readFileSync(resolve('src/keepTrackApi.ts'), 'utf8')).toContain('propagatorBackendRuntime');
  });
});

describe('propagator bundle guard', () => {
  const makeJsDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'satglobe-propagator-'));
    const jsDir = join(dir, 'js');

    temporaryDirs.push(dir);
    mkdirSync(jsDir);

    return jsDir;
  };

  it('checks every main, worker, and async JS asset', () => {
    const jsDir = makeJsDir();

    writeFileSync(join(jsDir, 'main.js'), 'console.log("safe")');
    writeFileSync(join(jsDir, 'positionCruncher.js'), 'Function("Module","require","__dirname", source)');
    writeFileSync(join(jsDir, 'lazy.js'), 'cwrap("TleAddSatFrLines_wasm")');
    writeFileSync(join(jsDir, 'main.js.map'), 'TleAddSatFrLines_wasm');

    expect(inspectPropagatorBundle(jsDir)).toEqual({
      assetCount: 3,
      offenders: ['lazy.js', 'positionCruncher.js'],
    });
    expect(() => assertPropagatorBundleProfile(jsDir, 'sgp4')).toThrow(
      'lazy.js, positionCruncher.js',
    );
    expect(assertPropagatorBundleProfile(jsDir, 'sgp4-xp-wasm').offenders).toHaveLength(2);
  });

  it('accepts a pure-SGP4 output with no Emscripten module in any chunk', () => {
    const jsDir = makeJsDir();

    writeFileSync(join(jsDir, 'main.js'), 'console.log("safe")');
    writeFileSync(join(jsDir, 'orbitCruncher.js'), 'const sgp4 = "typescript"');

    expect(assertPropagatorBundleProfile(jsDir, 'sgp4')).toEqual({
      assetCount: 2,
      offenders: [],
    });
  });
});
