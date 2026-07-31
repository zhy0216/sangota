import { describe, expect, it } from 'vitest';
import { ACT1_LAYOUT, generateMap } from '../src/map/generateMap';
import type { GameMap, RoomType } from '../src/map/types';

/**
 * The README claims the generator was validated across 400 seeds. This is that
 * claim, made standing — every rule in `generateMap.ts` is re-checked from the
 * outside on every `npm test`.
 */

const SEEDS = 400;
const seeds = Array.from({ length: SEEDS }, (_, i) => `map-seed-${i}`);

/** Rows whose type the generator overrides wholesale, bypassing the pool rules. */
const TREASURE_ROW = ACT1_LAYOUT.treasureRow!;
const REST_ROW = ACT1_LAYOUT.restRow!;
const FIXED_ROWS = new Set([0, TREASURE_ROW, REST_ROW]);
const RESTRICTED: ReadonlySet<RoomType> = new Set<RoomType>(['rest', 'shop', 'elite']);

/** Node ids reachable by walking children down from the starting floor. */
function reachable(map: GameMap): Set<string> {
  const seen = new Set<string>(map.byRow[0]);
  const queue = [...map.byRow[0]];
  while (queue.length > 0) {
    const node = map.nodes.get(queue.pop()!)!;
    for (const child of node.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return seen;
}

/** Column-ordered (parent, child) pairs for one floor's edges. */
function edgesOfRow(map: GameMap, row: number): [number, number][] {
  const out: [number, number][] = [];
  for (const id of map.byRow[row]) {
    const node = map.nodes.get(id)!;
    for (const childId of node.children) {
      out.push([node.col, map.nodes.get(childId)!.col]);
    }
  }
  return out;
}

describe(`generateMap over ${SEEDS} seeds`, () => {
  const maps = seeds.map((s) => generateMap(s, ACT1_LAYOUT));

  it('reproduces a layout exactly from its seed', () => {
    const shape = (m: GameMap) => [...m.nodes.values()].map((n) => `${n.id}:${n.type}:${n.x}`);
    expect(shape(generateMap('replay-me', ACT1_LAYOUT))).toEqual(shape(generateMap('replay-me', ACT1_LAYOUT)));
    expect(generateMap('replay-me', ACT1_LAYOUT).seed).toBe('replay-me');
  });

  it('mints its own seed when none is given, and reports it', () => {
    const map = generateMap(undefined, ACT1_LAYOUT);
    expect(map.seed).toMatch(/^[0-9a-z]+$/);
    expect(generateMap(map.seed, ACT1_LAYOUT).byRow).toEqual(map.byRow);
  });

  it('has the right shape: 15 floors plus a boss crown', () => {
    for (const map of maps) {
      expect(map.rows).toBe(ACT1_LAYOUT.rows);
      expect(map.byRow).toHaveLength(ACT1_LAYOUT.rows);
      for (let row = 0; row < ACT1_LAYOUT.rows; row++) expect(map.byRow[row].length).toBeGreaterThan(0);
      const boss = map.nodes.get(map.bossId)!;
      expect(boss.type).toBe('boss');
      expect(boss.parents.sort()).toEqual([...map.byRow[ACT1_LAYOUT.rows - 1]].sort());
    }
  });

  it('leaves every node reachable from the starting floor', () => {
    for (const map of maps) {
      const seen = reachable(map);
      const orphans = [...map.nodes.keys()].filter((id) => !seen.has(id));
      expect(orphans, `${map.seed} orphaned ${orphans.join(',')}`).toEqual([]);
      expect(seen.has(map.bossId)).toBe(true);
    }
  });

  it('never crosses two edges on the same floor', () => {
    for (const map of maps) {
      for (let row = 0; row < ACT1_LAYOUT.rows - 1; row++) {
        const edges = edgesOfRow(map, row);
        for (let i = 0; i < edges.length; i++) {
          for (let j = i + 1; j < edges.length; j++) {
            const [a, b] = edges[i];
            const [c, d] = edges[j];
            const crosses = (a < c && b > d) || (a > c && b < d);
            expect(crosses, `${map.seed} row ${row}: ${a}>${b} crosses ${c}>${d}`).toBe(false);
          }
        }
      }
    }
  });

  it('pins the fixed floors: combat, treasure, camp', () => {
    for (const map of maps) {
      for (const id of map.byRow[0]) expect(map.nodes.get(id)!.type).toBe('monster');
      for (const id of map.byRow[TREASURE_ROW]) expect(map.nodes.get(id)!.type).toBe('treasure');
      for (const id of map.byRow[REST_ROW]) expect(map.nodes.get(id)!.type).toBe('rest');
    }
  });

  it('locks elite / camp / shop out of the early floors', () => {
    for (const map of maps) {
      for (const node of map.nodes.values()) {
        if (node.id === map.bossId) continue;
        if (RESTRICTED.has(node.type)) {
          expect(node.row, `${map.seed} ${node.id} is ${node.type}`).toBeGreaterThanOrEqual(
            ACT1_LAYOUT.minAdvancedRow,
          );
        }
      }
      // A camp one floor under the guaranteed pre-boss camp is wasted.
      for (const id of map.byRow[REST_ROW - 1]) {
        expect(map.nodes.get(id)!.type).not.toBe('rest');
      }
    }
  });

  it('never repeats a restricted type up an edge', () => {
    for (const map of maps) {
      for (const node of map.nodes.values()) {
        if (!RESTRICTED.has(node.type)) continue;
        for (const parentId of node.parents) {
          const parent = map.nodes.get(parentId)!;
          expect(parent.type, `${map.seed} ${parentId} → ${node.id}`).not.toBe(node.type);
        }
      }
    }
  });

  it('never gives two siblings the same restricted type', () => {
    for (const map of maps) {
      for (const node of map.nodes.values()) {
        // The forced camp floor is a deliberate exception — every node on it is
        // a camp, siblings included.
        const children = node.children
          .map((id) => map.nodes.get(id)!)
          .filter((c) => !FIXED_ROWS.has(c.row) && RESTRICTED.has(c.type));
        const types = children.map((c) => c.type);
        expect(new Set(types).size, `${map.seed} under ${node.id}: ${types.join(',')}`).toBe(
          types.length,
        );
      }
    }
  });

  it('keeps the room mix in the shape the README describes', () => {
    const counts = new Map<RoomType, number>();
    let total = 0;
    for (const map of maps) {
      for (const node of map.nodes.values()) {
        if (node.id === map.bossId || FIXED_ROWS.has(node.row)) continue;
        counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
        total += 1;
      }
    }
    const share = (t: RoomType) => ((counts.get(t) ?? 0) / total) * 100;

    // Loose bands — this catches a pool or legality regression, not drift of a
    // percentage point.
    expect(share('monster')).toBeGreaterThan(share('event'));
    expect(share('event')).toBeGreaterThan(share('shop'));
    expect(share('monster')).toBeGreaterThan(40);
    expect(share('shop')).toBeGreaterThan(0);
    expect(share('shop')).toBeLessThan(10);
    expect(counts.get('elite')).toBeGreaterThan(0);
    expect(counts.get('rest')).toBeGreaterThan(0);
  });
});
