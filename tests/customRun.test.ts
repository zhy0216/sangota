import { afterEach, describe, expect, it } from 'vitest';
import { COLORLESS_POOL, getCard, poolFor } from '../src/combat/cards';
import { CURSE_POOL } from '../src/combat/curses';
import { DEFAULT_HERO } from '../src/data/heroes';
import mainSource from '../src/main.ts?raw';
import combatSceneSource from '../src/scenes/CombatScene.ts?raw';
import customSceneSource from '../src/scenes/CustomScene.ts?raw';
import mapSceneSource from '../src/scenes/MapScene.ts?raw';
import summarySceneSource from '../src/scenes/SummaryScene.ts?raw';
import { clearedAscension } from '../src/state/ascension';
import { normaliseSeed, startCustomRun, type CustomRunConfig } from '../src/state/customRun';
import { getCareer, settleRun } from '../src/state/history';
import { startRun, type RunState } from '../src/state/run';
import { fromSaved, toSaved, type SavedRun } from '../src/state/save';
import { emptyUnlocks, getUnlocks } from '../src/state/unlocks';

/**
 * 自定义模式 — todos/23 u5：不计分不解锁的一局。
 *
 * 三件事各有一节：`startCustomRun` 的确定性与 modifier（同 seed 同配置两局
 * 逐字一致）、三本账的门（自定义局过 `settleRun` 后 Career / unlocks /
 * ascension 一本不动）、以及存档与场景的接线（`custom` 随档往返，HUD 常驻
 * 「自定义 · 不计分」，结算页印种子配复制）。假 storage 沿用
 * `unlocks.test.ts` 的那只。
 */

// --------------------------------------------------------------- 假 storage

class FakeStorage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
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

// ------------------------------------------------------------------- 配置

const config = (over: Partial<CustomRunConfig> = {}): CustomRunConfig => ({
  seed: 'custom-test',
  ascension: 0,
  modifiers: {},
  ...over,
});

/** 地图的指纹——integrity.test.ts 的同款投影。 */
const shape = (run: RunState): string =>
  [...run.map.nodes.values()].map((n) => `${n.id}:${n.type}:${n.x.toFixed(4)}`).join('|');

// -------------------------------------------------------------- 开局与种子

describe('startCustomRun', () => {
  it('stamps the run custom and feeds the seed through untouched', () => {
    const run = startCustomRun(DEFAULT_HERO, config({ seed: 'abc-123' }));
    expect(run.custom).toBe(true);
    expect(run.map.seed).toBe('abc-123');
    // 普通局的章是 false——既有的每一条路都不受影响。
    expect(startRun(DEFAULT_HERO, 'abc-123').custom).toBe(false);
  });

  it('deals the very map and deck twice from one seed and one config', () => {
    const cfg = config({ ascension: 3, modifiers: { startWithAllCards: true, allCurses: true } });
    const a = startCustomRun(DEFAULT_HERO, cfg);
    const first = { shape: shape(a), deck: JSON.stringify(a.deck) };
    const b = startCustomRun(DEFAULT_HERO, cfg);
    expect(shape(b)).toBe(first.shape);
    expect(JSON.stringify(b.deck)).toBe(first.deck);
  });

  it('builds the same map a plain run of that seed gets — the seed is shareable', () => {
    expect(shape(startCustomRun(DEFAULT_HERO, config()))).toBe(
      shape(startRun(DEFAULT_HERO, 'custom-test')),
    );
  });

  it('honours the ascension asked for, gate-free', () => {
    const run = startCustomRun(DEFAULT_HERO, config({ ascension: 10 }));
    expect(run.ascension).toBe(10);
    // 十重的开局诅咒照发——mods 是 modsFor 的常规产物,自定义不另起炉灶。
    expect(run.deck.some((c) => c.defId === 'suye')).toBe(true);
  });

  it('十全武库 adds every hero-pool and colorless card exactly once', () => {
    const run = startCustomRun(DEFAULT_HERO, config({ modifiers: { startWithAllCards: true } }));
    const extra = [
      ...poolFor('guanyu', 'common'),
      ...poolFor('guanyu', 'uncommon'),
      ...poolFor('guanyu', 'rare'),
      ...COLORLESS_POOL,
    ];
    expect(run.deck).toHaveLength(DEFAULT_HERO.startingDeck.length + extra.length);
    for (const id of extra) {
      expect(run.deck.filter((c) => c.defId === id)).toHaveLength(1);
    }
  });

  it('业障缠身 straps on every curse in the pool', () => {
    const run = startCustomRun(DEFAULT_HERO, config({ modifiers: { allCurses: true } }));
    expect(run.deck).toHaveLength(DEFAULT_HERO.startingDeck.length + CURSE_POOL.length);
    for (const id of CURSE_POOL) {
      expect(getCard(id).type).toBe('curse');
      expect(run.deck.filter((c) => c.defId === id)).toHaveLength(1);
    }
  });

  it('with every switch off the deck is the plain starting deck', () => {
    const run = startCustomRun(DEFAULT_HERO, config());
    expect(run.deck.map((c) => c.defId)).toEqual(DEFAULT_HERO.startingDeck);
  });
});

describe('normaliseSeed', () => {
  it('trims, and turns blank into null (= random)', () => {
    expect(normaliseSeed(' abc ')).toBe('abc');
    expect(normaliseSeed('')).toBeNull();
    expect(normaliseSeed('   ')).toBeNull();
  });
});

// --------------------------------------------------------------- 三本账的门

describe('自定义局不入账 (u5)', () => {
  /** 一局大胜:普通局会同时推动战史、解锁和天命进度的终局信息。 */
  const bigWin = { victory: true, killedBy: null, endedAt: 0, durationMs: 60_000 } as const;

  it('a victorious high-score custom run writes none of the three ledgers', () => {
    const fake = withStorage();
    const run = startCustomRun(DEFAULT_HERO, config({ ascension: 3 }));
    run.stats.bossesSlain = 4; // 定鼎 4×50——普通局一笔就能跨过 200 的解锁门。
    const { record, newRecord, unlocks } = settleRun(run, { ...bigWin });

    // 分数照算——结算界面还要看——但不称纪录,回执也是白卷。
    expect(record.score).toBeGreaterThanOrEqual(200);
    expect(newRecord).toBe(false);
    expect(unlocks).toEqual({ newCards: [], newRelics: [], newHeroes: [], pendingChoice: null });

    // 三把钥匙一把都没转过。
    for (const key of ['sangota.career.v1', 'sangota.unlocks.v1', 'sangota.ascension.v1']) {
      expect(fake.getItem(key)).toBeNull();
    }
    expect(getCareer().totals.runs).toBe(0);
    expect(getUnlocks()).toEqual(emptyUnlocks());
    expect(clearedAscension('guanyu')).toBe(0);
  });

  it('the same run settled un-custom books all three — the gate is the flag', () => {
    withStorage();
    const run = startCustomRun(DEFAULT_HERO, config({ ascension: 3 }));
    run.stats.bossesSlain = 4;
    run.custom = false; // 对照组:抹掉章,同一局立刻三账全动。
    const { unlocks } = settleRun(run, { ...bigWin });
    expect(getCareer().totals.runs).toBe(1);
    expect(unlocks.newHeroes).toEqual(['zhaoyun']);
    expect(clearedAscension('guanyu')).toBe(3);
  });
});

// ------------------------------------------------------------------- 存档

describe('custom rides the save', () => {
  it('round-trips through toSaved / fromSaved', () => {
    const run = startCustomRun(DEFAULT_HERO, config());
    const saved = JSON.parse(JSON.stringify(toSaved(run, null))) as SavedRun;
    expect(saved.custom).toBe(true);
    expect(fromSaved(saved).custom).toBe(true);
  });

  it('reads a v3 payload without the field as a plain run', () => {
    // SAVE_VERSION 没为它 bump:老档缺字段是 undefined,落成 false 恰好正确。
    const saved = JSON.parse(JSON.stringify(toSaved(startRun(DEFAULT_HERO, 'legacy'), null)));
    delete (saved as Record<string, unknown>).custom;
    expect(fromSaved(saved as SavedRun).custom).toBe(false);
  });
});

// ----------------------------------------------------------------- 场景接线

describe('scene wiring', () => {
  it('CombatScene keeps the 敌卷 tap shut on a custom run', () => {
    // 接线用源码验,`unlocks.test.ts` 同款:场景在 Node 下 import 不动。
    expect(combatSceneSource).toContain(
      'if (!this.run.custom) recordSeenEnemies(this.encounter.enemies)',
    );
  });

  it('the HUD wears 「自定义 · 不计分」 on the map and in the fight', () => {
    expect(mapSceneSource).toContain('自定义 · 不计分');
    expect(combatSceneSource).toContain('自定义 · 不计分');
  });

  it('SummaryScene prints the bare run seed with a silent-failure copy button', () => {
    // 印的必须是 runSeedOf——第二幕的 map.seed 带 :act2 后缀,喂不回 startRun。
    expect(summarySceneSource).toContain('runSeedOf(run)');
    expect(summarySceneSource).toContain('复 制 种 子');
    expect(summarySceneSource).toContain('navigator.clipboard?.writeText');
    expect(summarySceneSource).toContain('自定义 · 不计分');
  });

  it('CustomScene starts the run through startCustomRun and is registered', () => {
    expect(customSceneSource).toContain('startCustomRun(this.picked, config)');
    expect(customSceneSource).toContain("super('Custom')");
    // 出征是单行道,标题页同款闸。
    const body = customSceneSource.slice(customSceneSource.indexOf('private beginRun(): void'));
    const head = body.slice(0, body.indexOf('startCustomRun('));
    expect(head).toContain('if (this.leaving) return');
    expect(head).toContain('this.leaving = true');
    expect(mainSource).toContain('CustomScene');
  });
});
