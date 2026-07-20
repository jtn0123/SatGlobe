import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SatGlobeErrorBoundary } from './app/error-boundary';
import { SatGlobeApp } from './app/satglobe-app';
import { SatGlobeEngineAdapter } from './engine/satglobe-engine-adapter';
import './app/satglobe-app.css';

/** Mounts the React product shell over KeepTrack's initialized canvas. */
export function mountSatGlobe(): void {
  if (document.getElementById('satglobe-root')) {
    return;
  }

  const root = document.createElement('div');

  root.id = 'satglobe-root';
  document.body.append(root);

  const adapter = new SatGlobeEngineAdapter();

  window.satGlobe = adapter;
  createRoot(root).render(
    <StrictMode>
      <SatGlobeErrorBoundary>
        <SatGlobeApp adapter={adapter} />
      </SatGlobeErrorBoundary>
    </StrictMode>,
  );
}
