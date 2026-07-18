# SatGlobe

SatGlobe is a local-first orbital visualization and storytelling workshop. It combines KeepTrack's proven WebGL/SGP4 engine with a focused TypeScript and React interface for exploring launches, constellations, orbital regimes, and the provenance behind what is shown.

The project is an early alpha. The first vertical slice is designed for a 1280×720 desktop viewport and scales through 1440p and 16:9 4K presentation.

## What works now

- Explore a checked-in catalog of more than 30,000 orbital objects and a curated public close-approach snapshot without runtime network access.
- Search the local catalog by identity, launch designator, country, or operator, then filter the scene by object class, operational state, regime, and inclination.
- Color the same scene by object type, regime, launch cohort, plane density, data age, or Starlink state.
- Inspect object identity, orbit, launch metadata, element epoch, catalog provenance, and resolved CelesTrak SOCRATES screening details.
- Move between a dense Workshop, a quiet presentation view, and a sourced five-beat Starlink buildout story.
- Export and import validated JSON views containing camera, time, filters, selection, scale, and presentation state.
- Compare readable semantic satellite marks with a disclosed true-scale view.

SatGlobe does not call predicted positions or public conjunction screening live telemetry. SOCRATES results are not operator alerts and must not be used alone for operational decisions. Predictions become less reliable as public element sets age or after unrepresented maneuvers.

## Run locally

Requirements: Node.js 24, npm, Git with Git LFS, and a browser with WebGL 2.

**Git LFS is required** — without it the 19 MB catalog checks out as a pointer file and the app renders an empty sky. The orbital toolkit (`src/engine/ootk`) is vendored in the tree; no submodule setup is needed.

```bash
git clone https://github.com/jtn0123/SatGlobe.git
cd SatGlobe
git lfs install
npm ci
npm run start:satglobe
```

Open `http://localhost:5544/`.

For a production bundle and local static preview:

```bash
npm run build:satglobe
npm run start:satglobe:static
```

The application reads bundled catalogs, imagery, fonts, and story data. It has no account, backend, analytics dependency, or runtime third-party API requirement.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the catalog search |
| `?` | Show / hide the shortcuts legend |
| `F` | Toggle the quiet presentation view |
| `Escape` | Return to the Workshop |
| `←` / `→` | Previous / next story beat (Story mode) |
| `Space` | Play / pause the story (Story mode) |

## Quality gates

```bash
npm run verify:satglobe
npm run test:e2e:satglobe
```

The main verification command runs TypeScript checking, the full source lint gate, focused unit tests, offline-behavior tests, and the production build. The Playwright journey separately exercises the real WebGL app at 1280×720, 1440p, and 4K.

Other useful commands:

| Command | Purpose |
| --- | --- |
| `npm run start:satglobe` | Start the SatGlobe development profile |
| `npm run catalog:verify` | Download or reuse cached inputs and validate a candidate catalog |
| `npm run catalog:refresh` | Atomically install a validated local catalog snapshot |
| `npm run docker:satglobe` | Build the static local-serving image |

## Architecture

SatGlobe is a maintained source fork of [KeepTrack v13.4.0](https://github.com/thkruz/keeptrack.space/releases/tag/v13.4.0). Upstream rendering, workers, catalog enrichment, camera, time, and orbit systems remain intact.

Product-owned code is kept behind a narrow boundary:

```text
src/satglobe/app       React workshop, presentation, and story UI
src/satglobe/domain    Versioned schemas and pure product logic
src/satglobe/engine    The only SatGlobe module allowed to import KeepTrack internals
src/satglobe/stories   Validated, sourced story manifests
scripts/satglobe       Manual catalog refresh and validation
```

Read [SATGLOBE.md](SATGLOBE.md) for operating details and [ADR 0001](docs/adr/0001-satglobe-source-fork.md) for the fork, offline-runtime, and upstream-sync decisions.

## Catalog refresh

Catalog updates are deliberate local operations, never browser background requests. The refresh command merges KeepTrack's enriched offline data with CelesTrak OMM-compatible sources and curates the official CelesTrak SOCRATES close-approach feed. It validates identifiers, epochs, screening provenance, and output shape; rejects regressions; and leaves installed artifacts untouched on failure.

```bash
npm run catalog:verify
npm run catalog:refresh
```

OMM downloads use a two-hour cache; SOCRATES uses an eight-hour provider-metadata gate. Timezone-less OMM epochs are parsed strictly as UTC. Verification is write-free, while refresh performs a manifest-last staged install whose v2 manifest separates the actual refresh time from the newest accepted element epoch. The curated `conjunctions.json` plus provenance, checksum, rejection, and summary reports live under `public/tle/satglobe/`; see [ADR 0003](docs/adr/0003-catalog-time-provenance.md) for the checksum, snapshot, and migration invariants.

## Upstream and license

`origin` is [jtn0123/SatGlobe](https://github.com/jtn0123/SatGlobe). The `upstream` remote tracks [thkruz/keeptrack.space](https://github.com/thkruz/keeptrack.space) for deliberate release-tag merges.

SatGlobe is distributed under [GNU AGPL-3.0](LICENSE). It preserves KeepTrack, Kruczek Labs LLC, contributors, and earlier ThingsInSpace attribution. See [NOTICE-SATGLOBE.md](NOTICE-SATGLOBE.md) for the modification and attribution notice. SatGlobe does not imply endorsement by KeepTrack, Kruczek Labs LLC, CelesTrak, SpaceX, the FCC, or any catalog provider.
