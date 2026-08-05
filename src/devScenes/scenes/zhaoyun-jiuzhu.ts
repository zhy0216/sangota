import { defineCombatScene } from '../types';

/**
 * 半血以下的濒危反打：单骑救主双版本走 16/20 热面并回血；
 * 先怀抱幼主上天佑再打护主冲阵吃 13 点分支，玉狮跃坑的低血甲同步可测。
 * 李傕的长驱 19 点撞上天佑会被整笔吃掉；阿斗襁褓在首次受伤时补一层。
 * 抽牌堆里是体力代价轴：血染征袍、杀透重围与裹创的回款窗口。
 */
export default defineCombatScene({
  name: '单骑救主 · 濒危反打',
  description: '赵云仅剩 26 体力面对李傕长驱；低血分支、天佑链与体力代价牌同局验证。',
  order: 90,
  hero: 'zhaoyun',
  encounter: 'e4',
  seed: 'zhaoyun-jiuzhu-clutch',
  relics: ['yajiaoqiang', 'adouqiangbao'],
  potions: ['huitiandan', 'tiejiasan', null],
  player: { hp: 26, maxHp: 74, energy: 5 },
  enemies: [
    {
      defId: 'licui',
      hp: 104,
      maxHp: 104,
      intent: 'drive',
    },
  ],
  hand: [
    'danqijiuzhu',
    { id: 'danqijiuzhu', upgraded: 1 },
    'huaibaoyoudou',
    'huzhuchongzhen',
    'yushiyuekeng',
  ],
  drawPile: ['xueranzhengpao', 'shatouchongwei', 'guochuang'],
  discardPile: [],
  exhaustPile: [],
});
