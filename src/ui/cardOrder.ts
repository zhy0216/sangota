import { resolveCard } from '../combat/cards';
import type { CardType } from '../combat/types';
import type { Rng } from '../core/rng';

/**
 * Display ordering for the card grid. Kept out of `CardGrid.ts` so it can be
 * unit-tested — importing Phaser under Node throws on `window`.
 */

export interface CardGridEntry {
  uid: string;
  defId: string;
  upgraded: number;
  /** Dim + explain instead of offering the card (e.g. already forged). */
  disabled?: boolean;
  disabledReason?: string;
  /** Show the upgraded face without the card actually being upgraded yet. */
  previewUpgraded?: boolean;
}

/** 攻 → 谋 → 势 → 咒 → 厄. The dead weight files last, where it is countable. */
const TYPE_ORDER: Record<CardType, number> = {
  attack: 0,
  skill: 1,
  power: 2,
  curse: 3,
  status: 4,
};

/**
 * The one order every screen shows a pile in: type, then cost, then id. Cost
 * comes from the resolved def, so 结营·精 files with the 1-cost cards the way
 * its face reads. Returns a new array — callers keep their own pile order.
 */
export function sortForDisplay(entries: readonly CardGridEntry[]): CardGridEntry[] {
  const keyed = entries.map((entry) => {
    const def = resolveCard(entry.defId, entry.previewUpgraded ? 1 : entry.upgraded);
    return { entry, type: TYPE_ORDER[def.type], cost: def.cost };
  });
  keyed.sort(
    (a, b) =>
      a.type - b.type ||
      a.cost - b.cost ||
      (a.entry.defId < b.entry.defId ? -1 : a.entry.defId > b.entry.defId ? 1 : 0) ||
      (a.entry.uid < b.entry.uid ? -1 : a.entry.uid > b.entry.uid ? 1 : 0),
  );
  return keyed.map((k) => k.entry);
}

/**
 * Draw-pile order. The player is allowed to know *what* is left but not *when*
 * it comes, so the display is scrambled on every open — the pile itself is
 * untouched.
 */
export function shuffleForDisplay(entries: readonly CardGridEntry[], rng: Rng): CardGridEntry[] {
  return rng.shuffle([...entries]);
}
