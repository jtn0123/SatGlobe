/**
 * Build-only placeholder for the optional public export. The TypeScript and
 * library graphs continue to resolve the real vendored implementation.
 */
export class Sgp4WasmPropagator {
  static readonly unavailableReason = 'Sgp4WasmPropagator is not included in this build profile.';

  constructor() {
    throw new Error(Sgp4WasmPropagator.unavailableReason);
  }
}
