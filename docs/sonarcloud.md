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

The following line-level disposition is kept next to the affected command with `NOSONAR`; it is not a rule-wide or path-wide exclusion:

| Rule | Path | Rationale and compensating control |
|---|---|---|
| `docker:S7026` | `configs/satglobe/healthcheck.sh` | S7026 recommends Docker `ADD` for build-time downloads, but this `wget` call is a runtime HTTP health probe and `ADD` cannot replace it. The Docker regression test locks the endpoint and command, while the image smoke test requires the container to reach Docker's `healthy` state. |
| `typescript:S1607` | `src/__tests__/sgp4-wasm.spec.ts` | The in-app parity journey requires license-restricted Sgp4Prop artifacts that cannot be committed or installed on public CI runners. The conditional skip carries Playwright's runtime reason and runs automatically when an authorized developer deploys all four local artifacts; the open TypeScript SGP4 benchmark remains blocking in CI. |

## Quality gate

After the valid legacy findings are cleared, the built-in Sonar quality gate is assigned to the project so new bugs, vulnerabilities, unreviewed security findings, and maintainability regressions are visible on every pull request. Automatic analysis reads `.sonarcloud.properties`; the local `.sonar-project.properties` file is for the optional Docker-hosted SonarQube workflow.
