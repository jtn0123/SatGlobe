import { z } from 'zod';

type ValidationRuntimeConfigurator = (settings: { jitless: boolean }) => unknown;

/** Disables Zod's runtime code generation only in the strict-CSP SatGlobe edition. */
export function configureSatGlobeValidation(
  edition: string,
  configure: ValidationRuntimeConfigurator = (settings) => z.config(settings),
): void {
  if (edition === 'satglobe') {
    configure({ jitless: true });
  }
}

configureSatGlobeValidation(__EDITION__);
