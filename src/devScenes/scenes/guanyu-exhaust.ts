import { defineCombatScene } from '../types';

/** 三张传奇牌都是消耗牌，此场景专门验证它们与砺兵/武圣状态的接线。 */
export default defineCombatScene({
  name: '传奇消耗 · 砺兵武圣',
  description: '预置砺兵 3、武圣 2 与三张消耗牌；势牌不会触发，两张攻牌会返甲并加神力。',
  order: 40,
  hero: 'guanyu',
  encounter: 'e2',
  seed: 'guanyu-legendary-exhaust-engine',
  relics: ['qinglongdao'],
  player: {
    hp: 54,
    maxHp: 82,
    energy: 8,
    statuses: { armory: 3, warSaint: 2 },
  },
  enemies: [
    {
      defId: 'guanhai',
      hp: 230,
      maxHp: 230,
      statuses: { angry: 1, vulnerable: 1 },
      intent: 'axe',
    },
  ],
  hand: [
    'wushenglinshi',
    'qinglongjueying',
    'yijueqianqiu',
    'baizhanhuifeng',
    'tiebi',
  ],
  drawPile: ['duanpaojueyi', 'zhenqianlidao', 'pikan'],
  discardPile: ['tuodao'],
  exhaustPile: ['qingzhuangjiancong', 'wenjiu', 'pikan'],
});
