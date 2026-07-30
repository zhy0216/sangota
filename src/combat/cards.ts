import { C } from '../config';
import { CURSES, NEGATIVE_TYPE_META, STATUS_CARDS } from './curses';
import type { CardDef, CardType } from './types';

/**
 * Status rules and copy live in `statuses.ts`; they are re-exported here so the
 * UI keeps one import path for "everything printed on a card or a pill".
 */
export { STATUS_META, STATUS_ORDER } from './statuses';
export type { StatusDef } from './statuses';

/** Keyword copy for the strip along the bottom of a card face. */
export const KEYWORD_LABEL = {
  exhaust: '消耗',
  ethereal: '虚无',
  innate: '固有',
  retain: '保留',
  unplayable: '不可打出',
} as const;

export const CARD_TYPE_META: Record<CardType, { label: string; color: number }> = {
  attack: { label: '攻', color: C.cinnabar },
  skill: { label: '谋', color: C.jade },
  power: { label: '势', color: C.gold },
  // 咒 / 厄, defined with the cards they frame.
  ...NEGATIVE_TYPE_META,
};

/** 关羽's own pool. Curses and status cards are merged in below, not here. */
const HERO_CARDS: Record<string, CardDef> = {
  // --- Guan Yu's starting deck -------------------------------------------
  pikan: {
    id: 'pikan',
    name: '劈砍',
    type: 'attack',
    rarity: 'basic',
    cost: 1,
    target: 'enemy',
    art: 'card-pikan',
    text: '造成 {D} 点伤害。',
    effects: [{ kind: 'damage', amount: 6 }],
    upgrade: { effects: [{ kind: 'damage', amount: 9 }] },
  },
  tiebi: {
    id: 'tiebi',
    name: '铁壁',
    type: 'skill',
    rarity: 'basic',
    cost: 1,
    target: 'self',
    art: 'card-tiebi',
    text: '获得 {B} 点护甲。',
    effects: [{ kind: 'block', amount: 5 }],
    upgrade: { effects: [{ kind: 'block', amount: 8 }] },
  },
  tuodao: {
    id: 'tuodao',
    name: '拖刀计',
    type: 'attack',
    rarity: 'basic',
    cost: 2,
    target: 'enemy',
    art: 'card-tuodao',
    text: '造成 {D} 点伤害。\n施加 2 层【破绽】。',
    effects: [
      { kind: 'damage', amount: 8 },
      { kind: 'status', status: 'vulnerable', amount: 2, to: 'target' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n施加 3 层【破绽】。',
      effects: [
        { kind: 'damage', amount: 10 },
        { kind: 'status', status: 'vulnerable', amount: 3, to: 'target' },
      ],
    },
  },

  // --- Reward pool --------------------------------------------------------
  wenjiu: {
    id: 'wenjiu',
    name: '温酒斩',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-wenjiu',
    text: '造成 {D} 点伤害。\n施加 1 层【破绽】。',
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'status', status: 'vulnerable', amount: 1, to: 'target' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n施加 2 层【破绽】。',
      effects: [
        { kind: 'damage', amount: 10 },
        { kind: 'status', status: 'vulnerable', amount: 2, to: 'target' },
      ],
    },
  },
  wanren: {
    id: 'wanren',
    name: '万人敌',
    type: 'attack',
    rarity: 'uncommon',
    cost: 2,
    target: 'all',
    art: 'card-wanren',
    text: '对所有敌人造成 {D} 点伤害。',
    effects: [{ kind: 'damageAll', amount: 8 }],
    upgrade: { effects: [{ kind: 'damageAll', amount: 12 }] },
  },
  quedi: {
    id: 'quedi',
    name: '却敌',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-quedi',
    text: '获得 {B} 点护甲。\n抽 1 张牌。',
    effects: [
      { kind: 'block', amount: 8 },
      { kind: 'draw', amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: 'block', amount: 11 },
        { kind: 'draw', amount: 1 },
      ],
    },
  },
  yiyong: {
    id: 'yiyong',
    name: '义勇',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-yiyong',
    text: '获得 2 层【神力】。',
    effects: [{ kind: 'status', status: 'strength', amount: 2, to: 'self' }],
    // 势 cards leave the fight through the keyword like anything else — the
    // engine has no `type === 'power'` branch any more.
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【神力】。',
      effects: [{ kind: 'status', status: 'strength', amount: 3, to: 'self' }],
    },
  },
  baima: {
    id: 'baima',
    name: '白马义从',
    type: 'attack',
    rarity: 'common',
    cost: 0,
    target: 'enemy',
    art: 'card-baima',
    text: '造成 {D} 点伤害。',
    effects: [{ kind: 'damage', amount: 4 }],
    upgrade: { effects: [{ kind: 'damage', amount: 7 }] },
  },
  jieying: {
    id: 'jieying',
    name: '结营',
    type: 'skill',
    rarity: 'common',
    cost: 2,
    target: 'self',
    art: 'card-jieying',
    text: '获得 {B} 点护甲。',
    effects: [{ kind: 'block', amount: 14 }],
    upgrade: { cost: 1 },
  },
  guanzhen: {
    id: 'guanzhen',
    name: '观阵',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-guanzhen',
    text: '抽 2 张牌。',
    effects: [{ kind: 'draw', amount: 2 }],
    upgrade: {
      text: '抽 3 张牌。',
      effects: [{ kind: 'draw', amount: 3 }],
    },
  },
  xuzhao: {
    id: 'xuzhao',
    name: '虚招',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-xuzhao',
    text: '施加 2 层【怯战】。\n获得 {B} 点护甲。',
    effects: [
      { kind: 'status', status: 'weak', amount: 2, to: 'target' },
      { kind: 'block', amount: 4 },
    ],
    upgrade: {
      text: '施加 3 层【怯战】。\n获得 {B} 点护甲。',
      effects: [
        { kind: 'status', status: 'weak', amount: 3, to: 'target' },
        { kind: 'block', amount: 6 },
      ],
    },
  },
};

/**
 * Every card the game can name. Curses and status cards live in here so
 * `getCard` resolves them and the piles can hold them — their exclusion from
 * rewards is enforced by rarity, not by a second table.
 */
export const CARDS: Record<string, CardDef> = { ...HERO_CARDS, ...CURSES, ...STATUS_CARDS };

/** Cards that can show up as post-combat rewards. */
export const REWARD_POOL: string[] = [
  'wenjiu',
  'wanren',
  'quedi',
  'yiyong',
  'baima',
  'jieying',
  'guanzhen',
  'xuzhao',
];

export const getCard = (id: string): CardDef => {
  const def = CARDS[id];
  if (!def) throw new Error(`Unknown card id: ${id}`);
  return def;
};

/** Upgraded cards read "劈砍·精" — a mark, not just a colour, so it survives thumbnails. */
export const UPGRADE_SUFFIX = '·精';

const resolved = new Map<string, CardDef>();

/**
 * The definition a physical card actually plays by. Every reader of card data
 * goes through here, so an upgrade is applied in exactly one place.
 */
export function resolveCard(defId: string, upgraded = 0): CardDef {
  const base = getCard(defId);
  if (upgraded <= 0 || !base.upgrade) return base;

  const key = `${defId}+${upgraded}`;
  let def = resolved.get(key);
  if (!def) {
    def = { ...base, ...base.upgrade, name: base.name + UPGRADE_SUFFIX };
    delete def.upgrade;
    resolved.set(key, def);
  }
  return def;
}

/** Whether a physical card still has an upgrade left in it. */
export const canUpgrade = (defId: string, upgraded: number): boolean =>
  upgraded < 1 && !!CARDS[defId]?.upgrade;
