import { afterEach, describe, expect, it } from 'vitest';
import { getEncounter } from '../src/combat/enemies';
import { startCombat } from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, type DeckCard } from '../src/state/run';
import { DEFAULT_SETTINGS, updateSettings } from '../src/state/settings';
import {
  AUTO_END_DELAY_MS,
  hasPlayableCard,
  needsEndTurnConfirm,
  needsPlayConfirm,
  shouldAutoEndTurn,
} from '../src/ui/confirm';

/**
 * 确认提示 + 自动结束回合 — todos/21 t3。
 *
 * 三节：**判定纯函数**（confirm.ts 的四个出口，逐设置项、逐条件验真值表，
 * 状态用真引擎 `startCombat` 起）、**默认值**（confirmEndTurn 开、其余关——
 * 测试环境无 storage 时三项设置都落回默认，其余场景测试不受影响）、
 * **接线守护**（`CombatScene.ts` 载着 Phaser，Node 下 import 不进来，照
 * `timing.test.ts` 的技法把源码当文本查——断的是打断语义：每个输入口先
 * `cancelAutoEnd`、只有 `play` 的收尾挂定时器、Esc 先收气泡，断了就静默
 * 失效的线）。
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

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

// --------------------------------------------------------------- 战斗台架

const cards = (defId: string, n: number): DeckCard[] =>
  Array.from({ length: n }, () => newDeckCard(defId));

/** 关羽起手 5 张劈砍（1 费指向攻击）、3 点气——手里必有可打的牌。 */
function bench(deck: DeckCard[] = cards('pikan', 5)): CombatState {
  return startCombat({
    encounter: getEncounter('m1'),
    deck,
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed: 'confirm-bench',
  });
}

/** 挂一个最小的悬置选牌——引擎冻结全场的那种状态。 */
const freeze = (state: CombatState): void => {
  state.pendingChoice = { kind: 'discard', options: [...state.hand], min: 1, max: 1 };
};

// --------------------------------------------------------------- 判定纯函数

describe('hasPlayableCard 逐张问引擎的 canPlay', () => {
  it('气够、牌在手——有得打', () => {
    expect(hasPlayableCard(bench())).toBe(true);
  });

  it('气为 0 时 1 费牌全打不出', () => {
    const state = bench();
    state.energy = 0;
    expect(hasPlayableCard(state)).toBe(false);
  });

  it('选牌悬置时全场冻结，一张也打不出', () => {
    const state = bench();
    freeze(state);
    expect(hasPlayableCard(state)).toBe(false);
  });
});

describe('needsEndTurnConfirm：气未用尽 且 有可打牌 且 设置开着', () => {
  it('默认开——气 3 点、满手可打，要问', () => {
    withStorage();
    expect(needsEndTurnConfirm(bench())).toBe(true);
  });

  it('气为 0 直接结束，不问', () => {
    withStorage();
    const state = bench();
    state.energy = 0;
    expect(needsEndTurnConfirm(state)).toBe(false);
  });

  it('气有余但无可打牌（空手）直接结束，不问', () => {
    withStorage();
    const state = bench();
    state.hand = [];
    expect(needsEndTurnConfirm(state)).toBe(false);
  });

  it('设置关掉后条件齐备也不问', () => {
    withStorage();
    updateSettings({ confirmEndTurn: false });
    expect(needsEndTurnConfirm(bench())).toBe(false);
  });
});

describe('needsPlayConfirm 三档：off 全放、rare 只拦稀有、all 全拦', () => {
  it('默认 off——稀有牌也直接打', () => {
    withStorage();
    expect(needsPlayConfirm({ rarity: 'rare' })).toBe(false);
    expect(needsPlayConfirm({ rarity: 'basic' })).toBe(false);
  });

  it('rare 档拦稀有与传说牌', () => {
    withStorage();
    updateSettings({ confirmPlay: 'rare' });
    expect(needsPlayConfirm({ rarity: 'rare' })).toBe(true);
    expect(needsPlayConfirm({ rarity: 'legendary' })).toBe(true);
    expect(needsPlayConfirm({ rarity: 'basic' })).toBe(false);
    expect(needsPlayConfirm({ rarity: 'common' })).toBe(false);
    expect(needsPlayConfirm({ rarity: 'uncommon' })).toBe(false);
  });

  it('all 档不看稀有度', () => {
    withStorage();
    updateSettings({ confirmPlay: 'all' });
    expect(needsPlayConfirm({ rarity: 'basic' })).toBe(true);
    expect(needsPlayConfirm({ rarity: 'rare' })).toBe(true);
  });
});

describe('shouldAutoEndTurn：设置开 且 玩家阶段 且 无悬置 且 无可打牌', () => {
  it('默认关——无可打牌也不代按', () => {
    withStorage();
    const state = bench();
    state.energy = 0;
    expect(shouldAutoEndTurn(state)).toBe(false);
  });

  it('开着、气尽无可打——触发', () => {
    withStorage();
    updateSettings({ autoEndTurn: true });
    const state = bench();
    state.energy = 0;
    expect(shouldAutoEndTurn(state)).toBe(true);
  });

  it('还有可打的牌——不触发', () => {
    withStorage();
    updateSettings({ autoEndTurn: true });
    expect(shouldAutoEndTurn(bench())).toBe(false);
  });

  it('敌方阶段不触发', () => {
    withStorage();
    updateSettings({ autoEndTurn: true });
    const state = bench();
    state.energy = 0;
    state.phase = 'enemy';
    expect(shouldAutoEndTurn(state)).toBe(false);
  });

  it('选牌悬置时不触发——canPlay 那时对满手好牌也答否，没有这一格就会替玩家把回合按掉', () => {
    withStorage();
    updateSettings({ autoEndTurn: true });
    const state = bench();
    // 气 3 点、满手 1 费牌，只因悬置而全打不出：hasPlayableCard 为 false，
    // 唯有 pendingChoice 这一格把它拦下。
    freeze(state);
    expect(hasPlayableCard(state)).toBe(false);
    expect(shouldAutoEndTurn(state)).toBe(false);
  });

  it('缓冲是 todo 钉的 700ms', () => {
    expect(AUTO_END_DELAY_MS).toBe(700);
  });
});

describe('默认值与 todo 一致——无 storage 的其余测试不受三项影响', () => {
  it('confirmEndTurn 开、confirmPlay 关、autoEndTurn 关', () => {
    expect(DEFAULT_SETTINGS.confirmEndTurn).toBe(true);
    expect(DEFAULT_SETTINGS.confirmPlay).toBe('off');
    expect(DEFAULT_SETTINGS.autoEndTurn).toBe(false);
  });
});

// --------------------------------------------------------------- 接线守护

const SOURCES: Record<string, string> = import.meta.glob('../src/scenes/CombatScene.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const scene = SOURCES['../src/scenes/CombatScene.ts'];

/** 方法体切片，照 `combatScene.test.ts` 的技法：方法头到下一个两格收笔。 */
const fnBody = (head: string): string => {
  const at = scene.indexOf(head);
  expect(at, head).toBeGreaterThan(-1);
  return scene.slice(at, scene.indexOf('\n  }', at));
};

describe('结束确认接在 onEndTurn 的唯一入口上', () => {
  it('先问 needsEndTurnConfirm，气泡已在则这一按就是确认', () => {
    const body = fnBody('private async onEndTurn(');
    expect(body).toContain('needsEndTurnConfirm(this.state)');
    expect(body).toContain('this.showEndTurnConfirm();');
    expect(body).toContain('this.dismissEndTurnConfirm();');
    // 弹泡即收手——不结束、不置 busy。
    expect(body.indexOf('this.showEndTurnConfirm();')).toBeLessThan(body.indexOf('this.busy = true;'));
  });

  it('气泡是 inkPanel 小气泡，点它本体确认', () => {
    const body = fnBody('private showEndTurnConfirm(');
    expect(body).toContain('inkPanel(this,');
    expect(body).toContain("hit.on('pointerdown', () => void this.onEndTurn());");
  });

  it('Esc 先收气泡再轮到取消选目标', () => {
    const at = scene.indexOf("keydown-ESC'");
    expect(at).toBeGreaterThan(-1);
    const handler = scene.slice(at, scene.indexOf('});', at));
    expect(handler).toContain('this.dismissEndTurnConfirm();');
    expect(handler.indexOf('dismissEndTurnConfirm')).toBeLessThan(handler.indexOf('clearSelection'));
  });

  it('点别处取消：pointerdown 里收气泡，气泡本体与结束回合按钮除外', () => {
    const at = scene.indexOf("this.input.on('pointerdown'");
    const handler = scene.slice(at, scene.indexOf('});', at));
    expect(handler).toContain('this.endTurnConfirm!.exists(');
    expect(handler).toContain('this.endTurnBtn.exists(');
    expect(handler).toContain('if (!spared) this.dismissEndTurnConfirm();');
  });
});

describe('打牌确认接在 onCardClick 的非指向分支上', () => {
  it('needsPlayConfirm 拦第一击，第二次点同一张才 play', () => {
    const body = fnBody('private onCardClick(');
    expect(body).toContain('needsPlayConfirm(view.def)');
    expect(body).toContain('this.select(view);');
  });

  it('高亮中点敌人是「别处」——取消而不是打出', () => {
    const body = fnBody('private onEnemyClick(');
    expect(body).toContain("selected.def.target !== 'enemy'");
    expect(body).toContain('this.clearSelection();');
  });

  it('高亮中的非指向牌不画瞄准线', () => {
    const body = fnBody('override update(');
    expect(body).toContain("view.def.target === 'enemy'");
  });
});

describe('自动结束的挂与掐', () => {
  it('只在 play 的收尾挂——autosave 之后、shouldAutoEndTurn 把关、700ms 过 dur', () => {
    const play = fnBody('private async play(');
    expect(play.indexOf('this.autosave();')).toBeLessThan(play.indexOf('this.scheduleAutoEnd();'));
    const sched = fnBody('private scheduleAutoEnd(');
    expect(sched).toContain('shouldAutoEndTurn(this.state)');
    expect(sched).toContain('this.time.delayedCall(dur(AUTO_END_DELAY_MS)');
    // 全文只有这一处挂线——用丹药、开新回合都不代按。
    expect(scene.match(/this\.scheduleAutoEnd\(\);/g)).toHaveLength(1);
  });

  it('玩家的每个输入口都先掐定时器——点卡/点敌人/用丹药/弃丹药/按 E', () => {
    for (const head of [
      'private onCardClick(',
      'private onEnemyClick(',
      'private onPotionClick(',
      'private discardPotion(',
      'private async onEndTurn(',
    ]) {
      expect(fnBody(head), head).toContain('this.cancelAutoEnd();');
    }
  });

  it('cancelAutoEnd 真摘定时器，不是只放引用', () => {
    const body = fnBody('private cancelAutoEnd(');
    expect(body).toContain('this.autoEndTimer?.remove(false);');
    expect(body).toContain('this.autoEndTimer = null;');
  });
});
