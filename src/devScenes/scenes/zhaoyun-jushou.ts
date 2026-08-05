import { defineCombatScene } from '../types';

/**
 * 据守反击轴对上最能喂回枪的连弩兵：两轮四连弩共八箭，
 * 回马枪每中一箭返 3 点护甲，坚壁的反刺再逐箭扎回去。
 * 预置 8 点护甲让据枪（≥5）与乘隙（≥5）开场即走高分支，
 * 再叠到 10 以上收枪出如龙的 20 点。
 */
export default defineCombatScene({
  name: '据守反击 · 回马枪',
  description: '两名连弩兵齐射，赵云预置 8 点护甲；回枪、反刺与护甲阈值牌同回合可测。',
  order: 70,
  hero: 'zhaoyun',
  encounter: 'm18',
  seed: 'zhaoyun-jushou-riposte',
  relics: ['yajiaoqiang'],
  potions: ['tiejiasan', null, null],
  player: { hp: 70, maxHp: 74, block: 8, energy: 6 },
  enemies: [
    {
      defId: 'lianubing',
      hp: 52,
      maxHp: 52,
      intent: 'volley',
    },
    {
      defId: 'lianubing',
      hp: 52,
      maxHp: 52,
      intent: 'volley',
    },
  ],
  hand: [
    'huimaqiang',
    'jianbi',
    'juqiang',
    'qiangchurulong',
    'chengxi',
  ],
  drawPile: ['juma', 'hanshuijushou', 'xianmei'],
  discardPile: [],
  exhaustPile: [],
});
