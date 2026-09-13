difficulty: medium
agent: inherit

# Avoid unchanged card layout and tooltip reconstruction

Priority: P1. One worktree and one final commit.

## T1 · Update only changed card-face output

Optimize `CardView.refresh`, `layoutDescription`, and `rebuildKeywordZones`. Cache the displayed compact rules text and layout-affecting inputs per view. If those inputs are unchanged, retain text layout and keyword zones instead of calling `setFixedSize`, trying font presets, destroying zones, and creating measuring Text objects again. Skip redundant cost/text styling writes where they trigger canvas updates.

Continue reading effective cost and playability from current combat state independently. CombatState mutates in place, so object identity is not a valid invalidation key. Preserve signed/dynamic numbers, energy-dependent/X cost, upgrades, width/font/resolution behavior, full description fitting, bottom keyword row, X tooltip, and pointer/drag forwarding. Avoid changing CombatScene's combat flow or adding a global unbounded layout cache.

Expected files:

- `src/ui/CardView.ts`; `src/ui/cardText.ts` only for a narrowly useful pure layout helper.
- `tests/cardText.test.ts` if helper behavior changes; existing `tests/cardFaces.test.ts` remains a rules correctness guard.
- **New:** `tests/performance/card-layout.mjs`, `tests/performance/baselines/card-layout.json`.
- Do not change shared browser helpers, package files, settings, grids, or game rules in this task.

Acceptance:

- After initial layout, repeated refreshes with unchanged displayed output create zero new keyword zones or measuring Text objects and perform zero description layout passes. Card cost/playability still updates when those values change independently.
- In-place state changes affecting damage/block, conditional text, attack count, energy, and status values produce correct live card faces and correctly positioned keyword hotspots.
- Hover and drag starting on a keyword still reach the card input path; no duplicate listeners or persistent tooltip targets remain after destruction.
- Long Chinese descriptions and upgraded/X-cost cards stay within the existing print area at supported render scales and hover sizes.
- Record the same hand-refresh workload before/after using 01's observer, keeping counters test-only. Do not claim engine improvements from UI-only changes.

前置依赖：依赖 [01-performance-baseline.md](01-performance-baseline.md)。

## Independent validation

Run `bun run check`, `bun run build`, and `bun run perf:browser --case card-layout --check`. Include real hover/drag behavior and a dynamic-description screenshot in the focused case. Existing face/rule golden expectations must not change.
