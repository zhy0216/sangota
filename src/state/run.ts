import { generateMap } from '../map/generateMap';
import type { GameMap } from '../map/types';
import { DEFAULT_HERO, type HeroDef } from '../data/heroes';

export interface RunState {
  hero: HeroDef;
  hp: number;
  maxHp: number;
  gold: number;
  act: number;
  map: GameMap;
  /** Card ids, one entry per physical copy. */
  deck: string[];
  /** null until the player commits to a starting node on floor 1. */
  currentNodeId: string | null;
  /** Node ids in visit order — used to paint the travelled path. */
  path: string[];
}

let active: RunState | null = null;

export function startRun(hero: HeroDef = DEFAULT_HERO, seed?: string): RunState {
  active = {
    hero,
    hp: hero.maxHp,
    maxHp: hero.maxHp,
    gold: hero.startingGold,
    act: 1,
    map: generateMap(seed),
    deck: [...hero.startingDeck],
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

export function addCard(run: RunState, cardId: string): void {
  run.deck.push(cardId);
}

/** Carry the surviving HP total back out of a fight. */
export function applyCombatResult(run: RunState, hpAfter: number): void {
  run.hp = Math.max(0, hpAfter);
}

export const isRunOver = (run: RunState): boolean => run.hp <= 0;
