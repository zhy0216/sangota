import { describe, expect, it } from 'vitest';
import {
  endPlayerTurn,
  playCard,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { startRun } from '../src/state/run';
import { POLICIES, type Policy, type PolicyName } from './policy';
import { findEncounter, simulateCombat } from './runCombat';

/**
 * Cheap fuzz over the whole rules layer: drive real fights and assert the
 * things that must hold after every single action, not just at the end. This is
 * the "360 fights, zero violations" claim in the README, made standing.
 */

const ENCOUNTERS = ['m1', 'm2', 'm3', 'm4', 'e1', 'b1'];
const POLICY_NAMES: PolicyName[] = ['random', 'greedy', 'threat'];
const RUNS_PER_COMBO = 20;

function assertInvariants(state: CombatState, deckSize: number, where: string): void {
  const piles = [...state.drawPile, ...state.hand, ...state.discardPile, ...state.exhaustPile];
  expect(piles.length, `${where}: cards leaked or duplicated`).toBe(deckSize);
  expect(new Set(piles).size, `${where}: a uid is in two piles at once`).toBe(deckSize);

  expect(state.energy, where).toBeGreaterThanOrEqual(0);
  expect(state.hand.length, where).toBeLessThanOrEqual(10);

  for (const c of [state.player, ...state.enemies]) {
    expect(c.block, `${where}: ${c.id} block`).toBeGreaterThanOrEqual(0);
    expect(c.hp, `${where}: ${c.id} hp`).toBeGreaterThanOrEqual(0);
    expect(c.hp, `${where}: ${c.id} hp`).toBeLessThanOrEqual(c.maxHp);
  }
  for (const enemy of state.enemies) {
    if (enemy.alive) expect(enemy.hp, `${where}: ${enemy.id} alive at 0 hp`).toBeGreaterThan(0);
    else expect(enemy.intent, `${where}: ${enemy.id} dead but telegraphing`).toBeNull();
  }
}

/** Mirrors `simulateCombat`'s loop, but checks the world after every step. */
function fuzzFight(encounterId: string, policy: Policy, seed: string): void {
  const deck = startRun(DEFAULT_HERO, seed).deck;
  const state = startCombat({
    encounter: findEncounter(encounterId),
    deck,
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed,
  });

  let steps = 0;
  assertInvariants(state, deck.length, `${seed} start`);

  while (state.phase === 'player') {
    expect(steps++, `${seed} never terminated`).toBeLessThan(2000);
    const action = policy.chooseAction(state);
    if (action) {
      expect(playCard(state, action.uid, action.targetId), `${seed} illegal action`).toBe(true);
    } else {
      endPlayerTurn(state);
      runEnemyTurn(state);
    }
    assertInvariants(state, deck.length, `${seed} step ${steps}`);
  }

  expect(['won', 'lost']).toContain(state.phase);
}

describe(`combat invariants across ${ENCOUNTERS.length * POLICY_NAMES.length * RUNS_PER_COMBO} fights`, () => {
  for (const encounterId of ENCOUNTERS) {
    it(encounterId, () => {
      for (const name of POLICY_NAMES) {
        for (let i = 0; i < RUNS_PER_COMBO; i++) {
          fuzzFight(encounterId, POLICIES[name], `fuzz-${encounterId}-${name}-${i}`);
        }
      }
    });
  }
});

describe('protective bail-outs', () => {
  const base = {
    encounterId: 'b1',
    deck: startRun(DEFAULT_HERO, 'guard').deck,
    hero: DEFAULT_HERO,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    seed: 'guard',
  };

  it('reports noProgress instead of hanging on a policy that never advances', () => {
    // A policy insisting on a card that is not in hand: `playCard` refuses, the
    // state cannot move, and without the detector this loops forever.
    const stuck: Policy = { name: 'stuck', chooseAction: () => ({ uid: 'not-a-card' }) };
    const result = simulateCombat({ ...base, policy: stuck });

    expect(result.aborted).toBe('noProgress');
    expect(result.turns).toBe(1);
  });

  it('reports turnLimit when a fight outlasts maxTurns', () => {
    const result = simulateCombat({ ...base, policy: POLICIES.threat, maxTurns: 2 });
    expect(result.aborted).toBe('turnLimit');
  });

  it('finishes normal fights without tripping either guard', () => {
    for (const name of POLICY_NAMES) {
      const result = simulateCombat({ ...base, policy: POLICIES[name] });
      expect(result.aborted, name).toBeNull();
    }
  });
});
