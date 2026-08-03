import { defineCombatScene } from '../types';

/**
 * 关羽三张传奇牌的综合演练场。
 *
 * 推荐顺序：武圣临世 → 青龙绝影 → 义绝千秋。
 * 华雄已有破绽，青龙绝影会走 36 点分支；8 点气足够在同一回合观察三张牌
 * 的特效、神力增伤、天佑、消耗与 X 费结算。
 */
export default defineCombatScene({
  name: '关羽传奇 · 三式合演',
  description: '华雄带破绽且血量加厚，关羽首回合持有三张传奇牌与 8 点气。',
  hero: 'guanyu',
  encounter: 'e1',
  seed: 'guanyu-legendary-scene1',
  relics: ['qinglongdao'],
  potions: ['zhuangxingjiu', 'tiejiasan', null],
  player: {
    hp: 58,
    maxHp: 82,
    energy: 8,
  },
  enemies: [
    {
      defId: 'huaxiong',
      hp: 220,
      maxHp: 220,
      statuses: { vulnerable: 1 },
      intent: 'sweep',
    },
  ],
  hand: [
    'wushenglinshi',
    'qinglongjueying',
    'yijueqianqiu',
    'wenjiu',
    'tiebi',
  ],
  drawPile: ['pikan', 'guaguliaodu', 'tiebi'],
  discardPile: ['tuodao'],
  exhaustPile: [],
});
