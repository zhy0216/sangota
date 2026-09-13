difficulty: hard
agent: inherit

# Construct only visible card-grid rows

Priority: P1. One worktree and one final commit.

## T1 · Bound Compendium and CardGrid cells by the viewport

Replace full-list cell construction in `openCardGrid()` and `CompendiumScene.buildCards()` with visible-row mounting plus small overscan. Share pure row-range arithmetic, while each consumer owns its scene objects and callbacks. CardView has readonly identity fields, so use safe cell create/destroy or an explicit identity-safe pool rather than reassigning a view's card UID/definition.

Keep sort/shuffle order, total scroll extent, picked UIDs, disabled state, and confirmation independently of mounted views. Support partially visible rows, empty/short lists, large decks, all/unlocked compendium entries, filters, upgraded faces, and hover/upgrade previews. Do not virtualize unrelated relic/enemy tabs unless measurements establish a new necessary scope and dependencies are updated.

Expected files:

- `src/ui/CardGrid.ts`, `src/scenes/CompendiumScene.ts`.
- **New:** `src/ui/visibleRows.ts`, `tests/visibleRows.test.ts`.
- `tests/cardGrid.test.ts`, `tests/compendiumView.test.ts` only if existing pure view contracts change.
- **New:** `tests/performance/card-grids.mjs`, `tests/performance/baselines/card-grids.json`.
- Read-only dependency: optimized `src/ui/CardView.ts` from 03. Do not change scene background assets here.

Acceptance:

- Live card/silhouette cells never exceed `min(entryCount, columns × (ceil(viewHeight / cellHeight) + 3))`, plus at most two explicit preview faces. A 500-entry test grid must not create 500 CardViews.
- Scrolling first-to-last and back preserves order, selection, disabled cards, confirmation count, and hover content. Unmounted selected UIDs still confirm correctly. Shuffle consumes no extra gameplay RNG and remains fixed during scrolling.
- Hit areas outside the viewport cannot activate underlying/hidden cards. Preview, tooltip targets, masks, and event listeners are cleaned up on scroll, close, tab/filter change, and scene shutdown.
- Mandatory picks remain mandatory, optional picks cancel correctly, upgrade comparison and nested overlays retain input freeze/thaw and Esc behavior.
- Repeated open/close/filter cycles settle to bounded live objects without growing active listeners or textures from destroyed Text objects.
- Record warm open/filter and scroll measurements against 01's same collection. Target at least 40% lower median Compendium opening/filtering cost; report measured deviations rather than hiding them with timing assertions.

前置依赖：依赖 [03-card-layout-cache.md](03-card-layout-cache.md)。

## Independent validation

Run focused visible-row/grid tests, `bun run check`, `bun run build`, and `bun run perf:browser --case card-grids --check`. The browser case must use real wheel/click input and cover scroll-away selection, disabled cells, and cleanup; pure arithmetic tests alone do not establish correctness.
