/**
 *!
 * /////////////////////////////////////////////////////////////////////////////
 *
 * https://keeptrack.space
 *
 * @Copyright (C) 2025 Kruczek Labs LLC
 *
 * KeepTrack is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * KeepTrack is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along with
 * KeepTrack. If not, see <http://www.gnu.org/licenses/>.
 *
 * /////////////////////////////////////////////////////////////////////////////
 */

import { KeepTrack } from './keeptrack';
import { registerServiceWorker } from './pwa/service-worker-registration';
import { mountSatGlobe } from './satglobe/bootstrap';

/*
 * Materialize v2 themes its components via Material Design 3 tokens that default
 * to a light palette unless the root element carries theme="dark". The HTML
 * templates set this, but index.html is un-hashed and can be served stale from
 * cache, so assert it here too (bundled JS is content-hashed) to guarantee the
 * dark palette regardless of which entry point loads or what the browser cached.
 */
document.documentElement.setAttribute('theme', 'dark');

/**
 * The bundled catalog gates first dots, and nothing before CatalogLoader needs
 * its bytes - so start the 19 MB fetch now and let it overlap engine init.
 * CatalogLoader consumes the promise in offlineMode and falls back to its own
 * fetch if this one failed. Dead-code eliminated outside the offline edition.
 */
function startCatalogPrefetch(): void {
  const prefetch = fetch('./tle/tle.json').then((response) => response.json());

  // Failures surface through CatalogLoader's own fetch path, not as unhandled rejections.
  prefetch.catch(() => undefined);
  window.satGlobeCatalogPrefetch = prefetch;
}

if (__EDITION__ === 'satglobe') {
  startCatalogPrefetch();
}

const keepTrackInstance = KeepTrack.getInstance();

// Load the main website class
keepTrackInstance.init(window.settingsOverride);

// Expose to window for debugging
window.keepTrack = keepTrackInstance;

// Initialize the website
KeepTrack.initCss().then(() => {
  keepTrackInstance.run();
  if (__EDITION__ === 'satglobe') {
    mountSatGlobe();
  }
});

if (__EDITION__ !== 'satglobe') {
  registerServiceWorker();
}
