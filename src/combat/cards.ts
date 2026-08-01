import { C } from '../config';
import { ZHAOYUN_CARDS, ZHUGELIANG_CARDS } from '../data/heroCards';
import { CURSES, NEGATIVE_TYPE_META, STATUS_CARDS } from './curses';
import type { CardDef, CardRarity, CardType } from './types';

/**
 * Status rules and copy live in `statuses.ts`; they are re-exported here so the
 * UI keeps one import path for "everything printed on a card or a pill".
 */
export { STATUS_META, STATUS_ORDER } from './statuses';
export type { StatusDef } from './statuses';

/** Same reason: "is this card one of the bad ones" is a question about a card. */
export { isCurse, isNegative, isStatus } from './curses';

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

/**
 * Stamps every card in a table with the hero it belongs to, so `CardDef.hero`
 * cannot drift from the table a card is actually declared in. Mutates the
 * literals at module scope and touches no other table (约定 7).
 */
function tagHero(hero: string, table: Record<string, CardDef>): Record<string, CardDef> {
  for (const def of Object.values(table)) def.hero = hero;
  return table;
}

/**
 * 关羽's own pool. Curses and status cards are merged in below, not here.
 *
 * **Declaration order is load-bearing and append-only.** `HERO_CARD_POOLS` is
 * derived from this table in declaration order, and a 商旅 shelf and a 战斗奖励
 * both index into those arrays off a seeded roll — re-ordering the table
 * re-deals every reward in every run that already exists.
 */
export const GUANYU_CARDS: Record<string, CardDef> = tagHero('guanyu', {
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
  /**
   * 2026-08 新手武将调参（见 pool expansion 段的说明）：8 → 11。原 8 点对单体
   * 是半张劈砍的效率，逐卡扫描量出 Δ胜率 −32——整个池最深的陷阱签。11 仍低于
   * 两张劈砍的 12，单体依旧亏，群战才回本，AoE 的身份没动。
   */
  wanren: {
    id: 'wanren',
    name: '万人敌',
    type: 'attack',
    rarity: 'uncommon',
    cost: 2,
    target: 'all',
    art: 'card-wanren',
    text: '对所有敌人造成 {D} 点伤害。',
    effects: [{ kind: 'damageAll', amount: 11 }],
    upgrade: { effects: [{ kind: 'damageAll', amount: 15 }] },
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
    effects: [{ kind: 'block', amount: 15 }],
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
   * three printed baselines — 劈砍 1气/6伤, 铁壁 1气/5甲, 结营 2气/15甲 — i.e.
   * roughly 6 damage or 5–7 block per 气 at basic rarity. Anything above that
   * rate here pays for it with a keyword, a condition, or 体力.
   *
   * ### 2026-08 新手武将调参
   *
   * 关羽是玩家的第一个武将，整局天命零重通关率要向 ~50% 靠（原 41%）。加成
   * 全部花在**抬高池底**上：`npm run eval` 的逐卡扫描标出 万人敌 −32、虎牢关
   * −15、水淹七军 −12、结营 −11、三张 rare 各 −9 —— 新手按直觉乱拿时，这些
   * 就是把一局拿输的签。天花板（土山约三事 +19、白马义从 +18）一张没动：
   * 上抬天花板是给熟手加速，抬底才是给新手兜底。改动逐张记在各卡注释里；
   * 万人敌 / 虎牢关 / 威震华夏 在 golden `wide` 牌组里，六份快照按 约定 3
   * 的内容型规程随本次调参重录。
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
   * 12 per enemy against 万人敌's 11 for the same 气, but split in two: each hit
   * takes 神力 separately, and each floors 怯战/破绽 on its own, so the printed
   * total is lower than 万人敌 the moment either side is scaled down.
   * （2026-08 新手武将调参：5×2 → 6×2，与万人敌同一轮抬底。）
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
      { kind: 'damageAll', amount: 6, times: 2 },
      {
        kind: 'conditional',
        when: { c: 'enemyCountAtLeast', n: 2 },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
    upgrade: {
      effects: [
        { kind: 'damageAll', amount: 8, times: 2 },
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
   * X 费. 6 per 气 sits at 劈砍's rate: the 5 it shipped at priced the
   * flexibility twice over — the card is already dead on a 0 气 board, and the
   * 2026-08 逐卡扫描 measured the under-rate print at Δ胜率 −15. What it keeps
   * paying with is the deadness; what it earns is that every repetition takes
   * 神力 and the starter relic's bonus in full, so a scaled 3 气 cast beats
   * three 劈砍 while spending two fewer cards.
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
    effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 6 }] }],
    upgrade: {
      effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 8 }] }],
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
   * 调息 5 pays out 5+4+3+2+1 = 15 体力 across five turns, so the card is worth
   * +12 in a long fight and a straight loss in a short one. Deliberately the
   * only sustain in the pool that is not a relic — which is exactly why the
   * 2026-08 新手武将调参 raised it a tier: 整局通关卡在血线上，池里唯一的
   * 续航签不该同时是张亏牌（扫描 Δ −6）。
   */
  guaguliaodu: {
    id: 'guaguliaodu',
    name: '刮骨疗毒',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-guaguliaodu',
    text: '失去 3 点体力。\n获得 5 层【调息】。',
    effects: [
      { kind: 'loseHp', amount: 3 },
      { kind: 'status', status: 'regen', amount: 5, to: 'self' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '失去 3 点体力。\n获得 6 层【调息】。',
      effects: [
        { kind: 'loseHp', amount: 3 },
        { kind: 'status', status: 'regen', amount: 6, to: 'self' },
      ],
    },
  },

  /**
   * 1 层【蓄势】 is half what the genre usually prints on a scaling power,
   * and that is intentional: this pool has three cards that hit more than once
   * per play (水淹七军, 五百校刀手, 虎牢关), so a point of 神力 is worth two to
   * three damage a turn here rather than one. The 气 is where the 2026-08
   * 新手武将调参 spent its buff — 3 费的启动回合太重（扫描 Δ −9），2 费让它
   * 首回合就能和一张劈砍同场落地；每回合的产出率没动。
   */
  weizhenhuaxia: {
    id: 'weizhenhuaxia',
    name: '威震华夏',
    type: 'power',
    rarity: 'rare',
    cost: 2,
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
   * Turns 结营's 15 甲 from a one-turn wall into a running total. It produces
   * nothing by itself — the whole cost is paid by the block cards it makes
   * compound. 2026-08 新手武将调参把 3 费降到 2：产出为零的一张牌再占掉大半个
   * 回合，扫描量出 Δ −9；降一费后首回合 赤兔马 也追得上它。
   */
  shengougaolei: {
    id: 'shengougaolei',
    name: '深沟高垒',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-shengougaolei',
    text: '获得【深沟高垒】。',
    effects: [{ kind: 'status', status: 'barricade', amount: 1, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: { cost: 1 },
  },
});

/**
 * 无色 — cards no hero starts with and no fight ever offers. The only counter
 * they are sold over is a 商旅's (todos/05), which is what buys them the licence
 * to reach for mechanics 关羽's own pool deliberately leaves alone: 反刺, 中毒
 * and 重甲 exist as statuses but no drafted card grants any of them.
 *
 * Their `rarity` is a **price band and nothing else**. They are absent from
 * `CARD_POOL_BY_RARITY` and must stay absent: that table feeds `availableRarity`,
 * so widening it would move every post-combat reward roll on every seed that
 * already exists.
 *
 * Rate check against the printed baselines (劈砍 1气/6伤, 铁壁 1气/5甲):
 * 淬毒 pays 5 up front and 3+2+1 over three turns for one 气, which is above
 * rate only if the fight lasts — 中毒 is the price and the point. 八阵图 pays
 * nothing on the turn it lands. 离间计 buys no damage at all, only a window.
 */
const COLORLESS_CARDS: Record<string, CardDef> = tagHero('colorless', {
  /** The one out-of-band heal in the game that is not a 丹药 or a campfire. */
  qingnangshu: {
    id: 'qingnangshu',
    name: '青囊书',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-qingnangshu',
    text: '回复 6 点体力。',
    effects: [{ kind: 'heal', amount: 6 }],
    keywords: ['exhaust'],
    upgrade: { text: '回复 9 点体力。', effects: [{ kind: 'heal', amount: 9 }] },
  },

  /**
   * 反刺 scales with how often the enemy swings rather than with 神力, so this
   * is the answer to a multi-hit attacker and dead weight against a single big
   * one — the first card in the game whose value the intent marker decides.
   */
  lujiao: {
    id: 'lujiao',
    name: '鹿角',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-lujiao',
    text: '获得 3 层【反刺】。',
    effects: [{ kind: 'status', status: 'thorns', amount: 3, to: 'self' }],
    upgrade: {
      text: '获得 4 层【反刺】。',
      effects: [{ kind: 'status', status: 'thorns', amount: 4, to: 'self' }],
    },
  },

  /** 虚招's debuffs, aimed at the whole field and with the block traded away. */
  lijianji: {
    id: 'lijianji',
    name: '离间计',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-lijianji',
    text: '对所有敌人施加 2 层【怯战】与 2 层【破绽】。',
    effects: [
      { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
      { kind: 'status', status: 'vulnerable', amount: 2, to: 'allEnemies' },
    ],
    upgrade: {
      text: '对所有敌人施加 3 层【怯战】与 3 层【破绽】。',
      effects: [
        { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
        { kind: 'status', status: 'vulnerable', amount: 3, to: 'allEnemies' },
      ],
    },
  },

  /** 中毒 ignores 护甲, which makes this the one attack a 深沟高垒 cannot wall. */
  dushi: {
    id: 'dushi',
    name: '毒矢',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-dushi',
    text: '造成 {D} 点伤害。\n施加 3 层【中毒】。',
    effects: [
      { kind: 'damage', amount: 5 },
      { kind: 'status', status: 'poison', amount: 3, to: 'target' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n施加 4 层【中毒】。',
      effects: [
        { kind: 'damage', amount: 7 },
        { kind: 'status', status: 'poison', amount: 4, to: 'target' },
      ],
    },
  },

  /** 重甲 lands its block at *turn end*, so it survives into the enemy turn. */
  bazhentu: {
    id: 'bazhentu',
    name: '八阵图',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-bazhentu',
    text: '获得 4 层【重甲】。',
    effects: [{ kind: 'status', status: 'metallicize', amount: 4, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 5 层【重甲】。',
      effects: [{ kind: 'status', status: 'metallicize', amount: 5, to: 'self' }],
    },
  },
});

/**
 * The other heroes' tables (todos/17). They are declared in `src/data/heroCards.ts`
 * — data only, no imports back into the rules cycle — and stamped here, so a
 * card's `hero` is decided by the table it lives in exactly the way 关羽's is.
 *
 * 关羽's table deliberately stays above, beside the 无色 stock it was written
 * with: moving it would re-order nothing that matters *today*, but every
 * existing 关羽 seed indexes into arrays derived from that declaration order,
 * and there is no reason to take the risk for a tidier file.
 */
const ZHAOYUN = tagHero('zhaoyun', ZHAOYUN_CARDS);
const ZHUGELIANG = tagHero('zhugeliang', ZHUGELIANG_CARDS);

/**
 * Every card the game can name. Curses and status cards live in here so
 * `getCard` resolves them and the piles can hold them — their exclusion from
 * rewards is enforced by rarity, not by a second table. Hero 令牌 (「锦囊」) are
 * in here for the same reason and kept out of the pools the same way: `basic`.
 */
export const CARDS: Record<string, CardDef> = {
  ...GUANYU_CARDS,
  ...ZHAOYUN,
  ...ZHUGELIANG,
  ...COLORLESS_CARDS,
  ...CURSES,
  ...STATUS_CARDS,
};

/**
 * A hero's draftable pool, grouped by rarity — `rollCardReward` rolls a tier
 * and then picks inside it, which is the whole mechanism that makes 万人敌
 * rarer than 白马义从.
 *
 * Keyed by `Exclude<CardRarity, 'basic'>`, so `rollCardReward` cannot ask for a
 * tier the starters, curses and 状态牌 (all `basic`) live in. The keys are the
 * only part TypeScript checks, though — the arrays are plain `string[]` — so
 * the actual guarantee that a curse never reaches the deck is `addCard`
 * throwing on one.
 */
export type CardPools = Record<Exclude<CardRarity, 'basic'>, string[]>;

/**
 * Derived from a hero's table in declaration order rather than written out a
 * second time: a hand-kept copy is a second place a card can be forgotten, and
 * the arrays are indexed by seeded rolls, so a divergence between the two would
 * silently re-deal old runs instead of failing.
 */
export function poolsOf(table: Record<string, CardDef>): CardPools {
  const pools: CardPools = { common: [], uncommon: [], rare: [] };
  for (const def of Object.values(table)) {
    if (def.rarity === 'basic') continue;
    pools[def.rarity].push(def.id);
  }
  return pools;
}

/**
 * Every hero's pool, by hero id — the keys must match `HeroDef.id`, and a hero
 * missing from the table drafts nothing, which is loud rather than silently
 * dealing someone else's cards. 无色 is deliberately absent: those cards are
 * sold, never drafted, and `availableRarity` walks this table.
 */
export const HERO_CARD_POOLS: Record<string, CardPools> = {
  guanyu: poolsOf(GUANYU_CARDS),
  zhaoyun: poolsOf(ZHAOYUN),
  zhugeliang: poolsOf(ZHUGELIANG),
};

/**
 * The ids `heroId` may be offered at `rarity`. **The single dealing point** —
 * `rollCardReward`, the 坊市 shelf and an 奇遇's `gainCards` all come through
 * here, so a hero can never be handed another hero's card.
 *
 * Pool *contents* vary by hero; how many times a stream is pulled does not
 * (R3, `src/rooms/rng.ts`). An unknown hero gets an empty pool, and every
 * caller already spends its draw against an empty pool.
 */
export const poolFor = (heroId: string, rarity: Exclude<CardRarity, 'basic'>): string[] =>
  HERO_CARD_POOLS[heroId]?.[rarity] ?? [];

/**
 * 关羽's pool, under the name it had before heroes had pools of their own.
 *
 * Kept because a dozen tests and the sim's card sweep read "the draftable set"
 * and, with one hero shipping, that is exactly this. **Not** a dealing point:
 * anything that hands a card to a player must go through `poolFor` with the
 * run's own hero, or 赵云 will be offered 青龙偃月刀 cards.
 */
export const CARD_POOL_BY_RARITY: CardPools = HERO_CARD_POOLS.guanyu;

/**
 * 无色 cards, which only the shop and events deal. Declaration order, and
 * therefore stable: a shop's shelf indexes into this array off a seeded roll,
 * so re-ordering it re-stocks every 商旅 in every existing run. Append only.
 */
export const COLORLESS_POOL: string[] = Object.keys(COLORLESS_CARDS);

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
