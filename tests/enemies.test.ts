import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import {
  ACT1,
  ACT_TABLES,
  ENEMIES,
  FINAL,
  PENDING_ENCOUNTERS,
  allEncounters,
  getEncounter,
  getEnemy,
  pickEncounter,
} from '../src/combat/enemies';
import { intentLabel } from '../src/combat/intent';
import {
  addStatus,
  endPlayerTurn,
  gainBlock,
  pickIntent,
  resolveDamage,
  runEnemyTurn,
  stacks,
  startCombat,
} from '../src/combat/engine';
import type { CombatEvent, CombatState, EnemyState, Encounter } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, type DeckCard } from '../src/state/run';

/**
 * 敌人机制 (todos/15). Every mechanic the move table can express, driven against
 * the real content rows and pinned to numbers — "it did not crash" is not a
 * result here, because every one of these is a damage or a resource swing the
 * player has to be able to plan around.
 *
 * Fights are built from ad-hoc encounters rather than the shipped tables so a
 * mechanic can be isolated: `probe(['guanhai'])` is 管亥 alone, whatever room
 * he actually shows up in.
 */

const deck = (defId: string, n: number): DeckCard[] =>
  Array.from({ length: n }, () => newDeckCard(defId));

/** A fight with no relics and a player who will not die mid-probe. */
function probe(enemies: string[], seed = 'enemy-probe', cards = deck('pikan', 10)): CombatState {
  const encounter: Encounter = { id: 'probe', name: 'probe', enemies, goldReward: [0, 0] };
  return startCombat({
    encounter,
    deck: cards,
    heroName: DEFAULT_HERO.name,
    hp: 999,
    maxHp: 999,
    relics: [],
    seed,
  });
}

/** Hands the turn over and takes it back, i.e. runs one full enemy turn. */
function enemyTurn(state: CombatState): void {
  endPlayerTurn(state);
  runEnemyTurn(state);
}

/**
 * The same, with the following draw suppressed. 断粮 is applied after the hand
 * has been discarded and before the enemy moves, so the piles the enemy left
 * behind can be read exactly — otherwise the five cards `startPlayerTurn` deals
 * would have already pulled whatever it buried.
 */
function enemyTurnFrozen(state: CombatState): void {
  endPlayerTurn(state);
  addStatus(state, state.player, 'noDraw', 1);
  runEnemyTurn(state);
}

/** A real attack from the player, so 龟缩 / 暴怒 / 反刺 all see it as one. */
function hit(state: CombatState, enemy: EnemyState, base: number): void {
  resolveDamage(state, {
    attacker: state.player,
    defender: enemy,
    base,
    isAttack: true,
    pierceBlock: false,
  });
}

const drain = (state: CombatState): CombatEvent[] => state.events.splice(0);
const kinds = (events: CombatEvent[], t: CombatEvent['t']): CombatEvent[] =>
  events.filter((e) => e.t === t);

// --------------------------------------------------------------- 冻结的四人

/**
 * The four enemies the 26 golden snapshots are built on. Their numbers are
 * frozen: this is the cheap guard that catches a passive or a threshold being
 * bolted onto 吕布 in a later pass, which would silently rewrite every one of
 * those files.
 */
describe('the original four are frozen', () => {
  const FROZEN: Record<string, { hp: [number, number]; moves: string }> = {
    yellowturban: { hp: [42, 50], moves: 'chop:9x1/0 roar:0x1/0 guard:5x1/6' },
    bandit: { hp: [28, 34], moves: 'slash:5x2/0 ambush:4x1/0' },
    huaxiong: { hp: [88, 96], moves: 'cleave:15x1/0 sweep:7x3/0 fury:0x1/8' },
    lubu: { hp: [150, 150], moves: 'ji:16x1/0 storm:6x3/0 sunder:9x1/0 peerless:0x1/12' },
  };

  for (const [id, want] of Object.entries(FROZEN)) {
    it(id, () => {
      const def = getEnemy(id);
      expect(def.hp).toEqual(want.hp);
      expect(
        def.moves.map((m) => `${m.id}:${m.damage ?? 0}x${m.hits ?? 1}/${m.block ?? 0}`).join(' '),
      ).toBe(want.moves);
      // None of todos/15's fields may appear on them.
      expect(def.passives).toBeUndefined();
      expect(def.script).toBeUndefined();
      expect(def.phases).toBeUndefined();
      expect(def.thresholds).toBeUndefined();
      expect(def.hiddenFirstIntent).toBeUndefined();
    });
  }
});

// ------------------------------------------------------------------- 被动

describe('被动 · 龟缩', () => {
  it('gives 董卓亲兵 its printed armour on the first wound and never again', () => {
    const state = probe(['dongzhuoqinbing']);
    const guard = state.enemies[0];
    expect(stacks(guard, 'curlUp')).toBe(8);
    expect(guard.block).toBe(0);

    hit(state, guard, 6);
    expect(guard.block).toBe(8);
    expect(stacks(guard, 'curlUp')).toBe(0);

    // Second wound: the status is spent, so this one costs the enemy outright.
    const hpBefore = guard.hp;
    hit(state, guard, 6);
    expect(guard.block).toBe(2); // 8 armour, 6 of it eaten
    expect(guard.hp).toBe(hpBefore);
    expect(stacks(guard, 'curlUp')).toBe(0);
  });

  it('does not fire on a blow the enemy fully blocked', () => {
    const state = probe(['dongzhuoqinbing']);
    const guard = state.enemies[0];
    gainBlock(state, guard, 20, 'power');

    hit(state, guard, 6);
    expect(stacks(guard, 'curlUp')).toBe(8);
    expect(guard.block).toBe(14);
  });

  it('is printed on the body, not applied to it — no status event, no 护身符 cost', () => {
    const state = probe(['dongzhuoqinbing']);
    const opening = kinds(drain(state), 'status');
    expect(opening.filter((e) => e.t === 'status' && e.targetId.startsWith('dongzhuo'))).toEqual([]);
  });
});

describe('被动 · 暴怒', () => {
  it('gives 管亥 神力 per wound and shows it in the telegraph', () => {
    const state = probe(['guanhai']);
    const gh = state.enemies[0];
    expect(stacks(gh, 'angry')).toBe(1);
    expect(stacks(gh, 'strength')).toBe(0);

    hit(state, gh, 5);
    expect(stacks(gh, 'strength')).toBe(1);
    hit(state, gh, 5);
    expect(stacks(gh, 'strength')).toBe(2);

    // The badge over his head has to read the number he will actually swing for.
    gh.intent = getEnemy('guanhai').moves.find((m) => m.id === 'axe')!;
    expect(intentLabel(state, gh)).toBe('攻 15'); // 13 + 2 神力
  });

  it('ignores a blow that drew no blood', () => {
    const state = probe(['guanhai']);
    const gh = state.enemies[0];
    gainBlock(state, gh, 30, 'power');

    hit(state, gh, 9);
    expect(stacks(gh, 'strength')).toBe(0);
  });
});

// ------------------------------------------------------------------- 血线

describe('血线触发', () => {
  it('hands 管亥 exactly one lump of 神力 as he crosses half, and shouts once', () => {
    const state = probe(['guanhai']);
    const gh = state.enemies[0];
    const half = Math.floor(gh.maxHp / 2);

    // One point above the line: nothing yet.
    hit(state, gh, gh.hp - half - 1);
    expect(gh.crossed).toEqual([]);
    // 暴怒 1 has fired once for that wound and nothing else has.
    expect(stacks(gh, 'strength')).toBe(1);

    drain(state);
    hit(state, gh, 2);
    expect(gh.crossed).toEqual([0]);
    // +1 暴怒 for this wound, +2 from the line.
    expect(stacks(gh, 'strength')).toBe(4);
    expect(kinds(drain(state), 'shout')).toEqual([
      { t: 'shout', enemyId: gh.id, text: '「困兽犹斗！」' },
    ]);

    // Every wound after it is just a wound.
    drain(state);
    hit(state, gh, 3);
    expect(stacks(gh, 'strength')).toBe(5);
    expect(kinds(drain(state), 'shout')).toEqual([]);
  });

  it('does not fire on the blow that kills', () => {
    const state = probe(['guanhai']);
    const gh = state.enemies[0];
    drain(state);

    hit(state, gh, gh.hp);
    expect(gh.alive).toBe(false);
    expect(gh.crossed).toEqual([]);
    const events = drain(state);
    expect(kinds(events, 'shout')).toEqual([]);
    expect(kinds(events, 'death')).toHaveLength(1);
  });
});

describe('半血分裂', () => {
  it('splits 张宝 inside the blow that crossed the line', () => {
    const state = probe(['zhangbao']);
    const boss = state.enemies[0];
    const half = Math.floor(boss.maxHp / 2);
    drain(state);

    hit(state, boss, boss.hp - half + 6); // lands 6 under half
    const left = boss.hp;
    expect(left).toBe(half - 6);

    // Parent leaves without dying.
    expect(boss.alive).toBe(false);
    expect(boss.escaped).toBe(false);
    expect(boss.intent).toBeNull();
    expect(boss.hp).toBeGreaterThan(0);

    const children = state.enemies.filter((e) => e.defId === 'zhangbaofenshen');
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.hp).toBe(Math.ceil(left / 2));
      expect(child.maxHp).toBe(Math.ceil(left / 2));
      expect(child.alive).toBe(true);
      expect(child.intent).not.toBeNull();
    }
    // Distinct bodies in distinct places.
    expect(new Set(state.enemies.map((e) => e.id)).size).toBe(3);
    expect(state.enemies.map((e) => e.slot)).toEqual([0, 1, 2]);

    const events = drain(state);
    // A split is not a death: no death event, so no reward and no 斩将.
    expect(kinds(events, 'death')).toEqual([]);
    expect(kinds(events, 'split')).toEqual([
      { t: 'split', parentId: boss.id, spawned: children.map((c) => c.id) },
    ]);
  });

  it('pays no kill trigger for the parent', () => {
    const state = probe(['zhangbao']);
    const boss = state.enemies[0];
    addStatus(state, state.player, 'slayer', 3);

    hit(state, boss, Math.ceil(boss.maxHp / 2) + 1);
    expect(state.enemies[0].alive).toBe(false);
    expect(stacks(state.player, 'strength')).toBe(0);
  });

  it('lets the halves take the very next turn', () => {
    const state = probe(['zhangbao']);
    const boss = state.enemies[0];
    hit(state, boss, Math.ceil(boss.maxHp / 2) + 1);
    drain(state);

    enemyTurn(state);
    const movers = kinds(drain(state), 'enemyMove').map((e) => (e.t === 'enemyMove' ? e.enemyId : ''));
    expect(movers).toEqual(state.enemies.slice(1).map((e) => e.id));
  });
});

// ------------------------------------------------------------------- 召唤

describe('召唤', () => {
  it('brings two 黄巾力士 in on unique ids and slots', () => {
    const state = probe(['zhangmancheng']);
    const boss = state.enemies[0];
    boss.intent = getEnemy('zhangmancheng').moves.find((m) => m.id === 'muster')!;
    drain(state);

    enemyTurn(state);
    const spawned = state.enemies.filter((e) => e.defId === 'yellowturban');
    expect(spawned).toHaveLength(2);
    expect(state.enemies.map((e) => e.slot)).toEqual([0, 1, 2]);
    expect(new Set(state.enemies.map((e) => e.id)).size).toBe(3);
    for (const e of spawned) {
      expect(e.alive).toBe(true);
      expect(e.hp).toBeGreaterThan(0);
      expect(e.intent, 'a summon arrives already telegraphing').not.toBeNull();
    }
  });

  it('does not let a summon act on the turn it was called', () => {
    const state = probe(['zhangmancheng']);
    state.enemies[0].intent = getEnemy('zhangmancheng').moves.find((m) => m.id === 'muster')!;
    drain(state);

    enemyTurn(state);
    // One mover this turn: the summoner. The two 力士 wait their turn.
    expect(kinds(drain(state), 'enemyMove')).toHaveLength(1);
    expect(state.enemies.filter((e) => e.actedTurns === 0)).toHaveLength(2);

    enemyTurn(state);
    expect(kinds(drain(state), 'enemyMove')).toHaveLength(3);
  });

  it('stops calling once the field is full', () => {
    const state = probe(['zhangmancheng']);
    const def = getEnemy('zhangmancheng');
    state.enemies[0].intent = def.moves.find((m) => m.id === 'muster')!;
    enemyTurn(state);

    // 聚众 is gated on `alliesAtMost: 1`; with two 力士 up it is off the table.
    for (let i = 0; i < 40; i++) {
      enemyTurn(state);
      if (state.enemies.length > 3) break;
    }
    expect(state.enemies).toHaveLength(3);
  });
});

// ------------------------------------------------------------------- 逃跑

describe('遁走', () => {
  it('has 流寇 lift 30 资财 and leave without dying', () => {
    const state = probe(['liukou']);
    const thief = state.enemies[0];
    addStatus(state, state.player, 'slayer', 3);

    // Scripted: 摸金, 摸金, 遁走.
    enemyTurn(state);
    enemyTurn(state);
    expect(thief.alive).toBe(true);
    drain(state);

    enemyTurn(state);
    const events = drain(state);
    expect(kinds(events, 'steal')).toEqual([{ t: 'steal', enemyId: thief.id, amount: 30 }]);
    expect(kinds(events, 'escape')).toEqual([{ t: 'escape', targetId: thief.id }]);
    expect(kinds(events, 'death')).toEqual([]);

    expect(thief.alive).toBe(false);
    expect(thief.escaped).toBe(true);
    expect(thief.intent).toBeNull();
    expect(thief.hp).toBeGreaterThan(0);
    // No kill hook: 斩将 must not pay out for a thief who got away.
    expect(stacks(state.player, 'strength')).toBe(0);
  });

  it('ends the fight in a win when the last body flees', () => {
    const state = probe(['liukou']);
    enemyTurn(state);
    enemyTurn(state);
    enemyTurn(state);
    expect(state.phase).toBe('won');
  });

  it('leaves the rest of the room fighting', () => {
    const state = probe(['liukou', 'bandit']);
    for (let i = 0; i < 3; i++) enemyTurn(state);
    expect(state.enemies[0].escaped).toBe(true);
    expect(state.phase).toBe('player');
    expect(state.enemies[1].alive).toBe(true);
  });
});

// ------------------------------------------------------------------- 脚本

describe('脚本化意图', () => {
  const EXPECTED = [
    'curse', 'gale', 'sigil', 'drums', 'surge',
    // `loopFrom: 1` — 咒水 opens the fight once and never returns.
    'gale', 'sigil', 'drums', 'surge', 'gale',
  ];

  it('gives 张梁 the same ten beats under ten different seeds', () => {
    for (let s = 0; s < 10; s++) {
      const state = probe(['zhangliang'], `script-${s}`);
      const seen: string[] = [];
      for (let turn = 0; turn < EXPECTED.length; turn++) {
        seen.push(state.enemies[0].intent!.id);
        enemyTurn(state);
      }
      expect(seen, `seed ${s}`).toEqual(EXPECTED);
    }
  });

  /**
   * Two passes of every 套路 in the game, written out.
   *
   * `loopFrom` had exactly one behavioural assertion in the whole suite —
   * 张梁's, above — so the field was guarded on the one enemy that happens to
   * skip its opening move. 流寇's `loopFrom: 2` could be set to 0 and the suite
   * stayed green, because 遁走 ends the fight before the wrap is ever observed.
   *
   * Spelled out as literals rather than derived from `script.order` and
   * `script.loopFrom`: a check that recomputes the expected sequence from the
   * same two fields it is checking passes for *every* value of them. That is
   * the mistake this comment exists to stop the next person repeating.
   */
  const LOOPS: Record<string, string> = {
    // `loopFrom: 1` — 咒水 opens and never returns.
    zhangliang: 'curse,gale,sigil,drums,surge,gale,sigil,drums,surge,gale,sigil',
    // `loopFrom: 2` — two 摸金 and then 遁走 forever. Unobservable in a real
    // fight, because 遁走 takes him off the field; that is why it went unpinned.
    liukou: 'rob,rob,bolt,bolt,bolt,bolt,bolt',
    // `loopFrom: 0` — the whole rotation repeats.
    liru: 'jiaozhao,luanzheng,chenmou,zhenjiu,fenjing,jiaozhao,luanzheng,chenmou,zhenjiu,fenjing,jiaozhao',
    xiahouyuan: 'gallop,raid,banner,strike,deluge,gallop,raid,banner,strike,deluge,gallop',
    tianming:
      'autumnwind,lifespan,wuzhang,defy,starfall,dust,autumnwind,lifespan,wuzhang,defy,starfall,dust,autumnwind',
  };

  it('covers every scripted enemy in the game', () => {
    const scripted = Object.values(ENEMIES)
      .filter((def) => def.script)
      .map((def) => def.id)
      .sort();
    expect(scripted).toEqual(Object.keys(LOOPS).sort());
  });

  for (const [id, expected] of Object.entries(LOOPS)) {
    it(`${ENEMIES[id].name} runs its rotation and wraps where it says`, () => {
      // Driven off `pickIntent` with a hand-set cursor rather than off real
      // turns, which is what lets an enemy that leaves the field be checked.
      const state = probe([id], `loop-${id}`);
      const enemy = state.enemies[0];
      const beats = expected.split(',');
      const seen = beats.map((_, i) => {
        enemy.actedTurns = i;
        pickIntent(state, enemy);
        return enemy.intent!.id;
      });
      expect(seen.join(',')).toBe(expected);
    });
  }

  it('indexes off the enemy, not the turn counter', () => {
    // A summon that joins on turn 4 starts its own script at the beginning; the
    // 力士 has none, so the check is that a mid-fight arrival's cursor is zero.
    const state = probe(['zhangmancheng']);
    state.enemies[0].intent = getEnemy('zhangmancheng').moves.find((m) => m.id === 'muster')!;
    enemyTurn(state);
    enemyTurn(state);
    expect(state.enemies[0].actedTurns).toBe(2);
    expect(state.enemies[1].actedTurns).toBe(1);
  });

  it('rolls no dice at all while a script is running', () => {
    const state = probe(['zhangliang'], 'script-rolls');
    const before = state.rng.rolls;
    // Two turns of telegraphing, minus everything the turn cycle itself draws:
    // measured by comparing against the same fight with a rolled table.
    enemyTurn(state);
    const scripted = state.rng.rolls - before;

    const rolled = probe(['huaxiong'], 'script-rolls');
    const rolledBefore = rolled.rng.rolls;
    enemyTurn(rolled);
    expect(scripted).toBeLessThan(rolled.rng.rolls - rolledBefore);
  });
});

// --------------------------------------------------------------- 条件招式

describe('招式门槛', () => {
  it('keeps 传道 off the table until 黄巾祭酒 has company', () => {
    const solo = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const state = probe(['jijiu'], `solo-${s}`);
      for (let i = 0; i < 6; i++) {
        solo.add(state.enemies[0].intent!.id);
        enemyTurn(state);
      }
    }
    expect([...solo].sort()).toEqual(['staff', 'talisman']);

    const crowd = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const state = probe(['jijiu', 'luanmin'], `crowd-${s}`);
      for (let i = 0; i < 6; i++) {
        crowd.add(state.enemies[0].intent!.id);
        enemyTurn(state);
      }
    }
    expect(crowd.has('preach')).toBe(true);
  });

  it('unlocks 管亥 血战 only under half', () => {
    const state = probe(['guanhai'], 'rage-gate');
    const gh = state.enemies[0];

    const above = new Set<string>();
    for (let i = 0; i < 60; i++) {
      pickIntent(state, gh);
      above.add(gh.intent!.id);
    }
    expect(above.has('deathfight')).toBe(false);

    gh.hp = Math.floor(gh.maxHp / 2) - 1;
    const below = new Set<string>();
    for (let i = 0; i < 60; i++) {
      pickIntent(state, gh);
      below.add(gh.intent!.id);
    }
    expect(below.has('deathfight')).toBe(true);
  });
});

// ------------------------------------------------------- 群体状态 / 直接扣血

describe('群体状态与直接扣血', () => {
  it('has 传道 buff every living body on its side and nobody else', () => {
    const state = probe(['jijiu', 'luanmin', 'luanmin']);
    state.enemies[0].intent = getEnemy('jijiu').moves.find((m) => m.id === 'preach')!;
    state.enemies[2].hp = 0;
    state.enemies[2].alive = false;
    state.enemies[2].intent = null;

    enemyTurn(state);
    expect(stacks(state.enemies[0], 'strength')).toBe(1);
    expect(stacks(state.enemies[1], 'strength')).toBe(1);
    expect(stacks(state.enemies[2], 'strength')).toBe(0);
    expect(stacks(state.player, 'strength')).toBe(0);
  });

  it('has 太平符水 go straight through 护甲', () => {
    const state = probe(['jijiu']);
    state.enemies[0].intent = getEnemy('jijiu').moves.find((m) => m.id === 'talisman')!;
    gainBlock(state, state.player, 30, 'relic');
    const hp = state.player.hp;
    drain(state);

    enemyTurn(state);
    expect(state.player.hp).toBe(hp - 4);
    // Not one point of the wall was spent on it.
    expect(kinds(drain(state), 'damage').filter((e) => e.t === 'damage' && e.targetId === 'player'))
      .toEqual([{ t: 'damage', targetId: 'player', amount: 4, blocked: 0, lethal: false }]);
  });
});

// ------------------------------------------------------------------- 塞牌

describe('牌组污染', () => {
  it('buries exactly two 创伤 in the draw pile', () => {
    const state = probe(['tieqi'], 'dust', deck('pikan', 6));
    state.enemies[0].intent = getEnemy('tieqi').moves.find((m) => m.id === 'dust')!;
    const before = Object.keys(state.cards).length;

    enemyTurnFrozen(state);
    const minted = Object.values(state.cards).filter((c) => c.defId === 'chuangshang');
    expect(minted).toHaveLength(2);
    expect(Object.keys(state.cards)).toHaveLength(before + 2);
    // Into the draw pile, so the player cannot see when they will surface.
    for (const card of minted) expect(state.drawPile).toContain(card.uid);

    // Still exactly one home per card.
    const piles = [...state.drawPile, ...state.hand, ...state.discardPile, ...state.exhaustPile];
    expect(new Set(piles).size).toBe(Object.keys(state.cards).length);
  });

  it('has 太平符水 clog the discard pile with 泥泞', () => {
    const state = probe(['jijiu'], 'mire', deck('pikan', 6));
    state.enemies[0].intent = getEnemy('jijiu').moves.find((m) => m.id === 'talisman')!;
    enemyTurnFrozen(state);

    const minted = Object.values(state.cards).filter((c) => c.defId === 'nining');
    expect(minted).toHaveLength(1);
    expect(state.discardPile).toContain(minted[0].uid);
  });
});

// --------------------------------------------------------------- 意图显示

describe('意图不可知', () => {
  it('hides 黄巾骑手 opening telegraph and shows it from the second turn', () => {
    const state = probe(['qishou']);
    const rider = state.enemies[0];
    expect(intentLabel(state, rider)).toBe('？');

    enemyTurn(state);
    expect(rider.actedTurns).toBe(1);
    expect(intentLabel(state, rider)).not.toBe('？');
    expect(intentLabel(state, rider)).toMatch(/^攻 /);
  });

  it('leaves ordinary enemies telegraphing from the first bell', () => {
    const state = probe(['yellowturban', 'huaxiong', 'lubu']);
    for (const enemy of state.enemies) expect(intentLabel(state, enemy)).not.toBe('？');
  });

  it('labels the new move shapes', () => {
    const state = probe(['zhangmancheng']);
    const boss = state.enemies[0];
    const def = getEnemy('zhangmancheng');

    boss.intent = def.moves.find((m) => m.id === 'muster')!;
    expect(intentLabel(state, boss)).toBe('召');

    // 遁走 takes 30 資財 with it. Printing a bare 「遁」 told the player the
    // enemy was leaving and not that it was leaving with their money.
    boss.intent = getEnemy('liukou').moves.find((m) => m.id === 'bolt')!;
    expect(intentLabel(state, boss)).toBe('遁 · 夺 30');

    // 太平符水 is 4 直接扣血 *and* a 泥泞 into the discard pile.
    boss.intent = getEnemy('jijiu').moves.find((m) => m.id === 'talisman')!;
    expect(intentLabel(state, boss)).toBe('伤 4 · 塞牌 1');
  });

  it('names the status a rider actually applies instead of calling it 弱', () => {
    // The bug: every `status` rider printed 「弱」. 踏阵 and 破军 both apply
    // 破绽 — "he is about to make my next wound worse" — and the label said
    // "he is about to cut my damage", which is the opposite defence.
    const state = probe(['qishou']);
    const rider = state.enemies[0];
    // 黄巾骑手 hides its first intent; this is about the second one onwards.
    rider.actedTurns = 1;

    rider.intent = getEnemy('qishou').moves.find((m) => m.id === 'trample')!;
    expect(intentLabel(state, rider)).toBe('攻 7 · 破绽');

    rider.intent = getEnemy('lubu').moves.find((m) => m.id === 'sunder')!;
    expect(intentLabel(state, rider)).toContain(' · 破绽');
    expect(intentLabel(state, rider)).not.toContain('弱');

    // A move that really does apply 怯战 still says so.
    const weakening = getEnemy('huaxiong').moves.find((m) => m.status?.status === 'weak');
    if (weakening) {
      rider.intent = weakening;
      expect(intentLabel(state, rider)).toContain('怯战');
    }
  });

  it('telegraphs a card being shovelled into the deck', () => {
    // 扬尘 / 擂鼓 / 泥雨 all pushed cards into the draw pile and every one of
    // them displayed as a bare hit.
    const state = probe(['tieqi']);
    const enemy = state.enemies[0];
    enemy.intent = getEnemy('tieqi').moves.find((m) => m.id === 'dust')!;
    expect(intentLabel(state, enemy)).toContain('塞牌 2');

    enemy.intent = getEnemy('zhangbao').moves.find((m) => m.id === 'mire')!;
    expect(intentLabel(state, enemy)).toContain('塞牌 2');

    enemy.intent = getEnemy('zhangliang').moves.find((m) => m.id === 'drums')!;
    expect(intentLabel(state, enemy)).toContain('塞牌 1');
  });

  it('still marks a defended attack and a group buff', () => {
    const state = probe(['dongzhuoqinbing']);
    const enemy = state.enemies[0];
    const guard = getEnemy('dongzhuoqinbing').moves.find((m) => !!m.damage && !!m.block);
    if (guard) {
      enemy.intent = guard;
      expect(intentLabel(state, enemy)).toMatch(/^攻 \d+ · 守/);
    }
    enemy.intent = getEnemy('jijiu').moves.find((m) => m.id === 'preach')!;
    expect(intentLabel(state, enemy)).toBe('强化 · 神力');
  });
});

// ------------------------------------------------------------------- 复现

describe('reproducibility', () => {
  /** One roster per new mechanic: 分裂, 召唤, 遁走, 脚本, 群体 buff, 龟缩. */
  const ROSTERS: string[][] = [
    ['zhangbao'],
    ['zhangmancheng'],
    ['liukou', 'bandit'],
    ['zhangliang'],
    ['jijiu', 'luanmin', 'luanmin'],
    ['dongzhuoqinbing', 'dongzhuoqinbing'],
    ['guanhai'],
    ['tieqi'],
    ['qishou', 'qishou'],
  ];

  it('replays every new mechanic byte for byte from one seed', () => {
    for (const roster of ROSTERS) {
      const label = roster.join('+');
      // One deck, copied: `newDeckCard` counts globally, so building a fresh
      // one per replay would compare two fights with different card uids.
      const cards = deck('pikan', 10);
      const run = (): string => {
        const state = probe(roster, `replay-${label}`, cards.map((c) => ({ ...c })));
        for (let i = 0; i < 12 && state.phase === 'player'; i++) {
          // A blow every other turn, so thresholds and splits actually trigger.
          const target = state.enemies.find((e) => e.alive);
          if (target && i % 2 === 0) hit(state, target, 20);
          if (state.phase !== 'player') break;
          enemyTurn(state);
        }
        return JSON.stringify({ events: state.events, enemies: state.enemies });
      };
      expect(run(), label).toBe(run());
    }
  });

  it('gives different seeds different fights', () => {
    const play = (seed: string): string => {
      const state = probe(['guanhai'], seed);
      for (let i = 0; i < 6; i++) enemyTurn(state);
      return state.enemies[0].intent!.id + state.player.hp;
    };
    expect(new Set(Array.from({ length: 20 }, (_, i) => play(`spread-${i}`))).size).toBeGreaterThan(1);
  });
});

// --------------------------------------------------------------- 遭遇表

describe('pickEncounter', () => {
  const opts = (combatCount: number, used: string[] = []) => ({ combatCount, used });

  it('draws weak fights while the act is young and strong ones after', () => {
    const weak = new Set(ACT1.weak.map((e) => e.id));
    const strong = new Set(ACT1.strong.map((e) => e.id));

    for (let s = 0; s < 60; s++) {
      const early = pickEncounter(new Rng(`enc-${s}`), ACT1, 'monster', opts(0));
      expect(weak.has(early.id), `${early.id} is not a weak fight`).toBe(true);

      // 3, spelled out. `opts(ACT1.weakCount)` moved the boundary with the
      // table, so `weakCount: 1` was still "strong after weakCount fights".
      expect(ACT1.weakCount).toBe(3);
      const late = pickEncounter(new Rng(`enc-${s}`), ACT1, 'monster', opts(3));
      expect(strong.has(late.id), `${late.id} is not a strong fight`).toBe(true);

      // …and the last weak slot is still weak.
      const third = pickEncounter(new Rng(`enc-${s}`), ACT1, 'monster', opts(2));
      expect(weak.has(third.id), `${third.id} is not a weak fight`).toBe(true);
    }
  });

  it('pulls the stream exactly once whatever the pool looks like', () => {
    for (const used of [[], ['m1'], ACT1.weak.map((e) => e.id)]) {
      const rng = new Rng('rolls');
      pickEncounter(rng, ACT1, 'monster', opts(0, used));
      expect(rng.rolls, `used=${used.join(',')}`).toBe(1);
    }
  });

  it('never repeats an id until the pool is spent, then re-opens', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 200; s++) {
      const picked = pickEncounter(new Rng(`fresh-${s}`), ACT1, 'monster', opts(0, ['m1', 'm3']));
      expect(picked.id).toBe('m5');
      seen.add(picked.id);
    }
    expect(seen.size).toBe(1);

    // Everything spent: the pool re-opens rather than throwing or returning null.
    const all = ACT1.weak.map((e) => e.id);
    const again = pickEncounter(new Rng('spent'), ACT1, 'monster', opts(0, all));
    expect(all).toContain(again.id);
  });

  it('ignores the weak/strong split for elites and bosses', () => {
    const elite = pickEncounter(new Rng('e'), ACT1, 'elite', opts(0));
    expect(ACT1.elite.map((x) => x.id)).toContain(elite.id);
    const boss = pickEncounter(new Rng('b'), ACT1, 'boss', opts(99));
    expect(ACT1.boss.map((x) => x.id)).toContain(boss.id);
  });

  it('degrades rather than handing back undefined when a pool is empty', () => {
    // `FINAL.weak` and `FINAL.strong` are empty on purpose, and 终章 is the one
    // act where an added 杂兵 node would *crash* instead of degrading:
    // `rng.pick([])` is `undefined`, which `ensureEncounter` assigns straight
    // into `record.encounterId` and then reads back one line later.
    const picked = pickEncounter(new Rng('final-weak'), FINAL, 'monster', opts(0));
    expect(picked).toBeDefined();
    expect(picked.id).toBeTruthy();
    expect(ENEMIES[picked.enemies[0]]).toBeDefined();

    // And still exactly one roll, so degrading cannot shift the stream (R3).
    for (const [table, tier, count] of [
      [FINAL, 'monster', 0],
      [FINAL, 'elite', 0],
      [FINAL, 'boss', 0],
    ] as const) {
      const rng = new Rng('empty-rolls');
      pickEncounter(rng, table, tier, opts(count));
      expect(rng.rolls, `${tier}`).toBe(1);
    }
  });
});

// --------------------------------------------------------------- 表的完整性

describe('the enemy table holds together', () => {
  it('names only real defs from every encounter', () => {
    for (const row of [...ACT1.weak, ...ACT1.strong, ...ACT1.elite, ...ACT1.boss]) {
      for (const id of row.enemies) expect(ENEMIES[id], `${row.id} → ${id}`).toBeDefined();
    }
  });

  it('names only real moves and defs from every script, summon and split', () => {
    for (const def of Object.values(ENEMIES)) {
      const tables = [def, ...Object.values(def.phases ?? {})];
      for (const table of tables) {
        for (const id of table.script?.order ?? []) {
          expect(table.moves.some((m) => m.id === id), `${def.id} script → ${id}`).toBe(true);
        }
      }
      for (const move of def.moves) {
        if (move.summon) expect(ENEMIES[move.summon.defId], `${def.id} summon`).toBeDefined();
      }
      for (const row of def.thresholds ?? []) {
        if (row.split) expect(ENEMIES[row.split.defId], `${def.id} split`).toBeDefined();
        if (row.phase) expect(def.phases?.[row.phase], `${def.id} phase`).toBeDefined();
      }
    }
  });

  it('gives every enemy a move it can always reach', () => {
    for (const def of Object.values(ENEMIES)) {
      const ungated = def.moves.filter((m) => !m.when);
      expect(ungated.length, `${def.id} gates every move`).toBeGreaterThan(0);
      // A single always-available move must not claim a repeat cap it cannot keep.
      if (ungated.length === 1 && !def.script) {
        expect(ungated[0].maxRepeat, `${def.id}`).toBeUndefined();
      }
    }
  });
});

// ------------------------------------------------------------- 遭遇的金币

/**
 * Every encounter's `goldReward`, as literals.
 *
 * The band is the room's whole economic contribution and nothing read it: the
 * only consumer is `CombatScene`, which no headless test can load, and
 * `tests/engine.test.ts` stubs it as `[0, 0]`. `m1` at [100, 180] and `b2` at
 * [8, 11] both passed the entire suite.
 *
 * The shop's price table is calibrated against a run banking ~300 資財, and
 * these eleven rows are where most of that comes from.
 */
describe('goldReward', () => {
  const PRINTED: Record<string, [number, number]> = {
    m1: [10, 18],
    m2: [14, 22],
    m3: [12, 20],
    m4: [14, 22],
    m5: [10, 18],
    m6: [15, 23],
    m7: [16, 24],
    m8: [15, 23],
    m9: [12, 20],
    // 第二幕 · 战虎牢
    m10: [16, 24],
    m11: [18, 26],
    m12: [17, 25],
    m13: [20, 27],
    m14: [21, 27],
    m15: [20, 27],
    // 第三幕 · 征汉中
    m16: [20, 27],
    m17: [19, 26],
    m18: [21, 27],
    m19: [23, 27],
    m20: [22, 27],
    m21: [23, 27],
    e1: [28, 42],
    e2: [28, 42],
    e3: [28, 42],
    e4: [40, 56],
    e5: [38, 54],
    e6: [50, 68],
    e7: [48, 66],
    e8: [60, 76],
    b1: [80, 110],
    b2: [80, 110],
    b3: [80, 110],
    b4: [95, 130],
    b5: [95, 130],
    b6: [110, 150],
    b7: [110, 150],
    b8: [150, 200],
  };

  it('pays every fight the band printed against it', () => {
    for (const [id, band] of Object.entries(PRINTED)) {
      expect(getEncounter(id).goldReward, id).toEqual(band);
    }
  });

  it('covers every shipped encounter, so a new fight cannot slip in untested', () => {
    const shipped = allEncounters().map((e) => e.id);
    expect([...shipped].sort()).toEqual(Object.keys(PRINTED).sort());
  });

  it('keeps the tiers apart — an elite always outpays a normal fight', () => {
    const top = (id: string): number => getEncounter(id).goldReward[1];
    const bottom = (id: string): number => getEncounter(id).goldReward[0];
    // Across every act at once, deliberately: the bands stratify by tier and
    // not by act, so a 第三幕 normal room must still pay less than a 第一幕 精英.
    const idsOf = (pick: (t: (typeof ACT_TABLES)[number]) => readonly { id: string }[]) => [
      ...ACT_TABLES.flatMap((t) => pick(t).map((e) => e.id)),
    ];
    const monsters = [
      ...idsOf((t) => [...t.weak, ...t.strong]),
      ...PENDING_ENCOUNTERS.monster.map((e) => e.id),
    ];
    const elites = [...idsOf((t) => t.elite), ...PENDING_ENCOUNTERS.elite.map((e) => e.id)];
    const bosses = [...idsOf((t) => t.boss), ...PENDING_ENCOUNTERS.boss.map((e) => e.id)];

    expect(Math.max(...monsters.map(top))).toBeLessThan(Math.min(...elites.map(bottom)));
    expect(Math.max(...elites.map(top))).toBeLessThan(Math.min(...bosses.map(bottom)));
  });
});
