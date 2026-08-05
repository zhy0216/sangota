import { defineCombatScene } from '../types';

/**
 * 连击缩放的标尺场：先用 0 费疾刺/龙胆垫连击数，再比较基础与精铸
 * 七探盘蛇的段伤曲线（5/7 每段）；三攻之后枪挑高览翻倍到 30。
 * 长坂坡在抽牌堆顶，可续一轮边打边立甲的连刺。
 */
export default defineCombatScene({
  name: '七探盘蛇 · 连击标尺',
  description: '厚血华雄当靶，同手放基础与精铸七探盘蛇；0 费攻牌垫数后观察段数结算。',
  order: 60,
  hero: 'zhaoyun',
  encounter: 'e1',
  seed: 'zhaoyun-qitan-ruler',
  relics: ['yajiaoqiang'],
  player: { hp: 68, maxHp: 74, energy: 8 },
  enemies: [
    {
      defId: 'huaxiong',
      hp: 260,
      maxHp: 260,
      intent: 'sweep',
    },
  ],
  hand: [
    'jici',
    'longdan',
    'qitanpanshe',
    { id: 'qitanpanshe', upgraded: 1 },
    'qiangtiaogaolan',
  ],
  drawPile: ['changbanpo', 'tingqiang', 'tuzhen'],
  discardPile: [],
  exhaustPile: [],
});
