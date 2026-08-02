import { describe, expect, it } from 'vitest';
import {
  ACT1,
  ACT2,
  ACT3,
  ENEMIES,
  FINAL,
  PENDING_ENCOUNTERS,
  allEncounters,
  getEncounter,
  type EncounterTable,
} from '../src/combat/enemies';
import type { Encounter } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { ACTS, actExit, actLabel, actOf, actSeed, advanceAct, runSeedOf } from '../src/data/acts';
import { generateFinalAct, generateMap } from '../src/map/generateMap';
import { roomCommit, roomRecord } from '../src/rooms/commit';
import { streamSeed } from '../src/rooms/rng';
import { bossOfferPending, ensureBossOffer, ensureEncounter, takeBossRelic } from '../src/rooms/fight';
import { addCard, addRelic, startRun, type RunState } from '../src/state/run';

/**
 * todos/09 · 多幕结构与推进.
 *
 * Every expected value in this file is a literal. Nothing here reads a number
 * back out of `ACTS` or the encounter tables and then asserts that it equals
 * itself — an act table can be retuned, but not silently: retuning it has to
 * come with an edit here, which is the whole point of the numbers below.
 */

const fresh = (seed = 'acts'): RunState => startRun(DEFAULT_HERO, seed);

// --------------------------------------------------------------- 数值工具

/** Mid-point of an enemy's HP band. */
const midHp = (defId: string): number => {
  const [lo, hi] = ENEMIES[defId].hp;
  return (lo + hi) / 2;
};

/**
 * The most 体力 one body can take off the player in a single turn — the number
 * the telegraph shows, before any 护甲 or status is considered.
 *
 * `loseHp` is counted because it is incoming damage the player feels; it just
 * ignores armour on the way in (太平符水, 鸩酒, 阳寿).
 */
const peak = (defId: string): number =>
  Math.max(
    ...ENEMIES[defId].moves.map((m) => (m.damage ?? 0) * (m.hits ?? 1) + (m.loseHp ?? 0)),
  );

const roomHp = (e: Encounter): number => e.enemies.reduce((n, id) => n + midHp(id), 0);
const roomPeak = (e: Encounter): number => e.enemies.reduce((n, id) => n + peak(id), 0);

const normals = (t: EncounterTable): readonly Encounter[] => [...t.weak, ...t.strong];
const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);
const ids = (rows: readonly Encounter[]): string[] => rows.map((e) => e.id);

// -------------------------------------------------------------- 幕的定义

describe('幕表', () => {
  it('ships four acts, named and numbered', () => {
    expect(Object.keys(ACTS).map(Number).sort()).toEqual([1, 2, 3, 4]);
    expect([ACTS[1].name, ACTS[2].name, ACTS[3].name, ACTS[4].name]).toEqual([
      '讨黄巾',
      '战虎牢',
      '征汉中',
      '五丈原',
    ]);
    expect([ACTS[1].index, ACTS[2].index, ACTS[3].index, ACTS[4].index]).toEqual([1, 2, 3, 4]);
  });

  it('gives each act its own floor plan', () => {
    // 第一幕's four numbers are the ones every existing seed was generated
    // with. If this row ever changes, every saved 第一幕 map changes with it.
    expect(ACTS[1].layout).toEqual({
      rows: 15,
      treasureRow: 8,
      restRow: 14,
      minAdvancedRow: 5,
    });
    expect(ACTS[2].layout).toEqual({ rows: 15, treasureRow: 7, restRow: 14, minAdvancedRow: 4 });
    expect(ACTS[3].layout).toEqual({ rows: 15, treasureRow: 6, restRow: 14, minAdvancedRow: 3 });
    // 精英 open earlier and the free 宝箱 arrives earlier, act by act.
    expect(ACTS[2].layout.minAdvancedRow).toBeLessThan(ACTS[1].layout.minAdvancedRow);
    expect(ACTS[3].layout.minAdvancedRow).toBeLessThan(ACTS[2].layout.minAdvancedRow);
  });

  it('pays the 幕间 heal only at the 终章 door', () => {
    expect([
      ACTS[1].interActHealPercent,
      ACTS[2].interActHealPercent,
      ACTS[3].interActHealPercent,
      ACTS[4].interActHealPercent,
    ]).toEqual([0, 0, 0, 30]);
  });

  it('labels an act the way the map header prints it', () => {
    expect(actLabel(ACTS[1])).toBe('第一幕 · 讨黄巾');
    expect(actLabel(ACTS[3])).toBe('第三幕 · 征汉中');
    expect(actLabel(ACTS[4])).toBe('终章 · 五丈原');
  });

  it('points every act at its own encounter table', () => {
    const run = fresh();
    expect(actOf(run).index).toBe(1);
    run.act = 2;
    expect(ids(actOf(run).table.boss)).toEqual(['b4', 'b5']);
    run.act = 4;
    expect(ids(actOf(run).table.boss)).toEqual(['b8']);
    // A corrupt index falls back rather than throwing the player out of a run.
    run.act = 99;
    expect(actOf(run).index).toBe(1);
  });
});

// -------------------------------------------------------------- 遭遇表

describe('每幕的遭遇表', () => {
  it('opens each act on its own weak table for a fixed number of rooms', () => {
    expect([ACT1.weakCount, ACT2.weakCount, ACT3.weakCount, FINAL.weakCount]).toEqual([3, 2, 2, 0]);
  });

  it('spells out which fight belongs to which act', () => {
    expect(ids(ACT1.weak)).toEqual(['m1', 'm3', 'm5']);
    expect(ids(ACT1.strong)).toEqual(['m2', 'm4', 'm6', 'm7', 'm8', 'm9']);
    expect(ids(ACT1.elite)).toEqual(['e1', 'e2', 'e3']);
    expect(ids(ACT1.boss)).toEqual(['b1', 'b2', 'b3']);

    expect(ids(ACT2.weak)).toEqual(['m10', 'm11', 'm12']);
    expect(ids(ACT2.strong)).toEqual(['m13', 'm14', 'm15']);
    expect(ids(ACT2.elite)).toEqual(['e4', 'e5']);
    expect(ids(ACT2.boss)).toEqual(['b4', 'b5']);

    expect(ids(ACT3.weak)).toEqual(['m16', 'm17', 'm22']);
    expect(ids(ACT3.strong)).toEqual(['m18', 'm19', 'm20', 'm21', 'm23']);
    expect(ids(ACT3.elite)).toEqual(['e6', 'e7']);
    expect(ids(ACT3.boss)).toEqual(['b6', 'b7']);

    // 终章 has no normal rooms at all — three fixed nodes, no draw pool.
    expect(ids(FINAL.weak)).toEqual([]);
    expect(ids(FINAL.strong)).toEqual([]);
    expect(ids(FINAL.elite)).toEqual(['e8']);
    expect(ids(FINAL.boss)).toEqual(['b8']);
  });

  it('never lists the same fight in two acts', () => {
    const all = [ACT1, ACT2, ACT3, FINAL].flatMap((t) => [
      ...ids(normals(t)),
      ...ids(t.elite),
      ...ids(t.boss),
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('names only enemies that exist, in every act', () => {
    for (const table of [ACT1, ACT2, ACT3, FINAL]) {
      for (const row of [...normals(table), ...table.elite, ...table.boss]) {
        for (const id of row.enemies) expect(ENEMIES[id], `${row.id} → ${id}`).toBeDefined();
      }
    }
  });

  it('looks a fight up by id across every act and the pending table', () => {
    expect(getEncounter('m1').name).toBe('黄巾散兵');
    expect(getEncounter('m13').name).toBe('铁骑冲阵');
    expect(getEncounter('b6').name).toBe('征西将军 · 夏侯渊');
    expect(getEncounter('b8').name).toBe('五丈原 · 天命');
    // Still reachable while it waits for the scene layer.
    expect(getEncounter('b3').name).toBe('地公将军 · 张宝');
    expect(() => getEncounter('m99')).toThrow();
  });

  it('has nothing left fenced off the map', () => {
    // todos/15 wired 召唤 / 分裂 / 遁走 / 夺财 into the scene, so 劫粮流寇,
    // 张曼成 and 张宝 moved into 第一幕 and this table emptied. 西凉铁骑 and
    // 董卓亲兵 were only ever waiting on 第二幕 existing, and now it does.
    expect(ids(PENDING_ENCOUNTERS.monster)).toEqual([]);
    expect(ids(PENDING_ENCOUNTERS.elite)).toEqual([]);
    expect(ids(PENDING_ENCOUNTERS.boss)).toEqual([]);

    // The mechanics that used to be fenced off are now genuinely reachable,
    // and each from exactly one act.
    const reachable = new Set(
      [ACT1, ACT2, ACT3, FINAL].flatMap((t) => [
        ...ids(normals(t)),
        ...ids(t.elite),
        ...ids(t.boss),
      ]),
    );
    for (const id of ['m9', 'e3', 'b3', 'm10', 'm11']) expect(reachable.has(id), id).toBe(true);

    const declares = (id: string, key: 'summon' | 'escape' | 'steal'): boolean =>
      getEncounter(id).enemies.some((d) => ENEMIES[d].moves.some((m) => m[key] !== undefined));
    expect(declares('m9', 'steal')).toBe(true);
    expect(declares('m9', 'escape')).toBe(true);
    expect(declares('e3', 'summon')).toBe(true);
    expect(
      getEncounter('b3').enemies.some((d) => (ENEMIES[d].thresholds ?? []).some((t) => t.split)),
    ).toBe(true);
    // 第二幕's two oldest rows need none of it — that is why they could ship
    // with the act rather than with the scene work.
    for (const id of ['m10', 'm11']) {
      for (const key of ['summon', 'escape', 'steal'] as const) {
        expect(declares(id, key), `${id}.${key}`).toBe(false);
      }
    }
  });

  it('covers every shipped fight with an act or the pending table', () => {
    // 9 + 6 + 8 normals, 3 + 2 + 2 + 1 elites, 3 + 2 + 2 + 1 bosses, 0 pending
    expect(allEncounters()).toHaveLength(9 + 6 + 8 + 8 + 8);
    expect(new Set(allEncounters().map((e) => e.id)).size).toBe(allEncounters().length);
  });
});

// ------------------------------------------------------------- 难度梯度

/**
 * The gradient, as numbers rather than as an intention.
 *
 * Two totals per normal room — the mid-point of the enemies' HP bands, and the
 * worst single turn they can produce between them — summed over the act. A
 * retune that flattens the curve fails here, and it should: a 第二幕 that plays
 * like 第一幕 is the whole failure mode 多幕 exists to avoid.
 */
describe('三幕的数值梯度', () => {
  it('counts the normal rooms each act fields', () => {
    expect([normals(ACT1).length, normals(ACT2).length, normals(ACT3).length]).toEqual([9, 6, 8]);
  });

  it('raises the 体力 a normal room fields, act by act', () => {
    expect(sum(normals(ACT1).map(roomHp))).toBe(594);
    expect(sum(normals(ACT2).map(roomHp))).toBe(481);
    expect(sum(normals(ACT3).map(roomHp))).toBe(827);
    // Mean per room: 66 → 80.2 → 103.4. 第二幕 fields fewer, heavier rooms, which
    // is why the *sum* dips and only the mean is a gradient. 第三幕 的 827 含
    // 军屯列垒(96)与发丘筹饷(108)——两间新房都压在幕均值附近，梯度不塌。
    const mean = (t: EncounterTable): number => sum(normals(t).map(roomHp)) / normals(t).length;
    expect(mean(ACT2) / mean(ACT1)).toBeGreaterThan(1.2);
    expect(mean(ACT3) / mean(ACT2)).toBeGreaterThan(1.2);
  });

  /**
   * The peak-damage curve flattens on purpose, and this is the one place it is
   * written down.
   *
   * 关羽 has 82 体力 and no act meaningfully grows it, so peak damage cannot keep
   * climbing act over act without a room one-shotting the player straight out of
   * the difficulty band it is supposed to sit in. The numbers here were first
   * written to climb 17.2 → 25.7 → 32, and measured (`npm run sim`) that put
   * 第三幕's normal rooms at 80-98% of the 体力 bar — i.e. a coin flip per room.
   *
   * So 体力 is the gradient the acts are held to and peak damage is only held to
   * *not falling*. What makes 第三幕 harder than 第二幕 is that its rooms take
   * longer to put down, not that any one turn hits harder.
   */
  it('does not let the worst turn a normal room can produce fall, act by act', () => {
    expect(sum(normals(ACT1).map(roomPeak))).toBe(155);
    expect(sum(normals(ACT2).map(roomPeak))).toBe(128);
    expect(sum(normals(ACT3).map(roomPeak))).toBe(185);
    // Mean per room: 17.2 → 21.3 → 23.1（军屯列垒 24 · 发丘筹饷 27 计入后）.
    const mean = (t: EncounterTable): number => sum(normals(t).map(roomPeak)) / normals(t).length;
    expect(mean(ACT2)).toBeGreaterThan(mean(ACT1));
    expect(mean(ACT3)).toBeGreaterThan(mean(ACT2));
  });

  /**
   * 体力 only, for the reason spelled out above: a strict peak-damage ordering
   * and a 40-55% 体力-cost band cannot both hold against a player whose bar
   * never grows. `tests/balance.test.ts` owns the same two assertions as the
   * balance net; they are duplicated here because this is where a reader of
   * todos/09 looks for the act curve.
   */
  it('stratifies 精英 outright — every act-N 精英 outweighs every act-(N-1) one', () => {
    const bodies = (t: EncounterTable) => t.elite.flatMap((e) => e.enemies);
    // 华雄 92 / 管亥 80 / 张曼成 42 · 李傕 105 / 郭汜 105 · 许褚 112 / 庞德 135 · 司马懿 157
    expect(Math.max(...bodies(ACT1).map(midHp))).toBe(92);
    expect(Math.min(...bodies(ACT2).map(midHp))).toBe(105);
    expect(Math.max(...bodies(ACT2).map(midHp))).toBe(105);
    expect(Math.min(...bodies(ACT3).map(midHp))).toBe(112);
    expect(Math.max(...bodies(ACT3).map(midHp))).toBe(135);
    expect(Math.min(...bodies(FINAL).map(midHp))).toBe(157);
  });

  it('stratifies 首领 outright too', () => {
    const bodies = (t: EncounterTable) => t.boss.flatMap((e) => e.enemies);
    // 吕布 150 / 张梁 155 / 张宝 150 · 李儒 194 / 董卓 196 · 张辽 206 / 夏侯渊 228 · 天命 252
    expect(Math.max(...bodies(ACT1).map(midHp))).toBe(155);
    expect(Math.min(...bodies(ACT2).map(midHp))).toBe(194);
    expect(Math.max(...bodies(ACT2).map(midHp))).toBe(196);
    expect(Math.min(...bodies(ACT3).map(midHp))).toBe(206);
    expect(Math.max(...bodies(ACT3).map(midHp))).toBe(228);
    expect(Math.min(...bodies(FINAL).map(midHp))).toBe(252);
  });
});

// ---------------------------------------------------------------- 地图

describe('每幕一张地图', () => {
  it('leaves 第一幕 on the bare run seed', () => {
    // Load bearing: prefixing 第一幕 would re-roll the opening map of every seed
    // ever played, and of all 37 golden snapshot runs.
    expect(actSeed('hello', 1)).toBe('hello');
    expect(actSeed('hello', 2)).toBe('hello:act2');
    expect(actSeed('hello', 3)).toBe('hello:act3');
    expect(actSeed('hello', 4)).toBe('hello:act4');
    expect(fresh('hello').map.seed).toBe('hello');
  });

  it('recovers the run seed from whichever act map is in hand', () => {
    const run = fresh('recover');
    expect(runSeedOf(run)).toBe('recover');
    run.act = 2;
    run.map = generateMap('recover:act2', ACTS[2].layout);
    expect(runSeedOf(run)).toBe('recover');
    run.act = 3;
    run.map = generateMap('recover:act3', ACTS[3].layout);
    expect(runSeedOf(run)).toBe('recover');
    // 终章 too: the hand-built map is the one that used to answer `'final'`
    // here, which would hand todos/08 the wrong run to reload.
    run.act = 4;
    run.map = generateFinalAct('recover:act4');
    expect(runSeedOf(run)).toBe('recover');
  });

  it('gives the same run three different maps, each reproducible on its own', () => {
    const shape = (seed: string, act: 1 | 2 | 3): string =>
      [...generateMap(actSeed(seed, act), ACTS[act].layout).nodes.values()]
        .map((n) => `${n.id}:${n.type}`)
        .sort()
        .join('|');

    const a = shape('three', 1);
    const b = shape('three', 2);
    const c = shape('three', 3);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);

    expect(shape('three', 2)).toBe(b);
    expect(shape('three', 3)).toBe(c);
  });

  it('builds 终章 by hand: three fixed rooms, no die rolled', () => {
    const map = generateFinalAct('anything:act4');
    expect(map.rows).toBe(2);
    expect(map.bossId).toBe('boss');
    expect([...map.nodes.keys()].sort()).toEqual(['0_0', '1_0', 'boss'].sort());
    expect(map.nodes.get('0_0')!.type).toBe('elite');
    expect(map.nodes.get('1_0')!.type).toBe('rest');
    expect(map.nodes.get('boss')!.type).toBe('boss');
    expect(map.nodes.get('0_0')!.children).toEqual(['1_0']);
    expect(map.nodes.get('1_0')!.children).toEqual(['boss']);

    // "Spends no randomness" means the *layout* ignores the seed — two
    // different seeds still lay the same three rooms down in the same places.
    const other = generateFinalAct('something-else:act4');
    const shape = (m: typeof map): string[] =>
      [...m.nodes.values()].map((n) => `${n.id}:${n.type}:${n.x}:${n.y}`);
    expect(shape(other)).toEqual(shape(map));
  });

  it('carries the run seed into 终章 rather than a literal', () => {
    // The map spends no draws, but `GameMap.seed` is *also* the prefix every
    // room stream in the act derives from and the only copy of the run's seed
    // left once the map is swapped. A literal here (it was `'final'`) gave
    // every run in the game the same 司马懿 shuffle, the same 战利品 chest and
    // the same elite relic, and made `runSeedOf` unable to name the run.
    expect(generateFinalAct(actSeed('alpha', 4)).seed).toBe('alpha:act4');
    expect(generateFinalAct(actSeed('bravo', 4)).seed).not.toBe(
      generateFinalAct(actSeed('alpha', 4)).seed,
    );
  });
});

// -------------------------------------------------------------- 推进

/** Walk a run to the state 「首领 down, 战利品 chest answered」. */
function clearBoss(run: RunState, decline = false): void {
  const bossId = run.map.bossId;
  run.currentNodeId = bossId;
  run.path.push(bossId);
  ensureEncounter(run, bossId, 'boss');
  const offer = ensureBossOffer(run, bossId);
  takeBossRelic(run, bossId, decline ? null : offer[0]);
}

describe('advanceAct', () => {
  it('refuses to move on while the 战利品 chest is unanswered', () => {
    const run = fresh('unanswered');
    run.currentNodeId = run.map.bossId;
    expect(() => advanceAct(run)).toThrow();
    expect(run.act).toBe(1);
  });

  it('wipes every ledger the old act owned', () => {
    const run = fresh('wipe');
    // Dirty the run the way a played-through act would.
    const monster = [...run.map.nodes.values()].find((n) => n.type === 'monster')!.id;
    ensureEncounter(run, monster, 'monster');
    expect(run.actCombatCount).toBe(1);
    expect(run.usedEncounters).toHaveLength(1);
    clearBoss(run);
    expect(run.bossRelicOffer).not.toBeNull();

    advanceAct(run);

    expect(run.act).toBe(2);
    expect(run.rooms).toEqual({});
    expect(run.usedEncounters).toEqual([]);
    expect(run.actCombatCount).toBe(0);
    expect(run.bossRelicOffer).toBeNull();
    expect(run.currentNodeId).toBeNull();
    expect(run.path).toEqual([]);
  });

  it('hands the new act a different map under the same run seed', () => {
    const run = fresh('newmap');
    const before = run.map.seed;
    clearBoss(run);
    advanceAct(run);
    expect(before).toBe('newmap');
    expect(run.map.seed).toBe('newmap:act2');
    expect(run.map.rows).toBe(15);
    // Same seed, different act — the layouts must not coincide.
    const shape = (m: typeof run.map): string =>
      [...m.nodes.values()].map((n) => `${n.id}:${n.type}`).sort().join('|');
    expect(shape(run.map)).not.toBe(shape(generateMap('newmap', ACTS[1].layout)));
  });

  it('does not let a 第二幕 node read back the 第一幕 fight that shared its id', () => {
    // The concrete bug: ids are `row_col` plus the literal `boss`, so `3_2`
    // exists in every act. A ledger left in place makes 第二幕's `3_2` open
    // 第一幕's fight, and 第二幕's 首领 chest answer 「already taken」.
    const run = fresh('collide');
    const monster = [...run.map.nodes.values()].find((n) => n.type === 'monster')!.id;
    const first = ensureEncounter(run, monster, 'monster');
    clearBoss(run);
    expect(bossOfferPending(run, 'boss')).toBe(false);

    advanceAct(run);

    expect(run.rooms[monster]).toBeUndefined();
    expect(bossOfferPending(run, run.map.bossId)).toBe(true);
    // And the same node id in the new act draws from 第二幕's table.
    const again = [...run.map.nodes.values()].find((n) => n.type === 'monster')!.id;
    const second = ensureEncounter(run, again, 'monster');
    expect(['m1', 'm3', 'm5', 'm2', 'm4', 'm6', 'm7', 'm8', 'm9']).toContain(first.id);
    expect(['m10', 'm11', 'm12', 'm13', 'm14', 'm15']).toContain(second.id);
  });

  it('carries 牌组 / 宝物 / 丹药 / 资财 across the seam untouched', () => {
    const run = fresh('carry');
    addCard(run, 'wenjiu');
    addRelic(run, 'yushan');
    run.potions[0] = 'jiuqi';
    run.gold = 271;
    run.hp = 40;
    const deck = run.deck.map((c) => `${c.defId}+${c.upgraded}`);

    clearBoss(run);
    // Snapshot *after* the 战利品 chest pays out — that grant belongs to the
    // act that just ended, and the seam must not eat it either.
    const relics = [...run.relics];
    expect(relics).toHaveLength(3);
    advanceAct(run);

    expect(run.deck.map((c) => `${c.defId}+${c.upgraded}`)).toEqual(deck);
    expect(run.relics).toEqual(relics);
    expect(run.potions[0]).toBe('jiuqi');
    expect(run.gold).toBe(271);
    // 第二幕 pays no 幕间 heal, exactly like the original.
    expect(run.hp).toBe(40);
  });

  it('天命六重进第二幕掉 10% 当前体力，且每幕都掉 (todos/19 a3)', () => {
    // 验收标准原文：「天命六重进第二幕时掉 10% 当前体力」。当前体力，不是
    // 上限：47 掉 floor(4.7) = 4，不是 82 的一成。零重比例为 0，上面每一条
    // advanceAct 测试的体力期望值原样成立，恒等就锁在那里。
    const run = startRun(DEFAULT_HERO, 'act-hp-loss', 6);
    run.hp = 47;
    clearBoss(run);
    advanceAct(run);
    expect(run.act).toBe(2);
    expect(run.hp).toBe(43); // 第二幕无幕间回血，掉的就是净数。

    // 「每幕开始」不是「第二幕开始」：进第三幕再掉一成，43 - floor(4.3) = 39。
    clearBoss(run);
    advanceAct(run);
    expect(run.act).toBe(3);
    expect(run.hp).toBe(39);
  });

  it('pays 30% of 体力上限 on the way into 终章, and nothing before it', () => {
    const run = fresh('heal');
    run.maxHp = 100;
    run.hp = 30;

    // 每一段都在 clearBoss 之后取样再断言：clearBoss 收下的首领宝物可以
    // 合法地移动 hp/上限（独断的 +12 走 addRelic 的同步抬升），被测的只是
    // advanceAct 的幕间回血本身。
    clearBoss(run, true); // decline for the 宝钥
    let before = run.hp;
    advanceAct(run);
    expect(run.act).toBe(2);
    expect(run.hp).toBe(before);

    clearBoss(run);
    before = run.hp;
    advanceAct(run);
    expect(run.act).toBe(3);
    expect(run.hp).toBe(before);

    clearBoss(run);
    before = run.hp;
    advanceAct(run);
    expect(run.act).toBe(4);
    expect(run.hp).toBe(
      Math.min(run.maxHp, before + Math.floor((run.maxHp * 30) / 100)),
    );
    expect(run.hp).toBeGreaterThan(before);
    // Never past the cap.
    expect(run.hp).toBeLessThanOrEqual(run.maxHp);
  });

  it('lands 终章 on the hand-built three-room map', () => {
    const run = fresh('finale');
    for (let i = 0; i < 3; i++) {
      clearBoss(run, i === 0);
      advanceAct(run);
    }
    expect(run.act).toBe(4);
    expect(run.map.seed).toBe('finale:act4');
    expect([...run.map.nodes.values()].map((n) => n.type)).toEqual(['elite', 'rest', 'boss']);
    // …and its fights come from FINAL, not from 第三幕.
    expect(ensureEncounter(run, '0_0', 'elite').id).toBe('e8');
    expect(ensureEncounter(run, 'boss', 'boss').id).toBe('b8');
  });

  it('gives two seeds two different 终章 — every stream, not just the map', () => {
    // The 终章 map is hand built, so nothing about its *shape* can vary. What
    // must vary is everything hanging off `GameMap.seed`: the fight's shuffle,
    // the 战利品 chest, the elite's relic, the reward and 丹药 rolls. With a
    // literal seed all five were the same for every run ever played.
    const toFinale = (seed: string): RunState => {
      const run = fresh(seed);
      for (let i = 0; i < 3; i++) {
        clearBoss(run, i === 0);
        advanceAct(run);
      }
      return run;
    };
    const a = toFinale('alpha');
    const b = toFinale('bravo');

    const PURPOSES = ['combat', 'reward', 'potion', 'eliteRelic', 'bossRelic'] as const;
    for (const purpose of PURPOSES) {
      for (const node of ['0_0', 'boss']) {
        expect(streamSeed(a, node, purpose), `${node}:${purpose}`).not.toBe(
          streamSeed(b, node, purpose),
        );
      }
    }
    // The 战利品 chest is the one a player would notice first.
    expect(ensureBossOffer(a, 'boss')).not.toEqual(ensureBossOffer(b, 'boss'));
    // Reproducible all the same: the same seed still lands the same chest.
    expect(ensureBossOffer(toFinale('alpha'), 'boss')).toEqual(ensureBossOffer(a, 'boss'));
  });

  it('runs out of acts rather than looping', () => {
    const run = fresh('overrun');
    for (let i = 0; i < 3; i++) {
      clearBoss(run, i === 0);
      advanceAct(run);
    }
    clearBoss(run);
    expect(() => advanceAct(run)).toThrow();
  });

  it('is the only thing that writes run.act — and it moves before the map', () => {
    const run = fresh('order');
    clearBoss(run);
    advanceAct(run);
    // If `act` moved after the map was built, the seed would carry the old
    // act's number and 第二幕 would generate 第一幕's map for every seed.
    expect(run.act).toBe(2);
    expect(run.map.seed).toBe('order:act2');
    expect(actOf(run).name).toBe('战虎牢');
  });
});

// ---------------------------------------------------------------- 终章门

describe('终章的门', () => {
  it('sends 第一幕 and 第二幕 straight on to the next chapter', () => {
    const run = fresh('door');
    expect(actExit(run)).toBe('interlude');
    run.act = 2;
    expect(actExit(run)).toBe('interlude');
  });

  it('opens 五丈原 only for a run holding the 宝钥', () => {
    const run = fresh('key');
    run.act = 3;
    expect(run.keys.sapphire).toBe(false);
    expect(actExit(run)).toBe('victory');
    run.keys.sapphire = true;
    expect(actExit(run)).toBe('finale');
  });

  it('ends the run once 终章 is cleared', () => {
    const run = fresh('end');
    run.act = 4;
    run.keys.sapphire = true;
    expect(actExit(run)).toBe('victory');
  });

  it('mints the 宝钥 from declining a 首领 chest, and from nothing else', () => {
    const taken = fresh('taken');
    clearBoss(taken, false);
    expect(taken.keys.sapphire).toBe(false);

    const declined = fresh('declined');
    clearBoss(declined, true);
    expect(declined.keys.sapphire).toBe(true);
    expect(declined.relics).toEqual([DEFAULT_HERO.starterRelic]);
  });
});

// -------------------------------------------------------- 房间层的接线

describe('ensureEncounter 按幕取表', () => {
  it('draws 第二幕 fights on a 第二幕 map, over many seeds', () => {
    const ACT2_MONSTERS = ['m10', 'm11', 'm12', 'm13', 'm14', 'm15'];
    for (let s = 0; s < 40; s++) {
      const run = fresh(`table-${s}`);
      clearBoss(run);
      advanceAct(run);
      const nodes = [...run.map.nodes.values()]
        .filter((n) => n.type === 'monster')
        .map((n) => n.id)
        .slice(0, 5);
      for (const id of nodes) {
        expect(ACT2_MONSTERS).toContain(ensureEncounter(run, id, 'monster').id);
      }
    }
  });

  it('honours each act own weak/strong split', () => {
    // ACT2.weakCount is 2 — spelled out, not read off the table.
    for (let s = 0; s < 30; s++) {
      const run = fresh(`split-${s}`);
      clearBoss(run);
      advanceAct(run);
      const nodes = [...run.map.nodes.values()]
        .filter((n) => n.type === 'monster')
        .map((n) => n.id)
        .slice(0, 4);
      const drawn = nodes.map((id) => ensureEncounter(run, id, 'monster').id);
      expect(drawn.slice(0, 2).every((id) => ['m10', 'm11', 'm12'].includes(id))).toBe(true);
      expect(drawn.slice(2).every((id) => ['m13', 'm14', 'm15'].includes(id))).toBe(true);
    }
  });

  it('still spends exactly one draw per node in every act', () => {
    const run = fresh('draws');
    clearBoss(run);
    advanceAct(run);
    const id = [...run.map.nodes.values()].find((n) => n.type === 'monster')!.id;
    ensureEncounter(run, id, 'monster');
    const record = roomRecord(run, id, 'combat');
    expect(record.encounterId).not.toBeNull();
    // R5: read back, never re-picked.
    expect(ensureEncounter(run, id, 'monster').id).toBe(record.encounterId);
    expect(run.usedEncounters).toEqual([record.encounterId]);
    expect(run.actCombatCount).toBe(1);
  });

  it('reads a 第一幕 record back correctly even after the fight moved acts', () => {
    // `getEncounter` scans every act, so a materialised id survives a fight
    // being re-homed — which is what makes moving a row between acts safe.
    const run = fresh('readback');
    const id = [...run.map.nodes.values()].find((n) => n.type === 'monster')!.id;
    roomRecord(run, id, 'combat').encounterId = 'm13';
    expect(ensureEncounter(run, id, 'monster').name).toBe('铁骑冲阵');
    expect(roomCommit(run, id).isDone('nothing')).toBe(false);
  });
});
