import { ENCOUNTERS } from '../src/combat/enemies';
import {
  endPlayerTurn,
  playCard,
  resolveChoice,
  runEnemyTurn,
  startCombat,
  usePotion,
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
  /**
   * [02] 丹药 carried into the fight. Empty by default, which is what keeps the
   * golden snapshots and the balance tables measuring the deck alone — a belt
   * is a run resource, so a tier's win rate with one is a different question.
   */
  potions?: string[];
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
  const belt = [...(opts.potions ?? [])];

  while (state.phase === 'player') {
    if (state.turn > maxTurns) {
      aborted = 'turnLimit';
      break;
    }

    // Before the card, because a potion is free: 壮行酒 that arrives after the
    // turn's last affordable play is 气 the policy never gets to spend.
    //
    // `belt.includes` first: `usePotion` only looks the id up in the table, so
    // a policy naming a bottle the run does not carry would drink it for real
    // and then `indexOf(-1)` would splice out whichever potion happened to be
    // last. A policy asking for what it does not hold is a policy bug, and the
    // no-progress detector below is what should report it.
    const pour = belt.length > 0 ? opts.policy.choosePotion?.(state, belt) : null;
    if (pour && belt.includes(pour.id) && usePotion(state, pour.id, pour.targetId)) {
      belt.splice(belt.indexOf(pour.id), 1);
      answerChoices(state, opts.policy);
    } else {
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
    }

    // Every path falls through to here: a `continue` past the detector is how a
    // hung potion loop would go unreported.
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
 *
 * Bounded, because the fallback is not guaranteed to be accepted: today
 * `chooseFromHand` is the only producer and it always offers at least `min`
 * options, but a future prompt whose options are narrower than its minimum
 * would spin here forever. Giving up leaves `pendingChoice` set, which the
 * no-progress detector then reports as a hang rather than hanging CI.
 */
const MAX_CHOICES_PER_ACTION = 64;

export function answerChoices(state: CombatState, policy: Policy): void {
  for (let i = 0; state.pendingChoice && i < MAX_CHOICES_PER_ACTION; i++) {
    const choice = state.pendingChoice;
    const fallback = choice.options.slice(0, choice.min);
    const answer = policy.resolveChoice?.(state, choice) ?? fallback;
    if (!resolveChoice(state, answer) && !resolveChoice(state, fallback)) return;
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
