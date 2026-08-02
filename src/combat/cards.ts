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

  // ------------------------------------------------- 2026-08 池扩（追加区）
  //
  // 关羽的可选池曾是 10/8/3——比另两位各少一张稀有，整池也最浅。以下七张
  // 只追加不插队（池序是种子化的下标，R3 铁律），机制全部走既有效果词汇，
  // 数值以 `npm run eval` 的 300 场边际扫描为准。

  /**
   * 斩颜良's twin, reading the other debuff: 斩颜良 cashes 破绽 into 气，这张
   * cashes 怯战 into牌。虚招/勒马横刀 是它的上游——关羽自己的怯战来源
   * 以前只有虚招一张，追击链立不起来。
   */
  zhuwenchou: {
    id: 'zhuwenchou',
    name: '诛文丑',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-zhuwenchou',
    text: '造成 {D} 点伤害。\n若目标有【怯战】，抽 1 张牌。',
    effects: [
      { kind: 'damage', amount: 8 },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 11 },
        {
          kind: 'conditional',
          when: { c: 'targetHasStatus', status: 'weak' },
          then: [{ kind: 'draw', amount: 1 }],
        },
      ],
    },
  },

  /**
   * 全场怯战的普通位。与虚招分工：虚招单点两层换四点甲是保命读招，这张
   * 一层铺全场是给 诛文丑/万人敌 的多人房做局。挂 消耗——一喝只此一声：
   * 不带消耗时它是每轮转都能再铺的全场减伤引擎，天命连场量出整程
   * 零重被它和 千里走单骑 合力抬破 60%。
   */
  lemahengdao: {
    id: 'lemahengdao',
    name: '勒马横刀',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-lemahengdao',
    text: '获得 {B} 点护甲。\n所有敌人添 1 层【怯战】。',
    effects: [
      { kind: 'block', amount: 5 },
      { kind: 'status', status: 'weak', amount: 1, to: 'allEnemies' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      effects: [
        { kind: 'block', amount: 8 },
        { kind: 'status', status: 'weak', amount: 1, to: 'allEnemies' },
      ],
    },
  },

  /**
   * 义勇 walks in a power and pays 消耗；这张把一层【神力】焊在一张真打的
   * 攻牌上，付的是伤害刻度（同费的温酒斩打 7 还带破绽）。灞桥挑袍——
   * 刀尖挑的是袍，攒下的是势。
   */
  daotiaojinpao: {
    id: 'daotiaojinpao',
    name: '刀挑锦袍',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-daotiaojinpao',
    text: '造成 {D} 点伤害。\n获得 1 层【神力】。',
    effects: [
      { kind: 'damage', amount: 5 },
      { kind: 'status', status: 'strength', amount: 1, to: 'self' },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 7 },
        { kind: 'status', status: 'strength', amount: 1, to: 'self' },
      ],
    },
  },

  /**
   * 挂印而去，一身轻——每场一记纯节奏：土山约三事拿体力换气，这张拿的
   * 是自己（消耗）。首版是「消耗手中 1 张牌换 2 气」：台架 Δ 只有 +1，
   * 天命连场却量出整程零重被它一张抬了 ~9 个百分点——真跑起来它每场白拆
   * 一张 祭酒/军师/张梁 塞进来的诅咒，把整条塞牌施压轴掀了。诅咒解药
   * 不该以 0 费顺手的形态住在池子里。
   */
  fengjinguayin: {
    id: 'fengjinguayin',
    name: '封金挂印',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-fengjinguayin',
    text: '获得 2 点气。',
    effects: [{ kind: 'energy', amount: 2 }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 点气。',
      effects: [{ kind: 'energy', amount: 3 }],
    },
  },

  /**
   * 全池最大的一刀。三费在 汉寿亭侯印（费≥2 加伤）和 虎牢关 的 X 费之间
   * 立一根定桩：一击 24 再挂两层【破绽】，把下一回合也预支进来。稀有付的
   * 是整个回合——挥空了什么都不剩。
   */
  yanyuezhan: {
    id: 'yanyuezhan',
    name: '偃月斩',
    type: 'attack',
    rarity: 'rare',
    cost: 3,
    target: 'enemy',
    art: 'card-yanyuezhan',
    text: '造成 {D} 点伤害。\n目标添 2 层【破绽】。',
    effects: [
      { kind: 'damage', amount: 18 },
      { kind: 'status', status: 'vulnerable', amount: 2, to: 'target' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n目标添 3 层【破绽】。',
      effects: [
        { kind: 'damage', amount: 24 },
        { kind: 'status', status: 'vulnerable', amount: 3, to: 'target' },
      ],
    },
  },

  /**
   * 一次性的整回合再造：气与牌各补一口，挂在 消耗 上不构成循环。升级
   * 免费——千里路上，马不停蹄。（首版还带 3 层【调息】；每场一记免费
   * 回合外加续航，天命连场把整程零重抬破 60%，续航割给 刮骨疗毒 专营。）
   */
  qianlizoudanqi: {
    id: 'qianlizoudanqi',
    name: '千里走单骑',
    type: 'skill',
    rarity: 'rare',
    cost: 1,
    target: 'self',
    art: 'card-qianlizoudanqi',
    text: '获得 2 点气。\n抽 2 张牌。',
    effects: [
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 2 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 2 点气。\n抽 3 张牌。',
      effects: [
        { kind: 'energy', amount: 2 },
        { kind: 'draw', amount: 3 },
      ],
    },
  },

  /**
   * 全部三个卡池里第一张【护身符】：李儒的鸩觞、张梁的咒水、天命的整套
   * 减益都被它挡在门外。挡什么、什么时候打，是这张势牌的全部技术含量；
   * 产出为零，所以敢给两层。
   */
  yibaoyuntian: {
    id: 'yibaoyuntian',
    name: '义薄云天',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-yibaoyuntian',
    text: '获得 2 层【护身符】。',
    effects: [{ kind: 'status', status: 'artifact', amount: 2, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【护身符】。',
      effects: [{ kind: 'status', status: 'artifact', amount: 3, to: 'self' }],
    },
  },

  // ------------------------------------------------- 2026-08 稀有补层（追加区）
  //
  // 首领奖励抬到 0/50/50 之后，6 张 rare 两幕就复读。+4 按原型缺口补层：
  // 龟壳（身在曹营）、空手（古城会）、群战斩将（万军取首）、追击（白马解围）。
  // 只追加不插队（R3），机制全走既有效果词汇，数值对 §「强度带」的费率基准。

  /**
   * 全游戏第一张【金蝉脱壳】。2 层不是 2 回合：玩家自己的回合结束先衰 1 层
   * （endOfTurn 衰减在敌方行动之前），剩下那层才是真正买到的东西——一个
   * 敌方回合内一切伤害降为 1，鸩觞、中毒、反刺一并按住。1 层版本是空转，
   * 所以基础就印 2。消耗：每场只有一次“身在曹营”，再多就成了常驻减伤。
   */
  shenzaicaoying: {
    id: 'shenzaicaoying',
    name: '身在曹营',
    type: 'skill',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-shenzaicaoying',
    text: '获得 2 层【金蝉脱壳】。',
    effects: [{ kind: 'status', status: 'intangible', amount: 2, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: { cost: 1 },
  },

  /**
   * 单刀赴会的稀有位。一通鼓未尽，蔡阳头已落地——手上什么都不剩的那一刀，
   * 才是真的。payoff 费率与单刀赴会同一条线（12伤/气），rare 的溢价全在
   * 抽 2：空手斩完，下一手已经回来。空振时 8伤/气，低于偃月斩附带破绽
   * 的稀有位，条件牌的税落在两费整块与手序要求上。`then`/`otherwise`
   * 单实例结算，神力只吃一次，
   * {D} 印实话。
   */
  guchenghui: {
    id: 'guchenghui',
    name: '古城会',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'enemy',
    art: 'card-guchenghui',
    text: '造成 {D} 点伤害。\n若手牌已空，改为 24 点并抽 2 张牌。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'handEmpty' },
        then: [
          { kind: 'damage', amount: 24 },
          { kind: 'draw', amount: 2 },
        ],
        otherwise: [{ kind: 'damage', amount: 16 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若手牌已空，改为 30 点并抽 2 张牌。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'handEmpty' },
          then: [
            { kind: 'damage', amount: 30 },
            { kind: 'draw', amount: 2 },
          ],
          otherwise: [{ kind: 'damage', amount: 18 }],
        },
      ],
    },
  },

  /**
   * 于万军之中取上将首级。【斩将】先挂后挥：这一刀自己造成的击杀立刻折成
   * 神力，第二轮扫击接着吃——effects 顺序是这张卡的全部技术含量。
   * 9×2/敌 @3费 = 6/气/敌，与水淹七军同一费率，付的是整整一个回合；
   * 对独目标 18@3 恰在劈砍费率上，不是陷阱签，只是无趣——rare 的分散
   * 与五关六将同构：牌组要么要宽房，要么不要。
   */
  wanjunqushou: {
    id: 'wanjunqushou',
    name: '万军取首',
    type: 'attack',
    rarity: 'rare',
    cost: 3,
    target: 'all',
    art: 'card-wanjunqushou',
    text: '获得 1 层【斩将】。\n对所有敌人造成 {D} 点伤害 {T} 次。',
    effects: [
      { kind: 'status', status: 'slayer', amount: 1, to: 'self' },
      { kind: 'damageAll', amount: 9, times: 2 },
    ],
    upgrade: {
      effects: [
        { kind: 'status', status: 'slayer', amount: 1, to: 'self' },
        { kind: 'damageAll', amount: 12, times: 2 },
      ],
    },
  },

  /**
   * 斩颜良、诛文丑之后，白马围解。两张 uncommon 各读一种减益、各付一小口；
   * 这张两种都读、双倍付账：破绽换 2 牌，怯战换 2 气，全中时 16 伤近乎白送。
   * 裸卡仍低于同费稀有的纯爆发线，价差由追击链来补。上游是拖刀计（起手组自带）、
   * 温酒斩、虚招、勒马横刀、偃月斩；rare 的分散在“追击链没立起来时，
   * 它只是一张标价刚好的重劈”。
   */
  baimajiewei: {
    id: 'baimajiewei',
    name: '白马解围',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'enemy',
    art: 'card-baimajiewei',
    text: '造成 {D} 点伤害。\n若目标有【破绽】，抽 2 张牌。\n若目标有【怯战】，获得 2 点气。',
    effects: [
      { kind: 'damage', amount: 16 },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'vulnerable' },
        then: [{ kind: 'draw', amount: 2 }],
      },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [{ kind: 'energy', amount: 2 }],
      },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 20 },
        {
          kind: 'conditional',
          when: { c: 'targetHasStatus', status: 'vulnerable' },
          then: [{ kind: 'draw', amount: 2 }],
        },
        {
          kind: 'conditional',
          when: { c: 'targetHasStatus', status: 'weak' },
          then: [{ kind: 'energy', amount: 2 }],
        },
      ],
    },
  },

  // ---------------------------------------------- 2026-08 关羽中层发动机（追加区）
  //
  // 16 张把全解锁可构筑池从 12/10/10 扩到 16/20/12。声明顺序仍只追加，
  // 不重排既有卡；池长变化会有意识地重发同 seed 的奖励，这是扩充内容本身的
  // 代价。核心闭环分三段：主动弃牌把牌送入弃牌堆并由【整军】兑现防御；洗回
  // 弃牌堆重置循环并由【粮道】回气；消耗则压薄循环，由【砺兵】与【武圣】把
  // 一次性牌折成甲和神力。

  /**
   * 最朴素的主动弃牌入口。比温酒斩多一伤、少破绽，额外的换手不是白抽：
   * 这张牌自己和被弃的牌都先离手，最后只补回一张，手牌总数照常少一。
   */
  huimazhan: {
    id: 'huimazhan',
    name: '回马斩',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-huimazhan',
    text: '造成 {D} 点伤害。\n弃 1 张牌，然后抽 1 张牌。',
    effects: [
      { kind: 'damage', amount: 8 },
      { kind: 'discard', amount: 1 },
      { kind: 'draw', amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 11 },
        { kind: 'discard', amount: 1 },
        { kind: 'draw', amount: 1 },
      ],
    },
  },

  /** 弃牌堆为空时仍是一张较薄的却敌；有旧牌时把整轮循环提前接回。 */
  mingjinzhengdui: {
    id: 'mingjinzhengdui',
    name: '鸣金整队',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-mingjinzhengdui',
    text: '获得 {B} 点护甲。\n将弃牌堆洗回抽牌堆。\n抽 1 张牌。',
    effects: [
      { kind: 'block', amount: 6 },
      { kind: 'shuffleDiscardIn' },
      { kind: 'draw', amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: 'block', amount: 9 },
        { kind: 'shuffleDiscardIn' },
        { kind: 'draw', amount: 1 },
      ],
    },
  },

  /**
   * 以一张手牌换永久压薄。裸用是有代价的劈砍上位一点；砺兵、武圣或
   * 百战回锋到位后，被消耗的牌才成为资源。
   */
  duanpaojueyi: {
    id: 'duanpaojueyi',
    name: '断袍决义',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-duanpaojueyi',
    text: '造成 {D} 点伤害。\n消耗 1 张牌。',
    effects: [
      { kind: 'damage', amount: 8 },
      { kind: 'exhaustCards', amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 11 },
        { kind: 'exhaustCards', amount: 1 },
      ],
    },
  },

  /** 一次性净化手序；升级多看一张，但始终只准每场走一遍。 */
  qingzhuangjiancong: {
    id: 'qingzhuangjiancong',
    name: '轻装简从',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-qingzhuangjiancong',
    text: '弃 1 张牌，然后抽 2 张牌。',
    effects: [
      { kind: 'discard', amount: 1 },
      { kind: 'draw', amount: 2 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '弃 1 张牌，然后抽 3 张牌。',
      effects: [
        { kind: 'discard', amount: 1 },
        { kind: 'draw', amount: 3 },
      ],
    },
  },

  /** 群攻与主动弃牌的中间位；两张选择题换回两张，不凭空增手牌。 */
  yanqiyansha: {
    id: 'yanqiyansha',
    name: '偃旗掩杀',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-yanqiyansha',
    text: '对所有敌人造成 {D} 点伤害。\n弃 2 张牌，然后抽 2 张牌。',
    effects: [
      { kind: 'damageAll', amount: 8 },
      { kind: 'discard', amount: 2 },
      { kind: 'draw', amount: 2 },
    ],
    upgrade: {
      effects: [
        { kind: 'damageAll', amount: 11 },
        { kind: 'discard', amount: 2 },
        { kind: 'draw', amount: 2 },
      ],
    },
  },

  /** 消耗一张，换回本牌花掉的气并补两张；升级把交换变成净赚一气。 */
  zhenqianlidao: {
    id: 'zhenqianlidao',
    name: '阵前砺刀',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-zhenqianlidao',
    text: '消耗 1 张牌。\n获得 1 点气。\n抽 2 张牌。',
    effects: [
      { kind: 'exhaustCards', amount: 1 },
      { kind: 'energy', amount: 1 },
      { kind: 'draw', amount: 2 },
    ],
    upgrade: {
      text: '消耗 1 张牌。\n获得 2 点气。\n抽 2 张牌。',
      effects: [
        { kind: 'exhaustCards', amount: 1 },
        { kind: 'energy', amount: 2 },
        { kind: 'draw', amount: 2 },
      ],
    },
  },

  /** 防御向的消耗入口；与阵前砺刀分工为保命回合和爆发回合。 */
  bingyinghezhen: {
    id: 'bingyinghezhen',
    name: '并营合阵',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-bingyinghezhen',
    text: '获得 {B} 点护甲。\n消耗 1 张牌。\n抽 2 张牌。',
    effects: [
      { kind: 'block', amount: 8 },
      { kind: 'exhaustCards', amount: 1 },
      { kind: 'draw', amount: 2 },
    ],
    upgrade: {
      effects: [
        { kind: 'block', amount: 11 },
        { kind: 'exhaustCards', amount: 1 },
        { kind: 'draw', amount: 2 },
      ],
    },
  },

  /**
   * 显式重启整副牌。消耗让它不能和粮道自循环；升级只减启动费，不多抽牌。
   */
  juantuchonglai: {
    id: 'juantuchonglai',
    name: '卷土重来',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-juantuchonglai',
    text: '将弃牌堆洗回抽牌堆。\n抽 3 张牌。',
    effects: [
      { kind: 'shuffleDiscardIn' },
      { kind: 'draw', amount: 3 },
    ],
    keywords: ['exhaust'],
    upgrade: { cost: 0 },
  },

  /** 一次性大幅换手；牌先弃、后抽，选择不会被新牌污染。 */
  yijiahuanzhen: {
    id: 'yijiahuanzhen',
    name: '易甲换阵',
    type: 'skill',
    rarity: 'uncommon',
    cost: 0,
    target: 'self',
    art: 'card-yijiahuanzhen',
    text: '弃 2 张牌，然后抽 3 张牌。',
    effects: [
      { kind: 'discard', amount: 2 },
      { kind: 'draw', amount: 3 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '弃 2 张牌，然后抽 4 张牌。',
      effects: [
        { kind: 'discard', amount: 2 },
        { kind: 'draw', amount: 4 },
      ],
    },
  },

  /** 消耗堆达到四张后从 8 跳到 14；阈值让压薄本身变成进攻路线。 */
  baizhanhuifeng: {
    id: 'baizhanhuifeng',
    name: '百战回锋',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-baizhanhuifeng',
    text: '造成 {D} 点伤害。\n若消耗堆不少于 4 张，改为 14 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 4 },
        then: [{ kind: 'damage', amount: 14 }],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若消耗堆不少于 4 张，改为 18 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 4 },
          then: [{ kind: 'damage', amount: 18 }],
          otherwise: [{ kind: 'damage', amount: 11 }],
        },
      ],
    },
  },

  /** 主动弃牌的防御发动机。层数就是每张牌兑现的护甲，不按回合衰减。 */
  zhengjingwu: {
    id: 'zhengjingwu',
    name: '整军经武',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-zhengjingwu',
    text: '获得 3 层【整军】。',
    effects: [{ kind: 'status', status: 'discipline', amount: 3, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 4 层【整军】。',
      effects: [{ kind: 'status', status: 'discipline', amount: 4, to: 'self' }],
    },
  },

  /** 消耗的防御发动机；势牌不触发，避免它进场时给自己返一层收益。 */
  libingmoma: {
    id: 'libingmoma',
    name: '厉兵秣马',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-libingmoma',
    text: '获得 2 层【砺兵】。',
    effects: [{ kind: 'status', status: 'armory', amount: 2, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【砺兵】。',
      effects: [{ kind: 'status', status: 'armory', amount: 3, to: 'self' }],
    },
  },

  /** 自动洗牌和卡牌主动洗牌都返气；升级改启动回合，不翻倍循环收益。 */
  liangdaochangtong: {
    id: 'liangdaochangtong',
    name: '粮道畅通',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-liangdaochangtong',
    text: '获得 1 层【粮道】。',
    effects: [{ kind: 'status', status: 'supply', amount: 1, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: { cost: 0 },
  },

  /** 关羽原本缺少的常驻护甲倍率；纯加法，不替代整军/砺兵的触发玩法。 */
  chizhongdaiji: {
    id: 'chizhongdaiji',
    name: '持重待机',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-chizhongdaiji',
    text: '获得 2 层【身法】。',
    effects: [{ kind: 'status', status: 'dexterity', amount: 2, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【身法】。',
      effects: [{ kind: 'status', status: 'dexterity', amount: 3, to: 'self' }],
    },
  },

  /**
   * 消耗路线的稀有轴心。每张被烧掉的攻/谋永久转成神力；势牌不触发，既避免
   * 本牌自赚，也让玩家仍需配置真正的消耗入口。
   */
  wusheng: {
    id: 'wusheng',
    name: '武圣',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-wusheng',
    text: '获得 1 层【武圣】。',
    effects: [{ kind: 'status', status: 'warSaint', amount: 1, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: { cost: 1 },
  },

  /**
   * 稀有重启器：把主动弃出的牌接回来，回一气再看四张。与千里走单骑相比，
   * 少净赚一气、多看两张，但必须先经营出一个弃牌堆。
   */
  hanbingzaixing: {
    id: 'hanbingzaixing',
    name: '汉兵再兴',
    type: 'skill',
    rarity: 'rare',
    cost: 1,
    target: 'self',
    art: 'card-hanbingzaixing',
    text: '将弃牌堆洗回抽牌堆。\n获得 1 点气。\n抽 4 张牌。',
    effects: [
      { kind: 'shuffleDiscardIn' },
      { kind: 'energy', amount: 1 },
      { kind: 'draw', amount: 4 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '将弃牌堆洗回抽牌堆。\n获得 1 点气。\n抽 5 张牌。',
      effects: [
        { kind: 'shuffleDiscardIn' },
        { kind: 'energy', amount: 1 },
        { kind: 'draw', amount: 5 },
      ],
    },
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
