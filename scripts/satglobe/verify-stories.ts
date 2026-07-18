#!/usr/bin/env npx tsx

/**
 * Production story-library acceptance walker.
 *
 * This script always creates a fresh SatGlobe production build before it
 * serves the generated profile, opens Chromium, applies every authored beat,
 * verifies the public adapter state, and captures audit screenshots.
 *
 * Environment overrides:
 *   SATGLOBE_STORY_URL          production-static URL (must remain http://127.0.0.1:5544)
 *   SATGLOBE_STORY_START_SERVER must remain enabled so evidence comes from this process's build
 *   SATGLOBE_STORY_HEADLESS     1 to hide Chromium (headed by default)
 *   SATGLOBE_STORY_OUTPUT_DIR   root for commit-keyed screenshot/manifest runs
 *   SATGLOBE_STORY_TIMEOUT_MS   server and semantic-wait timeout
 */
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  type Browser,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response as PlaywrightResponse,
} from '@playwright/test';
import { SATGLOBE_CSP } from '../../build/dev-server-response';
import { trustedGitExecutable } from '../../build/lib/trusted-executables';
import { storySimulationTime } from '../../src/satglobe/domain/story-time';
import { DEFAULT_FILTERS, type EngineState, type FilterState, type StoryBeat } from '../../src/satglobe/domain/types';
import { storyLibrary } from '../../src/satglobe/stories';

const DEFAULT_APP_URL = 'http://127.0.0.1:5544';
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST_DIR = resolve(ROOT_DIR, 'dist');
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');
const GIT_EXECUTABLE = trustedGitExecutable();
const APP_URL = process.env.SATGLOBE_STORY_URL ?? DEFAULT_APP_URL;
const INITIAL_GIT_PROVENANCE = readGitProvenance();
const GIT_SHA = INITIAL_GIT_PROVENANCE.gitSha;
const IS_DIRTY = INITIAL_GIT_PROVENANCE.dirty;
const STARTED_AT = new Date();
const UTC_RUN_ID = `${STARTED_AT.toISOString().replaceAll(/[-:.]/gu, '')}-${randomUUID()}`;
const RUN_KEY = `${GIT_SHA}${IS_DIRTY ? '-dirty' : ''}-${UTC_RUN_ID}`;
const OUTPUT_ROOT = resolve(ROOT_DIR, process.env.SATGLOBE_STORY_OUTPUT_DIR ?? 'test-results/satglobe-story-shots');
const OUTPUT_DIR = resolve(OUTPUT_ROOT, RUN_KEY);
const CONFIGURED_TIMEOUT_MS = Number(process.env.SATGLOBE_STORY_TIMEOUT_MS);
const TIMEOUT_MS = Number.isFinite(CONFIGURED_TIMEOUT_MS)
  ? Math.min(300_000, Math.max(5_000, CONFIGURED_TIMEOUT_MS))
  : 45_000;
const VIEWPORT = { width: 1440, height: 900 } as const;
// Zoom uses an exponential distance curve, so a hundredth can still represent
// tens of thousands of kilometres. Wait for the rendered pose to settle.
const CAMERA_TOLERANCE = 0.001;
const FETCH_TIMEOUT_MS = 3_000;
const PAINT_TIMEOUT_MS = 5_000;
const ANIMATION_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;
// The public adapter samples KeepTrack every 600 ms. Holding the audit epoch
// across more than two samples proves rate=0 rather than accepting the setter.
const CLOCK_STABILITY_WINDOW_MS = 1_250;
// TimeManager samples Date.now() while applying a requested timestamp, so allow
// only scheduling jitter—not enough drift to change an audited LEO frame.
const SIMULATION_TIME_TOLERANCE_MS = 100;
const BUILD_TIMEOUT_MS = 300_000;

type StoryWalkerWindow = Window & {
  satGlobe?: {
    getState: () => EngineState;
    setPlaybackRate: (rate: number) => void;
    setSimulationTime: (iso: string) => void;
  };
};

interface AuditAnchorRecord {
  playbackRate: 0;
  simulationTime: string;
  source: 'catalog-newest-element-epoch';
  stabilityWindowMs: typeof CLOCK_STABILITY_WINDOW_MS;
}

interface ProductionBuildRecord {
  byteCount: number;
  command: 'direct build:satglobe pipeline';
  completedAt: string;
  fileCount: number;
  identity: string;
  outputDirectory: 'dist';
  profile: 'satglobe';
  sha256: string;
  startedAt: string;
  verifiedAt?: string;
}

interface ServedRootRecord {
  appUrl: typeof DEFAULT_APP_URL;
  firstVerifiedAt: string;
  httpBodyByteCount: number;
  httpBodySha256: string;
  localFile: 'dist/index.html';
  ownership: 'walker-owned-static-server';
  proof: 'http-body-byte-equal-local-file';
  verifiedAt?: string;
}

interface ScreenshotRecord {
  beatId: string;
  beatIndex: number;
  beatTitle: string;
  engine: Pick<EngineState, 'camera' | 'encoding' | 'filters' | 'objectCount' | 'simulationTime' | 'visibleCount'>;
  file: string;
  sha256: string;
  storyId: string;
  storyIndex: number;
  storyTitle: string;
}

interface StaticServerProcess {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
}

interface PageErrorDiagnostic {
  message: string;
  stack?: string;
}

interface RuntimeFailureDiagnostic {
  kind: 'console-error' | 'http-error' | 'page-error' | 'request-failed';
  message: string;
  stack?: string;
  status?: number;
  url?: string;
}

interface GitProvenance {
  dirty: boolean;
  gitSha: string;
  statusPorcelain: string;
  statusSha256: string;
}

interface DomDiagnostic {
  bodyClass?: string;
  catalogStatus?: string;
  captureError?: string;
  engineError?: string;
  storyDeck?: string;
  storyPicker?: string;
  title?: string;
  url?: string;
  visibleCount?: string;
}

interface FailureDiagnostic {
  dom: DomDiagnostic;
  engine?: EngineState;
  message: string;
  pageErrors: PageErrorDiagnostic[];
  phase: string;
  runtimeFailures: RuntimeFailureDiagnostic[];
  stack?: string;
}

interface VerificationManifest {
  appUrl: string;
  auditAnchor?: AuditAnchorRecord;
  completedAt?: string;
  dirty: boolean;
  error?: string;
  failure?: FailureDiagnostic;
  generatedAt: string;
  gitSha: string;
  gitStatusSha256: string;
  pageErrors: PageErrorDiagnostic[];
  phase: string;
  provenanceVerifiedAt?: string;
  productionBuild?: ProductionBuildRecord;
  runKey: string;
  runtimeFailures: RuntimeFailureDiagnostic[];
  screenshots: ScreenshotRecord[];
  servedRoot?: ServedRootRecord;
  status: 'complete' | 'failed' | 'running';
  storyIds: string[];
  viewport: typeof VIEWPORT;
}

const TERMINATION_SIGNALS = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const;

type TerminationSignal = typeof TERMINATION_SIGNALS[number];

class SignalTerminationError extends Error {
  readonly signal: TerminationSignal;

  constructor(signal: TerminationSignal) {
    super(`Story verification interrupted by ${signal}.`);
    this.name = 'SignalTerminationError';
    this.signal = signal;
  }
}

interface TerminationController {
  dispose: () => void;
  getError: () => SignalTerminationError | null;
  promise: Promise<never>;
}

/** Parses the CLI's conventional truthy environment values. */
function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  return value === undefined ? fallback : ['1', 'true', 'yes'].includes(value.toLocaleLowerCase());
}

/** Captures both the commit and exact porcelain state used to label one run. */
function readGitProvenance(): GitProvenance {
  const gitSha = execFileSync(GIT_EXECUTABLE, ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  const statusPorcelain = execFileSync(
    GIT_EXECUTABLE,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: ROOT_DIR, encoding: 'utf8' },
  );

  return {
    dirty: statusPorcelain.length > 0,
    gitSha,
    statusPorcelain,
    statusSha256: createHash('sha256').update(statusPorcelain).digest('hex'),
  };
}

/** Rejects evidence whose source tree changed after its run key was assigned. */
function verifyGitProvenance(initial: GitProvenance): string {
  const current = readGitProvenance();

  if (current.gitSha !== initial.gitSha || current.statusPorcelain !== initial.statusPorcelain) {
    throw new Error(
      'Source provenance changed during story verification: ' +
      `commit ${initial.gitSha} -> ${current.gitSha}; ` +
      `status ${initial.statusSha256} -> ${current.statusSha256}.`,
    );
  }

  return new Date().toISOString();
}

/** Rejects a promise that outlives one explicitly bounded CLI stage. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);

    promise.then((value) => {
      clearTimeout(timer);
      resolvePromise(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
  });
}

/** Converts process termination into a rejected, cleanable verification stage. */
function installTerminationController(): TerminationController {
  let terminationError: SignalTerminationError | null = null;
  let rejectTermination: (error: SignalTerminationError) => void = () => undefined;
  const promise = new Promise<never>((_resolvePromise, rejectPromise) => {
    rejectTermination = rejectPromise;
  });
  const handlers = TERMINATION_SIGNALS.map((signal) => {
    const handler = (): void => {
      if (terminationError) {
        return;
      }
      terminationError = new SignalTerminationError(signal);
      rejectTermination(terminationError);
    };

    process.on(signal, handler);

    return { handler, signal };
  });

  return {
    dispose: () => handlers.forEach(({ handler, signal }) => process.off(signal, handler)),
    getError: () => terminationError,
    promise,
  };
}

/** Stops resource creation after a handled signal has requested cleanup. */
function assertNotTerminating(controller: TerminationController): void {
  const error = controller.getError();

  if (error) {
    throw error;
  }
}

/** Lists regular build-output files without following links outside dist/. */
async function listBuildFiles(directory: string): Promise<string[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const nestedFiles = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return listBuildFiles(path);
    }
    if (entry.isFile()) {
      return Promise.resolve([path]);
    }
    throw new Error(`Production build contains an unsupported filesystem entry: ${relative(ROOT_DIR, path)}`);
  }));

  return nestedFiles.flat();
}

/** Produces a stable content-and-path digest for the complete production tree. */
async function digestProductionBuild(): Promise<Pick<ProductionBuildRecord, 'byteCount' | 'fileCount' | 'sha256'>> {
  const files = await listBuildFiles(DIST_DIR);
  const hash = createHash('sha256');
  let byteCount = 0;

  if (files.length === 0) {
    throw new Error('Fresh SatGlobe production build produced an empty dist directory.');
  }
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop -- sequential reads cap memory while hashing the complete production tree.
    const contents = await readFile(file);
    const buildPath = relative(DIST_DIR, file).split(sep).join('/');

    byteCount += contents.byteLength;
    hash.update(`file\0${buildPath}\0${contents.byteLength}\0`);
    hash.update(contents);
    hash.update('\0');
  }

  return { byteCount, fileCount: files.length, sha256: hash.digest('hex') };
}

/** Runs and identifies a fresh production build even for direct CLI invocation. */
async function buildProductionProfile(): Promise<ProductionBuildRecord> {
  const startedAt = new Date().toISOString();
  const deadline = performance.now() + BUILD_TIMEOUT_MS;

  const steps = [
    ['./scripts/plugin/index.ts', 'sync', '--skip-locales'],
    ['./build/generate-translation.ts'],
    ['./build/build-manager.ts', 'production', '--profile=satglobe', '--skip-locales'],
  ];

  for (const step of steps) {
    const remainingTimeMs = Math.floor(deadline - performance.now());

    if (remainingTimeMs <= 0) {
      throw new Error(`Production build exceeded its ${BUILD_TIMEOUT_MS} ms aggregate deadline.`);
    }
    execFileSync(process.execPath, [TSX_CLI, ...step], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: remainingTimeMs,
    });
  }
  const digest = await digestProductionBuild();

  return {
    ...digest,
    command: 'direct build:satglobe pipeline',
    completedAt: new Date().toISOString(),
    identity: `satglobe-production-${digest.sha256.slice(0, 16)}`,
    outputDirectory: 'dist',
    profile: 'satglobe',
    startedAt,
  };
}

/** Re-hashes the complete local build tree after capture so its identity cannot drift. */
async function verifyProductionBuild(build: ProductionBuildRecord): Promise<string> {
  const current = await digestProductionBuild();

  if (
    current.sha256 !== build.sha256 ||
    current.byteCount !== build.byteCount ||
    current.fileCount !== build.fileCount
  ) {
    throw new Error(
      'Production build changed during story verification: ' +
      `${build.sha256}/${build.fileCount}/${build.byteCount} -> ` +
      `${current.sha256}/${current.fileCount}/${current.byteCount}.`,
    );
  }

  return new Date().toISOString();
}

/** Computes the durable checksum recorded beside one screenshot. */
async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** Resolves an evidence path and refuses any traversal outside this run's directory. */
function artifactPath(relativePath: string): string {
  const path = resolve(OUTPUT_DIR, relativePath);

  if (path !== OUTPUT_DIR && !path.startsWith(`${OUTPUT_DIR}${sep}`)) {
    throw new Error(`Refusing story artifact path outside the run directory: ${relativePath}`);
  }

  return path;
}

/** Records the exact stage that a failed manifest should report. */
function setPhase(manifest: VerificationManifest, phase: string): void {
  manifest.phase = phase;
}

/** Converts authored beat fields into the complete adapter filter state. */
function expectedFilters(beat: StoryBeat): FilterState {
  return {
    ...structuredClone(DEFAULT_FILTERS),
    constellation: beat.constellation ?? '',
    launchCohort: beat.launchCohort ?? '',
    ...beat.filterOverrides,
  };
}

/** Writes the current audit manifest so an interrupted pass still explains its partial output. */
async function writeManifest(manifest: VerificationManifest): Promise<void> {
  const destination = artifactPath('manifest.json');
  const temporary = artifactPath(`manifest.json.${process.pid}.tmp`);

  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporary, destination);
}

/** Refuses targets whose bytes are not owned by this verification process. */
function assertOwnedServerConfiguration(): void {
  if (APP_URL !== DEFAULT_APP_URL) {
    throw new Error(
      `Refusing custom story target ${APP_URL}: durable evidence requires the walker-owned server at ${DEFAULT_APP_URL}.`,
    );
  }
  if (!envFlag('SATGLOBE_STORY_START_SERVER', true)) {
    throw new Error(
      'Refusing SATGLOBE_STORY_START_SERVER=0: durable evidence requires a server started from this run\'s local dist build.',
    );
  }
}

/** Refuses to start when another process already answers at the audit URL. */
async function assertNoExistingServer(): Promise<void> {
  assertOwnedServerConfiguration();
  let response: Response | null = null;

  try {
    response = await fetch(APP_URL, { signal: AbortSignal.timeout(750) });
  } catch {
    return;
  }
  await response.body?.cancel();
  throw new Error(`Refusing to start: another process already responds at ${APP_URL}. Stop that process, then rerun so the walker can own the audited server.`);
}

/** Starts the same static SatGlobe server used by the production E2E lane. */
function startStaticServer(): StaticServerProcess {
  assertOwnedServerConfiguration();

  const child = spawn(process.execPath, [TSX_CLI, './build/dev-server.ts', '--static', '--profile=satglobe'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
  });
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    let output = '';
    let resolved = false;
    const inspectOutput = (chunk: Buffer) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-4_096);
      if (!resolved && output.includes('Serving dist/ at')) {
        resolved = true;
        resolveReady();
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      inspectOutput(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      inspectOutput(chunk);
    });
    child.once('error', rejectReady);
    child.once('exit', (code) => {
      if (!resolved) {
        rejectReady(new Error(`Production-static server exited before binding (code ${code ?? 'unknown'}).`));
      }
    });
  });

  return { child, ready };
}

/** Polls the server semantically and verifies SatGlobe's production CSP. */
async function waitForStaticServer(server: StaticServerProcess): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastFailure = 'no response';

  await withTimeout(server.ready, TIMEOUT_MS, 'Production-static server bind');

  while (Date.now() < deadline) {
    if (server.child.exitCode !== null && server.child.exitCode !== undefined) {
      throw new Error(`Production-static server exited before readiness (code ${server.child.exitCode}).`);
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- this is the readiness probe itself.
      const response = await fetch(APP_URL, {
        signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, Math.max(1, deadline - Date.now()))),
      });

      if (response.ok) {
        const csp = response.headers.get('content-security-policy') ?? '';

        if (csp !== SATGLOBE_CSP) {
          throw new Error('Target did not return the SatGlobe production Content-Security-Policy header.');
        }

        return;
      }
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    // eslint-disable-next-line no-await-in-loop -- bounded backoff between semantic HTTP probes.
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 100);
    });
  }
  throw new Error(`Production-static app was not ready at ${APP_URL}: ${lastFailure}`);
}

/** Fetches the owned HTTP root and proves that its body is the local dist entry point. */
async function readOwnedServedRoot(
  server: StaticServerProcess,
): Promise<Pick<ServedRootRecord, 'httpBodyByteCount' | 'httpBodySha256'>> {
  if (server.child.exitCode !== null || server.child.signalCode !== null) {
    throw new Error('Walker-owned production-static server exited before its HTTP root could be verified.');
  }
  const response = await fetch(DEFAULT_APP_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Walker-owned production-static root returned HTTP ${response.status}.`);
  }
  const httpBody = Buffer.from(await response.arrayBuffer());
  const localBody = await readFile(resolve(DIST_DIR, 'index.html'));
  const httpBodySha256 = createHash('sha256').update(httpBody).digest('hex');
  const localBodySha256 = createHash('sha256').update(localBody).digest('hex');

  if (!httpBody.equals(localBody)) {
    throw new Error(
      'Walker-owned HTTP root does not byte-match dist/index.html: ' +
      `${httpBodySha256}/${httpBody.byteLength} != ${localBodySha256}/${localBody.byteLength}.`,
    );
  }

  return { httpBodyByteCount: httpBody.byteLength, httpBodySha256 };
}

/** Records an honest HTTP-entry-point identity, separate from the complete build-tree digest. */
async function identifyOwnedServedRoot(server: StaticServerProcess): Promise<ServedRootRecord> {
  const servedRoot = await readOwnedServedRoot(server);

  return {
    ...servedRoot,
    appUrl: DEFAULT_APP_URL,
    firstVerifiedAt: new Date().toISOString(),
    localFile: 'dist/index.html',
    ownership: 'walker-owned-static-server',
    proof: 'http-body-byte-equal-local-file',
  };
}

/** Refetches the owned HTTP root and rejects a changed body before finalizing evidence. */
async function verifyOwnedServedRoot(
  servedRoot: ServedRootRecord,
  server: StaticServerProcess,
): Promise<string> {
  const current = await readOwnedServedRoot(server);

  if (
    servedRoot.httpBodySha256 !== current.httpBodySha256 ||
    servedRoot.httpBodyByteCount !== current.httpBodyByteCount
  ) {
    throw new Error(
      'Walker-owned HTTP root changed during story verification: ' +
      `${servedRoot.httpBodySha256}/${servedRoot.httpBodyByteCount} -> ` +
      `${current.httpBodySha256}/${current.httpBodyByteCount}.`,
    );
  }

  return new Date().toISOString();
}

/** Waits a bounded interval for one child-process close event. */
function waitForChildClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolveClose) => {
    const onClose = () => {
      clearTimeout(timer);
      resolveClose(true);
    };
    const timer = setTimeout(() => {
      child.off('close', onClose);
      resolveClose(false);
    }, timeoutMs);

    child.once('close', onClose);
  });
}

/** Stops only the static-server child created by this process. */
async function stopStaticServer(server: StaticServerProcess | null): Promise<void> {
  if (!server || server.child.exitCode !== null) {
    return;
  }
  server.child.kill('SIGTERM');
  if (await waitForChildClose(server.child, SHUTDOWN_TIMEOUT_MS)) {
    return;
  }
  server.child.kill('SIGKILL');
  if (!await waitForChildClose(server.child, SHUTDOWN_TIMEOUT_MS)) {
    throw new Error('Production-static server did not exit after SIGTERM and SIGKILL.');
  }
}

/** Closes both owned runtime resources and reports every bounded cleanup failure. */
async function shutdownRuntime(browser: Browser | null, server: StaticServerProcess | null): Promise<void> {
  const failures: unknown[] = [];

  if (browser?.isConnected()) {
    try {
      await withTimeout(browser.close(), SHUTDOWN_TIMEOUT_MS, 'Chromium shutdown');
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await stopStaticServer(server);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Multiple story-audit resources failed to shut down.');
  }
}

/** Waits for a hydrated adapter, then rejects engine and empty-catalog states. */
async function waitForEngine(page: Page): Promise<EngineState> {
  await page.waitForFunction(() => {
    const state = (window as StoryWalkerWindow).satGlobe?.getState();

    return state?.ready === true || Boolean(state?.error);
  }, undefined, { timeout: TIMEOUT_MS });
  const state = await page.evaluate(() => (window as StoryWalkerWindow).satGlobe?.getState());

  if (!state) {
    throw new Error('SatGlobe did not expose its engine adapter.');
  }
  if (state.error) {
    throw new Error(`SatGlobe engine error: ${state.error}`);
  }
  if (state.objectCount <= 0) {
    throw new Error('SatGlobe hydrated an empty catalog.');
  }

  return state;
}

/** Stops propagation and places the engine on the catalog-derived audit epoch. */
async function freezeAuditSimulation(page: Page, simulationTime: string): Promise<EngineState> {
  const expectedTimeMs = Date.parse(simulationTime);

  if (!Number.isFinite(expectedTimeMs)) {
    throw new Error(`Catalog newestElementEpoch is not a valid audit anchor: ${simulationTime || '(empty)'}`);
  }
  await page.evaluate(({ auditSimulationTime }) => {
    const adapter = (window as StoryWalkerWindow).satGlobe;

    if (!adapter) {
      throw new Error('SatGlobe adapter disappeared before the audit clock could be frozen.');
    }
    adapter.setPlaybackRate(0);
    adapter.setSimulationTime(auditSimulationTime);
  }, { auditSimulationTime: simulationTime });
  await page.waitForFunction(({ auditSimulationTimeMs, timeToleranceMs }) => {
    const state = (window as StoryWalkerWindow).satGlobe?.getState();
    const actualTimeMs = Date.parse(state?.simulationTime ?? '');

    return Boolean(state?.ready) && Number.isFinite(actualTimeMs) &&
      Math.abs(actualTimeMs - auditSimulationTimeMs) <= timeToleranceMs;
  }, { auditSimulationTimeMs: expectedTimeMs, timeToleranceMs: SIMULATION_TIME_TOLERANCE_MS }, { timeout: TIMEOUT_MS });

  const stabilityStartedAt = await page.evaluate(() => performance.now());

  try {
    await page.waitForFunction(({ auditSimulationTimeMs, stabilityStartedAtMs, stabilityWindowMs, timeToleranceMs }) => {
      const state = (window as StoryWalkerWindow).satGlobe?.getState();
      const actualTimeMs = Date.parse(state?.simulationTime ?? '');

      return performance.now() - stabilityStartedAtMs >= stabilityWindowMs &&
        state?.ready === true &&
        Number.isFinite(actualTimeMs) &&
        Math.abs(actualTimeMs - auditSimulationTimeMs) <= timeToleranceMs;
    }, {
      auditSimulationTimeMs: expectedTimeMs,
      stabilityStartedAtMs: stabilityStartedAt,
      stabilityWindowMs: CLOCK_STABILITY_WINDOW_MS,
      timeToleranceMs: SIMULATION_TIME_TOLERANCE_MS,
    }, { timeout: CLOCK_STABILITY_WINDOW_MS + 2_000 });
  } catch (error) {
    const actual = await page.evaluate(() => (window as StoryWalkerWindow).satGlobe?.getState());

    throw new Error(
      `Audit clock did not remain fixed at ${simulationTime} for ${CLOCK_STABILITY_WINDOW_MS} ms; ` +
      `actual ${actual?.simulationTime ?? '(unavailable)'}.`,
      { cause: error },
    );
  }

  return waitForEngine(page);
}

/** Waits until the adapter exposes every authored effect for one beat. */
async function waitForBeat(
  page: Page,
  beat: StoryBeat,
  storyAnchorIso: string,
  timeBeforeBeatIso: string,
): Promise<EngineState> {
  const expectedSimulationTime = beat.simulationTimeOffsetHours === undefined
    ? timeBeforeBeatIso
    : storySimulationTime(storyAnchorIso, beat.simulationTimeOffsetHours);
  const expected = {
    camera: beat.camera,
    encoding: beat.encoding,
    filters: expectedFilters(beat),
    simulationTime: expectedSimulationTime,
    simulationTimeMs: Date.parse(expectedSimulationTime),
  };

  try {
    await page.waitForFunction(({ cameraTolerance, expectedState, timeToleranceMs }) => {
      const state = (window as StoryWalkerWindow).satGlobe?.getState();

      if (state?.error) {
        return true;
      }
      if (!state?.ready) {
        return false;
      }
      const cameraMatches = Math.abs(state.camera.pitch - expectedState.camera.pitch) <= cameraTolerance &&
        Math.abs(state.camera.yaw - expectedState.camera.yaw) <= cameraTolerance &&
        Math.abs(state.camera.zoom - expectedState.camera.zoom) <= cameraTolerance;
      const filtersMatch = JSON.stringify(state.filters) === JSON.stringify(expectedState.filters);
      const timeDelta = Math.abs(Date.parse(state.simulationTime) - expectedState.simulationTimeMs);

      return cameraMatches &&
        state.encoding === expectedState.encoding &&
        filtersMatch &&
        Number.isFinite(timeDelta) &&
        timeDelta <= timeToleranceMs;
    }, { cameraTolerance: CAMERA_TOLERANCE, expectedState: expected, timeToleranceMs: SIMULATION_TIME_TOLERANCE_MS }, { timeout: TIMEOUT_MS });
  } catch (error) {
    const actual = await page.evaluate(() => (window as StoryWalkerWindow).satGlobe?.getState());
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(`Beat “${beat.id}” did not settle. Expected ${JSON.stringify(expected)}; actual ${JSON.stringify(actual)}; ${reason}`, { cause: error });
  }
  const state = await waitForEngine(page);

  if (state.visibleCount <= 0) {
    throw new Error(`Beat “${beat.id}” produced an empty scene.`);
  }

  return state;
}

/** Captures bounded engine and DOM evidence for a failed audit manifest. */
async function failureDiagnostic(page: Page | null, manifest: VerificationManifest, error: unknown): Promise<FailureDiagnostic> {
  const message = error instanceof Error ? error.message : String(error);
  const diagnostic: FailureDiagnostic = {
    dom: {},
    message,
    pageErrors: [...manifest.pageErrors],
    phase: manifest.phase,
    runtimeFailures: [...manifest.runtimeFailures],
    stack: error instanceof Error ? error.stack : undefined,
  };

  if (!page || page.isClosed()) {
    diagnostic.dom.captureError = 'Page was not available for failure diagnostics.';

    return diagnostic;
  }
  try {
    diagnostic.engine = await withTimeout(
      page.evaluate(() => (window as StoryWalkerWindow).satGlobe?.getState()),
      FETCH_TIMEOUT_MS,
      'Engine diagnostic capture',
    );
  } catch (captureError) {
    diagnostic.dom.captureError = `Engine: ${captureError instanceof Error ? captureError.message : String(captureError)}`;
  }
  try {
    diagnostic.dom = {
      ...diagnostic.dom,
      ...await withTimeout(page.evaluate(() => ({
        bodyClass: document.body.className,
        catalogStatus: document.querySelector('[data-testid="catalog-status"]')?.textContent?.trim(),
        engineError: document.querySelector('[data-testid="engine-error"]')?.textContent?.trim(),
        storyDeck: document.querySelector('[data-testid="story-deck"]')?.textContent?.trim().slice(0, 1_000),
        storyPicker: document.querySelector<HTMLSelectElement>('[data-testid="story-picker"]')?.value,
        title: document.title,
        url: window.location.href,
        visibleCount: document.querySelector('[data-testid="visible-count"]')?.textContent?.trim(),
      })), FETCH_TIMEOUT_MS, 'DOM diagnostic capture'),
    };
  } catch (captureError) {
    diagnostic.dom.captureError = `${diagnostic.dom.captureError ?? ''} DOM: ${captureError instanceof Error ? captureError.message : String(captureError)}`.trim();
  }

  return diagnostic;
}

/** Lets the renderer paint the semantically verified state without a fixed sleep. */
async function waitForPaint(page: Page): Promise<void> {
  // String evaluation follows benchmark-runtime-lite's Playwright/tsx pattern;
  // it avoids tsx's injected __name helper leaking into the browser realm.
  await page.evaluate(`new Promise((resolvePaint, rejectPaint) => {
    let frames = 0;
    const timeout = setTimeout(() => rejectPaint(new Error('Renderer did not paint within ${PAINT_TIMEOUT_MS} ms.')), ${PAINT_TIMEOUT_MS});
    const onFrame = () => {
      frames += 1;
      if (frames >= 4) {
        clearTimeout(timeout);
        resolvePaint();
      }
      else window.requestAnimationFrame(onFrame);
    };
    window.requestAnimationFrame(onFrame);
  })`);
}

/** Waits until CSS animations/transitions stay inactive across two frames. */
async function waitForDocumentAnimations(page: Page): Promise<void> {
  // Polling on animation frames catches transitions created while a prior one
  // completes, while an independent timer also handles suspended frame callbacks.
  await page.evaluate(`new Promise((resolveAnimations, rejectAnimations) => {
    let animationFrame = 0;
    let quietFrames = 0;
    let settled = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      if (error) rejectAnimations(error);
      else resolveAnimations();
    };
    const timeout = setTimeout(() => {
      settle(new Error('Document animations did not settle within ${ANIMATION_TIMEOUT_MS} ms.'));
    }, ${ANIMATION_TIMEOUT_MS});
    const onFrame = () => {
      animationFrame = 0;
      if (settled) return;
      const activeAnimations = document.getAnimations().filter((animation) =>
        animation.playState === 'pending' || animation.playState === 'running');

      quietFrames = activeAnimations.length === 0 ? quietFrames + 1 : 0;
      if (quietFrames >= 2) {
        settle();
      }
      else animationFrame = window.requestAnimationFrame(onFrame);
    };

    animationFrame = window.requestAnimationFrame(onFrame);
  })`);
}

/** Makes browser-console and resource failures first-class acceptance evidence. */
function attachRuntimeFailureListeners(page: Page, manifest: VerificationManifest): () => void {
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() !== 'error') {
      return;
    }
    const location = message.location();
    const url = location.url || undefined;

    manifest.runtimeFailures.push({
      kind: 'console-error',
      message: message.text(),
      url: url ? `${url}:${location.lineNumber}:${location.columnNumber}` : undefined,
    });
  };
  const onPageError = (error: Error): void => {
    const diagnostic = { message: error.message, stack: error.stack };

    manifest.pageErrors.push(diagnostic);
    manifest.runtimeFailures.push({
      kind: 'page-error',
      ...diagnostic,
    });
  };
  const onRequestFailed = (request: Request): void => {
    manifest.runtimeFailures.push({
      kind: 'request-failed',
      message: request.failure()?.errorText ?? 'Request failed without a browser error string.',
      url: request.url(),
    });
  };
  const onResponse = (response: PlaywrightResponse): void => {
    if (response.status() < 400) {
      return;
    }
    manifest.runtimeFailures.push({
      kind: 'http-error',
      message: `HTTP ${response.status()} ${response.statusText()}`.trim(),
      status: response.status(),
      url: response.url(),
    });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
  };
}

/** Stops the walk at the first browser/runtime failure with actionable detail. */
function assertNoRuntimeFailures(manifest: VerificationManifest): void {
  if (manifest.runtimeFailures.length === 0) {
    return;
  }
  const details = manifest.runtimeFailures.map(({ kind, message, status, url }) =>
    `${kind}${status === undefined ? '' : `(${status})`}: ${message}${url ? ` @ ${url}` : ''}`);

  throw new Error(`Browser runtime failures: ${details.join(' | ')}`);
}

/** Checks that the rendered picker is an exact view of the imported library. */
async function verifyPicker(page: Page): Promise<void> {
  const picker = page.getByTestId('story-picker');

  await picker.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
  const pickerIds = await picker.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const libraryIds = storyLibrary.map(({ id }) => id);

  if (JSON.stringify(pickerIds) !== JSON.stringify(libraryIds)) {
    throw new Error(`Story picker/library mismatch: picker=${pickerIds.join(',')} library=${libraryIds.join(',')}`);
  }
}

/** Verifies the visible chapter, not only engine state that adjacent beats may share. */
async function verifyActiveBeat(
  page: Page,
  storyId: string,
  beat: StoryBeat,
  beatIndex: number,
  beatCount: number,
): Promise<void> {
  const expectedCounter = `${String(beatIndex + 1).padStart(2, '0')} / ${String(beatCount).padStart(2, '0')}`;
  const expected = { beatId: beat.id, counter: expectedCounter, storyId, title: beat.title };

  try {
    await page.waitForFunction((expectedBeat) => {
      const deck = document.querySelector<HTMLElement>('[data-testid="story-deck"]');
      const title = document.querySelector<HTMLElement>('[data-testid="story-beat-title"]')?.textContent?.trim();
      const counter = document.querySelector<HTMLElement>('[data-testid="story-beat-counter"]')?.textContent?.trim();

      return deck?.dataset.storyId === expectedBeat.storyId &&
        deck.dataset.beatId === expectedBeat.beatId &&
        title === expectedBeat.title &&
        counter === expectedBeat.counter;
    }, expected, { timeout: TIMEOUT_MS });
  } catch (error) {
    const actual = await page.evaluate(() => {
      const deck = document.querySelector<HTMLElement>('[data-testid="story-deck"]');

      return {
        beatId: deck?.dataset.beatId,
        counter: document.querySelector<HTMLElement>('[data-testid="story-beat-counter"]')?.textContent?.trim(),
        storyId: deck?.dataset.storyId,
        title: document.querySelector<HTMLElement>('[data-testid="story-beat-title"]')?.textContent?.trim(),
      };
    });

    throw new Error(
      `Beat UI did not settle. Expected ${JSON.stringify(expected)}; actual ${JSON.stringify(actual)}.`,
      { cause: error },
    );
  }
}

/** Walks every library beat and adds its screenshot/state evidence to the manifest. */
async function walkStories(page: Page, manifest: VerificationManifest): Promise<void> {
  setPhase(manifest, 'browser:navigate');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  setPhase(manifest, 'engine:hydrate');
  const initialState = await waitForEngine(page);
  const storyAnchorIso = initialState.newestElementEpoch;

  setPhase(manifest, 'engine:freeze-audit-anchor');
  manifest.auditAnchor = {
    playbackRate: 0,
    simulationTime: storyAnchorIso,
    source: 'catalog-newest-element-epoch',
    stabilityWindowMs: CLOCK_STABILITY_WINDOW_MS,
  };
  await freezeAuditSimulation(page, storyAnchorIso);
  await writeManifest(manifest);
  setPhase(manifest, 'story:open');
  await page.getByTestId('story-mode').click();
  await verifyPicker(page);
  assertNoRuntimeFailures(manifest);

  for (const [storyIndex, story] of storyLibrary.entries()) {
    if (storyIndex > 0) {
      setPhase(manifest, `story:${story.id}:freeze-audit-anchor`);
      // eslint-disable-next-line no-await-in-loop -- each story is reset to the one catalog-derived audit epoch before selection.
      await freezeAuditSimulation(page, storyAnchorIso);
    }
    setPhase(manifest, `story:${story.id}:select`);
    // eslint-disable-next-line no-await-in-loop -- every picker transition starts the next authored scene.
    await page.getByTestId('story-picker').selectOption(story.id);
    // eslint-disable-next-line no-await-in-loop -- each manifest has a different rendered beat count.
    await page.waitForFunction(({ expectedCount, storyId }) => {
      const picker = document.querySelector<HTMLSelectElement>('[data-testid="story-picker"]');
      const buttons = document.querySelectorAll('[data-testid="story-deck"] .sg-story-beats button');

      return picker?.value === storyId && buttons.length === expectedCount;
    }, { expectedCount: story.beats.length, storyId: story.id }, { timeout: TIMEOUT_MS });
    const beatButtons = page.locator('[data-testid="story-deck"] .sg-story-beats button');

    // eslint-disable-next-line no-await-in-loop -- validates the just-rendered story before its ordered beat walk.
    if (await beatButtons.count() !== story.beats.length) {
      throw new Error(`Story “${story.id}” is missing rendered beat controls.`);
    }

    for (const [beatIndex, beat] of story.beats.entries()) {
      setPhase(manifest, `story:${story.id}:beat:${beat.id}:apply`);
      // eslint-disable-next-line no-await-in-loop -- screenshots must follow authored presentation order.
      const beforeState = await waitForEngine(page);

      // eslint-disable-next-line no-await-in-loop -- each click is verified before the next beat mutates the scene.
      await beatButtons.nth(beatIndex).click();
      // eslint-disable-next-line no-await-in-loop -- adjacent beats can share engine state, so the visible chapter is an independent acceptance signal.
      await verifyActiveBeat(page, story.id, beat, beatIndex, story.beats.length);
      // eslint-disable-next-line no-await-in-loop -- establish the authored state before waiting for the renderer.
      await waitForBeat(page, beat, storyAnchorIso, beforeState.simulationTime);

      // eslint-disable-next-line no-await-in-loop -- rAF paint completion belongs to the current verified beat.
      await waitForPaint(page);
      // eslint-disable-next-line no-await-in-loop -- UI transitions must settle before this beat's durable capture.
      await waitForDocumentAnimations(page);
      // eslint-disable-next-line no-await-in-loop -- reject engine post-frame normalization that moved away from the authored state.
      const state = await waitForBeat(page, beat, storyAnchorIso, beforeState.simulationTime);

      assertNoRuntimeFailures(manifest);
      const file = `${story.id}/${String(beatIndex + 1).padStart(2, '0')}-${beat.id}.png`;
      const screenshotPath = artifactPath(file);

      // eslint-disable-next-line no-await-in-loop -- each story owns an audit subdirectory under the immutable commit key.
      await mkdir(dirname(screenshotPath), { recursive: true });
      setPhase(manifest, `story:${story.id}:beat:${beat.id}:screenshot`);
      // eslint-disable-next-line no-await-in-loop -- viewport screenshot order is part of the durable audit manifest.
      await page.screenshot({ fullPage: false, path: screenshotPath });
      // eslint-disable-next-line no-await-in-loop -- checksum belongs to the exact screenshot just captured.
      const screenshotSha256 = await sha256File(screenshotPath);

      manifest.screenshots.push({
        beatId: beat.id,
        beatIndex,
        beatTitle: beat.title,
        engine: {
          camera: state.camera,
          encoding: state.encoding,
          filters: state.filters,
          objectCount: state.objectCount,
          simulationTime: state.simulationTime,
          visibleCount: state.visibleCount,
        },
        file,
        sha256: screenshotSha256,
        storyId: story.id,
        storyIndex,
        storyTitle: story.title,
      });
      // eslint-disable-next-line no-await-in-loop -- persist partial progress after each expensive browser capture.
      await writeManifest(manifest);
      console.log(`Captured ${story.id} ${beatIndex + 1}/${story.beats.length}: ${relative(ROOT_DIR, screenshotPath)}`);
    }
  }
  setPhase(manifest, 'story-walk:complete');
}

await mkdir(OUTPUT_ROOT, { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: false });
const manifest: VerificationManifest = {
  appUrl: APP_URL,
  dirty: IS_DIRTY,
  generatedAt: STARTED_AT.toISOString(),
  gitSha: GIT_SHA,
  gitStatusSha256: INITIAL_GIT_PROVENANCE.statusSha256,
  pageErrors: [],
  phase: 'initialize',
  runKey: RUN_KEY,
  runtimeFailures: [],
  screenshots: [],
  status: 'running',
  storyIds: storyLibrary.map(({ id }) => id),
  viewport: VIEWPORT,
};
let browser: Browser | null = null;
let detachRuntimeFailureListeners: () => void = () => undefined;
let page: Page | null = null;
let server: StaticServerProcess | null = null;
let runError: unknown = null;

await writeManifest(manifest);
const terminationController = installTerminationController();

const verificationPromise = (async (): Promise<void> => {
  setPhase(manifest, 'server:ownership');
  assertOwnedServerConfiguration();
  setPhase(manifest, 'build:production');
  await writeManifest(manifest);
  const productionBuild = await buildProductionProfile();

  Object.assign(manifest, { productionBuild });
  assertNotTerminating(terminationController);
  await writeManifest(manifest);
  setPhase(manifest, 'server:preflight');
  await assertNoExistingServer();
  assertNotTerminating(terminationController);
  setPhase(manifest, 'server:start');
  const ownedServer = startStaticServer();

  server = ownedServer;
  await waitForStaticServer(ownedServer);
  Object.assign(manifest, { servedRoot: await identifyOwnedServedRoot(ownedServer) });
  await writeManifest(manifest);
  assertNotTerminating(terminationController);
  setPhase(manifest, 'browser:launch');
  await writeManifest(manifest);
  browser = await chromium.launch({
    // This process owns bounded signal finalization; Playwright's default
    // handlers re-raise the signal before the manifest can be marked failed.
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    headless: envFlag('SATGLOBE_STORY_HEADLESS', false),
    timeout: TIMEOUT_MS,
  });
  assertNotTerminating(terminationController);
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    viewport: VIEWPORT,
  });

  page = await context.newPage();
  detachRuntimeFailureListeners = attachRuntimeFailureListeners(page, manifest);
  await walkStories(page, manifest);
  assertNotTerminating(terminationController);
  assertNoRuntimeFailures(manifest);
  setPhase(manifest, 'server:verify-root-unchanged');
  if (!manifest.servedRoot) {
    throw new Error('Walker-owned served-root identity was not recorded before browser evidence capture.');
  }
  const servedRoot = manifest.servedRoot;
  const servedRootVerifiedAt = await verifyOwnedServedRoot(servedRoot, ownedServer);

  Object.assign(servedRoot, { verifiedAt: servedRootVerifiedAt });
  setPhase(manifest, 'build:verify-unchanged');
  const buildVerifiedAt = await verifyProductionBuild(productionBuild);

  productionBuild.verifiedAt = buildVerifiedAt;
  assertNotTerminating(terminationController);
  setPhase(manifest, 'source:verify-provenance');
  manifest.provenanceVerifiedAt = verifyGitProvenance(INITIAL_GIT_PROVENANCE);
  await writeManifest(manifest);
})();

try {
  await Promise.race([verificationPromise, terminationController.promise]);
  // Listeners remain attached through the final build/provenance checks. Recheck
  // immediately before their synchronous removal so a late browser/network
  // failure cannot coexist with a complete manifest.
  assertNoRuntimeFailures(manifest);
} catch (error) {
  runError = error;
  if (!terminationController.getError()) {
    manifest.failure = await failureDiagnostic(page, manifest, error);
  }
}

detachRuntimeFailureListeners();
detachRuntimeFailureListeners = () => undefined;
setPhase(manifest, 'cleanup');
try {
  await shutdownRuntime(browser, server);
} catch (cleanupError) {
  runError = runError
    ? new AggregateError([runError, cleanupError], 'Story audit and runtime cleanup both failed.')
    : cleanupError;
  manifest.failure = {
    ...(manifest.failure ?? await failureDiagnostic(page, manifest, runError)),
    message: runError instanceof Error ? runError.message : String(runError),
    phase: manifest.phase,
    stack: runError instanceof Error ? runError.stack : undefined,
  };
}

let terminationError = terminationController.getError();

if (terminationError) {
  setPhase(manifest, `signal:${terminationError.signal}`);
  // The signal can win the race while an awaited resource acquisition is
  // still pending. The first shutdown interrupts already-published resources;
  // waiting here lets a late chromium.launch() publish its Browser reference.
  // Only after the task settles is a second, idempotent shutdown conclusive.
  await verificationPromise.catch(() => undefined);
  setPhase(manifest, `signal:${terminationError.signal}:final-cleanup`);
  try {
    await shutdownRuntime(browser, server);
  } catch (finalCleanupError) {
    runError = runError
      ? new AggregateError([runError, finalCleanupError], 'Story audit interruption and final runtime cleanup both failed.')
      : finalCleanupError;
  }
  runError ??= terminationError;
  setPhase(manifest, `signal:${terminationError.signal}`);
  manifest.failure = await failureDiagnostic(page, manifest, runError);
}

manifest.completedAt = new Date().toISOString();
if (runError) {
  manifest.status = 'failed';
  manifest.error = runError instanceof Error ? runError.message : String(runError);
  await writeManifest(manifest);
  terminationController.dispose();
  if (terminationError) {
    process.exitCode = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[terminationError.signal];
    console.error(manifest.error);
  } else {
    throw runError;
  }
} else {
  setPhase(manifest, 'complete');
  manifest.status = 'complete';
  await writeManifest(manifest);
  // A handled signal may arrive while the atomic success manifest is being
  // written. Re-read synchronously after that final await, then remove the
  // handlers without yielding so success cannot be reported from a stale
  // pre-write termination snapshot.
  terminationError = terminationController.getError();
  terminationController.dispose();
  if (terminationError) {
    setPhase(manifest, `signal:${terminationError.signal}`);
    manifest.completedAt = new Date().toISOString();
    manifest.status = 'failed';
    manifest.error = terminationError.message;
    manifest.failure = await failureDiagnostic(page, manifest, terminationError);
    await writeManifest(manifest);
    process.exitCode = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[terminationError.signal];
    console.error(manifest.error);
  } else {
    console.log(`Verified ${storyLibrary.length} stories / ${manifest.screenshots.length} beats. Manifest: ${relative(ROOT_DIR, artifactPath('manifest.json'))}`);
  }
}
