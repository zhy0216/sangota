/**
 * 解锁轨道 (todos/23 设计方案) — 纯数据，规则在 `src/state/unlocks.ts`。
 *
 * 门只锁**后加的内容**：不在任何轨道里出现的牌/宝物/武将一律视为初始解锁
 * （见 `isUnlocked`），所以「初始解锁集合」不用抄一份清单——关羽的原始 11 张
 * （劈砍…许诺，todos/11 扩池前的那批）、全部无色牌、以及未被 `HERO_UNLOCKS`
 * 点名的武将，天然就是开着的。这也意味着日后新增内容**默认可见**，要分批
 * 放出就在这里加一行，忘了加也只是少一道门，不会凭空锁死谁。
 *
 * 轨道内容引用的都是 defId / relic id / hero id——`tests/unlocks.test.ts`
 * 逐个对着 `CARDS` / `RELICS` / `HEROES` 查，写错 id 会当场红。
 */

/** 一批按累积分数放出的内容。三选一的语义见 `applyRunUnlocks`。 */
export interface UnlockBatch {
  heroId: string;
  /** 该武将的累积「史笔」分数达到此值时放出这一批。 */
  atScore: number;
  /** 三选一的卡：玩家选一张优先解锁，其余随下一批自动解锁。 */
  cardChoice?: string[];
  /** 不用选、跨过阈值就直接解锁的卡。 */
  cards?: string[];
  relics?: string[];
}

/**
 * 分数轨道。目前只有关羽的三批——赵云/诸葛亮的扩池 (todos/17) 随武将本体
 * 一起放出，不再单独设卡牌门：解锁一个新武将本身就是那批「新东西」。
 *
 * 批内三选一取「常见 / 罕见 / 稀有」各一张，让每次选择都在「稳定入组」和
 * 「憋大招」之间为难；自动批装剩下的中坚牌。13 张扩池牌 (todos/11) 三批
 * 放完：3 + (3+2) + (3+2)。
 */
export const UNLOCK_TRACKS: UnlockBatch[] = [
  {
    heroId: 'guanyu',
    atScore: 200,
    cardChoice: ['dandaofuhui', 'shuiyanqijun', 'weizhenhuaxia'],
  },
  {
    heroId: 'guanyu',
    atScore: 500,
    cardChoice: ['huarongdao', 'zhanyanliang', 'wuguanliujiang'],
    cards: ['bingzhudadan', 'hulaoguan'],
    // 两件普通宝物：先登盾、玄甲——都是锦上添花的数值件,锁住不缺口粮。
    relics: ['xiandengdun', 'xuanjia'],
  },
  {
    heroId: 'guanyu',
    atScore: 900,
    cardChoice: ['yeduchunqiu', 'tushanyuesanshi', 'shengougaolei'],
    cards: ['wubaijiaodaoshou', 'guaguliaodu'],
    // 一件稀有宝物：古锭刀本就是关羽专属 (todos/17)，压轴他自己的轨道。
    relics: ['gudingdao'],
  },
];

/** 按通关次数放出的武将。 */
export interface HeroUnlock {
  heroId: string;
  /** 任意武将累计通关这么多次后解锁。 */
  victories: number;
}

/**
 * 通关一次解锁赵云，两次解锁诸葛亮 (todos/23 设计方案)。
 * 周瑜 (`victories: 3`) 还不存在于 `HEROES`，行先不写——`unlocks.ts` 对
 * 查不到的 heroId 一律跳过，等他进武将表再补一行即可。
 */
export const HERO_UNLOCKS: HeroUnlock[] = [
  { heroId: 'zhaoyun', victories: 1 },
  { heroId: 'zhugeliang', victories: 2 },
];
