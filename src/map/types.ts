export type RoomType =
  | 'monster'
  | 'elite'
  | 'event'
  | 'shop'
  | 'rest'
  | 'treasure'
  | 'boss';

export interface RoomMeta {
  /** Display name on the map tooltip. */
  label: string;
  /** One-line flavour, shown under the label. */
  desc: string;
  /** Texture key registered in BootScene. */
  icon: string;
  /** Accent colour for the node ring + hover glow. */
  accent: number;
}

export interface MapNode {
  id: string;
  row: number;
  col: number;
  type: RoomType;
  /** Position in map-space pixels (origin = top-left of the scrollable map). */
  x: number;
  y: number;
  children: string[];
  parents: string[];
  visited: boolean;
}

export interface GameMap {
  seed: string;
  rows: number;
  cols: number;
  width: number;
  height: number;
  nodes: Map<string, MapNode>;
  /** Node ids per row, ordered by column. Index 0 is the starting floor. */
  byRow: string[][];
  bossId: string;
}

export const nodeKey = (row: number, col: number): string => `${row}_${col}`;
