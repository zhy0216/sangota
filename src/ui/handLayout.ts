import { GAME_WIDTH } from '../config';

/**
 * 手牌布局几何 (todos/24 k6 · 实现步骤 8+9)。纯算术，不碰 Phaser——
 * CombatScene 把牌数和卡宽递进来，这里只回答「第 i 张放哪、转几度、
 * 几成大小」；tween、深度和 home 位的账都是场景层的事。抽成独立一档照
 * dragPlay.ts 的规矩——扇形随牌数收窄、Tab 展开的槽位表在 Node 里
 * 测得动（tests/handLayout.test.ts）。
 */

/** 一个手牌槽位：中心点（设计坐标）、旋转角与缩放。 */
export interface HandSlot {
  x: number;
  y: number;
  angle: number;
  scale: number;
}

/** 扇形手位的基准线（设计坐标 y）。卡高 200，基线 604 的卡底恰好贴屏底。 */
export const HAND_Y = 604;

/** 扇形铺开的最大总宽——牌多时靠收窄间距塞进这个宽度。 */
export const FAN_MAX_SPREAD = 760;

/** 扇形卡间距：牌少时近乎并排（卡宽 − 22），牌多时按总宽均摊收窄。 */
export function fanSpacing(n: number, cardW: number): number {
  return Math.min(cardW - 22, FAN_MAX_SPREAD / Math.max(1, n));
}

/**
 * 扇形排布（实现步骤 9）：间距与旋转角都随 `n` 动态算。t ∈ [-0.5, 0.5]
 * 是这张牌在扇里的份位——横位按份位铺开，边上的牌沉一点（|t|·26）、
 * 斜一点（角随 n 涨、封顶 ±6°），正中的牌端平。MAX_HAND=10 张时间距
 * 收到 76：每张牌左缘露出一条 76px 的竖带，费用珠和牌名都在带里——
 * 全可见、全可点、不遮关键信息。
 */
export function fanLayout(n: number, cardW: number): HandSlot[] {
  const spacing = fanSpacing(n, cardW);
  const totalWidth = spacing * (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 .. 0.5
    return {
      x: GAME_WIDTH / 2 + t * totalWidth,
      y: HAND_Y + Math.abs(t) * 26,
      angle: t * Math.min(12, n * 2.2),
      scale: 1,
    };
  });
}

/** Tab 展开排的两侧留白与相邻卡间隙。 */
const ROW_EDGE = 16;
const ROW_GAP = 8;

/**
 * Tab 展开排（实现步骤 8）：一排端平，零旋转零重叠。10 张全尺寸要
 * 1520px，1280 的屏塞不下——「全尺寸」和「不重叠」冲突时保不重叠：
 * 全排等比缩到恰好铺满（10 张约 0.82，8 张以内原尺寸不缩），规则文本
 * 反正还有悬停放大那一档可读。
 */
export function rowLayout(n: number, cardW: number): HandSlot[] {
  const avail = GAME_WIDTH - ROW_EDGE * 2;
  const scale = Math.min(1, avail / (Math.max(1, n) * (cardW + ROW_GAP)));
  const spacing = (cardW + ROW_GAP) * scale;
  const totalWidth = spacing * (n - 1);
  return Array.from({ length: n }, (_, i) => ({
    x: GAME_WIDTH / 2 - totalWidth / 2 + i * spacing,
    y: HAND_Y,
    angle: 0,
    scale,
  }));
}
