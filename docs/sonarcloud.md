# SonarCloud policy

SatGlobe uses SonarCloud automatic analysis for broad static analysis and the repository's blocking ESLint, TypeScript, unit, OOTK, E2E, and build gates for executable verification. Run `npm run sonar:cloud-report` to print the current unresolved-issue inventory or add `-- --json` for machine-readable output.

## Analysis scope

The cloud scanner intentionally excludes `src/engine/ootk/.github/**`. Those files are retained provenance from the vendored OOTK project; GitHub does not execute nested workflow directories in the parent SatGlobe repository. Because automatic analysis does not support this wildcard in `.sonarcloud.properties`, the pattern is configured under **Administration > General Settings > Analysis Scope > Files > Source File Exclusions** in the SonarCloud project settings. The declarative story manifests remain included in normal analysis but excluded from copy-paste detection because their repeated beat/fact/source structure is the authored data schema.

## Rule dispositions

The project-admin settings under **Administration > General Settings > Analysis Scope > Issues > Ignore Issues on Multiple Criteria** contain only these reviewed exceptions:

| Rule | Paths | Rationale and compensating control |
|---|---|---|
| `typescript:S3776` | `**/*` | SonarCloud's built-in threshold is 15, while this inherited math/WebGL codebase deliberately enforces a blocking ESLint complexity ceiling of 45. SatGlobe-owned hotspots are still refactored when they reduce product risk. |
| `typescript:S6534` | `src/engine/ootk/src/propagator/RungeKutta89Propagator.ts`, `src/engine/ootk/src/sgp4/sgp4.ts` | Published numerical coefficients are necessarily rounded to IEEE-754 when loaded into `Float64Array`. Shortening the source literals cannot recover precision; OOTK and SGP4 parity tests guard behavior. |
| `typescript:S2245` | `src/app/data/catalog-loader.ts`, `src/app/ui/splash-screen.ts`, `src/engine/audio/sound-manager.ts`, `src/engine/rendering/draw-manager/sun.ts`, `src/engine/utils/demo-mode.ts`, `src/engine/utils/showLoading.ts`, `src/plugins/dops/terrain-mask-profile.ts` | Randomness drives notional simulation or presentation variation, never authentication, secrets, or cryptography. Custom-sensor identifiers use `crypto.randomUUID()` and are not excluded. |
| `typescript:S6440` | `scripts/sgp4-benchmark/sgp4-benchmark.ts`, `src/engine/ootk/src/maneuver/Waypoint.ts`, `src/engine/utils/sgp4-wasm-loader.ts`, `test/e2e/coverage.ts` | The flagged `useWasmBackend`, `useShortPath`, and Playwright fixture `use` calls are not React Hooks or React components. |

No other rule-wide exclusions are permitted. A new exception must name the exact rule and narrowest path, explain why the rule is inapplicable, identify the compensating test or gate, and be reviewed in source control before the matching SonarCloud setting changes.

### Compatibility contracts

`typescript:S1874` is resolved in source rather than excluded. A symbol is marked deprecated only when callers have a behaviorally equivalent, supported replacement. Three widely used contracts had aspirational deprecation labels even though their suggested replacements could not serve every current caller:

| Contract | Why it remains current | Retirement criterion |
|---|---|---|
| `DetailedSensor` scalar FOV fields | These fields are the constructor, serialized custom-sensor, worker, and mutable UI data shape. `getFieldOfView()` returns an attached sensor's single FOV; `getFaceFovs()` returns its per-face FOVs. Either may return `undefined`. | Migrate persisted custom sensors, worker messages, editors, and all scalar mutations to a versioned structured-FOV schema with legacy-data loading tests. |
| `CoreSettings.installDirectory` | Self-hosted and offline deployments use it as the asset base when SatGlobe is served below the webserver root. Browser-relative resolution is not equivalent for every loader. The setter normalizes non-empty values to end in `/` before loaders append asset paths. | Route every catalog, texture, mesh, audio, worker, and fallback URL through one tested runtime base-URL resolver. |
| Bundled `sensorGroups` | Synchronous consumers use the bundled list, and `fetchSensorGroups()` itself returns it when the API is empty or unavailable. | Convert all consumers to an async provider while retaining an offline/API-failure fallback with equivalent startup behavior. |
| `ReportData.body` / `isHeaders` | Externally registered reports still use the string-body contract; the formatter converts it into the structured table model. | Version the plugin report API and provide a migration period with legacy-format characterization tests. |
| `SensorMath` TEARR helpers | These adapters add SatGlobe FOV filtering, rise/set labels, sensor-manager validation, and UI-ready formatting that no single OOTK call provides. | Move the application-specific result model onto a documented OOTK adapter with parity tests for rise, peak, set, and out-of-view cases. |
| Cached/safe `SatMath` adapters | `getSunDirection()` uses the live scene cache, while `getDirection()` converts propagation failures to the UI's `Error` result. Direct OOTK calls have different error and caching behavior. | Give the scene cache and safe-direction result explicit application services, then migrate callers with failure-path tests. |

Removing those inaccurate annotations is a contract correction, not a Sonar exception. Their characterization tests remain the change-safety control until the retirement criteria are implemented.

The following line-level disposition is kept next to the affected command with `NOSONAR`; it is not a rule-wide or path-wide exclusion:

| Rule | Path | Rationale and compensating control |
|---|---|---|
| `docker:S7026` | `configs/satglobe/healthcheck.sh` | S7026 recommends Docker `ADD` for build-time downloads, but this `wget` call is a runtime HTTP health probe and `ADD` cannot replace it. The Docker regression test locks the endpoint and command, while the image smoke test requires the container to reach Docker's `healthy` state. |
| `typescript:S1607` | `src/__tests__/sgp4-wasm.spec.ts` | The in-app parity journey requires license-restricted Sgp4Prop artifacts that cannot be committed or installed on public CI runners. The conditional skip carries Playwright's runtime reason and runs automatically when an authorized developer deploys all four local artifacts; the open TypeScript SGP4 benchmark remains blocking in CI. |

## Quality gate

After the valid legacy findings are cleared, the built-in Sonar quality gate is assigned to the project so new bugs, vulnerabilities, unreviewed security findings, and maintainability regressions are visible on every pull request. Automatic analysis reads `.sonarcloud.properties`; the local `.sonar-project.properties` file is for the optional Docker-hosted SonarQube workflow.
