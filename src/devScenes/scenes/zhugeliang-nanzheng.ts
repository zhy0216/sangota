import { defineCombatScene } from '../types';

export default defineCombatScene({
  name: '南征定计 · 瘴气破甲',
  description: '先以瘴气、五溪叠毒，再用绝营与八望阵压制护甲和攻势；中毒在敌方回合穿过护甲扣血。',
  order: 120,
  hero: 'zhugeliang',
  encounter: 'e1',
  seed: 'zhugeliang-nanzheng-release',
  relics: ['guanjin', 'chibitufu', 'qingnangyaojuan', 'jiangyuantu'],
  player: { hp: 48, maxHp: 68, energy: 6 },
  enemies: [{ defId: 'huaxiong', hp: 180, maxHp: 180, block: 30, intent: 'sweep' }],
  hand: ['zhangqi', 'wuxilu', 'jueying', 'bawangzhen', 'yangsheng'],
  drawPile: ['duandao', 'jushou', 'huoshaoxinye', 'zhangqi', 'wuxilu'],
  discardPile: [],
  exhaustPile: [],
});
