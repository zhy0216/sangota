import { describe, expect, it } from 'vitest';
import { groupCombatEvents, groupTotal, type DamageEv } from '../src/ui/eventGroups';
import type { CombatEvent } from '../src/combat/types';

/**
 * 动画优化 · 事件合并分组。两半：`eventGroups.ts` 的分组语义是纯函数，
 * 直接驱动；场景的连击/横扫演出在 Node 里点不动，按 `tests/dragPlay.test.ts`
 * 的老办法读源码断言。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

const dmg = (targetId: string, amount = 5, blocked = 0): DamageEv => ({
  t: 'damage',
  targetId,
  amount,
  blocked,
  lethal: false,
});
const draw: CombatEvent = { t: 'draw', uid: 'c1' } as CombatEvent;

// ---------------------------------------------------------------- 分组语义

describe('groupCombatEvents', () => {
  it('lets lone events pass through untouched, order intact', () => {
    const events = [draw, dmg('e1'), draw];
    expect(groupCombatEvents(events)).toEqual([
      { kind: 'one', ev: draw },
      { kind: 'one', ev: events[1] },
      { kind: 'one', ev: draw },
    ]);
  });

  it('folds consecutive same-target hits into one multiHit — 力战无将 5×5', () => {
    const hits = [dmg('e1'), dmg('e1'), dmg('e1'), dmg('e1'), dmg('e1')];
    expect(groupCombatEvents(hits)).toEqual([{ kind: 'multiHit', events: hits }]);
  });

  it('folds a spread over distinct targets into one aoe — 万人敌', () => {
    const hits = [dmg('e1', 11), dmg('e2', 11), dmg('e3', 11)];
    expect(groupCombatEvents(hits)).toEqual([{ kind: 'aoe', events: hits }]);
  });

  it('reads repeated targets inside a spread as aoe still — 水淹七军 6×2', () => {
    const hits = [dmg('e1', 6), dmg('e2', 6), dmg('e1', 6), dmg('e2', 6)];
    expect(groupCombatEvents(hits)).toEqual([{ kind: 'aoe', events: hits }]);
  });

  it('never groups hits on the player — 敌人的出招节奏是逐次伸手', () => {
    const hits = [dmg('player'), dmg('player'), dmg('player')];
    expect(groupCombatEvents(hits).map((g) => g.kind)).toEqual(['one', 'one', 'one']);
  });

  it('breaks the run on any interleaved event — 击杀拍独立成戏', () => {
    // 引擎在击杀当下就发 death（engine.ts resolveDamage），横扫扫死人时
    // death 把 run 切开，后半段自己成组。
    const death: CombatEvent = { t: 'death', targetId: 'e2' } as CombatEvent;
    const events = [dmg('e1'), dmg('e2', 20), death, dmg('e3')];
    expect(groupCombatEvents(events)).toEqual([
      { kind: 'aoe', events: [events[0], events[1]] },
      { kind: 'one', ev: death },
      { kind: 'one', ev: events[3] },
    ]);
  });

  it('answers an empty drain with an empty list', () => {
    expect(groupCombatEvents([])).toEqual([]);
  });
});

describe('groupTotal', () => {
  it('sums the amounts — the yardstick for the final hit’s weight class', () => {
    expect(groupTotal([dmg('e1', 5), dmg('e1', 5), dmg('e1', 5)])).toBe(15);
    expect(groupTotal([])).toBe(0);
  });
});

// ---------------------------------------------------------------- 接线

describe('连击/横扫接进了场景 (源码断言)', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('playEvents drains through groupCombatEvents, singles still via playEvent', () => {
    const at = scene.indexOf('private async playEvents');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('groupCombatEvents(events)');
    expect(body).toContain('await this.playMultiHit(group.events)');
    expect(body).toContain('await this.playAoe(group.events)');
    // finished 的规矩不变：damage 组里不含 death，整组跳。
    expect(body).toContain('if (this.finished) continue;');
  });

  it('the final hit of a combo takes its weight from the cumulative total', () => {
    const at = scene.indexOf('private async playMultiHit');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    // 重顿帧配重闷响的纪律（combatSfx.ts 同档约定）在合并后依然成立：
    // 末段的音效档位按整套连击的累计伤害来定。
    expect(body).toContain('const total = groupTotal(events)');
    expect(body).toContain('{ ...ev, amount: total }');
    expect(body).toContain('const heavy = total >= 12');
  });

  it('an aoe is one sweep, one hitstop, one shake — not N serial ones', () => {
    const at = scene.indexOf('private async playAoe');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body.match(/slash\(this,/g)).toHaveLength(1);
    expect(body.match(/hitStop\(this,/g)).toHaveLength(1);
    expect(body.match(/screenShake\(this,/g)).toHaveLength(1);
  });

  it('exhaust burns the card in place instead of flying it to the discard', () => {
    expect(scene).toContain('this.burnCard(ev.uid)');
    const at = scene.indexOf('private burnCard');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    // 先摘账再烧——syncHand 不会再抢着把同一张飞向弃牌堆。
    expect(body).toContain('this.cardViews.delete(uid)');
  });
});
