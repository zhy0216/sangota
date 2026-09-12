import { defineCombatScene } from '../types';

export default defineCombatScene({
  name: '卧龙锦囊 · 消耗成阵',
  description: '先打井田法、隆中对，再逐张打开锦囊；看护甲、宝物与消耗堆联动，最后用焚聚收尾。',
  order: 110,
  hero: 'zhugeliang',
  encounter: 'e1',
  seed: 'zhugeliang-jinnang-release',
  relics: ['guanjin', 'bagualu', 'kongmingdeng', 'wuhouci'],
  player: { hp: 54, maxHp: 68, energy: 6 },
  enemies: [{ defId: 'huaxiong', hp: 180, maxHp: 180, intent: 'sweep' }],
  hand: ['jingtianfa', 'longzhongdui', 'tuizhen', 'fenju', 'caolu'],
  drawPile: ['jushou', 'yuanrongnu', 'jiefeng', 'shangfanggu', 'tuntian'],
  discardPile: [],
  exhaustPile: [],
});
