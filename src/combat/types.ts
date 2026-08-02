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
  | 'discipline'
  | 'armory'
  | 'supply'
  | 'warSaint'
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
  /** 20×20 icon texture key. Text pills do not survive a library this wide. */
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
  | { c: 'enemyCountAtLeast'; n: number }
  /** 攻 played *before* this card this turn — 赵云's 连击 reads this. */
  | { c: 'attacksAtLeast'; n: number }
  /** Cards in the 消耗堆 right now. */
  | { c: 'exhaustedAtLeast'; n: number };

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
  | { kind: 'scaleWithEnergy'; per: Effect[] }
  /**
   * Repeats `per` once for every 攻 played earlier this turn. The multiplier is
   * read **once, at enqueue time** (`QueuedStep.attacks`), exactly the way
   * `scaleWithEnergy` reads the 气 the card spent — re-reading
   * `state.attacksThisTurn` while the queue drains would let a card count
   * attacks its own effects had not yet made.
   */
  | { kind: 'scaleWithAttacks'; per: Effect[] };

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
  /**
   * Which hero may be *offered* this card: a hero id, or `'colorless'` for the
   * 无色 stock no hero drafts. Absent on 诅咒 and 状态牌, which no pool holds.
   *
   * Stamped by `cards.ts` from the table a card is declared in rather than
   * written per card, so a card cannot end up in one hero's table wearing
   * another hero's tag. `poolFor` is what actually deals them out.
   */
  hero?: string;
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
   * `false` 表示不可移除（todos/19 a4 的「宿业」）：商店弃卡、奇遇/祝福的
   * 弃牌与易牌——一切「从牌组移除」的门——都把这张牌标为不可选。缺省即可
   * 移除，所以既有卡表一行不用改。判定统一走 `isRemovable`（`state/run.ts`）。
   */
  removable?: false;
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

/**
 * What the marker over an enemy's head says it is about to do.
 *
 * **Derived, never declared.** `EnemyMove` used to carry an `intent` field and
 * two rows had it wrong — a move that shoved cards into the deck telegraphed as
 * a plain hit. The kind is now read off the move's own fields
 * (`src/combat/intent.ts`), so a table row and its telegraph cannot disagree.
 *
 * 'unknown' is the *displayed* kind of a 首回合意图不明 enemy; it never changes
 * which move was picked.
 */
export type IntentKind =
  | 'attack'
  | 'attack-defend'
  | 'attack-debuff'
  | 'defend'
  | 'defend-buff'
  | 'buff'
  | 'debuff'
  | 'strong-debuff'
  | 'special'
  | 'escape'
  | 'unknown';

/** A rider on an intent — the badges printed beside the headline number. */
export type IntentMark =
  | { m: 'block'; n: number }
  | { m: 'buff'; status: StatusId; n: number }
  | { m: 'debuff'; status: StatusId; n: number }
  | { m: 'cards'; n: number }
  | { m: 'summon'; n: number }
  | { m: 'steal'; n: number };

/**
 * Everything the intent marker draws, computed in the pure layer so the sim's
 * threat policy and the HUD's incoming-damage total read the same number.
 *
 * `damage` is per hit and already clamped (金蝉脱壳 shows 1). `loseHp` is the
 * block-ignoring half — a total that leaves it out under-reports 太平符水.
 */
export interface IntentDisplay {
  kind: IntentKind;
  damage: number | null;
  hits: number;
  loseHp: number | null;
  /** Severity band, measured against the player's current 体力. */
  tier: 'none' | 'light' | 'medium' | 'heavy' | 'lethal';
  marks: readonly IntentMark[];
  tooltip: { title: string; body: string };
  /** 首回合意图不明: the fields above are true, but must not be shown. */
  hidden: boolean;
}

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
  /**
   * 攻 already played this turn when the card was queued — what
   * `scaleWithAttacks` multiplies by. Frozen here rather than re-read off
   * `state` for the same reason `energy` is.
   */
  attacks: number;
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
  /**
   * 天命 (todos/19)：本场敌人 HP 倍率，`startCombat` 按遭遇档位从 mods 取好。
   * 召唤/分裂中途造出的新身体同样吃它——同一场仗只有一个档位。零重恒 1。
   */
  enemyHpMult: number;
  /**
   * 天命 (todos/19)：敌方攻击伤害倍率，在 `computeAttack` **之前**乘到基础值上
   * ——顺序反了就和怯战/破绽的乘法打架。意图数字走同一个入口。零重恒 1。
   */
  enemyDamageMult: number;
  /** 天命十七至十九重：本场所处档位是否启用敌人强化招式表。 */
  enemyMovesEnhanced: boolean;
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
