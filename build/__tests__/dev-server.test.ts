import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runDevServer, startServer } from '../dev-server';
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
const SATGLOBE_HEALTHCHECK_PATH = resolve(process.cwd(), 'configs/satglobe/healthcheck.sh');
const SATGLOBE_DOCKERFILE_PATH = resolve(process.cwd(), 'Dockerfile.satglobe');

interface HttpResponse {
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}

/** Make one bounded request against the live server. */
function requestServer(port: number, path: string): Promise<HttpResponse> {
  return new Promise((resolveResponse, reject) => {
    const req = request({ host: '127.0.0.1', path, port }, (res) => {
      let body = '';

      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolveResponse({
        body,
        headers: res.headers,
        status: res.statusCode ?? 0,
      }));
      res.on('error', reject);
    });

    req.setTimeout(500, () => req.destroy(new Error(`Request timed out: ${path}`)));
    req.on('error', reject);
    req.end();
  });
}

/** Close a test server and fail if shutdown itself fails. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolveClose();
    });
  });
}

/** Find executable inline scripts using the browser's HTML parser. */
function findInlineExecutableScripts(html: string): HTMLScriptElement[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  return [...parsed.querySelectorAll('script')]
    .filter((script) => !script.hasAttribute('src') && script.type.toLowerCase() !== 'application/ld+json');
}

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
    expect(SATGLOBE_CSP).toContain('script-src \'self\'');
  });

  it('keeps local SatGlobe and nginx Content-Security-Policy directives identical', () => {
    const localPolicy = securityHeadersFor('satglobe')['Content-Security-Policy'];
    const nginxConfig = readFileSync(NGINX_CONFIG_PATH, 'utf8');
    const nginxPolicy = nginxConfig.match(/add_header Content-Security-Policy "(?<policy>[^"]+)" always;/u)?.groups?.policy;

    expect(localPolicy).toBe(SATGLOBE_CSP);
    expect(nginxPolicy).toBe(SATGLOBE_CSP);
    expect(SATGLOBE_CSP.match(/script-src [^;]+/u)?.[0]).toBe('script-src \'self\' blob:');
  });

  it('builds the production image without lifecycle scripts and runs nginx unprivileged', () => {
    const dockerfile = readFileSync(SATGLOBE_DOCKERFILE_PATH, 'utf8');
    const healthcheck = readFileSync(SATGLOBE_HEALTHCHECK_PATH, 'utf8');
    const nginxConfig = readFileSync(NGINX_CONFIG_PATH, 'utf8');

    expect(dockerfile).toContain('RUN npm ci --ignore-scripts');
    expect(dockerfile).toContain('/var/cache/nginx /run /usr/share/nginx/html');
    expect(dockerfile).toContain('USER nginx');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(dockerfile).toContain('HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3');
    expect(dockerfile).toContain('CMD ["/usr/local/bin/satglobe-healthcheck"]');
    expect(healthcheck).toContain('http://127.0.0.1:8080/');
    expect(nginxConfig).toMatch(/^\s*listen 8080;$/mu);
  });

  it('loads the early service-worker bootstrap from same-origin JS instead of executable inline code', () => {
    const indexTemplate = readFileSync(INDEX_TEMPLATE_PATH, 'utf8');
    const inlineExecutableScripts = findInlineExecutableScripts(indexTemplate);

    expect(inlineExecutableScripts).toEqual([]);
    expect(indexTemplate).toContain('<script defer src="./service-worker-bootstrap.js"></script>');
    expect(existsSync(SERVICE_WORKER_BOOTSTRAP_PATH)).toBe(true);
    const bootstrap = readFileSync(SERVICE_WORKER_BOOTSTRAP_PATH, 'utf8');

    expect(bootstrap).toContain('\'serviceWorker\' in navigator');
    expect(bootstrap).toContain('addEventListener(\'controllerchange\'');
    expect(bootstrap).toContain('postMessage({ type: \'SKIP_WAITING\' })');

    const nginxConfig = readFileSync(NGINX_CONFIG_PATH, 'utf8');
    const bootstrapLocation = nginxConfig.match(/location = \/service-worker-bootstrap\.js \{(?<body>[\s\S]*?)\n {2}\}/u)?.groups?.body;

    expect(bootstrapLocation).toContain('expires epoch;');
    expect(bootstrapLocation).not.toMatch(/^\s*add_header\b/mu);
  });

  it('revalidates the conjunction feed without dropping inherited security headers', () => {
    const nginxConfig = readFileSync(NGINX_CONFIG_PATH, 'utf8');
    const conjunctionLocation = nginxConfig.match(/location = \/tle\/satglobe\/conjunctions\.json \{(?<body>[\s\S]*?)\n {2}\}/u)?.groups?.body;
    const exactLocationIndex = nginxConfig.indexOf('location = /tle/satglobe/conjunctions.json');
    const immutableJsonIndex = nginxConfig.indexOf('location ~* \\.(?:js|css|woff2?|ttf|png|jpg|webp|wasm|json)');

    expect(conjunctionLocation).toContain('expires epoch;');
    expect(conjunctionLocation).toContain('try_files $uri =404;');
    expect(conjunctionLocation).not.toMatch(/^\s*add_header\b/mu);
    expect(exactLocationIndex).toBeGreaterThan(-1);
    expect(exactLocationIndex).toBeLessThan(immutableJsonIndex);
  });

  it('checks script tags and attributes without case-sensitive gaps', () => {
    const scripts = findInlineExecutableScripts([
      '<SCRIPT>window.inline = true;</SCRIPT >',
      '<SCRIPT SRC="./same-origin.js"></SCRIPT>',
      '<SCRIPT TYPE="APPLICATION/LD+JSON">{"name":"SatGlobe"}</SCRIPT>',
    ].join(''));

    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.textContent).toBe('window.inline = true;');
  });
});

describe('dev-server startup', () => {
  /** Create side-effect-free startup collaborators for orchestration tests. */
  function createRuntime() {
    return {
      runBuildWatch: vi.fn(),
      startServer: vi.fn(),
      watchConfigDir: vi.fn(),
      watchDist: vi.fn(),
    };
  }

  it('watches the selected profile configuration in development mode', () => {
    const runtime = createRuntime();

    runDevServer(['--profile=satglobe'], runtime);

    expect(runtime.runBuildWatch).toHaveBeenCalledWith(['--profile=satglobe']);
    expect(runtime.startServer).toHaveBeenCalledWith(securityHeadersFor('satglobe'), true);
    expect(runtime.watchDist).toHaveBeenCalledOnce();
    expect(runtime.watchConfigDir).toHaveBeenCalledOnce();
    expect(runtime.watchConfigDir).toHaveBeenCalledWith('satglobe');
  });

  it('does not start build or config watchers in static mode', () => {
    const runtime = createRuntime();

    runDevServer(['--static', '--profile=satglobe'], runtime);

    expect(runtime.startServer).toHaveBeenCalledWith(securityHeadersFor('satglobe'), false);
    expect(runtime.runBuildWatch).not.toHaveBeenCalled();
    expect(runtime.watchDist).not.toHaveBeenCalled();
    expect(runtime.watchConfigDir).not.toHaveBeenCalled();
  });
});

describe('dev-server static HTTP boundary', () => {
  let address: AddressInfo;
  let server: Server;

  beforeAll(async () => {
    server = startServer({}, false, 0);
    await once(server, 'listening');
    address = server.address() as AddressInfo;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('binds to IPv4 loopback', () => {
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');
  });

  it('does not serve a decoded path that escapes dist', async () => {
    const posixTraversal = await requestServer(address.port, '/%2e%2e%2fpackage.json');
    const windowsTraversal = await requestServer(address.port, '/%2e%2e%5cpackage.json');

    expect(posixTraversal).toMatchObject({ body: 'Not found', status: 404 });
    expect(windowsTraversal).toMatchObject({ body: 'Not found', status: 404 });
  });

  it('does not follow a symlink inside dist to a file outside dist', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'satglobe-dev-server-'));
    const distPath = resolve(process.cwd(), 'dist');
    const linkName = `symlink-escape-${randomUUID()}`;
    const linkPath = join(distPath, linkName);

    await mkdir(distPath, { recursive: true });
    await writeFile(join(outsideDir, 'index.html'), 'outside-dist-secret');
    await symlink(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const response = await requestServer(address.port, `/${linkName}/index.html`);

      expect(response).toMatchObject({ body: 'Not found', status: 404 });
      expect(response.body).not.toContain('outside-dist-secret');
    } finally {
      await rm(linkPath, { force: true, recursive: true });
      await rm(outsideDir, { force: true, recursive: true });
    }
  });

  it('does not dispatch the plugin handler in static mode', async () => {
    const plugin = await requestServer(address.port, '/__plugin/not-a-command');

    expect(plugin).toMatchObject({ body: 'Not found', status: 404 });
    expect(plugin.headers['content-type']).toBeUndefined();
  });

  it('does not open the live-reload event stream in static mode', async () => {
    const reload = await requestServer(address.port, '/__reload');
    const reloadClient = await requestServer(address.port, LIVE_RELOAD_CLIENT_PATH);

    expect(reload).toMatchObject({ body: 'Not found', status: 404 });
    expect(reloadClient).toMatchObject({ body: 'Not found', status: 404 });
  });
});
