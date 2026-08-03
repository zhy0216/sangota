import { describe, expect, it } from 'vitest';
import { CARDS, getCard } from '../src/combat/cards';
import { ENEMIES, getEnemy } from '../src/combat/enemies';
import { intentKindOf } from '../src/combat/intent';
import { RELICS, RELIC_TIER_ORDER } from '../src/combat/relics';
import type { CombatState, EnemyState } from '../src/combat/types';
import {
  CARD_RARITY_LABEL,
  INTENT_WORD,
  MOVE_TABLE_HEAD,
  RELIC_TIER_LABEL,
  cardHeroKey,
  compendiumCardIds,
  costBucketOf,
  defaultCardFilter,
  enemyActSections,
  enemyTraitLines,
  filterCardIds,
  hpRangeText,
  moveIntentKind,
  moveRows,
  relicRows,
} from '../src/ui/compendiumView';

/**
 * 典籍 (todos/23 u4) 的排版层。`CompendiumScene.ts` imports Phaser,Node 下
 * 装不进来——所以三卷要印的字全在 `compendiumView.ts` 里拼、在这里钉;
 * 场景与 main.ts 的接线按 `historyView.test.ts` 的技法查源文。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

// ------------------------------------------------------------------- 牌卷

describe('compendium card catalogue and filters', () => {
  it('lists every card the game can name, and every id resolves', () => {
    const ids = compendiumCardIds();
    expect(ids).toEqual(Object.keys(CARDS));
    for (const id of ids) expect(() => getCard(id)).not.toThrow();
  });

  it('files curses and status cards under the negative shelf', () => {
    expect(cardHeroKey(getCard('pikan'))).toBe('guanyu');
    expect(cardHeroKey(getCard('nining'))).toBe('negative');
  });

  it('buckets costs, with X (-1) and 3+ as their own shelves', () => {
    expect(costBucketOf(0)).toBe('0');
    expect(costBucketOf(1)).toBe('1');
    expect(costBucketOf(2)).toBe('2');
    expect(costBucketOf(3)).toBe('3+');
    expect(costBucketOf(5)).toBe('3+');
    expect(costBucketOf(-1)).toBe('X');
  });

  it('filters by hero: 关羽 keeps his own cards and drops 赵云s and the curses', () => {
    const ids = filterCardIds(compendiumCardIds(), { ...defaultCardFilter(), hero: 'guanyu' });
    expect(ids).toContain('pikan');
    expect(ids).not.toContain('tuzhen');
    expect(ids).not.toContain('nining');
    for (const id of ids) expect(getCard(id).hero).toBe('guanyu');
  });

  it('ANDs all four dimensions together', () => {
    const ids = filterCardIds(compendiumCardIds(), {
      hero: 'guanyu',
      type: 'attack',
      cost: '1',
      rarity: 'basic',
    });
    expect(ids).toEqual(['pikan']);
  });

  it('an all-pass filter drops nothing', () => {
    expect(filterCardIds(compendiumCardIds(), defaultCardFilter())).toEqual(compendiumCardIds());
  });

  it('names every rarity', () => {
    expect(CARD_RARITY_LABEL).toEqual({
      basic: '起始',
      common: '常见',
      uncommon: '罕见',
      rare: '稀有',
      legendary: '传说',
    });
  });
});

// ------------------------------------------------------------------- 宝卷

describe('relicRows', () => {
  it('covers every relic, sorted by tier order with declaration order inside a tier', () => {
    const rows = relicRows();
    expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(RELICS).sort());
    const rank = new Map(RELIC_TIER_ORDER.map((t, i) => [t, i]));
    for (let i = 1; i < rows.length; i++) {
      expect(rank.get(rows[i].tier)!).toBeGreaterThanOrEqual(rank.get(rows[i - 1].tier)!);
    }
  });

  it('prints the tier in words and the text with {N} already paid in', () => {
    const rows = relicRows();
    const guding = rows.find((r) => r.id === 'gudingdao');
    expect(guding).toBeDefined();
    expect(guding?.tierLabel).toBe(RELIC_TIER_LABEL[guding!.tier]);
    for (const row of rows) expect(row.text).not.toContain('{N}');
  });
});

// ------------------------------------------------------------------- 敌卷

describe('enemyActSections', () => {
  it('names the four acts the way the annals do', () => {
    expect(enemyActSections().map((s) => s.act)).toEqual(['第一幕', '第二幕', '第三幕', '终章']);
  });

  it('leaves no enemy row out of the book — summons and splits included', () => {
    const listed = new Set(enemyActSections().flatMap((s) => s.enemyIds));
    expect([...listed].sort()).toEqual(Object.keys(ENEMIES).sort());
  });

  it('files 张宝分身 in the first act, after the body it splits from', () => {
    const act1 = enemyActSections()[0].enemyIds;
    expect(act1).toContain('zhangbaofenshen');
    expect(act1.indexOf('zhangbaofenshen')).toBeGreaterThan(act1.indexOf('zhangbao'));
    // 每幕之内不重列:同名敌人出现在多个遭遇里也只占一行。
    expect(new Set(act1).size).toBe(act1.length);
  });
});

describe('hpRangeText', () => {
  it('prints a range, and a single number when the roll is fixed', () => {
    expect(hpRangeText(getEnemy('yellowturban'))).toBe('42–50');
    expect(hpRangeText(getEnemy('lubu'))).toBe('150');
  });
});

describe('moveIntentKind', () => {
  it('agrees with intentKindOf on every move of every enemy', () => {
    // intentKindOf 收整个 CombatState/EnemyState 只为首回合意图不明;
    // 判种本身一字不读 state(`void state`),所以这里给个空壳、给个已行动
    // 过一回合的敌人,逐招对齐两份判序——它们不许漂移,见 compendiumView。
    const state = undefined as unknown as CombatState;
    for (const def of Object.values(ENEMIES)) {
      const enemy = { defId: def.id, actedTurns: 1 } as EnemyState;
      for (const move of def.moves) {
        expect(moveIntentKind(move), `${def.id}/${move.id}`).toBe(intentKindOf(state, enemy, move));
      }
    }
  });

  it('has a word for every kind it can return', () => {
    for (const def of Object.values(ENEMIES)) {
      for (const move of def.moves) {
        expect(INTENT_WORD[moveIntentKind(move)]).toBeTruthy();
      }
    }
  });
});

describe('moveRows', () => {
  it('keeps the six columns the todo names', () => {
    expect(MOVE_TABLE_HEAD).toEqual(['招式', '意图', '伤害', '护甲', '状态', '权重']);
  });

  it('sets 山贼 exactly as enemies.ts writes him: 伤害×段数、状态、权重·连出', () => {
    expect(moveRows(getEnemy('bandit'))).toEqual([
      { name: '双斧', intent: '攻', damage: '5×2', block: '—', status: '—', weight: '3·连2' },
      {
        name: '偷袭',
        intent: '攻·乱',
        damage: '4',
        block: '—',
        status: '施【怯战】1',
        weight: '2·连1',
      },
    ]);
  });

  it('prints armour-piercing loseHp as 穿 and the shoved card by name', () => {
    const talisman = moveRows(getEnemy('jijiu'))[1];
    expect(talisman.name).toBe('太平符水');
    expect(talisman.damage).toBe('穿 4');
    expect(talisman.status).toBe('塞【泥泞】×1');
    // 传道:全军加神力,且只在友军 ≥2 时上桌——条件跟在状态一栏里。
    const preach = moveRows(getEnemy('jijiu'))[2];
    expect(preach.intent).toBe('强化');
    expect(preach.status).toBe('全军【神力】1　友军 ≥2 时');
  });

  it('prints script beats instead of weights for a scripted enemy', () => {
    const liukou = moveRows(getEnemy('liukou'));
    expect(liukou[0]).toMatchObject({ name: '摸金', weight: '谱 1·2' });
    expect(liukou[1]).toMatchObject({ name: '遁走', intent: '遁走', weight: '谱 3', status: '夺财 30' });
    expect(moveRows(getEnemy('zhangliang'))[0].weight).toBe('谱 1');
  });

  it('shows block on its own column and the defend-buff pair as 守·强', () => {
    const fury = moveRows(getEnemy('huaxiong'))[2];
    expect(fury).toEqual({
      name: '怒喝',
      intent: '守·强',
      damage: '—',
      block: '8',
      status: '自增【神力】3',
      weight: '1·连1',
    });
  });
});

describe('enemyTraitLines', () => {
  it('writes down passives, thresholds and the script, one line each', () => {
    expect(enemyTraitLines(getEnemy('guanhai'))).toEqual([
      '开场：【暴怒】1',
      '体力落至 50%：得【神力】2',
    ]);
    expect(enemyTraitLines(getEnemy('zhangbao'))).toEqual([
      '体力落至 50%：分裂为 2 具【张宝分身】',
    ]);
    expect(enemyTraitLines(getEnemy('zhangliang'))).toEqual(['按谱行招，循环自第 2 手起']);
    expect(enemyTraitLines(getEnemy('liru'))).toEqual(['按谱行招，周而复始']);
    expect(enemyTraitLines(getEnemy('qishou'))).toEqual(['初上阵时意图不明']);
    expect(enemyTraitLines(getEnemy('bandit'))).toEqual([]);
  });
});

// ------------------------------------------------------------------- 接线

describe('the 典籍 scene is wired in', () => {
  it('is registered with the game', () => {
    const main = read('src/main.ts');
    expect(main).toContain("import { CompendiumScene } from './scenes/CompendiumScene'");
    expect(main).toContain('CompendiumScene,');
  });

  it('reads the ledgers once, and judges 未获/未遇 by them alone', () => {
    const scene = read('src/scenes/CompendiumScene.ts');
    // 三个 tab 都在。
    for (const label of ['牌 卷', '宝 卷', '敌 卷']) expect(scene).toContain(label);
    // 解锁走 u1 的账,遭遇走 u2 的埋点;典籍只读不写。
    expect(scene).toContain("filterUnlocked('card', compendiumCardIds())");
    expect(scene).toContain("filterUnlocked('relic', Object.keys(RELICS))");
    expect(scene).toContain('getUnlocks().seenEnemies');
    expect(scene).not.toContain('applyRunUnlocks');
    expect(scene).not.toContain('recordSeenEnemies');
    expect(scene).not.toContain('chooseUnlock');
    // 剪影文案:牌卷「未获」,敌卷「？？？」。
    expect(scene).toContain('未 获');
    expect(scene).toContain('？？？');
    // 排版全出自纯层——招式表和筛选都不在场景里现拼。
    expect(scene).toContain('moveRows(');
    expect(scene).toContain('filterCardIds(');
    expect(scene).toContain('sortForDisplay(');
  });
});
