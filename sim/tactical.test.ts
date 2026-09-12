import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/combat/cards';
import { getEncounter } from '../src/combat/enemies';
import { playCard, startCombat } from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { Rng } from '../src/core/rng';
import { HEROES } from '../src/data/heroes';
import { newDeckCard } from '../src/state/run';
import { POLICIES } from './policy';
import { simulateCombat } from './runCombat';
import { cloneCombat, resolveTacticalChoices, TACTICAL_POLICY } from './tactical';

function bench(ids: string[], heroId = 'zhaoyun', encounter = 'm1'): CombatState {
  const hero = HEROES[heroId];
  const state = startCombat({
    encounter: getEncounter(encounter), deck: ids.map((id) => newDeckCard(id)),
    heroName: hero.name, hp: hero.maxHp, maxHp: hero.maxHp,
    relics: [hero.starterRelic], seed: 'tactical-contract',
  });
  state.hand = Object.keys(state.cards);
  state.drawPile = [];
  for (const enemy of state.enemies) {
    enemy.hp = enemy.maxHp = 200;
    enemy.statuses = {};
    enemy.intent = { id: 'hit', label: 'hit', damage: 10 };
  }
  return state;
}

function playTurn(state: CombatState): string[] {
  const played: string[] = [];
  for (let i = 0; i < 25; i++) {
    const action = TACTICAL_POLICY.chooseAction(state);
    if (!action) return played;
    played.push(state.cards[action.uid].defId);
    expect(playCard(state, action.uid, action.targetId)).toBe(true);
    resolveTacticalChoices(state);
  }
  throw new Error('diagnostic policy failed to end a finite turn');
}

describe('tactical card diagnosis', () => {
  it('counts actual multi-hit damage without changing the golden greedy policy', () => {
    const state = bench(['lizhanwujiang', 'tuzhen']);
    state.attacksThisTurn = 1;
    const legacy = POLICIES.greedy.chooseAction(state)!;
    const tactical = TACTICAL_POLICY.chooseAction(state)!;
    expect(state.cards[legacy.uid].defId).toBe('tuzhen');
    expect(state.cards[tactical.uid].defId).toBe('lizhanwujiang');
    playCard(state, tactical.uid, tactical.targetId);
    expect(state.enemies[0].hp).toBe(155); // (5 + starter's 4) × 5
  });

  it('sets up armour before attacks that require it', () => {
    const state = bench(['qiangchurulong', 'chengxi', 'kongyingji']);
    const played = playTurn(state);
    expect(played[0]).toBe('kongyingji');
    expect(played).toContain('qiangchurulong');
    expect(state.enemies[0].hp).toBeLessThanOrEqual(173);
    expect(state.player.block).toBe(11);
  });

  it.each([2, 3])('builds three attacks and refunds qi for a %i-qi finisher', (cost) => {
    // Keep both the original audit counterexample and the retuned cost: a
    // cheaper cold hit must not crowd its stronger prepared line out of search.
    const original = CARDS.qiangtiaogaolan;
    try {
      CARDS.qiangtiaogaolan = { ...original, cost };
      const state = bench(['qiangtiaogaolan', 'tuzhen', 'longdan', 'jici']);
      const played = playTurn(state);
      expect(played.at(-1)).toBe('qiangtiaogaolan');
      expect(played).toHaveLength(4);
      expect(state.enemies[0].hp).toBeLessThanOrEqual(154);
    } finally {
      CARDS.qiangtiaogaolan = original;
    }
  });

  it('values attacks across the whole room, including overkill', () => {
    const state = bench(['wenjiu', 'shuiyanqijun'], 'guanyu', 'm2');
    state.enemies[0].hp = 1;
    state.enemies[1].hp = 18;
    const action = TACTICAL_POLICY.chooseAction(state)!;
    expect(state.cards[action.uid].defId).toBe('shuiyanqijun');
    playCard(state, action.uid, action.targetId);
    expect(state.phase).toBe('won');
  });

  it('respects lethal reflections rather than trusting printed D × T', () => {
    const state = bench(['sanjinsanchu', 'kongyingji']);
    state.player.hp = 5;
    state.enemies[0].statuses.thorns = 3;
    const played = playTurn(state);
    expect(played[0]).toBe('kongyingji');
    expect(state.player.hp).toBe(5);
  });

  it('does not mutate a real state or consume its RNG while searching', () => {
    const state = bench(['huimazhan', 'pikan', 'guanzhen', 'tiebi'], 'guanyu');
    const before = JSON.stringify(state);
    const copy = cloneCombat(state);
    expect(copy.rng.next()).toBe(new Rng(state.rng.getState()).next());
    TACTICAL_POLICY.chooseAction(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('invalidates a cached sequence after an external state change', () => {
    const state = bench(['kongyingji', 'tuzhen', 'longdan']);
    const first = TACTICAL_POLICY.chooseAction(state)!;
    playCard(state, first.uid, first.targetId);
    state.player.statuses.entangled = 1;
    const next = TACTICAL_POLICY.chooseAction(state);
    expect(next === null || state.cards[next.uid].defId === 'kongyingji').toBe(true);
  });

  it('ends unproductive zero-cost draw / X-cost cycles', () => {
    const state = bench(['guanzhen', 'guanzhen', 'hulaoguan'], 'guanyu');
    state.energy = 0;
    expect(TACTICAL_POLICY.chooseAction(state)).toBeNull();
  });

  it('replays identically, including opt-in observations', () => {
    const opts = {
      encounterId: 'b3', deck: ['longdan', 'jici', 'tuzhen', 'kongyingji', 'qitanpanshe']
        .map((id) => newDeckCard(id)),
      hero: HEROES.zhaoyun, hp: 74, maxHp: 74, seed: 'tactical-split', policy: TACTICAL_POLICY,
    };
    let decisions = 0;
    let plays = 0;
    const observed = simulateCombat({
      ...opts, onDecision: () => { decisions++; }, onPlayed: () => { plays++; },
    });
    expect(observed).toEqual(simulateCombat(opts));
    expect(observed.aborted).toBeNull();
    expect(decisions).toBeGreaterThanOrEqual(plays);
    expect(plays).toBeGreaterThan(0);
  });
});
