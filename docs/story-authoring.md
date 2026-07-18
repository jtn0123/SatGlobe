# Authoring a SatGlobe story

A story is a guided tour of the live orbital scene: a handful of **beats** (chapters), each moving the camera, filters, and color encoding while a caption narrates. Stories are plain TypeScript data — no build step, no editor — validated by a schema at import, so a broken story fails the build and the tests instead of the viewer.

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
- **`encoding`** — one of `object-type`, `orbit-regime`, `launch-cohort`, `orbital-plane`, `data-age`, `starlink`. Pick the encoding that carries the chapter's point (six GPS planes → `orbital-plane`; fragment ages → `data-age`).
- **`constellation`** — a lowercase substring matched against object names (`'navstar'` selects GPS, `'cosmos 2251'` selects that satellite and its named fragments). Leave unset to show everything the filters allow.
- **`filterOverrides`** — only `objectKinds`, `status`, `regimes` may be overridden; everything else stays at the defaults. The default view is *active payloads in all regimes*, so chapters about debris or retired satellites must override.
- **`reconstruction`** — `'reconstructed'` marks a chapter as illustrative of history (badge reads RECONSTRUCTED); `'observed'` means the chapter shows the installed catalog as-is. **Convention: the final beat is always `'observed'`** — end on what's real and current. The library test enforces this.
- **Performance is free.** Stories are static data; beat changes ride the same recolor path as the quick lenses (~70 ms). There is no perf budget to spend here.

## Checklist for a new story

1. Create `src/satglobe/stories/<id>.ts` exporting a parsed manifest (copy an existing story as the template — `geo-belt.ts` is the shortest).
2. Verify each source URL; set `retrievedAt` to today.
3. Capture real camera poses from the running app (`npm run start:satglobe`, position, console).
4. Add the story to `src/satglobe/stories/index.ts` in its presentation slot.
5. `npx vitest run src/satglobe/domain/__tests__/story.test.ts` — the library test validates parsing, unique ids, override keys, and the observed ending.
6. Watch the whole story once in the app (Story mode → picker). Check every beat: does the camera show what the narration says?

Four stories ship today: `starlink-buildout`, `gps-constellation`, `cosmos-iridium`, `geo-belt`.
