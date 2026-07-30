import { CARD_POOL_BY_RARITY } from './cards';
import type { Rng } from '../core/rng';
import type { RunState } from '../state/run';
import type { CardRarity } from './types';

/**
 * 卡牌奖励 — which cards a fight offers. The rarity weights are the original's,
 * and so is the escalation: a reward that produces no rare makes the next one
 * likelier to, which is what stops a run from going twenty fights without ever
 * being offered a build-around.
 *
 * No Phaser here, and no `CombatState` either — a reward is a property of the
 * run, so this module reads `RunState` and the fight is already over.
 */

export type RewardTier = 'monster' | 'elite' | 'boss';

/** Rarity a reward card can be. `basic` is not draftable, hence the exclusion. */
export type RewardRarity = Exclude<CardRarity, 'basic'>;

/** Ordered worst to best — the fallback walks this list, so order is load-bearing. */
export const REWARD_RARITIES: readonly RewardRarity[] = ['common', 'uncommon', 'rare'];

/**
 * Base pick weights per tier. Elites and bosses buy their better odds out of
 * the common share rather than the uncommon one: the tier a player notices is
 * "how often do I see a rare", and shrinking uncommon would just make elite
 * rewards feel swingier without making them feel better.
 */
export const TIER_WEIGHTS: Record<RewardTier, Record<RewardRarity, number>> = {
  monster: { common: 60, uncommon: 37, rare: 3 },
  elite: { common: 50, uncommon: 37, rare: 13 },
  boss: { common: 40, uncommon: 40, rare: 20 },
};

/** Cards offered when nothing modifies it. */
export const BASE_CARD_REWARD_COUNT = 3;

export interface CardRewardOptions {
  tier: RewardTier;
  run: RunState;
  rng: Rng;
  /** Defaults to `run.cardRewardCount`. Relics move that, not this. */
  count?: number;
}

/**
 * `count` distinct card ids to offer, and the side effect on `run.rareBump`.
 *
 * Each card rolls its own rarity and is then drawn from that tier, so a reward
 * is three independent rolls rather than one shape — that is what lets a
 * monster fight occasionally offer two uncommons.
 */
export function rollCardReward(opts: CardRewardOptions): string[] {
  const { tier, run, rng } = opts;
  const count = Math.max(0, opts.count ?? run.cardRewardCount);

  const picked: string[] = [];
  let rolledRare = false;

  for (let i = 0; i < count; i++) {
    const wanted = rollRarity(tier, run.rareBump, rng);
    const from = availableRarity(wanted, picked);
    // Every pool drained at once: only reachable if the whole card set is
    // smaller than `count`, so returning short beats repeating a card.
    if (!from) break;

    const options = CARD_POOL_BY_RARITY[from].filter((id) => !picked.includes(id));
    picked.push(rng.pick(options));
    if (from === 'rare') rolledRare = true;
  }

  // Escalation is per reward, not per card: three commons is one dry reward,
  // not three, or the bump would outrun the weight table within an act.
  run.rareBump = rolledRare ? 0 : run.rareBump + 1;
  return picked;
}

/** The tier's weights with the accumulated rare bonus folded into `rare`. */
export function rewardWeights(tier: RewardTier, rareBump: number): Record<RewardRarity, number> {
  const base = TIER_WEIGHTS[tier];
  return { ...base, rare: base.rare + Math.max(0, rareBump) };
}

function rollRarity(tier: RewardTier, rareBump: number, rng: Rng): RewardRarity {
  const weights = rewardWeights(tier, rareBump);
  return rng.weighted(REWARD_RARITIES, REWARD_RARITIES.map((r) => weights[r]));
}

/**
 * The first rarity at or below `wanted` with an unpicked card in it, then the
 * first above. Stepping down first keeps the fallback from silently *upgrading*
 * a reward — draining the commons should not start handing out rares.
 */
function availableRarity(wanted: RewardRarity, picked: readonly string[]): RewardRarity | null {
  const has = (r: RewardRarity): boolean =>
    CARD_POOL_BY_RARITY[r].some((id) => !picked.includes(id));

  const at = REWARD_RARITIES.indexOf(wanted);
  for (let i = at; i >= 0; i--) {
    if (has(REWARD_RARITIES[i])) return REWARD_RARITIES[i];
  }
  for (let i = at + 1; i < REWARD_RARITIES.length; i++) {
    if (has(REWARD_RARITIES[i])) return REWARD_RARITIES[i];
  }
  return null;
}
