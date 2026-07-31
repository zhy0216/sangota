import { addGold, type RunState } from '../state/run';
import { roomCommit, roomRecord } from './commit';
import { stream } from './rng';
import type { ChestLoot, TreasureReport } from './types';

/**
 * 宝藏 — the simplest room there is, and therefore the one the whole room shell
 * is proved against.
 *
 * The gold roll is deliberately the *first* draw on the `loot` stream and must
 * stay there: todo 10 appends the relic and potion rolls behind it, and a chest
 * opened on a given seed has to pay the same coin before and after that lands.
 */

/**
 * R5 — rolled on first sight, then read back forever. Splitting this out from
 * `openTreasure` is what will let todo 10 show the chest's contents before the
 * player commits to opening it.
 */
export function ensureLoot(run: RunState, nodeId: string): ChestLoot {
  const record = roomRecord(run, nodeId, 'treasure');
  if (record.loot) return record.loot;
  const rng = stream(run, nodeId, 'loot');
  // Draw #1 on this stream. Frozen — see the module comment.
  const gold = rng.range(25, 45);
  // todo 10 fills these from the same stream, appended *after* the gold roll.
  record.loot = { gold, relicId: null, potionId: null };
  return record.loot;
}

/** null means the chest was already open — a second call pays nothing. */
export function openTreasure(run: RunState, nodeId: string): TreasureReport | null {
  return (
    roomCommit(run, nodeId).once('open', (): TreasureReport => {
      const loot = ensureLoot(run, nodeId);
      // What the player actually banked, 招财-style multipliers included.
      const before = run.gold;
      addGold(run, loot.gold);
      return {
        gold: run.gold - before,
        relicId: null,
        potionId: null,
        potionRefused: false,
      };
    }) ?? null
  );
}
