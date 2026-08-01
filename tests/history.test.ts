import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_HERO } from '../src/data/heroes';
import {
  CAREER_RECORD_LIMIT,
  CAREER_VERSION,
  computeScore,
  emptyCareer,
  getCareer,
  markRunStart,
  recordRun,
  runElapsed,
  settleRun,
  type RunEndInfo,
  type RunRecord,
} from '../src/state/history';
import { addCurse, emptyRunStats, newDeckCard, startRun, type RunState } from '../src/state/run';

/**
 * 战史 — todos/22 s2 的评分表与跨局账本。
 *
 * 评分测试全部手动构造一局验算（验收标准自带的算例：登临 15 层 = 15 分、
 * 斩 20 个 = 40、1 精英 = 10、1 Boss = 50，共 115），存储测试沿用
 * `save.test.ts` 的假 storage——真的在 Node 下不存在，而「不存在」本身
 * 也是被测的情形之一。
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

// ------------------------------------------------------------------- 评分

/**
 * 验收标准的那一局：15 层、20 杂兵、1 精英、1 Boss。牌组换成「有重复、
 * 无四连」的五张——关羽的起手 5×劈砍 + 4×铁壁 会平白多出两笔专精。
 */
function scoredRun(): RunState {
  const run = startRun(DEFAULT_HERO, 'history-score');
  run.stats.floorsClimbed = 15;
  run.stats.enemiesSlain = 20;
  run.stats.elitesSlain = 1;
  run.stats.bossesSlain = 1;
  run.deck = [
    newDeckCard('pikan'),
    newDeckCard('pikan'),
    newDeckCard('tiebi'),
    newDeckCard('tiebi'),
    newDeckCard('tuodao'),
  ];
  return run;
}

describe('computeScore', () => {
  it('adds up the acceptance-criteria run to exactly 115', () => {
    const { total, breakdown } = computeScore(scoredRun(), false);
    expect(breakdown).toEqual([
      { label: '登临', value: 15 },
      { label: '斩获', value: 40 },
      { label: '破锐', value: 10 },
      { label: '定鼎', value: 50 },
    ]);
    expect(total).toBe(115);
  });

  it('multiplies the total by 1.25 under 天命五重, floor and all', () => {
    const { total, breakdown } = computeScore(scoredRun(), false, 5);
    // 115 × 1.25 = 143.75 → 143，零头舍去；加成单独成行，明细的和 === 总分。
    expect(total).toBe(143);
    expect(breakdown.at(-1)).toEqual({ label: '天命', value: 28 });
    expect(breakdown.reduce((sum, line) => sum + line.value, 0)).toBe(total);
  });

  it('pays 博采 100 only when no two cards share a defId', () => {
    const run = scoredRun();
    run.deck = ['pikan', 'tiebi', 'tuodao', 'tuzhen', 'luema'].map((id) => newDeckCard(id));
    const { total, breakdown } = computeScore(run, false);
    expect(breakdown).toContainEqual({ label: '博采', value: 100 });
    expect(total).toBe(215);
    // 天命五重叠上去：215 × 1.25 = 268.75 → 268。
    expect(computeScore(run, false, 5).total).toBe(268);
  });

  it('books 专精 25 per defId that reaches four copies', () => {
    const run = scoredRun();
    run.deck = [...Array.from({ length: 4 }, () => newDeckCard('pikan')), newDeckCard('tiebi')];
    expect(computeScore(run, false).breakdown).toContainEqual({ label: '专精', value: 25 });

    // 关羽起手 5×劈砍 + 4×铁壁 —— 两笔。
    const starter = startRun(DEFAULT_HERO, 'history-mastery');
    expect(computeScore(starter, false).breakdown).toContainEqual({ label: '专精', value: 50 });
  });

  it('books 全甲 and 秋毫无犯 per flawless fight', () => {
    const run = scoredRun();
    run.stats.flawlessElites = 1;
    run.stats.flawlessBosses = 1;
    const { breakdown } = computeScore(run, false);
    expect(breakdown).toContainEqual({ label: '全甲', value: 25 });
    expect(breakdown).toContainEqual({ label: '秋毫无犯', value: 50 });
  });

  it('pays the 通关限定 lines on a victory and never on a loss', () => {
    const run = scoredRun();
    run.relics = [];
    addCurse(run, 'tannian');
    addCurse(run, 'jiushang');
    addCurse(run, 'yixin');

    // 8 张 ≤ 15 精兵，0 宝物布衣，3 诅咒负重。
    const won = computeScore(run, true).breakdown;
    expect(won).toContainEqual({ label: '精兵', value: 30 });
    expect(won).toContainEqual({ label: '布衣', value: 60 });
    expect(won).toContainEqual({ label: '负重', value: 40 });

    const lost = computeScore(run, false).breakdown.map((line) => line.label);
    expect(lost).not.toContain('精兵');
    expect(lost).not.toContain('布衣');
    expect(lost).not.toContain('负重');
  });

  it('pays 众志 for a forty-card victory deck', () => {
    const run = scoredRun();
    run.deck = Array.from({ length: 40 }, () => newDeckCard('pikan'));
    expect(computeScore(run, true).breakdown).toContainEqual({ label: '众志', value: 30 });
    expect(computeScore(run, false).breakdown.map((l) => l.label)).not.toContain('众志');
  });

  it('lists only the lines that scored', () => {
    const run = startRun(DEFAULT_HERO, 'history-empty');
    run.deck = [newDeckCard('pikan'), newDeckCard('pikan')];
    // 什么都没干的一局：没有一行 0 分的空行，总分就是 0。
    expect(computeScore(run, false)).toEqual({ total: 0, breakdown: [] });
  });
});

// ------------------------------------------------------------------- 账本

function rec(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'r0',
    endedAt: 0,
    durationMs: 0,
    heroId: 'guanyu',
    ascension: 0,
    victory: false,
    killedBy: '华雄',
    floor: 12,
    act: 1,
    score: 100,
    scoreBreakdown: [],
    deck: [{ defId: 'pikan', upgraded: 0 }],
    relics: ['qinglongdao'],
    stats: emptyRunStats(),
    ...over,
  };
}

describe('recordRun / getCareer', () => {
  it('opens on a blank page when nothing has been recorded', () => {
    withStorage();
    expect(getCareer()).toEqual(emptyCareer());
  });

  it('accumulates the totals across runs and reads them back from storage', () => {
    withStorage();
    recordRun(rec({ id: 'r0', durationMs: 1000, score: 100 }));
    recordRun(
      rec({
        id: 'r1',
        heroId: 'zhaoyun',
        victory: true,
        killedBy: null,
        durationMs: 2500,
        score: 300,
        deck: [
          { defId: 'pikan', upgraded: 1 },
          { defId: 'tuzhen', upgraded: 0 },
        ],
        relics: ['yajiaoqiang', 'yaonang'],
      }),
    );

    // 每次 getCareer 都是从 storage 重新读回来的，不是内存里的旧引用。
    const career = getCareer();
    expect(career.records.map((r) => r.id)).toEqual(['r1', 'r0']);
    expect(career.totals.runs).toBe(2);
    expect(career.totals.victories).toBe(1);
    expect(career.totals.totalPlayMs).toBe(3500);
    expect(career.totals.highScore).toEqual({ guanyu: 100, zhaoyun: 300 });
    expect(career.totals.deathsBy).toEqual({ 华雄: 1 });
    expect(career.totals.cardsTaken).toEqual({ pikan: 2, tuzhen: 1 });
    expect(career.totals.relicsTaken).toEqual({ qinglongdao: 1, yajiaoqiang: 1, yaonang: 1 });
  });

  it('keeps the high score per hero and never lowers it', () => {
    withStorage();
    recordRun(rec({ id: 'a', score: 200 }));
    recordRun(rec({ id: 'b', score: 150 }));
    expect(getCareer().totals.highScore.guanyu).toBe(200);
  });

  it('does not book a death for a victory, whatever killedBy says', () => {
    withStorage();
    recordRun(rec({ victory: true, killedBy: '华雄' }));
    expect(getCareer().totals.deathsBy).toEqual({});
  });

  it('keeps only the newest 50 records but every run in the totals', () => {
    withStorage();
    for (let i = 0; i < 55; i++) recordRun(rec({ id: `r${i}` }));
    const career = getCareer();
    expect(career.records).toHaveLength(CAREER_RECORD_LIMIT);
    expect(career.records[0].id).toBe('r54');
    expect(career.records.at(-1)!.id).toBe('r5');
    // 被挤出列表的旧局不从总账里消失。
    expect(career.totals.runs).toBe(55);
  });

  it('leaves the 08 save slot alone — two keys, two books', () => {
    const fake = withStorage();
    fake.setItem('sangota.save.v1', '{"version":2}');
    recordRun(rec());
    expect(fake.getItem('sangota.save.v1')).toBe('{"version":2}');
    expect(fake.getItem('sangota.career.v1')).not.toBeNull();
  });

  it('starts over on a payload it cannot read or a version it does not know', () => {
    const fake = withStorage();
    fake.setItem('sangota.career.v1', 'not json');
    expect(getCareer()).toEqual(emptyCareer());

    fake.setItem('sangota.career.v1', JSON.stringify({ version: CAREER_VERSION + 1 }));
    expect(getCareer()).toEqual(emptyCareer());
  });

  it('shrugs when localStorage is absent or hostile', () => {
    // Node 的默认情形：根本没有 localStorage。
    expect(getCareer()).toEqual(emptyCareer());
    expect(() => recordRun(rec())).not.toThrow();

    // 锁死的浏览器：每次访问都抛。
    const fake = withStorage();
    fake.hostile = true;
    expect(getCareer()).toEqual(emptyCareer());
    expect(() => recordRun(rec())).not.toThrow();
  });
});

// ------------------------------------------------------------------- 收官

/** 一份平平无奇的终局信息，逐测试按需覆盖。 */
function endInfo(over: Partial<RunEndInfo> = {}): RunEndInfo {
  return { victory: false, killedBy: '华雄', endedAt: 0, durationMs: 0, ...over };
}

describe('settleRun (todos/22 s4)', () => {
  it('books the record with the computed score and syncs the totals', () => {
    withStorage();
    const run = scoredRun();
    const { record, newRecord } = settleRun(
      run,
      endInfo({ killedBy: '华雄', endedAt: 42, durationMs: 1234 }),
    );

    // 验收标准那一局：115 分，明细与 computeScore 同一份。
    expect(record.score).toBe(115);
    expect(record.scoreBreakdown).toEqual(computeScore(run, false).breakdown);
    expect(record.heroId).toBe(DEFAULT_HERO.id);
    expect(record.id).toBe(run.map.seed);
    expect(record.floor).toBe(15);
    expect(record.act).toBe(1);
    expect(record.killedBy).toBe('华雄');
    expect(record.endedAt).toBe(42);
    expect(record.durationMs).toBe(1234);
    expect(record.deck).toEqual(run.deck.map((c) => ({ defId: c.defId, upgraded: c.upgraded })));
    expect(record.relics).toEqual(run.relics);
    expect(newRecord).toBe(true);

    // Career.totals 同步入账，读回来的是存储里的那份。
    const career = getCareer();
    expect(career.records.map((r) => r.id)).toEqual([run.map.seed]);
    expect(career.totals.runs).toBe(1);
    expect(career.totals.totalPlayMs).toBe(1234);
    expect(career.totals.highScore[DEFAULT_HERO.id]).toBe(115);
    expect(career.totals.deathsBy).toEqual({ 华雄: 1 });
  });

  it('stamps maxHpAtEnd and stores a snapshot, not a live reference', () => {
    withStorage();
    const run = scoredRun();
    run.maxHp = 77;
    const { record } = settleRun(run, endInfo());
    expect(run.stats.maxHpAtEnd).toBe(77);
    expect(record.stats.maxHpAtEnd).toBe(77);

    // 入史之后账本再动，记录不许跟着动。
    run.stats.enemiesSlain = 999;
    run.stats.route.push({ act: 1, row: 0, type: 'monster' });
    expect(record.stats.enemiesSlain).toBe(20);
    expect(record.stats.route).toEqual([]);
  });

  it('never blames anyone for a victory, whatever the scene handed over', () => {
    withStorage();
    const { record } = settleRun(scoredRun(), endInfo({ victory: true, killedBy: '华雄' }));
    expect(record.victory).toBe(true);
    expect(record.killedBy).toBeNull();
    expect(getCareer().totals.deathsBy).toEqual({});
  });

  it('calls 新纪录 only on a score that beats the standing one, and never on 0', () => {
    withStorage();
    // 0 分不称纪录——白卷面前它也不是。
    const zero = startRun(DEFAULT_HERO, 'settle-zero');
    zero.deck = [newDeckCard('pikan'), newDeckCard('pikan')];
    expect(settleRun(zero, endInfo()).newRecord).toBe(false);

    expect(settleRun(scoredRun(), endInfo()).newRecord).toBe(true); // 115 > 0
    expect(settleRun(scoredRun(), endInfo()).newRecord).toBe(false); // 115 平旧账

    const better = scoredRun();
    better.stats.floorsClimbed = 16;
    expect(settleRun(better, endInfo()).newRecord).toBe(true); // 116 > 115
  });
});

describe('本局用时的刻度', () => {
  it('reads 0 before any mark is set', () => {
    expect(runElapsed(500)).toBe(0);
  });

  it('reads the difference from the mark, clamped at 0, and re-marks cleanly', () => {
    markRunStart(1000);
    expect(runElapsed(4500)).toBe(3500);
    // 钟往回走不欠账。
    expect(runElapsed(400)).toBe(0);
    markRunStart(8000);
    expect(runElapsed(8250)).toBe(250);
  });
});
