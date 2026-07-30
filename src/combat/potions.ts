import { C } from '../config';
import { STATUS_META } from './statuses';
import type { Rng } from '../core/rng';
import type { Effect } from './types';

/**
 * 丹药 — one-shot consumables. Free to use: no 气, no play limit, gone after.
 * Their job is variance insurance, so the common tier is deliberately
 * unexciting and always applicable while the rare tier is what actually wins a
 * losing fight.
 *
 * Effects are the card `Effect` union on purpose — a potion routes through
 * `applyEffect` so 神力 / 怯战 / 破绽 interact identically for cards and potions.
 * Only what the union genuinely cannot express gets a `special`, and there are
 * exactly three of those.
 *
 * No Phaser here — this is rules data.
 */

export type PotionRarity = 'common' | 'uncommon' | 'rare';

/** Behaviour the `Effect` union genuinely cannot express. Exactly three. */
export type PotionSpecial = 'reviveOnce' | 'cleanseDebuffs' | 'duplicateHand';

/** What 回天丹 pays back. Read by both its face and `usePotion`. */
export const REVIVE_HP = 25;

export interface PotionDef {
  id: string;
  name: string;
  rarity: PotionRarity;
  /** Texture key. The potion belt draws a procedural stand-in until art lands. */
  art: string;
  /** Tint for that stand-in and for the use flash, from the shared palette. */
  color: number;
  /** Rules text. `{D}` / `{B}` follow the card convention, see `potionText`. */
  text: string;
  /** Whether the player has to pick an enemy first. */
  target: 'enemy' | 'self' | 'none';
  /** Usable on the map, outside a fight. */
  usableOutOfCombat: boolean;
  effects: Effect[];
  special?: PotionSpecial;
}

// ------------------------------------------------------------------ the table

export const POTIONS: Record<string, PotionDef> = {
  // --- common ------------------------------------------------------------
  /**
   * The yardstick. 20 is ~3 劈砍 for no 气 and no card — a real turn's worth —
   * yet only 13% of 吕布, so it opens a window rather than closing a fight.
   * Every other damage number in this table is priced against it.
   */
  huoyouguan: {
    id: 'huoyouguan',
    name: '火油罐',
    rarity: 'common',
    art: 'potion-huoyouguan',
    color: C.cinnabarBright,
    text: '对目标造成 {D} 点伤害。',
    target: 'enemy',
    usableOutOfCombat: false,
    effects: [{ kind: 'damage', amount: 20 }],
  },

  /** 12 is one 方天画戟 (16) minus a card — enough to matter, not to trivialise. */
  tiejiasan: {
    id: 'tiejiasan',
    name: '铁甲散',
    rarity: 'common',
    art: 'potion-tiejiasan',
    color: C.paperDim,
    text: '获得 {B} 点护甲。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [{ kind: 'block', amount: 12 }],
  },

  zhuangxingjiu: {
    id: 'zhuangxingjiu',
    name: '壮行酒',
    rarity: 'common',
    art: 'potion-zhuangxingjiu',
    color: C.goldBright,
    text: '本回合获得 2 点气。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [{ kind: 'energy', amount: 2 }],
  },

  junqingmibao: {
    id: 'junqingmibao',
    name: '军情密报',
    rarity: 'common',
    art: 'potion-junqingmibao',
    color: C.paper,
    text: '抽 3 张牌。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [{ kind: 'draw', amount: 3 }],
  },

  /** Potion colours quote the status they deal, so the belt reads at a glance. */
  jiejiasan: {
    id: 'jiejiasan',
    name: '解甲散',
    rarity: 'common',
    art: 'potion-jiejiasan',
    color: STATUS_META.vulnerable.color,
    text: '施加 3 层【破绽】。',
    target: 'enemy',
    usableOutOfCombat: false,
    effects: [{ kind: 'status', status: 'vulnerable', amount: 3, to: 'target' }],
  },

  mihunsan: {
    id: 'mihunsan',
    name: '迷魂散',
    rarity: 'common',
    art: 'potion-mihunsan',
    color: STATUS_META.weak.color,
    text: '施加 3 层【怯战】。',
    target: 'enemy',
    usableOutOfCombat: false,
    effects: [{ kind: 'status', status: 'weak', amount: 3, to: 'target' }],
  },

  /**
   * 16 ≈ two成 of 关羽's 82. Flat rather than a percentage: every other number
   * the player reads is flat, and a 玄甲 pickup only shifts this by one point.
   */
  xumintang: {
    id: 'xumintang',
    name: '续命汤',
    rarity: 'common',
    art: 'potion-xumintang',
    color: C.jade,
    text: '回复 16 点体力。\n行军途中亦可服。',
    target: 'self',
    usableOutOfCombat: true,
    effects: [{ kind: 'heal', amount: 16 }],
  },

  // --- uncommon ----------------------------------------------------------
  /**
   * Priced above 火油罐 despite the smaller printed number: 神力 pays out once
   * per attack for the rest of the fight, so against 吕布's ~8 turns 2 层 is
   * worth well past 20 damage in a deck that swings three times a turn.
   */
  hulangzhiyao: {
    id: 'hulangzhiyao',
    name: '虎狼之药',
    rarity: 'uncommon',
    art: 'potion-hulangzhiyao',
    color: STATUS_META.strength.color,
    text: '获得 2 层【神力】。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [{ kind: 'status', status: 'strength', amount: 2, to: 'self' }],
  },

  /**
   * The block rider exists so this is never a dead slot: 破绽/怯战 tick down on
   * their own, and a potion that reads "does nothing this fight" is worse than
   * no drop at all for a system meant to cut variance.
   */
  qingxinsan: {
    id: 'qingxinsan',
    name: '清心散',
    rarity: 'uncommon',
    art: 'potion-qingxinsan',
    color: C.paper,
    text: '解除自身所有负面状态。\n获得 {B} 点护甲。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [{ kind: 'block', amount: 6 }],
    special: 'cleanseDebuffs',
  },

  /**
   * 12 to everyone: worse than 火油罐 on the boss, twice as good on the
   * two-enemy encounters, which is exactly the trade an uncommon should ask you
   * to read.
   */
  tiejili: {
    id: 'tiejili',
    name: '铁蒺藜',
    rarity: 'uncommon',
    art: 'potion-tiejili',
    color: C.cinnabar,
    text: '对所有敌人造成 {D} 点伤害。',
    target: 'none',
    usableOutOfCombat: false,
    effects: [{ kind: 'damageAll', amount: 12 }],
  },

  /** 12 + 3 层【破绽】 lands near 火油罐's 20 once the follow-up swings cash in. */
  cuidujian: {
    id: 'cuidujian',
    name: '淬毒箭',
    rarity: 'uncommon',
    art: 'potion-cuidujian',
    color: C.blood,
    text: '造成 {D} 点伤害。\n施加 3 层【破绽】。',
    target: 'enemy',
    usableOutOfCombat: false,
    effects: [
      { kind: 'damage', amount: 12 },
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'target' },
    ],
  },

  jinnang: {
    id: 'jinnang',
    name: '锦囊',
    rarity: 'uncommon',
    art: 'potion-jinnang',
    color: C.gold,
    text: '抽 2 张牌。\n本回合获得 1 点气。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [
      { kind: 'draw', amount: 2 },
      { kind: 'energy', amount: 1 },
    ],
  },

  queyuezhen: {
    id: 'queyuezhen',
    name: '却月阵',
    rarity: 'uncommon',
    art: 'potion-queyuezhen',
    color: C.jade,
    text: '获得 {B} 点护甲。\n抽 1 张牌。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [
      { kind: 'block', amount: 18 },
      { kind: 'draw', amount: 1 },
    ],
  },

  // --- rare --------------------------------------------------------------
  /**
   * Double 虎狼之药. Held for the boss it is the single largest swing in the
   * table, which is what "rare" should feel like; used on 山贼 it is wasted.
   */
  wushisan: {
    id: 'wushisan',
    name: '五石散',
    rarity: 'rare',
    art: 'potion-wushisan',
    color: C.goldBright,
    text: '获得 4 层【神力】。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [{ kind: 'status', status: 'strength', amount: 4, to: 'self' }],
  },

  /**
   * Copies are hand-only and 手牌上限 10 caps the payoff, so this is a big turn
   * rather than an infinite: on a full 5-card hand it is roughly one free turn.
   */
  mengdexinshu: {
    id: 'mengdexinshu',
    name: '孟德新书',
    rarity: 'rare',
    art: 'potion-mengdexinshu',
    color: C.paper,
    text: '手中每张牌各复制一张。',
    target: 'self',
    usableOutOfCombat: false,
    effects: [],
    special: 'duplicateHand',
  },

  /**
   * 25 ≈ three成 of 82, and it only refunds a death — it never prevents the
   * chip damage on the way there, so it buys about one extra 吕布 turn.
   */
  huitiandan: {
    id: 'huitiandan',
    name: '回天丹',
    rarity: 'rare',
    art: 'potion-huitiandan',
    color: C.cinnabarBright,
    text: `本场战斗中受到致命伤时，\n改为回复 ${REVIVE_HP} 点体力。仅一次。`,
    target: 'self',
    usableOutOfCombat: false,
    effects: [],
    special: 'reviveOnce',
  },
};

// ----------------------------------------------------------------- drop pools

const idsOfRarity = (rarity: PotionRarity): string[] =>
  Object.values(POTIONS)
    .filter((p) => p.rarity === rarity)
    .map((p) => p.id);

export const POTION_POOL_BY_RARITY: Record<PotionRarity, string[]> = {
  common: idsOfRarity('common'),
  uncommon: idsOfRarity('uncommon'),
  rare: idsOfRarity('rare'),
};

/** Weights for which tier a drop rolls, once a drop has been decided. */
export const POTION_RARITY_WEIGHTS: Record<PotionRarity, number> = {
  common: 65,
  uncommon: 25,
  rare: 10,
};

/**
 * Drop-rate bookkeeping. `chance` drifts so a dry streak self-corrects: a drop
 * costs `step`, a miss refunds it, clamped to [min, max].
 */
export const POTION_DROP = {
  start: 40,
  step: 10,
  min: 0,
  max: 100,
  /** Elites always pay out; bosses pay in relics instead. */
  elite: 100,
  boss: 0,
} as const;

/** Next `potionChance` after a monster fight resolved with `dropped`. */
export const nextPotionChance = (chance: number, dropped: boolean): number =>
  Math.max(
    POTION_DROP.min,
    Math.min(POTION_DROP.max, chance + (dropped ? -POTION_DROP.step : POTION_DROP.step)),
  );

// -------------------------------------------------------------------- lookups

export const getPotion = (id: string): PotionDef => {
  const def = POTIONS[id];
  if (!def) throw new Error(`Unknown potion id: ${id}`);
  return def;
};

const RARITY_ORDER: PotionRarity[] = ['common', 'uncommon', 'rare'];

export function rollPotion(rng: Rng): string {
  const rarity = rng.weighted(
    RARITY_ORDER,
    RARITY_ORDER.map((r) => POTION_RARITY_WEIGHTS[r]),
  );
  return rng.pick(POTION_POOL_BY_RARITY[rarity]);
}

export const potionsOfRarity = (rarity: PotionRarity): PotionDef[] =>
  POTION_POOL_BY_RARITY[rarity].map(getPotion);

/** Potions the map screen may offer as usable. */
export const outOfCombatPotions = (ids: readonly (string | null)[]): string[] =>
  ids.filter((id): id is string => !!id && getPotion(id).usableOutOfCombat);

/**
 * Display text with the potion's own numbers substituted, mirroring `relicText`.
 * `{D}` is the first damage effect and `{B}` the first block one — the same
 * contract card faces use, so a number can only be edited in one place.
 *
 * Printed values, not live ones: the belt is read on the map as often as in a
 * fight, and a tooltip that folds in 神力 on one screen and not the other is
 * worse than one that is honestly printed on both.
 */
export function potionText(def: PotionDef): string {
  const damage = def.effects.find((e) => e.kind === 'damage' || e.kind === 'damageAll');
  const block = def.effects.find((e) => e.kind === 'block');
  return def.text
    .replace(/\{D\}/g, String(damage && 'amount' in damage ? damage.amount : 0))
    .replace(/\{B\}/g, String(block && 'amount' in block ? block.amount : 0));
}
