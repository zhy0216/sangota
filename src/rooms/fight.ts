import { ACT1, getEncounter, pickEncounter, type CombatTier } from '../combat/enemies';
import { RELIC_MISS_GOLD } from '../combat/relics';
import { rollBossOffer, rollRelic } from '../combat/rewards';
import type { Encounter } from '../combat/types';
import { addGold, addRelic, type RunState } from '../state/run';
import { roomCommit, roomRecord } from './commit';
import { stream } from './rng';

/**
 * 战斗房 — the rules half of a combat node.
 *
 * `CombatScene` cannot own any of this. It imports Phaser, so nothing in it is
 * reachable from a test, and every decision it made inline was therefore
 * unverifiable: which fight the node carries, which relic an elite drops, which
 * three 首领 relics the 战利品 chest shows. All three now live here, beside the
 * other four room modules and under the same three rules (`src/rooms/rng.ts`):
 *
 * **R3.** A purpose draws a constant number of times. `ensureEncounter` spends
 * exactly one draw on `encounter` no matter how far the act's pool has been
 * eaten into; `claimVictoryRelic` spends exactly `RELIC_ROLL_DRAWS` on
 * `eliteRelic`; `ensureBossOffer` spends exactly `BOSS_OFFER_DRAWS` on
 * `bossRelic`.
 *
 * **R5.** Materialise once. The encounter and the 首领 offer are written into
 * the node's record on first sight and read back forever after. This is not
 * optional here: `pickEncounter` filters against `run.usedEncounters`, so a
 * second `create()` on the same node — a scene restart today, a reloaded save
 * once todo 08 lands — would otherwise pick a *different* fight than the one
 * the player walked into.
 *
 * **One payout per node.** Every grant goes through `commit.once`, the same
 * gate the shop counter and the event options use.
 */

/** Read back a materialised encounter, or pick this node's fight and freeze it. */
export function ensureEncounter(run: RunState, nodeId: string, tier: CombatTier): Encounter {
  const record = roomRecord(run, nodeId, 'combat');
  if (record.encounterId) return getEncounter(record.encounterId);

  const encounter = pickEncounter(stream(run, nodeId, 'encounter'), ACT1, tier, {
    combatCount: run.actCombatCount,
    used: run.usedEncounters,
  });

  record.encounterId = encounter.id;
  run.usedEncounters.push(encounter.id);
  // Counted on entry rather than on victory: a fight the player walked into is
  // spent whether or not they survived it, and there is no run left to tally
  // against if they did not. `weakCount` is therefore "the first three normal
  // rooms an act opens", which is what the table's comment promises.
  if (tier === 'monster') run.actCombatCount += 1;
  return encounter;
}

/**
 * The relic a won fight owes, or null.
 *
 * Two sources, and deliberately one gate over both: an 精英 drops one by tier
 * (`RELIC_DROP_WEIGHTS.elite`), and an 奇遇 that sent the player into a fight
 * may have promised a named one (`EventOutcome.fight.bonusRelic`). A named
 * relic wins — it was already described to the player in the event's own
 * result lines — and no roll is spent on top of it.
 *
 * A dry pool pays `RELIC_MISS_GOLD.elite` rather than nothing, and says so
 * through `refused` so the screen can print a different line.
 */
export interface VictoryRelic {
  relicId: string | null;
  /** A relic was owed and every shelf the ladder reaches was bare. */
  refused: boolean;
  /** The consolation actually banked, multipliers included; 0 when a relic landed. */
  gold: number;
}

export function claimVictoryRelic(
  run: RunState,
  nodeId: string,
  tier: CombatTier,
  bonusRelic?: string | null,
): VictoryRelic | null {
  if (tier !== 'elite' && !bonusRelic) return null;

  return (
    roomCommit(run, nodeId).once('relic', (): VictoryRelic => {
      if (bonusRelic) {
        const took = addRelic(run, bonusRelic);
        return { relicId: took ? bonusRelic : null, refused: !took, gold: 0 };
      }

      const rng = stream(run, nodeId, 'eliteRelic');
      const id = rollRelic(rng, run, 'elite');
      const record = roomRecord(run, nodeId, 'combat');
      if (id && addRelic(run, id)) {
        record.relicId = id;
        return { relicId: id, refused: false, gold: 0 };
      }
      const before = run.gold;
      addGold(run, RELIC_MISS_GOLD.elite);
      return { relicId: null, refused: true, gold: run.gold - before };
    }) ?? null
  );
}

/**
 * 夺财 — the run-side half of an enemy's `steal`.
 *
 * 约定 8: the engine never touches `RunState`, so a theft leaves the fight as a
 * `CombatEvent` and lands here. `index` is *how many thefts this fight has
 * already reported*, which makes it the idempotency key for free — the same
 * seed replays the same steals in the same order, so `steal:0` is always the
 * same theft. A scene restart mid-fight therefore cannot charge twice, and two
 * thieves in one fight are still charged separately.
 *
 * Returns what was actually taken, which may be less than `amount` — `addGold`
 * floors the purse at zero, and 流寇 asking for 30 off a purse holding 12 takes
 * 12. The caller prints that number, not the one the move declared.
 */
export function payTheft(run: RunState, nodeId: string, index: number, amount: number): number {
  const take = Math.max(0, amount);
  return (
    roomCommit(run, nodeId).once(`steal:${index}`, (): number => {
      const before = run.gold;
      addGold(run, -take);
      return before - run.gold;
    }) ?? 0
  );
}

/**
 * The three 首领 relics on offer, rolled once and then frozen on the run.
 *
 * Parked on `RunState` rather than on the node record because the 战利品 chest
 * outlives the fight that filled it — todos/09 opens it between acts, on a
 * screen that has no node of its own.
 */
export function ensureBossOffer(run: RunState, nodeId: string): string[] {
  if (run.bossRelicOffer) return run.bossRelicOffer;
  run.bossRelicOffer = rollBossOffer(stream(run, nodeId, 'bossRelic'), run);
  return run.bossRelicOffer;
}

/** True while the 战利品 chest still owes an answer. Read-only — no roll, no mark. */
export const bossOfferPending = (run: RunState, nodeId: string): boolean =>
  !roomCommit(run, nodeId).isDone('bossRelic');

/**
 * Take one of the three, or decline for the 宝钥. `null` means the chest was
 * already answered — a second click pays nothing, and cannot turn a relic that
 * was taken into a key.
 *
 * Declining is a real choice rather than a forfeit: todos/09 spends 宝钥 on the
 * 终章 door, so 「不取」 is trading this act's relic for the next act's room.
 */
export function takeBossRelic(run: RunState, nodeId: string, relicId: string | null): boolean {
  const offer = ensureBossOffer(run, nodeId);
  if (relicId !== null && !offer.includes(relicId)) return false;

  return (
    roomCommit(run, nodeId).once('bossRelic', (): boolean => {
      if (relicId === null) {
        run.keys.sapphire = true;
        return true;
      }
      addRelic(run, relicId);
      roomRecord(run, nodeId, 'combat').relicId = relicId;
      return true;
    }) ?? false
  );
}
