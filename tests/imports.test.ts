import { describe, expect, it, vi } from 'vitest';

/**
 * The rules layer is a knot of import cycles by design — `statuses` calls into
 * `engine`, `engine` resolves cards and potions, `cards` merges the curse
 * tables — and a cycle is only safe as long as no module *reads a value* out of
 * another one while the graph is still being evaluated.
 *
 * `potions.ts` did exactly that: `color: STATUS_META.vulnerable.color` at
 * module scope crashed with "Cannot read properties of undefined" for anyone
 * whose first import was `statuses` or `curses`. Nothing caught it because
 * every existing test file happens to enter the cycle at a safe node.
 *
 * So: import each module *first*, in its own module registry, and check it came
 * up whole. The failure mode this guards is a load-time crash or a table that
 * silently evaluated to `{}`, both of which are invisible to behaviour tests
 * written against a graph that was entered somewhere else.
 */

/** Every module in the cycle, with one value that proves it evaluated fully. */
const ENTRY_POINTS: { path: string; check: (m: Record<string, unknown>) => void }[] = [
  {
    path: '../src/combat/statuses',
    check: (m) => {
      const meta = m.STATUS_META as Record<string, { color: number }>;
      expect(Object.keys(meta)).toHaveLength((m.STATUS_ORDER as string[]).length);
      expect(meta.vulnerable.color).toBeTypeOf('number');
    },
  },
  {
    path: '../src/combat/curses',
    check: (m) => {
      expect(Object.keys(m.CURSES as object).length).toBeGreaterThan(0);
      expect(Object.keys(m.STATUS_CARDS as object).length).toBeGreaterThan(0);
    },
  },
  {
    path: '../src/combat/potions',
    check: (m) => {
      const potions = m.POTIONS as Record<string, { color: number }>;
      for (const [id, def] of Object.entries(potions)) {
        expect(def.color, id).toBeTypeOf('number');
      }
    },
  },
  {
    path: '../src/combat/cards',
    check: (m) => {
      const cards = m.CARDS as Record<string, unknown>;
      // Merged from three tables, one of which is on the other side of a cycle.
      expect(cards.pikan).toBeDefined();
      expect(cards.tannian).toBeDefined();
      expect(cards.fenying).toBeDefined();
    },
  },
  {
    path: '../src/combat/engine',
    check: (m) => expect(m.startCombat).toBeTypeOf('function'),
  },
  {
    path: '../src/combat/intent',
    // Sits on the cycle too: it calls back into `engine` for the damage maths
    // and into `statuses` for the names. Both from inside functions (约定 7).
    check: (m) => expect(m.intentLabel).toBeTypeOf('function'),
  },
  {
    path: '../src/combat/relics',
    check: (m) => expect(Object.keys(m.RELICS as object).length).toBeGreaterThan(0),
  },
  {
    path: '../src/combat/rewards',
    check: (m) => expect(m.rollCardReward).toBeTypeOf('function'),
  },
  {
    path: '../src/state/run',
    check: (m) => expect(m.startRun).toBeTypeOf('function'),
  },
];

describe('module graph', () => {
  for (const { path, check } of ENTRY_POINTS) {
    it(`${path} loads when it leads the graph`, async () => {
      vi.resetModules();
      check((await import(/* @vite-ignore */ path)) as Record<string, unknown>);
    });
  }
});
