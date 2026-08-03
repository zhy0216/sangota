import type { CombatTier } from '../combat/enemies';
import type { StatusId } from '../combat/types';

/** A string is an unupgraded card; use the object form for forged cards. */
export type DevSceneCard = string | { id: string; upgraded?: number };

export interface DevScenePlayer {
  hp?: number;
  maxHp?: number;
  block?: number;
  energy?: number;
  maxEnergy?: number;
  handSize?: number;
  statuses?: Partial<Record<StatusId, number>>;
}

/** Enemy entries correspond to the encounter's enemies by slot. */
export interface DevSceneEnemy {
  /** Optional assertion that this slot contains the expected enemy definition. */
  defId?: string;
  hp?: number;
  maxHp?: number;
  block?: number;
  statuses?: Partial<Record<StatusId, number>>;
  /** Move id from this enemy's current move table; null hides the intent. */
  intent?: string | null;
  phase?: string | null;
  actedTurns?: number;
  repeat?: number;
  alive?: boolean;
}

export interface DevCombatScene {
  name: string;
  description?: string;
  /** Lower numbers appear first on the in-game scene browser. */
  order?: number;
  hero?: string;
  encounter: string;
  /** Defaults to the encounter's own tier. */
  tier?: CombatTier;
  seed?: string;
  ascension?: number;
  gold?: number;
  relics?: string[];
  /** Exact belt contents; missing slots are padded with null. */
  potions?: (string | null)[];
  player?: DevScenePlayer;
  enemies?: DevSceneEnemy[];
  turn?: number;
  attacksThisTurn?: number;
  cardsPlayedThisTurn?: number;
  /** Exact hand at scene start. */
  hand?: DevSceneCard[];
  /** First entry is the next card drawn. */
  drawPile?: DevSceneCard[];
  discardPile?: DevSceneCard[];
  exhaustPile?: DevSceneCard[];
}

export const defineCombatScene = (scene: DevCombatScene): DevCombatScene => scene;
