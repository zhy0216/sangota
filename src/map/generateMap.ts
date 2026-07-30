import { MAP } from '../config';
import { Rng } from '../core/rng';
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

export function generateMap(seedInput?: string): GameMap {
  const seed = seedInput ?? Math.floor(Math.random() * 0xffffffff).toString(36);
  const rng = new Rng(seed);

  const { rows, cols, paths } = MAP;
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
  assignRoomTypes(rng, nodes, byRow, rows);

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
  rows: number,
): void {
  for (let row = 0; row < rows; row++) {
    for (const id of byRow[row]) {
      const node = nodes.get(id)!;

      if (row === 0) {
        node.type = 'monster';
        continue;
      }
      if (row === MAP.treasureRow) {
        node.type = 'treasure';
        continue;
      }
      if (row === MAP.restRow) {
        node.type = 'rest';
        continue;
      }

      node.type = rollType(rng, node, nodes, byRow);
    }
  }
}

function rollType(
  rng: Rng,
  node: MapNode,
  nodes: Map<string, MapNode>,
  byRow: string[][],
): RoomType {
  const items = POOL.map((p) => p.type);
  const weights = POOL.map((p) => p.weight);

  // Try a bounded number of weighted rolls, then fall back to the always-legal
  // options so generation can never wedge.
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = rng.weighted(items, weights);
    if (isLegal(candidate, node, nodes, byRow)) return candidate;
  }
  return rng.weighted(['monster', 'event'], [0.7, 0.3]);
}

function isLegal(
  type: RoomType,
  node: MapNode,
  nodes: Map<string, MapNode>,
  byRow: string[][],
): boolean {
  if (RESTRICTED.has(type)) {
    // Elite / rest / shop are gated behind the early floors.
    if (node.row < MAP.minAdvancedRow) return false;

    // A rest one floor below the guaranteed pre-boss rest is wasted.
    if (type === 'rest' && node.row === MAP.restRow - 1) return false;

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
