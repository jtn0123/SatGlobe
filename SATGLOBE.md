# SatGlobe

SatGlobe turns the KeepTrack orbital engine into a local-first, presentation-ready workshop. Its primary layout targets the current 1280×720 application viewport, then expands fluidly through 1440p and readable 16:9 4K presentation, with no account, backend, or runtime third-party API.

## Start locally

Requirements: Node.js 24, npm, Git, and a browser with WebGL 2.

```bash
git submodule update --init src/engine/ootk
npm ci
npm run generate-t7e
npm run start:satglobe
```

Open `http://localhost:5544`. The private KeepTrack Pro submodule is not required and is intentionally absent from SatGlobe.

For a production build and local preview:

```bash
npm run build:satglobe
npm run start:satglobe:static
```

The application loads the checked-in `public/tle/tle.json` snapshot. Browser runtime code is configured for offline mode and does not retrieve catalogs, fonts, imagery, analytics, or story assets from remote services. Browser developer tools may still show requests to the local server because the application itself is delivered as local static files.

## Workshop and story

- Workshop provides local catalog search, quick lenses, combined object and orbital filters, data-driven color encodings, an object inspector, time control, and portable saved-view JSON.
- Present collapses the instrument panels into a calm title composition without changing engine state.
- Story plays the validated five-beat “Building a shell” Starlink narrative over the same scene. Historical beats display `Reconstructed`; the current beat uses the installed propagated catalog.
- `F` toggles presentation, `Escape` returns to Workshop, and the arrow/space controls navigate a story when Story mode is open.

Satellite marks use semantic scale by default. They are enlarged for legibility. True-scale comparison is a disclosure state: most real spacecraft are too small to remain visible at planetary scale.

## Catalog refresh

Catalog updates are explicit and never happen in the browser:

```bash
npm run catalog:verify
npm run catalog:refresh
```

The command starts with KeepTrack’s enriched catalog and merges CelesTrak OMM-compatible CSV for active objects and Starlink. It treats catalog identifiers as strings, rejects duplicate IDs and malformed elements, blocks epoch regressions, checks suspicious object-count drops, and derives a deterministic snapshot ID from source content.

CelesTrak updates group downloads every two hours and rejects repeat requests inside that window. SatGlobe caches successful manual downloads in the ignored `.cache/satglobe` directory for two hours, so `catalog:verify` followed by `catalog:refresh` validates and installs the exact same inputs without a second provider request. Delete that directory only when a genuinely fresh download is required. A successful install writes:

- `public/tle/tle.json`
- `public/tle/satglobe/manifest.json`
- `public/tle/satglobe/catalog.sha256`
- `public/tle/satglobe/rejected-rows.json`
- `public/tle/satglobe/summary.json`

Use checked-in source files for a reproducibility check:

```bash
npx tsx scripts/satglobe/catalog-refresh.ts \
  --verify-only \
  --active-input ./inputs/active.csv \
  --starlink-input ./inputs/starlink.csv
```

General-perturbations/SGP4 output is a prediction from public element sets. SatGlobe never calls it live telemetry. Accuracy degrades as elements age and after maneuvers that the installed elements do not represent.

## Quality gates

```bash
npm run typecheck
npm run lint
npm run test:satglobe
npm run build:satglobe
npm run test:e2e:satglobe
```

`npm run verify:satglobe` runs typecheck, the full source lint gate, focused SatGlobe/catalog/offline unit tests, and the production build as one local checkpoint command. The Playwright journey remains separate because it starts the WebGL application in Chromium.

The upstream test suite is available with `npm test`. The one machine-dependent snapshot from the v13.4.0 import baseline (a weather-coordinate floating-point difference around 1e-12) has been replaced with a stable projection, so the full suite is expected to pass on any machine.

## Docker

```bash
npm run docker:satglobe
docker run --rm -p 8080:80 satglobe:local
```

Open `http://localhost:8080`. Docker serves only the generated static bundle; it does not add a backend.

## Upstream sync

The `upstream` remote points to `https://github.com/thkruz/keeptrack.space.git`. Track releases by tag and perform merges on a dedicated branch:

```bash
git fetch upstream --tags
git switch -c codex/upstream-keeptrack-vNEXT
git merge vNEXT
npm ci
npm run generate-t7e
npm run typecheck
npm run test:satglobe
npm run build:satglobe
```

Resolve upstream changes outside `src/satglobe` with minimal edits. Product code must not import KeepTrack internals; `src/satglobe/engine` is the sole engine boundary. See [ADR 0001](docs/adr/0001-satglobe-source-fork.md).

## Deferred scope

Phone layouts, authoring tools, cislunar and Lagrange frames, desktop wrappers, accounts, cloud synchronization, collaboration, and automatic background refresh are not v1 features. The domain schemas keep identifiers and element-set kinds extensible for later OEM and multi-body work.
