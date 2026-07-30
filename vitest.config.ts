import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `sim/balance.sim.ts` runs thousands of fights and is opt-in via
    // `npm run sim` — it must not be on the every-save path.
    include: ['tests/**/*.test.ts', 'sim/**/*.test.ts'],
  },
});
