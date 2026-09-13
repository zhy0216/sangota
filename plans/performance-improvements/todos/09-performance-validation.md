difficulty: medium
agent: inherit

# Validate integrated gains and document the result

Priority: P1. One worktree and one final commit. This task assembles release evidence after all implementation dependencies have landed.

## T1 · Verify performance and behavior across browser and desktop

Run the same 01 baseline cases and profiles on the integrated result, with at least five cold and five warm observations. Compare title readiness, first playable combat, saved resume, Compendium open/filter/scroll, large deck grids, frame intervals/long tasks, live objects, resource bytes, and source texture estimates. Keep cache conditions, viewport, render scale, browser version, and state fixture identical or label differences explicitly.

Exercise three heroes, all four acts via isolated standalone fixtures, cards created during combat, summoned enemies, rewards/rooms, and saved combat resume. Cover 1/2/3 render scales with targeted visual samples rather than multiplying every timing case. Add only missing integration coverage for load failure/retry, abandoned loads, rapid repeated navigation, and offscreen selections; use existing focused cases where they already prove the behavior.

Expected files:

- **New:** `tests/performance/integration.mjs`, `tests/performance/baselines/after.json`.
- `tests/performance/budgets.json` only for justified final ratcheting, not to hide a failed target.
- `docs/performance.md`, `README.md`, `docs/desktop.md` for final measured behavior and actual commands.
- `scripts/smoke-desktop.mjs` only if its existing eager-asset assumptions need adaptation or a necessary offline integration path is missing.
- No unrelated gameplay fixes or cross-module refactor. If a dependency's implementation fails, return the concrete failure to that task for correction rather than burying it in this documentation commit.

Acceptance:

- `bun run check` and `bun run build` pass with game rule/golden expectations unchanged. All focused deterministic performance checks and aggregate bundle budgets pass.
- Final report includes baseline/result values, target status, raw sample links, exact conditions, cold/warm differences, and any remaining limits. Explicitly distinguish compressed transfer, decoded texture estimate, JS heap if available, and unmeasured GPU memory.
- Show actual title and compendium gains, settings I/O elimination, unchanged card-layout allocation bounds, and full-session behavior. Report any missed goal or unverified hardware condition; do not treat absence of measurement as success.
- Browser behavior cases preserve input, preview/selection semantics, save resume, and isolated custom/test play. Repeated cycles stabilize rather than accumulating objects/listeners.
- `bun run desktop:test` passes using the existing offline protocol and temporary profile. If packaging or runtime asset copying changed, test an actual packaged directory with the existing smoke script's `--executable` option. A browser pass does not substitute for desktop evidence.
- Document how to run the performance tools, regenerate/check asset derivatives/metadata, update budgets responsibly, and reproduce future comparisons. Reports contain no user save data.
- New performance commands mentioned in docs actually exist; no unresolved test process or raw artifact is left tracked accidentally. No deployment or publication is performed.

前置依赖：依赖 [02-settings-snapshot.md](02-settings-snapshot.md)；依赖 [08-javascript-budget.md](08-javascript-budget.md)。

## Independent validation

Run the repository checks once against the integrated tree, all deterministic performance cases, and the controlled comparison matrix. Use `bun run desktop:test` with the repository's documented Xvfb/window-manager setup on headless Linux. If that environment is unavailable, report the exact missing requirement and leave desktop acceptance outstanding rather than marking this task done. Additional simulation/evaluation sweeps are unnecessary unless a rule-layer regression appears.
