import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import {
  CARD_POOL_BY_RARITY,
  COLORLESS_POOL,
  GUANYU_CARDS,
  HERO_CARD_POOLS,
  getCard,
  poolFor,
  poolsOf,
} from '../src/combat/cards';
import { relicPool } from '../src/combat/rewards';
import { RELICS, relicModifiers } from '../src/combat/relics';
import { ACT1_LAYOUT, generateFinalAct, generateMap } from '../src/map/generateMap';
import { RUN_SCOPE, runStream, streamSeed } from '../src/rooms/rng';
import { payTheft } from '../src/rooms/fight';
import { applyPick, transformRarity } from '../src/rooms/events';
import { clearActProgress, startRun, type RunState } from '../src/state/run';
import { DEFAULT_HERO } from '../src/data/heroes';

/**
 * 阶段四地基 — the shared surface every parallel swimlane was cut against.
 *
 * Everything here guards a property that is *invisible* when it breaks: a pool
 * that quietly re-orders, a stream that quietly re-rolls, a ledger that quietly
 * carries an act's worth of state into the next one. None of them fails loudly
 * on its own, and all of them invalidate saved seeds.
 */

const run = (): RunState => startRun(DEFAULT_HERO, 'foundation-seed');

// ------------------------------------------------------------------- 卡池

/**
 * The three arrays exactly as they were written by hand before the pools were
 * derived from `GUANYU_CARDS`. **Append only.** A reward and a 坊市 shelf both
 * index into these off a seeded roll, so re-ordering one re-deals every reward
 * in every run that already exists — which no test that only counts them, and
 * no player, would notice.
 */
const GUANYU_POOLS = {
  common: [
    'wenjiu',
    'quedi',
    'baima',
    'jieying',
    'guanzhen',
    'xuzhao',
    'dandaofuhui',
    'huarongdao',
    'bingzhudadan',
    'yeduchunqiu',
  ],
  uncommon: [
    'wanren',
    'yiyong',
    'shuiyanqijun',
    'zhanyanliang',
    'hulaoguan',
    'tushanyuesanshi',
    'wubaijiaodaoshou',
    'guaguliaodu',
  ],
  rare: ['weizhenhuaxia', 'wuguanliujiang', 'shengougaolei'],
} as const;

describe('卡池按武将分流', () => {
  it('deals 关羽 exactly the ids, in exactly the order, he was dealt before', () => {
    expect(poolFor('guanyu', 'common')).toEqual([...GUANYU_POOLS.common]);
    expect(poolFor('guanyu', 'uncommon')).toEqual([...GUANYU_POOLS.uncommon]);
    expect(poolFor('guanyu', 'rare')).toEqual([...GUANYU_POOLS.rare]);
  });

  it('keeps the old alias pointing at the same arrays', () => {
    expect(CARD_POOL_BY_RARITY).toBe(HERO_CARD_POOLS.guanyu);
  });

  it('hands an unknown hero an empty pool rather than someone else’s cards', () => {
    expect(poolFor('nobody', 'common')).toEqual([]);
    expect(poolFor('nobody', 'rare')).toEqual([]);
  });

  it('derives pools in declaration order and drops the un-draftable', () => {
    const pools = poolsOf(GUANYU_CARDS);
    expect(pools.common).toEqual([...GUANYU_POOLS.common]);
    // 起手牌 are `basic` and no pool has a `basic` key.
    expect(Object.values(pools).flat()).not.toContain('pikan');
  });

  it('tags every card with the table it was declared in', () => {
    for (const id of Object.values(GUANYU_POOLS).flat()) {
      expect(getCard(id).hero, id).toBe('guanyu');
    }
    for (const id of COLORLESS_POOL) expect(getCard(id).hero, id).toBe('colorless');
  });

  it('keeps 无色 out of every hero pool', () => {
    for (const pools of Object.values(HERO_CARD_POOLS)) {
      for (const id of COLORLESS_POOL) expect(Object.values(pools).flat()).not.toContain(id);
    }
  });
});

// ------------------------------------------------------------------- 宝物

describe('宝物按武将分流', () => {
  /** Today's pools, frozen from before `RelicDef.hero` existed. */
  const BASELINE = {
    common: [
      'shufajinguan',
      'dujunlingqi',
      'xuanwujia',
      'xingjuntu',
      'lianhuanjia',
      'jinchuangyao',
      'xiandengdun',
      'xuanjia',
      'yaonang',
    ],
    uncommon: ['lianu', 'tiemian', 'huxinjing', 'xiaoshouling', 'qiuxianling', 'yushan', 'mumaliu', 'huangshishu'],
    rare: ['chuanguoyuxi', 'tengjia', 'gudingdao', 'sunzibingfa', 'qixingdeng'],
    boss: ['chitima', 'duduan', 'fangtianhuaji', 'hufu', 'tongquetai', 'jiuxi'],
    shop: ['geban', 'jubaopen', 'xingshangfujie', 'jiuhulu'],
  };

  it('leaves 关羽 the pool he had before relics could belong to a hero', () => {
    const r = run();
    r.relics = [];
    for (const [tier, ids] of Object.entries(BASELINE)) {
      expect(relicPool(r, tier as keyof typeof BASELINE), tier).toEqual(ids);
    }
  });

  it('never rolls a starter relic — that is what the tier is for', () => {
    const r = run();
    r.relics = [];
    const rolled = new Set(
      (['common', 'uncommon', 'rare', 'boss', 'shop'] as const).flatMap((t) => relicPool(r, t)),
    );
    for (const def of Object.values(RELICS)) {
      if (def.tier === 'starter') expect(rolled.has(def.id), def.id).toBe(false);
    }
  });

  it('sums modifiers but *ors* the one flag', () => {
    const mods = relicModifiers([]);
    expect(mods.noRelicPurchase).toBe(false);
    expect(mods.goldMultiplier).toBe(1);
  });
});

// --------------------------------------------------------------- 随机流

describe('run-scope streams', () => {
  it('addresses run-wide decisions through the same three-field seed', () => {
    const r = run();
    expect(streamSeed(r, RUN_SCOPE, 'blessing')).toBe(`${r.map.seed}:run:blessing`);
  });

  it('keeps the blessing streams physically apart', () => {
    const r = run();
    const a = runStream(r, 'blessing').int(1000);
    const b = runStream(r, 'blessingTake').int(1000);
    const c = runStream(r, 'blessingTransform').int(1000);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('replays a run stream from the seed alone', () => {
    const first = runStream(run(), 'blessing');
    const second = runStream(run(), 'blessing');
    expect(Array.from({ length: 8 }, () => first.next())).toEqual(
      Array.from({ length: 8 }, () => second.next()),
    );
  });
});

// ------------------------------------------------------------------- 夺财

describe('payTheft', () => {
  it('debits the purse once per theft, whatever the caller does', () => {
    const r = run();
    r.gold = 100;
    expect(payTheft(r, '1_1', 0, 30)).toBe(30);
    expect(r.gold).toBe(70);
    // Same index twice — a re-entered fight must not be charged again.
    expect(payTheft(r, '1_1', 0, 30)).toBe(0);
    expect(r.gold).toBe(70);
  });

  it('charges two thieves separately', () => {
    const r = run();
    r.gold = 100;
    payTheft(r, '1_1', 0, 30);
    expect(payTheft(r, '1_1', 1, 30)).toBe(30);
    expect(r.gold).toBe(40);
  });

  it('clamps at an empty purse and reports what was actually taken', () => {
    const r = run();
    r.gold = 12;
    expect(payTheft(r, '1_1', 0, 30)).toBe(12);
    expect(r.gold).toBe(0);
  });
});

// ------------------------------------------------------------------- 选牌

describe('applyPick — the one deck-pick implementation', () => {
  it('floors a removal at MIN_DECK_SIZE', () => {
    const r = run();
    r.deck = r.deck.slice(0, 5);
    applyPick(r, { kind: 'remove', count: 3 }, r.deck.map((c) => c.uid));
    expect(r.deck.length).toBe(4);
  });

  it('exchanges a card for a different one of the same band', () => {
    const r = run();
    const card = r.deck[0];
    // 起手牌 are `basic`; without the mapping the pool would be empty.
    expect(transformRarity(card.defId)).toBe('common');
    applyPick(r, { kind: 'transform', count: 1 }, [card.uid], new Rng('t'));
    expect(r.deck.find((c) => c.uid === card.uid)).toBeUndefined();
    const gained = r.deck[r.deck.length - 1];
    expect(poolFor('guanyu', 'common')).toContain(gained.defId);
    expect(gained.defId).not.toBe(card.defId);
  });

  it('spends exactly one draw per card exchanged (R3)', () => {
    const r = run();
    const rng = new Rng('draws');
    const before = rng.rolls;
    applyPick(r, { kind: 'transform', count: 2 }, [r.deck[0].uid, r.deck[1].uid], rng);
    expect(rng.rolls - before).toBe(2);
  });

  it('maps every other rarity onto itself', () => {
    expect(transformRarity('wenjiu')).toBe('common');
    expect(transformRarity('wanren')).toBe('uncommon');
    expect(transformRarity('weizhenhuaxia')).toBe('rare');
  });
});

// --------------------------------------------------------------- 幕与地图

describe('act layout and the finale', () => {
  it('starts 第一幕 on the numbers the map has always used', () => {
    expect(ACT1_LAYOUT).toEqual({ rows: 15, treasureRow: 8, restRow: 14, minAdvancedRow: 5 });
  });

  it('honours a different shape rather than a module-level one', () => {
    const map = generateMap('shape', { rows: 6, treasureRow: 2, restRow: 5, minAdvancedRow: 1 });
    expect(map.rows).toBe(6);
    expect(map.byRow).toHaveLength(6);
    for (const id of map.byRow[2]) expect(map.nodes.get(id)!.type).toBe('treasure');
    for (const id of map.byRow[5]) expect(map.nodes.get(id)!.type).toBe('rest');
  });

  it('builds 终章 without touching a die', () => {
    // Two different seeds: the seed is carried for the room streams and for
    // `runSeedOf`, and the *layout* must still ignore it entirely.
    const a = generateFinalAct('one:act4');
    const b = generateFinalAct('two:act4');
    const shape = (m: ReturnType<typeof generateFinalAct>): string[] =>
      [...m.nodes.values()].map((n) => `${n.id}:${n.type}:${n.x}:${n.y}`);
    expect(shape(a)).toEqual(shape(b));
    expect(a.seed).toBe('one:act4');
    expect(a.nodes.size).toBe(3);
    expect(a.nodes.get('0_0')!.type).toBe('elite');
    expect(a.nodes.get('1_0')!.type).toBe('rest');
    expect(a.nodes.get(a.bossId)!.type).toBe('boss');
    expect(a.bossId).toBe('boss');
    // One route, no choice: elite → camp → boss.
    expect(a.nodes.get('0_0')!.children).toEqual(['1_0']);
    expect(a.nodes.get('1_0')!.children).toEqual(['boss']);
  });
});

// --------------------------------------------------------------- 换幕清账

describe('clearActProgress', () => {
  it('wipes everything an act owns and nothing the run owns', () => {
    const r = run();
    r.rooms['3_2'] = { kind: 'rest', committed: ['rest'] };
    r.usedEncounters.push('m1');
    r.actCombatCount = 4;
    r.bossRelicOffer = ['chitima'];
    r.currentNodeId = '3_2';
    r.path.push('3_2');
    const hp = r.hp;
    const deck = r.deck.length;

    clearActProgress(r);

    expect(r.rooms).toEqual({});
    expect(r.usedEncounters).toEqual([]);
    expect(r.actCombatCount).toBe(0);
    expect(r.bossRelicOffer).toBeNull();
    expect(r.currentNodeId).toBeNull();
    expect(r.path).toEqual([]);
    // The run itself is untouched — an act change is not a new run.
    expect(r.hp).toBe(hp);
    expect(r.deck.length).toBe(deck);
    expect(r.relics.length).toBeGreaterThan(0);
  });

  it('lets a repeated node id start clean, which is the whole point', () => {
    const r = run();
    r.rooms['3_2'] = {
      kind: 'combat',
      committed: ['relic'],
      encounterId: 'm1',
      relicId: null,
      spoils: null,
    };
    clearActProgress(r);
    expect(r.rooms['3_2']).toBeUndefined();
  });
});

// --------------------------------------------------------------- 开局祝福

describe('RunState.blessing', () => {
  it('starts null and costs `startRun` nothing', () => {
    const r = run();
    expect(r.blessing).toBeNull();
    expect(r.rooms).toEqual({});
  });
});
