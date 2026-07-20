# SatGlobe Codebase Grade Report

- **Repository:** jtn0123/SatGlobe (fork of KeepTrack.space v13.4.0, upstream commit `f06b30bd`)
- **Audited commit:** `c9fdf79de6ec442178ca06a92de16ff820ac1f01` (2026-07-18)
- **Audit date:** 2026-07-20
- **Method:** Nine-category read-only audit performed by parallel specialized reviewers, every finding verified against the cited file and line before inclusion. No source code was modified. Scale: ~1,408 TypeScript files in `src/`, 614 test files, 72 npm scripts, 8 build profiles.
- **Grading policy (per request):** Security and Testing & Reliability are double-weighted in the overall grade.

---

## Overall Grade: **B+**

| Weighted computation | |
|---|---|
| A Architecture B (3.0) ×1 · B Backend A- (3.7) ×1 · C Frontend B+ (3.3) ×1 · **D Testing B+ (3.3) ×2** · **E Security B+ (3.3) ×2** · F Dependencies B+ (3.3) ×1 · G Performance A- (3.7) ×1 · H Docs B+ (3.3) ×1 · I DX A- (3.7) ×1 | **37.2 / 11 = 3.38 → B+** |

**The one-paragraph verdict.** SatGlobe is really two codebases sharing a repo. The fork-authored layer (`src/satglobe`, the data-refresh pipeline, the benchmark/CI tooling) is A-grade work: a lint-enforced anti-corruption boundary written up in an ADR, `.strict()` zod validation with byte ceilings and origin pinning on every remote read, transactional catalog installs with rollback, exemplary behavioral tests with injected clocks, and performance that is budgeted and gated rather than guessed. The inherited KeepTrack engine is C+-grade: inverted layering (engine imports app/plugins in 125 places, with a hard import cycle), 53 files consuming an ambient `window.settingsManager`, ~256 `innerHTML` sites of which several still interpolate catalog-derived satellite names unescaped, 582 `not.toThrow()` smoke assertions, and a non-strict base tsconfig. The authors demonstrably know where the debt is — the boundary fences, strict-mode ratchet, and ADRs prove it — but the double-weighted categories (Security, Testing) both sit at B+ because the inherited surface is where the exploitable sinks and the untested branches live.

---

## Summary Table

| Category | Grade | One-line rationale |
|---|---|---|
| A. Architecture & Design | **B** | `src/satglobe` is a textbook, lint-enforced anti-corruption layer (A-grade); the inherited engine has inverted layering — 125 upward imports across 42 files, a hard `keeptrack↔engine↔plugins` cycle, and an ambient-global settings singleton (C+). |
| B. Backend Quality | **A-** | Transactional, provenance-checked data pipeline with rollback + ~900 lines of tests and a realpath-hardened dev server; docked for shell-string `exec` in three utilities and unbounded downloads in `catalog-refresh`. |
| C. Frontend Quality | **B+** | React layer has real a11y engineering and disciplined state; docked for a global key handler that hijacks Ctrl/Cmd+F, no error boundary, a defeated memo on the heaviest panel, and a legacy layer with zero `removeEventListener` calls. |
| D. Testing & Reliability ×2 | **B+** | 614 test files, blocking CI gates, exemplary domain tests; docked because 85/86 Playwright specs never run in CI, the vendored ootk math suite (124 test files) is never executed, and branch coverage floor is 57%. |
| E. Security ×2 | **B+** | Real CSP with parity tests, hardened loopback dev servers, zod-validated remote reads, 0 `npm audit` findings, CodeQL; docked for unescaped catalog names reaching `innerHTML` in several plugins, CSP on only 1 of 8 profiles, and `'unsafe-eval'` in script-src. |
| F. Dependencies & Tech Currency | **B+** | Core stack genuinely current (React 19, TS 5.9, ESLint 9, vitest 4, rspack 2; single fresh lockfile, 0 vulns); docked for `numeric` (unmaintained since ~2012) in runtime paths, a misclassified prod dep, dead tsup + broken `prepublishOnly`, and a 4-way transpiler pile-up. |
| G. Performance & Scalability | **A-** | Worker-side culling, zero-copy transfers, budgeted+gated benchmarks (59.8 FPS idle, 6.5 MiB bundle ceiling), documented idle-render budget; docked for Close Objects SGP4 running on the main thread while its purpose-built worker ships as dead code. |
| H. Documentation & Onboarding | **B+** | Fork-authored docs excellent (accurate README, textbook AGPL notice, ADRs); docked because the inherited layer wasn't swept — contributing.md contradicts the README, `.env.example` is stale upstream content, typedoc omits `src/satglobe` entirely. |
| I. Developer Experience & Tooling | **A-** | `verify:satglobe` is a true one-command CI mirror; ESLint enforces the architecture with rationale comments; docked for two broken npm scripts, 72-script sprawl, a pre-commit/CI lint mismatch, and 4× duplicated CI setup with no Playwright cache. |
| **Overall (Security & Testing ×2)** | **B+** | |

---

## Top 5 Highest-Leverage Improvements

1. **E1 + E2 — Escape catalog-derived names at every `innerHTML` sink and ship a baseline CSP on all profiles.** Satellite names from remote TLE/JSON catalogs are interpolated unescaped in at least five plugins (`src/plugins/sat-info-box/sat-info-box.ts:343`, `watchlist.ts:594→605`, `sat-constellations.ts:646→655`, `breakup-analysis-table.ts:227→breakup-analysis.ts:442`), and 7 of 8 deployment profiles ship **no CSP at all** (`build/dev-server-response.ts:23-32`; only `configs/satglobe/nginx.conf:12`). Together that is stored XSS on non-satglobe profiles. The fix is mechanical — the repo's own `escapeHtml` (`src/engine/utils/escape-html.ts:7`) is already used correctly in search and hover — plus one `<meta http-equiv>` tag in `public/index.html`. *Effort S+M, lifts Security B+ → A-.*
2. **D1 — Put the Playwright suite in CI.** 85 of 86 E2E spec files (plugin journeys, app smoke, WASM parity, orbit-line stability) are configured (`playwright.config.ts:9-10`) but never executed by any workflow — CI runs exactly one file (`.github/workflows/build-pipeline.yml:122-123` → `package.json:80`). They are silently rotting. Add a blocking (or nightly) full-suite job and fix the four hard `waitForTimeout` sleeps (D6) as specs are promoted. *Effort M, lifts Testing B+ → A-.*
3. **D2 — Actually run the vendored ootk test suite.** The astrodynamics library that computes every orbit on screen carries 124 test files that are excluded from discovery and coverage (`vitest.config.ts:90`, `:59`) and referenced by no workflow — the most correctness-critical math in the app is never exercised by this repo's CI, including any local modifications since vendoring. One scoped CI step fixes it. *Effort S-M, cheapest Major fix in the report.*
4. **C1 + C2 — Fix the global keyboard handler and add a React error boundary.** The window-level handler (`src/satglobe/app/satglobe-app.tsx:208-246`) never checks modifier keys, so Ctrl/Cmd+F silently triggers presentation mode and blocks browser Find, and Space is stolen from focused buttons; separately, `bootstrap.tsx:21-25` mounts with no error boundary, so one bad catalog record (e.g. `inspector.tsx:53`) blanks the entire shell. Both are small, user-facing, high-visibility fixes. *Effort S each, lifts Frontend B+ → A-.*
5. **G1 — Move Close Objects screening onto its already-built worker.** `findCloseObjects_` re-propagates every candidate pair synchronously on the main thread (`src/plugins/close-objects/close-objects.ts:175-194`, `:258-272`), freezing the UI for seconds on a 20k catalog — while `src/webworker/closeObjectsWorker.ts:95-238` and `CloseObjectsThreadManager` (`src/app/threads/close-objects-thread-manager.ts:45-46`) implement exactly this flow and ship in the bundle unused. Fixing the off-by-design sweep bound (G2, `close-objects.ts:238`) at the same time removes ~4M wasted iterations. *Effort M, lifts Performance A- → A.*

---

# Category Reports

Within each category, findings are ordered by impact, then expected grade lift, then effort (smaller first). Grade lift is expressed as the contribution toward the next grade step for that category; where several findings share a lift, they jointly gate the step.

---

## A. Architecture & Design — Grade: B

**Justification.** The fork's own contribution is genuinely well-architected: `src/satglobe` is a textbook anti-corruption layer with a pure domain core (zod + types only), a single adapter seam to the upstream engine (`src/satglobe/engine/satglobe-engine-adapter.ts`, 716 lines, injectable seams at :36-40), and the boundary is *machine-enforced* by ESLint (`eslint.config.mjs:314-321`) per a written ADR (`docs/adr/0001-satglobe-source-fork.md`). The inherited upstream has been partially modernized (typed EventBus, ServiceLocator/Container, declarative lazy plugin manifest). What holds the grade at B is the upstream core's inverted layering, a hard import cycle, an ambient-global settings singleton, and config sprawl. New code: A. Inherited core: C+. Blended, with credit for the debt being mapped and fenced: B.

### Findings

**A1 — Engine layer depends upward on app, plugins, and the application root**
- **Where:** 125 non-test imports from `src/engine/**` into `@app/app/*`, `@app/plugins/*`, `@app/settings/*`, `@app/keeptrack`, `@app/locales` across 42 files. Representative: `src/engine/plugins/base-plugin.ts:2-8`, `src/engine/core/scene.ts:3-4`, `src/engine/camera/camera.ts:24-28`, `src/engine/rendering/color-scheme-manager.ts:30-36`. `SelectSatManager` alone is imported from engine 17×.
- **What's wrong:** "Engine" is not a layer — it cannot be built, tested, or reused without the entire app and plugin set, despite `tsconfig.base.json` defining an `@engine/*` alias and `tsconfig.library.json` existing for a library build.
- **Impact:** Major
- **Fix:** Define the interfaces engine actually needs in `src/engine/core/interfaces.ts`, register concrete implementations in the existing `Container` (`src/engine/core/container.ts:9`), and add a `no-restricted-imports` ESLint block for `src/engine/**` mirroring the satglobe fence (`eslint.config.mjs:314-321`). Ratchet: forbid new violations first, burn down the 42 files over time.
- **Effort:** L
- **Grade lift:** A1+A2+A3 jointly are the B → B+/A- step for this category.

**A2 — Hard circular dependency: keeptrack ↔ engine ↔ plugins**
- **Where:** `src/keeptrack.ts:49` → `src/engine/engine.ts:2` (imports `PluginManager` from `../plugins/plugins`) → `src/plugins/plugins.ts:4` (imports `KeepTrackPlugin` from `../engine/plugins/base-plugin`) → `src/engine/plugins/base-plugin.ts:6` (imports `KeepTrack` from `@app/keeptrack`) — cycle closed. `base-plugin` uses it only for `engine.pause()/resume()` (`base-plugin.ts:1576`, `:1713`).
- **What's wrong:** Module init order becomes load-order-dependent (a classic upstream KeepTrack bug source), and no tooling guards cycles (no madge/dependency-cruiser in `package.json`).
- **Impact:** Major
- **Fix:** Route pause/resume through `ServiceLocator` or an `EventBusEvent` (both already imported in the same file); move `PluginManager` into `src/engine/plugins/` with the manifest passed in (`keeptrack.ts:365` already passes `settingsManager.plugins`). Add a CI cycle check.
- **Effort:** M
- **Grade lift:** see A1.

**A3 — `settingsManager` used as an undeclared ambient global in 53 engine files**
- **Where:** Singleton created at `src/settings/settings.ts:948`, typed onto `Window` at `src/keepTrackApi.ts:34`; 53 non-test engine files reference `settingsManager.` with no import at all — e.g. `src/engine/camera/camera.ts:220`.
- **What's wrong:** Invisible coupling — the dependency is absent from the import graph, so refactoring tools, tree-shaking, and unit tests (which must pre-seed `window.settingsManager`) all fight it, and it silently undermines any A1 fix.
- **Impact:** Moderate
- **Fix:** Import the module-level singleton explicitly (mechanical codemod), then ban the ambient global via ESLint `no-restricted-globals`; long-term, hang it off `ServiceLocator`.
- **Effort:** M
- **Grade lift:** see A1.

**A4 — `keepTrackApi` facade is ~95% dead code but still ships and shapes the docs**
- **Where:** `src/keepTrackApi.ts:45-122` exposes ~17 service getters, 7 event methods, plugin-registry and save/wasm utilities. Non-test usage of `keepTrackApi.get*`/`on`/`emit` in the tree: **zero**. Only `toast` (`src/plugins/polar-plot/polar-plot.ts:448-449`, `src/plugins/onboarding/onboarding.ts:351`) and `analytics` (`src/plugins/onboarding/tour-steps.ts:239`) are live. Real code uses `ServiceLocator` (1,518 uses) and `EventBus.getInstance()` (429 uses). `Window.keepTrackApi` is declared at `keepTrackApi.ts:38` but never assigned anywhere in `src`. Stale reference at `src/settings/ui-settings.ts:263`.
- **What's wrong:** A broad public-looking API surface that nothing uses invites drift; the unassigned window global is a latent bug for any console user or external plugin relying on it (`external-plugins.json` exists).
- **Impact:** Moderate
- **Fix:** Shrink the class to `toast` + `analytics` (or move both behind ServiceLocator), delete the dead getters and phantom `Window` declaration — or deliberately assign it at bootstrap if external plugins need it.
- **Effort:** S
- **Grade lift:** minor; clarity/dead-code hygiene within B.

**A5 — `KeepTrackPlugin` base class is a 1,721-line multi-responsibility hub with a type-system hack**
- **Where:** `src/engine/plugins/base-plugin.ts:1` (`/* eslint-disable max-lines */`); responsibilities span icon lifecycle, side/secondary menus, drag, help, keyboard, context menus, login gating (:54), sound, and engine pause. Bonus defect: `:10` does `import Module from 'module'` — the **Node.js builtin** — used as the type of PNG imports (`bottomIconImg: Module` at :204; `addBottomIcon(icon: Module, ...)` at :1154; `as unknown as Module` at :659).
- **What's wrong:** Every one of ~80 plugins inherits this surface; the `Module` import is semantically nonsense in browser code and only compiles because the bundler shims it. A component decomposition already exists (`base-plugin.ts:23-28` imports six `./components/*` classes) but the base class remains the god object.
- **Impact:** Moderate
- **Fix:** Type icons as `string` (S, isolated); continue the started migration into `components/` and the capability type guards already defined (`base-plugin.ts:36-47`).
- **Effort:** M
- **Grade lift:** minor within B.

**A6 — Config and build-profile sprawl**
- **Where:** Six root tsconfigs; 8 edition dirs under `configs/` (26 files); 72 npm scripts with 10 `build:*` variants; `build/webpack-manager.ts:1` actually imports `@rspack/core` (naming lags reality; `build-manager.ts:107` casts to `MultiRspackOptions`). Strictness is split three ways: `tsconfig.base.json:36-38` sets `strict/noImplicitAny/strictNullChecks` all false; only `tsconfig.satglobe.json:3-8` and `tsconfig.story-walker.json` are strict; `tsconfig.json:8` enables only `strictNullChecks`.
- **What's wrong:** For a single-product fork, most of the 8 edition profiles (epfl, celestrak, companion, embed, pro) are unreachable upstream baggage; the same file type-checks differently depending on which config touched it.
- **Impact:** Moderate
- **Fix:** Prune profiles the fork will never ship (keep oss + satglobe + offline), rename `WebpackManager` → `RspackManager`, adopt a single strictness ratchet (per-directory strict include list that only grows).
- **Effort:** M
- **Grade lift:** minor within B; reduces cognitive load repo-wide.

**A7 — 66k-line generated data files compiled as TypeScript and statically bundled**
- **Where:** `src/app/data/catalogs/control-sites.ts` is 66,330 lines; `stars.ts` (3,101), `sensors.ts` (1,976), `user-urls.ts` (1,333), `constellations.ts` (1,187), `countries.ts` (967). All statically imported into `src/app/data/catalog-manager.ts:28-31`, which is on the boot path.
- **What's wrong:** ~70k lines of pure data flow through tsc, ESLint, and the bundler on every build and land in the main chunk whether or not the user opens a control-site feature. The repo already treats large data correctly elsewhere (`tle.json` is a fetched LFS asset, prefetched at `src/main.ts:45`).
- **Impact:** Moderate (build time + bundle size; overlaps G5)
- **Fix:** Emit these as JSON in `public/` (or lazy JSON modules), keep only the `ControlSiteParams` interface in TS, dynamic-import at first use.
- **Effort:** M
- **Grade lift:** shared with G5.

**A8 — Raw NUL byte embedded in a source file makes it opaque to text tooling**
- **Where:** `src/plugins/draw-lines/draw-lines.ts`, literal 0x00 byte at offset 15241, inside a template literal used as a map-key separator.
- **What's wrong:** `grep` classifies the file as binary and silently skips it in repo-wide searches (it bit this audit twice).
- **Impact:** Minor
- **Fix:** Replace the raw byte with the `' '` escape — identical runtime value.
- **Effort:** S
- **Grade lift:** negligible; hygiene.

### Strengths
1. **Lint-enforced anti-corruption layer.** `eslint.config.mjs:314-321` implements ADR 0001: everything under `src/satglobe` except `src/satglobe/engine` is forbidden from importing `@app/*`, `@engine/*`, `@ootk/*`, even `keepTrackApi` — verified true in practice (`src/satglobe/domain/*.ts` imports only zod and siblings; every upstream touch lives in the 716-line adapter). Integration into upstream is a single edition-gated call (`src/main.ts:27`, `:70`). This is how you fork: upstream can rebase without touching product code.
2. **Declarative, lazily-loaded plugin manifest with compile-time edition gating.** `src/plugins/plugin-manifest.ts:20-50` registers every plugin as a `PluginDescriptor` with `() => import(...)` thunks; pro plugins gated by `__IS_PRO__` so rspack never resolves the private submodule path in OSS builds (`src/plugins-pro.d.ts` documents the ambient-fallback trick).
3. **The historical god object has been genuinely decomposed, with types.** `keepTrackApi` is now 122 lines over `ServiceLocator` (`src/engine/core/service-locator.ts:40-43`), a 26-line `Container`, a 61-line `PluginRegistry`, and an `EventBus` with a fully typed payload map (`src/engine/events/event-bus.ts:12-40`) — compile-time-checked events rather than upstream's stringly-typed callbacks.

---

## B. Backend Quality — Grade: A-

**Justification.** The "backend" surface (build tooling, dev servers, data-refresh pipeline, webworkers) is well above typical project-tooling quality. The data-refresh pipeline is the standout: bounded network reads, provenance-checked caching, transactional multi-file installs with backup/rollback and a stale-lock reclaim protocol, backed by ~900 lines of dedicated tests. The dev server does realpath-canonical path containment; webworkers use per-worker typed message unions with sequence-number staleness handling. Held off A/A+ by shell-string `exec` interpolation in three utilities, unbounded downloads in `catalog-refresh` (inconsistent with its sibling), and verbatim duplication.

### Findings

**B1 — `catalog-refresh` downloads are unbounded, unlike its sibling `socrates-refresh`**
- **Where:** `scripts/satglobe/catalog-refresh.ts:438,443` (unbounded `await response.text()` for both error and success bodies); `fetchWithRetry` (`:382-410`) lacks the redirect/origin pinning of `socrates-refresh.ts:645-655`. Contrast `scripts/satglobe/socrates-refresh.ts:128-190` (`assertBoundedContentLength` + `readBoundedResponseText` with hard byte ceilings and UTF-8 validation).
- **What's wrong:** A misbehaving or MITM'd CelesTrak response can balloon memory / fill disk via the cache write at `catalog-refresh.ts:446-449`.
- **Impact:** Moderate
- **Fix:** Export `readBoundedResponseText` from socrates-refresh (or a shared module), apply with a ~64 MiB cap, add `redirect: 'error'` to the CelesTrak GP fetches.
- **Effort:** M
- **Grade lift:** B1+B2 are the A- → A step.

**B2 — Shell-string command construction with `exec`/`execSync` in three utilities**
- **Where:** `build/lib/sourcemap-uploader.ts:37` (interpolated `key`/`filePath` in an `execSync` string); `build/utils/open-file.ts:8-16` (interpolated path, called from `scripts/sonar.ts:366,417` with a URL built from the `SONAR_HOST_URL` env var); `scripts/mesh-viewer/server.ts:164-166` (same opener pattern).
- **What's wrong:** A quote or `$` in the interpolated value breaks out of the quoting. Attacker control is low (local files/config), but the repo elsewhere carefully uses arg-array `spawnSync` with `shell: false` (`scripts/satglobe/typecheck-strict.ts:20`, `scripts/plugin/lib/git.ts:16`) — these are inconsistencies as much as risks.
- **Impact:** Moderate
- **Fix:** Replace with `execFile`/`spawn` and argument arrays.
- **Effort:** S
- **Grade lift:** see B1.

**B3 — Process-wide `uncaughtException`/`unhandledRejection` handlers registered inside `startServer()`**
- **Where:** `build/dev-server.ts:200-205`; also `:111` — `new URL(req.url!, ...)` runs before the `try` at `:164`, so a throw leaves the client socket hanging (logged but never responded).
- **What's wrong:** Each `startServer()` call installs new process-level handlers (listener leak for tests using the exported `DevServerRuntime`), and swallowing all uncaught exceptions is broader than the stated goal.
- **Impact:** Minor
- **Fix:** Register handlers once at module scope; move the URL parse inside the `try`.
- **Effort:** S
- **Grade lift:** minor within A-.

**B4 — `startServer(port)` override breaks the plugin endpoint's Origin allowlist**
- **Where:** `build/dev-server.ts:102` accepts a port override; `build/plugin-install-endpoint.ts:15` pins `ALLOWED_ORIGINS` to port 5544.
- **What's wrong:** On any non-default port, legitimate browser requests (which carry the real Origin) get 403 — while missing-Origin requests still pass (see E5): simultaneously too strict and too loose.
- **Impact:** Minor
- **Fix:** Derive the allowlist from the actual bound port (pass it into `handlePluginEndpoint`).
- **Effort:** S
- **Grade lift:** minor; pairs with E5.

**B5 — `sonar.ts` docker invocation joins args into an unquoted shell string**
- **Where:** `scripts/sonar.ts:46` — `spawnSync(['docker', ...args].join(' '), { shell: true })`.
- **What's wrong:** Any future arg containing a space/metacharacter silently splits or injects; the inline comment acknowledges dodging DEP0190 rather than fixing the pattern.
- **Impact:** Minor
- **Fix:** `spawnSync('docker', args, { shell: false })`, or resolve the executable like `scripts/plugin/lib/git.ts:16` does.
- **Effort:** S
- **Grade lift:** minor.

**B6 — Verbatim code duplication across scripts**
- **Where:** `writeAtomic` duplicated character-for-character (`scripts/satglobe/catalog-refresh.ts:460-465` vs `socrates-refresh.ts:630-635`); `GIT_SHA` IIFE duplicated (`scripts/inspect.ts:108-115` vs `scripts/capture-verification-shots.ts:28-35`); MIME tables duplicated with drift (`build/dev-server.ts:29-46` vs `scripts/mesh-viewer/server.ts:24-33`).
- **Impact:** Minor
- **Fix:** Extract into `scripts/lib/` (alongside the existing `safe-path.ts` precedent).
- **Effort:** S
- **Grade lift:** minor.

**B7 — `mesh-viewer` server startup fragility**
- **Where:** `scripts/mesh-viewer/server.ts:21` (`--port=abc` → `NaN` → unhelpful throw); `:84` (module-level `fs.watch` throws uncaught ENOENT if `public/meshes` is absent on a fresh clone).
- **Impact:** Minor
- **Fix:** Validate the port; guard the watch with `existsSync` + a clear error.
- **Effort:** S
- **Grade lift:** minor.

*(The plugin-install endpoint's Origin-bypass and `ref` injection are graded under Security as E5.)*

### Strengths
1. **Transactional, provenance-checked data-refresh pipeline.** `stageAndInstallArtifacts` (`scripts/satglobe/catalog-refresh.ts:811-865`) stages six outputs, backs up installed versions, installs the manifest last, rolls back on partial failure — under an advisory install lock with a UUID-token/inode-identity stale-lock reclaim protocol (`:511-780`). Sanity rails: ≥30k-row floor (`:247-249`), >5% object-count-drop abort (`:918-920`), re-parse of every serialized output before install (`:867-877`). Tests: `catalog-refresh.test.ts` (378 lines), `socrates-refresh.test.ts` (516 lines).
2. **Defense-in-depth static file serving.** `resolveStaticPath` (`build/dev-server.ts:71-99`): lexical containment check, realpath canonical re-check (defeats symlink escape), re-check after directory→index resolution, Windows backslash normalization; shared helper `scripts/lib/safe-path.ts:17-44`; 13 tests in `build/__tests__/dev-server.test.ts`.
3. **Disciplined webworker protocol.** Per-worker typed message unions (`src/webworker/orbit-cruncher-messages.ts:83-88`), catalog-swap `seqNum` staleness protocol (`orbitCruncher.ts:20-23,41-50`), transfer-list `postMessage` (`:85-91`), centralized `onerror` → errorManager (`src/engine/threads/web-worker-thread.ts:41-56`). All ten workers have matching test files.

---

## C. Frontend Quality — Grade: B+

**Justification.** The React layer (`src/satglobe/app`) is genuinely well-crafted: small focused components (largest .tsx is 402 lines), a reducer-driven story state machine, a real focus-trap hook, `inert` boot guards, correct `aria-pressed`/`aria-live` usage, and `prefers-reduced-motion` honored in both CSS and playback behavior. Held below A by concrete defects: a global keyboard handler that hijacks browser shortcuts, no error boundary anywhere, a defeated memo on the heaviest panel, English-only strings atop a fully localized engine, and CSS that leaks into the legacy UI. The legacy layer carries inherited debt — 40 `innerHTML` sites in `src/app/ui` (256 across app+plugins) and zero `removeEventListener` calls in the directory — though it escapes carefully where user data flows in.

### Findings

**C1 — Global keydown handler hijacks modifier shortcuts and Space on focused buttons**
- **Where:** `src/satglobe/app/satglobe-app.tsx:208-246` (esp. `:219`, `:223`, `:232`); only bails for input/select targets (`:209`).
- **What's wrong:** No `metaKey`/`ctrlKey`/`altKey` check: Ctrl/Cmd+F triggers `switchMode('presentation')` and `preventDefault()` blocks the browser's Find dialog (`:223`, `:237-239`); in story mode, Space on any focused button (e.g. `story-deck.tsx:73`) is intercepted (`:232`) — a keyboard-nav defect.
- **Impact:** Major
- **Fix:** Early-return on modifier keys; bail for `HTMLButtonElement` in the Space branch; add textarea/`isContentEditable` exclusions.
- **Effort:** S
- **Grade lift:** C1+C2 are the B+ → A- step.

**C2 — No React error boundary — one render throw blanks the entire shell**
- **Where:** `src/satglobe/bootstrap.tsx:21-25`; no ErrorBoundary/`getDerivedStateFromError`/`onUncaughtError` anywhere under `src/satglobe` (grep-verified). Example trigger: unmapped `object.kind` indexing `objectKindLabels[object.kind]` at `inspector.tsx:53`.
- **What's wrong:** React 18+ unmounts the whole tree on an uncaught render error — every panel vanishes with no recovery UI, ironic given the care spent on the engine-failure state (`satglobe-app.tsx:387-394`).
- **Impact:** Major
- **Fix:** Wrap `SatGlobeApp` in a small boundary reusing the `sg-engine-error` presentation with a Reload button; optionally pass `onUncaughtError` to `createRoot`.
- **Effort:** S
- **Grade lift:** see C1.

**C3 — `createView` closes over the whole `engine` object, defeating `DiscoverPanel`'s memo every 600 ms** *(also G4)*
- **Where:** `src/satglobe/app/satglobe-app.tsx:248-258` (dep `[engine, ...]`), passed at `:346`; `DiscoverPanel` memoized at `discover-panel.tsx:270`; adapter polls every 600 ms (`satglobe-engine-adapter.ts:146`) and emits a new state object whenever sim time advances (`:447-465`).
- **What's wrong:** While the clock runs (the normal state), the heaviest panel re-renders ~1.7×/s for nothing. The adapter's own idle budget is honored; the running-clock case is not. The inline `onAuthoredView={() => ...}` at `satglobe-app.tsx:375` similarly breaks `StoryDeck`'s memo in story mode.
- **Impact:** Moderate
- **Fix:** Build the view from `adapter.getState()` at call time (the documented immutable-snapshot API, `satglobe-engine-adapter.ts:149-157`) or keep `engine` in a ref; deps shrink to the scalar inputs.
- **Effort:** S
- **Grade lift:** part of the B+ → A- step (shared with G).

**C4 — New UI layer hardcodes English while the app ships full i18next infrastructure**
- **Where:** Every string in `src/satglobe/app/*.tsx` is literal English (e.g. `discover-panel.tsx:127-151`, `top-bar.tsx:21-31`, `satglobe-app.tsx:390-397`); the legacy layer translates via `t7e`/i18next (`src/app/ui/hover-manager.ts:12-15,309-329`), 9+ locale files in `src/locales/`, and `main.ts:82` blocks boot on `localizationReady`.
- **What's wrong:** A non-English user gets a translated engine tooltip layered under an English-only shell; retrofitting extraction across ~15 components later costs far more than doing it now.
- **Impact:** Moderate
- **Fix:** Adopt `react-i18next` (i18next already a dependency, `package.json:200`) and extract shell strings; or record an explicit ADR that SatGlobe is English-only and strip the locale-gated boot for this edition.
- **Effort:** M
- **Grade lift:** moderate within B+.

**C5 — Unscoped element selectors in `satglobe-app.css` leak into the legacy UI**
- **Where:** `src/satglobe/app/satglobe-app.css:51-59` — top-level `button, input, select { font: inherit; }` and `button { color: inherit; }`; imported globally at `bootstrap.tsx:5`; the legacy Materialize UI shares the document (`main.ts:67-71`).
- **What's wrong:** Everything else in the file is disciplined under `#satglobe-root`/`.sg-*` (`:14-27`), but these rules restyle every button/input/select in the legacy DOM.
- **Impact:** Moderate
- **Fix:** Scope them under `#satglobe-root`.
- **Effort:** S
- **Grade lift:** minor.

**C6 — Legacy UI: zero event-listener cleanup, including document-level listeners bound with `.bind()`**
- **Where:** 0 `removeEventListener` vs ~70 `addEventListener` in `src/app/ui`. Worst: `camera-control-widget.ts:98-111` attaches document-level `mousemove`/`mouseup` via `this.onMouseMove_.bind(this)` (an unrecoverable reference); `ui-manager.ts:447-450` adds a permanent window resize listener; `ui-manager.ts:358-360` guards re-init by throwing rather than being disposable.
- **What's wrong:** No dispose path exists for any UI manager. Bounded today (singletons), but every document-level `mousemove` runs on each pointer move forever, and any future re-init (embed mode, hot reload) doubles handlers silently.
- **Impact:** Moderate
- **Fix:** Store bound handlers or use `AbortController` signals; add `dispose()` invoked from engine teardown.
- **Effort:** M
- **Grade lift:** minor-moderate within B+.

**C7 — Escape while the story Sources drawer is open exits story mode instead of closing the dialog**
- **Where:** `satglobe-app.tsx:225-227` (Escape → `switchMode('workshop')`); drawer is `role="dialog" aria-modal="true"` at `story-deck.tsx:46`; `use-dialog-focus.ts:24-27` handles only Tab.
- **What's wrong:** Standard dialog semantics say Escape dismisses the topmost modal; here it tears down the whole story mode.
- **Impact:** Minor
- **Fix:** Check `showSources`/`showShortcuts` first and consume Escape for the topmost layer, or add Escape+`onClose` to `useDialogFocus`.
- **Effort:** S
- **Grade lift:** minor.

**C8 — Saved-view list keyed by non-unique `view.name`**
- **Where:** `discover-panel.tsx:244` (`key={view.name}`); names generated at `satglobe-app.tsx:250`, prepended at `:263`.
- **What's wrong:** Saving twice with the same selection yields duplicate keys — React warnings and wrong-row reconciliation on reorder.
- **Impact:** Minor
- **Fix:** Add an `id` (`crypto.randomUUID()`) to `SavedViewV1` at creation and key on it.
- **Effort:** S
- **Grade lift:** minor.

### Strengths
1. **Real accessibility engineering.** `use-dialog-focus.ts:13-53` (mount-focus, Tab trap, opener-focus restore); `inert` boot guard (`satglobe-app.tsx:340`) and inerted panels (`discover-panel.tsx:126`, `inspector.tsx:40,66`); `aria-pressed` toggles (`discover-panel.tsx:68,153,189`); live regions (`satglobe-app.tsx:381,396`); reduced motion honored in CSS (`satglobe-app.css:1568-1577`) *and* behavior — playback degrades to discrete beat steps (`use-story-playback.ts:94-102`).
2. **Disciplined state architecture.** Documented reducer with index clamping so renders can never read past a story's beat array (`use-story-playback.ts:30-45,62-69`); immediate vs slider-debounced engine writes with timer cleanup (`use-workshop-filters.ts:25-40`); adapter emits only on observable change — an idle scene costs zero React renders (`satglobe-engine-adapter.ts:462-465`).
3. **Legacy layer is careful where it counts.** Search-result rendering escapes every user-influenced string including match highlighting (`search-manager.ts:465`, `:504,558,565-581`); `ui-manager.ts:151-160` documents and fixes a real upstream Materialize Toast double-dismiss crash with a `WeakSet`.

---

## D. Testing & Reliability — Grade: B+ *(double-weighted)*

**Justification.** Serious testing muscle: 614 test files against ~800 source files, 5,928 test blocks, and a CI pipeline where typecheck, strict typecheck, lint (`--max-warnings 0`), unit tests, coverage thresholds, a production build, and an E2E journey are all blocking. New-code domain tests are exemplary (injected clocks, boundary assertions, immutability checks). Reliability engineering is real: default-on global error traps, a byte-ceilinged same-origin loader with timeout+abort, an E2E test proving the error UI appears on catalog failure. Falls short of A because the gates have blind spots: 85 of 86 Playwright specs never run in CI, the vendored ootk astrodynamics suite (124 test files — the most correctness-critical math in the app) is never executed, a large legacy tranche is `not.toThrow()` smoke, and the branch-coverage floor is 57%.

**Key numbers:** 614 test files (528 vitest — incl. 124 non-running ootk — plus 86 Playwright specs) vs ~800 source files; 5,928 `it`/`test` blocks; coverage thresholds 71/57/73/71 (stmts/branch/funcs/lines), blocking, over the full `src/**` denominator; CI gates on PR: `verify:satglobe` (job 1), full vitest + coverage (job 2), 1-of-86 E2E journeys (job 3), SGP4 benchmark report-only (job 4).

### Findings

**D1 — 85 of 86 Playwright spec files are not run in CI**
- **Where:** `playwright.config.ts:9-10` matches `src/**/__tests__/*.spec.ts` (86 files: plugin journeys, `src/__tests__/app-smoke.spec.ts`, `src/__tests__/sgp4-wasm.spec.ts`, `src/app/rendering/__tests__/orbit-line-stability.spec.ts`, …); the CI e2e job (`.github/workflows/build-pipeline.yml:122-123`) runs `test:e2e:satglobe`, pinned to a single file (`package.json:80`).
- **What's wrong:** The other 85 specs only run if a developer invokes `test:e2e` locally, so they silently rot.
- **Impact:** Major
- **Fix:** Add a CI job (or nightly workflow) running `npx playwright test` against the built bundle, quarantining known-flaky specs; or delete specs that are intentionally dead.
- **Effort:** M
- **Grade lift:** D1+D2 are the B+ → A- step (double-weighted category).

**D2 — Vendored `ootk` engine tests are excluded from the host suite and coverage, and nothing else runs them**
- **Where:** `vitest.config.ts:90` excludes `src/engine/ootk/**` from discovery; `:59` from coverage. `src/engine/ootk/` contains 124 test files (coordinate transforms, force models, orbit determination), has its own `package.json`, and no workflow references it.
- **What's wrong:** The propagation math shipping in this bundle is never exercised by this repo's CI — including any local modifications made since vendoring.
- **Impact:** Major
- **Fix:** Add a scoped CI step running the ootk suite in its subdirectory, or document + enforce that the vendored copy is byte-identical to a tested upstream tag.
- **Effort:** S-M
- **Grade lift:** see D1.

**D3 — Large legacy tranche of smoke-only unit tests**
- **Where:** 582 `not.toThrow()` assertions across 191 test files. Example: `src/app/ui/__tests__/uiManager.test.ts:14-17, 38-40, 95-111, 124-128, 143, 151, 159, 178`; `process_getsensorinfo` (`:20-35`) asserts the array it just assigned contains the value it assigned.
- **What's wrong:** These execute code (feeding the coverage ratchet) but verify almost no behavior — regressions that change output without throwing pass.
- **Impact:** Moderate
- **Fix:** Replace with behavioral assertions when touching these areas; forbid new `not.toThrow`-only tests via convention or lint rule.
- **Effort:** L (incremental)
- **Grade lift:** with D5, the A- → A step.

**D4 — Offline-catalog fallback keyed on an exact error-message string**
- **Where:** `src/app/data/catalog-loader.ts:295-296` maps HTTP 401 to `throw new Error('Failed to fetch')`; the catch at `:309` falls back to the bundled `tle/tle.json` only `if (error.message === 'Failed to fetch')`; other failures hit the `else` at `:321` and just log.
- **What's wrong:** Matches Chrome's network TypeError but not Firefox's ("NetworkError when attempting to fetch resource.") nor a 5xx whose `response.json()` throws SyntaxError — the app is left catalog-less when a working bundled catalog exists.
- **Impact:** Moderate (reliability defect in the boot path)
- **Fix:** Fall back for any fetch/parse failure of the primary source (invert the condition), keeping the error log.
- **Effort:** S
- **Grade lift:** moderate; user-facing reliability.

**D5 — Branch coverage floor is 57%**
- **Where:** `vitest.config.ts:77-82`: thresholds 71/57/73/71, actuals documented 72.13/58.02 (`:74-76`).
- **What's wrong:** The 14-point line-vs-branch gap means error paths and conditionals are the least-tested code — exactly where reliability bugs (cf. D4) live. The "ratchet upward" comment has no automation.
- **Impact:** Moderate
- **Fix:** Bump thresholds to actuals-minus-0.5 each release; prioritize branch coverage in `src/app/data/` loaders.
- **Effort:** M (ongoing)
- **Grade lift:** see D3.

**D6 — Hard sleeps in the non-CI Playwright specs**
- **Where:** `src/app/rendering/__tests__/orbit-line-stability.spec.ts:59` (4,000 ms), `:94` (2,500 ms); `src/plugins/watchlist/__tests__/watchlist.spec.ts:18` (2,000 ms); `src/plugins/top-menu/__tests__/top-menu.spec.ts:33` (500 ms).
- **What's wrong:** Classic flake seeds that will bite the moment D1 is fixed. (Contrast: `satglobe.spec.ts:224-230` uses its sleep correctly inside an `expect.poll`.)
- **Impact:** Minor
- **Fix:** Replace with `expect.poll`/`waitForFunction` on the awaited condition.
- **Effort:** S
- **Grade lift:** enabler for D1.

**D7 — Benchmark job is report-only with no expiry**
- **Where:** `build-pipeline.yml:133-137` — "report-only for now (ADR 0002)", no threshold.
- **What's wrong:** An SGP4 throughput regression merges clean indefinitely.
- **Impact:** Minor
- **Fix:** Set the promised hard threshold now that baselines exist, or add a dated TODO check.
- **Effort:** S
- **Grade lift:** minor.

**D8 — Global default `fetch` mock silently returns `ok: true` with empty payloads**
- **Where:** `test/vitest-setup.ts:121-128`.
- **What's wrong:** Any unit test that forgets to override it exercises a fake "success with empty data" path that cannot occur in production, masking loader bugs.
- **Impact:** Minor
- **Fix:** Make the default mock reject with "unmocked fetch: \<url\>" so tests must declare their network fixtures.
- **Effort:** S
- **Grade lift:** minor.

### Strengths
1. **New-code domain tests are exemplary.** `src/satglobe/domain/__tests__/conjunctions.test.ts` (311 lines; 879 across 7 domain files): schema round-trip equality (`:103`), rejection of self-pairs/duplicate IDs/checksum mismatches (`:123-147`), exact freshness-boundary assertion with an injected clock (`:164-170`), `Object.isFrozen` immutability checks (`:300-301`), memoization verified by mock call counts (`:191`). No snapshots, no smoke.
2. **The SatGlobe E2E journey tests real reliability contracts.** `src/satglobe/__tests__/satglobe.spec.ts`: zero external network requests asserted via route interception (`:141-146,152`), a parse-time performance budget (`:168-173`), an explicit failure-state journey proving the error UI replaces an infinite spinner (`:333-345`), locale-chunk failure fallback to English (`:398-406`). Deterministic suite-wide clock (`test/vitest-setup.ts:15`, `TZ=GMT` at `:11`).
3. **Runtime reliability engineering is real.** Global error + unhandledrejection traps on by default (`src/engine/engine.ts:87-117`; `src/settings/core-settings.ts:107`; rethrow in Node so tests fail loudly); the conjunction loader enforces a 256 KiB streaming ceiling with same-origin and redirect checks (`src/satglobe/runtime/conjunction-loader.ts:16-65,91-107`); its caller adds a 2 s AbortController timeout and degrades to a typed `unavailable` state (`satglobe-engine-adapter.ts:103-104,624-634`).

---

## E. Security — Grade: B+ *(double-weighted)*

**Justification.** Deliberate, above-average security engineering for a client-side app: a real CSP with `frame-ancestors 'none'`/`object-src 'none'` kept byte-identical between dev server and nginx (with a parity test), loopback-only dev servers with realpath-canonicalized traversal defenses, zod `.strict()` validation with byte caps and same-origin enforcement on all SatGlobe-authored data paths, zero `npm audit` findings (prod *and* dev), CodeQL on push/PR/weekly, and a genuine, fork-aware SECURITY.md. Out of the A range because of the inherited engine: `escapeHtml` exists and is used in the busiest sinks (search, hover), but several plugins still interpolate catalog-derived satellite names straight into `innerHTML`; the legacy catalog loader performs no runtime validation of remote TLE/JSON; CSP protection exists only on the `satglobe` profile; and `script-src` carries `'unsafe-eval'` + `blob:`.

### Findings (ordered by severity)

**E1 — Catalog-derived names reach `innerHTML` unescaped in several plugins**
- **Where:** `src/plugins/sat-info-box/sat-info-box.ts:343` (`setInnerHtml(EL.NAME, obj.name)` — `setInnerHtml` is a raw assignment, `src/engine/utils/get-el.ts:29-38`) and `:317` (+ `:364-365`, `altName`/`altId`); `src/plugins/watchlist/watchlist.ts:594` → sink `:605`; `src/plugins/sat-constellations/sat-constellations.ts:646` → sink `:655`; `src/plugins/breakup-analysis/breakup-analysis-table.ts:227` → sink `breakup-analysis.ts:442`.
- **What's wrong:** Names originate in TLE/JSON catalogs, and URL parameters can point the catalog at external feeds (`src/settings/parse-get-variables.ts:144-167` — `CATNR`/`NAME`/`GROUP` → celestrak, `latest-sats` → api.keeptrack.space) with no validation (E3). On the `satglobe` profile the CSP degrades this to markup/UI injection; on every other profile (no CSP, E2) a hostile name like `<img src=x onerror=…>` is stored XSS.
- **Impact:** Major
- **Fix:** Wrap every name/altName/desc interpolation in the existing `escapeHtml` (`src/engine/utils/escape-html.ts:7`), exactly as `search-manager.ts` and `hover-manager.ts` already do; add an ESLint `no-unsanitized`-style rule to prevent regressions.
- **Effort:** M
- **Grade lift:** E1+E2 are the B+ → A- step (double-weighted category).

**E2 — CSP exists only on the `satglobe` profile; no `<meta>` fallback**
- **Where:** `build/dev-server-response.ts:23-32` returns `{}` (no security headers) for every profile except `'satglobe'`; the only production CSP is `configs/satglobe/nginx.conf:12`; `public/index.html` contains no CSP meta tag (only CACHE-CONTROL at `:38`).
- **What's wrong:** Any deployment of the oss/pro/celestrak/embed/etc. profiles — or static hosting that ignores nginx.conf — ships with zero CSP, making E1 fully exploitable.
- **Impact:** Moderate
- **Fix:** Add a baseline CSP `<meta http-equiv>` to `public/index.html` (everything except `frame-ancestors`, which meta can't express) and/or extend `securityHeadersFor` to all profiles.
- **Effort:** S
- **Grade lift:** see E1.

**E3 — Legacy engine trusts remote catalog data blindly**
- **Where:** `src/app/data/catalog-loader.ts:57-120` types the fetched catalog with a TS `interface` only — no runtime validation, length caps, or charset checks. Contrast the SatGlobe path: `src/satglobe/domain/schemas.ts` (uniformly `.strict()` zod) and `src/satglobe/runtime/conjunction-loader.ts:16-113` (256 KiB cap, `redirect: 'error'`, origin pinning).
- **Impact:** Moderate
- **Fix:** Add a minimal zod schema (or validating adapter) for `KeepTrackTLEFile[]` at ingest — bound string lengths, strip `<>` from display fields — defense-in-depth for the `innerHTML` sinks.
- **Effort:** M/L
- **Grade lift:** with E4, the A- → A step.

**E4 — `script-src` includes `'unsafe-eval'` and `blob:`**
- **Where:** `build/dev-server-response.ts:13` and `configs/satglobe/nginx.conf:12`; required by the SGP4 WASM glue, fetched as text and executed via `new Function` (`src/engine/ootk/src/external/Sgp4WasmBase.ts:646`; acknowledged in `src/engine/ootk/src/external/README.md:54`).
- **What's wrong:** `'unsafe-eval'` converts any HTML-injection foothold into full XSS potential; `blob:` script-src allows attacker-constructed blob scripts.
- **Impact:** Moderate
- **Fix:** Rebuild the Emscripten glue as an ES module (`-sMODULARIZE -sEXPORT_ES6`) so it loads via a normal same-origin import, then drop both directives.
- **Effort:** L
- **Grade lift:** see E3.

**E5 — Plugin-install endpoint: Origin-absent bypass and unvalidated `ref` into a `shell: true` spawn**
- **Where:** `build/plugin-install-endpoint.ts:67` (`if (origin && !ALLOWED_ORIGINS.has(origin))` lets Origin-less requests through); `:93-97` (`parsed.ref` unvalidated → `spawn('npx', args, { shell: process.platform === 'win32' })` — Windows metacharacter injection; a leading `-` can be parsed as an option downstream on all platforms). The `repository` regex at `:16` is safe. Mitigations: loopback bind (`build/dev-server.ts:20,207`), live-reload gating (`dev-server.ts:152-157`), browsers always send Origin on cross-origin POSTs.
- **Impact:** Minor (dev-machine-only, but an RCE primitive)
- **Fix:** Require an allowed Origin outright; validate `ref` against `^[\w./-]{1,100}$` forbidding a leading `-`; drop `shell: true` (resolve `npx.cmd` explicitly on Windows).
- **Effort:** S
- **Grade lift:** minor.

**E6 — The `` html`` `` template tag looks like a sanitizer but is `String.raw`**
- **Where:** `src/engine/utils/development/formatter.ts:7-15`.
- **What's wrong:** Developers familiar with lit-html reasonably assume `` html`<td>${sat.name}</td>` `` escapes interpolations; it does nothing — the direct cause of the breakup-analysis instance in E1.
- **Impact:** Minor (footgun with Major downstream consequences)
- **Fix:** Make the tag escape non-literal placeholders by default (with an explicit `raw()` opt-out), or rename it `rawHtml` and document it.
- **Effort:** S
- **Grade lift:** regression-prevention for E1.

**E7 — Unmaintained `numeric` package in the runtime bundle** *(see F1 for the remediation plan)*
- **Where:** `package.json:204`; runtime imports at `src/app/analysis/sat-math.ts:63`, `src/engine/math/dop-math.ts:1`, `src/app/data/catalog-manager/satLinkManager.ts:11`.
- **What's wrong:** Last released 2012; no known CVE today, but no upstream to patch one either.
- **Impact:** Minor
- **Fix:** Replace the few used routines (see F1).
- **Effort:** M
- **Grade lift:** minor.

**E8 — Upstream Supabase anon key committed in profile configs**
- **Where:** `configs/pro/profile.env:16` and `configs/offline/profile.env:5` embed `PUBLIC_SUPABASE_ANON_KEY` (JWT `role: anon`, exp 2035) for the upstream project's instance.
- **What's wrong:** Anon keys are public-by-design, so not a leaked secret — but it is the *upstream project's* key living in a fork, and the offline profile's contract is "no external requests."
- **Impact:** Minor
- **Fix:** Strip from unused profiles (especially `offline`) or replace with a placeholder. (`.env` is properly gitignored, `.gitignore:151-153`; `.env.example` contains only placeholders.)
- **Effort:** S
- **Grade lift:** minor.

**E9 — `document.write` in debug new-tab utility**
- **Where:** `src/engine/utils/new-tab-utils.ts:41-43` — the `download="${name…}"` attribute is interpolated unescaped; data is locally sourced settings, so impact is negligible.
- **Impact:** Minor
- **Fix:** Build the anchor with `createElement` + `textContent`.
- **Effort:** S
- **Grade lift:** negligible.

### Strengths
- **Hardened dev servers:** both bind 127.0.0.1 explicitly (`build/dev-server.ts:207`; `scripts/mesh-viewer/server.ts:155` — "a dev tool has no business being LAN-reachable"); two-layer traversal defense (`dev-server.ts:71-99`); no directory listing; 13 tests.
- **Real CSP with parity testing:** `SATGLOBE_CSP` (`build/dev-server-response.ts:9-20`) — `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, no `'unsafe-inline'` scripts; a test enforces byte parity with `configs/satglobe/nginx.conf:12`; plus nosniff and `Referrer-Policy: no-referrer`.
- **Exemplary SatGlobe-authored remote-data handling:** `conjunction-loader.ts` (256 KiB streaming ceiling, `redirect: 'error'`, post-response origin re-verification, fatal-mode UTF-8 decode, zod parsing); `schemas.ts` uniformly `.strict()` with regex-constrained IDs and bounded lengths.
- **Clean dependency posture:** `npm audit` — 0 vulnerabilities across 1,189 packages (35 prod); esbuild pinned via override post-dating the known dev-server CORS advisory.
- **XSS awareness in core paths:** `escape-html.ts` applied in every branch of the search-results renderer (`search-manager.ts:481-593`, incl. `highlightMatch_` at `:464-466`) and the hover box (`hover-manager.ts:84-397`).
- **postMessage origin check:** the only window-level message listener verifies `event.origin !== window.origin` (`src/engine/input/input-manager/keyboard-input.ts:27`).
- **Process security:** SECURITY.md routes to GitHub private vulnerability reporting and routes engine issues upstream; `codeql.yml` runs javascript-typescript on push/PR/weekly cron with least-privilege permissions.
- **No secrets in source:** only the public-by-design anon key (E8) and a placeholder in `.env.example`; the mesh-viewer suppresses stack traces in responses citing CodeQL `js/stack-trace-exposure` (`server.ts:146-150`).

---

## F. Dependencies & Tech Currency — Grade: B+

**Justification.** The core stack is impressively current — React 19.2, TypeScript 5.9.3, ESLint 9 flat config, vitest 4.0.18, rspack 2.0.5, Playwright 1.58, zod 4, echarts 6 — with a single, freshly regenerated lockfileVersion-3 lockfile, a clean `npm audit` (0 vulnerabilities), and disciplined lazy-loading of heavy deps. What holds it back is hygiene rather than currency: an effectively-dead 2012-era runtime package, a runtime dependency misclassified as dev, a vestigial tsup + broken publish script, i18next three majors behind, and a four-way transpiler pile-up.

### Findings

**F1 — `numeric@1.2.6` — unmaintained since ~2012, used in three runtime hot paths**
- **Where:** `package.json:204`; imports at `src/engine/math/dop-math.ts:1` (uses `rep/setBlock/dot/transpose/inv`, `:73-83`), `src/app/analysis/sat-math.ts:63`, `src/app/data/catalog-manager/satLinkManager.ts:11`; types bolted on via `@types/numeric` (`package.json:140`).
- **What's wrong:** Last published 14 years ago, no ESM, no maintenance, no upstream to patch a CVE. Usage is shallow: `dot`, `transpose`, `inv` on small matrices plus two vector dot products.
- **Impact:** Moderate
- **Fix:** Replace vector dots with a 5-line helper; replace the 4×4 `inv`/`transpose` with `gl-matrix` (already a dependency, `package.json:199`, `mat4.invert`) or ~30 lines of hand-rolled code; drop `numeric` + `@types/numeric`.
- **Effort:** S-M
- **Grade lift:** F1+F2+F3 are the B+ → A- step.

**F2 — `papaparse` is a devDependency but imported by production code**
- **Where:** `package.json:169` (devDependencies); runtime imports at `src/app/data/catalog-loader.ts:23` and `src/engine/utils/saveVariable.ts:27`.
- **What's wrong:** Works today only because the app is bundled and `private: true`; `npm install --omit=dev` builds, the declared library surface (`main: lib/index.js`, `package.json:26`), and dep-audit tooling all see an undeclared runtime dep.
- **Impact:** Moderate
- **Fix:** Move `papaparse` to `dependencies`.
- **Effort:** S
- **Grade lift:** see F1.

**F3 — Dead `tsup` + broken `prepublishOnly` script**
- **Where:** `package.json:176` (tsup) and `:100` (`"prepublishOnly": "npm run build:lib"`).
- **What's wrong:** No `tsup.config.*` exists and nothing references tsup; `build:lib` does not exist anywhere in package.json — any `npm publish` would fail. tsup is also the only package pinning `esbuild ^0.27.0`, which is what makes the override out-of-range (F4).
- **Impact:** Moderate
- **Fix:** Delete tsup; delete `prepublishOnly` or point it at `build:satglobe`. With `private: true`, `main/module/types/files` (`package.json:26-32`) are arguably vestigial too.
- **Effort:** S
- **Grade lift:** see F1.

**F4 — `overrides: { esbuild: "0.28.1" }` forces tsup out of its declared range, exact-pinned and undocumented**
- **Where:** `package.json:213-215`; lockfile: tsx@4.22.3 and vite want `~0.28.0`, tsup declares `^0.27.0`.
- **What's wrong:** The dedupe goal is legitimate, but the exact pin blocks patch updates and silently violates tsup's range, with no comment explaining why.
- **Impact:** Minor
- **Fix:** After removing tsup (F3) the override may be droppable; if kept, use `"~0.28.1"` and document it in SATGLOBE.md.
- **Effort:** S
- **Grade lift:** minor.

**F5 — Four overlapping transpilers: babel + ts-loader (full type-check) + SWC + esbuild**
- **Where:** `build/webpack-manager.ts:218` (ts-loader with `transpileOnly: false` at `:221`) and `:232` (babel-loader on all `.m?js` incl. node_modules, `:227`); babel packages at `package.json:116-119,152`; `babel.config.cjs` targets `esmodules: true`.
- **What's wrong:** rspack already bundles SWC (`SwcJsMinimizerRspackPlugin` imported at `webpack-manager.ts:1`); `builtin:swc-loader` would replace both loaders; `transpileOnly: false` runs a second full type-check inside every build even though `typecheck` (`package.json:50`) already does `tsc --noEmit`. The single biggest build-speed lever, plus 5 removable devDeps.
- **Impact:** Moderate
- **Fix:** Switch to `builtin:swc-loader`; type-check via the CI script only; drop `@babel/*`, `babel-loader`, `ts-loader`.
- **Effort:** M
- **Grade lift:** with F6, the A- → A step.

**F6 — `worker-loader@^3.0.8` — archived project, superseded by native worker syntax**
- **Where:** `package.json:187`; used at `build/webpack-manager.ts:211-214`.
- **What's wrong:** Deprecated/unmaintained since ~2020; webpack 5 and rspack natively support `new Worker(new URL('./x.worker.ts', import.meta.url))` with better code-splitting and TS integration.
- **Impact:** Moderate
- **Fix:** Migrate instantiation sites to the native URL pattern; delete the rule and the dep.
- **Effort:** M
- **Grade lift:** see F5.

**F7 — `i18next@^23.14.0` — three majors behind (latest 26.x); `uuid` and `dotenv` also behind**
- **Where:** `package.json:200` (i18next), `:209` (uuid 11 vs 14 — only `v4` used, e.g. `src/engine/rendering/buffer-geometry.ts:2`), `:193` (dotenv 16 vs 17).
- **What's wrong:** Drifting three majors makes the eventual i18next jump costly (its languagedetector companion is already current at 8.2.1); `uuid` is entirely replaceable by native `crypto.randomUUID()`.
- **Impact:** Moderate
- **Fix:** Schedule the i18next 23→26 migration; replace `uuid` with `crypto.randomUUID()`; bump dotenv.
- **Effort:** M (i18next), S (uuid/dotenv)
- **Grade lift:** moderate.

**F8 — Private-SSH git submodule for `src/plugins-pro`**
- **Where:** `.gitmodules:1-3` (`git@github.com:thkruz/keeptrack-space-pro.git`), pinned at `ad0e771`, uninitialized in this checkout.
- **What's wrong:** SSH-only URL to a private upstream repo means fresh clones without keys fail `git submodule update`. Well-mitigated (`build/get-submodules.ts` skips gracefully; `__IS_PRO__` compile-time guards keep OSS builds clean) — but the fork's homepage is `jtn0123/SatGlobe` while the submodule points at the upstream author's private repo, a coupling worth documenting (see H1).
- **Impact:** Minor
- **Fix:** Note in SATGLOBE.md that the submodule is optional/pro-only; consider an `https://` URL with credential fallback.
- **Effort:** S
- **Grade lift:** minor.

**Verified non-issues:** echarts-gl 2.1.0's peer range includes `^6.0.0`, so it is compatible with echarts 6.1.0; `openmeteo`, `@e965/xlsx`, and `new-github-issue-url` are all genuinely used (`src/plugins/timeline-sensor/sensor-timeline.ts:32`, `src/engine/utils/saveVariable.ts:101`, `src/engine/utils/errorManager.ts:2`); `draggabilly@3.0.0` is at latest (frozen since 2022 — watch, not urgent).

### Strengths
1. **Genuinely current core toolchain** — nearly every dependency's wanted == latest per `npm outdated`; Node 24 pinned consistently across `.nvmrc`, volta (`package.json:216-218`), and CI (`build-pipeline.yml:39`).
2. **Healthy supply chain:** exactly one lockfile (v3, ~1,046 resolved packages), regenerated three days before this audit; `npm audit` reports 0 vulnerabilities.
3. **Deliberate bundle-size discipline:** every plugin loads via dynamic `import()` through a manifest (`src/plugins/plugin-manifest.ts:819-854`), keeping echarts/echarts-gl out of the entry; `@e965/xlsx` is dynamically imported with an explicit comment (`src/engine/utils/saveVariable.ts:95-101`).

---

## G. Performance & Scalability — Grade: A-

**Justification.** Deliberate, measured performance engineering rather than incidental adequacy: SGP4 propagation in a dedicated worker with zero-copy transferables, worker-side frustum/occlusion culling throttling off-screen satellites to 1/10th update rate, color computation offloaded to a color worker, a React shell with a documented "idle budget" (zero re-renders when nothing observable changes) and 7/7 memoized components, and real benchmark tooling with enforced gates (59.8 median FPS idle, p95 interaction < 100 ms, a 6.5 MiB bundle budget that fails the build). A `FrameProfiler` instruments CPU and GPU stages throughout the hot path. Kept out of A by: the Close Objects search running SGP4 verification synchronously on the main thread while its purpose-built worker ships unused, the 20k-object catalog handed to the position cruncher via `JSON.stringify`/`JSON.parse`, and the defeated memo on the flagship panel (C3).

### Findings

**G1 — Close Objects search does SGP4 verification on the main thread; its dedicated worker is dead code**
- **Where:** `src/plugins/close-objects/close-objects.ts:175-194` — `findCloseObjects_()` runs the whole pipeline synchronously inside `showLoading`; `getActualCSOs_` (`:258-272`) re-propagates every candidate pair with `SatMath.getEci(...)` twice on the main thread. Meanwhile `src/webworker/closeObjectsWorker.ts:95-238` implements exactly this verify+TCA flow off-thread, `src/app/threads/close-objects-thread-manager.ts:45-46` wraps it, nothing in OSS source references the manager outside tests, and the worker is still built as an entry (`build/webpack-manager.ts:343`).
- **What's wrong:** On a 20k+ catalog this freezes the UI for seconds ("takes a few seconds" per the plugin's own locale text) while a shipped, tested solution sits unused.
- **Impact:** Major
- **Fix:** Wire `CloseObjectsThreadManager` into the plugin, streaming `VERIFIED`/`TCA_CHUNK` results into the UI (the message protocol already exists).
- **Effort:** M
- **Grade lift:** G1+G2 are the A- → A step.

**G2 — Broad-phase sweep starts 200 elements *behind* the sweep index**
- **Where:** `src/plugins/close-objects/close-objects.ts:238` — after sorting by `position.x` (`:183`), the inner loop is `for (let j = Math.max(0, i - 200); j < satList.length; j++)`.
- **What's wrong:** A sorted sweep-and-prune should start at `j = i + 1` and break when `pos2.x > posXmax`; the backward magic-number lookback adds ~200·n wasted iterations (≈4M for 20k objects), generates duplicate pairs that must be scrubbed by `getUnique` (`:186`), and silently misses pairs whose x-sorted indices are >200 apart when x-coordinates are near-equal.
- **Impact:** Moderate (correctness + performance)
- **Fix:** `j = i + 1` with the break condition; drop the dedupe pass.
- **Effort:** S
- **Grade lift:** see G1.

**G3 — Catalog handoff to the position cruncher is stringified JSON**
- **Where:** `src/app/data/catalog-loader.ts:383` builds `satDataString` (`getSatDataString_`, `:1142-1143` — `JSON.stringify` of a 20k+-element mapped array) on the main thread at startup; the worker re-parses at `src/webworker/positionCruncher.ts:264` and synchronously builds 20k `Sgp4.createSatrec`s (`:271-275`). Same pattern on catalog swap.
- **What's wrong:** The stringify is pure main-thread startup cost — structured clone of the plain array (native `postMessage`) would remove it; the satrec loop could chunk to interleave early messages.
- **Impact:** Moderate
- **Fix:** Post the plain object array; chunk the satrec build.
- **Effort:** M
- **Grade lift:** startup-time improvement within A-.

**G4 — Defeated `DiscoverPanel`/`StoryDeck` memoization every 600 ms poll** *(same defect as C3 — see there for the full analysis and fix)*
- **Impact:** Moderate · **Effort:** S

**G5 — Monolithic ~5.2 MiB main bundle, no vendor/common chunk strategy**
- **Where:** `build/webpack-manager.ts:267-296` — single `main` entry, no `optimization.splitChunks` anywhere; only split points are dynamic imports (locales `src/locales/locales.ts:35-45`, plugins via the manifest). The budget at `webpack-manager.ts:86-91` documents main.js at ~5.2 MiB against a 6.5 MiB error ceiling.
- **What's wrong:** The budget is enforced (good) but generous; first paint pays for all engine + UI + ootk code up front. Compounded by A7 (~70k lines of static data in the main graph) and `.txt` data files inlined as strings (`webpack-manager.ts:196-201`).
- **Impact:** Moderate
- **Fix:** Add `splitChunks` for vendor (gl-matrix, zod, react); audit the eager main graph; land A7.
- **Effort:** M
- **Grade lift:** moderate.

**G6 — Per-keystroke unbounded catalog scan and sort in search**
- **Where:** `src/satglobe/engine/satglobe-engine-adapter.ts:170-181` — `search()` filters all ~20k entries then sorts the entire filtered array before `slice(0, limit)`; driven per keystroke with no debounce from `satglobe-app.tsx:138-141`.
- **What's wrong:** A one-character query like "1" matches most of the catalog and sorts tens of thousands of entries per keypress.
- **Impact:** Minor
- **Fix:** Early-exit collection at ~limit×4 candidates, or a 100 ms debounce on `query`.
- **Effort:** S
- **Grade lift:** minor.

**G7 — On-demand 25 MB scenario JSON parsed on the main thread**
- **Where:** `src/plugins/missile/missile-simulator-plugin.ts:44-51` maps presets to `public/simulation/` files — `GlobalThermonuclearWar.json` is 25 MB, `Exchange_USA_Russia.json` 19 MB (verified with `du`); parsed via `.json()` at selection.
- **What's wrong:** Blocks the main thread for hundreds of ms on mid-tier hardware. (Related deploy note: `public/` also carries 151 MB of textures and a 5.4 MB preview PNG — fine if CDN-served/lazy, worth a deploy audit; the git pack is ~217 MiB.)
- **Impact:** Minor
- **Fix:** Parse in a worker or convert scenarios to a binary/typed-array format.
- **Effort:** M
- **Grade lift:** minor.

**G8 — Per-frame full-buffer upload plus CPU interpolation loop is the structural frame cost** *(informed trade-off, not a defect)*
- **Where:** `src/engine/rendering/dots-manager.ts:298-304` re-uploads the entire `positionData` array via `bufferSubData` every frame, fed by the O(n) scalar velocity-extrapolation loop at `:1406-1413`. Properly profiled (`CpuStage.dotBuffers`; comment at `:289-291` notes integrated-GPU cost).
- **Fix (opportunity):** Move dead-reckoning into the vertex shader — upload position+velocity only on cruncher messages (~1 Hz), pass `dt` as a uniform — eliminating the per-frame CPU loop and ~240 KB/frame upload. Large refactor touching shaders, picking, and every `positionData` consumer.
- **Impact:** Minor · **Effort:** L
- **Grade lift:** would strengthen an A at high object counts.

*(Scoping note: `src/satglobe/domain/conjunctions.ts` is not a screening algorithm — it is a zod-validated loader for a pre-computed, 25-event-capped SOCRATES feed (`conjunctions.ts:50`); no O(n²) risk there. The pairwise machinery lives in the close-objects plugin/worker covered by G1/G2.)*

### Strengths
1. **Worker propagation architecture is genuinely sophisticated.** Camera data throttled to 200 ms into the worker (`src/engine/engine.ts:204-236`); frustum + Earth-occlusion culling inside the worker (`src/webworker/positionCruncher.ts:427-529`); off-screen satellites propagated every 10th cycle with per-index staggering and velocity extrapolation between (`:620-629`); correct invalidation on time jumps (`:220-224`); transfer-list posts with documented rationale (`:960-1010`); per-cycle Sun ECI caching (`:853-861`) and a measured replacement of a 20-iteration geodetic loop with a spherical bound check (`:778-796`).
2. **React shell hygiene is near-exemplary for a frame-driven app.** 600 ms poll emitting only on observable change ("idle scene produces … zero React re-renders (ADR 0002 idle budget)", `satglobe-engine-adapter.ts:461-473`); reference-identity-preserving snapshots (`:149-157`); 7/7 components `React.memo`'d; 120 ms trailing debounce on slider recolors (`use-workshop-filters.ts:31-38`). Nothing re-renders per animation frame.
3. **Performance is measured, budgeted, and gated — not guessed.** `scripts/satglobe/benchmark-runtime-lite.ts` enforces `MIN_IDLE_MEDIAN_FPS = 59.8` and `MAX_CONJUNCTION_LENS_P95_MS = 100` against the built bundle; `scripts/sgp4-benchmark/` benchmarks the TS propagator against USSF WASM builds; the production build fails on JS assets over 6.5 MiB (`build/webpack-manager.ts:86-91`); `FrameProfiler` wraps every hot stage through `engine.ts` and `dots-manager.ts`.

---

## H. Documentation & Onboarding — Grade: B+

**Justification.** The fork-authored documentation is unusually good: README.md is a full rewrite that accurately reflects SatGlobe, states the Git LFS trap up front, and gives working setup commands; NOTICE-SATGLOBE.md is a textbook AGPL modification notice with exact baseline tag and commit; ADR 0001 maintains an upstream-modification log. Drops from the A range because the *inherited* documentation layer was not swept: contributing.md contradicts the README about submodules, `.env.example` is verbatim upstream content omitting variables the build actually reads, docs/technical.md is stale upstream material, and typedoc documents only the engine — none of the product code — under the name "KeepTrack API".

### Findings

**H1 — contributing.md contradicts the README on the ootk "submodule"**
- **Where:** `docs/contributing.md:29` says "the `src/engine/ootk` submodule must be initialized"; `README.md:23` and `SATGLOBE.md:17` correctly state ootk is vendored in-tree. `.gitmodules:1-3` contains only the private `src/plugins-pro` submodule (SSH URL).
- **What's wrong:** A contributor following contributing.md may run `git submodule update --init` and hit an SSH auth failure against a private repo they can never access. (`build/get-submodules.ts:56` does treat it as optional/allowed-to-fail.)
- **Impact:** Moderate · **Fix:** Delete the submodule clause from contributing.md. · **Effort:** S
- **Grade lift:** H1+H2+H3 are the B+ → A- step.

**H2 — `.env.example` is stale upstream content and incomplete**
- **Where:** `.env.example:1` still headers "# .env file for keeptrack-space"; `:13-14` directs users to get a `KEEPTRACK_API_KEY` from keeptrack.space — irrelevant for an offline fork whose README promises "no runtime third-party API requirement" (`README.md:42`). Omitted variables the build genuinely reads: `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY`/`EDITION`/`PROPAGATOR_BACKEND` (`build/lib/config-manager.ts:230-237`), `BUILD_VERBOSE`/`BUILD_INTERACTIVE` (`build/lib/reporter.ts:72-80`), `SATGLOBE_COMMIT_SHA` (`build/webpack-manager.ts:23`), `SATGLOBE_E2E`/`SATGLOBE_STORY_HEADLESS`.
- **Impact:** Moderate · **Fix:** Rewrite with the actually-read variables, marking optional/upstream-only ones. · **Effort:** S
- **Grade lift:** see H1.

**H3 — typedoc excludes all SatGlobe product code and keeps the upstream name**
- **Where:** `typedoc.json:2-10` lists `src/app`, `src/engine`, `src/plugins`, etc. — not `src/satglobe`; `typedoc.json:32` names the output "KeepTrack API".
- **What's wrong:** `npm run docs` generates API docs that omit the entire product layer the fork exists for.
- **Impact:** Moderate · **Fix:** Add `src/satglobe` to entryPoints and rename. · **Effort:** S
- **Grade lift:** see H1.

**H4 — docs/ carries unmarked stale upstream material**
- **Where:** `docs/technical.md:17-21` shows Jest/Cypress badges (the repo uses Vitest/Playwright) and links the upstream diagram (`:25`); `docs/v5.md`–`docs/v11.md` are upstream release notes, unlabeled.
- **Impact:** Minor · **Fix:** Move to `docs/upstream/` or add a "historical KeepTrack doc" banner. · **Effort:** S

**H5 — No CLAUDE.md / AGENTS.md / architecture entry map**
- **Where:** No root-level orientation file exists; conventions are strong but scattered (ADR 0001 boundary, SATGLOBE.md offline contract, ADR 0002 budgets; lint-enforced boundaries at `eslint.config.mjs:313-321`).
- **Impact:** Minor · **Fix:** Add a short entry map pointing to SATGLOBE.md, the ADRs, and `verify:satglobe`. · **Effort:** S

### Strengths
1. **README is fork-accurate, not upstream residue:** `README.md:19-31` gives correct, tested setup (Node 24, `git lfs install`, `npm ci`, `npm run start:satglobe`) and calls out the single worst onboarding trap first — without LFS "the 19 MB catalog checks out as a pointer file and the app renders an empty sky" (`README.md:23`).
2. **AGPL fork obligations handled correctly:** `NOTICE-SATGLOBE.md:3` records the exact modification start date, upstream release (v13.4.0) and commit (`f06b30bd`); the network-source obligation is restated at `README.md:104` and `docs/adr/0001-satglobe-source-fork.md:27`; upstream copyright notices preserved in place.
3. **SECURITY.md is fork-aware:** routes engine-layer vulnerabilities upstream while keeping SatGlobe-scope reports on private GitHub advisories (`SECURITY.md:12`), and accurately scopes the attack surface (`:22-24`).

---

## I. Developer Experience & Tooling — Grade: A-

**Justification.** For SatGlobe-owned code, tooling is exemplary: a single `verify:satglobe` meta-command mirrors CI exactly; a stricter TypeScript gate applies `strict: true` to product code without blocking on the inherited non-strict engine; the ESLint flat config enforces the ADR 0001 architecture boundary mechanically and annotates every relaxed rule with a rationale and ratchet plan; husky hooks solve real, specific failure modes. Deductions: two dead package.json scripts, 72-script sprawl with no discoverability layer, a pre-commit/CI lint severity mismatch, and CI boilerplate duplicated four times with no Playwright browser caching.

### Findings

**I1 — `npm run createtest` is broken**
- **Where:** `package.json:51` runs `npx tsx ./scripts/create-test-file.ts`; that file does not exist anywhere in the repo.
- **Impact:** Moderate · **Fix:** Restore from upstream v13.4.0 or delete the entry. · **Effort:** S
- **Grade lift:** I1+I3 are the A- → A step (cheap, high-annoyance fixes).

**I2 — Script sprawl with no discoverability layer**
- **Where:** 72 scripts, many upstream-only or non-functional in this fork: `build:pro` (`package.json:37`) needs the private SSH-only submodule; `build:celestrak`/`embed`/`companion`/`epfl` (`:39-42`); `scenario:*` (`:52-54`); `missile:scenarios`/`mirv:meshes` (`:55-56`); `upload:sourcemaps` (`:45`). README documents ~6 commands (`README.md:57-71`).
- **What's wrong:** A newcomer cannot tell the ~10 SatGlobe-relevant commands from the ~60 inherited ones.
- **Impact:** Moderate · **Fix:** Prune non-functional profiles or add a grouped command reference in SATGLOBE.md separating "SatGlobe" from "upstream engine" scripts. · **Effort:** M

**I3 — Pre-commit lint is weaker than the CI lint gate**
- **Where:** lint-staged runs bare `eslint` (`package.json:219-221`) without `--max-warnings 0`, while CI and `verify:satglobe` run `eslint ./src --max-warnings 0` (`package.json:49`). Warn-level rules (`eslint.config.mjs:272-274`, `:243`) pass the hook but fail CI — defeating the hook's stated purpose "so PRs pass CI the first time" (`.husky/pre-commit:5-8`).
- **Impact:** Moderate · **Fix:** Change lint-staged to `eslint --max-warnings 0`. · **Effort:** S
- **Grade lift:** see I1.

**I4 — CI duplicates setup 4× and skips available caching**
- **Where:** All four jobs in `.github/workflows/build-pipeline.yml` repeat identical checkout/LFS-pull/setup-node/npm-ci/t7e blocks (`:26-47`, `:56-77`, `:94-115`, `:141-159`); the e2e job reinstalls Playwright Chromium from scratch every run with no `~/.cache/ms-playwright` cache (`:116-117`); the bundle is built twice per pipeline (inside `verify:satglobe` at `:49` and again in e2e at `:120`) with no artifact reuse.
- **Impact:** Moderate · **Fix:** Extract a composite setup action; cache Playwright browsers keyed on the @playwright/test version; share the dist artifact. · **Effort:** M

**I5 — Strict typecheck gate relies on fragile string filtering of tsc output**
- **Where:** Base is non-strict (`tsconfig.base.json:36-38`); `tsconfig.satglobe.json:4-7` re-enables strict; `scripts/satglobe/typecheck-strict.ts:22-24` then filters diagnostics with `line.startsWith('src/satglobe/')`. Rationale documented at `:3-11`.
- **What's wrong:** A path-format change or directory rename would make the gate pass vacuously with zero signal.
- **Impact:** Moderate · **Fix:** Assert at least one known-good file was compiled, or switch to TypeScript project references so the boundary is structural. · **Effort:** M

**I6 — Dead/stale release scripts**
- **Where:** `package.json:100` `prepublishOnly` → `build:lib` (undefined; see F3); `release`/`release:dry` (`:102-103`) keep semantic-release wired on a private fork pinned at upstream's version 13.4.0 (`:3`).
- **Impact:** Minor · **Fix:** Remove or repair the publish/release trio. · **Effort:** S

### Strengths
1. **`verify:satglobe` is a genuine one-command local CI mirror:** `package.json:79` chains repo typecheck, strict satglobe typecheck, story-walker lint+typecheck, the full `--max-warnings 0` lint gate, focused unit tests, and the production build; CI runs exactly this command (`build-pipeline.yml:49`) — "green locally = green in CI" actually holds.
2. **Architecture enforced by lint, with rationale comments throughout:** `eslint.config.mjs:313-321` implements the ADR 0001 boundary via `no-restricted-imports` with instructive messages; relaxed rules carry explanations and ratchet plans (`:62` complexity 40→45 with reason; `:109` "876 violations… dedicated sweep"; `:202`); JSDoc gating is real (`jsdoc/require-jsdoc: 'error'` at `:275`; only 2 disables in all of src/; 33 of 36 non-test satglobe files documented).
3. **Husky hooks solve real, specific failure modes:** `.husky/commit-msg` rejects PowerShell here-string-corrupted subjects (the changelog is regenerated from git history); `.husky/pre-commit` documents its `--no-verify` escape hatch; `.husky/pre-push` guards the LFS catalog contract.
4. **CI hygiene basics are right:** concurrency cancellation (`build-pipeline.yml:13-15`), per-job timeouts, npm caching via setup-node, least-privilege `contents: read` (`:18`), and a scoped LFS pull with an inline comment explaining why blanket `lfs: true` fails on this fork (`:29-34`).

---

## Consolidated Priority List

All findings across categories, ordered by impact, then expected grade lift (double-weighted categories first among ties), then effort (smaller first).

| # | ID | Finding | Impact | Effort | Grade lift |
|---|----|---------|--------|--------|------------|
| 1 | E1 | Catalog names → `innerHTML` unescaped in 5 plugins | Major | M | E: B+ → A- (with E2) |
| 2 | D2 | Vendored ootk test suite (124 files) never runs | Major | S-M | D: B+ → A- (with D1) |
| 3 | D1 | 85/86 Playwright specs not in CI | Major | M | D: B+ → A- (with D2) |
| 4 | C2 | No React error boundary | Major | S | C: B+ → A- (with C1) |
| 5 | C1 | Global keydown hijacks Ctrl/Cmd+F and Space | Major | S | C: B+ → A- (with C2) |
| 6 | G1 | Close Objects SGP4 on main thread; worker dead code | Major | M | G: A- → A (with G2) |
| 7 | A1 | Engine imports app/plugins upward (125 sites) | Major | L | A: B → B+/A- (with A2, A3) |
| 8 | A2 | keeptrack ↔ engine ↔ plugins import cycle | Major | M | A: with A1 |
| 9 | E2 | CSP on only 1 of 8 profiles; no meta fallback | Moderate | S | E: enables E1's lift |
| 10 | D4 | Catalog fallback keyed on exact error string | Moderate | S | D: user-facing reliability |
| 11 | C3/G4 | `createView` defeats DiscoverPanel memo every 600 ms | Moderate | S | C/G: shared |
| 12 | G2 | Sweep loop starts 200 behind index (~4M wasted iterations) | Moderate | S | G: with G1 |
| 13 | F2 | papaparse misclassified as devDependency | Moderate | S | F: with F1, F3 |
| 14 | F3 | Dead tsup + broken prepublishOnly | Moderate | S | F: with F1, F2 |
| 15 | I3 | Pre-commit lint weaker than CI gate | Moderate | S | I: with I1 |
| 16 | I1 | `createtest` script broken | Moderate | S | I: with I3 |
| 17 | H1 | contributing.md contradicts README (submodule) | Moderate | S | H: with H2, H3 |
| 18 | H2 | `.env.example` stale + incomplete | Moderate | S | H: with H1, H3 |
| 19 | H3 | typedoc omits `src/satglobe` | Moderate | S | H: with H1, H2 |
| 20 | C5 | Unscoped CSS selectors leak into legacy UI | Moderate | S | C: minor |
| 21 | E3 | Legacy catalog loader trusts remote data blindly | Moderate | M/L | E: A- → A (with E4) |
| 22 | F1 | `numeric` (2012) in runtime hot paths (=E7) | Moderate | S-M | F: with F2, F3 |
| 23 | B2 | Shell-string exec in 3 utilities | Moderate | S | B: with B1 |
| 24 | B1 | Unbounded downloads in catalog-refresh | Moderate | M | B: A- → A (with B2) |
| 25 | D5 | Branch coverage floor 57% | Moderate | M | D: A- → A (with D3) |
| 26 | G3 | JSON.stringify catalog handoff to cruncher | Moderate | M | G: startup time |
| 27 | G5 | Monolithic 5.2 MiB bundle, no splitChunks | Moderate | M | G: with A7 |
| 28 | A7 | 66k-line data files compiled as TS in main chunk | Moderate | M | A/G: shared |
| 29 | C4 | React layer English-only atop localized engine | Moderate | M | C: moderate |
| 30 | C6 | Zero listener cleanup in legacy UI | Moderate | M | C: minor-moderate |
| 31 | A3 | `settingsManager` ambient global (53 files) | Moderate | M | A: with A1 |
| 32 | A4 | `keepTrackApi` facade ~95% dead | Moderate | S | A: hygiene |
| 33 | A5 | 1,721-line plugin base class + `Module` type hack | Moderate | M | A: minor |
| 34 | A6 | Config/profile sprawl (6 tsconfigs, 8 profiles) | Moderate | M | A: minor |
| 35 | E4 | `'unsafe-eval'` + `blob:` in script-src | Moderate | L | E: A- → A (with E3) |
| 36 | F5 | Four overlapping transpilers | Moderate | M | F: A- → A (with F6) |
| 37 | F6 | Archived worker-loader | Moderate | M | F: with F5 |
| 38 | F7 | i18next 3 majors behind; uuid/dotenv behind | Moderate | M/S | F: moderate |
| 39 | I2 | 72-script sprawl, no discoverability | Moderate | M | I: moderate |
| 40 | I4 | CI setup ×4, no Playwright cache, double build | Moderate | M | I: moderate |
| 41 | I5 | Strict-gate string filtering fragile | Moderate | M | I: moderate |
| 42 | D3 | 582 `not.toThrow()` smoke assertions | Moderate | L | D: A- → A (with D5) |
| 43–58 | | Minor findings: E5, E6, E8, E9, D6, D7, D8, C7, C8, B3–B7, F4, F8, G6, G7, G8, H4, H5, I6, A8 | Minor | S–L | small |

---

## Remediation Log — 2026-07-20

The top 15 findings from the consolidated priority list were implemented on this branch (line references above describe the pre-remediation code at commit `c9fdf79`):

| ID | Status | How it was fixed |
|----|--------|------------------|
| E1 | ✅ Fixed | Catalog-derived names/ids now pass through `escapeHtml` at all five cited sinks (`sat-info-box.ts`, `watchlist.ts`, `sat-constellations.ts`, `breakup-analysis-table.ts`). |
| E2 | ✅ Fixed | Baseline CSP `<meta>` (`object-src 'none'; base-uri 'self'`) added to `public/index.html`; all non-satglobe dev-server profiles now get a real CSP (no inline scripts) + nosniff + referrer policy via `BASELINE_CSP` in `build/dev-server-response.ts`. |
| D1 | ✅ Fixed | New `.github/workflows/e2e-nightly.yml` runs all 86 Playwright specs nightly (+ manual dispatch) against a production build, with report upload. |
| D2 | ✅ Fixed | New `vitest.ootk.config.ts` + `npm run test:ootk` + blocking CI job run the vendored ootk suite (1,974 tests). Found real rot on first run: TZ-dependent snapshots (regenerated under the repo's TZ=GMT convention), an error-message drift in `ModifiedGoodingIOD.test.ts` (aligned with source), and one non-converging IOD fixture (skipped with explanation). |
| C1 | ✅ Fixed | Global shortcut handler (extracted to `handleGlobalShortcut`) now ignores Cmd/Ctrl/Alt combos, textarea/contentEditable targets, and leaves Space to focused buttons. |
| C2 | ✅ Fixed | `SatGlobeErrorBoundary` (new `src/satglobe/app/error-boundary.tsx`, with tests) wraps the shell in `bootstrap.tsx`, reusing the engine-error presentation with a Reload button. |
| C3/G4 | ✅ Fixed | `createView` reads `adapter.getState()` at call time (no `engine` dep); `StoryDeck`'s `onAuthoredView` is now a stable `useCallback`. |
| G1 | ✅ Fixed | `findCsoBtnClick_` keeps the cheap broad phase on the main thread and hands SGP4 verification to `CloseObjectsThreadManager`/`closeObjectsWorker` (with watchdog timeout and streaming `onVerified` → search). Legacy sync pipeline retained for the pro subclass. |
| G2 | ✅ Fixed | Broad-phase sweep is now `j = i + 1` forward-only with the `posXmax` break — each unordered pair visited once, no reversed duplicates, no 200-element lookback. |
| D4 | ✅ Fixed | Catalog loader falls back to the bundled `tle/tle.json` on ANY primary-source failure (network wording differences, JSON parse errors), with new tests for the Firefox-wording and non-JSON cases. |
| A2 | ✅ Fixed | `base-plugin.ts` no longer imports `@app/keeptrack` — engine pause/resume goes through the Container (`Singletons.Engine` + `ServiceLocator.getEngine()`), breaking the `keeptrack ↔ engine ↔ plugins` cycle. |
| A1 | ✅ Ratchet in place | New `scripts/check-engine-boundary.ts` + checked-in baseline (82 files / 152 upward imports) fails CI on any NEW engine→app import; prints ratchet-down reminders as files improve. Burn-down of the existing 82 files remains future work. |
| F2 | ✅ Fixed | `papaparse` moved to `dependencies` (it is imported by production code). |
| F3 | ✅ Fixed | `tsup` removed (nothing referenced it); broken `prepublishOnly` (`build:lib` never existed) removed. |
| I3 | ✅ Fixed | lint-staged now runs `eslint --max-warnings 0`, matching the CI gate. |

*Report generated by a multi-agent code audit. Every file:line citation was read and verified during the audit; none were inferred. The original audit modified no source files; the remediation above was applied afterward on this branch at the user's request.*
