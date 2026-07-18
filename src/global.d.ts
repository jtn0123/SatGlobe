import { KeepTrack } from './keeptrack';

declare global {
  const __VERSION__: string;
  const __VERSION_DATE__: string;
  const __COMMIT_HASH__: string;
  const __IS_PRO__: boolean;
  const __EDITION__: string;
  const __PROPAGATOR_BACKEND__: 'sgp4' | 'sgp4-wasm' | 'sgp4-xp-wasm';

  interface Window {
    keepTrack: KeepTrack;
    satGlobe?: import('./satglobe/engine/satglobe-engine-adapter').SatGlobeEngineAdapter;
    /** Offline-edition catalog fetch started at module evaluation, ahead of engine init (see main.ts). */
    satGlobeCatalogPrefetch?: Promise<unknown>;
    zaraz?: {
      consent?: {
        get: (key: string) => boolean;
        modal: boolean;
      };
    };
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export { };
