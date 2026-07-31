import type { Rng } from '../core/rng';
import type { RunState } from '../state/run';

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
  | 'slayer'
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

/**
 * 诅咒 rides in the deck for the whole run; 状态 is minted into one fight and
 * dies with it. Both are cards in every other respect, which is the point —
 * they take up a hand slot and obey the same life cycle.
 */
export type CardType = 'attack' | 'skill' | 'power' | 'curse' | 'status';
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

/**
 * Behaviour a curse or status card cannot express as an `Effect`, because it
 * fires from somewhere other than "this card was played". The engine calls
 * these at four fixed moments and branches on no card id, the same contract
 * relics run on.
 */
export interface CardHooks {
  /** Our turn is ending and this card is still in hand. */
  onEndTurnInHand?: (state: CombatState, uid: string) => void;
  /** The moment this card enters the hand off the draw pile. */
  onDrawn?: (state: CombatState, uid: string) => void;
  /** The fight was won and this card was in it. Needs the run, so the scene fires it. */
  onCombatEnd?: (state: CombatState, run: RunState) => void;
  /** Another card finished resolving while this one sat in hand. */
  onCardPlayedInHand?: (state: CombatState, uid: string) => void;
  /**
   * May *other* cards still be played while this one is in hand? Queried by
   * `canPlay`, which the hand view calls once per card per repaint — so it must
   * stay free of side effects.
   */
  restrictPlay?: (state: CombatState) => boolean;
}

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
  hooks?: CardHooks;
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

export type IntentKind =
  | 'attack'
  | 'defend'
  | 'buff'
  | 'debuff'
  | 'attack-defend'
  | 'summon'
  | 'escape';

/**
 * Gate on a single move. Absent means "always on the table", which is what
 * keeps a table with no conditions rolling over exactly the pool it always did.
 *
 * 「友军」 counts living enemies *including the mover itself*, so a lone enemy
 * sits at `alliesAtLeast: 1`.
 */
export type MoveCondition =
  | { c: 'selfHpBelow'; percent: number }
  | { c: 'selfHpAtLeast'; percent: number }
  | { c: 'turnAtLeast'; n: number }
  | { c: 'alliesAtLeast'; n: number }
  | { c: 'alliesAtMost'; n: number };

/**
 * One row of an enemy's move table. Everything an enemy can do is a field
 * here — the engine reads the row and branches on no enemy id, the same
 * contract `StatusDef` and `CardDef` are held to.
 */
export interface EnemyMove {
  id: string;
  label: string;
  intent: IntentKind;
  damage?: number;
  /** Multi-hit attacks show as "N × hits". */
  hits?: number;
  block?: number;
  status?: { status: StatusId; amount: number; to: 'player' | 'self' };
  /** The same status on every living enemy, the mover included. */
  statusAll?: { status: StatusId; amount: number };
  /** Straight to the body: ignores 护甲, is not an attack, provokes no 反刺. */
  loseHp?: number;
  /** Shoves 状态牌 into the player's piles. Minted, so they die with the fight. */
  addCards?: { defId: string; count: number; to: 'draw' | 'discard' | 'hand' };
  /** New enemies appended to `state.enemies`; they act from the *next* turn. */
  summon?: { defId: string; count: number };
  /**
   * 资财 lifted off the run. Reported as a `steal` event and nothing more — the
   * engine never touches `RunState`, so the scene is what actually pays.
   */
  steal?: number;
  /** Leaves the fight: no death, no kill hooks, no reward. */
  escape?: boolean;
  /** Relative pick weight. Defaults to 1, and is ignored while a script runs. */
  weight?: number;
  /** How many times in a row this move may be chosen. */
  maxRepeat?: number;
  /** Only selectable while this holds. */
  when?: MoveCondition;
}

/**
 * A fixed rotation. While one is set the weights are not consulted at all and
 * no die is rolled — which is the point: a telegraphed套路 the player can learn
 * is a different kind of fight from a weighted roll.
 *
 * The index is the enemy's *own* `actedTurns`, never `state.turn`: a summon
 * that joins on turn 4 starts its script at the beginning, and an enemy that
 * skipped a turn does not skip a beat.
 */
export interface EnemyScript {
  /** Move ids, in order. */
  order: string[];
  /** Where the loop restarts once `order` runs out. Defaults to 0. */
  loopFrom?: number;
}

/** An alternate move table an enemy switches into. Same shape as the default. */
export interface EnemyPhase {
  moves: EnemyMove[];
  script?: EnemyScript;
}

/**
 * Fires once, the moment the enemy's HP lands at or below `percent` of its
 * maximum — inside the blow that took it there, so a half-HP transformation is
 * live before the player's next card, not a turn late.
 */
export interface EnemyThreshold {
  percent: number;
  /** One-off statuses, e.g. 暴怒 or a lump of 神力. */
  gain?: Partial<Record<StatusId, number>>;
  /** Switch to a named entry of `phases`. Restarts that phase's script. */
  phase?: string;
  /** Break apart. The parent leaves without dying; children split its HP. */
  split?: { defId: string; count: number };
  /** Shown over the enemy's head. */
  shout?: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  art: string;
  hp: [min: number, max: number];
  /** On-screen height in design units. */
  height: number;
  moves: EnemyMove[];
  /** Statuses the enemy walks in with — 龟缩, 暴怒, 反刺, 蓄势, 重甲… */
  passives?: Partial<Record<StatusId, number>>;
  /** Fixed rotation instead of a weighted roll. */
  script?: EnemyScript;
  /** Alternate move tables, entered by a threshold's `phase`. */
  phases?: Record<string, EnemyPhase>;
  /** HP-line triggers, each firing at most once. */
  thresholds?: readonly EnemyThreshold[];
  /** The opening telegraph reads 「？」 until the enemy has acted once. */
  hiddenFirstIntent?: boolean;
}

export interface EnemyState extends Combatant {
  defId: string;
  art: string;
  height: number;
  /** The move that will resolve on the enemy's next turn. */
  intent: EnemyMove | null;
  /** How many times in a row `intent` has been repeated. */
  repeat: number;
  alive: boolean;
  /** Slot index, so the view can keep positions stable after a death. */
  slot: number;
  /**
   * Turns this enemy has actually acted on — the script cursor, and what
   * `hiddenFirstIntent` reads. Not `state.turn`: a summon joins mid-fight.
   */
  actedTurns: number;
  /** Named entry of `EnemyDef.phases` currently in force, or null for the default. */
  phase: string | null;
  /** Indices of `EnemyDef.thresholds` already spent. */
  crossed: number[];
  /** Left the fight rather than died: no kill hooks, no reward, still a win. */
  escaped: boolean;
}

// ------------------------------------------------------------------- combat

export type CombatPhase = 'player' | 'enemy' | 'won' | 'lost';

/** Emitted by the engine so the scene can animate; drained by the scene. */
export type CombatEvent =
  | { t: 'damage'; targetId: string; amount: number; blocked: number; lethal: boolean }
  | { t: 'heal'; targetId: string; amount: number }
  | { t: 'block'; targetId: string; amount: number }
  | { t: 'status'; targetId: string; status: StatusId; amount: number }
  /** A status was cancelled: 护身符 warded it off, 天佑 ate a wound, 清心散 cleansed. */
  | { t: 'statusBlocked'; targetId: string; status: StatusId }
  | { t: 'death'; targetId: string }
  | { t: 'draw'; uid: string }
  | { t: 'discard'; uid: string }
  | { t: 'exhaust'; uid: string }
  | { t: 'shuffle' }
  | { t: 'enemyMove'; enemyId: string; label: string }
  /** New enemies joined the fight. `spawned` are their `EnemyState.id`s. */
  | { t: 'summon'; enemyId: string; spawned: string[] }
  /** A body broke apart. The parent is gone but did *not* die. */
  | { t: 'split'; parentId: string; spawned: string[] }
  /** An enemy fled. Not a death: no kill hooks, no reward, the fight can end. */
  | { t: 'escape'; targetId: string }
  /**
   * 资财 lifted off the run. The engine has no `RunState`, so this is the whole
   * of the theft — whoever drives the fight is what actually debits the purse.
   */
  | { t: 'steal'; enemyId: string; amount: number }
  /** A threshold fired: a line over the enemy's head. */
  | { t: 'shout'; enemyId: string; text: string }
  /** A relic fired: flash its icon in the bar. */
  | { t: 'relic'; relicId: string }
  /** A 丹药 was drunk: empty its slot and flourish. */
  | { t: 'potion'; potionId: string }
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
  /** Every card, not just 攻 — 宿命's cap counts them all. */
  cardsPlayedThisTurn: number;
  /** Effects still to resolve. Non-empty only while a card is mid-resolution. */
  effectQueue: QueuedStep[];
  /** Non-null freezes the fight until `resolveChoice` answers it. */
  pendingChoice: PendingChoice | null;
  /** 回天丹: HP to come back on instead of dying, once. 0 means no refund held. */
  pendingRevive: number;
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
