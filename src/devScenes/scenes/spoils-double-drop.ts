import { defineCombatScene } from '../types';

/**
 * 战罢结算的双收据版面：精英必掉宝物，POTION_DROP.elite 100 又必掉丹药，
 * 一枪收掉一点体力的华雄即达。腰间三瓶全满，先看「行囊已满 · 点击此瓶
 * 取舍」的宽标签行，点瓶取舍后再看「得【某某】」的窄标签行——两种宽度
 * 都要与宝物行同列对齐、整块居中。
 */
export default defineCombatScene({
  name: '战罢 · 双掉落收据',
  description: '华雄仅剩一点体力，一枪即胜；精英必掉宝物与丹药，满腰带可再走一遍取舍换标签。验战罢版面两行收据的对齐。',
  order: 95,
  hero: 'zhaoyun',
  encounter: 'e1',
  seed: 'spoils-double-drop',
  potions: ['tiejiasan', 'zhuangxingjiu', 'mihunsan'],
  player: { hp: 60, maxHp: 74 },
  enemies: [
    {
      defId: 'huaxiong',
      hp: 1,
    },
  ],
  hand: ['tuzhen', 'tuzhen', 'luema'],
  drawPile: ['luema', 'longdan', 'tuzhen'],
});
