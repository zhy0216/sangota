import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, getCard, poolFor } from '../src/combat/cards';
import { RELICS } from '../src/combat/relics';
import {
  relicPool,
  rollCardReward,
  rollRelicOfTier,
  unlockedPool,
} from '../src/combat/rewards';
import { Rng } from '../src/core/rng';
import { DEFAULT_HERO, HEROES } from '../src/data/heroes';
import { HERO_UNLOCKS, UNLOCK_TRACKS } from '../src/data/unlockTracks';
import { applyOutcome } from '../src/rooms/events';
import { generateStock, SHOP_DRAWS } from '../src/rooms/shop';
import combatSceneSource from '../src/scenes/CombatScene.ts?raw';
import summarySceneSource from '../src/scenes/SummaryScene.ts?raw';
import titleSceneSource from '../src/scenes/TitleScene.ts?raw';
import { settleRun, type RunRecord } from '../src/state/history';
import historySource from '../src/state/history.ts?raw';
import {
  applyRunUnlocks,
  chooseUnlock,
  emptyUnlocks,
  filterUnlocked,
  getUnlocks,
  isUnlocked,
  recordSeenEnemies,
  UNLOCKS_VERSION,
} from '../src/state/unlocks';
import { emptyRunStats, startRun } from '../src/state/run';

/**
 * 解锁进度 — todos/23 u1 的账本与轨道。
 *
 * 三件事各有一节：**默认解锁、轨道设门**的过滤语义（isUnlocked）、阈值跨越
 * 的入账与三选一（applyRunUnlocks / chooseUnlock）、以及第四把钥匙的独立性
 * （键名、白卷、敌意存储）。假 storage 沿用 `history.test.ts` 的那只——
 * 真的在 Node 下不存在，而「不存在」本身也是被测的情形之一。
 */

// --------------------------------------------------------------- 假 storage

class FakeStorage {
  private data = new Map<string, string>();
  /** Set to make every call throw, the way a locked-down browser does. */
  hostile = false;

  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    if (this.hostile) throw new Error('denied');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.hostile) throw new Error('denied');
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    if (this.hostile) throw new Error('denied');
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
}

const withStorage = (): FakeStorage => {
  const fake = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: fake,
    configurable: true,
    writable: true,
  });
  return fake;
};

const dropStorage = (): void => {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
};

afterEach(dropStorage);

// ------------------------------------------------------------------- 局末账

/** 一条最小可用的史料：解锁只读 heroId / score / victory，其余是过账的数字。 */
function record(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'unlock-test',
    endedAt: 0,
    durationMs: 0,
    heroId: 'guanyu',
    ascension: 0,
    victory: false,
    killedBy: '刀盾兵',
    floor: 3,
    act: 1,
    score: 0,
    scoreBreakdown: [],
    deck: [],
    relics: [],
    stats: emptyRunStats(),
    ...over,
  };
}

// 轨道三批的阈值与内容，测试按 id 写死——轨道数据变了这里就该跟着红。
const [BATCH1, BATCH2, BATCH3] = UNLOCK_TRACKS;

// ----------------------------------------------------------------- 轨道数据

describe('UNLOCK_TRACKS', () => {
  it('references only ids that exist — cards, relics and heroes alike', () => {
    for (const batch of UNLOCK_TRACKS) {
      expect(HEROES[batch.heroId]).toBeDefined();
      for (const id of [...(batch.cardChoice ?? []), ...(batch.cards ?? [])]) {
        // getCard throws on an unknown id — the loud version of the check.
        expect(getCard(id).id).toBe(id);
      }
      for (const id of batch.relics ?? []) expect(RELICS[id]).toBeDefined();
    }
    for (const gate of HERO_UNLOCKS) expect(HEROES[gate.heroId]).toBeDefined();
  });

  it('matches the design table: 200 三选一, 500 +2 普通宝物, 900 +1 稀有宝物', () => {
    expect(BATCH1.atScore).toBe(200);
    expect(BATCH1.cardChoice).toHaveLength(3);
    expect(BATCH1.relics ?? []).toHaveLength(0);

    expect(BATCH2.atScore).toBe(500);
    expect(BATCH2.cardChoice).toHaveLength(3);
    expect(BATCH2.relics).toHaveLength(2);
    for (const id of BATCH2.relics ?? []) expect(RELICS[id].tier).toBe('common');

    expect(BATCH3.atScore).toBe(900);
    expect(BATCH3.cardChoice).toHaveLength(3);
    expect(BATCH3.relics).toHaveLength(1);
    for (const id of BATCH3.relics ?? []) expect(RELICS[id].tier).toBe('rare');
  });

  it('gates exactly the 13 expansion cards — 关羽 keeps his original 11', () => {
    const gated = UNLOCK_TRACKS.flatMap((b) => [...(b.cardChoice ?? []), ...(b.cards ?? [])]);
    expect(new Set(gated).size).toBe(13);
    // 原始 11 张（todos/11 扩池前）一张都不在门后。
    const original = [
      'pikan', 'tiebi', 'tuodao',
      'wenjiu', 'wanren', 'quedi', 'yiyong', 'baima', 'jieying', 'guanzhen', 'xuzhao',
    ];
    for (const id of original) expect(gated).not.toContain(id);
    // 门后的全是关羽的牌——赵云/诸葛亮的池子随武将本体放出，不设卡牌门。
    for (const id of gated) expect(CARDS[id].hero).toBe('guanyu');
  });
});

// ----------------------------------------------------------------- 初始集合

describe('isUnlocked', () => {
  it('opens a fresh install wide enough for a first run', () => {
    withStorage();
    // 关羽和他的原始 11 张全开；无色牌、未点名的宝物同样默认放行。
    expect(isUnlocked('hero', 'guanyu')).toBe(true);
    for (const id of ['pikan', 'wenjiu', 'wanren', 'quedi', 'xuzhao']) {
      expect(isUnlocked('card', id)).toBe(true);
    }
    expect(isUnlocked('card', 'qingnangshu')).toBe(true);
    expect(isUnlocked('relic', 'shufajinguan')).toBe(true);
    expect(isUnlocked('relic', 'chuanguoyuxi')).toBe(true);
  });

  it('locks the tracked content and the two later heroes', () => {
    withStorage();
    expect(isUnlocked('hero', 'zhaoyun')).toBe(false);
    expect(isUnlocked('hero', 'zhugeliang')).toBe(false);
    for (const id of ['dandaofuhui', 'weizhenhuaxia', 'bingzhudadan', 'shengougaolei']) {
      expect(isUnlocked('card', id)).toBe(false);
    }
    for (const id of ['xiandengdun', 'xuanjia', 'gudingdao']) {
      expect(isUnlocked('relic', id)).toBe(false);
    }
  });

  it('leaves 赵云 and 诸葛亮 cards ungated — the hero door is their only door', () => {
    withStorage();
    expect(isUnlocked('card', 'tuzhen')).toBe(true);
    expect(isUnlocked('card', 'changbanpo')).toBe(true);
    expect(isUnlocked('card', 'huoshaotengjia')).toBe(true);
  });
});

// ------------------------------------------------------------- 阈值与三选一

describe('applyRunUnlocks', () => {
  it('crossing 200 raises the 三选一 and hands out nothing else yet', () => {
    withStorage();
    const out = applyRunUnlocks(record({ score: 250 }));
    expect(out.newCards).toEqual([]);
    expect(out.newRelics).toEqual([]);
    expect(out.pendingChoice).toEqual({ heroId: 'guanyu', options: BATCH1.cardChoice });
    expect(getUnlocks().progress.guanyu).toBe(250);
    // 挂起归挂起——没选之前一张都不算解锁。
    for (const id of BATCH1.cardChoice ?? []) expect(isUnlocked('card', id)).toBe(false);
  });

  it('accumulates score across runs before a threshold, per hero', () => {
    withStorage();
    expect(applyRunUnlocks(record({ score: 120 })).pendingChoice).toBeNull();
    // 赵云的分记赵云的账，推不动关羽的轨道。
    expect(applyRunUnlocks(record({ heroId: 'zhaoyun', score: 999 })).pendingChoice).toBeNull();
    const out = applyRunUnlocks(record({ score: 80 }));
    expect(getUnlocks().progress).toEqual({ guanyu: 200, zhaoyun: 999 });
    expect(out.pendingChoice?.options).toEqual(BATCH1.cardChoice);
  });

  it('chooseUnlock takes the picked card now and only from the live options', () => {
    withStorage();
    applyRunUnlocks(record({ score: 200 }));
    // 不在选项里的牌拒收——按钮回调传错 id 不能白拿。
    expect(chooseUnlock('pikan')).toBe(false);
    expect(chooseUnlock('weizhenhuaxia')).toBe(true);
    expect(isUnlocked('card', 'weizhenhuaxia')).toBe(true);
    expect(getUnlocks().pendingChoice).toBeNull();
    // 其余两张仍在门后，等下一批。
    expect(isUnlocked('card', 'dandaofuhui')).toBe(false);
    // 选完就没得再选。
    expect(chooseUnlock('dandaofuhui')).toBe(false);
  });

  it('crossing 500 frees the previous leftovers, the relics and the next choice', () => {
    withStorage();
    applyRunUnlocks(record({ score: 200 }));
    chooseUnlock('weizhenhuaxia');
    const out = applyRunUnlocks(record({ score: 300 }));
    // 第一批剩下两张「下一批自动解锁」。
    expect(out.newCards).toEqual(
      expect.arrayContaining(['dandaofuhui', 'shuiyanqijun', ...(BATCH2.cards ?? [])]),
    );
    expect(out.newCards).toHaveLength(4);
    expect(out.newRelics).toEqual(BATCH2.relics);
    expect(out.pendingChoice?.options).toEqual(BATCH2.cardChoice);
  });

  it('an ignored choice still unlocks in full once a higher batch lands', () => {
    withStorage();
    // 一局巨分直接跨过 200 和 500：第一批没人选过,三张全放,只挂第二批的三选一。
    const out = applyRunUnlocks(record({ score: 600 }));
    expect(out.newCards).toEqual(
      expect.arrayContaining([...(BATCH1.cardChoice ?? []), ...(BATCH2.cards ?? [])]),
    );
    expect(out.newCards).toHaveLength(5);
    expect(out.pendingChoice?.options).toEqual(BATCH2.cardChoice);
  });

  it('the final batch has no next batch — its leftovers follow on the next run', () => {
    withStorage();
    applyRunUnlocks(record({ score: 900 }));
    chooseUnlock('shengougaolei');
    const out = applyRunUnlocks(record({ score: 10 }));
    expect(out.newCards).toEqual(expect.arrayContaining(['yeduchunqiu', 'tushanyuesanshi']));
    expect(out.pendingChoice).toBeNull();
    // 至此 13 张扩池牌全部在册。
    const gated = UNLOCK_TRACKS.flatMap((b) => [...(b.cardChoice ?? []), ...(b.cards ?? [])]);
    for (const id of gated) expect(isUnlocked('card', id)).toBe(true);
  });

  it('unlocks 赵云 on the first victory, any hero — and holds 制作中 诸葛亮 back', () => {
    withStorage();
    expect(applyRunUnlocks(record({ victory: true, killedBy: null })).newHeroes).toEqual([
      'zhaoyun',
    ]);
    expect(isUnlocked('hero', 'zhaoyun')).toBe(true);
    expect(isUnlocked('hero', 'zhugeliang')).toBe(false);
    // 第二次通关换赵云上——「任意武将」——但诸葛亮制作中：门跨过了也不发，
    // 结算界面不许一个选将界面点不开的人。
    const out = applyRunUnlocks(record({ heroId: 'zhaoyun', victory: true, killedBy: null }));
    expect(out.newHeroes).toEqual([]);
    expect(getUnlocks().heroes).toEqual(['zhaoyun']);
    // 第三次没有周瑜可发（他还不在 HEROES 里），不多发也不炸。
    expect(applyRunUnlocks(record({ victory: true, killedBy: null })).newHeroes).toEqual([]);
    expect(getUnlocks().victories).toBe(3);
  });

  it('发的是那面旗，不是通关数——摘掉 wip，下一次入账当场补发', () => {
    withStorage();
    for (let i = 0; i < 2; i++) applyRunUnlocks(record({ victory: true, killedBy: null }));
    expect(getUnlocks().victories).toBe(2);
    expect(getUnlocks().heroes).not.toContain('zhugeliang');

    // 上架的那一刻：通关数早就够了，账上还欠着他。
    delete HEROES.zhugeliang.wip;
    try {
      const out = applyRunUnlocks(record({ score: 0 }));
      expect(out.newHeroes).toEqual(['zhugeliang']);
      expect(isUnlocked('hero', 'zhugeliang')).toBe(true);
    } finally {
      HEROES.zhugeliang.wip = true;
    }
  });

  it('a defeat counts score but never a victory', () => {
    withStorage();
    applyRunUnlocks(record({ score: 50, victory: false }));
    expect(getUnlocks().victories).toBe(0);
    expect(isUnlocked('hero', 'zhaoyun')).toBe(false);
  });
});

// ------------------------------------------------------------- 随机池过滤 u2

// 门后的全部 id，直接从轨道推——轨道加一批,这里的断言自动跟着变严。
const GATED_CARD_IDS = UNLOCK_TRACKS.flatMap((b) => [
  ...(b.cardChoice ?? []),
  ...(b.cards ?? []),
]);
const GATED_RELIC_IDS = UNLOCK_TRACKS.flatMap((b) => b.relics ?? []);

/** 把轨道上的门全部写开——「全解锁时行为与现在完全一致」用它对照。 */
const unlockAll = (fake: FakeStorage): void => {
  fake.setItem(
    'sangota.unlocks.v1',
    JSON.stringify({ ...emptyUnlocks(), cards: GATED_CARD_IDS, relics: GATED_RELIC_IDS }),
  );
};

describe('随机池解锁过滤 (u2)', () => {
  it('a fresh ledger never offers a gated card in fight rewards — and never shorts the reward', () => {
    withStorage();
    const run = startRun(DEFAULT_HERO, 'u2-reward');
    const rng = new Rng('u2-reward');
    for (let i = 0; i < 200; i++) {
      const picks = rollCardReward({ tier: 'boss', run, rng });
      // 稀有池整个在门后,回退顶上——奖励宽度不缩水。
      expect(picks).toHaveLength(3);
      for (const id of picks) expect(GATED_CARD_IDS).not.toContain(id);
    }
  });

  it('unlocking the tracks lets gated cards back into rewards', () => {
    unlockAll(withStorage());
    const run = startRun(DEFAULT_HERO, 'u2-reward-open');
    const rng = new Rng('u2-reward-open');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const id of rollCardReward({ tier: 'boss', run, rng })) seen.add(id);
    }
    expect(GATED_CARD_IDS.some((id) => seen.has(id))).toBe(true);
  });

  it('narrows the pool without moving the stream — same seed, same draw count (R3)', () => {
    withStorage();
    const locked = startRun(DEFAULT_HERO, 'u2-r3');
    const lockedRng = new Rng('u2-r3');
    for (let i = 0; i < 50; i++) rollCardReward({ tier: 'monster', run: locked, rng: lockedRng });

    dropStorage();
    const open = startRun(DEFAULT_HERO, 'u2-r3');
    const openRng = new Rng('u2-r3');
    for (let i = 0; i < 50; i++) rollCardReward({ tier: 'monster', run: open, rng: openRng });

    expect(lockedRng.rolls).toBe(openRng.rolls);
  });

  it('keeps gated relics off every drop path through the one shared pool', () => {
    withStorage();
    const run = startRun(DEFAULT_HERO, 'u2-relic');
    for (const tier of ['common', 'rare'] as const) {
      for (const id of GATED_RELIC_IDS) expect(relicPool(run, tier)).not.toContain(id);
    }
    const rng = new Rng('u2-relic');
    for (let i = 0; i < 120; i++) {
      const id = rollRelicOfTier(rng, run, 'common');
      if (id) expect(GATED_RELIC_IDS).not.toContain(id);
    }
  });

  it('the shop shelf carries no gated stock, still in exactly SHOP_DRAWS draws', () => {
    withStorage();
    for (const seed of ['u2-shop-a', 'u2-shop-b', 'u2-shop-c']) {
      const run = startRun(DEFAULT_HERO, seed);
      const rng = new Rng(seed);
      const stock = generateStock(run, rng);
      expect(rng.rolls).toBe(SHOP_DRAWS);
      for (const offer of stock.cards) expect(GATED_CARD_IDS).not.toContain(offer.defId);
      for (const offer of stock.relics) expect(GATED_RELIC_IDS).not.toContain(offer.id);
    }
  });

  it('a fully unlocked ledger stocks the very shelf a storage-less run does', () => {
    // 「全解锁时行为与现在完全一致」——同一种子,开满门的账和没有账的
    // Node 环境必须逐字进同一批货。
    unlockAll(withStorage());
    const openLedger = generateStock(startRun(DEFAULT_HERO, 'u2-same'), new Rng('u2-same'));
    dropStorage();
    const noLedger = generateStock(startRun(DEFAULT_HERO, 'u2-same'), new Rng('u2-same'));
    expect(openLedger).toEqual(noLedger);
  });

  it('an event dealing rares on a fresh ledger deals only the ungated ones — never undefined, never a locked card', () => {
    withStorage();
    const run = startRun(DEFAULT_HERO, 'u2-event');
    const before = run.deck.length;
    // 解锁轨上的三张稀有(威震华夏/五关六将/深沟高垒)在门后一张不漏；
    // 2026-08 扩池的九张不上轨，新账本也照发——固定种子仍只烧三次 pick。
    const rng = new Rng('u2-event');
    const report = applyOutcome(run, { text: '', gainCards: { count: 3, rarity: 'rare' } }, rng);
    expect([...report.cardIds].sort()).toEqual(['shenzaicaoying', 'wusheng', 'yibaoyuntian']);
    expect(run.deck).toHaveLength(before + 3);
    expect(rng.rolls).toBe(3);

    // 常见池还有未上锁的 12 张,发得出来,且发的全不在门后。
    const more = applyOutcome(
      run,
      { text: '', gainCards: { count: 3, rarity: 'common' } },
      new Rng('u2-event-common'),
    );
    expect(more.cardIds).toHaveLength(3);
    for (const id of more.cardIds) expect(GATED_CARD_IDS).not.toContain(id);
  });

  it('without storage every pool stays wide open — the documented tradeoff', () => {
    // Node 测试与 headless sim 无处记账,门不设防:黄金快照与既有期望值不动。
    dropStorage();
    expect(unlockedPool('guanyu', 'rare')).toEqual(poolFor('guanyu', 'rare'));
    expect(filterUnlocked('card', GATED_CARD_IDS)).toEqual(GATED_CARD_IDS);
    expect(isUnlocked('card', GATED_CARD_IDS[0])).toBe(true);
  });
});

// --------------------------------------------------------------- 敌卷埋点 u2

describe('recordSeenEnemies', () => {
  it('records each enemy once, however many stand up or how often the fight reopens', () => {
    withStorage();
    recordSeenEnemies(['yellowturban', 'yellowturban', 'bandit']);
    expect(getUnlocks().seenEnemies).toEqual(['yellowturban', 'bandit']);
    // 续档重开同一场:幂等,不重复记账。
    recordSeenEnemies(['bandit', 'huaxiong']);
    expect(getUnlocks().seenEnemies).toEqual(['yellowturban', 'bandit', 'huaxiong']);
  });

  it('shrugs without storage, like the rest of the ledger', () => {
    dropStorage();
    expect(() => recordSeenEnemies(['lubu'])).not.toThrow();
  });

  it('CombatScene reports the encounter the moment it is ensured — the engine never does', () => {
    // 接线用源码验,`tests/combatScene.test.ts` 同款:场景在 Node 下 import
    // 不动,而这行不在,敌卷就永远是白卷。
    expect(combatSceneSource).toContain('recordSeenEnemies(this.encounter.enemies)');
  });
});

// ----------------------------------------------------------------- u3 接线

describe('settleRun 接入解锁 (u3)', () => {
  /** `settleRun` 要的终局信息,一份平平无奇的败局。 */
  const end = { victory: false, killedBy: '华雄', endedAt: 0, durationMs: 0 } as const;

  it('books the run into the unlock ledger and hands the report back', () => {
    withStorage();
    const run = startRun(DEFAULT_HERO, 'u3-settle');
    run.stats.bossesSlain = 4; // 定鼎 4×50——一笔跨过 200 的门。
    const { record, unlocks } = settleRun(run, { ...end });
    expect(record.score).toBeGreaterThanOrEqual(200);
    expect(unlocks.pendingChoice?.options).toEqual(BATCH1.cardChoice);
    // 与战史同源同额:解锁账本记的就是史笔那笔分。
    expect(getUnlocks().progress.guanyu).toBe(record.score);
  });

  it('a victory settled through settleRun frees 赵云 on the spot', () => {
    withStorage();
    const run = startRun(DEFAULT_HERO, 'u3-victory');
    const { unlocks } = settleRun(run, { ...end, victory: true, killedBy: null });
    expect(unlocks.newHeroes).toEqual(['zhaoyun']);
    expect(isUnlocked('hero', 'zhaoyun')).toBe(true);
  });

  it('settles the annals first and the unlock ledger second — recordRun 后调', () => {
    // 实现步骤 4 点名的先后。源码验序,`recordSeenEnemies` 的接线测试同款。
    const at = historySource.indexOf('recordRun(record)');
    expect(at).toBeGreaterThan(-1);
    expect(historySource.indexOf('applyRunUnlocks(record)')).toBeGreaterThan(at);
  });

  it('SummaryScene lays the report out — cards flip, relics flash, heroes take a bow', () => {
    // 场景在 Node 下 import 不动(要 Phaser),按 `tests/summaryFlow.test.ts`
    // 的规矩验源码:回执必须进「新识」栏,三类内容与卷讯一个都不能少。
    expect(summarySceneSource).toContain('this.buildUnlockPanel(unlocks)');
    for (const bit of ['newCards', 'newRelics', 'newHeroes', 'relicBar.flash', '有新卷可阅']) {
      expect(summarySceneSource).toContain(bit);
    }
  });

  it('TitleScene raises 「新卷可阅」 while a choice hangs, and settles it via chooseUnlock', () => {
    expect(titleSceneSource).toContain('getUnlocks().pendingChoice');
    expect(titleSceneSource).toContain('新 卷 可 阅');
    // 三选一复用 CardGrid 的 pick 模式,选一张、当场入册。
    expect(titleSceneSource).toContain("mode: 'pick'");
    expect(titleSceneSource).toContain('chooseUnlock(uids[0])');
  });
});

// --------------------------------------------------------------- 第四把钥匙

describe('unlock storage', () => {
  it('writes its own key and never touches the other three ledgers', () => {
    const fake = withStorage();
    applyRunUnlocks(record({ score: 250 }));
    expect(fake.getItem('sangota.unlocks.v1')).not.toBeNull();
    for (const key of ['sangota.save.v1', 'sangota.career.v1', 'sangota.ascension.v1']) {
      expect(fake.getItem(key)).toBeNull();
    }
    // 清掉跑团存档影响不到解锁——键不同，账就分开。
    fake.removeItem('sangota.save.v1');
    expect(getUnlocks().progress.guanyu).toBe(250);
  });

  it('resets to a blank page on a version mismatch or garbage payload', () => {
    const fake = withStorage();
    fake.setItem('sangota.unlocks.v1', JSON.stringify({ version: UNLOCKS_VERSION + 1 }));
    expect(getUnlocks()).toEqual(emptyUnlocks());
    fake.setItem('sangota.unlocks.v1', '不是 JSON');
    expect(getUnlocks()).toEqual(emptyUnlocks());
  });

  it('shrugs when localStorage is absent or hostile', () => {
    // Node 的默认情形：根本没有 localStorage。
    dropStorage();
    expect(getUnlocks()).toEqual(emptyUnlocks());
    expect(() => applyRunUnlocks(record({ score: 999 }))).not.toThrow();
    expect(isUnlocked('card', 'pikan')).toBe(true);

    // 锁死的浏览器：读写皆抛。
    const fake = withStorage();
    fake.hostile = true;
    expect(getUnlocks()).toEqual(emptyUnlocks());
    expect(() => chooseUnlock('dandaofuhui')).not.toThrow();
  });
});
