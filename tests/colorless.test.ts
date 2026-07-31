import { describe, expect, it } from 'vitest';
import { COLORLESS_POOL, getCard, resolveCard } from '../src/combat/cards';
import { ENCOUNTERS } from '../src/combat/enemies';
import {
  endPlayerTurn,
  playCard,
  runEnemyTurn,
  stacks,
  startCombat,
  startPlayerTurn,
} from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard } from '../src/state/run';

/**
 * 无色 cards — the five the 坊市 deals and nothing else does.
 *
 * They had *no* combat coverage. `sim/invariants.test.ts` put them through its
 * kitchen-sink deck, but that only asserts structural properties (piles
 * conserved, `hp ≤ maxHp`, `block ≥ 0`), so turning 青囊书 into a 0-cost
 * unlimited 6-heal by deleting its 消耗 keyword changed nothing that anything
 * measured. The rarity and cost bands had no coverage either, which matters
 * doubly here: the 坊市 shelf prices 无色 stock off its declared rarity.
 *
 * Every assertion below names the number on the card.
 */

/** One fight, one card type in hand, energy enough to actually play it. */
function bench(deckId: string, seed = 'colorless'): CombatState {
  const state = startCombat({
    encounter: ENCOUNTERS.monster[0],
    deck: Array.from({ length: 12 }, () => newDeckCard(deckId)),
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [],
    seed,
  });
  state.energy = 99;
  return state;
}

describe('the 无色 shelf itself', () => {
  it('ships exactly the five cards the shop indexes into, in declaration order', () => {
    // `COLORLESS_POOL` is `Object.keys(...)`, i.e. declaration order, and the
    // shelf's fifth slot indexes into it off a seeded roll. Re-ordering it
    // re-stocks every 商旅 in every existing run — the comment says "append
    // only" and nothing enforced it. Reversing the array passed the whole suite.
    expect(COLORLESS_POOL).toEqual([
      'qingnangshu',
      'lujiao',
      'lijianji',
      'dushi',
      'bazhentu',
    ]);
  });

  it('prices out of the bands the shelf charges for', () => {
    const printed: Record<string, { rarity: string; cost: number; type: string }> = {
      qingnangshu: { rarity: 'common', cost: 0, type: 'skill' },
      lujiao: { rarity: 'common', cost: 1, type: 'skill' },
      lijianji: { rarity: 'uncommon', cost: 1, type: 'skill' },
      dushi: { rarity: 'uncommon', cost: 1, type: 'attack' },
      bazhentu: { rarity: 'rare', cost: 2, type: 'power' },
    };
    for (const id of COLORLESS_POOL) {
      const def = getCard(id);
      expect({ rarity: def.rarity, cost: def.cost, type: def.type }, id).toEqual(printed[id]);
    }
  });

  it('gives every one of them an upgrade face', () => {
    for (const id of COLORLESS_POOL) expect(getCard(id).upgrade, id).toBeDefined();
  });
});

describe('青囊书', () => {
  it('heals 6, and 9 forged', () => {
    const state = bench('qingnangshu');
    state.player.hp = 40;
    playCard(state, state.hand[0]);
    expect(state.player.hp).toBe(46);

    expect(resolveCard('qingnangshu', 1).effects).toEqual([{ kind: 'heal', amount: 9 }]);
  });

  it('exhausts, which is the only thing stopping a 0-cost infinite heal', () => {
    expect(getCard('qingnangshu').keywords).toContain('exhaust');

    const state = bench('qingnangshu');
    state.player.hp = 10;
    const held = state.hand.length;
    playCard(state, state.hand[0]);
    expect(state.exhaustPile).toHaveLength(1);
    expect(state.discardPile).toHaveLength(0);
    expect(state.hand).toHaveLength(held - 1);
  });

  it('never heals past the ceiling', () => {
    const state = bench('qingnangshu');
    state.player.hp = state.player.maxHp - 2;
    playCard(state, state.hand[0]);
    expect(state.player.hp).toBe(state.player.maxHp);
  });
});

describe('鹿角', () => {
  it('lays 3 层 反刺 and answers back for 3 on every hit taken', () => {
    const state = bench('lujiao');
    playCard(state, state.hand[0]);
    expect(stacks(state.player, 'thorns')).toBe(3);

    const enemy = state.enemies[0];
    const hp = enemy.hp;
    endPlayerTurn(state);
    runEnemyTurn(state);
    // 黄巾散兵 either swings or guards; when it swung, it paid the thorns.
    if (enemy.hp < hp) expect(hp - enemy.hp).toBe(3);
    // The stack does not decay on its own.
    expect(stacks(state.player, 'thorns')).toBe(3);
  });

  it('forges to 4', () => {
    expect(resolveCard('lujiao', 1).effects).toEqual([
      { kind: 'status', status: 'thorns', amount: 4, to: 'self' },
    ]);
  });
});

describe('离间计', () => {
  it('puts 2 怯战 and 2 破绽 on every enemy, not just the targeted one', () => {
    const state = startCombat({
      encounter: ENCOUNTERS.monster.find((e) => e.enemies.length > 1)!,
      deck: Array.from({ length: 12 }, () => newDeckCard('lijianji')),
      heroName: DEFAULT_HERO.name,
      hp: DEFAULT_HERO.maxHp,
      maxHp: DEFAULT_HERO.maxHp,
      relics: [],
      seed: 'lijian',
    });
    state.energy = 99;
    expect(state.enemies.length).toBeGreaterThan(1);

    playCard(state, state.hand[0]);
    for (const enemy of state.enemies) {
      expect(stacks(enemy, 'weak'), enemy.id).toBe(2);
      expect(stacks(enemy, 'vulnerable'), enemy.id).toBe(2);
    }
  });

  it('is targeted at the whole field, not at one enemy', () => {
    expect(getCard('lijianji').target).toBe('all');
  });

  it('forges to 3 and 3', () => {
    expect(resolveCard('lijianji', 1).effects).toEqual([
      { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'allEnemies' },
    ]);
  });
});

describe('毒矢', () => {
  it('deals 5 and stacks 3 层 中毒', () => {
    const state = bench('dushi');
    const enemy = state.enemies[0];
    const hp = enemy.hp;

    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(5);
    expect(stacks(enemy, 'poison')).toBe(3);

    // Stacks rather than refreshing.
    playCard(state, state.hand[0], enemy.id);
    expect(stacks(enemy, 'poison')).toBe(6);
  });

  it('ticks its poison through 护甲, which is the whole point of the card', () => {
    const state = bench('dushi');
    const enemy = state.enemies[0];
    playCard(state, state.hand[0], enemy.id);
    enemy.block = 99;
    const hp = enemy.hp;

    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(enemy.hp).toBeLessThan(hp);
    // …and the stack decays by one per tick.
    expect(stacks(enemy, 'poison')).toBe(2);
  });

  it('forges to 7 damage and 4 层', () => {
    expect(resolveCard('dushi', 1).effects).toEqual([
      { kind: 'damage', amount: 7 },
      { kind: 'status', status: 'poison', amount: 4, to: 'target' },
    ]);
  });
});

describe('八阵图', () => {
  it('lays 4 层 重甲, which pays its armour at turn end', () => {
    const state = bench('bazhentu');
    playCard(state, state.hand[0]);
    expect(stacks(state.player, 'metallicize')).toBe(4);
    // A 能力 pays nothing on the turn it lands…
    expect(state.player.block).toBe(0);

    const before = state.player.block;
    endPlayerTurn(state);
    // …and the armour is there for the enemy's turn.
    expect(state.player.block).toBeGreaterThan(before);
  });

  it('keeps paying every turn', () => {
    const state = bench('bazhentu');
    playCard(state, state.hand[0]);
    endPlayerTurn(state);
    runEnemyTurn(state);
    startPlayerTurn(state);
    state.player.block = 0;
    endPlayerTurn(state);
    expect(state.player.block).toBe(4);
  });

  it('exhausts, so the layers cannot be doubled up from one deck', () => {
    expect(getCard('bazhentu').keywords).toContain('exhaust');
    const state = bench('bazhentu');
    playCard(state, state.hand[0]);
    expect(state.exhaustPile).toHaveLength(1);
  });

  it('forges to 5', () => {
    expect(resolveCard('bazhentu', 1).effects).toEqual([
      { kind: 'status', status: 'metallicize', amount: 5, to: 'self' },
    ]);
  });
});
