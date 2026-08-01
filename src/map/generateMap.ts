import { MAP } from '../config';
import { Rng, randomSeed } from '../core/rng';
import { nodeKey, type GameMap, type MapNode, type RoomType } from './types';

/**
 * Slay-the-Spire-style act map generation.
 *
 * Two phases:
 *  1. Carve `paths` random walks from the bottom floor to the top floor. Every
 *     visited cell becomes a node; every step becomes an edge. Walks may share
 *     cells, which is what produces the branching-then-merging silhouette.
 *  2. Assign a room type to each node under the design rules (fixed floors,
 *     lockouts below floor 6, no repeats along an edge or between siblings).
 */

const WALK_STEPS = [-1, 0, 1] as const;

/** Weighted pool for the "free" floors. Mirrors StS's room distribution. */
const POOL: { type: RoomType; weight: number }[] = [
  { type: 'monster', weight: 0.45 },
  { type: 'event', weight: 0.22 },
  { type: 'elite', weight: 0.16 },
  { type: 'rest', weight: 0.12 },
  { type: 'shop', weight: 0.05 },
];

/** Types that may not repeat across an edge or between siblings. */
const RESTRICTED: ReadonlySet<RoomType> = new Set<RoomType>(['rest', 'shop', 'elite']);

const edgeKey = (row: number, from: number, to: number) => `${row}:${from}>${to}`;

/**
 * The shape of one act's map: how tall it is and which floors are fixed.
 *
 * Split out of `MAP` (which keeps the geometry — lane count, spacing, jitter)
 * because every act has its own shape (`ACTS`, `src/data/acts.ts`), and the
 * only honest way to
 * express that is to pass it in. A module-level read would silently generate
 * 第二幕 with 第一幕's floor plan.
 *
 * `null` on a fixed row means the act has no such floor at all.
 */
export interface ActLayout {
  rows: number;
  treasureRow: number | null;
  restRow: number | null;
  /** Elite / rest / shop are locked out below this floor. */
  minAdvancedRow: number;
}

/**
 * 第一幕's shape — the numbers that lived in `MAP` before acts existed, moved
 * verbatim. `startRun` passes this, so **every existing seed generates exactly
 * the map it always did**; `ACTS[1].layout` is this very object by reference,
 * and must stay that way or every 第一幕 in every saved seed changes.
 */
export const ACT1_LAYOUT: ActLayout = {
  rows: 15,
  treasureRow: 8,
  restRow: 14,
  minAdvancedRow: 5,
};

export function generateMap(
  seedInput: string | undefined,
  layout: ActLayout,
  extraElites = 0,
): GameMap {
  const seed = seedInput ?? randomSeed();
  const rng = new Rng(seed);

  const { rows } = layout;
  const { cols, paths } = MAP;
  const cells = new Set<string>();
  const edges = new Set<string>();
  /** row -> col -> set of child cols, so we can build the graph after carving. */
  const links = new Map<string, Set<number>>();

  const addLink = (row: number, from: number, to: number) => {
    const k = nodeKey(row, from);
    if (!links.has(k)) links.set(k, new Set());
    links.get(k)!.add(to);
    edges.add(edgeKey(row, from, to));
  };

  // --- Phase 1: carve paths -------------------------------------------------
  const starts: number[] = [];
  for (let p = 0; p < paths; p++) {
    let col = rng.int(cols);
    // StS guarantees the first two paths start on different columns, so the
    // opening floor is never a single forced node.
    if (p === 1 && col === starts[0]) col = (col + 1 + rng.int(cols - 1)) % cols;
    starts.push(col);
    cells.add(nodeKey(0, col));

    for (let row = 0; row < rows - 1; row++) {
      const next = pickNextCol(rng, row, col, cols, edges);
      addLink(row, col, next);
      cells.add(nodeKey(row + 1, next));
      col = next;
    }
  }

  // --- Build the graph ------------------------------------------------------
  const nodes = new Map<string, MapNode>();
  const byRow: string[][] = Array.from({ length: rows }, () => []);

  for (const key of cells) {
    const [rowStr, colStr] = key.split('_');
    const row = Number(rowStr);
    const col = Number(colStr);
    nodes.set(key, {
      id: key,
      row,
      col,
      type: 'monster',
      x: 0,
      y: 0,
      children: [],
      parents: [],
      visited: false,
    });
    byRow[row].push(key);
  }
  for (const row of byRow) {
    row.sort((a, b) => nodes.get(a)!.col - nodes.get(b)!.col);
  }

  for (const [fromKey, childCols] of links) {
    const from = nodes.get(fromKey)!;
    for (const childCol of childCols) {
      const toKey = nodeKey(from.row + 1, childCol);
      const to = nodes.get(toKey);
      if (!to) continue;
      from.children.push(toKey);
      to.parents.push(fromKey);
    }
  }

  // --- Phase 2: assign room types ------------------------------------------
  assignRoomTypes(rng, nodes, byRow, layout);
  promoteExtraElites(rng, nodes, byRow, layout, extraElites);

  // --- Boss crown -----------------------------------------------------------
  const bossId = 'boss';
  const boss: MapNode = {
    id: bossId,
    row: rows,
    col: (cols - 1) / 2,
    type: 'boss',
    x: 0,
    y: 0,
    children: [],
    parents: [...byRow[rows - 1]],
    visited: false,
  };
  nodes.set(bossId, boss);
  for (const id of byRow[rows - 1]) nodes.get(id)!.children.push(bossId);

  // --- Layout ---------------------------------------------------------------
  const width = MAP.marginX * 2 + (cols - 1) * MAP.colSpacing;
  const height = MAP.marginTop + MAP.marginBottom + rows * MAP.rowSpacing;

  for (const node of nodes.values()) {
    const isBoss = node.id === bossId;
    const jx = isBoss ? 0 : rng.jitter(MAP.jitterX);
    const jy = isBoss ? 0 : rng.jitter(MAP.jitterY);
    node.x = MAP.marginX + node.col * MAP.colSpacing + jx;
    // Row 0 sits at the bottom and the boss at the very top, StS-style.
    node.y = height - MAP.marginBottom - node.row * MAP.rowSpacing + jy;
  }

  return { seed, rows, cols, width, height, nodes, byRow, bossId };
}

/**
 * 终章 — three rooms in a column, and not one die rolled.
 *
 * A generated map is the wrong shape for a finale: the whole point is that
 * there is no route to choose, so 「精英 → 篝火 → 首领」 is the map. Building it
 * by hand rather than by seeding a 3-row `generateMap` also keeps it out of the
 * random stream entirely — the 终章 costs no draws, so unlocking it cannot
 * shift anything an existing seed does anywhere else.
 *
 * **`seed` is still required, and it is not decoration.** The layout ignores
 * it, but `GameMap.seed` is *also* the prefix every room stream in the act is
 * derived from (`streamSeed`, `src/rooms/rng.ts`) and the only place the run's
 * own seed survives once the map is swapped (`runSeedOf`, `src/data/acts.ts`).
 * A literal here — it used to be `'final'` — made 司马懿's shuffle, the 战利品
 * chest, the elite's relic and every reward roll in the 终章 identical for
 * every seed ever played, and left `runSeedOf` unable to name the run at all.
 *
 * Node ids follow the same `row_col` convention every other act uses, and the
 * boss keeps the literal id `boss`, so the room layer needs no special case.
 */
export function generateFinalAct(seed: string): GameMap {
  const rows = 2;
  const cols = MAP.cols;
  const mid = (cols - 1) / 2;
  const order: RoomType[] = ['elite', 'rest'];

  const nodes = new Map<string, MapNode>();
  const byRow: string[][] = [[], []];

  order.forEach((type, row) => {
    const id = nodeKey(row, 0);
    nodes.set(id, {
      id,
      row,
      col: mid,
      type,
      x: 0,
      y: 0,
      children: [],
      parents: [],
      visited: false,
    });
    byRow[row].push(id);
  });

  const bossId = 'boss';
  nodes.set(bossId, {
    id: bossId,
    row: rows,
    col: mid,
    type: 'boss',
    x: 0,
    y: 0,
    children: [],
    parents: [nodeKey(1, 0)],
    visited: false,
  });
  nodes.get(nodeKey(0, 0))!.children.push(nodeKey(1, 0));
  nodes.get(nodeKey(1, 0))!.parents.push(nodeKey(0, 0));
  nodes.get(nodeKey(1, 0))!.children.push(bossId);

  const width = MAP.marginX * 2 + (cols - 1) * MAP.colSpacing;
  const height = MAP.marginTop + MAP.marginBottom + rows * MAP.rowSpacing;
  for (const node of nodes.values()) {
    node.x = MAP.marginX + node.col * MAP.colSpacing;
    node.y = height - MAP.marginBottom - node.row * MAP.rowSpacing;
  }

  return { seed, rows, cols, width, height, nodes, byRow, bossId };
}

/**
 * Pick the next column for a walk, rejecting moves that would visually cross an
 * edge already carved by an earlier path. With ±1 steps the only possible
 * crossing is a direct swap between two neighbouring columns.
 */
function pickNextCol(
  rng: Rng,
  row: number,
  col: number,
  cols: number,
  edges: Set<string>,
): number {
  const candidates = WALK_STEPS.map((d) => col + d).filter((c) => {
    if (c < 0 || c >= cols) return false;
    if (c === col + 1 && edges.has(edgeKey(row, col + 1, col))) return false;
    if (c === col - 1 && edges.has(edgeKey(row, col - 1, col))) return false;
    return true;
  });
  return candidates.length > 0 ? rng.pick(candidates) : col;
}

function assignRoomTypes(
  rng: Rng,
  nodes: Map<string, MapNode>,
  byRow: string[][],
  layout: ActLayout,
): void {
  for (let row = 0; row < layout.rows; row++) {
    for (const id of byRow[row]) {
      const node = nodes.get(id)!;

      if (row === 0) {
        node.type = 'monster';
        continue;
      }
      if (row === layout.treasureRow) {
        node.type = 'treasure';
        continue;
      }
      if (row === layout.restRow) {
        node.type = 'rest';
        continue;
      }

      node.type = rollType(rng, node, nodes, byRow, layout);
    }
  }
}

/**
 * 天命 (todos/19)：把 `count` 间已定型的 monster/event 房提成精英。
 *
 * 事后提格而不是给 `POOL` 里的 elite 加权——加权改变每一次 `rollType` 的
 * 命中，零重的地图会整张重排；提格则在 `count === 0` 时**一次骰子都不掷**，
 * 既有 seed 的每一个节点、每一个 jitter 都原样（`tests/generateMap.test.ts`
 * 对此有恒等断言）。
 *
 * 候选按 `eliteUpgradeLegal` 过滤，现有规则一条不破：固定层不动、
 * `minAdvancedRow` 之下不放、同边（父/子）不重复、同父兄弟不重复。候选
 * 挑干净了就提前收手——规则约束优先于精英数量。
 */
function promoteExtraElites(
  rng: Rng,
  nodes: Map<string, MapNode>,
  byRow: string[][],
  layout: ActLayout,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const candidates: MapNode[] = [];
    for (let row = Math.max(1, layout.minAdvancedRow); row < layout.rows; row++) {
      if (row === layout.treasureRow || row === layout.restRow) continue;
      for (const id of byRow[row]) {
        const node = nodes.get(id)!;
        if (node.type !== 'monster' && node.type !== 'event') continue;
        if (eliteUpgradeLegal(node, nodes)) candidates.push(node);
      }
    }
    if (candidates.length === 0) return;
    rng.pick(candidates).type = 'elite';
  }
}

/**
 * `isLegal` 的事后版。原版是自下而上边填边查，只看父辈和已填的兄弟就够；
 * 提格发生在全图定型之后，所以父、子、兄弟三个方向都要查，否则提上去的
 * 精英会和**晚它一行**才定型的邻居撞在同一条边上。
 */
function eliteUpgradeLegal(node: MapNode, nodes: Map<string, MapNode>): boolean {
  for (const parentId of node.parents) {
    const parent = nodes.get(parentId)!;
    if (parent.type === 'elite') return false;
    for (const siblingId of parent.children) {
      if (siblingId !== node.id && nodes.get(siblingId)?.type === 'elite') return false;
    }
  }
  for (const childId of node.children) {
    if (nodes.get(childId)?.type === 'elite') return false;
  }
  return true;
}

function rollType(
  rng: Rng,
  node: MapNode,
  nodes: Map<string, MapNode>,
  byRow: string[][],
  layout: ActLayout,
): RoomType {
  const items = POOL.map((p) => p.type);
  const weights = POOL.map((p) => p.weight);

  // Try a bounded number of weighted rolls, then fall back to the always-legal
  // options so generation can never wedge.
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = rng.weighted(items, weights);
    if (isLegal(candidate, node, nodes, byRow, layout)) return candidate;
  }
  return rng.weighted(['monster', 'event'], [0.7, 0.3]);
}

function isLegal(
  type: RoomType,
  node: MapNode,
  nodes: Map<string, MapNode>,
  byRow: string[][],
  layout: ActLayout,
): boolean {
  if (RESTRICTED.has(type)) {
    // Elite / rest / shop are gated behind the early floors.
    if (node.row < layout.minAdvancedRow) return false;

    // A rest one floor below the guaranteed pre-boss rest is wasted.
    if (layout.restRow !== null && type === 'rest' && node.row === layout.restRow - 1) {
      return false;
    }

    // No repeat straight up an edge.
    for (const parentId of node.parents) {
      if (nodes.get(parentId)!.type === type) return false;
    }

    // No two siblings (nodes sharing a parent) with the same restricted type —
    // otherwise a branch choice stops being a real choice.
    for (const parentId of node.parents) {
      for (const siblingId of nodes.get(parentId)!.children) {
        if (siblingId === node.id) continue;
        const sibling = nodes.get(siblingId);
        if (sibling && sibling.type === type && byRow[sibling.row].indexOf(siblingId) < byRow[node.row].indexOf(node.id)) {
          return false;
        }
      }
    }
  }
  return true;
}
