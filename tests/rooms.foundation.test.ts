import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { relicsOfTier } from '../src/combat/relics';
import { rollChestExtras } from '../src/combat/rewards';
import { roomCommit, roomRecord } from '../src/rooms/commit';
import { stream, streamSeed } from '../src/rooms/rng';
import { ensureLoot, openTreasure } from '../src/rooms/treasure';
import { addRelic, startRun, type RunState } from '../src/state/run';
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

// 'bedrock'：paths 6→4 之后 'foundation' 的图上恰好没有商铺；这颗种子在新
// 生成器下五种房型齐备（shop×2 在内），夹具靠它才够 nodeOf 取用。
const fresh = (seed = 'bedrock'): RunState => startRun(DEFAULT_HERO, seed);

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

  it('cannot be made to collide by a seed that contains the separator', () => {
    // `randomSeed()` is base36 so this is unreachable today, but the moment a
    // 「输入种子」 box exists, seed `a:b` on node `c` and seed `a` on node `b:c`
    // would share a stream and nothing would say so. The run seed is escaped;
    // the node id and the purpose are closed vocabularies and are not — a
    // purpose contains a colon on purpose (`eventBranch:2`).
    const a = fresh();
    const b = fresh();
    a.map.seed = 'a:b';
    b.map.seed = 'a';
    expect(streamSeed(a, 'c', 'shop')).not.toBe(streamSeed(b, 'b:c', 'shop'));
    expect(stream(a, 'c', 'shop').next()).not.toBe(stream(b, 'b:c', 'shop').next());

    // A backslash cannot be used to fake the escape either.
    const c = fresh();
    const d = fresh();
    c.map.seed = 'x\\';
    d.map.seed = 'x';
    expect(streamSeed(c, 'n', 'shop')).not.toBe(streamSeed(d, '\\n', 'shop'));

    // And an ordinary seed is still spelled the way every existing save spells
    // it — escaping must not re-roll a run that already exists.
    const plain = fresh();
    expect(streamSeed(plain, 'n7', 'shop')).toBe(`${plain.map.seed}:n7:shop`);
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
    // draw is #1 on the `loot` stream and the six relic/potion draws sit behind
    // it, so a chest on a given seed still pays the coin it always paid. A dry
    // relic pool adds its consolation on top, which no fresh run can hit.
    const run = fresh();
    const id = nodeOf(run, 'treasure');
    const legacy = new Rng(`${run.map.seed}:${id}:loot`).range(25, 45);
    expect(ensureLoot(run, id).gold).toBe(legacy);
  });

  it('spends exactly seven draws on the loot stream, whatever the chest holds', () => {
    // 1 gold + CHEST_EXTRA_DRAWS. Constant by construction (R3): a chest that
    // found nothing must still burn what a chest that found everything did.
    const run = fresh();
    const rng = stream(run, nodeOf(run, 'treasure'), 'loot');
    rng.range(25, 45);
    rollChestExtras(rng, run);
    expect(rng.rolls).toBe(7);

    // …and again against a run that owns every relic the ladder can reach.
    const drained = fresh('drained');
    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (const def of relicsOfTier(tier)) addRelic(drained, def.id);
    }
    const dry = stream(drained, nodeOf(drained, 'treasure'), 'loot');
    dry.range(25, 45);
    expect(rollChestExtras(dry, drained).relicId).toBeNull();
    expect(dry.rolls).toBe(7);
  });

  it('materialises the loot once and reads it back after', () => {
    const run = fresh();
    const id = nodeOf(run, 'treasure');
    const first = ensureLoot(run, id);
    expect(ensureLoot(run, id)).toBe(first);
    expect(['small', 'medium', 'large']).toContain(first.size);
    // The whole point of the room: a chest on a fresh run holds a relic.
    expect(first.relicId).not.toBeNull();
    expect(run.relics).not.toContain(first.relicId!);
  });

  it('hands over the relic and the bottle it froze', () => {
    const run = fresh('chest-open');
    const id = nodeOf(run, 'treasure');
    const loot = ensureLoot(run, id);
    const report = openTreasure(run, id)!;

    expect(report.relicId).toBe(loot.relicId);
    expect(run.relics).toContain(loot.relicId!);
    if (loot.potionId) {
      expect(report.potionId).toBe(loot.potionId);
      expect(run.potions).toContain(loot.potionId);
    }
  });

  it('names the bottle it could not fit rather than dropping it silently', () => {
    // Find a seed whose chest carries a potion, then fill the belt before it
    // opens: a full belt is a refusal, not a chest that held nothing.
    let run = fresh('belt-0');
    let id = nodeOf(run, 'treasure');
    for (let i = 1; !ensureLoot(run, id).potionId && i < 60; i++) {
      run = fresh(`belt-${i}`);
      id = nodeOf(run, 'treasure');
    }
    expect(ensureLoot(run, id).potionId).not.toBeNull();

    for (let slot = 0; slot < run.potionSlots; slot++) run.potions[slot] = 'tiejiasan';
    const report = openTreasure(run, id)!;
    expect(report.potionRefused).toBe(true);
    expect(report.potionId).toBeNull();
  });

  it('pays the size-matched consolation when every shelf is bare', () => {
    const run = fresh('bare');
    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (const def of relicsOfTier(tier)) addRelic(run, def.id);
    }
    const id = nodeOf(run, 'treasure');
    const loot = ensureLoot(run, id);
    expect(loot.relicId).toBeNull();
    // 25-45 base plus the constant the source owes: 50 / 70 / 90 by size.
    const owed = { small: 50, medium: 70, large: 90 }[loot.size];
    expect(loot.gold).toBeGreaterThanOrEqual(25 + owed);
    expect(loot.gold).toBeLessThanOrEqual(45 + owed);
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
