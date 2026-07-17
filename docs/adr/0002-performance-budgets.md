# ADR 0002: Performance budgets

- Status: accepted
- Date: 2026-07-17
- Context baseline: SatGlobe at KeepTrack v13.4.0 import (`f06b30bd`) plus the Wave 1 guardrail changes

## Context

A substantial performance effort landed with the v13.4.0 baseline: frustum-culling LOD in the position worker, a color worker, transferable buffers in most workers, per-stage CPU/GPU frame profiling, and lazy plugin chunks. The 2026-07-16 codebase audit found that nothing defended that level — bundle-size warnings were suppressed, the SGP4 benchmark ran only by hand, and neither the full unit suite nor the offline E2E gated merges. Feature work erodes unguarded performance one innocent change at a time.

This ADR defines the budgets SatGlobe holds itself to and how each is enforced. Every feature PR that touches the render loop, the adapter, the color pipeline, catalog loading, or the build should state which of these budgets it affects.

## Budgets

| # | Budget | Target | Enforcement | Baseline (2026-07-17) |
|---|--------|--------|-------------|------------------------|
| 1 | Initial JS bundle | No JS asset or entrypoint over **8 MiB** | `performance.hints: 'error'` in the production build (`build/webpack-manager.ts`) — build fails | `main.js` 7.42 MiB |
| 2 | SGP4 propagation throughput | No sustained regression trend | Report-only CI job uploads `benchmark-results/` per run; convert to a hard threshold after runner baselines accumulate | tracked in CI artifacts |
| 3 | Idle steady-state | **Zero** React re-renders and **zero** full GPU buffer uploads when nothing changes | Manual check with React DevTools Profiler + FrameProfiler until Wave 2 (G4/G5) lands the mechanisms; then E2E-verifiable | Not yet met — adapter emits every 600 ms; full color+position `bufferSubData` every frame (audit items G4, G5) |
| 4 | Interaction cost | Main-thread work per input event ≤ **one frame (16.7 ms)** at full catalog (~30k objects) | Manual Performance-panel trace on filter drag until Wave 2 (G3) lands | Not yet met — filter change costs 2×O(n) sweeps + full GPU upload (audit item G3) |
| 5 | Startup | First visible dots as early as possible; no regression to time-to-first-dots | Measure before/after on catalog-path changes | Measured 2026-07-17: parsing the full 20 MB catalog costs 48 ms one-time (33,337 rows) — startup is dominated by engine/cruncher init, not the parse. A binary catalog format is not warranted at this catalog size |

Budgets 3–5 are aspirational targets with known violations at baseline; Wave 2 of the implementation play (grade-report items G2–G8) exists to meet them. Budgets 1–2 are enforced now to stop regressions while that work proceeds.

## Decision

1. Production builds fail when any JS asset or entrypoint exceeds 8 MiB. The filter intentionally excludes non-JS assets (textures, fonts, icons), which are governed by the existing 25 MiB per-file deploy check. The unminified `COVERAGE=1` build is exempt (not a shipped artifact).
2. The SGP4 benchmark runs bounded (`--limit 5000 --frames 10`) on every push/PR to `main` and uploads its JSON/HTML report as a 90-day artifact. It becomes a hard gate once enough runner-consistent baselines exist to set a fair threshold.
3. The 8 MiB ceiling is a **regression stop, not an endorsement** — the 7.42 MiB main bundle is expected to shrink (data-as-code catalogs and worker/library splits are audit candidates), and the ceiling should be ratcheted down as it does.

## Consequences

- A PR that bloats the initial bundle past the ceiling fails CI with an explicit size error instead of shipping silently.
- Benchmark trends are visible in CI artifacts before any hard gate exists, so a slow drift is caught by inspection rather than by users.
- The manual checks for budgets 3–5 are labor until Wave 2 lands; they are listed here so reviewers know what to measure when touching those paths.
