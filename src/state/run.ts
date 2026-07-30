import { canUpgrade } from '../combat/cards';
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
  /** null until the player commits to a starting node on floor 1. */
  currentNodeId: string | null;
  /** Node ids in visit order — used to paint the travelled path. */
  path: string[];
}

let active: RunState | null = null;
/** Monotonic, not random: a seed alone must reproduce the whole run. */
let nextUid = 0;

export function newDeckCard(defId: string, upgraded = 0): DeckCard {
  return { uid: `d${nextUid++}`, defId, upgraded };
}

export function startRun(hero: HeroDef = DEFAULT_HERO, seed?: string): RunState {
  nextUid = 0;
  active = {
    hero,
    hp: hero.maxHp,
    maxHp: hero.maxHp,
    gold: hero.startingGold,
    act: 1,
    map: generateMap(seed),
    deck: hero.startingDeck.map((defId) => newDeckCard(defId)),
    currentNodeId: null,
    path: [],
  };
  return active;
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

export function addGold(run: RunState, amount: number): void {
  run.gold = Math.max(0, run.gold + amount);
}

export function addCard(run: RunState, cardId: string, upgraded = 0): DeckCard {
  const card = newDeckCard(cardId, upgraded);
  run.deck.push(card);
  return card;
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
