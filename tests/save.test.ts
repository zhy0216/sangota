import { afterEach, describe, expect, it } from 'vitest';
import { ACT1, getEncounter } from '../src/combat/enemies';
import { endPlayerTurn, playCard, resolveDamage, runEnemyTurn, startCombat } from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { DEFAULT_HERO, HEROES } from '../src/data/heroes';
import { advanceAct } from '../src/data/acts';
import { roomCommit } from '../src/rooms/commit';
import { ensureEncounter } from '../src/rooms/fight';
import {
  addCurse,
  addPotion,
  addRelic,
  newDeckCard,
  startRun,
  travelTo,
  upgradeCard,
  type RunState,
} from '../src/state/run';
import {
  SAVE_VERSION,
  clearSave,
  combatIsQuiescent,
  fromSaved,
  readSlot,
  resetWriteCache,
  restoreCombat,
  snapshotCombat,
  summarise,
  toSaved,
  writeSave,
  type SavedCombat,
} from '../src/state/save';

/**
 * 存档 — the acceptance criteria of todos/08, as assertions.
 *
 * The load-bearing test is `round trip`: it compares the *whole* rebuilt run
 * against the original with `toEqual`, so a field added to `RunState` and
 * forgotten in `toSaved` fails here even though nothing in this file mentions
 * it by name. That is the guard the derived `SavedRun` type cannot give on its
 * own — `Omit` catches a missing property, not a mis-copied one.
 */

// --------------------------------------------------------------- 假 storage

/**
 * The real thing is absent under Node, which is itself one of the cases under
 * test ("localStorage 被禁用时游戏仍能正常玩"). Installed per test rather than
 * globally so the absent case stays reachable.
 */
class FakeStorage {
  private data = new Map<string, string>();
  /** Set to make every call throw, the way a locked-down browser does. */
  hostile = false;

  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    if (this.hostile) throw new Error('denied');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.hostile) throw new Error('denied');
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    if (this.hostile) throw new Error('denied');
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
}

const withStorage = (): FakeStorage => {
  const fake = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: fake,
    configurable: true,
    writable: true,
  });
  resetWriteCache();
  return fake;
};

const dropStorage = (): void => {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
  resetWriteCache();
};

afterEach(dropStorage);

/** The payload as it actually comes back: through JSON, never by reference. */
const reload = (run: RunState, combat: SavedCombat | null = null): RunState =>
  fromSaved(JSON.parse(JSON.stringify(toSaved(run, combat))));

/**
 * A run that has actually been played, so the round trip has something to lose.
 * Every field group `RunState` carries is touched by one of these lines.
 */
function playedRun(seed = 'save-seed'): RunState {
  const run = startRun(DEFAULT_HERO, seed);

  // 走五步 — the acceptance criterion's own number.
  let at = run.map.byRow[0][0];
  travelTo(run, at);
  for (let i = 0; i < 4; i++) {
    at = run.map.nodes.get(at)!.children[0];
    travelTo(run, at);
  }

  run.hp = 42;
  run.gold = 317;
  addRelic(run, 'yaonang');
  addPotion(run, 'huoyouguan');
  addCurse(run, 'tannian');
  upgradeCard(run, run.deck[0].uid);
  run.deck.push(newDeckCard('pikan', 1));
  run.seenEvents.push('taoyuan');
  run.cardRemovalSurcharge = 25;
  run.actCombatCount = 3;
  run.rareBump = 2;
  run.potionChance = 55;
  run.blessing = {
    offered: [{ id: 'm_yangjing', costId: null }],
    takenId: 'm_yangjing',
    pending: null,
  };
  roomCommit(run, run.path[0]).mark('enter');
  ensureEncounter(run, run.path[0], 'monster');

  return run;
}

// ------------------------------------------------------------------- 往返

describe('round trip', () => {
  it('rebuilds the whole run, field for field', () => {
    const run = playedRun();
    // Deep-equal on the live object, `map` included: `GameMap` holds a `Map` of
    // nodes and vitest compares those structurally, so a node whose `visited`
    // flag or jitter offset came back wrong fails here.
    expect(reload(run)).toEqual(run);
  });

  it('regrows the map from the seed rather than storing it', () => {
    const run = playedRun();
    const saved = toSaved(run, null);
    expect(JSON.stringify(saved)).not.toContain('"nodes"');

    const back = reload(run);
    const shape = (r: RunState): string =>
      [...r.map.nodes.values()]
        .map((n) => `${n.id}:${n.type}:${n.x.toFixed(4)}:${n.y.toFixed(4)}:${n.visited}`)
        .join('|');
    expect(shape(back)).toBe(shape(run));
  });

  it('paints the travelled path back, and nothing else', () => {
    const run = playedRun();
    const back = reload(run);
    const visited = [...back.map.nodes.values()].filter((n) => n.visited).map((n) => n.id);
    expect(visited.sort()).toEqual([...run.path].sort());
    expect(back.currentNodeId).toBe(run.path[run.path.length - 1]);
  });

  it('carries the run across an act boundary', () => {
    // 09 archived owing exactly this: 「[08 存档] 能跨幕恢复」无从验证.
    const run = startRun(DEFAULT_HERO, 'act-hop');
    run.currentNodeId = run.map.bossId;
    roomCommit(run, run.map.bossId).mark('bossRelic');
    advanceAct(run);
    expect(run.act).toBe(2);

    const back = reload(run);
    expect(back.act).toBe(2);
    expect(back.map.seed).toBe(run.map.seed);
    expect(back).toEqual(run);
  });

  it('reaches 终章, which is built by hand and not generated', () => {
    const run = startRun(DEFAULT_HERO, 'finale');
    run.keys.sapphire = true;
    for (const to of [2, 3, 4]) {
      run.currentNodeId = run.map.bossId;
      roomCommit(run, run.map.bossId).mark('bossRelic');
      advanceAct(run);
      expect(run.act).toBe(to);
    }
    expect(reload(run)).toEqual(run);
  });
});

describe('what a save deliberately does not hold', () => {
  it('re-derives the belt and the reward width from the relics', () => {
    const run = playedRun();
    // 药囊 is +2 on top of the base 3, and the save carries neither number.
    expect(run.potionSlots).toBe(5);
    const saved = toSaved(run, null);
    expect(saved).not.toHaveProperty('potionSlots');
    expect(saved).not.toHaveProperty('cardRewardCount');
    expect(reload(run).potionSlots).toBe(5);
    expect(reload(run).cardRewardCount).toBe(run.cardRewardCount);
  });

  it('carries no clock', () => {
    // 约定 2 bans `Date.now()` project-wide, so a save cannot be timestamped —
    // todos/08's draft `savedAt` field is the one part of it that could not be
    // built. `tests/integrity.test.ts` enforces the ban; this names the
    // consequence so the field is not re-added by someone reading the todo.
    expect(toSaved(playedRun(), null)).not.toHaveProperty('savedAt');
  });

  it('parks the deck-uid cursor, so a restored run mints fresh uids', () => {
    const run = playedRun();
    const uids = new Set(run.deck.map((c) => c.uid));
    const back = reload(run);
    const minted = newDeckCard('pikan');
    expect(uids.has(minted.uid)).toBe(false);
    expect(back.deck.some((c) => c.uid === minted.uid)).toBe(false);
  });
});

// ------------------------------------------------------------------- 战斗

/** A fight taken to the given turn, played greedily so state actually moves. */
function fightAt(run: RunState, turns: number): CombatState {
  const state = startCombat({
    encounter: getEncounter(ACT1.weak[0].id),
    deck: run.deck,
    heroName: run.hero.name,
    hp: run.hp,
    maxHp: run.maxHp,
    relics: run.relics,
    seed: 'fight-seed',
  });

  for (let t = 0; t < turns; t++) {
    for (const uid of [...state.hand]) {
      if (state.pendingChoice) break;
      playCard(state, uid, state.enemies.find((e) => e.alive)?.id);
    }
    if (state.pendingChoice || state.phase !== 'player') break;
    endPlayerTurn(state);
    runEnemyTurn(state);
    state.events.length = 0;
  }
  return state;
}

const CTX = {
  tier: 'monster' as const,
  ledgerId: null,
  bonusRelic: null,
  theftSeq: 2,
  fightDamageTaken: 0,
};

describe('a fight in progress', () => {
  it('comes back identical at turn 3', () => {
    const run = startRun(DEFAULT_HERO, 'combat-save');
    const state = fightAt(run, 3);
    expect(state.turn).toBeGreaterThanOrEqual(3);
    expect(combatIsQuiescent(state)).toBe(true);

    const back = restoreCombat(JSON.parse(JSON.stringify(snapshotCombat(state, CTX))));

    // Everything the acceptance criterion names, and then the whole object.
    expect(back.hand).toEqual(state.hand);
    expect(back.drawPile).toEqual(state.drawPile);
    expect(back.discardPile).toEqual(state.discardPile);
    expect(back.exhaustPile).toEqual(state.exhaustPile);
    expect(back.energy).toBe(state.energy);
    expect(back.player).toEqual(state.player);
    expect(back.enemies).toEqual(state.enemies);
    expect(back.rng.getState()).toBe(state.rng.getState());
  });

  it('resolves the *same* future, not merely the same present', () => {
    // The point of storing the generator cursor. Two fights that look identical
    // and then diverge on the next shuffle are not a restored fight.
    const run = startRun(DEFAULT_HERO, 'combat-future');
    const state = fightAt(run, 2);
    const back = restoreCombat(JSON.parse(JSON.stringify(snapshotCombat(state, CTX))));

    const advance = (s: CombatState): string => {
      for (let t = 0; t < 4; t++) {
        for (const uid of [...s.hand]) {
          if (s.pendingChoice || s.phase !== 'player') break;
          playCard(s, uid, s.enemies.find((e) => e.alive)?.id);
        }
        if (s.pendingChoice || s.phase !== 'player') break;
        endPlayerTurn(s);
        runEnemyTurn(s);
        s.events.length = 0;
      }
      return JSON.stringify({
        turn: s.turn,
        hp: s.player.hp,
        block: s.player.block,
        statuses: s.player.statuses,
        hand: s.hand,
        draw: s.drawPile,
        enemies: s.enemies.map((e) => [e.id, e.hp, e.block, e.intent?.id, e.statuses]),
      });
    };

    expect(advance(back)).toBe(advance(state));
  });

  it('resolves a telegraphed move back through the phase it was picked in', () => {
    const run = startRun(DEFAULT_HERO, 'intent');
    const state = fightAt(run, 1);
    const snap = snapshotCombat(state, CTX);
    expect(snap.enemies.every((e) => typeof e.intentId === 'string')).toBe(true);

    const back = restoreCombat(JSON.parse(JSON.stringify(snap)));
    for (const [i, enemy] of back.enemies.entries()) {
      // The *same table row*, not a copy of it: the engine compares
      // `enemy.intent?.id` against rows by identity-free id, but `runEnemyTurn`
      // reads fields straight off the object it is handed.
      expect(enemy.intent).toBe(state.enemies[i].intent);
    }
  });

  it('round-trips a boss after its half-HP phase has replaced the telegraph', () => {
    const run = startRun(DEFAULT_HERO, 'phase-intent');
    const state = startCombat({
      encounter: getEncounter('b2'),
      deck: run.deck,
      heroName: run.hero.name,
      hp: run.hp,
      maxHp: run.maxHp,
      relics: run.relics,
      seed: 'phase-fight',
    });
    const enemy = state.enemies[0];
    resolveDamage(state, {
      attacker: state.player,
      defender: enemy,
      base: Math.ceil(enemy.maxHp / 2),
      isAttack: true,
      pierceBlock: false,
    });
    expect(enemy.phase).toBe('huangtian');
    expect(enemy.intent?.id).toBe('fushen');

    const back = restoreCombat(
      JSON.parse(JSON.stringify(snapshotCombat(state, { ...CTX, tier: 'boss' }))),
    );
    expect(back.enemies[0].phase).toBe('huangtian');
    expect(back.enemies[0].crossed).toEqual([0]);
    expect(back.enemies[0].actedTurns).toBe(0);
    expect(back.enemies[0].intent).toBe(enemy.intent);
  });

  it('refuses a save whose telegraphed move no longer exists', () => {
    const run = startRun(DEFAULT_HERO, 'intent-gone');
    const snap = snapshotCombat(fightAt(run, 1), CTX);
    snap.enemies[0].intentId = 'a-move-that-was-deleted';
    expect(() => restoreCombat(snap)).toThrow(/not a move of/);
  });

  it('holds the scene-side context the engine does not carry', () => {
    const snap = snapshotCombat(fightAt(startRun(DEFAULT_HERO, 'ctx'), 1), {
      tier: 'elite',
      ledgerId: '3_2#fight',
      bonusRelic: 'qinglongdao',
      theftSeq: 2,
      // 无伤判定的基线 (todos/22)：不随存档走的话，读档就能洗掉已挨的刀。
      fightDamageTaken: 7,
    });
    expect(snap.tier).toBe('elite');
    expect(snap.ledgerId).toBe('3_2#fight');
    expect(snap.bonusRelic).toBe('qinglongdao');
    expect(snap.theftSeq).toBe(2);
    expect(snap.fightDamageTaken).toBe(7);
  });

  it('is only quiescent between actions', () => {
    const run = startRun(DEFAULT_HERO, 'quiet');
    const state = fightAt(run, 1);
    expect(combatIsQuiescent(state)).toBe(true);

    state.pendingChoice = { kind: 'discard', options: [], min: 1, max: 1 };
    expect(combatIsQuiescent(state)).toBe(false);
    state.pendingChoice = null;

    state.effectQueue.push({ effect: { kind: 'draw', amount: 1 }, target: undefined, bonus: 0, energy: 0, attacks: 0 });
    expect(combatIsQuiescent(state)).toBe(false);
    state.effectQueue.length = 0;
    expect(combatIsQuiescent(state)).toBe(true);
  });

  it('is quiescent with a presentation backlog, but not with an unpaid theft', () => {
    // The opening five `draw`s are still queued when `CombatScene.create`
    // finishes. Treating those as "not quiescent" meant the *start* of a fight
    // was never written down: reloading before playing a card came back to a map
    // node already marked visited, with the fight and its 战利品 gone for good.
    const state = fightAt(startRun(DEFAULT_HERO, 'backlog'), 0);
    expect(state.events.filter((e) => e.t === 'draw').length).toBeGreaterThan(0);
    expect(combatIsQuiescent(state)).toBe(true);

    // 夺财 is the exception, and the only one: 约定 8 keeps the engine away from
    // `RunState`, so the gold is still in the purse until `CombatScene` plays the
    // event. Snapshot over it and reloading refunds the theft.
    state.events.push({ t: 'steal', enemyId: 'x', amount: 30 });
    expect(combatIsQuiescent(state)).toBe(false);
  });

  it('rides along in the run payload', () => {
    const run = playedRun('with-fight');
    const snap = snapshotCombat(fightAt(run, 2), CTX);
    const back = JSON.parse(JSON.stringify(toSaved(run, snap)));
    expect(back.combat.turn).toBe(snap.turn);
    expect(summarise(back).inCombat).toBe(true);
    expect(summarise(toSaved(run, null)).inCombat).toBe(false);
  });
});

// ------------------------------------------------------------------- 存储

describe('the slot', () => {
  it('writes, reads back and clears', () => {
    withStorage();
    const run = playedRun('slot');
    expect(readSlot()).toEqual({ kind: 'empty' });

    writeSave(run, null);
    const slot = readSlot();
    expect(slot.kind).toBe('ok');
    if (slot.kind !== 'ok') throw new Error('unreachable');
    expect(fromSaved(slot.saved)).toEqual(run);

    clearSave();
    expect(readSlot()).toEqual({ kind: 'empty' });
  });

  it('does not re-serialise an unchanged run', () => {
    const fake = withStorage();
    const run = playedRun('dedupe');
    let writes = 0;
    const real = fake.setItem.bind(fake);
    fake.setItem = (k: string, v: string): void => {
      writes += 1;
      real(k, v);
    };

    writeSave(run, null);
    writeSave(run, null);
    writeSave(run, null);
    expect(writes).toBe(1);

    run.gold += 1;
    writeSave(run, null);
    expect(writes).toBe(2);
  });

  it('reports an older payload as stale rather than loading or dropping it', () => {
    const fake = withStorage();
    fake.setItem('sangota.save.v1', JSON.stringify({ version: SAVE_VERSION + 1, hp: 1 }));
    expect(readSlot()).toEqual({ kind: 'stale', version: SAVE_VERSION + 1 });
  });

  it('reports unparseable and version-less payloads as broken', () => {
    const fake = withStorage();
    fake.setItem('sangota.save.v1', '{not json');
    expect(readSlot()).toEqual({ kind: 'broken' });
    fake.setItem('sangota.save.v1', '{"hp":40}');
    expect(readSlot()).toEqual({ kind: 'broken' });
  });

  it('is a silent no-op with no localStorage at all', () => {
    dropStorage();
    const run = playedRun('no-store');
    expect(() => writeSave(run, null)).not.toThrow();
    expect(() => clearSave()).not.toThrow();
    expect(readSlot()).toEqual({ kind: 'empty' });
  });

  it('survives a store that throws on every call', () => {
    const fake = withStorage();
    fake.hostile = true;
    const run = playedRun('hostile');
    expect(() => writeSave(run, null)).not.toThrow();
    expect(() => clearSave()).not.toThrow();
    expect(readSlot()).toEqual({ kind: 'empty' });
  });
});

describe('a save that cannot be restored exactly is refused', () => {
  it('rejects an unknown hero', () => {
    const saved = toSaved(playedRun('hero'), null);
    expect(() => fromSaved({ ...saved, heroId: 'lubu' })).toThrow(/Unknown hero/);
  });

  it('rejects an act the table has not got', () => {
    const saved = toSaved(playedRun('act'), null);
    expect(() => fromSaved({ ...saved, act: 9 })).toThrow(/Unknown act/);
  });

  it('rejects a path the regrown map cannot walk', () => {
    const saved = toSaved(playedRun('path'), null);
    expect(() => fromSaved({ ...saved, path: [...saved.path, '99_9'] })).toThrow(/has not got/);
  });

  it('names every hero the title screen can start, so none is unloadable', () => {
    for (const id of Object.keys(HEROES)) {
      const run = startRun(HEROES[id], `hero-${id}`);
      expect(reload(run).hero.id).toBe(id);
    }
  });
});

/**
 * The scene wiring, checked as source text.
 *
 * None of it can be reached from a test — every one of these files imports
 * Phaser — and each property below costs the player real progress when it
 * breaks. This is the same technique `tests/integrity.test.ts` uses on the
 * victory screen, for the same reason.
 */
describe('where the save is actually written', () => {
  const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const read = (path: string): string => SOURCES[`../${path}`];

  it('writes on the way into a room and on the way out of one', () => {
    // The two funnels every room and every fight passes through. Written in
    // `enterRoom` *after* the entry hooks have fired: those are gated `once`, so
    // a save taken a beat earlier would restore a run whose 行商符节 could never
    // pay out.
    const nav = read('src/scenes/nav.ts');
    const enter = nav.slice(nav.indexOf('export function enterRoom'));
    const enterBody = enter.slice(0, enter.indexOf('\n}'));
    expect(enterBody).toContain('writeSave(run, null)');
    expect(enterBody.indexOf("once('enter'")).toBeLessThan(enterBody.indexOf('writeSave'));

    const back = nav.slice(nav.indexOf('export function returnToMap'));
    expect(back.slice(0, back.indexOf('\n}'))).toContain('writeSave(run, null)');
  });

  it('rides the room layer’s own one-way funnel', () => {
    // `action` is documented as "every button callback goes through here", which
    // makes it the only point at which "the run just changed" is reliably true
    // inside a 商旅 with eight independent one-shot purchases.
    const room = read('src/scenes/RoomScene.ts');
    const body = room.slice(room.indexOf('private action(fn: () => void)'));
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('writeSave(this.run, null)');
    // The card grid calls back on its own confirm button and bypasses `action`.
    const pick = room.slice(room.indexOf('const done = (uids: string[])'));
    expect(pick.slice(0, pick.indexOf('};'))).toContain('writeSave(this.run, null)');
  });

  it('snapshots a fight only after the outcome has been checked', () => {
    // Before `checkOutcome`, a won fight is still `finished === false` and would
    // be written down as live — and reopened as live on the next load, with the
    // enemies dead and no way to reach the reward screen.
    const scene = read('src/scenes/CombatScene.ts');
    for (const caller of ['private async play(', 'private async onEndTurn(']) {
      const body = scene.slice(scene.indexOf(caller));
      const tail = body.slice(0, body.indexOf('\n  }'));
      expect(tail, caller).toContain('this.autosave()');
      expect(tail.indexOf('this.checkOutcome()'), caller).toBeLessThan(
        tail.indexOf('this.autosave()'),
      );
    }
    const guard = scene.slice(scene.indexOf('private autosave(): void'));
    expect(guard.slice(0, guard.indexOf('\n  }'))).toContain(
      'if (this.finished || !combatIsQuiescent(this.state)) return;',
    );
  });

  it('settles a won fight exactly once across a reload', () => {
    // `applyCombatResult` survives being run twice; `resolveCombatEndHooks` does
    // not — 贪念 would collect a second time off a body already paid for. So the
    // save is written *inside* the branch that settles, and the resumed path
    // skips both.
    const scene = read('src/scenes/CombatScene.ts');
    const body = scene.slice(scene.indexOf('private showVictory('));
    const head = body.slice(0, body.indexOf("if (this.nodeType === 'boss'"));
    expect(head).toContain('if (!resumed) {');
    expect(head).toContain('resolveCombatEndHooks(this.state, this.run)');
    expect(head).toContain('this.saveFight()');
    // 首领战后的回满 (2026-08-05) 必须压在写档之前：读档恢复的胜利画面从
    // 存档拿到的就是满血，resumed 分支才有资格什么都不补。
    expect(head).toContain('healAfterBossVictory(this.run, this.nodeType)');
    expect(head.indexOf('healAfterBossVictory')).toBeLessThan(head.indexOf('this.saveFight()'));

    // And the resumed path is the only caller that passes `true`.
    const create = scene.slice(scene.indexOf('  create(): void {'));
    expect(create.slice(0, create.indexOf('\n  }'))).toContain('this.showVictory(true)');
  });

  it('ends the run at 兵败 and at 凯旋, save included', () => {
    const scene = read('src/scenes/CombatScene.ts');
    const defeat = scene.slice(scene.indexOf('private showDefeat(): void'));
    // Cleared in `showDefeat` rather than on the button that leaves it, so
    // closing the tab on the 兵败 screen ends the run too.
    expect(defeat.slice(0, defeat.indexOf('\n  }'))).toContain('clearSave()');

    // 幕间 is the only caller of `advanceAct`, so it is also the only place a
    // run can be declared over without a fight.
    const interlude = read('src/scenes/InterludeScene.ts');
    expect(interlude).toContain('clearSave()');
    expect(interlude.indexOf('advanceAct(this.run)')).toBeLessThan(
      interlude.indexOf('writeSave(this.run, null)'),
    );
  });

  it('offers 继续 from the title and asks before overwriting', () => {
    const title = read('src/scenes/TitleScene.ts');
    const resume = title.slice(title.indexOf('private continueRun(): void'));
    const body = resume.slice(0, resume.indexOf('\n  }\n'));
    // 拜别 is not on the resume path: a saved run has already been blessed.
    expect(body).toContain("this.scene.start('Combat', { resume: saved.combat })");
    expect(body).toContain("this.scene.start('Map')");
    expect(body).not.toContain("start('Blessing')");
    // A save that parses but cannot be rebuilt demotes itself rather than
    // dropping the player into a half-understood run (S4).
    expect(body).toContain("this.slot = { kind: 'broken' }");

    // 重新出征 over a live save asks first; 出征 with no save does not.
    expect(title).toContain('confirmDiscard()');
    const build = title.slice(title.indexOf('private buildActions(): void'));
    expect(build).toContain('resumable ? this.continueRun() : this.beginRun()');
  });

  it('writes the run for the first time only once 拜别 is settled', () => {
    // Before that the 祝福 can still rewrite the deck, the purse and 体力上限.
    const blessing = read('src/scenes/BlessingScene.ts');
    const body = blessing.slice(blessing.indexOf('private leave(): void'));
    const tail = body.slice(0, body.indexOf('\n  }'));
    expect(tail).toContain('writeSave(this.run, null)');
    expect(tail).toContain('blessingSettled(this.run)');
  });
});

describe('summary', () => {
  it('prints what the 继续 button needs without rebuilding the run', () => {
    const run = playedRun('summary');
    const s = summarise(toSaved(run, null));
    expect(s).toEqual({
      heroName: '关羽',
      actLabel: '第一幕',
      floor: 5,
      hp: 42,
      maxHp: run.maxHp,
      gold: run.gold,
      deckSize: run.deck.length,
      inCombat: false,
    });
  });
});
