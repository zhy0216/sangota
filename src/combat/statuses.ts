import { C } from '../config';
import { addStatus, gainBlock, healCombatant, resolveDamage } from './engine';
import type { DamageContext } from './engine';
import type { Combatant, CombatState, StatusId, StatusMeta } from './types';

/**
 * 状态效果库 — every status is a row in one table, and the engine reads the
 * table rather than branching on ids. Adding a status must never mean adding an
 * `if` to the damage pipeline: a row declares which slot of the pipeline it
 * modifies, when it ticks, and how it decays, and that is the whole contract.
 *
 * No Phaser here, and no card data either — `cards.ts` re-exports `STATUS_META`
 * so the UI's import path does not move.
 */

export type StatusDecay =
  | 'none' // 永久（神力、身法、重甲、反刺、深沟高垒、蓄势、暴怒）
  | 'endOfTurn' // 拥有者回合结束 -1（破绽、怯战、力竭、金蝉脱壳）
  | 'tickDown' // 触发后自身 -1（中毒、调息）
  | 'consume' // 触发时消耗（护身符、天佑、龟缩）
  | 'clearAtTurnEnd'; // 拥有者回合结束时整层清零（断粮、束缚）

export type TickPhase = 'ownerTurnStart' | 'ownerTurnEnd';

/**
 * Where in the damage pipeline a modifier lands. `flat` and `attackerMult` read
 * the attacker's stacks, `defenderMult` and `clamp` the defender's — the
 * pipeline reads the slot and never the id.
 */
export type DamageSlot = 'flat' | 'attackerMult' | 'defenderMult' | 'clamp';

/** Where a pile of block came from. Only earned block is shaped by 身法/力竭. */
export type BlockSource = 'card' | 'power' | 'relic' | 'enemyMove';

export interface StatusDef extends StatusMeta {
  id: StatusId;
  decay: StatusDecay;
  /** Whether 护身符 intercepts this status when it is applied as a debuff. */
  blockable: boolean;
  /**
   * Whether the stack count is allowed below zero. 神力 and 身法 are the two
   * signed quantities in the game — a 削弱 effect on an enemy at 神力 2 must
   * leave it at -1, not at nothing, or "reduce N" silently under-applies. Every
   * other status is a count of layers and floors at zero.
   */
  signed?: boolean;
  /** Pure numeric hook into the damage pipeline. `n` is the stack count. */
  modify?: { slot: DamageSlot; fn: (n: number, damage: number) => number };
  /** Modifies block *gained*. Applied in `STATUS_ORDER`, so 身法 adds before 力竭 scales. */
  blockGain?: (n: number, amount: number) => number;
  /** Fires from `tickStatuses(state, owner, phase)`, before that status decays. */
  tick?: { phase: TickPhase; run: (state: CombatState, owner: Combatant, n: number) => void };
  /** Fires on the *defender* once an attack has fully resolved. */
  onAttacked?: (
    state: CombatState,
    owner: Combatant,
    ctx: DamageContext,
    hpLost: number,
    blocked: number,
  ) => void;
  /**
   * Fires on the player when any enemy drops, at the same moment the
   * `enemyKilled` relic hook does. Player-scoped because a kill is a thing that
   * happens *to* the fight, not to a combatant — there is no "the enemy that
   * died gets to react" case, and scoping it to the owner would make the
   * trigger depend on who landed the blow.
   */
  onEnemyKilled?: (state: CombatState, owner: Combatant, n: number) => void;
}

/**
 * The one iteration order in the game: damage slots, block modifiers, ticks,
 * decay, and the UI's pill row all walk this list. Two orderings are
 * load-bearing — 身法 before 力竭, so block reads "+dex, then ×0.75"; and the
 * three reactive statuses last, so 龟缩 soaks and 暴怒 swells before 反刺
 * throws the hit back.
 */
export const STATUS_ORDER: readonly StatusId[] = [
  'strength',
  'weak',
  'vulnerable',
  'dexterity',
  'frail',
  'intangible',
  'buffer',
  'artifact',
  'barricade',
  'poison',
  'regen',
  'metallicize',
  'ritual',
  'slayer',
  'noDraw',
  'entangled',
  'curlUp',
  'angry',
  'thorns',
];

/**
 * Off-palette status accents. `C` carries eight hues that stay legible on
 * `C.inkDeep`, which is not enough to keep 18 pills apart, so — following the
 * precedent 怯战 already set with its raw `0x8a7bb8` — the rest are named here
 * and hue-grouped by mechanic: stone tones = 护甲, cool pale = 规则改写,
 * warm = 伤害.
 */
const HUE = {
  weak: 0x8a7bb8, // unchanged: the existing 怯战 purple
  frail: 0x6e7f8c, // slate — 怯战 of the block half of the game
  poison: 0x7fa63c, // acid green, deliberately off C.jade
  regen: 0x6fbf9a, // mint: a brighter, kinder cousin of C.jade
  artifact: 0x86c9d6, // ward cyan
  intangible: 0xb9c6e0, // spectral, near-white
  buffer: 0xd8c2f0, // halo violet
  entangled: 0xa8763f, // hemp rope
  curlUp: 0x8fa07c, // shell olive
  angry: 0xe07a4a, // ember
} as const;

const VULNERABLE_MULT = 1.5;
const WEAK_MULT = 0.75;
const FRAIL_MULT = 0.75;

/**
 * `Record<StatusId, StatusDef>` and not a lookup that can miss: status #19 is a
 * compile error until its row exists, which is the entire reason this table is
 * worth having.
 */
export const STATUS_META: Record<StatusId, StatusDef> = {
  // --- 数值修饰 -----------------------------------------------------------
  vulnerable: {
    id: 'vulnerable',
    label: '破绽',
    desc: '受到的攻击伤害提高 50%。每回合结束减 1 层。',
    kind: 'debuff',
    color: C.cinnabarBright,
    icon: 'status-vulnerable',
    decay: 'endOfTurn',
    blockable: true,
    modify: { slot: 'defenderMult', fn: (_n, d) => Math.floor(d * VULNERABLE_MULT) },
  },
  weak: {
    id: 'weak',
    label: '怯战',
    desc: '造成的攻击伤害降低 25%。每回合结束减 1 层。',
    kind: 'debuff',
    color: HUE.weak,
    icon: 'status-weak',
    decay: 'endOfTurn',
    blockable: true,
    modify: { slot: 'attackerMult', fn: (_n, d) => Math.floor(d * WEAK_MULT) },
  },
  strength: {
    id: 'strength',
    label: '神力',
    desc: '每次攻击额外造成等量伤害。',
    kind: 'buff',
    color: C.goldBright,
    icon: 'status-strength',
    decay: 'none',
    blockable: false,
    signed: true,
    modify: { slot: 'flat', fn: (n, d) => d + n },
  },
  /**
   * Deliberately worded as 神力's mirror: flat per instance of block, not a
   * percentage, so 身法 3 + 铁壁 is 5+3=8.
   */
  dexterity: {
    id: 'dexterity',
    label: '身法',
    desc: '每次获得护甲时额外获得等量护甲。',
    kind: 'buff',
    color: C.jade,
    icon: 'status-dexterity',
    decay: 'none',
    blockable: false,
    signed: true,
    blockGain: (n, amount) => amount + n,
  },
  /** Multiplies after 身法 adds, hence floor(8×0.75)=6 rather than floor(5×0.75)+3. */
  frail: {
    id: 'frail',
    label: '力竭',
    desc: '获得的护甲降低 25%。每回合结束减 1 层。',
    kind: 'debuff',
    color: HUE.frail,
    icon: 'status-frail',
    decay: 'endOfTurn',
    blockable: true,
    blockGain: (_n, amount) => Math.floor(amount * FRAIL_MULT),
  },

  // --- 回合触发 -----------------------------------------------------------
  /**
   * Says 无视护甲 out loud because that is the whole reason to draft poison: it
   * is the one source of damage a 深沟高垒 wall cannot answer. Resolves at turn
   * start *after* block is cleared, so a stack never eats the clear.
   */
  poison: {
    id: 'poison',
    label: '中毒',
    desc: '回合开始时失去等量体力（无视护甲），随后减 1 层。',
    kind: 'debuff',
    color: HUE.poison,
    icon: 'status-poison',
    decay: 'tickDown',
    blockable: true,
    tick: {
      phase: 'ownerTurnStart',
      run: (state, owner, n) => {
        resolveDamage(state, {
          attacker: null,
          defender: owner,
          base: n,
          isAttack: false,
          pierceBlock: true,
        });
      },
    },
  },
  /** End of turn, not start — 调息 N heals N+(N-1)+…+1 over its life, so it prices high. */
  regen: {
    id: 'regen',
    label: '调息',
    desc: '回合结束时回复等量体力，随后减 1 层。',
    kind: 'buff',
    color: HUE.regen,
    icon: 'status-regen',
    decay: 'tickDown',
    blockable: false,
    tick: { phase: 'ownerTurnEnd', run: (state, owner, n) => healCombatant(state, owner, n) },
  },
  /** The block lands at turn end, so it survives into the enemy turn — that is the point. */
  metallicize: {
    id: 'metallicize',
    label: '重甲',
    desc: '回合结束时获得等量护甲。',
    kind: 'buff',
    color: C.paperDim,
    icon: 'status-metallicize',
    decay: 'none',
    blockable: false,
    tick: {
      phase: 'ownerTurnEnd',
      run: (state, owner, n) => gainBlock(state, owner, n, 'power'),
    },
  },
  /**
   * 每次 is load-bearing: a 3×4 multi-hit reflects four times, and a killing
   * blow reflects too — walking into a 反刺 holder costs the same whether or not
   * the swing finishes it. The reflected damage is not itself an attack, which
   * is what stops two 反刺 holders from bouncing a hit back and forth forever.
   */
  thorns: {
    id: 'thorns',
    label: '反刺',
    desc: '每次受到攻击时，对攻击者造成等量伤害。',
    kind: 'buff',
    color: C.cinnabar,
    icon: 'status-thorns',
    decay: 'none',
    blockable: false,
    onAttacked: (state, owner, ctx) => {
      const attacker = ctx.attacker;
      if (!attacker || attacker.hp <= 0) return;
      resolveDamage(state, {
        attacker: owner,
        defender: attacker,
        base: owner.statuses.thorns ?? 0,
        isAttack: false,
        pierceBlock: false,
      });
    },
  },
  /** Enemy-side engine: fires at that enemy's turn end, so the 神力 is live for its next attack. */
  ritual: {
    id: 'ritual',
    label: '蓄势',
    desc: '回合结束时获得等量【神力】。',
    kind: 'buff',
    color: C.gold,
    icon: 'status-ritual',
    decay: 'none',
    blockable: false,
    tick: { phase: 'ownerTurnEnd', run: (state, owner, n) => addStatus(state, owner, 'strength', n) },
  },
  /**
   * 五关六将's payoff. Worthless against a lone boss and worth +4 神力 halfway
   * through a three-enemy room, which is the spread that makes the card a rare
   * rather than a staple. Rides the same kill moment 枭首令 hooks.
   */
  slayer: {
    id: 'slayer',
    label: '斩将',
    desc: '每击杀一名敌人，获得等量【神力】。',
    kind: 'buff',
    color: C.blood,
    icon: 'status-slayer',
    decay: 'none',
    blockable: false,
    onEnemyKilled: (state, owner, n) => addStatus(state, owner, 'strength', n),
  },

  // --- 规则改写 -----------------------------------------------------------
  /**
   * Consumes one layer at the moment a debuff is applied, before that debuff
   * exists — so 破绽 2 costs one 护身符 layer, not two. Buffs pass through
   * untouched, which is why 抵消 is scoped to 负面状态 in the copy.
   */
  artifact: {
    id: 'artifact',
    label: '护身符',
    desc: '抵消下一次加于己身的负面状态，每抵消一次减 1 层。',
    kind: 'buff',
    color: HUE.artifact,
    icon: 'status-artifact',
    decay: 'consume',
    blockable: false,
  },
  /** Layers are meaningless — grant exactly 1 and let the pill read as a flag. */
  barricade: {
    id: 'barricade',
    label: '深沟高垒',
    desc: '护甲不再于回合开始时清零。',
    kind: 'buff',
    color: C.paper,
    icon: 'status-barricade',
    decay: 'none',
    blockable: false,
  },
  /**
   * 一切 covers 中毒 and reflected damage too, and the clamp lands *before*
   * block — so 金蝉脱壳 plus 5 护甲 against a 30-damage 巨斧 costs one point of
   * block and no HP at all. Clamping after block would instead eat the wall.
   */
  intangible: {
    id: 'intangible',
    label: '金蝉脱壳',
    desc: '受到的一切伤害降为 1 点。每回合结束减 1 层。',
    kind: 'buff',
    color: HUE.intangible,
    icon: 'status-intangible',
    decay: 'endOfTurn',
    blockable: false,
    modify: { slot: 'clamp', fn: (_n, d) => Math.min(d, 1) },
  },
  /** Eats the HP loss after block, so a layer spent on a 1-damage chip is wasted — by design. */
  buffer: {
    id: 'buffer',
    label: '天佑',
    desc: '抵消下一次体力损失，每抵消一次减 1 层。',
    kind: 'buff',
    color: HUE.buffer,
    icon: 'status-buffer',
    decay: 'consume',
    blockable: false,
  },
  /**
   * Cleared at the owner's turn *end*, not its start. Both of these exist to be
   * applied by an enemy during the enemy turn and to bite on the player's next
   * turn — clearing at turn start would delete them before the player ever drew
   * a card or looked at their hand, i.e. a guaranteed no-op.
   */
  noDraw: {
    id: 'noDraw',
    label: '断粮',
    desc: '本回合无法抽牌，回合结束时清除。',
    kind: 'debuff',
    color: C.paperFaint,
    icon: 'status-noDraw',
    decay: 'clearAtTurnEnd',
    blockable: true,
  },
  entangled: {
    id: 'entangled',
    label: '束缚',
    desc: '本回合无法打出【攻】牌，回合结束时清除。',
    kind: 'debuff',
    color: HUE.entangled,
    icon: 'status-entangled',
    decay: 'clearAtTurnEnd',
    blockable: true,
  },

  // --- 敌人专属 -----------------------------------------------------------
  /**
   * The stack count *is* the block granted, so triggering clears 龟缩 whole
   * rather than taking one layer off it — otherwise 龟缩 9 would fire nine
   * times. The block lands after the hit resolves, so it guards the next one.
   *
   * 受到伤害 and not merely 受到攻击: a hit the owner fully blocked cost it
   * nothing, and a corpse does not curl up. 反刺 is the one reaction that fires
   * unconditionally.
   */
  curlUp: {
    id: 'curlUp',
    label: '龟缩',
    desc: '受到伤害时获得等量护甲，随后消失。',
    kind: 'buff',
    color: HUE.curlUp,
    icon: 'status-curlUp',
    decay: 'consume',
    blockable: false,
    onAttacked: (state, owner, _ctx, hpLost) => {
      if (hpLost <= 0 || owner.hp <= 0) return;
      const n = owner.statuses.curlUp ?? 0;
      delete owner.statuses.curlUp;
      gainBlock(state, owner, n, 'power');
    },
  },
  /** Only attacks that drew blood feed it — chip damage and 反刺 must not, or the fight spirals. */
  angry: {
    id: 'angry',
    label: '暴怒',
    desc: '每次受到伤害后获得等量【神力】。',
    kind: 'buff',
    color: HUE.angry,
    icon: 'status-angry',
    decay: 'none',
    blockable: false,
    onAttacked: (state, owner, _ctx, hpLost) => {
      if (hpLost <= 0 || owner.hp <= 0) return;
      addStatus(state, owner, 'strength', owner.statuses.angry ?? 0);
    },
  },
};
