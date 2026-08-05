import { describe, expect, it } from 'vitest';
import { getEncounter } from '../src/combat/enemies';
import {
  addStatus,
  canPlay,
  computeAttack,
  drawCards,
  endPlayerTurn,
  gainBlock,
  playCard,
  resolveDamage,
  runEnemyTurn,
  startCombat,
  startPlayerTurn,
  tickStatuses,
} from '../src/combat/engine';
import { STATUS_META, STATUS_ORDER } from '../src/combat/statuses';
import type { CombatState, EnemyMove, EnemyState, StatusId } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, type DeckCard } from '../src/state/run';

/**
 * todos/12 · 状态效果库 — one test per line of its 验收标准, plus the ordering
 * decisions the original gets right and a naive port gets wrong.
 */

function bench(deck: DeckCard[], encounterId = 'm1', seed = 'status-bench'): CombatState {
  const encounter = getEncounter(encounterId);
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

/** Hands the turn to the enemies with `move` telegraphed, skipping the tick. */
function enemyPlays(state: CombatState, move: EnemyMove, enemy: EnemyState = state.enemies[0]): void {
  state.phase = 'enemy';
  for (const other of state.enemies) other.intent = null;
  enemy.intent = move;
  runEnemyTurn(state);
}

const attackMove = (damage: number, hits?: number): EnemyMove => ({
  id: 'probe',
  label: '试',
  damage,
  hits,
  weight: 1,
});

// ------------------------------------------------------------------- 表结构

describe('the status table', () => {
  it('orders every status exactly once', () => {
    const ids = Object.keys(STATUS_META) as StatusId[];
    expect([...STATUS_ORDER].sort()).toEqual([...ids].sort());
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
  });

  it('gives all 24 statuses a name, a description and an icon', () => {
    expect(STATUS_ORDER).toHaveLength(24);
    for (const id of STATUS_ORDER) {
      const def = STATUS_META[id];
      expect(def.id, id).toBe(id);
      expect(def.label.length, id).toBeGreaterThan(0);
      expect(def.desc.length, id).toBeGreaterThan(0);
      expect(def.icon, id).toBe(`status-${id}`);
    }
  });

  it('applies 身法 before 力竭, which is what makes 8 block become 6', () => {
    expect(STATUS_ORDER.indexOf('dexterity')).toBeLessThan(STATUS_ORDER.indexOf('frail'));
  });

  it('runs the reactive statuses last, 龟缩 before 反刺', () => {
    const reactive = STATUS_ORDER.filter((id) => STATUS_META[id].onAttacked);
    expect(reactive).toEqual(['riposte', 'curlUp', 'angry', 'thorns']);
    expect(STATUS_ORDER.slice(-4)).toEqual(reactive);
  });
});

// ------------------------------------------------------------------- 数值修饰

describe('身法 / 力竭', () => {
  it('adds 身法 flat, then scales by 力竭 — 铁壁 reads 5 → 8 → 6', () => {
    const state = bench(cards('tiebi', 5));
    const play = (): number => {
      const before = state.player.block;
      playCard(state, state.hand.find((uid) => state.cards[uid].defId === 'tiebi')!);
      return state.player.block - before;
    };

    expect(play()).toBe(5);
    addStatus(state, state.player, 'dexterity', 3);
    expect(play()).toBe(8);
    addStatus(state, state.player, 'frail', 2);
    expect(play()).toBe(6);
  });

  it('reaches block granted by an enemy move as well as by a card', () => {
    const state = bench(cards('pikan', 5));
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'dexterity', 4);
    enemyPlays(state, { id: 'p', label: '守', block: 6, weight: 1 }, enemy);
    expect(enemy.block).toBe(10);
  });

  it('leaves 重甲 and 宝物 block alone — only earned block is shaped', () => {
    const state = bench(cards('pikan', 5));
    addStatus(state, state.player, 'frail', 1);
    gainBlock(state, state.player, 8, 'power');
    expect(state.player.block).toBe(8);
  });
});

/**
 * 神力 and 身法 are the two signed quantities. Storing them clamped at zero
 * makes every "reduce N" effect under-apply silently — and it also made the
 * negative-Strength guard inside `computeAttack` unreachable dead code.
 */
describe('signed stacks', () => {
  it('takes 神力 below zero and subtracts from there', () => {
    const state = bench(cards('pikan', 5), 'm2');
    const [a, b] = state.enemies;

    addStatus(state, a, 'strength', 2);
    addStatus(state, a, 'strength', -3);
    expect(a.statuses.strength).toBe(-1);
    expect(computeAttack(6, a, state.player)).toBe(5);

    // On a fresh target it is a plain penalty, not a no-op.
    addStatus(state, b, 'strength', -2);
    expect(computeAttack(6, b, state.player)).toBe(4);
  });

  it('takes 身法 below zero and shrinks earned block', () => {
    const state = bench(cards('tiebi', 5));
    addStatus(state, state.player, 'dexterity', -2);
    playCard(state, state.hand.find((uid) => state.cards[uid].defId === 'tiebi')!);
    expect(state.player.block).toBe(3);
  });

  it('never inverts a negative 神力 into a heal', () => {
    const state = bench(cards('pikan', 5));
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'strength', -20);
    addStatus(state, state.player, 'vulnerable', 1);
    expect(computeAttack(4, enemy, state.player)).toBe(0);
  });

  it('still floors every other status at zero', () => {
    const state = bench(cards('pikan', 5));
    addStatus(state, state.player, 'vulnerable', 2);
    addStatus(state, state.player, 'vulnerable', -5);
    expect(state.player.statuses.vulnerable).toBeUndefined();
  });
});

// ------------------------------------------------------------------- 回合触发

describe('中毒', () => {
  it('takes 3 through 10 block at turn start and steps down to 2', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'poison', 3);
    state.player.block = 10;
    const hp = state.player.hp;

    startPlayerTurn(state);

    expect(state.player.hp).toBe(hp - 3);
    expect(state.player.block).toBe(0); // wiped by the turn, not by the poison
    expect(state.player.statuses.poison).toBe(2);
  });

  it('bites an enemy at the start of its own turn', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'poison', 4);
    const hp = enemy.hp;

    enemyPlays(state, attackMove(1), enemy);

    expect(enemy.hp).toBe(hp - 4);
    expect(enemy.statuses.poison).toBe(3);
  });
});

describe('调息 · 重甲 · 蓄势', () => {
  it('heals at end of turn and steps down', () => {
    const state = bench(cards('pikan', 6));
    state.player.hp = 40;
    addStatus(state, state.player, 'regen', 3);

    endPlayerTurn(state);

    expect(state.player.hp).toBe(43);
    expect(state.player.statuses.regen).toBe(2);
  });

  it('grants 重甲 block at end of turn, so it survives into the enemy turn', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'metallicize', 4);

    endPlayerTurn(state);

    expect(state.player.block).toBe(4);
    expect(state.player.statuses.metallicize).toBe(4);
  });

  it('turns 蓄势 into 神力 at the owner’s turn end', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'ritual', 2);

    enemyPlays(state, attackMove(1), enemy);

    expect(enemy.statuses.strength).toBe(2);
    expect(enemy.statuses.ritual).toBe(2);
  });
});

describe('反刺', () => {
  it('reflects once per hit of a multi-hit attack', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, state.player, 'thorns', 3);
    const hp = enemy.hp;

    enemyPlays(state, attackMove(4, 2), enemy);

    expect(hp - enemy.hp).toBe(6);
  });

  it('reflects even when the blow was fully blocked', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, state.player, 'thorns', 3);
    state.player.block = 50;
    const hp = enemy.hp;
    state.events.length = 0;

    enemyPlays(state, attackMove(4), enemy);

    expect(state.events.find((e) => e.t === 'damage' && e.targetId === 'player')).toMatchObject({
      amount: 0,
      blocked: 4,
    });
    expect(hp - enemy.hp).toBe(3);
  });

  /**
   * The reaction pass used to be gated on `defender.hp > 0`, which made 反刺
   * free to walk into whenever the swing was lethal. Killing the holder is
   * exactly when the spikes should hurt most.
   */
  it('still reflects when the blow is the killing one', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    enemy.hp = 3;
    addStatus(state, enemy, 'thorns', 5);
    const hp = state.player.hp;

    playCard(state, state.hand[0], enemy.id);

    expect(enemy.alive).toBe(false);
    expect(hp - state.player.hp).toBe(5);
  });

  it('does not bounce between two 反刺 holders', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, state.player, 'thorns', 3);
    addStatus(state, enemy, 'thorns', 3);
    const enemyHp = enemy.hp;
    const playerHp = state.player.hp;

    // The reflection is not an attack, so it cannot provoke a reflection back.
    enemyPlays(state, attackMove(4), enemy);

    expect(enemyHp - enemy.hp).toBe(3);
    expect(playerHp - state.player.hp).toBe(4);
  });
});

// ------------------------------------------------------------------- 规则改写

describe('护身符', () => {
  it('wards off the next debuff whole and spends one layer for it', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'artifact', 1);
    state.events.length = 0;

    addStatus(state, state.player, 'vulnerable', 2);

    expect(state.player.statuses.vulnerable).toBeUndefined();
    expect(state.player.statuses.artifact).toBeUndefined();
    expect(state.events).toEqual([
      { t: 'statusBlocked', targetId: 'player', status: 'vulnerable' },
    ]);

    // Layer gone: the next one lands.
    addStatus(state, state.player, 'vulnerable', 2);
    expect(state.player.statuses.vulnerable).toBe(2);
  });

  it('lets buffs through untouched', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'artifact', 1);

    addStatus(state, state.player, 'strength', 2);

    expect(state.player.statuses.strength).toBe(2);
    expect(state.player.statuses.artifact).toBe(1);
  });

  it('still wards a buff applied as a penalty, e.g. -2 神力', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'artifact', 1);

    addStatus(state, state.player, 'strength', -2);

    expect(state.player.statuses.strength).toBeUndefined();
    expect(state.player.statuses.artifact).toBeUndefined();
  });
});

describe('深沟高垒', () => {
  it('keeps block standing through the turn start', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'barricade', 1);
    state.player.block = 12;

    startPlayerTurn(state);

    expect(state.player.block).toBe(12);
  });

  it('keeps an enemy’s block standing through its own turn start', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'barricade', 1);
    enemy.block = 9;

    enemyPlays(state, attackMove(1), enemy);

    expect(enemy.block).toBe(9);
  });
});

describe('金蝉脱壳', () => {
  it('clamps a 30-damage swing to 1 before block, costing 1 block and no HP', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'intangible', 2);
    state.player.block = 5;
    const hp = state.player.hp;
    state.events.length = 0;

    enemyPlays(state, attackMove(30));

    expect(state.player.hp).toBe(hp);
    // One point of block spent, four still standing when the swing lands — the
    // clamp is before the wall, not after it.
    expect(state.events.filter((e) => e.t === 'damage')).toEqual([
      { t: 'damage', targetId: 'player', amount: 0, blocked: 1, lethal: false },
    ]);
  });

  it('costs exactly 1 HP with no block at all', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'intangible', 1);
    const hp = state.player.hp;

    enemyPlays(state, attackMove(30));

    expect(state.player.hp).toBe(hp - 1);
  });

  it('lasts two of the owner’s turns, then wears off', () => {
    const state = bench(cards('pikan', 20));
    addStatus(state, state.player, 'intangible', 2);

    endPlayerTurn(state);
    expect(state.player.statuses.intangible).toBe(1);
    runEnemyTurn(state);

    endPlayerTurn(state);
    expect(state.player.statuses.intangible).toBeUndefined();
  });
});

describe('天佑', () => {
  it('eats one instance of HP loss and spends a layer', () => {
    const state = bench(cards('pikan', 6));
    addStatus(state, state.player, 'buffer', 1);
    const hp = state.player.hp;

    resolveDamage(state, {
      attacker: null,
      defender: state.player,
      base: 20,
      isAttack: false,
      pierceBlock: true,
    });
    expect(state.player.hp).toBe(hp);
    expect(state.player.statuses.buffer).toBeUndefined();
    expect(state.events.at(-1)).toEqual({
      t: 'damage',
      targetId: 'player',
      amount: 0,
      blocked: 0,
      lethal: false,
    });

    resolveDamage(state, {
      attacker: null,
      defender: state.player,
      base: 20,
      isAttack: false,
      pierceBlock: true,
    });
    expect(state.player.hp).toBe(hp - 20);
  });
});

describe('断粮 / 束缚', () => {
  it('stops every draw for the turn and clears at the end of it', () => {
    const state = bench(cards('pikan', 20));
    addStatus(state, state.player, 'noDraw', 1);
    const hand = state.hand.length;

    drawCards(state, 3);
    expect(state.hand).toHaveLength(hand);

    endPlayerTurn(state);
    expect(state.player.statuses.noDraw).toBeUndefined();
    runEnemyTurn(state);
    expect(state.hand.length).toBeGreaterThan(0);
  });

  /**
   * The whole reason both statuses exist: an enemy applies them on its own
   * turn and they bite on the player's next one. Clearing at the player's turn
   * *start* — which is what the first cut did — deletes them before the draw
   * and before `canPlay` is ever asked, i.e. a guaranteed silent no-op.
   */
  it('survives an enemy turn to gate the player turn it was aimed at', () => {
    const inflict = (status: StatusId): CombatState => {
      const state = bench(cards('pikan', 20));
      endPlayerTurn(state);
      enemyPlays(state, {
        id: `apply-${status}`,
        label: status,
        weight: 1,
        status: { status, amount: 1, to: 'player' },
      });
      return state;
    };

    const starved = inflict('noDraw');
    expect(starved.player.statuses.noDraw).toBe(1);
    expect(starved.hand).toHaveLength(0);

    const bound = inflict('entangled');
    expect(bound.player.statuses.entangled).toBe(1);
    expect(canPlay(bound, bound.hand[0])).toBe(false);

    // And it costs exactly that one turn, not the rest of the fight.
    endPlayerTurn(bound);
    expect(bound.player.statuses.entangled).toBeUndefined();
  });

  it('greys out 攻 cards only', () => {
    const state = bench([...cards('pikan', 3), ...cards('tiebi', 3)]);
    addStatus(state, state.player, 'entangled', 1);

    const attack = state.hand.find((uid) => state.cards[uid].defId === 'pikan')!;
    const skill = state.hand.find((uid) => state.cards[uid].defId === 'tiebi')!;

    expect(canPlay(state, attack)).toBe(false);
    expect(canPlay(state, skill)).toBe(true);
    expect(playCard(state, attack, state.enemies[0].id)).toBe(false);
  });
});

describe('龟缩 / 暴怒', () => {
  it('gives 龟缩 block once and then vanishes whole', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'curlUp', 7);

    playCard(state, state.hand[0], enemy.id);
    expect(enemy.block).toBe(7);
    expect(enemy.statuses.curlUp).toBeUndefined();

    enemy.block = 0;
    playCard(state, state.hand[0], enemy.id);
    expect(enemy.block).toBe(0);
  });

  it('feeds 暴怒 on every attack but not on reflected damage', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'angry', 2);
    addStatus(state, enemy, 'thorns', 1);

    playCard(state, state.hand[0], enemy.id);
    expect(enemy.statuses.strength).toBe(2);

    playCard(state, state.hand[0], enemy.id);
    expect(enemy.statuses.strength).toBe(4);
  });

  /**
   * Both read the HP the hit actually took. The hook is handed `hpLost` and
   * `blocked` precisely so a swing that died on a wall of 护甲 counts for
   * nothing — otherwise a 100-block enemy farms 神力 off attacks that never
   * touched it.
   */
  it('ignores an attack the defender fully blocked', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    enemy.block = 100;
    addStatus(state, enemy, 'curlUp', 7);
    addStatus(state, enemy, 'angry', 2);
    const hp = enemy.hp;

    playCard(state, state.hand[0], enemy.id);
    // The wall took the whole swing, so neither reaction was owed anything.
    expect(enemy.hp).toBe(hp);
    expect(enemy.block).toBeLessThan(100);
    expect(enemy.statuses.curlUp).toBe(7);
    expect(enemy.statuses.strength).toBeUndefined();
  });

  it('does not let a corpse curl up or get angry', () => {
    const state = bench(cards('pikan', 6));
    const enemy = state.enemies[0];
    enemy.hp = 1;
    addStatus(state, enemy, 'curlUp', 7);
    addStatus(state, enemy, 'angry', 2);

    playCard(state, state.hand[0], enemy.id);
    expect(enemy.alive).toBe(false);
    expect(enemy.block).toBe(0);
    expect(enemy.statuses.strength).toBeUndefined();
  });
});

// -------------------------------------------------------------------- 斩将

describe('斩将 (todos/11)', () => {
  /** Two enemies, so a kill can happen with the fight still running. */
  const bench2 = (deck: DeckCard[]): CombatState => bench(deck, 'm2', 'slayer');
  const stacksOf = (state: CombatState, id: StatusId): number => state.player.statuses[id] ?? 0;

  it('grants 神力 equal to its stacks each time an enemy drops', () => {
    const state = bench2(cards('pikan', 6));
    addStatus(state, state.player, 'slayer', 2);

    const first = state.enemies[0];
    resolveDamage(state, {
      attacker: state.player,
      defender: first,
      base: 999,
      isAttack: true,
      pierceBlock: true,
    });
    expect(first.alive).toBe(false);
    expect(stacksOf(state, 'strength')).toBe(2);

    const second = state.enemies[1];
    resolveDamage(state, {
      attacker: state.player,
      defender: second,
      base: 999,
      isAttack: true,
      pierceBlock: true,
    });
    expect(stacksOf(state, 'strength')).toBe(4);
  });

  it('does nothing at all without the status', () => {
    const state = bench2(cards('pikan', 6));
    resolveDamage(state, {
      attacker: state.player,
      defender: state.enemies[0],
      base: 999,
      isAttack: true,
      pierceBlock: true,
    });
    expect(stacksOf(state, 'strength')).toBe(0);
  });

  it('fires once per enemy, not once per killing hit', () => {
    const state = bench2(cards('pikan', 6));
    addStatus(state, state.player, 'slayer', 3);
    const target = state.enemies[0];

    for (let i = 0; i < 3; i++) {
      resolveDamage(state, {
        attacker: state.player,
        defender: target,
        base: 999,
        isAttack: true,
        pierceBlock: true,
      });
    }
    // A corpse cannot die again — `enemy.alive` gates the whole block.
    expect(stacksOf(state, 'strength')).toBe(3);
  });

  it('is a permanent buff that no debuff ward intercepts', () => {
    expect(STATUS_META.slayer.decay).toBe('none');
    expect(STATUS_META.slayer.kind).toBe('buff');
    expect(STATUS_META.slayer.blockable).toBe(false);
  });
});

// ------------------------------------------------------------------- 回归

describe('the refactor stayed still', () => {
  it('resolves a whole status-heavy exchange without touching the rng', () => {
    const state = bench(cards('pikan', 6));
    const before = state.rng.rolls;

    for (const id of ['poison', 'regen', 'metallicize', 'thorns', 'dexterity'] as StatusId[]) {
      addStatus(state, state.player, id, 2);
    }
    tickStatuses(state, state.player, 'ownerTurnStart');
    tickStatuses(state, state.player, 'ownerTurnEnd');
    resolveDamage(state, {
      attacker: state.enemies[0],
      defender: state.player,
      base: 12,
      isAttack: true,
      pierceBlock: false,
    });

    // Statuses are pure rules: every roll in a fight still comes from the deck,
    // the enemy rolls and the intents.
    expect(state.rng.rolls).toBe(before);
  });
});
