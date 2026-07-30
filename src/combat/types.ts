import type { Rng } from '../core/rng';

// ---------------------------------------------------------------- statuses

export type StatusId = 'vulnerable' | 'weak' | 'strength';

export interface StatusMeta {
  label: string;
  desc: string;
  kind: 'buff' | 'debuff';
  color: number;
}

// ------------------------------------------------------------------- cards

export type CardType = 'attack' | 'skill' | 'power';
export type CardRarity = 'basic' | 'common' | 'uncommon' | 'rare';
/** Who the player picks when playing the card. */
export type TargetMode = 'enemy' | 'self' | 'all';

export type Effect =
  | { kind: 'damage'; amount: number }
  | { kind: 'damageAll'; amount: number }
  | { kind: 'block'; amount: number }
  | { kind: 'status'; status: StatusId; amount: number; to: 'target' | 'self' }
  | { kind: 'draw'; amount: number };

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: CardRarity;
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
  /**
   * Fields the upgraded ("·精") version overrides. Absent means the card can
   * never be upgraded — curses and status cards should leave it out.
   */
  upgrade?: Partial<Pick<CardDef, 'cost' | 'target' | 'text' | 'effects'>>;
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
  | { t: 'block'; targetId: string; amount: number }
  | { t: 'status'; targetId: string; status: StatusId; amount: number }
  | { t: 'death'; targetId: string }
  | { t: 'draw'; uid: string }
  | { t: 'discard'; uid: string }
  | { t: 'shuffle' }
  | { t: 'enemyMove'; enemyId: string; label: string }
  | { t: 'passive'; label: string };

export interface CombatState {
  turn: number;
  phase: CombatPhase;
  energy: number;
  maxEnergy: number;
  player: Combatant;
  enemies: EnemyState[];
  cards: Record<string, CardInstance>;
  drawPile: string[];
  hand: string[];
  discardPile: string[];
  exhaustPile: string[];
  /** Guan Yu's 青龙偃月 fires on the first attack card each turn. */
  firstAttackUsed: boolean;
  rng: Rng;
  events: CombatEvent[];
}

export interface Encounter {
  id: string;
  name: string;
  enemies: string[];
  goldReward: [min: number, max: number];
}
