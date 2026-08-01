import type { TargetMode } from '../combat/types';

/**
 * 拖拽出牌的松手裁决 (todos/24 k3)。纯几何，不碰 Phaser——CombatScene 把
 * 指针坐标（设计单位）和敌人热区递进来，这里只回答「打出还是回弹」；
 * tween、箭头和 playCard 都是场景层的事。抽成独立一档，是为了让回弹
 * 判定和打出线阈值在 Node 里测得动（tests/dragPlay.test.ts）。
 */

/**
 * 打出线（设计坐标 y）。无目标牌（target self/all）拖过这条线松手即打
 * ——原版的「上半屏任意处」。取在敌阵地面（BASELINE_Y 420）与悬停
 * 抬牌位（~514）之间：抬着的牌自己够不到线，想打必须真往上拖一段。
 */
export const PLAY_LINE_Y = 440;

/** 松手点是否越过打出线。压线不算——「过线」得是真过。 */
export function pastPlayLine(py: number, line: number = PLAY_LINE_Y): boolean {
  return py < line;
}

/** 一块以中心点计的矩形热区——Phaser Zone（origin 0.5）的形状。 */
export interface DropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 指针落在哪块热区里：命中返回下标，落空 -1。重叠时取排前的。 */
export function hitIndex(px: number, py: number, rects: readonly DropRect[]): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (Math.abs(px - r.x) <= r.width / 2 && Math.abs(py - r.y) <= r.height / 2) return i;
  }
  return -1;
}

export type DropCall = { verdict: 'play'; enemyIndex?: number } | { verdict: 'bounce' };

/**
 * 松手裁决：指向牌要落在活敌热区上（调用方只递活敌），无目标牌要过
 * 打出线，其余一律回弹。回弹即「不算打出」——气一分不扣，是拖到一半
 * 反悔的防误触（todo「原版行为」点名的那条）。
 */
export function dropVerdict(
  target: TargetMode,
  px: number,
  py: number,
  enemyRects: readonly DropRect[],
  line: number = PLAY_LINE_Y,
): DropCall {
  if (target === 'enemy') {
    const i = hitIndex(px, py, enemyRects);
    return i >= 0 ? { verdict: 'play', enemyIndex: i } : { verdict: 'bounce' };
  }
  return pastPlayLine(py, line) ? { verdict: 'play' } : { verdict: 'bounce' };
}
