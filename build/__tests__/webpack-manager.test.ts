import type { Configuration } from '@rspack/core';
import DotEnv from 'dotenv-webpack';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildConfig } from '../lib/config-manager';
import { WebpackManager } from '../webpack-manager';

interface DotEnvPluginOptions {
  allowEmptyValues?: boolean;
  path?: string | false;
  systemvars?: boolean;
}

type DotEnvPlugin = DotEnv & { config: DotEnvPluginOptions };

const originalCommitSha = process.env.SATGLOBE_COMMIT_SHA;

/** Return a complete Pro build config that creates both dotenv plugin instances. */
function createBuildConfig(): BuildConfig {
  return {
    edition: 'pro',
    envFilePath: 'configs/pro/profile.env',
    favIconPath: 'public/img/favicons/favicon.ico',
    isPro: true,
    isWatch: false,
    loadingScreenCssPath: 'public/css/loading-screen.css',
    mode: 'production',
    primaryLogoPath: 'public/img/logo-primary.png',
    propagatorBackend: 'sgp4-wasm',
    secondaryLogoPath: 'public/img/logo-secondary.png',
    settingsPath: 'public/settings/settingsOverride.js',
    styleCssPath: 'public/css/style.css',
    textLogoPath: 'public/img/logo.png',
    wallpapersPath: 'src/app/ui/default-wallpapers.ts',
  };
}

/** Read the runtime options retained by dotenv-webpack instances in one compiler. */
function dotenvOptions(config: Configuration | undefined): DotEnvPluginOptions[] {
  return (config?.plugins ?? []).flatMap((plugin) => {
    if (plugin instanceof DotEnv) {
      return [(plugin as unknown as DotEnvPlugin).config];
    }

    return [];
  });
}

describe('WebpackManager dotenv plugins', () => {
  afterEach(() => {
    if (originalCommitSha === undefined) {
      delete process.env.SATGLOBE_COMMIT_SHA;
    } else {
      process.env.SATGLOBE_COMMIT_SHA = originalCommitSha;
    }
  });

  it('retains env path and system-variable options for main and auth compilers', () => {
    process.env.SATGLOBE_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
    const configs = WebpackManager.createConfig(createBuildConfig());
    const mainOptions = dotenvOptions(configs.find((config) => config.name === 'MainFiles'));
    const authOptions = dotenvOptions(configs.find((config) => config.name === 'AuthFiles'));
    const workerOptions = dotenvOptions(configs.find((config) => config.name === 'WebWorkers'));
    const expected = {
      allowEmptyValues: true,
      path: './configs/pro/profile.env',
      systemvars: true,
    };

    expect(mainOptions).toEqual([expect.objectContaining(expected)]);
    expect(authOptions).toEqual([expect.objectContaining(expected)]);
    expect(workerOptions).toEqual([]);
    expect([...mainOptions, ...authOptions]).toHaveLength(2);
  });
});
