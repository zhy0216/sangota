import { describe, expect, it } from 'vitest';
import { CARDS, CARD_POOL_BY_RARITY, COLORLESS_POOL, getCard } from '../src/combat/cards';
import { isNegative } from '../src/combat/curses';
import {
  BASE_CARD_REWARD_COUNT,
  REWARD_RARITIES,
  TIER_WEIGHTS,
  availableRarity,
  rewardWeights,
  rollCardReward,
  type RewardRarity,
  type RewardTier,
} from '../src/combat/rewards';
import shopSource from '../src/rooms/shop.ts?raw';
import { Rng } from '../src/core/rng';
import { modsFor } from '../src/data/ascension';
import { DEFAULT_HERO } from '../src/data/heroes';
import { addRelic, startRun, type RunState } from '../src/state/run';

/**
 * todos/11 · 卡牌稀有度与奖励规则 — one test per line of its 验收标准.
 */

const rarityOf = (defId: string): RewardRarity =>
  REWARD_RARITIES.find((r) => CARD_POOL_BY_RARITY[r].includes(defId))!;

function run(seed = 'reward'): RunState {
  return startRun(DEFAULT_HERO, seed);
}

/**
 * Rarity counts over `n` rewards. `rareBump` is reset before every roll so this
 * measures the printed weight table rather than the escalation on top of it —
 * the escalation has its own test.
 */
function distribution(tier: RewardTier, n: number, seed: string): Record<RewardRarity, number> {
  const r = run(seed);
  const rng = new Rng(seed);
  const counts: Record<RewardRarity, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    legendary: 0,
  };
  let total = 0;

  for (let i = 0; i < n; i++) {
    r.rareBump = 0;
    for (const id of rollCardReward({ tier, run: r, rng })) {
      counts[rarityOf(id)] += 1;
      total += 1;
    }
  }
  for (const k of REWARD_RARITIES) counts[k] = (counts[k] / total) * 100;
  return counts;
}

describe('rollCardReward · 验收标准', () => {
  it('lands on 60 / 37 / 3 for a monster fight, within 3 points', () => {
    const d = distribution('monster', 1000, 'dist-monster');
    expect(d.common).toBeGreaterThan(57);
    expect(d.common).toBeLessThan(63);
    expect(d.uncommon).toBeGreaterThan(34);
    expect(d.uncommon).toBeLessThan(40);
    expect(d.rare).toBeGreaterThan(0);
    expect(d.rare).toBeLessThan(6);
    expect(d.legendary).toBe(0);
  });

  it('makes rares markedly likelier at an elite, and likelier again at a boss', () => {
    const monster = distribution('monster', 600, 'dist-m');
    const elite = distribution('elite', 600, 'dist-e');
    const boss = distribution('boss', 600, 'dist-b');

    expect(elite.rare).toBeGreaterThan(monster.rare * 2);
    expect(boss.rare).toBeGreaterThan(elite.rare);
  });

  it('never offers a common after a 首领, with a 10% Legendary capstone', () => {
    // The table itself, spelled out — retuning it has to edit this line too.
    expect(TIER_WEIGHTS.boss).toEqual({ common: 0, uncommon: 45, rare: 45, legendary: 10 });

    // And the behaviour: the pools are 12/10/6, a reward takes 3, so the
    // fallback ladder can never be forced down into common at this tier.
    const d = distribution('boss', 600, 'dist-boss-floor');
    expect(d.common).toBe(0);
    expect(d.rare).toBeGreaterThan(39);
    expect(d.rare).toBeLessThan(51);
    expect(d.legendary).toBeGreaterThan(6);
    expect(d.legendary).toBeLessThan(14);
  });

  it('raises the rare weight once per dry reward and resets it on a rare or Legendary hit', () => {
    const r = run('bump');
    expect(r.rareBump).toBe(0);

    // A pool with no rares in it can never pay out, so the bump only climbs.
    const rng = new Rng('bump');
    let dry = 0;
    for (let i = 0; i < 20; i++) {
      const before = r.rareBump;
      const picks = rollCardReward({ tier: 'monster', run: r, rng });
      if (picks.every((id) => rarityOf(id) !== 'rare')) {
        expect(r.rareBump).toBe(before + 1);
        dry += 1;
      } else {
        expect(r.rareBump).toBe(0);
      }
    }
    expect(dry).toBeGreaterThan(0);

    // 20 dry rewards would take monster rare from 3 to 23 — a visible shift.
    expect(rewardWeights('monster', 20).rare).toBe(TIER_WEIGHTS.monster.rare + 20);

    // Legendary is above rare, so seeing one also ends the dry streak. Search
    // deterministic seeds instead of pinning this rule to a catalog index.
    let sawLegendary = false;
    for (let i = 0; i < 500; i++) {
      const lucky = run(`legendary-bump-${i}`);
      lucky.rareBump = 7;
      const pick = rollCardReward({
        tier: 'boss',
        run: lucky,
        rng: new Rng(`legendary-bump-${i}`),
        count: 1,
      });
      if (pick[0] && rarityOf(pick[0]) === 'legendary') {
        expect(lucky.rareBump).toBe(0);
        sawLegendary = true;
        break;
      }
    }
    expect(sawLegendary).toBe(true);
  });

  it('escalates per reward, not per card', () => {
    const r = run('per-reward');
    r.rareBump = 0;
    // Three commons in one reward is one dry reward.
    rollCardReward({ tier: 'monster', run: r, rng: new Rng('x'), count: 3 });
    expect(r.rareBump).toBeLessThanOrEqual(1);
  });

  /**
   * A reward that showed the player nothing was never a draw, so it cannot be
   * a dry one. 独断 already takes the count to 1; a second such relic would
   * take it to 0 and the streak would climb on rewards that never happened.
   */
  it('does not escalate on a reward that offered nothing', () => {
    const r = run('empty-reward');
    r.rareBump = 4;
    expect(rollCardReward({ tier: 'monster', run: r, rng: new Rng('x'), count: 0 })).toEqual([]);
    expect(r.rareBump).toBe(4);
  });

  it('never offers the same card twice in one reward', () => {
    const r = run('dupes');
    const rng = new Rng('dupes');
    for (let i = 0; i < 400; i++) {
      const picks = rollCardReward({ tier: 'monster', run: r, rng });
      expect(new Set(picks).size).toBe(picks.length);
    }
  });

  it('falls back a tier when the rolled one is drained, and never returns undefined', () => {
    const r = run('drain');
    const rng = new Rng('drain');
    // More cards than the rare pool holds, at boss weights where rare is likeliest.
    const picks = rollCardReward({ tier: 'boss', run: r, rng, count: 12 });
    expect(picks.length).toBe(12);
    for (const id of picks) {
      expect(id, String(id)).toBeTruthy();
      expect(CARDS[id], id).toBeDefined();
    }
    expect(new Set(picks).size).toBe(12);
  });

  it('returns short rather than repeating when every pool is drained', () => {
    const r = run('drain-all');
    const total = Object.values(CARD_POOL_BY_RARITY).flat().length;
    const picks = rollCardReward({ tier: 'monster', run: r, rng: new Rng('a'), count: total + 5 });
    expect(picks.length).toBe(total);
    expect(new Set(picks).size).toBe(total);
  });

  it('draws the same number of times whether or not the pools ran out (R3)', () => {
    // A `break` on the drained case made the length of the `reward` stream
    // depend on how much of the pool the reward had already eaten. Today the
    // gold roll comes first and the stream ends here, so nothing visibly
    // shifts — but `count` is relic-driven and hero pools are small, so this is
    // one added purpose away from moving everything downstream of it.
    const total = Object.values(CARD_POOL_BY_RARITY).flat().length;
    const rolls = (count: number): number => {
      const rng = new Rng('r3');
      rollCardReward({ tier: 'monster', run: run(`r3-${count}`), rng, count });
      return rng.rolls;
    };
    // Two draws per requested card — the rarity roll and the pick — flat.
    expect(rolls(3)).toBe(6);
    expect(rolls(total)).toBe(total * 2);
    expect(rolls(total + 5)).toBe((total + 5) * 2);
  });

  it('offers 4 cards under 求贤令 and 1 under 独断', () => {
    const more = run('more');
    expect(more.cardRewardCount).toBe(BASE_CARD_REWARD_COUNT);
    addRelic(more, 'qiuxianling');
    expect(more.cardRewardCount).toBe(4);
    expect(rollCardReward({ tier: 'monster', run: more, rng: new Rng('m') }).length).toBe(4);

    const fewer = run('fewer');
    addRelic(fewer, 'duduan');
    expect(fewer.cardRewardCount).toBe(1);
    expect(rollCardReward({ tier: 'monster', run: fewer, rng: new Rng('f') }).length).toBe(1);
  });

  it('never drops below one card, however much a relic subtracts', () => {
    const r = run('floor');
    addRelic(r, 'duduan');
    addRelic(r, 'qiuxianling');
    // -2 then +1 is 2; the clamp matters only if something subtracts harder.
    expect(r.cardRewardCount).toBe(2);
    expect(rollCardReward({ tier: 'monster', run: r, rng: new Rng('c') }).length).toBe(2);
  });

  it('replays exactly from a seed', () => {
    const once = rollCardReward({ tier: 'elite', run: run('rep'), rng: new Rng('rep:node') });
    const twice = rollCardReward({ tier: 'elite', run: run('rep'), rng: new Rng('rep:node') });
    expect(once).toEqual(twice);
  });
});

describe('the pool itself', () => {
  it('adds three Legendary cards without moving the existing 12/10/6 pools', () => {
    // todos/11 shipped 10/8/3; the 2026-08 expansion appends 诛文丑/勒马横刀
    // (common), 刀挑锦袍/封金挂印 (uncommon), 偃月斩/千里走单骑/义薄云天 (rare).
    expect(CARD_POOL_BY_RARITY.common.length).toBe(12);
    expect(CARD_POOL_BY_RARITY.uncommon.length).toBe(10);
    expect(CARD_POOL_BY_RARITY.rare.length).toBe(6);
    expect(CARD_POOL_BY_RARITY.legendary).toEqual([
      'qinglongjueying',
      'wushenglinshi',
      'yijueqianqiu',
    ]);
  });

  it('lists every card exactly once, and each under its own declared rarity', () => {
    const all = Object.values(CARD_POOL_BY_RARITY).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const rarity of REWARD_RARITIES) {
      for (const id of CARD_POOL_BY_RARITY[rarity]) {
        expect(getCard(id).rarity, id).toBe(rarity);
      }
    }
  });

  /** The invariant the whole rarity keying exists to guarantee. */
  it('can never offer a curse, a 状态牌 or a starter', () => {
    const all = Object.values(CARD_POOL_BY_RARITY).flat();
    for (const id of all) {
      expect(isNegative(CARDS[id]), id).toBe(false);
      expect(getCard(id).rarity, id).not.toBe('basic');
    }

    // And nothing rolled out of the real roller either, over many rewards.
    const r = run('hygiene');
    const rng = new Rng('hygiene');
    for (let i = 0; i < 300; i++) {
      for (const tier of ['monster', 'elite', 'boss'] as RewardTier[]) {
        for (const id of rollCardReward({ tier, run: r, rng })) {
          expect(isNegative(CARDS[id]), id).toBe(false);
          expect(getCard(id).rarity, id).not.toBe('basic');
        }
      }
    }
  });

  it('every reward card is a real, playable, upgradable definition', () => {
    for (const id of Object.values(CARD_POOL_BY_RARITY).flat()) {
      const def = getCard(id);
      expect(def.id, id).toBe(id);
      expect(def.effects.length, id).toBeGreaterThan(0);
      expect(def.upgrade, id).toBeDefined();
    }
  });

  it('keeps 无色 stock out of the post-combat pools until a shop exists', () => {
    const all = Object.values(CARD_POOL_BY_RARITY).flat();
    for (const id of COLORLESS_POOL) expect(all, id).not.toContain(id);
  });

  it('weights every tier so all reward rarities sum to 100', () => {
    for (const tier of Object.keys(TIER_WEIGHTS) as RewardTier[]) {
      const w = TIER_WEIGHTS[tier];
      expect(REWARD_RARITIES.reduce((sum, rarity) => sum + w[rarity], 0), tier).toBe(100);
    }
  });
});

/**
 * The fallback ladder for *cards*, which had no test at all — the pools are
 * 10/8/3 and a reward takes three, so nothing in the game can drain one, and
 * nothing in the suite ever constructed a drained one either.
 *
 * There used to be two identical copies of this function, one here and one in
 * `shop.ts`. Both were uncovered, and either could have drifted from the other.
 */
describe('availableRarity — degrade first, promote second', () => {
  /** The pools are per hero now; 关羽 is the one this file's baselines describe. */
  const HERO = DEFAULT_HERO.id;
  const drain = (...rarities: RewardRarity[]): string[] =>
    rarities.flatMap((r) => CARD_POOL_BY_RARITY[r]);

  it('hands back the wanted rarity while it still has anything in it', () => {
    expect(availableRarity(HERO, 'legendary', [])).toBe('legendary');
    expect(availableRarity(HERO, 'rare', [])).toBe('rare');
    expect(availableRarity(HERO, 'uncommon', [])).toBe('uncommon');
    expect(availableRarity(HERO, 'common', [])).toBe('common');
  });

  it('steps *down* when the wanted rarity is empty', () => {
    // The stated rule: "draining the commons should not start handing out
    // rares". Walking the ladder upward first passes every other test in the
    // file, because no other test ever empties a pool.
    expect(availableRarity(HERO, 'rare', drain('rare'))).toBe('uncommon');
    expect(availableRarity(HERO, 'legendary', drain('legendary'))).toBe('rare');
    expect(availableRarity(HERO, 'uncommon', drain('uncommon'))).toBe('common');
  });

  it('only promotes once everything below is gone too', () => {
    expect(availableRarity(HERO, 'rare', drain('rare', 'uncommon'))).toBe('common');
    expect(availableRarity(HERO, 'common', drain('common'))).toBe('uncommon');
    expect(availableRarity(HERO, 'common', drain('common', 'uncommon'))).toBe('rare');
    expect(availableRarity(HERO, 'common', drain('common', 'uncommon', 'rare'))).toBe('legendary');
    expect(availableRarity(HERO, 'uncommon', drain('uncommon', 'common'))).toBe('rare');
  });

  it('returns null only when every pool is empty', () => {
    expect(
      availableRarity(HERO, 'uncommon', drain('common', 'uncommon', 'rare', 'legendary')),
    ).toBeNull();
  });

  it('is the same function the 坊市 shelf walks', () => {
    // 商旅 used to carry a byte-identical private copy. If it ever grows one
    // again, this is the test that has to be duplicated with it.
    expect(shopSource).toContain("from '../combat/rewards'");
    expect(shopSource).not.toMatch(/function availableRarity\b/);
  });
});

describe('天命接线 (todos/19 a3) · rarityWeightMult', () => {
  it('乘的是表上的基础权重，保底 bump 乘后全额叠加', () => {
    // 十二重（后十级数据）压低罕见/稀有；bump 不跟着缩水，旱久了稀有还是会来。
    const w = rewardWeights('monster', 20, { uncommon: 0.5, rare: 0.5 });
    expect(w.common).toBe(60);
    expect(w.uncommon).toBe(18.5);
    expect(w.rare).toBe(21.5); // 3 × 0.5 + 20，不是 (3 + 20) × 0.5 = 11.5
    expect(w.legendary).toBe(0);
    // 缺省乘 1 恒等——既有调用点和上面每一条期望值原样成立。
    expect(rewardWeights('monster', 20)).toEqual({
      common: 60,
      uncommon: 37,
      rare: 23,
      legendary: 0,
    });
  });

  it('rollCardReward 从 run.mods 读倍率：rare 权重乘成 0 后一张稀有都不出', () => {
    const r = run('mult-zero');
    r.mods = { ...r.mods, rarityWeightMult: { uncommon: 1, rare: 0 } };
    const rng = new Rng('mult-zero');
    for (let i = 0; i < 200; i++) {
      r.rareBump = 0; // 关掉保底，量的就是乘出来的那个 0。
      for (const id of rollCardReward({ tier: 'boss', run: r, rng })) {
        expect(['rare', 'legendary']).not.toContain(rarityOf(id));
      }
    }
  });

  it('一到十重乘 1 恒等：同 seed 同 run，十重的奖励和零重逐张相同', () => {
    const draw = (level: number): string[] => {
      const r = run('mult-idem');
      r.mods = modsFor(level);
      return rollCardReward({ tier: 'elite', run: r, rng: new Rng('mult-idem') });
    };
    expect(draw(10)).toEqual(draw(0));
  });
});
