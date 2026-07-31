import type { RewardRarity } from '../combat/rewards';
import type { RunState } from '../state/run';

/**
 * 奇遇 — the event table.
 *
 * Data only. Nothing here mutates a run, imports a table at module scope or
 * knows what a scene is: `src/rooms/events.ts` reads this and applies it,
 * `src/rooms/eventView.ts` draws whatever that hands back. The only runtime
 * value this module produces is `EVENTS` itself, and the only functions on it
 * are `requires` predicates, which read a `RunState` and never write one.
 *
 * The rule every entry is held to (and `tests/rooms.events.test.ts` checks):
 * **an option that pays must also cost.** A room the player clicks through
 * collecting prizes is not a decision, and 21% of the map is events — a free
 * one every three floors would quietly double the run's income.
 *
 * Two costs are deliberately *not* used as costs. Removing a card is a benefit
 * in a deckbuilder, not a price, so 官渡焚粮 charges blood rather than 「弃一张
 * 牌」 the way the design note originally had it. And 「无事发生」 is only ever
 * offered as the *decline* half of a choice, never as the whole of one.
 */

// -------------------------------------------------------------------- shapes

/**
 * Which shelf a rolled relic comes off. `boss` and `shop` are closed pools that
 * events must not reach into — a boss relic handed out by a random 奇遇 would
 * make the act's own boss reward feel like small change.
 */
export type EventRelicTier = 'common' | 'uncommon' | 'rare';

/** A named relic, or one rolled off a tier. Never both. */
export type RelicGrant = { tier: EventRelicTier } | { id: string };

/**
 * Cards handed to the deck. `ids` are exact; `count` + `rarity` rolls that many
 * off the reward pool. Curses never come through here — `addCard` throws on
 * one — they have their own field, and their own door in `run.ts`.
 */
export interface CardGrant {
  ids?: string[];
  count?: number;
  /** Defaults to `common`. */
  rarity?: RewardRarity;
  upgraded?: number;
}

/**
 * What an option does, declaratively — no callbacks, so an outcome can be
 * asserted field by field in a test and read back off a save without needing
 * the code that produced it.
 */
export interface EventOutcome {
  /** Replaces the body text once the option resolves. */
  text: string;
  /** Positive is income (relic-multiplied); negative is a charge at face value. */
  gold?: number;
  /** 五丈原's 「散尽资财」 — the amount is not knowable when the table is written. */
  spendAllGold?: boolean;
  /** Flat 体力. Negative is a wound; see the clamp note on `applyOutcome`. */
  hp?: number;
  /** A fraction of *current* 体力 lost, rounded up. 0.2 = 两成. */
  hpLossPercent?: number;
  /** Capacity. A gain heals for what it grants, the way a relic's does. */
  maxHp?: number;
  healToFull?: boolean;
  gainRelic?: RelicGrant;
  /** Bottles rolled off the drop table. A full belt refuses them. */
  gainPotion?: number;
  gainCards?: CardGrant;
  /** A curse id. Goes through `addCurse`, which is the only door that takes one. */
  gainCurse?: string;
  /** Opens the deck grid. At most one pick per node — see `resolvePending`. */
  removeCards?: number;
  upgradeCards?: number;
  /**
   * 易牌: the picked copies are shed and replaced with random cards of the same
   * rarity band (`transformRarity` maps 起手牌's `basic` onto `common`, which is
   * the only rarity a pool can actually deal). No 奇遇 uses it today — 开局祝福
   * (todos/18) is what it exists for.
   */
  transformCards?: number;
  /** Hands the player to `CombatScene`. The room is over either way. */
  fight?: { tier: 'monster' | 'elite'; bonusRelic?: string };
  /**
   * A weighted switch. The chosen branch replaces this outcome *whole* — the
   * parent's other fields are ignored — so a branch reads as one complete
   * result rather than as a diff against something the player never saw.
   * Branches do not nest.
   */
  branches?: { weight: number; outcome: EventOutcome }[];
}

export interface EventOption {
  label: string;
  /** The grey line under the button. Spell the price out; never make them guess. */
  hint: string;
  /** Unmet options are shown greyed with `requiresText`, never hidden. */
  requires?: (run: RunState) => boolean;
  requiresText?: string;
  outcome: EventOutcome;
  /** 山中残兵 — may be taken again until something else resolves the event. */
  repeatable?: boolean;
  tone?: 'default' | 'gold' | 'danger';
}

export interface EventDef {
  id: string;
  name: string;
  /** The line under the title — a place and a date, in the style of a 题跋. */
  sub: string;
  body: string;
  options: EventOption[];
  /** Never offered twice in one run, even after the pool has been exhausted. */
  once?: boolean;
  /** Earliest floor, 0-indexed. Keeps the 20-体力 gambles off floor one. */
  minRow?: number;
}

/**
 * The floor under any option that wounds and then hands the player to a fight,
 * or that may be taken over and over.
 *
 * `applyOutcome` clamps a wound at 1 体力 rather than killing (the defeat
 * screen belongs to `CombatScene` and the room layer cannot reach it), and that
 * clamp is a hole in two directions. A repeatable option stops costing anything
 * at all once the player is pinned at the floor — 山中残兵 could then be farmed
 * for unbounded 資財 at no price. And an option that ends in a fight could hand
 * a 1-体力 player to an 精英, which the room layer had carefully avoided doing
 * itself.
 *
 * A quarter of the ceiling, so it scales with 体力上限 relics rather than going
 * stale the moment one is picked up.
 */
export const RISK_FLOOR = (run: RunState): boolean => run.hp > run.maxHp * 0.25;
export const RISK_FLOOR_TEXT = '伤重难行，此事做不得。';

// -------------------------------------------------------------------- the table

/**
 * Twelve, against ~3.14 event rooms a run: the pool is wide enough that two
 * runs rarely rhyme, and `seenEvents` de-duplicates within a run regardless.
 */
export const EVENTS: EventDef[] = [
  {
    id: 'taoyuan',
    name: '桃园结义',
    sub: '涿郡 · 中平元年',
    once: true,
    body: '桃林深处，三人焚香列拜，血酒尚温。\n为首者回身看你：「同生共死，可愿？」\n篱外另有一队商旅，正以五十金招募护卫。',
    options: [
      {
        label: '歃血同盟',
        hint: '体力上限 +8',
        outcome: { text: '一拜之后，肩上多了两条命，也多了一口气。', maxHp: 8 },
      },
      {
        label: '受金而去',
        hint: '资财 +50',
        tone: 'gold',
        outcome: { text: '商队的钱袋很沉。桃花落在身后，没有回头。', gold: 50 },
      },
    ],
  },

  {
    id: 'caochuanjiejian',
    name: '草船借箭',
    sub: '赤壁 · 大雾',
    minRow: 2,
    body: '大雾锁江，二十只草船泊在浅滩。\n对岸是曹营的箭雨，也是唾手可得的军资。\n雾里行船，回来时未必还是这条身子。',
    options: [
      {
        label: '趁雾夜取',
        hint: '失 8 体力，得两瓶丹药',
        tone: 'danger',
        outcome: {
          text: '船身插满了箭。所幸只有两支穿透了草束。',
          hp: -8,
          gainPotion: 2,
        },
      },
      {
        label: '按兵不动',
        hint: '毫无所得',
        outcome: { text: '雾散时，江面空空如也。至少人是全的。' },
      },
    ],
  },

  {
    id: 'guandufenliang',
    name: '官渡焚粮',
    sub: '乌巢 · 建安五年',
    minRow: 3,
    body: '乌巢屯粮如山，守军酣睡，火把已在手中。\n烧，则敌军三日内必乱，只是这一把火要贴着敌营点。\n搬，则辎重尽归己有，可军中从此不肯吃苦。',
    options: [
      {
        label: '举火焚之',
        hint: '失 10 体力，得一件普通宝物',
        tone: 'danger',
        outcome: {
          text: '火起时被守军咬了一口。粮草化灰，帐中拾得一物。',
          hp: -10,
          gainRelic: { tier: 'common' },
        },
      },
      {
        label: '尽数运回',
        hint: '资财 +70，牌组混入诅咒【奢靡】',
        tone: 'gold',
        outcome: {
          text: '粮车压得辙痕三寸深。自此军中人人惦记着下一车。',
          gold: 70,
          gainCurse: 'shemi',
        },
      },
      {
        label: '不敢妄动',
        hint: '毫无所得',
        outcome: { text: '天亮了，守军换岗。机会只有那一夜。' },
      },
    ],
  },

  {
    id: 'wolonggang',
    name: '卧龙岗',
    sub: '南阳 · 大雪',
    once: true,
    minRow: 4,
    body: '草庐深锁，童子说先生午睡未醒。\n阶下的雪已没过靴面。等，是把命耗在这里；\n留一封书，也算尽了礼数。',
    options: [
      {
        label: '三顾其庐',
        hint: '失 12 体力，精进两张牌',
        tone: 'danger',
        outcome: {
          text: '雪立三日，冻伤了脚。先生出庐，为你改了两处兵法。',
          hp: -12,
          upgradeCards: 2,
        },
      },
      {
        label: '留书而去',
        hint: '精进一张牌',
        outcome: { text: '书留在案上。半月后有人送来一卷批注。', upgradeCards: 1 },
      },
    ],
  },

  {
    id: 'jiangdongfuyan',
    name: '江东赴宴',
    sub: '陆口 · 单刀一口',
    minRow: 5,
    body: '子敬设宴相邀，帖上写的是叙旧，\n帐后立的是刀斧手。案上先摆了一件重礼——\n收下，这顿饭就非吃不可了。',
    options: [
      {
        label: '单刀赴之',
        hint: '先得一件稀有宝物，随即陷入精锐死斗',
        tone: 'danger',
        requires: RISK_FLOOR,
        requiresText: RISK_FLOOR_TEXT,
        outcome: {
          text: '礼收下了。酒过三巡，帐后甲叶作响。',
          gainRelic: { tier: 'rare' },
          fight: { tier: 'elite' },
        },
      },
      {
        label: '婉言谢绝',
        hint: '毫无所得',
        outcome: { text: '回帖只写了八个字：军务在身，改日再叙。' },
      },
    ],
  },

  {
    id: 'huatuo',
    name: '华佗行医',
    sub: '谯县 · 青囊在侧',
    minRow: 3,
    body: '案上一卷青囊书，一柄薄如蝉翼的刀。\n神医说：汤药只能镇住头风，\n要除根，得开颅。他说这话时手很稳。',
    options: [
      {
        label: '服药静养',
        hint: '体力回满',
        outcome: { text: '三剂汤药下去，头不疼了。神医摇头：治标而已。', healToFull: true },
      },
      {
        label: '开颅去疾',
        hint: '七成 体力上限 +15；三成 失 20 体力',
        tone: 'danger',
        outcome: {
          text: '',
          branches: [
            {
              weight: 70,
              outcome: {
                text: '刀落颅开，再醒来时神清目明，气力比从前更足。',
                maxHp: 15,
              },
            },
            {
              weight: 30,
              outcome: {
                text: '刀偏了半分。血流了半日才止住，人险些没能醒过来。',
                hp: -20,
              },
            },
          ],
        },
      },
      {
        label: '谢而不受',
        hint: '资财 +25（诊金退还）',
        tone: 'gold',
        outcome: { text: '诊金原封退回。神医收了刀，没再多说一句。', gold: 25 },
      },
    ],
  },

  {
    id: 'huangjintai',
    name: '黄金台',
    sub: '易水 · 燕昭王旧筑',
    minRow: 2,
    body: '燕昭王筑台以千金求士，台已倾颓，金却还在砖缝里。\n取之无人知晓。只是自此以后，\n每一次收兵，都会先想起这堆金子。',
    options: [
      {
        label: '尽取其金',
        hint: '资财 +100，牌组混入诅咒【贪念】',
        tone: 'gold',
        outcome: {
          text: '金子装了三袋。夜里数了两遍，还想再数一遍。',
          gold: 100,
          gainCurse: 'tannian',
        },
      },
      {
        label: '拂袖而去',
        hint: '分文不取',
        outcome: { text: '台上风大。走出十里，心里反倒轻了。' },
      },
    ],
  },

  {
    id: 'yuxichenjiang',
    name: '玉玺沉江',
    sub: '洛阳城南 · 枯井',
    once: true,
    minRow: 6,
    body: '枯井里捞起一方血裹的玉玺，螭纽缺角，以黄金镶补。\n孙文台的旧事，就是从这一件东西开始的。\n藏，则此物噬主；沉，则换个心安。',
    options: [
      {
        label: '秘而私藏',
        hint: '得一件稀有宝物，失去两成体力',
        tone: 'danger',
        outcome: {
          text: '玉玺贴身藏了。此后夜夜梦见有人在帐外磨刀。',
          gainRelic: { tier: 'rare' },
          hpLossPercent: 0.2,
        },
      },
      {
        label: '沉之于江',
        hint: '资财 +80',
        tone: 'gold',
        outcome: {
          text: '玉玺入水，只响了一声。随行的人分了赏钱，都说没见过。',
          gold: 80,
        },
      },
    ],
  },

  {
    id: 'zuijiuzhangfei',
    name: '醉酒张飞',
    sub: '下邳 · 城破前夜',
    minRow: 4,
    body: '翼德抱坛而坐，见人便斟，酒气冲得帐帘直晃。\n这酒能解一身乏，也能误一座城——\n徐州就是这么丢的。',
    options: [
      {
        label: '陪他痛饮',
        hint: '体力回满，牌组混入诅咒【旧伤】',
        tone: 'danger',
        outcome: {
          text: '一坛见底，浑身舒泰。第二日醒来，旧年的刀口又裂了。',
          healToFull: true,
          gainCurse: 'jiushang',
        },
      },
      {
        label: '夺坛劝止',
        hint: '体力 +10',
        outcome: { text: '酒坛砸在地上。他骂了半宿，倒也让人睡了个囫囵觉。', hp: 10 },
      },
    ],
  },

  {
    id: 'xiangjianglaitou',
    name: '降将来投',
    sub: '辕门外 · 二百人',
    minRow: 2,
    body: '阵前倒戈的二百人跪在辕门外，为首者双手奉上印绶。\n收，军中便多了两双不知底细的手；\n遣，省下一笔粮饷，也省了一桩心事。',
    options: [
      {
        label: '收编入伍',
        hint: '牌组加入两张随机常见牌',
        outcome: {
          text: '编入左营。名册上多了两行字，阵中多了两分变数。',
          gainCards: { count: 2, rarity: 'common' },
        },
      },
      {
        label: '尽数遣散',
        hint: '资财 +40',
        tone: 'gold',
        outcome: { text: '给了盘缠，各自回乡。粮官松了一口气。', gold: 40 },
      },
    ],
  },

  {
    id: 'wuzhangyuan',
    name: '五丈原',
    sub: '渭水南岸 · 秋',
    once: true,
    minRow: 8,
    body: '七星灯已燃了六夜，主灯摇曳欲灭。\n续命之法要以军资供奉，且只此一次。\n帐外是渭水，帐内是最后一夜。',
    options: [
      {
        label: '设坛祈禳',
        hint: '散尽资财，体力回满并精进一张牌',
        requires: (run) => run.gold >= 75,
        requiresText: '需 75 资财',
        outcome: {
          text: '灯焰稳住了。军资尽入香案，帐中人重新握得住笔。',
          spendAllGold: true,
          healToFull: true,
          upgradeCards: 1,
        },
      },
      {
        label: '顺天而行',
        hint: '毫无所得',
        outcome: { text: '主灯灭了。星陨于渭水之南，无人再提续命的事。' },
      },
    ],
  },

  {
    id: 'shanzhongcanbing',
    name: '山中残兵',
    sub: '太行小道 · 断矛半截',
    minRow: 1,
    body: '山道两侧有新踩的脚印，草丛里露出半截断矛。\n是散兵丢下的辎重，还是没走远的埋伏？\n翻一处是一处，只看敢翻几次。',
    options: [
      {
        label: '继续搜寻',
        hint: '每搜一处 失 5 体力；四分之一遇伏，否则 资财 +30',
        tone: 'danger',
        repeatable: true,
        requires: RISK_FLOOR,
        requiresText: RISK_FLOOR_TEXT,
        outcome: {
          text: '',
          branches: [
            // The 5 体力 is what makes this a decision instead of a faucet.
            // Without it the search was the only *strictly* positive option in
            // the table: three finds on average is 90 資財 — a third of a run's
            // whole income — and the ambush that ends it is a normal fight,
            // which pays coin, a card and a 丹药 roll of its own. Blood is the
            // one currency the ambush cannot refund.
            {
              weight: 75,
              outcome: { text: '草丛里翻出一只钱袋，还带着体温。', gold: 30, hp: -5 },
            },
            {
              weight: 25,
              outcome: {
                text: '断矛后面站起来一个人，接着是第二个。',
                fight: { tier: 'monster' },
              },
            },
          ],
        },
      },
      {
        label: '就此离开',
        hint: '不再搜寻',
        outcome: { text: '退出山道。身后的草丛响了一下，没有回头看。' },
      },
    ],
  },
];

/**
 * The floor under the pool. Never in `EVENTS`, so it is never rolled and never
 * de-duplicated — it only appears when every real event has been spent, which
 * takes thirteen event rooms in one run.
 */
export const FALLBACK_EVENT: EventDef = {
  id: 'huangjingwuren',
  name: '荒径无人',
  sub: '无名山道',
  body: '山径寂寂，只有旧年的车辙。\n行囊翻出一小袋前朝的钱，锈得粘在一起。',
  options: [
    {
      label: '拾而藏之',
      hint: '资财 +25',
      tone: 'gold',
      outcome: { text: '钱数得清，路还长。', gold: 25 },
    },
  ],
};

const BY_ID: Record<string, EventDef> = Object.fromEntries(
  [...EVENTS, FALLBACK_EVENT].map((def) => [def.id, def]),
);

/** Throws on an unknown id: a save naming an event that no longer exists is a
 *  bug in a migration, not something to paper over with a silent fallback. */
export function getEvent(id: string): EventDef {
  const def = BY_ID[id];
  if (!def) throw new Error(`Unknown event id: ${id}`);
  return def;
}
