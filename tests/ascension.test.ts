import { afterEach, describe, expect, it } from 'vitest';
import { getCard } from '../src/combat/cards';
import { CURSE_POOL } from '../src/combat/curses';
import { encounterTierOf, getEncounter, getEnemy, type CombatTier } from '../src/combat/enemies';
import { endPlayerTurn, runEnemyTurn, startCombat } from '../src/combat/engine';
import { intentLabel, intentOf } from '../src/combat/intent';
import { Rng } from '../src/core/rng';
import {
  ASCENSION_STEPS,
  DEFAULT_MODS,
  MAX_ASCENSION,
  SUYE_ID,
  modsFor,
  type AscensionMods,
} from '../src/data/ascension';
import { DEFAULT_HERO } from '../src/data/heroes';
import { applyPick } from '../src/rooms/events';
import {
  ASCENSION_PROGRESS_VERSION,
  clearedAscension,
  emptyProgress,
  getAscensionProgress,
  maxSelectableAscension,
  recordAscensionClear,
} from '../src/state/ascension';
import { settleRun, type RunEndInfo } from '../src/state/history';
import {
  isRemovable,
  newDeckCard,
  removableCount,
  removeDisabledReason,
  startRun,
  syncPotionSlots,
  type RunState,
} from '../src/state/run';
import { clearSave, fromSaved, restoreCombat, snapshotCombat, toSaved } from '../src/state/save';

/**
 * 天命 (todos/19 a1) — 集中修饰器本身的账。
 *
 * 接线点（地图、引擎、营帐……）各有各的条目和各自的测试；这里只管
 * `modsFor` 的合并语义——**累积不替换、倍率相乘不覆盖**——那是 todo
 * 点名最容易写错的地方，也是十重难度对不对的全部根基。
 *
 * a2 补引擎接线的账（下面「引擎接线」一节）：hpMult / damageMult / intentOf。
 * 地图的 extraElites 在 `tests/generateMap.test.ts`，挨着它要守的那些规则。
 */

describe('modsFor', () => {
  it('零重就是 DEFAULT_MODS 本尊，不是一份长得像的拷贝', () => {
    // 同一个对象：天命零重的每一局共享它，所以它是冻结的（下一条）。
    expect(modsFor(0)).toBe(DEFAULT_MODS);
  });

  it('交出去的 mods 是深冻结的——run.mods 全程只读靠的就是这个', () => {
    expect(Object.isFrozen(DEFAULT_MODS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MODS.startingCurses)).toBe(true);
    const nine = modsFor(9);
    expect(Object.isFrozen(nine)).toBe(true);
    expect(Object.isFrozen(nine.damageMult)).toBe(true);
  });

  it('一重只加一间精英房，其余原样', () => {
    const one = modsFor(1);
    expect(one.extraElites).toBe(1);
    expect(one.hpMult).toEqual(DEFAULT_MODS.hpMult);
    expect(one.damageMult).toEqual(DEFAULT_MODS.damageMult);
    expect(one.restHealPercent).toBe(30);
  });

  it('修改累积：九重同时带着 1..9 的全部效果', () => {
    // 验收标准原文：「天命九重同时有 2/3/4/7/8/9 的全部效果」。
    // 数值是 a6 标定后的（见 `sim/balance.sim.ts` 天命连场一节），
    // 不是设计稿抄原版的初值——那套增量把十重通关率量成 0%。
    const nine = modsFor(9);
    expect(nine.extraElites).toBe(1); // 一重
    expect(nine.hpMult.monster).toBeCloseTo(1.05, 10); // 二重
    expect(nine.hpMult.elite).toBeCloseTo(1.05 * 1.02, 10); // 三重 × 八重
    expect(nine.hpMult.boss).toBeCloseTo(1.05 * 1.02, 10); // 四重 × 九重
    expect(nine.restHealPercent).toBe(25); // 五重
    expect(nine.actStartHpLossPercent).toBe(10); // 六重
    expect(nine.damageMult.monster).toBeCloseTo(1.05, 10); // 七重
    expect(nine.damageMult.elite).toBeCloseTo(1.05, 10); // 三重
    expect(nine.damageMult.boss).toBeCloseTo(1, 10); // 标定后首领只涨体力
  });

  it('倍率相乘而不是覆盖——todo 点名最容易写错的地方', () => {
    // 三重给精英体力 ×1.05，八重再 ×1.02：正确是 1.071；写成覆盖会得 1.02。
    expect(modsFor(8).hpMult.elite).toBeCloseTo(1.05 * 1.02, 10);
    expect(modsFor(8).hpMult.elite).not.toBe(1.02);
    // 取值类则相反，是覆盖：五重把营帐回血从 30 改成 25，不是 30×0.25。
    expect(modsFor(5).restHealPercent).toBe(25);
  });

  it('十重拼上「宿业」，九重还没有', () => {
    expect(modsFor(9).startingCurses).toEqual([]);
    expect(modsFor(10).startingCurses).toEqual(['suye']);
  });

  it('超出已做的十重按十重算——后十重的行落进表里之前就是没有', () => {
    expect(modsFor(15)).toEqual(modsFor(10));
    expect(ASCENSION_STEPS[11]).toBeUndefined();
  });
});

describe('引擎接线 (a2)：hpMult / damageMult / intentOf', () => {
  /**
   * e1 = 关下骁将 · 华雄——验收标准点名的那一场。数字全部写死为字面量，
   * 和 `tests/intent.test.ts` 一个纪律：照实现的算法抄一遍期望值，等于没测。
   */
  const fight = (mods?: AscensionMods, tier?: CombatTier, encounterId = 'e1') =>
    startCombat({
      encounter: getEncounter(encounterId),
      deck: Array.from({ length: 10 }, () => newDeckCard('pikan')),
      heroName: DEFAULT_HERO.name,
      hp: 80,
      maxHp: 80,
      relics: [],
      seed: 'asc-a2',
      tier,
      mods,
    });

  /** Force a named move onto the enemy, so one table row can be isolated. */
  const telegraph = (state: ReturnType<typeof fight>, moveId: string) => {
    const enemy = state.enemies[0];
    const move = getEnemy(enemy.defId).moves.find((m) => m.id === moveId);
    if (!move) throw new Error(`no move ${moveId} on ${enemy.defId}`);
    enemy.intent = move;
    return enemy;
  };

  it('三重精英档：华雄 HP 是基础的 1.05 倍——先掷区间再乘，骰数不变', () => {
    // 同一个 seed 掷出同一个基础值，倍率是乘在那次掷骰之后的。
    const base = fight().enemies[0];
    const three = fight(modsFor(3), 'elite').enemies[0];
    expect(three.maxHp).toBe(Math.round(base.maxHp * 1.05));
    expect(three.hp).toBe(three.maxHp);
  });

  it('倍率按 tier 取档：三重不动首领档，缺省档按杂兵算', () => {
    const base = fight().enemies[0];
    // 三重的 boss 档倍率还是 1（四重才动它）——同 mods 换个档位，一滴血不多。
    expect(fight(modsFor(3), 'boss').enemies[0].maxHp).toBe(base.maxHp);
    // 不传 tier 按杂兵档：三重杂兵 HP ×1.05（来自二重的累积）。
    expect(fight(modsFor(3)).enemies[0].maxHp).toBe(Math.round(base.maxHp * 1.05));
  });

  it('零重（不传 mods 或传 DEFAULT_MODS）一切恒等——37 个黄金快照锁的就是这格', () => {
    const plain = fight();
    const zero = fight(DEFAULT_MODS, 'elite');
    expect(zero.enemies[0].maxHp).toBe(plain.enemies[0].maxHp);
    expect(zero.enemyHpMult).toBe(1);
    expect(zero.enemyDamageMult).toBe(1);
    const enemy = telegraph(plain, 'cleave');
    expect(intentOf(plain, enemy)!.damage).toBe(15); // 表上的原值
  });

  it('三重下伤害 1.05 倍，意图数字正确反映、且等于真挨的那一下', () => {
    const state = fight(modsFor(3), 'elite');
    const enemy = telegraph(state, 'cleave');

    // 巨斧 15 × 1.05 = 15.75 → 16。徽章、文字标记、真实掉血三处一个数。
    const shown = intentOf(state, enemy)!;
    expect(shown.damage).toBe(16);
    expect(intentLabel(state, enemy)).toBe('攻 16');

    const before = state.player.hp;
    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(before - state.player.hp).toBe(16);
  });

  it('中途召来的身体同样吃 hpMult——同一场仗只有一个档位', () => {
    // e3 = 神上使 · 张曼成，聚众召两名黄巾力士。倍率不改骰数，两场同 seed
    // 的随机流一步不差，召出来的基础值因此可以逐个对着乘。
    const summon = (mods?: AscensionMods, tier?: CombatTier) => {
      const state = fight(mods, tier, 'e3');
      telegraph(state, 'muster');
      endPlayerTurn(state);
      runEnemyTurn(state);
      return state;
    };
    const base = summon();
    const three = summon(modsFor(3), 'elite');
    expect(base.enemies.length).toBe(3);
    expect(three.enemies.length).toBe(3);
    for (let i = 1; i < 3; i++) {
      expect(three.enemies[i].maxHp).toBe(Math.round(base.enemies[i].maxHp * 1.05));
    }
  });

  it('存档恢复按 tier × 天命重导两个倍率 (S2)，不传 mods 恒等', () => {
    const state = fight(modsFor(3), 'elite');
    const saved = snapshotCombat(state, {
      tier: 'elite',
      ledgerId: null,
      bonusRelic: null,
      theftSeq: 0,
      fightDamageTaken: 0,
    });
    const back = restoreCombat(saved, modsFor(3));
    expect(back.enemyHpMult).toBeCloseTo(1.05, 10);
    expect(back.enemyDamageMult).toBeCloseTo(1.05, 10);
    // 旧调用形态（只给档）按零重算——既有测试与旧档一个不惊动。
    expect(restoreCombat(saved).enemyHpMult).toBe(1);
    expect(restoreCombat(saved).enemyDamageMult).toBe(1);
  });

  it('encounterTierOf：无头模拟反查档位的那把尺', () => {
    expect(encounterTierOf('e1')).toBe('elite');
    expect(encounterTierOf('b1')).toBe('boss');
    expect(encounterTierOf('m1')).toBe('monster');
    expect(encounterTierOf('m7')).toBe('monster'); // strong 表也是杂兵档
    expect(() => encounterTierOf('no-such-id')).toThrow();
  });
});

describe('RunState 接入', () => {
  it('默认零重：既有调用点一个不改，mods 就是 DEFAULT_MODS', () => {
    const run = startRun(DEFAULT_HERO, 'asc-zero');
    expect(run.ascension).toBe(0);
    expect(run.mods).toBe(DEFAULT_MODS);
  });

  it('开局算好，等级和修饰器一次到位', () => {
    const run = startRun(DEFAULT_HERO, 'asc-nine', 9);
    expect(run.ascension).toBe(9);
    expect(run.mods).toEqual(modsFor(9));
  });
});

describe('跑团接线 (a3)：startRun / syncPotionSlots', () => {
  // 营帐 / advanceAct / 奖励 / 商价的接线各自的测试挨着各自的房间：
  // `tests/rooms.campfire.test.ts`、`tests/acts.test.ts`、`tests/rewards.test.ts`、
  // `tests/rooms.shop.test.ts`。这里只管 `startRun` 一次到位的三样。

  it('一到十重不动上限、槽位、牌组张数——接线在，DEFAULT 值下恒等', () => {
    // 十重本尊要等宿业的卡面 (a4)，这里用九重锁「接了线也不多扣一滴」。
    const run = startRun(DEFAULT_HERO, 'asc-a3-idem', 9);
    expect(run.maxHp).toBe(82);
    expect(run.hp).toBe(82);
    expect(run.potionSlots).toBe(3);
    expect(run.deck).toHaveLength(DEFAULT_HERO.startingDeck.length);
  });

  it('maxHpMult / potionSlots 从 mods 读——后十级落地只改数据不改代码', () => {
    // 十四重 (-5% 上限) 和十一重 (槽 3 → 2) 都还没落表；临时把数值挂上第
    // 9 行验证接线本身，用完复原。正式落地那天动的就只是 `ASCENSION_STEPS`。
    const nine = ASCENSION_STEPS[9];
    ASCENSION_STEPS[9] = { ...nine, maxHpMult: 0.95, potionSlots: 2 };
    try {
      const run = startRun(DEFAULT_HERO, 'asc-a3-mult', 9);
      expect(run.maxHp).toBe(78); // round(82 × 0.95)，遗物加成乘在里面
      expect(run.hp).toBe(78);
      expect(run.potionSlots).toBe(2);
      expect(run.potions).toHaveLength(2);
    } finally {
      ASCENSION_STEPS[9] = nine;
    }
  });

  it('syncPotionSlots 的基础槽位是 run.mods 的，遗物加成照旧叠上去', () => {
    const run = startRun(DEFAULT_HERO, 'asc-a3-slots', 9);
    run.mods = { ...modsFor(9), potionSlots: 2 };
    syncPotionSlots(run);
    expect(run.potionSlots).toBe(2);
    expect(run.potions).toHaveLength(2);
  });

  it('startingCurses 逐张入组——宿业 (a4) 落卡面前借现有诅咒「贪念」验证', () => {
    const ten = ASCENSION_STEPS[10];
    ASCENSION_STEPS[10] = { startingCurses: ['tannian'] };
    try {
      const run = startRun(DEFAULT_HERO, 'asc-a3-curse', 10);
      expect(run.deck.filter((c) => c.defId === 'tannian')).toHaveLength(1);
      expect(run.deck).toHaveLength(DEFAULT_HERO.startingDeck.length + 1);
    } finally {
      ASCENSION_STEPS[10] = ten;
    }
    // 正牌 id 由常量占住：a4 的卡表引用 `SUYE_ID`，接线点一行不用改。
    expect(modsFor(10).startingCurses).toEqual([SUYE_ID]);
  });
});

describe('诅咒「宿业」与不可移除的门 (a4)', () => {
  it('卡面：咒、不可打出、虚无、removable: false——且绝不进 CURSE_POOL', () => {
    const def = getCard(SUYE_ID);
    expect(def.type).toBe('curse');
    expect(def.keywords).toContain('unplayable');
    expect(def.keywords).toContain('ethereal');
    expect(def.removable).toBe(false);
    // 无 upgrade 键即不可精进——`canUpgrade` 的既有闸门，诅咒一律如此。
    expect(def.upgrade).toBeUndefined();
    // CURSE_POOL 的每个 id 都必须可解；宿业只从十重的开局来。
    expect(CURSE_POOL).not.toContain(SUYE_ID);
    for (const id of CURSE_POOL) expect(getCard(id).removable).toBeUndefined();
  });

  it('十重开局牌组含一张宿业——与 a3 的 startingCurses 接线联测', () => {
    const run = startRun(DEFAULT_HERO, 'asc-a4-deck', 10);
    expect(run.deck.filter((c) => c.defId === SUYE_ID)).toHaveLength(1);
    expect(run.deck).toHaveLength(DEFAULT_HERO.startingDeck.length + 1);
    // 九重整副干净——诅咒是十重那一行独有的追加。
    const nine = startRun(DEFAULT_HERO, 'asc-a4-nine', 9);
    expect(nine.deck.some((c) => c.defId === SUYE_ID)).toBe(false);
  });

  it('弃卡网格里不可选：removeDisabledReason 压暗它，其余的牌照旧', () => {
    const run = startRun(DEFAULT_HERO, 'asc-a4-grid', 10);
    const suye = run.deck.find((c) => c.defId === SUYE_ID)!;
    expect(isRemovable(suye)).toBe(false);
    expect(removeDisabledReason(suye)).toBe('不可移除');
    for (const card of run.deck.filter((c) => c.defId !== SUYE_ID)) {
      expect(removeDisabledReason(card)).toBeNull();
    }
  });

  it('removableCount 以可移除的张数封顶——MIN_DECK_SIZE 之外的第二把尺', () => {
    const run = startRun(DEFAULT_HERO, 'asc-a4-count');
    // 六张里五张宿业：地板（6 − 4 = 2）还容两张，可移除的却只有一张。
    run.deck = [...Array.from({ length: 5 }, () => newDeckCard(SUYE_ID)), newDeckCard('pikan')];
    expect(removableCount(run)).toBe(1);
    // 整副不可移除：一张也弃不得，无论比地板厚多少。
    run.deck = Array.from({ length: 6 }, () => newDeckCard(SUYE_ID));
    expect(removableCount(run)).toBe(0);
  });

  it('applyPick 的弃与易都拒收宿业——绕过网格也过不去的那道门', () => {
    const run = startRun(DEFAULT_HERO, 'asc-a4-pick', 10);
    const suye = run.deck.find((c) => c.defId === SUYE_ID)!;
    const size = run.deck.length;

    // 弃（五丈原 / 祝福的弃芜走的同一实现）：牌还在，一张不少。
    applyPick(run, { kind: 'remove', count: 1 }, [suye.uid]);
    expect(run.deck.some((c) => c.uid === suye.uid)).toBe(true);
    expect(run.deck).toHaveLength(size);

    // 易（易牌也是「从牌组移除」）：既不移除，也不补新牌。
    applyPick(run, { kind: 'transform', count: 1 }, [suye.uid], new Rng('asc-a4-rng'));
    expect(run.deck.some((c) => c.uid === suye.uid)).toBe(true);
    expect(run.deck).toHaveLength(size);

    // 同一道门对可移除的牌照常放行。
    const other = run.deck.find((c) => c.defId !== SUYE_ID)!;
    applyPick(run, { kind: 'remove', count: 1 }, [other.uid]);
    expect(run.deck.some((c) => c.uid === other.uid)).toBe(false);
    expect(run.deck).toHaveLength(size - 1);
  });
});

describe('存档往返', () => {
  /** 和 save.test.ts 的 `reload` 同款：走 JSON，不走引用。 */
  const reload = (run: RunState): RunState =>
    fromSaved(JSON.parse(JSON.stringify(toSaved(run, null))));

  it('天命等级往返，mods 按 S2 重导而不入档', () => {
    const run = startRun(DEFAULT_HERO, 'asc-save', 5);
    const saved = toSaved(run, null);
    expect(saved.ascension).toBe(5);
    // mods 是 `modsFor(ascension)` 的纯函数结果，存一份就是第二事实源。
    expect(saved).not.toHaveProperty('mods');

    const back = reload(run);
    expect(back.ascension).toBe(5);
    expect(back.mods).toEqual(modsFor(5));
    expect(back).toEqual(run);
  });

  it('零重的档回来还是零重', () => {
    const back = reload(startRun(DEFAULT_HERO, 'asc-save-zero'));
    expect(back.ascension).toBe(0);
    expect(back.mods).toBe(DEFAULT_MODS);
  });
});

// --------------------------------------------------------------- 假 storage
// `history.test.ts` 的同款：真的在 Node 下不存在，而「不存在」本身也是被测
// 的情形之一。

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

describe('天命进度持久化 (a5)', () => {
  afterEach(dropStorage);

  it('白卷：没打过的武将 cleared 0，最高只能选一重', () => {
    withStorage();
    expect(getAscensionProgress()).toEqual(emptyProgress());
    expect(clearedAscension('guanyu')).toBe(0);
    expect(maxSelectableAscension('guanyu')).toBe(1);
  });

  it('通关入账只升不降、按武将分账，写进 storage 读得回来', () => {
    withStorage();
    recordAscensionClear('guanyu', 3);
    recordAscensionClear('guanyu', 2); // 低重数的重温不抹高重数的功劳。
    recordAscensionClear('zhaoyun', 1);
    expect(clearedAscension('guanyu')).toBe(3);
    expect(clearedAscension('zhaoyun')).toBe(1);
    // 选将界面的那道门：只能选到 cleared + 1。
    expect(maxSelectableAscension('guanyu')).toBe(4);
    expect(maxSelectableAscension('zhaoyun')).toBe(2);
  });

  it('上限封顶 MAX_ASCENSION——通关十重也开不出十一重', () => {
    withStorage();
    recordAscensionClear('guanyu', MAX_ASCENSION);
    expect(maxSelectableAscension('guanyu')).toBe(MAX_ASCENSION);
  });

  it('零重通关不留一行 0 的空账', () => {
    const fake = withStorage();
    recordAscensionClear('guanyu', 0);
    expect(fake.getItem('sangota.ascension.v1')).toBeNull();
  });

  it('清跑团档动不了难度进度——两把钥匙，两本账', () => {
    const fake = withStorage();
    fake.setItem('sangota.save.v1', '{"version":3}');
    recordAscensionClear('guanyu', 5);
    clearSave();
    expect(fake.getItem('sangota.save.v1')).toBeNull();
    expect(clearedAscension('guanyu')).toBe(5);
  });

  it('读不懂或版本不合：白卷重来，不抛不报——进度丢了游戏照打', () => {
    const fake = withStorage();
    fake.setItem('sangota.ascension.v1', 'not json');
    expect(getAscensionProgress()).toEqual(emptyProgress());

    fake.setItem(
      'sangota.ascension.v1',
      JSON.stringify({ version: ASCENSION_PROGRESS_VERSION + 1, cleared: { guanyu: 9 } }),
    );
    expect(clearedAscension('guanyu')).toBe(0);
  });

  it('storage 缺席或敌意时不抛、当白卷', () => {
    // Node 的默认情形：根本没有 localStorage。
    expect(getAscensionProgress()).toEqual(emptyProgress());
    expect(() => recordAscensionClear('guanyu', 3)).not.toThrow();

    // 锁死的浏览器：每次访问都抛。
    const fake = withStorage();
    fake.hostile = true;
    expect(getAscensionProgress()).toEqual(emptyProgress());
    expect(() => recordAscensionClear('guanyu', 3)).not.toThrow();
  });
});

describe('通关入账 (a5)：settleRun 的天命接线', () => {
  afterEach(dropStorage);

  const endInfo = (victory: boolean): RunEndInfo => ({
    victory,
    killedBy: victory ? null : '华雄',
    endedAt: 0,
    durationMs: 0,
  });

  it('胜利把 cleared 提到本局天命，记录与评分吃的都是真值', () => {
    withStorage();
    const run = startRun(DEFAULT_HERO, 'asc-a5-win', 5);
    const { record } = settleRun(run, endInfo(true));

    expect(record.ascension).toBe(5);
    // 关羽起手局：专精 50（5×劈砍 + 4×铁壁）+ 精兵 30（9 张 ≤ 15），
    // 80 × 1.25 = 100——computeScore 吃到的是真实的五重，加成单独成行。
    expect(record.score).toBe(100);
    expect(record.scoreBreakdown.at(-1)).toEqual({ label: '天命', value: 20 });

    expect(clearedAscension(DEFAULT_HERO.id)).toBe(5);
    // 验收标准的那扇门：通关五重后能选六重。
    expect(maxSelectableAscension(DEFAULT_HERO.id)).toBe(6);
  });

  it('败局不入账，低重数的胜利也不降账', () => {
    withStorage();
    recordAscensionClear(DEFAULT_HERO.id, 4);

    const lost = startRun(DEFAULT_HERO, 'asc-a5-loss', 5);
    // 记录照记五重（战史的天命列有数），进度不动——败局没有「通关」可言。
    expect(settleRun(lost, endInfo(false)).record.ascension).toBe(5);
    expect(clearedAscension(DEFAULT_HERO.id)).toBe(4);

    const low = startRun(DEFAULT_HERO, 'asc-a5-low', 2);
    settleRun(low, endInfo(true));
    expect(clearedAscension(DEFAULT_HERO.id)).toBe(4);
  });
});
