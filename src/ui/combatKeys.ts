import type { KeyAction } from '../state/settings';

/**
 * 战斗键位 (todos/24 k4 · 实现步骤 5 + 键位表) — 键→动作的映射与单敌直打
 * 判定，纯函数不碰 Phaser。`CombatScene` 把 `getSettings().keys` 递进来，
 * 这里铺成 `keydown-<KEY>` 事件名单；哪个键印在键帽上只有 21 的设置账
 * 说了算，场景里一个键名都不许硬编码。抽成独立一档照 `dragPlay.ts` 的
 * 规矩——映射和判定在 Node 里测得动（tests/combatKeys.test.ts）。
 */

/**
 * 战斗场景听的动作，`KeyAction` 的子集。cancel 不进这张表——Esc 的分层
 * （收 overlay → 收气泡 → 取消选敌 → 开设置）在场景里另有一根线；
 * recenter 是地图的键，settings 有右上角齿轮，都不归战斗管。
 */
export const COMBAT_KEY_ACTIONS: readonly KeyAction[] = [
  'endTurn',
  'viewDeck', 'viewDraw', 'viewDiscard',
  'card1', 'card2', 'card3', 'card4', 'card5',
  'card6', 'card7', 'card8', 'card9', 'card10',
  'potion1', 'potion2', 'potion3',
];

/** 一条接线：Phaser 键盘事件名（`keydown-<KEY>`）与它触发的动作。 */
export interface CombatKeyEvent {
  action: KeyAction;
  event: string;
}

/**
 * 键位表 → 事件名单。键名来自设置账（'ONE' / 'Q' / 'E'…），与各场景现有
 * 的 `keydown-${key}` 写法直接拼接——重绑了哪个键，下一场战斗就听哪个键。
 */
export function combatKeyEvents(keys: Record<KeyAction, string>): CombatKeyEvent[] {
  return COMBAT_KEY_ACTIONS.map((action) => ({ action, event: `keydown-${keys[action]}` }));
}

/** card1..card10 → 手牌下标 0..9；不是出牌键回 -1。 */
export function cardIndexOf(action: KeyAction): number {
  const m = /^card(10|[1-9])$/.exec(action);
  return m ? Number(m[1]) - 1 : -1;
}

/** potion1..potion3 → 腰带槽位 0..2；不是丹药键回 -1。 */
export function potionIndexOf(action: KeyAction): number {
  const m = /^potion([1-3])$/.exec(action);
  return m ? Number(m[1]) - 1 : -1;
}

/**
 * 单敌直打判定（实现步骤 5，原版行为省一步）：指向牌按数字键时，场上
 * 只剩一个存活敌人则选敌只有一个答案——直接把它当目标打出。两个以上
 * 回 null，照旧进选敌模式；死人不算目标。
 */
export function soleLivingEnemy<T extends { alive: boolean }>(enemies: readonly T[]): T | null {
  let sole: T | null = null;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (sole) return null;
    sole = enemy;
  }
  return sole;
}
