# SatGlobe roadmap and recovery ledger

Last updated: 2026-07-24T04:27:27Z

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

## Legacy PR disposition

PRs #51–#68 were closed without merging at 2026-07-24T03:59:26Z after each
received a preservation and disposition comment. GitHub was then re-queried:
zero PRs remained open and all 18 closed heads still matched the recorded
objects below.

| PR | Head SHA | Planned disposition | Status |
| --- | --- | --- | --- |
| #51 | `ca60edf50f3a97f5a82092f535db6495cb440994` | Port stability gates, atomic visual state, trusted timing, CI flake policy, and justified coverage | Ported |
| #52 | `7134d9fd581bf5fe9312b22762e4e57a55c9fb5e` | Port typed linear algebra and remove `numeric` | Verified |
| #53 | `37161ae8509ec9f67abd5d0660bdf25c7f1f44dc` | Port local view playlists | Ported |
| #54 | `087c7884442912cc5aa275f1efd9f120e82e3094` | Port pure-SGP4/WASM profile gating | Verified |
| #55 | `d452bde92d34a7fbd98ce69558b531d388408f62` | Port catalog provenance schema and UTC invariants | Blocked |
| #56 | `908f3c83cba4366f3af825ea79a7d1c5a0b773b2` | Reproduce and verify the six corrected catalog artifacts | Verified |
| #57 | `fc467f61126624105d908845695d40642541ebb8` | Port strict CSP and emitted-script inspection | Verified |
| #58 | `db4b97ecc8e15d855ed7f4e5c677a76cf907a888` | Port GNSS and Landsat stories after source/ID verification | Blocked |
| #59 | `3af7f2b6e96f52151e980994339197b33b9093f2` | Replace with a fresh audit from current main | Deferred |
| #60 | `9bb7d3fff13be46c9e625bf04a706656df583307` | Port cumulative launch-history time-lapse | Ported |
| #61 | `30dad92dd6796b059380a40ba7add2b05b91e20c` | Replace with a fresh audit from current main | Deferred |
| #62 | `f890e2b8c4ab95633b813472674b40a0c5fc7ba4` | Port one-request WebGL-frame PNG capture | Ported |
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
| `codex/recovery-security-lane` | Isolated #52/#54/#57 forward-port | In progress |
| `codex/recovery-catalog-lane` | Isolated #55/#56/#58 forward-port | In progress |
| `codex/recovery-product-lane` | Isolated #51/#53/#60/guided/#62 forward-port | In progress |
| `/Users/justin/Documents/SatGlobe` | Archived first-play checkout; generated Husky dirt only | Deferred |
| `.claude/worktrees/app-roadmap-performance-0642ff` | Original dirty guided-Story source | Deferred |
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
- [ ] `Blocked` — Catalog provenance schema v2 from #55: pre-install
  cross-artifact coherence and deterministic test timing are being fixed.
- [x] `Verified` — Corrected catalog transaction from #56.
- [ ] `Blocked` — GNSS and Landsat stories from #58: the dead GLONASS source is
  being replaced before the final full story walk.
- [x] `Ported` — View playlists from #53; runtime E2E is pending.
- [x] `Ported` — Launch-history time-lapse from #60; runtime E2E is pending.
- [x] `Ported` — Guided-Story worktree recovery; runtime E2E and full story
  verification are pending.
- [x] `Ported` — Canvas snapshot export from #62; decoded runtime export E2E
  is pending.
- [ ] `Pending` — Selective legend and Starlink cohort recovery.
- [ ] `Pending` — Current performance governance and final documentation.
- [ ] `Pending` — Open the replacement draft PR and link every closed PR.
- [ ] `Pending` — Integrate latest main, satisfy all mergeability gates, mark
  the PR ready, and stop before merge.

## Replacement commit ledger

| Legacy source | Consolidated replacement | Included behavior | Status |
| --- | --- | --- | --- |
| PR #51 | `dd8d0816`, `14f8fa8b` | Transactional visual updates across Workshop, Present, playlists, launch history, and Story; resilient timing; corrected Dependabot targets; CI flake policy; and test-backed coverage ratchet | Ported |
| PR #52 | `ae2c94e3`, `712af510` | Typed finite-safe vector/matrix helpers, migrated callers, and complete removal of `numeric`, its types, and `_numeric` | Verified |
| PR #54 | `0a3fae26`, `ae12b02f`, `a193a9b8`, `66fa6c27` | Typed propagator facade, nine worker gates including the Az/Range fleet, recursive whole-output WASM-glue policy, and build-policy errors | Verified |
| PR #57 | `9fa11775`, `8d5f2981`, `39ae5981` | SatGlobe-only Zod jitless mode, eval-free OBJ alias, scope-aware AST emitted-script guard, and exact strict CSP | Verified |
| PR #55 | `bb834479`, `2a300cf6` | Strict v1/v2 manifest parsing, v2 time provenance, UTC epoch handling, coherent snapshot/checksum validation, and offline fallback | Blocked |
| PR #56 | `e342cd7b` | Exact six-artifact transaction: schema v2, 35,049 objects, zero rejects, and catalog SHA-256 `9fae7a2fa46004ae13fa863890547f9947036bfcfe8357ef9a7d67bbf6076a1b` | Verified |
| PR #58 | `ad07e829` | GNSS-family and Landsat-continuity manifests; library now ten stories / 51 beats | Blocked |
| PR #53 | `616dc0d0` | Strict 2–24-entry local playlists, atomic import/export, persistence, editing/reorder/delete, Present playback, and reduced-motion behavior | Ported |
| PR #60 | `8df5c429` | Strict cumulative launch-year filtering, decade stops, atomic application, autoplay, and shared reactive reduced-motion handling | Ported |
| Guided-Story patch `5cb03505…` | `413add27` | Bounded deterministic orbit cues, Story-only 60× time, complete 1× cleanup, layered Escape, source reset, and one-second reduced-motion progress | Ported |
| PR #62 | `a620e5ec` | One-pending-request next-frame WebGL capture and full-resolution canvas-only PNG download with failure cleanup | Ported |

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
