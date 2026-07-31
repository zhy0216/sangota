import type { CombatEvent } from '../combat/types';

/**
 * 敌阵调度 — which bodies join the stage, which leave it outright, and whether
 * the line has to re-form afterwards.
 *
 * Pure, and separate from `CombatScene` for one reason: three of the four
 * events below were silently swallowed by a `default: break` for a whole phase,
 * and nothing failed. A summoned 力士 was invisible and unclickable, a split
 * 张宝 left his own corpse standing forever, and a 流寇 that fled froze
 * mid-stride — five encounters were fenced out of the map because of it. The
 * choreography (tweens, timings, dust) stays in the scene where a canvas is;
 * *what happens to the set of bodies* is decided here, where it can be tested.
 */

export interface StageChange {
  /** `EnemyState.id`s that need a body built now. */
  add: readonly string[];
  /**
   * Bodies to destroy outright. **Never a corpse** — a death is supposed to
   * leave a faded body where it fell, and only 分裂's parent and 遁走's runaway
   * are removed from the world.
   */
  drop: readonly string[];
  /**
   * Whether to re-slot the survivors.
   *
   * **Only when the living count grows.** `EnemyState.slot` exists so positions
   * stay put once a body is gone; sliding the line on a death or a 遁走 would
   * move the target out from under a click already on its way, and would leave
   * an in-flight 飘字 pointing at empty ground.
   */
  relayout: boolean;
  /**
   * Whose feet new bodies walk out of, or null for none. A summon that appears
   * pre-positioned in its final slot reads as a spawn; one that steps out of
   * its summoner reads as a summon.
   */
  spawnFrom: string | null;
}

/**
 * What one event does to the stage, or null if it does nothing to it.
 *
 * `death` is deliberately null: `playDeath` fades a corpse in place and the
 * roster keeps it. `split` is not — `splitEnemy` marks the parent `alive:
 * false` and emits **no** `death` event on purpose (a split is not a kill and
 * must not pay 斩将), so if this did not drop the parent, nothing ever would.
 */
export function stageChange(ev: CombatEvent): StageChange | null {
  switch (ev.t) {
    case 'summon':
      return { add: ev.spawned, drop: [], relayout: true, spawnFrom: ev.enemyId };
    case 'split':
      return {
        add: ev.spawned,
        drop: [ev.parentId],
        relayout: true,
        spawnFrom: ev.parentId,
      };
    case 'escape':
      return { add: [], drop: [ev.targetId], relayout: false, spawnFrom: null };
    default:
      return null;
  }
}
