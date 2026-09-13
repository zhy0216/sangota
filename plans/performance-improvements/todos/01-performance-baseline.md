difficulty: hard
agent: inherit

# Establish reproducible performance measurements

Priority: P1. One worktree and one final commit. The current source remains the performance baseline until this task's measurements have been recorded.

## T1 · Measure assets and production browser flows

Build a repeatable harness around the installed Playwright package and production Vite preview. Reuse the test-only Phaser interception pattern from `scripts/smoke-desktop.mjs` without changing that script or adding a production debug global. Own server/browser/profile cleanup. Use complete network observations, not the default 250-entry resource buffer, and distinguish HTTP traffic, blob URLs, transfer bytes, decoded body sizes, and cached responses.

Prepare deterministic contexts for fresh Title, first run and combat, saved combat resume, full Compendium open/filter/scroll, a large CardGrid, and repeated visits. Real input must drive acceptance paths; observers may inspect scene readiness and live objects. State preparation stays isolated from user storage and outside measured intervals. Record navigation-to-ready separately from decorative animations. Include source commit, browser/renderer, viewport, DPR/render scale, CPU/network profile, request bytes, texture pixel estimates, long tasks, frame intervals, and object counts.

Expected files:

- **New:** `scripts/perf-assets.mjs`, `scripts/perf-browser.mjs`.
- **New:** `tests/performance/helpers.mjs`, `tests/performance/baseline.mjs`, `tests/performance/baselines/before.json`, `tests/performance/budgets.json`.
- **New:** `docs/performance.md`.
- Existing: `package.json`, `.gitignore`; `bun.lock` only if a necessary dependency changes.
- Read-only reference: `scripts/smoke-desktop.mjs`, `src/devScenes/prepare.ts`, `src/state/testBattle.ts`, `src/state/save.ts`.

Acceptance:

- `bun run perf:assets` reports image counts, file bytes, dimensions, and `width × height × 4` by category with largest offenders. It agrees with the plan's baseline or explains actual repository drift.
- `bun run perf:browser --case baseline` collects at least five cold and five warm observations, reports raw values and medians, and defines cold/warm precisely. Use the plan's candidate controlled profile and an unthrottled interaction profile, documenting any needed calibration.
- Define readiness and freeze the plan's candidate targets before downstream changes. Current oversized baseline is recorded as baseline debt, not falsely reported to meet future optimized limits.
- Add a documented `--check` mode for deterministic budgets/behavior, separate from noisy timing comparisons. Provide case discovery so later tasks add separate files without competing for the runner.
- Temporary profiles and owned server/browser processes are removed on success and failure. Raw generated artifacts are ignored; the curated baseline and budgets are committed.
- The release still contains no test global and no Node or measurement-only code. Existing game behavior is unchanged.

前置依赖：无。

## Independent validation

Run `bun run check`, `bun run build`, `bun run perf:assets`, and the baseline browser command. Validate failure cleanup once by failing a requested case or stopping its owned page. Document the limits of headless graphics; do not claim measured GPU memory or real-device FPS from pixel estimates.
