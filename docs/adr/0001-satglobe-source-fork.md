# ADR 0001: KeepTrack source fork and SatGlobe product boundary

- Status: accepted
- Date: 2026-07-15
- Upstream baseline: KeepTrack v13.4.0 (`f06b30bd`)

## Context

SatGlobe needs KeepTrack’s complete WebGL renderer, propagation workers, catalog enrichment, time model, camera, orbit paths, and color systems. KeepTrack’s source release is ahead of its reusable npm surface, and the required engine seams are not exposed as a stable package API.

The application must run locally without accounts, a backend, runtime catalogs, analytics, or remote story assets. It must remain type-safe and able to absorb later KeepTrack releases without scattering product behavior through upstream code.

## Decision

SatGlobe is maintained as an AGPL-3.0 source fork. Upstream history and tags remain intact and the Git remote named `upstream` tracks KeepTrack.

All SatGlobe-owned product code lives under `src/satglobe`. Only `src/satglobe/engine` may import KeepTrack or OOTK internals. React renders into a sibling overlay above KeepTrack’s canvas; the `satglobe` profile suppresses the upstream visual shell but retains engine services. `src/main.ts` contains the minimal edition-specific mount and service-worker exclusion.

The browser reads only bundled resources. Catalog refresh is a manual Node command that validates all inputs before atomically replacing the checked-in catalog. Portable view JSON is strict, versioned data and cannot resolve scripts or arbitrary remote assets.

## Consequences

- Upstream engine capability is retained without reimplementing propagation or rendering.
- SatGlobe remains covered by AGPL-3.0. If it is offered over a network, users must receive access to the corresponding modified source as required by the license.
- The adapter is intentionally narrow and is the expected conflict-resolution point during upstream sync.
- The React version and schema library become additional maintained dependencies.
- Browser runtime behavior can be tested with the network disabled; a catalog update requires deliberate local operator action.
- KeepTrack Pro is not part of SatGlobe and is not required to install, test, or build it.

## Upstream policy

1. Fetch release tags from `upstream`.
2. Merge a selected tag into a dedicated `codex/upstream-keeptrack-*` branch.
3. Preserve upstream changes unless SatGlobe’s documented profile or adapter boundary requires a small modification.
4. Run typecheck, SatGlobe unit tests, production build, offline E2E, and selected upstream tests.
5. Record any unavoidable upstream-file modification in this ADR or a successor.

## Upstream modification log

- 2026-07-17 — `test/weatherApi/weather.test.ts` (+ regenerated snapshot): replaced the machine-dependent full-object snapshot of `calculatePasses_()` with a stable projection (sensor `objName`, pass type, ISO pass windows). The raw `DetailedSensor` graph embeds trig-derived ECF positions that differ at ~1e-12 across libm implementations, which made the upstream snapshot fail on some machines (previously noted in `SATGLOBE.md`).
