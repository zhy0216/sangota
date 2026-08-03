import { defineCombatScene } from '../types';

/** 低血量与多段攻击把武圣临世的护甲、天佑和反打价值放在同一回合里。 */
export default defineCombatScene({
  name: '武圣临世 · 绝境反打',
  description: '关羽仅剩 24 体力，管亥将发动两段血战；先开武圣再决定进攻或防守。',
  order: 20,
  hero: 'guanyu',
  encounter: 'e2',
  seed: 'guanyu-wusheng-last-stand',
  relics: ['qinglongdao'],
  potions: ['tiejiasan', 'zhuangxingjiu', null],
  player: { hp: 24, maxHp: 82, energy: 6 },
  enemies: [
    {
      defId: 'guanhai',
      hp: 96,
      maxHp: 220,
      statuses: { angry: 1, strength: 2 },
      intent: 'deathfight',
    },
  ],
  hand: ['wushenglinshi', 'qinglongjueying', 'pikan', 'tiebi', 'yijueqianqiu'],
  drawPile: ['tiebi', 'tuodao', 'pikan'],
  discardPile: [],
  exhaustPile: [],
});
