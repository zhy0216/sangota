import { canPlay } from '../combat/engine';
import type { CardDef, CombatState } from '../combat/types';
import { getSettings } from '../state/settings';

/**
 * 确认与自动结束的判定 (todos/21 t3) — confirmEndTurn / confirmPlay /
 * autoEndTurn 三个设置项的唯一出口，照 `timing.ts` 的规矩：纯函数、
 * 现读现算不缓存，`CombatScene` 只问结论不自己碰设置。三个函数都不管
 * 「怎么弹气泡 / 怎么挂定时器」——那是场景层的事，这里只回答「该不该」。
 */

/** 手里是否还有打得出的牌——逐张问引擎的 `canPlay`，规则只有一份。 */
export function hasPlayableCard(state: CombatState): boolean {
  return state.hand.some((uid) => canPlay(state, uid));
}

/**
 * 结束回合要不要先问一声：开着 confirmEndTurn、气没用完、手里还有能打
 * 的牌，三者齐备才问。气为 0 或无可打牌时结束是唯一去向，问了是烦人
 * ——todo 点名这两种情况直接结束。
 */
export function needsEndTurnConfirm(state: CombatState): boolean {
  if (!getSettings().confirmEndTurn) return false;
  return state.energy > 0 && hasPlayableCard(state);
}

/**
 * 打这张牌要不要先高亮等第二次点击：all 全拦，rare 只拦稀有牌。多敌时
 * 指向牌天然就是「点卡高亮 → 点敌人才打出」的两段式，场景层不再另问；
 * 单敌直打把两段并成了一步，场景层（onCardClick）会替点击路径把这道闸
 * 补回来。
 */
export function needsPlayConfirm(def: Pick<CardDef, 'rarity'>): boolean {
  const mode = getSettings().confirmPlay;
  if (mode === 'all') return true;
  return mode === 'rare' && (def.rarity === 'rare' || def.rarity === 'legendary');
}

/** 自动结束前的缓冲——留 700ms 给玩家反悔（用丹药、看局面）。 */
export const AUTO_END_DELAY_MS = 700;

/**
 * playCard 结算完要不要挂自动结束的定时器：开着 autoEndTurn、仍在玩家
 * 阶段、没有悬而未决的选牌、手里再无可打的牌。`pendingChoice` 单独列出
 * 不是废笔：`canPlay` 在选牌悬置时对每张牌都答否，没有这一格，一张
 * 「弃 2 张」还没弃完的牌就会看着满手好牌替玩家把回合按掉。
 */
export function shouldAutoEndTurn(state: CombatState): boolean {
  if (!getSettings().autoEndTurn) return false;
  if (state.phase !== 'player' || state.pendingChoice) return false;
  return !hasPlayableCard(state);
}
