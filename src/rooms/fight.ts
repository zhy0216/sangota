import { getEncounter, pickEncounter, type CombatTier } from '../combat/enemies';
import { POTION_DROP, nextPotionChance, rollPotion } from '../combat/potions';
import { RELIC_MISS_GOLD, relicModifiers } from '../combat/relics';
import { rollBossOffer, rollCardReward, rollRelic } from '../combat/rewards';
import type { Encounter } from '../combat/types';
import { actOf } from '../data/acts';
import {
  addCard,
  addGold,
  addPotion,
  addRelic,
  hasPotionSpace,
  removePotion,
  type RunState,
} from '../state/run';
import { roomCommit, roomRecord } from './commit';
import { stream } from './rng';
import type { Spoils } from './types';

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

/**
 * The ledger id for a fight an 奇遇 started.
 *
 * An event node's record is a `{ kind: 'event' }` one from the moment the
 * player steps on it, and `roomRecord(..., 'combat')` **throws** on a mismatched
 * kind by design. So a fight run against the event's own node id took the
 * player's map away (`goCombat` stops 「Map」 before starting 「Combat」) and then
 * threw inside `create()` before a single Game Object existed: black screen,
 * run gone. 江东赴宴's 「单刀赴之」 and 山中残兵's 25% ambush both did it, and
 * 山中残兵 is `minRow: 1` and repeatable, so it was reachable in 第一幕.
 *
 * A derived id rather than a reused one, because the two rooms are genuinely
 * separate decisions and each owes its own commits: the event has already paid
 * out its relic and its lines, and the fight still owes an encounter, spoils
 * and possibly an 精英 relic. `#` cannot appear in a real node id (`row_col` or
 * the literal `boss`) or in a `Purpose`, so the derived id collides with
 * nothing — including in `streamSeed`, where it simply reads as a node the map
 * does not have.
 */
export const eventFightNodeId = (nodeId: string): string => `${nodeId}#fight`;

/**
 * Read back a materialised encounter, or pick this node's fight and freeze it.
 *
 * The table comes from `actOf(run)`, never from a constant: a node id repeats
 * every act (`3_2` exists in all of them), and so does the literal `boss`, so
 * the *only* thing that says which act's fights a node draws from is `run.act`.
 * Reading back is by id across every act, which is what lets a materialised
 * record survive even if a fight is later moved between acts.
 */
export function ensureEncounter(run: RunState, nodeId: string, tier: CombatTier): Encounter {
  const record = roomRecord(run, nodeId, 'combat');
  if (record.encounterId) return getEncounter(record.encounterId);

  const encounter = pickEncounter(stream(run, nodeId, 'encounter'), actOf(run).table, tier, {
    combatCount: run.actCombatCount,
    used: run.usedEncounters,
  });

  record.encounterId = encounter.id;
  run.usedEncounters.push(encounter.id);
  // Counted on entry rather than on victory: a fight the player walked into is
  // spent whether or not they survived it, and there is no run left to tally
  // against if they did not. `weakCount` is therefore "the first N normal rooms
  // *this* act opens" — 3 in 第一幕, 2 after that — and `clearActProgress`
  // resets the counter at the seam so every act gets its own ramp.
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
 * outlives the fight that filled it: `advanceAct` asserts this commit before
 * it wipes the ledger, so declining for the 宝钥 survives the act change that
 * the decline is *for*.
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
 * Take one of the three, or decline. `null` means the chest was already
 * answered — a second click pays nothing, and cannot turn a relic that was
 * taken into a key.
 *
 * Declining in 第三幕 mints the 宝钥 — the only key to the 终章 door
 * (`actExit`, `src/data/acts.ts`) — so the final 「不取」 trades that act's
 * relic for a whole extra act. In 第一幕/第二幕 declining is a pure pass:
 * every 首领 relic carries a downside, and walking away empty-handed is a
 * legal read of the table, but it pays nothing and promises nothing. The act
 * gate lives here rather than in `actExit` so the key can never sit latent
 * on a run that "earned" it two acts early.
 */
export function takeBossRelic(run: RunState, nodeId: string, relicId: string | null): boolean {
  const offer = ensureBossOffer(run, nodeId);
  if (relicId !== null && !offer.includes(relicId)) return false;

  return (
    roomCommit(run, nodeId).once('bossRelic', (): boolean => {
      if (relicId === null) {
        if (run.act === 3) run.keys.sapphire = true;
        return true;
      }
      addRelic(run, relicId);
      roomRecord(run, nodeId, 'combat').relicId = relicId;
      return true;
    }) ?? false
  );
}

// ------------------------------------------------------------------ 战利品

/**
 * What a won fight pays: coin, the cards to choose from, and the 丹药 roll.
 *
 * All three used to be rolled inline on `CombatScene`'s victory screen, outside
 * `commit.once` and materialised nowhere — the only room in the game that
 * showed the player a random result it could not write down (R5). `addGold`,
 * `rollCardReward` (which moves `run.rareBump`) and the drop roll (which moves
 * `run.potionChance`) all landed on every `create()`, so re-entering a won node
 * paid a second time *and* shifted the odds of every later fight. The relic two
 * lines below it was gated, which is what makes the omission an oversight
 * rather than a decision.
 *
 * Draw order is frozen and matches what the screen used to do exactly: the
 * `reward` stream rolls gold and then the cards, and the `potion` stream is its
 * own so that adding or removing a drop cannot shift either.
 *
 * The cards are *offered*, not granted — `takeCardReward` is the second half.
 */
export function claimSpoils(
  run: RunState,
  nodeId: string,
  tier: CombatTier,
  encounter: Encounter,
): Spoils {
  const record = roomRecord(run, nodeId, 'combat');
  const paid = roomCommit(run, nodeId).once('spoils', (): Spoils => {
    const rng = stream(run, nodeId, 'reward');
    const gold = rng.range(encounter.goldReward[0], encounter.goldReward[1]);
    const cardIds = rollCardReward({ tier, run, rng });
    const potionId = rollPotionDrop(run, nodeId, tier);

    addGold(run, gold);
    const spoils: Spoils = { gold, cardIds, potionId };
    record.spoils = spoils;
    return spoils;
  });

  // Read back on every later visit — the frozen record, never a re-roll.
  return paid ?? record.spoils ?? { gold: 0, cardIds: [], potionId: null };
}

/**
 * The 丹药 that dropped, or null.
 *
 * The id is rolled whether or not the drop landed (R3), so one relic that
 * changes the drop rate cannot reshuffle which bottle every later fight offers.
 * `potionChance` only drifts on a 杂兵 fight: 精英 and 首领 have fixed rates, so
 * banking elite kills must not be able to dry a monster-fight streak out.
 */
function rollPotionDrop(run: RunState, nodeId: string, tier: CombatTier): string | null {
  const rng = stream(run, nodeId, 'potion');
  const chance =
    tier === 'elite' ? POTION_DROP.elite : tier === 'boss' ? POTION_DROP.boss : run.potionChance;

  const dropped = rng.int(100) < chance;
  if (tier === 'monster') run.potionChance = nextPotionChance(run.potionChance, dropped);
  const id = rollPotion(rng);
  return dropped ? id : null;
}

/**
 * Take one of the offered cards, or decline. `null` declines — which 歌钵 turns
 * into 体力上限 rather than nothing, so it is a real choice and has to be paid
 * through the same gate.
 *
 * Gated because it is one payout per fight: `CombatScene.claimed` only guards a
 * double click *within one scene instance*, and dies with the scene.
 */
export function takeCardReward(run: RunState, nodeId: string, cardId: string | null): boolean {
  const offered = roomRecord(run, nodeId, 'combat').spoils?.cardIds ?? [];
  if (cardId !== null && !offered.includes(cardId)) return false;

  return (
    roomCommit(run, nodeId).once('cardReward', (): boolean => {
      if (cardId !== null) {
        addCard(run, cardId);
        return true;
      }
      const skip = relicModifiers(run.relics).skipRewardMaxHp;
      if (skip > 0) {
        run.maxHp += skip;
        run.hp += skip;
      }
      return true;
    }) ?? false
  );
}

/**
 * Put the dropped bottle on the belt.
 *
 * `slot` is the bottle to pour away for it, or null to take it only if the belt
 * has room. Declining with a full belt therefore leaves the gate *open* — the
 * player has not answered yet, and the swap prompt is still to come — which is
 * why the space check sits outside `once` rather than inside it: `once` marks
 * before it runs, so an early return from inside would burn the key.
 *
 * Returns whether the bottle actually landed.
 */
export function takePotionDrop(
  run: RunState,
  nodeId: string,
  potionId: string,
  slot: number | null = null,
): boolean {
  if (slot === null && !hasPotionSpace(run)) return false;
  return (
    roomCommit(run, nodeId).once('potionDrop', (): boolean => {
      if (slot !== null) removePotion(run, slot);
      return addPotion(run, potionId);
    }) ?? false
  );
}

/** 「放弃新瓶」 — answer the drop without taking it, so it cannot be taken later. */
export function declinePotionDrop(run: RunState, nodeId: string): void {
  roomCommit(run, nodeId).mark('potionDrop');
}
