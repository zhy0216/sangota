import { moveById, type CombatTier } from '../combat/enemies';
import type { CombatState, EnemyState } from '../combat/types';
import { Rng } from '../core/rng';
import { ACTS, type ActIndex } from '../data/acts';
import { HEROES } from '../data/heroes';
import { generateFinalAct, generateMap } from '../map/generateMap';
import { adoptRun, syncPotionSlots, syncRewardCount, uidCursor, type RunState } from './run';

/**
 * 存档 — one slot, written at every boundary, restored bit-for-bit.
 *
 * Four rules shape everything below, and the first two are the reason this is a
 * mapping layer rather than a `JSON.stringify(run)`:
 *
 * **S1 — the map is not stored, it is regrown.** `generateMap` is deterministic
 * (`tests/generateMap.test.ts` replays 400 seeds), so a seed plus the act it
 * belongs to reproduces every node, every edge and every jitter offset exactly.
 * Storing the graph instead would be larger, would break the moment `MapNode`
 * gained a field, and would let a save disagree with the generator that made it.
 *
 * **S2 — nothing derived is stored.** `potionSlots` and `cardRewardCount` are
 * pure functions of `relics` (`syncPotionSlots` / `syncRewardCount`), so they
 * are re-derived on load. A stored copy is a second source of truth that a relic
 * rebalance would silently leave stale.
 *
 * **S3 — no clock.** 约定 2 bans every wall-clock API from every file under
 * `src/`, rules layer or not — see 「keeps the clock out of every file」 in
 * `tests/integrity.test.ts` — because a run that reads the clock does not
 * replay. todos/08's draft carried a `savedAt` field and this does not: it is
 * the one line of that design that could not be built. The autosave throttle is
 * likewise not time-based; the write path de-duplicates on the *payload*
 * instead, which is a better throttle anyway (see `lastWritten`).
 *
 * **S4 — a save that cannot be restored exactly is refused, never approximated.**
 * An unknown hero, an unknown map node, a telegraphed enemy move whose table row
 * no longer exists: every one of them throws out of `fromSaved`, the loader
 * reports 「损坏」, and the title screen offers to clear it. Silently continuing
 * from a half-understood save is worse than losing it — the player would be
 * playing a run the numbers no longer describe.
 */

/**
 * Bump on any change that makes an old payload unreadable. The loader refuses a
 * mismatch outright (`{ kind: 'stale' }`) rather than migrating: there is one
 * slot and one run in it, and a wrong migration is indistinguishable from a
 * working save until the run is already unwinnable.
 *
 * 2: `RunState.stats` 与 `SavedCombat.fightDamageTaken` (todos/22 s1)。
 */
export const SAVE_VERSION = 2;

const SAVE_KEY = 'sangota.save.v1';

// --------------------------------------------------------------- 存档结构

/**
 * Everything on `RunState` that is neither reconstructible (S1) nor derived
 * (S2), taken as a *derived* type rather than re-declared field by field.
 *
 * This is the point of the whole file: `RunState` has grown a field in five of
 * the last six phases, and a hand-written mirror would have silently dropped
 * every one of them. Written this way, a new field on `RunState` becomes a
 * missing property on the object literal in `toSaved` — a build error, on the
 * next `npm run typecheck`, naming the field.
 */
type PersistedRun = Omit<RunState, 'hero' | 'map' | 'potionSlots' | 'cardRewardCount'>;

export interface SavedRun extends PersistedRun {
  version: number;
  /** `HeroDef` is a table row; only its id belongs in a save. */
  heroId: string;
  /** `GameMap.seed`, which `run.act` turns back into the whole graph (S1). */
  mapSeed: string;
  /** `run.ts`'s monotonic deck-uid counter — see `uidCursor`. */
  uidCursor: number;
  /** The fight in progress, or null when the player is standing on the map. */
  combat: SavedCombat | null;
}

/**
 * `EnemyState.intent` is a *reference into the move table*, so it saves as an id
 * and resolves back through the enemy's current phase (`moveById`).
 */
type SavedEnemy = Omit<EnemyState, 'intent'> & { intentId: string | null };

/**
 * Everything except the four fields a snapshot must not or need not hold:
 *
 * - `rng` is an object; its cursor is one 32-bit word (`rngState`).
 * - `events` have already been drained by the scene that animated them.
 * - `effectQueue` and `pendingChoice` hold live `EnemyState` references and a
 *   half-resolved card. Rather than serialise them, snapshots are only ever
 *   taken when both are empty — see `combatIsQuiescent`.
 */
type PersistedCombat = Omit<
  CombatState,
  'enemies' | 'rng' | 'events' | 'effectQueue' | 'pendingChoice'
>;

export interface SavedCombat extends PersistedCombat {
  enemies: SavedEnemy[];
  rngState: number;

  // ---- what `CombatScene` carries beside the engine state ------------------

  /** 杂兵 / 精英 / 首领 — picks the reward tables and the 战利品 chest. */
  tier: CombatTier;
  /** `CombatScene.ledgerId`: set only for an 奇遇-started fight. */
  ledgerId: string | null;
  /** A relic the 奇遇 promised for surviving, paid on the victory screen. */
  bonusRelic: string | null;
  /** `CombatScene.theftSeq` — the idempotency key 夺财 payouts are gated by. */
  theftSeq: number;
  /**
   * `CombatScene.fightDamageTaken` — 本场已掉的血 (todos/22)。无伤判定的基线：
   * 不存的话，先挨一刀、存档再读回来打完，就成了「无伤」。
   */
  fightDamageTaken: number;
}

/** The scene-side context a snapshot needs and `CombatState` does not carry. */
export interface CombatContext {
  tier: CombatTier;
  ledgerId: string | null;
  bonusRelic: string | null;
  theftSeq: number;
  fightDamageTaken: number;
}

// ----------------------------------------------------------------- 纯映射

/**
 * Events the *scene* still owes the run something for. Dropping one of these
 * loses a payout; dropping any other loses an animation.
 *
 * 约定 8 keeps the engine away from `RunState`, so a 夺财 is *reported* by the
 * engine and *charged* by `CombatScene` (`payTheft`). Until the scene has
 * played the event, the gold is still in the purse — so a snapshot taken over
 * an unplayed one, whose `events` array `restoreCombat` drops, is a theft the
 * player gets refunded by reloading.
 */
const RUN_SIDE_EVENTS: ReadonlySet<CombatState['events'][number]['t']> = new Set(['steal']);

/**
 * May the fight be snapshotted right now?
 *
 * Two things must be finished, and one thing deliberately need not be:
 *
 * - **`effectQueue`** holds `QueuedStep`s pointing at live `EnemyState` objects,
 *   i.e. a card half-resolved. Expensive to serialise faithfully and free to
 *   avoid, since it is only ever non-empty mid-animation.
 * - **`pendingChoice`** is a question the player has not answered.
 * - **`events` may be non-empty**, and at the top of a fight always is: the five
 *   opening `draw`s are still queued when `create` finishes. They are a
 *   *presentation log* — the engine has already applied every one of them to
 *   `CombatState` — so `restoreCombat` drops them and the only thing lost is an
 *   animation. Requiring them empty meant the opening state of a fight was never
 *   written down at all: reloading before playing a card put the player back on
 *   a map node already marked visited, with the fight and its 战利品 skipped.
 *   The one exception is `RUN_SIDE_EVENTS`.
 */
export const combatIsQuiescent = (state: CombatState): boolean =>
  state.effectQueue.length === 0 &&
  state.pendingChoice === null &&
  !state.events.some((e) => RUN_SIDE_EVENTS.has(e.t));

export function snapshotCombat(state: CombatState, ctx: CombatContext): SavedCombat {
  return {
    turn: state.turn,
    phase: state.phase,
    energy: state.energy,
    maxEnergy: state.maxEnergy,
    handSize: state.handSize,
    player: state.player,
    cards: state.cards,
    drawPile: state.drawPile,
    hand: state.hand,
    discardPile: state.discardPile,
    exhaustPile: state.exhaustPile,
    attacksThisTurn: state.attacksThisTurn,
    cardsPlayedThisTurn: state.cardsPlayedThisTurn,
    pendingRevive: state.pendingRevive,
    nextUid: state.nextUid,
    relics: state.relics,
    relicCounters: state.relicCounters,

    enemies: state.enemies.map(({ intent, ...rest }) => ({
      ...rest,
      intentId: intent?.id ?? null,
    })),
    rngState: state.rng.getState(),

    tier: ctx.tier,
    ledgerId: ctx.ledgerId,
    bonusRelic: ctx.bonusRelic,
    theftSeq: ctx.theftSeq,
    fightDamageTaken: ctx.fightDamageTaken,
  };
}

/**
 * Rebuild the fight. Throws on a move id the table no longer has (S4) — the
 * alternative is re-rolling an intent under a player who has already been shown
 * one and has planned the turn around it.
 */
export function restoreCombat(saved: SavedCombat): CombatState {
  const rng = new Rng(0);
  rng.fromState(saved.rngState);

  const enemies: EnemyState[] = saved.enemies.map(({ intentId, ...rest }) => {
    const intent = intentId === null ? null : moveById(rest.defId, rest.phase, intentId);
    if (intentId !== null && !intent) {
      throw new Error(`Saved intent '${intentId}' is not a move of ${rest.defId}`);
    }
    return { ...rest, intent };
  });

  return {
    turn: saved.turn,
    phase: saved.phase,
    energy: saved.energy,
    maxEnergy: saved.maxEnergy,
    handSize: saved.handSize,
    player: saved.player,
    enemies,
    cards: saved.cards,
    drawPile: saved.drawPile,
    hand: saved.hand,
    discardPile: saved.discardPile,
    exhaustPile: saved.exhaustPile,
    attacksThisTurn: saved.attacksThisTurn,
    cardsPlayedThisTurn: saved.cardsPlayedThisTurn,
    effectQueue: [],
    pendingChoice: null,
    pendingRevive: saved.pendingRevive,
    nextUid: saved.nextUid,
    relics: saved.relics,
    relicCounters: saved.relicCounters,
    rng,
    events: [],
  };
}

/**
 * A run, as a payload. Shares array and object structure with `run` — the write
 * path stringifies immediately, and the round-trip test parses a fresh copy.
 */
export function toSaved(run: RunState, combat: SavedCombat | null): SavedRun {
  return {
    version: SAVE_VERSION,
    heroId: run.hero.id,
    mapSeed: run.map.seed,
    uidCursor: uidCursor(),
    combat,

    hp: run.hp,
    maxHp: run.maxHp,
    gold: run.gold,
    act: run.act,
    deck: run.deck,
    relics: run.relics,
    relicCounters: run.relicCounters,
    potions: run.potions,
    potionChance: run.potionChance,
    rareBump: run.rareBump,
    currentNodeId: run.currentNodeId,
    path: run.path,
    rooms: run.rooms,
    seenEvents: run.seenEvents,
    cardRemovalSurcharge: run.cardRemovalSurcharge,
    actCombatCount: run.actCombatCount,
    usedEncounters: run.usedEncounters,
    bossRelicOffer: run.bossRelicOffer,
    keys: run.keys,
    blessing: run.blessing,
    stats: run.stats,
  };
}

/**
 * Rebuild the run and make it the active one.
 *
 * **Takes ownership of `saved`.** The returned `RunState` shares its arrays and
 * objects, which is correct for the only caller — a payload freshly parsed out
 * of storage, which nothing else holds a reference to.
 *
 * `path` is the whole of the map's mutable state: `travelTo` is the only writer
 * of `MapNode.visited` and it pushes to `path` in the same breath, so replaying
 * the path *is* repainting the trail. A separate `visitedNodeIds` array would be
 * the same information twice, with a way to disagree.
 */
export function fromSaved(saved: SavedRun): RunState {
  const hero = HEROES[saved.heroId];
  if (!hero) throw new Error(`Unknown hero in save: ${saved.heroId}`);

  const act = ACTS[saved.act as ActIndex];
  if (!act) throw new Error(`Unknown act in save: ${saved.act}`);

  // 终章 is built by hand and rolls nothing; every other act regrows from its
  // own seed and its own layout (S1). `advanceAct` makes exactly this choice.
  const map =
    act.index === 4 ? generateFinalAct(saved.mapSeed) : generateMap(saved.mapSeed, act.layout);

  for (const id of saved.path) {
    const node = map.nodes.get(id);
    if (!node) throw new Error(`Saved path names a node the map has not got: ${id}`);
    node.visited = true;
  }

  const run: RunState = {
    hero,
    map,
    hp: saved.hp,
    maxHp: saved.maxHp,
    gold: saved.gold,
    act: saved.act,
    deck: saved.deck,
    relics: saved.relics,
    relicCounters: saved.relicCounters,
    potions: saved.potions,
    // Both re-derived from `relics` a line below (S2).
    potionSlots: 0,
    cardRewardCount: 0,
    potionChance: saved.potionChance,
    rareBump: saved.rareBump,
    currentNodeId: saved.currentNodeId,
    path: saved.path,
    rooms: saved.rooms,
    seenEvents: saved.seenEvents,
    cardRemovalSurcharge: saved.cardRemovalSurcharge,
    actCombatCount: saved.actCombatCount,
    usedEncounters: saved.usedEncounters,
    bossRelicOffer: saved.bossRelicOffer,
    keys: saved.keys,
    blessing: saved.blessing,
    stats: saved.stats,
  };

  syncPotionSlots(run);
  syncRewardCount(run);
  return adoptRun(run, saved.uidCursor);
}

// ------------------------------------------------------------------- 摘要

/** What the 「继续」 button prints, so the player knows what they are resuming. */
export interface SaveSummary {
  heroName: string;
  actLabel: string;
  /** Rooms entered this act. The 兵败 screen counts the same way. */
  floor: number;
  hp: number;
  maxHp: number;
  gold: number;
  deckSize: number;
  /** True when the save was taken mid-fight, so the button can say so. */
  inCombat: boolean;
}

/**
 * Read straight off the payload, without rebuilding the run — the title screen
 * draws this before the player has committed to anything, and regenerating a map
 * to print a floor number would be a whole act's stream spent on a label.
 */
export function summarise(saved: SavedRun): SaveSummary {
  const hero = HEROES[saved.heroId];
  const act = ACTS[saved.act as ActIndex];
  return {
    heroName: hero?.name ?? '？',
    actLabel: act ? (act.index === 4 ? '终章' : `第${['一', '二', '三'][act.index - 1]}幕`) : '？',
    floor: saved.path.length,
    hp: saved.hp,
    maxHp: saved.maxHp,
    gold: saved.gold,
    deckSize: saved.deck.length,
    inCombat: saved.combat !== null,
  };
}

// ----------------------------------------------------------------- 存储层

/**
 * What is in the slot. Four outcomes rather than `SavedRun | null` because the
 * title screen owes the player a different sentence for each: nothing to
 * continue, a run to continue, a save from an older build, and a save that no
 * longer parses. Collapsing the last two into `null` would silently open a new
 * run over a save the player still believed in.
 */
export type SaveSlot =
  | { kind: 'empty' }
  | { kind: 'ok'; saved: SavedRun }
  | { kind: 'stale'; version: number }
  | { kind: 'broken' };

/**
 * `localStorage` is absent under Node (the test suite) and *throws on access*
 * under some privacy settings rather than merely refusing to write — so it is
 * fetched through a guard on every call and never cached. A missing store makes
 * every function here a silent no-op, which is the acceptance criterion:
 * 「localStorage 被禁用时游戏仍能正常玩（只是没存档），不崩」.
 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The last payload actually written, so an unchanged run is not re-serialised.
 *
 * This is the autosave throttle. A time-based one is impossible here (S3), but
 * de-duplicating on content is strictly better than de-duplicating on a clock:
 * entering a room fires `autosave` from the nav layer, the HUD refresh and the
 * room's own `enter`, and all three produce byte-identical payloads.
 */
let lastWritten: string | null = null;

export function writeSave(run: RunState, combat: SavedCombat | null): void {
  const slot = store();
  if (!slot) return;
  const json = JSON.stringify(toSaved(run, combat));
  if (json === lastWritten) return;
  try {
    slot.setItem(SAVE_KEY, json);
    lastWritten = json;
  } catch {
    // Quota exceeded, or a store that reports itself present and refuses to
    // write. Nothing to do and nothing worth interrupting the run over.
  }
}

export function readSlot(): SaveSlot {
  const slot = store();
  if (!slot) return { kind: 'empty' };

  let raw: string | null = null;
  try {
    raw = slot.getItem(SAVE_KEY);
  } catch {
    return { kind: 'empty' };
  }
  if (!raw) return { kind: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'broken' };
  }

  const version = (parsed as { version?: unknown } | null)?.version;
  if (typeof version !== 'number') return { kind: 'broken' };
  if (version !== SAVE_VERSION) return { kind: 'stale', version };

  return { kind: 'ok', saved: parsed as SavedRun };
}

export function clearSave(): void {
  lastWritten = null;
  const slot = store();
  if (!slot) return;
  try {
    slot.removeItem(SAVE_KEY);
  } catch {
    // Same as `writeSave`: nothing to do about a store that will not co-operate.
  }
}

/** Test seam. Production never needs it — the module holds no other state. */
export function resetWriteCache(): void {
  lastWritten = null;
}
