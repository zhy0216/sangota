difficulty: medium
agent: inherit

# Keep settings in a coherent session snapshot

Priority: P2. One worktree and one final commit.

## T1 · Remove repeated storage reads from timing and settings consumers

Change `getSettings()` in `src/state/settings.ts` to initialize a sanitized session snapshot once, returning defensive copies so callers cannot mutate shared state. Prefer lazy initialization within this module to avoid changing `src/main.ts` and avoid a `config` import cycle. Merge updates into the snapshot before attempting persistence, then notify subscribers from the same committed in-memory value. Preserve defaults, version merging, nested key bindings, no-op update suppression, and legacy audio migration.

Handle real external `storage` updates/removal and an explicit session/test reset; do not silently reread storage on every call. Remove stale documentation in settings/timing that demands uncached reads. Tests that replace fake storage must explicitly reset or initialize the session instead of depending on hidden storage replacement detection.

Expected files:

- `src/state/settings.ts`, `src/ui/timing.ts`.
- `tests/settings.test.ts`, `tests/timing.test.ts`, `tests/sfx.test.ts`, `tests/confirm.test.ts`, and other existing settings consumers only where their fake-storage lifecycle requires explicit reset.
- **New:** `tests/performance/settings.mjs`, `tests/performance/baselines/settings.json` if browser evidence is useful.
- Do not change `package.json`, `bun.lock`, `src/main.ts`, the audio API, or unrelated save ledgers.

Acceptance:

- After one initialization, 10,000 `dur`/`skipDecor`/`shakeIntensity` queries cause zero additional localStorage reads or settings JSON parses. Verify as an observable I/O budget, not a timing assertion.
- A rejected write still changes subsequent getters, timing, and subscriber snapshots for the current session. Reinitializing a fresh session observes whatever was actually persisted.
- Getters/subscriber callbacks cannot mutate the snapshot or another listener's copy. Unchanged updates neither write nor broadcast.
- Legacy migration, missing/broken/throwing storage, invalid fields, nested key merging, unsubscribe behavior, external updates/removal, and resets have meaningful regression coverage.
- Animation-speed changes take effect on the next lookup; render scale retains its existing reload requirement. Audio and settings UI remain consistent.

前置依赖：依赖 [01-performance-baseline.md](01-performance-baseline.md)。

## Independent validation

Run focused settings/timing/audio/confirmation tests with `bun run test`, then `bun run check`. Use the 01 harness for a live settings change if necessary. Do not run balance simulations for a settings-only change.
