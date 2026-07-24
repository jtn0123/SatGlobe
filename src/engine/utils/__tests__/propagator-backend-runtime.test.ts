import { Sgp4, type TleLine1, type TleLine2 } from '@ootk/src/main';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { propagatorBackendRuntime as disabledRuntime } from '../propagator-backend-runtime-disabled';
import { propagatorBackendRuntime as enabledRuntime } from '../propagator-backend-runtime';

const loaderMocks = vi.hoisted(() => ({
  activateConfiguredPropagatorBackend: vi.fn(),
  isWasmPropagatorActive: vi.fn(),
  loadSgp4Wasm: vi.fn(),
  loadSgp4XpWasm: vi.fn(),
}));

vi.mock('../sgp4-wasm-loader', () => loaderMocks);

const ISS_TLE = {
  line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9002' as TleLine1,
  line2: '2 25544  51.6400 208.9163 0006730 358.5720 122.3372 15.50104550100010' as TleLine2,
};

describe('propagator backend build boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Sgp4.clearWasmBackend();
  });

  afterEach(() => {
    Sgp4.clearWasmBackend();
  });

  it('keeps the enabled profile loader contract callable through the lazy facade', async () => {
    const classic = { flavor: 'classic' };
    const xp = { flavor: 'xp' };

    loaderMocks.loadSgp4Wasm.mockResolvedValue(classic);
    loaderMocks.loadSgp4XpWasm.mockResolvedValue(xp);
    loaderMocks.activateConfiguredPropagatorBackend.mockResolvedValue(true);
    loaderMocks.isWasmPropagatorActive.mockReturnValue(true);

    expect(await enabledRuntime.loadSgp4Wasm()).toBe(classic);
    expect(await enabledRuntime.loadSgp4XpWasm()).toBe(xp);
    expect(await enabledRuntime.activateConfiguredPropagatorBackend()).toBe(true);
    expect(await enabledRuntime.isWasmPropagatorActive()).toBe(true);
    expect(loaderMocks.loadSgp4Wasm).toHaveBeenCalledOnce();
    expect(loaderMocks.loadSgp4XpWasm).toHaveBeenCalledOnce();
  });

  it('keeps the pure-SGP4 profile dependency-free and rejects optional loader calls', async () => {
    await expect(disabledRuntime.activateConfiguredPropagatorBackend()).resolves.toBe(false);
    await expect(disabledRuntime.isWasmPropagatorActive()).resolves.toBe(false);
    await expect(disabledRuntime.loadSgp4Wasm()).rejects.toThrow('not included in this build profile');
    await expect(disabledRuntime.loadSgp4XpWasm()).rejects.toThrow('not included in this build profile');
    expect(loaderMocks.loadSgp4Wasm).not.toHaveBeenCalled();
  });

  it('preserves the non-wasm SGP4 result', () => {
    expect(Sgp4.isWasmBackendActive).toBe(false);

    const satrec = Sgp4.createSatrec(ISS_TLE.line1, ISS_TLE.line2);
    const state = Sgp4.propagate(satrec, 60);

    expect(state.position).not.toBe(false);
    expect(state.velocity).not.toBe(false);

    if (!state.position || !state.velocity) {
      throw new Error('Pure-TypeScript SGP4 propagation failed');
    }

    expect(state.position.x).toBeCloseTo(-6148.131571693397, 9);
    expect(state.position.y).toBeCloseTo(-2820.8307581670506, 9);
    expect(state.position.z).toBeCloseTo(-605.2179790438712, 9);
    expect(state.velocity.x).toBeCloseTo(1.511227909696832, 9);
    expect(state.velocity.y).toBeCloseTo(-4.559957880840239, 9);
    expect(state.velocity.z).toBeCloseTo(5.974712081440595, 9);
  });
});
