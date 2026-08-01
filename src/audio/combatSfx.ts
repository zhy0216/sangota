import { STATUS_META } from '../combat/statuses';
import type { CardType, CombatEvent } from '../combat/types';
import type { SfxId, SfxOptions } from './sfx';

/**
 * 战斗事件 → 音效的映射表 (todos/20 b5)。纯函数层：`CombatScene.playEvents`
 * 排水时逐条查表喊 `audio.play`，音效因此和动画同源同步（README：
 * 「animation is sequenced off the rules」——声音也是）。
 *
 * 拆成独立模块而不是写死在场景里，是因为 `CombatScene` 载着 Phaser 进不了
 * Node（仓库惯例，见 `tests/combatScene.test.ts`）——表在这儿，
 * `tests/combatSfx.test.ts` 就能整表逐行验，场景层只剩接线，
 * 接线由 `tests/audioWiring.test.ts` 当源码文本钉住。
 */

/** 一声待播的音效：id 加上要叠给 `Audio.play` 的选项。 */
export interface SfxCue {
  id: SfxId;
  opts?: SfxOptions;
}

// ------------------------------------------------------------- 命中三档

/**
 * 伤害分档阈值。基础伤害的实际分布（`cards.ts` + `enemies.ts`）：
 * 4–6 一大簇（杂兵刀、初始攻），7–10 一簇（强化过的攻、精英平砍），
 * 12 起步是重击（首领、蓄力斩）。todo 给的 <=14 中档线切在 12–14 那簇
 * 中间，而 `playDamage` 的视觉重击线是 `amount >= 12`——音画必须同档：
 * 重的 hitstop 配重的闷响，所以重档线跟视觉走 12，不跟 14。
 */
export const HIT_LIGHT_MAX = 6;
/** 与 `playDamage` 的 `heavy = ev.amount >= 12` 同一条线，见上。 */
export const HIT_HEAVY_MIN = 12;

/** 实际落下的伤害（减甲后）分三档命中音。 */
export function hitSfx(amount: number): SfxId {
  if (amount <= HIT_LIGHT_MAX) return 'hit-light';
  if (amount < HIT_HEAVY_MIN) return 'hit-mid';
  return 'hit-heavy';
}

// ------------------------------------------------------------- 抽牌递增

/**
 * 本批第 n 张（0 起）的抽牌音抬高 n*60 cents——五连抽听成上行音阶而不是
 * 同一个音重复（验收标准点名）。jitter 归零：随机 ±60 cents 会把 60 一步
 * 的音阶搅乱，抽牌的「递增感」比「不像机器」值钱。
 */
export const DRAW_DETUNE_STEP = 60;

export function drawCue(n: number): SfxCue {
  return { id: 'card-draw', opts: { detune: n * DRAW_DETUNE_STEP, pitchJitter: 0 } };
}

// ------------------------------------------------------------- 打出卡牌

/**
 * 打出一张牌按牌类型发声：攻是刀，势是钟，其余（谋、以及少数能打出的
 * 诅咒/伤情牌）都归谋——它们没有自己的音色，第二批再说。
 */
export function cardPlaySfx(type: CardType): SfxId {
  if (type === 'attack') return 'card-attack';
  if (type === 'power') return 'card-power';
  return 'card-skill';
}

// ------------------------------------------------------------- 事件映射

/**
 * 一个事件要响哪几声。数组而不是单值：`damage` 可以同时是一记闷响和一声
 * 甲裂（挡了一部分），也可以只有甲声（全挡下）或什么都不响（0 伤未挡，
 * 比如力竭到 0 的挥空）。
 *
 * `drawIndex`：本批第几张抽牌（0 起），只有 `draw` 事件读它。
 *
 * 表外的事件——`heal`（有自己的绿字动画但第一批没配音源）、`enemyMove`
 * （每类敌人独立攻击声属第二批）、`steal`/`summon`/`split`/`escape`/
 * `shout`/`statusBlocked`——一律空数组，静默即正确：没有声音的一刀
 * 仍然是一刀（`Audio.play` 的同一条约定）。
 */
export function sfxForEvent(ev: CombatEvent, drawIndex = 0): SfxCue[] {
  switch (ev.t) {
    case 'damage': {
      const cues: SfxCue[] = [];
      if (ev.amount > 0) cues.push({ id: hitSfx(ev.amount) });
      // 护甲挡了刀（不论挡没挡全）就有甲裂声，todo 事件表原文。
      if (ev.blocked > 0) cues.push({ id: 'block-break' });
      return cues;
    }
    case 'block':
      return [{ id: 'block-gain' }];
    case 'status':
      return [{ id: STATUS_META[ev.status].kind === 'buff' ? 'status-buff' : 'status-debuff' }];
    case 'death':
      // 引擎今天只对敌人发 death（玩家死是 phase='lost'，声音在
      // `showDefeat` 接），但表按 targetId 分完整——引擎哪天改了这儿不改。
      return [{ id: ev.targetId === 'player' ? 'player-death' : 'enemy-death' }];
    case 'draw':
      return [drawCue(drawIndex)];
    case 'discard':
      return [{ id: 'card-discard' }];
    case 'shuffle':
      return [{ id: 'shuffle' }];
    case 'exhaust':
      return [{ id: 'card-exhaust' }];
    case 'relic':
    case 'passive':
      return [{ id: 'relic-trigger' }];
    case 'potion':
      return [{ id: 'potion-use' }];
    default:
      return [];
  }
}
