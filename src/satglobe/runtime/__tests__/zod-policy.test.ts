import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { configureSatGlobeValidation } from '../zod-policy';

describe('SatGlobe validation runtime policy', () => {
  it('enables Zod jitless mode only for the SatGlobe edition', () => {
    const configure = vi.fn();

    configureSatGlobeValidation('satglobe', configure);
    expect(configure).toHaveBeenCalledOnce();
    expect(configure).toHaveBeenCalledWith({ jitless: true });

    configure.mockClear();
    configureSatGlobeValidation('oss', configure);
    configureSatGlobeValidation('pro', configure);
    expect(configure).not.toHaveBeenCalled();
  });

  it('loads the runtime policy before any SatGlobe schema consumer', () => {
    const bootstrap = readFileSync(resolve('src/satglobe/bootstrap.tsx'), 'utf8');
    const policyImport = bootstrap.indexOf('import \'./runtime/zod-policy\';');
    const appImport = bootstrap.indexOf('import { SatGlobeApp } from \'./app/satglobe-app\';');

    expect(policyImport).toBeGreaterThanOrEqual(0);
    expect(appImport).toBeGreaterThan(policyImport);
  });
});
