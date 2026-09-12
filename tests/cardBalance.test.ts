import { describe, expect, it } from 'vitest';
import { resolveCard } from '../src/combat/cards';
import { getEncounter } from '../src/combat/enemies';
import {
  addStatus, canPlay, describeCard, endPlayerTurn, playCard,
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

describe('weak-card adjustments preserve competing uses', () => {
  it.each([0, 1])('万人敌 matches starter AoE but 水淹 grows faster with strength (upgrade %i)', (up) => {
    const single = bench(['wanren'], 'guanyu', up, true);
    const multi = bench(['shuiyanqijun'], 'guanyu', up, true);
    expect(play(single, 'wanren')).toBe(play(multi, 'shuiyanqijun'));
    expect(single.enemies.map((enemy) => enemy.hp)).toEqual(multi.enemies.map((enemy) => enemy.hp));
    const strongSingle = bench(['wanren'], 'guanyu', up, true);
    const strongMulti = bench(['shuiyanqijun'], 'guanyu', up, true);
    strongSingle.player.statuses.strength = strongMulti.player.statuses.strength = 2;
    expect(play(strongMulti, 'shuiyanqijun') - play(strongSingle, 'wanren')).toBe(2);
  });

  it('single-hit AoE feeds 暴怒 once, while 水淹 feeds it twice', () => {
    const single = bench(['wanren'], 'guanyu');
    const multi = bench(['shuiyanqijun'], 'guanyu');
    single.enemies[0].statuses.angry = multi.enemies[0].statuses.angry = 1;
    play(single, 'wanren');
    play(multi, 'shuiyanqijun');
    expect(single.enemies[0].statuses.strength).toBe(1);
    expect(multi.enemies[0].statuses.strength).toBe(2);
  });

  it('a stored-qi turn can pay for 万人敌 and defence without changing its printed-cost hooks', () => {
    const state = bench(['wanren', 'tiebi'], 'guanyu');
    state.relics.push('maichengcanqi', 'hanshoutinghouyin');
    state.energy = 2;
    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(state.energy).toBe(5);
    expect(play(state, 'wanren')).toBe(21); // 15 + first attack 3 + printed-cost relic 3
    play(state, 'tiebi');
    expect(state.energy).toBe(2);
  });

  it.each([0, 1])('横扫 has a reachable payoff; 常山 still wins cold and 拒马 costs less (upgrade %i)', (up) => {
    const sweep = bench(['hengsaoqianjun', 'tuzhen', 'longdan'], 'zhaoyun', up, true);
    const rare = bench(['changshanzhaozilong'], 'zhaoyun', up, true);
    const cold = play(bench(['hengsaoqianjun'], 'zhaoyun', up, true), 'hengsaoqianjun');
    const rareHit = play(rare, 'changshanzhaozilong');
    expect(cold).toBeLessThan(rareHit);
    play(sweep, 'tuzhen');
    play(sweep, 'longdan');
    expect(sweep.energy).toBe(2);
    expect(play(sweep, 'hengsaoqianjun')).toBeGreaterThan(rareHit);
    expect(sweep.energy).toBe(0);
    const cheap = bench(['juma'], 'zhaoyun', up, true);
    cheap.energy = 1;
    cheap.player.block = 8;
    expect(canPlay(cheap, uid(cheap, 'juma'))).toBe(true);
  });

  it.each([0, 1])('高览 finishes a three-attack line while leaving qi for defence (upgrade %i)', (up) => {
    const state = bench(['qiangtiaogaolan', 'tuzhen', 'longdan', 'jici', 'luema'], 'zhaoyun', up);
    play(state, 'tuzhen');
    play(state, 'longdan');
    play(state, 'jici');
    expect(state.attacksThisTurn).toBe(3);
    const text = describeCard(state, resolveCard('qiangtiaogaolan', up), state.enemies[0]);
    const damage = play(state, 'qiangtiaogaolan');
    expect(text).toContain(`造成 ${damage} 点伤害`);
    expect(damage).toBe(up ? 36 : 30);
    expect(state.energy).toBe(1);
    play(state, 'luema');
    expect(state.player.block).toBe(5);
  });

  it('力斩 keeps unconditional strength scaling; 高览 avoids feeding repeated anger', () => {
    const finisher = bench(['qiangtiaogaolan'], 'zhaoyun');
    const multi = bench(['lizhanwujiang'], 'zhaoyun');
    finisher.attacksThisTurn = multi.attacksThisTurn = 3;
    finisher.player.statuses.strength = multi.player.statuses.strength = 2;
    finisher.enemies[0].statuses.angry = multi.enemies[0].statuses.angry = 1;
    expect(play(multi, 'lizhanwujiang')).toBeGreaterThan(play(finisher, 'qiangtiaogaolan'));
    expect(finisher.enemies[0].statuses.strength).toBe(1);
    expect(multi.enemies[0].statuses.strength).toBe(5);
  });

  it.each([0, 1])('血染 can take an urgent kill that 挺枪 misses, paying HP (upgrade %i)', (up) => {
    const blood = bench(['xueranzhengpao'], 'zhaoyun', up);
    const safe = bench(['tingqiang'], 'zhaoyun', up);
    blood.player.hp = safe.player.hp = 20;
    blood.enemies[0].hp = safe.enemies[0].hp = up ? 14 : 10;
    blood.enemies[0].intent = safe.enemies[0].intent = { id: 'hit', label: 'hit', damage: 10 };
    play(blood, 'xueranzhengpao');
    play(safe, 'tingqiang');
    expect(blood.phase).toBe('won');
    expect(blood.player.hp).toBe(19);
    endPlayerTurn(safe);
    runEnemyTurn(safe);
    expect(safe.player.hp).toBe(10);
  });

  it.each([0, 1])('血染 consumes 天佑 and lethal self-damage stops the attack (upgrade %i)', (up) => {
    const protectedState = bench(['xueranzhengpao'], 'zhaoyun', up);
    protectedState.player.statuses.buffer = 1;
    const hp = protectedState.player.hp;
    play(protectedState, 'xueranzhengpao');
    expect(protectedState.player.hp).toBe(hp);
    expect(protectedState.player.statuses.buffer ?? 0).toBe(0);
    const dying = bench(['xueranzhengpao'], 'zhaoyun', up);
    dying.player.hp = 1;
    expect(play(dying, 'xueranzhengpao')).toBe(0);
    expect(dying.phase).toBe('lost');
  });

  it('blood cost carries across fights and remains a real repeated-use penalty', () => {
    let hp = 37;
    for (let fight = 0; fight < 3; fight++) {
      const state = bench(['xueranzhengpao'], 'zhaoyun');
      state.player.hp = hp;
      state.enemies[0].hp = 10;
      play(state, 'xueranzhengpao');
      expect(state.phase).toBe('won');
      hp = state.player.hp;
    }
    expect(hp).toBe(34);
  });
});

describe('WIP roles have concrete payoffs', () => {
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

describe('narrow-use cards retained after review', () => {
  it('义薄云天 protects future control effects without cleansing existing ones', () => {
    const state = bench(['yibaoyuntian'], 'guanyu');
    state.player.statuses.weak = 1;
    play(state, 'yibaoyuntian');
    addStatus(state, state.player, 'entangled', 1);
    addStatus(state, state.player, 'noDraw', 1);
    expect(state.player.statuses.weak).toBe(1);
    expect(state.player.statuses.entangled ?? 0).toBe(0);
    expect(state.player.statuses.noDraw ?? 0).toBe(0);
  });

  it('五关 exceeds 义勇 after two group kills while another enemy survives', () => {
    const state = bench(['wuguanliujiang', 'pikan', 'pikan'], 'guanyu', 0, 'm5');
    state.enemies[0].hp = 1;
    state.enemies[1].hp = 1;
    play(state, 'wuguanliujiang');
    play(state, 'pikan');
    play(state, 'pikan');
    expect(state.phase).toBe('player');
    expect(state.player.statuses.strength).toBe(4);
  });

  it('顺平侯 adds no mitigation to one hit but protects against subsequent hits', () => {
    const losses = [1, 2].map((hits) => {
      const state = bench(['shunpinghou'], 'zhaoyun');
      const hp = state.player.hp;
      state.enemies[0].intent = { id: 'hit', label: 'hit', damage: 10, hits };
      play(state, 'shunpinghou');
      endPlayerTurn(state);
      runEnemyTurn(state);
      return hp - state.player.hp;
    });
    expect(losses).toEqual([10, 18]);
  });

  it('封金 supplies an otherwise unaffordable heavy attack and cannot recur', () => {
    const state = bench(['fengjinguayin', 'tuodao'], 'guanyu');
    state.energy = 1;
    expect(canPlay(state, uid(state, 'tuodao'))).toBe(false);
    const acceleration = uid(state, 'fengjinguayin');
    play(state, 'fengjinguayin');
    expect(canPlay(state, uid(state, 'tuodao'))).toBe(true);
    expect(state.exhaustPile).toContain(acceleration);
  });

  it('卷土 triggers 粮道 with an unempty draw pile while 观阵 only draws', () => {
    const gains = ['juantuchonglai', 'guanzhen'].map((id) => {
      const state = bench([id, 'pikan'], 'guanyu');
      const attack = uid(state, 'pikan');
      state.hand = state.hand.filter((held) => held !== attack);
      state.discardPile = [attack];
      drawStack(state, ['tiebi', 'tiebi', 'tiebi', 'tiebi']);
      state.player.statuses.supply = 2;
      play(state, id);
      return state.energy;
    });
    expect(gains).toEqual([4, 3]);
  });
});
