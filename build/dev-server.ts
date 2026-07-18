import { spawn } from 'node:child_process';
import { cpSync, existsSync, watch } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  LIVE_RELOAD_CLIENT_PATH,
  LIVE_RELOAD_CLIENT_SOURCE,
  liveReloadEnabledFor,
  prepareHtmlResponse,
  securityHeadersFor,
} from './dev-server-response';
import { ConsoleStyles, logWithStyle } from './lib/build-error';
import { handlePluginEndpoint } from './plugin-install-endpoint';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const PORT = 5544;
const LOOPBACK_HOST = '127.0.0.1';
const distDir = resolve(rootDir, 'dist');

// Maps config directory filenames to their dist/ destinations
const CONFIG_FILE_DESTINATIONS: Record<string, string> = {
  'settingsOverride.js': 'dist/settings/settingsOverride.js',
  'favicon.ico': 'dist/img/favicons/favicon.ico',
};

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

// SSE clients for livereload
const sseClients = new Set<ServerResponse>();

/** End an unhandled request without exposing which server boundary rejected it. */
function sendNotFound(res: ServerResponse): void {
  if (!res.headersSent) {
    res.writeHead(404);
  }
  res.end('Not found');
}

/** Resolve one decoded URL pathname only when the result remains inside dist/. */
function resolveStaticPath(pathname: string): string | null {
  const decodedPath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    // URL paths use forward slashes, but a decoded backslash is a separator on Windows.
    // Normalizing it here makes traversal handling identical on every host platform.
    .replaceAll('\\', '/');
  const rootedPath = decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;
  const candidate = resolve(distDir, `.${rootedPath}`);
  const distRelativePath = relative(distDir, candidate);

  if (distRelativePath === '..' || distRelativePath.startsWith(`..${sep}`) || isAbsolute(distRelativePath)) {
    return null;
  }

  return candidate;
}

/** Serve the current dist directory with the requested headers and reload behavior. */
export function startServer(securityHeaders: Record<string, string>, liveReloadEnabled: boolean, port = PORT) {
  const server = createServer(async (req, res) => {
    // Swallow socket-level errors (client aborts, RST). Without this listener a
    // write to a closed/aborted socket emits an unhandled 'error' that crashes the
    // whole process — under Playwright (which aborts requests on page close /
    // navigation constantly) that takes down the server and every later test fails
    // with ERR_CONNECTION_REFUSED.
    res.on('error', () => { /* ignore broken pipe / reset */ });

    const pathname = new URL(req.url!, `http://localhost:${PORT}`).pathname;

    // The SatGlobe CSP disallows executable inline scripts. Serve the development
    // reload client from a same-origin endpoint so live reload remains compatible.
    if (pathname === LIVE_RELOAD_CLIENT_PATH) {
      if (!liveReloadEnabled) {
        sendNotFound(res);

        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
        ...securityHeaders,
      });
      res.end(LIVE_RELOAD_CLIENT_SOURCE);

      return;
    }

    // SSE endpoint for livereload
    if (pathname === '/__reload') {
      if (!liveReloadEnabled) {
        sendNotFound(res);

        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));

      return;
    }

    // One-click plugin install (dev-server only; localhost + same-origin guarded).
    if (pathname.startsWith('/__plugin/')) {
      if (!liveReloadEnabled) {
        sendNotFound(res);

        return;
      }

      await handlePluginEndpoint(req, res, pathname, rootDir);

      return;
    }

    try {
      let filePath = resolveStaticPath(pathname);

      if (!filePath) {
        sendNotFound(res);

        return;
      }

      const fileStat = await stat(filePath).catch(() => null);

      if (fileStat?.isDirectory()) {
        filePath = join(filePath, 'index.html');
      }

      let data: Buffer = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();

      // Static HTML must remain byte-for-byte build output; only development gets live reload.
      if (ext === '.html') {
        data = prepareHtmlResponse(data, liveReloadEnabled);
      }

      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', ...securityHeaders });
      res.end(data);
    } catch {
      // Guard against "headers already sent" when the response was partially
      // written before the failure — calling writeHead again would throw out of
      // the catch and crash the process.
      sendNotFound(res);
    }
  });

  // A malformed request line / header from an aborted client must not crash the server.
  server.on('clientError', (_err, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  // Last-resort safety net: keep the dev/test server alive even if an unexpected
  // error escapes a request handler. Logged, not fatal.
  process.on('uncaughtException', (err) => {
    logWithStyle(`Uncaught exception (server kept alive): ${err.message}`, ConsoleStyles.ERROR);
  });
  process.on('unhandledRejection', (reason) => {
    logWithStyle(`Unhandled rejection (server kept alive): ${String(reason)}`, ConsoleStyles.ERROR);
  });

  server.listen(port, LOOPBACK_HOST, () => {
    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : port;

    logWithStyle(`Serving dist/ at http://${LOOPBACK_HOST}:${listeningPort}`, ConsoleStyles.SUCCESS);
  });

  return server;
}

/** Notify every connected live-reload client that the build output changed. */
function notifyClients() {
  for (const client of sseClients) {
    client.write('data: reload\n\n');
  }
}

/** Watch generated build output and debounce live-reload notifications. */
function watchDist() {
  let debounce: ReturnType<typeof setTimeout> | null = null;

  watch(distDir, { recursive: true }, () => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      logWithStyle('Change detected, reloading...', ConsoleStyles.INFO);
      notifyClients();
    }, 300);
  });
}

/**
 * Watch a profile's config directory for changes to non-rspack files
 * (settingsOverride.js, favicon.ico) and re-copy them to dist/.
 */
function watchConfigDir(profileName: string) {
  const configDir = resolve(rootDir, 'configs', profileName);

  if (!existsSync(configDir)) {
    return;
  }

  logWithStyle(`Watching configs/${profileName}/ for changes`, ConsoleStyles.INFO);

  watch(configDir, (_, filename) => {
    if (!filename) {
      return;
    }

    const destRelative = CONFIG_FILE_DESTINATIONS[filename];

    if (destRelative) {
      const src = resolve(configDir, filename);
      const dest = resolve(rootDir, destRelative);

      logWithStyle(`Config changed: ${filename} → ${destRelative}`, ConsoleStyles.DEBUG);
      cpSync(src, dest);
      // dist/ watcher will pick up the change and trigger reload
    }
  });
}

/** Reconcile generated assets and start the build toolchain in watch mode. */
function runBuildWatch(args: string[]): void {
  const buildArgs = args.length > 0 ? args : ['development'];

  // Ensure --watch is included
  if (!buildArgs.includes('--watch')) {
    buildArgs.push('--watch');
  }

  // generate-translation.ts below already merges src/locales; the build must not redo it
  if (!buildArgs.includes('--skip-locales')) {
    buildArgs.push('--skip-locales');
  }

  const cwd = rootDir;

  // Reconcile external plugins first (restore clones a fork committed + regenerate
  // the manifest), then translations, then start the watch build. --skip-locales on
  // sync avoids a redundant t7e run since we run generate-translation right after.
  const sync = spawn('npx', ['tsx', './scripts/plugin/index.ts', 'sync', '--skip-locales'], {
    stdio: 'inherit',
    shell: true,
    cwd,
  });

  sync.on('close', () => {
    // Run translations, then start build in watch mode
    const t7e = spawn('npx', ['tsx', './build/generate-translation.ts'], {
      stdio: 'inherit',
      shell: true,
      cwd,
    });

    t7e.on('close', (code) => {
      if (code !== 0) {
        logWithStyle(`Translation generation failed with code ${code}`, ConsoleStyles.ERROR);

        return;
      }

      // Start build in watch mode (runs indefinitely)
      spawn('npx', ['tsx', './build/build-manager.ts', ...buildArgs], {
        stdio: 'inherit',
        shell: true,
        cwd,
      });
    });
  });
}

/** Read the selected profile name from CLI arguments. */
function getProfileName(args: string[]): string | null {
  const profileArg = args.find((arg) => arg.startsWith('--profile='));

  return profileArg ? profileArg.split('=')[1] : null;
}

export interface DevServerRuntime {
  runBuildWatch: typeof runBuildWatch;
  startServer: typeof startServer;
  watchConfigDir: typeof watchConfigDir;
  watchDist: typeof watchDist;
}

const defaultRuntime: DevServerRuntime = {
  runBuildWatch,
  startServer,
  watchConfigDir,
  watchDist,
};

/** Start the static server or the full development server for the supplied CLI arguments. */
export function runDevServer(cliArgs: string[], runtime: DevServerRuntime = defaultRuntime): void {
  const liveReloadEnabled = liveReloadEnabledFor(cliArgs);
  const requestedProfile = getProfileName(cliArgs);
  const securityHeaders = securityHeadersFor(requestedProfile);

  if (!liveReloadEnabled) {
    runtime.startServer(securityHeaders, liveReloadEnabled);

    return;
  }

  const args = cliArgs.filter((arg) => arg !== '--static');
  const profileName = getProfileName(args);

  // Start build in watch mode (non-blocking)
  runtime.runBuildWatch(args);

  // Start server and file watchers
  runtime.startServer(securityHeaders, liveReloadEnabled);
  runtime.watchDist();

  // Watch config directory for non-rspack file changes
  if (profileName) {
    runtime.watchConfigDir(profileName);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDevServer(process.argv.slice(2));
}
