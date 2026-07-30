import type { Rng } from '../core/rng';

// ---------------------------------------------------------------- statuses

export type StatusId =
  | 'vulnerable'
  | 'weak'
  | 'strength'
  | 'dexterity'
  | 'frail'
  | 'poison'
  | 'regen'
  | 'metallicize'
  | 'thorns'
  | 'artifact'
  | 'barricade'
  | 'intangible'
  | 'buffer'
  | 'ritual'
  | 'noDraw'
  | 'entangled'
  | 'curlUp'
  | 'angry';

/** Presentation only. The rules of a status live in `StatusDef` (statuses.ts). */
export interface StatusMeta {
  label: string;
  desc: string;
  kind: 'buff' | 'debuff';
  color: number;
  /** 20×20 icon texture key. Text pills do not survive 18 statuses. */
  icon?: string;
}

// ------------------------------------------------------------------- cards

export type CardType = 'attack' | 'skill' | 'power';
export type CardRarity = 'basic' | 'common' | 'uncommon' | 'rare';
/** Who the player picks when playing the card. */
export type TargetMode = 'enemy' | 'self' | 'all';

/**
 * Keywords change a card's *life cycle*; effects change what it does. Powers
 * are 'exhaust' cards like any other — there is no type special case, or the
 * game would carry two parallel sets of rules for leaving play.
 */
export type CardKeyword = 'exhaust' | 'ethereal' | 'innate' | 'retain' | 'unplayable';

export type EffectCondition =
  | { c: 'targetHasStatus'; status: StatusId; min?: number }
  | { c: 'selfHasStatus'; status: StatusId; min?: number }
  | { c: 'handEmpty' }
  | { c: 'attackPlayedThisTurn' }
  | { c: 'hpBelow'; percent: number }
  | { c: 'enemyCountAtLeast'; n: number };

export type Effect =
  | { kind: 'damage'; amount: number; times?: number }
  | { kind: 'damageAll'; amount: number; times?: number }
  | { kind: 'block'; amount: number }
  | { kind: 'status'; status: StatusId; amount: number; to: 'target' | 'self' | 'allEnemies' }
  | { kind: 'draw'; amount: number }
  /** Self-damage: ignores block and is not an attack, so no Strength, no Vulnerable. */
  | { kind: 'loseHp'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'energy'; amount: number }
  /** Non-random discards stop the engine on `pendingChoice` until the player picks. */
  | { kind: 'discard'; amount: number; random?: boolean }
  | { kind: 'exhaustCards'; amount: number }
  | {
      kind: 'addCard';
      defId: string;
      count: number;
      to: 'hand' | 'draw' | 'discard';
      upgraded?: number;
    }
  | { kind: 'shuffleDiscardIn' }
  | { kind: 'conditional'; when: EffectCondition; then: Effect[]; otherwise?: Effect[] }
  /** X-cost: repeats `per` once for every 气 the card actually consumed. */
  | { kind: 'scaleWithEnergy'; per: Effect[] };

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: CardRarity;
  /** `X_COST` (-1) means "spend everything", and `scaleWithEnergy` reads it back. */
  cost: number;
  target: TargetMode;
  /** Texture key for the card's illustration. */
  art: string;
  /**
   * Rules text. `{D}` is replaced with the computed damage of the first
   * damage effect and `{B}` with the first block effect, so the card always
   * shows the number it will actually deal.
   */
  text: string;
  effects: Effect[];
  keywords?: readonly CardKeyword[];
  /**
   * Fields the upgraded ("·精") version overrides. Absent means the card can
   * never be upgraded — curses and status cards should leave it out.
   */
  upgrade?: Partial<Pick<CardDef, 'cost' | 'target' | 'text' | 'effects' | 'keywords'>>;
}

export interface CardInstance {
  uid: string;
  defId: string;
  /** Upgrade count. Only 0 and 1 are meaningful today. */
  upgraded: number;
}

// --------------------------------------------------------------- combatants

export interface Combatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  statuses: Partial<Record<StatusId, number>>;
}

export type IntentKind = 'attack' | 'defend' | 'buff' | 'debuff' | 'attack-defend';

export interface EnemyMove {
  id: string;
  label: string;
  intent: IntentKind;
  damage?: number;
  /** Multi-hit attacks show as "N × hits". */
  hits?: number;
  block?: number;
  status?: { status: StatusId; amount: number; to: 'player' | 'self' };
  /** Relative pick weight. */
  weight: number;
  /** How many times in a row this move may be chosen. */
  maxRepeat?: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  art: string;
  hp: [min: number, max: number];
  /** On-screen height in design units. */
  height: number;
  moves: EnemyMove[];
}

export interface EnemyState extends Combatant {
  defId: string;
  art: string;
  height: number;
  /** The move that will resolve on the enemy's next turn. */
  intent: EnemyMove | null;
  /** How many turns in a row `intent` has been repeated. */
  repeat: number;
  alive: boolean;
  /** Slot index, so the view can keep positions stable after a death. */
  slot: number;
}

// ------------------------------------------------------------------- combat

export type CombatPhase = 'player' | 'enemy' | 'won' | 'lost';

/** Emitted by the engine so the scene can animate; drained by the scene. */
export type CombatEvent =
  | { t: 'damage'; targetId: string; amount: number; blocked: number; lethal: boolean }
  | { t: 'heal'; targetId: string; amount: number }
  | { t: 'block'; targetId: string; amount: number }
  | { t: 'status'; targetId: string; status: StatusId; amount: number }
  /** 护身符 warded a debuff off, or 天佑 ate a wound. One event for both. */
  | { t: 'statusBlocked'; targetId: string; status: StatusId }
  | { t: 'death'; targetId: string }
  | { t: 'draw'; uid: string }
  | { t: 'discard'; uid: string }
  | { t: 'exhaust'; uid: string }
  | { t: 'shuffle' }
  | { t: 'enemyMove'; enemyId: string; label: string }
  /** A relic fired: flash its icon in the bar. */
  | { t: 'relic'; relicId: string }
  /** A relic with a `banner` fired: the full-screen flourish. */
  | { t: 'passive'; label: string };

/**
 * A card effect waiting its turn, carrying the context of the card that queued
 * it. Effects go through a queue rather than a plain loop because one of them
 * (「弃 2 张牌」) has to stop and wait for the player — see `pendingChoice`.
 */
export interface QueuedStep {
  effect: Effect;
  target: EnemyState | undefined;
  /** Relic damage bonus in force for the card that queued this step. */
  bonus: number;
  /** 气 the card actually spent, which is what `scaleWithEnergy` multiplies by. */
  energy: number;
}

/**
 * The engine is synchronous, so "choose 2 cards to exhaust" cannot block. It
 * parks the rest of `effectQueue` here instead; the scene (or a sim policy)
 * answers with `resolveChoice` and the queue resumes.
 */
export interface PendingChoice {
  kind: 'discard' | 'exhaust' | 'putOnDraw';
  /** Card uids the answer may be drawn from. */
  options: string[];
  min: number;
  max: number;
}

export interface CombatState {
  turn: number;
  phase: CombatPhase;
  energy: number;
  maxEnergy: number;
  /** Cards drawn at the start of each turn, relic modifiers already folded in. */
  handSize: number;
  player: Combatant;
  enemies: EnemyState[];
  cards: Record<string, CardInstance>;
  drawPile: string[];
  hand: string[];
  discardPile: string[];
  exhaustPile: string[];
  /** Neutral bookkeeping relics ask about, e.g. "is this the first attack?". */
  attacksThisTurn: number;
  /** Effects still to resolve. Non-empty only while a card is mid-resolution. */
  effectQueue: QueuedStep[];
  /** Non-null freezes the fight until `resolveChoice` answers it. */
  pendingChoice: PendingChoice | null;
  /** Monotonic id source for engine-minted cards. Never `rng` — uids must replay. */
  nextUid: number;
  /** Relic ids in effect, in pickup order — hooks fire in this order. */
  relics: string[];
  /** Per-relic counters for this fight only; run-long ones live on RunState. */
  relicCounters: Record<string, number>;
  rng: Rng;
  events: CombatEvent[];
}

export interface Encounter {
  id: string;
  name: string;
  enemies: string[];
  goldReward: [min: number, max: number];
}
