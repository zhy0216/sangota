import { describe, expect, it } from 'vitest';
import { ACT1_LAYOUT, generateMap } from '../src/map/generateMap';
import type { GameMap, RoomType } from '../src/map/types';
import { Rng } from '../src/core/rng';

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

  it('keeps every edge unique, symmetric and between adjacent cells', () => {
    for (const map of maps) {
      for (const node of map.nodes.values()) {
        expect(new Set(node.children).size, `${map.seed}/${node.id} duplicate child`).toBe(
          node.children.length,
        );
        expect(new Set(node.parents).size, `${map.seed}/${node.id} duplicate parent`).toBe(
          node.parents.length,
        );
        for (const childId of node.children) {
          const child = map.nodes.get(childId)!;
          expect(child.parents, `${map.seed} ${node.id} -> ${childId}`).toContain(node.id);
          if (childId === map.bossId) continue;
          expect(child.row).toBe(node.row + 1);
          expect(Math.abs(child.col - node.col)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('roughly doubles strategic branching without changing room density', () => {
    let nodes = 0;
    let walkable = 0;
    let branches = 0;
    let routeChoices = 0;
    for (const map of maps) {
      nodes += map.nodes.size - 1;
      const parents = map.byRow
        .slice(0, map.rows - 1)
        .flatMap((row) => row.map((id) => map.nodes.get(id)!));
      walkable += parents.length;
      branches += parents.filter((node) => node.children.length > 1).length;

      const rng = new Rng(`${map.seed}:route-choice-probe`);
      let choices = map.byRow[0].length > 1 ? 1 : 0;
      let node = map.nodes.get(rng.pick(map.byRow[0]))!;
      while (node.id !== map.bossId) {
        if (node.children.length > 1) choices += 1;
        node = map.nodes.get(rng.pick(node.children))!;
      }
      routeChoices += choices;
    }

    const averageNodes = nodes / maps.length;
    const branchShare = branches / walkable;
    const averageChoices = routeChoices / maps.length;
    expect(averageNodes).toBeGreaterThan(45);
    expect(averageNodes).toBeLessThan(49);
    expect(branchShare).toBeGreaterThan(0.28);
    expect(branchShare).toBeLessThan(0.33);
    expect(averageChoices).toBeGreaterThan(5.8);
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

/**
 * 天命 (todos/19 a2) — `extraElites` 提格。规则本体在上面那组测试里逐条
 * 站着，这里只问三件事：零重恒等（黄金快照与既有 seed 的命门）、
 * 提上去的数量对、提上去的位置不破任何一条既有规则。
 */
describe('extraElites (todos/19 a2)', () => {
  const extraSeeds = seeds.slice(0, 120);
  const eliteCount = (m: GameMap): number =>
    [...m.nodes.values()].filter((n) => n.type === 'elite').length;

  it('零重恒等：extraElites 0（或不传）一次骰子都不掷，整张图分毫不动', () => {
    const shape = (m: GameMap): string =>
      [...m.nodes.values()].map((n) => `${n.id}:${n.type}:${n.x}:${n.y}`).join('|');
    for (const seed of extraSeeds) {
      expect(shape(generateMap(seed, ACT1_LAYOUT, 0)), seed).toBe(
        shape(generateMap(seed, ACT1_LAYOUT)),
      );
    }
  });

  it('一重恰好多一间精英房', () => {
    for (const seed of extraSeeds) {
      expect(eliteCount(generateMap(seed, ACT1_LAYOUT, 1)), seed).toBe(
        eliteCount(generateMap(seed, ACT1_LAYOUT)) + 1,
      );
    }
  });

  it('提格不破既有规则：固定层、minAdvancedRow、同边不重复、同父兄弟不重复', () => {
    for (const seed of extraSeeds) {
      const map = generateMap(seed, ACT1_LAYOUT, 3);
      for (const node of map.nodes.values()) {
        if (node.id === map.bossId || node.type !== 'elite') continue;
        expect(FIXED_ROWS.has(node.row), `${seed} ${node.id} 占了固定层`).toBe(false);
        expect(node.row, `${seed} ${node.id}`).toBeGreaterThanOrEqual(ACT1_LAYOUT.minAdvancedRow);
        for (const parentId of node.parents) {
          const parent = map.nodes.get(parentId)!;
          expect(parent.type, `${seed} ${parentId} → ${node.id}`).not.toBe('elite');
          for (const siblingId of parent.children) {
            if (siblingId === node.id) continue;
            expect(
              map.nodes.get(siblingId)!.type,
              `${seed} ${node.id} 与 ${siblingId} 同父同为精英`,
            ).not.toBe('elite');
          }
        }
      }
    }
  });

  it('候选挑干净就收手——规则约束优先于精英数量', () => {
    // 一个荒唐大的 extra 必须停在有限、合法的数上，而不是死循环或破规则
    // （合法性上一条已查；这里只查它真的收了手）。
    const map = generateMap('elite-flood', ACT1_LAYOUT, 99);
    const free = [...map.nodes.values()].filter(
      (n) => n.id !== map.bossId && !FIXED_ROWS.has(n.row),
    );
    expect(eliteCount(map)).toBeGreaterThan(0);
    expect(eliteCount(map)).toBeLessThan(free.length);
  });
});
