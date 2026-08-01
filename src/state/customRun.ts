import { COLORLESS_POOL, poolFor } from '../combat/cards';
import { CURSE_POOL } from '../combat/curses';
import type { HeroDef } from '../data/heroes';
import { addCard, addCurse, startRun, type RunState } from './run';

/**
 * 自定义模式 (todos/23 u5) — 指定种子 + 开关 modifier 的一局，不计分不解锁。
 *
 * 规则全在这一个纯函数里，场景（`CustomScene`）只管收集输入：约定 8 的分工，
 * 也让「同 seed 同配置两局逐字一致」可以在 Node 下直接测。
 *
 * 不掷骰子、不读钟：种子原样递给 `startRun`，modifier 逐张按声明序入组
 * （`poolFor` / `COLORLESS_POOL` / `CURSE_POOL` 的顺序都是 append-only 的），
 * 所以自定义局和普通局一样，一个 seed 就能整局复现。
 *
 * todo 草稿里的四个 modifier 砍掉两个，理由（实现步骤 7 授权「做不起的砍掉」）：
 * - `infiniteEnergy`：气是引擎（`startTurn` 回气、`playCard` 扣气）的账，
 *   要么改引擎要么每回合从场景外挂补气——前者动纯函数层，后者是第二事实源；
 * - `noRelics`：宝物有五扇门（战利品 / 精英 / 首领匣 / 坊市 / 奇遇），
 *   全部设闸等于把 05/06/10 各改一遍，这一条 todo 背不动。
 */
export interface CustomRunConfig {
  /** null / 空串 = 随机种子（`generateMap` 自己 `randomSeed()`）。 */
  seed: string | null;
  /** 自定义局不计分，天命任选——不受 `maxSelectableAscension` 的门限制。 */
  ascension: number;
  modifiers: {
    /** 十全武库：开局把本将全部可获得牌 + 全部无色牌各入组一张。 */
    startWithAllCards?: boolean;
    /** 业障缠身：开局背上 `CURSE_POOL` 的全部诅咒（宿业走天命十重，不在此列）。 */
    allCurses?: boolean;
  };
}

/** 界面输入的收口：去首尾空白，空串归 null（= 随机）。 */
export function normaliseSeed(input: string): string | null {
  const seed = input.trim();
  return seed === '' ? null : seed;
}

/**
 * 开一局自定义局。`startRun` 原样打底（同 seed 与普通局同一张图），
 * 然后盖 `custom` 章、按 modifier 逐张改组——全程零随机，见文件头。
 */
export function startCustomRun(hero: HeroDef, config: CustomRunConfig): RunState {
  const run = startRun(hero, config.seed ?? undefined, config.ascension);
  run.custom = true;

  if (config.modifiers.startWithAllCards) {
    // 本将三档奖池 + 无色牌，声明序各一张。basic 的起手牌 `startingDeck`
    // 已经带着，不再重复。
    for (const rarity of ['common', 'uncommon', 'rare'] as const) {
      for (const id of poolFor(hero.id, rarity)) addCard(run, id);
    }
    for (const id of COLORLESS_POOL) addCard(run, id);
  }

  if (config.modifiers.allCurses) {
    for (const id of CURSE_POOL) addCurse(run, id);
  }

  return run;
}
