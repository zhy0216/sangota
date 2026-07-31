import { defineConfig } from 'vitest/config';

/**
 * Long-running balance simulation. Run it when tuning numbers, not on save.
 *
 * The two `sim/*.test.ts` suites ride along deliberately. They are on the
 * every-save path as well (`vitest.config.ts`), but `npm run sim` is what a
 * person runs *after* touching a number, and a balance table that moved while
 * a golden snapshot broke is not a balance result — it is a regression with a
 * table attached.
 */
export default defineConfig({
  test: {
    include: ['sim/balance.sim.ts', 'sim/*.test.ts'],
    testTimeout: 600_000,
  },
});
