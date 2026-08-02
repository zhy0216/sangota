import type { CombatEvent } from '../combat/types';

/**
 * 战斗事件的合并分组——纯函数，不碰 Phaser，场景把 drain 出来的
 * `CombatEvent[]` 递进来，这里只回答「哪些 damage 该并成一场戏」；怎么演
 * （斩击角度、顿帧、屏震）是场景层的事。抽成独立一档，是为了让分组语义
 * 在 Node 里测得动（tests/eventGroups.test.ts）。
 *
 * 规则：**连续的、打在敌人身上的** damage 事件并成一组——同一目标是
 * 连击（multiHit，力战无将 5×5 那类 `times: N`），多个目标是横扫
 * （aoe，万人敌 / 水淹七军的 `damageAll`）。打在玩家身上的不并：敌人
 * 逐次伸手的出招节奏（`playDamage` 里的 lunge）就是它的表现本体。
 * 中间隔了任何别的事件（status、death、draw…）就断组——引擎在击杀
 * 当下就发 death（engine.ts `resolveDamage`），所以横扫扫死人时击杀拍
 * 自然独立成戏，不会被并进后半段。
 */

export type DamageEv = Extract<CombatEvent, { t: 'damage' }>;

export type EventGroup =
  | { kind: 'one'; ev: CombatEvent }
  | { kind: 'multiHit'; events: DamageEv[] }
  | { kind: 'aoe'; events: DamageEv[] };

export function groupCombatEvents(events: readonly CombatEvent[]): EventGroup[] {
  const out: EventGroup[] = [];
  let run: DamageEv[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push({ kind: 'one', ev: run[0] });
    } else if (run.every((e) => e.targetId === run[0].targetId)) {
      out.push({ kind: 'multiHit', events: run });
    } else {
      out.push({ kind: 'aoe', events: run });
    }
    run = [];
  };

  for (const ev of events) {
    if (ev.t === 'damage' && ev.targetId !== 'player') {
      run.push(ev);
      continue;
    }
    flush();
    out.push({ kind: 'one', ev });
  }
  flush();
  return out;
}

/** 一组连击/横扫的累计伤害——末段音画按这个数定档（重顿帧配重闷响）。 */
export function groupTotal(events: readonly DamageEv[]): number {
  return events.reduce((sum, e) => sum + e.amount, 0);
}
