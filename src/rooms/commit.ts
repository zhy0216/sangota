import type { RoomType } from '../map/types';
import type { RunState } from '../state/run';
import type { RoomKind, RoomRecord } from './types';

/**
 * 一次性提交台账 — the gate that makes every room action idempotent.
 *
 * A room is not a transaction: the player may leave a shop mid-shopping, take a
 * fight from an event and walk back in, or reload a save standing on the same
 * node. Every payout therefore has to be able to answer "did I already happen?"
 * on its own, and the answer has to survive in `RunState` rather than in scene
 * state that dies with the scene.
 *
 * The discipline that makes this work: `commit.once(...)` appears **only** in
 * `src/rooms/*.ts`. The scene layer never gets a handle on the gate, so no
 * button callback can ever route around it. `tests/integrity.test.ts` enforces
 * that as source text.
 */
export interface RoomCommit {
  isDone(key: string): boolean;
  /** Runs at most once. A repeat call returns undefined with zero side effects. */
  once<T>(key: string, apply: () => T): T | undefined;
  mark(key: string): void;
  /** Commits sharing a prefix — repeatable options read their attempt from this. */
  count(prefix: string): number;
}

/** Map room types onto ledger kinds. The three fight types share one ledger. */
const ROOM_KIND: Record<RoomType, RoomKind> = {
  monster: 'combat',
  elite: 'combat',
  boss: 'combat',
  rest: 'rest',
  shop: 'shop',
  event: 'event',
  treasure: 'treasure',
};

/** A blank ledger for a node nobody has committed anything at yet. */
function blankRecord(kind: RoomKind): RoomRecord {
  switch (kind) {
    case 'combat':
      return { kind, committed: [], encounterId: null, relicId: null, spoils: null };
    case 'rest':
      return { kind, committed: [] };
    case 'shop':
      return { kind, committed: [], stock: null };
    case 'event':
      return { kind, committed: [], eventId: null };
    case 'treasure':
      return { kind, committed: [], loot: null };
  }
}

const kindOf = (run: RunState, nodeId: string): RoomKind => {
  const type = run.map.nodes.get(nodeId)?.type;
  // A node id that is not on the map can only come from a corrupt save; treat
  // it as a plain combat ledger rather than throwing the player out of the run.
  return type ? ROOM_KIND[type] : 'combat';
};

/**
 * The ledger for one node, created on first *write*. Reads never materialise a
 * record, so a run that merely walked past a node adds nothing to the save.
 */
export function ensureRecord(run: RunState, nodeId: string): RoomRecord {
  const existing = run.rooms[nodeId];
  if (existing) return existing;
  const fresh = blankRecord(kindOf(run, nodeId));
  run.rooms[nodeId] = fresh;
  return fresh;
}

/**
 * The ledger for one node, narrowed to the kind the caller expects. Rooms use
 * this to reach their own materialised randomness — `ensureStock` reads
 * `roomRecord(run, id, 'shop').stock`, and so on.
 *
 * A mismatched kind (an event node asked for its shop stock) is a programming
 * error, so it throws rather than silently handing back a fresh record.
 */
export function roomRecord<K extends RoomKind>(
  run: RunState,
  nodeId: string,
  kind: K,
): Extract<RoomRecord, { kind: K }> {
  const record = ensureRecord(run, nodeId);
  if (record.kind !== kind) {
    throw new Error(`Room ${nodeId} is a ${record.kind} ledger, not ${kind}`);
  }
  return record as Extract<RoomRecord, { kind: K }>;
}

export function roomCommit(run: RunState, nodeId: string): RoomCommit {
  const committed = (): string[] => run.rooms[nodeId]?.committed ?? [];

  const mark = (key: string): void => {
    const record = ensureRecord(run, nodeId);
    if (!record.committed.includes(key)) record.committed.push(key);
  };

  return {
    isDone: (key) => committed().includes(key),
    mark,
    count: (prefix) => committed().filter((key) => key.startsWith(prefix)).length,
    once<T>(key: string, apply: () => T): T | undefined {
      if (committed().includes(key)) return undefined;
      // Marked *before* the body runs: a payout that throws half-way must not
      // leave the door open for a second, compounding attempt.
      mark(key);
      return apply();
    },
  };
}
