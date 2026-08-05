import { defineCombatScene } from '../types';

/**
 * 扩池遗物的五段阶梯：手上五张攻牌连打，第 1~5 次攻击各点亮一件——
 * 红缨（+2 甲）→ 涯角枪（+4 伤）→ 青釭剑（抽 2）→ 翊军印（回 1 气）
 * → 龙胆枪谱（重复结算）。第 5 张牌同时触发常山军旗的抽牌；
 * 回合结束再看亮银甲与得胜鼓的收尾。
 */
export default defineCombatScene({
  name: '连击遗物 · 五段阶梯',
  description: '装满赵云扩池遗物，五张攻牌把 1~5 攻的触发一次看全；虎豹骑当靶。',
  order: 80,
  hero: 'zhaoyun',
  encounter: 'm16',
  seed: 'zhaoyun-relic-ladder',
  relics: [
    'yajiaoqiang',
    'hongying',
    'qinggangjian',
    'yijunyin',
    'longdanqiangpu',
    'changshanjunqi',
    'deshenggu',
    'liangyinjia',
  ],
  player: { hp: 74, maxHp: 74, energy: 6 },
  enemies: [
    {
      defId: 'hubaoqi',
      hp: 130,
      maxHp: 130,
      intent: 'hoof',
    },
  ],
  hand: [
    'tuzhen',
    'lianhuanqiang',
    'jici',
    'longdan',
    'sanjinsanchu',
  ],
  drawPile: ['tingqiang', 'touzhen', 'duojian'],
  discardPile: [],
  exhaustPile: [],
});
