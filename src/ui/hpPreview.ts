/**
 * 敌人 HP 条伤害预览的段几何 (todos/24 k5)。纯算术，不碰 Phaser——
 * CombatScene 把目标的当前 HP/护甲和这一击的单段伤害 × 段数递进来，这里
 * 只回答「半透明红段从哪画到哪、这一下杀不杀得死」；闪烁、「必杀」小签
 * 和重画都是场景层的事。抽成独立一档，让护甲折算和致死判定在 Node 里
 * 测得动（tests/hpPreview.test.ts）——和 dragPlay.ts 同一个抽法。
 */

export interface HpPreviewSeg {
  /** 段的左右端，占 HP 条全宽的比例（0..1），from < to。 */
  from: number;
  to: number;
  /** 这一击打完 HP 归零——必杀。 */
  lethal: boolean;
}

/**
 * 这一击会打掉的 HP 段。伤害数字由调用方从引擎的 `previewValues` 取——
 * 与卡面同一套算法，破绽/神力/怯战全折进去；这里只做护甲与 HP 的折算。
 *
 * 多段攻击按总伤算（todo 点名）：一次出牌内护甲逐段消耗、每段伤害相同，
 * 吸收量恰等于 min(护甲, 总伤)，与引擎 `resolveDamage` 逐段结算殊途同归。
 * 打不穿护甲、或目标已倒下时没有段——返回 null，条上什么都不画。
 */
export function hpPreviewSeg(
  hp: number,
  maxHp: number,
  block: number,
  damagePerHit: number,
  hits: number,
): HpPreviewSeg | null {
  if (hp <= 0 || maxHp <= 0) return null;
  const total = Math.max(0, damagePerHit) * Math.max(0, hits);
  const loss = Math.min(hp, Math.max(0, total - Math.max(0, block)));
  if (loss <= 0) return null;
  return {
    from: (hp - loss) / maxHp,
    to: hp / maxHp,
    lethal: loss === hp,
  };
}
