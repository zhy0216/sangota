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
  /**
   * A fraction of 体力**上限** lost, rounded up. 0.2 = 两成.
   *
   * Off the ceiling rather than off the bar, since 2026-08 — see the note in
   * `applyOutcome`. A percentage of the *current* bar is a price that shrinks
   * precisely when the player is best placed to pay it.
   */
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
   * the only rarity a pool can actually deal). 月旦评 asks for it from the table;
   * 开局祝福 (todos/18) parks the same shape on run.blessing.
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
  /**
   * The grey line under the button. **Spell the stakes out; never spell the
   * odds out.**
   *
   * The price half of that rule is old and unchanged: a player must know what
   * they are paying and what they stand to win, in numbers, before they click —
   * an option whose cost is a surprise is a trap, not a choice.
   *
   * The odds half is 2026-08. Four hints used to print the weights of their own
   * `branches`（「七成…三成…」）, which turned every gamble into arithmetic: the
   * hundredth time you met 青梅煮酒 you knew exactly as much as the first, and
   * there was nothing left to learn, remember or dread. Naming both outcomes
   * without their weights keeps the decision informed and keeps the roll a roll.
   */
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
  /** Acts in which this event may be rolled. Absent means all three main acts. */
  acts?: readonly (1 | 2 | 3)[];
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
 * Twenty-nine total: eleven global plus six exclusive to each main act. A run
 * enters roughly nine event rooms, so it now sees about a third of the whole
 * table while each act still carries a distinct historical flavour.
 */
export const EVENTS: EventDef[] = [
  {
    id: 'taoyuan',
    name: '桃园结义',
    sub: '涿郡 · 中平元年',
    acts: [1],
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
    // 2026-08 收进二三幕。`minRow: 5` 一个人拦不住它：它无幕限制时，第一幕
    // 第五层就能用一场一幕精英换一件 **稀有** 宝物，而一幕精英池里坐着
    // e3 神上使（42 体力），抽中即等于白送。同结构的 虎牢残骑 限二幕、只给
    // 罕见——这一条本来就该跟它一档。
    acts: [2, 3],
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

  /**
   * 2026-08. 江东赴宴 moved to `acts: [2, 3]` and took 第一幕's pool from 17
   * down to 16 with it; this is the row that puts it back, and 第一幕 is the
   * act that could least afford to lose one — it is where a new player forms
   * their first impression of what an 奇遇 even is.
   *
   * Both options cost and both pay, with no 「毫无所得」 third: 20/29 rows in
   * this table already carry a decline button, and a decline button is a safety
   * valve, not a decision. Here the decision is the whole room — 資財 against
   * 体力, two 精 against one 罕见 — and 第一幕 is exactly where the purse and
   * the 体力 bar are tight enough for that to hurt either way.
   */
  {
    id: 'luzhiqiuche',
    name: '卢植囚车',
    sub: '广宗 · 槛车北去',
    acts: [1],
    minRow: 2,
    body: '槛车停在道边，车里坐的是刚破了黄巾主力的中郎将。\n押送的宦官嫌你碍事，挥手要你让路。\n车里那人却隔着木栅看了你一眼，像是有话要说。',
    options: [
      {
        label: '上书鸣冤',
        hint: '费 40 资财打点，精进两张牌',
        requires: (run) => run.gold >= 40,
        requiresText: '需 40 资财',
        outcome: {
          text: '文书递上去石沉大海，倒是押送的老卒收了钱，\n把车里传出的两卷批注塞进了你怀里。',
          gold: -40,
          upgradeCards: 2,
        },
      },
      {
        label: '随车问学',
        hint: '失 8 体力，得一张随机罕见牌',
        tone: 'danger',
        outcome: {
          text: '你徒步随车走了三十里，靴底磨穿，人也脱了形。\n三十里路换来的东西，写在一张纸上，只有半页。',
          hp: -8,
          gainCards: { count: 1, rarity: 'uncommon' },
        },
      },
    ],
  },

  {
    id: 'huatuo',
    name: '华佗行医',
    sub: '谯县 · 青囊在侧',
    acts: [1],
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
        hint: '刀下搏命：或体力上限 +15，或失 20 体力',
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
    acts: [1],
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
    acts: [2],
    once: true,
    minRow: 6,
    body: '枯井里捞起一方血裹的玉玺，螭纽缺角，以黄金镶补。\n孙文台的旧事，就是从这一件东西开始的。\n藏，则此物噬主；沉，则换个心安。',
    options: [
      {
        label: '秘而私藏',
        hint: '得一件稀有宝物，失去两成体力上限之数',
        tone: 'danger',
        requires: RISK_FLOOR,
        requiresText: RISK_FLOOR_TEXT,
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
    acts: [2],
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
    acts: [3],
    once: true,
    minRow: 8,
    body: '七星灯已燃了六夜，主灯摇曳欲灭。\n续命之法要以军资供奉，且只此一次。\n帐外是渭水，帐内是最后一夜。',
    options: [
      {
        label: '设坛祈禳',
        hint: '散尽资财，体力回满并精进一张牌',
        // 门槛 75 → 150（2026-08）。`spendAllGold` 收多少全看进门时钱袋有
        // 多鼓，所以门槛就是这一格的**真实底价**：三幕普通房均金 24.6、精英
        // 58、首领 130，走到 minRow 8 时 75 已是零头，先绕去坊市花空再进来
        // 几乎白拿。150 让「散尽」重新是一句实话。
        requires: (run) => run.gold >= 150,
        requiresText: '需 150 资财',
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
        hint: '每搜一处 失 5 体力：或得 资财 +30，或撞上埋伏',
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

  {
    id: 'yuedanping',
    name: '月旦评',
    sub: '汝南 · 月旦之期',
    minRow: 2,
    body: '汝南许氏月旦设评，一句褒贬，足定终身。\n你把麾下诸人名帖尽数递了上去。\n评语张出那日，营门外有人连夜卷了行装。',
    options: [
      {
        // 全表第一处 transformCards——同稀有度换血，非弃非精进。`eventView`
        // 的易牌栅格与 `resolvePending` 的 `blessingTransform` 流早已就位。
        label: '依评黜陟',
        hint: '择两张牌易之，各得同稀有度随机一张',
        outcome: {
          text: '朱批既下，旧人自去，新人自来。名帖收回时，营中气象已是一新。',
          transformCards: 2,
        },
      },
      {
        label: '付之一笑',
        hint: '毫无所得',
        outcome: { text: '虚名月旦，臧否由人。名帖收回袖中，该带的兵还是这些。' },
      },
    ],
  },

  {
    id: 'huluhezhi',
    name: '呼卢喝雉',
    sub: '军市 · 上灯时分',
    minRow: 2,
    body: '军市尽头围得水泄不通，五木掷得山响，呼卢喝雉之声不绝。\n庄家抬眼，把一把五铢推到你面前：\n「客官印堂发亮，是要发财的面相。来一把？」',
    options: [
      {
        // 全表唯一的纯赌局，点缀而非主菜。一注即散——绝不 repeatable，赢面
        // 分支无血价，repeat 即水龙头。负 gold 依约定以 requires 把守，钱袋
        // 见底赌不了。
        //
        // 2026-08 重做：原版是 45/55 赔一赔一，EV −5，赔率还印在 hint 上，
        // 于是它不是个赌局，是一道算术题——答案永远是「别赌」，这一格内容
        // 等同空房间。现在赔率不再明示（见 `EventOption.hint`），所以 EV 也
        // 不能再是负的：一个看不见抽头的负期望赌局是陷阱，不是选择。
        // 15/35/50 配 +120/+50/−50，EV ≈ +10——够低，一局至多见一两次不会
        // 冲垮资财曲线；方差够大，「差一把就够买那件宝物」时值得赌一手。
        label: '押五十金',
        hint: '押上 50 资财：或倍收，或大胜，或尽没',
        tone: 'gold',
        requires: (run) => run.gold >= 50,
        requiresText: '需 50 资财',
        outcome: {
          text: '',
          branches: [
            {
              weight: 15,
              outcome: {
                text: '五木齐黑，一掷成卢！满场哄然。庄家脸色由青转白，连本带利推了过来。',
                gold: 120,
              },
            },
            {
              weight: 35,
              outcome: { text: '雉采压过庄家一头。钱推回来时，那只手抖了一下。', gold: 50 },
            },
            {
              weight: 50,
              outcome: {
                text: '差一子成卢。钱进了庄家袖中，围观的人替你叹了一声。',
                gold: -50,
              },
            },
          ],
        },
      },
      {
        label: '袖手旁观',
        hint: '毫无所得',
        outcome: { text: '你看了三把，庄家赢了三把。钱袋按得更紧，转身出了灯影。' },
      },
    ],
  },

  {
    id: 'qingmeizhujiu',
    name: '青梅煮酒',
    sub: '许都 · 梅子青时',
    minRow: 3,
    body: '曹公相邀，小亭对坐，青梅煮酒正沸。\n他忽然放箸，遥指天边龙挂：「君观天下，谁堪称英雄？」\n亭外雷云低垂。这一问，答错了是要掉头的。',
    options: [
      {
        label: '从容对答',
        hint: '或得两瓶丹药，或牌组混入诅咒【疑心】',
        tone: 'danger',
        outcome: {
          text: '',
          branches: [
            {
              weight: 65,
              outcome: {
                text: '雷声恰过头顶，你俯身拾箸，惊惧掩作了从容。曹公抚掌大笑，临别以青梅酒两瓶相赠。',
                gainPotion: 2,
              },
            },
            {
              // 被疑者自此多疑——【疑心】长在被盯上的人身上。
              weight: 35,
              outcome: {
                text: '「天下英雄——」他盯着你，后半句终究没有说完。自此你总觉得背后悬着一道目光。',
                gainCurse: 'yixin',
              },
            },
          ],
        },
      },
      {
        label: '托病辞席',
        hint: '毫无所得',
        outcome: { text: '回帖称病。青梅自青，酒自沸，有些席面，不入座才是全身之道。' },
      },
    ],
  },

  {
    id: 'baimenlou',
    name: '白门楼',
    sub: '下邳 · 建安三年',
    acts: [2],
    minRow: 4,
    body: '城破之日，白门楼下缚着一员虓将，三姓的旧主都没能拴住他。\n他抬眼看你：「缚太急，可少宽乎？」\n此人骁勇冠绝当世，只是刀太快的，从来不问主人是谁。',
    options: [
      {
        // 两张罕见换一张【反噬】：养虎的利与养虎的价。牌是即时的锋，
        // 咒是留在手里的牙——弑其两父者，价目表上早写好了。
        label: '松绑而纳',
        hint: '牌组加入两张随机罕见牌，混入诅咒【反噬】',
        tone: 'danger',
        outcome: {
          text: '狼骑编入前营，锋锐无两。当夜起，你把佩刀挪到了枕边。',
          gainCards: { count: 2, rarity: 'uncommon' },
          gainCurse: 'fanshi',
        },
      },
      {
        // 桃园式二选一的另一半：价即是放弃上一项。FREE_BY_DESIGN 登记。
        label: '明正典刑',
        hint: '资财 +55',
        tone: 'gold',
        outcome: {
          text: '楼下一声令下，绳套收紧。并州军的辎重造册入库，营中睡了个安稳觉。',
          gold: 55,
        },
      },
    ],
  },

  {
    id: 'wenjiguihan',
    name: '文姬归汉',
    sub: '南匈奴 · 十二年后',
    minRow: 5,
    body: '胡帐深处传出汉家琴音，弹琴人鬓边已见霜色。\n通译低声说：左贤王开价百金，赎与不赎，只在一句话。\n她囊中无金无帛，只有默写下来的亡书残卷。',
    options: [
      {
        // 全表第一处拿弃牌当商品卖的事件（坊市外唯一的弃牌门）。负 gold
        // 依约定必须挂 requires——`addGold` 在零处钳位，不设门就是暗降价。
        label: '以百金赎之',
        hint: '费 100 资财，择两张牌弃之',
        requires: (run) => run.gold >= 100,
        requiresText: '需 100 资财',
        outcome: {
          text: '百金付讫，琴随车行。归途中她为你校订兵册，朱笔勾去芜杂两篇。',
          gold: -100,
          removeCards: 2,
        },
      },
      {
        label: '叹而去之',
        hint: '毫无所得',
        outcome: { text: '琴音又起，已换作胡笳的调子。你在帐外立了片刻，终究拨马而去。' },
      },
    ],
  },

  {
    id: 'yujifushui',
    name: '于吉符水',
    sub: '吴会 · 城门之下',
    minRow: 5,
    body: '城门下设着香案，一名道人以符水施药，饮者皆言沉疴立去。\n将佐劝你也求一盏。\n也有人低声提醒：孙讨逆，就是为这道人送的命。',
    options: [
      {
        // 全表第一处负 maxHp 作价：满血急救按天花板计息。次序无虞——
        // `applyOutcome` 先动上限后 `healToFull`，回满回的是降过的顶。
        label: '求符水一盏',
        hint: '体力回满，体力上限 -4',
        tone: 'danger',
        outcome: {
          text: '符灰入水，一饮而尽。宿疾霍然而愈，只是自此总觉中气短了一口。',
          healToFull: true,
          maxHp: -4,
        },
      },
      {
        label: '拂袖不受',
        hint: '毫无所得',
        outcome: { text: '道人也不恼，只朝你稽首一礼。身后的人群又跪下去一片。' },
      },
    ],
  },

  {
    id: 'baizouhuarong',
    name: '败走华容',
    sub: '华容小道 · 大雨初歇',
    acts: [3],
    once: true,
    minRow: 6,
    body: '败军自赤壁来，烧残的旌旗拖在泥里，人马塞满了半条窄道。\n为首者于马上欠身，笑得从容：「将军别来无恙？」\n旧年的恩，今日的功，两样只能全一样。',
    options: [
      {
        // 江东赴宴的低阶镜像：罕见宝物先落袋、随之的是残军（monster 而非
        // 精英）。fight 依约定押 RISK_FLOOR。人还是走脱了——史归史。
        label: '依令擒之',
        hint: '先得一件罕见宝物，随即与残军死斗',
        tone: 'danger',
        requires: RISK_FLOOR,
        requiresText: RISK_FLOOR_TEXT,
        outcome: {
          text: '残军困兽犹斗，虎卫拼死护主，终究还是让他走脱了。乱阵中缴得他遗下的行装。',
          gainRelic: { tier: 'uncommon' },
          fight: { tier: 'monster' },
        },
      },
      {
        // 军令状悬颈——恩义两清换一纸【宿命】。无退项是本意：立于华容道口，
        // 没有「绕着走」这个选项。
        label: '念旧放行',
        hint: '体力回满，牌组混入诅咒【宿命】',
        tone: 'danger',
        outcome: {
          text: '你勒马让开半条道。败军过尽，泥水里只余蹄印——军令状上的墨迹，忽然重了千斤。',
          healToFull: true,
          gainCurse: 'suming',
        },
      },
    ],
  },

  {
    id: 'hanshuibaoyi',
    name: '汉水暴溢',
    sub: '襄樊 · 秋霖不止',
    acts: [3],
    minRow: 7,
    body: '秋雨连绵十日，汉水在堤内翻涌如沸。\n低处扎着敌军七营，旗号泡得发白，鼓声都是潮的。\n只需掘开一道口子，水会替你打完这一仗。',
    options: [
      {
        // 官渡焚粮的第二级阶梯：10 血买普通在第 3 行，12 血买罕见在第 7 行。
        label: '决堤灌之',
        hint: '失 12 体力，得一件罕见宝物',
        tone: 'danger',
        outcome: {
          text: '你亲执锹钁立于堤上，寒雨彻骨。水声过处，七营俱没，浮获满江。',
          hp: -12,
          gainRelic: { tier: 'uncommon' },
        },
      },
      {
        // 仁者的那一半，价是放弃满江浮获。FREE_BY_DESIGN 登记。
        label: '掩堤缓进',
        hint: '资财 +35',
        tone: 'gold',
        outcome: {
          text: '你使人卷埽固堤，引军绕行。低处的百姓箪食壶浆，粮官收了几车谢礼。',
          gold: 35,
        },
      },
    ],
  },

  // --- 第一幕 · 黄巾与募兵 -------------------------------------------------

  {
    id: 'yingchuanmuyong',
    name: '颍川募勇',
    sub: '颍川 · 义旗初举',
    acts: [1],
    minRow: 1,
    body: '县署外挤满了投军的乡勇，甲不齐，粮也不足。\n主簿说四十五金可置一批伤药；若亲去乡里征粮，\n钱能省下，只怕要挨几下闷棍。',
    options: [
      {
        label: '出资募勇',
        hint: '费 45 资财，得两瓶丹药',
        requires: (run) => run.gold >= 45,
        requiresText: '需 45 资财',
        outcome: {
          text: '钱交给主簿，新兵背着药箱入列。队伍不整，救命的东西倒齐了。',
          gold: -45,
          gainPotion: 2,
        },
      },
      {
        label: '亲往征粮',
        hint: '失 6 体力，资财 +35',
        tone: 'danger',
        outcome: {
          text: '粮车带回来了，乡里的棍棒也没少落在肩背上。',
          hp: -6,
          gold: 35,
        },
      },
      {
        label: '整队离去',
        hint: '毫无所得',
        outcome: { text: '兵未足，粮未齐。至少没有在起兵第一日就欠下一笔账。' },
      },
    ],
  },

  {
    id: 'changshehuogong',
    name: '长社火攻',
    sub: '长社 · 夜风骤起',
    acts: [1],
    minRow: 2,
    body: '黄巾依草结营，夜风正往营中吹。\n火把一点，乱军必溃；但纵火的人要贴着鹿角进去，\n能带回什么，全看退得够不够快。',
    options: [
      {
        label: '衔枚纵火',
        hint: '失 8 体力，得一件普通宝物',
        tone: 'danger',
        outcome: {
          text: '火借风势卷过营盘。撤回时衣袖烧穿，怀里却多了一件敌军遗物。',
          hp: -8,
          gainRelic: { tier: 'common' },
        },
      },
      {
        label: '候风而退',
        hint: '毫无所得',
        outcome: { text: '风向半夜便转了。营火依旧，机会随烟散去。' },
      },
    ],
  },

  {
    id: 'taipingdaotan',
    name: '太平道坛',
    sub: '巨鹿 · 黄幡蔽日',
    acts: [1],
    minRow: 1,
    body: '废坛上摆着符水、铜钱与一卷太平要术的残页。\n取钱，便要饮符立誓；取书，则须以血洗去坛上的旧名。\n道人只在远处看着，不来相劝。',
    options: [
      {
        label: '饮符受财',
        hint: '资财 +60，牌组混入诅咒【疑心】',
        tone: 'danger',
        outcome: {
          text: '符水苦涩，铜钱却很实在。离坛十里，仍觉得身后有人跟着。',
          gold: 60,
          gainCurse: 'yixin',
        },
      },
      {
        label: '血洗残卷',
        hint: '失 7 体力，精进一张牌',
        tone: 'danger',
        outcome: {
          text: '旧名被血冲淡，残卷上的字却一行行清楚起来。',
          hp: -7,
          upgradeCards: 1,
        },
      },
      {
        label: '焚坛而去',
        hint: '毫无所得',
        outcome: { text: '黄幡化灰，铜钱熔在泥里。至少誓不是你立的。' },
      },
    ],
  },

  // --- 第二幕 · 洛阳与群雄 -------------------------------------------------

  {
    id: 'sishuaduanliang',
    name: '汜水断粮',
    sub: '汜水关外 · 粮道三十里',
    acts: [2],
    minRow: 1,
    body: '西凉军的粮队沿河而来，前后相隔半里。\n截下一段，军资便够用许久；只是关上鼓声一响，\n押粮兵立刻会合围回来。',
    options: [
      {
        label: '伏击粮队',
        hint: '先得 50 资财，随即陷入战斗',
        tone: 'danger',
        requires: RISK_FLOOR,
        requiresText: RISK_FLOOR_TEXT,
        outcome: {
          text: '粮车刚推入林中，关上便响了三通鼓。追兵已到。',
          gold: 50,
          fight: { tier: 'monster' },
        },
      },
      {
        label: '放其过去',
        hint: '毫无所得',
        outcome: { text: '车轮声渐远。关上今夜会吃得很饱。' },
      },
    ],
  },

  {
    id: 'luoyangcanjuan',
    name: '洛阳残卷',
    sub: '洛阳旧宫 · 焦梁之下',
    acts: [2],
    minRow: 2,
    body: '宫室烧尽，焦梁下压着几箱尚未成灰的兵书。\n纸页一碰便碎，只够抢救其中两卷；\n烟火未熄，进去的人得拿皮肉挡落木。',
    options: [
      {
        label: '入火抢书',
        hint: '失 8 体力，择两张牌易之',
        tone: 'danger',
        outcome: {
          text: '两卷兵书抱了出来，肩上也留下两道火痕。旧法换新法，正合乱世。',
          hp: -8,
          transformCards: 2,
        },
      },
      {
        label: '任其成灰',
        hint: '毫无所得',
        outcome: { text: '梁柱轰然倒下，前朝兵法与宫瓦一道成了灰。' },
      },
    ],
  },

  {
    id: 'hulaocanqi',
    name: '虎牢残骑',
    sub: '虎牢关东 · 败旗未倒',
    acts: [2],
    minRow: 4,
    body: '一队并州残骑守着主将遗下的兵匣，马瘦，人却不散。\n夺匣便得重器，但这些人已经没有退路，\n也不会再受第二次招降。',
    options: [
      {
        label: '破阵夺匣',
        hint: '先得一件罕见宝物，随即陷入精锐死斗',
        tone: 'danger',
        requires: RISK_FLOOR,
        requiresText: RISK_FLOOR_TEXT,
        outcome: {
          text: '匣已到手，残骑却从两翼合拢。最后一阵只能硬闯。',
          gainRelic: { tier: 'uncommon' },
          fight: { tier: 'elite' },
        },
      },
      {
        label: '收兵绕行',
        hint: '毫无所得',
        outcome: { text: '残旗在风里越来越小。没人追来，也没人投降。' },
      },
    ],
  },

  // --- 第三幕 · 汉中与北伐 -------------------------------------------------

  {
    id: 'dingjunshao',
    name: '定军斥候',
    sub: '定军山 · 暮色压营',
    acts: [3],
    minRow: 1,
    body: '斥候从敌营带回一册将校名录，夹页中还有一篇未传的阵法。\n他只要七十五金，今夜便离开此地。\n天亮之后，这册东西会落到谁手里就难说了。',
    options: [
      {
        label: '重金购册',
        hint: '费 75 资财，得一张随机稀有牌',
        requires: (run) => run.gold >= 75,
        requiresText: '需 75 资财',
        outcome: {
          text: '金袋落手，斥候没入暮色。名录烧了，阵法留在你的兵册里。',
          gold: -75,
          gainCards: { count: 1, rarity: 'rare' },
        },
      },
      {
        label: '扣册拿人',
        hint: '失 9 体力，得一张随机罕见牌',
        tone: 'danger',
        outcome: {
          text: '人拿住了，暗处的弩箭也到了。册页只保下半卷。',
          hp: -9,
          gainCards: { count: 1, rarity: 'uncommon' },
        },
      },
      {
        label: '不问来路',
        hint: '毫无所得',
        outcome: { text: '斥候带册离去。暮色里没有脚印。' },
      },
    ],
  },

  {
    id: 'muniuzidui',
    name: '木牛辎队',
    sub: '褒斜道 · 木轮无声',
    acts: [3],
    minRow: 2,
    body: '一列木牛停在栈道阴影里，车上没有押运兵，只有封好的军械。\n取走军械，须把随身资财全留作转运；\n空手的人，连车轴都不会为他转一下。',
    options: [
      {
        label: '散财转运',
        hint: '散尽资财，得一件罕见宝物',
        // 门槛 60 → 120（2026-08），与 五丈原 同理：`spendAllGold` 的底价就是
        // 它的门槛，60 在三幕买不下一件罕见宝物的一半（RELIC_PRICE.uncommon
        // 140-165），于是这一格成了绕开坊市定价的后门。
        requires: (run) => run.gold >= 120,
        requiresText: '需至少 120 资财',
        outcome: {
          text: '钱袋尽数挂上车辕，军械则入了你的营。木轮重新转动，没有一声吱响。',
          spendAllGold: true,
          gainRelic: { tier: 'uncommon' },
        },
      },
      {
        label: '封车不取',
        hint: '毫无所得',
        outcome: { text: '木牛仍停在阴影里。回头再看时，栈道上已空无一物。' },
      },
    ],
  },

  {
    id: 'hanzhongzhandao',
    name: '汉中栈道',
    sub: '秦岭 · 云下千仞',
    acts: [3],
    minRow: 3,
    body: '旧栈道半悬于绝壁，新修的木板只容一骑。\n走险路可省十日，并有时间重整两套战法；\n一步踩空，山下连尸骨都寻不回来。',
    options: [
      {
        label: '负伤走险',
        hint: '失去两成体力上限之数，精进两张牌',
        tone: 'danger',
        requires: RISK_FLOOR,
        requiresText: RISK_FLOOR_TEXT,
        outcome: {
          text: '木板在身后断了三处。人过了山，兵册也在十日险路上改定。',
          hpLossPercent: 0.2,
          upgradeCards: 2,
        },
      },
      {
        label: '绕行旧道',
        hint: '毫无所得',
        outcome: { text: '多走十日，鞋底磨穿。好在每个人都走到了山那边。' },
      },
    ],
  },
];

/**
 * The floor under the pool. Never in `EVENTS`, so it is never rolled and never
 * de-duplicated — it only appears when every real event has been spent, which
 * takes thirty event rooms in one run.
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
