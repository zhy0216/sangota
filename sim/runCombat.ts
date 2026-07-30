import { ENCOUNTERS } from '../src/combat/enemies';
import {
  endPlayerTurn,
  playCard,
  resolveChoice,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import type { CombatEvent, CombatState, Encounter } from '../src/combat/types';
import type { HeroDef } from '../src/data/heroes';
import type { DeckCard } from '../src/state/run';
import type { Policy } from './policy';

/**
 * Headless combat driver. Runs the same `engine.ts` entry points the scene
 * calls, minus the animation, so a fight that takes 90 seconds to hand-play
 * costs microseconds here.
 */

export const DEFAULT_MAX_TURNS = 60;
/** Consecutive iterations with an unchanged state hash before we call it hung. */
const NO_PROGRESS_LIMIT = 16;

export interface SimOptions {
  encounterId: string;
  deck: DeckCard[];
  hero: HeroDef;
  hp: number;
  maxHp: number;
  seed: string;
  policy: Policy;
  /** Defaults to the hero's starter relic, i.e. what a real run always carries. */
  relics?: string[];
  /** [19] ascension — not read by the engine yet. */
  ascension?: number;
  maxTurns?: number;
}

export interface SimResult {
  won: boolean;
  turns: number;
  hpLeft: number;
  hpMax: number;
  /** The complete event stream, which is what the golden snapshots freeze. */
  events: CombatEvent[];
  /** Non-null means a protective bail-out fired, i.e. there is a bug. */
  aborted: 'turnLimit' | 'noProgress' | null;
}

export function findEncounter(id: string): Encounter {
  for (const table of Object.values(ENCOUNTERS)) {
    const found = table.find((e) => e.id === id);
    if (found) return found;
  }
  throw new Error(`Unknown encounter id: ${id}`);
}

export function simulateCombat(opts: SimOptions): SimResult {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const state = startCombat({
    encounter: findEncounter(opts.encounterId),
    deck: opts.deck,
    heroName: opts.hero.name,
    hp: opts.hp,
    maxHp: opts.maxHp,
    relics: opts.relics ?? [opts.hero.starterRelic],
    seed: opts.seed,
  });

  let aborted: SimResult['aborted'] = null;
  let lastHash = '';
  let stuck = 0;

  while (state.phase === 'player') {
    if (state.turn > maxTurns) {
      aborted = 'turnLimit';
      break;
    }

    const action = opts.policy.chooseAction(state);
    if (action) {
      // A rejected action is a policy bug. Deliberately not papered over by
      // ending the turn — let the no-progress detector surface it instead.
      playCard(state, action.uid, action.targetId);
      answerChoices(state, opts.policy);
    } else {
      endPlayerTurn(state);
      runEnemyTurn(state);
    }

    const hash = hashState(state);
    stuck = hash === lastHash ? stuck + 1 : 0;
    lastHash = hash;
    if (stuck >= NO_PROGRESS_LIMIT) {
      aborted = 'noProgress';
      break;
    }
  }

  return {
    won: state.phase === 'won',
    turns: state.turn,
    hpLeft: state.player.hp,
    hpMax: state.player.maxHp,
    events: state.events,
    aborted,
  };
}

/**
 * A card that stops to ask "which two cards do you discard?" freezes the
 * engine. The sim has no player, so the policy answers — and if it answers
 * badly, the first `min` options are taken rather than letting the fight hang.
 * One card can queue several prompts, hence the loop.
 */
function answerChoices(state: CombatState, policy: Policy): void {
  while (state.pendingChoice) {
    const choice = state.pendingChoice;
    const fallback = choice.options.slice(0, choice.min);
    const answer = policy.resolveChoice?.(state, choice) ?? fallback;
    if (!resolveChoice(state, answer)) resolveChoice(state, fallback);
  }
}

/**
 * Everything a legal action must move. `events.length` is the tightest term —
 * any real rules effect appends at least one event, so a repeat hash means the
 * loop truly did nothing.
 */
function hashState(state: CombatState): string {
  const bodies = [state.player, ...state.enemies]
    .map((c) => `${c.id}:${c.hp}/${c.block}/${JSON.stringify(c.statuses)}`)
    .join('|');
  return [
    state.turn,
    state.phase,
    state.energy,
    state.events.length,
    state.hand.join(','),
    state.drawPile.length,
    state.discardPile.length,
    state.exhaustPile.length,
    bodies,
  ].join(';');
}
