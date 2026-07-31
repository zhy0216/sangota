import type { CardDef } from '../combat/types';

/**
 * 专属卡 for every hero except 关羽, whose table stays in `cards.ts` beside the
 * 无色 stock it was written with — moving it would re-order `HERO_CARD_POOLS`
 * and re-deal every run that already exists.
 *
 * Only data lives here: `cards.ts` stamps `hero` on each table (so a card
 * cannot wear a tag its table disagrees with), merges them into `CARDS`, and
 * derives the draft pools. This file therefore imports **types only** and sits
 * outside the rules cycle entirely.
 *
 * **Declaration order is load-bearing and append-only** for the same reason
 * 关羽's is: `poolsOf` walks the table in order, a 坊市 shelf and a 战斗奖励
 * index into the derived arrays off a seeded roll, and re-ordering a table
 * silently re-deals every existing run of that hero.
 *
 * Rate check, against the three printed baselines the whole game is priced off
 * (劈砍 1气/6伤, 铁壁 1气/5甲, 结营 2气/14甲): roughly 6 damage or 5–7 block per
 * 气 at basic rarity. Anything above that pays for it with a keyword, a
 * condition, or 体力 — the notes on each card say which.
 */

// ---------------------------------------------------------------- 赵云 · 连击

/**
 * 赵云's whole pool reads one number: `state.attacksThisTurn`, the 攻 cards
 * played **before** this one this turn. `playCard` increments it only after the
 * card has finished resolving, so a card never counts itself — which is what
 * makes 「七探盘蛇」 a finisher rather than a first play.
 *
 * The split against 关羽 is deliberate: 关羽 is a handful of big swings scaled
 * by 神力, so his cards want to be few and fat. 赵云's only 神力 is one layer on
 * a rare (一身是胆); his damage comes from card *count*, so his cards are
 * small, cheap, and worth more the later in the turn they land. A 赵云 deck
 * that drafts like a 关羽 deck stops working, and that is the point.
 */
export const ZHAOYUN_CARDS: Record<string, CardDef> = {
  // --- 起手牌组 (5 突阵 / 4 掠马 / 1 龙胆) ---------------------------------

  /**
   * 劈砍's rate exactly. The difference between the two heroes' openings is not
   * the card, it is the relic behind it: 青龙偃月刀 pays the turn's first swing,
   * 涯角枪 pays its second. Five of these are five 连击 counters, and every
   * payoff card in the pool multiplies the count rather than the hit.
   */
  tuzhen: {
    id: 'tuzhen',
    name: '突阵',
    type: 'attack',
    rarity: 'basic',
    cost: 1,
    target: 'enemy',
    art: 'card-tuzhen',
    text: '造成 {D} 点伤害。',
    effects: [{ kind: 'damage', amount: 6 }],
    upgrade: { effects: [{ kind: 'damage', amount: 9 }] },
  },

  /** 铁壁's rate exactly. 赵云 buys his defence from 截江 / 空营计, not from here. */
  luema: {
    id: 'luema',
    name: '掠马',
    type: 'skill',
    rarity: 'basic',
    cost: 1,
    target: 'self',
    art: 'card-luema',
    text: '获得 {B} 点护甲。',
    effects: [{ kind: 'block', amount: 5 }],
    upgrade: { effects: [{ kind: 'block', amount: 8 }] },
  },

  /**
   * The 连击 tutorial, and the only card in the starting ten that reads the
   * counter. 0 气 so it is never the reason a combo stops; the draw is gated at
   * two prior attacks so it pays out on the turns the deck is actually working.
   */
  longdan: {
    id: 'longdan',
    name: '龙胆',
    type: 'attack',
    rarity: 'basic',
    cost: 0,
    target: 'enemy',
    art: 'card-longdan',
    text: '造成 {D} 点伤害。\n若本回合已打出 2 张【攻】牌，抽 1 张牌。',
    effects: [
      { kind: 'damage', amount: 3 },
      { kind: 'conditional', when: { c: 'attacksAtLeast', n: 2 }, then: [{ kind: 'draw', amount: 1 }] },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 5 },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 2 },
          then: [{ kind: 'draw', amount: 1 }],
        },
      ],
    },
  },

  // --- common --------------------------------------------------------------

  /**
   * 单刀赴会's shape with 关羽's empty hand swapped for 赵云's counter: under
   * rate as an opener, half again over it as a follow-up. One damage instance
   * either way, so the face can print an honest {D}.
   */
  tingqiang: {
    id: 'tingqiang',
    name: '挺枪',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-tingqiang',
    text: '造成 {D} 点伤害。\n若本回合已打出【攻】牌，改为 9 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'damage', amount: 9 }],
        otherwise: [{ kind: 'damage', amount: 6 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若本回合已打出【攻】牌，改为 12 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 1 },
          then: [{ kind: 'damage', amount: 12 }],
          otherwise: [{ kind: 'damage', amount: 8 }],
        },
      ],
    },
  },

  /**
   * The hero's signature: 5 per prior 攻, and 5 flat if it is the first thing
   * played. The 「至少一次」 floor is not softness — it is what keeps the card
   * from being a dead draw in an opening hand, and it is why the branch is
   * written as a conditional around `scaleWithAttacks` rather than a bare
   * scale. Each repetition is its own damage instance, so 破绽 and any borrowed
   * 神力 are counted once per hit.
   *
   * The 气 curve is the balance: three prior attacks cost three cards and three
   * 气 before this one lands, which is a whole turn's worth of set-up for 15.
   */
  qitanpanshe: {
    id: 'qitanpanshe',
    name: '七探盘蛇',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-qitanpanshe',
    text: '连刺 {T} 次，每次造成 {D} 点伤害。\n次数为本回合已打出的【攻】牌数，至少一次。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'scaleWithAttacks', per: [{ kind: 'damage', amount: 5 }] }],
        otherwise: [{ kind: 'damage', amount: 5 }],
      },
    ],
    upgrade: {
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 1 },
          then: [{ kind: 'scaleWithAttacks', per: [{ kind: 'damage', amount: 7 }] }],
          otherwise: [{ kind: 'damage', amount: 7 }],
        },
      ],
    },
  },

  /**
   * The pool's one anti-synergy, on purpose: it pays 11 甲 — over 铁壁's rate —
   * exactly on the turns 赵云 is *not* comboing. A deck of nothing but 连击
   * payoffs has no turn where this is worth a card.
   */
  kongyingji: {
    id: 'kongyingji',
    name: '空营计',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-kongyingji',
    text: '获得 {B} 点护甲。\n若本回合尚未打出【攻】牌，改为 11 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attackPlayedThisTurn' },
        then: [{ kind: 'block', amount: 6 }],
        otherwise: [{ kind: 'block', amount: 11 }],
      },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n若本回合尚未打出【攻】牌，改为 14 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attackPlayedThisTurn' },
          then: [{ kind: 'block', amount: 8 }],
          otherwise: [{ kind: 'block', amount: 14 }],
        },
      ],
    },
  },

  // --- uncommon ------------------------------------------------------------

  /**
   * 9 for 1 气 is a shade over rate, and it is split three ways: every 护甲 and
   * every 重甲 subtracts three times, which is what pays for it. Against
   * 破绽 it is the best card in the pool.
   */
  sanjinsanchu: {
    id: 'sanjinsanchu',
    name: '三进三出',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-sanjinsanchu',
    text: '造成 {D} 点伤害 {T} 次。',
    effects: [{ kind: 'damage', amount: 3, times: 3 }],
    upgrade: { effects: [{ kind: 'damage', amount: 4, times: 3 }] },
  },

  /**
   * 七探盘蛇's mirror on the defensive side, and the reason 赵云 can combo on a
   * turn he still has to survive. Block *accumulates* across effects, so the
   * printed {B} is the true total — base plus 3 for each 攻 already made.
   */
  jiejiang: {
    id: 'jiejiang',
    name: '截江',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-jiejiang',
    text: '获得 {B} 点护甲。\n本回合每打出过一张【攻】牌，此数再 +3。',
    effects: [
      { kind: 'block', amount: 4 },
      { kind: 'scaleWithAttacks', per: [{ kind: 'block', amount: 3 }] },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n本回合每打出过一张【攻】牌，此数再 +4。',
      effects: [
        { kind: 'block', amount: 6 },
        { kind: 'scaleWithAttacks', per: [{ kind: 'block', amount: 4 }] },
      ],
    },
  },

  /**
   * The one unconditional big hit in the pool, and it costs 体力 rather than
   * set-up — the escape hatch for a hand that has no combo in it. Priced off a
   * 74 体力 pool, i.e. tighter than 关羽's 82: three 血染征袍 in a fight is a
   * ninth of the bar.
   */
  xueranzhengpao: {
    id: 'xueranzhengpao',
    name: '血染征袍',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-xueranzhengpao',
    text: '失去 3 点体力。\n造成 {D} 点伤害。',
    effects: [
      { kind: 'loseHp', amount: 3 },
      { kind: 'damage', amount: 10 },
    ],
    upgrade: {
      effects: [
        { kind: 'loseHp', amount: 3 },
        { kind: 'damage', amount: 14 },
      ],
    },
  },

  // --- rare ----------------------------------------------------------------

  /**
   * 天佑 eats a whole HP loss regardless of size, so this is 赵云's answer to
   * the one thing a 74 体力 hero cannot answer with 护甲: a single enormous
   * hit. The 神力 rides along because the pool has none anywhere else — one
   * layer, so it never turns into 关羽's plan.
   */
  yishenshidan: {
    id: 'yishenshidan',
    name: '一身是胆',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-yishenshidan',
    text: '获得 2 层【天佑】与 1 层【神力】。',
    effects: [
      { kind: 'status', status: 'buffer', amount: 2, to: 'self' },
      { kind: 'status', status: 'strength', amount: 1, to: 'self' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【天佑】与 1 层【神力】。',
      effects: [
        { kind: 'status', status: 'buffer', amount: 3, to: 'self' },
        { kind: 'status', status: 'strength', amount: 1, to: 'self' },
      ],
    },
  },

  /**
   * Reads the bar, not the board: 8 damage while healthy is under rate, and the
   * card only becomes a rare below half 体力 — which on 74 体力 is a line this
   * hero crosses in most elite fights. The heal is small on purpose; it buys a
   * turn, not a comeback.
   */
  danqijiuzhu: {
    id: 'danqijiuzhu',
    name: '单骑救主',
    type: 'attack',
    rarity: 'rare',
    cost: 1,
    target: 'enemy',
    art: 'card-danqijiuzhu',
    text: '造成 {D} 点伤害。\n若你的体力低于一半，改为 16 点并回复 6 点体力。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'hpBelow', percent: 50 },
        then: [
          { kind: 'damage', amount: 16 },
          { kind: 'heal', amount: 6 },
        ],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若你的体力低于一半，改为 20 点并回复 8 点体力。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'hpBelow', percent: 50 },
          then: [
            { kind: 'damage', amount: 20 },
            { kind: 'heal', amount: 8 },
          ],
          otherwise: [{ kind: 'damage', amount: 11 }],
        },
      ],
    },
  },

  /**
   * 25 across five instances for the whole turn's 气. Flat, that is a shade
   * over rate; the reason it is rare is that it is five separate hits, so a
   * single point of borrowed 神力 is worth 5 and 破绽 is worth 12. It does not
   * feed 连击 (one card, one counter) — it *spends* the turn instead, which is
   * the choice the card exists to pose.
   */
  lizhanwujiang: {
    id: 'lizhanwujiang',
    name: '力斩五将',
    type: 'attack',
    rarity: 'rare',
    cost: 3,
    target: 'enemy',
    art: 'card-lizhanwujiang',
    text: '造成 {D} 点伤害 {T} 次。',
    effects: [{ kind: 'damage', amount: 5, times: 5 }],
    upgrade: { effects: [{ kind: 'damage', amount: 7, times: 5 }] },
  },

  // --- Pool expansion (todos/17, 阶段四实测) --------------------------------
  /*
   * 11 cards taking 赵云 from 9 draftable to 20 — 8 common, 8 uncommon, 4 rare,
   * against 关羽's 10/8/3. Same design brief as the section header: small,
   * cheap, and worth more the later in the turn they land. Appended after the
   * original nine and never re-ordered — `poolsOf` walks this table in
   * declaration order and existing runs index into the derived arrays.
   */

  /**
   * 三进三出 one instance short and one tier down: 6 for 1 气 is 劈砍's rate
   * exactly, paid out in two hits — each takes borrowed 神力 and 破绽
   * separately, and each is its own 连击-less swing that still moves the
   * counter by only one. The humble body the archetype runs on.
   */
  lianhuanqiang: {
    id: 'lianhuanqiang',
    name: '连环枪',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-lianhuanqiang',
    text: '造成 {D} 点伤害 {T} 次。',
    effects: [{ kind: 'damage', amount: 3, times: 2 }],
    upgrade: { effects: [{ kind: 'damage', amount: 4, times: 2 }] },
  },

  /**
   * 3 for 0 气 is under 白马义从's rate, and the refund is the difference: at
   * two prior 攻 the card is 气-positive, which is the only way this pool ever
   * prints "gain 气" — bought with two cards of set-up, never flat.
   */
  jici: {
    id: 'jici',
    name: '疾刺',
    type: 'attack',
    rarity: 'common',
    cost: 0,
    target: 'enemy',
    art: 'card-jici',
    text: '造成 {D} 点伤害。\n若本回合已打出 2 张【攻】牌，获得 1 点气。',
    effects: [
      { kind: 'damage', amount: 3 },
      { kind: 'conditional', when: { c: 'attacksAtLeast', n: 2 }, then: [{ kind: 'energy', amount: 1 }] },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 5 },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 2 },
          then: [{ kind: 'energy', amount: 1 }],
        },
      ],
    },
  },

  /**
   * 温酒斩's shape with the rider moved behind the combo gate: 6 flat is rate,
   * and the 2 层【破绽】 — worth most to 连环枪 and 力斩五将, which subtract per
   * hit — only land once two 攻 have already gone out. The sword pays the
   * finisher, not the opener. Named for the *taking* of 青釭剑 at 长坂坡 — the
   * sword itself is the relic of that id, and the two must not share a name.
   */
  duojian: {
    id: 'duojian',
    name: '夺剑',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-duojian',
    text: '造成 {D} 点伤害。\n若本回合已打出 2 张【攻】牌，施加 2 层【破绽】。',
    effects: [
      { kind: 'damage', amount: 6 },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 2 },
        then: [{ kind: 'status', status: 'vulnerable', amount: 2, to: 'target' }],
      },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 8 },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 2 },
          then: [{ kind: 'status', status: 'vulnerable', amount: 2, to: 'target' }],
        },
      ],
    },
  },

  /**
   * 铁壁's rate with a gated cantrip on top: 5 甲 flat, and the draw — the half
   * 却敌 prints unconditionally for 关羽 — only on a turn an 攻 already went
   * out. Defence that keeps the combo moving instead of pausing it.
   */
  qianghua: {
    id: 'qianghua',
    name: '枪花',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-qianghua',
    text: '获得 {B} 点护甲。\n若本回合已打出【攻】牌，抽 1 张牌。',
    effects: [
      { kind: 'block', amount: 5 },
      { kind: 'conditional', when: { c: 'attacksAtLeast', n: 1 }, then: [{ kind: 'draw', amount: 1 }] },
    ],
    upgrade: {
      effects: [
        { kind: 'block', amount: 8 },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 1 },
          then: [{ kind: 'draw', amount: 1 }],
        },
      ],
    },
  },

  /**
   * 观阵 split across the combo gate: one card cold, 观阵's two once an 攻 has
   * gone out. Under 关羽's rate on purpose — draw is worth more to a deck of
   * small cards, so it pays the same toll every payoff in this pool pays.
   */
  chenshi: {
    id: 'chenshi',
    name: '趁势',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-chenshi',
    text: '抽 1 张牌。\n若本回合已打出【攻】牌，再抽 1 张牌。',
    effects: [
      { kind: 'draw', amount: 1 },
      { kind: 'conditional', when: { c: 'attacksAtLeast', n: 1 }, then: [{ kind: 'draw', amount: 1 }] },
    ],
    upgrade: {
      text: '抽 2 张牌。\n若本回合已打出【攻】牌，再抽 1 张牌。',
      effects: [
        { kind: 'draw', amount: 2 },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 1 },
          then: [{ kind: 'draw', amount: 1 }],
        },
      ],
    },
  },

  /**
   * The attack that replaces itself: 5 for 1 气 is under rate and the draw is
   * the missing point — a 连击 counter that costs no card is what every payoff
   * in the pool wants most, which is why the cantrip sits a tier above 突阵.
   */
  yinqiang: {
    id: 'yinqiang',
    name: '银枪',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-yinqiang',
    text: '造成 {D} 点伤害。\n抽 1 张牌。',
    effects: [
      { kind: 'damage', amount: 5 },
      { kind: 'draw', amount: 1 },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 8 },
        { kind: 'draw', amount: 1 },
      ],
    },
  },

  /**
   * The pool's one AoE, and it reads the counter like everything else: 6 to the
   * room is under 万人敌's 8 for the same 气, 10 is over — the gap is the two
   * 攻 the turn already spent. One damage instance per enemy either way, so the
   * face prints an honest {D}.
   */
  hengsaoqianjun: {
    id: 'hengsaoqianjun',
    name: '横扫千军',
    type: 'attack',
    rarity: 'uncommon',
    cost: 2,
    target: 'all',
    art: 'card-hengsaoqianjun',
    text: '对所有敌人造成 {D} 点伤害。\n若本回合已打出 2 张【攻】牌，改为 10 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 2 },
        then: [{ kind: 'damageAll', amount: 10 }],
        otherwise: [{ kind: 'damageAll', amount: 6 }],
      },
    ],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害。\n若本回合已打出 2 张【攻】牌，改为 13 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 2 },
          then: [{ kind: 'damageAll', amount: 13 }],
          otherwise: [{ kind: 'damageAll', amount: 8 }],
        },
      ],
    },
  },

  /**
   * 土山约三事 at half size, priced for a 74 体力 bar: 2 体力 buys one 气 and
   * one card, which is exactly one more small attack this turn. The upgrade
   * buys back 体力 rather than adding effect, the same bargain 关羽's makes.
   */
  longxiang: {
    id: 'longxiang',
    name: '龙骧',
    type: 'skill',
    rarity: 'uncommon',
    cost: 0,
    target: 'self',
    art: 'card-longxiang',
    text: '失去 2 点体力。\n获得 1 点气。\n抽 1 张牌。',
    effects: [
      { kind: 'loseHp', amount: 2 },
      { kind: 'energy', amount: 1 },
      { kind: 'draw', amount: 1 },
    ],
    upgrade: {
      text: '失去 1 点体力。\n获得 1 点气。\n抽 1 张牌。',
      effects: [
        { kind: 'loseHp', amount: 1 },
        { kind: 'energy', amount: 1 },
        { kind: 'draw', amount: 1 },
      ],
    },
  },

  /**
   * 汉水: banners down, gates open. 铁壁's block plus 1 层【怯战】 on the whole
   * room for 1 气 — over rate, paid by the layer being one: it blunts exactly
   * the turn it lands, which is the turn 赵云 spends setting up rather than
   * comboing.
   */
  yanqixigu: {
    id: 'yanqixigu',
    name: '偃旗息鼓',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-yanqixigu',
    text: '对所有敌人施加 1 层【怯战】。\n获得 {B} 点护甲。',
    effects: [
      { kind: 'status', status: 'weak', amount: 1, to: 'allEnemies' },
      { kind: 'block', amount: 5 },
    ],
    upgrade: {
      text: '对所有敌人施加 2 层【怯战】。\n获得 {B} 点护甲。',
      effects: [
        { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
        { kind: 'block', amount: 7 },
      ],
    },
  },

  /**
   * The only 身法 any pool grants, and it belongs here: 身法 pays per block
   * instance, and 赵云 plays more, cheaper 谋 cards than anyone — 掠马, 枪花 and
   * 截江's every +3 all collect. 义勇's price and life cycle exactly, with the
   * scaling stat swapped for the defensive one.
   */
  huwei: {
    id: 'huwei',
    name: '虎威',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-huwei',
    text: '获得 2 层【身法】。',
    effects: [{ kind: 'status', status: 'dexterity', amount: 2, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【身法】。',
      effects: [{ kind: 'status', status: 'dexterity', amount: 3, to: 'self' }],
    },
  },

  /**
   * The scene the hero is famous for, as the combo's capstone: 七探盘蛇's
   * either/or shape, with each repetition swinging *and* guarding. Two prior 攻
   * make it 14 伤 + 6 甲 for 2 气 — well over rate, bought with a whole turn's
   * set-up — while the 「至少一次」 floor (7 伤 + 3 甲) keeps it above dead in
   * an opening hand. Block accumulates across repetitions, so {B} prints the
   * true total the way 截江's does.
   */
  changbanpo: {
    id: 'changbanpo',
    name: '长坂坡',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'enemy',
    art: 'card-changbanpo',
    text: '连刺 {T} 次，每次造成 {D} 点伤害；共获得 {B} 点护甲。\n次数为本回合已打出的【攻】牌数，至少一次。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [
          {
            kind: 'scaleWithAttacks',
            per: [
              { kind: 'damage', amount: 7 },
              { kind: 'block', amount: 3 },
            ],
          },
        ],
        otherwise: [
          { kind: 'damage', amount: 7 },
          { kind: 'block', amount: 3 },
        ],
      },
    ],
    upgrade: {
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 1 },
          then: [
            {
              kind: 'scaleWithAttacks',
              per: [
                { kind: 'damage', amount: 9 },
                { kind: 'block', amount: 4 },
              ],
            },
          ],
          otherwise: [
            { kind: 'damage', amount: 9 },
            { kind: 'block', amount: 4 },
          ],
        },
      ],
    },
  },
};

// -------------------------------------------------------------- 诸葛亮 · 锦囊

/**
 * 诸葛亮 draws **one card fewer** every turn and has **one more 气** (羽扇), so
 * his hand is short and his 气 is long — the exact inverse of 赵云. The pool
 * closes that gap by *minting* cards: 「锦囊」 is a 0 气 token that replaces
 * itself, so a hand of four with two 锦囊 in it plays like a hand of six.
 *
 * The second thread is the 消耗堆. 锦囊 exhausts when played, and so does most
 * of the pool, so `exhaustedAtLeast` is a counter that only this hero can turn
 * on reliably — 火计 and 出师表 are the payoffs.
 *
 * 68 体力 is the price of both. He is the only hero who cannot afford to trade.
 */
export const ZHUGELIANG_CARDS: Record<string, CardDef> = {
  // --- 起手牌组 (5 连弩 / 4 据守 / 1 隆中对) -------------------------------

  /**
   * 劈砍's total, split in two. Worse into 护甲, better into 破绽, and — the
   * reason it is the basic — it is the only attack he starts with, so the two
   * instances are what make a single borrowed 神力 worth drafting at all.
   */
  yuanrongnu: {
    id: 'yuanrongnu',
    name: '元戎弩',
    type: 'attack',
    rarity: 'basic',
    cost: 1,
    target: 'enemy',
    art: 'card-yuanrongnu',
    text: '造成 {D} 点伤害 {T} 次。',
    effects: [{ kind: 'damage', amount: 3, times: 2 }],
    upgrade: { effects: [{ kind: 'damage', amount: 4, times: 2 }] },
  },

  /** 铁壁's rate. Deliberately the plainest card in the game. */
  jushou: {
    id: 'jushou',
    name: '据守',
    type: 'skill',
    rarity: 'basic',
    cost: 1,
    target: 'self',
    art: 'card-jushou',
    text: '获得 {B} 点护甲。',
    effects: [{ kind: 'block', amount: 5 }],
    upgrade: { effects: [{ kind: 'block', amount: 8 }] },
  },

  /**
   * 固有, so 诸葛亮's short opening hand is short by one card and long by two
   * 锦囊 — turn one is where the missing card hurts most, and this is the
   * answer to it. 消耗 keeps it from clogging the later shuffles, the same
   * bargain 夜读春秋 makes.
   */
  longzhongdui: {
    id: 'longzhongdui',
    name: '隆中对',
    type: 'skill',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-longzhongdui',
    text: '将 2 张「锦囊」置入手牌。',
    effects: [{ kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' }],
    keywords: ['innate', 'exhaust'],
    upgrade: {
      text: '将 3 张「锦囊」置入手牌。',
      effects: [{ kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' }],
    },
  },

  /**
   * The token. `rarity: 'basic'` is what keeps it out of every pool — `poolsOf`
   * skips basic — the same mechanism that keeps 起手牌 out of rewards, and the
   * reason it needs no second table. No `upgrade`: a card that is minted, never
   * drafted, has nowhere to carry one, so the 营帐 forge cannot see it either.
   *
   * Card-neutral by design (it draws its own replacement), so its real cost is
   * the hand slot it occupies for one beat. Value = 4 甲 and one card deeper
   * into the deck, for free — which is precisely what a 4-card hand needs.
   */
  jinnang: {
    id: 'jinnang',
    name: '锦囊',
    type: 'skill',
    rarity: 'basic',
    cost: 0,
    target: 'self',
    art: 'card-jinnang',
    text: '获得 {B} 点护甲。\n抽 1 张牌。',
    effects: [
      { kind: 'block', amount: 4 },
      { kind: 'draw', amount: 1 },
    ],
    keywords: ['exhaust'],
  },

  // --- common --------------------------------------------------------------

  /** 铁壁's rate plus a token — the workhorse that keeps the hand from emptying. */
  jiejianzhiji: {
    id: 'jiejianzhiji',
    name: '借箭之计',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-jiejianzhiji',
    text: '获得 {B} 点护甲。\n将 1 张「锦囊」置入手牌。',
    effects: [
      { kind: 'block', amount: 6 },
      { kind: 'addCard', defId: 'jinnang', count: 1, to: 'hand' },
    ],
    upgrade: {
      effects: [
        { kind: 'block', amount: 9 },
        { kind: 'addCard', defId: 'jinnang', count: 1, to: 'hand' },
      ],
    },
  },

  /**
   * Card-positive and 气-free, which sounds unconditional and is not: the two
   * 锦囊 are worth 8 甲 only if there are 气 and hand slots left to spend them,
   * and every one of the three cards it puts in play ends up in the 消耗堆 —
   * which is either 火计's fuel or nothing at all.
   */
  jiedongfeng: {
    id: 'jiedongfeng',
    name: '借东风',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-jiedongfeng',
    text: '将 2 张「锦囊」置入手牌。\n抽 1 张牌。',
    effects: [
      { kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' },
      { kind: 'draw', amount: 1 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '将 3 张「锦囊」置入手牌。\n抽 1 张牌。',
      effects: [
        { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
        { kind: 'draw', amount: 1 },
      ],
    },
  },

  /**
   * The 消耗堆 tutorial: half of 劈砍 early, twice it once three cards have
   * burned. The card itself exhausts *after* its effects resolve (`playCard`),
   * so it never counts itself — three really means three others.
   */
  huoji: {
    id: 'huoji',
    name: '火计',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-huoji',
    text: '造成 {D} 点伤害。\n若消耗堆中已有 3 张牌，改为 12 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'damage', amount: 12 }],
        otherwise: [{ kind: 'damage', amount: 6 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若消耗堆中已有 3 张牌，改为 16 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 3 },
          then: [{ kind: 'damage', amount: 16 }],
          otherwise: [{ kind: 'damage', amount: 8 }],
        },
      ],
    },
  },

  // --- uncommon ------------------------------------------------------------

  /**
   * 怯战 on the whole room plus 结营-grade block for 1 气 would be over rate if
   * it stayed in the deck; 消耗 is what prices it. The strategist's answer to a
   * turn he cannot out-damage.
   */
  kongchengji: {
    id: 'kongchengji',
    name: '空城计',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-kongchengji',
    text: '对所有敌人施加 2 层【怯战】。\n获得 {B} 点护甲。',
    effects: [
      { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
      { kind: 'block', amount: 8 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '对所有敌人施加 3 层【怯战】。\n获得 {B} 点护甲。',
      effects: [
        { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
        { kind: 'block', amount: 11 },
      ],
    },
  },

  /**
   * 调息 4 pays 4+3+2+1 = 10 体力 over four turns — the same curve as 关羽's
   * 刮骨疗毒 but without the 3 体力 down payment, because 68 体力 cannot afford
   * the entry fee. Long fights only, which is where a 消耗 deck lives anyway.
   */
  qixingdeng: {
    id: 'qixingdeng',
    name: '七星灯',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-qixingdeng',
    text: '获得 4 层【调息】。',
    effects: [{ kind: 'status', status: 'regen', amount: 4, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 6 层【调息】。',
      effects: [{ kind: 'status', status: 'regen', amount: 6, to: 'self' }],
    },
  },

  /**
   * Draw is worth more to this hero than to any other — he is a card down every
   * turn — so it is priced a tier above 观阵 and rewards the 消耗堆 rather than
   * simply printing a bigger number. The upgrade buys the 气 back instead of
   * adding a card, so it never becomes a free turn.
   */
  muniuliuma: {
    id: 'muniuliuma',
    name: '木牛流马',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-muniuliuma',
    text: '抽 2 张牌。\n若消耗堆中已有 3 张牌，再抽 1 张。',
    effects: [
      { kind: 'draw', amount: 2 },
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
    upgrade: { cost: 0 },
  },

  // --- rare ----------------------------------------------------------------

  /**
   * The only 神力 in the pool, and it arrives with the two cards needed to
   * spend it — 元戎弩 and 火计 both want a flat bonus more than 关羽's swings do,
   * because they hit twice or hit conditionally.
   */
  wolongchushan: {
    id: 'wolongchushan',
    name: '卧龙出山',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-wolongchushan',
    text: '获得 2 层【神力】。\n将 2 张「锦囊」置入手牌。',
    effects: [
      { kind: 'status', status: 'strength', amount: 2, to: 'self' },
      { kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【神力】。\n将 2 张「锦囊」置入手牌。',
      effects: [
        { kind: 'status', status: 'strength', amount: 3, to: 'self' },
        { kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' },
      ],
    },
  },

  /**
   * 气-neutral and three cards deep, which on a four-card hand is the entire
   * hand again. The 消耗堆 clause is what makes it a rare rather than a fat
   * 观阵: five burned cards is a deck that has been playing 锦囊 all fight, and
   * this is that deck's reward.
   */
  chushibiao: {
    id: 'chushibiao',
    name: '出师表',
    type: 'skill',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-chushibiao',
    text: '获得 2 点气。\n抽 3 张牌。\n若消耗堆中已有 5 张牌，再抽 2 张。',
    effects: [
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 3 },
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 5 },
        then: [{ kind: 'draw', amount: 2 }],
      },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 2 点气。\n抽 3 张牌。\n若消耗堆中已有 3 张牌，再抽 2 张。',
      effects: [
        { kind: 'energy', amount: 2 },
        { kind: 'draw', amount: 3 },
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 3 },
          then: [{ kind: 'draw', amount: 2 }],
        },
      ],
    },
  },

  /**
   * Buys no damage at all, only a window — 3 层 of each debuff on the whole
   * room is worth more than any single card in the pool if the deck can follow
   * it up, and worth nothing if it cannot. Dead against a lone 首领 that
   * already carries 护身符.
   */
  qiqinqizong: {
    id: 'qiqinqizong',
    name: '七擒七纵',
    type: 'skill',
    rarity: 'rare',
    cost: 2,
    target: 'all',
    art: 'card-qiqinqizong',
    text: '对所有敌人施加 3 层【破绽】与 3 层【怯战】。\n抽 2 张牌。',
    effects: [
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'allEnemies' },
      { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
      { kind: 'draw', amount: 2 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '对所有敌人施加 4 层【破绽】与 4 层【怯战】。\n抽 2 张牌。',
      effects: [
        { kind: 'status', status: 'vulnerable', amount: 4, to: 'allEnemies' },
        { kind: 'status', status: 'weak', amount: 4, to: 'allEnemies' },
        { kind: 'draw', amount: 2 },
      ],
    },
  },

  // --- Pool expansion (todos/17, 阶段四实测) --------------------------------
  /*
   * 11 cards taking 诸葛亮 from 9 draftable to 20 — 8 common, 8 uncommon,
   * 4 rare, the same spread 赵云's expansion landed on. Same design brief as
   * the section header: mint 锦囊, feed the 消耗堆, and control the room
   * instead of racing it. Appended after the original nine and never
   * re-ordered — `poolsOf` walks this table in declaration order and existing
   * runs index into the derived arrays.
   */

  /**
   * 劈砍's rate minus one point, and the point buys the 层: 怯战 on a 68 体力
   * hero is worth more than anywhere else, because a blunted swing is 体力 he
   * cannot buy back. The 层 is also 声东击西's fuel — the pool's control basic.
   */
  youdi: {
    id: 'youdi',
    name: '诱敌之计',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-youdi',
    text: '造成 {D} 点伤害。\n施加 1 层【怯战】。',
    effects: [
      { kind: 'damage', amount: 5 },
      { kind: 'status', status: 'weak', amount: 1, to: 'target' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n施加 2 层【怯战】。',
      effects: [
        { kind: 'damage', amount: 7 },
        { kind: 'status', status: 'weak', amount: 2, to: 'target' },
      ],
    },
  },

  /**
   * 挺枪's shape with 赵云's counter swapped for the debuff this pool applies:
   * 6 flat is rate, 9 into a 怯战 target is half again over it — paid, exactly
   * like 斩颜良, by the card of set-up (诱敌之计 / 激将法 / 空城计) that put the
   * 层 there. The face reads the live target, so {D} never lies.
   */
  shengdongjixi: {
    id: 'shengdongjixi',
    name: '声东击西',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-shengdongjixi',
    text: '造成 {D} 点伤害。\n若目标有【怯战】，改为 9 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [{ kind: 'damage', amount: 9 }],
        otherwise: [{ kind: 'damage', amount: 6 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若目标有【怯战】，改为 12 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'targetHasStatus', status: 'weak' },
          then: [{ kind: 'damage', amount: 12 }],
          otherwise: [{ kind: 'damage', amount: 8 }],
        },
      ],
    },
  },

  /**
   * 隆中对 made draftable: 1 气 for two tokens is 8 甲 plus two cards deeper,
   * over 铁壁 on paper — paid by arriving in pieces. Each 锦囊 still wants a
   * beat of hand room to cash, and every one of them ends in the 消耗堆, which
   * is the other half of what this card is buying.
   */
  miaosuan: {
    id: 'miaosuan',
    name: '妙算',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-miaosuan',
    text: '将 2 张「锦囊」置入手牌。',
    effects: [{ kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' }],
    upgrade: {
      text: '将 3 张「锦囊」置入手牌。',
      effects: [{ kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' }],
    },
  },

  /**
   * 火计's gate on the defensive side: 铁壁's 5 before three cards have burned,
   * nearly double after. The common that makes the 消耗堆 a defensive stat —
   * and the reason a 诸葛亮 deck plays its 锦囊 even on the quiet turns.
   */
  fubing: {
    id: 'fubing',
    name: '伏兵',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-fubing',
    text: '获得 {B} 点护甲。\n若消耗堆中已有 3 张牌，改为 9 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'block', amount: 9 }],
        otherwise: [{ kind: 'block', amount: 5 }],
      },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n若消耗堆中已有 3 张牌，改为 12 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 3 },
          then: [{ kind: 'block', amount: 12 }],
          otherwise: [{ kind: 'block', amount: 7 }],
        },
      ],
    },
  },

  /**
   * 3 伤 plus a 层 for 0 气 is over rate for the cost, and 消耗 is the price
   * that squares it — the card is a one-shot. Burning is also half the point:
   * it is a 火计 / 伏兵 counter that costs no 气, and the 层 it leaves is
   * 声东击西's trigger. The pool's cheapest way to start both engines.
   */
  jijiangfa: {
    id: 'jijiangfa',
    name: '激将法',
    type: 'attack',
    rarity: 'common',
    cost: 0,
    target: 'enemy',
    art: 'card-jijiangfa',
    text: '造成 {D} 点伤害。\n施加 1 层【怯战】。',
    effects: [
      { kind: 'damage', amount: 3 },
      { kind: 'status', status: 'weak', amount: 1, to: 'target' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 5 },
        { kind: 'status', status: 'weak', amount: 1, to: 'target' },
      ],
    },
  },

  /**
   * 虎牢关's shape for the hero whose 气 is long and hand is short: X 费, one
   * card per 气. Dead on a 0 气 board and card-negative at 1, which is the
   * cost of the flexibility — 羽扇's fourth 气 is what makes it his rather
   * than anyone's. The upgrade adds 2 甲 per 气 rather than a card, so it
   * never draws the hand past what the turn can spend.
   */
  guanxing: {
    id: 'guanxing',
    name: '观星',
    type: 'skill',
    rarity: 'uncommon',
    // X_COST. `playCard` drains 气 and `scaleWithEnergy` reads back what it spent.
    cost: -1,
    target: 'self',
    art: 'card-guanxing',
    text: '消耗全部气。\n每 1 点气抽 1 张牌。',
    effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'draw', amount: 1 }] }],
    upgrade: {
      text: '消耗全部气。\n每 1 点气抽 1 张牌并获得 2 点护甲。',
      effects: [
        {
          kind: 'scaleWithEnergy',
          per: [
            { kind: 'draw', amount: 1 },
            { kind: 'block', amount: 2 },
          ],
        },
      ],
    },
  },

  /**
   * The pool's one repeatable AoE: 7 to the room is under 万人敌's 8 for the
   * same 气, 11 is over — the gap is the three cards the fight has already
   * burned. One damage instance per enemy either way, so the face prints an
   * honest {D}.
   */
  huoshaobowang: {
    id: 'huoshaobowang',
    name: '火烧博望坡',
    type: 'attack',
    rarity: 'uncommon',
    cost: 2,
    target: 'all',
    art: 'card-huoshaobowang',
    text: '对所有敌人造成 {D} 点伤害。\n若消耗堆中已有 3 张牌，改为 11 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'damageAll', amount: 11 }],
        otherwise: [{ kind: 'damageAll', amount: 7 }],
      },
    ],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害。\n若消耗堆中已有 3 张牌，改为 14 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 3 },
          then: [{ kind: 'damageAll', amount: 14 }],
          otherwise: [{ kind: 'damageAll', amount: 9 }],
        },
      ],
    },
  },

  /**
   * Fewer troops, more stoves: trades the hand's worst card for 1 气 and a
   * fresh one, and the trade itself feeds the 消耗堆 — the only card that lets
   * the hero *choose* what burns, which is what makes a drawn 诅咒 or a spent
   * 据守 into 火计 fuel. 气-neutral at worst; the value is all in the swap.
   */
  jianbingzengzao: {
    id: 'jianbingzengzao',
    name: '减兵增灶',
    type: 'skill',
    rarity: 'uncommon',
    cost: 0,
    target: 'self',
    art: 'card-jianbingzengzao',
    text: '消耗手牌中 1 张牌。\n获得 1 点气。\n抽 1 张牌。',
    effects: [
      { kind: 'exhaustCards', amount: 1 },
      { kind: 'energy', amount: 1 },
      { kind: 'draw', amount: 1 },
    ],
    upgrade: {
      text: '消耗手牌中 1 张牌。\n获得 1 点气。\n抽 2 张牌。',
      effects: [
        { kind: 'exhaustCards', amount: 1 },
        { kind: 'energy', amount: 1 },
        { kind: 'draw', amount: 2 },
      ],
    },
  },

  /**
   * 借东风 a tier up: the extra 气 buys the extra draw, and 消耗 still prices
   * the package — two tokens and two cards off the top would be a free turn if
   * it stayed in the deck. The upgrade buys the 气 back, muniuliuma's bargain.
   */
  shenjimiaosuan: {
    id: 'shenjimiaosuan',
    name: '神机妙算',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-shenjimiaosuan',
    text: '将 2 张「锦囊」置入手牌。\n抽 2 张牌。',
    effects: [
      { kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' },
      { kind: 'draw', amount: 2 },
    ],
    keywords: ['exhaust'],
    upgrade: { cost: 0 },
  },

  /**
   * 结营 prints 14 甲 for the same 气; this prints 12 and spends the other two
   * points on a 层 for the whole room — armour against this turn's swings plus
   * a discount on next turn's. The strategist's version of a defensive turn:
   * it answers the room, not the biggest number in it.
   */
  anjupingwulu: {
    id: 'anjupingwulu',
    name: '安居平五路',
    type: 'skill',
    rarity: 'uncommon',
    cost: 2,
    target: 'all',
    art: 'card-anjupingwulu',
    text: '获得 {B} 点护甲。\n对所有敌人施加 1 层【怯战】。',
    effects: [
      { kind: 'block', amount: 12 },
      { kind: 'status', status: 'weak', amount: 1, to: 'allEnemies' },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n对所有敌人施加 2 层【怯战】。',
      effects: [
        { kind: 'block', amount: 15 },
        { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
      ],
    },
  },

  /**
   * The 消耗 deck's finisher, and it burns like everything it counts: 12 for
   * 2 气 is exactly rate, 24 is 火计's doubling at rare scale — five burned
   * cards is a fight spent minting and spending 锦囊, and this is that fight's
   * payoff. 消耗 keeps it one strike per battle: the 藤甲 only burns once.
   */
  huoshaotengjia: {
    id: 'huoshaotengjia',
    name: '火烧藤甲',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'enemy',
    art: 'card-huoshaotengjia',
    text: '造成 {D} 点伤害。\n若消耗堆中已有 5 张牌，改为 24 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 5 },
        then: [{ kind: 'damage', amount: 24 }],
        otherwise: [{ kind: 'damage', amount: 12 }],
      },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '造成 {D} 点伤害。\n若消耗堆中已有 5 张牌，改为 28 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 5 },
          then: [{ kind: 'damage', amount: 28 }],
          otherwise: [{ kind: 'damage', amount: 14 }],
        },
      ],
    },
  },
};
