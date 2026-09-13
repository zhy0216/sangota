difficulty: hard
agent: inherit

# Load title assets first and gameplay assets when needed

Priority: P1. One worktree and one final commit. This is the integration task for the catalog, derivatives, and viewport grids; keep it focused on resource readiness rather than a general scene refactor.

## T1 · Implement shared loading and fallback lifecycle

Create a loader over 04/06's catalog with unavailable/in-flight/ready/fallback states. Deduplicate the same requested asset/group, resolve empty/already-ready groups, scope completion callbacks to their owning scene or game lifetime, and detach listeners on shutdown. Fall back visibly on asset error and allow a later retry to replace fallback textures safely, including sprite-bounds invalidation.

Change `BootScene.preload/create` to load the menu background, chooser heroes/portraits, core UI/procedural textures, and existing short dual-format SFX. Retain music's existing demand loading. Update `makeCardArt` to create only requested missing art; it must not fill every unloaded catalog key and mask future image loads.

Expected files:

- **New:** `src/assets/loader.ts` and narrowly scoped group/loader helpers if needed.
- `src/assets/catalog.ts`, `src/scenes/BootScene.ts`, `src/ui/cardArt.ts`, `src/ui/spriteBounds.ts` only for fallback replacement integration.
- **New:** `tests/assetLoading.test.ts` for meaningful pure group/state contracts and `tests/performance/asset-loading.mjs` for the real loader.
- `tests/heroAssets.test.ts`, `tests/enemyAssets.test.ts`, `tests/audioWiring.test.ts` and related source guards only where the actual registration contract changes.

Acceptance:

- Fresh title meets the frozen target: required image transfer at most 15 MiB and source image RGBA estimate at most 64 MiB; separately report audio, JS, generated textures, and aggregate request totals.
- No gameplay card/enemy/room or easter-egg bulk load is required before title readiness. Remaining title art renders normally and chooser switching remains responsive.
- Duplicate requests share work; a missing image gets usable fallback; retry can install real art instead of being blocked by `textures.exists`. Failure/retry and abandoned scene loads do not leak listeners or leave unresolved promises.

前置依赖：依赖 [05-visible-card-grids.md](05-visible-card-grids.md)；依赖 [06-runtime-texture-sizes.md](06-runtime-texture-sizes.md)。

## T2 · Cover every scene and overlay asset entry

Audit actual consumers and add resource readiness at scene/view boundaries. Wire the menu derivative into Title, Custom, and Compendium. Prefer coarse safe groups at first, including all necessary neutral/generated/off-hero cards and summoned enemies, rather than assuming hero/act labels completely describe demand. Show progress/fallback in the appropriate view, deduplicate rapid user activation, and ignore callbacks belonging to an old scene visit.

Expected files:

- `src/scenes/TitleScene.ts`, `BlessingScene.ts`, `MapScene.ts`, `CombatScene.ts`, `RoomScene.ts`, `InterludeScene.ts`, `SummaryScene.ts`, `CompendiumScene.ts`, `CustomScene.ts`, `TestBattleScene.ts` as their consumers require.
- `src/scenes/nav.ts`, `src/devScenes/index.ts` only where direct entry bypasses normal loading.
- `src/ui/CardGrid.ts`, `CardView.ts`, `HistoryPanel.ts`, `RelicBar.ts`, `PotionBelt.ts` and `src/rooms/*View.ts` only where overlay/dynamic content requires assets not guaranteed by a scene group.
- Extend the T1 browser case, plus **new** `tests/performance/baselines/asset-loading.json`.
- Any package/helper change belongs solely to this task during its serial integration window. Do not change save schemas, rule modules, or pool order.

Acceptance:

- Real-input smoke covers title deck/history previews, new run, blessing choices, map/rooms, first combat and saved combat resume, rewards/summary, Compendium tabs/scrolling, Custom/TestBattle across acts, and development direct entry.
- Neutral/temporary/off-hero cards, reward/shop/event choices, potions, and summoned enemies display real art or the documented error fallback. Asset completeness is not inferred solely from the selected hero.
- Scene `init/create` state, Map sleep/wake layering, hooks/reward commits, and save ordering remain correct. No asynchronous wait is inserted halfway through a rule mutation. Rapid clicks, scene exit, and request failure cannot start duplicate combat or grant duplicate rewards.
- Failed assets allow the pending transition to finish with fallback and remain recoverable. Existing broader save-recovery work stays outside this task; document pre-existing failures separately.
- Loaded textures are reused initially; do not add aggressive eviction. Repeated load/visit cycles settle and do not accumulate duplicate textures/callbacks. Report full-content residency separately from boot savings.
- Target at least 30% lower controlled cold title median without merely shifting excessive delay to first playable combat. Report cold/warm first-combat and scene-entry comparisons; investigate a warm regression above 10%.
- All requests work from relative production paths and the offline desktop protocol. Missing original-source requests confirm runtime derivatives are the files actually used.

前置依赖：依赖本文件 T1。

## Independent validation

Run `bun run check`, `bun run build`, `bun run perf:assets --check`, `bun run perf:browser --case asset-loading --check`, and `bun run desktop:test` using the documented headless setup where needed. Run a production/development direct-entry check for a late-act standalone fight. Keep failure/retry and repeated-click checks behavioral, not source-string assertions.
