import { describe, expect, it } from 'vitest';
import {
  ACT1,
  ACT2,
  ACT3,
  ACT_TABLES,
  ENEMIES,
  FINAL,
  getEncounter,
  type EncounterTable,
} from '../src/combat/enemies';
import type { EnemyDef, EnemyMove } from '../src/combat/types';

/**
 * The balance net: the things a tuning pass is allowed to move, and the things
 * it is not.
 *
 * `sim/balance.sim.ts` is where numbers are *measured*; it is opt-in and slow.
 * This file is the fast half — it runs on every save and it exists because the
 * expensive failure mode of a balance pass is not a bad number, it is a number
 * moved in the wrong place.
 */

// ------------------------------------------------------ 冻结的敌人

/**
 * The fights the 37 golden snapshots are recorded on — the `encounterId` of
 * every case in `sim/golden.test.ts`, deduplicated.
 *
 * Their enemy rows are what a balance pass **must not touch**. Each file in
 * `sim/__snapshots__/` commits the complete `CombatEvent` stream of a fight, so
 * a single point of 体力 or damage on any body these can field rewrites one of
 * them, and a rewritten golden snapshot is indistinguishable from a rules
 * regression. The escape hatch exists (约定 3 permits a content-retune commit)
 * but it is a deliberate, separately-reviewed act — not something a tuning pass
 * does by reaching for the nearest number.
 *
 * Kept as a literal rather than read off the snapshot directory because the
 * point is to fail when the *enemies* move, and a list that regenerates itself
 * from whatever is on disk would quietly follow them.
 */
const GOLDEN_ENCOUNTERS = [
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11',
  'e1', 'e2', 'e3',
  'b1', 'b2', 'b3',
];

/** Bodies a fight can field, including anything it summons or splits into. */
function bodiesOf(encounterId: string): string[] {
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const move of ENEMIES[id].moves) {
      if (move.summon) walk(move.summon.defId);
    }
    for (const t of ENEMIES[id].thresholds ?? []) {
      if (t.split) walk(t.split.defId);
    }
  };
  for (const id of getEncounter(encounterId).enemies) walk(id);
  return [...seen];
}

/** The one number per move that a balance pass would reach for. */
const swing = (m: EnemyMove): number => (m.damage ?? 0) * (m.hits ?? 1) + (m.loseHp ?? 0);

const thresholdLine = (t: NonNullable<EnemyDef['thresholds']>[number]): string => {
  if (t.phase) return `@${t.percent} phase ${t.phase}`;
  return `@${t.percent} ${JSON.stringify(t.gain ?? t.split)}`;
};

/** A body's whole tunable surface, flattened to something readable in a diff. */
const statLine = (def: EnemyDef): string =>
  [
    `hp ${def.hp[0]}-${def.hp[1]}`,
    ...def.moves.map((m) => `${m.id} ${swing(m)}×${m.weight ?? 0}`),
    ...(def.passives ? [`passive ${JSON.stringify(def.passives)}`] : []),
    ...(def.thresholds ?? []).map(thresholdLine),
  ].join(' · ');

/**
 * Pinned by hand from `c629838`, the commit the 37 snapshots were recorded at.
 *
 * A failure here means someone tuned a fight the golden files own. The fix is
 * to revert that number — **not** to update this table and re-record. Updating
 * both is exactly the silent drift the snapshots exist to catch.
 */
const FROZEN: Record<string, string> = {
  yellowturban: 'hp 42-50 · chop 9×3 · roar 0×1 · guard 5×2',
  bandit: 'hp 28-34 · slash 10×3 · ambush 4×2',
  luanmin: 'hp 10-14 · hoe 4×3 · huddle 0×1',
  jijiu: 'hp 38-44 · staff 9×3 · talisman 4×3 · preach 0×3',
  qishou: 'hp 32-38 · charge 12×3 · trample 7×2',
  liukou: 'hp 26-30 · rob 8×0 · bolt 0×0',
  huaxiong: 'hp 88-96 · cleave 15×3 · sweep 21×2 · fury 0×1',
  guanhai:
    'hp 76-84 · axe 13×3 · bellow 0×1 · deathfight 12×3 · passive {"angry":1} · @50 {"strength":2}',
  zhangmancheng: 'hp 38-46 · hack 8×3 · muster 0×3 · banner 0×2',
  lubu: 'hp 150-150 · ji 16×3 · storm 18×2 · sunder 9×2 · peerless 0×1',
  zhangliang:
    'hp 155-155 · curse 8×0 · gale 18×0 · sigil 0×0 · drums 5×0 · surge 22×0 · @50 phase huangtian',
  zhangbao:
    'hp 150-150 · heaven 18×3 · mire 9×2 · ward 0×1 · @50 {"defId":"zhangbaofenshen","count":2}',
  zhangbaofenshen: 'hp 1-1 · phantom 12×3 · gather 0×1',
  tieqi: 'hp 46-54 · lance 13×3 · dust 5×2 · passive {"metallicize":3}',
  dongzhuoqinbing: 'hp 36-42 · stab 10×3 · parry 6×2 · passive {"curlUp":8}',
};

describe('黄金快照锁住的敌人', () => {
  const frozenIds = [...new Set(GOLDEN_ENCOUNTERS.flatMap(bodiesOf))].sort();

  it('covers exactly the bodies the 37 snapshots can field', () => {
    expect(frozenIds).toEqual(Object.keys(FROZEN).sort());
  });

  for (const id of Object.keys(FROZEN).sort()) {
    it(`${ENEMIES[id].name} is unchanged`, () => {
      expect(statLine(ENEMIES[id])).toBe(FROZEN[id]);
    });
  }
});

// -------------------------------------------- 幕二之后的精英与首领：伤害面

/**
 * Just the damage surface — what a body *hits for*, not how long it lives.
 *
 * Deliberately excludes 体力: the stratification tests below own that, and
 * keeping the two guards disjoint means a failure names which of the two things
 * moved instead of both at once.
 */
const damageLine = (def: EnemyDef): string =>
  [
    ...def.moves.map(
      (m) => `${m.id} ${m.damage ?? 0}x${m.hits ?? 1}+${m.loseHp ?? 0}@${m.weight ?? 0}`,
    ),
    ...(def.passives ? [`passive ${JSON.stringify(def.passives)}`] : []),
    ...(def.thresholds ?? []).map(thresholdLine),
  ].join(' · ');

/**
 * Alternate phases are outside `def.moves`, so neither frozen surface above
 * sees their numbers. Keep the phase's whole combat payload compactly visible:
 * damage/hits/direct loss, block, one status rider and one card rider are every
 * field the four shipped phase tables use.
 */
const phaseSurface = (def: EnemyDef): string =>
  Object.entries(def.phases ?? {})
    .map(([name, phase]) => {
      const script = phase.script
        ? `${phase.script.order.join('>')}@${phase.script.loopFrom}`
        : 'rolled';
      const moves = phase.moves.map((m) => {
        const status = m.status
          ? `${m.status.status}${m.status.amount}->${m.status.to}`
          : '-';
        const cards = m.addCards
          ? `${m.addCards.defId}${m.addCards.count}->${m.addCards.to}`
          : '-';
        return (
          `${m.id}:${m.damage ?? 0}x${m.hits ?? 1}+${m.loseHp ?? 0}` +
          `/b${m.block ?? 0}/${status}/${cards}`
        );
      });
      return `${name}[${script}] ${moves.join(' · ')}`;
    })
    .join(' || ');

const PHASE_SURFACES: Record<string, string> = {
  // 2026-08: 董卓 与 张辽 补上二阶段。八个首领里原本只有四个换招，另外四个是
  // 六拍加权掷骰、背熟即无变数；吕布与张宝的数值归黄金快照所有（`FROZEN`），
  // 动不得，所以这一轮只补 TUNABLE 表里的这两位。
  dongzhuo:
    'fendu[feidi>fenluo>baonue>jielue@0] ' +
    'feidi:0x1+0/b0/weak2->player/- · fenluo:18x1+0/b0/-/chuangshang1->draw · ' +
    'baonue:30x1+0/b0/-/- · jielue:11x2+0/b0/vulnerable2->player/-',
  zhangliao:
    'xiaoyaojin[jiaozhan>tuwei>duanqiao>zhenwei@0] ' +
    'jiaozhan:0x1+0/b0/weak2->player/- · tuwei:32x1+0/b0/-/- · ' +
    'duanqiao:11x3+0/b0/-/- · zhenwei:12x1+0/b12/strength3->self/-',
  zhangliang:
    'huangtian[fushen>yaofeng>zhouhuo>jiangshi@0] ' +
    'fushen:0x1+0/b0/entangled1->player/- · yaofeng:7x3+0/b0/-/- · ' +
    'zhouhuo:8x1+0/b0/-/xuanyun1->draw · jiangshi:16x1+0/b8/ritual1->self/-',
  liru:
    'duji[zhendu>quchi>yinmou>juedu@0] ' +
    'zhendu:0x1+0/b0/poison4->player/- · quchi:13x2+0/b0/-/- · ' +
    'yinmou:0x1+0/b12/ritual1->self/- · juedu:0x1+12/b0/-/nining1->discard',
  xiahouyuan:
    'shensu[duanliang>fenliang>qingqi>changqu@0] ' +
    'duanliang:0x1+0/b0/noDraw1->player/- · fenliang:6x1+0/b0/-/xuanyun1->draw · ' +
    'qingqi:9x2+0/b0/-/- · changqu:18x1+0/b0/-/-',
  tianming:
    'tianshu[xingchen>juxing>tianqing@0] ' +
    'xingchen:0x1+0/b0/frail2->player/- · juxing:0x1+0/b65/ritual3->self/- · ' +
    'tianqing:26x1+0/b0/-/-',
};

/**
 * Every 精英 and 首领 body that the 37 snapshots do **not** own.
 *
 * The hole this closes: `FROZEN` above covers only the 15 bodies the golden
 * files can field, and 「可调内容的分层」 below asserts 体力 and nothing else.
 * Between them, **every damage number on every act-2, act-3 and 终章 elite and
 * 首领 was unguarded** — all 26 of them could be set to 1, making 天命 hit for a
 * single point a turn, and both `npm test` and `npm run sim` stayed green.
 * (Measured: the test net was watching how long a fight takes, never how much
 * it hurts.)
 *
 * **This table is not `FROZEN`.** These fights are meant to be tuned, and
 * updating a line here is a legitimate part of a balance pass — the point is
 * that it has to be a *visible line in the diff* rather than a number that
 * moves in silence. `sim/balance.sim.ts` says whether a value is right; this
 * says that somebody chose it.
 */
const TUNABLE_DAMAGE: Record<string, string> = {
  // 第二幕 · 战虎牢
  licui: 'drive 22x1+0@3 · pillage 8x2+0@2 · hold 0x1+0@1 · @50 {"strength":2}',
  guosi: 'raid 8x3+0@3 · poison 0x1+7@2 · camp 0x1+0@1',
  dongzhuo:
    'might 19x1+0@3 · trample 6x3+0@2 · burn 10x1+0@2 · fortress 0x1+0@1 · passive {"metallicize":3} · @50 phase fendu',
  liru:
    'jiaozhao 10x1+0@0 · luanzheng 7x2+0@0 · chenmou 0x1+0@0 · zhenjiu 0x1+8@0 · fenjing 26x1+0@0 · @50 phase duji',
  // 第三幕 · 定中原
  // 2026-08 三幕精英上调：许褚 期望 13.2 → 15.8，庞德 15.2 → 17.3。两人都比
  // 同幕的普通房软（m27 25.8 / m20 23.5），「精英」曾只在体力上成立。
  xuchu: 'tiger 17x1+0@3 · bare 7x2+0@2 · passive {"angry":1} · @50 {"strength":1}',
  pangde: 'coffin 24x1+0@3 · arrow 8x2+0@2 · laststand 0x1+0@1',
  xiahouyuan:
    'gallop 8x2+0@0 · raid 26x1+0@0 · banner 0x1+0@0 · strike 13x1+0@0 · deluge 8x1+0@0 · @50 phase shensu',
  zhangliao:
    'raid 20x1+0@3 · eighthundred 7x4+0@2 · awe 10x1+0@2 · regroup 0x1+0@1 · @50 phase xiaoyaojin',
  // 终 · 五丈原
  simayi: 'hawk 26x1+0@3 · endure 0x1+0@2 · bite 9x2+0@2 · @50 {"strength":4}',
  tianming:
    'autumnwind 5x3+0@0 · lifespan 0x1+6@0 · wuzhang 0x1+0@0 · defy 12x1+0@0 · starfall 22x1+0@0 · dust 9x1+0@0 · passive {"metallicize":3} · @50 phase tianshu',
};

describe('幕二之后的精英与首领，伤害是被盯着的', () => {
  /** Every elite/boss body in the game, summons and split halves included. */
  const eliteAndBossBodies = (): string[] => {
    const ids = ACT_TABLES.flatMap((t) => [...t.elite, ...t.boss]).map((e) => e.id);
    return [...new Set(ids.flatMap(bodiesOf))].sort();
  };

  it('leaves no 精英 or 首领 body unaccounted for', () => {
    // A new act's elite must land in one table or the other. Neither list
    // regenerates itself, which is the whole point: the previous version of
    // this file was a hand-written act-1 list whose comment claimed to cover
    // everything, and todos/09 then added ten more bodies past it.
    const guarded = new Set([...Object.keys(FROZEN), ...Object.keys(TUNABLE_DAMAGE)]);
    const unguarded = eliteAndBossBodies().filter((id) => !guarded.has(id));
    expect(unguarded).toEqual([]);
  });

  it('does not overlap the snapshot-owned table', () => {
    // Two tables claiming the same body is two places to update and one to
    // forget. 第一幕's elites and 首领 belong to `FROZEN`.
    const both = Object.keys(TUNABLE_DAMAGE).filter((id) => id in FROZEN);
    expect(both).toEqual([]);
  });

  for (const id of Object.keys(TUNABLE_DAMAGE).sort()) {
    it(`${ENEMIES[id].name} hits for what it is meant to`, () => {
      expect(damageLine(ENEMIES[id])).toBe(TUNABLE_DAMAGE[id]);
    });
  }
});

describe('首领二阶段的数值面', () => {
  it('accounts for every alternate phase', () => {
    const phased = Object.values(ENEMIES)
      .filter((def) => def.phases)
      .map((def) => def.id)
      .sort();
    expect(phased).toEqual(Object.keys(PHASE_SURFACES).sort());
  });

  for (const id of Object.keys(PHASE_SURFACES).sort()) {
    it(`${ENEMIES[id].name} keeps its chosen phase payload`, () => {
      expect(phaseSurface(ENEMIES[id])).toBe(PHASE_SURFACES[id]);
    });
  }
});

// ------------------------------------------------------ 可调的敌人

const mid = (def: EnemyDef): number => (def.hp[0] + def.hp[1]) / 2;
const bodies = (list: readonly { enemies: readonly string[] }[]): EnemyDef[] =>
  list.flatMap((e) => e.enemies.map((id) => ENEMIES[id]));

/**
 * The gradient that survives contact with a fixed 体力 pool.
 *
 * 关羽 has 82 体力 and no act grows it much, so an act cannot keep raising the
 * damage of a single turn without eventually one-shotting the player out of the
 * difficulty band the fight is supposed to sit in — which is why the peak-damage
 * ordering across acts is deliberately *not* asserted anywhere (see the note in
 * `tests/acts.test.ts`).
 *
 * What can rise without bound is how long a body takes to put down. So 体力 is
 * the gradient the content is held to, and it is held strictly: every 精英 body
 * of act N outweighs every 精英 body of act N-1, and the same for 首领.
 */
describe('可调内容的分层', () => {
  const ACTS: [string, EncounterTable][] = [
    ['一', ACT1],
    ['二', ACT2],
    ['三', ACT3],
    ['终', FINAL],
  ];

  it('stratifies 精英 体力 strictly, act over act', () => {
    for (let i = 1; i < ACTS.length; i++) {
      const prev = Math.max(...bodies(ACTS[i - 1][1].elite).map(mid));
      const next = Math.min(...bodies(ACTS[i][1].elite).map(mid));
      expect(next, `${ACTS[i][0]}幕精英最轻 ${next} vs ${ACTS[i - 1][0]}幕最重 ${prev}`)
        .toBeGreaterThan(prev);
    }
  });

  it('stratifies 首领 体力 strictly, act over act', () => {
    for (let i = 1; i < ACTS.length; i++) {
      const prev = Math.max(...bodies(ACTS[i - 1][1].boss).map(mid));
      const next = Math.min(...bodies(ACTS[i][1].boss).map(mid));
      expect(next, `${ACTS[i][0]}幕首领最轻 ${next} vs ${ACTS[i - 1][0]}幕最重 ${prev}`)
        .toBeGreaterThan(prev);
    }
  });

  it('keeps 天命 the largest body in the game', () => {
    const all = ACT_TABLES.flatMap((t) => bodies([...t.weak, ...t.strong, ...t.elite, ...t.boss]));
    expect(Math.max(...all.map(mid))).toBe(mid(ENEMIES.tianming));
  });
});
