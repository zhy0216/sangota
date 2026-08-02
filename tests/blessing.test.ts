import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { getCard } from '../src/combat/cards';
import { RELICS, relicModifiers } from '../src/combat/relics';
import { relicPool } from '../src/combat/rewards';
import { HEROES } from '../src/data/heroes';
import {
  ALL_BLESSINGS,
  BLESSING_COSTS,
  MAJOR_BLESSINGS,
  MINOR_BLESSINGS,
  REFUSE_BLESSINGS,
  TRADE_BLESSINGS,
  costsFor,
  getBlessing,
} from '../src/data/blessings';
import {
  BLESSING_DRAWS,
  blessingPending,
  blessingSettled,
  blessingTaken,
  blessingViews,
  ensureBlessing,
  resolveBlessingPick,
  rollBlessings,
  takeBlessing,
} from '../src/rooms/blessing';
import { buy, shelf } from '../src/rooms/shop';
import { addGold, addRelic, startRun, type RunState } from '../src/state/run';

/**
 * 开局祝福 — 「拜别 · 出征前夜」.
 *
 * Every expected value below is a literal. Nothing imports the constant it is
 * about to assert: a test that reads `MINOR_BLESSINGS.length` back at itself
 * cannot fail when the table is edited, which is the only time it matters.
 *
 * The pools the payouts draw from are written out by hand for the same reason —
 * they are the frozen contents of `poolFor('guanyu', …)` and `relicsOfTier(…)`
 * as of the commit that landed this file, and a change to either must show up
 * here rather than pass silently.
 */

// The card pools a 祝福 can deal from, by hand. Order is not asserted — only
// membership — so appending to a pool is legal and re-pointing one is not.
const GUANYU_COMMON = [
  'wenjiu', 'quedi', 'baima', 'jieying', 'guanzhen',
  'xuzhao', 'dandaofuhui', 'huarongdao', 'bingzhudadan', 'yeduchunqiu',
];
const GUANYU_RARE = [
  'weizhenhuaxia', 'wuguanliujiang', 'shengougaolei',
  'yanyuezhan', 'qianlizoudanqi', 'yibaoyuntian',
  'shenzaicaoying', 'guchenghui', 'wanjunqushou', 'baimajiewei',
];
const ZHAOYUN_RARE = ['yishenshidan', 'danqijiuzhu', 'lizhanwujiang', 'changbanpo'];

const COMMON_RELICS = [
  'shufajinguan', 'dujunlingqi', 'xuanwujia', 'xingjuntu', 'lianhuanjia',
  'jinchuangyao', 'xiandengdun', 'xuanjia', 'yaonang',
];
const UNCOMMON_RELICS = [
  'lianu', 'tiemian', 'huxinjing', 'xiaoshouling', 'qiuxianling',
  'yushan', 'mumaliu', 'huangshishu',
];
const RARE_RELICS = ['chuanguoyuxi', 'tengjia', 'gudingdao', 'sunzibingfa', 'qixingdeng'];
const BOSS_RELICS = ['chitima', 'duduan', 'fangtianhuaji', 'hufu', 'tongquetai', 'jiuxi'];

const MINOR_IDS = ['m_yangjing', 'm_ziliang', 'm_qiwu', 'm_yipai', 'm_xieyao'];
const MAJOR_IDS = ['j_jingjian', 'j_michuan', 'j_zengbao', 'j_duanlian', 'j_huanxue'];
const TRADE_IDS = ['t_qizhen', 't_milu', 't_hufu', 't_houbi', 't_cuiti'];
const COST_IDS = ['c_geshe', 'c_suji', 'c_qingnang'];

const fresh = (seed = 'blessing'): RunState => startRun(HEROES.guanyu, seed);

const shopNodeId = (run: RunState): string => {
  for (const node of run.map.nodes.values()) if (node.type === 'shop') return node.id;
  throw new Error('no 商旅 on this map');
};

/** A run with a 坊市 on the map and a purse deep enough that price decides nothing. */
function shopRun(): RunState {
  for (let i = 0; i < 200; i++) {
    const run = fresh(`shop#${i}`);
    for (const node of run.map.nodes.values()) {
      if (node.type === 'shop') {
        run.gold = 9999;
        return run;
      }
    }
  }
  throw new Error('no map with a 商旅');
}

/**
 * A run standing in front of one specific gift. The four-up is `run.blessing`'s
 * own shape, so writing it directly is exactly what a seed that happened to
 * roll this option would have produced — and it lets a payout be tested without
 * hunting for the seed that offers it.
 */
function offering(run: RunState, id: string, costId: string | null = null): RunState {
  run.blessing = { offered: [{ id, costId }], takenId: null, pending: null };
  return run;
}

/** Take a gift and hand back what it actually did. */
const take = (run: RunState, id: string, costId: string | null = null) =>
  takeBlessing(offering(run, id, costId), id)!;

// ------------------------------------------------------------------- 掷四选一

describe('rollBlessings', () => {
  it('draws exactly five numbers, whatever the pools hold', () => {
    // R3. The 无所求 pool holds one entry and still burns its `int`: the day a
    // second one lands, every existing seed must keep the 祝福 it was shown.
    const rng = new Rng('draw-count');
    rollBlessings(rng);
    expect(rng.rolls).toBe(5);
    expect(BLESSING_DRAWS).toBe(5);
  });

  it('offers one of each class, in class order', () => {
    for (let i = 0; i < 60; i++) {
      const offers = rollBlessings(new Rng(`class-${i}`));
      expect(offers).toHaveLength(4);
      expect(MINOR_IDS).toContain(offers[0].id);
      expect(MAJOR_IDS).toContain(offers[1].id);
      expect(TRADE_IDS).toContain(offers[2].id);
      expect(offers[3].id).toBe('r_bushou');
    }
  });

  it('prices the 交易 slot and only the 交易 slot', () => {
    for (let i = 0; i < 60; i++) {
      const offers = rollBlessings(new Rng(`price-${i}`));
      expect(offers[0].costId).toBeNull();
      expect(offers[1].costId).toBeNull();
      expect(COST_IDS).toContain(offers[2].costId);
      expect(offers[3].costId).toBeNull();
    }
  });

  it('replays the whole four-up, pairing included, from the seed alone', () => {
    expect(rollBlessings(new Rng('same'))).toEqual(rollBlessings(new Rng('same')));
  });

  it('actually varies with the seed', () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) =>
        rollBlessings(new Rng(`vary-${i}`))
          .map((o) => `${o.id}/${o.costId}`)
          .join(','),
      ),
    );
    expect(seen.size).toBeGreaterThan(8);
  });

  it('never sells 厚币 for 倾囊', () => {
    // `applyOutcome` empties the purse before it fills it, so the pair would
    // hand over 250 資財 and charge nothing at all.
    for (let i = 0; i < 400; i++) {
      const trade = rollBlessings(new Rng(`pair-${i}`))[2];
      if (trade.id === 't_houbi') expect(trade.costId).not.toBe('c_qingnang');
    }
    expect(costsFor(getBlessing('t_houbi')!).map((c) => c.id)).toEqual(['c_geshe', 'c_suji']);
    expect(costsFor(getBlessing('t_hufu')!).map((c) => c.id)).toEqual([
      'c_geshe',
      'c_suji',
      'c_qingnang',
    ]);
  });
});

describe('ensureBlessing', () => {
  it('materialises once and never re-rolls (R5)', () => {
    const run = fresh('r5');
    const first = ensureBlessing(run).offered.map((o) => `${o.id}/${o.costId}`);
    // A relic changes what the relic pools can deal — a re-roll would show.
    addRelic(run, 'yaonang');
    run.gold = 0;
    expect(ensureBlessing(run).offered.map((o) => `${o.id}/${o.costId}`)).toEqual(first);
  });

  it('parks ids and nothing else (R6)', () => {
    const run = fresh('r6');
    ensureBlessing(run);
    expect(JSON.parse(JSON.stringify(run.blessing))).toEqual(run.blessing);
    for (const offer of run.blessing!.offered) {
      expect(typeof offer.id).toBe('string');
      expect(offer.costId === null || typeof offer.costId === 'string').toBe(true);
    }
    expect(run.blessing!.takenId).toBeNull();
    expect(run.blessing!.pending).toBeNull();
  });

  it('starts null and hangs nothing off the map', () => {
    const run = fresh('null');
    expect(run.blessing).toBeNull();
    take(run, 'm_ziliang');
    expect(run.rooms).toEqual({});
  });

  it('describes every offer for the screen', () => {
    const run = fresh('views');
    const views = blessingViews(run);
    expect(views.map((v) => v.categoryLabel)).toEqual(['薄礼', '厚赠', '交易', '无所求']);
    for (const view of views) {
      expect(view.label.length).toBeGreaterThan(1);
      expect(view.desc.length).toBeGreaterThan(4);
    }
    expect(views[0].cost).toBeNull();
    expect(views[2].cost).toMatch(/^代价：/);
    expect(views[3].cost).toBeNull();
  });
});

// --------------------------------------------------------------------- 薄礼

describe('薄礼', () => {
  it('养精 raises the ceiling and heals for what it granted', () => {
    const run = fresh();
    expect(run.hp).toBe(82);
    const report = take(run, 'm_yangjing');
    expect(run.maxHp).toBe(90);
    expect(run.hp).toBe(90);
    expect(report.maxHp).toBe(8);
  });

  it('资粮 pays 100 on top of the purse the hero brought', () => {
    const run = fresh();
    expect(run.gold).toBe(99);
    take(run, 'm_ziliang');
    expect(run.gold).toBe(199);
  });

  it('携药 fills the belt with three bottles', () => {
    const run = fresh();
    const report = take(run, 'm_xieyao');
    expect(report.potionIds).toHaveLength(3);
    expect(report.potionRefused).toBe(0);
    expect(run.potions.filter((p) => p !== null)).toHaveLength(3);
  });

  it('弃芜 sheds exactly the copy that was picked', () => {
    const run = fresh();
    const doomed = run.deck[3].uid;
    const report = take(run, 'm_qiwu');
    expect(report.pending).toEqual({ kind: 'remove', count: 1 });
    expect(blessingPending(run)).toEqual({ kind: 'remove', count: 1 });
    expect(run.deck).toHaveLength(10);

    expect(resolveBlessingPick(run, [doomed])).toBe(true);
    expect(run.deck).toHaveLength(9);
    expect(run.deck.some((c) => c.uid === doomed)).toBe(false);
    expect(blessingSettled(run)).toBe(true);
  });

  it('易牌 exchanges one copy for a different card of the same band', () => {
    const run = fresh('yipai');
    const doomed = run.deck[0];
    expect(getCard(doomed.defId).rarity).toBe('basic');

    take(run, 'm_yipai');
    expect(blessingPending(run)).toEqual({ kind: 'transform', count: 1 });
    resolveBlessingPick(run, [doomed.uid]);

    // 起手牌 are all `basic` and no pool has a `basic` key — `transformRarity`
    // maps the band onto 常见, or 易牌 would draw from an empty pool on turn one.
    expect(run.deck).toHaveLength(10);
    expect(run.deck.some((c) => c.uid === doomed.uid)).toBe(false);
    const gained = run.deck[run.deck.length - 1];
    expect(GUANYU_COMMON).toContain(gained.defId);
    expect(gained.defId).not.toBe(doomed.defId);
  });
});

// --------------------------------------------------------------------- 厚赠

describe('厚赠', () => {
  it('精简 sheds two named copies and leaves eight', () => {
    const run = fresh();
    const [a, b] = [run.deck[1].uid, run.deck[7].uid];
    take(run, 'j_jingjian');
    expect(blessingPending(run)).toEqual({ kind: 'remove', count: 2 });
    resolveBlessingPick(run, [a, b]);
    expect(run.deck).toHaveLength(8);
    expect(run.deck.some((c) => c.uid === a || c.uid === b)).toBe(false);
  });

  it('秘传 deals one 稀世 card out of the hero own pool', () => {
    const run = fresh('michuan');
    const report = take(run, 'j_michuan');
    expect(report.cardIds).toHaveLength(1);
    expect(GUANYU_RARE).toContain(report.cardIds[0]);
    expect(run.deck).toHaveLength(11);
  });

  it('赠宝 deals a 常见 relic', () => {
    const run = fresh('zengbao');
    const report = take(run, 'j_zengbao');
    expect(COMMON_RELICS).toContain(report.relicId!);
    expect(run.relics).toEqual(['qinglongdao', report.relicId]);
  });

  it('锻炼 forges the copy that was picked', () => {
    const run = fresh();
    const target = run.deck[0];
    take(run, 'j_duanlian');
    expect(blessingPending(run)).toEqual({ kind: 'upgrade', count: 1 });
    resolveBlessingPick(run, [target.uid]);
    expect(run.deck.find((c) => c.uid === target.uid)!.upgraded).toBe(1);
    expect(run.deck.filter((c) => c.upgraded > 0)).toHaveLength(1);
  });

  it('换血 exchanges two copies and keeps the deck the same size', () => {
    const run = fresh('huanxue');
    const doomed = [run.deck[0], run.deck[6]];
    take(run, 'j_huanxue');
    resolveBlessingPick(
      run,
      doomed.map((c) => c.uid),
    );
    expect(run.deck).toHaveLength(10);
    for (const card of doomed) expect(run.deck.some((c) => c.uid === card.uid)).toBe(false);
    for (const gained of run.deck.slice(-2)) expect(GUANYU_COMMON).toContain(gained.defId);
  });
});

// --------------------------------------------------------------------- 交易

describe('交易', () => {
  it('虎符 + 倾囊 empties the purse and hands over a 首领 relic', () => {
    const run = fresh('hufu');
    expect(run.gold).toBe(99);
    const report = take(run, 't_hufu', 'c_qingnang');
    expect(run.gold).toBe(0);
    expect(BOSS_RELICS).toContain(report.relicId!);
    expect(run.relics).toHaveLength(2);
    expect(run.relics[1]).toBe(report.relicId);
  });

  it('虎符 degrades onto the 稀有 ladder when every 首领 relic is owned', () => {
    const run = fresh('hufu-dry');
    for (const id of BOSS_RELICS) addRelic(run, id);
    const report = take(run, 't_hufu', 'c_geshe');
    expect(RARE_RELICS).toContain(report.relicId!);
    expect(report.relicRefused).toBe(false);
  });

  it('淬体 + 割股 raises the ceiling first and bites the raised total', () => {
    // Order is `applyOutcome`'s, and it is the merge that gives the pair one:
    // 82 → 102 on the gain, then ⌈102 × 10%⌉ = 11 off.
    const run = fresh();
    take(run, 't_cuiti', 'c_geshe');
    expect(run.maxHp).toBe(102);
    expect(run.hp).toBe(91);
  });

  it('奇珍 + 宿疾 deals a 罕见 relic and a permanent 旧伤', () => {
    const run = fresh('qizhen');
    const report = take(run, 't_qizhen', 'c_suji');
    expect(UNCOMMON_RELICS).toContain(report.relicId!);
    expect(report.curseIds).toEqual(['jiushang']);
    expect(run.deck).toHaveLength(11);
    expect(run.deck.filter((c) => c.defId === 'jiushang')).toHaveLength(1);
  });

  it('秘录 + 割股 deals three 稀世 cards for a tenth of the blood', () => {
    const run = fresh('milu');
    const report = take(run, 't_milu', 'c_geshe');
    expect(report.cardIds).toHaveLength(3);
    for (const id of report.cardIds) expect(GUANYU_RARE).toContain(id);
    expect(run.deck).toHaveLength(13);
    expect(run.hp).toBe(73);
    expect(run.maxHp).toBe(82);
  });

  it('厚币 + 割股 pays 250 for nine 体力', () => {
    const run = fresh();
    take(run, 't_houbi', 'c_geshe');
    expect(run.gold).toBe(349);
    expect(run.hp).toBe(73);
  });

  it('replays a 交易 payout from the seed alone', () => {
    const a = take(fresh('replay-trade'), 't_qizhen', 'c_suji');
    const b = take(fresh('replay-trade'), 't_qizhen', 'c_suji');
    expect(a.relicId).toBe(b.relicId);
    expect(a.lines).toEqual(b.lines);
  });
});

// ------------------------------------------------------------------ 无所求

describe('不受 · 布衣', () => {
  it('hands over 布衣 and nothing else', () => {
    const run = fresh();
    const report = take(run, 'r_bushou');
    expect(report.relicId).toBe('buyi');
    expect(run.relics).toEqual(['qinglongdao', 'buyi']);
    expect(run.deck).toHaveLength(10);
    expect(run.gold).toBe(99);
  });

  it('trades possessions for a sturdier body: 体力上限 +10, 资财不抽成', () => {
    // 旧布衣发钱又禁掉钱最好的去处（+25% 资财 × 坊市禁购宝物），自相矛盾；
    // 现在苦修换体魄，addRelic 把当前体力同步抬满额。
    const run = fresh();
    const { hp, maxHp, gold } = run;
    take(run, 'r_bushou');
    expect(run.maxHp).toBe(maxHp + 10);
    expect(run.hp).toBe(hp + 10);
    expect(relicModifiers(run.relics).goldMultiplier).toBe(1);
    addGold(run, 100);
    expect(run.gold).toBe(gold + 100);
  });

  it('shuts the 坊市 relic counter, with the reason on the tag', () => {
    const run = shopRun();
    const node = shopNodeId(run);
    const before = shelf(run, node).filter((i) => i.slot.kind === 'relic');
    expect(before.every((i) => i.blocked === null)).toBe(true);

    take(run, 'r_bushou');
    const relics = shelf(run, node).filter((i) => i.slot.kind === 'relic');
    expect(relics).toHaveLength(3);
    for (const item of relics) expect(item.blocked).toBe('布衣在身，不购宝物');
    // Refused *before* the one-shot gate: a refusal inside it would burn the
    // slot and hand back nothing.
    expect(buy(run, node, { kind: 'relic', index: 0 })).toBe('forbidden');
    expect(shelf(run, node).find((i) => i.slot.kind === 'relic')!.sold).toBe(false);
    expect(run.gold).toBe(9999);

    // The other two counters stay open.
    const potion = shelf(run, node).find((i) => i.slot.kind === 'potion')!;
    expect(potion.blocked).toBeNull();
    expect(buy(run, node, potion.slot)).toBe('ok');
  });

  it('keeps 布衣 out of every pool a run can reach', () => {
    const run = fresh('buyi-pool');
    for (const tier of ['starter', 'common', 'uncommon', 'rare', 'boss', 'shop'] as const) {
      expect(relicPool(run, tier), tier).not.toContain('buyi');
    }
    expect(RELICS.buyi.tier).toBe('starter');
    expect(RELICS.buyi.modifiers).toEqual({ maxHp: 10, noRelicPurchase: true });
  });
});

// ------------------------------------------------------------------ 一次性门

describe('the door', () => {
  it('pays a 祝福 exactly once', () => {
    const run = fresh();
    offering(run, 'm_ziliang');
    expect(takeBlessing(run, 'm_ziliang')).not.toBeNull();
    expect(run.gold).toBe(199);

    expect(takeBlessing(run, 'm_ziliang')).toBeNull();
    expect(run.gold).toBe(199);
    expect(blessingTaken(run)).toBe('m_ziliang');
  });

  it('refuses a second, different 祝福 after one has been taken', () => {
    const run = fresh();
    run.blessing = {
      offered: [
        { id: 'm_ziliang', costId: null },
        { id: 'm_yangjing', costId: null },
      ],
      takenId: null,
      pending: null,
    };
    takeBlessing(run, 'm_ziliang');
    expect(takeBlessing(run, 'm_yangjing')).toBeNull();
    expect(run.maxHp).toBe(82);
  });

  it('refuses an id that was never on this run four-up', () => {
    const run = fresh();
    offering(run, 'm_ziliang');
    expect(takeBlessing(run, 't_houbi')).toBeNull();
    expect(takeBlessing(run, 'no_such_id')).toBeNull();
    expect(blessingTaken(run)).toBeNull();
    expect(run.gold).toBe(99);
  });

  it('answers a deck pick exactly once', () => {
    const run = fresh();
    take(run, 'j_jingjian');
    expect(resolveBlessingPick(run, [run.deck[0].uid, run.deck[1].uid])).toBe(true);
    expect(run.deck).toHaveLength(8);
    expect(resolveBlessingPick(run, [run.deck[0].uid])).toBe(false);
    expect(run.deck).toHaveLength(8);
  });

  it('floors a removal at the deck the engine can still deal from', () => {
    const run = fresh();
    // Seven copies asked for against a ten-card deck: `applyPick` stops at
    // MIN_DECK_SIZE, which is 4.
    run.blessing = { offered: [], takenId: 'x', pending: { kind: 'remove', count: 7 } };
    resolveBlessingPick(
      run,
      run.deck.map((c) => c.uid),
    );
    expect(run.deck).toHaveLength(4);
  });

  it('is not settled while a pick is owed', () => {
    const run = fresh();
    expect(blessingSettled(run)).toBe(false);
    take(run, 'm_qiwu');
    expect(blessingSettled(run)).toBe(false);
    resolveBlessingPick(run, [run.deck[0].uid]);
    expect(blessingSettled(run)).toBe(true);
  });
});

// --------------------------------------------------------------- 按武将分流

describe('per-hero payouts', () => {
  it('deals each hero cards out of his own pool on the same seed', () => {
    const guan = startRun(HEROES.guanyu, 'hero-split');
    const zhao = startRun(HEROES.zhaoyun, 'hero-split');
    const a = take(guan, 'j_michuan');
    const b = take(zhao, 'j_michuan');
    expect(GUANYU_RARE).toContain(a.cardIds[0]);
    expect(ZHAOYUN_RARE).toContain(b.cardIds[0]);
  });

  it('never deals another hero starting relic', () => {
    const run = startRun(HEROES.zhaoyun, 'hero-relic');
    const report = take(run, 'j_zengbao');
    expect(COMMON_RELICS).toContain(report.relicId!);
    expect(run.relics[0]).toBe('yajiaoqiang');
  });
});

// ----------------------------------------------------------------- 表本身

describe('the table', () => {
  it('holds five 薄礼, five 厚赠, five 交易, one 无所求 and three prices', () => {
    expect(MINOR_BLESSINGS.map((d) => d.id)).toEqual(MINOR_IDS);
    expect(MAJOR_BLESSINGS.map((d) => d.id)).toEqual(MAJOR_IDS);
    expect(TRADE_BLESSINGS.map((d) => d.id)).toEqual(TRADE_IDS);
    expect(REFUSE_BLESSINGS.map((d) => d.id)).toEqual(['r_bushou']);
    expect(BLESSING_COSTS.map((d) => d.id)).toEqual(COST_IDS);
    expect(ALL_BLESSINGS).toHaveLength(16);
  });

  it('keeps every id unique and every line written', () => {
    const ids = [...ALL_BLESSINGS.map((d) => d.id), ...BLESSING_COSTS.map((d) => d.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of ALL_BLESSINGS) {
      expect(def.label.length, def.id).toBeGreaterThan(1);
      expect(def.desc.length, def.id).toBeGreaterThan(4);
      expect(def.outcome.text.length, def.id).toBeGreaterThan(4);
    }
    for (const cost of BLESSING_COSTS) {
      expect(cost.desc.startsWith('代价：'), cost.id).toBe(true);
    }
  });

  it('charges for every 交易 and for nothing else', () => {
    // Every price is a real one: blood, a curse, or the purse.
    for (const cost of BLESSING_COSTS) {
      const o = cost.outcome;
      expect(Boolean(o.hpLossPercent || o.gainCurse || o.spendAllGold), cost.id).toBe(true);
    }
    // Every 交易 can be sold at at least one of them — an empty pool would burn
    // its draw and hand back a benefit with no price attached.
    for (const def of TRADE_BLESSINGS) {
      expect(costsFor(def).length, def.id).toBeGreaterThan(0);
    }
    // 薄礼 and 厚赠 are pure gains on purpose: the price of a 祝福 is the three
    // you did not take. Anything that bites belongs to 交易.
    for (const def of [...MINOR_BLESSINGS, ...MAJOR_BLESSINGS, ...REFUSE_BLESSINGS]) {
      const o = def.outcome;
      expect(o.hpLossPercent, def.id).toBeUndefined();
      expect(o.gainCurse, def.id).toBeUndefined();
      expect(o.spendAllGold, def.id).toBeUndefined();
      expect(o.gold ?? 0, def.id).toBeGreaterThanOrEqual(0);
      expect(o.hp ?? 0, def.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('merges a price into a benefit without either overwriting the other', () => {
    // `takeBlessing` spreads the cost over the benefit. A field they shared
    // would silently drop half the pair.
    for (const benefit of TRADE_BLESSINGS) {
      for (const cost of costsFor(benefit)) {
        for (const key of Object.keys(cost.outcome)) {
          if (key === 'text') continue;
          expect(benefit.outcome, `${benefit.id}+${cost.id}`).not.toHaveProperty(key);
        }
      }
    }
  });

  it('grants only what the 奇遇 outcome system already knows how to pay', () => {
    // 虎符 is the one exception, and it is declared rather than smuggled in
    // through a widened `EventRelicTier`.
    const bossy = ALL_BLESSINGS.filter((d) => d.bossRelic).map((d) => d.id);
    expect(bossy).toEqual(['t_hufu']);
    expect(getBlessing('r_bushou')!.outcome.gainRelic).toEqual({ id: 'buyi' });
  });
});
