import { defineCombatScene } from '../types';

export default defineCombatScene({
  name: '卧龙三策 · 传世奇谋',
  description: '奇门八阵立甲与造锦囊，七星续命救急；剩余气交给东风祭天，观察三张传世牌的演出。',
  order: 130,
  hero: 'zhugeliang',
  encounter: 'e1',
  seed: 'zhugeliang-legendary-release',
  relics: ['guanjin', 'sanguzhili', 'tianwenpan', 'qimendunjia'],
  player: { hp: 28, maxHp: 68, energy: 9 },
  enemies: [{ defId: 'huaxiong', hp: 240, maxHp: 240, intent: 'sweep' }],
  hand: ['qimenbazhen', 'qixingxuming', 'dongfengjitian', 'liufulong', 'huoshi'],
  drawPile: ['tuizhen', 'jinnang', 'yuanrongnu', 'huoshaoxinye', 'jushou'],
  discardPile: [],
  exhaustPile: [],
});
