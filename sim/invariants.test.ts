import { describe, expect, it } from 'vitest';
import {
  endPlayerTurn,
  playCard,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { CARD_POOL_BY_RARITY, COLORLESS_POOL } from '../src/combat/cards';
import { CURSE_POOL, STATUS_POOL } from '../src/combat/curses';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, startRun, type DeckCard } from '../src/state/run';
import { POLICIES, type Policy, type PolicyName } from './policy';
import { answerChoices, findEncounter, simulateCombat } from './runCombat';

/**
 * Cheap fuzz over the whole rules layer: drive real fights and assert the
 * things that must hold after every single action, not just at the end. This is
 * the "360 fights, zero violations" claim in the README, made standing.
 */

/**
 * Every encounter in both tables. The six originals plus todos/15's rows, which
 * is where 召唤, 分裂, 遁走, 塞牌 and the scripted bosses actually get walked
 * under three policies and twenty seeds each — the mechanics tests in
 * `tests/enemies.test.ts` pin the numbers, this pins that nothing they do can
 * leave the fight in an impossible shape.
 */
const ENCOUNTERS = [
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8',
  'm9', 'm10', 'm11',
  'e1', 'e2', 'e3',
  'b1', 'b2', 'b3',
];
const POLICY_NAMES: PolicyName[] = ['random', 'greedy', 'threat'];
const RUNS_PER_COMBO = 20;

function assertInvariants(state: CombatState, where: string): void {
  // Counted against `state.cards` and not the starting deck: 五百校刀手 and
  // 孟德新书 mint cards mid-fight, and every one of them must still be findable
  // in exactly one pile.
  const known = Object.keys(state.cards).length;
  const piles = [...state.drawPile, ...state.hand, ...state.discardPile, ...state.exhaustPile];
  expect(piles.length, `${where}: cards leaked or duplicated`).toBe(known);
  expect(new Set(piles).size, `${where}: a uid is in two piles at once`).toBe(known);

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

  // Bodies that join mid-fight — 召唤 and 分裂 — must not collide with the ones
  // already there. A duplicate id makes `playCard` target the wrong body and a
  // duplicate slot stacks two sprites on one spot.
  const ids = state.enemies.map((e) => e.id);
  expect(new Set(ids).size, `${where}: two enemies share an id`).toBe(ids.length);
  const slots = state.enemies.map((e) => e.slot);
  expect(new Set(slots).size, `${where}: two enemies share a slot`).toBe(slots.length);

  // 遁走 is not a death: an enemy that left is off the field but was never
  // killed, so nothing downstream may pay a kill reward for it.
  for (const enemy of state.enemies) {
    if (!enemy.escaped) continue;
    expect(enemy.alive, `${where}: ${enemy.id} escaped but still on the field`).toBe(false);
    expect(enemy.hp, `${where}: ${enemy.id} escaped at 0 hp — that is a death`).toBeGreaterThan(0);
  }
}

/**
 * Mirrors `simulateCombat`'s loop, but checks the world after every step. The
 * two drivers must stay in step: a prompt the fuzz cannot answer would park
 * `pendingChoice`, make every later `chooseAction` return null and every
 * `endPlayerTurn` a no-op, and the fight would be reported as "never
 * terminated" instead of as the rules bug it is.
 */
function fuzzFight(encounterId: string, policy: Policy, seed: string, deckOverride?: DeckCard[]): void {
  const deck = deckOverride ?? startRun(DEFAULT_HERO, seed).deck;
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
  assertInvariants(state, `${seed} start`);

  while (state.phase === 'player') {
    expect(steps++, `${seed} never terminated`).toBeLessThan(2000);
    const action = policy.chooseAction(state);
    if (action) {
      expect(playCard(state, action.uid, action.targetId), `${seed} illegal action`).toBe(true);
    } else {
      endPlayerTurn(state);
      runEnemyTurn(state);
    }
    answerChoices(state, policy);
    expect(state.pendingChoice, `${seed} step ${steps}: unanswered prompt`).toBeNull();
    assertInvariants(state, `${seed} step ${steps}`);
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

/**
 * The starter deck is ten cards of two kinds; phase 2 added 21 rewardable
 * cards, six curses and five 状态牌, none of which the fuzz above ever draws.
 * This deck holds one of every one of them, so card minting, 消耗/虚无/保留,
 * unplayable cards and the play-restricting curses all get walked.
 *
 * `COLORLESS_POOL` is in here too. Those five are sold only in 坊市 and so sit
 * outside `CARD_POOL_BY_RARITY` by design, which means nothing else in the sim
 * would ever draw them — and they are the only cards that mint 反刺/中毒/重甲.
 * A card that cannot reach this deck is a card whose combat behaviour is
 * unfuzzed; any future pool that bypasses the rarity table belongs here as well.
 */
const KITCHEN_SINK: DeckCard[] = [
  ...Object.values(CARD_POOL_BY_RARITY).flat(),
  ...COLORLESS_POOL,
  ...CURSE_POOL,
  ...STATUS_POOL,
].map((defId) => newDeckCard(defId));

describe('combat invariants with every card in the deck', () => {
  for (const encounterId of ENCOUNTERS) {
    it(encounterId, () => {
      for (const name of POLICY_NAMES) {
        for (let i = 0; i < 5; i++) {
          const seed = `sink-${encounterId}-${name}-${i}`;
          // Fresh uids per fight: `startCombat` copies the instances, but two
          // fights sharing one array would still share upgrade state.
          fuzzFight(encounterId, POLICIES[name], seed, KITCHEN_SINK.map((c) => ({ ...c })));
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

  /**
   * `usePotion` only looks an id up in the table — it never asks the belt. A
   * policy naming a bottle the run does not carry used to drink it for real,
   * and `belt.indexOf(-1)` then spliced out whichever potion was last, so the
   * fight got free effects and the carried potions vanished unused. The first
   * balance table run with potions would have reported wrong numbers.
   */
  it('refuses a potion the run is not carrying, and keeps the belt intact', () => {
    // 壮行酒 targets nobody, so `usePotion` would happily pour one the run
    // never had — the belt check is the only thing standing between them.
    const phantom: Policy = {
      ...POLICIES.greedy,
      name: 'phantom-potion',
      choosePotion: () => ({ id: 'zhuangxingjiu' }),
    };
    const result = simulateCombat({
      ...base,
      policy: phantom,
      potions: ['tiejiasan', 'junqingmibao'],
    });

    expect(result.aborted).toBeNull();
    expect(result.events.filter((e) => e.t === 'potion')).toEqual([]);
  });

  it('drinks and discards exactly the bottle the policy named', () => {
    let poured = false;
    const once: Policy = {
      ...POLICIES.greedy,
      name: 'one-pour',
      choosePotion: (_state, belt) => {
        if (poured || !belt.includes('junqingmibao')) return null;
        poured = true;
        return { id: 'junqingmibao' };
      },
    };
    const result = simulateCombat({
      ...base,
      policy: once,
      potions: ['tiejiasan', 'junqingmibao'],
    });

    expect(result.aborted).toBeNull();
    expect(result.events.filter((e) => e.t === 'potion')).toEqual([
      { t: 'potion', potionId: 'junqingmibao' },
    ]);
  });
});
