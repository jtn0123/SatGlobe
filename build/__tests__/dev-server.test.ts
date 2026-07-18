import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIVE_RELOAD_CLIENT_PATH,
  LIVE_RELOAD_CLIENT_SOURCE,
  liveReloadEnabledFor,
  prepareHtmlResponse,
  SATGLOBE_CSP,
  securityHeadersFor,
} from '../dev-server-response';

const HTML = '<!doctype html><html><body><main>SatGlobe</main></body></html>';
const INDEX_TEMPLATE_PATH = resolve(process.cwd(), 'public/index.html');
const SERVICE_WORKER_BOOTSTRAP_PATH = resolve(process.cwd(), 'public/service-worker-bootstrap.js');
const NGINX_CONFIG_PATH = resolve(process.cwd(), 'configs/satglobe/nginx.conf');

describe('dev-server HTML responses', () => {
  it('does not inject the live-reload client in static mode', () => {
    const liveReloadEnabled = liveReloadEnabledFor(['--static', '--profile=satglobe']);
    const buildOutput = Buffer.from(HTML);
    const response = prepareHtmlResponse(buildOutput, liveReloadEnabled);

    expect(liveReloadEnabled).toBe(false);
    expect(response).toBe(buildOutput);
    expect(response.toString()).toBe(HTML);
    expect(response.toString()).not.toContain('/__reload');
  });

  it('preserves live reload in development mode without CSP-blocked inline JavaScript', () => {
    const liveReloadEnabled = liveReloadEnabledFor(['--profile=satglobe']);
    const response = prepareHtmlResponse(Buffer.from(HTML), liveReloadEnabled).toString();

    expect(liveReloadEnabled).toBe(true);
    expect(response).toContain(`<script src="${LIVE_RELOAD_CLIENT_PATH}"></script>`);
    expect(response).not.toContain('new EventSource');
    expect(response).toContain('</script></body>');
    expect(LIVE_RELOAD_CLIENT_SOURCE).toContain('new EventSource("/__reload")');
    expect(SATGLOBE_CSP).toContain("script-src 'self'");
  });

  it('keeps local SatGlobe and nginx Content-Security-Policy directives identical', () => {
    const localPolicy = securityHeadersFor('satglobe')['Content-Security-Policy'];
    const nginxConfig = readFileSync(NGINX_CONFIG_PATH, 'utf8');
    const nginxPolicy = nginxConfig.match(/add_header Content-Security-Policy "(?<policy>[^"]+)" always;/u)?.groups?.policy;

    expect(localPolicy).toBe(SATGLOBE_CSP);
    expect(nginxPolicy).toBe(SATGLOBE_CSP);
    expect(SATGLOBE_CSP.match(/script-src [^;]+/u)?.[0]).toBe('script-src \'self\' \'unsafe-eval\' blob:');
  });

  it('loads the early service-worker bootstrap from same-origin JS instead of executable inline code', () => {
    const indexTemplate = readFileSync(INDEX_TEMPLATE_PATH, 'utf8');
    const inlineExecutableScripts = [...indexTemplate.matchAll(/<script(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/script>/gu)]
      .filter(({ groups }) => !(/\bsrc\s*=/u).test(groups?.attributes ?? '') && !(/type="application\/ld\+json"/u).test(groups?.attributes ?? ''));

    expect(inlineExecutableScripts).toEqual([]);
    expect(indexTemplate).toContain('<script defer src="./service-worker-bootstrap.js"></script>');
    expect(existsSync(SERVICE_WORKER_BOOTSTRAP_PATH)).toBe(true);
    const bootstrap = readFileSync(SERVICE_WORKER_BOOTSTRAP_PATH, 'utf8');

    expect(bootstrap).toContain('\'serviceWorker\' in navigator');
    expect(bootstrap).toContain('addEventListener(\'controllerchange\'');
    expect(bootstrap).toContain('postMessage({ type: \'SKIP_WAITING\' })');

    const nginxConfig = readFileSync(NGINX_CONFIG_PATH, 'utf8');
    const bootstrapLocation = nginxConfig.match(/location = \/service-worker-bootstrap\.js \{(?<body>[\s\S]*?)\n  \}/u)?.groups?.body;

    expect(bootstrapLocation).toContain('expires epoch;');
    expect(bootstrapLocation).not.toMatch(/^\s*add_header\b/mu);
  });
});
