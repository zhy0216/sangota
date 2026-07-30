import { addGold, type RunState } from '../state/run';
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
        gainBlock(state, state.player, value);
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
        gainBlock(state, state.player, value);
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
        gainBlock(state, state.player, value);
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
        gainBlock(state, state.player, value);
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
};

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
}

/** Summed static modifiers for a set of relics. Gold multipliers compound. */
export function relicModifiers(ids: readonly string[]): ResolvedModifiers {
  const total: ResolvedModifiers = {
    maxHp: 0,
    energy: 0,
    handSize: 0,
    startingBlock: 0,
    goldMultiplier: 1,
  };
  for (const id of ids) {
    const mods = RELICS[id]?.modifiers;
    if (!mods) continue;
    total.maxHp += mods.maxHp ?? 0;
    total.energy += mods.energy ?? 0;
    total.handSize += mods.handSize ?? 0;
    total.startingBlock += mods.startingBlock ?? 0;
    total.goldMultiplier *= mods.goldMultiplier ?? 1;
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
