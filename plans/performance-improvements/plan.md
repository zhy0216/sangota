# Performance improvements

Status: planned; implementation has not started. Prepared 2026-09-13 from `9a5ec4b07b50723273e847b9c102a7ee3d08f80d` on `main`.

## Intent

The request is `$auto-dev performance improve`. Improve the game's startup, memory use, and responsiveness without changing game rules or artwork design. Repository inspection identifies eager artwork loading as the largest startup cost, unnecessary card text layout as a combat refresh cost, and full-list card construction as a compendium cost. This is a focused performance project, not the complete `repo-improvements` backlog.

The stack is Phaser 3, TypeScript, Vite, Vitest, and Electron. Use Bun for dependencies and package scripts, preserve `bun.lock` as the canonical lockfile, and keep the relative Vite base and offline desktop protocol working.

## Goals and scope

- Make the title usable before downloading and decoding gameplay artwork.
- Reduce texture pixel cost according to actual display size, including a separate title-sized backdrop instead of loading the full scrolling map.
- Avoid repeated settings storage reads and unchanged card-face text/tooltip reconstruction during gameplay.
- Bound card-grid objects by the viewport size rather than collection size.
- Record repeatable before/after measurements and enforce deterministic asset, object-count, and JavaScript budgets.
- Preserve Chinese text, hero silhouettes, card previews, tooltip and drag behavior, selection semantics, save compatibility, all four acts, standalone test battles, development scenes, and offline Electron operation.

Non-goals: balance or combat-engine changes, new art generation, an engine/framework upgrade, a save-system redesign, a broad UI rewrite, asset streaming from a remote service, adaptive render-scale changes, aggressive texture eviction, or executing unrelated tasks in the existing backlog. The current `auto-dev` session writes only this plan and its queue; a separate Herdr coordinator owns implementation.

## Evidence from this checkout

| Finding | Location and measurement | Implication |
| --- | --- | --- |
| All shipped image groups load before Title | `src/scenes/BootScene.ts:132`: heroes, map, all enemies, cards, relics, potions, room art, and the easter egg are queued together. | Split loading by consumer and avoid blocking title on gameplay art. |
| Large source pixel footprint | Header inspection of `public/assets/`: 382 files / 73,032,460 bytes; 321 PNG/JPEG files / 54,086,919 compressed bytes; `sum(width × height × 4)` = 386,356,928 bytes, approximately 368.46 MiB. | Compressed download size alone does not describe texture cost. This estimate is not measured GPU memory. |
| Full map used on title | `TitleScene.ts:110`, `CustomScene.ts:74`, `CompendiumScene.ts:110`, `MapScene.ts:226`; `map-bg.jpg` is 3072 × 5504 and expands to 67,633,152 bytes. | Use a separate viewport derivative for menu backdrops; preserve the full-map geometry and crop. |
| Other large groups | Cards: 105,062,400 RGBA bytes; enemies: 84,715,200; rooms: 45,217,216; heroes: 29,083,200; combat backdrop: 22,860,800. | Choose derivatives and load groups from actual rendered dimensions and needed content. |
| Synchronous sprite scanning | `src/ui/spriteBounds.ts:25–84` reads every source pixel on first use, caches only by texture key, and releases CanvasPool resources only on success. | Generate alpha bounds ahead of time; retain safe fallback, always release temporary canvases, and invalidate on source replacement. |
| Repeated card layout | `src/ui/CardView.ts:259–365`: every refresh fits the description and reconstructs keyword zones and measuring Text objects. `CombatScene.ts:3103` refreshes every hand card. | Cache by the actual displayed description/layout inputs, while updating cost and playability independently. |
| Repeated settings I/O | `src/state/settings.ts:220–286`; `src/ui/timing.ts`: every timing lookup reads/parses localStorage. A rejected write broadcasts a value that the next getter loses. | Keep an initialized session snapshot with explicit external-update and test reset paths. |
| Offscreen cards are still constructed | `src/ui/CardGrid.ts:189` and `src/scenes/CompendiumScene.ts:311` instantiate all entries; scrolling mainly disables hit areas. | Keep only visible rows plus overscan alive, preserving selection outside the mounted rows. |
| One entry JavaScript bundle | `src/main.ts` imports all scenes; `vite.config.ts` sets a 2000 kB chunk warning threshold. Fresh build: 1,943.95 kB raw / 483.89 kB gzip. | Budget aggregate startup JS and measure cache/splitting benefits; a smaller individual chunk is not proof of faster startup. |

Read-only browser probe: a fresh headless Chromium context opened the production preview on localhost at 1280 × 720, DPR 1. Title was first observed active at 4149.8 ms, with 386 textures and 387,816,040 estimated source RGBA bytes. Eight observed long tasks totaled 1240 ms, with a maximum of 349 ms. A programmatic Compendium entry was observed active after 1486.3 ms and contained 158 CardViews, 852 Text objects, and 2308 total display objects. No page errors were observed. These are single diagnostic samples, not stable performance thresholds or evidence of real-device FPS. The browser's default resource buffer capped entries at 250, so its partial transfer total is deliberately not used as a complete download measurement. Task 01 must collect complete request data and real-input readiness measurements.

Verification performed during planning:

- `bun run check` passed: TypeScript, 72 Vitest files / 4962 tests, and 6 desktop protocol unit tests. Vitest reported 23.87 seconds; this was not an isolated timing benchmark.
- `bun run build` passed: 115 transformed modules; Vite reported 9.01 seconds. Build/check ran concurrently, so build time is not a performance baseline.
- The browser probe above passed. It did not exercise full combat or packaged desktop behavior.
- No simulation/evaluation sweep, dependency update, asset rewrite, or business-code edit was performed. Image dimensions were read using a dependency-free PNG/JPEG header parser; Pillow is not installed.

## Approach

### 1. Establish a reproducible measurement contract

Add a production-preview browser harness using the installed Playwright package. Reuse the test-only Phaser interception pattern in `scripts/smoke-desktop.mjs`; do not expose a new release debug global. Prepare deterministic state only within isolated test contexts. Drive user-facing paths through real input; observers may inspect objects and timing but must not substitute scene calls for interaction acceptance.

Measure fresh title, first run/first combat, saved-combat resume, Compendium open/filter/scroll, a large deck grid, and repeated scene visits. Separate navigation-to-ready from decorative fade duration. Record viewport, DPR/render scale, browser, renderer, CPU/network conditions, source commit, cache state, request bytes, texture dimensions, long tasks, frame intervals, and live object counts. Increase or drain the resource timing buffer and reconcile with network events; distinguish HTTP traffic from blob URLs, decoded sizes, and cached responses.

Use at least five cold and five warm repetitions for comparable timing results; store raw observations and medians. Test slow-network behavior with explicit fixed settings (initial candidate: 10 Mbps, 40 ms latency, 4× CPU slowdown), and use an unthrottled profile for interaction latency. Do not interpret software-rendered headless results as real-device GPU performance.

Initial acceptance targets, to be frozen with the repeated baseline in task 01:

- Title-required image transfer at most 15 MiB and source RGBA estimate at most 64 MiB after tasks 06–07. Report audio, generated textures, and JS separately as well as in the overall total.
- At least 30% lower median cold title-ready time under the same controlled profile; track time to first playable combat so waiting is not merely moved behind the title button.
- Compendium live card/silhouette cells at most `columns × (ceil(viewHeight / cellHeight) + 3)`, capped by entry count, plus at most two explicit preview faces. Apply the same viewport formula to CardGrid. Target at least 40% lower warm compendium open/filter median with the same unlocked collection.
- After settings initialization, repeated timing queries perform no additional storage reads/parsing. After a CardView's initial layout, unchanged refreshes allocate no new keyword zones or measuring Text objects and perform no repeated description layout.
- Warm first-combat and normal scene-entry medians should not regress more than 10%; repeat suspicious noisy samples before judging. Report first-combat texture estimates and full-session resource growth against baseline.

Use byte counts, loaded-key sets, live-object bounds, and behavior as automated gates. Keep noisy wall-clock comparisons as controlled performance evidence rather than an ordinary Vitest timing assertion. If a proposed target cannot be met while preserving quality, document the measured reason and revised target before proceeding; do not silently raise a limit to make a check green.

### 2. Remove unnecessary work in existing views

Settings: lazily initialize or explicitly initialize once without creating a `config`/settings import cycle. Store sanitized state, return defensive snapshots, merge updates into memory before best-effort persistence, and notify subscribers consistently. Handle legitimate `storage` updates, removal, and session reset explicitly; update tests that currently swap fake storage behind the getter. Preserve legacy audio migration, defaults, key bindings, and render-scale's reload requirement.

Card faces: keep caching local to each view and invalidate using displayed text and layout-affecting inputs, not CombatState identity (the engine mutates state). Skip redundant `setFixedSize`, preset search, and keyword rebuilding. Continue computing cost/playability from current state; preserve dynamic damage, block, X cost, upgrades, fonts, and tooltip forwarding. Avoid a general combat-scene or status-widget rewrite in this project.

Grids: introduce shared pure visible-row arithmetic, with lifecycle ownership local to each consumer. Create/destroy row cells at viewport boundaries; the immutable identity fields in CardView make indiscriminate instance reassignment unsafe. Keep ordered entries, picked UIDs, disabled state, and confirmation independent of mounted views. Clean up masks, hover previews, tooltip targets, and input listeners on scroll, close, tab/filter change, and scene shutdown.

### 3. Define assets and static bounds once

Create a typed, browser-safe asset catalog for existing texture keys, local relative URLs, category, dimensions, source fingerprint, consumer groups, and optional alpha bounds. Tooling computes binary metadata and bounds; runtime imports contain no Node or image-processing dependencies. Existing hero/enemy integrity tests parse BootScene's literal arrays: migrate them to assert actual catalog-to-definition-to-file coverage instead of maintaining obsolete source-string assumptions.

Initially keep eager loading unchanged while moving the catalog, to isolate correctness. Preserve SFX dual-format behavior and existing music-on-demand handling. Generate sprite bounds with the current alpha threshold of 12 and identical inclusive-edge semantics. Validate metadata against the actual loaded source/fingerprint and dimensions; fallback works for unknown textures, placeholders, replaced sources, and missing context. Put CanvasPool cleanup in `finally` and cache by source identity as well as key.

### 4. Right-size and stage assets

Generate reproducible local runtime derivatives from the existing artwork. Preserve originals and source-to-derivative metadata; do not repaint characters or alter identity. Choose dimensions from the largest consumer, including hover/upgrade previews and render scales 1/2/3, not only thumbnail size. Bound large dimensions for the supported WebGL path. Keep the scrolling map's layout and visible crop consistent while using a separate menu background. Inspect screenshots for map seams/cropping, Chinese text, card art, and actor grounding before accepting savings.

Build an asset loader that distinguishes unavailable, in-flight, ready, and fallback states, deduplicates requests, and detaches scene-specific callbacks on shutdown. A fallback texture must not permanently block a retry of real artwork. Change `makeCardArt` so it only creates requested fallbacks; the current all-card pass would otherwise populate every deferred key at boot.

Boot loads title/menu background, hero chooser art, core UI/procedural textures, and the existing small SFX set. Load gameplay groups when required, with visible progress and a usable fallback/retry path. Groups must cover actual demand, not simply the chosen hero: neutral cards, generated and temporary cards, off-hero cards, potions, reward choices, shop/event offerings, and summoned enemies can appear unexpectedly. Audit title deck preview/history, Custom/TestBattle, blessing choices, saved combat, Room event combat, reward and summary screens, Compendium tabs, and dev-scene direct entry. Prefer coarse safe groups for the first implementation over a complex per-card cache.

Keep scene `init/create` semantics, sleep/wake behavior, and save/hook commit ordering intact. Do not add asynchronous gaps inside rule-state mutation or reuse an old scene's completion callback. Repeated clicks and abandoned loads must not start duplicate fights or pay rewards twice. Resource errors must allow the pending transition to complete with supported fallback rather than stranding a saved run. The broader pre-existing transition-recovery issue in the old backlog is not silently included here.

Retain ready textures for reuse initially; aggressive eviction would require a separate ownership design. Report growth after visiting all content honestly. Staging reduces startup residency, while derivatives and bounded grids reduce longer-session cost.

### 5. Control JavaScript and prove integration

After asset staging, inspect the emitted import graph and measure raw/gzip total startup JS, parsed/evaluated work, and warm cache behavior. Experiment with stable Phaser vendor separation and optional-scene imports only where they reduce measured costs. Preserve scene registration order (notably sleeping Map/Room composition), deep/dev entry paths, and `sangota://game/` relative chunk loads. Existing code already removes many development-only paths during production optimization; do not assume all dev scenes are shipped from source imports alone.

Deliver a budget over the actual startup dependency closure, not just Vite's largest chunk warning. If splitting produces no useful gain, keep the simpler graph and record the experiment; the aggregate budget/report remains required. Finish with browser/desktop verification and an honest before/after report, with unsupported hardware measurements marked as unavailable.

## Task breakdown

| File | Priority | Difficulty | Scope | Direct dependencies |
| --- | --- | --- | --- | --- |
| `01-performance-baseline.md` | P1 | hard | Reproducible browser/asset measurements and baseline contract | None |
| `02-settings-snapshot.md` | P2 | medium | Remove timing-path storage reads and keep updates consistent | 01 |
| `03-card-layout-cache.md` | P1 | medium | Skip unchanged description/keyword layout | 01 |
| `04-asset-catalog-and-bounds.md` | P1 | hard | Typed catalog, static alpha bounds, safe fallback cleanup | 01 |
| `05-visible-card-grids.md` | P1 | hard | Bound Compendium and CardGrid view construction | 03 |
| `06-runtime-texture-sizes.md` | P1 | medium | Display-sized derivatives and menu backdrop | 04 |
| `07-staged-asset-loading.md` | P1 | hard | Boot/scene/overlay resource readiness and fallbacks | 05, 06 |
| `08-javascript-budget.md` | P2 | medium | Measure splitting, enforce aggregate startup budget | 07 |
| `09-performance-validation.md` | P1 | medium | Integrated evidence, browser regressions, offline desktop, docs | 02, 08 |

After 01, tasks 02/03/04 may run in parallel. After 03/04, branches 03 → 05 and 04 → 06 may run in parallel. Task 07 joins them, then 08, then 09 after 02 also completes. The queue serializes shared asset/Boot files, CardView consumers, package scripts, and `bun.lock`. Each todo is one worktree and one final commit. Do not run this queue and overlapping old-backlog tasks concurrently.

## Execution preferences

`default_agent: codex`, inherited from the initiating Codex host. The user supplied no global model/reasoning override or per-task agent override. All todos use `agent: inherit`. Resolve using `/home/ubuntu/.agents/skills/herdr-finish-plan/references/agent-routing.md`: medium → `codex / gpt-6-astra / xhigh`; hard → `codex / gpt-6-astra / max`. The coordinator defaults to `codex / gpt-6-astra / high`; that does not override task difficulty. Herdr starts use the skill's explicit auto/YOLO arguments.

Save the concrete default in `todos/README.md` so a new coordinator does not infer a different host. No `default_model` or `default_reasoning_effort` overrides should be saved because none were requested.

## Validation

Current commands: `bun run typecheck`, `bun run test`, `bun run check`, `bun run build`, `bun run desktop:test:unit`, `bun run desktop:test`; opt-in `bun run sim`, `bun run eval`, and `bun run eval:cards`. The performance changes do not justify a balance sweep unless rule behavior unexpectedly changes. Keep existing golden snapshots and save roundtrips intact; do not update expected combat results to hide a regression.

Task 01 introduces `bun run perf:assets` and `bun run perf:browser`, with a focused case option and a deterministic `--check` mode documented by that task. Later tasks extend these tools with their own cases and reports. These commands do not exist yet and have not passed. Generated reports go to a task-defined ignored artifact directory; curated baselines and budgets are versioned. Each task runs checks appropriate to its owned code and reports actual outcomes. Task 09 runs the integrated checks once after merging.

`bun run desktop:test` covers a real Electron launch. On a headless Linux host, use the repository's documented Xvfb/window-manager setup if available; report environmental inability separately from success. Test an actual packaged directory only if asset packaging/copying changes. Do not deploy or publish.

## Risks, assumptions, and launch state

- Assumption: improve browser and Electron on the existing 1280 × 720 design space and render-scale settings; no mobile layout or quality reduction was requested.
- Cached layout must key on displayed values and font/layout inputs, since state and enemy/status structures mutate in place. A cache keyed on object identity will produce stale card numbers.
- Offscreen selection and input cleanup are correctness requirements of virtualization. Large decks and upgrade comparisons must remain usable after rows unmount.
- Smaller compressed assets do not imply smaller decoded textures. Validate derivatives against actual preview sizes, high-DPI output, transparent bounds, and maximum texture dimensions.
- Loader callbacks can outlive a scene; all retry and cancellation paths require behavioral coverage. Keep missing-art fallbacks distinct from successfully loaded assets.
- The existing `repo-improvements` plan has overlapping items R09/R19/R20/R21 and a separate 29-task queue. This focused queue carries its own dependencies and does not require unrelated storage, CI, or architecture work from that draft. A future coordinator must reconcile any changes that have landed since this baseline rather than replaying duplicates.
- At entry, `git status --porcelain` showed `?? plans/repo-improvements/todos/`, so launch was paused after preparing this plan and queue. The user then explicitly approved committing that existing queue, committing this performance plan, and launching Herdr. The existing queue was preserved without content changes in `ec4e362`; its 29 tasks are not part of this execution request.
- `HERDR_ENV=1` and the Herdr CLI are available. Installed Codex supports the required launch arguments, and local model metadata confirms `gpt-6-astra` with `high`, `xhigh`, and `max`. Commit this plan and verify the workspace is clean before launching the performance coordinator. No implementation has started at the time of this planning commit.
