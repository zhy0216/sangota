import {
  aliveEnemies, canPlay, defOf, endPlayerTurn, playCard, resolveChoice, runEnemyTurn,
} from '../src/combat/engine';
import type { CombatState, PendingChoice, StatusId } from '../src/combat/types';
import { Rng } from '../src/core/rng';
import { draftScore } from './draft';
import type { Policy, SimAction } from './policy';

/**
 * Opt-in card diagnosis. The golden policies deliberately keep their old
 * semantics. Search at most four plays ahead, with a six-state beam, and
 * resolve every hit, reaction, choice and enemy turn through the real engine.
 *
 * This is a deterministic, optimistic diagnostic, not a model of a human:
 * branches see the seeded draws they simulate. Long-term status values remain
 * a heuristic; report its results separately from the legacy greedy policy.
 */
const DEPTH = 4;
const WIDTH = 6;

export function cloneCombat(state: CombatState): CombatState {
  const enemies = state.enemies.map((enemy) => ({
    ...enemy, statuses: { ...enemy.statuses }, crossed: [...enemy.crossed],
  }));
  return {
    ...state,
    player: { ...state.player, statuses: { ...state.player.statuses } },
    enemies,
    // Instances and intent definitions are immutable during a fight. The map
    // is copied because effects can mint new instances into it.
    cards: { ...state.cards },
    hand: [...state.hand], drawPile: [...state.drawPile],
    discardPile: [...state.discardPile], exhaustPile: [...state.exhaustPile],
    effectQueue: state.effectQueue.map((step) => ({
      ...step, target: enemies.find((enemy) => enemy.id === step.target?.id),
    })),
    pendingChoice: state.pendingChoice
      ? { ...state.pendingChoice, options: [...state.pendingChoice.options] } : null,
    relics: [...state.relics], relicCounters: { ...state.relicCounters },
    rng: new Rng(state.rng.getState()), events: [...state.events],
  };
}

/** Full mutable rules state, excluding presentation events and RNG roll counts. */
const stamp = (state: CombatState): string => JSON.stringify({
  ...state, events: undefined, rng: state.rng.getState() >>> 0,
});

function shed(state: CombatState, choice: PendingChoice): string[] {
  return [...choice.options].sort((a, b) => {
    const value = (uid: string): number => {
      const def = defOf(state, uid);
      if (def.type === 'curse' || def.type === 'status') return -100;
      return draftScore(def);
    };
    return value(a) - value(b);
  }).slice(0, choice.min);
}

export function resolveTacticalChoices(state: CombatState): void {
  for (let i = 0; state.pendingChoice && i < 64; i++) {
    if (!resolveChoice(state, shed(state, state.pendingChoice))) break;
  }
}

/** A duplicate physical copy makes the same play; don't spend the beam twice. */
function actions(state: CombatState): SimAction[] {
  const seen = new Set<string>();
  const out: SimAction[] = [];
  for (const uid of state.hand) {
    if (!canPlay(state, uid)) continue;
    const def = defOf(state, uid);
    const key = `${def.id}:${state.cards[uid].upgraded}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (def.target === 'enemy') {
      for (const enemy of aliveEnemies(state)) out.push({ uid, targetId: enemy.id });
    } else out.push({ uid });
  }
  return out;
}

const STATUS_VALUE: Partial<Record<StatusId, number>> = {
  strength: 5, dexterity: 4, ritual: 7, metallicize: 4,
  thorns: 3, buffer: 8, artifact: 2, barricade: 5, regen: 2,
  slayer: 2, discipline: 2, armory: 2, supply: 3, warSaint: 5, riposte: 2,
};

/** Score stopping here, including this turn's actual enemy response. */
function value(root: CombatState, state: CombatState, plays: number): number {
  const next = cloneCombat(state);
  if (next.phase === 'player' && !next.pendingChoice) {
    endPlayerTurn(next);
    runEnemyTurn(next);
  }
  if (next.phase === 'lost' || next.pendingChoice) return -100_000;
  if (next.phase === 'won') return 100_000 + next.player.hp * 2 - plays * 0.05;

  // Damage events include overkill in `amount`; cap each body separately.
  // Newly split/summoned bodies have their own actual HP, not the parent's.
  const hp = new Map(root.enemies.map((enemy) => [enemy.id, enemy.hp]));
  let score = 0;
  for (const event of next.events) {
    if (event.t === 'damage' && event.targetId !== 'player') {
      const left = hp.get(event.targetId)
        ?? next.enemies.find((enemy) => enemy.id === event.targetId)?.maxHp ?? 0;
      score += Math.min(left, event.amount) + event.blocked * 0.25;
      hp.set(event.targetId, Math.max(0, left - event.amount));
    }
    if (event.t === 'heal' && event.targetId !== 'player') {
      hp.set(event.targetId, (hp.get(event.targetId) ?? 0) + event.amount);
    }
    if (event.t === 'death' && event.targetId !== 'player') score += 6;
  }
  score += (next.player.hp - root.player.hp) * 1.8;
  for (const [id, weight] of Object.entries(STATUS_VALUE)) {
    const status = id as StatusId;
    score += ((next.player.statuses[status] ?? 0) - (root.player.statuses[status] ?? 0)) * weight;
  }
  if (next.player.statuses.barricade) score += Math.min(30, next.player.block) * 0.4;
  // A gratuitous draw/reshuffle must not beat ending the turn. This also
  // prevents legal zero-cost cycles from becoming an infinite policy loop.
  return score - plays * 0.05;
}

interface PlannedPlay { before: string; action: SimAction }
interface Node { state: CombatState; path: PlannedPlay[]; score: number }

/** Cached paths are checked against the actual state before every use. */
const plans = new WeakMap<CombatState, PlannedPlay[]>();

export const TACTICAL_POLICY: Policy = {
  name: 'tactical',
  chooseAction(state) {
    if (state.phase !== 'player' || state.pendingChoice) return null;
    const key = stamp(state);
    const cached = plans.get(state);
    if (cached?.[0]?.before === key) return cached.shift()!.action;
    plans.delete(state);

    const root = cloneCombat(state);
    root.events = [];
    let best: Node = { state: root, path: [], score: value(root, root, 0) };
    let beam = [best];
    for (let depth = 0; depth < DEPTH; depth++) {
      const candidates: Node[] = [];
      for (const node of beam) {
        if (node.state.phase !== 'player') continue;
        const before = stamp(node.state);
        for (const action of actions(node.state)) {
          const next = cloneCombat(node.state);
          if (!playCard(next, action.uid, action.targetId)) continue;
          resolveTacticalChoices(next);
          const path = [...node.path, { before, action }];
          const child = { state: next, path, score: value(root, next, path.length) };
          if (child.score > best.score) best = child;
          candidates.push(child);
        }
      }
      // Retain preparation lines that have not cashed in their energy yet.
      // This is only a beam priority, never a reward for ending with spare qi.
      const priority = (node: Node): number => node.score + Math.min(4, node.state.energy) * 10;
      candidates.sort((a, b) => priority(b) - priority(a));
      beam = candidates.slice(0, WIDTH);
      if (beam.length === 0 || best.state.phase === 'won') break;
    }
    if (best.path.length === 0) return null;
    const [first, ...rest] = best.path;
    plans.set(state, rest);
    return first.action;
  },
  resolveChoice: shed,
};
