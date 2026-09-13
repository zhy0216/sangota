# Performance task queue

Source: [performance plan](../plan.md). Prepared 2026-09-13 against `9a5ec4b07b50723273e847b9c102a7ee3d08f80d`.

Nine tasks cover the focused performance request. Each file is one independent task, one worktree, and one final commit. Paths marked **new** in tasks describe proposed implementation files, not files already present. Reconcile any changes since this baseline before starting; do not execute overlapping tasks from `plans/repo-improvements/todos/` at the same time.

## 执行偏好

```yaml
default_agent: codex
```

The default comes from the initiating Codex host. There are no user model/reasoning overrides and no per-task agent overrides. Every todo uses `agent: inherit`. The resolved routing below follows `/home/ubuntu/.agents/skills/herdr-finish-plan/references/agent-routing.md`; all use `gpt-6-astra`, medium uses `xhigh`, and hard uses `max`. The coordinator's default `high` effort is independent of worker difficulty. Use the skill's explicit auto/YOLO launch arguments and verify the selected CLI/model before launch.

## 优先级

The table is sorted by priority; the numbered list below gives the topological execution and integration order.

| File | Priority | Difficulty | Agent / source | Model / Codex effort | Deliverable |
| --- | --- | --- | --- | --- | --- |
| [01-performance-baseline.md](01-performance-baseline.md) | P1 | hard | codex / inherited | gpt-6-astra / max | Repeatable browser and asset measurements. |
| [03-card-layout-cache.md](03-card-layout-cache.md) | P1 | medium | codex / inherited | gpt-6-astra / xhigh | Avoid unchanged card-face and keyword layout. |
| [04-asset-catalog-and-bounds.md](04-asset-catalog-and-bounds.md) | P1 | hard | codex / inherited | gpt-6-astra / max | Asset catalog and static sprite bounds. |
| [05-visible-card-grids.md](05-visible-card-grids.md) | P1 | hard | codex / inherited | gpt-6-astra / max | Viewport-bounded card and compendium grids. |
| [06-runtime-texture-sizes.md](06-runtime-texture-sizes.md) | P1 | medium | codex / inherited | gpt-6-astra / xhigh | Reproducible display-sized runtime images. |
| [07-staged-asset-loading.md](07-staged-asset-loading.md) | P1 | hard | codex / inherited | gpt-6-astra / max | Small title load with safe deferred gameplay groups. |
| [09-performance-validation.md](09-performance-validation.md) | P1 | medium | codex / inherited | gpt-6-astra / xhigh | Integrated measurements and browser/desktop evidence. |
| [02-settings-snapshot.md](02-settings-snapshot.md) | P2 | medium | codex / inherited | gpt-6-astra / xhigh | Session settings without repeated storage reads. |
| [08-javascript-budget.md](08-javascript-budget.md) | P2 | medium | codex / inherited | gpt-6-astra / xhigh | Aggregate startup JS budget and measured split decision. |

## 文件

1. [01-performance-baseline.md](01-performance-baseline.md) — hard; codex / gpt-6-astra / max.
   前置依赖：无。
2. [02-settings-snapshot.md](02-settings-snapshot.md) — medium; codex / gpt-6-astra / xhigh.
   前置依赖：依赖 [01-performance-baseline.md](01-performance-baseline.md)。
3. [03-card-layout-cache.md](03-card-layout-cache.md) — medium; codex / gpt-6-astra / xhigh.
   前置依赖：依赖 [01-performance-baseline.md](01-performance-baseline.md)。
4. [04-asset-catalog-and-bounds.md](04-asset-catalog-and-bounds.md) — hard; codex / gpt-6-astra / max.
   前置依赖：依赖 [01-performance-baseline.md](01-performance-baseline.md)。
5. [05-visible-card-grids.md](05-visible-card-grids.md) — hard; codex / gpt-6-astra / max.
   前置依赖：依赖 [03-card-layout-cache.md](03-card-layout-cache.md)。
6. [06-runtime-texture-sizes.md](06-runtime-texture-sizes.md) — medium; codex / gpt-6-astra / xhigh.
   前置依赖：依赖 [04-asset-catalog-and-bounds.md](04-asset-catalog-and-bounds.md)。
7. [07-staged-asset-loading.md](07-staged-asset-loading.md) — hard; codex / gpt-6-astra / max.
   前置依赖：依赖 [05-visible-card-grids.md](05-visible-card-grids.md)；依赖 [06-runtime-texture-sizes.md](06-runtime-texture-sizes.md)。
8. [08-javascript-budget.md](08-javascript-budget.md) — medium; codex / gpt-6-astra / xhigh.
   前置依赖：依赖 [07-staged-asset-loading.md](07-staged-asset-loading.md)。
9. [09-performance-validation.md](09-performance-validation.md) — medium; codex / gpt-6-astra / xhigh.
   前置依赖：依赖 [02-settings-snapshot.md](02-settings-snapshot.md)；依赖 [08-javascript-budget.md](08-javascript-budget.md)。

## Parallel work and file ownership

- Start with 01 alone, preserving the pre-optimization baseline. Then 02, 03, and 04 may run concurrently.
- The card branch is 03 → 05. The asset branch is 04 → 06. These branches may run concurrently; 06 prepares menu artwork/catalog entries but leaves menu-scene URL/key changes to 07, avoiding a collision with 05's Compendium edits.
- Join at 07, then execute 08. Execute 09 after both 02 and 08 finish.
- Settings/timing and related storage-test resets belong to 02; do not edit `src/main.ts` for settings initialization while other tasks own it. CardView layout belongs to 03; 05 consumes it without changing its identity contract.
- Asset generator/catalog/Boot ownership passes from 04 to 06 to 07. Only 01, 04, 06, 07, and 08 may need package/tooling changes, and they are ordered by dependencies. Only those owners may change `package.json` or `bun.lock`.
- 01 establishes shared browser helpers and case discovery. Later tasks add their own case files rather than changing the common runner concurrently. A needed shared-interface change requires an explicit dependency and serial integration.
- The main `docs/performance.md` is established by 01 and finalized by 09. Intermediate task reports use distinct paths in `tests/performance/baselines/`. Dependencies protect all shared budget/report tooling.
- No file may be concurrently owned by an unrelated task. If implementation expands the listed write scope, update dependencies before assigning the new work.

## Validation contract

Use Bun throughout. Dependency changes must include `bun.lock`; do not generate or refresh `package-lock.json`. In a fresh worktree use `bun install --frozen-lockfile` when dependencies need installation. Preserve game rules, seeded RNG, card pool order, save schemas, and golden combat expectations.

Current commands are `bun run check`, `bun run build`, and `bun run desktop:test`. 01 introduces `perf:assets` and `perf:browser`; each has documented deterministic `--check` behavior and the browser command supports `--case <name>`. Before 01 lands those commands do not exist. Run each task's focused behavior checks and appropriate repository checks; rerun a full performance matrix only for integration or a new unresolved regression.

Browser tests use temporary profiles and prepared deterministic state, real pointer/keyboard input, explicit readiness, and cleanup. Performance observers are test-only. Keep noisy timings out of default unit-test gates; use repeatable reports, asset counts/bytes, loaded-key sets, and object bounds. The minimum targets and measurement conditions are in the plan and are frozen by 01.

## Launch state

Plan and queue prepared; no implementation started at the time of the planning commit. The initial worktree contained the pre-existing untracked `plans/repo-improvements/todos/` directory. The user explicitly approved preserving that queue in a commit, committing this performance plan, and launching Herdr. The existing queue was committed unchanged as `ec4e362`; execute only this performance queue's nine tasks. Herdr is available (`HERDR_ENV=1`), and installed Codex/model metadata support the saved routing. Commit this plan directory, verify a clean workspace, and follow the auto-dev launch flow. Do not mark any task complete based on planning checks.
