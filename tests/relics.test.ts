import { describe, expect, it } from 'vitest';
import { resolveCard } from '../src/combat/cards';
import { ENCOUNTERS } from '../src/combat/enemies';
import {
  BASE_ENERGY,
  HAND_SIZE,
  addStatus,
  applyDamage,
  drawCards,
  endPlayerTurn,
  playCard,
  previewValues,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import {
  RELICS,
  fireRunHook,
  relicText,
  type CombatHook,
  type RelicHook,
} from '../src/combat/relics';
import type { CombatState, StatusId } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { addGold, addRelic, hasRelic, newDeckCard, startRun } from '../src/state/run';

/**
 * The relic system's two promises: a relic is pure data, and 关羽's passive
 * behaves exactly as it did when it was an `if` in the engine. The golden
 * snapshots in `sim/` are the real proof of the second one — these pin the
 * numbers close up so a failure says which part broke.
 */

const QINGLONG = RELICS.qinglongdao.value ?? 0;

function bench(relics: string[], copies = 20, seed = 'relic-bench'): CombatState {
  return startCombat({
    encounter: ENCOUNTERS.monster[0],
    deck: Array.from({ length: copies }, () => newDeckCard('pikan')),
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics,
    seed,
  });
}

describe('青龙偃月 as a relic', () => {
  it('deals the same first-attack bonus the hardcoded passive did', () => {
    const state = bench(['qinglongdao']);
    const enemy = state.enemies[0];

    let hp = enemy.hp;
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6 + QINGLONG);

    hp = enemy.hp;
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6);
  });

  it('shows the boosted number on the card face until it is spent', () => {
    const state = bench(['qinglongdao']);
    const def = resolveCard('pikan', 0);

    expect(previewValues(state, def).D).toBe(6 + QINGLONG);
    playCard(state, state.hand[0], state.enemies[0].id);
    expect(previewValues(state, def).D).toBe(6);
  });

  it('recharges every turn, and the face agrees again', () => {
    const state = bench(['qinglongdao']);
    playCard(state, state.hand[0], state.enemies[0].id);

    endPlayerTurn(state);
    runEnemyTurn(state);

    expect(state.attacksThisTurn).toBe(0);
    expect(previewValues(state, resolveCard('pikan', 0)).D).toBe(6 + QINGLONG);
  });

  it('announces itself with the same banner event, once per turn', () => {
    const state = bench(['qinglongdao']);
    state.events.length = 0;
    playCard(state, state.hand[0], state.enemies[0].id);
    playCard(state, state.hand[0], state.enemies[0].id);

    expect(state.events.filter((e) => e.t === 'passive')).toEqual([
      { t: 'passive', label: '青龙偃月' },
    ]);
  });

  it('does nothing at all without the relic', () => {
    const state = bench([]);
    const enemy = state.enemies[0];
    const hp = enemy.hp;

    expect(previewValues(state, resolveCard('pikan', 0)).D).toBe(6);
    playCard(state, state.hand[0], enemy.id);
    expect(hp - enemy.hp).toBe(6);
    expect(state.events.some((e) => e.t === 'passive')).toBe(false);
  });
});

describe('static modifiers', () => {
  it('gives 赤兔马 a fourth 气 and takes a card off the draw', () => {
    const state = bench(['chitima']);

    expect(state.maxEnergy).toBe(BASE_ENERGY + 1);
    expect(state.energy).toBe(BASE_ENERGY + 1);
    expect(state.handSize).toBe(HAND_SIZE - 1);
    expect(state.hand).toHaveLength(HAND_SIZE - 1);

    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(state.energy).toBe(BASE_ENERGY + 1);
    expect(state.hand).toHaveLength(HAND_SIZE - 1);
  });

  it('leaves the baseline alone with no relics', () => {
    const state = bench([]);
    expect(state.maxEnergy).toBe(BASE_ENERGY);
    expect(state.hand).toHaveLength(HAND_SIZE);
  });

  it('starts 先登盾 with block that survives the turn-one wipe', () => {
    const state = bench(['xiandengdun']);
    expect(state.player.block).toBe(RELICS.xiandengdun.value);

    // ... and is wiped like any other block on the turns after.
    endPlayerTurn(state);
    runEnemyTurn(state);
    expect(state.player.block).toBe(0);
  });

  it('raises max HP at the start of a run and on pickup', () => {
    const plain = startRun(DEFAULT_HERO, 'mods-seed');
    expect(plain.maxHp).toBe(DEFAULT_HERO.maxHp);

    const armoured = startRun({ ...DEFAULT_HERO, starterRelic: 'xuanjia' }, 'mods-seed');
    expect(armoured.maxHp).toBe(DEFAULT_HERO.maxHp + 8);
    expect(armoured.hp).toBe(armoured.maxHp);

    const run = startRun(DEFAULT_HERO, 'mods-seed');
    run.hp = 40;
    expect(addRelic(run, 'xuanjia')).toBe(true);
    expect(run.maxHp).toBe(DEFAULT_HERO.maxHp + 8);
    expect(run.hp).toBe(48);
  });

  it('scales gold gains but not gold spent', () => {
    const run = startRun(DEFAULT_HERO, 'gold-seed');
    run.gold = 0;
    addGold(run, 40);
    expect(run.gold).toBe(40);

    addRelic(run, 'jubaopen');
    addGold(run, 40);
    expect(run.gold).toBe(40 + 50);
    addGold(run, -30);
    expect(run.gold).toBe(60);
  });
});

describe('counter relics', () => {
  it('accumulates 督军令旗 across turns and pays out on the third card', () => {
    const state = bench(['dujunlingqi']);
    const enemy = state.enemies[0];

    playCard(state, state.hand[0], enemy.id);
    playCard(state, state.hand[0], enemy.id);
    expect(state.relicCounters.dujunlingqi).toBe(2);
    expect(state.player.block).toBe(0);

    endPlayerTurn(state);
    runEnemyTurn(state);
    // The counter is deliberately not a per-turn one: it carries over.
    expect(state.relicCounters.dujunlingqi).toBe(2);

    state.player.block = 0;
    playCard(state, state.hand[0], enemy.id);
    expect(state.player.block).toBe(RELICS.dujunlingqi.value);
    expect(state.relicCounters.dujunlingqi).toBe(0);
    expect(state.events.some((e) => e.t === 'relic' && e.relicId === 'dujunlingqi')).toBe(true);
  });

  it('resets counters between combats', () => {
    const first = bench(['dujunlingqi']);
    playCard(first, first.hand[0], first.enemies[0].id);
    playCard(first, first.hand[0], first.enemies[0].id);
    expect(first.relicCounters.dujunlingqi).toBe(2);

    const second = bench(['dujunlingqi'], 20, 'relic-bench-2');
    expect(second.relicCounters).toEqual({});

    playCard(second, second.hand[0], second.enemies[0].id);
    playCard(second, second.hand[0], second.enemies[0].id);
    expect(second.player.block).toBe(0);
  });

  it('gives 铁面 its draw once per fight, and only on real HP loss', () => {
    const state = bench(['tiemian']);
    const held = state.hand.length;

    // Fully absorbed: no HP came off, so the relic must stay asleep.
    state.player.block = 10;
    applyDamage(state, state.player, 5);
    expect(state.hand).toHaveLength(held);

    applyDamage(state, state.player, 12);
    expect(state.hand).toHaveLength(held + (RELICS.tiemian.value ?? 0));

    applyDamage(state, state.player, 12);
    expect(state.hand).toHaveLength(held + (RELICS.tiemian.value ?? 0));
    expect(state.events.filter((e) => e.t === 'relic' && e.relicId === 'tiemian')).toHaveLength(1);
  });
});

/**
 * 宝物 hand over their printed number. `gainBlock`'s `source` used to default to
 * `'card'`, so every relic that granted block was quietly run through 身法/力竭
 * — a relic promising 6 護甲 gave 4 under 力竭 and 9 under 身法 3. No shipped
 * content applies either status yet, which is exactly why nothing caught it:
 * these tests put the status on the player by hand.
 */
describe('relic block ignores 身法 / 力竭', () => {
  const SHAPERS: [StatusId, number][] = [
    ['frail', 1],
    ['dexterity', 3],
  ];

  /** Each hook-driven grant, and the thing that makes it pay out. */
  const PAYOUTS: { id: string; fire: (state: CombatState) => void }[] = [
    { id: 'xuanwujia', fire: (state) => endPlayerTurn(state) },
    {
      id: 'dujunlingqi',
      fire: (state) => {
        for (let i = 0; i < 3; i++) playCard(state, state.hand[0], state.enemies[0].id);
      },
    },
    {
      id: 'xingjuntu',
      fire: (state) => {
        state.discardPile.push(...state.drawPile.splice(0));
        drawCards(state, 1);
      },
    },
  ];

  for (const { id, fire } of PAYOUTS) {
    for (const [status, amount] of SHAPERS) {
      it(`${RELICS[id].name} pays its printed number under ${status} ${amount}`, () => {
        const state = bench([id]);
        addStatus(state, state.player, status, amount);
        state.player.block = 0;
        fire(state);
        expect(state.player.block).toBe(RELICS[id].value);
      });
    }
  }

  // The two that land before the player can be holding a status at all. They
  // still have to go in unshaped, which is a property of the call and not of
  // the fight, so the assertion is that the printed number arrives whole.
  it('束发金冠 and 先登盾 open the fight with exactly their printed number', () => {
    expect(bench(['shufajinguan']).player.block).toBe(RELICS.shufajinguan.value);
    expect(bench(['xiandengdun']).player.block).toBe(RELICS.xiandengdun.value);
  });
});

describe('hooks outside combat', () => {
  it('pays 行商符节 on entering a room', () => {
    const run = startRun(DEFAULT_HERO, 'room-seed');
    run.gold = 0;
    addRelic(run, 'xingshangfujie');

    expect(fireRunHook(run, 'roomEnter', 'monster')).toEqual(['xingshangfujie']);
    expect(run.gold).toBe(RELICS.xingshangfujie.value);

    fireRunHook(run, 'roomEnter', 'rest');
    expect(run.gold).toBe((RELICS.xingshangfujie.value ?? 0) * 2);
  });

  it('runs the payout through the gold multiplier like any other gain', () => {
    const run = startRun(DEFAULT_HERO, 'room-seed');
    run.gold = 0;
    addRelic(run, 'xingshangfujie');
    addRelic(run, 'jubaopen');

    fireRunHook(run, 'roomEnter', 'shop');
    expect(run.gold).toBe(Math.floor(5 * 1.25));
  });

  it('fires nothing for a run that owns no such relic', () => {
    const run = startRun(DEFAULT_HERO, 'room-seed');
    const gold = run.gold;
    expect(fireRunHook(run, 'roomEnter', 'monster')).toEqual([]);
    expect(run.gold).toBe(gold);
  });
});

describe('run relics', () => {
  it('starts with the hero own starter relic and refuses duplicates', () => {
    const run = startRun(DEFAULT_HERO, 'own-seed');
    expect(run.relics).toEqual([DEFAULT_HERO.starterRelic]);
    expect(hasRelic(run, 'qinglongdao')).toBe(true);

    expect(addRelic(run, 'qinglongdao')).toBe(false);
    expect(addRelic(run, 'not-a-relic')).toBe(false);
    expect(addRelic(run, 'chitima')).toBe(true);
    expect(run.relics).toEqual(['qinglongdao', 'chitima']);
  });
});

// ------------------------------------------------------------------ the table

const SOURCES = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const COMBAT_HOOKS: CombatHook[] = [
  'combatStart',
  'turnStart',
  'turnEnd',
  'enemyTurnEnd',
  'cardPlayed',
  'attackPlayed',
  'damageTaken',
  'blockGained',
  'enemyKilled',
  'shuffle',
  'combatEnd',
];

describe('relic table', () => {
  it('keys every entry by its own id and its own art key', () => {
    for (const [key, def] of Object.entries(RELICS)) {
      expect(def.id, key).toBe(key);
      expect(def.art, key).toBe(`relic-${key}`);
      expect(def.name.length, key).toBeGreaterThan(0);
    }
  });

  it('leaves no placeholder unfilled in any relic text', () => {
    for (const def of Object.values(RELICS)) {
      expect(relicText(def), def.id).not.toMatch(/\{N\}/);
      if (def.text.includes('{N}')) expect(def.value, def.id).toBeTypeOf('number');
    }
  });

  it('covers every hook with at least one relic', () => {
    const used = new Set<RelicHook>();
    for (const def of Object.values(RELICS)) {
      for (const hook of Object.keys(def.hooks ?? {}) as RelicHook[]) used.add(hook);
    }
    const missing = [...COMBAT_HOOKS, 'roomEnter'].filter((h) => !used.has(h as RelicHook));
    expect(missing).toEqual([]);
  });

  it('has an engine trigger point for every combat hook', () => {
    // A hook nothing fires is a relic that silently never works, and the type
    // system cannot catch it — so read the engine and check.
    const engine = SOURCES['../src/combat/engine.ts'];
    const unfired = COMBAT_HOOKS.filter((h) => !engine.includes(`fireHook(state, '${h}'`));
    expect(unfired).toEqual([]);
  });

  it('fires the room hook once per node, through the commit gate', () => {
    // Room dispatch moved out of MapScene into nav.ts; the hook must still be
    // fired, and must sit behind `commit.once` — 行商符节 pays 5 资财 on entry,
    // and re-entering a node (or reloading onto it) must not pay it twice.
    const nav = SOURCES['../src/scenes/nav.ts'];
    expect(nav).toContain("fireRunHook(run, 'roomEnter'");
    expect(nav).toMatch(/roomCommit\(run, node\.id\)\.once\('enter'/);
  });

  it('keeps the engine free of relic-specific branches', () => {
    const engine = SOURCES['../src/combat/engine.ts'];
    for (const id of Object.keys(RELICS)) expect(engine, id).not.toContain(id);
    expect(engine).not.toContain('青龙偃月');
  });
});
