import { defineCombatScene } from '../types';

/**
 * 赵云三张传奇牌的综合演练场。
 *
 * 推荐顺序：照夜破阵 → 0 费攻牌铺连击 → 七入长坂 → 龙吟震军。
 * 照夜破阵先回气补手；连击数到 3 后七入长坂附带回气抽牌，
 * 龙吟震军收全场并铺怯战。督尉的驱策展示三人房的斩首压力。
 */
export default defineCombatScene({
  name: '赵云传奇 · 三式合演',
  description: '西凉督尉领两名羌兵，赵云首回合持有三张传奇牌与 8 点气。',
  order: 50,
  hero: 'zhaoyun',
  encounter: 'm15',
  seed: 'zhaoyun-legendary-trio',
  relics: ['yajiaoqiang'],
  potions: ['zhuangxingjiu', 'tiejiasan', null],
  player: {
    hp: 60,
    maxHp: 74,
    energy: 8,
  },
  enemies: [
    {
      defId: 'xiliangduwei',
      hp: 40,
      maxHp: 40,
      intent: 'drive',
    },
    {
      defId: 'qiangbing',
      hp: 46,
      maxHp: 46,
      intent: 'blade',
    },
    {
      defId: 'qiangbing',
      hp: 46,
      maxHp: 46,
      intent: 'rally',
    },
  ],
  hand: [
    'zhaoyepozhen',
    'qiruchangban',
    'longyinzhenjun',
    'jici',
    'tuzhen',
  ],
  drawPile: ['longdan', 'tingqiang', 'luema'],
  discardPile: [],
  exhaustPile: [],
});
