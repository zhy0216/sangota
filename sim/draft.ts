import { CARDS } from '../src/combat/cards';
import type { CardDef, Effect, StatusId } from '../src/combat/types';
import type { Rng } from '../src/core/rng';
import type { DeckCard, RunState } from '../src/state/run';

/**
 * 选牌策略 — the half of this game's skill that `sim/policy.ts` cannot see.
 *
 * `Policy` decides which card to play out of a hand that has already been
 * dealt. Everything upstream of that — which reward to take, which to refuse,
 * which copy to forge — was a uniform `rng.pick` in `buildKit`, deliberately
 * (「a band is about the average run, not the ceiling」). That under-statement
 * is fine for measuring *fights*, and it is exactly why the gauntlet could not
 * measure *players*: 2026-08-06 三个出牌策略在五重以上收敛到统计噪声内
 * （greedy/threat/adaptive 在十重是 22/20/23%，差值 z<1.2），because a run
 * walked with a scripted kit is decided by the kit, not by the play.
 *
 * So the draft becomes a policy too, and the gauntlet can cross the two:
 * 「会打牌」 against 「会选牌」, and which of the two moves the number more.
 *
 * The scoring here is deliberately crude and **static** — it reads a `CardDef`
 * and nothing else, no synergy, no deck context beyond one median. A good
 * drafter in a deckbuilder is mostly someone who *refuses* mediocre cards, and
 * that single behaviour is what this models. A cleverer evaluator would measure
 * a better player; it would not change the question being asked.
 */

export type DraftPolicyName = 'uniform' | 'curated';

export interface DraftPolicy {
  name: DraftPolicyName;
  /** Which of the offered ids to take, or null to refuse the reward outright. */
  pick(run: RunState, offered: readonly string[], rng: Rng): string | null;
  /** Which copy to forge. */
  forge(run: RunState, open: readonly DeckCard[], rng: Rng): DeckCard;
}

/**
 * What one stack of a status is worth, in "points", relative to a point of
 * damage. 神力/敏捷 compound over a fight and are priced accordingly; the
 * one-shot debuffs are worth about a good hit's difference.
 */
const STATUS_POINTS: Partial<Record<StatusId, number>> = {
  strength: 6,
  dexterity: 5,
  vulnerable: 2.5,
  weak: 2,
  frail: 1.5,
  poison: 1.5,
  regen: 1.5,
  metallicize: 4,
  thorns: 2,
  artifact: 3,
  barricade: 8,
  intangible: 8,
  buffer: 5,
  ritual: 6,
  slayer: 4,
  discipline: 3,
  armory: 3,
  supply: 3,
  warSaint: 6,
  riposte: 4,
};

/**
 * A card's worth per 气, as a number that only has to *rank* correctly.
 *
 * Two choices worth naming. Conditional effects score their `otherwise` branch
 * — the floor, not the ceiling — because a drafter who prices every conditional
 * at its best case is the drafter who ends up with a deck of cards that need a
 * setup they never draw. And the denominator is `cost + 1` rather than `cost`,
 * so a 0 气 card is worth its full text instead of infinitely much.
 */
export function draftScore(def: CardDef): number {
  let dmg = 0;
  let blk = 0;
  let util = 0;

  const walk = (effects: readonly Effect[], mult: number): void => {
    for (const e of effects) {
      switch (e.kind) {
        case 'damage':
        case 'damageAll':
          dmg += e.amount * (e.times ?? 1) * mult;
          break;
        case 'block':
          blk += e.amount * mult;
          break;
        case 'draw':
          util += 2.5 * e.amount * mult;
          break;
        case 'energy':
          util += 4 * e.amount * mult;
          break;
        case 'heal':
          util += 1.2 * e.amount * mult;
          break;
        case 'loseHp':
          util -= 1.2 * e.amount * mult;
          break;
        case 'status':
          util += (STATUS_POINTS[e.status] ?? 2) * e.amount * mult;
          break;
        case 'addCard':
          util += 2 * e.count * mult;
          break;
        case 'exhaustCards':
          util += 0.5 * e.amount * mult;
          break;
        case 'discard':
          util -= 0.5 * e.amount * mult;
          break;
        // The floor, on purpose — see the note above.
        case 'conditional':
          walk(e.otherwise ?? [], mult);
          break;
        // Assume the card lands with about two 气 / two 攻 behind it.
        case 'scaleWithEnergy':
        case 'scaleWithAttacks':
          walk(e.per, mult * 2);
          break;
        default:
          break;
      }
    }
  };
  walk(def.effects, 1);

  const cost = def.cost < 0 ? 3 : Math.max(def.cost, 0);
  // 攻 and 谋 are not additive: a card is bought for whichever half it does.
  return (Math.max(dmg, blk) + util) / (cost + 1);
}

const scoreOfCard = (card: DeckCard): number => draftScore(CARDS[card.defId]);

/**
 * The bar a new card has to clear: the median card already in the deck.
 *
 * This is the whole of the thinning behaviour, and it self-calibrates. Early on
 * the deck is 起手牌 and the bar is low, so almost everything is an upgrade and
 * `curated` drafts greedily — which is correct, a 10-card deck needs bodies.
 * As the deck improves the bar rises on its own and the same rule starts
 * refusing rewards, which is also correct: past a point every card added is a
 * card drawn *instead of* the good one.
 */
function deckBar(run: RunState): number {
  if (run.deck.length === 0) return 0;
  const scores = run.deck.map(scoreOfCard).sort((a, b) => a - b);
  return scores[Math.floor(scores.length / 2)];
}

/**
 * The shipped behaviour, unchanged and still the default everywhere.
 *
 * Every existing row in `balance.sim.ts` and `evaluate.sim.ts` is measured
 * against this, and it consumes the `rng` stream in exactly the shape it always
 * did — `rng.pick` once per reward, once per forge. A policy that pulled a
 * different number of values would re-deal every kit in the file.
 */
const uniform: DraftPolicy = {
  name: 'uniform',
  pick(_run, offered, rng) {
    return rng.pick([...offered]);
  },
  forge(_run, open, rng) {
    return rng.pick([...open]);
  },
};

/**
 * Takes the best card on offer, refuses the reward when the best of the three
 * is worse than what the deck already averages, and forges what it plays most.
 *
 * Note what it deliberately does **not** do: chase a synergy, plan an
 * archetype, or count 消耗堆. It is one rule — 「宁缺毋滥」 — and if that alone
 * moves the win rate more than the difference between 出牌 policies, that is
 * the finding.
 */
const curated: DraftPolicy = {
  name: 'curated',
  pick(run, offered, _rng) {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const id of offered) {
      const s = draftScore(CARDS[id]);
      if (s > bestScore) {
        bestScore = s;
        best = id;
      }
    }
    if (best === null) return null;
    return bestScore >= deckBar(run) ? best : null;
  },
  forge(_run, open, _rng) {
    let best = open[0];
    let bestScore = -Infinity;
    for (const card of open) {
      const s = scoreOfCard(card);
      if (s > bestScore) {
        bestScore = s;
        best = card;
      }
    }
    return best;
  },
};

export const DRAFT_POLICIES: Record<DraftPolicyName, DraftPolicy> = { uniform, curated };
