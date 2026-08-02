import type { EventOutcome } from './events';

/**
 * 开局祝福 — the table.
 *
 * Data only, exactly like `src/data/events.ts`: nothing here mutates a run,
 * imports a table at module scope or knows what a scene is. `src/rooms/
 * blessing.ts` rolls and applies it; `src/scenes/BlessingScene.ts` draws
 * whatever that hands back.
 *
 * **This table is deliberately not part of `EVENTS`.** Two reasons, both
 * checked elsewhere: `tests/rooms.events.test.ts` holds every 奇遇 option to
 * 「凡收益必有代价」, and 薄礼 / 厚赠 are pure gains — the price of a 祝福 is the
 * three you did *not* take. And an event needs a map node to hang its ledger
 * on, which a blessing does not have (see `RunState.blessing`).
 *
 * The shape of the decision, which is the whole design:
 *
 * - **薄礼** — small, certain, free.
 * - **厚赠** — large, certain, free.
 * - **交易** — the largest payouts in the game this early, each carrying a
 *   price rolled *independently* of it. This is the only class where the
 *   player is asked to give something up, and it is what makes the four-up a
 *   decision rather than a menu.
 * - **无所求** — take nothing, wear 布衣: +25% 资财 for the whole run against a
 *   坊市 that will not sell you a single 宝物.
 *
 * Ids are append-only. `run.blessing.offered` stores ids and nothing else, so a
 * rename is a save that no longer resolves — and, worse, a silent re-roll of
 * every seed at the point where the pool is indexed.
 */

export type BlessingCategory = 'minor' | 'major' | 'trade' | 'refuse';

/** Screen headings, in the order the four-up is drawn. */
export const BLESSING_CATEGORY_ORDER: readonly BlessingCategory[] = [
  'minor',
  'major',
  'trade',
  'refuse',
];

export const BLESSING_CATEGORY_LABEL: Record<BlessingCategory, string> = {
  minor: '薄礼',
  major: '厚赠',
  trade: '交易',
  refuse: '无所求',
};

export interface BlessingDef {
  id: string;
  category: BlessingCategory;
  /** The two-character name on the button. */
  label: string;
  /** What the player gets, in the player's words. Spell the numbers out. */
  desc: string;
  /** Reuses the 奇遇 result system whole — see `applyOutcome`. */
  outcome: EventOutcome;
  /**
   * 首领 relic. Not expressible as an `EventOutcome`: `EventRelicTier` closes
   * 首领 and 坊市 off on purpose, and widening it would open that door to all
   * twelve 奇遇 as well. `takeBlessing` rolls it last, after the outcome.
   */
  bossRelic?: true;
}

/**
 * The price half of a 交易. Kept apart from the benefit rather than written
 * into it so that the pairing can be rolled: five benefits × the costs each one
 * admits is a far wider opening than five fixed bundles.
 */
export interface BlessingCostDef {
  id: string;
  label: string;
  /** Drawn in cinnabar under the benefit. */
  desc: string;
  outcome: EventOutcome;
}

// ------------------------------------------------------------------- 薄礼

export const MINOR_BLESSINGS: readonly BlessingDef[] = [
  {
    id: 'm_yangjing',
    category: 'minor',
    label: '养精',
    desc: '体力上限 +8，并回复等量体力。',
    outcome: { text: '一碗药汤下肚，筋骨舒展了些。', maxHp: 8 },
  },
  {
    id: 'm_ziliang',
    category: 'minor',
    label: '资粮',
    desc: '得资财 100。',
    outcome: { text: '道人自袖中取出一囊，沉甸甸的。', gold: 100 },
  },
  {
    id: 'm_qiwu',
    category: 'minor',
    label: '弃芜',
    desc: '自牌组中弃去一张。',
    outcome: { text: '「多则惑，少则得。将军自择。」', removeCards: 1 },
  },
  {
    id: 'm_yipai',
    category: 'minor',
    label: '易牌',
    desc: '将一张牌换作同品的另一张。',
    outcome: { text: '「此技不趁手，换一路罢。」', transformCards: 1 },
  },
  {
    id: 'm_xieyao',
    category: 'minor',
    label: '携药',
    desc: '得丹药三瓶。',
    outcome: { text: '三只小瓶塞进行囊，叮当作响。', gainPotion: 3 },
  },
];

// ------------------------------------------------------------------- 厚赠

export const MAJOR_BLESSINGS: readonly BlessingDef[] = [
  {
    id: 'j_jingjian',
    category: 'major',
    label: '精简',
    desc: '自牌组中弃去两张。',
    outcome: { text: '「刀在精不在多。」', removeCards: 2 },
  },
  {
    id: 'j_michuan',
    category: 'major',
    label: '秘传',
    desc: '得稀世之技一张。',
    outcome: {
      text: '道人以指蘸茶，在案上画了一路刀法。',
      gainCards: { count: 1, rarity: 'rare' },
    },
  },
  {
    id: 'j_zengbao',
    category: 'major',
    label: '赠宝',
    desc: '得寻常宝物一件。',
    outcome: { text: '「聊备一物，权作程仪。」', gainRelic: { tier: 'common' } },
  },
  {
    id: 'j_duanlian',
    category: 'major',
    label: '锻炼',
    desc: '将一张牌精进。',
    outcome: { text: '炉火通宵，一技已熟。', upgradeCards: 1 },
  },
  {
    id: 'j_huanxue',
    category: 'major',
    label: '换血',
    desc: '将两张牌各换作同品的另一张。',
    outcome: { text: '「旧路走死了，换两条。」', transformCards: 2 },
  },
];

// ------------------------------------------------------------------- 交易

export const TRADE_BLESSINGS: readonly BlessingDef[] = [
  {
    id: 't_qizhen',
    category: 'trade',
    label: '奇珍',
    desc: '得罕见宝物一件。',
    outcome: { text: '匣中之物，非市井所有。', gainRelic: { tier: 'uncommon' } },
  },
  {
    id: 't_milu',
    category: 'trade',
    label: '秘录',
    desc: '得稀世之技三张。',
    outcome: {
      text: '半卷残书递来，字迹如刀。',
      gainCards: { count: 3, rarity: 'rare' },
    },
  },
  {
    id: 't_hufu',
    category: 'trade',
    label: '虎符',
    desc: '得首领之宝一件。',
    outcome: { text: '铜面斑驳的半枚虎符：「持此者，令行三军。」' },
    bossRelic: true,
  },
  {
    id: 't_houbi',
    category: 'trade',
    label: '厚币',
    desc: '得资财 250。',
    outcome: { text: '钱帛堆在案上，比人还沉。', gold: 250 },
  },
  {
    id: 't_cuiti',
    category: 'trade',
    label: '淬体',
    desc: '体力上限 +20，并回复等量体力。',
    outcome: { text: '一夜针石，血气如新。', maxHp: 20 },
  },
];

/**
 * The prices. Three, and only three: a price the player cannot read at a glance
 * is not a decision, it is a surprise.
 *
 * None of them touches a field any benefit above uses — `takeBlessing` merges
 * the two outcomes into one, and `tests/blessing.test.ts` proves the merge is
 * lossless for every pair the table can actually produce.
 */
export const BLESSING_COSTS: readonly BlessingCostDef[] = [
  {
    id: 'c_geshe',
    label: '割股',
    desc: '代价：失去一成体力。',
    outcome: { text: '', hpLossPercent: 0.1 },
  },
  {
    id: 'c_suji',
    label: '宿疾',
    desc: '代价：「旧伤」入册，此行不去。',
    outcome: { text: '', gainCurse: 'jiushang' },
  },
  {
    id: 'c_qingnang',
    label: '倾囊',
    desc: '代价：资财尽散。',
    outcome: { text: '', spendAllGold: true },
  },
];

// ---------------------------------------------------------------- 无所求

export const REFUSE_BLESSINGS: readonly BlessingDef[] = [
  {
    id: 'r_bushou',
    category: 'refuse',
    label: '不受',
    desc: '得宝物「布衣」：体力上限 +10，但此行不购宝物。',
    outcome: {
      text: '「无所求者，反得其全。」道人递来一件粗麻布衣。',
      gainRelic: { id: 'buyi' },
    },
  },
];

// -------------------------------------------------------------------- 查表

export const BLESSINGS_BY_CATEGORY: Record<BlessingCategory, readonly BlessingDef[]> = {
  minor: MINOR_BLESSINGS,
  major: MAJOR_BLESSINGS,
  trade: TRADE_BLESSINGS,
  refuse: REFUSE_BLESSINGS,
};

export const ALL_BLESSINGS: readonly BlessingDef[] = BLESSING_CATEGORY_ORDER.flatMap(
  (category) => BLESSINGS_BY_CATEGORY[category],
);

export const getBlessing = (id: string): BlessingDef | undefined =>
  ALL_BLESSINGS.find((def) => def.id === id);

export const getBlessingCost = (id: string): BlessingCostDef | undefined =>
  BLESSING_COSTS.find((def) => def.id === id);

/**
 * Which prices a benefit may be sold at. **A lookup, never a draw** — the pool
 * is narrowed *before* the cost is rolled, so adding a fourth price changes
 * what a seed pays but never how many numbers it pulls (R3).
 *
 * One exclusion, and it is arithmetic rather than taste: `applyOutcome` empties
 * the purse *before* it fills it (`spendAllGold` then `gold`, events.ts), so
 * 厚币 + 倾囊 would hand over 250 資財 and charge nothing at all. The rule is
 * written against the field instead of against the id, so a second coin benefit
 * cannot reintroduce the hole.
 */
export function costsFor(benefit: BlessingDef): readonly BlessingCostDef[] {
  return BLESSING_COSTS.filter(
    (cost) => !(cost.outcome.spendAllGold && (benefit.outcome.gold ?? 0) > 0),
  );
}
