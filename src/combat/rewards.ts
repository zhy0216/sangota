import { poolFor } from './cards';
import { rollPotion } from './potions';
import {
  RELIC_DROP_WEIGHTS,
  RELIC_LADDER,
  RELIC_MISS_GOLD,
  RELIC_TIER_ORDER,
  relicsOfTier,
  type RelicSource,
  type RelicTier,
} from './relics';
import type { Rng } from '../core/rng';
import type { AscensionMods } from '../data/ascension';
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
    const wanted = rollRarity(tier, run.rareBump, rng, run.mods.rarityWeightMult);
    const from = availableRarity(run.hero.id, wanted, picked);
    // Every pool drained at once: only reachable if the whole card set is
    // smaller than `count`, so returning short beats repeating a card.
    //
    // R3 (`src/rooms/rng.ts`): the *draw* still happens. Skipping it would make
    // the length of the `reward` stream depend on how much of the pool this
    // reward had already eaten — a `break` here made the same seed pull a
    // different number of times for a hero whose pools are small, and every
    // stream position after it moved. `pick([])` is undefined, so the burn is
    // an explicit `int`.
    if (!from) {
      rng.int(1);
      continue;
    }

    const options = poolFor(run.hero.id, from).filter((id) => !picked.includes(id));
    picked.push(rng.pick(options));
    if (from === 'rare') rolledRare = true;
  }

  // Escalation is per reward, not per card: three commons is one dry reward,
  // not three, or the bump would outrun the weight table within an act. A
  // reward that offered nothing at all is not a dry streak either — it was
  // never a draw.
  if (picked.length > 0) run.rareBump = rolledRare ? 0 : run.rareBump + 1;
  return picked;
}

/**
 * The tier's weights with the accumulated rare bonus folded into `rare`.
 *
 * 天命 (todos/19 a3)：`rarityWeightMult` 乘的是**表上的基础权重**，保底
 * bump 在乘完之后全额叠加——十二重（后十级数据）压得再低，旱久了稀有
 * 还是会来，压不灭保底。缺省乘 1 恒等，既有调用点一个不改。
 */
export function rewardWeights(
  tier: RewardTier,
  rareBump: number,
  rarityWeightMult: AscensionMods['rarityWeightMult'] = { uncommon: 1, rare: 1 },
): Record<RewardRarity, number> {
  const base = TIER_WEIGHTS[tier];
  return {
    common: base.common,
    uncommon: base.uncommon * rarityWeightMult.uncommon,
    rare: base.rare * rarityWeightMult.rare + Math.max(0, rareBump),
  };
}

function rollRarity(
  tier: RewardTier,
  rareBump: number,
  rng: Rng,
  rarityWeightMult: AscensionMods['rarityWeightMult'],
): RewardRarity {
  const weights = rewardWeights(tier, rareBump, rarityWeightMult);
  return rng.weighted(REWARD_RARITIES, REWARD_RARITIES.map((r) => weights[r]));
}

/**
 * The first rarity at or below `wanted` with an unpicked card in it, then the
 * first above. Stepping down first keeps the fallback from silently *upgrading*
 * a reward — draining the commons should not start handing out rares.
 *
 * Walked without drawing: how drained a pool is must never change how many
 * numbers the stream gives up (R3).
 *
 * `heroId` comes first because the pool a rarity resolves against is the
 * *hero's* — 赵云 draining his commons must not start promoting 关羽's rares.
 *
 * Exported because 坊市 needs exactly this, against its own shelf rather than
 * against a reward's picks. It used to carry a second, character-for-character
 * identical copy — two implementations of one rule, each able to drift from the
 * other and neither with a test for the fallback at all.
 */
export function availableRarity(
  heroId: string,
  wanted: RewardRarity,
  picked: readonly string[],
): RewardRarity | null {
  const has = (r: RewardRarity): boolean =>
    poolFor(heroId, r).some((id) => !picked.includes(id));

  const at = REWARD_RARITIES.indexOf(wanted);
  for (let i = at; i >= 0; i--) {
    if (has(REWARD_RARITIES[i])) return REWARD_RARITIES[i];
  }
  for (let i = at + 1; i < REWARD_RARITIES.length; i++) {
    if (has(REWARD_RARITIES[i])) return REWARD_RARITIES[i];
  }
  return null;
}

// ----------------------------------------------------------------- 宝物掉落
//
// 战利品 — where relics come from. The tier odds are data (`RELIC_DROP_WEIGHTS`
// in `relics.ts`); this is the rolling, the de-duplication and the fallback.
//
// Three properties hold it together, and every one of them has a test:
//
// **A roll is a fixed number of draws.** `rollRelic` pulls the stream exactly
// twice — once for the tier, once for the pick — whether or not anything came
// out. An empty pool still burns its pick. This is R3 from `src/rooms/rng.ts`:
// the 宝藏 stream's first draw is the frozen gold roll and the six behind it
// must stay six, or adding one relic to the table re-rolls every existing seed.
//
// **A relic is owned once.** Everything the run already holds is filtered out
// before the pick, so 「已持有的遗物不会再次掉落」 is a property of the pool
// rather than a re-roll loop — a re-roll loop would break the draw count.
//
// **Running dry pays coin, not `undefined`.** The ladder degrades first (see
// `RELIC_LADDER`); only when a source's whole ladder is owned does this return
// `null`, and the caller then pays the constant in `RELIC_MISS_GOLD`.

/** Draws `rollRelic` takes off the stream. Constant by construction. */
export const RELIC_ROLL_DRAWS = 2;

/** 战利品 shows three 首领 relics and the player keeps one. */
export const BOSS_OFFER_SIZE = 3;
export const BOSS_OFFER_DRAWS = RELIC_ROLL_DRAWS * BOSS_OFFER_SIZE;

/** Draws `rollChestExtras` takes — the six that follow 宝藏's frozen gold roll. */
export const CHEST_EXTRA_DRAWS = 6;

export type ChestSize = 'small' | 'medium' | 'large';

/** Ordered, because a weighted pick over them must not depend on key order. */
export const CHEST_SIZES: readonly ChestSize[] = ['small', 'medium', 'large'];

export const CHEST_SIZE_WEIGHTS: Record<ChestSize, number> = { small: 50, medium: 33, large: 17 };

/** Percent chance a chest of each size also holds a 丹药. */
export const CHEST_POTION_CHANCE: Record<ChestSize, number> = { small: 0, medium: 40, large: 60 };

export const CHEST_RELIC_SOURCE: Record<ChestSize, RelicSource> = {
  small: 'chestSmall',
  medium: 'chestMedium',
  large: 'chestLarge',
};

/**
 * Everything a 宝藏 holds beyond the gold. The gold roll itself stays where it
 * is, as the first draw on the `loot` stream, and is not repeated here.
 */
export interface ChestExtras {
  size: ChestSize;
  relicId: string | null;
  /** The `RELIC_MISS_GOLD` consolation when the pool was dry; 0 otherwise. */
  gold: number;
  /** null when the size's chance roll missed — the id is rolled either way. */
  potionId: string | null;
}

/** Relic ids of one tier the run does not already hold. Never re-orders. */
function unowned(run: RunState, tier: RelicTier, exclude: ReadonlySet<string>): string[] {
  // The one place a relic's owner is checked. `relicPool` / `rollRelicOfTier` /
  // `rollBossOffer` / 坊市's `generateStock` all reach the table through here,
  // so a hero-locked relic (`RelicDef.hero`) is unreachable everywhere at once.
  return relicsOfTier(tier)
    .filter((def) => !def.hero || def.hero === run.hero.id)
    .map((def) => def.id)
    .filter((id) => !run.relics.includes(id) && !exclude.has(id));
}

/**
 * The ids a `wanted` tier can actually deliver, after de-duplication and after
 * the fallback ladder. Pure and draw-free — the fallback must not cost the
 * stream anything, or how far a pool had been drained would change every roll
 * downstream of it.
 */
export function relicPool(
  run: RunState,
  wanted: RelicTier,
  exclude: readonly string[] = [],
): string[] {
  const skip = new Set(exclude);
  const free = (tier: RelicTier): string[] => unowned(run, tier, skip);

  // Closed pools. 坊市 stock is bought, never dropped, so it has nowhere to
  // fall back to; an exhausted 首领 pool drops onto the open ladder instead of
  // handing out something the player could have walked into a shop and bought.
  if (wanted === 'shop') return free('shop');
  let target = wanted;
  if (target === 'boss') {
    const bosses = free('boss');
    if (bosses.length > 0) return bosses;
    target = 'rare';
  }
  // 关羽's own relic is dealt at 开局, never dropped.
  if (target === 'starter') target = 'common';

  const at = RELIC_LADDER.indexOf(target);
  for (let i = at; i >= 0; i--) {
    const pool = free(RELIC_LADDER[i]);
    if (pool.length > 0) return pool;
  }
  for (let i = at + 1; i < RELIC_LADDER.length; i++) {
    const pool = free(RELIC_LADDER[i]);
    if (pool.length > 0) return pool;
  }
  return [];
}

/**
 * One unowned relic of `tier` — for callers that already know the tier they
 * want: 坊市 stocks one 常见 and one 罕见 by design, and an 奇遇 names its own
 * reward. Exactly one draw, spent whether or not the pool had anything in it.
 *
 * Reaching for `rng.pick(relicPool(...))` instead is the bug this exists to
 * prevent: `pick` on an empty array hands back `undefined`, and `addRelic`
 * takes `undefined` as quietly as it takes a typo.
 */
export function rollRelicOfTier(
  rng: Rng,
  run: RunState,
  tier: RelicTier,
  exclude: readonly string[] = [],
): string | null {
  const pool = relicPool(run, tier, exclude);
  const at = rng.int(Math.max(1, pool.length));
  return pool.length > 0 ? pool[at] : null;
}

/**
 * One relic from `source`, or null when everything it could offer is owned.
 *
 * The `Rng` is passed in and never built here: the caller owns the stream, so
 * an elite's relic and its gold replay together off one seed.
 *
 * Exactly `RELIC_ROLL_DRAWS` draws, always — the pick is rolled even against an
 * empty pool, the way `rollPotionDrop` rolls a bottle id it may throw away.
 */
export function rollRelic(
  rng: Rng,
  run: RunState,
  source: RelicSource,
  exclude: readonly string[] = [],
): string | null {
  const weights = RELIC_DROP_WEIGHTS[source];
  const tiers = RELIC_TIER_ORDER.filter((tier) => (weights[tier] ?? 0) > 0);
  const wanted = rng.weighted(
    tiers,
    tiers.map((tier) => weights[tier] ?? 0),
  );
  return rollRelicOfTier(rng, run, wanted, exclude);
}

/**
 * The three 首领 relics the 战利品 chest offers. Distinct by construction —
 * each pick excludes the ones already on the table — and short only if the
 * whole ladder behind 首领 ran dry too, which the scene pays out as coin.
 *
 * Always `BOSS_OFFER_DRAWS` draws, however few relics come back.
 */
export function rollBossOffer(rng: Rng, run: RunState): string[] {
  const offer: string[] = [];
  for (let i = 0; i < BOSS_OFFER_SIZE; i++) {
    const id = rollRelic(rng, run, 'boss', offer);
    if (id) offer.push(id);
  }
  return offer;
}

/**
 * A 宝藏's relic and its trimmings, in `CHEST_EXTRA_DRAWS` draws.
 *
 * Call it on the `loot` stream *after* the frozen `range(25, 45)` gold roll and
 * nowhere else — the ordering is what keeps a chest opened on a given seed
 * paying the same coin it paid before relics existed.
 */
export function rollChestExtras(rng: Rng, run: RunState): ChestExtras {
  const size = rng.weighted(
    CHEST_SIZES,
    CHEST_SIZES.map((s) => CHEST_SIZE_WEIGHTS[s]),
  );
  const source = CHEST_RELIC_SOURCE[size];
  const relicId = rollRelic(rng, run, source);

  // Rolled in this order and both rolled unconditionally: a 小宝藏 never holds
  // a 丹药 but still burns the same two draws finding that out, so widening the
  // chance table later cannot reshuffle what every later chest contains.
  const lucky = rng.int(100) < CHEST_POTION_CHANCE[size];
  const potionId = rollPotion(rng);

  return {
    size,
    relicId,
    gold: relicId ? 0 : RELIC_MISS_GOLD[source],
    potionId: lucky ? potionId : null,
  };
}
