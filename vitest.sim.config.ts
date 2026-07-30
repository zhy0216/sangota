import { defineConfig } from 'vitest/config';

/** Long-running balance simulation. Run it when tuning numbers, not on save. */
export default defineConfig({
  test: {
    include: ['sim/balance.sim.ts'],
    testTimeout: 600_000,
  },
});
