# SatGlobe agent guide

This file applies to the entire repository. It is the compact handoff for an
agent starting without conversation history.

## Read first

1. `README.md` — product intent, current capabilities, setup, and architecture.
2. `ROADMAP.md` — live recovery ledger, product sequence, and deferred scope.
3. `SATGLOBE.md` — operating commands, catalog refresh, tests, and upstream sync.
4. `docs/adr/0001-satglobe-source-fork.md` — architectural boundary.
5. `docs/performance/README.md` when it exists on the active branch and the
   task touches UI, rendering, workers, benchmarks, or performance policy.

## Product north star

Build a beautiful but factual orbital atlas that moves between a calm
planetarium, a powerful workshop, and explorable launch/constellation stories.
Bias toward comprehension and storytelling, not a generic tracker with more
controls.

The roadmap priority is narrative depth and launch timelines on the proven
Earth-orbit foundation. Do not begin cislunar or Lagrange work unless the
roadmap is deliberately changed.

## Non-negotiable truths

- Public GP/SGP4 positions are predictions, not live telemetry.
- Historical motion is `Reconstructed` unless archival elements support it.
- Semantic satellite size and representative substitutions are disclosed.
- Story claims are source-backed.
- Browser runtime is offline: no accounts, backend, analytics, remote catalogs,
  or remote story assets.
- Imported JSON is validated, versioned data and never executable content.
- Catalog identifiers remain strings.
- Accepted performance records are immutable.

## Code ownership boundary

```text
src/satglobe/app       React product UI
src/satglobe/domain    Schemas and pure logic
src/satglobe/engine    Sole KeepTrack/OOTK import boundary
src/satglobe/stories   Validated sourced manifests
scripts/satglobe       Catalog, benchmark, ledger, and build tooling
```

Only `src/satglobe/engine` may import KeepTrack internals. Extend the typed
engine port and adapter instead of reaching into managers from React or domain
code. Keep inherited-file changes minimal and prefer an adapter/profile seam.

## Setup

```bash
git lfs install
npm ci
npm run generate-t7e
npm run start:satglobe
```

The OOTK source under `src/engine/ootk` is vendored in this repository. Do not
initialize the inherited private Pro submodule and do not replace the vendored
tree with an implicit recursive submodule checkout.

Local app: `http://localhost:5544/`

Confirm `public/tle/tle.json` is real LFS content rather than a pointer before
diagnosing an empty scene.

## Working method

1. Inspect `git status`, the branch, worktree attachments, and nearby tests.
2. Preserve unrelated dirty or unpushed work; never clean another worktree by
   assumption.
3. Add or update focused behavior tests with implementation changes.
4. Test real UI behavior near 1280×720 and 2560×1440; include 4K when
   presentation or rendering behavior changes.
5. Run `npm run verify:satglobe` before handoff.
6. Use `CI=true npm run test:e2e:satglobe` for the deterministic static E2E
   profile when UI, adapter, story, filters, views, scale, capture, or offline
   behavior changes.
7. Run `npm run test:ootk` for OOTK compatibility and `CI=true npm test` for
   shared KeepTrack, renderer, worker, build-profile, or upstream-sync changes.
8. Run `SATGLOBE_STORY_HEADLESS=1 npm run verify:stories` for story/library
   changes.
9. Update documentation and an ADR when behavior, commands, data truth,
   security policy, or architecture changes.
10. Update `ROADMAP.md` with the exact tested SHA, UTC time, result, and
    evidence after each logical recovery commit and validation run.

## Recovery and branch safety

- `ROADMAP.md` is the sole recovery tracker.
- Legacy commits are evidence, not a wholesale merge source.
- Before deleting any branch, recheck its exact SHA, worktree attachment,
  dirty/untracked state, and reachability from main, an archive ref, or a
  verified replacement.
- Remove worktrees with `git worktree remove`, then `git worktree prune`.
- Keep archive refs until the consolidated recovery PR is eventually merged.
- A mergeable PR is the stop condition; it is not permission to merge.

## Security and bundle policy

SatGlobe production output must remain offline and compatible with
`script-src 'self' blob:`. Do not introduce eval-like execution, remote script
dependencies, optional WASM glue in the pure-SGP4 profile, executable imports,
or policy exceptions that merely hide a failing bundle inspection.

## Performance rules

- Diagnose with the governed benchmark rather than a single total-ms number.
- Five fresh-page samples are the minimum official hardware record.
- Use a two-minute story soak for sustained stability evidence.
- Raw reports stay ignored; governed records live under
  `docs/performance/records/`.
- Never rewrite an accepted record or weaken a budget to hide a regression.
- WebGL is required cross-platform; WebGPU remains an optional measured
  adapter experiment.

## Current verified baseline

At `7c67dd20050481e3b1b3b5cbb26e2a298526679d` on 2026-07-24:

- focused verification: 23 files / 243 tests and production build passing;
- static Chromium E2E: 10 journeys passing;
- OOTK compatibility: 1,981 passing and 21 skipped tests;
- story verification: eight stories / 39 beats;
- production dependency audit: zero vulnerabilities.

Treat counts and timings as dated evidence. Recheck the active commit rather
than promoting them as permanent facts.

## Definition of done

A change is not done merely because it renders. It must preserve factual and
provenance language, offline runtime behavior, responsive desktop/presentation
composition, the typed boundary, schema validation, deterministic visual
state, relevant tests/build gates, proportional performance evidence, and a
clean intentional diff.
