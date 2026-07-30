import {
  aliveEnemies,
  canPlay,
  computeAttack,
  defOf,
  previewValues,
} from '../src/combat/engine';
import type { CardDef, CombatState, EnemyState } from '../src/combat/types';

/**
 * AI drivers for the headless sim. A policy is a pure decision function over a
 * `CombatState` — it never mutates, `runCombat` applies whatever it returns.
 *
 * Every roll goes through `state.rng` rather than an unseeded generator, so a
 * seed replays a whole fight including the policy's own coin flips.
 */

export type PolicyName = 'random' | 'greedy' | 'threat';

export interface SimAction {
  uid: string;
  targetId?: string;
}

/**
 * Forward declaration of the choice prompt from todos/13. The sim drives combat
 * synchronously, so a card that stops to ask "discard 2 cards" would deadlock
 * unless a policy can answer it — the hook has to exist in the interface before
 * 13 lands, not after.
 */
export interface PendingChoice {
  kind: string;
  /** Ids the policy may pick from — card uids today. */
  options: string[];
  min: number;
  max: number;
}

export interface Policy {
  name: string;
  /** The card to play and its target, or null to end the turn. */
  chooseAction(state: CombatState): SimAction | null;
  /** [13] pendingChoice — returns between `choice.min` and `choice.max` ids. */
  resolveChoice?(state: CombatState, choice: PendingChoice): string[];
  /** [02] potions. */
  choosePotion?(
    state: CombatState,
    potions: string[],
  ): { id: string; targetId?: string } | null;
}

/**
 * Damage the telegraphed intents will land next turn, statuses folded in.
 * Superseded by todos/16 once the intent system owns this number.
 */
export function totalIncomingDamage(state: CombatState): number {
  let total = 0;
  for (const enemy of aliveEnemies(state)) {
    const move = enemy.intent;
    if (!move?.damage) continue;
    total += computeAttack(move.damage, enemy, state.player) * (move.hits ?? 1);
  }
  return total;
}

/**
 * Share of remaining HP a telegraphed swing has to threaten before the threat
 * policy stops attacking and blocks. Just under 1 rather than at it: intents
 * under-report, because 破军 lands its Vulnerable in the same turn it hits and
 * a Strength buff resolves before the swing does.
 *
 * Blocking earlier than this measurably loses fights — 吕布 has 150 HP and 铁壁
 * trades 1 气 for 5 mitigation, so turtling loses the race it was meant to win.
 */
const DANGER_RATIO = 0.9;

const playable = (state: CombatState): string[] =>
  state.hand.filter((uid) => canPlay(state, uid));

const needsTarget = (def: CardDef): boolean => def.target === 'enemy';

/** Whatever is closest to dying — one fewer attacker beats spread damage. */
const weakest = (enemies: EnemyState[]): EnemyState =>
  enemies.reduce((a, b) => (b.hp + b.block < a.hp + a.block ? b : a));

const aim = (state: CombatState, uid: string, target: EnemyState): SimAction =>
  needsTarget(defOf(state, uid)) ? { uid, targetId: target.id } : { uid };

/** Highest-damage playable attack against `target`, or null. */
function bestAttack(state: CombatState, options: string[], target: EnemyState): SimAction | null {
  let best: SimAction | null = null;
  let bestD = 0;
  for (const uid of options) {
    const def = defOf(state, uid);
    if (def.type !== 'attack') continue;
    const d = previewValues(state, def, target).D;
    if (d > bestD) {
      bestD = d;
      best = aim(state, uid, target);
    }
  }
  return best;
}

/** Highest-block playable card, or null if nothing in hand grants any. */
function bestGuard(state: CombatState, options: string[], target: EnemyState): SimAction | null {
  let best: SimAction | null = null;
  let bestB = 0;
  for (const uid of options) {
    const b = previewValues(state, defOf(state, uid)).B;
    if (b > bestB) {
      bestB = b;
      best = aim(state, uid, target);
    }
  }
  return best;
}

const random: Policy = {
  name: 'random',
  chooseAction(state) {
    const options = playable(state);
    const alive = aliveEnemies(state);
    if (options.length === 0 || alive.length === 0) return null;
    const uid = state.rng.pick(options);
    return aim(state, uid, state.rng.pick(alive));
  },
};

const greedy: Policy = {
  name: 'greedy',
  chooseAction(state) {
    const options = playable(state);
    const alive = aliveEnemies(state);
    if (options.length === 0 || alive.length === 0) return null;

    const target = weakest(alive);
    const attack = bestAttack(state, options, target);
    if (attack) return attack;

    // No attack affordable — spend the leftover 气 on defence, then on
    // anything at all rather than passing with energy in hand.
    return bestGuard(state, options, target) ?? aim(state, options[0], target);
  },
};

const threat: Policy = {
  name: 'threat',
  chooseAction(state) {
    const options = playable(state);
    const alive = aliveEnemies(state);
    if (options.length === 0 || alive.length === 0) return null;

    // 1. Take a kill the moment one is on the table — a dead enemy telegraphs
    //    nothing, which is worth more than any amount of block.
    for (const uid of options) {
      const def = defOf(state, uid);
      if (def.type !== 'attack') continue;
      for (const enemy of alive) {
        if (previewValues(state, def, enemy).D >= enemy.hp + enemy.block) {
          return aim(state, uid, enemy);
        }
      }
    }

    // 2. Survive the telegraphed swing before thinking about damage.
    const exposure = totalIncomingDamage(state) - state.player.block;
    if (exposure > 0 && exposure >= state.player.hp * DANGER_RATIO) {
      const guard = bestGuard(state, options, weakest(alive));
      if (guard) return guard;
    }

    // 3. Otherwise behave greedily.
    return greedy.chooseAction(state);
  },
};

export const POLICIES: Record<PolicyName, Policy> = { random, greedy, threat };
