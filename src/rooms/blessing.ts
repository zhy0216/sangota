import type { Rng } from '../core/rng';
import { getRelic } from '../combat/relics';
import { rollRelicOfTier } from '../combat/rewards';
import { addGold, addRelic, type BlessingOffer, type BlessingState, type RunState } from '../state/run';
import {
  BLESSINGS_BY_CATEGORY,
  BLESSING_CATEGORY_LABEL,
  BLESSING_CATEGORY_ORDER,
  costsFor,
  getBlessing,
  getBlessingCost,
  type BlessingCategory,
  type BlessingDef,
} from '../data/blessings';
import type { EventOutcome } from '../data/events';
import { applyOutcome, applyPick, type OutcomeReport } from './events';
import { runStream } from './rng';
import type { DeckPick } from './types';

/**
 * 开局祝福 — the rules half. 「拜别 · 出征前夜」: four gifts, one taken, before
 * the player has walked a single step.
 *
 * **It does not live on a node, and that is a deliberate design decision, not
 * an omission.** `roomRecord(run, 'neow', 'event')` throws — there is no such
 * node — and `RoomRecord` is a union tagged by *map node type*. So the ledger
 * this screen keeps is `run.blessing` (`src/state/run.ts`), and the one-shot
 * gate that `commit.once` provides everywhere else is `takenId !== null` here.
 *
 * The three stream rules, restated for a decision made off the map:
 *
 * **R3** — `rollBlessings` draws exactly `BLESSING_DRAWS` times, always. The
 * 无所求 pool holds one entry and still burns its `int`, the same way
 * `ensureEvent` does against an empty pool: the day a second 无所求 lands, every
 * existing seed must keep the 祝福 it was already shown.
 *
 * **R5** — the four-up is materialised into `run.blessing.offered` the first
 * time the screen is entered and only read afterwards. A seeded stream alone is
 * not enough: `rollRelicOfTier` and `poolFor` both filter against what the run
 * already holds, so a re-roll after a take would deal something else.
 *
 * **R6** — only ids are stored. No `Rng`, no cursor, no resolved outcome — a
 * saved outcome would be a save that disagrees with the table it came from.
 */

/**
 * Draws `rollBlessings` takes. Constant by construction, and asserted as the
 * literal 5 in `tests/blessing.test.ts` — the same treatment `SHOP_DRAWS` gets.
 *
 * 薄礼 1 · 厚赠 1 · 交易(收益) 1 · 交易(代价) 1 · 无所求 1.
 */
export const BLESSING_DRAWS = 5;

/**
 * What a dry 首领 shelf pays instead. Matches `RELIC_MISS_GOLD.boss`, and is a
 * constant rather than a roll for the same reason that one is (R3).
 */
export const BOSS_RELIC_CONSOLATION = 120;

// ------------------------------------------------------------------ rolling

/** One draw, spent whether or not the pool had anything in it. */
function drawFrom<T>(rng: Rng, pool: readonly T[]): T | undefined {
  const at = rng.int(Math.max(1, pool.length));
  return pool[at];
}

/**
 * The four-up: one from each class, and the 交易's price.
 *
 * Draw order is fixed by *category order*, never by what came out — 薄礼, 厚赠,
 * 交易收益, 交易代价, 无所求. `costsFor` narrows the price pool against the
 * benefit that was just drawn, which is a filter and not a re-roll: the count
 * stays at one however many prices the benefit admits.
 */
export function rollBlessings(rng: Rng): BlessingOffer[] {
  const offers: BlessingOffer[] = [];
  for (const category of BLESSING_CATEGORY_ORDER) {
    const def = drawFrom(rng, BLESSINGS_BY_CATEGORY[category]);
    if (category !== 'trade') {
      if (def) offers.push({ id: def.id, costId: null });
      continue;
    }
    // 交易 is two draws in one line: the benefit, then a price chosen from the
    // ones that benefit admits. Both come off this stream, in this order.
    const cost = drawFrom(rng, def ? costsFor(def) : []);
    if (def) offers.push({ id: def.id, costId: cost?.id ?? null });
  }
  return offers;
}

/** R5 — rolled on first sight, read back forever after. */
export function ensureBlessing(run: RunState): BlessingState {
  if (run.blessing) return run.blessing;
  run.blessing = {
    offered: rollBlessings(runStream(run, 'blessing')),
    takenId: null,
    pending: null,
  };
  return run.blessing;
}

// -------------------------------------------------------------------- views

/** One button on the 祝福 screen. `cost` is the cinnabar line, or null. */
export interface BlessingView {
  id: string;
  category: BlessingCategory;
  /** 薄礼 / 厚赠 / 交易 / 无所求. */
  categoryLabel: string;
  label: string;
  desc: string;
  cost: string | null;
}

export function blessingViews(run: RunState): BlessingView[] {
  return ensureBlessing(run).offered.flatMap((offer) => {
    const def = getBlessing(offer.id);
    if (!def) return [];
    const cost = offer.costId ? getBlessingCost(offer.costId) : undefined;
    return [
      {
        id: def.id,
        category: def.category,
        categoryLabel: BLESSING_CATEGORY_LABEL[def.category],
        label: def.label,
        desc: def.desc,
        cost: cost?.desc ?? null,
      },
    ];
  });
}

export const blessingTaken = (run: RunState): string | null => run.blessing?.takenId ?? null;

/** The deck pick the taken 祝福 bought and has not been answered yet. */
export const blessingPending = (run: RunState): DeckPick | null => run.blessing?.pending ?? null;

/** True once the screen has nothing left to ask. */
export const blessingSettled = (run: RunState): boolean =>
  !!run.blessing?.takenId && !run.blessing.pending;

// -------------------------------------------------------------------- taking

/**
 * Benefit and price as one outcome.
 *
 * Merged rather than applied twice so that `applyOutcome`'s own ordering — the
 * purse is emptied before it is filled, a 体力上限 gain heals before a wound
 * bites — governs the pair as well. Two sequential calls would have let 淬体 +
 * 割股 charge 一成 of the *pre-gain* total, which reads as the game shortchanging
 * the player on the one option that visibly raises the number first.
 *
 * The benefit's narration wins: a price has no story of its own, only a line in
 * cinnabar under the button.
 */
function outcomeOf(def: BlessingDef, costId: string | null): EventOutcome {
  const cost = costId ? getBlessingCost(costId) : undefined;
  if (!cost) return def.outcome;
  return { ...def.outcome, ...cost.outcome, text: def.outcome.text };
}

/**
 * Take one. `null` means the take was refused — an unknown id, an id that was
 * not on this run's four-up, or a 祝福 already taken — and in every one of those
 * cases `run` is left untouched.
 *
 * Everything random happens here and **never in `startRun`**: 37 golden
 * snapshots build their decks through that function, and one extra draw inside
 * it invalidates all of them at once.
 *
 * Draw order on the `blessingTake` stream, fixed by declaration:
 * branch → relic → potions → cards (all inside `applyOutcome`) → 首领宝物.
 */
export function takeBlessing(run: RunState, id: string): OutcomeReport | null {
  const state = ensureBlessing(run);
  // The one-shot gate. `commit.once` cannot be used — it is keyed by node id,
  // and this screen has no node — so the door is the field itself.
  if (state.takenId) return null;
  const offer = state.offered.find((o) => o.id === id);
  const def = offer ? getBlessing(offer.id) : undefined;
  if (!offer || !def) return null;

  const rng = runStream(run, 'blessingTake');
  const report = applyOutcome(run, outcomeOf(def, offer.costId), rng);
  if (def.bossRelic) grantBossRelic(run, rng, report);

  state.takenId = def.id;
  state.pending = report.pending ?? null;
  return report;
}

/**
 * 虎符 — the one grant `EventOutcome` cannot express, because `EventRelicTier`
 * closes the 首领 pool off from every 奇遇 on purpose and widening it would open
 * that door for all twelve of them.
 *
 * Exactly one draw, spent against the pool whether or not it had anything in it
 * (R3), and last in the order so that adding a card grant to some future 交易
 * cannot move it.
 */
function grantBossRelic(run: RunState, rng: Rng, report: OutcomeReport): void {
  const wanted = rollRelicOfTier(rng, run, 'boss');
  if (wanted && addRelic(run, wanted)) {
    report.relicId = wanted;
    report.lines.push(`得宝物「${getRelic(wanted)?.name ?? wanted}」。`);
    return;
  }
  // Measured, not assumed: `addGold` scales income by the 资财 multiplier, and
  // the same take could have handed over a relic that carries one.
  const before = run.gold;
  addGold(run, BOSS_RELIC_CONSOLATION);
  const paid = run.gold - before;
  report.relicRefused = true;
  report.gold += paid;
  report.lines.push('库中已无可取之物，折作资财。', `资财 +${paid}。`);
}

// ------------------------------------------------------------------- pending

/**
 * The 祝福 half of a deck pick — 弃芜 / 精简 / 锻炼 / 易牌.
 *
 * The body is `applyPick`, shared with the node path (`resolvePending`); only
 * the door differs, and each path carries its own. Cleared *before* the pick is
 * applied so that a double-click on the grid's confirm cannot spend it twice.
 *
 * 易牌 draws once per card exchanged, off its own `blessingTransform` stream —
 * physically apart from `blessingTake` so that what a 祝福 paid out and what a
 * transform rolled can never shift each other.
 */
export function resolveBlessingPick(run: RunState, uids: readonly string[]): boolean {
  const state = run.blessing;
  const pick = state?.pending;
  if (!state || !pick) return false;
  state.pending = null;
  applyPick(
    run,
    pick,
    uids,
    pick.kind === 'transform' ? runStream(run, 'blessingTransform') : undefined,
  );
  return true;
}
