# SatGlobe performance governance

SatGlobe keeps large raw browser reports local and commits only compact, accepted records. The current ledger intentionally starts empty. Measurements from the archived first-play branch and the dated values in earlier ADRs remain historical context; they are not evidence for the combined application now on `main`.

## Plain-English workflow

1. Build SatGlobe and serve that exact production build.
2. Run the normal benchmark. It repeats cold starts and interactions across five fresh browser pages.
3. Run the two-minute soak when renderer, workers, stories, filters, or long-running behavior changed.
4. Compare the raw report with the accepted record for the same machine profile.
5. Accept a clean, passing hardware report only when the change is meaningful enough to preserve as a milestone.

```bash
npm run build:satglobe
npm run check:build:satglobe
npm run start:satglobe:static

# In another terminal:
npm run benchmark:satglobe
npm run benchmark:satglobe:soak
npm run performance:compare -- --input benchmark-results/satglobe/<run>.raw.json --profile apple-m4-1440p
npm run performance:record -- --input benchmark-results/satglobe/<run>.raw.json --profile apple-m4-1440p --label "Meaningful change"
npm run performance:validate
npm run performance:history
```

Raw reports live under ignored `benchmark-results/satglobe/`. `performance:record` rejects dirty commits, headless or software-rendered runs, runtime errors, fewer than five samples, viewport/profile mismatches, and absolute-budget failures.

## Fair comparisons

Only like-for-like results are compared: the same hardware profile, viewport, render scale, renderer, browser major, analyzer major, gate version, and a catalog population within five percent. A different environment starts a new profile or analyzer epoch instead of producing a misleading percentage.

- More than 10% slower is a warning.
- More than 20% slower requires an independent confirmation report for the same clean commit and catalog plus a written justification.
- Absolute frame, interaction, long-task, soak, context-loss, runtime-error, total-output, aggregate-JavaScript, and per-JavaScript-asset budgets fail directly.
- GitHub-hosted software rendering may exercise deterministic contracts, but its milliseconds can never become hardware evidence.

The first valid accepted run for a profile becomes its baseline. Existing JSON records are immutable: add a new superseding record rather than editing or deleting one. CI validates schemas, profile pointers, generated history, and unchanged records relative to the pull request base.

## Recording conditions

Use headed Chromium on AC power after the machine has returned to an idle thermal state. Close builds, video calls, games, and other GPU-heavy work. The default profile is `apple-m4-1440p`; set `SATGLOBE_BENCHMARK_PROFILE`, `SATGLOBE_BENCHMARK_WIDTH`, and `SATGLOBE_BENCHMARK_HEIGHT` only when intentionally running another declared profile. The analyzer records the actual canvas-to-CSS render scale; it is not caller-asserted.
