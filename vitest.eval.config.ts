import { defineConfig } from 'vitest/config';

/**
 * 平衡评估仪器（`npm run eval`）——比 `npm run sim` 更重，只在调参会话里跑。
 *
 * 与 sim 配置分开是刻意的：`npm run sim` 是改数后的验收闸门，必须保持在
 * 一分钟内让人愿意每次都跑；这里的卡牌/宝物逐张扫描随内容池线性变慢，
 * 混进去闸门迟早没人跑。
 */
export default defineConfig({
  test: {
    include: ['sim/evaluate.sim.ts'],
    testTimeout: 600_000,
  },
});
