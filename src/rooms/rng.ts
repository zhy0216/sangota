import { Rng } from '../core/rng';
import type { RunState } from '../state/run';

/**
 * 房间随机流 — one decision point, one stream.
 *
 * Three rules hold this together, and every room module is held to them by
 * `tests/rooms.*.test.ts`:
 *
 * **R3 — a purpose draws a constant number of times.** How many times a stream
 * is pulled must not depend on what it rolled. An empty pool still burns its
 * `int` before degrading, the way `CombatScene.rollPotionDrop` rolls the bottle
 * id whether or not the drop landed. Otherwise adding one relic to a table
 * reshuffles every seed downstream of it.
 *
 * **R5 — materialise once.** Anything shown before it is consumed is written
 * into `run.rooms[nodeId]` on first entry and only read afterwards. A seeded
 * stream is *not* sufficient: `generateStock` filters relics the player already
 * owns, so re-rolling after a purchase produces a different third relic.
 *
 * **R6 — no cross-node cursors.** Never park an `Rng` instance or a
 * `getState()` cursor in `RunState`. A node's stream is derived from the seed
 * and the node id, and from nothing else.
 */

/**
 * Closed enum — append only, never rename. Renaming a purpose silently
 * re-rolls every existing seed at that decision point.
 *
 * | purpose      | draws            |
 * |--------------|------------------|
 * | `encounter`  | 1                |
 * | `combat`     | varies (shuffle / hp / intents — inherently so) |
 * | `reward`     | existing, frozen |
 * | `potion`     | existing, frozen |
 * | `loot`       | 1 now, 7 once todo 10 lands — the gold roll stays first |
 * | `shop`       | 31               |
 * | `event`      | 1                |
 * | `eventBranch:{n}` | 1 per branch taken |
 * | `eliteRelic` | 2                |
 * | `bossRelic`  | 6                |
 */
export type Purpose =
  | 'encounter'
  | 'combat'
  | 'reward'
  | 'potion'
  | 'loot'
  | 'shop'
  | 'event'
  | 'eliteRelic'
  | 'bossRelic'
  | `eventBranch:${number}`;

/**
 * The seed string behind a stream. Exposed because `startCombat` wants a seed
 * rather than a generator, and the two must agree byte for byte.
 */
export const streamSeed = (run: RunState, nodeId: string, purpose: Purpose): string =>
  `${run.map.seed}:${nodeId}:${purpose}`;

export const stream = (run: RunState, nodeId: string, purpose: Purpose): Rng =>
  new Rng(streamSeed(run, nodeId, purpose));
