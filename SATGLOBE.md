# SatGlobe

SatGlobe turns the KeepTrack orbital engine into a local-first, presentation-ready workshop. Its primary layout targets the current 1280×720 application viewport, then expands fluidly through 1440p and readable 16:9 4K presentation, with no account, backend, or runtime third-party API.

## Start locally

Requirements: Node.js 24, npm, Git with Git LFS, and a browser with WebGL 2.

**Git LFS is required** — without it the catalog checks out as a tiny pointer file and the app renders an empty sky.

```bash
git lfs install
npm ci
npm run start:satglobe
```

The dev server regenerates translations on start; the orbital toolkit (`src/engine/ootk`) is vendored in the tree, so no submodule setup is needed.

Open `http://localhost:5544`. The private KeepTrack Pro submodule is not required and is intentionally absent from SatGlobe.

For a production build and local preview:

```bash
npm run build:satglobe
npm run start:satglobe:static
```

The application loads the checked-in `public/tle/tle.json` catalog and `public/tle/satglobe/conjunctions.json` screening snapshot. Browser runtime code is configured for offline mode and does not retrieve catalogs, screening data, fonts, imagery, analytics, or story assets from remote services. Browser developer tools may still show requests to the local server because the application itself is delivered as local static files.

## Workshop and story

- Workshop provides local catalog search, quick lenses, combined object and orbital filters, data-driven color encodings, an object inspector, time control, portable saved-view JSON, and portable captioned playlists. Its cumulative launch-history transport can step or play the installed catalog from 1960 through the newest known launch year; each stop applies one combined filter, recolor, and count update. The Close approaches lens highlights resolved pairs from the bundled CelesTrak SOCRATES public screening snapshot and shows metrics, source timestamps, and explicit stale/past caveats. It is not live telemetry, an operator alert, or an operational decision source.
- Present collapses the instrument panels into a calm title composition without changing engine state. The launch-history transport remains usable there, and saved-view playlists play as captioned presentation sequences.
- Story plays eight validated, sourced narratives over the same scene: Starlink buildout, launch to orbit, ISS assembly, one day in orbit, the GPS clockwork, the 2007 Fengyun-1C ASAT debris cloud, the 2009 Cosmos–Iridium collision, and the geostationary ring. The picker changes stories in place; the time-led story uses offsets from a stable per-story entry anchor. Historical beats display `Reconstructed`, and every story ends on the installed propagated catalog. Authoring and screenshot-verification guide: `docs/story-authoring.md`.
- `/` focuses the catalog search, `?` shows the shortcuts legend, `F` toggles presentation, `Escape` returns to Workshop, and the arrow/space controls navigate a story when Story mode is open.

Screening status uses the provider update time, never the local retrieval time. A snapshot with future resolved encounters is `current` for 24 hours, then `stale`; once every resolved encounter is past it becomes `archival`. The adapter re-evaluates those boundaries while the page remains open, and the Inspector labels a selected past event as past even when another pair is still upcoming.

Satellite marks use semantic scale by default. They are enlarged for legibility. True-scale comparison is a disclosure state: most real spacecraft are too small to remain visible at planetary scale.

## Catalog refresh

Catalog updates are explicit and never happen in the browser:

```bash
npm run catalog:verify
npm run catalog:refresh
```

The command starts with KeepTrack’s enriched catalog, merges CelesTrak OMM-compatible CSV for active objects and Starlink, and curates up to 25 future SOCRATES close-approach records from CelesTrak's official `sort-minRange.csv`. It treats catalog identifiers as strings, rejects duplicate IDs and malformed elements, blocks epoch regressions, checks suspicious object-count drops, strictly validates screening provenance, and derives deterministic snapshot IDs from source content.

CelesTrak OMM group downloads use a two-hour local cache. SOCRATES checks provider metadata on an eight-hour gate and preserves its original retrieval timestamp when provider bytes are unchanged. `catalog:verify` is deliberately write-free; `catalog:refresh` validates all candidate outputs before a manifest-last staged install. Delete `.cache/satglobe` only when a genuinely fresh provider request is required. A successful install writes:

- `public/tle/tle.json` (stored via Git LFS — each refresh rewrites ~20 MB, and LFS keeps those revisions out of the base git history)
- `public/tle/satglobe/manifest.json`
- `public/tle/satglobe/conjunctions.json`
- `public/tle/satglobe/catalog.sha256`
- `public/tle/satglobe/rejected-rows.json`
- `public/tle/satglobe/summary.json`

Use checked-in source files for a reproducibility check:

```bash
npx tsx scripts/satglobe/catalog-refresh.ts \
  --verify-only \
  --active-input ./inputs/active.csv \
  --starlink-input ./inputs/starlink.csv \
  --socrates-input ./inputs/sort-minRange.csv \
  --socrates-updated-at 2026-07-18T01:13:28.000Z \
  --socrates-retrieved-at 2026-07-18T11:25:30.000Z
```

`--socrates-updated-at` must be the canonical ISO form of the provider's `FILE_MTIME` for that exact saved CSV, and `--socrates-retrieved-at` must preserve when those bytes were originally downloaded. SatGlobe never substitutes local processing or filesystem modification time for source provenance.

General-perturbations/SGP4 output and SOCRATES screening are predictions from public element sets. SatGlobe never calls either live telemetry. Accuracy degrades as elements age and after maneuvers that the installed elements do not represent.

## Quality gates

```bash
npm run typecheck
npm run lint
npm run test:satglobe
npm run build:satglobe
npm run test:e2e:satglobe
npm run verify:stories
```

`npm run verify:satglobe` runs the application and story-walker typechecks, the full source lint gate, focused SatGlobe/catalog/offline unit tests, and the production build as one local checkpoint command. The Playwright journeys remain separate because they start the WebGL application in Chromium.

`npm run verify:stories` invokes a runner that always creates a fresh production profile itself, so calling `npx tsx scripts/satglobe/verify-stories.ts` directly cannot certify a stale ignored `dist/`. It serves that profile and walks all eight stories in headed Chromium at 1440×900. Before Story opens, the runner stops propagation at rate `0` and fixes the audit clock to the installed catalog's `newestElementEpoch`; every story is reset to that same anchor. It rejects picker/library drift, engine errors, empty scenes, and authored camera/filter/encoding/time mismatches.

Fixed 1440×900 viewport evidence is written under the ignored `test-results/satglobe-story-shots/<run-key>/` path. Every clean or dirty key includes the Git SHA, a compact UTC timestamp, and a UUID; dirty keys are explicitly marked, and the runner creates the leaf directory exclusively instead of reusing an earlier run. `manifest.json` records the fixed audit anchor, the fresh production tree's SHA-256 identity, and a SHA-256 for every screenshot. Set `SATGLOBE_STORY_HEADLESS=1` for automation.

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
