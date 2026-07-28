# ADR 0004: Separate deterministic gates from hardware evidence

- Status: accepted
- Date: 2026-07-23

## Context

SatGlobe has dated performance measurements and an archived first-play benchmark design, but the product has since combined story, playlist, launch-history, snapshot, and exploration behavior. Reusing an older Apple M4 number as the current baseline would claim evidence for code that was not actually measured.

Hosted CI also runs Chromium through a software renderer. That environment is useful for schemas and deterministic behavior but is not comparable with a physical GPU.

## Decision

- Version the raw report, analyzer, gate, policy, and machine-profile contracts.
- Start the combined application's accepted-record ledger empty. Do not import archived first-play results as current evidence.
- Require at least five fresh-page samples for an accepted normal run and a two-minute story-state soak for sustained-stability evidence.
- Keep raw reports ignored and commit compact records only for meaningful renderer, engine, catalog/browser baseline, or release milestones.
- Compare only compatible hardware, viewport, render scale, renderer, browser major, analyzer major, gate version, and catalog populations.
- Warn above a 10% comparable regression. A regression above 20% needs a second independent report for the same clean commit and catalog plus written justification.
- Reject absolute-budget, runtime-error, context-loss, profile, dirty-tree, headless, or software-renderer violations before a record can be accepted.
- Treat accepted records as immutable. Add a superseding record; CI checks that records present on the pull-request base were not changed or deleted.
- Enforce current production-output size, aggregate JavaScript, and per-JavaScript-asset ceilings with `check:build:satglobe`, independently of timing evidence. The whole-output ceiling ratchets the current combined build with limited headroom; it does not silently assume the archived branch's pruned asset layout.

## Consequences

The repository has an honest gap until a fresh current-app hardware run is accepted. That is preferable to a precise-looking but invalid baseline. Timing regressions remain reviewable without making hosted-runner noise a merge gate, while deterministic contracts and the current build-output budgets stay enforceable in CI. Removing inherited media that still ships in the combined production profile is a separate build-profile change, not part of this governance recovery.
