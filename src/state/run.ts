import { canUpgrade, getCard, isNegative } from '../combat/cards';
import { POTION_DROP, getPotion } from '../combat/potions';
import { RELICS, relicModifiers } from '../combat/relics';
import { BASE_CARD_REWARD_COUNT } from '../combat/rewards';
import { generateMap } from '../map/generateMap';
import type { GameMap } from '../map/types';
import type { RoomRecord } from '../rooms/types';
import { DEFAULT_HERO, type HeroDef } from '../data/heroes';

/** One physical card in the deck. Upgrades ride on the copy, not on the id. */
export interface DeckCard {
  /** Stable instance id — lets "upgrade the 3rd 劈砍" and UI selection work. */
  uid: string;
  defId: string;
  upgraded: number;
}

export interface RunState {
  hero: HeroDef;
  hp: number;
  maxHp: number;
  gold: number;
  act: number;
  map: GameMap;
  /** One entry per physical copy. */
  deck: DeckCard[];
  /** Relic ids in pickup order — the HUD bar and the hooks both read this order. */
  relics: string[];
  /** Relic counters that outlive a single fight, keyed by relic id. */
  relicCounters: Record<string, number>;
  /** Always exactly `potionSlots` long; an empty slot is null. */
  potions: (string | null)[];
  /** 3 plus whatever 药囊-style relics add. Kept in step by `syncPotionSlots`. */
  potionSlots: number;
  /** Drop chance for the next monster fight, in percent. Drifts, see POTION_DROP. */
  potionChance: number;
  /** Rewards since the last rare, added to the rare weight. See `rollCardReward`. */
  rareBump: number;
  /** Cards a reward offers. Relic-modified; kept in step by `syncRewardCount`. */
  cardRewardCount: number;
  /** null until the player commits to a starting node on floor 1. */
  currentNodeId: string | null;
  /** Node ids in visit order — used to paint the travelled path. */
  path: string[];

  // ------------------------------------------------------------ 房间层
  // Added whole rather than in instalments: every one of these is read by more
  // than one room, and a field that lands later would need a save migration.

  /**
   * Per-node room ledger plus that node's materialised randomness. Keyed by
   * `MapNode.id`. `committed` inside a record is the single source of truth for
   * "has this already been done" — see `src/rooms/commit.ts`.
   */
  rooms: Record<string, RoomRecord>;
  /**
   * Event ids resolved this run. Drives both `once` events and same-run
   * de-duplication — 3.14 event rooms against a 12-event pool means repeats are
   * the norm, not the exception, without this.
   */
  seenEvents: string[];
  /** Card-removal price escalation. Run-long: it survives leaving the shop. */
  cardRemovalSurcharge: number;
  /** Fights finished in the current act — picks the weak vs strong table. */
  actCombatCount: number;
  /** Encounter ids spent this act; cleared on an act change. */
  usedEncounters: string[];
  /** The three boss relics on offer, frozen the moment the chest is opened. */
  bossRelicOffer: string[] | null;
  /** Locked doors this run has the key to. */
  keys: { sapphire: boolean };
}

let active: RunState | null = null;
/** Monotonic, not random: a seed alone must reproduce the whole run. */
let nextUid = 0;

/** Slots before any relic touches them. */
export const BASE_POTION_SLOTS = 3;

export function newDeckCard(defId: string, upgraded = 0): DeckCard {
  return { uid: `d${nextUid++}`, defId, upgraded };
}

export function startRun(hero: HeroDef = DEFAULT_HERO, seed?: string): RunState {
  nextUid = 0;
  const relics = [hero.starterRelic];
  const maxHp = hero.maxHp + relicModifiers(relics).maxHp;
  active = {
    hero,
    hp: maxHp,
    maxHp,
    gold: hero.startingGold,
    act: 1,
    map: generateMap(seed),
    deck: hero.startingDeck.map((defId) => newDeckCard(defId)),
    relics,
    relicCounters: {},
    potions: [],
    potionSlots: 0,
    potionChance: POTION_DROP.start,
    rareBump: 0,
    cardRewardCount: 0,
    currentNodeId: null,
    path: [],
    // Constants, every one of them: `startRun` must never draw from an Rng.
    // `sim/golden.test.ts` builds its decks through here, and one extra roll
    // would invalidate all 26 golden snapshots.
    rooms: {},
    seenEvents: [],
    cardRemovalSurcharge: 0,
    actCombatCount: 0,
    usedEncounters: [],
    bossRelicOffer: null,
    keys: { sapphire: false },
  };
  syncPotionSlots(active);
  syncRewardCount(active);
  return active;
}

/**
 * Re-derives the reward width from the relics owned right now. Clamped at 1: a
 * relic that subtracts more than the pool offers must still leave something to
 * pick, and 「不取」 is already the way to decline.
 */
export function syncRewardCount(run: RunState): void {
  const mods = relicModifiers(run.relics);
  run.cardRewardCount = Math.max(1, BASE_CARD_REWARD_COUNT + mods.cardRewardCount);
}

/**
 * Re-derives the belt from the relics owned right now. `potions` is grown and
 * trimmed rather than rebuilt, so picking up 药囊 mid-run never disturbs what is
 * already in the first three slots. Shrinking is a no-op today — nothing takes
 * slots away — and deliberately drops from the tail if one ever does.
 */
export function syncPotionSlots(run: RunState): void {
  run.potionSlots = BASE_POTION_SLOTS + relicModifiers(run.relics).potionSlots;
  while (run.potions.length < run.potionSlots) run.potions.push(null);
  run.potions.length = run.potionSlots;
}

export function getRun(): RunState {
  if (!active) return startRun();
  return active;
}

/** Display floor number (1-based). 0 means "not yet entered the map". */
export function currentFloor(run: RunState): number {
  if (!run.currentNodeId) return 0;
  return run.map.nodes.get(run.currentNodeId)!.row + 1;
}

/** Node ids the player may click right now. */
export function availableNodes(run: RunState): string[] {
  if (!run.currentNodeId) return [...run.map.byRow[0]];
  return [...run.map.nodes.get(run.currentNodeId)!.children];
}

export function travelTo(run: RunState, nodeId: string): void {
  const node = run.map.nodes.get(nodeId);
  if (!node) return;
  node.visited = true;
  run.currentNodeId = nodeId;
  run.path.push(nodeId);
}

// ------------------------------------------------------------- run mutations

export function heal(run: RunState, amount: number): number {
  const before = run.hp;
  run.hp = Math.min(run.maxHp, run.hp + amount);
  return run.hp - before;
}

/** Gains are scaled by the relic multiplier; spending is charged at face value. */
export function addGold(run: RunState, amount: number): void {
  const gained =
    amount > 0 ? Math.floor(amount * relicModifiers(run.relics).goldMultiplier) : amount;
  run.gold = Math.max(0, run.gold + gained);
}

export const hasRelic = (run: RunState, id: string): boolean => run.relics.includes(id);

/** Rejects unknown ids and duplicates — a relic is owned once or not at all. */
export function addRelic(run: RunState, id: string): boolean {
  const def = RELICS[id];
  if (!def || hasRelic(run, id)) return false;
  run.relics.push(id);
  // A max-HP relic heals for what it grants, so picking one up is never a loss.
  const gain = def.modifiers?.maxHp ?? 0;
  run.maxHp += gain;
  run.hp += gain;
  // 药囊 widens the belt the moment it is picked up, not at the next fight,
  // and 求贤令 / 独断 widen or narrow the next reward the same way.
  syncPotionSlots(run);
  syncRewardCount(run);
  return true;
}

// ------------------------------------------------------------------- potions

export const hasPotionSpace = (run: RunState): boolean => run.potions.includes(null);

/** Into the first free slot. False means the belt is full — ask the player. */
export function addPotion(run: RunState, id: string): boolean {
  getPotion(id);
  const slot = run.potions.indexOf(null);
  if (slot < 0) return false;
  run.potions[slot] = id;
  return true;
}

/** Empties a slot and hands back what was in it, so a swap is two calls. */
export function removePotion(run: RunState, slot: number): string | null {
  const id = run.potions[slot] ?? null;
  if (id !== null) run.potions[slot] = null;
  return id;
}

/**
 * The map's half of `usePotion`. Only `heal` is honoured out here, which is
 * exactly the set `usableOutOfCombat` marks — anything else has no combat to
 * resolve against, so the potion is refused rather than silently wasted.
 */
export function usePotionOutOfCombat(run: RunState, slot: number): boolean {
  const id = run.potions[slot];
  if (!id) return false;
  const def = getPotion(id);
  if (!def.usableOutOfCombat) return false;

  for (const effect of def.effects) {
    if (effect.kind === 'heal') heal(run, effect.amount);
  }
  run.potions[slot] = null;
  return true;
}

/**
 * The reward channel. A 状态牌 exists for one fight and is minted into
 * `state.cards`; letting one into the deck would make it permanent, which is
 * the single thing that separates it from a curse. A 诅咒 is permanent by
 * definition but is never *won* — it is inflicted, and that has its own door.
 *
 * Loud rather than silent, and a runtime check rather than a rarity convention:
 * `CARD_POOL_BY_RARITY` only types its keys, so a curse pushed into one of its
 * arrays would otherwise typecheck all the way into the player's deck.
 */
export function addCard(run: RunState, cardId: string, upgraded = 0): DeckCard {
  const def = getCard(cardId);
  if (isNegative(def)) {
    throw new Error(`${def.type} cards are never a reward: ${cardId} — use addCurse`);
  }
  return pushCard(run, cardId, upgraded);
}

/** Events, relics and enemies inflict these; they ride in the deck for good. */
export function addCurse(run: RunState, defId: string): DeckCard {
  if (getCard(defId).type !== 'curse') throw new Error(`Not a curse: ${defId}`);
  return pushCard(run, defId, 0);
}

function pushCard(run: RunState, cardId: string, upgraded: number): DeckCard {
  const card = newDeckCard(cardId, upgraded);
  run.deck.push(card);
  return card;
}

/**
 * No door may thin a deck below this. Nothing in the engine breaks at four
 * cards, but a deck that cannot fill an opening hand is a run the player cannot
 * recover, and nothing should be able to sell that.
 *
 * It lives here rather than in `shop.ts` because the shop is not the only door:
 * `EventOutcome.removeCards` reaches `removeCard` through `resolvePending`, and
 * that path had no floor at all — an event asking for three cards from a
 * three-card deck emptied it.
 */
export const MIN_DECK_SIZE = 4;

/** How many copies may still be shed before the floor is reached. */
export const removableCount = (run: RunState): number =>
  Math.max(0, run.deck.length - MIN_DECK_SIZE);

/**
 * The one removal primitive, by uid so the right physical copy goes. 商店弃卡,
 * 营帐弃甲 and 五丈原 all end up here — a curse the player cannot shed is just
 * punishment, so this must exist before any curse is handed out.
 *
 * Deliberately *not* floored itself: a caller that means "shed this exact copy"
 * — undoing a grant, a future 弃甲 — must still be able to. The floor belongs
 * to the doors the player walks through, and both of them apply it.
 */
export function removeCard(run: RunState, uid: string): boolean {
  const at = run.deck.findIndex((c) => c.uid === uid);
  if (at < 0) return false;
  run.deck.splice(at, 1);
  return true;
}

/** Cards the blacksmith may offer — already-upgraded copies are excluded. */
export function upgradableCards(run: RunState): DeckCard[] {
  return run.deck.filter((c) => canUpgrade(c.defId, c.upgraded));
}

export function upgradeCard(run: RunState, uid: string): boolean {
  const card = run.deck.find((c) => c.uid === uid);
  if (!card || !canUpgrade(card.defId, card.upgraded)) return false;
  card.upgraded += 1;
  return true;
}

/** Carry the surviving HP total back out of a fight. */
export function applyCombatResult(run: RunState, hpAfter: number): void {
  run.hp = Math.max(0, hpAfter);
}

export const isRunOver = (run: RunState): boolean => run.hp <= 0;
