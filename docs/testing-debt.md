# Testing debt — remaining skipped tests

Tracked remainder of the 2026-07-17 skip triage (grade-report item D5). The sweep
un-skipped or fixed 26 tests and deleted 21 that pinned removed behavior; the
markers below are what legitimately remains, each with the reason and the work
required to retire it. Nothing may be re-skipped without an entry here.

| File | Markers | Why it stays skipped | Path to retirement |
|---|---|---|---|
| `src/__tests__/sgp4-wasm.spec.ts` | 1 conditional | By design: runs only when the license-restricted Sgp4Prop WASM artifacts are present locally | None — intended gate |
| `src/engine/input/__tests__/url-manager.test.ts` | 5 skips + 1 todo | `UrlManager` reads `window.location` directly and JSDOM's location is non-configurable under vitest | Inject `location` into `UrlManager` (small DI refactor), then un-skip; write the missile-params test while there |
| `src/engine/plugins/components/help/__tests__/help-component.test.ts` | 4 | The `adviceManagerInstance.showAdvice` module mock is not the instance the component resolves at runtime; assertions get 0 calls | Rework the module mock to intercept the real resolution path (or expose an injection seam) |
| `src/engine/plugins/components/secondary-menu/__tests__/secondary-menu-component.test.ts` | 2 | Same class of module-mock plumbing for the sound manager | Same as above |
| `src/engine/plugins/components/side-menu/__tests__/side-menu-component.test.ts` | 1 | Same class of module-mock plumbing for `ServiceLocator.getUiManager` (behavior covered indirectly by the passing open/close suite) | Same as above |
| `src/engine/plugins/components/context-menu/__tests__/context-menu-component.test.ts` | 1 | InputManager registration mock timing; the registration is exercised by integration tests | Return the mock before `init()` or drop in favor of the integration coverage |

Deleted in the sweep (do not resurrect without rewriting against current APIs):
orbit-data link clicks (elements removed from product), spatial-density scheme
blocks (tests the pre-`orbitDensity` design), `createSensorRow_` throw (method
no longer throws), satellite-view bottomMenuClick pair (superseded by the
behavior suite), orbit-references link click (superseded), two keeptrack boot
tests (assertions were no-ops), earth `mvMatrix_` test (field removed in the
mesh rewrite), six `getDirection` null-stub tests (unwritten TODOs against a
deprecated API), four color-scheme-manager choreography tests (pinned internal
call patterns that no longer exist; behavior covered by per-scheme and
color-worker parity suites).
