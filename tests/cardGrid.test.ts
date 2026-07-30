import { describe, expect, it } from 'vitest';
import { CARDS, resolveCard } from '../src/combat/cards';
import { describeCard, previewValues } from '../src/combat/engine';
import { Rng } from '../src/core/rng';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, startRun } from '../src/state/run';
import { shuffleForDisplay, sortForDisplay, type CardGridEntry } from '../src/ui/cardOrder';

/**
 * `CardGrid.ts` itself imports Phaser, which cannot load under Node — the
 * ordering it hands every consumer lives in `cardOrder.ts` so it can be pinned
 * here, and the re-export is checked as source text below.
 */

const TYPE_RANK: Record<string, number> = { attack: 0, skill: 1, power: 2 };

const entry = (defId: string, upgraded = 0, uid = `${defId}-${upgraded}`): CardGridEntry => ({
  uid,
  defId,
  upgraded,
});

/** One of every card, in both upgrade states — 22 entries, deliberately jumbled. */
const everyCard = (): CardGridEntry[] =>
  shuffleForDisplay(
    Object.keys(CARDS).flatMap((defId) => [entry(defId, 0), entry(defId, 1)]),
    new Rng('jumble'),
  );

describe('sortForDisplay', () => {
  it('groups 攻 → 谋 → 势, then cost, then id', () => {
    const sorted = sortForDisplay(everyCard());
    for (let i = 1; i < sorted.length; i++) {
      const a = resolveCard(sorted[i - 1].defId, sorted[i - 1].upgraded);
      const b = resolveCard(sorted[i].defId, sorted[i].upgraded);
      const key = (e: CardGridEntry, d: typeof a): [number, number, string, string] => [
        TYPE_RANK[d.type],
        d.cost,
        e.defId,
        e.uid,
      ];
      expect(key(sorted[i - 1], a).join('|') <= key(sorted[i], b).join('|')).toBe(true);
    }
  });

  it('files a forged card by the cost its face shows', () => {
    // 结营 drops 2 气 → 1 when forged, so it must sit with the 1-cost 谋 cards.
    const sorted = sortForDisplay([entry('jieying', 0), entry('jieying', 1), entry('quedi', 0)]);
    expect(sorted.map((e) => e.uid)).toEqual(['jieying-1', 'quedi-0', 'jieying-0']);
  });

  it('breaks ties on uid, so two copies never swap between openings', () => {
    const copies = [entry('pikan', 0, 'd9'), entry('pikan', 0, 'd2'), entry('pikan', 0, 'd11')];
    expect(sortForDisplay(copies).map((e) => e.uid)).toEqual(['d11', 'd2', 'd9']);
    expect(sortForDisplay([...copies].reverse()).map((e) => e.uid)).toEqual(['d11', 'd2', 'd9']);
  });

  it('sorts the upgraded face when the grid is previewing an upgrade', () => {
    const preview: CardGridEntry = { ...entry('jieying', 0), previewUpgraded: true };
    expect(sortForDisplay([preview, entry('quedi', 0)])[0].uid).toBe('jieying-0');
  });

  it('leaves the caller’s array alone', () => {
    const run = startRun(DEFAULT_HERO, 'grid');
    const before = run.deck.map((c) => c.uid);
    sortForDisplay(run.deck);
    expect(run.deck.map((c) => c.uid)).toEqual(before);
  });

  it('orders a real starting deck the same way every time', () => {
    const run = startRun(DEFAULT_HERO, 'grid');
    const once = sortForDisplay(run.deck).map((e) => e.uid);
    const twice = sortForDisplay(shuffleForDisplay(run.deck, new Rng('x'))).map((e) => e.uid);
    expect(twice).toEqual(once);
    expect(once).toHaveLength(run.deck.length);
  });
});

describe('shuffleForDisplay', () => {
  const pile = () =>
    ['pikan', 'pikan', 'tiebi', 'tuodao', 'guanzhen', 'wanren', 'baima', 'quedi'].map((id, i) =>
      entry(id, 0, `d${i}`),
    );

  it('keeps the contents exactly, order aside', () => {
    const source = pile();
    const shown = shuffleForDisplay(source, new Rng('open-1'));
    expect(shown.map((e) => e.uid).sort()).toEqual(source.map((e) => e.uid).sort());
    expect(shown).toHaveLength(source.length);
  });

  it('does not disturb the pile it was handed', () => {
    const source = pile();
    const before = source.map((e) => e.uid);
    shuffleForDisplay(source, new Rng('open-1'));
    expect(source.map((e) => e.uid)).toEqual(before);
  });

  it('shows a different order on essentially every opening', () => {
    // The whole point: the player may know what is left, never what is next.
    const orders = new Set<string>();
    let asDealt = 0;
    const dealt = pile()
      .map((e) => e.uid)
      .join(',');
    for (let i = 0; i < 60; i++) {
      const shown = shuffleForDisplay(pile(), new Rng(`open-${i}`))
        .map((e) => e.uid)
        .join(',');
      orders.add(shown);
      if (shown === dealt) asDealt++;
    }
    expect(orders.size).toBeGreaterThan(50);
    expect(asDealt).toBeLessThanOrEqual(1);
  });
});

describe('card faces outside combat', () => {
  it('reads the printed numbers when there is no fight to read', () => {
    // The map has no CombatState, so no Strength, no Vulnerable, and no 青龙偃月.
    expect(previewValues(undefined, resolveCard('pikan', 0))).toEqual({ D: 6, B: 0, T: 1 });
    expect(previewValues(undefined, resolveCard('pikan', 1))).toEqual({ D: 9, B: 0, T: 1 });
    expect(describeCard(undefined, resolveCard('tiebi', 1))).toBe('获得 8 点护甲。');
  });

  it('never leaves a placeholder on the face', () => {
    for (const defId of Object.keys(CARDS)) {
      for (const upgraded of [0, 1]) {
        expect(describeCard(undefined, resolveCard(defId, upgraded))).not.toMatch(/\{[DB]\}/);
      }
    }
  });

  it('marks forged copies in the grid the way the deck stores them', () => {
    expect(resolveCard(newDeckCard('pikan', 1).defId, 1).name).toBe('劈砍·精');
  });
});

describe('CardGrid public surface', () => {
  const SOURCES: Record<string, string> = import.meta.glob('../src/ui/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('re-exports the shared ordering, so consumers import one name', () => {
    // 04 / 05 / 06 / 18 / 22 all reach for these through CardGrid.
    const src = SOURCES['../src/ui/CardGrid.ts'];
    expect(src).toMatch(/export \{ shuffleForDisplay, sortForDisplay \} from '\.\/cardOrder'/);
    expect(src).toMatch(/export function openCardGrid\(/);
    expect(src).toMatch(/export type \{ CardGridEntry \}/);
  });

  it('keeps the pure ordering free of Phaser', () => {
    expect(SOURCES['../src/ui/cardOrder.ts']).not.toMatch(/from '.*phaser'/i);
  });
});
