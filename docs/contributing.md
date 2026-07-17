# Contributing to SatGlobe

Thanks for your interest in SatGlobe — a local-first orbital visualization workshop built as an AGPL-3.0 source fork of [KeepTrack](https://github.com/thkruz/keeptrack.space).

## Where things go

- **Issues and pull requests** for SatGlobe belong on [jtn0123/SatGlobe](https://github.com/jtn0123/SatGlobe/issues).
- Improvements to the underlying engine (rendering, propagation, plugins outside `src/satglobe`) are usually best contributed **upstream** to [KeepTrack](https://github.com/thkruz/keeptrack.space) — SatGlobe absorbs upstream releases on a regular cadence (see the upstream-sync policy in [SATGLOBE.md](../SATGLOBE.md) and [ADR 0001](adr/0001-satglobe-source-fork.md)).

## Ground rules

1. **Respect the engine boundary.** Product code lives in `src/satglobe`; only `src/satglobe/engine` may import KeepTrack or OOTK internals. This is enforced by lint — if `no-restricted-imports` fires, route your change through the adapter instead.
2. **Keep the offline contract.** The satglobe profile must make zero external network requests at runtime. The E2E asserts this; don't add remote fetches to the product path.
3. **Mind the performance budgets.** [ADR 0002](adr/0002-performance-budgets.md) defines bundle, idle, interaction, and startup budgets. A PR that touches the render loop, adapter, color pipeline, catalog loading, or the build should say which budgets it affects.
4. **Record upstream-file modifications** in ADR 0001's upstream modification log.

## Quality gates

```bash
npm run verify:satglobe   # typecheck + lint + focused tests + production build
npm run test:e2e:satglobe # offline Playwright journey
npm test                  # full upstream + SatGlobe unit suite
```

All of these run in CI on pull requests to `main`.

## Setup

See the [README](../README.md) for local setup. Node.js 24, npm, and a WebGL 2 browser are required; the `src/engine/ootk` submodule must be initialized.
