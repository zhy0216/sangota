import { describe, expect, it } from 'vitest';
import { ACT1, getEncounter, getEnemy } from '../src/combat/enemies';
import {
  BASE_ENERGY,
  HAND_SIZE,
  MAX_HAND,
  applyDamage,
  computeAttack,
  drawCards,
  endPlayerTurn,
  pickIntent,
  playCard,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import { RELICS } from '../src/combat/relics';
import type { CombatState, Combatant, Encounter, StatusId } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, type DeckCard } from '../src/state/run';

const body = (statuses: Partial<Record<StatusId, number>> = {}): Combatant => ({
  id: 'x',
  name: 'x',
  hp: 100,
  maxHp: 100,
  block: 0,
  statuses,
});

function bench(
  deck: DeckCard[],
  encounter: Encounter = getEncounter('m1'),
  seed = 'engine-bench',
): CombatState {
  return startCombat({
    encounter,
    deck,
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed,
  });
}

const cards = (defId: string, n: number): DeckCard[] =>
  Array.from({ length: n }, () => newDeckCard(defId));

describe('computeAttack', () => {
  it('composes strength, weak and vulnerable in that order', () => {
    const attacker = body({ strength: 2 });
    const defender = body();

    // 6 + 2 strength
    expect(computeAttack(6, attacker, defender)).toBe(8);
    // ... × 0.75 weak, floored
    attacker.statuses.weak = 1;
    expect(computeAttack(6, attacker, defender)).toBe(6);
    // ... × 1.5 vulnerable, floored again
    defender.statuses.vulnerable = 1;
    expect(computeAttack(6, attacker, defender)).toBe(9);
  });

  it('floors after each multiply, not once at the end', () => {
    // 5 → floor(3.75) = 3 → floor(4.5) = 4. Collapsing the two multiplies into
    // one and flooring at the end would give 5 instead.
    expect(computeAttack(5, body({ weak: 1 }), body({ vulnerable: 1 }))).toBe(4);
    expect(Math.floor(5 * 0.75 * 1.5)).toBe(5);
  });

  it('reads weak and vulnerable as switches and strength as an addend', () => {
    expect(computeAttack(6, body({ strength: 5 }), body())).toBe(11);
    expect(computeAttack(6, body({ weak: 9 }), body())).toBe(4);
    expect(computeAttack(6, body(), body({ vulnerable: 9 }))).toBe(9);
  });

  it('clamps a negative total to zero rather than healing the target', () => {
    expect(computeAttack(3, body({ strength: -5 }), body({ vulnerable: 1 }))).toBe(0);
  });
});

describe('applyDamage', () => {
  it('eats block first and passes the remainder to HP', () => {
    const state = bench(cards('pikan', 1));
    state.player.block = 5;
    const hp = state.player.hp;

    applyDamage(state, state.player, 8);

    expect(state.player.block).toBe(0);
    expect(state.player.hp).toBe(hp - 3);
    expect(state.events.at(-1)).toEqual({
      t: 'damage',
      targetId: 'player',
      amount: 3,
      blocked: 5,
      lethal: false,
    });
  });

  it('keeps the surplus when block covers the whole hit', () => {
    const state = bench(cards('pikan', 1));
    state.player.block = 10;
    const hp = state.player.hp;

    applyDamage(state, state.player, 8);

    expect(state.player.block).toBe(2);
    expect(state.player.hp).toBe(hp);
    expect(state.events.at(-1)).toMatchObject({ amount: 0, blocked: 8 });
  });

  it('kills an enemy exactly once and clears its intent', () => {
    const state = bench(cards('pikan', 1));
    const enemy = state.enemies[0];

    applyDamage(state, enemy, enemy.hp + 50);

    expect(enemy.hp).toBe(0);
    expect(enemy.alive).toBe(false);
    expect(enemy.intent).toBeNull();
    expect(state.events.filter((e) => e.t === 'death')).toHaveLength(1);

    applyDamage(state, enemy, 10);
    expect(state.events.filter((e) => e.t === 'death')).toHaveLength(1);
  });
});

describe('status decay', () => {
  it('ticks the player debuffs down at end of turn and leaves buffs alone', () => {
    const state = bench(cards('pikan', 1));
    Object.assign(state.player.statuses, { vulnerable: 2, weak: 1, strength: 3 });

    endPlayerTurn(state);

    expect(state.player.statuses.vulnerable).toBe(1);
    expect(state.player.statuses.weak).toBeUndefined();
    expect(state.player.statuses.strength).toBe(3);
  });

  it('ticks enemy debuffs on the enemy turn', () => {
    const state = bench(cards('pikan', 1));
    const enemy = state.enemies[0];
    Object.assign(enemy.statuses, { vulnerable: 2, strength: 4 });

    endPlayerTurn(state);
    runEnemyTurn(state);

    expect(enemy.statuses.vulnerable).toBe(1);
    expect(enemy.statuses.strength).toBe(4);
  });
});

describe('drawCards', () => {
  it('reshuffles the discard pile when the draw pile runs dry', () => {
    const state = bench(cards('pikan', 6));
    expect(state.hand).toHaveLength(HAND_SIZE);

    endPlayerTurn(state);
    state.discardPile.push(...state.drawPile.splice(0));
    expect(state.discardPile).toHaveLength(6);

    state.events.length = 0;
    drawCards(state, 3);

    expect(state.hand).toHaveLength(3);
    expect(state.drawPile).toHaveLength(3);
    expect(state.discardPile).toEqual([]);
    expect(state.events[0]).toEqual({ t: 'shuffle' });
    expect(state.events.filter((e) => e.t === 'draw')).toHaveLength(3);
  });

  it('is a silent no-op when both piles are empty', () => {
    const state = bench(cards('pikan', 2));
    state.drawPile = [];
    state.discardPile = [];
    const hand = [...state.hand];
    state.events.length = 0;

    expect(() => drawCards(state, 5)).not.toThrow();

    expect(state.hand).toEqual(hand);
    expect(state.events).toEqual([]);
  });

  it('stops at MAX_HAND — the 11th card is never drawn', () => {
    const state = bench(cards('pikan', 20));
    drawCards(state, MAX_HAND);
    expect(state.hand).toHaveLength(MAX_HAND);

    const left = state.drawPile.length;
    state.events.length = 0;
    drawCards(state, 1);

    expect(state.hand).toHaveLength(MAX_HAND);
    expect(state.drawPile).toHaveLength(left);
    expect(state.events).toEqual([]);
  });
});

describe('pickIntent', () => {
  const enemyIds = [
    ...new Set(
      [...ACT1.weak, ...ACT1.strong, ...ACT1.elite, ...ACT1.boss].flatMap((e) => e.enemies),
    ),
  ];

  it('never repeats a move past its maxRepeat', () => {
    for (const defId of enemyIds) {
      const def = getEnemy(defId);
      const limits = new Map(def.moves.map((m) => [m.id, m.maxRepeat ?? Infinity]));
      const probe: Encounter = { id: 'probe', name: 'probe', enemies: [defId], goldReward: [0, 0] };

      for (let s = 0; s < 200; s++) {
        const state = bench(cards('pikan', 1), probe, `intent-${defId}-${s}`);
        const enemy = state.enemies[0];
        let last = enemy.intent!.id;
        let streak = 1;

        for (let i = 0; i < 40; i++) {
          pickIntent(state, enemy);
          const id = enemy.intent!.id;
          streak = id === last ? streak + 1 : 1;
          last = id;
          expect(streak, `${defId} repeated ${id} ${streak}× in a row`).toBeLessThanOrEqual(
            limits.get(id)!,
          );
        }
      }
    }
  });

  it('always leaves something to pick, so an enemy never idles', () => {
    const state = bench(cards('pikan', 1));
    const enemy = state.enemies[0];
    for (let i = 0; i < 100; i++) {
      pickIntent(state, enemy);
      expect(enemy.intent).not.toBeNull();
    }
  });
});

describe('turn cycle', () => {
  it('refills energy, clears block and redraws a hand', () => {
    const state = bench(cards('pikan', 20));
    state.player.block = 12;
    state.energy = 0;

    endPlayerTurn(state);
    runEnemyTurn(state);

    expect(state.energy).toBe(BASE_ENERGY);
    expect(state.player.block).toBe(0);
    expect(state.hand).toHaveLength(HAND_SIZE);
  });

  it('spends 青龙偃月 on the first attack of each turn only', () => {
    const state = bench(cards('pikan', 20));
    const enemy = state.enemies[0];

    let hp = enemy.hp;
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6 + (RELICS.qinglongdao.value ?? 0));

    hp = enemy.hp;
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6);

    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(state.attacksThisTurn).toBe(0);
  });
});
