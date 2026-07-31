import { describe, expect, it } from 'vitest';

/**
 * 黄金快照只增不删.
 *
 * 约定 3 was relaxed in 阶段四: a **content** change (a number in
 * `src/combat/enemies.ts`) may re-record the snapshots of the encounters it
 * touches, under four conditions — its own commit, the ids and the old→new
 * `result` listed in the message, the count matching the encounter's snapshot
 * count exactly, and only after P0–P2 have landed. An **engine** change may
 * still never move one.
 *
 * That relaxation opens one hole the balance lane could fall through without
 * noticing: a snapshot that is *deleted* re-records as nothing at all and every
 * remaining assertion still passes. `sim/golden.test.ts` iterates the cases it
 * knows about, so a missing file is a case that silently stops being checked.
 *
 * This is the floor under that: the set of snapshot files may only grow.
 */

const SNAPSHOTS: Record<string, unknown> = import.meta.glob('../sim/__snapshots__/*.json', {
  eager: true,
});

/** The 37 that existed at the end of 阶段三 (HEAD c629838). Append only. */
const FROZEN = [
  'combat-b1-gold-15-greedy',
  'combat-b1-gold-16-threat',
  'combat-b1-gold-17-random',
  'combat-b1-gold-20-threat',
  'combat-b1-gold-23-random',
  'combat-b1-gold-25-threat',
  'combat-b2-gold-36-greedy',
  'combat-b3-gold-37-threat',
  'combat-e1-gold-12-greedy',
  'combat-e1-gold-13-threat',
  'combat-e1-gold-14-random',
  'combat-e1-gold-19-threat',
  'combat-e1-gold-24-greedy',
  'combat-e1-gold-26-greedy',
  'combat-e2-gold-34-greedy',
  'combat-e3-gold-35-random',
  'combat-m1-gold-01-greedy',
  'combat-m1-gold-02-threat',
  'combat-m1-gold-03-random',
  'combat-m10-gold-32-random',
  'combat-m11-gold-33-threat',
  'combat-m2-gold-04-greedy',
  'combat-m2-gold-05-threat',
  'combat-m2-gold-06-random',
  'combat-m2-gold-18-greedy',
  'combat-m2-gold-21-greedy',
  'combat-m3-gold-07-greedy',
  'combat-m3-gold-08-threat',
  'combat-m4-gold-09-greedy',
  'combat-m4-gold-10-threat',
  'combat-m4-gold-11-random',
  'combat-m4-gold-22-threat',
  'combat-m5-gold-27-greedy',
  'combat-m6-gold-28-threat',
  'combat-m7-gold-29-random',
  'combat-m8-gold-30-greedy',
  'combat-m9-gold-31-threat',
];

const present = new Set(
  Object.keys(SNAPSHOTS).map((path) => path.replace(/^.*\//, '').replace(/\.json$/, '')),
);

describe('golden snapshots are append-only', () => {
  it('still holds every file the 阶段三 net was built out of', () => {
    const missing = FROZEN.filter((name) => !present.has(name));
    expect(missing, 'a deleted snapshot is a fight that stopped being checked').toEqual([]);
  });

  it('never shrinks below 37', () => {
    expect(present.size).toBeGreaterThanOrEqual(FROZEN.length);
  });
});
