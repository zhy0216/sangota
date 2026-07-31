import { describe, expect, it } from 'vitest';
import { CARDS, CARD_POOL_BY_RARITY, COLORLESS_POOL, resolveCard } from '../src/combat/cards';
import { isNegative } from '../src/combat/curses';
import { POTIONS, getPotion } from '../src/combat/potions';
import { RELICS, getRelic, relicsOfTier } from '../src/combat/relics';
import { REWARD_RARITIES } from '../src/combat/rewards';
import { DEFAULT_HERO } from '../src/data/heroes';
import { roomCommit } from '../src/rooms/commit';
import { stream } from '../src/rooms/rng';
import {
  CARD_PRICE,
  COLORLESS_SLOT,
  MIN_DECK_SIZE,
  POTION_PRICE,
  RELIC_PRICE,
  RELIC_SHELF,
  REMOVAL_BASE,
  REMOVAL_STEP,
  SHOP_CARD_COUNT,
  SHOP_CARD_WEIGHTS,
  SHOP_DRAWS,
  SHOP_POTION_COUNT,
  SHOP_RELIC_COUNT,
  buy,
  buyRemoval,
  discountedPrice,
  ensureStock,
  generateStock,
  isCleanedOut,
  removalBlocked,
  removalPrice,
  shelf,
} from '../src/rooms/shop';
import type { ShopSlot } from '../src/rooms/types';
import { addPotion, addRelic, startRun, type RunState } from '../src/state/run';

/**
 * 商旅 — the room that turns 资财 from a score into a resource.
 *
 * The numbers are asserted against literals as well as against the constants
 * that produce them: a test that only re-computes the expression it is checking
 * passes just as happily against a table that has drifted by a fifth.
 */

const shopNodes = (run: RunState): string[] =>
  [...run.map.nodes.values()].filter((n) => n.type === 'shop').map((n) => n.id);

const shopNode = (run: RunState): string => {
  const [id] = shopNodes(run);
  if (!id) throw new Error('no shop node on this map');
  return id;
};

/**
 * A run standing on a map that actually has a 商旅. Shops are 16% of the pool
 * and barred below floor 6, so plenty of seeds have none; the search walks a
 * deterministic suffix rather than a random one, so a named seed still replays.
 */
const withShops = (count: number, seed: string): RunState => {
  for (let i = 0; i < 200; i++) {
    const run = startRun(DEFAULT_HERO, i === 0 ? seed : `${seed}#${i}`);
    if (shopNodes(run).length >= count) return run;
  }
  throw new Error(`no map with ${count} 商旅 near seed ${seed}`);
};

const fresh = (seed = 'shop'): RunState => withShops(1, seed);

/** A purse deep enough that price never decides the outcome of a test. */
const rich = (seed = 'shop'): RunState => {
  const run = fresh(seed);
  run.gold = 9999;
  return run;
};

const slotsOf = (run: RunState, id: string): ShopSlot[] => shelf(run, id).map((i) => i.slot);

describe('库存', () => {
  it('stocks five cards, three relics and three potions', () => {
    const run = fresh();
    const stock = ensureStock(run, shopNode(run));
    expect(stock.cards).toHaveLength(SHOP_CARD_COUNT);
    expect(stock.relics).toHaveLength(SHOP_RELIC_COUNT);
    expect(stock.potions).toHaveLength(SHOP_POTION_COUNT);
    expect(SHOP_CARD_COUNT).toBe(5);
  });

  it('draws exactly 31 numbers off the shop stream, whatever it rolled', () => {
    // R3, asserted on a stream this test owns — `ensureStock` builds its own and
    // `Rng.rolls` is the only window onto one.
    expect(SHOP_DRAWS).toBe(31);
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const run = fresh(seed);
      const id = shopNode(run);
      const rng = stream(run, id, 'shop');
      const stock = generateStock(run, rng);
      expect(rng.rolls, `seed ${seed}`).toBe(SHOP_DRAWS);
      // And the generator the room actually calls is the same one.
      expect(ensureStock(run, id)).toEqual(stock);
    }
  });

  it('spends the same draws when the relic shelf has nothing left to sell', () => {
    const drained = rich('drained');
    // Own literally every relic: the three relic picks now come back null and
    // must still cost the stream three picks and three prices.
    for (const id of Object.keys(RELICS)) addRelic(drained, id);
    const node = shopNode(drained);
    const rng = stream(drained, node, 'shop');
    const stock = generateStock(drained, rng);
    expect(stock.relics).toHaveLength(0);
    expect(stock.cards).toHaveLength(SHOP_CARD_COUNT);
    expect(rng.rolls).toBe(SHOP_DRAWS);

    // The cards were rolled before the relics and the potions after them, so a
    // shelf with nothing to sell must leave both blocks exactly where they were.
    const fat = rich('drained');
    const rich_ = ensureStock(fat, shopNode(fat));
    expect(stock.cards).toEqual(rich_.cards);
    expect(stock.potions).toEqual(rich_.potions);
  });

  it('freezes on first sight and reads back identically after a purchase', () => {
    const run = rich('frozen');
    const id = shopNode(run);
    const first = ensureStock(run, id);
    const snapshot = structuredClone(first);

    // R5 exists for exactly this: `rollRelicOfTier` filters owned relics, so a
    // re-roll after buying off this shelf would produce a different third one.
    expect(buy(run, id, { kind: 'relic', index: 0 })).toBe('ok');
    expect(ensureStock(run, id)).toBe(first);
    expect(ensureStock(run, id)).toEqual(snapshot);
  });

  it('gives the same seed the same shelf and the same prices', () => {
    const a = fresh('seeded');
    const b = fresh('seeded');
    expect(ensureStock(a, shopNode(a))).toEqual(ensureStock(b, shopNode(b)));
  });

  it('gives two shops on one map different shelves', () => {
    const run = withShops(2, 'two-shops');
    const [one, two] = shopNodes(run).map((id) => ensureStock(run, id));
    expect(one.cards.map((c) => c.defId)).not.toEqual(two.cards.map((c) => c.defId));
  });

  it('never shelves the same card, relic or potion twice', () => {
    for (let i = 0; i < 60; i++) {
      const run = fresh(`dupe-${i}`);
      const stock = ensureStock(run, shopNode(run));
      const cards = stock.cards.map((c) => c.defId);
      const relics = stock.relics.map((r) => r.id);
      const potions = stock.potions.map((p) => p.id);
      expect(new Set(cards).size, `cards ${cards.join()}`).toBe(cards.length);
      expect(new Set(relics).size, `relics ${relics.join()}`).toBe(relics.length);
      expect(new Set(potions).size, `potions ${potions.join()}`).toBe(potions.length);
    }
  });

  it('never shelves a relic the run already owns', () => {
    for (let i = 0; i < 40; i++) {
      const run = fresh(`owned-${i}`);
      addRelic(run, 'jubaopen');
      addRelic(run, 'geban');
      const stock = ensureStock(run, shopNode(run));
      for (const offer of stock.relics) expect(run.relics).not.toContain(offer.id);
    }
  });

  it('never shelves a curse or a 状态牌', () => {
    for (let i = 0; i < 40; i++) {
      const run = fresh(`clean-${i}`);
      for (const offer of ensureStock(run, shopNode(run)).cards) {
        expect(isNegative(CARDS[offer.defId]), offer.defId).toBe(false);
      }
    }
  });

  it('keeps one 无色 slot, and deals 无色 stock nowhere else', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const run = fresh(`colorless-${i}`);
      const cards = ensureStock(run, shopNode(run)).cards;
      expect(COLORLESS_POOL, `slot ${COLORLESS_SLOT}`).toContain(cards[COLORLESS_SLOT].defId);
      // The four rarity slots never reach into the 无色 pool.
      for (let s = 0; s < COLORLESS_SLOT; s++) {
        expect(COLORLESS_POOL).not.toContain(cards[s].defId);
      }
      seen.add(cards[COLORLESS_SLOT].defId);
    }
    // The whole 无色 pool is reachable, not just its first entry.
    expect(seen.size).toBe(COLORLESS_POOL.length);
    expect(COLORLESS_POOL.length).toBeGreaterThanOrEqual(5);
  });

  it('stocks 常见 / 罕见 / 坊市 relics in that order', () => {
    expect(RELIC_SHELF).toEqual(['common', 'uncommon', 'shop']);
    for (let i = 0; i < 30; i++) {
      const run = fresh(`tiers-${i}`);
      const relics = ensureStock(run, shopNode(run)).relics;
      relics.forEach((offer, at) => {
        // Only the 坊市 slot is a closed pool; the other two may degrade down
        // the ladder, so they are checked as "not a shop relic" rather than
        // pinned to one tier.
        const tier = getRelic(offer.id)!.tier;
        if (at === 2) expect(tier, offer.id).toBe('shop');
        else expect(tier, offer.id).not.toBe('shop');
      });
    }
  });

  it('sells only 坊市 relics that exist to be sold', () => {
    // A regression guard on the pool itself: with one 坊市 relic the shelf would
    // repeat, and with none the third slot would silently vanish.
    expect(relicsOfTier('shop').length).toBeGreaterThanOrEqual(3);
  });
});

describe('定价', () => {
  it('prices a card inside its rarity band', () => {
    expect(CARD_PRICE.common).toEqual([26, 32]);
    expect(CARD_PRICE.uncommon).toEqual([40, 48]);
    expect(CARD_PRICE.rare).toEqual([78, 92]);

    for (let i = 0; i < 80; i++) {
      const run = fresh(`price-${i}`);
      for (const offer of ensureStock(run, shopNode(run)).cards) {
        const rarity = resolveCard(offer.defId).rarity;
        if (rarity === 'basic') throw new Error(`basic card on the shelf: ${offer.defId}`);
        const [lo, hi] = CARD_PRICE[rarity];
        // A discounted slot pays half; the band applies to the list price.
        const list = offer.listPrice ?? offer.price;
        expect(list, `${offer.defId} ${rarity}`).toBeGreaterThanOrEqual(lo);
        expect(list, `${offer.defId} ${rarity}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('prices a relic by the tier it actually is, not the tier it was asked for', () => {
    for (let i = 0; i < 60; i++) {
      const run = fresh(`relic-price-${i}`);
      for (const offer of ensureStock(run, shopNode(run)).relics) {
        const [lo, hi] = RELIC_PRICE[getRelic(offer.id)!.tier];
        const list = offer.listPrice ?? offer.price;
        expect(list, offer.id).toBeGreaterThanOrEqual(lo);
        expect(list, offer.id).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('prices a potion by its rarity', () => {
    expect(POTION_PRICE.common).toEqual([27, 31]);
    for (let i = 0; i < 60; i++) {
      const run = fresh(`potion-price-${i}`);
      for (const offer of ensureStock(run, shopNode(run)).potions) {
        const [lo, hi] = POTION_PRICE[getPotion(offer.id).rarity];
        const list = offer.listPrice ?? offer.price;
        expect(list, offer.id).toBeGreaterThanOrEqual(lo);
        expect(list, offer.id).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('discounts at most one slot, always a card or a relic, at half price', () => {
    let discounts = 0;
    for (let i = 0; i < 120; i++) {
      const run = fresh(`disc-${i}`);
      const stock = ensureStock(run, shopNode(run));
      const marked = [...stock.cards, ...stock.relics].filter((o) => o.listPrice !== undefined);
      expect(marked.length, `seed disc-${i}`).toBeLessThanOrEqual(1);
      // 丹药 never go on sale — the original discounts a card or a relic.
      for (const potion of stock.potions) expect(potion.listPrice).toBeUndefined();
      for (const offer of marked) {
        expect(offer.price).toBe(discountedPrice(offer.listPrice!));
        expect(offer.price * 2).toBeGreaterThanOrEqual(offer.listPrice!);
      }
      discounts += marked.length;
    }
    // Two draws decide the discount, so it lands on nearly every shelf — but a
    // roll onto a slot that came back empty leaves none, which is legal.
    expect(discounts).toBeGreaterThan(100);
  });

  it('rounds a discounted odd price up rather than down', () => {
    expect(discountedPrice(27)).toBe(14);
    expect(discountedPrice(92)).toBe(46);
    expect(discountedPrice(1)).toBe(1);
  });

  it('weights the card rarities to 100', () => {
    const total = REWARD_RARITIES.reduce((sum, r) => sum + SHOP_CARD_WEIGHTS[r], 0);
    expect(total).toBe(100);
    // Rarer than a monster reward (3% rare), flatter than an elite's (13%).
    expect(SHOP_CARD_WEIGHTS.rare).toBe(12);
  });

  it('keeps a whole shelf out of reach of one run', () => {
    // The calibration claim: ~300 资财 a run, so clearing a counter is not an
    // option a player ever has. If this starts passing cheaply the bands drifted.
    const run = fresh('afford');
    const stock = ensureStock(run, shopNode(run));
    const total =
      [...stock.cards, ...stock.relics, ...stock.potions].reduce((sum, o) => sum + o.price, 0);
    expect(total).toBeGreaterThan(300);
  });
});

describe('买卖', () => {
  it('adds the card, charges the price, and closes the slot', () => {
    const run = rich('buy-card');
    const id = shopNode(run);
    const item = shelf(run, id)[0];
    const before = run.deck.length;

    expect(buy(run, id, item.slot)).toBe('ok');
    expect(run.deck).toHaveLength(before + 1);
    expect(run.deck.at(-1)!.defId).toBe(item.id);
    expect(run.gold).toBe(9999 - item.price);

    // Bought is bought: a second click pays nothing and takes nothing.
    const goldAfter = run.gold;
    expect(buy(run, id, item.slot)).toBe('sold');
    expect(run.gold).toBe(goldAfter);
    expect(run.deck).toHaveLength(before + 1);
    expect(shelf(run, id)[0].sold).toBe(true);
  });

  it('charges the discounted price, not the list price', () => {
    for (let i = 0; i < 40; i++) {
      const run = rich(`disc-buy-${i}`);
      const id = shopNode(run);
      const item = shelf(run, id).find((s) => s.listPrice !== null);
      if (!item) continue;
      const before = run.gold;
      expect(buy(run, id, item.slot)).toBe('ok');
      expect(before - run.gold).toBe(item.price);
      expect(item.price).toBeLessThan(item.listPrice!);
      return;
    }
    throw new Error('no discounted slot in 40 shelves');
  });

  it('hands over the relic and the potion too', () => {
    const run = rich('buy-rest');
    const id = shopNode(run);
    const relic = shelf(run, id).find((s) => s.slot.kind === 'relic')!;
    const potion = shelf(run, id).find((s) => s.slot.kind === 'potion')!;

    expect(buy(run, id, relic.slot)).toBe('ok');
    expect(run.relics).toContain(relic.id);

    expect(buy(run, id, potion.slot)).toBe('ok');
    expect(run.potions).toContain(potion.id);
  });

  it('refuses a purchase the purse cannot cover, and charges nothing', () => {
    const run = fresh('poor');
    const id = shopNode(run);
    const item = shelf(run, id).find((s) => s.slot.kind === 'relic')!;
    run.gold = item.price - 1;

    expect(buy(run, id, item.slot)).toBe('poor');
    expect(run.gold).toBe(item.price - 1);
    expect(run.relics).not.toContain(item.id);
    // Refused, not spent: the slot is still on sale once the purse fills up.
    expect(shelf(run, id).find((s) => s.slot.kind === 'relic')!.sold).toBe(false);
    expect(shelf(run, id).find((s) => s.slot.kind === 'relic')!.blocked).toBe('资财不足');

    run.gold = item.price;
    expect(buy(run, id, item.slot)).toBe('ok');
    expect(run.gold).toBe(0);
  });

  it('refuses a bottle when the belt is full, and charges nothing', () => {
    const run = rich('full-belt');
    const id = shopNode(run);
    // Three slots, filled — `hasPotionSpace`, not a hard 3, so 药囊 still works.
    while (run.potions.includes(null)) addPotion(run, 'huoyouguan');
    const item = shelf(run, id).find((s) => s.slot.kind === 'potion')!;

    expect(buy(run, id, item.slot)).toBe('nospace');
    expect(run.gold).toBe(9999);
    expect(shelf(run, id).find((s) => s.slot.kind === 'potion')!.blocked).toBe('丹药囊已满');
    expect(run.potions.filter((p) => p === item.id)).toHaveLength(0);
  });

  it('closes a relic slot the player got hold of somewhere else', () => {
    const run = rich('elsewhere');
    const id = shopNode(run);
    const item = shelf(run, id).find((s) => s.slot.kind === 'relic')!;
    // An 奇遇 or a 宝藏 handed it over after the stock froze.
    addRelic(run, item.id);

    expect(buy(run, id, item.slot)).toBe('sold');
    expect(run.gold).toBe(9999);
    expect(shelf(run, id).find((s) => s.slot.kind === 'relic')!.sold).toBe(true);
  });

  it('reports an empty slot as sold rather than throwing', () => {
    const run = rich('empty-slot');
    const id = shopNode(run);
    expect(buy(run, id, { kind: 'card', index: 99 })).toBe('sold');
    expect(run.gold).toBe(9999);
  });

  it('never lets the purse go negative, however hard the shelf is worked', () => {
    const run = fresh('purse');
    run.gold = 120;
    const id = shopNode(run);
    for (const slot of slotsOf(run, id)) buy(run, id, slot);
    for (const slot of slotsOf(run, id)) buy(run, id, slot);
    expect(run.gold).toBeGreaterThanOrEqual(0);
    expect(new Set(run.relics).size).toBe(run.relics.length);
    expect(run.potions).toHaveLength(run.potionSlots);
  });

  it('empties out when everything has been bought', () => {
    const run = rich('sweep');
    const id = shopNode(run);
    expect(isCleanedOut(run, id)).toBe(false);
    for (const slot of slotsOf(run, id)) buy(run, id, slot);
    expect(isCleanedOut(run, id)).toBe(true);
  });

  it('leaves the run untouched when a purchase is refused', () => {
    const run = fresh('untouched');
    run.gold = 0;
    const id = shopNode(run);
    ensureStock(run, id);
    const snapshot = structuredClone({ ...run, map: null, hero: null });

    for (const slot of slotsOf(run, id)) expect(buy(run, id, slot)).toBe('poor');
    expect(structuredClone({ ...run, map: null, hero: null })).toEqual(snapshot);
  });
});

describe('弃卡', () => {
  it('costs 52 the first time', () => {
    const run = rich('removal');
    expect(REMOVAL_BASE).toBe(52);
    expect(removalPrice(run)).toBe(52);
  });

  it('removes the physical copy that was named, not the first of its kind', () => {
    const run = rich('removal-uid');
    const id = shopNode(run);
    const strikes = run.deck.filter((c) => c.defId === 'pikan');
    expect(strikes.length).toBeGreaterThan(1);
    const target = strikes[1];

    expect(buyRemoval(run, id, target.uid)).toBe(true);
    expect(run.deck.map((c) => c.uid)).not.toContain(target.uid);
    // The others are still there — an id-based removal would have taken one.
    expect(run.deck.filter((c) => c.defId === 'pikan')).toHaveLength(strikes.length - 1);
    expect(run.gold).toBe(9999 - 52);
  });

  it('tells an upgraded copy apart from an unforged one', () => {
    const run = rich('removal-upgraded');
    const id = shopNode(run);
    const forged = run.deck.find((c) => c.defId === 'pikan')!;
    forged.upgraded = 1;
    const plain = run.deck.filter((c) => c.defId === 'pikan' && c.upgraded === 0);

    expect(buyRemoval(run, id, forged.uid)).toBe(true);
    expect(run.deck.some((c) => c.uid === forged.uid)).toBe(false);
    expect(run.deck.filter((c) => c.defId === 'pikan' && c.upgraded === 0)).toHaveLength(
      plain.length,
    );
  });

  it('serves one card per shop and refuses the second', () => {
    const run = rich('removal-once');
    const id = shopNode(run);
    expect(buyRemoval(run, id, run.deck[0].uid)).toBe(true);
    const gold = run.gold;
    const size = run.deck.length;

    expect(buyRemoval(run, id, run.deck[0].uid)).toBe(false);
    expect(run.gold).toBe(gold);
    expect(run.deck).toHaveLength(size);
    expect(removalBlocked(run, id)).toBe('此处已了此事');
  });

  it('charges 70 at the second shop — the surcharge outlives the counter', () => {
    // Measured, not simulated: P(a run walks into two shops) is about 6%, so a
    // play-through fuzz would essentially never reach this price.
    const run = withShops(2, 'surcharge');
    run.gold = 9999;
    const [first, second] = shopNodes(run);

    expect(buyRemoval(run, first, run.deck[0].uid)).toBe(true);
    expect(run.cardRemovalSurcharge).toBe(REMOVAL_STEP);
    expect(REMOVAL_STEP).toBe(18);
    expect(removalPrice(run)).toBe(70);

    const before = run.gold;
    expect(buyRemoval(run, second, run.deck[0].uid)).toBe(true);
    expect(before - run.gold).toBe(70);
    expect(removalPrice(run)).toBe(88);
  });

  it('escalates monotonically, never resetting', () => {
    const run = withShops(2, 'escalate');
    run.gold = 9999;
    const prices: number[] = [];
    for (const id of shopNodes(run)) {
      prices.push(removalPrice(run));
      expect(buyRemoval(run, id, run.deck[0].uid)).toBe(true);
    }
    expect(prices.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBe(prices[i - 1] + 18);
  });

  it('refuses when the purse is short, and charges nothing', () => {
    const run = fresh('removal-poor');
    run.gold = 51;
    const id = shopNode(run);
    const size = run.deck.length;

    expect(removalBlocked(run, id)).toBe('资财不足');
    expect(buyRemoval(run, id, run.deck[0].uid)).toBe(false);
    expect(run.gold).toBe(51);
    expect(run.deck).toHaveLength(size);
    expect(run.cardRemovalSurcharge).toBe(0);
  });

  it('refuses a uid that is not in the deck', () => {
    const run = rich('removal-ghost');
    const id = shopNode(run);
    expect(buyRemoval(run, id, 'not-a-card')).toBe(false);
    expect(run.gold).toBe(9999);
    // Refused *before* the gate, so the counter is still open.
    expect(removalBlocked(run, id)).toBeNull();
  });

  it('will not thin a deck below four cards', () => {
    const run = rich('removal-thin');
    const id = shopNode(run);
    run.deck = run.deck.slice(0, MIN_DECK_SIZE);
    expect(removalBlocked(run, id)).toBe('牌少不可再弃');
    expect(buyRemoval(run, id, run.deck[0].uid)).toBe(false);
    expect(run.deck).toHaveLength(MIN_DECK_SIZE);
  });
});

describe('台账', () => {
  it('keys every one-shot action the way the contract spells it', () => {
    const run = rich('ledger');
    const id = shopNode(run);
    buy(run, id, { kind: 'card', index: 0 });
    buy(run, id, { kind: 'relic', index: 2 });
    buy(run, id, { kind: 'potion', index: 1 });
    buyRemoval(run, id, run.deck[0].uid);

    expect(run.rooms[id].committed).toEqual([
      'item:card:0',
      'item:relic:2',
      'item:potion:1',
      'removal:0',
    ]);
    expect(run.rooms[id].kind).toBe('shop');
  });

  it('reads a shelf without writing anything but the frozen stock', () => {
    const run = fresh('read-only');
    const id = shopNode(run);
    shelf(run, id);
    expect(roomCommit(run, id).count('item:')).toBe(0);
    expect(run.rooms[id].committed).toEqual([]);
  });

  it('survives a reload: the ledger, not scene state, remembers the sale', () => {
    const run = rich('reload');
    const id = shopNode(run);
    buy(run, id, { kind: 'card', index: 0 });
    const gold = run.gold;
    const deck = run.deck.length;

    // What a save/load round trip amounts to for the room layer.
    const reloaded: RunState = { ...run, rooms: structuredClone(run.rooms) };
    expect(buy(reloaded, id, { kind: 'card', index: 0 })).toBe('sold');
    expect(reloaded.gold).toBe(gold);
    expect(reloaded.deck).toHaveLength(deck);
  });
});

describe('无色牌', () => {
  it('stays out of the post-combat reward pools', () => {
    const pooled = Object.values(CARD_POOL_BY_RARITY).flat();
    for (const id of COLORLESS_POOL) expect(pooled, id).not.toContain(id);
  });

  it('is a real card with a forge path and a price band', () => {
    for (const id of COLORLESS_POOL) {
      const def = CARDS[id];
      expect(def, id).toBeDefined();
      expect(isNegative(def), id).toBe(false);
      expect(def.upgrade, id).toBeDefined();
      expect(['common', 'uncommon', 'rare'], id).toContain(def.rarity);
      // 势 cards must declare 消耗 — the engine has no type branch for it.
      if (def.type === 'power') expect(def.keywords ?? [], id).toContain('exhaust');
    }
  });

  it('is never dealt by anything but the shop', () => {
    // The two other tables that hand out cards.
    const pooled = new Set(Object.values(CARD_POOL_BY_RARITY).flat());
    const starters = new Set(DEFAULT_HERO.startingDeck);
    for (const id of COLORLESS_POOL) {
      expect(pooled.has(id), id).toBe(false);
      expect(starters.has(id), id).toBe(false);
    }
  });
});

describe('库存内容', () => {
  it('has enough of every kind to fill a counter without repeating', () => {
    expect(Object.values(CARD_POOL_BY_RARITY).flat().length).toBeGreaterThanOrEqual(
      SHOP_CARD_COUNT,
    );
    expect(Object.keys(POTIONS).length).toBeGreaterThanOrEqual(SHOP_POTION_COUNT);
    expect(COLORLESS_POOL.length).toBeGreaterThan(0);
  });
});
