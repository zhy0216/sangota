import { describe, expect, it } from 'vitest';
import { resolveCard } from '../src/combat/cards';
import { getEncounter } from '../src/combat/enemies';
import {
  describeCard, endPlayerTurn, playCard,
  runEnemyTurn, startCombat,
} from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { HEROES } from '../src/data/heroes';
import { newDeckCard } from '../src/state/run';

/** Controlled hands, real payment, relics, reactions, and turn transitions. */
function bench(ids: string[], heroId: string, upgraded = 0, group: boolean | string = false): CombatState {
  const hero = HEROES[heroId];
  const state = startCombat({
    encounter: getEncounter(typeof group === 'string' ? group : group ? 'm2' : 'm1'),
    deck: ids.map((id, i) => newDeckCard(id, i === 0 ? upgraded : 0)),
    hp: hero.maxHp, maxHp: hero.maxHp, heroName: hero.name,
    relics: [hero.starterRelic], seed: 'card-balance-contract',
  });
  state.hand = Object.keys(state.cards);
  state.drawPile = [];
  for (const enemy of state.enemies) {
    enemy.hp = enemy.maxHp = 200;
    enemy.block = 0;
    enemy.statuses = {};
    enemy.intent = { id: 'wait', label: 'wait' };
  }
  return state;
}

function uid(state: CombatState, id: string): string {
  return state.hand.find((held) => state.cards[held].defId === id)!;
}

function play(state: CombatState, id: string): number {
  const enemy = state.enemies.find((body) => body.alive)!;
  const hp = enemy.hp;
  expect(playCard(state, uid(state, id), enemy.id)).toBe(true);
  return hp - enemy.hp;
}

function drawStack(state: CombatState, ids: string[]): void {
  for (const id of ids) {
    const card = newDeckCard(id);
    state.cards[card.uid] = card;
    state.drawPile.push(card.uid);
  }
}

describe('诸葛亮构筑定位', () => {
  it.each([0, 1])('伏兵 waits in hand for a future threat and exhaust gate (upgrade %i)', (up) => {
    const state = bench(['fubing', 'tuntian'], 'zhugeliang', up);
    const held = uid(state, 'fubing');
    const field = uid(state, 'tuntian');
    endPlayerTurn(state);
    expect(state.hand).toContain(held);
    expect(state.discardPile).toContain(field);
    drawStack(state, ['jinnang', 'jinnang', 'jinnang', 'yuanrongnu']);
    runEnemyTurn(state);
    for (let i = 0; i < 3; i++) play(state, 'jinnang');
    state.player.block = 0;
    play(state, 'fubing');
    expect(state.player.block).toBe(up ? 12 : 9);
    expect(state.discardPile).toContain(held);
  });

  it.each([0, 1])('观星 leaves qi to spend its draws and prints the actual block (upgrade %i)', (up) => {
    const state = bench(['guanxing'], 'zhugeliang', up);
    drawStack(state, ['yuanrongnu', 'yuanrongnu', 'yuanrongnu']);
    const text = describeCard(state, resolveCard('guanxing', up));
    play(state, 'guanxing');
    expect(state.energy).toBe(3);
    expect(state.hand).toHaveLength(up ? 3 : 2);
    expect(text).toContain(`获得 ${state.player.block} 点护甲`);
    expect(play(state, 'yuanrongnu')).toBe(6);
    expect(state.energy).toBe(2);
    expect(resolveCard('muniuliuma', 1).cost).toBe(0);
  });

  it.each([0, 1])('绝营 replaces its hand slot and only reduces active new armour (upgrade %i)', (up) => {
    const state = bench(['jueying'], 'zhugeliang', up, true);
    drawStack(state, ['yuanrongnu']);
    for (const enemy of state.enemies) {
      enemy.block = 20;
      enemy.statuses.metallicize = 4;
      enemy.intent = { id: 'guard', label: 'guard', block: 12 };
    }
    play(state, 'jueying');
    expect(state.hand).toHaveLength(1);
    expect(state.enemies.every((enemy) => enemy.block === 20)).toBe(true);
    const start = state.events.length;
    endPlayerTurn(state);
    runEnemyTurn(state);
    const blocks = state.events.slice(start).filter((event) => event.t === 'block' && event.targetId !== 'player');
    expect(blocks.map((event) => event.t === 'block' ? event.amount : 0)).toEqual([9, 9, 4, 4]);
  });

  it.each([0, 1])('卧龙 trades fewer tokens for stronger later attacks than 六出 (upgrade %i)', (up) => {
    const wolong = bench(['wolongchushan', 'yuanrongnu'], 'zhugeliang', up);
    const liuchu = bench(['liufulong', 'yuanrongnu'], 'zhugeliang', up);
    play(wolong, 'wolongchushan');
    play(liuchu, 'liufulong');
    expect(wolong.hand.length).toBeLessThan(liuchu.hand.length);
    expect(play(wolong, 'yuanrongnu') - play(liuchu, 'yuanrongnu')).toBe(2);
  });

  it.each([0, 1])('巧舌 enables damage with the last qi and is spent afterward (upgrade %i)', (up) => {
    const state = bench(['qiaoshe', 'yuanrongnu'], 'zhugeliang', up);
    state.energy = 1;
    const opener = uid(state, 'qiaoshe');
    play(state, 'qiaoshe');
    expect(state.energy).toBe(1);
    expect(state.exhaustPile).toContain(opener);
    expect(play(state, 'yuanrongnu')).toBe(8); // per-hit rounding: floor(3 × 1.5) × 2
    expect(resolveCard('lijianji').keywords ?? []).not.toContain('exhaust');
  });

  it.each([0, 1])('火烧藤甲 takes a prepared kill; 焚聚 keeps its repeatable role (upgrade %i)', (up) => {
    const burst = bench(['huoshaotengjia'], 'zhugeliang', up);
    const repeat = bench(['fenju'], 'zhugeliang', up);
    for (const state of [burst, repeat]) {
      for (let i = 0; i < 5; i++) {
        const card = newDeckCard('jinnang');
        state.cards[card.uid] = card;
        state.exhaustPile.push(card.uid);
      }
      state.enemies[0].hp = up ? 38 : 30;
    }
    const oneShot = uid(burst, 'huoshaotengjia');
    const repeating = uid(repeat, 'fenju');
    play(burst, 'huoshaotengjia');
    play(repeat, 'fenju');
    expect(burst.phase).toBe('won');
    expect(burst.exhaustPile).toContain(oneShot);
    expect(repeat.phase).toBe('player');
    expect(repeat.discardPile).toContain(repeating);
  });
});
