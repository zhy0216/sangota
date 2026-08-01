import { getSettings, type Settings } from '../state/settings';

/**
 * 动画时长换算 (todos/21 t2) — 「动画速度」与「屏幕震动」两个设置项的唯一出口。
 *
 * `CombatScene` / `vfx.ts` 里所有 tween 的 duration/delay、`delayedCall` 的
 * 毫秒数、`hitStop` 的冻结时长都从 `dur()` 过一遍。改的是**传入的时长**，
 * 不碰 `time.timeScale` / `tweens.timeScale`——README 的约定是 `hitStop` 只
 * 缩放 `tweens.timeScale`、动画 `await` 走场景时钟，`dur()` 与它作用在不同
 * 的轴上，互不冲突。
 *
 * 两处**故意不过** `dur()`，别在下一轮机械接线里顺手包上：
 * - `repeat: -1` 的环境循环（呼吸、致死脉冲）——它们不占战斗节奏，
 *   加速只会让人物换气过度；
 * - 抽牌音的 `delayedCall(drawn * 60, …)` 错峰——60ms 是为了躲开
 *   `Audio` 40ms 限流窗，除以 1.6 就掉进窗里被吞声。
 *
 * 照 `settings.ts` 的规矩现读现算、不缓存：测试逐用例换假 storage 吃不到
 * 陈账，面板上改完挡位，下一个动画立即生效。
 */

/** 三档除数。normal 原值；fast/instant 的倍率来自 todo 的设计方案。 */
export const ANIM_SPEED_DIVISOR: Record<Settings['animSpeed'], number> = {
  normal: 1,
  fast: 1.6,
  instant: 2.5,
};

/** 把一段动画时长（毫秒）按当前「动画速度」挡位换算。 */
export function dur(ms: number): number {
  return ms / ANIM_SPEED_DIVISOR[getSettings().animSpeed];
}

/**
 * instant 挡位额外跳过的纯装饰动画（尘土、水墨飞溅、屏幕洗色）问这里。
 * 伤害数字、护甲变化、死亡反馈**不许**走这个闸——极速也得看得懂战况。
 */
export function skipDecor(): boolean {
  return getSettings().animSpeed === 'instant';
}

/**
 * 屏幕震动挡位的强度换算：full 原样、reduced 减半、off 返回 null——
 * 调用方（`vfx.screenShake`）拿到 null 整个不摇。纯函数，镜头不在这儿。
 */
export function shakeIntensity(intensity: number): number | null {
  const mode = getSettings().screenShake;
  if (mode === 'off') return null;
  return mode === 'reduced' ? intensity / 2 : intensity;
}
