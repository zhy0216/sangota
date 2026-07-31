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

/** A body's whole tunable surface, flattened to something readable in a diff. */
const statLine = (def: EnemyDef): string =>
  [
    `hp ${def.hp[0]}-${def.hp[1]}`,
    ...def.moves.map((m) => `${m.id} ${swing(m)}×${m.weight ?? 0}`),
    ...(def.passives ? [`passive ${JSON.stringify(def.passives)}`] : []),
    ...(def.thresholds ?? []).map((t) => `@${t.percent} ${JSON.stringify(t.gain ?? t.split)}`),
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
  zhangliang: 'hp 155-155 · curse 8×0 · gale 18×0 · sigil 0×0 · drums 5×0 · surge 22×0',
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
