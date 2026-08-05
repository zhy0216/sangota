import { addGold, heal, type RunState } from '../state/run';
import {
  addStatus,
  aliveEnemies,
  applyDamage,
  drawCards,
  gainBlock,
  hasKeyword,
  healCombatant,
} from './engine';
import type { CardDef, CombatEvent, CombatState } from './types';

/**
 * 宝物 — permanent passives. A relic is data: static modifiers folded into the
 * combat constants plus callbacks the engine fires at fixed moments. Adding a
 * relic must never mean adding a branch to the engine, so every trigger point
 * goes through `fireHook` and every number a card face shows goes through
 * `relicDamageBonus`.
 *
 * No Phaser here — this is rules, and `tests/integrity.test.ts` enforces it.
 */

export type RelicTier = 'starter' | 'common' | 'uncommon' | 'rare' | 'boss' | 'shop';

/** Moments the engine fires. A new one needs a matching `fireHook` call there. */
export type CombatHook =
  | 'combatStart' // combat begins, before the opening hand
  | 'turnStart' // our turn begins, after energy and block, before the draw
  | 'turnEnd' // our turn ends, before the hand is discarded
  | 'enemyTurnEnd' // the enemy turn is fully resolved
  | 'cardPlayed' // any card resolved
  | 'attackPlayed' // an 攻 card resolved
  | 'damageTaken' // we lost HP, block already subtracted
  | 'blockGained' // we gained block
  | 'enemyKilled' // an enemy dropped
  | 'cardDiscarded' // a deliberate card effect discarded one card
  | 'cardExhausted' // a card entered the exhaust pile
  | 'shuffle' // the discard pile was reshuffled into the draw pile
  | 'combatEnd'; // the fight was won, before rewards

/** Moments outside combat, fired by the scenes against the run instead. */
export type RunHook = 'roomEnter';

export type RelicHook = CombatHook | RunHook;

interface ContextBase {
  /**
   * Extra information about what triggered, by convention per hook:
   * `cardPlayed` / `attackPlayed` a CardDef, `damageTaken` / `blockGained` the
   * amount, `enemyKilled` the EnemyState, `roomEnter` the room type.
   */
  payload?: unknown;
  /** This relic's own counter. Survives turns; combat counters reset per fight. */
  counter: { value: number };
  /** The relic's tunable number — the same one `{N}` prints in its text. */
  value: number;
  /** Call when the relic actually did something, so the HUD can react. */
  trigger: () => void;
}

export interface CombatContext extends ContextBase {
  state: CombatState;
}

export interface RunContext extends ContextBase {
  run: RunState;
}

/**
 * The todo describes one `RelicContext` carrying both `state` and `run`. The
 * engine deliberately never sees run state and the map never has a fight in
 * progress, so the two are split — each hook gets exactly the world it runs in
 * and no relic has to null-check.
 */
export type RelicContext = CombatContext | RunContext;

export type RelicHooks = Partial<
  { [K in CombatHook]: (ctx: CombatContext) => void } & {
    [K in RunHook]: (ctx: RunContext) => void;
  }
>;

/** Static values folded in where the engine reads its constants. */
export interface RelicModifiers {
  maxHp?: number;
  energy?: number;
  handSize?: number;
  startingBlock?: number;
  goldMultiplier?: number;
  /** Extra 丹药 slots. Read by the run, not the engine — a fight has no belt. */
  potionSlots?: number;
  /** Cards a reward offers, relative to the base 3. Also run-side, not engine. */
  cardRewardCount?: number;
  /** 「不取」 pays this much 最大体力 instead of nothing. */
  skipRewardMaxHp?: number;
  /** Unspent 气 carried into the next turn, capped after all relics sum. */
  energyCarryCap?: number;
  /** Every non-negative card acquired after this relic arrives is forged. */
  newCardsUpgraded?: boolean;
  /** Multiplier on the 坊市 card-removal price. Multiple relics compound. */
  removalPriceMultiplier?: number;
  /** The run-wide card-removal surcharge is ignored and no longer grows. */
  noRemovalSurcharge?: boolean;
  /**
   * 布衣: the 坊市 will not sell this run a 宝物 at all. Summed with **or**, not
   * with `+` — one relic forbidding the counter forbids it.
   */
  noRelicPurchase?: boolean;
}

/** Everything a pure damage query may look at. Must not be mutated. */
export interface RelicQuery {
  state: CombatState;
  def: CardDef;
  counter: number;
  value: number;
}

/** Payload shared by the two deliberate pile-transition hooks. */
export interface RelicCardPilePayload {
  uid: string;
  def: CardDef;
}

export interface RelicDef {
  id: string;
  name: string;
  tier: RelicTier;
  /**
   * Hero id this relic belongs to. Absent means anyone may find it.
   *
   * Filtered in exactly one place — `unowned` in `rewards.ts` — so a locked
   * relic is out of every drop, every 首领 offer and every shelf at once.
   * A hero's *starting* relic is `tier: 'starter'` instead, which no source
   * rolls at all.
   */
  hero?: string;
  /** Icon texture key. The relic bar draws a procedural stand-in until art lands. */
  art: string;
  /** Rules text; `{N}` is replaced with `value`. */
  text: string;
  /** The relic's one tunable number, so text and behaviour cannot disagree. */
  value?: number;
  modifiers?: RelicModifiers;
  /**
   * Flat bonus added to each damage effect of the card being played. Pure:
   * `previewValues` calls it to keep the card face honest, so it must not
   * mutate anything or push events.
   */
  damageBonus?: (q: RelicQuery) => number;
  /** Delta applied to the printed cost. Pure: hand rendering calls it too. */
  costDelta?: (q: RelicQuery) => number;
  /** Additional copies of this card's effects to enqueue. The card itself moves once. */
  playCopies?: (q: RelicQuery) => number;
  /**
   * Announce a firing with the full-screen flourish under this label instead of
   * the quiet icon flash.
   */
  banner?: string;
  hooks?: RelicHooks;
}

// ------------------------------------------------------------------- the table

export const RELICS: Record<string, RelicDef> = {
  qinglongdao: {
    id: 'qinglongdao',
    name: '青龙偃月刀',
    tier: 'starter',
    art: 'relic-qinglongdao',
    text: '每回合首次打出【攻】牌时，该牌额外造成 {N} 点伤害。',
    value: 3,
    banner: '青龙偃月',
    damageBonus: ({ state, def, value }) =>
      def.type === 'attack' && state.attacksThisTurn === 0 ? value : 0,
  },

  /**
   * 赵云's 起手宝物 (todos/17). Deliberately 青龙偃月刀 shifted by one: 关羽 is
   * paid for the turn's *first* swing, 赵云 for its second, so the two starters
   * pull their decks in opposite directions from the first fight — one toward
   * few fat cards, one toward many cheap ones.
   *
   * Shifted rather than replaced with a draw (`combatStart`) because a one-off
   * two cards is worth a fixed ~10 damage a fight while 关羽's bonus is worth 3
   * *per turn*; measured against the same starting-deck bench, the draw left
   * 赵云 losing 精英 fights 关羽 wins at full health.
   */
  yajiaoqiang: {
    id: 'yajiaoqiang',
    name: '涯角枪',
    tier: 'starter',
    art: 'relic-yajiaoqiang',
    text: '每回合第二次打出【攻】牌时，该牌额外造成 {N} 点伤害。',
    value: 4,
    banner: '涯角连枪',
    damageBonus: ({ state, def, value }) =>
      def.type === 'attack' && state.attacksThisTurn === 1 ? value : 0,
  },

  /**
   * 诸葛亮's 起手宝物 (todos/17). Named for the other half of 羽扇纶巾 because
   * 「羽扇」 is already a 罕见 relic below — the pair reads as intended and no id
   * moves.
   *
   * The same trade 赤兔马 offers, printed as a hero instead of as a 首领 reward:
   * his whole pool is written around a short hand (「锦囊」 mints its own cards
   * back), and his 68 体力 is what pays for the 气. Stacking it with 赤兔马 is
   * legal and reads as 5 气 / 3 张, which is a build, not an accident.
   */
  guanjin: {
    id: 'guanjin',
    name: '纶巾',
    tier: 'starter',
    art: 'relic-guanjin',
    text: '气上限 +{N}，但每回合少抽 1 张牌。',
    value: 1,
    modifiers: { energy: 1, handSize: -1 },
  },

  /**
   * 开局祝福's 「不受」 (todos/18). `tier: 'starter'` for the same reason the
   * three 起手宝物 are: no source rolls that tier, so this can never be dropped,
   * offered or stocked — it is handed out by exactly one option on exactly one
   * screen, and refusing every gift is the only way to own it.
   *
   * 曾是「资财 +25% 且坊市不售宝物」——发钱又禁掉钱最好的去处，自相矛盾；
   * 且 +25% 恰与坊市里买得到的聚宝盆同额，一件苦修者的信物沦为它的劣化。
   * 现在的账直白：不置外物，一身轻健。体力走 modifiers.maxHp，`addRelic`
   * 会同步把当前体力抬同样多，开局拿到即是满的。
   */
  buyi: {
    id: 'buyi',
    name: '布衣',
    tier: 'starter',
    art: 'relic-buyi',
    text: '体力上限 +{N}。坊市不售宝物于你。',
    value: 10,
    modifiers: { maxHp: 10, noRelicPurchase: true },
  },

  /**
   * 曾是「战斗开始时获得 3 点护甲」——与先登盾的 `startingBlock: 4` 走同一个
   * `gainBlock(..., 'relic')` 入口，同一回合、同一免疫、同一触发，两件普通
   * 宝物在统计上是一件。改成开战多抽两张：束发整冠，先机在我——占下没有
   * 第二件宝物占的 combatStart 抽牌位，也和先登盾的开场垫刀彻底分开。
   * （曾试过发【身法】：per-hero 模拟里它把守势对局拖过回合上限——常驻
   * 减伤只会把僵局拉长，先机则催战斗收束。）
   */
  shufajinguan: {
    id: 'shufajinguan',
    name: '束发金冠',
    tier: 'common',
    art: 'relic-shufajinguan',
    text: '战斗开始时，抽 {N} 张牌。',
    value: 2,
    hooks: {
      combatStart: ({ state, value, trigger }) => {
        trigger();
        drawCards(state, value);
      },
    },
  },

  dujunlingqi: {
    id: 'dujunlingqi',
    name: '督军令旗',
    tier: 'common',
    art: 'relic-dujunlingqi',
    text: '每打出 3 张牌，获得 {N} 点护甲。',
    value: 2,
    hooks: {
      cardPlayed: ({ state, counter, value, trigger }) => {
        counter.value += 1;
        if (counter.value < 3) return;
        counter.value = 0;
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  lianu: {
    id: 'lianu',
    name: '连弩',
    tier: 'uncommon',
    art: 'relic-lianu',
    text: '每打出 3 张【攻】牌，对随机一名敌人造成 {N} 点伤害。',
    value: 5,
    hooks: {
      attackPlayed: ({ state, counter, value, trigger }) => {
        counter.value += 1;
        if (counter.value < 3) return;
        const alive = aliveEnemies(state);
        // Nothing left to shoot: hold the charge rather than waste it.
        if (alive.length === 0) return;
        counter.value = 0;
        trigger();
        applyDamage(state, state.rng.pick(alive), value);
      },
    },
  },

  tiemian: {
    id: 'tiemian',
    name: '铁面',
    tier: 'uncommon',
    art: 'relic-tiemian',
    text: '每场战斗首次受到伤害时，抽 {N} 张牌。',
    value: 2,
    hooks: {
      damageTaken: ({ state, counter, value, trigger }) => {
        if (counter.value > 0) return;
        counter.value = 1;
        trigger();
        drawCards(state, value);
      },
    },
  },

  huxinjing: {
    id: 'huxinjing',
    name: '护心镜',
    tier: 'uncommon',
    art: 'relic-huxinjing',
    text: '敌方回合结束时，回复 {N} 点体力。',
    value: 2,
    hooks: {
      enemyTurnEnd: ({ state, value, trigger }) => {
        if (state.player.hp >= state.player.maxHp) return;
        trigger();
        healCombatant(state, state.player, value);
      },
    },
  },

  xuanwujia: {
    id: 'xuanwujia',
    name: '玄武甲',
    tier: 'common',
    art: 'relic-xuanwujia',
    text: '回合结束时若身上没有护甲，获得 {N} 点护甲。',
    value: 6,
    hooks: {
      turnEnd: ({ state, value, trigger }) => {
        if (state.player.block > 0) return;
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  /**
   * 曾是「第 3 回合起每回合多抽一张」——评估台上最弱的稀有（+2），输给四件
   * 普通，而它顶着全设定里分量最重的名字。改成 handSize +1：纶巾/赤兔马
   * 拿 -1 手牌换一点气、评估 +53，这里就是那笔账的另一面，玺在手，每一手
   * 都多一张牌，从第 1 回合起。
   */
  chuanguoyuxi: {
    id: 'chuanguoyuxi',
    name: '传国玉玺',
    tier: 'rare',
    art: 'relic-chuanguoyuxi',
    text: '每回合多抽 {N} 张牌。',
    value: 1,
    modifiers: { handSize: 1 },
  },

  xingjuntu: {
    id: 'xingjuntu',
    name: '行军图',
    tier: 'common',
    art: 'relic-xingjuntu',
    text: '每次重洗抽牌堆时，获得 {N} 点护甲。',
    value: 2,
    hooks: {
      shuffle: ({ state, value, trigger }) => {
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  /**
   * 击杀报酬曾是 +1 神力——但精英与首领全是单人局（enemies.ts 的 e1–e8 /
   * b1–b8），最后一刀落下战斗即终，神力永远加在一个已经赢了的棋盘上。改成
   * 当场的气与牌：多人房里每颗人头都立刻转成本回合的行动力，趁胜追击才像
   * 一道「枭首令」。
   */
  xiaoshouling: {
    id: 'xiaoshouling',
    name: '枭首令',
    tier: 'uncommon',
    art: 'relic-xiaoshouling',
    text: '每击杀一名敌人，获得 {N} 点气并抽 {N} 张牌。',
    value: 1,
    hooks: {
      enemyKilled: ({ state, value, trigger }) => {
        // 最后一刀也会走到这里，但 checkEnd 随即收场，白给不白错。
        if (aliveEnemies(state).length === 0) return;
        trigger();
        state.energy += value;
        drawCards(state, value);
      },
    },
  },

  lianhuanjia: {
    id: 'lianhuanjia',
    name: '连环甲',
    tier: 'common',
    art: 'relic-lianhuanjia',
    text: '每 3 次获得护甲，获得 {N} 点【神力】。',
    value: 1,
    hooks: {
      blockGained: ({ state, counter, value, trigger }) => {
        counter.value += 1;
        if (counter.value < 3) return;
        counter.value = 0;
        trigger();
        addStatus(state, state.player, 'strength', value);
      },
    },
  },

  jinchuangyao: {
    id: 'jinchuangyao',
    name: '金疮药',
    tier: 'common',
    art: 'relic-jinchuangyao',
    text: '战斗胜利后，回复 {N} 点体力。',
    value: 4,
    hooks: {
      combatEnd: ({ state, value, trigger }) => {
        if (state.player.hp >= state.player.maxHp) return;
        trigger();
        healCombatant(state, state.player, value);
      },
    },
  },

  xiandengdun: {
    id: 'xiandengdun',
    name: '先登盾',
    tier: 'common',
    art: 'relic-xiandengdun',
    text: '每场战斗开始时，已有 {N} 点护甲。',
    value: 4,
    modifiers: { startingBlock: 4 },
  },

  xuanjia: {
    id: 'xuanjia',
    name: '玄甲',
    tier: 'common',
    art: 'relic-xuanjia',
    text: '体力上限 +{N}。',
    value: 8,
    modifiers: { maxHp: 8 },
  },

  chitima: {
    id: 'chitima',
    name: '赤兔马',
    tier: 'boss',
    art: 'relic-chitima',
    text: '气上限 +1，但每回合少抽 1 张牌。',
    modifiers: { energy: 1, handSize: -1 },
  },

  yaonang: {
    id: 'yaonang',
    name: '药囊',
    tier: 'common',
    art: 'relic-yaonang',
    text: '丹药槽位 +{N}。',
    value: 2,
    modifiers: { potionSlots: 2 },
  },

  qiuxianling: {
    id: 'qiuxianling',
    name: '求贤令',
    tier: 'uncommon',
    art: 'relic-qiuxianling',
    text: '战后可选的卡牌 +{N} 张。',
    value: 1,
    modifiers: { cardRewardCount: 1 },
  },

  /**
   * The 魁首 trade — narrower drafts, sturdier body. 曾经只有 -2 没有任何
   * 报偿：首领奖励是三选一，白扣的一件永远选不过旁边任何一件（评估 +0/+0）。
   * -2 rather than "always 1" so it composes with 求贤令 instead of overriding
   * it — two relics that both rewrite the count would need a precedence rule.
   */
  duduan: {
    id: 'duduan',
    name: '独断',
    tier: 'boss',
    art: 'relic-duduan',
    text: '体力上限 +12，但战后可选的卡牌 -{N} 张。',
    value: 2,
    modifiers: { maxHp: 12, cardRewardCount: -2 },
  },

  /**
   * Makes 「不取」 a real option rather than a concession — a thin deck is a
   * strategy, and before this the screen charged nothing for it but paid
   * nothing either.
   */
  geban: {
    id: 'geban',
    name: '歌钵',
    tier: 'shop',
    art: 'relic-geban',
    text: '战后选择「不取」时，最大体力 +{N}。',
    value: 2,
    modifiers: { skipRewardMaxHp: 2 },
  },

  jubaopen: {
    id: 'jubaopen',
    name: '聚宝盆',
    tier: 'shop',
    art: 'relic-jubaopen',
    text: '所得资财增加四分之一。',
    modifiers: { goldMultiplier: 1.25 },
  },

  xingshangfujie: {
    id: 'xingshangfujie',
    name: '行商符节',
    tier: 'shop',
    art: 'relic-xingshangfujie',
    text: '每进入一处房间，获得 {N} 资财。',
    value: 5,
    hooks: {
      roomEnter: ({ run, value, trigger }) => {
        trigger();
        addGold(run, value);
      },
    },
  },

  // ------------------------------------------------------- todos/10 additions
  //
  // The drop tables below can only pay out what the table holds. Before this
  // block there was exactly one 稀有 relic and two 首领 ones, so an elite that
  // rolled 稀有 could cash in at most once a run and a boss chest could not
  // offer three distinct relics at all. The counts these bring the table to —
  // 9 常见 / 8 罕见 / 5 稀有 / 6 首领 / 4 坊市 — are what `rollRelic`'s
  // degradation ladder is sized against.
  //
  // Nothing above this line is touched: the eight relics the golden snapshots
  // exercise keep their `value`, `modifiers`, `hooks` and `damageBonus` exactly
  // as they were, and `tests/relicRewards.test.ts` pins them.

  // --- 罕见 -----------------------------------------------------------------

  yushan: {
    id: 'yushan',
    name: '羽扇',
    tier: 'uncommon',
    art: 'relic-yushan',
    text: '战斗开始时，获得 {N} 点【神力】。',
    value: 1,
    hooks: {
      combatStart: ({ state, value, trigger }) => {
        trigger();
        addStatus(state, state.player, 'strength', value);
      },
    },
  },

  /**
   * 行军图's sibling on the same trigger, paying HP instead of block. A reshuffle
   * is the one clock a fight keeps that neither side controls, so it is worth
   * having two relics read from it.
   *
   * 改名「辎重车」：诸葛亮的罕见牌就叫木牛流马（heroCards.ts），同名同幕
   * 出现在同一张奖励清单上，玩家分不清抽到的是哪个。id/art 不动——id 是
   * 池序与存档里的字，art 画的本就是一辆粮车。
   */
  mumaliu: {
    id: 'mumaliu',
    name: '辎重车',
    tier: 'uncommon',
    art: 'relic-mumaliu',
    text: '每次重洗抽牌堆时，回复 {N} 点体力。',
    value: 3,
    hooks: {
      shuffle: ({ state, value, trigger }) => {
        if (state.player.hp >= state.player.maxHp) return;
        trigger();
        healCombatant(state, state.player, value);
      },
    },
  },

  /**
   * The counter is reset by `turnStart` rather than being read off
   * `cardsPlayedThisTurn`: that field counts every card, and what this pays for
   * is specifically the turn's first 【技】.
   */
  huangshishu: {
    id: 'huangshishu',
    name: '黄石公书',
    tier: 'uncommon',
    art: 'relic-huangshishu',
    text: '每回合首次打出【技】牌时，抽 {N} 张牌。',
    value: 1,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      cardPlayed: ({ state, payload, counter, value, trigger }) => {
        if ((payload as CardDef | undefined)?.type !== 'skill') return;
        if (counter.value > 0) return;
        counter.value = 1;
        trigger();
        drawCards(state, value);
      },
    },
  },

  // --- 稀有 -----------------------------------------------------------------

  tengjia: {
    id: 'tengjia',
    name: '藤甲',
    tier: 'rare',
    art: 'relic-tengjia',
    text: '每回合开始时，获得 {N} 点护甲。',
    value: 3,
    hooks: {
      turnStart: ({ state, value, trigger }) => {
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  /**
   * 青龙偃月刀 without the once-a-turn limit and at a smaller number — the
   * starter rewards opening with an attack, this rewards a deck built out of
   * them.
   */
  gudingdao: {
    id: 'gudingdao',
    name: '古锭刀',
    tier: 'rare',
    art: 'relic-gudingdao',
    text: '你打出的每张【攻】牌额外造成 {N} 点伤害。',
    value: 2,
    damageBonus: ({ def, value }) => (def.type === 'attack' ? value : 0),
  },

  sunzibingfa: {
    id: 'sunzibingfa',
    name: '孙子兵法',
    tier: 'rare',
    art: 'relic-sunzibingfa',
    text: '每打出 5 张牌，抽 {N} 张牌。',
    value: 2,
    hooks: {
      cardPlayed: ({ state, counter, value, trigger }) => {
        counter.value += 1;
        if (counter.value < 5) return;
        counter.value = 0;
        trigger();
        drawCards(state, value);
      },
    },
  },

  qixingdeng: {
    id: 'qixingdeng',
    name: '七星灯',
    tier: 'rare',
    art: 'relic-qixingdeng',
    text: '每回合开始时，若体力不足半数，回复 {N} 点体力。',
    value: 4,
    hooks: {
      turnStart: ({ state, value, trigger }) => {
        if (state.player.hp * 2 >= state.player.maxHp) return;
        trigger();
        healCombatant(state, state.player, value);
      },
    },
  },

  // --- 首领 -----------------------------------------------------------------
  //
  // Every one of these is a trade, and every downside is expressed through
  // `modifiers` or a status. None of them moves 体力上限: `addRelic` moves
  // `run.hp` by the same amount a relic moves `run.maxHp`, so a boss relic
  // costing max HP would kill a player who walked out of the boss fight under
  // its cost. That is a fine relic and a terrible way to end a run, and it needs
  // a guard in `addRelic` before it can exist.

  fangtianhuaji: {
    id: 'fangtianhuaji',
    name: '方天画戟',
    tier: 'boss',
    art: 'relic-fangtianhuaji',
    text: '你打出的每张【攻】牌额外造成 {N} 点伤害，但所得资财减半。',
    value: 3,
    modifiers: { goldMultiplier: 0.5 },
    damageBonus: ({ def, value }) => (def.type === 'attack' ? value : 0),
  },

  /**
   * 力竭 is re-applied every turn rather than granted once, so the cost is
   * permanent for the whole fight. It rides on `gainBlock`'s card scale only —
   * relic-sourced block is deliberately off that scale — which is what makes
   * this a tax on 【技】 armour and not on 藤甲 or 玄武甲.
   */
  hufu: {
    id: 'hufu',
    name: '虎符',
    tier: 'boss',
    art: 'relic-hufu',
    text: '战斗开始时获得 {N} 点【神力】，但每回合开始时获得 1 层【力竭】。',
    value: 2,
    hooks: {
      combatStart: ({ state, value, trigger }) => {
        trigger();
        addStatus(state, state.player, 'strength', value);
      },
      turnStart: ({ state, trigger }) => {
        trigger();
        addStatus(state, state.player, 'frail', 1);
      },
    },
  },

  /**
   * 曾附带 -1 手牌——评估台上唯一双负的宝物（-8 胜率 / +2 精英代价）：赤兔马
   * 用同一个 -1 换一点气还值 +53，这里却拿它换金子。代价换成 -1 战后选卡：
   * 铜雀台敛财而怠贤，钱多了、募到的良才少了，反正钱正好拿去坊市补——
   * 首领宝物必须是交易（relicRewards.test 钉着），但不能倒贴胜率。
   */
  tongquetai: {
    id: 'tongquetai',
    name: '铜雀台',
    tier: 'boss',
    art: 'relic-tongquetai',
    text: '所得资财增加一半，但战后可选的卡牌 -1 张。',
    modifiers: { goldMultiplier: 1.5, cardRewardCount: -1 },
  },

  jiuxi: {
    id: 'jiuxi',
    name: '九锡',
    tier: 'boss',
    art: 'relic-jiuxi',
    text: '气上限 +1，但战后可选的卡牌 -1 张。',
    modifiers: { energy: 1, cardRewardCount: -1 },
  },

  // --- 坊市 -----------------------------------------------------------------

  jiuhulu: {
    id: 'jiuhulu',
    name: '酒葫芦',
    tier: 'shop',
    art: 'relic-jiuhulu',
    text: '每进入一处房间，回复 {N} 点体力。',
    value: 2,
    hooks: {
      roomEnter: ({ run, value, trigger }) => {
        if (run.hp >= run.maxHp) return;
        trigger();
        heal(run, value);
      },
    },
  },

  // ------------------------------------------------------- todos/17 additions
  //
  // 武将专属遗物 — the first entries to carry `RelicDef.hero`. The gate itself
  // (`unowned` in `rewards.ts`) predates them; until here nothing declared an
  // owner, so 「赵云专属遗物只在玩赵云时出现」 had no relic to be true of.
  // Each exclusive reads the thing its owner's pool is already built around —
  // 关羽's few fat 【攻】 cards, 赵云's `attacksThisTurn`, 诸葛亮's 「锦囊」 and
  // the 消耗 keyword his deck burns — so one found mid-run bends the run toward
  // its owner's plan instead of being a stat stick with a name on it.
  //
  // The ladder stays fed per hero: todos/10 sized it against 9 常见 / 8 罕见,
  // and while the table now holds 11 / 11, what one hero can actually roll is
  // 10 / 9 (关羽 9 / 9) — above the floor, so no degradation path shortened.

  /**
   * 关羽 exclusive. 古锭刀 narrowed to the cards his pool is built around: only
   * 【攻】 costing 2 气 or more collect it — a bigger number per swing than the
   * 稀有 relic pays, but only for a deck of few, heavy cards. `X_COST` (-1)
   * falls outside the comparison on purpose: a card whose printed cost is X is
   * a cheap card played expensively, not a fat one.
   */
  hanshoutinghouyin: {
    id: 'hanshoutinghouyin',
    name: '汉寿亭侯印',
    tier: 'uncommon',
    hero: 'guanyu',
    art: 'relic-hanshoutinghouyin',
    text: '你打出的费用 2 及以上的【攻】牌额外造成 {N} 点伤害。',
    value: 3,
    damageBonus: ({ def, value }) => (def.type === 'attack' && def.cost >= 2 ? value : 0),
  },

  /**
   * 赵云 exclusive — the sword taken at 长坂坡, paying the way he fights: the
   * turn's third 【攻】 draws, feeding the very spiral his 连击 cards scale
   * from. `attacksThisTurn` is incremented *before* `attackPlayed` fires, so
   * `=== 3` reads exactly the third attack — once a turn, never on the fourth.
   * No counter of its own: the state field already resets in `startPlayerTurn`,
   * and a per-fight relic counter could only drift from it.
   */
  qinggangjian: {
    id: 'qinggangjian',
    name: '青釭剑',
    tier: 'uncommon',
    hero: 'zhaoyun',
    art: 'relic-qinggangjian',
    text: '每回合第 3 次打出【攻】牌时，抽 {N} 张牌。',
    value: 2,
    hooks: {
      attackPlayed: ({ state, value, trigger }) => {
        if (state.attacksThisTurn !== 3) return;
        trigger();
        drawCards(state, value);
      },
    },
  },

  /**
   * 赵云 exclusive. 玄武甲's slot moved behind his own condition: 6 甲 for a
   * turn that ended bare becomes {N} 甲 for a turn that attacked twice — which
   * the 涯角枪 starter already wants every turn to do. Armour for aggression,
   * so committing the whole hand to 【攻】 is not automatically the defenceless
   * line.
   */
  liangyinjia: {
    id: 'liangyinjia',
    name: '亮银甲',
    tier: 'common',
    hero: 'zhaoyun',
    art: 'relic-liangyinjia',
    text: '回合结束时，若本回合已打出至少 2 张【攻】牌，获得 {N} 点护甲。',
    value: 4,
    hooks: {
      turnEnd: ({ state, value, trigger }) => {
        if (state.attacksThisTurn < 2) return;
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  /**
   * 诸葛亮 exclusive. 金疮药 rewritten onto his own clock: his pool burns
   * itself — 「锦囊」 and most of the deck carry 消耗 — so every third such
   * card *played* pays 体力 back to the hero whose 68 体力 funds everything
   * else. The keyword, not the 消耗堆: a card exhausted from the hand by an
   * effect was a cost, not a play. Holds the charge at full 体力 the way 连弩
   * holds its shot with nothing left to hit.
   */
  kongmingdeng: {
    id: 'kongmingdeng',
    name: '孔明灯',
    tier: 'common',
    hero: 'zhugeliang',
    art: 'relic-kongmingdeng',
    text: '每打出 3 张【消耗】牌，回复 {N} 点体力。',
    value: 2,
    hooks: {
      cardPlayed: ({ state, payload, counter, value, trigger }) => {
        const def = payload as CardDef | undefined;
        if (!def || !hasKeyword(def, 'exhaust')) return;
        counter.value += 1;
        if (counter.value < 3) return;
        // Full 体力: hold the charge rather than waste it.
        if (state.player.hp >= state.player.maxHp) return;
        counter.value = 0;
        trigger();
        healCombatant(state, state.player, value);
      },
    },
  },

  /**
   * 诸葛亮 exclusive. The 妙计 pay double: every second 「锦囊」 played leaves
   * 【神力】 behind, turning the card-neutral tempo token into his damage
   * curve. Checked by id, not by keyword — it is the 锦囊 plan being paid here,
   * not 消耗 in general (孔明灯 above already pays that).
   */
  qimendunjia: {
    id: 'qimendunjia',
    name: '奇门遁甲',
    tier: 'uncommon',
    hero: 'zhugeliang',
    art: 'relic-qimendunjia',
    text: '每打出 2 张「锦囊」，获得 {N} 点【神力】。',
    value: 1,
    hooks: {
      cardPlayed: ({ state, payload, counter, value, trigger }) => {
        if ((payload as CardDef | undefined)?.id !== 'jinnang') return;
        counter.value += 1;
        if (counter.value < 2) return;
        counter.value = 0;
        trigger();
        addStatus(state, state.player, 'strength', value);
      },
    },
  },

  // ------------------------------------------- 2026-08 关羽宝物扩充
  //
  // 关羽全解锁可得池从 9/9/5/6/4 扩到 15/15/10/8/5。开放
  // 档中十五件携 `hero: 'guanyu'`，不稀释赵云/诸葛亮的池；
  // 首领、坊市与两件通用开放档共五件，让其他武将也能见到新
  // 规则。全部只追加在表尾，既有声明顺序一字不动。

  // --- 常见 -----------------------------------------------------------------

  zhuquejie: {
    id: 'zhuquejie',
    name: '朱雀节',
    tier: 'common',
    hero: 'guanyu',
    art: 'relic-zhuquejie',
    text: '战斗开始时，所有敌人添 1 层【怯战】。',
    hooks: {
      combatStart: ({ state, trigger }) => {
        const enemies = aliveEnemies(state);
        if (enemies.length === 0) return;
        trigger();
        for (const enemy of enemies) addStatus(state, enemy, 'weak', 1);
      },
    },
  },

  duanjinwan: {
    id: 'duanjinwan',
    name: '断金腕',
    tier: 'common',
    hero: 'guanyu',
    art: 'relic-duanjinwan',
    text: '每回合首次获得护甲时，额外获得 {N} 点护甲。',
    value: 3,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      blockGained: ({ state, counter, value, trigger }) => {
        // startingBlock lands before turn one and is not a turn's first grant.
        if (state.turn <= 0 || counter.value > 0) return;
        // Mark first: gainBlock recursively fires blockGained.
        counter.value = 1;
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  bingliangce: {
    id: 'bingliangce',
    name: '兵粮册',
    tier: 'common',
    hero: 'guanyu',
    art: 'relic-bingliangce',
    text: '每次将弃牌堆洗回抽牌堆时，抽 {N} 张牌。',
    value: 1,
    hooks: {
      shuffle: ({ state, value, trigger }) => {
        trigger();
        drawCards(state, value);
      },
    },
  },

  pohujia: {
    id: 'pohujia',
    name: '破胡甲',
    tier: 'common',
    hero: 'guanyu',
    art: 'relic-pohujia',
    text: '每回合首次损失体力后，获得 {N} 点护甲。',
    value: 4,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      damageTaken: ({ state, counter, value, trigger }) => {
        if (counter.value > 0) return;
        counter.value = 1;
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  huatuoyaofang: {
    id: 'huatuoyaofang',
    name: '华佗药方',
    tier: 'common',
    hero: 'guanyu',
    art: 'relic-huatuoyaofang',
    text: '每击杀一名敌人，回复 {N} 点体力。',
    value: 1,
    hooks: {
      enemyKilled: ({ state, value, trigger }) => {
        if (state.player.hp >= state.player.maxHp) return;
        trigger();
        healCombatant(state, state.player, value);
      },
    },
  },

  fenghuotai: {
    id: 'fenghuotai',
    name: '烽火台',
    tier: 'common',
    art: 'relic-fenghuotai',
    text: '战斗开始时，若敌人不少于 2 名，获得 {N} 层【神力】。',
    value: 1,
    hooks: {
      combatStart: ({ state, value, trigger }) => {
        if (aliveEnemies(state).length < 2) return;
        trigger();
        addStatus(state, state.player, 'strength', value);
      },
    },
  },

  // --- 罕见 -----------------------------------------------------------------

  shangjiangling: {
    id: 'shangjiangling',
    name: '上将令',
    tier: 'uncommon',
    hero: 'guanyu',
    art: 'relic-shangjiangling',
    text: '每回合首次打出费用 2 及以上的【攻】牌时，抽 {N} 张牌。',
    value: 1,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      attackPlayed: ({ state, payload, counter, value, trigger }) => {
        const def = payload as CardDef | undefined;
        if (!def || def.cost < 2 || counter.value > 0) return;
        counter.value = 1;
        trigger();
        drawCards(state, value);
      },
    },
  },

  jingzhouyin: {
    id: 'jingzhouyin',
    name: '荆州印',
    tier: 'uncommon',
    hero: 'guanyu',
    art: 'relic-jingzhouyin',
    text: '若空手结束回合，下回合获得 {N} 点气。',
    value: 1,
    hooks: {
      turnEnd: ({ state, counter }) => {
        counter.value = state.hand.length === 0 ? 1 : 0;
      },
      turnStart: ({ state, counter, value, trigger }) => {
        if (counter.value === 0) return;
        counter.value = 0;
        trigger();
        state.energy += value;
      },
    },
  },

  liangcaojie: {
    id: 'liangcaojie',
    name: '粮草节',
    tier: 'uncommon',
    hero: 'guanyu',
    art: 'relic-liangcaojie',
    text: '回合结束时，至多将 3 点未耗气各转为 {N} 点护甲。',
    value: 2,
    hooks: {
      turnEnd: ({ state, value, trigger }) => {
        const spent = Math.min(3, Math.max(0, state.energy));
        if (spent === 0) return;
        state.energy -= spent;
        trigger();
        gainBlock(state, state.player, spent * value, 'relic');
      },
    },
  },

  hujunxin: {
    id: 'hujunxin',
    name: '护军心',
    tier: 'uncommon',
    hero: 'guanyu',
    art: 'relic-hujunxin',
    text: '战斗开始时，获得 {N} 层【护身符】。',
    value: 1,
    hooks: {
      combatStart: ({ state, value, trigger }) => {
        trigger();
        addStatus(state, state.player, 'artifact', value);
      },
    },
  },

  tunbingfu: {
    id: 'tunbingfu',
    name: '屯兵符',
    tier: 'uncommon',
    hero: 'guanyu',
    art: 'relic-tunbingfu',
    text: '每回合首次单次损失至少 10 点体力时，获得 {N} 层【神力】。',
    value: 1,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      damageTaken: ({ state, payload, counter, value, trigger }) => {
        if ((payload as number | undefined) === undefined || (payload as number) < 10) return;
        if (counter.value > 0) return;
        counter.value = 1;
        trigger();
        addStatus(state, state.player, 'strength', value);
      },
    },
  },

  yanxingling: {
    id: 'yanxingling',
    name: '严行令',
    tier: 'uncommon',
    hero: 'guanyu',
    art: 'relic-yanxingling',
    text: '每回合首次主动弃牌时，获得 {N} 点气。',
    value: 1,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      cardDiscarded: ({ state, counter, value, trigger }) => {
        if (counter.value > 0) return;
        counter.value = 1;
        trigger();
        state.energy += value;
      },
    },
  },

  // --- 稀有 -----------------------------------------------------------------

  qinglongdaopu: {
    id: 'qinglongdaopu',
    name: '青龙刀谱',
    tier: 'rare',
    hero: 'guanyu',
    art: 'relic-qinglongdaopu',
    text: '每回合首次打出费用 2 及以上的【攻】牌时，少耗 {N} 点气。',
    value: 1,
    costDelta: ({ def, counter, value }) =>
      def.type === 'attack' && def.cost >= 2 && counter === 0 ? -value : 0,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      attackPlayed: ({ payload, counter }) => {
        const def = payload as CardDef | undefined;
        if (def && def.cost >= 2 && counter.value === 0) counter.value = 1;
      },
    },
  },

  qinglongnizhan: {
    id: 'qinglongnizhan',
    name: '青龙逆斩',
    tier: 'rare',
    hero: 'guanyu',
    art: 'relic-qinglongnizhan',
    text: '每场战斗首次打出费用 2 及以上的【攻】牌时，其效果额外结算一次。',
    playCopies: ({ def, counter }) =>
      def.type === 'attack' && def.cost >= 2 && counter === 0 ? 1 : 0,
    hooks: {
      attackPlayed: ({ payload, counter }) => {
        const def = payload as CardDef | undefined;
        if (def && def.cost >= 2 && counter.value === 0) counter.value = 1;
      },
    },
  },

  chunqiubaodian: {
    id: 'chunqiubaodian',
    name: '春秋宝笺',
    tier: 'rare',
    hero: 'guanyu',
    art: 'relic-chunqiubaodian',
    text: '每回合前 2 张非【势】牌被消耗时，各抽 {N} 张牌。',
    value: 1,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      cardExhausted: ({ state, payload, counter, value, trigger }) => {
        const def = (payload as RelicCardPilePayload | undefined)?.def;
        if (!def || def.type === 'power' || counter.value >= 2) return;
        counter.value += 1;
        trigger();
        drawCards(state, value);
      },
    },
  },

  jingzhougudao: {
    id: 'jingzhougudao',
    name: '荆州古道',
    tier: 'rare',
    hero: 'guanyu',
    art: 'relic-jingzhougudao',
    text: '每场战斗首次主动弃掉的牌改为置于抽牌堆顶。',
    hooks: {
      cardDiscarded: ({ state, payload, counter, trigger }) => {
        if (counter.value > 0) return;
        const uid = (payload as RelicCardPilePayload | undefined)?.uid;
        if (!uid) return;
        const at = state.discardPile.indexOf(uid);
        if (at < 0) return;
        state.discardPile.splice(at, 1);
        state.drawPile.push(uid);
        counter.value = 1;
        trigger();
      },
    },
  },

  longlin: {
    id: 'longlin',
    name: '龙鳞',
    tier: 'rare',
    art: 'relic-longlin',
    text: '战斗开始时，获得 {N} 层【天佑】。',
    value: 1,
    hooks: {
      combatStart: ({ state, value, trigger }) => {
        trigger();
        addStatus(state, state.player, 'buffer', value);
      },
    },
  },

  // --- 首领 -----------------------------------------------------------------

  shouhanzhaoshu: {
    id: 'shouhanzhaoshu',
    name: '受汉诏书',
    tier: 'boss',
    art: 'relic-shouhanzhaoshu',
    text: '此后获得的牌均为【精】，但战后可选的卡牌 -1 张。',
    modifiers: { newCardsUpgraded: true, cardRewardCount: -1 },
  },

  maichengcanqi: {
    id: 'maichengcanqi',
    name: '麦城残旗',
    tier: 'boss',
    art: 'relic-maichengcanqi',
    text: '至多保留 {N} 点未耗气到下回合，但每回合少抽 1 张牌。',
    value: 2,
    modifiers: { energyCarryCap: 2, handSize: -1 },
    hooks: {
      turnStart: ({ state, trigger }) => {
        if (state.energy > state.maxEnergy) trigger();
      },
    },
  },

  // --- 坊市 -----------------------------------------------------------------

  xiaojiling: {
    id: 'xiaojiling',
    name: '销籍令',
    tier: 'shop',
    art: 'relic-xiaojiling',
    text: '坊市弃牌费用减半，且不再递增。',
    modifiers: { removalPriceMultiplier: 0.5, noRemovalSurcharge: true },
  },

  // ------------------------------------------- 2026-08 赵云宝物扩充
  //
  // 赵云可掷池从 11/9/6 扩到 15/14/7（常见 +4 / 罕见 +5 / 稀有 +1），十件全部
  // 携 `hero: 'zhaoyun'`——关羽与诸葛亮的池子逐字不动，既有关羽 seed 的每一次
  // 掉落原样重放。全部只追加在表尾，声明顺序一字不动。
  //
  // 设计随卡池同一批（枪胆防反）：宝物阶梯把「第 N 次」数满——首攻（红缨）→
  // 第二攻（涯角枪）→ 第三攻（青釭剑）→ 第四攻（翊军印）→ 第五攻（龙胆枪谱），
  // 第四格退的 1 气恰好付第五枪；防守半场按行为发工资（素征袍/蒺藜/得胜鼓），
  // 血线两件（阿斗襁褓）与击杀一件（牙门旗）收方差。

  // --- 常见 -----------------------------------------------------------------

  /**
   * 枪头那撮红缨。阶梯的空格：涯角枪占第 2 击、青釭剑占第 3 击、亮银甲占
   * 「≥2 击回合末」，首击此前无人认领。出枪即披甲——进攻回合的第一格甲，
   * 常见档的单条件小数值。`attacksThisTurn` 在 attackPlayed 前已自增，
   * `=== 1` 恰读首击；不自设 counter（青釭剑同注）。
   */
  hongying: {
    id: 'hongying',
    name: '红缨',
    tier: 'common',
    hero: 'zhaoyun',
    art: 'relic-hongying',
    text: '每回合首次打出【攻】牌时，获得 {N} 点护甲。',
    value: 2,
    hooks: {
      attackPlayed: ({ state, value, trigger }) => {
        if (state.attacksThisTurn !== 1) return;
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  /**
   * 云曾拜牙门将军，旗随斩将立。华佗药方（击杀回血）同一时钟的护甲面：多人
   * 房每倒一人送 5 甲，恰是薄血条在乱战里最缺的过渡帧；孤 boss 房一文不值
   * ——常见件敢占这个方差，稀有件才不敢。最后一刀也触发（枭首令同则）。
   */
  yamenqi: {
    id: 'yamenqi',
    name: '牙门旗',
    tier: 'common',
    hero: 'zhaoyun',
    art: 'relic-yamenqi',
    text: '击杀一名敌人时，获得 {N} 点护甲。',
    value: 5,
    hooks: {
      enemyKilled: ({ state, value, trigger }) => {
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  /**
   * 素袍未染，是因为甲一层压着一层。断金腕（首次获甲 +3）的镜像移位——那件
   * 奖第一口，这件奖第三口，专喂多段甲（枪舞梨花三段、截江的每个 +3、掠马+
   * 枪花的散件）。递归护栏照断金腕：先把计数推过阈值再补甲，补进来的甲再
   * 触发 blockGained 时已不命中。
   */
  suzhengpao: {
    id: 'suzhengpao',
    name: '素征袍',
    tier: 'common',
    hero: 'zhaoyun',
    art: 'relic-suzhengpao',
    text: '每回合第 3 次获得护甲时，额外获得 {N} 点护甲。',
    value: 3,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      blockGained: ({ state, counter, value, trigger }) => {
        if (state.turn <= 0) return;
        counter.value += 1;
        if (counter.value !== 3) return;
        // Mark past the threshold first: gainBlock recursively fires blockGained.
        counter.value = 4;
        trigger();
        gainBlock(state, state.player, value, 'relic');
      },
    },
  },

  /**
   * 旗到之处，士气自续。赵云的回合是全游戏出牌张数最多的回合——第 5 张牌的
   * 门槛在他手里是常态，在别人手里是奢望，这就是「贴武将玩法轴」的常见件
   * 写法。读张数不读攻数，与青釭剑（攻数）分属两个时钟；嵌套抽牌不破手牌
   * 上限（drawCards 自查，兵粮册同则）。
   */
  changshanjunqi: {
    id: 'changshanjunqi',
    name: '常山军旗',
    tier: 'common',
    hero: 'zhaoyun',
    art: 'relic-changshanjunqi',
    text: '每回合打出第 5 张牌时，抽 {N} 张牌。',
    value: 1,
    hooks: {
      turnStart: ({ counter }) => {
        counter.value = 0;
      },
      cardPlayed: ({ state, counter, value, trigger }) => {
        counter.value += 1;
        if (counter.value !== 5) return;
        trigger();
        drawCards(state, value);
      },
    },
  },

  // --- 罕见 -----------------------------------------------------------------

  /**
   * 汉寿亭侯印的镜像倒装——那件付肥卡（费 2+ 的攻 +3），这件付碎卡：龙胆/
   * 疾刺/刺晏明从 3 直接跳到 5，白给的计数器第一次自己也疼人。`X_COST`(-1)
   * 落在 `=== 0` 之外：X 费是贵着打的便宜牌，不领这份钱。0 费攻是赵云回合
   * 的地板砖，所以这件放罕见档——同构的汉寿亭侯印也在这一档。
   */
  baiying: {
    id: 'baiying',
    name: '白缨',
    tier: 'uncommon',
    hero: 'zhaoyun',
    art: 'relic-baiying',
    text: '你打出的费用为 0 的【攻】牌额外造成 {N} 点伤害。',
    value: 2,
    damageBonus: ({ def, value }) => (def.type === 'attack' && def.cost === 0 ? value : 0),
  },

  /**
   * 拜翊军将军之印。宝物阶梯的第四级：涯角枪付第二击、青釭剑付第三击、这件
   * 付第四击——退回的 1 气恰好是第五张攻的费用，连击的斜率在第四枪之后由它
   * 续上。`attacksThisTurn` 在 attackPlayed 前已自增，`=== 4` 恰读第四枪、
   * 一回合一次；不自设 counter（青釭剑注释原文适用）。
   */
  yijunyin: {
    id: 'yijunyin',
    name: '翊军印',
    tier: 'uncommon',
    hero: 'zhaoyun',
    art: 'relic-yijunyin',
    text: '每回合第 4 次打出【攻】牌时，获得 {N} 点气。',
    value: 1,
    hooks: {
      attackPlayed: ({ state, value, trigger }) => {
        if (state.attacksThisTurn !== 4) return;
        trigger();
        state.energy += value;
      },
    },
  },

  /**
   * 墙根撒蒺藜。把「回合末还立着的高墙」折成永久反刺，长战斗里逐回合复利
   * ——防守构筑第一次有了随时间变强的理由。阈值 8 与拒马同刻度，一套铺垫两
   * 处兑现。eval 红线：与回马枪/坚壁的被动墙合流若把零重抬破 60%，第一刀
   * 抬这里的阈值 8 → 10。
   */
  jili: {
    id: 'jili',
    name: '蒺藜',
    tier: 'uncommon',
    hero: 'zhaoyun',
    art: 'relic-jili',
    text: '回合结束时，若你有至少 {N} 点护甲，获得 1 层【反刺】。',
    value: 8,
    hooks: {
      turnEnd: ({ state, value, trigger }) => {
        if (state.player.block < value) return;
        trigger();
        addStatus(state, state.player, 'thorns', 1);
      },
    },
  },

  /**
   * 长坂坡怀中那个襁褓——最脆的东西裹在最里面。74 体力的英雄跌破半血是常态
   * 节点（单骑救主/玉狮跃坑同一条线），这件在那一刻垫一层天佑，吃掉下一次
   * 整笔失血。一场一次（战斗计数器守门），与护军心同档：一个挡减益，一个挡
   * 巨锤。也给护主冲阵的天佑读数多开一个自动上游。
   */
  adouqiangbao: {
    id: 'adouqiangbao',
    name: '阿斗襁褓',
    tier: 'uncommon',
    hero: 'zhaoyun',
    art: 'relic-adouqiangbao',
    text: '每场战斗你的体力首次低于一半时，获得 {N} 层【天佑】。',
    value: 1,
    hooks: {
      damageTaken: ({ state, counter, value, trigger }) => {
        if (counter.value > 0) return;
        if (state.player.hp * 2 >= state.player.maxHp) return;
        counter.value = 1;
        trigger();
        addStatus(state, state.player, 'buffer', value);
      },
    },
  },

  /**
   * 这一阵打得漂亮，鼓声传到下一阵。亮银甲占了「回合末 ≥2 攻」的甲位，这件
   * 把门槛抬到 ≥4、报酬换成节奏：好回合滚成下一个好回合。与青釭剑分属两个
   * 时钟——一个救当下，一个养明天。跨回合记账走荆州印范式；≥ 而非 ===：
   * 第五枪、第六枪不该反而弄丢它。
   */
  deshenggu: {
    id: 'deshenggu',
    name: '得胜鼓',
    tier: 'uncommon',
    hero: 'zhaoyun',
    art: 'relic-deshenggu',
    text: '回合结束时，若本回合已打出至少 4 张【攻】牌，下回合开始时抽 {N} 张牌。',
    value: 1,
    hooks: {
      turnEnd: ({ state, counter }) => {
        counter.value = state.attacksThisTurn >= 4 ? 1 : 0;
      },
      turnStart: ({ state, counter, value, trigger }) => {
        if (counter.value === 0) return;
        counter.value = 0;
        trigger();
        drawCards(state, value);
      },
    },
  },

  // --- 稀有 -----------------------------------------------------------------

  /**
   * 青龙逆斩的赵云化，两个旋钮都反着拧：那件每**场**首张、付「费 2+」；这件
   * 每**回合**第五张、付「真打出四枪再留一张好的」。效果复读、不复读生命
   * 周期与计数（relicCardCopies 契约），复读的连刺读的是同一份 enqueue
   * 快照。`playCopies` 在结算前查询、计数器尚未为本牌自增，`=== 4` 恰指本
   * 回合第 5 张攻——且必须查 `def.type`：四攻之后的谋/势牌不领这份复读。
   */
  longdanqiangpu: {
    id: 'longdanqiangpu',
    name: '龙胆枪谱',
    tier: 'rare',
    hero: 'zhaoyun',
    art: 'relic-longdanqiangpu',
    text: '每回合第 5 次打出的【攻】牌，其效果额外结算一次。',
    playCopies: ({ state, def }) => (def.type === 'attack' && state.attacksThisTurn === 4 ? 1 : 0),
  },
};

// -------------------------------------------------------------- 掉落档位数据

/**
 * Where a relic can come from. Chest sizes are separate sources rather than a
 * second argument: `rollRelic`'s signature carries an `exclude` list in that
 * slot, and a size that only ever selects a weight row is a weight row.
 */
export type RelicSource =
  | 'elite'
  | 'chestSmall'
  | 'chestMedium'
  | 'chestLarge'
  | 'boss'
  | 'shop';

/**
 * Rarity odds per source. Percentages, and each row sums to 100 — that is
 * checked, because a row that does not is still a legal weighted pick and would
 * silently drift from the number written in the design.
 *
 * `starter` appears in no row: 关羽's 青龙偃月刀 is dealt with the hero, never
 * dropped. `boss` and `shop` are closed pools of one tier each.
 *
 * There is no `event` row on purpose: an 奇遇 names the tier it promises in
 * its own definition and draws through `rollRelicOfTier`, never through this
 * table — a promised 「一件普通宝物」 that could come out 稀有 would make the
 * event text a lie. Its dry-pool consolation lives in `RELIC_CONSOLATION`
 * (`src/rooms/events.ts`), keyed by the promised tier for the same reason.
 */
export const RELIC_DROP_WEIGHTS: Record<RelicSource, Partial<Record<RelicTier, number>>> = {
  elite: { common: 50, uncommon: 33, rare: 17 },
  chestSmall: { common: 75, uncommon: 25 },
  chestMedium: { common: 60, uncommon: 35, rare: 5 },
  chestLarge: { common: 40, uncommon: 45, rare: 15 },
  boss: { boss: 100 },
  shop: { shop: 100 },
};

/**
 * What a source pays instead when every relic it could offer is already owned.
 * A constant per source, never a roll: the stream must be pulled the same
 * number of times whether or not a relic came out (R3), so the consolation
 * cannot be a die of its own.
 *
 * Priced off the tier a source mostly hands out — 常见 40 / 罕见 60 / 稀有 90 /
 * 首领 120 — which is a little above what the same room's gold roll pays, since
 * running the pool dry is the player's own doing.
 */
export const RELIC_MISS_GOLD: Record<RelicSource, number> = {
  elite: 60,
  chestSmall: 40,
  chestMedium: 60,
  chestLarge: 90,
  boss: 120,
  shop: 60,
};

/**
 * Canonical tier order for anything that iterates a weight row. Rolling off
 * `Object.keys(row)` instead would make the outcome depend on the order the
 * literal above happens to be written in, and re-ordering one row would then
 * silently re-roll every existing seed.
 */
export const RELIC_TIER_ORDER: readonly RelicTier[] = [
  'starter',
  'common',
  'uncommon',
  'rare',
  'boss',
  'shop',
];

/**
 * The open ladder, worst to best. A drained tier steps *down* this list before
 * it steps up, so exhausting the commons hands out 罕见 only once there is
 * nothing cheaper left — draining a pool must never quietly upgrade a reward.
 * `boss` and `shop` are closed and sit outside it; an empty 首领 pool falls back
 * to the top of this ladder rather than to a 坊市 relic the player could buy.
 */
export const RELIC_LADDER: readonly RelicTier[] = ['common', 'uncommon', 'rare'];

// ----------------------------------------------------------------- lookups

export const getRelic = (id: string): RelicDef | undefined => RELICS[id];

/** Display text with the relic's own number substituted in. */
export const relicText = (def: RelicDef): string =>
  def.text.replace(/\{N\}/g, String(def.value ?? 0));

/** The scene maps a `passive` banner event back to the icon that should flash. */
export const relicByBanner = (label: string): RelicDef | undefined =>
  Object.values(RELICS).find((r) => r.banner === label);

export const relicsOfTier = (tier: RelicTier): RelicDef[] =>
  Object.values(RELICS).filter((r) => r.tier === tier);

export interface ResolvedModifiers {
  maxHp: number;
  energy: number;
  handSize: number;
  startingBlock: number;
  goldMultiplier: number;
  potionSlots: number;
  cardRewardCount: number;
  skipRewardMaxHp: number;
  energyCarryCap: number;
  newCardsUpgraded: boolean;
  removalPriceMultiplier: number;
  noRemovalSurcharge: boolean;
  /** True when *any* owned relic forbids buying 宝物 — an or, not a sum. */
  noRelicPurchase: boolean;
}

/** Summed static modifiers for a set of relics. Gold multipliers compound. */
export function relicModifiers(ids: readonly string[]): ResolvedModifiers {
  const total: ResolvedModifiers = {
    maxHp: 0,
    energy: 0,
    handSize: 0,
    startingBlock: 0,
    goldMultiplier: 1,
    potionSlots: 0,
    cardRewardCount: 0,
    skipRewardMaxHp: 0,
    energyCarryCap: 0,
    newCardsUpgraded: false,
    removalPriceMultiplier: 1,
    noRemovalSurcharge: false,
    noRelicPurchase: false,
  };
  for (const id of ids) {
    const mods = RELICS[id]?.modifiers;
    if (!mods) continue;
    total.maxHp += mods.maxHp ?? 0;
    total.energy += mods.energy ?? 0;
    total.handSize += mods.handSize ?? 0;
    total.startingBlock += mods.startingBlock ?? 0;
    total.goldMultiplier *= mods.goldMultiplier ?? 1;
    total.potionSlots += mods.potionSlots ?? 0;
    total.cardRewardCount += mods.cardRewardCount ?? 0;
    total.skipRewardMaxHp += mods.skipRewardMaxHp ?? 0;
    total.energyCarryCap += mods.energyCarryCap ?? 0;
    total.newCardsUpgraded ||= mods.newCardsUpgraded ?? false;
    total.removalPriceMultiplier *= mods.removalPriceMultiplier ?? 1;
    total.noRemovalSurcharge ||= mods.noRemovalSurcharge ?? false;
    // Boolean rules compose by OR: one relic rewriting the door wins.
    total.noRelicPurchase ||= mods.noRelicPurchase ?? false;
  }
  return total;
}

// ------------------------------------------------------------------- firing

/**
 * Live view onto a counter store, so a hook that writes `counter.value` needs
 * no write-back step and can never leave a stale copy behind.
 */
function counterOf(store: Record<string, number>, id: string): { value: number } {
  return {
    get value() {
      return store[id] ?? 0;
    },
    set value(next: number) {
      store[id] = next;
    },
  };
}

/**
 * 关羽's 青龙偃月 keeps the original screen-wide `passive` flourish; everything
 * else just flashes its icon in the relic bar.
 */
export const relicEvent = (def: RelicDef): CombatEvent =>
  def.banner ? { t: 'passive', label: def.banner } : { t: 'relic', relicId: def.id };

/** Every relic in the fight that hooks `hook`, in pickup order. */
export function fireHook(state: CombatState, hook: CombatHook, payload?: unknown): void {
  for (const id of state.relics) {
    const def = RELICS[id];
    const fn = def?.hooks?.[hook];
    if (!def || !fn) continue;
    fn({
      state,
      payload,
      value: def.value ?? 0,
      counter: counterOf(state.relicCounters, id),
      trigger: () => state.events.push(relicEvent(def)),
    });
  }
}

/**
 * The out-of-combat half. There is no event queue on the map, so the ids that
 * fired come back instead and the caller flashes them.
 */
export function fireRunHook(run: RunState, hook: RunHook, payload?: unknown): string[] {
  const fired: string[] = [];
  for (const id of run.relics) {
    const def = RELICS[id];
    const fn = def?.hooks?.[hook];
    if (!def || !fn) continue;
    fn({
      run,
      payload,
      value: def.value ?? 0,
      counter: counterOf(run.relicCounters, id),
      trigger: () => fired.push(id),
    });
  }
  return fired;
}

export interface DamageBonus {
  amount: number;
  /** Relics that contributed, so the caller can announce them. */
  sources: RelicDef[];
}

export interface RelicCardAdjustment {
  amount: number;
  sources: RelicDef[];
}

/**
 * Effective cost of a card in the current fight. Pure because the hand view,
 * `canPlay` and `playCard` all ask the same question at different moments.
 * X-cost stays X: a printed variable is not a costly card made cheaper.
 */
export function relicCardCost(
  state: CombatState | undefined,
  def: CardDef,
): RelicCardAdjustment {
  const adjusted: RelicCardAdjustment = { amount: def.cost, sources: [] };
  if (!state || def.cost < 0) return adjusted;
  for (const id of state.relics) {
    const relic = RELICS[id];
    if (!relic?.costDelta) continue;
    const delta = relic.costDelta({
      state,
      def,
      counter: state.relicCounters[id] ?? 0,
      value: relic.value ?? 0,
    });
    if (delta === 0) continue;
    adjusted.amount += delta;
    adjusted.sources.push(relic);
  }
  adjusted.amount = Math.max(0, adjusted.amount);
  return adjusted;
}

/**
 * Extra copies of a card's effects. The card itself is paid, counted and moved
 * exactly once; this only repeats the queued effects, so hooks cannot recurse.
 */
export function relicCardCopies(
  state: CombatState | undefined,
  def: CardDef,
): RelicCardAdjustment {
  const adjusted: RelicCardAdjustment = { amount: 0, sources: [] };
  if (!state) return adjusted;
  for (const id of state.relics) {
    const relic = RELICS[id];
    if (!relic?.playCopies) continue;
    const copies = Math.max(
      0,
      relic.playCopies({
        state,
        def,
        counter: state.relicCounters[id] ?? 0,
        value: relic.value ?? 0,
      }),
    );
    if (copies === 0) continue;
    adjusted.amount += copies;
    adjusted.sources.push(relic);
  }
  return adjusted;
}

/**
 * Flat damage every relic adds to the card about to be played. Pure — both
 * `playCard` and `previewValues` call it, which is what keeps the card face
 * and the HP that comes off in agreement.
 */
export function relicDamageBonus(state: CombatState | undefined, def: CardDef): DamageBonus {
  const bonus: DamageBonus = { amount: 0, sources: [] };
  if (!state) return bonus;
  for (const id of state.relics) {
    const relic = RELICS[id];
    if (!relic?.damageBonus) continue;
    const amount = relic.damageBonus({
      state,
      def,
      counter: state.relicCounters[id] ?? 0,
      value: relic.value ?? 0,
    });
    if (amount === 0) continue;
    bonus.amount += amount;
    bonus.sources.push(relic);
  }
  return bonus;
}
