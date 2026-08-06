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
 * (劈砍 1气/6伤, 铁壁 1气/5甲, 结营 2气/15甲): roughly 6 damage or 5–7 block per
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
   * The first 11 additions took 赵云 from 9 draftable to 20 — 8 common,
   * 8 uncommon, 4 rare, against 关羽's then-current 10/8/3. Same design brief
   * as the section header: small,
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

  // --- legendary ----------------------------------------------------------

  qiruchangban: {
    id: 'qiruchangban',
    name: '七入长坂',
    type: 'attack',
    rarity: 'legendary',
    cost: 2,
    target: 'enemy',
    art: 'card-qiruchangban',
    playVfx: 'sevenRides',
    text: '连刺 {T} 次，每次造成 {D} 点伤害，至少一次。\n若本回合已打出 3 张【攻】牌，获得 1 点气并抽 2 张牌。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'scaleWithAttacks', per: [{ kind: 'damage', amount: 8 }] }],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 3 },
        then: [
          { kind: 'energy', amount: 1 },
          { kind: 'draw', amount: 2 },
        ],
      },
    ],
    keywords: ['exhaust'],
    upgrade: {
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 1 },
          then: [{ kind: 'scaleWithAttacks', per: [{ kind: 'damage', amount: 10 }] }],
          otherwise: [{ kind: 'damage', amount: 10 }],
        },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 3 },
          then: [
            { kind: 'energy', amount: 1 },
            { kind: 'draw', amount: 3 },
          ],
        },
      ],
    },
  },

  longyinzhenjun: {
    id: 'longyinzhenjun',
    name: '龙吟震军',
    type: 'attack',
    rarity: 'legendary',
    cost: 3,
    target: 'all',
    art: 'card-longyinzhenjun',
    playVfx: 'dragonRoar',
    text: '对所有敌人造成 {D} 点伤害 {T} 次。\n施加 2 层【怯战】。',
    effects: [
      { kind: 'damageAll', amount: 6, times: 3 },
      { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害 {T} 次。\n施加 3 层【怯战】。',
      effects: [
        { kind: 'damageAll', amount: 8, times: 3 },
        { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
      ],
    },
  },

  zhaoyepozhen: {
    id: 'zhaoyepozhen',
    name: '照夜破阵',
    type: 'skill',
    rarity: 'legendary',
    cost: 1,
    target: 'self',
    art: 'card-zhaoyepozhen',
    playVfx: 'nightRaid',
    text: '失去 5 点体力。\n获得 2 点气，抽 3 张牌，并获得 1 层【天佑】。',
    effects: [
      { kind: 'loseHp', amount: 5 },
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 3 },
      { kind: 'status', status: 'buffer', amount: 1, to: 'self' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '失去 3 点体力。\n获得 2 点气，抽 4 张牌，并获得 1 层【天佑】。',
      effects: [
        { kind: 'loseHp', amount: 3 },
        { kind: 'energy', amount: 2 },
        { kind: 'draw', amount: 4 },
        { kind: 'status', status: 'buffer', amount: 1, to: 'self' },
      ],
    },
  },

  // --- 2026-08 扩池：枪胆防反 ---------------------------------------------
  /*
   * 赵云从 8/8/4/3 = 23 张扩到与关羽持平的 16/20/12/3 = 51：+8 常见、
   * +12 罕见、+8 稀有，传说已满不动。铁律照关羽三批：只追加不插队、数值对
   * 三条印刷基线算账、台架与天命连场两口径都过。
   *
   * 本批补的是**结构洞**，不是把连击轴再拧三圈：读 attacksAtLeast /
   * scaleWithAttacks 的新卡恰 5 张（透阵/杀透重围/常山赵子龙/再入重围/
   * 枪挑高览），其余全部落在此前没人住的房间——第二条真构筑路线「据守反击」
   * （新条件 `blockAtLeast`：立甲→兑现，阈值 5/8/10 三档）、被动半场
   * 【回枪】（挨完那一击才回甲，答多段不答巨伤——巨伤是天佑的地盘）、
   * 全池第一张 retain（衔枚）与第一张 innate（请为先锋/一马当先）、身法
   * 支线的第二签与专职兑现件、体力代价轴的回款窗口（裹创/杀透重围）。
   * 神力零新增：一身是胆的那一层仍是全池唯一。得气仍永不白给（博望擒兰
   * 要上游怯战、再入重围要两张攻的铺垫）。
   */

  // --- common (扩) ---------------------------------------------------------

  /**
   * 七十岁上帐前请命：「不以老将为先锋，臣当碎首于阶下」。全池第一张固有：
   * 开局必在手，且必须**第一个**打——8 伤超劈砍两点，付账是顺位约束（后手
   * 缩水到 5）加固有必然占据的起手位；然后它反过来给整条连击链当第一发
   * 计数。挺枪的镜像：那张奖励晚落，这张奖励先落。
   */
  qingweixianfeng: {
    id: 'qingweixianfeng',
    name: '请为先锋',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-qingweixianfeng',
    text: '造成 {D} 点伤害。\n若本回合已打出过【攻】牌，改为 5 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attackPlayedThisTurn' },
        then: [{ kind: 'damage', amount: 5 }],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
    keywords: ['innate'],
    upgrade: {
      text: '造成 {D} 点伤害。\n若本回合已打出过【攻】牌，改为 7 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attackPlayedThisTurn' },
          then: [{ kind: 'damage', amount: 7 }],
          otherwise: [{ kind: 'damage', amount: 11 }],
        },
      ],
    },
  },

  /**
   * `blockAtLeast` 的教学卡，挺枪的防守镜像。冷 6 是劈砍基线；热 10 的溢价
   * 由「本回合先花一张牌立甲」支付——阈值 5 恰是一张掠马，包价 2 气 =
   * 5甲+10伤 对基线 12 伤，拿 2 伤换 5 甲，不多不少。单实例结算，{D} 印实话。
   */
  juqiang: {
    id: 'juqiang',
    name: '据枪',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-juqiang',
    text: '造成 {D} 点伤害。\n若你有至少 5 点护甲，改为 10 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'blockAtLeast', n: 5 },
        then: [{ kind: 'damage', amount: 10 }],
        otherwise: [{ kind: 'damage', amount: 6 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若你有至少 5 点护甲，改为 13 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'blockAtLeast', n: 5 },
          then: [{ kind: 'damage', amount: 13 }],
          otherwise: [{ kind: 'damage', amount: 8 }],
        },
      ],
    },
  },

  /**
   * 衔枚夜行，枪藏到该出的那回合。全池第一张保留攻：对连击组是存进下回合的
   * 一个计数，对防反组是把攻牌腾出防守回合。6 伤 = 基线整；保留不另收费的
   * 价签是秉烛达旦（1费 7甲 retain 常见）立过的，付的是它永远占一个手牌位。
   */
  xianmei: {
    id: 'xianmei',
    name: '衔枚',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-xianmei',
    text: '造成 {D} 点伤害。',
    effects: [{ kind: 'damage', amount: 6 }],
    keywords: ['retain'],
    upgrade: { effects: [{ kind: 'damage', amount: 9 }] },
  },

  /**
   * 夺剑把破绽挂在第三击后，这张把护甲挂在第三击后——杀进阵去还能全身而
   * 出。冷 5 伤在基线下，热 5伤+5甲 的溢价由两张攻的铺垫支付；是连击组唯一
   * 自带防御的攻牌，两个半场的焊点。护甲印定值：条件臂里的 {B} 在冷面会
   * 印 0，挺枪的「改为 9 点」先例适用于一切条件行。
   */
  touzhen: {
    id: 'touzhen',
    name: '透阵',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-touzhen',
    text: '造成 {D} 点伤害。\n若本回合已打出 2 张【攻】牌，获得 5 点护甲。',
    effects: [
      { kind: 'damage', amount: 5 },
      { kind: 'conditional', when: { c: 'attacksAtLeast', n: 2 }, then: [{ kind: 'block', amount: 5 }] },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 7 },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 2 },
          then: [{ kind: 'block', amount: 5 }],
        },
      ],
    },
  },

  /**
   * 穰山夜战，护着败军杀开一条路——人越多，枪越密。6 伤是基线原价；4 甲挂在
   * 「敌 ≥2」之后，孤 boss 房拿不到，付账方式是条件本身。全池第一张读
   * `enemyCountAtLeast` 的卡，多人房恰是 74 血条最疼的地方。
   */
  rangshantuwei: {
    id: 'rangshantuwei',
    name: '穰山突围',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-rangshantuwei',
    text: '造成 {D} 点伤害。\n若敌人不少于 2 名，获得 4 点护甲。',
    effects: [
      { kind: 'damage', amount: 6 },
      { kind: 'conditional', when: { c: 'enemyCountAtLeast', n: 2 }, then: [{ kind: 'block', amount: 4 }] },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若敌人不少于 2 名，获得 5 点护甲。',
      effects: [
        { kind: 'damage', amount: 8 },
        {
          kind: 'conditional',
          when: { c: 'enemyCountAtLeast', n: 2 },
          then: [{ kind: 'block', amount: 5 }],
        },
      ],
    },
  },

  /**
   * 白马义从（0费 4伤）的护甲位。0 费 3 甲在基线下，先出枪再披袍升到 5——
   * 进攻回合不再自动等于裸奔，与亮银甲宝物同一句话的卡牌版，也是据枪阈值
   * 的第二条供给线（掠马之外）。
   */
  baipao: {
    id: 'baipao',
    name: '白袍',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-baipao',
    text: '获得 {B} 点护甲。\n若本回合已打出【攻】牌，改为 5 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attackPlayedThisTurn' },
        then: [{ kind: 'block', amount: 5 }],
        otherwise: [{ kind: 'block', amount: 3 }],
      },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n若本回合已打出【攻】牌，改为 8 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attackPlayedThisTurn' },
          then: [{ kind: 'block', amount: 8 }],
          otherwise: [{ kind: 'block', amount: 5 }],
        },
      ],
    },
  },

  /**
   * 陷马坑里红光一罩，照夜玉狮子平空跃出——绝境处马救主。0 费 3 甲在票面
   * 之下，半血以下 7 甲在铁壁之上，付账的是「牌面在你最不想要它的时候最
   * 大」：单骑救主的防御面，把 74 血条的下半段明码标价。
   */
  yushiyuekeng: {
    id: 'yushiyuekeng',
    name: '玉狮跃坑',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-yushiyuekeng',
    text: '获得 {B} 点护甲。\n若你的体力低于一半，改为 7 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'hpBelow', percent: 50 },
        then: [{ kind: 'block', amount: 7 }],
        otherwise: [{ kind: 'block', amount: 3 }],
      },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n若你的体力低于一半，改为 10 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'hpBelow', percent: 50 },
          then: [{ kind: 'block', amount: 10 }],
          otherwise: [{ kind: 'block', amount: 5 }],
        },
      ],
    },
  },

  /**
   * 本传原文：「敛众固守，不至大败」。结营（2气 15甲）的赵云版收两点——
   * 收的理由与掠马对铁壁同源：他的防守从截江/空营计那类反直觉卡买，直板
   * 大甲只做池底的兜底。升级照结营惯用形，只降费。
   */
  lianzhonggushou: {
    id: 'lianzhonggushou',
    name: '敛众固守',
    type: 'skill',
    rarity: 'common',
    cost: 2,
    target: 'self',
    art: 'card-lianzhonggushou',
    text: '获得 {B} 点护甲。',
    effects: [{ kind: 'block', amount: 13 }],
    upgrade: { cost: 1 },
  },

  // --- uncommon (扩) -------------------------------------------------------

  /**
   * 防反引擎的主发动机。每挨一击回 3 甲、挨完那击才回——对多段是软墙，对
   * 单发巨伤一文不值，那是天佑的地盘，两张互不越界（时序见 statuses.ts 的
   * 回枪行）。对照重甲 4（2费）：便宜一费、上限更高、下限更低（敌不挥拳就
   * 是零）——方差就是罕见价。势牌消耗离场，每场一台。
   */
  huimaqiang: {
    id: 'huimaqiang',
    name: '回马枪',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-huimaqiang',
    text: '获得 3 层【回枪】。',
    effects: [{ kind: 'status', status: 'riposte', amount: 3, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 4 层【回枪】。',
      effects: [{ kind: 'status', status: 'riposte', amount: 4, to: 'self' }],
    },
  },

  /**
   * 赵云的结营位。结营 15 甲；这张 12，割 3 甲换 2 层永久反刺——墙矮一头，
   * 但墙上有刺。给拒马/枪出如龙的阈值一步到位，给蒺藜宝物垫燃料。长战斗里
   * 反刺的复利是它压着 15 不放的原因。
   */
  jianbi: {
    id: 'jianbi',
    name: '坚壁',
    type: 'skill',
    rarity: 'uncommon',
    cost: 2,
    target: 'self',
    art: 'card-jianbi',
    text: '获得 {B} 点护甲。\n获得 2 层【反刺】。',
    effects: [
      { kind: 'block', amount: 12 },
      { kind: 'status', status: 'thorns', amount: 2, to: 'self' },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n获得 3 层【反刺】。',
      effects: [
        { kind: 'block', amount: 15 },
        { kind: 'status', status: 'thorns', amount: 3, to: 'self' },
      ],
    },
  },

  /**
   * 防守构筑的宽房答案，与横扫千军精确分工：同一张 AoE，一边问「出了几杆
   * 枪」，一边问「立了多高的墙」。热 6/敌 @1 气贴着万人敌的费率，由阈值 8
   * （约两张牌的甲）支付；拒马桩立稳了才扎人。
   */
  juma: {
    id: 'juma',
    name: '拒马',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-juma',
    text: '对所有敌人造成 {D} 点伤害。\n若你有至少 8 点护甲，改为 6 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'blockAtLeast', n: 8 },
        then: [{ kind: 'damageAll', amount: 6 }],
        otherwise: [{ kind: 'damageAll', amount: 4 }],
      },
    ],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害。\n若你有至少 8 点护甲，改为 8 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'blockAtLeast', n: 8 },
          then: [{ kind: 'damageAll', amount: 8 }],
          otherwise: [{ kind: 'damageAll', amount: 6 }],
        },
      ],
    },
  },

  /**
   * 疾刺的防守孪生：疾刺拿两杆枪换气，这张拿一面墙换牌。0 费 3 伤在白马
   * 义从之下，cantrip 只付给立稳了甲的回合。防反组自己的连击计数器——墙后
   * 的枪不是不出，是挑缝出。
   */
  chengxi: {
    id: 'chengxi',
    name: '乘隙',
    type: 'attack',
    rarity: 'uncommon',
    cost: 0,
    target: 'enemy',
    art: 'card-chengxi',
    text: '造成 {D} 点伤害。\n若你有至少 5 点护甲，抽 1 张牌。',
    effects: [
      { kind: 'damage', amount: 3 },
      { kind: 'conditional', when: { c: 'blockAtLeast', n: 5 }, then: [{ kind: 'draw', amount: 1 }] },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 5 },
        {
          kind: 'conditional',
          when: { c: 'blockAtLeast', n: 5 },
          then: [{ kind: 'draw', amount: 1 }],
        },
      ],
    },
  },

  /**
   * 磐河首阵，少年赵云挺枪救公孙瓒于坡下——一枪之威，先夺其胆。温酒斩
   * （7伤+1破绽）的刻度矮半头换读数方向：1 层怯战替 74 血条挡下一记 -25%。
   * 全池首个单体怯战源，给博望擒兰/力退张郃的怯战读数立上游；与偃旗息鼓
   * 分工为点与面。
   */
  panhejiugong: {
    id: 'panhejiugong',
    name: '磐河救公孙',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-panhejiugong',
    text: '造成 {D} 点伤害，并施加 1 层【怯战】。',
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'status', status: 'weak', amount: 1, to: 'target' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害，并施加 2 层【怯战】。',
      effects: [
        { kind: 'damage', amount: 9 },
        { kind: 'status', status: 'weak', amount: 2, to: 'target' },
      ],
    },
  },

  /**
   * 博望坡生擒夏侯兰——擒的是已经胆寒的人；擒而不杀，荐为军正，是赵云的
   * 分寸。斩颜良（破绽→气）的赵云镜像，读自家怯战线。得气永不白给的第三条
   * 供给线：这 1 点气的铺垫是「上游先施加过怯战」。7 伤低于斩颜良的 9——
   * 条件产出同价时，身板让位。
   */
  bowangqinlan: {
    id: 'bowangqinlan',
    name: '博望擒兰',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-bowangqinlan',
    text: '造成 {D} 点伤害。\n若目标有【怯战】，获得 1 点气。',
    effects: [
      { kind: 'damage', amount: 7 },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [{ kind: 'energy', amount: 1 }],
      },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 9 },
        {
          kind: 'conditional',
          when: { c: 'targetHasStatus', status: 'weak' },
          then: [{ kind: 'energy', amount: 1 }],
        },
      ],
    },
  },

  /**
   * 偃旗息鼓的后半场：大开营门，追兵自己撞上来。5 甲是铁壁基线，反刺是
   * 加在「今回合不出枪」之上的溢价——本池第二张（也是最后一张）空营计式
   * 反连击卡，配额用满。与无色鹿角分工：那张平铺 3 层裸签，这张要你放弃
   * 连击回合才给 2。
   */
  hanshuijushou: {
    id: 'hanshuijushou',
    name: '汉水据守',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-hanshuijushou',
    text: '获得 {B} 点护甲。\n若本回合尚未打出【攻】牌，获得 2 层【反刺】。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attackPlayedThisTurn' },
        then: [{ kind: 'block', amount: 5 }],
        otherwise: [
          { kind: 'block', amount: 5 },
          { kind: 'status', status: 'thorns', amount: 2, to: 'self' },
        ],
      },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n若本回合尚未打出【攻】牌，获得 3 层【反刺】。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attackPlayedThisTurn' },
          then: [{ kind: 'block', amount: 7 }],
          otherwise: [
            { kind: 'block', amount: 7 },
            { kind: 'status', status: 'thorns', amount: 3, to: 'self' },
          ],
        },
      ],
    },
  },

  /**
   * 糜夫人投井托孤，解下护主的那一抱——怀里有主，这条命就不许丢。一身是胆
   * 的零售装：拆掉神力、降一费、挂消耗防循环囤积。护甲垫底是天佑的保险丝
   * （天佑结算在护甲之后，4 点甲挡住「被 1 点余伤吃掉一层」的亏账）。
   * 下游：护主冲阵读这层天佑。
   */
  huaibaoyoudou: {
    id: 'huaibaoyoudou',
    name: '怀抱幼主',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-huaibaoyoudou',
    text: '获得 1 层【天佑】与 {B} 点护甲。',
    effects: [
      { kind: 'status', status: 'buffer', amount: 1, to: 'self' },
      { kind: 'block', amount: 4 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      effects: [
        { kind: 'status', status: 'buffer', amount: 1, to: 'self' },
        { kind: 'block', amount: 7 },
      ],
    },
  },

  /**
   * 「那枪浑身上下，若舞梨花；遍体纷纷，如飘瑞雪」——不是一面盾，是三百个
   * 枪花。裸卡 6 甲在铁壁带宽内；写成三次独立获得是全部技术含量：身法按次
   * 平加，2 层虎威下这张是 12。身法支线从此有了专职兑现件。{B} 照截江先例
   * 印三段总和。
   */
  qiangwulihua: {
    id: 'qiangwulihua',
    name: '枪舞梨花',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-qiangwulihua',
    text: '连拨三下，共获得 {B} 点护甲。',
    effects: [
      { kind: 'block', amount: 2 },
      { kind: 'block', amount: 2 },
      { kind: 'block', amount: 2 },
    ],
    upgrade: {
      effects: [
        { kind: 'block', amount: 3 },
        { kind: 'block', amount: 3 },
        { kind: 'block', amount: 3 },
      ],
    },
  },

  /**
   * 血染征袍/龙骧整条体力代价轴的回款窗口。4 层总回 10，比刮骨疗毒（-3
   * 换 5 层=净 12）少两点、不掏血——赵云的续航签不该再往血条上加账。消耗
   * 照旧：池里唯一的主动回复不许循环。升级买幅度不买次数。
   */
  guochuang: {
    id: 'guochuang',
    name: '裹创',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-guochuang',
    text: '获得 4 层【调息】。',
    effects: [{ kind: 'status', status: 'regen', amount: 4, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 5 层【调息】。',
      effects: [{ kind: 'status', status: 'regen', amount: 5, to: 'self' }],
    },
  },

  /**
   * 杀进去是本事，杀出来才是长坂坡。7 伤略超基线，回 2 体力锁在两攻之后
   * ——全池第一次把续航接在连击轴上，专偿血染征袍欠下的血债。回复量钉死 2
   * 且升级不动它（只加伤）：循环收益不翻倍，粮道畅通立的规矩。
   */
  shatouchongwei: {
    id: 'shatouchongwei',
    name: '杀透重围',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-shatouchongwei',
    text: '造成 {D} 点伤害。\n若本回合已打出 2 张【攻】牌，回复 2 点体力。',
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'conditional', when: { c: 'attacksAtLeast', n: 2 }, then: [{ kind: 'heal', amount: 2 }] },
    ],
    upgrade: {
      effects: [
        { kind: 'damage', amount: 10 },
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 2 },
          then: [{ kind: 'heal', amount: 2 }],
        },
      ],
    },
  },

  /**
   * 身法支线的第二签（虎威之外），固有让引擎首回合点火——势牌越早落越值，
   * 固有就是把「晚抽到的势牌是死牌」的方差买断。只给 1 层，虎威的 2 层仍是
   * 主力；3 甲垫的是第一回合据枪的阈值。产出低于虎威，付账的是 innate。
   * 护甲效果排在身法之前，牌面 {B} 印的才是实收（自家身法不给自家甲加成）。
   */
  yimadangxian: {
    id: 'yimadangxian',
    name: '一马当先',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-yimadangxian',
    text: '获得 {B} 点护甲与 1 层【身法】。',
    effects: [
      { kind: 'block', amount: 3 },
      { kind: 'status', status: 'dexterity', amount: 1, to: 'self' },
    ],
    keywords: ['innate', 'exhaust'],
    upgrade: {
      text: '获得 {B} 点护甲与 1 层【身法】。',
      effects: [
        { kind: 'block', amount: 7 },
        { kind: 'status', status: 'dexterity', amount: 1, to: 'self' },
      ],
    },
  },

  // --- rare (扩) -----------------------------------------------------------

  /**
   * 据守反击轴的收刀。冷 10 @2 在基线下；热 20 看似 10/气，但阈值 10 要这
   * 回合先押约 2 气 2 卡进墙里——整包 4 气 = 20伤+10甲，恰回到基线费率，
   * 只是甲这半没有浪费（这正是 blockAtLeast 与 handEmpty/连击门的价差
   * 来源，热值压在古城会 24 之下）。墙立到最高的那一枪才叫如龙。
   */
  qiangchurulong: {
    id: 'qiangchurulong',
    name: '枪出如龙',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'enemy',
    art: 'card-qiangchurulong',
    text: '造成 {D} 点伤害。\n若你有至少 10 点护甲，改为 20 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'blockAtLeast', n: 10 },
        then: [{ kind: 'damage', amount: 20 }],
        otherwise: [{ kind: 'damage', amount: 10 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若你有至少 10 点护甲，改为 24 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'blockAtLeast', n: 10 },
          then: [{ kind: 'damage', amount: 24 }],
          otherwise: [{ kind: 'damage', amount: 13 }],
        },
      ],
    },
  },

  /**
   * 「前后枪刺剑砍，杀死曹营名将五十余员」——不数招式，只数人头。全池第一
   * 张 X 费。费率照虎牢关钉在 6/气——灵活性不重复收费，死牌性就是它付的价
   * ——但劈成每气两段：3 气就是六个实例，破绽逐段收、每段吃借来的神力。
   * 与力斩五将分工：那张付整回合换固定五段，这张把「今晚花多少」交还玩家。
   */
  qiangcijiankan: {
    id: 'qiangcijiankan',
    name: '枪刺剑砍',
    type: 'attack',
    rarity: 'rare',
    // X_COST. `playCard` drains 气 and `scaleWithEnergy` reads back what it spent.
    cost: -1,
    target: 'enemy',
    art: 'card-qiangcijiankan',
    text: '消耗全部气。\n每 1 点气连刺 2 次，每次造成 {D} 点伤害。',
    effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 3, times: 2 }] }],
    upgrade: {
      effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 4, times: 2 }] }],
    },
  },

  /**
   * 报名号的那一嗓子，做成群体收尾：冷面 10 全体在万人敌下一点，三攻之后
   * 16 全体 + 全场怯战——付的是整整三张前置与 2 费整块。怯战只 1 层：吼完
   * 敌人腿软的是下一刀，不是永久的；层数挂在三攻门后，所以不必照勒马横刀
   * 挂消耗。「吾乃常山赵子龙也！」
   */
  changshanzhaozilong: {
    id: 'changshanzhaozilong',
    name: '常山赵子龙',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'all',
    art: 'card-changshanzhaozilong',
    text: '对所有敌人造成 {D} 点伤害。\n若本回合已打出 3 张【攻】牌，改为 16 点并施加 1 层【怯战】。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 3 },
        then: [
          { kind: 'damageAll', amount: 16 },
          { kind: 'status', status: 'weak', amount: 1, to: 'allEnemies' },
        ],
        otherwise: [{ kind: 'damageAll', amount: 10 }],
      },
    ],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害。\n若本回合已打出 3 张【攻】牌，改为 20 点并施加 1 层【怯战】。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 3 },
          then: [
            { kind: 'damageAll', amount: 20 },
            { kind: 'status', status: 'weak', amount: 1, to: 'allEnemies' },
          ],
          otherwise: [{ kind: 'damageAll', amount: 13 }],
        },
      ],
    },
  },

  /**
   * 长坂坡三十余合逼退张郃——对面先怯了，这一枪才有三十合的余裕。白马解围
   * （双减益双倍付账）的赵云单读版：只读怯战、双倍付账（伤害抬档且给甲）。
   * 上游链条齐整：磐河救公孙、偃旗息鼓、砍倒大旗之外还有龙吟震军。裸卡 14
   * @2 略超基线半步、低于同费稀有纯爆发线，价差由追击链补。
   */
  lituizhanghe: {
    id: 'lituizhanghe',
    name: '力退张郃',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'enemy',
    art: 'card-lituizhanghe',
    text: '造成 {D} 点伤害。\n若目标有【怯战】，改为 20 点并获得 5 点护甲。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [
          { kind: 'damage', amount: 20 },
          { kind: 'block', amount: 5 },
        ],
        otherwise: [{ kind: 'damage', amount: 14 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若目标有【怯战】，改为 24 点并获得 6 点护甲。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'targetHasStatus', status: 'weak' },
          then: [
            { kind: 'damage', amount: 24 },
            { kind: 'block', amount: 6 },
          ],
          otherwise: [{ kind: 'damage', amount: 17 }],
        },
      ],
    },
  },

  /**
   * 怀中幼主尚在，杀气便不许竭——护着人打，反而打得更狠。全池第一张读
   * `selfHasStatus` 的卡，把天佑从纯保险变成进攻许可证：一身是胆/照夜破阵/
   * 怀抱幼主铺的每一层从此都有第二重身份。8 @1 是基线原价；13+4甲 的超率由
   * 「天佑是稀有资源、每挨一记大的就少一层」支付——条件会被敌人打没，这是
   * 全游戏唯一会被对面拆的加成条件。
   */
  huzhuchongzhen: {
    id: 'huzhuchongzhen',
    name: '护主冲阵',
    type: 'attack',
    rarity: 'rare',
    cost: 1,
    target: 'enemy',
    art: 'card-huzhuchongzhen',
    text: '造成 {D} 点伤害。\n若你有【天佑】，改为 13 点并获得 4 点护甲。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'selfHasStatus', status: 'buffer' },
        then: [
          { kind: 'damage', amount: 13 },
          { kind: 'block', amount: 4 },
        ],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
    upgrade: {
      // 保底 8 → 11（2026-08）。原先升级只动条件分支，于是这张**稀有**在没有
      // 【天佑】时精进的收益恰好是 0——同池的普通 单刀赴会 保底都从 6 涨到 8。
      // 条件牌的条件分支是它的上限，不该是它唯一会动的数字。
      text: '造成 {D} 点伤害。\n若你有【天佑】，改为 16 点并获得 5 点护甲。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'selfHasStatus', status: 'buffer' },
          then: [
            { kind: 'damage', amount: 16 },
            { kind: 'block', amount: 5 },
          ],
          otherwise: [{ kind: 'damage', amount: 11 }],
        },
      ],
    },
  },

  /**
   * 谥号——柔贤慈惠曰顺，执事有班曰平。防反构筑的稀有轴心：一张卡把两台
   * 引擎同时上线，主动获甲吃身法、被动挨打吃回枪，两条产线互不塑形、不复
   * 利（回枪的甲是 'power' 源）。产出为零的势牌敢给足——义薄云天的论式。
   */
  shunpinghou: {
    id: 'shunpinghou',
    name: '顺平侯',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-shunpinghou',
    text: '获得 2 层【回枪】与 2 层【身法】。',
    effects: [
      { kind: 'status', status: 'riposte', amount: 2, to: 'self' },
      { kind: 'status', status: 'dexterity', amount: 2, to: 'self' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 3 层【回枪】与 2 层【身法】。',
      effects: [
        { kind: 'status', status: 'riposte', amount: 3, to: 'self' },
        { kind: 'status', status: 'dexterity', amount: 2, to: 'self' },
      ],
    },
  },

  /**
   * 已经杀出来了，勒转马头，再进去一趟。千里走单骑（+2气抽2 无条件）的连击
   * 税版：产出改为 +1气抽3——气恰好返还本卡、牌多看一张——但要先付两张攻
   * 的铺垫，同费率稀有的差异全落在前置条件上（论证照汉兵再兴）。消耗 =
   * 每场一趟，绝不成循环。得气第四例：铺垫是两张攻。
   */
  zairuchongwei: {
    id: 'zairuchongwei',
    name: '再入重围',
    type: 'skill',
    rarity: 'rare',
    cost: 1,
    target: 'self',
    art: 'card-zairuchongwei',
    text: '若本回合已打出 2 张【攻】牌：获得 1 点气，抽 3 张牌。\n否则抽 1 张牌。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 2 },
        then: [
          { kind: 'energy', amount: 1 },
          { kind: 'draw', amount: 3 },
        ],
        otherwise: [{ kind: 'draw', amount: 1 }],
      },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '若本回合已打出 2 张【攻】牌：获得 1 点气，抽 4 张牌。\n否则抽 2 张牌。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 2 },
          then: [
            { kind: 'energy', amount: 1 },
            { kind: 'draw', amount: 4 },
          ],
          otherwise: [{ kind: 'draw', amount: 2 }],
        },
      ],
    },
  },

  /**
   * 全池缺的那记单点重锤，用赵云的语法印：偃月斩 3 费 18 无条件，这张冷面
   * 只有 15、热面 30——10/气的溢价全部由「3 攻 + 3 费同回合凑齐」支付，
   * 实际上要一个满手回合才挥得出来。单实例、神力只吃一次、{D} 印实话。
   * 典出穰山：高览方斩后卫，云一枪刺于马下——之前七缠八斗都是铺垫，杀招
   * 只有一下。
   */
  qiangtiaogaolan: {
    id: 'qiangtiaogaolan',
    name: '枪挑高览',
    type: 'attack',
    rarity: 'rare',
    cost: 3,
    target: 'enemy',
    art: 'card-qiangtiaogaolan',
    text: '造成 {D} 点伤害。\n若本回合已打出 3 张【攻】牌，改为 30 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 3 },
        then: [{ kind: 'damage', amount: 30 }],
        otherwise: [{ kind: 'damage', amount: 15 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若本回合已打出 3 张【攻】牌，改为 36 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'attacksAtLeast', n: 3 },
          then: [{ kind: 'damage', amount: 36 }],
          otherwise: [{ kind: 'damage', amount: 18 }],
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

  // --- legendary ----------------------------------------------------------

  qimenbazhen: {
    id: 'qimenbazhen',
    name: '奇门八阵',
    type: 'skill',
    rarity: 'legendary',
    cost: 3,
    target: 'all',
    art: 'card-qimenbazhen',
    playVfx: 'eightTrigrams',
    text: '获得 {B} 点护甲。\n所有敌人添 2 层【破绽】与【怯战】。\n将 2 张「锦囊」置入手牌。',
    effects: [
      { kind: 'block', amount: 18 },
      { kind: 'status', status: 'vulnerable', amount: 2, to: 'allEnemies' },
      { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
      { kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 {B} 点护甲。\n所有敌人添 3 层【破绽】与【怯战】。\n将 3 张「锦囊」置入手牌。',
      effects: [
        { kind: 'block', amount: 24 },
        { kind: 'status', status: 'vulnerable', amount: 3, to: 'allEnemies' },
        { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
        { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
      ],
    },
  },

  dongfengjitian: {
    id: 'dongfengjitian',
    name: '东风祭天',
    type: 'attack',
    rarity: 'legendary',
    cost: -1,
    target: 'all',
    art: 'card-dongfengjitian',
    playVfx: 'eastWind',
    text: '每消耗 1 点气，对所有敌人造成 {D} 点伤害。\n再施加 1 层【破绽】。',
    effects: [
      { kind: 'scaleWithEnergy', per: [{ kind: 'damageAll', amount: 6 }] },
      { kind: 'status', status: 'vulnerable', amount: 1, to: 'allEnemies' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '每消耗 1 点气，对所有敌人造成 {D} 点伤害。\n再施加 2 层【破绽】。',
      effects: [
        { kind: 'scaleWithEnergy', per: [{ kind: 'damageAll', amount: 8 }] },
        { kind: 'status', status: 'vulnerable', amount: 2, to: 'allEnemies' },
      ],
    },
  },

  qixingxuming: {
    id: 'qixingxuming',
    name: '七星续命',
    type: 'power',
    rarity: 'legendary',
    cost: 3,
    target: 'self',
    art: 'card-qixingxuming',
    playVfx: 'sevenStars',
    text: '回复 12 点体力。\n获得 2 层【天佑】。\n将 3 张「锦囊」置入手牌。',
    effects: [
      { kind: 'heal', amount: 12 },
      { kind: 'status', status: 'buffer', amount: 2, to: 'self' },
      { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      cost: 2,
      text: '回复 16 点体力。\n获得 2 层【天佑】。\n将 3 张「锦囊」置入手牌。',
      effects: [
        { kind: 'heal', amount: 16 },
        { kind: 'status', status: 'buffer', amount: 2, to: 'self' },
        { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
      ],
    },
  },

  // ======================================================================
  // 2026-08 扩池 23 → 41 draftable
  //
  // Appended in one block rather than filed into the rarity sections above,
  // because `HERO_CARD_POOLS` is built from this table **in declaration
  // order** and a shelf roll indexes into those arrays: slotting a card into
  // the middle of 常见 re-deals every reward in every save that already
  // exists. Append-only is the whole contract.
  //
  // What the block is for. 诸葛亮 shipped with 23 draftable cards against
  // 关羽/赵云's 51, and 7 攻 against their 19/30 — of his 4 稀有 exactly one
  // could kill anything. That is not a lean pool, it is half a hero: the
  // balance sim's one standing abort (诸葛亮 vs 张宝, turnLimit) is a deck
  // that cannot close, not a bad seed.
  //
  // Three threads, all of them already his and none of them borrowed:
  //
  // 1. **锦囊** — the minting he is built on. More ways to turn 气 into
  //    cards, since his hand is one short every turn.
  // 2. **消耗堆** — `exhaustedAtLeast` is a counter only he can turn on
  //    reliably, and it had two payoffs. Now it has six.
  // 3. **火攻与瘴疠** — the control axis, and where the two orphaned status
  //    words go. 力竭 had *no* card in the game applying it (only 天命 used
  //    it, on the player, in the last fight of a run) and 中毒 hung off one
  //    無色 uncommon. Both are 诸葛亮's by theme — burning stores and southern
  //    miasma are how he wins fights he does not fight — so both become a
  //    small chain here instead of a definition nothing reaches.
  //
  // Kept off him deliberately: 连击 (赵云's `attacksAtLeast`) and stacked
  // 神力 (关羽's). `tests/heroes.test.ts` 「武将机制互不串味」 is the guard.

  // --- common ---------------------------------------------------------

  /** 借箭之计's mirror on the attack side: the workhorse 攻 he did not have. */
  huoshi: {
    id: 'huoshi',
    name: '火矢',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-huoshi',
    text: '造成 {D} 点伤害。\n将 1 张「锦囊」置入手牌。',
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'addCard', defId: 'jinnang', count: 1, to: 'hand' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n将 1 张「锦囊」置入手牌。',
      effects: [
        { kind: 'damage', amount: 10 },
        { kind: 'addCard', defId: 'jinnang', count: 1, to: 'hand' },
      ],
    },
  },

  /**
   * 力竭 enters the game here. It cuts the 护甲 a body *gains* by a quarter,
   * which is aimed at exactly the enemies that turtle — 董卓亲兵's 龟缩, 华雄's
   * 蓄势, every 守 move in the tables — and does nothing at all against a pure
   * attacker. A conditional answer, not a stat stick.
   */
  duandao: {
    id: 'duandao',
    name: '断道',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-duandao',
    text: '施加 2 层【力竭】。\n获得 {B} 点护甲。',
    effects: [
      { kind: 'status', status: 'frail', amount: 2, to: 'target' },
      { kind: 'block', amount: 5 },
    ],
    upgrade: {
      text: '施加 3 层【力竭】。\n获得 {B} 点护甲。',
      effects: [
        { kind: 'status', status: 'frail', amount: 3, to: 'target' },
        { kind: 'block', amount: 7 },
      ],
    },
  },

  /** 南征. 中毒 stops being a one-card curiosity and becomes a line to draft. */
  zhangqi: {
    id: 'zhangqi',
    name: '瘴气',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-zhangqi',
    text: '施加 4 层【中毒】。',
    effects: [{ kind: 'status', status: 'poison', amount: 4, to: 'target' }],
    upgrade: {
      text: '施加 6 层【中毒】。',
      effects: [{ kind: 'status', status: 'poison', amount: 6, to: 'target' }],
    },
  },

  /** 消耗堆 payoff at the cheapest rung, so the counter matters from 第一幕. */
  tuntian: {
    id: 'tuntian',
    name: '屯田',
    type: 'skill',
    rarity: 'common',
    cost: 1,
    target: 'self',
    art: 'card-tuntian',
    text: '获得 {B} 点护甲。\n若消耗堆不少于 3 张，改为 12 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'block', amount: 12 }],
        otherwise: [{ kind: 'block', amount: 6 }],
      },
    ],
    upgrade: {
      text: '获得 {B} 点护甲。\n若消耗堆不少于 3 张，改为 16 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 3 },
          then: [{ kind: 'block', amount: 16 }],
          otherwise: [{ kind: 'block', amount: 8 }],
        },
      ],
    },
  },

  /** 0 气 filler that feeds the 消耗堆 rather than the hand. */
  caolu: {
    id: 'caolu',
    name: '草庐',
    type: 'skill',
    rarity: 'common',
    cost: 0,
    target: 'self',
    art: 'card-caolu',
    text: '抽 1 张牌。\n将 1 张「锦囊」置入手牌。',
    effects: [
      { kind: 'draw', amount: 1 },
      { kind: 'addCard', defId: 'jinnang', count: 1, to: 'hand' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '抽 2 张牌。\n将 1 张「锦囊」置入手牌。',
      effects: [
        { kind: 'draw', amount: 2 },
        { kind: 'addCard', defId: 'jinnang', count: 1, to: 'hand' },
      ],
    },
  },

  /** A plain 攻 with a debuff rider — the common shelf needed a second one. */
  jimu: {
    id: 'jimu',
    name: '疑冢',
    type: 'attack',
    rarity: 'common',
    cost: 1,
    target: 'enemy',
    art: 'card-jimu',
    text: '造成 {D} 点伤害。\n施加 1 层【破绽】。',
    effects: [
      { kind: 'damage', amount: 6 },
      { kind: 'status', status: 'vulnerable', amount: 1, to: 'target' },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n施加 2 层【破绽】。',
      effects: [
        { kind: 'damage', amount: 9 },
        { kind: 'status', status: 'vulnerable', amount: 2, to: 'target' },
      ],
    },
  },

  // --- uncommon -------------------------------------------------------

  /** The 中毒 multiplier. Alone it is weak; behind 瘴气 it is the line's spine. */
  wuxilu: {
    id: 'wuxilu',
    name: '五溪',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-wuxilu',
    text: '对所有敌人施加 3 层【中毒】。',
    effects: [{ kind: 'status', status: 'poison', amount: 3, to: 'allEnemies' }],
    upgrade: {
      text: '对所有敌人施加 5 层【中毒】。',
      effects: [{ kind: 'status', status: 'poison', amount: 5, to: 'allEnemies' }],
    },
  },

  /** 力竭 in the round shape, for the rooms that field three shields. */
  jueying: {
    id: 'jueying',
    name: '绝营',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-jueying',
    text: '对所有敌人施加 2 层【力竭】。',
    effects: [{ kind: 'status', status: 'frail', amount: 2, to: 'allEnemies' }],
    upgrade: {
      text: '对所有敌人施加 3 层【力竭】。',
      effects: [{ kind: 'status', status: 'frail', amount: 3, to: 'allEnemies' }],
    },
  },

  /** 消耗堆 as damage. The 攻 the 消耗 line was missing below 稀有. */
  fenju: {
    id: 'fenju',
    name: '焚聚',
    type: 'attack',
    rarity: 'uncommon',
    cost: 2,
    target: 'enemy',
    art: 'card-fenju',
    text: '造成 {D} 点伤害。\n若消耗堆不少于 5 张，改为 20 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 5 },
        then: [{ kind: 'damage', amount: 20 }],
        otherwise: [{ kind: 'damage', amount: 11 }],
      },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n若消耗堆不少于 5 张，改为 26 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 5 },
          then: [{ kind: 'damage', amount: 26 }],
          otherwise: [{ kind: 'damage', amount: 14 }],
        },
      ],
    },
  },

  /** 气 into cards, the trade his 纶巾 exists to make. */
  tuizhen: {
    id: 'tuizhen',
    name: '推演',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-tuizhen',
    text: '将 2 张「锦囊」置入手牌。\n抽 1 张牌。',
    effects: [
      { kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' },
      { kind: 'draw', amount: 1 },
    ],
    upgrade: {
      text: '将 3 张「锦囊」置入手牌。\n抽 1 张牌。',
      effects: [
        { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
        { kind: 'draw', amount: 1 },
      ],
    },
  },

  /** A second 破绽 opener, priced for the turn it sets up rather than its own. */
  qiaoshe: {
    id: 'qiaoshe',
    name: '巧舌',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'all',
    art: 'card-qiaoshe',
    text: '对所有敌人施加 2 层【破绽】。',
    effects: [{ kind: 'status', status: 'vulnerable', amount: 2, to: 'allEnemies' }],
    upgrade: {
      text: '对所有敌人施加 3 层【破绽】。',
      effects: [{ kind: 'status', status: 'vulnerable', amount: 3, to: 'allEnemies' }],
    },
  },

  /** 硬 攻 with no rider, because a pool of riders cannot close a fight. */
  liaoyuan: {
    id: 'liaoyuan',
    name: '燎原',
    type: 'attack',
    rarity: 'uncommon',
    cost: 2,
    target: 'all',
    art: 'card-liaoyuan',
    text: '对所有敌人造成 {D} 点伤害。',
    effects: [{ kind: 'damageAll', amount: 10 }],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害。',
      effects: [{ kind: 'damageAll', amount: 14 }],
    },
  },

  /** Cheap 攻 that pays the 消耗 line without needing it. */
  jiefeng: {
    id: 'jiefeng',
    name: '借风',
    type: 'attack',
    rarity: 'uncommon',
    cost: 1,
    target: 'enemy',
    art: 'card-jiefeng',
    text: '造成 {D} 点伤害。\n消耗手牌中 1 张牌。',
    effects: [
      { kind: 'damage', amount: 11 },
      { kind: 'exhaustCards', amount: 1 },
    ],
    upgrade: {
      text: '造成 {D} 点伤害。\n消耗手牌中 1 张牌。',
      effects: [
        { kind: 'damage', amount: 15 },
        { kind: 'exhaustCards', amount: 1 },
      ],
    },
  },

  /** 回复 on the hero who cannot trade 体力 for anything. */
  yangsheng: {
    id: 'yangsheng',
    name: '养生',
    type: 'skill',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-yangsheng',
    text: '获得 {B} 点护甲。\n回复 4 点体力。',
    effects: [
      { kind: 'block', amount: 6 },
      { kind: 'heal', amount: 4 },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '获得 {B} 点护甲。\n回复 7 点体力。',
      effects: [
        { kind: 'block', amount: 9 },
        { kind: 'heal', amount: 7 },
      ],
    },
  },

  /** 势 that turns the 锦囊 stream into a defensive engine. */
  jingtianfa: {
    id: 'jingtianfa',
    name: '井田法',
    type: 'power',
    rarity: 'uncommon',
    cost: 1,
    target: 'self',
    art: 'card-jingtianfa',
    text: '每消耗一张非【势】牌，获得等量护甲。',
    effects: [{ kind: 'status', status: 'armory', amount: 2, to: 'self' }],
    keywords: ['exhaust'],
    upgrade: {
      text: '每消耗一张非【势】牌，获得等量护甲。',
      effects: [{ kind: 'status', status: 'armory', amount: 3, to: 'self' }],
    },
  },

  // --- rare -----------------------------------------------------------

  /**
   * 稀有 攻 #2. 诸葛亮 had exactly one 稀有 that could kill anything, which is
   * why a deck of his could reach 张宝 and then fail to finish him.
   */
  huoshaoxinye: {
    id: 'huoshaoxinye',
    name: '火烧新野',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'all',
    art: 'card-huoshaoxinye',
    text: '对所有敌人造成 {D} 点伤害。\n再对所有敌人施加 3 层【中毒】。',
    effects: [
      { kind: 'damageAll', amount: 14 },
      { kind: 'status', status: 'poison', amount: 3, to: 'allEnemies' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害。\n再对所有敌人施加 5 层【中毒】。',
      effects: [
        { kind: 'damageAll', amount: 18 },
        { kind: 'status', status: 'poison', amount: 5, to: 'allEnemies' },
      ],
    },
  },

  /** 稀有 攻 #3 — the single-target finisher the pool had none of. */
  shangfanggu: {
    id: 'shangfanggu',
    name: '上方谷',
    type: 'attack',
    rarity: 'rare',
    cost: 3,
    target: 'enemy',
    art: 'card-shangfanggu',
    text: '造成 {D} 点伤害。\n若消耗堆不少于 8 张，改为 42 点。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 8 },
        then: [{ kind: 'damage', amount: 42 }],
        otherwise: [{ kind: 'damage', amount: 24 }],
      },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '造成 {D} 点伤害。\n若消耗堆不少于 8 张，改为 52 点。',
      effects: [
        {
          kind: 'conditional',
          when: { c: 'exhaustedAtLeast', n: 8 },
          then: [{ kind: 'damage', amount: 52 }],
          otherwise: [{ kind: 'damage', amount: 30 }],
        },
      ],
    },
  },

  /** 稀有 攻 #4, and the 力竭 line's ceiling. */
  bawangzhen: {
    id: 'bawangzhen',
    name: '八望阵',
    type: 'attack',
    rarity: 'rare',
    cost: 2,
    target: 'all',
    art: 'card-bawangzhen',
    text: '对所有敌人造成 {D} 点伤害。\n再对所有敌人施加 2 层【力竭】与 2 层【怯战】。',
    effects: [
      { kind: 'damageAll', amount: 12 },
      { kind: 'status', status: 'frail', amount: 2, to: 'allEnemies' },
      { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
    ],
    upgrade: {
      text: '对所有敌人造成 {D} 点伤害。\n再对所有敌人施加 3 层【力竭】与 3 层【怯战】。',
      effects: [
        { kind: 'damageAll', amount: 16 },
        { kind: 'status', status: 'frail', amount: 3, to: 'allEnemies' },
        { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
      ],
    },
  },

  /** 势 that makes the 中毒 line a build rather than a pair of cards. */
  liufulong: {
    id: 'liufulong',
    name: '六出祁山',
    type: 'power',
    rarity: 'rare',
    cost: 2,
    target: 'self',
    art: 'card-liufulong',
    text: '将 4 张「锦囊」置入手牌。\n获得 2 点【神力】。',
    effects: [
      { kind: 'addCard', defId: 'jinnang', count: 4, to: 'hand' },
      { kind: 'status', status: 'strength', amount: 2, to: 'self' },
    ],
    keywords: ['exhaust'],
    upgrade: {
      text: '将 5 张「锦囊」置入手牌。\n获得 3 点【神力】。',
      effects: [
        { kind: 'addCard', defId: 'jinnang', count: 5, to: 'hand' },
        { kind: 'status', status: 'strength', amount: 3, to: 'self' },
      ],
    },
  },
};
