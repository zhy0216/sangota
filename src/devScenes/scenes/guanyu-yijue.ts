import { defineCombatScene } from '../types';

/** 同手放基础与精铸版本；刷新场景后换一张打，即可比较 X 费曲线。 */
export default defineCombatScene({
  name: '义绝千秋 · X 费标尺',
  description: '5 点气、破绽目标，同时提供基础与精铸版本；可先饮壮行酒测试 7 气结算。',
  order: 30,
  hero: 'guanyu',
  encounter: 'e1',
  seed: 'guanyu-yijue-energy-scale',
  relics: ['qinglongdao'],
  potions: ['zhuangxingjiu', 'junqingmibao', null],
  player: { hp: 62, maxHp: 82, energy: 5 },
  enemies: [
    {
      defId: 'huaxiong',
      hp: 260,
      maxHp: 260,
      statuses: { vulnerable: 1 },
      intent: 'sweep',
    },
  ],
  hand: [
    'yijueqianqiu',
    { id: 'yijueqianqiu', upgraded: 1 },
    'wenjiu',
    'tiebi',
    'pikan',
  ],
  drawPile: ['pikan', 'guaguliaodu', 'tiebi'],
  discardPile: [],
  exhaustPile: [],
});
