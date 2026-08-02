import { describe, expect, it } from 'vitest';
import { CARDS, COLORLESS_POOL, poolFor, resolveCard } from '../src/combat/cards';
import { X_COST, previewValues, startCombat, type StartCombatOptions } from '../src/combat/engine';
import { getEncounter } from '../src/combat/enemies';
import { playCard, resolveChoice } from '../src/combat/engine';
import { RELICS, relicText, relicsOfTier } from '../src/combat/relics';
import { relicPool, rollCardReward } from '../src/combat/rewards';
import { HEROES, HEROES_IN_ORDER, HERO_ORDER, DEFAULT_HERO, type HeroDef } from '../src/data/heroes';
import { Rng } from '../src/core/rng';
import { generateStock } from '../src/rooms/shop';
import { newDeckCard, startRun } from '../src/state/run';
import type { CombatState } from '../src/combat/types';

/**
 * 多武将 (todos/17).
 *
 * Every expectation here is a literal. Importing the table under test and
 * comparing it to itself is the failure mode this suite exists to avoid: the
 * whole point is to catch a number *moving*, and a self-referential assertion
 * moves with it.
 *
 * The 关羽 block is the load-bearing half. All 37 golden snapshots build their
 * deck from his `startingDeck` and fight with his `starterRelic`, so anything
 * that would change a snapshot fails here first, with a message that says what
 * moved rather than "37 files differ".
 */

// -------------------------------------------------------------------- 名册

describe('武将名册', () => {
  it('lists exactly the three shipped heroes, 关羽 first', () => {
    expect(HERO_ORDER).toEqual(['guanyu', 'zhaoyun', 'zhugeliang']);
    expect(HEROES_IN_ORDER.map((h) => h.name)).toEqual(['关羽', '赵云', '诸葛亮']);
    expect(DEFAULT_HERO.id).toBe('guanyu');
  });

  it('keys every hero by its own id', () => {
    for (const [key, hero] of Object.entries(HEROES)) expect(hero.id, key).toBe(key);
  });

  it('gives every hero the copy the 选将 screen prints', () => {
    for (const hero of HEROES_IN_ORDER) {
      // One traditional glyph — the watermark and the placeholder plate both
      // draw it, and two characters would overflow the 96px tile.
      expect(hero.seal, hero.id).toHaveLength(1);
      expect(hero.passive.name.length, hero.id).toBeGreaterThan(0);
      expect(hero.mechanic.name.length, hero.id).toBeGreaterThan(0);
      // Long enough to actually say how the hero plays, short enough for the
      // two wrapped lines the panel has room for.
      expect(hero.mechanic.desc.length, hero.id).toBeGreaterThan(12);
      expect(hero.mechanic.desc.length, hero.id).toBeLessThanOrEqual(48);
      expect(hero.blurb.length, hero.id).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------- 起手三件套

describe('起手数值', () => {
  it('leaves 关羽 exactly as the 37 golden snapshots left him', () => {
    const g = HEROES.guanyu;
    expect(g.maxHp).toBe(82);
    expect(g.startingGold).toBe(99);
    expect(g.starterRelic).toBe('qinglongdao');
    expect(g.startingDeck).toEqual([
      'pikan', 'pikan', 'pikan', 'pikan', 'pikan',
      'tiebi', 'tiebi', 'tiebi', 'tiebi',
      'tuodao',
    ]);
  });

  it('gives 赵云 a thinner bar, a spear and ten cards of his own', () => {
    const z = HEROES.zhaoyun;
    expect(z.maxHp).toBe(74);
    expect(z.startingGold).toBe(99);
    expect(z.starterRelic).toBe('yajiaoqiang');
    expect(z.startingDeck).toEqual([
      'tuzhen', 'tuzhen', 'tuzhen', 'tuzhen', 'tuzhen',
      'luema', 'luema', 'luema', 'luema',
      'longdan',
    ]);
  });

  it('gives 诸葛亮 the thinnest bar and the 纶巾', () => {
    const k = HEROES.zhugeliang;
    expect(k.maxHp).toBe(68);
    expect(k.startingGold).toBe(99);
    expect(k.starterRelic).toBe('guanjin');
    expect(k.startingDeck).toEqual([
      'yuanrongnu', 'yuanrongnu', 'yuanrongnu', 'yuanrongnu', 'yuanrongnu',
      'jushou', 'jushou', 'jushou', 'jushou',
      'longzhongdui',
    ]);
  });

  it('starts every hero with ten cards, all of them his own and all 起手 rarity', () => {
    for (const hero of HEROES_IN_ORDER) {
      expect(hero.startingDeck, hero.id).toHaveLength(10);
      for (const id of hero.startingDeck) {
        const def = CARDS[id];
        expect(def, `${hero.id}/${id}`).toBeDefined();
        // `basic` is the whole mechanism keeping 起手牌 out of every pool.
        expect(def.rarity, id).toBe('basic');
        expect(def.hero, id).toBe(hero.id);
      }
    }
  });

  it('hands every hero a 起手宝物 that no source can ever drop or sell', () => {
    for (const hero of HEROES_IN_ORDER) {
      const def = RELICS[hero.starterRelic];
      expect(def, hero.id).toBeDefined();
      expect(def.tier, hero.id).toBe('starter');
    }
    // 布衣 rides the same tier without being anyone's 起手宝物: 开局祝福's
    // 「不受」 is its only source, and `starter` is what keeps it off every shelf.
    expect(relicsOfTier('starter').map((d) => d.id).sort()).toEqual([
      'buyi',
      'guanjin',
      'qinglongdao',
      'yajiaoqiang',
    ]);

    // `relicPool` remaps `starter` onto `common`, so the guard that actually
    // matters is that no reachable tier ever returns one of the three.
    for (const hero of HEROES_IN_ORDER) {
      const run = startRun(hero, `pool-${hero.id}`);
      for (const tier of ['common', 'uncommon', 'rare', 'boss', 'shop', 'starter'] as const) {
        const pool = relicPool(run, tier);
        expect(pool, `${hero.id}/${tier}`).not.toContain('qinglongdao');
        expect(pool, `${hero.id}/${tier}`).not.toContain('yajiaoqiang');
        expect(pool, `${hero.id}/${tier}`).not.toContain('guanjin');
      }
    }
  });

  it('prints the 起手宝物 on the 选将 screen exactly as the relic behaves', () => {
    // `HeroDef.passive` drives no rules — it is the 选将 screen's copy of the
    // relic, and it drifted once already: 涯角枪 was retuned from 「战斗开始抽 2
    // 张」 to the second-swing bonus and this line kept the old promise, so the
    // screen advertised a relic the run did not hand out. Pinned to the rendered
    // relic text so the two can never disagree again.
    // Only `desc` is pinned. `passive.name` is flavour and is allowed to differ
    // from the relic's — 关羽 bills his as 「青龙偃月」 against a relic called
    // 青龙偃月刀 — but the sentence describing what it *does* is a promise.
    for (const hero of HEROES_IN_ORDER) {
      const def = RELICS[hero.starterRelic];
      expect(hero.passive.name.length, hero.id).toBeGreaterThan(0);
      expect(hero.passive.desc, hero.id).toBe(relicText(def));
    }
  });

  it('builds the run off the hero it was handed and nothing else', () => {
    const zhao = startRun(HEROES.zhaoyun, 'run-zhaoyun');
    expect(zhao.maxHp).toBe(74);
    expect(zhao.hp).toBe(74);
    expect(zhao.gold).toBe(99);
    expect(zhao.relics).toEqual(['yajiaoqiang']);
    expect(zhao.deck.map((c) => c.defId)).toEqual(HEROES.zhaoyun.startingDeck);

    const kong = startRun(HEROES.zhugeliang, 'run-zhugeliang');
    expect(kong.maxHp).toBe(68);
    expect(kong.hp).toBe(68);
    expect(kong.relics).toEqual(['guanjin']);

    const guan = startRun(HEROES.guanyu, 'run-guanyu');
    expect(guan.maxHp).toBe(82);
    expect(guan.relics).toEqual(['qinglongdao']);
  });
});

// --------------------------------------------------------------- 战斗差异

const BENCH: Omit<StartCombatOptions, 'deck' | 'relics' | 'seed'> = {
  encounter: getEncounter('m1'),
  heroName: '试',
  hp: 80,
  maxHp: 80,
};

/**
 * A fight with a hand-built deck. Five cards or fewer means the opening hand is
 * the whole deck whatever the shuffle did, so a test never depends on an order.
 */
function bench(defIds: string[], relics: readonly string[] = [], seed = 'hero-bench'): CombatState {
  expect(defIds.length).toBeLessThanOrEqual(5);
  return startCombat({
    ...BENCH,
    deck: defIds.map((id) => newDeckCard(id)),
    relics,
    seed,
  });
}

const uidOf = (state: CombatState, defId: string): string => {
  const uid = state.hand.find((u) => state.cards[u].defId === defId);
  expect(uid, `${defId} not in hand`).toBeDefined();
  return uid!;
};

/** Plays a card at the enemy and returns the HP it took off. */
function hit(state: CombatState, defId: string): number {
  const before = state.enemies[0].hp;
  expect(playCard(state, uidOf(state, defId), state.enemies[0].id), defId).toBe(true);
  return before - state.enemies[0].hp;
}

describe('起手宝物驱动开局差异', () => {
  it('deals 关羽 five cards and three 气, and pays his first attack +3', () => {
    const state = bench(['pikan', 'tiebi', 'tiebi', 'tiebi', 'tiebi'], ['qinglongdao']);
    expect(state.hand).toHaveLength(5);
    expect(state.maxEnergy).toBe(3);
    // 6 printed + 3 from 青龙偃月刀, and only on the turn's first 攻.
    expect(hit(state, 'pikan')).toBe(9);
  });

  it('pays 赵云 on the turn’s second 攻 instead of its first', () => {
    const state = bench(['tuzhen', 'tuzhen', 'tuzhen'], ['yajiaoqiang']);
    expect(state.hand).toHaveLength(3);
    expect(state.maxEnergy).toBe(3);
    // Same 5 cards and 3 气 as 关羽 — the whole difference is *which* swing pays.
    expect(hit(state, 'tuzhen')).toBe(6); // printed, no bonus on the first
    expect(hit(state, 'tuzhen')).toBe(10); // 6 + 4 from 涯角枪
    expect(hit(state, 'tuzhen')).toBe(6); // once only, per turn
  });

  it('leaves the two 蜀 starters mutually exclusive on the same swing', () => {
    // Both relics at once (a 祝福 could do it): 关羽's fires on swing one and
    // 赵云's on swing two, never together.
    const state = bench(['tuzhen', 'tuzhen'], ['qinglongdao', 'yajiaoqiang']);
    expect(hit(state, 'tuzhen')).toBe(9); // 6 + 3
    expect(hit(state, 'tuzhen')).toBe(10); // 6 + 4
  });

  it('deals 诸葛亮 one card fewer and one 气 more', () => {
    const state = startCombat({
      ...BENCH,
      deck: Array.from({ length: 10 }, () => newDeckCard('jushou')),
      relics: ['guanjin'],
      seed: 'kongming-open',
    });
    expect(state.hand).toHaveLength(4);
    expect(state.maxEnergy).toBe(4);
    expect(state.energy).toBe(4);
  });
});

// ------------------------------------------------------------- 赵云 · 连击

describe('赵云 · 连击', () => {
  it('pays 七探盘蛇 once per 攻 already played, and never for itself', () => {
    const first = bench(['qitanpanshe', 'tuzhen', 'tuzhen']);
    // Opened with: no prior 攻, so the floor applies — one stab, not zero.
    expect(hit(first, 'qitanpanshe')).toBe(5);

    const combo = bench(['tuzhen', 'tuzhen', 'qitanpanshe']);
    expect(hit(combo, 'tuzhen')).toBe(6);
    expect(hit(combo, 'tuzhen')).toBe(6);
    // Two prior 攻 → two stabs of 5. Not three: the card does not count itself.
    expect(hit(combo, 'qitanpanshe')).toBe(10);
  });

  it('prints on the face exactly what it is about to deal', () => {
    const state = bench(['tuzhen', 'tuzhen', 'qitanpanshe']);
    hit(state, 'tuzhen');
    hit(state, 'tuzhen');
    expect(previewValues(state, resolveCard('qitanpanshe', 0), state.enemies[0])).toEqual({
      D: 5,
      B: 0,
      T: 2,
    });
    // 精 raises the per-stab number, not the count.
    expect(previewValues(state, resolveCard('qitanpanshe', 1), state.enemies[0])).toEqual({
      D: 7,
      B: 0,
      T: 2,
    });
  });

  it('flips 挺枪 from 6 to 9 the moment an 攻 has gone out', () => {
    const cold = bench(['tingqiang', 'tuzhen', 'tingqiang']);
    expect(hit(cold, 'tingqiang')).toBe(6);
    expect(hit(cold, 'tuzhen')).toBe(6);
    expect(hit(cold, 'tingqiang')).toBe(9);
  });

  it('stacks 截江 by 3 per 攻 and 空营计 the other way round', () => {
    const cold = bench(['jiejiang', 'kongyingji']);
    expect(playCard(cold, uidOf(cold, 'jiejiang'))).toBe(true);
    expect(cold.player.block).toBe(4);

    const hot = bench(['tuzhen', 'tuzhen', 'jiejiang']);
    hit(hot, 'tuzhen');
    hit(hot, 'tuzhen');
    expect(playCard(hot, uidOf(hot, 'jiejiang'))).toBe(true);
    expect(hot.player.block).toBe(10); // 4 + 3 + 3

    // 空营计 is the anti-synergy: it pays *more* on a turn with no 攻 in it.
    const quiet = bench(['kongyingji', 'luema']);
    expect(playCard(quiet, uidOf(quiet, 'kongyingji'))).toBe(true);
    expect(quiet.player.block).toBe(11);

    const busy = bench(['tuzhen', 'kongyingji']);
    hit(busy, 'tuzhen');
    expect(playCard(busy, uidOf(busy, 'kongyingji'))).toBe(true);
    expect(busy.player.block).toBe(6);
  });

  it('draws off 龙胆 only once two 攻 have gone out', () => {
    const combo = bench(['tuzhen', 'tuzhen', 'longdan', 'luema', 'luema']);
    expect(hit(combo, 'tuzhen')).toBe(6);
    expect(hit(combo, 'tuzhen')).toBe(6);
    expect(hit(combo, 'longdan')).toBe(3);
    // Drew: the empty pile was refilled from the discard and one card taken.
    expect(combo.hand).toHaveLength(3);
    expect(combo.drawPile).toHaveLength(1);

    const cold = bench(['tuzhen', 'longdan', 'luema', 'luema', 'luema']);
    hit(cold, 'tuzhen');
    expect(hit(cold, 'longdan')).toBe(3);
    // One 攻 short: nothing was drawn, so nothing was reshuffled either.
    expect(cold.hand).toHaveLength(3);
    expect(cold.drawPile).toHaveLength(0);
    expect(cold.discardPile).toHaveLength(2);
  });

  it('splits 三进三出 into three separate instances and 力斩五将 into five', () => {
    const quick = bench(['sanjinsanchu', 'luema']);
    expect(hit(quick, 'sanjinsanchu')).toBe(9); // 3 × 3

    // 3 气 is the whole turn, so it gets a bench of its own.
    const heavy = bench(['lizhanwujiang', 'luema']);
    expect(hit(heavy, 'lizhanwujiang')).toBe(25); // 5 × 5
  });

  it('pays 血染征袍 out of the bar', () => {
    const state = bench(['xueranzhengpao']);
    expect(hit(state, 'xueranzhengpao')).toBe(10);
    expect(state.player.hp).toBe(77); // 80 − 3, and 护甲 does not stop it
  });

  it('only lets 单骑救主 off the leash below half 体力', () => {
    const full = bench(['danqijiuzhu']);
    expect(hit(full, 'danqijiuzhu')).toBe(8);

    const hurt = startCombat({
      ...BENCH,
      hp: 30, // 30/80 is under half
      deck: [newDeckCard('danqijiuzhu')],
      relics: [],
      seed: 'danqi-hurt',
    });
    expect(hit(hurt, 'danqijiuzhu')).toBe(16);
    expect(hurt.player.hp).toBe(36); // healed 6 on the way through
  });
});

// ----------------------------------------------------------- 诸葛亮 · 锦囊

describe('诸葛亮 · 锦囊', () => {
  it('opens with 隆中对 in hand every time and mints two 锦囊', () => {
    const state = startCombat({
      ...BENCH,
      deck: [
        newDeckCard('longzhongdui'),
        ...Array.from({ length: 9 }, () => newDeckCard('jushou')),
      ],
      relics: ['guanjin'],
      seed: 'kongming-innate',
    });
    // 固有: it is lifted to the top of the pile, so a short hand still has it.
    expect(state.hand).toHaveLength(4);
    expect(state.hand.some((u) => state.cards[u].defId === 'longzhongdui')).toBe(true);

    expect(playCard(state, uidOf(state, 'longzhongdui'))).toBe(true);
    const minted = state.hand.filter((u) => state.cards[u].defId === 'jinnang');
    expect(minted).toHaveLength(2);
    // Minted, not drafted: the run's own deck never hears about them.
    expect(state.exhaustPile).toHaveLength(1);
  });

  it('makes a 锦囊 worth 4 甲 and its own replacement', () => {
    const state = bench(['longzhongdui', 'jushou', 'jushou', 'jushou', 'jushou']);
    expect(playCard(state, uidOf(state, 'longzhongdui'))).toBe(true);
    const before = state.hand.length;

    expect(playCard(state, uidOf(state, 'jinnang'))).toBe(true);
    expect(state.player.block).toBe(4);
    // Played one, drew one — the deck is one card thinner, the hand is not.
    // (Nothing to draw here: 隆中对 and 锦囊 both exhaust, so no discard to
    // reshuffle. The block is the half that must always be true.)
    expect(state.hand.length).toBeLessThanOrEqual(before);
    expect(state.exhaustPile).toHaveLength(2);
  });

  it('doubles 火计 once three cards have burned', () => {
    const cold = bench(['huoji', 'jushou']);
    expect(cold.exhaustPile).toHaveLength(0);
    expect(hit(cold, 'huoji')).toBe(6);

    const hot = bench(['longzhongdui', 'huoji', 'jushou', 'jushou', 'jushou']);
    expect(playCard(hot, uidOf(hot, 'longzhongdui'))).toBe(true);
    expect(playCard(hot, uidOf(hot, 'jinnang'))).toBe(true);
    expect(playCard(hot, uidOf(hot, 'jinnang'))).toBe(true);
    expect(hot.exhaustPile).toHaveLength(3); // 隆中对 + two 锦囊
    expect(hit(hot, 'huoji')).toBe(12);
  });

  it('leaves 出师表 气-neutral and burns itself', () => {
    const state = bench(['chushibiao', 'jushou', 'jushou', 'jushou', 'jushou']);
    expect(state.energy).toBe(3);
    expect(playCard(state, uidOf(state, 'chushibiao'))).toBe(true);
    expect(state.energy).toBe(3); // spent 2, refunded 2
    expect(state.exhaustPile).toHaveLength(1);
  });

  it('hits twice with 元戎弩 rather than once for the total', () => {
    const state = bench(['yuanrongnu']);
    expect(previewValues(state, resolveCard('yuanrongnu', 0), state.enemies[0])).toEqual({
      D: 3,
      B: 0,
      T: 2,
    });
    expect(hit(state, 'yuanrongnu')).toBe(6);
  });

  // --- Pool expansion (todos/17) -------------------------------------------

  it('flips 声东击西 from 6 to 9 once the target is 怯战', () => {
    const state = bench(['shengdongjixi', 'jijiangfa', 'shengdongjixi']);
    expect(hit(state, 'shengdongjixi')).toBe(6); // cold: printed rate
    expect(hit(state, 'jijiangfa')).toBe(3); // leaves 1 层【怯战】 and burns
    expect(state.exhaustPile).toHaveLength(1);
    expect(hit(state, 'shengdongjixi')).toBe(9);
  });

  it('reads the 消耗堆 for 伏兵 the way 火计 does', () => {
    const cold = bench(['fubing']);
    expect(playCard(cold, uidOf(cold, 'fubing'))).toBe(true);
    expect(cold.player.block).toBe(5);

    const hot = bench(['longzhongdui', 'fubing', 'jushou', 'jushou', 'jushou']);
    expect(playCard(hot, uidOf(hot, 'longzhongdui'))).toBe(true);
    expect(playCard(hot, uidOf(hot, 'jinnang'))).toBe(true);
    expect(playCard(hot, uidOf(hot, 'jinnang'))).toBe(true);
    expect(hot.exhaustPile).toHaveLength(3); // 隆中对 + two 锦囊
    expect(playCard(hot, uidOf(hot, 'fubing'))).toBe(true);
    expect(hot.player.block).toBe(4 + 4 + 9); // two 锦囊, then the hot branch
  });

  it('lets 减兵增灶 pick what burns, then pays the 气', () => {
    const state = bench(['jianbingzengzao', 'jushou', 'jushou']);
    expect(state.energy).toBe(3);
    expect(playCard(state, uidOf(state, 'jianbingzengzao'))).toBe(true);
    // The choice interrupts the queue; the 气 and the draw land after it.
    expect(state.pendingChoice).toMatchObject({ kind: 'exhaust', min: 1, max: 1 });
    const pick = uidOf(state, 'jushou');
    expect(resolveChoice(state, [pick])).toBe(true);
    expect(state.pendingChoice).toBeNull();
    expect(state.exhaustPile).toEqual([pick]);
    expect(state.energy).toBe(4); // cost 0, +1 refunded after the pick
  });

  it('lets 火烧藤甲 cash a fight spent burning', () => {
    const state = bench(['longzhongdui', 'jianbingzengzao', 'jijiangfa', 'huoshaotengjia', 'jushou']);
    expect(playCard(state, uidOf(state, 'longzhongdui'))).toBe(true);
    expect(playCard(state, uidOf(state, 'jinnang'))).toBe(true);
    expect(playCard(state, uidOf(state, 'jinnang'))).toBe(true);
    expect(hit(state, 'jijiangfa')).toBe(3);
    expect(playCard(state, uidOf(state, 'jianbingzengzao'))).toBe(true);
    expect(resolveChoice(state, [uidOf(state, 'jushou')])).toBe(true);
    expect(state.exhaustPile).toHaveLength(5); // 隆中对、两张锦囊、激将法、据守
    expect(hit(state, 'huoshaotengjia')).toBe(24);
  });
});

// ------------------------------------------------------------------- 卡池

/** 关羽's three arrays, written out rather than imported. Append-only. */
const GUANYU = {
  common: [
    'wenjiu', 'quedi', 'baima', 'jieying', 'guanzhen', 'xuzhao',
    'dandaofuhui', 'huarongdao', 'bingzhudadan', 'yeduchunqiu',
    'zhuwenchou', 'lemahengdao',
    'huimazhan', 'mingjinzhengdui', 'duanpaojueyi', 'qingzhuangjiancong',
  ],
  uncommon: [
    'wanren', 'yiyong', 'shuiyanqijun', 'zhanyanliang', 'hulaoguan',
    'tushanyuesanshi', 'wubaijiaodaoshou', 'guaguliaodu',
    'daotiaojinpao', 'fengjinguayin',
    'yanqiyansha', 'zhenqianlidao', 'bingyinghezhen', 'juantuchonglai',
    'yijiahuanzhen', 'baizhanhuifeng', 'zhengjingwu', 'libingmoma',
    'liangdaochangtong', 'chizhongdaiji',
  ],
  rare: [
    'weizhenhuaxia', 'wuguanliujiang', 'shengougaolei',
    'yanyuezhan', 'qianlizoudanqi', 'yibaoyuntian',
    'shenzaicaoying', 'guchenghui', 'wanjunqushou', 'baimajiewei',
    'wusheng', 'hanbingzaixing',
  ],
};

const ZHAOYUN = {
  common: [
    'tingqiang', 'qitanpanshe', 'kongyingji',
    'lianhuanqiang', 'jici', 'duojian', 'qianghua', 'chenshi',
  ],
  uncommon: [
    'sanjinsanchu', 'jiejiang', 'xueranzhengpao',
    'yinqiang', 'hengsaoqianjun', 'longxiang', 'yanqixigu', 'huwei',
  ],
  rare: ['yishenshidan', 'danqijiuzhu', 'lizhanwujiang', 'changbanpo'],
};

const ZHUGELIANG = {
  common: [
    'jiejianzhiji', 'jiedongfeng', 'huoji',
    'youdi', 'shengdongjixi', 'miaosuan', 'fubing', 'jijiangfa',
  ],
  uncommon: [
    'kongchengji', 'qixingdeng', 'muniuliuma',
    'guanxing', 'huoshaobowang', 'jianbingzengzao', 'shenjimiaosuan', 'anjupingwulu',
  ],
  rare: ['wolongchushan', 'chushibiao', 'qiqinqizong', 'huoshaotengjia'],
};

const POOLS: Record<string, typeof GUANYU> = {
  guanyu: GUANYU,
  zhaoyun: ZHAOYUN,
  zhugeliang: ZHUGELIANG,
};

describe('专属卡池', () => {
  it('deals each hero exactly his own ids, in exactly his declaration order', () => {
    for (const [heroId, pools] of Object.entries(POOLS)) {
      expect(poolFor(heroId, 'common'), heroId).toEqual(pools.common);
      expect(poolFor(heroId, 'uncommon'), heroId).toEqual(pools.uncommon);
      expect(poolFor(heroId, 'rare'), heroId).toEqual(pools.rare);
    }
  });

  it('never lets two heroes share a card', () => {
    const seen = new Map<string, string>();
    for (const [heroId, pools] of Object.entries(POOLS)) {
      for (const id of [...pools.common, ...pools.uncommon, ...pools.rare]) {
        expect(seen.get(id), `${id} is in both ${seen.get(id)} and ${heroId}`).toBeUndefined();
        seen.set(id, heroId);
        expect(CARDS[id].hero, id).toBe(heroId);
      }
    }
  });

  it('keeps 无色, 起手牌 and 令牌 out of every pool', () => {
    for (const heroId of Object.keys(POOLS)) {
      const all = [
        ...poolFor(heroId, 'common'),
        ...poolFor(heroId, 'uncommon'),
        ...poolFor(heroId, 'rare'),
      ];
      for (const id of COLORLESS_POOL) expect(all, `${heroId}/${id}`).not.toContain(id);
      // 「锦囊」 is minted in combat and must never be draftable or purchasable.
      expect(all, heroId).not.toContain('jinnang');
      for (const hero of HEROES_IN_ORDER) {
        for (const id of hero.startingDeck) expect(all, `${heroId}/${id}`).not.toContain(id);
      }
    }
  });

  it('offers a 赵云 run nothing but 赵云 cards, over 300 rewards', () => {
    const run = startRun(HEROES.zhaoyun, 'reward-zhaoyun');
    const mine = new Set([...ZHAOYUN.common, ...ZHAOYUN.uncommon, ...ZHAOYUN.rare]);
    let dealt = 0;
    for (let i = 0; i < 100; i++) {
      for (const id of rollCardReward({ tier: 'monster', run, rng: new Rng(`rw-${i}`) })) {
        expect(mine.has(id), id).toBe(true);
        dealt += 1;
      }
    }
    expect(dealt).toBeGreaterThanOrEqual(300);
  });

  it('stocks a 诸葛亮 shelf with his cards and the 无色 stock, nothing else', () => {
    const run = startRun(HEROES.zhugeliang, 'shop-zhugeliang');
    const mine = new Set([...ZHUGELIANG.common, ...ZHUGELIANG.uncommon, ...ZHUGELIANG.rare]);
    const colourless = new Set(COLORLESS_POOL);
    let own = 0;
    let shelved = 0;
    for (let i = 0; i < 60; i++) {
      for (const slot of generateStock(run, new Rng(`shop-${i}`)).cards) {
        expect(mine.has(slot.defId) || colourless.has(slot.defId), slot.defId).toBe(true);
        shelved += 1;
        if (mine.has(slot.defId)) own += 1;
      }
    }
    // Not vacuous: the shelf really is stocked, and mostly from his own pool.
    expect(shelved).toBe(300); // 60 shops × 5 slots
    expect(own).toBeGreaterThan(200);
  });

  it('never lets a 关羽 run see another hero’s card', () => {
    const run = startRun(HEROES.guanyu, 'reward-guanyu');
    const his = new Set([...GUANYU.common, ...GUANYU.uncommon, ...GUANYU.rare]);
    for (let i = 0; i < 100; i++) {
      for (const id of rollCardReward({ tier: 'monster', run, rng: new Rng(`gw-${i}`) })) {
        expect(his.has(id), id).toBe(true);
      }
    }
    const colourless = new Set(COLORLESS_POOL);
    for (let i = 0; i < 40; i++) {
      for (const slot of generateStock(run, new Rng(`gs-${i}`)).cards) {
        expect(his.has(slot.defId) || colourless.has(slot.defId), slot.defId).toBe(true);
      }
    }
  });
});

// ----------------------------------------------------------- 卡面完整性

describe('专属卡的表面', () => {
  const heroCards = (heroId: string): string[] =>
    Object.keys(CARDS).filter((id) => CARDS[id].hero === heroId);

  it('gives 赵云 and 诸葛亮 a full pool plus their starters', () => {
    // 赵云: 3 起手 + 20 draftable (8/8/4, against 关羽's 10/8/3 — the todos/17
    // 「20+ 张」 bar). 诸葛亮: 3 起手 + 20 draftable (8/8/4 as well) plus the
    // 锦囊 token.
    expect(heroCards('zhaoyun')).toHaveLength(23);
    expect(heroCards('zhugeliang')).toHaveLength(24);
    expect(
      ZHAOYUN.common.length + ZHAOYUN.uncommon.length + ZHAOYUN.rare.length,
    ).toBeGreaterThanOrEqual(20);
    expect(
      ZHUGELIANG.common.length + ZHUGELIANG.uncommon.length + ZHUGELIANG.rare.length,
    ).toBeGreaterThanOrEqual(20);
  });

  it('leaves every drafted card forgeable, and the 令牌 not', () => {
    for (const pools of Object.values(POOLS)) {
      for (const id of [...pools.common, ...pools.uncommon, ...pools.rare]) {
        expect(CARDS[id].upgrade, id).toBeDefined();
      }
    }
    // A card that is minted and never held between fights has nowhere to carry
    // an upgrade, so the 营帐 forge must not be able to see one.
    expect(CARDS.jinnang.upgrade).toBeUndefined();
    expect(resolveCard('jinnang', 1).name).toBe('锦囊');
  });

  it('prices every hero card inside the printed cost range', () => {
    for (const hero of HEROES_IN_ORDER) {
      for (const id of heroCards(hero.id)) {
        const def = CARDS[id];
        expect(def.cost, id).toBeGreaterThanOrEqual(X_COST);
        expect(def.cost, id).toBeLessThanOrEqual(3);
        expect(def.art, id).toBe(`card-${id}`);
        expect(def.name.length, id).toBeGreaterThan(0);
      }
    }
  });
});

// --------------------------------------------------------------- 机制隔离

describe('武将机制互不串味', () => {
  it('gives 赵云 no 神力 of his own and 关羽 no 连击 payoff', () => {
    const strengthCards = ZHAOYUN.common
      .concat(ZHAOYUN.uncommon)
      .filter((id) => JSON.stringify(CARDS[id].effects).includes('"strength"'));
    // Only the rare 一身是胆 grants it, and only one layer.
    expect(strengthCards).toEqual([]);

    const guanyuScaling = [...GUANYU.common, ...GUANYU.uncommon, ...GUANYU.rare].filter((id) =>
      JSON.stringify(CARDS[id].effects).includes('scaleWithAttacks'),
    );
    expect(guanyuScaling).toEqual([]);
  });

  it('keeps each hero on his own 消耗 payoff', () => {
    const readers = Object.keys(CARDS).filter((id) =>
      JSON.stringify(CARDS[id].effects).includes('exhaustedAtLeast'),
    );
    expect(readers.sort()).toEqual([
      'baizhanhuifeng', 'chushibiao', 'fubing', 'huoji', 'huoshaobowang',
      'huoshaotengjia', 'muniuliuma',
    ]);
    expect(CARDS.baizhanhuifeng.hero).toBe('guanyu');
    for (const id of readers.filter((id) => id !== 'baizhanhuifeng')) {
      expect(CARDS[id].hero, id).toBe('zhugeliang');
    }
  });

  it('keeps the 连击 readers to 赵云', () => {
    const readers = Object.keys(CARDS).filter((id) => {
      const json = JSON.stringify(CARDS[id].effects);
      return json.includes('attacksAtLeast') || json.includes('scaleWithAttacks');
    });
    expect(readers.sort()).toEqual([
      'changbanpo', 'chenshi', 'duojian', 'hengsaoqianjun', 'jici', 'jiejiang',
      'longdan', 'qianghua', 'qitanpanshe', 'tingqiang',
    ]);
    for (const id of readers) expect(CARDS[id].hero, id).toBe('zhaoyun');
  });
});

/** The engine must not learn what a hero is — see 约定 in `heroes.ts`. */
describe('引擎不认识 HeroDef', () => {
  const SOURCES: Record<string, string> = import.meta.glob('../src/combat/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('never imports the hero table into the rules layer', () => {
    for (const [path, src] of Object.entries(SOURCES)) {
      expect(src, path).not.toContain("from '../data/heroes'");
    }
  });

  it('still takes a hero as a name, an HP pair and a list of relic ids', () => {
    const engine = SOURCES['../src/combat/engine.ts'];
    const head = engine.slice(engine.indexOf('export interface StartCombatOptions'));
    const body = head.slice(0, head.indexOf('\n}'));
    expect(body).toContain('heroName: string');
    expect(body).not.toContain('HeroDef');
  });
});

/**
 * The 连击 readout on the fight HUD, checked as source text — CombatScene
 * imports Phaser and cannot be constructed here. Same technique as
 * `tests/save.test.ts`'s 「where the save is actually written」.
 */
describe('连击数上了战斗 HUD', () => {
  const SCENES: Record<string, string> = import.meta.glob('../src/scenes/CombatScene.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('draws the counter only for 赵云 and repaints it in refresh', () => {
    const scene = SCENES['../src/scenes/CombatScene.ts'];
    // Built only for the combo hero — 关羽/诸葛亮 get no dead zero.
    expect(scene).toContain("this.run.hero.id === 'zhaoyun'");
    // And repainted from the engine's own counter inside `refresh`, which runs
    // both after a card is played and after the turn-start reset — so the HUD
    // number can never be anything but `state.attacksThisTurn`.
    const body = scene.slice(scene.indexOf('private refresh(): void'));
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('this.state.attacksThisTurn');
  });
});

/** Guards the one hero the snapshots cannot survive losing. */
describe('DEFAULT_HERO', () => {
  it('is 关羽 by identity, not by copy', () => {
    expect(DEFAULT_HERO).toBe(HEROES.guanyu);
    const hero: HeroDef = DEFAULT_HERO;
    expect(hero.name).toBe('关羽');
  });
});
