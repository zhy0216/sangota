import { defineCombatScene } from '../types';

/** 左侧无破绽，右侧已有破绽；两张青龙绝影可在同一局比较两个分支。 */
export default defineCombatScene({
  name: '青龙绝影 · 双靶分支',
  description: '左侧山贼走基础伤害，右侧山贼已有破绽；手中另有一张精铸版本。',
  order: 10,
  hero: 'guanyu',
  encounter: 'm3',
  seed: 'guanyu-qinglong-branches',
  relics: ['qinglongdao'],
  player: { hp: 82, maxHp: 82, energy: 6 },
  enemies: [
    {
      defId: 'bandit',
      hp: 140,
      maxHp: 140,
      statuses: {},
      intent: 'slash',
    },
    {
      defId: 'bandit',
      hp: 140,
      maxHp: 140,
      statuses: { vulnerable: 1 },
      intent: 'ambush',
    },
  ],
  hand: [
    'qinglongjueying',
    { id: 'qinglongjueying', upgraded: 1 },
    'wenjiu',
    'pikan',
    'tiebi',
  ],
  drawPile: ['tuodao', 'pikan', 'tiebi'],
  discardPile: [],
  exhaustPile: [],
});
