import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileLoader } from '../lib/profile-loader';

const TEST_ENV_KEYS = ['EDITION', 'SATGLOBE_PARSE_ONLY'] as const;
const originalEnv = new Map(TEST_ENV_KEYS.map((key) => [key, process.env[key]]));
const tempRoots: string[] = [];

/** Create an isolated profile fixture without changing the worker CWD. */
async function createProfile(profileEnv?: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'satglobe-profile-loader-'));
  const profileDir = join(projectRoot, 'configs', 'fixture');

  tempRoots.push(projectRoot);
  await mkdir(profileDir, { recursive: true });
  if (profileEnv !== undefined) {
    await writeFile(join(profileDir, 'profile.env'), profileEnv);
  }

  return projectRoot;
}

describe('ProfileLoader environment parsing', () => {
  afterEach(async () => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it('parses profile.env without polluting process.env', async () => {
    const projectRoot = await createProfile([
      'EDITION=fixture-edition',
      'SATGLOBE_PARSE_ONLY=from-file',
    ].join('\n'));

    process.env.EDITION = 'os-edition';
    delete process.env.SATGLOBE_PARSE_ONLY;
    const config = new ProfileLoader(projectRoot).loadProfile('fixture');

    expect(config).toMatchObject({
      edition: 'fixture-edition',
      envFilePath: 'configs/fixture/profile.env',
    });
    expect(process.env.EDITION).toBe('os-edition');
    expect(process.env.SATGLOBE_PARSE_ONLY).toBeUndefined();
  });

  it('treats a missing profile.env as an empty environment override', async () => {
    const projectRoot = await createProfile();

    expect(new ProfileLoader(projectRoot).loadProfile('fixture')).toEqual({});
  });
});
