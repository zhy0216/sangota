import { defineConfig } from 'vitest/config';

/** Opt-in scene matrix. Keep the ordinary test and legacy balance loops fast. */
export default defineConfig({
  test: { include: ['sim/cardAudit.sim.ts'], testTimeout: 600_000 },
});
