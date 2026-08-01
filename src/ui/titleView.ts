import { HERO_UNLOCKS } from '../data/unlockTracks';

/**
 * 标题页 (todos/23 u6) 的纯排版层 — 场景本体 `TitleScene.ts` imports Phaser,
 * Node 下装不进来;六入口谁出场、摆在哪,全在这里算、在
 * `tests/titleView.test.ts` 里钉。标签、配色与点击留在场景里:守源码的
 * 既有测试(`unlocks.test.ts` / `historyView.test.ts` 等)认的是场景文本,
 * 这里只出几何。同 `historyView.ts` 的规矩,不 import `config.ts`,
 * 免得把窗口对象拖进 Node 测试。
 */

/**
 * 六入口的名册:「继续」`resume` 与「出征」`begin` 互斥(有可续存档才是
 * 「继续」),「重新出征」`again` / 「清除存档」`wipe` 跟着存档状态走,
 * 「典籍」`compendium` / 「战史」`annals` / 「自定义」`custom` 常驻,
 * 「新卷可阅」`scroll` 只在三选一还挂着账时出现。
 */
export type TitleActionId =
  | 'resume'
  | 'begin'
  | 'again'
  | 'wipe'
  | 'compendium'
  | 'annals'
  | 'custom'
  | 'scroll';

/** `SaveSlot['kind']` 的镜像——纯排版层不 import `save.ts` 的 Phaser 邻居。 */
export type TitleSlotKind = 'empty' | 'ok' | 'stale' | 'broken';

export interface TitleActionFrame {
  id: TitleActionId;
  /** 按钮中心,设计坐标。 */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  /** 入场淡入的延迟,沿用旧版 860 起、副排每枚 +40 的节奏。 */
  delay: number;
}

/** 标题块的左缘,与 `TitleScene` 的 LEFT 同值。 */
const LEFT = 108;

/**
 * 天命选择器面板的左缘(`TitleScene` 的 `ASC.x - ASC.w / 2`)。高重天命的
 * 累积修改名单会垂到按钮那一行,所以副排的右缘不许过这条线。
 */
export const ASC_PANEL_LEFT = 1118;

/** 谁出场、按什么次序——主位永远打头,副排按固定席次跟上。 */
export function titleActionIds(slot: TitleSlotKind, pending: boolean): TitleActionId[] {
  const ids: TitleActionId[] = [slot === 'ok' ? 'resume' : 'begin'];
  if (slot === 'ok') ids.push('again');
  if (slot === 'stale' || slot === 'broken') ids.push('wipe');
  ids.push('compendium', 'annals', 'custom');
  if (pending) ids.push('scroll');
  return ids;
}

/**
 * 六入口的横排几何。主位大按钮在左,副排从它右侧铺开——存档行按钮或
 * 「新卷可阅」挤进来就收紧一档(旧版 crowded 的同款取舍);副排到五枚时
 * 再窄一码,右缘让开天命选择器(`ASC_PANEL_LEFT`)。
 */
export function layoutTitleActions(slot: TitleSlotKind, pending: boolean): TitleActionFrame[] {
  const [primary, ...rest] = titleActionIds(slot, pending);
  const resumable = primary === 'resume';
  const frames: TitleActionFrame[] = [
    {
      id: primary,
      x: LEFT + (resumable ? 130 : 118),
      y: 658,
      width: resumable ? 260 : 236,
      height: 66,
      fontSize: resumable ? 30 : 32,
      delay: 860,
    },
  ];

  const crowded = slot !== 'empty' || pending;
  const width = rest.length >= 5 ? 132 : 152;
  const startX = crowded ? 452 : LEFT + 358;
  const step = width + 12;
  for (const [i, id] of rest.entries()) {
    frames.push({
      id,
      x: startX + i * step,
      y: crowded ? 646 : 658,
      width,
      height: crowded ? 50 : 52,
      fontSize: rest.length >= 5 ? 18 : 20,
      delay: 980 + i * 40,
    });
  }
  return frames;
}

/** 一/两/三——武将门槛就这几个数,再往上直接印数字。 */
const VICTORY_WORD: Record<number, string> = { 1: '一', 2: '两', 3: '三' };

/**
 * 选将界面的解锁门 (u6):未解锁武将压暗之外还要给个理由。谁锁着由
 * `isUnlocked('hero', id)` 判(那本账要碰 localStorage,留在场景里),
 * 这里只把 `HERO_UNLOCKS` 的门槛译成人话;不设门的武将返回 null。
 */
export function heroLockReason(heroId: string): string | null {
  const gate = HERO_UNLOCKS.find((h) => h.heroId === heroId);
  if (!gate) return null;
  const word = VICTORY_WORD[gate.victories] ?? String(gate.victories);
  return `通关${word}次可解锁`;
}
