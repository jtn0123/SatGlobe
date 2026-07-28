export const LIVE_RELOAD_CLIENT_PATH = '/__reload-client.js';
export const LIVE_RELOAD_CLIENT_SOURCE = 'new EventSource("/__reload").onmessage=()=>location.reload();';
const RELOAD_SCRIPT = `<script src="${LIVE_RELOAD_CLIENT_PATH}"></script>`;

/*
 * Security policy for the SatGlobe profile. The nginx deployment duplicates
 * this value and a focused test requires byte-for-byte directive parity.
 */
export const SATGLOBE_CSP = [
  'default-src \'self\' blob:',
  'img-src \'self\' data: blob:',
  'style-src \'self\' \'unsafe-inline\'',
  'script-src \'self\' blob:',
  'worker-src \'self\' blob:',
  'connect-src \'self\'',
  'font-src \'self\'',
  'frame-ancestors \'none\'',
  'object-src \'none\'',
  'base-uri \'self\'',
].join('; ');

/*
 * Baseline policy for every non-SatGlobe profile. Looser than SATGLOBE_CSP
 * (external connects/scripts stay allowed because oss/pro fetch CelesTrak,
 * api.keeptrack.space, etc.) but still omits 'unsafe-inline' for scripts, so
 * markup injected through catalog data cannot execute inline handlers.
 */
export const BASELINE_CSP = [
  'default-src \'self\' blob:',
  'img-src \'self\' data: blob: https:',
  'style-src \'self\' \'unsafe-inline\'',
  'script-src \'self\' \'unsafe-eval\' blob: https:',
  'worker-src \'self\' blob:',
  'connect-src \'self\' https: wss:',
  'font-src \'self\' data:',
  'frame-ancestors \'none\'',
  'object-src \'none\'',
  'base-uri \'self\'',
].join('; ');

/** Returns the response headers owned by one local-server profile. */
export function securityHeadersFor(profileName: string | null): Record<string, string> {
  return profileName === 'satglobe'
    ? {
      'Content-Security-Policy': SATGLOBE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // Enables the JS self-profiling API locally so perf work can sample real stacks.
      'Document-Policy': 'js-profiling',
    }
    : {
      'Content-Security-Policy': BASELINE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
}

/** Returns whether the CLI mode should include development live reload. */
export function liveReloadEnabledFor(args: readonly string[]): boolean {
  return !args.includes('--static');
}

/** Builds one HTML response body, adding the reload client only in development mode. */
export function prepareHtmlResponse(data: Buffer, liveReloadEnabled: boolean): Buffer {
  if (!liveReloadEnabled) {
    return data;
  }
  const html = data.toString().replace('</body>', `${RELOAD_SCRIPT}</body>`);

  return Buffer.from(html);
}
