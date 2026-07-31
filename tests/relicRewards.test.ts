import { describe, expect, it } from 'vitest';
import { resolveCard } from '../src/combat/cards';
import { ENCOUNTERS } from '../src/combat/enemies';
import {
  BASE_ENERGY,
  HAND_SIZE,
  drawCards,
  endPlayerTurn,
  playCard,
  previewValues,
  runEnemyTurn,
  stacks,
  startCombat,
  startPlayerTurn,
} from '../src/combat/engine';
import { POTIONS } from '../src/combat/potions';
import {
  RELICS,
  RELIC_DROP_WEIGHTS,
  RELIC_LADDER,
  RELIC_MISS_GOLD,
  RELIC_TIER_ORDER,
  fireRunHook,
  relicText,
  relicsOfTier,
  type RelicSource,
  type RelicTier,
} from '../src/combat/relics';
import {
  BOSS_OFFER_DRAWS,
  BOSS_OFFER_SIZE,
  CHEST_EXTRA_DRAWS,
  CHEST_POTION_CHANCE,
  CHEST_RELIC_SOURCE,
  CHEST_SIZES,
  CHEST_SIZE_WEIGHTS,
  RELIC_ROLL_DRAWS,
  relicPool,
  rollBossOffer,
  rollChestExtras,
  rollRelic,
  rollRelicOfTier,
  type ChestSize,
} from '../src/combat/rewards';
import type { CombatState } from '../src/combat/types';
import { Rng } from '../src/core/rng';
import { DEFAULT_HERO } from '../src/data/heroes';
import { stream } from '../src/rooms/rng';
import { ensureLoot } from '../src/rooms/treasure';
import { addGold, addRelic, newDeckCard, startRun, type RunState } from '../src/state/run';

/**
 * todos/10 · 精英 · 宝箱 · Boss 遗物奖励 — one test per line of its 验收标准,
 * plus the numbers the new relics promise.
 *
 * The drop system's three failure modes are all silent: a weight table that
 * drifts from the design, a pool that hands out something already owned, and a
 * roll whose draw count depends on what it rolled — the last of which does not
 * misbehave at all until someone adds a relic and every old seed replays
 * differently. So the tests here are statistical, adversarial (runs that own
 * whole tiers) and count draws off `Rng.rolls`.
 */

const DROP_SOURCES = Object.keys(RELIC_DROP_WEIGHTS) as RelicSource[];

function run(seed = 'relic-drop'): RunState {
  return startRun(DEFAULT_HERO, seed);
}

const tierOf = (id: string): RelicTier => RELICS[id].tier;

/** Hand the run every relic of these tiers, so a roll has to fall back. */
function own(r: RunState, ...tiers: RelicTier[]): RunState {
  for (const tier of tiers) for (const def of relicsOfTier(tier)) addRelic(r, def.id);
  return r;
}

function bench(relics: string[], deck = 'pikan', seed = 'drop-bench'): CombatState {
  return startCombat({
    encounter: ENCOUNTERS.monster[0],
    deck: Array.from({ length: 20 }, () => newDeckCard(deck)),
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics,
    seed,
  });
}

/** Percentage of `n` rolls that landed on each tier. */
function tierSpread(source: RelicSource, n: number, seed: string): Record<string, number> {
  const r = run(seed);
  const rng = new Rng(seed);
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const id = rollRelic(rng, r, source);
    expect(id, `${source} must not run dry with a fresh run`).not.toBeNull();
    const tier = tierOf(id!);
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  for (const key of Object.keys(counts)) counts[key] = (counts[key] / n) * 100;
  return counts;
}

// --------------------------------------------------------------- the pool

describe('the relic table can actually pay out', () => {
  /**
   * The gap todos/10 is blocked on: before it, 稀有 held exactly one relic and
   * 首领 two, so an elite's 17% 稀有 slot could pay at most once a run and the
   * 战利品 chest could not show three distinct relics at all.
   */
  it('holds enough of every droppable tier to feed its own tables', () => {
    expect(relicsOfTier('common').length).toBeGreaterThanOrEqual(9);
    expect(relicsOfTier('uncommon').length).toBeGreaterThanOrEqual(8);
    expect(relicsOfTier('rare').length).toBeGreaterThanOrEqual(5);
    expect(relicsOfTier('boss').length).toBeGreaterThanOrEqual(BOSS_OFFER_SIZE + 3);
    expect(relicsOfTier('shop').length).toBeGreaterThanOrEqual(4);
  });

  it('keys every new entry by its own id and art, with no placeholder left', () => {
    for (const [key, def] of Object.entries(RELICS)) {
      expect(def.id, key).toBe(key);
      expect(def.art, key).toBe(`relic-${key}`);
      expect(relicText(def), key).not.toMatch(/\{N\}/);
      if (def.text.includes('{N}')) expect(def.value, key).toBeTypeOf('number');
    }
  });

  /**
   * 「说明文本完整含负收益」 — a 首领 relic is a build decision, so its cost has
   * to be printed on it. Checked as text because the cost lives in three
   * different places mechanically (modifiers, hooks, statuses).
   */
  it('prints the downside on every 首领 relic', () => {
    for (const def of relicsOfTier('boss')) {
      expect(relicText(def), def.id).toMatch(/但|-\d/);
    }
  });

  /**
   * No relic may cost 体力上限: `addRelic` moves `run.hp` by whatever it moves
   * `run.maxHp`, so a -10 max-HP relic taken at 8 HP ends the run on the spot.
   * That guard belongs in `addRelic`; until it exists, the table stays clean.
   */
  it('never sells a relic that could kill the player on pickup', () => {
    for (const def of Object.values(RELICS)) {
      expect(def.modifiers?.maxHp ?? 0, def.id).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The eight relics the 26 golden snapshots run through, pinned by hand. A
   * failure here means a fight's numbers moved, and `npm run sim` is about to
   * disagree with files that are not allowed to change.
   */
  it('leaves every snapshotted relic exactly as it was', () => {
    expect(RELICS.qinglongdao.value).toBe(3);
    expect(RELICS.xiandengdun.value).toBe(4);
    expect(RELICS.xiandengdun.modifiers).toEqual({ startingBlock: 4 });
    expect(RELICS.lianhuanjia.value).toBe(1);
    expect(RELICS.xuanwujia.value).toBe(6);
    expect(RELICS.xingjuntu.value).toBe(2);
    expect(RELICS.chitima.modifiers).toEqual({ energy: 1, handSize: -1 });
    expect(RELICS.chitima.value).toBeUndefined();
    expect(RELICS.tiemian.value).toBe(2);
    expect(RELICS.xiaoshouling.value).toBe(1);

    // 传国玉玺 keeps its 稀有 slot and its rules; todos/10's 首领 relic of the
    // same name is not it, and was not built by editing it.
    expect(RELICS.chuanguoyuxi.tier).toBe('rare');
    expect(RELICS.chuanguoyuxi.value).toBe(1);
  });
});

describe('RELIC_DROP_WEIGHTS', () => {
  it('sums each source to 100, so a row reads as the percentages it prints', () => {
    for (const source of DROP_SOURCES) {
      const row = RELIC_DROP_WEIGHTS[source];
      const total = Object.values(row).reduce((a, b) => a + b, 0);
      expect(total, source).toBe(100);
    }
  });

  it('names only tiers that exist, are droppable, and have stock', () => {
    for (const source of DROP_SOURCES) {
      for (const tier of Object.keys(RELIC_DROP_WEIGHTS[source]) as RelicTier[]) {
        expect(RELIC_TIER_ORDER, `${source}/${tier}`).toContain(tier);
        expect(tier, `${source} must not drop the hero's own relic`).not.toBe('starter');
        expect(relicsOfTier(tier).length, `${source}/${tier}`).toBeGreaterThan(0);
      }
    }
  });

  it('pays a constant consolation for every source', () => {
    for (const source of DROP_SOURCES) {
      expect(RELIC_MISS_GOLD[source], source).toBeGreaterThan(0);
    }
  });
});

// -------------------------------------------------------------- 掉落分布

describe('rollRelic · 掉落分布', () => {
  it('lands an elite on 50 / 33 / 17, within 3 points', () => {
    const d = tierSpread('elite', 3000, 'elite-dist');
    expect(d.common).toBeGreaterThan(47);
    expect(d.common).toBeLessThan(53);
    expect(d.uncommon).toBeGreaterThan(30);
    expect(d.uncommon).toBeLessThan(36);
    expect(d.rare).toBeGreaterThan(14);
    expect(d.rare).toBeLessThan(20);
  });

  /** The 验收标准 asks for 200 rolls; the shape has to survive that sample too. */
  it('is already recognisable over the 200 rolls the 验收标准 asks for', () => {
    const d = tierSpread('elite', 200, 'elite-200');
    expect(d.common).toBeGreaterThan(40);
    expect(d.common).toBeLessThan(60);
    expect(d.rare).toBeGreaterThan(8);
    expect(d.rare).toBeLessThan(26);
  });

  it('walks a chest from 75/25 up to 40/45/15 as it gets bigger', () => {
    const small = tierSpread('chestSmall', 2000, 'chest-s');
    expect(small.common).toBeGreaterThan(71);
    expect(small.common).toBeLessThan(79);
    expect(small.rare ?? 0).toBe(0);

    const medium = tierSpread('chestMedium', 2000, 'chest-m');
    expect(medium.common).toBeGreaterThan(56);
    expect(medium.common).toBeLessThan(64);
    expect(medium.rare).toBeGreaterThan(2);
    expect(medium.rare).toBeLessThan(9);

    const large = tierSpread('chestLarge', 2000, 'chest-l');
    expect(large.common).toBeGreaterThan(36);
    expect(large.common).toBeLessThan(44);
    expect(large.uncommon).toBeGreaterThan(41);
    expect(large.rare).toBeGreaterThan(11);
    expect(large.rare).toBeLessThan(19);

    // The point of three sizes: rarity climbs monotonically with size.
    expect(medium.rare).toBeLessThan(large.rare);
    expect(large.common).toBeLessThan(small.common);
  });

  it('draws 首领 relics from the 首领 pool and nothing else', () => {
    const d = tierSpread('boss', 300, 'boss-dist');
    expect(d).toEqual({ boss: 100 });
  });

  it('draws 坊市 relics from the 坊市 pool and nothing else', () => {
    const d = tierSpread('shop', 300, 'shop-dist');
    expect(d).toEqual({ shop: 100 });
  });
});

// ------------------------------------------------------------------ 去重

describe('rollRelic · 去重与兜底', () => {
  it('never hands out a relic the run already owns', () => {
    const r = run('dupes');
    const rng = new Rng('dupes');
    for (let i = 0; i < 800; i++) {
      const id = rollRelic(rng, r, 'elite');
      expect(id).not.toBeNull();
      expect(r.relics, id!).not.toContain(id);
      // Bank twenty of them along the way, so the pool genuinely thins out
      // under the test rather than being asked the same question 800 times.
      if (i % 40 === 0) addRelic(r, id!);
    }
    expect(r.relics.length).toBe(21);
  });

  it('honours an extra exclude list on top of what is owned', () => {
    const r = run('exclude');
    const spoken = relicsOfTier('common').map((d) => d.id);
    const rng = new Rng('exclude');
    for (let i = 0; i < 300; i++) {
      const id = rollRelic(rng, r, 'chestSmall', spoken);
      expect(spoken, id!).not.toContain(id);
    }
  });

  /**
   * Down the ladder before up it. Owning every 稀有 must not start handing out
   * 首领 relics, and must not hand back null while 罕见 stock is still on the
   * shelf — the contract's exact case.
   */
  it('degrades a drained 稀有 roll into 罕见, never into null or a 首领 relic', () => {
    const r = own(run('no-rares'), 'rare');
    const rng = new Rng('no-rares');
    for (let i = 0; i < 400; i++) {
      const id = rollRelic(rng, r, 'chestLarge');
      expect(id).not.toBeNull();
      expect(['common', 'uncommon'], id!).toContain(tierOf(id!));
    }
  });

  it('steps down before it steps up when the middle of the ladder is gone', () => {
    const r = own(run('no-uncommon'), 'uncommon');
    // A 罕见 roll with the commons still stocked must land on 常见, not 稀有.
    expect(relicPool(r, 'uncommon').map(tierOf)).toEqual(
      relicPool(r, 'uncommon').map(() => 'common'),
    );

    const drained = own(run('no-common-uncommon'), 'common', 'uncommon');
    expect(relicPool(drained, 'uncommon').map(tierOf)).toEqual(
      relicPool(drained, 'uncommon').map(() => 'rare'),
    );
  });

  it('returns null only when the source has nothing left at any tier', () => {
    const r = own(run('drained'), 'common', 'uncommon', 'rare');
    const rng = new Rng('drained');
    for (let i = 0; i < 50; i++) expect(rollRelic(rng, r, 'elite')).toBeNull();

    // And the caller's fallback is a constant, not a die.
    expect(RELIC_MISS_GOLD.elite).toBe(60);
  });

  it('keeps 坊市 stock out of drop pools, and drops out of 坊市 stock', () => {
    const shopOnly = own(run('shop-closed'), 'shop');
    // A drained 坊市 shelf falls back to nothing rather than to a drop relic.
    expect(relicPool(shopOnly, 'shop')).toEqual([]);

    // ... and no drop source can ever produce one.
    const r = run('no-shop-drops');
    const rng = new Rng('no-shop-drops');
    for (const source of ['elite', 'chestLarge', 'event'] as RelicSource[]) {
      for (let i = 0; i < 200; i++) {
        const id = rollRelic(rng, r, source);
        expect(tierOf(id!), id!).not.toBe('shop');
      }
    }
  });

  it('falls a drained 首领 pool onto 稀有 rather than onto 坊市 or null', () => {
    const r = own(run('no-boss'), 'boss');
    const rng = new Rng('no-boss');
    for (let i = 0; i < 200; i++) {
      const id = rollRelic(rng, r, 'boss');
      expect(id).not.toBeNull();
      expect(tierOf(id!), id!).toBe('rare');
    }
  });
});

// ------------------------------------------------------- 恒定抽取次数 (R3)

describe('每个 purpose 的抽取次数恒定', () => {
  it('spends exactly two draws on a relic, full pool or empty', () => {
    const full = new Rng('draws-full');
    rollRelic(full, run('draws-full'), 'elite');
    expect(full.rolls).toBe(RELIC_ROLL_DRAWS);

    const empty = new Rng('draws-empty');
    const drained = own(run('draws-empty'), 'common', 'uncommon', 'rare');
    expect(rollRelic(empty, drained, 'elite')).toBeNull();
    expect(empty.rolls).toBe(RELIC_ROLL_DRAWS);

    // And a degraded roll costs no more than a clean one.
    const degraded = new Rng('draws-degraded');
    rollRelic(degraded, own(run('draws-degraded'), 'rare'), 'chestLarge');
    expect(degraded.rolls).toBe(RELIC_ROLL_DRAWS);
  });

  it('spends one draw on a tier the caller already chose', () => {
    const rng = new Rng('tier-draws');
    expect(tierOf(rollRelicOfTier(rng, run('tier-draws'), 'shop')!)).toBe('shop');
    expect(rng.rolls).toBe(1);

    // Empty pool, same one draw, and a null rather than an `undefined` that
    // would sail straight into `addRelic`.
    const dry = new Rng('tier-dry');
    expect(rollRelicOfTier(dry, own(run('tier-dry'), 'shop'), 'shop')).toBeNull();
    expect(dry.rolls).toBe(1);
  });

  it('spends six draws on a 战利品 offer however many relics come back', () => {
    const rng = new Rng('boss-draws');
    expect(rollBossOffer(rng, run('boss-draws'))).toHaveLength(BOSS_OFFER_SIZE);
    expect(rng.rolls).toBe(BOSS_OFFER_DRAWS);

    const dry = new Rng('boss-dry');
    const drained = own(run('boss-dry'), 'boss', 'common', 'uncommon', 'rare');
    expect(rollBossOffer(dry, drained)).toEqual([]);
    expect(dry.rolls).toBe(BOSS_OFFER_DRAWS);
  });

  it('spends six draws on a chest whatever it holds', () => {
    for (const seed of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
      const rng = new Rng(seed);
      rollChestExtras(rng, run(seed));
      expect(rng.rolls, seed).toBe(CHEST_EXTRA_DRAWS);
    }

    const dry = new Rng('chest-dry');
    const drained = own(run('chest-dry'), 'common', 'uncommon', 'rare');
    expect(rollChestExtras(dry, drained).relicId).toBeNull();
    expect(dry.rolls).toBe(CHEST_EXTRA_DRAWS);
  });

  /**
   * The one byte-compatibility promise the room contract makes: 宝藏's gold is
   * the *first* draw on the `loot` stream and stays `range(25, 45)`, with
   * todos/10's six behind it. A chest opened on a given seed pays the same coin
   * it paid before relics existed.
   */
  it('leaves 宝藏 gold exactly where the room layer froze it', () => {
    const r = run('loot-compat');
    const nodeId = [...r.map.nodes.values()].find((n) => n.type === 'treasure')!.id;

    const rng = stream(r, nodeId, 'loot');
    const gold = rng.range(25, 45);
    expect(gold).toBe(ensureLoot(r, nodeId).gold);

    rollChestExtras(rng, r);
    expect(rng.rolls).toBe(1 + CHEST_EXTRA_DRAWS);
  });
});

// ------------------------------------------------------------------ 宝藏

describe('rollChestExtras · 宝藏', () => {
  /** Sizes and their contents over many chests, from one stream. */
  function chests(n: number, seed: string) {
    const r = run(seed);
    const rng = new Rng(seed);
    const sizes: Record<string, number> = { small: 0, medium: 0, large: 0 };
    const potions: Record<string, number> = { small: 0, medium: 0, large: 0 };
    for (let i = 0; i < n; i++) {
      const loot = rollChestExtras(rng, r);
      sizes[loot.size] += 1;
      if (loot.potionId) potions[loot.size] += 1;
      expect(loot.relicId, 'a fresh run can always be paid in relics').not.toBeNull();
      expect(loot.gold).toBe(0);
      if (loot.potionId) expect(POTIONS[loot.potionId], loot.potionId).toBeDefined();
    }
    return { sizes, potions };
  }

  it('rolls sizes 50 / 33 / 17', () => {
    const { sizes } = chests(3000, 'sizes');
    expect((sizes.small / 3000) * 100).toBeGreaterThan(47);
    expect((sizes.small / 3000) * 100).toBeLessThan(53);
    expect((sizes.medium / 3000) * 100).toBeGreaterThan(30);
    expect((sizes.medium / 3000) * 100).toBeLessThan(36);
    expect((sizes.large / 3000) * 100).toBeGreaterThan(14);
    expect((sizes.large / 3000) * 100).toBeLessThan(20);
  });

  it('always holds a relic, and adds a 丹药 at the printed rate per size', () => {
    const { sizes, potions } = chests(3000, 'contents');
    expect(potions.small).toBe(0);

    const rate = (size: ChestSize): number => (potions[size] / sizes[size]) * 100;
    expect(rate('medium')).toBeGreaterThan(CHEST_POTION_CHANCE.medium - 5);
    expect(rate('medium')).toBeLessThan(CHEST_POTION_CHANCE.medium + 5);
    expect(rate('large')).toBeGreaterThan(CHEST_POTION_CHANCE.large - 6);
    expect(rate('large')).toBeLessThan(CHEST_POTION_CHANCE.large + 6);
  });

  it('pays the size-matched consolation when the pool is dry', () => {
    const drained = own(run('chest-dry-gold'), 'common', 'uncommon', 'rare');
    const rng = new Rng('chest-dry-gold');
    for (let i = 0; i < 60; i++) {
      const loot = rollChestExtras(rng, drained);
      expect(loot.relicId).toBeNull();
      expect(loot.gold).toBe(RELIC_MISS_GOLD[CHEST_RELIC_SOURCE[loot.size]]);
      expect(loot.gold).toBeGreaterThan(0);
    }
  });

  it('weights every size and prices every size', () => {
    for (const size of CHEST_SIZES) {
      expect(CHEST_SIZE_WEIGHTS[size], size).toBeGreaterThan(0);
      expect(RELIC_DROP_WEIGHTS[CHEST_RELIC_SOURCE[size]], size).toBeDefined();
    }
    const total = CHEST_SIZES.reduce((a, s) => a + CHEST_SIZE_WEIGHTS[s], 0);
    expect(total).toBe(100);
  });
});

// ---------------------------------------------------------------- 战利品

describe('rollBossOffer · 战利品', () => {
  it('offers three distinct 首领 relics', () => {
    for (const seed of ['b1', 'b2', 'b3', 'b4']) {
      const offer = rollBossOffer(new Rng(seed), run(seed));
      expect(offer, seed).toHaveLength(BOSS_OFFER_SIZE);
      expect(new Set(offer).size, seed).toBe(BOSS_OFFER_SIZE);
      for (const id of offer) expect(tierOf(id), id).toBe('boss');
    }
  });

  it('never offers a 首领 relic already taken in an earlier act', () => {
    const r = run('boss-owned');
    addRelic(r, 'chitima');
    for (const seed of ['o1', 'o2', 'o3', 'o4', 'o5']) {
      expect(rollBossOffer(new Rng(seed), r)).not.toContain('chitima');
    }
  });

  it('tops a thinning 首领 pool up from 稀有 rather than showing two relics', () => {
    const r = run('boss-thin');
    for (const id of relicsOfTier('boss').slice(0, 4)) addRelic(r, id.id);
    const offer = rollBossOffer(new Rng('thin'), r);

    expect(offer).toHaveLength(BOSS_OFFER_SIZE);
    expect(new Set(offer).size).toBe(BOSS_OFFER_SIZE);
    expect(offer.filter((id) => tierOf(id) === 'boss')).toHaveLength(2);
    expect(offer.filter((id) => tierOf(id) === 'rare')).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ 复现

describe('同一 seed 完全可复现', () => {
  it('replays an elite drop, a chest and a 战利品 offer byte for byte', () => {
    const elite = (): string | null => rollRelic(new Rng('seed:node:eliteRelic'), run('rep'), 'elite');
    expect(elite()).toBe(elite());

    const chest = () => rollChestExtras(new Rng('seed:node:loot'), run('rep'));
    expect(chest()).toEqual(chest());

    const offer = (): string[] => rollBossOffer(new Rng('seed:node:bossRelic'), run('rep'));
    expect(offer()).toEqual(offer());
  });

  it('gives different nodes different drops', () => {
    const r = run('spread');
    const a = rollChestExtras(new Rng('spread:n1:loot'), r);
    const b = rollChestExtras(new Rng('spread:n2:loot'), r);
    expect([a.size, a.relicId, a.potionId]).not.toEqual([b.size, b.relicId, b.potionId]);
  });

  /**
   * What a run already owns is part of the input, deliberately: a chest rolled
   * before and after picking up its own relic must not offer it twice. Which is
   * why `ensureLoot` materialises the result rather than re-deriving it.
   */
  it('reads the run, so the same stream on a richer run rolls around it', () => {
    const seed = 'same:node:eliteRelic';
    const first = rollRelic(new Rng(seed), run('same'), 'elite')!;

    // Same stream, same draws — but the tier it landed on is now spoken for.
    const rich = own(run('same'), tierOf(first));
    const second = rollRelic(new Rng(seed), rich, 'elite')!;

    expect(second).not.toBe(first);
    expect(tierOf(second)).not.toBe(tierOf(first));
  });
});

// ------------------------------------------------------------ 新增遗物

describe('新增遗物 · 罕见', () => {
  it('羽扇 opens the fight with 1 神力', () => {
    expect(stacks(bench(['yushan']).player, 'strength')).toBe(RELICS.yushan.value);
    expect(stacks(bench([]).player, 'strength')).toBe(0);
  });

  it('木牛流马 heals on every reshuffle, and not at full health', () => {
    const state = bench(['mumaliu']);
    state.player.hp = 40;

    state.discardPile.push(...state.drawPile.splice(0));
    drawCards(state, 1);
    expect(state.player.hp).toBe(40 + (RELICS.mumaliu.value ?? 0));

    state.player.hp = state.player.maxHp;
    state.discardPile.push(...state.drawPile.splice(0));
    drawCards(state, 1);
    expect(state.player.hp).toBe(state.player.maxHp);
  });

  it('黄石公书 draws on the turn first 技 only, and recharges each turn', () => {
    const state = bench(['huangshishu'], 'tiebi');
    const held = state.hand.length;

    // Played one, drew one back.
    playCard(state, state.hand[0]);
    expect(state.hand).toHaveLength(held);
    expect(state.relicCounters.huangshishu).toBe(1);

    playCard(state, state.hand[0]);
    expect(state.hand).toHaveLength(held - 1);

    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(state.relicCounters.huangshishu).toBe(0);
  });

  it('黄石公书 ignores 攻 cards', () => {
    const state = bench(['huangshishu'], 'pikan');
    const held = state.hand.length;
    playCard(state, state.hand[0], state.enemies[0].id);
    expect(state.hand).toHaveLength(held - 1);
    expect(state.relicCounters.huangshishu ?? 0).toBe(0);
  });
});

describe('新增遗物 · 稀有', () => {
  it('藤甲 lays 3 armour at the start of every turn', () => {
    const state = bench(['tengjia']);
    expect(state.player.block).toBe(RELICS.tengjia.value);

    state.player.block = 99;
    startPlayerTurn(state);
    expect(state.player.block).toBe(RELICS.tengjia.value);
  });

  it('古锭刀 adds its damage to every 攻 card, on the face and on the enemy', () => {
    const state = bench(['gudingdao']);
    const bonus = RELICS.gudingdao.value ?? 0;
    expect(previewValues(state, resolveCard('pikan', 0)).D).toBe(6 + bonus);

    const enemy = state.enemies[0];
    let hp = enemy.hp;
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6 + bonus);

    // Unlike 青龙偃月刀 it does not spend itself on the turn's first attack.
    hp = enemy.hp;
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6 + bonus);
  });

  it('古锭刀 leaves 技 cards alone', () => {
    const state = bench(['gudingdao'], 'tiebi');
    expect(previewValues(state, resolveCard('tiebi', 0)).B).toBe(5);
    playCard(state, state.hand[0]);
    expect(state.player.block).toBe(5);
  });

  it('孙子兵法 draws two on every fifth card', () => {
    const state = bench(['sunzibingfa']);
    state.enemies[0].hp = 999;
    state.energy = 99;

    const held = state.hand.length;
    for (let i = 0; i < 4; i++) playCard(state, state.hand[0], state.enemies[0].id);
    expect(state.hand).toHaveLength(held - 4);
    expect(state.relicCounters.sunzibingfa).toBe(4);

    playCard(state, state.hand[0], state.enemies[0].id);
    expect(state.hand).toHaveLength(held - 5 + (RELICS.sunzibingfa.value ?? 0));
    expect(state.relicCounters.sunzibingfa).toBe(0);
  });

  it('七星灯 burns only below half health', () => {
    const state = bench(['qixingdeng']);
    const value = RELICS.qixingdeng.value ?? 0;

    state.player.hp = state.player.maxHp;
    startPlayerTurn(state);
    expect(state.player.hp).toBe(state.player.maxHp);

    // Exactly half is not below half.
    state.player.hp = Math.ceil(state.player.maxHp / 2);
    startPlayerTurn(state);
    expect(state.player.hp).toBe(Math.ceil(state.player.maxHp / 2));

    state.player.hp = 20;
    startPlayerTurn(state);
    expect(state.player.hp).toBe(20 + value);
  });
});

describe('新增遗物 · 首领', () => {
  it('方天画戟 pays damage on every attack and takes half the coin', () => {
    const bonus = RELICS.fangtianhuaji.value ?? 0;
    const state = bench(['fangtianhuaji']);
    const enemy = state.enemies[0];
    const hp = enemy.hp;
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6 + bonus);

    const r = run('halved');
    r.gold = 0;
    addRelic(r, 'fangtianhuaji');
    addGold(r, 40);
    expect(r.gold).toBe(20);
    // Spending is never scaled, so the tax cannot become a discount.
    addGold(r, -10);
    expect(r.gold).toBe(10);
  });

  it('虎符 opens with 神力 and re-applies 力竭 every single turn', () => {
    const state = bench(['hufu'], 'tiebi');
    expect(stacks(state.player, 'strength')).toBe(RELICS.hufu.value);
    expect(stacks(state.player, 'frail')).toBe(1);

    // 力竭 shaves card block by a quarter; relic-sourced block stays whole.
    playCard(state, state.hand[0]);
    expect(state.player.block).toBe(3);

    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(stacks(state.player, 'frail')).toBe(1);
    expect(stacks(state.player, 'strength')).toBe(RELICS.hufu.value);
  });

  it('铜雀台 buys half again as much coin with a card off every hand', () => {
    expect(bench(['tongquetai']).hand).toHaveLength(HAND_SIZE - 1);

    const r = run('tower');
    r.gold = 0;
    addRelic(r, 'tongquetai');
    addGold(r, 40);
    expect(r.gold).toBe(60);
  });

  it('九锡 buys a fourth 气 with a narrower draft', () => {
    expect(bench(['jiuxi']).maxEnergy).toBe(BASE_ENERGY + 1);

    const r = run('jiuxi');
    expect(r.cardRewardCount).toBe(3);
    addRelic(r, 'jiuxi');
    expect(r.cardRewardCount).toBe(2);
  });

  it('keeps every 首领 relic a trade rather than a straight upgrade', () => {
    // Each one either subtracts through a modifier or applies a status to its
    // own owner; a boss relic with no cost at all is a design bug.
    for (const def of relicsOfTier('boss')) {
      const mods = Object.values(def.modifiers ?? {});
      const subtracts = mods.some((v) => v < 0) || (def.modifiers?.goldMultiplier ?? 1) < 1;
      const selfStatus = /力竭|怯战|破绽|诅咒/.test(def.text);
      expect(subtracts || selfStatus, def.id).toBe(true);
    }
  });
});

describe('新增遗物 · 坊市', () => {
  it('酒葫芦 pours a little back at every room, and stays quiet at full health', () => {
    const r = run('gourd');
    addRelic(r, 'jiuhulu');
    r.hp = r.maxHp - 10;

    expect(fireRunHook(r, 'roomEnter', 'shop')).toEqual(['jiuhulu']);
    expect(r.hp).toBe(r.maxHp - 10 + (RELICS.jiuhulu.value ?? 0));

    r.hp = r.maxHp;
    expect(fireRunHook(r, 'roomEnter', 'rest')).toEqual([]);
    expect(r.hp).toBe(r.maxHp);
  });
});

describe('the ladder itself', () => {
  it('runs worst to best, so stepping down is stepping cheaper', () => {
    expect(RELIC_LADDER).toEqual(['common', 'uncommon', 'rare']);
  });

  it('orders every tier the weight tables can name', () => {
    for (const tier of RELIC_LADDER) expect(RELIC_TIER_ORDER).toContain(tier);
    expect(RELIC_TIER_ORDER).toContain('boss');
    expect(RELIC_TIER_ORDER).toContain('shop');
  });
});
