import { describe, expect, it } from 'vitest';
import { ACT1, getEncounter } from '../src/combat/enemies';
import { applyDamage, startCombat, usePotion } from '../src/combat/engine';
import type { CombatEvent } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import {
  addGold,
  addPotion,
  addRelic,
  clearActProgress,
  emptyRunStats,
  recordCombatEvents,
  recordFightSettled,
  startRun,
  travelTo,
  usePotionOutOfCombat,
} from '../src/state/run';
import { fromSaved, toSaved } from '../src/state/save';

/**
 * RunStats 埋点 — todos/22 的 s1。账本只进不出，且战斗内的数字只走
 * `CombatEvent` 回传：约定 8 不让引擎写 `RunState`，所以这里既测状态层
 * 自己的埋点（travelTo / addGold / 丹药），也测「引擎发事件、状态层记账」
 * 这条通道端到端是通的。
 */

describe('the ledger opens empty', () => {
  it('starts every counter at zero, whatever the seed', () => {
    expect(startRun(DEFAULT_HERO, 'stats-zero').stats).toEqual(emptyRunStats());
  });

  it('hands each run its own route array, not a shared one', () => {
    // `emptyRunStats` 是函数而非常量的原因：共享一份 `route` 会让两局互相记账。
    expect(emptyRunStats().route).not.toBe(emptyRunStats().route);
  });
});

describe('travelTo', () => {
  it('counts floors and writes the route down', () => {
    const run = startRun(DEFAULT_HERO, 'stats-route');
    const first = run.map.byRow[0][0];
    travelTo(run, first);
    const second = run.map.nodes.get(first)!.children[0];
    travelTo(run, second);

    expect(run.stats.floorsClimbed).toBe(2);
    expect(run.stats.route).toEqual([
      { act: 1, row: 0, type: run.map.nodes.get(first)!.type },
      { act: 1, row: 1, type: run.map.nodes.get(second)!.type },
    ]);
  });

  it('does not count a node the map has not got', () => {
    const run = startRun(DEFAULT_HERO, 'stats-route-miss');
    travelTo(run, 'no-such-node');
    expect(run.stats.floorsClimbed).toBe(0);
    expect(run.stats.route).toEqual([]);
  });

  it('keeps the route across an act wipe — that is what it is for', () => {
    // `path` 每幕清空（`clearActProgress`），路线是给结算界面看的跨幕史料。
    const run = startRun(DEFAULT_HERO, 'stats-route-act');
    travelTo(run, run.map.byRow[0][0]);
    clearActProgress(run);
    expect(run.path).toEqual([]);
    expect(run.stats.route).toHaveLength(1);
    expect(run.stats.floorsClimbed).toBe(1);
  });
});

describe('addGold', () => {
  it('books gains and spending into separate columns', () => {
    const run = startRun(DEFAULT_HERO, 'stats-gold');
    run.relics = []; // 关掉宝物加成，让数字直读。
    run.gold = 100;

    addGold(run, 40);
    expect(run.gold).toBe(140);
    expect(run.stats.goldEarned).toBe(40);
    expect(run.stats.goldSpent).toBe(0);

    addGold(run, -30);
    expect(run.gold).toBe(110);
    expect(run.stats.goldSpent).toBe(30);
    expect(run.stats.goldEarned).toBe(40);
  });

  it('books the multiplied gain — the purse and the ledger must agree', () => {
    const run = startRun(DEFAULT_HERO, 'stats-gold-relic');
    run.relics = [];
    addRelic(run, 'jubaopen'); // 所得资财 ×1.25
    run.gold = 0;
    addGold(run, 100);
    expect(run.gold).toBe(125);
    expect(run.stats.goldEarned).toBe(125);
  });

  it('books only what the floor at zero actually took', () => {
    const run = startRun(DEFAULT_HERO, 'stats-gold-floor');
    run.relics = [];
    run.gold = 20;
    addGold(run, -500);
    expect(run.gold).toBe(0);
    // 只丢得起 20，账上就只有 20 —— 账本记真发生过的事。
    expect(run.stats.goldSpent).toBe(20);
  });
});

describe('recordCombatEvents', () => {
  it('splits damage by target, counts deaths and potions, skips the rest', () => {
    const stats = emptyRunStats();
    const events: CombatEvent[] = [
      { t: 'damage', targetId: 'player', amount: 6, blocked: 2, lethal: false },
      { t: 'damage', targetId: 'e0', amount: 9, blocked: 0, lethal: false },
      // 被护甲全挡下：掉血 0，无伤判定也该视为无伤。
      { t: 'damage', targetId: 'player', amount: 0, blocked: 5, lethal: false },
      { t: 'death', targetId: 'e0' },
      // 逃走不是死，分裂也不是 —— 都不算斩获。
      { t: 'escape', targetId: 'e1' },
      { t: 'split', parentId: 'e2', spawned: ['e3', 'e4'] },
      { t: 'potion', potionId: 'huoyouguan' },
    ];

    const taken = recordCombatEvents(stats, events, 'player');
    expect(taken).toBe(6);
    expect(stats.damageTaken).toBe(6);
    expect(stats.damageDealt).toBe(9);
    expect(stats.enemiesSlain).toBe(1);
    expect(stats.potionsUsed).toBe(1);
  });

  it('books what a real fight reports, through the same channel the scene uses', () => {
    const run = startRun(DEFAULT_HERO, 'stats-engine');
    const state = startCombat({
      encounter: getEncounter(ACT1.weak[0].id),
      deck: run.deck,
      heroName: run.hero.name,
      hp: 30,
      maxHp: run.maxHp,
      relics: [],
      seed: 'stats-fight',
    });
    state.events.length = 0; // 开场抽牌只是动画，不入账。

    const enemyHp = state.enemies[0].hp;
    applyDamage(state, state.player, 7);
    applyDamage(state, state.enemies[0], enemyHp); // 击杀
    expect(usePotion(state, 'xumintang')).toBe(true);

    const taken = recordCombatEvents(run.stats, state.events.splice(0), state.player.id);
    expect(taken).toBe(7);
    expect(run.stats.damageTaken).toBe(7);
    expect(run.stats.damageDealt).toBe(enemyHp);
    expect(run.stats.enemiesSlain).toBe(1);
    expect(run.stats.potionsUsed).toBe(1);
    // 事件已被 drain 走，引擎侧没有第二本账可言。
    expect(state.events).toEqual([]);
  });
});

describe('recordFightSettled', () => {
  it('books elites and bosses by tier, flawless only at exactly zero', () => {
    const run = startRun(DEFAULT_HERO, 'stats-settle');

    recordFightSettled(run, 'monster', 0); // 杂兵不入此账，斩获走 death 事件。
    expect(run.stats).toEqual(emptyRunStats());

    recordFightSettled(run, 'elite', 0);
    recordFightSettled(run, 'elite', 12);
    recordFightSettled(run, 'boss', 0);
    recordFightSettled(run, 'boss', 1);

    expect(run.stats.elitesSlain).toBe(2);
    expect(run.stats.flawlessElites).toBe(1);
    expect(run.stats.bossesSlain).toBe(2);
    expect(run.stats.flawlessBosses).toBe(1);
  });
});

describe('丹药 out of combat', () => {
  it('counts a bottle actually drunk and not one refused', () => {
    const run = startRun(DEFAULT_HERO, 'stats-potion');
    run.hp = 10;
    addPotion(run, 'xumintang'); // 可在地图上喝
    addPotion(run, 'huoyouguan'); // 只能在战斗里用

    expect(usePotionOutOfCombat(run, 0)).toBe(true);
    expect(run.stats.potionsUsed).toBe(1);

    expect(usePotionOutOfCombat(run, 1)).toBe(false);
    expect(run.stats.potionsUsed).toBe(1);
  });
});

describe('the ledger survives a save', () => {
  it('rides the payload and comes back whole', () => {
    const run = startRun(DEFAULT_HERO, 'stats-save');
    travelTo(run, run.map.byRow[0][0]);
    addGold(run, 55);
    recordFightSettled(run, 'elite', 0);

    const back = fromSaved(JSON.parse(JSON.stringify(toSaved(run, null))));
    expect(back.stats).toEqual(run.stats);
  });
});
