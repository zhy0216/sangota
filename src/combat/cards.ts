import { C } from '../config';
import { CURSES, NEGATIVE_TYPE_META, STATUS_CARDS } from './curses';
import type { CardDef, CardRarity, CardType } from './types';

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

  // --- Pool expansion (todos/11) ------------------------------------------
  /*
   * 13 cards taking 关羽 from 11 to 24. Balance is white-boxed against the
   * three printed baselines — 劈砍 1气/6伤, 铁壁 1气/5甲, 结营 2气/14甲 — i.e.
   * roughly 6 damage or 5–7 block per 气 at basic rarity. Anything above that
   * rate here pays for it with a keyword, a condition, or 体力.
   */

  /**
   * Printed at 劈砍's rate; the payoff branch doubles it. `then` / `otherwise`
   * rather than a bonus damage effect on purpose — one damage instance resolves
   * either way, so 神力 is counted once and the face can print an honest {D}.
   */
  dandaofuhui: {
    id: 'dandaofuhui',
    name: '单刀赴会',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-dandaofuhui',
    text: '造成 {D} 点伤害。\n若手牌已空，改为 12 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'handEmpty' },
        then: [{ kind: 'damage', amount: 12 }],
        otherwise: [{ kind: 'damage', amount: 6 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若手牌已空，改为 16 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'handEmpty' },
          then: [{ kind: 'damage', amount: 16 }],
          otherwise: [{ kind: 'damage', amount: 8 }],
        },
      ],
    },
  },

  /**
   * Twice 铁壁's block for the same 气. 虚无 is the whole price: it is only ever
   * worth a card if the enemy is swinging the turn you draw it.
   */
  huarongdao: {
    id: 'huarongdao',
    name: '华容道',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-huarongdao',
    text: '获得 {B} 点护甲。',
    effects: [{ kind: 'block', amount: 10 }],
    keywords: ['ethereal'],
    upgrade: { effects: [{ kind: 'block', amount: 13 }] },
  },

  /** The mirror of 华容道: barely above 铁壁's rate, but it waits for the turn it matters. */
  bingzhudadan: {
    id: 'bingzhudadan',
    name: '秉烛达旦',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-bingzhudadan',
    text: '获得 {B} 点护甲。',
    effects: [{ kind: 'block', amount: 7 }],
    keywords: ['retain'],
    upgrade: { effects: [{ kind: 'block', amount: 10 }] },
  },

  /**
   * 观阵 with the draw guaranteed on turn one instead of repeatable. 消耗 is
   * upside as much as cost here — it thins the deck for the rest of the fight.
   */
  yeduchunqiu: {
    id: 'yeduchunqiu',
    name: '夜读春秋',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-yeduchunqiu',
    text: '抽 2 张牌。',
    effects: [{ kind: 'draw', amount: 2 }],
    keywords: ['innate', 'exhaust'],
    upgrade: {
      text: '抽 3 张牌。',
      effects: [{ kind: 'draw', amount: 3 }],
    },
  },

  /**
   * 10 per enemy against 万人敌's 8 for the same 气, but split in two: each hit
   * takes 神力 separately, and each floors 怯战/破绽 on its own, so the printed
   * total is lower than 万人敌 the moment either side is scaled down.
   */
  shuiyanqijun: {
    id: 'shuiyanqijun',
    name: '水淹七军',
    type: 'attack',
    rarity: 'uncommon',
    cost: 2,
    target: 'all',
    art: 'card-shuiyanqijun',
    text: '对所有敌人造成 {D} 点伤害 {T} 次。\n若敌人不少于 2 名，抽 1 张牌。',
    effects: [
      { kind: 'damageAll', amount: 5, times: 2 },
      {
        kind: 'conditional',
        when: { c: 'enemyCountAtLeast', n: 2 },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
    upgrade: {
      effects: [
        { kind: 'damageAll', amount: 7, times: 2 },
        {
          kind: 'conditional',
          when: { c: 'enemyCountAtLeast', n: 2 },
          then: [{ kind: 'draw', amount: 1 }],
        },
      ],
    },
  },

  /**
   * 9 for 1 气 is above rate, and free when the 破绽 is already on. That refund
   * costs a whole card to set up (拖刀计 / 温酒斩 / 虚招), which is what keeps
   * it out of rare — undirected it is a slightly fat 劈砍.
   */
  zhanyanliang: {
    id: 'zhanyanliang',
    name: '斩颜良',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-zhanyanliang',
    text: '造成 {D} 点伤害。\n若目标有【破绽】，获得 1 点气。',
    effects: [
      { kind: 'damage', amount: 9 },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'vulnerable' },
        then: [{ kind: 'energy', amount: 1 }],
      },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 12 },
        {
          kind: 'conditional',
          when: { c: 'targetHasStatus', status: 'vulnerable' },
          then: [{ kind: 'energy', amount: 1 }],
        },
      ],
    },
  },

  /**
   * X 费. 5 per 气 is under 劈砍's rate on purpose: the card's real payment is
   * that every repetition takes 神力 and the starter relic's bonus in full, so
   * at 3 神力 a 3 气 cast already beats three 劈砍 while spending two fewer
   * cards. Dead on a 0 气 board — that is the cost of the flexibility.
   */
  hulaoguan: {
    id: 'hulaoguan',
    name: '虎牢关',
    type: 'attack',
    rarity: 'uncommon',
    // X_COST. `playCard` drains 气 and `scaleWithEnergy` reads back what it spent.
    cost: -1,
    target: 'enemy',
    art: 'card-hulaoguan',
    text: '消耗全部气。\n每 1 点气造成 {D} 点伤害。',
    effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 5 }] }],
    upgrade: {
      effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 7 }] }],
    },
  },

  /**
   * Three terms, three lines. Net +2 气 and +2 cards for 5 体力 — priced off a
   * 82 体力 pool where the hero's problem is almost always tempo, not the bar.
   * The upgrade buys back 体力 rather than adding effect, so it never becomes a
   * free turn.
   */
  tushanyuesanshi: {
    id: 'tushanyuesanshi',
    name: '土山约三事',
    type: 'skill',
    rarity: 'uncommon',
    cost: 0,
    target: 'self',
    art: 'card-tushanyuesanshi',
    text: '失去 5 点体力。\n获得 2 点气。\n抽 2 张牌。',
    effects: [
      { kind: 'loseHp', amount: 5 },
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 2 },
    ],
    upgrade: {
      text: '失去 3 点体力。\n获得 2 点气。\n抽 2 张牌。',
      effects: [
        { kind: 'loseHp', amount: 3 },
        { kind: 'energy', amount: 2 },
        { kind: 'draw', amount: 2 },
      ],
    },
  },

  /**
   * 12 damage for 1 气, deferred: the three 白马义从 are 0 气 each, so they all
   * land the same turn if 气 allows, but each is a separate attack instance and
   * therefore takes 神力 three times over. Upgraded that is 21 before 神力,
   * which is why the card exhausts.
   *
   * The copies live in `state.cards` only — `run.deck` never sees them.
   */
  wubaijiaodaoshou: {
    id: 'wubaijiaodaoshou',
    name: '五百校刀手',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-wubaijiaodaoshou',
    text: '将 3 张「白马义从」置入手牌。',
    effects: [{ kind: 'addCard', defId: 'baima', count: 3, to: 'hand' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '将 3 张「白马义从·精」置入手牌。',
      effects: [{ kind: 'addCard', defId: 'baima', count: 3, to: 'hand', upgraded: 1 }],
    },
  },

  /**
   * 调息 4 pays out 4+3+2+1 = 10 体力 across four turns, so the card is worth
   * +7 in a long fight and a straight loss in a short one. Deliberately the
   * only sustain in the pool that is not a relic.
   */
  guaguliaodu: {
    id: 'guaguliaodu',
    name: '刮骨疗毒',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-guaguliaodu',
    text: '失去 3 点体力。\n获得 4 层【调息】。',
    effects: [
      { kind: 'loseHp', amount: 3 },
      { kind: 'status', status: 'regen', amount: 4, to: 'self' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '失去 3 点体力。\n获得 5 层【调息】。',
      effects: [
        { kind: 'loseHp', amount: 3 },
        { kind: 'status', status: 'regen', amount: 5, to: 'self' },
      ],
    },
  },

  /**
   * 1 层【蓄势】 is half what the genre usually prints on a 3 气 scaling power,
   * and that is intentional: this pool has three cards that hit more than once
   * per play (水淹七军, 五百校刀手, 虎牢关), so a point of 神力 is worth two to
   * three damage a turn here rather than one.
   */
  weizhenhuaxia: {
    id: 'weizhenhuaxia',
    name: '威震华夏',
    type: 'power',
    rarity: 'rare',
    cost: 3,
    target: 'self',
    art: 'card-weizhenhuaxia',
    text: '获得 1 层【蓄势】。',
    effects: [{ kind: 'status', status: 'ritual', amount: 1, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 2 层【蓄势】。',
      effects: [{ kind: 'status', status: 'ritual', amount: 2, to: 'self' }],
    },
  },

  /**
   * The build-around. Cheap because it is conditional on the room: dead against
   * a lone boss, +4 神力 by the time a three-enemy room is half cleared, and it
   * reads the same kill moment 枭首令 already hooks. That spread is the rare —
   * the deck either wants wide rooms or it does not.
   */
  wuguanliujiang: {
    id: 'wuguanliujiang',
    name: '五关六将',
    type: 'power',
    rarity: 'rare',
    cost: 1,
    target: 'self',
    art: 'card-wuguanliujiang',
    text: '获得 2 层【斩将】。',
    effects: [{ kind: 'status', status: 'slayer', amount: 2, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【斩将】。',
      effects: [{ kind: 'status', status: 'slayer', amount: 3, to: 'self' }],
    },
  },

  /**
   * Turns 结营's 14 甲 from a one-turn wall into a running total. 3 气 means it
   * cannot land before turn two even with 赤兔马, and it produces nothing by
   * itself — the whole cost is paid by the block cards it makes compound.
   */
  shengougaolei: {
    id: 'shengougaolei',
    name: '深沟高垒',
    type: 'power',
    rarity: 'rare',
    cost: 3,
    target: 'self',
    art: 'card-shengougaolei',
    text: '获得【深沟高垒】。',
    effects: [{ kind: 'status', status: 'barricade', amount: 1, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: { cost: 2 },
  },
};

/**
 * Every card the game can name. Curses and status cards live in here so
 * `getCard` resolves them and the piles can hold them — their exclusion from
 * rewards is enforced by rarity, not by a second table.
 */
export const CARDS: Record<string, CardDef> = { ...HERO_CARDS, ...CURSES, ...STATUS_CARDS };

/**
 * The reward pool, grouped by rarity — `rollCardReward` rolls a tier and then
 * picks inside it, which is the whole mechanism that makes 万人敌 rarer than
 * 白马义从.
 *
 * Keyed by `Exclude<CardRarity, 'basic'>`, so the three starters and every
 * curse and 状态牌 (all `basic`) are *structurally* unable to appear as loot.
 * That is a type error rather than a filter someone has to remember to write.
 */
export const CARD_POOL_BY_RARITY: Record<Exclude<CardRarity, 'basic'>, string[]> = {
  common: [
    'wenjiu',
    'quedi',
    'baima',
    'jieying',
    'guanzhen',
    'xuzhao',
    'dandaofuhui',
    'huarongdao',
    'bingzhudadan',
    'yeduchunqiu',
  ],
  uncommon: [
    'wanren',
    'yiyong',
    'shuiyanqijun',
    'zhanyanliang',
    'hulaoguan',
    'tushanyuesanshi',
    'wubaijiaodaoshou',
    'guaguliaodu',
  ],
  rare: ['weizhenhuaxia', 'wuguanliujiang', 'shengougaolei'],
};

/**
 * 无色 cards, which only the shop and events deal. Empty until todos/05 — the
 * export exists so `rollCardReward` has one place to widen rather than growing
 * a second pool shape later.
 */
export const COLORLESS_POOL: string[] = [];

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
