import { rollChestExtras } from '../combat/rewards';
import { addGold, addPotion, addRelic, hasPotionSpace, type RunState } from '../state/run';
import { roomCommit, roomRecord } from './commit';
import { stream } from './rng';
import type { ChestLoot, TreasureReport } from './types';

/**
 * 宝藏 — the simplest room there is, and therefore the one the whole room shell
 * is proved against.
 *
 * The gold roll is deliberately the *first* draw on the `loot` stream and must
 * stay there: the relic and potion rolls sit behind it, so a chest opened on a
 * given seed pays the same coin it paid before relics existed. The seven draws
 * this stream now spends are `1 + CHEST_EXTRA_DRAWS`, and that total is a
 * constant whatever the chest turned out to hold (R3, `src/rooms/rng.ts`).
 */

/**
 * R5 — rolled on first sight, then read back forever. Split out from
 * `openTreasure` so the view can show what is in the chest before the player
 * commits to taking it, and so a second visit cannot re-roll the contents
 * against a relic pool the first visit already narrowed.
 */
export function ensureLoot(run: RunState, nodeId: string): ChestLoot {
  const record = roomRecord(run, nodeId, 'treasure');
  if (record.loot) return record.loot;

  const rng = stream(run, nodeId, 'loot');
  // Draw #1 on this stream. Frozen — see the module comment.
  const gold = rng.range(25, 45);
  // Draws #2-#7, in `rollChestExtras`' own fixed order.
  const extras = rollChestExtras(rng, run);

  record.loot = {
    size: extras.size,
    // A dry relic pool pays its size-matched consolation on top of the coin the
    // chest was already worth, rather than the chest quietly being smaller.
    gold: gold + extras.gold,
    relicId: extras.relicId,
    potionId: extras.potionId,
  };
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

      // `addRelic` refuses a duplicate. It cannot be one — `rollChestExtras`
      // filters what the run already holds — but the chest was frozen on first
      // sight and an 奇遇 between then and now could have handed over the same
      // relic, so the report says what landed rather than what was rolled.
      const relicId = loot.relicId && addRelic(run, loot.relicId) ? loot.relicId : null;

      // Asked before taking: `addPotion` returning false is the only signal the
      // belt was full, and the bottle has to be named in the report either way.
      const potionRefused = !!loot.potionId && !hasPotionSpace(run);
      const potionId = loot.potionId && addPotion(run, loot.potionId) ? loot.potionId : null;

      return {
        gold: run.gold - before,
        relicId,
        potionId,
        potionRefused,
      };
    }) ?? null
  );
}
