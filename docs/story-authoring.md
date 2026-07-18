# Authoring a SatGlobe story

A story is a guided tour of the live orbital scene: a handful of **beats** (chapters), each moving the camera, filters, color encoding, and optionally simulation time while a caption narrates. Stories are plain TypeScript data — no editor or story-specific build step — validated by a schema at import, so a broken story fails the build and tests instead of the viewer.

The library lives in `src/satglobe/stories/`. Each story is one file exporting one parsed manifest; `src/satglobe/stories/index.ts` lists them in presentation order.

## The shape of a story

```ts
import type { StoryManifestV1 } from '../domain/types';
import { storyManifestV1Schema } from '../domain/schemas';

export const myStory: StoryManifestV1 = storyManifestV1Schema.parse({
  schemaVersion: 1,
  id: 'my-story',                    // kebab-case, unique in the library
  title: 'A short evocative title',
  dek: 'One-sentence subtitle shown in the story deck.',
  reconstructionPolicy: 'sourced-reconstruction',
  sources: [ /* where the facts come from */ ],
  facts:   [ /* sourced statements beats can cite */ ],
  beats:   [ /* the chapters */ ],
});
```

`storyManifestV1Schema.parse` at the export site is the contract: it rejects unknown fields, missing citations, and dangling ids. Keep it.

## Sources and facts — the honesty system

Every claim a story makes lives in a **fact**, and every fact cites at least one **source**. The viewer's "Sources · Facts" drawer renders them, so an audience can check the story against its references.

```ts
sources: [{
  id: 'esa-space-debris',
  title: 'About space debris',
  url: 'https://www.esa.int/Space_Safety/Space_Debris/About_space_debris',
  retrievedAt: '2026-07-17',        // the date YOU verified the URL
  publisher: 'European Space Agency',
}],
facts: [{
  id: 'collision-event',
  text: 'On 10 February 2009 at 16:56 UTC, ...',   // states only what the source states
  sourceIds: ['esa-space-debris'],
  caveat: 'Optional: limits of the claim.',        // use for anything time-sensitive
}],
```

Rules that keep stories trustworthy:
- **Write facts strictly from what the source says.** If you can't cite it, don't claim it — put interpretation in the beat's `narration` instead, phrased as framing, not fact.
- **Verify every URL on the day you write `retrievedAt`.** Dead links in a sourced story cost more credibility than no source.
- Numbers that drift over time (object counts, fleet sizes) get a `caveat` pointing at the source for current figures.

## Beats — the chapters

```ts
{
  id: 'the-cloud',
  eyebrow: '04 / THE FRAGMENT CLOUDS',   // small caps kicker, numbered
  title: 'Two satellites become thousands of pieces',
  dateLabel: '10 Feb 2009, 16:56 UTC',   // free text under the kicker
  narration: 'One or two sentences the audience reads during the beat.',
  factIds: ['collision-speed', 'fragment-count'],
  durationMs: 14_000,                    // 11–16s reads well; schema allows 1s–120s
  camera: { pitch: 0.4, yaw: 2.5, zoom: 0.55 },
  encoding: 'launch-cohort',             // which color encoding tells this chapter's story
  constellation: 'iridium 33',           // optional: name-match filter (lowercase substring)
  launchCohort: '1997-051',              // optional: launch-date/designator substring filter
  simulationTimeOffsetHours: 6,          // optional: hours from this Story session's time anchor
  orbitCatalogId: '25544',               // optional: draw one catalog object's propagated orbit
  orbitCatalogIds: ['64202', '67588'],   // optional: draw up to 12 unique catalog-object orbits
  filterOverrides: {                     // optional: departures from the default filters
    objectKinds: ['debris'],             //   e.g. a collision chapter must show debris
    status: 'all',
  },
  reconstruction: 'reconstructed',       // or 'observed' — see below
  scaleMode: 'semantic',
}
```

Field notes:
- **`camera`** — capture poses from the live app: position the view how you want it, then in the browser console run `window.satGlobe.getState().camera` and copy the `{ pitch, yaw, zoom }` it prints. Don't guess; captured poses are what make beats land.
- **`encoding`** — one of the six visual meanings below. Pick the encoding that carries the chapter's point.

  | Value | What the color means |
  | --- | --- |
  | `object-type` | Payload, rocket body, debris, or other catalog object. |
  | `orbit-regime` | LEO, MEO, GEO, highly elliptical, or another orbital regime. |
  | `launch-cohort` | One deterministic color per actual launch, keyed by the normalized `YYYY-NNN` international designator. Objects launched together share a color. This changes color; it does not select one launch. |
  | `orbital-plane` | Local orbital-plane density. Useful for constellation shells and repeated planes. |
  | `data-age` | Age of the current GP/TLE element epoch relative to the installed catalog's reference date. It is **not** spacecraft age, debris age, mission age, or time since launch. |
  | `starlink` | Installed Starlink records split by known operational status; non-Starlink objects are hidden. |

- **`constellation`** — a lowercase substring matched against object names (`'navstar'` selects GPS, `'cosmos 2251'` selects that satellite and its named fragments). Leave unset to show everything the filters allow.
- **`launchCohort`** — a substring matched against the launch date and international designator. Use an exact designator prefix such as `'2026-027'` to select the catalog records associated with one launch. Despite the similar name, this field is a selector; the `launch-cohort` encoding above assigns colors to all visible launches without narrowing the population.
- **`simulationTimeOffsetHours`** — moves simulation time relative to one stable anchor captured when the user enters Story mode or selects a different story. `0`, `1.5`, and `24` mean that story's entry time, 90 minutes later, and one day later. The selected story keeps its anchor across beat replay and autoplay. Omit the field when a beat should preserve the current simulation time. This changes the propagated view; it does not turn the installed catalog into historical telemetry.
- **`orbitCatalogId`** — draws one installed object's propagated orbit line for a sparse chapter subject, then clears it on the next beat or when Story mode closes. Use a stable numeric catalog id and explain that the line is a current GP propagation, not a historical path.
- **`orbitCatalogIds`** — draws 1–12 unique installed-object orbit lines when a chapter needs representative paths for several planes or subjects. Values use the same strict numeric catalog-id format as `orbitCatalogId`; if both fields are present, SatGlobe draws the de-duplicated union after clearing the preceding beat's lines. Explain what the selected paths represent and do not claim that dots or static lines alone prove historical motion or sourced geometry.
- **`filterOverrides`** — only `objectKinds`, `status`, `regimes` may be overridden; everything else stays at the defaults. The default view is *active payloads in all regimes*, so chapters about debris or retired satellites must override.
- **`reconstruction`** — `'reconstructed'` marks a chapter as illustrative of history (badge reads RECONSTRUCTED); `'observed'` means the chapter shows the installed catalog as-is. **Convention: the final beat is always `'observed'`** — end on what's real and current. The library test enforces this.
- **Keep runtime work bounded.** Manifests are static data and beat changes use the existing filter/recolor, camera, and time seams. Do not add per-frame story work.

## Checklist for a new story

1. Create `src/satglobe/stories/<id>.ts` exporting a parsed manifest (copy an existing story as the template — `geo-belt.ts` is the shortest).
2. Verify each source URL; set `retrievedAt` to today.
3. Capture real camera poses from the running app (`npm run start:satglobe`, position, console).
4. Add the story to `src/satglobe/stories/index.ts` in its presentation slot.
5. `npx vitest run src/satglobe/domain/__tests__/story.test.ts` — the library test validates parsing, story/source/fact/beat id uniqueness, strict fields, override keys, and the observed ending.
6. Run `npm run verify:stories`. The runner itself always creates a fresh production SatGlobe profile (including when invoked directly with `npx tsx scripts/satglobe/verify-stories.ts`), starts its static server, and opens headed Chromium at 1440×900. It stops propagation at playback rate `0`, fixes simulation time to the installed catalog's `newestElementEpoch` before Story opens, resets every story to that same anchor, and semantically checks each beat's filters, encoding, actual camera pose, and fixed time. It honors the app's reduced-motion path, waits for document animations to settle, and writes fixed 1440×900 viewport screenshots plus `manifest.json` under the ignored `test-results/satglobe-story-shots/<run-key>/` directory. Clean keys use `<git-sha>-<UTC-run-id>` and dirty keys use `<git-sha>-dirty-<UTC-run-id>`; the UTC id contains both a timestamp and UUID, and the runner refuses to reuse an existing run directory. The manifest separately records the anchor, the complete fresh production-tree SHA-256 identity, an HTTP-root checksum proven byte-equal to `dist/index.html`, and the SHA-256 checksum of every screenshot.
7. Review every generated image, not only the passing manifest. Confirm that the subject is visible and the scene supports the narration. Use `SATGLOBE_STORY_HEADLESS=1` only for non-interactive automation. `SATGLOBE_STORY_OUTPUT_DIR` changes the artifact root. Durable evidence must use the production-static server started and owned by the walker; custom `SATGLOBE_STORY_URL` targets and `SATGLOBE_STORY_START_SERVER=0` are rejected because their bytes cannot be tied to this run. If another process already owns the audit port, stop it and rerun. A successful manifest fetches the owned HTTP root before capture and again after the walk, byte-compares it with `dist/index.html` both times, and keeps that entry-point evidence distinct from the full local production-tree digest. A failed manifest records its exact phase, error stack, page errors, and available engine/DOM state.

Eight stories ship today: `starlink-buildout`, `launch-to-orbit`, `iss-assembly`, `one-day-in-orbit`, `gps-constellation`, `fengyun-asat`, `cosmos-iridium`, and `geo-belt`.
