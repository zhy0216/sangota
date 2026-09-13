difficulty: hard
agent: inherit

# Centralize asset metadata and precompute sprite bounds

Priority: P1. One worktree and one final commit. Keep the current eager loading policy during this task.

## T1 · Create a typed catalog for the current assets

Move BootScene's explicit image registration data into a browser-safe catalog, retaining every existing texture key and local relative URL. Include category, consumer group, dimensions, fingerprint, and optional static content bounds. Derive binary metadata reproducibly with build tooling; runtime catalog imports must contain no Node APIs or image-processing dependency. Read game definitions to validate coverage, without changing declaration order or rules.

Expected files:

- **New:** `src/assets/catalog.ts`, `src/assets/metadata.generated.ts`, `scripts/generate-asset-metadata.mjs`, `tests/assetCatalog.test.ts`.
- `src/scenes/BootScene.ts`, `tests/heroAssets.test.ts`, `tests/enemyAssets.test.ts`; other art/source-string integrity guards only where needed to assert catalog coverage instead.
- `scripts/perf-assets.mjs`, `package.json`, and `bun.lock` if a necessary image metadata dependency is added with Bun.
- Existing SFX/music implementation remains unchanged; retain SVG and dual-format sound behavior.

Acceptance:

- All existing hero/card/relic/potion/enemy/room/map/easter-egg image keys map to existing files with valid dimensions and no duplicate registration. Account for intentional sharing explicitly.
- Hero/enemy guards validate definitions, catalog, and actual files instead of parsing the removed literal arrays. No test passes vacuously because a source slice disappeared.
- Metadata regeneration is deterministic; a `--check` option fails for stale dimensions, fingerprints, missing files, or invalid bounds. Unknown/new assets fail visibly in tooling while runtime fallback remains usable.
- Production browser and offline asset URLs retain their relative-path behavior. Boot still eagerly loads the same groups; loading policy changes belong to 07.

前置依赖：依赖 [01-performance-baseline.md](01-performance-baseline.md)。

## T2 · Use precomputed bounds with a safe runtime fallback

Generate alpha bounds for shipped transparent actor sprites using threshold 12 and the existing inclusive edge convention. `measureSprite()` should use matching metadata without runtime `getImageData`; validate that metadata refers to the real loaded source, not a placeholder sharing a key. Scope cached fallback results to source identity/dimensions and invalidate if a texture is removed/replaced.

Expected files:

- `src/ui/spriteBounds.ts`, the T1 catalog/generator, **new** `tests/spriteBounds.test.ts` for pure metadata/geometry behavior where practical.
- **New:** `tests/performance/sprite-bounds.mjs`, `tests/performance/baselines/sprite-bounds.json` for actual Phaser/CanvasPool behavior.

Acceptance:

- Known matching sprites use no synchronous pixel read on first display; grounding and content width match baseline within rounding tolerance.
- Unknown, fully transparent, missing, or replaced textures fall back correctly. A generated placeholder cannot poison the later real asset's bounds.
- CanvasPool resources are released in `finally` when context creation, drawing, or pixel reading fails. Repeated injected failures do not increase used canvas count; a later valid texture still measures correctly.
- Cache/source invalidation and metadata checks work across scene restarts without introducing per-frame hashing or storage reads.

前置依赖：依赖本文件 T1。

## Independent validation

Run `bun run check`, `bun run build`, the generator's documented `--check` command, `bun run perf:assets`, and `bun run perf:browser --case sprite-bounds --check`. Observe title and actor screenshots; retain existing offline URL/protocol unit checks. Pass dependency changes through Bun and commit `bun.lock` when changed.
