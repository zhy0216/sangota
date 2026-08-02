import { COLORLESS_POOL, resolveCard } from '../combat/cards';
import { POTION_POOL_BY_RARITY, getPotion, rollPotion } from '../combat/potions';
import { getRelic, relicModifiers, type RelicTier } from '../combat/relics';
import {
  REWARD_RARITIES,
  availableRarity,
  rollRelicOfTier,
  unlockedPool,
  type RewardRarity,
} from '../combat/rewards';
import type { Rng } from '../core/rng';
import { filterUnlocked } from '../state/unlocks';
import {
  addCard,
  addGold,
  addPotion,
  addRelic,
  hasPotionSpace,
  hasRelic,
  isRemovable,
  removableCount,
  removeCard,
  type RunState,
} from '../state/run';
import { roomCommit, roomRecord } from './commit';
import { stream } from './rng';
import type { ShopCardOffer, ShopRelicOffer, ShopSlot, ShopStock } from './types';

/**
 * 商旅 — the rules half. Everything that reads or writes `RunState` for a shop
 * is in this file; `shopView.ts` draws what these functions hand back and
 * nothing else.
 *
 * Gold was a dead resource before this room existed: a run banks roughly 300
 * 资财 and had nowhere to spend a coin of it. That number is what the price
 * table below is calibrated against — see `CARD_PRICE`.
 *
 * Three properties, each with a test:
 *
 * **The shelf is frozen on first sight (R5).** `ensureStock` materialises the
 * whole inventory into `run.rooms[nodeId].stock` and every later visit reads it
 * back. A seeded stream is *not* enough on its own: the relic roll filters
 * against relics the player owns, so re-rolling after a purchase from this very
 * shelf hands back a different third relic.
 *
 * **The stream is pulled exactly `SHOP_DRAWS` times (R3).** Every slot spends
 * its draws whether or not anything came out of them, so adding a card to the
 * pool cannot re-stock a shop on a seed that already exists.
 *
 * **A slot is bought once.** Every purchase runs inside `commit.once`, keyed by
 * the slot, so a double click, a stale button during the exit fade and a save
 * reloaded inside the shop all charge exactly one price.
 */

// ------------------------------------------------------------------ 货架规格

export const SHOP_CARD_COUNT = 5;
export const SHOP_RELIC_COUNT = 3;
export const SHOP_POTION_COUNT = 3;

/**
 * The last card slot is 无色 stock — the one place in the game those cards are
 * dealt. Kept last so the four rarity-rolled slots read as a block.
 */
export const COLORLESS_SLOT = SHOP_CARD_COUNT - 1;

/** One 常见, one 罕见, one 坊市-only, in that order along the shelf. */
export const RELIC_SHELF: readonly RelicTier[] = ['common', 'uncommon', 'shop'];

/**
 * Draws `generateStock` takes off the `shop` stream. Constant by construction,
 * and asserted as a literal — the whole point is that it cannot drift.
 *
 * | block                        | draws |
 * |------------------------------|-------|
 * | 4 × (rarity, pick)           | 8     |
 * | 1 × 无色 pick                 | 1     |
 * | 5 × card price               | 5     |
 * | 3 × relic pick               | 3     |
 * | 3 × relic price              | 3     |
 * | 3 × (potion rarity, pick)    | 6     |
 * | 3 × potion price             | 3     |
 * | discount kind, discount slot | 2     |
 */
export const SHOP_DRAWS = 31;

// -------------------------------------------------------------------- 价目表
//
// A run banks about 300 资财 in total (99 to start, ~7.7 monster fights at
// 10-22, one elite at 28-42, one chest at 25-45). The draft table was written
// against an assumed 370 and every band here is that table cut by a fifth, so a
// single shop visit is a real choice between one relic and a fistful of cards
// rather than a shopping trip that clears the shelf.

/** By the card's rarity, which for 无色 stock is a price band and nothing more. */
export const CARD_PRICE: Record<RewardRarity, readonly [number, number]> = {
  common: [26, 32],
  uncommon: [40, 48],
  rare: [78, 92],
};

/**
 * By the relic's *actual* tier rather than the requested one: `rollRelicOfTier`
 * degrades down the ladder when a tier is exhausted, and a 罕见 handed over
 * because the 常见 shelf was bare must not be sold at the 常见 price.
 */
export const RELIC_PRICE: Record<RelicTier, readonly [number, number]> = {
  starter: [80, 90],
  common: [80, 90],
  uncommon: [140, 165],
  rare: [190, 225],
  boss: [230, 270],
  shop: [170, 200],
};

export const POTION_PRICE: Record<'common' | 'uncommon' | 'rare', readonly [number, number]> = {
  common: [27, 31],
  uncommon: [40, 46],
  rare: [54, 62],
};

/**
 * Rarer than a monster fight's reward roll and flatter than an elite's: paying
 * for a card is already a filter, so the shelf does not also need to be stingy.
 * Sums to 100, like `TIER_WEIGHTS`.
 */
export const SHOP_CARD_WEIGHTS: Record<RewardRarity, number> = {
  common: 55,
  uncommon: 33,
  rare: 12,
};

/** 弃卡 — the run's only reliable way to thin a deck, and priced like it. */
export const REMOVAL_BASE = 52;
/** Every use raises the price for the rest of the run, not just this shop. */
export const REMOVAL_STEP = 18;
/** Removals one 商旅 will perform. The key is numbered so this can grow. */
export const REMOVALS_PER_SHOP = 1;
/**
 * The merchant will not thin a deck below this. The floor is defined in
 * `run.ts` and re-exported here: 弃卡 is one of two doors onto `removeCard` and
 * both have to answer to the same number.
 */
export { MIN_DECK_SIZE } from '../state/run';

/** Half off, rounded up — the merchant does not deal in halves of a coin. */
export const discountedPrice = (price: number): number => Math.ceil(price / 2);

// ------------------------------------------------------------------ 台账 key

const slotKey = (slot: ShopSlot): string => `item:${slot.kind}:${slot.index}`;
const REMOVAL_PREFIX = 'removal:';

export const isSold = (run: RunState, nodeId: string, slot: ShopSlot): boolean =>
  roomCommit(run, nodeId).isDone(slotKey(slot));

// -------------------------------------------------------------------- 进货

/**
 * 一次价格掷骰。天命 (todos/19 a3)：十六重的商价 +10%（后十级数据）乘在掷出
 * 的原价上，四舍五入——骰数不变 (R3)，货架和折扣槽一个不挪；零重乘 1 恒等。
 */
const priceIn = (run: RunState, rng: Rng, band: readonly [number, number]): number =>
  Math.round(rng.range(band[0], band[1]) * run.mods.shopPriceMult);

/**
 * Two draws: the rarity, then the pick. The pick is spent against an empty pool
 * too, which is the only reason a slot may come back null.
 *
 * 池子走 `unlockedPool` (todos/23 u2)：未解锁的牌不上架，骰数不动。
 */
function rollShelfCard(rng: Rng, run: RunState, taken: readonly string[]): string | null {
  const wanted = rng.weighted(
    REWARD_RARITIES,
    REWARD_RARITIES.map((r) => SHOP_CARD_WEIGHTS[r]),
  );
  const rarity = availableRarity(run.hero.id, wanted, taken);
  const pool = rarity ? unlockedPool(run.hero.id, rarity).filter((id) => !taken.includes(id)) : [];
  const at = rng.int(Math.max(1, pool.length));
  return pool[at] ?? null;
}

/**
 * One draw. Falls back to the 常见 pool if 无色 stock is ever emptied out —
 * the slot going blank would silently shrink the shelf from five cards to four
 * and nothing on screen would say why.
 *
 * The fallback was documented in this comment and not implemented: the `pool`
 * expression was `colorless.length > 0 ? colorless : []`, which is `colorless`.
 * Unreachable today (`COLORLESS_POOL` holds five ids and the four slots ahead
 * of it draw from the rarity pools, which are disjoint from it) and now real.
 */
function rollColorlessCard(rng: Rng, run: RunState, taken: readonly string[]): string | null {
  // 无色牌今天一张也没上锁，但过滤照过 (todos/23 u2)——哪天有一张进了轨道，
  // 这格货架不该是唯一漏风的窗。
  const colorless = filterUnlocked('card', COLORLESS_POOL).filter((id) => !taken.includes(id));
  const fallback = unlockedPool(run.hero.id, 'common').filter((id) => !taken.includes(id));
  const pool = colorless.length > 0 ? colorless : fallback;
  const at = rng.int(Math.max(1, pool.length));
  return pool[at] ?? null;
}

/**
 * The bottle, de-duplicated *after* the roll rather than by re-rolling: a shelf
 * of three identical flasks reads as a bug, and a re-roll loop would spend a
 * variable number of draws finding that out. Two draws, always.
 */
function rollShelfPotion(rng: Rng, taken: readonly string[]): string {
  const id = rollPotion(rng);
  if (!taken.includes(id)) return id;
  const sameRarity = POTION_POOL_BY_RARITY[getPotion(id).rarity];
  return sameRarity.find((other) => !taken.includes(other)) ?? id;
}

/**
 * The whole inventory, priced, in exactly `SHOP_DRAWS` draws.
 *
 * Slots are rolled into a fixed-length array of nullable ids first and only
 * compacted at the end: an empty pool must still cost the stream its price
 * draw, or a shop stocked on a drained pool would shift every number behind it.
 *
 * Exported so the draw count can be asserted against a stream the test owns —
 * `ensureStock` builds its own, and `Rng.rolls` is the only way to see one.
 */
export function generateStock(run: RunState, rng: Rng): ShopStock {
  // -- 兵书. Four off the rarity pools, then the 无色 slot.
  const cardIds: (string | null)[] = [];
  for (let i = 0; i < COLORLESS_SLOT; i++) {
    cardIds.push(rollShelfCard(rng, run, cardIds.filter((id): id is string => !!id)));
  }
  cardIds.push(rollColorlessCard(rng, run, cardIds.filter((id): id is string => !!id)));

  const cards: (ShopCardOffer | null)[] = cardIds.map((defId) => {
    // 无色 stock is priced off its own declared rarity, exactly like the rest.
    const rarity = defId ? resolveCard(defId).rarity : 'common';
    const price = priceIn(run, rng, rarity === 'basic' ? CARD_PRICE.common : CARD_PRICE[rarity]);
    return defId ? { defId, upgraded: 0, price } : null;
  });

  // -- 宝物. Already-owned relics are filtered inside `rollRelicOfTier`, and the
  // shelf excludes itself so the three are never the same relic twice.
  const relicIds: (string | null)[] = [];
  for (const tier of RELIC_SHELF) {
    relicIds.push(
      rollRelicOfTier(rng, run, tier, relicIds.filter((id): id is string => !!id)),
    );
  }
  const relics: (ShopRelicOffer | null)[] = relicIds.map((id, i) => {
    const tier = id ? (getRelic(id)?.tier ?? RELIC_SHELF[i]) : RELIC_SHELF[i];
    const price = priceIn(run, rng, RELIC_PRICE[tier]);
    return id ? { id, price } : null;
  });

  // -- 丹药
  const potionIds: string[] = [];
  for (let i = 0; i < SHOP_POTION_COUNT; i++) potionIds.push(rollShelfPotion(rng, potionIds));
  const potions = potionIds.map((id) => ({
    id,
    price: priceIn(run, rng, POTION_PRICE[getPotion(id).rarity]),
  }));

  // -- 折扣. Two draws: which counter, then which slot on it. The original
  // discounts a card or a relic and never a potion, and rolling the counter
  // separately is what keeps that faithful *and* the draw count constant.
  const onCards = rng.int(2) === 0;
  const at = rng.int(onCards ? SHOP_CARD_COUNT : SHOP_RELIC_COUNT);
  const discounted = onCards ? cards[at] : relics[at];
  if (discounted) {
    discounted.listPrice = discounted.price;
    discounted.price = discountedPrice(discounted.price);
  }

  return {
    cards: cards.filter((o): o is ShopCardOffer => !!o),
    relics: relics.filter((o): o is ShopRelicOffer => !!o),
    potions,
  };
}

/** R5 — rolled on first sight, then read back forever. */
export function ensureStock(run: RunState, nodeId: string): ShopStock {
  const record = roomRecord(run, nodeId, 'shop');
  if (record.stock) return record.stock;
  record.stock = generateStock(run, stream(run, nodeId, 'shop'));
  return record.stock;
}

// -------------------------------------------------------------------- 买卖

/**
 * `'sold'` covers both "already bought" and "no longer purchasable at all" —
 * the slot is gone from the player's point of view either way. `'poor'` and
 * `'nospace'` are refusals the player can act on, and neither costs a coin.
 */
export type BuyResult = 'ok' | 'sold' | 'poor' | 'nospace' | 'forbidden';

/**
 * 布衣 (todos/18) trades every 宝物 on every counter for a standing +25% on
 * 资财. Checked here rather than inside the gate: `commit.once` marks its key
 * on the way in, so a refusal in the body would burn the slot and hand back
 * nothing.
 */
const RELIC_PURCHASE_BARRED = '布衣在身，不购宝物';

export const relicPurchaseBarred = (run: RunState): string | null =>
  relicModifiers(run.relics).noRelicPurchase ? RELIC_PURCHASE_BARRED : null;

/** What a slot costs, what stands in its way, and how to hand it over. */
interface Purchase {
  price: number;
  /** The slot cannot be sold at all any more, whatever the purse says. */
  gone: boolean;
  /** The belt is full. Potions only. */
  full: boolean;
  take: () => void;
}

function purchaseAt(run: RunState, stock: ShopStock, slot: ShopSlot): Purchase | null {
  switch (slot.kind) {
    case 'card': {
      const offer = stock.cards[slot.index];
      if (!offer) return null;
      return {
        price: offer.price,
        gone: false,
        full: false,
        take: () => {
          addCard(run, offer.defId, offer.upgraded);
        },
      };
    }
    case 'relic': {
      const offer = stock.relics[slot.index];
      if (!offer) return null;
      return {
        price: offer.price,
        // The stock froze before an 奇遇 or a 宝藏 handed over this same relic.
        // Charging for a duplicate would take the coin and give nothing back.
        gone: hasRelic(run, offer.id),
        full: false,
        take: () => {
          addRelic(run, offer.id);
        },
      };
    }
    case 'potion': {
      const offer = stock.potions[slot.index];
      if (!offer) return null;
      return {
        price: offer.price,
        gone: false,
        // `hasPotionSpace` and not a hard 3: 药囊 widens the belt.
        full: !hasPotionSpace(run),
        take: () => {
          addPotion(run, offer.id);
        },
      };
    }
  }
}

/**
 * Buy one slot. Every refusal is checked *before* the gate — `once` marks its
 * key on the way in, so a refusal inside the body would burn the slot and hand
 * back nothing.
 */
export function buy(run: RunState, nodeId: string, slot: ShopSlot): BuyResult {
  const stock = ensureStock(run, nodeId);
  const commit = roomCommit(run, nodeId);
  const key = slotKey(slot);
  if (commit.isDone(key)) return 'sold';

  if (slot.kind === 'relic' && relicPurchaseBarred(run)) return 'forbidden';

  const purchase = purchaseAt(run, stock, slot);
  if (!purchase) return 'sold';
  if (purchase.gone) {
    // Close the slot so the shelf greys it rather than offering it again.
    commit.mark(key);
    return 'sold';
  }
  if (run.gold < purchase.price) return 'poor';
  if (purchase.full) return 'nospace';

  commit.once(key, () => {
    // Negative amounts skip the 聚宝盆 multiplier: gains are scaled, spending is
    // charged at face value.
    addGold(run, -purchase.price);
    purchase.take();
  });
  return 'ok';
}

// ------------------------------------------------------------------ 弃卡服务

/** 52 the first time, then 18 more for every removal taken this run. */
export const removalPrice = (run: RunState): number => {
  const mods = relicModifiers(run.relics);
  const surcharge = mods.noRemovalSurcharge ? 0 : run.cardRemovalSurcharge;
  return Math.max(0, Math.floor((REMOVAL_BASE + surcharge) * mods.removalPriceMultiplier));
};

export const removalsTaken = (run: RunState, nodeId: string): number =>
  roomCommit(run, nodeId).count(REMOVAL_PREFIX);

/** Why the counter is closed, or null when a card may be handed over. */
export function removalBlocked(run: RunState, nodeId: string): string | null {
  if (removalsTaken(run, nodeId) >= REMOVALS_PER_SHOP) return '此处已了此事';
  // `removableCount` 同时管两件事：地板（MIN_DECK_SIZE）和不可移除的牌
  // （宿业，todos/19 a4）——两样都数不出一张可弃的，柜台就关着。
  if (removableCount(run) === 0) return '牌少不可再弃';
  if (run.gold < removalPrice(run)) return '资财不足';
  return null;
}

/**
 * Pay to strike one physical copy out of the deck. By uid, so 「the unforged
 * 劈砍」 and 「劈砍·精」 are different sales.
 *
 * The surcharge is charged to the *run*, not to the shop: the second removal
 * costs 70 whether it is bought here or two floors up.
 *
 * `removable === false`（宿业）拒收：网格已把它压暗，这里是绕过 UI 也过
 * 不去的那道门。
 */
export function buyRemoval(run: RunState, nodeId: string, uid: string): boolean {
  if (removalBlocked(run, nodeId)) return false;
  const target = run.deck.find((card) => card.uid === uid);
  if (!target || !isRemovable(target)) return false;

  const commit = roomCommit(run, nodeId);
  const price = removalPrice(run);
  return (
    commit.once(`${REMOVAL_PREFIX}${removalsTaken(run, nodeId)}`, () => {
      addGold(run, -price);
      removeCard(run, uid);
      if (!relicModifiers(run.relics).noRemovalSurcharge) {
        run.cardRemovalSurcharge += REMOVAL_STEP;
      }
      return true;
    }) ?? false
  );
}

// -------------------------------------------------------------------- 货架视图

/** One slot as the counter draws it. The view reads nothing else off the run. */
export interface ShelfItem {
  slot: ShopSlot;
  /** 卡 uses `defId`; 宝物 and 丹药 use their own id. */
  id: string;
  /** Cards only; 0 for everything else. */
  upgraded: number;
  name: string;
  /** What the player pays. */
  price: number;
  /** The struck-through original, on the one discounted slot. */
  listPrice: number | null;
  sold: boolean;
  /** null when it can be bought right now — a reason otherwise. */
  blocked: string | null;
}

const shelfName = (slot: ShopSlot, id: string, upgraded: number): string => {
  if (slot.kind === 'card') return resolveCard(id, upgraded).name;
  if (slot.kind === 'relic') return getRelic(id)?.name ?? id;
  return getPotion(id).name;
};

/**
 * The whole counter, in shelf order. `blocked` is the same set of reasons `buy`
 * refuses on, computed once here so a greyed tag and a refused click can never
 * disagree.
 */
export function shelf(run: RunState, nodeId: string): ShelfItem[] {
  const stock = ensureStock(run, nodeId);
  const items: ShelfItem[] = [];

  const add = (
    slot: ShopSlot,
    id: string,
    price: number,
    listPrice: number | undefined,
    upgraded = 0,
  ): void => {
    // A relic picked up elsewhere after the stock froze is off the counter for
    // good, so it reads as sold rather than as an unaffordable duplicate.
    const sold = isSold(run, nodeId, slot) || (slot.kind === 'relic' && hasRelic(run, id));
    const blocked = sold
      ? null
      : slot.kind === 'relic'
        ? // Checked ahead of the purse: 「资财不足」 on a counter that would
          // refuse the sale at any price is the wrong reason to print.
          (relicPurchaseBarred(run) ??
          (run.gold < price ? '资财不足' : null))
        : run.gold < price
          ? '资财不足'
          : slot.kind === 'potion' && !hasPotionSpace(run)
            ? '丹药囊已满'
            : null;
    items.push({
      slot,
      id,
      upgraded,
      name: shelfName(slot, id, upgraded),
      price,
      listPrice: listPrice ?? null,
      sold,
      blocked,
    });
  };

  stock.cards.forEach((offer, index) =>
    add({ kind: 'card', index }, offer.defId, offer.price, offer.listPrice, offer.upgraded),
  );
  stock.relics.forEach((offer, index) =>
    add({ kind: 'relic', index }, offer.id, offer.price, offer.listPrice),
  );
  stock.potions.forEach((offer, index) =>
    add({ kind: 'potion', index }, offer.id, offer.price, offer.listPrice),
  );
  return items;
}

/** True once nothing on the counter can still be bought. */
export const isCleanedOut = (run: RunState, nodeId: string): boolean =>
  shelf(run, nodeId).every((item) => item.sold);
