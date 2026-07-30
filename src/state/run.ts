import { canUpgrade, getCard } from '../combat/cards';
import { POTION_DROP, getPotion } from '../combat/potions';
import { RELICS, relicModifiers } from '../combat/relics';
import { generateMap } from '../map/generateMap';
import type { GameMap } from '../map/types';
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
  /** null until the player commits to a starting node on floor 1. */
  currentNodeId: string | null;
  /** Node ids in visit order — used to paint the travelled path. */
  path: string[];
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
    currentNodeId: null,
    path: [],
  };
  syncPotionSlots(active);
  return active;
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
  // 药囊 widens the belt the moment it is picked up, not at the next fight.
  syncPotionSlots(run);
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

export function addCard(run: RunState, cardId: string, upgraded = 0): DeckCard {
  // A 状态牌 exists for one fight and is minted into `state.cards`; letting one
  // into the deck would make it permanent, which is the single thing that
  // separates it from a curse. Loud rather than silent — a caller that wants a
  // permanent downside means `addCurse`.
  if (getCard(cardId).type === 'status') {
    throw new Error(`Status cards never enter the deck: ${cardId}`);
  }
  const card = newDeckCard(cardId, upgraded);
  run.deck.push(card);
  return card;
}

/** Events, relics and enemies inflict these; they ride in the deck for good. */
export function addCurse(run: RunState, defId: string): DeckCard {
  if (getCard(defId).type !== 'curse') throw new Error(`Not a curse: ${defId}`);
  return addCard(run, defId);
}

/**
 * The one removal primitive, by uid so the right physical copy goes. 商店弃卡,
 * 营帐弃甲 and 五丈原 all end up here — a curse the player cannot shed is just
 * punishment, so this must exist before any curse is handed out.
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
