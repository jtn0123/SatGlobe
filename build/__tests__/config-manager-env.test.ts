import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager } from '../lib/config-manager';

const PROFILE_FILES = [
  'settingsOverride.js',
  'style.css',
  'loading-screen.css',
  'logo.png',
  'logo-primary.png',
  'logo-secondary.png',
  'favicon.ico',
  'wallpapers.ts',
] as const;
const TEST_ENV_KEYS = [
  'DOTENV_CONFIG_QUIET',
  'EDITION',
  'SATGLOBE_ENV_OS_WINS',
  'SATGLOBE_ENV_PROFILE_WINS',
  'SATGLOBE_ENV_ROOT_ONLY',
] as const;
const originalEnv = new Map(TEST_ENV_KEYS.map((key) => [key, process.env[key]]));
const tempRoots: string[] = [];

/** Create an isolated project/profile fixture without changing the worker CWD. */
async function createProjectRoot(profileEnv?: string, rootEnv?: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'satglobe-dotenv-'));
  const profileDir = join(projectRoot, 'configs', 'fixture');

  tempRoots.push(projectRoot);
  await mkdir(profileDir, { recursive: true });
  await Promise.all(PROFILE_FILES.map((fileName) => writeFile(join(profileDir, fileName), '')));

  if (profileEnv !== undefined) {
    await writeFile(join(profileDir, 'profile.env'), profileEnv);
  }
  if (rootEnv !== undefined) {
    await writeFile(join(projectRoot, '.env'), rootEnv);
  }

  return projectRoot;
}

/** Assert that dotenv 17 did not emit its environment-injection information line. */
function expectNoDotenvInfoLog(consoleLog: ReturnType<typeof vi.spyOn>): void {
  const output = consoleLog.mock.calls.flat().join(' ');

  expect(output).not.toMatch(/\[dotenv@|inject(?:ed|ing) env/iu);
}

describe('ConfigManager environment loading', () => {
  beforeEach(() => {
    for (const key of TEST_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    vi.restoreAllMocks();
  });

  it('keeps OS variables above profile.env and root .env values', async () => {
    const projectRoot = await createProjectRoot(
      [
        'EDITION=profile-edition',
        'SATGLOBE_ENV_OS_WINS=profile',
        'SATGLOBE_ENV_PROFILE_WINS=profile',
      ].join('\n'),
      [
        'EDITION=root-edition',
        'SATGLOBE_ENV_OS_WINS=root',
        'SATGLOBE_ENV_PROFILE_WINS=root',
        'SATGLOBE_ENV_ROOT_ONLY=root',
      ].join('\n'),
    );
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    process.env.EDITION = 'os-edition';
    process.env.SATGLOBE_ENV_OS_WINS = 'os';
    const config = new ConfigManager().loadConfig(['--profile=fixture'], projectRoot);

    expect(process.env.SATGLOBE_ENV_OS_WINS).toBe('os');
    expect(process.env.SATGLOBE_ENV_PROFILE_WINS).toBe('profile');
    expect(process.env.SATGLOBE_ENV_ROOT_ONLY).toBe('root');
    expect(config.edition).toBe('os-edition');
    expectNoDotenvInfoLog(consoleLog);
  });

  it('loads a legacy root .env quietly', async () => {
    const projectRoot = await createProjectRoot(undefined, 'EDITION=legacy-edition\n');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const config = new ConfigManager().loadConfig([], projectRoot);

    expect(config.edition).toBe('legacy-edition');
    expectNoDotenvInfoLog(consoleLog);
  });

  it('loads profile.env when the root .env is missing', async () => {
    const projectRoot = await createProjectRoot('EDITION=profile-edition\n');

    const config = new ConfigManager().loadConfig(['--profile=fixture'], projectRoot);

    expect(config.edition).toBe('profile-edition');
    expect(process.env.EDITION).toBe('profile-edition');
  });

  it('loads root .env system variables when profile.env is missing', async () => {
    const projectRoot = await createProjectRoot(undefined, 'SATGLOBE_ENV_ROOT_ONLY=root\n');

    const config = new ConfigManager().loadConfig(['--profile=fixture'], projectRoot);

    expect(config).toMatchObject({ edition: 'oss', envFilePath: '.env' });
    expect(process.env.SATGLOBE_ENV_ROOT_ONLY).toBe('root');
  });

  it('keeps documented defaults when profile and legacy env files are missing', async () => {
    const projectRoot = await createProjectRoot();

    expect(() => new ConfigManager().loadConfig(['--profile=fixture'], projectRoot)).not.toThrow();
    expect(new ConfigManager().loadConfig([], projectRoot)).toMatchObject({
      edition: 'oss',
      envFilePath: '.env',
      isPro: false,
    });
  });
});
