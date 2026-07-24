# SatGlobe roadmap and recovery ledger

Last updated: 2026-07-24T05:56:42Z

This file is the durable product roadmap and the live ledger for the approved
legacy-work recovery. It is intentionally Markdown so every decision, test
result, and disposition is reviewable in Git.

## Status vocabulary

Ledger entries use only `Pending`, `In progress`, `Ported`, `Verified`,
`Superseded`, `Deferred`, or `Blocked`.

## North star

SatGlobe is a factual orbital atlas that moves continuously between:

1. **Planetarium** — a calm, beautiful living globe that invites discovery.
2. **Workshop** — precise search, filters, inspection, time, provenance, and
   visual encoding.
3. **Story** — sourced launch and constellation narratives that remain
   explorable.

Public GP/SGP4 positions are predictions, historical reconstruction is
disclosed, semantic scale is disclosed, and the browser runtime remains
offline. The recovery must deepen the proven Earth-orbit product rather than
bypassing its typed engine boundary or jumping to cislunar scope.

## Recovery objective and stop condition

The recovery starts from exact `origin/main` commit
`7c67dd20050481e3b1b3b5cbb26e2a298526679d`. It will preserve the old work,
close obsolete pull requests without merging them, manually forward-port the
valuable behavior, and present one reviewable replacement pull request.

The stop condition is a non-draft replacement PR that is current with `main`,
conflict-free, green in required CI and CodeQL, free of attributable new Sonar
findings and unresolved review threads, and fully mapped in this ledger. That
PR must not be merged without separate approval.

Draft replacement PR
[#84](https://github.com/jtn0123/SatGlobe/pull/84) was opened from
`codex/satglobe-consolidated-recovery` at 2026-07-24T04:39:46Z. It remains
draft while the last recovery lane and mergeability gates are in progress.

## Verified starting point

At `7c67dd20050481e3b1b3b5cbb26e2a298526679d`:

- The bundled catalog contains 35,049 objects.
- The library contains eight sourced stories and 39 beats.
- Workshop, Present, and Story modes share one offline WebGL runtime.
- Saved views, close-approach screening, search, filters, time controls, and
  six encodings are present.
- Manifest schema v1 incorrectly uses refresh time as the effective element
  epoch and reports 7,591 misleading `Epoch regression` rejections.
- The production dependency audit is clean, but the source still includes the
  eval-generating `numeric` package and SatGlobe permits `'unsafe-eval'`.

## Preservation ledger

All entries below were verified at 2026-07-24T03:53:47Z before source changes.

| Preserved source | Exact object | Archive ref or artifact | Status |
| --- | --- | --- | --- |
| Catalog/story stack through PR #58 | `db4b97ecc8e15d855ed7f4e5c677a76cf907a888` | `refs/archive/satglobe/2026-07-23/catalog-story` | Verified |
| Security stack through PR #57 | `fc467f61126624105d908845695d40642541ebb8` | `refs/archive/satglobe/2026-07-23/security` | Verified |
| Product stack through PR #62 | `f890e2b8c4ab95633b813472674b40a0c5fc7ba4` | `refs/archive/satglobe/2026-07-23/product` | Verified |
| Dependency stack through PR #68 | `cd1760824b53341f876517bed1b925c43fe26ec3` | `refs/archive/satglobe/2026-07-23/dependencies` | Verified |
| First-play branch | `e456209a5510d45e98c873bcf23bfc5e2bc8d55c` | `refs/archive/satglobe/2026-07-23/first-play` | Verified |
| Geometry cleanup | `8f901564bb124f885a59c80d7db4f1f5bf02b05e` | `refs/archive/satglobe/2026-07-23/geometry` | Deferred |
| Dirty guided-Story worktree | base `49851ea72e310035301bad857a0c704ba76ff185` | archive commit `2abf8529b9731e765970f64e5b1ad10e2b2c5547` | Verified |
| Dirty guided-Story patch | nine modified paths | `.git/recovery/2026-07-23/guided-story.patch`; SHA-256 `5cb03505bb7c1d2443f53213e4f177f64fa1448adb5f9bc2a102f4f2911ced25`; 19,256 bytes | Verified |
| Corrected catalog LFS object | 21,406,172 bytes | SHA-256 `9fae7a2fa46004ae13fa863890547f9947036bfcfe8357ef9a7d67bbf6076a1b` | Verified |

The original first-play and dirty guided-Story worktrees remain untouched
until their selected behavior has a tested replacement.

A later cleanup audit found the independent local branch
`codex/sonar-cleanup-01` at
`6342805149f6830e65a471215ff2533c9e1d73bc`. Its two unique Sonar inventory and
policy commits are outside the approved consolidation scope; they will receive
an exact archive ref and remain `Deferred`, not be deleted as part of a batch.

## Legacy PR disposition

PRs #51–#68 were closed without merging at 2026-07-24T03:59:26Z after each
received a preservation and disposition comment. GitHub was then re-queried:
zero PRs remained open and all 18 closed heads still matched the recorded
objects below.

| PR | Head SHA | Planned disposition | Status |
| --- | --- | --- | --- |
| #51 | `ca60edf50f3a97f5a82092f535db6495cb440994` | Port stability gates, atomic visual state, trusted timing, CI flake policy, and justified coverage | Verified |
| #52 | `7134d9fd581bf5fe9312b22762e4e57a55c9fb5e` | Port typed linear algebra and remove `numeric` | Verified |
| #53 | `37161ae8509ec9f67abd5d0660bdf25c7f1f44dc` | Port local view playlists | Verified |
| #54 | `087c7884442912cc5aa275f1efd9f120e82e3094` | Port pure-SGP4/WASM profile gating | Verified |
| #55 | `d452bde92d34a7fbd98ce69558b531d388408f62` | Port catalog provenance schema and UTC invariants | Verified |
| #56 | `908f3c83cba4366f3af825ea79a7d1c5a0b773b2` | Reproduce and verify the six corrected catalog artifacts | Verified |
| #57 | `fc467f61126624105d908845695d40642541ebb8` | Port strict CSP and emitted-script inspection | Verified |
| #58 | `db4b97ecc8e15d855ed7f4e5c677a76cf907a888` | Port GNSS and Landsat stories after source/ID verification | Verified |
| #59 | `3af7f2b6e96f52151e980994339197b33b9093f2` | Replace with a fresh audit from current main | Deferred |
| #60 | `9bb7d3fff13be46c9e625bf04a706656df583307` | Port cumulative launch-history time-lapse | Verified |
| #61 | `30dad92dd6796b059380a40ba7add2b05b91e20c` | Replace with a fresh audit from current main | Deferred |
| #62 | `f890e2b8c4ab95633b813472674b40a0c5fc7ba4` | Port one-request WebGL-frame PNG capture | Verified |
| #63 | `b36d7bff5a59307b1733faac0445148f16695426` | Replace with a fresh audit from current main | Deferred |
| #64 | `92362bbbb2f8f32347d8d48a335b99c75f864c94` | Replace with a fresh audit from current main | Deferred |
| #65 | `4d90ed33689f20df2929ba8183d1be47b55ce8d1` | Replace with a fresh audit from current main | Deferred |
| #66 | `2cedfc9daca3a838776487c641c99c32b6fb6839` | Replace with a fresh audit from current main | Deferred |
| #67 | `bf1e9c359c35a6e6e23e64b22343cb9f706ae004` | Replace with a fresh audit from current main | Deferred |
| #68 | `cd1760824b53341f876517bed1b925c43fe26ec3` | Replace with a fresh audit from current main | Deferred |

## Worktree and branch ledger

| Location or branch set | Purpose | Status |
| --- | --- | --- |
| `/Users/justin/.codex/worktrees/satglobe-recovery/SatGlobe` | Clean consolidation branch from exact current main | Verified |
| `origin/codex/satglobe-consolidated-recovery` / draft PR #84 | Published replacement branch and GitHub review surface | In progress |
| Seven `codex/recovery-*` lane worktrees | Replacement commits are verified; exact lane-tip archive refs are required before Git-native removal | In progress |
| `/Users/justin/Documents/SatGlobe` | First-play replacement verified; generated Husky dirt only; archive and checkout cleanup pending | In progress |
| `.claude/worktrees/app-roadmap-performance-0642ff` | Guided replacement verified; saved patch still matches the dirty worktree; Git-native removal pending | In progress |
| `codex/sonar-cleanup-01` | Two unique Sonar inventory/policy commits discovered during cleanup; preserve separately and exclude from PR #84 | Deferred |
| `.codex/worktrees/7414/SatGlobe` | Removed with Git after confirming clean exact commit; archive ref retained | Verified |
| 33 clean local ancestors of main | Deleted non-forcibly from a current-main descendant after exact live recheck | Verified |
| Six remote heads for merged PRs #24–#27, #69, and #70 | Deleted after GitHub state/name/SHA recheck | Verified |

No branch may be deleted unless its recorded object is unchanged, it is not
attached to a worktree, it has no dirty or untracked content, and it remains
reachable from `main`, an archive ref, or a verified replacement commit.

## Ordered recovery checklist

- [x] `Verified` — Refresh main, PR, branch, worktree, CI, and catalog state.
- [x] `Verified` — Create archive refs and a binary-safe guided-Story patch.
- [x] `Verified` — Create the clean recovery worktree from exact `origin/main`.
- [x] `Verified` — Establish clean current-main unit, E2E, OOTK, story, build,
  and production-audit baselines.
- [x] `Verified` — Close legacy PRs #51–#68 without merging and record closure.
- [x] `Verified` — Remove only reverified safe branches and the archived clean
  geometry worktree.
- [ ] `In progress` — Recovery ledger and current handoff.
- [x] `Ported` — Stability and atomic visual state from #51, including Story
  beat filter/encoding application through the same transaction.
- [x] `Verified` — Typed eval-free numeric replacement from #52.
- [x] `Verified` — Pure-SGP4/WASM profile gating from #54, including explicit
  per-worker Az/Range fleet activation.
- [x] `Verified` — Strict CSP and emitted-script inspection from #57, including
  escaped/aliased global eval and locally shadowed safe names.
- [x] `Verified` — Catalog provenance schema v2 from #55, including
  pre-install catalog/feed/manifest coherence and deterministic large-fixture
  validation.
- [x] `Verified` — Corrected catalog transaction from #56.
- [x] `Verified` — GNSS and Landsat stories from #58, including a live official
  UNOOSA replacement for the retired GLONASS source and the full visual story
  walk.
- [x] `Verified` — View playlists from #53, including production-static E2E.
- [x] `Verified` — Launch-history time-lapse from #60, including
  production-static E2E.
- [x] `Verified` — Guided-Story worktree recovery, production-static E2E, and
  the full visual story walk.
- [x] `Verified` — Canvas snapshot export from #62, including decoded
  full-resolution runtime export E2E.
- [x] `Verified` — Selective renderer-consistent legend and Starlink cohort
  recovery, including production-static desktop E2E.
- [x] `Verified` — Current performance governance and final documentation,
  including a truthful five-sample benchmark and two-minute hardware soak.
- [x] `Verified` — Open replacement draft PR #84 and link it from every closed
  PR #51–#68.
- [ ] `Pending` — Integrate latest main, satisfy all mergeability gates, mark
  the PR ready, and stop before merge.

## Replacement commit ledger

| Legacy source | Consolidated replacement | Included behavior | Status |
| --- | --- | --- | --- |
| PR #51 | `dd8d0816`, `14f8fa8b` | Transactional visual updates across Workshop, Present, playlists, launch history, and Story; resilient timing; corrected Dependabot targets; CI flake policy; and test-backed coverage ratchet | Ported |
| PR #52 | `ae2c94e3`, `712af510` | Typed finite-safe vector/matrix helpers, migrated callers, and complete removal of `numeric`, its types, and `_numeric` | Verified |
| PR #54 | `0a3fae26`, `ae12b02f`, `a193a9b8`, `66fa6c27` | Typed propagator facade, nine worker gates including the Az/Range fleet, recursive whole-output WASM-glue policy, and build-policy errors | Verified |
| PR #57 | `9fa11775`, `8d5f2981`, `39ae5981` | SatGlobe-only Zod jitless mode, eval-free OBJ alias, scope-aware AST emitted-script guard, and exact strict CSP | Verified |
| PR #55 | `bb834479`, `2a300cf6`, `8813cf38` | Strict v1/v2 parsing with v2-only installation, v2 time provenance, UTC epoch handling, candidate catalog/feed/manifest coherence, deterministic large-artifact validation, and offline fallback | Verified |
| PR #56 | `e342cd7b` | Exact six-artifact transaction: schema v2, 35,049 objects, zero rejects, and catalog SHA-256 `9fae7a2fa46004ae13fa863890547f9947036bfcfe8357ef9a7d67bbf6076a1b` | Verified |
| PR #58 | `ad07e829`, `497e030f` | GNSS-family and Landsat-continuity manifests, verified representative IDs, and current official sources; library now ten stories / 51 beats | Verified |
| PR #53 | `616dc0d0`, `bf27732c` | Strict 2–24-entry local playlists, atomic import/export, persistence, editing/reorder/delete, Present playback, reduced-motion behavior, and cleanup when Presentation ends | Verified |
| PR #60 | `8df5c429` | Strict cumulative launch-year filtering, decade stops, atomic application, autoplay, and shared reactive reduced-motion handling | Verified |
| Guided-Story patch `5cb03505…` | `413add27`, `f53bb34d`, `2c5554be` | Bounded deterministic orbit cues, Story-only 60× time, complete 1× cleanup, layered Escape, source reset on pause/completion, native citation-link keyboard behavior, and one-second reduced-motion progress | Verified |
| PR #62 | `a620e5ec` | One-pending-request next-frame WebGL capture and full-resolution canvas-only PNG download with failure cleanup | Verified |
| First-play branch `e456209a` | `40f7726f`, `18762641`, `f391d306` | Shared launch-designator normalization and renderer color definitions, complete counted live legend including unknown cohorts, close-approach key, snapshot-aware searchable/year-filtered Starlink cohort exploration, and unchanged saved-view v1 | Verified |
| Archived performance policy | `d9fb8075`, `a0256455`, `ce2176ec`, `b1e37273` | Seven requested commands, immutable-record validation, five-sample benchmark, two-minute soak, truthful interaction gates, work-split runtime behavior, serialization-safe soak runner, current build budgets, empty honest current-app ledger, and historical-only archived M4 claims | Verified |

## Validation ledger

| UTC time | Source SHA | Command or check | Result | Evidence |
| --- | --- | --- | --- | --- |
| 2026-07-24T03:16:00Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | `npm ci` | Verified | 960 packages installed; generated locale files required next |
| 2026-07-24T03:20:00Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | `npm run generate-t7e` then `npm run verify:satglobe` | Verified | 23 files / 243 tests; production build passed |
| 2026-07-24T03:29:00Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | `npm run test:e2e:satglobe` | Blocked | Cold watch-server readiness race: 6 failed, 4 passed; known configuration behavior |
| 2026-07-24T03:32:00Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | `CI=true npm run test:e2e:satglobe` | Verified | Static production profile: 10/10 journeys passed |
| 2026-07-24T03:35:00Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | `npm run test:ootk` | Verified | 124 passed, 1 skipped files; 1,981 passed, 21 skipped tests |
| 2026-07-24T03:53:47Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | `SATGLOBE_STORY_HEADLESS=1 npm run verify:stories` | Verified | Eight stories / 39 beats; `test-results/satglobe-story-shots/7c67dd200504-20260724T034238908Z-10f5fafe-3103-45d6-87c3-7fa4a97bfa54/manifest.json` |
| 2026-07-24T03:49:00Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | `npm audit --omit=dev` | Verified | 0 production vulnerabilities across 36 production dependencies |
| 2026-07-24T03:59:26Z | `1b99e255` | GitHub PR #51–#68 preservation comments, close operations, and live re-query | Verified | Zero open PRs; 18 closed PR head SHAs exactly matched this ledger |
| 2026-07-24T04:03:37Z | `17dd31fc` | Remote/local branch and geometry-worktree cleanup | Verified | Six merged remote heads and 33 main-ancestor local heads removed; geometry remains at archive ref `8f901564` |
| 2026-07-24T04:10:09Z | `8d5f29813b440b6e2ac69f0f257d0ae8991a52af` | Focused numeric, caller, propagator-profile, bundle-policy, CSP, and Zod tests | Verified | Eight files / 85 tests passed after integration |
| 2026-07-24T04:12:32Z | `ad07e829e97c86fd0e087e4627fb92cdd9ad57ae` | Catalog artifact inspection and focused catalog/cache/story/UI tests | Verified | Seven files / 85 tests; LFS pointer and 21,406,172-byte content match SHA-256 `9fae7a2f…`; schema v2, 35,049 rows, zero rejects |
| 2026-07-24T04:19:12Z | `a620e5ecedf6ac97d65dba83312ab006150f3ba9` | `npm run test:satglobe -- --maxWorkers=1` | Verified | 35 files / 338 tests passed on the combined security, catalog, playlist, launch, Story, and snapshot tree |
| 2026-07-24T04:21:25Z | `7b517fd0` | Independent security and catalog lane review | Blocked | Az/Range WASM activation, eval scanner coverage/scope, pre-install cross-artifact coherence, deterministic catalog test clock, strict installed-v2 test, and dead GNSS source require focused fixes |
| 2026-07-24T04:27:27Z | `39ae5981c163ec74117c696bbffaadc82b1eb83f` | Focused security-review regression suite | Verified | Three files / 27 tests passed: Az/Range fleet activation, base worker configuration, and scope-aware emitted-eval policy |
| 2026-07-24T04:36:12Z | `14f8fa8b` | `npx vitest run src/satglobe/app/__tests__/satglobe-app.test.tsx --maxWorkers=1` | Verified | One file / 41 tests; Story navigation now proves one `setVisualState` call and no separate filter or encoding mutation |
| 2026-07-24T04:37:10Z | `92abb7c1` | TopBar snapshot fixture test and `npm run typecheck:satglobe-strict` | Verified | Two focused tests passed; strict SatGlobe typecheck passed with 1,901 inherited engine-import diagnostics filtered |
| 2026-07-24T04:38:22Z | `497e030f` | Catalog, conjunction, and Story-source regression suites | Verified | Three files / 65 tests passed; candidate artifacts are bound before install and the live official UNOOSA GLONASS source is pinned by regression |
| 2026-07-24T04:39:46Z | `ecf5980a` | Push consolidated branch and open draft replacement PR #84 | Verified | GitHub created `https://github.com/jtn0123/SatGlobe/pull/84` against `main`; draft remained unmergeable while recovery gates are open |
| 2026-07-24T04:41:27Z | `ecf5980a` | Add replacement follow-up to closed PRs #51–#68 | Verified | GitHub accepted one #84 link comment on each of all 18 preserved legacy PR conversations |
| 2026-07-24T04:43:30Z | `40f7726f` | Eight legend, cohort, renderer-color, and integrated app suites plus strict SatGlobe typecheck | Verified | Eight files / 92 tests passed; strict typecheck passed with the inherited engine-import diagnostic filter only |
| 2026-07-24T04:51:00Z | `b76a50a1` | SonarCloud PR #84 quality gate | Blocked | Reliability rating D from two new TypeScript S2871 findings: implicit string sorts in launch-year and source-label lists |
| 2026-07-24T04:53:52Z | `45391d1b` | Explicit locale-aware sorting and focused launch explorer/cohort suites | Verified | Both Sonar findings fixed; two files / five tests passed; GitHub rescan remains pending |
| 2026-07-24T04:53:28Z | `b76a50a1` | GitHub SatGlobe CI run `30067557968` | Blocked | Coverage, typecheck/lint/build, OOTK, CodeQL, and benchmark passed; offline E2E reported 13 passed plus one retry caused by a sub-pixel camera-settling assertion |
| 2026-07-24T04:57:31Z | `ed26cf66` | E2E failure-log diagnosis and camera-stability assertion repair | Ported | Selection still must preserve camera intent; the test now waits for preceding easing to settle and tolerates only sub-pixel normalized drift. Final static E2E/CI rerun pending |
| 2026-07-24T04:57:44Z | `52163e42` | Independent integrated product review | Verified | Reproduced and fixed stale playlist resurrection, Story Sources persistence after stop, unknown-cohort legend omission, and stale same-count snapshot cohorts; 17 focused files / 143 tests plus strict/normal typecheck and lint passed in isolation |
| 2026-07-24T04:57:58Z | `b7080695` | Performance governance validation | Verified | Four contract tests, 360 SatGlobe tests, TypeScript, strict typecheck, lint, production build, 352.0 MiB/12.8 MiB build budget, and empty-ledger validation passed; one-sample smoke was correctly rejected as evidence |
| 2026-07-24T05:01:39Z | `d9fb8075` | `npm run test:satglobe -- --maxWorkers=1` on the consolidated head | Verified | 41 files / 365 tests passed, including catalog, stories, product review fixes, security policy, and performance contracts |
| 2026-07-24T05:02:52Z | `2c5554be` | Sources-link keyboard regression suite | Verified | Integrated app file / 42 tests passed; Space on a focused citation link no longer bubbles into global Story playback |
| 2026-07-24T05:04:40Z | `73acefe3` | `npm run verify:satglobe` | Verified | Normal and strict typecheck, story-walker boundary, full lint, 41 files / 366 tests, performance-ledger validation, production build, emitted-script policy, and 351.9 MiB/12.8 MiB build budget passed |
| 2026-07-24T05:06:49Z | `73acefe3` | `CI=true npm run test:e2e:satglobe` | Verified | All 14 production-static offline Chromium journeys passed in 2.1 minutes with fail-on-flake enabled and no retry |
| 2026-07-24T05:07:31Z | `45490afb` | `npm run test:ootk` | Verified | 124 passed / one skipped files; 1,981 passed / 21 skipped tests |
| 2026-07-24T05:10:12Z | `45490afb` | `CI=true npm test` | Verified | 446 files / 5,904 passed, eight skipped, and one todo |
| 2026-07-24T05:10:20Z | `45490afb` | Production audit, performance-ledger validation, build-budget check, and `git diff --check` | Verified | Zero production vulnerabilities; zero-record/two-profile ledger valid; 351.9 MiB dist and 12.8 MiB JavaScript within budget; clean diff check |
| 2026-07-24T05:12:18Z | `45490afb` | Five-sample Apple M4 1440p hardware benchmark | Blocked | Raw report `benchmark-results/satglobe/2026-07-24T05-11-02Z.raw.json` incorrectly declared success while Starlink/conjunction long-task p95 values of 65/63 ms exceeded the governed 50 ms budget |
| 2026-07-24T05:15:12Z | `a0256455` | Long-task gate and live-legend work-splitting regressions | Ported | Threshold legends skip catalog scans; highlight-only changes reuse the base legend; benchmark now enforces interaction long tasks. Three files / ten tests, strict typecheck, focused lint, and diff check passed; hardware rerun pending |
| 2026-07-24T05:17:32Z | `bcda9acf` | Corrected five-sample Apple M4 1440p hardware benchmark | Blocked | Truthful raw report `benchmark-results/satglobe/2026-07-24T05-16-20Z.raw.json` failed: Starlink/conjunction longest-task p95 measured 57/67 ms against the unchanged 50 ms budget |
| 2026-07-24T05:19:35Z | `ce2176ec` | Split synchronous renderer work from React-state publication | Ported | Engine transactions remain synchronous and atomic while shell mirroring becomes transition work in a separate browser task; three files / 50 tests, strict typecheck, focused lint, and diff check passed; hardware rerun pending |
| 2026-07-24T05:20:49Z | `8b9bf031` | Five-sample Apple M4 1440p hardware benchmark | Verified | Raw report `benchmark-results/satglobe/2026-07-24T05-20-49Z.raw.json`: hardware renderer, 59.88 median FPS, 17.6 ms frame p95, zero interaction long tasks, Starlink/conjunction response p95 58.8/60.6 ms, playlist/launch apply p95 39.9/45.8 ms, zero paused churn, one atomic filter/recolor/count pass, and zero runtime errors |
| 2026-07-24T05:23:00Z | `8b9bf031` | Initial governed two-minute soak invocation | Blocked | The runner failed before measurement because its TypeScript keep-names transform injected an unavailable `__name` helper into the Playwright-serialized page callback |
| 2026-07-24T05:24:19Z | `b1e37273` (report base `8b9bf031`) | One-second hardware soak callback smoke | Verified | Raw dirty-worktree report `benchmark-results/satglobe/2026-07-24T05-24-19Z.raw.json` exercised the exact callback committed in `b1e37273`: 1.011 seconds, 61 frames, 59.88 FPS, 17.4 ms frame p95, zero slow frames/long tasks/context loss/runtime errors; the run was correctly rejected only because one fresh page is below the five-sample evidence minimum |
| 2026-07-24T05:26:08Z | `b1e37273` | Serialize the governed soak callback as browser-native source | Verified | Normal TypeScript, focused lint, diff check, the one-second callback smoke, and the subsequent governed two-minute hardware soak all passed |
| 2026-07-24T05:27:32Z | `9c650030` | `npm run benchmark:satglobe:soak` | Verified | Raw report `benchmark-results/satglobe/2026-07-24T05-27-32Z.raw.json`: five fresh pages plus 120.006 seconds of Story, 7,201 frames, 59.88 median FPS, 17.6 ms frame p95, zero slow frames/long tasks/context loss/runtime errors, and heap ended 47,705,387 bytes below its start |
| 2026-07-24T05:31:40Z | `e287a469` | Remaining live Sonar issue inspection and focused repair | Verified | Replaced the flagged 32-bit range literal with `2 ** 32`, consolidated the duplicate visually-hidden selector, and passed three launch-designator/cohort/color files with 19 tests, focused lint, and `git diff --check`; the GitHub rescan remains pending |
| 2026-07-24T05:47:08Z | `c99ce10e` | `SATGLOBE_STORY_HEADLESS=1 npm run verify:stories` | Verified | Fresh production build captured all ten stories / 51 beats without a semantic or runtime failure; manifest `test-results/satglobe-story-shots/c99ce10e828e-20260724T053234041Z-edddb937-3e83-4827-9901-292928a476eb/manifest.json` |
| 2026-07-24T05:49:15Z | `0b985244` | `npm run verify:satglobe` | Verified | Normal and strict typecheck, story-walker boundary, full lint, 41 files / 368 tests, performance-ledger validation, production build, emitted-script policy, and 351.9 MiB/12.8 MiB build budget passed |
| 2026-07-24T05:52:42Z | `0b985244` | `CI=true npm run test:e2e:satglobe` | Blocked | 13 journeys passed; launch-history monotonicity read the intentionally transitioned React count before it settled after the synchronous engine transaction, and the retry also failed, so fail-on-flake correctly kept the gate red |
| 2026-07-24T05:53:47Z | `7bb6dca3` | Launch-history settled-state E2E repeated without retries | Verified | The test now waits for both the selected timeline year and the unchanged monotonic count contract. `--repeat-each=3 --retries=0` passed all three runs in 38.9 seconds; the complete production-static E2E rerun remains pending |
| 2026-07-24T05:56:42Z | `07d0d73b` | `CI=true npm run test:e2e:satglobe` | Verified | All 14 production-static offline Chromium journeys passed in 2.0 minutes with fail-on-flake enabled and no retry |

Every later validation entry must identify the exact tested commit. Raw
benchmark and story artifacts remain ignored; governed evidence is committed
only through its policy-defined ledger.

## Public contracts in this recovery

The replacement PR may add the transactional `SatGlobeVisualStateUpdate` and
`SatGlobeEngineAdapter.setVisualState()`, typed propagator selection, manifest
schema v2, portable `PlaylistV1`, cumulative `launchYearMax`, bounded
`StoryBeat.orbitMatchLimit`, one-shot renderer capture, and renderer-derived
legend/cohort models. Saved-view schema v1 remains unchanged.

No backend, account, analytics, remote runtime catalog, cloud storage,
executable imported content, or required WebGPU path is introduced.

## Decision log

| UTC time | Source SHA | Decision | Status |
| --- | --- | --- | --- |
| 2026-07-24T03:53:47Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | Use this Markdown file as the sole tracker; no HTML duplicate | Verified |
| 2026-07-24T03:53:47Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | Forward-port selected behavior manually; do not merge the obsolete DAG wholesale | Verified |
| 2026-07-24T03:53:47Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | Preserve old performance records as history but generate fresh evidence | Verified |
| 2026-07-24T03:53:47Z | `7c67dd20050481e3b1b3b5cbb26e2a298526679d` | Keep geometry, dependency upgrades, saved-view v2, and broad future scope out of this PR | Deferred |
| 2026-07-24T03:59:26Z | `1b99e255` | Close #51–#68 without merging after confirming every head remained archived | Verified |
| 2026-07-24T04:03:37Z | `17dd31fc` | Use non-force local deletion from the current-main recovery worktree; use Git double-force only for the clean archived geometry worktree blocked by its registered uninitialized submodule | Verified |
| 2026-07-24T04:36:12Z | `14f8fa8b` | Route Story beat filters and encoding through the transactional adapter boundary so authored playback cannot publish an intermediate visual state | Verified |
| 2026-07-24T04:38:22Z | `497e030f` | Reject catalog transactions before installation unless manifest, catalog, and conjunction-feed provenance agree; replace the retired GLONASS citation with the current official UNOOSA publication | Verified |
| 2026-07-24T04:39:46Z | `ecf5980a` | Publish the consolidated branch as draft PR #84 so CI and review can run before final readiness; draft status does not authorize merge | In progress |
| 2026-07-24T04:43:30Z | `40f7726f` | Recover only first-play legend/cohort behavior that fits the current typed boundary; keep transient explorer state out of portable saved-view schema v1 | Ported |
| 2026-07-24T04:53:52Z | `45391d1b` | Treat Sonar's two new implicit-sort reliability findings as attributable blockers and replace them with explicit locale-aware ordering | Verified |
| 2026-07-24T04:57:31Z | `ed26cf66` | Keep CI's fail-on-flake policy; fix the unstable camera assertion by measuring settled product behavior rather than weakening or disabling the gate | Ported |
| 2026-07-24T05:01:39Z | `d9fb8075` | Accept the independent product review's four reproduced lifecycle/data-truth fixes and initialize performance governance with zero accepted current records until fresh measurements pass policy | Verified |
| 2026-07-24T05:15:12Z | `a0256455` | Do not accept a raw report whose normal interactions exceed the declared long-task budget; split live-legend work away from renderer transactions instead of weakening the 50 ms policy | Ported |
| 2026-07-24T05:19:35Z | `ce2176ec` | Preserve synchronous atomic renderer semantics but publish React mirrors as transitions so the two workloads cannot form one browser long task | Ported |
| 2026-07-24T05:26:08Z | `b1e37273` | Keep the soak callback browser-native so Playwright cannot serialize TypeScript runner helpers that do not exist in the measured page | Verified |
| 2026-07-24T05:31:40Z | `e287a469` | Treat all four attributable Sonar findings as mergeability blockers, including the numeric-grouping and duplicate-selector findings exposed after the initial sort repairs | Verified |
| 2026-07-24T05:53:47Z | `7bb6dca3` | Keep the launch-history monotonicity assertion and wait for the transitioned count to settle; do not disable CI retries or weaken the product invariant | Verified |

## After the recovery gate

Only after the replacement PR is mergeable and separately approved:

1. Audit dependencies from current main rather than reviving #59/#61/#63–#68.
2. Reassess the archived geometry cleanup as a small independent change.
3. Visually direct all ten stories at 1280×720 and 1440p.
4. Add a date-labelled narrative timeline and one sourced archival-keyframe
   story.
5. Improve active-filter explanation and saved-view management.
6. Finish accessibility, projector readability, install verification, current
   performance records, and a versioned static alpha artifact.

Cislunar/Lagrange views, phone-first layouts, accounts, cloud sync,
collaboration, desktop wrappers, arbitrary-date reconstruction, and saved-view
schema v2 remain outside this recovery.
