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
  shouldCopyProWasmArtifacts,
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

  it('copies proprietary WASM artifacts only for a WASM-enabled Pro profile', () => {
    expect(shouldCopyProWasmArtifacts({ isPro: false, propagatorBackend: 'sgp4' })).toBe(false);
    expect(shouldCopyProWasmArtifacts({ isPro: true, propagatorBackend: 'sgp4' })).toBe(false);
    expect(shouldCopyProWasmArtifacts({ isPro: true, propagatorBackend: 'sgp4-wasm' })).toBe(true);
    expect(shouldCopyProWasmArtifacts({ isPro: true, propagatorBackend: 'sgp4-xp-wasm' })).toBe(true);
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
    expect(Object.keys(entries).sort()).toEqual(['colorCruncher', ...SGP4_WASM_WORKER_ENTRY_NAMES].sort());

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
  const makeDistDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'satglobe-propagator-'));

    temporaryDirs.push(dir);
    mkdirSync(join(dir, 'js'));

    return dir;
  };

  it('checks every main, worker, async, auth, and copied-runtime JS asset', () => {
    const distDir = makeDistDir();

    mkdirSync(join(distDir, 'auth'));
    mkdirSync(join(distDir, 'wasm', 'sgp4prop'), { recursive: true });
    writeFileSync(join(distDir, 'js', 'main.js'), 'console.log("safe")');
    writeFileSync(join(distDir, 'js', 'positionCruncher.js'), 'Function("Module","require","__dirname", source)');
    writeFileSync(join(distDir, 'auth', 'callback.js'), 'cwrap("TleAddSatFrLines_wasm")');
    writeFileSync(join(distDir, 'wasm', 'sgp4prop', 'Sgp4Prop.js'), 'return { Module: Module, FS: FS };');
    writeFileSync(join(distDir, 'js', 'main.js.map'), 'TleAddSatFrLines_wasm');

    expect(inspectPropagatorBundle(distDir)).toEqual({
      assetCount: 4,
      offenders: ['auth/callback.js', 'js/positionCruncher.js', 'wasm/sgp4prop/Sgp4Prop.js'],
    });
    expect(() => assertPropagatorBundleProfile(distDir, 'sgp4')).toThrow(
      'auth/callback.js, js/positionCruncher.js, wasm/sgp4prop/Sgp4Prop.js',
    );
    expect(assertPropagatorBundleProfile(distDir, 'sgp4-xp-wasm').offenders).toHaveLength(3);
  });

  it('accepts a pure-SGP4 output with no Emscripten module in any chunk', () => {
    const distDir = makeDistDir();

    writeFileSync(join(distDir, 'js', 'main.js'), 'console.log("safe")');
    writeFileSync(join(distDir, 'js', 'orbitCruncher.js'), 'const sgp4 = "typescript"');

    expect(assertPropagatorBundleProfile(distDir, 'sgp4')).toEqual({
      assetCount: 2,
      offenders: [],
    });
    expect(() => assertPropagatorBundleProfile(distDir, 'sgp4-xp-wasm')).toThrow(
      'did not retain the optional Emscripten loader',
    );
  });
});
