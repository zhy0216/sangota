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
 * Twenty, against ~9–10 event rooms a run — 0.22 pool weight over the ~36
 * rollable floors of three acts (the old 「~3.14」 was one act's expectation
 * wearing a per-run label). With `seenEvents` de-duplicating inside a run, a
 * run sees about half the table, and two runs share ~4–5 entries (9.5²⁄20);
 * at twelve they shared ~7–8 of ~9.5, and every second run was a rerun.
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
        // 全表唯一的纯赌局，点缀而非主菜：赔率印在 hint 上（EV −5，庄家
        // 抽头明摆着），一注即散——绝不 repeatable，赢面分支无血价，repeat
        // 即水龙头。负 gold 依约定以 requires 把守，钱袋见底赌不了。
        label: '押五十金',
        hint: '四成半 资财 +50；五成半 资财 -50',
        tone: 'gold',
        requires: (run) => run.gold >= 50,
        requiresText: '需 50 资财',
        outcome: {
          text: '',
          branches: [
            {
              weight: 45,
              outcome: { text: '五木齐黑，一掷成卢，满场哄然。庄家脸色发青，如数赔付。', gold: 50 },
            },
            {
              weight: 55,
              outcome: { text: '差一子成卢。钱进了庄家袖中，围观的人替你叹了一声。', gold: -50 },
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
        hint: '六成半 得两瓶丹药；三成半 牌组混入诅咒【疑心】',
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
];

/**
 * The floor under the pool. Never in `EVENTS`, so it is never rolled and never
 * de-duplicated — it only appears when every real event has been spent, which
 * takes twenty-one event rooms in one run.
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
