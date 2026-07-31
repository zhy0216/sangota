import { addGold, heal, type RunState } from '../state/run';
import {
  addStatus,
  aliveEnemies,
  applyDamage,
  drawCards,
  gainBlock,
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
}

/** Everything a pure damage query may look at. Must not be mutated. */
export interface RelicQuery {
  state: CombatState;
  def: CardDef;
  counter: number;
  value: number;
}

export interface RelicDef {
  id: string;
  name: string;
  tier: RelicTier;
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

  shufajinguan: {
    id: 'shufajinguan',
    name: '束发金冠',
    tier: 'common',
    art: 'relic-shufajinguan',
    text: '战斗开始时，获得 {N} 点护甲。',
    value: 3,
    hooks: {
      combatStart: ({ state, value, trigger }) => {
        trigger();
        gainBlock(state, state.player, value, 'relic');
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

  chuanguoyuxi: {
    id: 'chuanguoyuxi',
    name: '传国玉玺',
    tier: 'rare',
    art: 'relic-chuanguoyuxi',
    text: '第 3 回合起，每回合开始时多抽 {N} 张牌。',
    value: 1,
    hooks: {
      turnStart: ({ state, value, trigger }) => {
        if (state.turn < 3) return;
        trigger();
        drawCards(state, value);
      },
    },
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

  xiaoshouling: {
    id: 'xiaoshouling',
    name: '枭首令',
    tier: 'uncommon',
    art: 'relic-xiaoshouling',
    text: '每击杀一名敌人，获得 {N} 点【神力】。',
    value: 1,
    hooks: {
      enemyKilled: ({ state, value, trigger }) => {
        trigger();
        addStatus(state, state.player, 'strength', value);
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
   * The 魁首 trade: a narrower draft in exchange for the boss relic itself.
   * -2 rather than "always 1" so it composes with 求贤令 instead of overriding
   * it — two relics that both rewrite the count would need a precedence rule.
   */
  duduan: {
    id: 'duduan',
    name: '独断',
    tier: 'boss',
    art: 'relic-duduan',
    text: '战后可选的卡牌 -{N} 张。',
    value: 2,
    modifiers: { cardRewardCount: -2 },
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
   */
  mumaliu: {
    id: 'mumaliu',
    name: '木牛流马',
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

  tongquetai: {
    id: 'tongquetai',
    name: '铜雀台',
    tier: 'boss',
    art: 'relic-tongquetai',
    text: '所得资财增加一半，但每回合少抽 1 张牌。',
    modifiers: { goldMultiplier: 1.5, handSize: -1 },
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
  | 'shop'
  | 'event';

/**
 * Rarity odds per source. Percentages, and each row sums to 100 — that is
 * checked, because a row that does not is still a legal weighted pick and would
 * silently drift from the number written in the design.
 *
 * `starter` appears in no row: 关羽's 青龙偃月刀 is dealt with the hero, never
 * dropped. `boss` and `shop` are closed pools of one tier each.
 */
export const RELIC_DROP_WEIGHTS: Record<RelicSource, Partial<Record<RelicTier, number>>> = {
  elite: { common: 50, uncommon: 33, rare: 17 },
  chestSmall: { common: 75, uncommon: 25 },
  chestMedium: { common: 60, uncommon: 35, rare: 5 },
  chestLarge: { common: 40, uncommon: 45, rare: 15 },
  boss: { boss: 100 },
  shop: { shop: 100 },
  event: { common: 60, uncommon: 30, rare: 10 },
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
  event: 40,
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
