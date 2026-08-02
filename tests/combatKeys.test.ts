import { describe, expect, it } from 'vitest';
import {
  COMBAT_KEY_ACTIONS,
  cardIndexOf,
  combatKeyEvents,
  potionIndexOf,
  soleLivingEnemy,
} from '../src/ui/combatKeys';
import { KEY_ACTIONS, defaultSettings, type KeyAction } from '../src/state/settings';

/**
 * todos/24 · k4 — 键位：数字键出牌 + 丹药/查看快捷键。两半：`combatKeys.ts`
 * 的键→动作映射和单敌直打判定是纯函数，直接驱动；场景的接线在 Node 里
 * 点不动，按 `tests/dragPlay.test.ts` 的老办法读源码断言。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

// ---------------------------------------------------------------- 键→动作

describe('combatKeyEvents', () => {
  const events = combatKeyEvents(defaultSettings().keys);
  const eventOf = (action: KeyAction): string | undefined =>
    events.find((e) => e.action === action)?.event;

  it('lays out the whole 24 key table off the default bindings', () => {
    // 1-0 打出手牌第 N 张。
    expect(eventOf('card1')).toBe('keydown-ONE');
    expect(eventOf('card5')).toBe('keydown-FIVE');
    expect(eventOf('card10')).toBe('keydown-ZERO');
    // Q/W/R 服第 1/2/3 瓶丹药。
    expect(eventOf('potion1')).toBe('keydown-Q');
    expect(eventOf('potion2')).toBe('keydown-W');
    expect(eventOf('potion3')).toBe('keydown-R');
    // D 牌组、A 抽牌堆、S 弃牌堆、E 结束回合。
    expect(eventOf('viewDeck')).toBe('keydown-D');
    expect(eventOf('viewDraw')).toBe('keydown-A');
    expect(eventOf('viewDiscard')).toBe('keydown-S');
    expect(eventOf('endTurn')).toBe('keydown-E');
  });

  it('reads the binding, not the keycap — a rebind moves the event', () => {
    const keys = { ...defaultSettings().keys, card1: 'K', endTurn: 'ENTER' };
    const rebound = combatKeyEvents(keys);
    expect(rebound.find((e) => e.action === 'card1')?.event).toBe('keydown-K');
    expect(rebound.find((e) => e.action === 'endTurn')?.event).toBe('keydown-ENTER');
  });

  it('covers exactly the combat actions — no Esc, no map keys', () => {
    // cancel 的 Esc 分层在场景里另有一根线，recenter/settings 不归战斗管。
    for (const action of COMBAT_KEY_ACTIONS) expect(KEY_ACTIONS).toContain(action);
    expect(COMBAT_KEY_ACTIONS).not.toContain('cancel');
    expect(COMBAT_KEY_ACTIONS).not.toContain('recenter');
    expect(COMBAT_KEY_ACTIONS).not.toContain('settings');
    // 1 结束 + 3 看堆 + 10 出牌 + 3 丹药。
    expect(events).toHaveLength(17);
  });
});

describe('cardIndexOf / potionIndexOf', () => {
  it('maps card1..card10 onto hand slots 0..9', () => {
    expect(cardIndexOf('card1')).toBe(0);
    expect(cardIndexOf('card9')).toBe(8);
    expect(cardIndexOf('card10')).toBe(9);
  });

  it('maps potion1..potion3 onto belt slots 0..2', () => {
    expect(potionIndexOf('potion1')).toBe(0);
    expect(potionIndexOf('potion3')).toBe(2);
  });

  it('answers -1 for every action of the other kinds', () => {
    for (const action of ['endTurn', 'viewDeck', 'potion2', 'cancel'] as const) {
      expect(cardIndexOf(action), action).toBe(-1);
    }
    for (const action of ['endTurn', 'card3', 'viewDiscard', 'settings'] as const) {
      expect(potionIndexOf(action), action).toBe(-1);
    }
  });
});

// ---------------------------------------------------------------- 单敌直打

describe('soleLivingEnemy', () => {
  const e = (id: string, alive: boolean): { id: string; alive: boolean } => ({ id, alive });

  it('names the target when exactly one enemy still stands', () => {
    expect(soleLivingEnemy([e('a', true)])?.id).toBe('a');
    // 死人不算目标——尸体躺在台上，不挡直打。
    expect(soleLivingEnemy([e('a', false), e('b', true), e('c', false)])?.id).toBe('b');
  });

  it('refuses when the answer is ambiguous or absent', () => {
    // 两个活敌：选敌必须由玩家来——省的是步骤，不是选择。
    expect(soleLivingEnemy([e('a', true), e('b', true)])).toBeNull();
    expect(soleLivingEnemy([e('a', false), e('b', false)])).toBeNull();
    expect(soleLivingEnemy([])).toBeNull();
  });
});

// ---------------------------------------------------------------- 接线

describe('键位接进了场景 (源码断言)', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('wires the whole table off getSettings().keys, hardcoding nothing', () => {
    expect(scene).toContain('combatKeyEvents(getSettings().keys)');
    expect(scene).toContain('this.onKeyAction(action)');
    // 原来的硬编码 E 键必须让位（keydown-ESC 是 Esc 分层，另一根线）。
    expect(scene).not.toContain("'keydown-E'");
  });

  it('stands down while an overlay is up or the fight is decided', () => {
    const at = scene.indexOf('private onKeyAction');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('if (this.finished || isCardGridOpen(this)) return;');
  });

  it('routes endTurn through onEndTurn, keeping the confirm bubble logic', () => {
    const at = scene.indexOf('private onKeyAction');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('void this.onEndTurn()');
    // 别的键等于「点了别处」——先收确认气泡，与 pointerdown 的语义一致。
    expect(body).toContain('this.dismissEndTurnConfirm()');
  });

  it('opens the piles and the deck through the buttons’ own entries', () => {
    const at = scene.indexOf('private onKeyAction');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain("this.openPile('抽 牌 堆', this.state.drawPile, true)");
    expect(body).toContain("this.openPile('弃 牌 堆', this.state.discardPile)");
    expect(body).toContain('this.openDeck()');
    // 「牌组」按钮走同一个入口，不许两处各写一份 openCardGrid。
    expect(scene).toContain("hit.on('pointerup', () => this.openDeck())");
  });

  it('plays the Nth card through onCardClick, gates and all', () => {
    const at = scene.indexOf('private onCardKey');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    // 复用现有输入门：busy/finished/dragUid/气不足全在 onCardClick 里。
    expect(body).toContain('this.onCardClick(view, sole?.id)');
    // 单敌直打问的是引擎的活敌名单，不是屏幕上的谁还站着。
    expect(body).toContain('soleLivingEnemy(this.state.enemies)');
    expect(body).toContain("view.def.target === 'enemy'");
  });

  it('hands the direct target straight to play, clearing any selection', () => {
    const at = scene.indexOf('private onCardClick');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('void this.play(view.uid, direct)');
    // 点击路径不传 directTargetId——单敌免选在 onCardClick 里自己按
    // 同一把尺（引擎的活敌名单）量，键盘与鼠标共用一条判定。
    expect(scene).toContain("view.hitZone.on('pointerup', () => this.onCardClick(view))");
    expect(body).toContain('directTargetId ?? soleLivingEnemy(this.state.enemies)?.id');
    // 单敌直打收掉了「点敌人才结算」这道天然确认，confirmPlay 的闸对
    // 点击路径必须补回来（数字键照旧直打）。
    expect(body).toContain('directTargetId === undefined && needsPlayConfirm(view.def)');
  });

  it('pours the Qth/Wth/Rth bottle through the belt’s own click path', () => {
    const at = scene.indexOf('private onPotionKey');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('this.onPotionClick(slot, getPotion(id))');
  });
});
