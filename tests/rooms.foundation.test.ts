import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { roomCommit, roomRecord } from '../src/rooms/commit';
import { stream, streamSeed } from '../src/rooms/rng';
import { ensureLoot, openTreasure } from '../src/rooms/treasure';
import { startRun, type RunState } from '../src/state/run';
import { DEFAULT_HERO } from '../src/data/heroes';

/**
 * The shared floor every room in phase three stands on: the one-shot ledger,
 * the per-node random streams, and the chest that proves both.
 *
 * The invariants each owner's own suite re-states for its own room are stated
 * once here against the primitives, so a break shows up at the cause rather
 * than in four places at once.
 */

const nodeOf = (run: RunState, type: string): string => {
  for (const node of run.map.nodes.values()) if (node.type === type) return node.id;
  throw new Error(`no ${type} node on this map`);
};

const fresh = (seed = 'foundation'): RunState => startRun(DEFAULT_HERO, seed);

describe('RunState room fields', () => {
  it('starts every one of them empty', () => {
    const run = fresh();
    expect(run.rooms).toEqual({});
    expect(run.seenEvents).toEqual([]);
    expect(run.cardRemovalSurcharge).toBe(0);
    expect(run.actCombatCount).toBe(0);
    expect(run.usedEncounters).toEqual([]);
    expect(run.bossRelicOffer).toBeNull();
    expect(run.keys).toEqual({ sapphire: false });
  });

  it('replays identically from a seed', () => {
    // Nothing added to `startRun` may draw from an Rng: `sim/golden.test.ts`
    // builds its decks through here.
    const a = fresh('replay');
    const b = fresh('replay');
    expect(a.deck.map((c) => c.defId)).toEqual(b.deck.map((c) => c.defId));
    expect([...a.map.nodes.keys()]).toEqual([...b.map.nodes.keys()]);
  });
});

describe('roomCommit', () => {
  it('runs a key once and reports it done', () => {
    const run = fresh();
    const id = nodeOf(run, 'treasure');
    const commit = roomCommit(run, id);

    expect(commit.isDone('open')).toBe(false);
    let calls = 0;
    expect(commit.once('open', () => ++calls)).toBe(1);
    expect(commit.once('open', () => ++calls)).toBeUndefined();
    expect(calls).toBe(1);
    expect(commit.isDone('open')).toBe(true);
  });

  it('leaves no trace for a node that was only read', () => {
    const run = fresh();
    const id = nodeOf(run, 'shop');
    expect(roomCommit(run, id).isDone('item:card:0')).toBe(false);
    expect(roomCommit(run, id).count('item:')).toBe(0);
    // A read must not grow the save file.
    expect(run.rooms).toEqual({});
  });

  it('counts commits sharing a prefix, for repeatable options', () => {
    const run = fresh();
    const id = nodeOf(run, 'shop');
    const commit = roomCommit(run, id);
    commit.mark('removal:0');
    commit.mark('removal:1');
    commit.mark('item:card:0');
    expect(commit.count('removal:')).toBe(2);
    expect(commit.count('item:')).toBe(1);
    // `mark` is idempotent too — the ledger is a set, spelled as an array.
    commit.mark('removal:1');
    expect(commit.count('removal:')).toBe(2);
  });

  it('picks the ledger kind off the node type', () => {
    const run = fresh();
    roomCommit(run, nodeOf(run, 'shop')).mark('x');
    roomCommit(run, nodeOf(run, 'rest')).mark('x');
    roomCommit(run, nodeOf(run, 'monster')).mark('x');
    expect(run.rooms[nodeOf(run, 'shop')].kind).toBe('shop');
    expect(run.rooms[nodeOf(run, 'rest')].kind).toBe('rest');
    expect(run.rooms[nodeOf(run, 'monster')].kind).toBe('combat');
  });

  it('refuses to hand a room the wrong kind of ledger', () => {
    const run = fresh();
    expect(() => roomRecord(run, nodeOf(run, 'shop'), 'event')).toThrow();
  });
});

describe('room streams', () => {
  it('derives from the seed, the node and the purpose, and nothing else', () => {
    const run = fresh();
    expect(streamSeed(run, 'n7', 'shop')).toBe(`${run.map.seed}:n7:shop`);
    // Different purposes on one node must not share a sequence.
    expect(stream(run, 'n7', 'shop').next()).not.toBe(stream(run, 'n7', 'event').next());
    expect(stream(run, 'n7', 'loot').next()).not.toBe(stream(run, 'n8', 'loot').next());
  });

  it('replays a purpose from the run state alone — no stored cursor', () => {
    const run = fresh();
    const once = Array.from({ length: 8 }, () => stream(run, 'n3', 'shop').int(100));
    // Eight *fresh* streams: identical, because nothing is carried between them.
    expect(new Set(once).size).toBe(1);
  });
});

describe('宝藏', () => {
  it('pays the same coin the pre-room-layer map paid', () => {
    // Byte-compatibility with the roll that used to live in MapScene: the gold
    // draw is #1 on the `loot` stream, and todo 10 appends behind it.
    const run = fresh();
    const id = nodeOf(run, 'treasure');
    const legacy = new Rng(`${run.map.seed}:${id}:loot`).range(25, 45);
    expect(ensureLoot(run, id).gold).toBe(legacy);
  });

  it('draws exactly once', () => {
    const run = fresh();
    const rng = stream(run, nodeOf(run, 'treasure'), 'loot');
    rng.range(25, 45);
    expect(rng.rolls).toBe(1);
  });

  it('materialises the loot once and reads it back after', () => {
    const run = fresh();
    const id = nodeOf(run, 'treasure');
    const first = ensureLoot(run, id);
    expect(ensureLoot(run, id)).toBe(first);
    expect(first.relicId).toBeNull();
    expect(first.potionId).toBeNull();
  });

  it('opens once; a second attempt pays nothing and changes nothing', () => {
    const run = fresh();
    const id = nodeOf(run, 'treasure');
    const before = run.gold;

    const report = openTreasure(run, id)!;
    expect(report.gold).toBeGreaterThan(0);
    expect(run.gold).toBe(before + report.gold);

    const snapshot = structuredClone(run.rooms);
    const goldAfter = run.gold;
    expect(openTreasure(run, id)).toBeNull();
    expect(run.gold).toBe(goldAfter);
    expect(run.rooms).toEqual(snapshot);
  });

  it('replays for a seed', () => {
    const a = fresh('chest');
    const b = fresh('chest');
    const id = nodeOf(a, 'treasure');
    expect(openTreasure(a, id)!.gold).toBe(openTreasure(b, id)!.gold);
  });
});
