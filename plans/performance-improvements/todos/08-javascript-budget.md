difficulty: medium
agent: inherit

# Budget aggregate startup JavaScript and verify splitting benefits

Priority: P2. One worktree and one final commit.

## T1 · Measure the emitted graph and retain only useful loading changes

Inspect the built dependency graph after 07. Record raw and gzip bytes for the complete initial dependency closure, optional chunks, evaluation work, and network/cache behavior. The baseline entry bundle is 1,943.95 kB raw / 483.89 kB gzip; a smaller largest chunk alone does not establish a startup improvement.

Experiment with a stable Phaser vendor chunk and lazy optional-scene registration only if measurements show potential benefit. Preserve `base: './'`, offline `sangota://game/` resolution, Map/Room scene layering, and test/dev entry. Verify emitted content rather than assuming static development imports survive production tree-shaking. If the experiment gives no worthwhile cold/warm benefit, keep the simpler graph and record that result.

Expected files:

- `vite.config.ts`, `src/main.ts`; `src/scenes/BootScene.ts` or `src/devScenes/index.ts` only if justified by the measured optional path.
- **New:** `scripts/check-bundle-budget.mjs`, `tests/performance/javascript.mjs`, `tests/performance/baselines/javascript.json`.
- `tests/performance/budgets.json`, `package.json`; `bun.lock` only if a necessary tooling dependency changes.
- Existing import/dev-scene guards only where real module contracts change. Avoid new framework or Vite major-version changes.

Acceptance:

- A documented Bun package command checks total startup raw/gzip JS and optional-chunk totals, failing for meaningful budget regressions even if each chunk is below Vite's warning threshold.
- Any accepted split has recorded before/after cold and warm evidence and retains relative URLs and correct scene order. Optional imports register before navigation and avoid duplicate registration on return visits.
- A chunk-load failure is visible and recoverable without leaving a blank screen. Add this behavior case if lazy scene imports are introduced.
- The budget/report is delivered even if splitting proves unhelpful; do not manufacture a split or claim startup savings from chunk-count changes.
- The production bundle still contains no test observers/debug global. Development scenes continue to work through their existing entry script.

前置依赖：依赖 [07-staged-asset-loading.md](07-staged-asset-loading.md)。

## Independent validation

Run `bun run check`, `bun run build`, the new bundle-budget command, and `bun run perf:browser --case javascript --check`. If chunk registration/loading changes, run `bun run desktop:test` and exercise Title → optional screen → Title plus direct development entry. Keep Bun lock changes with the task commit.
