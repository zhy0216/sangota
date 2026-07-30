import { C } from '../config';
import { addGold, type RunState } from '../state/run';
import { addStatus, defOf, resolveDamage } from './engine';
import type { CardDef, CardType, CombatState } from './types';

/**
 * 诅咒与状态牌 — the deck's downside.
 *
 * Curses live in `run.deck` forever and are only shed through the removal
 * channels (商店弃卡 / 营帐弃甲 / 五丈原); status cards are minted into a fight
 * and die with it. Neither kind is ever rolled as a reward: both tables are
 * merged into `CARDS` so `getCard` resolves them, but they carry `basic` rarity
 * and the reward pool is keyed by `Exclude<CardRarity, 'basic'>`, so they are
 * structurally unable to appear as loot.
 *
 * Everything here is data. The engine gets four call sites (`drawCards`,
 * `endPlayerTurn`, `playCard`, `canPlay`) plus the run-aware
 * `resolveCombatEndHooks` below, and no per-card branches.
 */

// ------------------------------------------------------------------- tuning

/**
 * One number per card, referenced by both the rules text and the hook, so a
 * balance pass can never leave the face lying about what the card does.
 */
const TANNIAN_GOLD = 15;
const YIXIN_WEAK = 1;
const FANSHI_HP = 1;
const SUMING_LIMIT = 3;
const FENYING_DAMAGE = 2;
const ZUI_ENERGY = 1;

// ------------------------------------------------------------------ helpers

/**
 * HP loss that ignores 护甲 — 反噬 and 焚营 are rot, not blows, so a wall of
 * shields is no answer to them. Routed through the engine's one damage pipeline
 * rather than writing `hp` directly, so 金蝉脱壳 and 天佑 answer a curse exactly
 * the way they answer the `loseHp` effect a card would use.
 */
function loseHp(state: CombatState, amount: number): void {
  resolveDamage(state, {
    attacker: null,
    defender: state.player,
    base: amount,
    isAttack: false,
    pierceBlock: true,
  });
}

// ------------------------------------------------------------------- frames

/**
 * 咒 in dried blood, 厄 in faded ink — the two frames must read as "not yours"
 * at a glance, well before the text is legible. Merged into `CARD_TYPE_META`.
 */
export const NEGATIVE_TYPE_META: Record<
  Extract<CardType, 'curse' | 'status'>,
  { label: string; color: number }
> = {
  curse: { label: '咒', color: C.blood },
  status: { label: '厄', color: C.paperFaint },
};

// ------------------------------------------------------------------- curses

/**
 * Curses carry no `upgrade` key, which is exactly what makes them
 * unupgradable: `canUpgrade` already gates on `!!CARDS[defId]?.upgrade`, so the
 * 营帐 forge list drops them with no new rule.
 *
 * None of the six is unremovable. That is a deliberate release valve: every
 * curse here must be shakeable through 商店弃卡 / 营帐弃甲 / 五丈原, or the
 * player is just being punished.
 */
export const CURSES: Record<string, CardDef> = {
  /**
   * 黄金台 (todos/06) pays +120 资财 for this. At 15 per fight it turns a
   * windfall into a loan: roughly 8 fights to break even, so taking it early is
   * a real gamble and taking it late is nearly free — which is the decision the
   * event wants to sell.
   */
  tannian: {
    id: 'tannian',
    name: '贪念',
    type: 'curse',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-tannian',
    text: `不可打出。\n战斗结束时失去 ${TANNIAN_GOLD} 资财。`,
    effects: [],
    keywords: ['unplayable'],
    hooks: {
      // `addGold` clamps at zero and charges losses at face value — the 聚宝盆
      // multiplier lifts income only, so a relic can never make this bite harder.
      onCombatEnd: (_state, run) => {
        addGold(run, -TANNIAN_GOLD);
      },
    },
  },

  jiushang: {
    id: 'jiushang',
    name: '旧伤',
    type: 'curse',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-jiushang',
    text: '不可打出。',
    effects: [],
    keywords: ['unplayable'],
  },

  /**
   * The one curse that scales with a good deck: a thin, fast list draws it
   * often and eats 怯战 nearly every turn. One layer is enough — it lands after
   * the end-of-turn tick and so is live for the enemy swing.
   */
  yixin: {
    id: 'yixin',
    name: '疑心',
    type: 'curse',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-yixin',
    text: `不可打出。\n回合结束时获得 ${YIXIN_WEAK} 层【怯战】。`,
    effects: [],
    keywords: ['unplayable'],
    hooks: {
      onEndTurnInHand: (state) => {
        addStatus(state, state.player, 'weak', YIXIN_WEAK);
      },
    },
  },

  /** 铜雀台 (todos/10) shuffles this in. 虚无 makes it a one-turn tax per copy. */
  shemi: {
    id: 'shemi',
    name: '奢靡',
    type: 'curse',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-shemi',
    text: '不可打出。虚无。',
    effects: [],
    keywords: ['unplayable', 'ethereal'],
  },

  /**
   * The most expensive curse in the set and the reason it costs nothing else:
   * a 6-card turn pays 6 体力 with no way to shed it, so it converts tempo into
   * blood rather than merely clogging a hand.
   */
  fanshi: {
    id: 'fanshi',
    name: '反噬',
    type: 'curse',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-fanshi',
    text: `不可打出。\n还在手上时，每打出一张牌失去 ${FANSHI_HP} 点体力。`,
    effects: [],
    keywords: ['unplayable'],
    hooks: {
      // Fired once per card that actually resolved, never from `restrictPlay` —
      // that gate is queried per repaint, which would cost 1 体力 a frame.
      onCardPlayedInHand: (state) => {
        loseHp(state, FANSHI_HP);
      },
    },
  },

  /**
   * Three is chosen against a 3-气 baseline: it costs a normal turn nothing and
   * guts exactly the 0 费 chains (白马义从 / 观阵) that a built deck wins with.
   * A cap that also hurt the opening deck would read as unplayable, not as a curse.
   */
  suming: {
    id: 'suming',
    name: '宿命',
    type: 'curse',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-suming',
    text: `不可打出。\n本回合最多打出 ${SUMING_LIMIT} 张牌。`,
    effects: [],
    keywords: ['unplayable'],
    hooks: {
      restrictPlay: (state) => state.cardsPlayedThisTurn < SUMING_LIMIT,
    },
  },
};

// ------------------------------------------------------------- status cards

/**
 * Minted into a fight by enemies and effects, never written back: `run.deck` is
 * only ever touched by `addCard` on the run, which refuses this type outright.
 */
export const STATUS_CARDS: Record<string, CardDef> = {
  /**
   * 虚无 is what makes "然后消耗" work: the engine's end-of-turn pass already
   * sends ethereal cards to the 消耗堆 rather than the discard, so 焚营 burns
   * once and is gone instead of cycling. `exhaust` rides along per todo 14's
   * table and is inert — an unplayable card is never played.
   *
   * 2 点 is set against 焚营 arriving in twos: a stack of four is 8 体力 a turn,
   * enough to force the player to spend a turn cycling rather than swinging.
   */
  fenying: {
    id: 'fenying',
    name: '焚营',
    type: 'status',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-fenying',
    text: `不可打出。\n回合结束时受到 ${FENYING_DAMAGE} 点伤害，然后消耗。`,
    effects: [],
    keywords: ['unplayable', 'exhaust', 'ethereal'],
    hooks: {
      onEndTurnInHand: (state) => {
        loseHp(state, FENYING_DAMAGE);
      },
    },
  },

  /** 西凉铁骑's 扬尘 pushes two of these into the draw pile (todos/15). */
  chuangshang: {
    id: 'chuangshang',
    name: '创伤',
    type: 'status',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-chuangshang',
    text: '不可打出。',
    effects: [],
    keywords: ['unplayable'],
  },

  xuanyun: {
    id: 'xuanyun',
    name: '眩晕',
    type: 'status',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-xuanyun',
    text: '不可打出。虚无。',
    effects: [],
    keywords: ['unplayable', 'ethereal'],
  },

  /**
   * The only playable card in either table, and it does nothing on purpose: the
   * player chooses between one wasted 气 and one clogged hand slot. Both are
   * losses, which is the whole design — no hook, because burning the 气 *is*
   * the cost of playing it.
   */
  nining: {
    id: 'nining',
    name: '泥泞',
    type: 'status',
    rarity: 'basic',
    cost: 1,
    target: 'self',
    art: 'card-nining',
    text: '打出后消耗。',
    effects: [],
    keywords: ['exhaust'],
  },

  /**
   * 醉酒张飞 (todos/06) trades permanent 神力 for one of these in every opening
   * hand. Charged on draw rather than at end of turn so the loss lands while
   * the turn can still be replanned around it.
   */
  zui: {
    id: 'zui',
    name: '醉',
    type: 'status',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-zui',
    text: `不可打出。\n被抽到时失去 ${ZUI_ENERGY} 点气。`,
    effects: [],
    keywords: ['unplayable'],
    hooks: {
      // Floored at zero: drawn mid-turn on an empty pool it costs nothing, and
      // 气 must never go negative or the next turn starts in debt.
      onDrawn: (state) => {
        state.energy = Math.max(0, state.energy - ZUI_ENERGY);
      },
    },
  },
};

// ----------------------------------------------------------------- lookups

/** What events, relics and 李儒 may inflict. Every id here must be removable. */
export const CURSE_POOL: string[] = [
  'tannian',
  'jiushang',
  'yixin',
  'shemi',
  'fanshi',
  'suming',
];

/** What enemies and effects may mint into a fight. */
export const STATUS_POOL: string[] = ['fenying', 'chuangshang', 'xuanyun', 'nining', 'zui'];

export const isCurse = (def: CardDef): boolean => def.type === 'curse';
export const isStatus = (def: CardDef): boolean => def.type === 'status';

/** Neither kind belongs in the deck's working count, the forge, or a reward. */
export const isNegative = (def: CardDef): boolean => isCurse(def) || isStatus(def);

/**
 * The fourth hook point, kept out of `engine.ts` because it is the one that
 * needs `RunState` and the engine deliberately never sees it. Fired by the
 * scene on a win, alongside the `combatEnd` relic hook — a corpse pays no
 * debts, and on a loss the run is over anyway.
 *
 * Walks `run.deck` and not `state.cards`: the charge is the price of *owning*
 * the card, so a 贪念 that never came off the draw pile still bills, while a
 * throwaway copy 孟德新书 minted into the hand does not — that copy dies with
 * the fight and must not do permanent damage to the run.
 */
export function resolveCombatEndHooks(state: CombatState, run: RunState): void {
  for (const card of run.deck) {
    // A deck card the fight never saw — the scene always starts one from the
    // whole deck, so this only guards a caller that did not.
    if (!state.cards[card.uid]) continue;
    defOf(state, card.uid).hooks?.onCombatEnd?.(state, run);
  }
}
