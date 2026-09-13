difficulty: medium
agent: inherit

# Generate display-sized runtime textures

Priority: P1. One worktree and one final commit. This task prepares assets and catalog mappings; 07 wires the menu background and staged consumers into scenes.

## T1 · Reduce excessive source dimensions without changing the art

Use 01's dimensions/budgets and 04's catalog to generate reproducible runtime derivatives. Prioritize the 3072 × 5504 map, full-screen backdrops, and oversized actor sources; only shrink card art after checking the largest hover/preview consumer. Respect render scales 1/2/3, aspect ratio, alpha, ground position, and maximum supported texture dimensions. Preserve original artwork and document each source-to-output mapping and processing parameter.

Create a viewport/menu background derived from the existing map's cover crop rather than requiring the entire scrolling map for Title/Custom/Compendium. Keep the scrolling map's coordinate and crop semantics. Prepare the new catalog key without editing Compendium or other menu scenes; those scene edits belong to 07 so this task can run in parallel with 05.

Expected files:

- **New:** `scripts/prepare-runtime-assets.mjs`, `public/assets/runtime/` derivatives and deterministic processing configuration if needed.
- `src/assets/catalog.ts`, `src/assets/metadata.generated.ts`, `scripts/generate-asset-metadata.mjs`, `scripts/perf-assets.mjs` from 04.
- `package.json`, `bun.lock` if tooling requires a dependency or script.
- **New:** `tests/performance/texture-sizes.mjs`, `tests/performance/baselines/texture-sizes.json`; update catalog guards if needed.
- Read-only consumers: `src/config.ts`, `src/ui/CardView.ts`, `src/ui/spriteBounds.ts`, `src/scenes/MapScene.ts`, and menu scenes. Scene integration is explicitly deferred to 07.

Acceptance:

- Re-running generation produces the same dimensions/content metadata; `--check` detects stale derivatives. Regenerate alpha bounds against derivative pixels and retain source fingerprints.
- The selected runtime files meet the frozen dimension/pixel budgets while large card previews, Chinese text, transparency, actor feet, and map crop remain visually consistent at render scales 1/2/3.
- No texture exceeds the declared supported maximum dimension; document the tested limit and fallback choices instead of assuming a desktop GPU cap.
- Report compressed bytes, decoded pixel estimates, and distribution size separately. Preserving source files can enlarge the shipped directory; do not claim a smaller package based only on active textures. Avoid publishing duplicate requests for original and derived artwork.
- Do not generate new art, change game layout/render-scale settings, or overwrite the only source copy. The menu derivative can be previewed by the test harness, but Title/Custom/Compendium switch to it in 07.

前置依赖：依赖 [04-asset-catalog-and-bounds.md](04-asset-catalog-and-bounds.md)。

## Independent validation

Run the generator check, `bun run perf:assets`, `bun run check`, `bun run build`, and `bun run perf:browser --case texture-sizes --check`. Inspect side-by-side screenshots for map, title crop, hero/enemy grounding, and full-size card previews. Use Bun and commit `bun.lock` if changed.
