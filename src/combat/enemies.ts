import type { Rng } from '../core/rng';
import type { EnemyDef, EnemyMove, EnemyPhase, Encounter } from './types';

/**
 * 敌军名录 — every enemy is a row, and every behaviour it has is a field of that
 * row. The engine reads the table and branches on no enemy id anywhere: a new
 * enemy is a new row here and nothing else.
 *
 * Every enemy now carries its own portrait (todos/15 step 7 landed): `art` is
 * `enemy-<id>`，图在 `public/assets/enemies/<id>.png`，钥匙登记在 BootScene 的
 * `ENEMY_KEYS`。三者要一起动——键无图是加载错误的 `?` 占位，图无键是 Phaser
 * 的绿色缺纹理框。
 */

export const ENEMIES: Record<string, EnemyDef> = {
  yellowturban: {
    id: 'yellowturban',
    name: '黄巾力士',
    art: 'enemy-yellowturban',
    hp: [42, 50],
    height: 236,
    moves: [
      { id: 'chop', label: '劈斩', damage: 9, weight: 3, maxRepeat: 2 },
      {
        id: 'roar',
        label: '鼓噪',
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
      { id: 'guard', label: '据守', damage: 5, block: 6, weight: 2, maxRepeat: 1 },
    ],
  },
  bandit: {
    id: 'bandit',
    name: '山贼',
    art: 'enemy-bandit',
    hp: [28, 34],
    height: 212,
    moves: [
      { id: 'slash', label: '双斧', damage: 5, hits: 2, weight: 3, maxRepeat: 2 },
      {
        id: 'ambush',
        label: '偷袭',
        damage: 4,
        status: { status: 'weak', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },
  huaxiong: {
    id: 'huaxiong',
    name: '华雄',
    art: 'enemy-huaxiong',
    hp: [88, 96],
    height: 296,
    moves: [
      { id: 'cleave', label: '巨斧', damage: 15, weight: 3, maxRepeat: 2 },
      { id: 'sweep', label: '横扫', damage: 7, hits: 3, weight: 2, maxRepeat: 1 },
      {
        id: 'fury',
        label: '怒喝',
        block: 8,
        status: { status: 'strength', amount: 3, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },
  lubu: {
    id: 'lubu',
    name: '吕布',
    art: 'enemy-lubu',
    hp: [150, 150],
    height: 322,
    // Strength compounds hard on the multi-hit moves, so both the buff and the
    // hit count are kept modest — +4 strength on a 4-hit move is a 16-damage
    // swing in a single turn, which simulated out to an unwinnable fight.
    moves: [
      { id: 'ji', label: '方天画戟', damage: 16, weight: 3, maxRepeat: 2 },
      { id: 'storm', label: '戟雨', damage: 6, hits: 3, weight: 2, maxRepeat: 1 },
      {
        id: 'sunder',
        label: '破军',
        damage: 9,
        status: { status: 'vulnerable', amount: 2, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'peerless',
        label: '人中吕布',
        block: 12,
        status: { status: 'strength', amount: 3, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  // --------------------------------------------------- 一 · 讨黄巾（新增）

  /**
   * Three to a room and barely worth a card each. Exists to give 万人敌 and the
   * other `damageAll` cards something to be right about, and to make the first
   * two rooms of a run feel different from each other.
   *
   * Both moves are ungated on purpose. A table whose only ungated row carries a
   * `maxRepeat` is a lie: the gate outranks the cap, so the last survivor would
   * repeat a move it claims never to repeat.
   */
  luanmin: {
    id: 'luanmin',
    name: '乱民',
    art: 'enemy-luanmin',
    hp: [10, 14],
    height: 190,
    moves: [
      { id: 'hoe', label: '锄戈', damage: 4, weight: 3, maxRepeat: 2 },
      { id: 'huddle', label: '抱团', block: 5, weight: 1, maxRepeat: 1 },
    ],
  },

  /**
   * The support piece: buffs the room it stands in and clogs the deck. 传道 is
   * worthless alone, so the encounter tables never field one on its own —
   * killing the 祭酒 first has to be the right read.
   */
  jijiu: {
    id: 'jijiu',
    name: '黄巾祭酒',
    art: 'enemy-jijiu',
    hp: [38, 44],
    height: 248,
    moves: [
      { id: 'staff', label: '杖击', damage: 9, weight: 3, maxRepeat: 2 },
      {
        // 直接扣血, not an attack: holy water goes past armour, ignores 破绽 and
        // 怯战, and provokes no 反刺 — four points that a shield cannot answer.
        id: 'talisman',
        label: '太平符水',
        loseHp: 4,
        addCards: { defId: 'nining', count: 1, to: 'discard' },
        weight: 3,
        maxRepeat: 1,
      },
      {
        id: 'preach',
        label: '传道',
        statusAll: { status: 'strength', amount: 1 },
        weight: 3,
        maxRepeat: 1,
        when: { c: 'alliesAtLeast', n: 2 },
      },
    ],
  },

  /**
   * 意图不可知 on the opening turn only. The point is a first turn played blind
   * against a body that might hit for 12 in one blow or 4 three times over —
   * after that it telegraphs like anything else.
   */
  qishou: {
    id: 'qishou',
    name: '黄巾骑手',
    art: 'enemy-qishou',
    hp: [32, 38],
    // 连人带马的立绘，比步卒的图高一截；height 跟着放大，脚（马蹄）仍落地。
    height: 270,
    hiddenFirstIntent: true,
    moves: [
      { id: 'charge', label: '驰突', damage: 4, hits: 3, weight: 3, maxRepeat: 2 },
      {
        id: 'trample',
        label: '踏阵',
        damage: 7,
        status: { status: 'vulnerable', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 暴怒 1 from the first bell: every hit that draws blood makes the next one
   * worse, so the fight rewards big single blows over chip damage — the exact
   * opposite of what 华雄 wants. 血战 only unlocks under half HP, and the same
   * line hands over a lump of 神力, so the back half is a race.
   */
  guanhai: {
    id: 'guanhai',
    name: '管亥',
    art: 'enemy-guanhai',
    hp: [76, 84],
    height: 300,
    passives: { angry: 1 },
    thresholds: [{ percent: 50, gain: { strength: 2 }, shout: '「困兽犹斗！」' }],
    moves: [
      { id: 'axe', label: '巨斧', damage: 13, weight: 3, maxRepeat: 2 },
      {
        id: 'bellow',
        label: '怒吼',
        block: 8,
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
      {
        id: 'deathfight',
        label: '血战',
        damage: 6,
        hits: 2,
        weight: 3,
        maxRepeat: 1,
        when: { c: 'selfHpBelow', percent: 50 },
      },
    ],
  },

  /**
   * 人公将军, and the first fight in the game that can be *learned*: five beats
   * in a fixed order, rolling nothing. 咒水 opens the fight once and never comes
   * round again — `loopFrom: 1` restarts the cycle after it — so the loop the
   * player plans around is 黄风 → 符咒 → 擂鼓 → 地涌.
   *
   * 符咒 is the whole clock: one layer of 蓄势 a cycle, compounding, which is
   * what stops a defensive deck from simply outlasting him.
   */
  zhangliang: {
    id: 'zhangliang',
    name: '张梁',
    art: 'enemy-zhangliang',
    hp: [155, 155],
    height: 316,
    script: {
      order: ['curse', 'gale', 'sigil', 'drums', 'surge'],
      loopFrom: 1,
    },
    moves: [
      {
        id: 'curse',
        label: '咒水',
        damage: 8,
        status: { status: 'weak', amount: 2, to: 'player' },
      },
      { id: 'gale', label: '黄风', damage: 6, hits: 3 },
      {
        id: 'sigil',
        label: '符咒',
        block: 12,
        status: { status: 'ritual', amount: 1, to: 'self' },
      },
      {
        id: 'drums',
        label: '擂鼓',
        damage: 5,
        addCards: { defId: 'xuanyun', count: 1, to: 'draw' },
      },
      { id: 'surge', label: '地涌', damage: 22 },
    ],
    thresholds: [{ percent: 50, phase: 'huangtian', shout: '「苍天已死，黄天当立！」' }],
    phases: {
      /**
       * 黄天 — 妖术全开的后半场。地涌的 22 尖刺让位给缚神咒：每循环一个
       * 回合玩家打不出攻牌，只能作守势。钟（蓄势 1/循环）由降世接管，
       * 降世同时结 8 点护甲，防御卡组依旧熬不过他；咒火接着
       * 擂鼓往牌堆里下眩晕。
       */
      huangtian: {
        script: { order: ['fushen', 'yaofeng', 'zhouhuo', 'jiangshi'], loopFrom: 0 },
        moves: [
          {
            id: 'fushen',
            label: '缚神咒',
            status: { status: 'entangled', amount: 1, to: 'player' },
          },
          { id: 'yaofeng', label: '妖风', damage: 7, hits: 3 },
          {
            id: 'zhouhuo',
            label: '咒火',
            damage: 8,
            addCards: { defId: 'xuanyun', count: 1, to: 'draw' },
          },
          {
            id: 'jiangshi',
            label: '黄天降世',
            damage: 16,
            block: 8,
            status: { status: 'ritual', amount: 1, to: 'self' },
          },
        ],
      },
    },
  },

  // ------------------------------------ 一 · 讨黄巾（会动的身体：夺 / 遁 / 召 / 裂）

  /**
   * 摸金 twice, then away with the purse. The theft is reported as a `steal`
   * event; `CombatScene.payTheft` is what actually moves 资财, so the purse only
   * moves once per event however often the scene replays it (todos/15).
   * Killing it before the third turn is the whole minigame.
   */
  liukou: {
    id: 'liukou',
    name: '流寇',
    art: 'enemy-liukou',
    hp: [26, 30],
    height: 212,
    script: { order: ['rob', 'rob', 'bolt'], loopFrom: 2 },
    moves: [
      { id: 'rob', label: '摸金', damage: 8 },
      { id: 'bolt', label: '遁走', steal: 30, escape: true },
    ],
  },

  /** 神上使. Calls two 力士 to the field whenever it stands alone. */
  zhangmancheng: {
    id: 'zhangmancheng',
    name: '张曼成',
    art: 'enemy-zhangmancheng',
    hp: [38, 46],
    height: 292,
    moves: [
      { id: 'hack', label: '劈', damage: 8, weight: 3, maxRepeat: 2 },
      {
        id: 'muster',
        label: '聚众',
        summon: { defId: 'yellowturban', count: 2 },
        weight: 3,
        maxRepeat: 1,
        when: { c: 'alliesAtMost', n: 1 },
      },
      {
        id: 'banner',
        label: '呼旗',
        block: 6,
        statusAll: { status: 'strength', amount: 1 },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /** 地公将军. Halves into two of himself the moment his own half falls. */
  zhangbao: {
    id: 'zhangbao',
    name: '张宝',
    art: 'enemy-zhangbao',
    hp: [150, 150],
    height: 312,
    thresholds: [
      { percent: 50, split: { defId: 'zhangbaofenshen', count: 2 }, shout: '「化身千万！」' },
    ],
    moves: [
      { id: 'heaven', label: '黄天', damage: 18, weight: 3, maxRepeat: 2 },
      {
        id: 'mire',
        label: '泥雨',
        damage: 9,
        addCards: { defId: 'nining', count: 2, to: 'draw' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'ward',
        label: '符阵',
        block: 16,
        status: { status: 'metallicize', amount: 4, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  /** The halves. `hp` here is never rolled — `splitEnemy` overwrites it. */
  zhangbaofenshen: {
    id: 'zhangbaofenshen',
    name: '张宝分身',
    art: 'enemy-zhangbaofenshen',
    hp: [1, 1],
    height: 220,
    moves: [
      { id: 'phantom', label: '幻击', damage: 12, weight: 3, maxRepeat: 2 },
      { id: 'gather', label: '聚形', block: 8, weight: 1, maxRepeat: 1 },
    ],
  },

  // ------------------------------------------------------- 二 · 战虎牢（新增）

  /** 扬尘 buries two 创伤 in the draw pile — the deck-pollution archetype. */
  tieqi: {
    id: 'tieqi',
    name: '西凉铁骑',
    art: 'enemy-tieqi',
    hp: [46, 54],
    // 连人带马的立绘（见 qishou）。
    height: 280,
    passives: { metallicize: 3 },
    moves: [
      { id: 'lance', label: '冲阵', damage: 13, weight: 3, maxRepeat: 2 },
      {
        id: 'dust',
        label: '扬尘',
        damage: 5,
        addCards: { defId: 'chuangshang', count: 2, to: 'draw' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 龟缩 8: the first blow that draws blood buys it eight armour and then the
   * status is gone for good, so the read is "chip it once, then commit".
   */
  dongzhuoqinbing: {
    id: 'dongzhuoqinbing',
    name: '董卓亲兵',
    art: 'enemy-dongzhuoqinbing',
    hp: [36, 42],
    height: 232,
    passives: { curlUp: 8 },
    moves: [
      { id: 'stab', label: '突刺', damage: 10, weight: 3, maxRepeat: 2 },
      {
        id: 'parry',
        label: '格挡',
        damage: 6,
        block: 6,
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * The 第二幕 rank and file. Two hits of eight rather than one of sixteen, so
   * 护甲 answers it far better than it answers 西凉铁骑 — the act's opening
   * lesson is that the same 16 points of incoming want different cards.
   */
  qiangbing: {
    id: 'qiangbing',
    name: '羌兵',
    art: 'enemy-qiangbing',
    hp: [30, 34],
    height: 226,
    moves: [
      { id: 'blade', label: '弯刀', damage: 5, hits: 2, weight: 3, maxRepeat: 2 },
      {
        id: 'javelin',
        label: '掷矛',
        damage: 10,
        status: { status: 'weak', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'rally',
        label: '结阵',
        block: 8,
        status: { status: 'strength', amount: 1, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 董卓's household guard, and the 第二幕 body that punishes a slow clock:
   * 重甲 4 every turn on top of 列阵 14 means a deck that cannot put ~20 on the
   * board in one turn never gets ahead of it.
   */
  feixiongjun: {
    id: 'feixiongjun',
    name: '飞熊军',
    art: 'enemy-feixiongjun',
    hp: [48, 54],
    height: 256,
    passives: { metallicize: 3 },
    moves: [
      { id: 'charge', label: '突击', damage: 12, weight: 3, maxRepeat: 2 },
      {
        id: 'caltrop',
        label: '铁蒺藜',
        damage: 6,
        addCards: { defId: 'chuangshang', count: 1, to: 'draw' },
        weight: 2,
        maxRepeat: 1,
      },
      { id: 'wall', label: '列阵', block: 12, weight: 1, maxRepeat: 1 },
    ],
  },

  /**
   * 第二幕's support piece, and deliberately the mirror of 黄巾祭酒: that one
   * bought its allies 神力 one layer at a time, this one hands out two and
   * softens the player at the same time. Kill order is the whole fight.
   */
  xiliangduwei: {
    id: 'xiliangduwei',
    name: '西凉督尉',
    art: 'enemy-xiliangduwei',
    hp: [26, 30],
    height: 248,
    moves: [
      { id: 'hack', label: '挥刀', damage: 7, weight: 3, maxRepeat: 2 },
      {
        id: 'whistle',
        label: '鸣镝',
        damage: 5,
        status: { status: 'vulnerable', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'drive',
        label: '督战',
        statusAll: { status: 'strength', amount: 1 },
        weight: 2,
        maxRepeat: 1,
        when: { c: 'alliesAtLeast', n: 2 },
      },
    ],
  },

  /**
   * 第二幕 精英. 长驱 22 is one point of incoming above anything 第一幕 fields,
   * and the half-HP lump makes the back half worse rather than better — the
   * fight the act uses to teach that 精英 are now a real resource decision.
   */
  licui: {
    id: 'licui',
    name: '李傕',
    art: 'enemy-licui',
    hp: [100, 110],
    height: 302,
    thresholds: [{ percent: 50, gain: { strength: 2 }, shout: '「大军在此，谁敢当锋！」' }],
    moves: [
      { id: 'drive', label: '长驱', damage: 19, weight: 3, maxRepeat: 2 },
      {
        id: 'pillage',
        label: '纵兵',
        damage: 7,
        hits: 2,
        addCards: { defId: 'chuangshang', count: 1, to: 'discard' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'hold',
        label: '据关',
        block: 14,
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * The other 第二幕 精英, and the answer to a pure 护甲 deck: 毒计 goes past
   * armour for 6 and clogs the draw pile, while 结寨 puts 重甲 4 on a body that
   * already blocked 18. Racing it is correct; grinding it is not.
   */
  guosi: {
    id: 'guosi',
    name: '郭汜',
    art: 'enemy-guosi',
    hp: [100, 110],
    height: 298,
    moves: [
      { id: 'raid', label: '掠阵', damage: 7, hits: 3, weight: 3, maxRepeat: 2 },
      {
        id: 'poison',
        label: '毒计',
        loseHp: 5,
        addCards: { defId: 'nining', count: 1, to: 'draw' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'camp',
        label: '结寨',
        block: 16,
        status: { status: 'metallicize', amount: 3, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 第二幕 首领, scripted like 张梁 and for the same reason: a 首领 whose 套路 can
   * be learned rewards the second attempt at an act. Five beats, looping whole
   * — 焚京 lands on beat five every single cycle, so the player either has 24
   * points of answer ready on that turn or does not.
   */
  liru: {
    id: 'liru',
    name: '李儒',
    art: 'enemy-liru',
    hp: [194, 194],
    height: 314,
    script: { order: ['jiaozhao', 'luanzheng', 'chenmou', 'zhenjiu', 'fenjing'], loopFrom: 0 },
    moves: [
      {
        id: 'jiaozhao',
        label: '矫诏',
        damage: 10,
        addCards: { defId: 'xuanyun', count: 1, to: 'draw' },
      },
      {
        id: 'luanzheng',
        label: '乱政',
        damage: 7,
        hits: 2,
        status: { status: 'weak', amount: 2, to: 'player' },
      },
      {
        id: 'chenmou',
        label: '沉谋',
        block: 14,
        status: { status: 'ritual', amount: 1, to: 'self' },
      },
      {
        id: 'zhenjiu',
        label: '鸩酒',
        loseHp: 8,
        addCards: { defId: 'nining', count: 1, to: 'discard' },
      },
      { id: 'fenjing', label: '焚京', damage: 26 },
    ],
    thresholds: [{ percent: 50, phase: 'duji', shout: '「一杯鸩酒，与君同尽！」' }],
    phases: {
      /**
       * 毒计 — 焚京的 26 让位给一条护甲挡不住的血线：鸩毒（中毒 4，
       * 每循环恰好耗尽不叠层）加绝毒（直取 12），可挡部分仍低于前半。
       * 龟壳在这半场一文不值，题目是抢在毒累积成山之前送他上路。
       * 阴谋保住他 1/循环的蓄势钟。
       */
      duji: {
        script: { order: ['zhendu', 'quchi', 'yinmou', 'juedu'], loopFrom: 0 },
        moves: [
          {
            id: 'zhendu',
            label: '鸩毒',
            status: { status: 'poison', amount: 4, to: 'player' },
          },
          { id: 'quchi', label: '驱驰', damage: 13, hits: 2 },
          {
            id: 'yinmou',
            label: '阴谋',
            block: 12,
            status: { status: 'ritual', amount: 1, to: 'self' },
          },
          {
            id: 'juedu',
            label: '绝毒',
            loseHp: 12,
            addCards: { defId: 'nining', count: 1, to: 'discard' },
          },
        ],
      },
    },
  },

  /**
   * 第二幕 首领. Weighted where 李儒 is scripted, so the act's two 首领 ask
   * different questions: this one cannot be planned around, only out-paced.
   * 重甲 4 on 205 体力 makes chip damage a losing proposition outright.
   */
  dongzhuo: {
    id: 'dongzhuo',
    name: '董卓',
    art: 'enemy-dongzhuo',
    hp: [196, 196],
    height: 332,
    passives: { metallicize: 3 },
    moves: [
      { id: 'might', label: '相国之威', damage: 19, weight: 3, maxRepeat: 2 },
      { id: 'trample', label: '铁骑碾压', damage: 6, hits: 3, weight: 2, maxRepeat: 1 },
      {
        id: 'burn',
        label: '焚宫',
        damage: 10,
        addCards: { defId: 'chuangshang', count: 1, to: 'draw' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'fortress',
        label: '筑坞',
        block: 16,
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  // ------------------------------------------------------- 三 · 征汉中（新增）

  /**
   * 第三幕's baseline body, and it is heavier than anything 第二幕 fields on its
   * own. 重甲 5 with no defensive move at all: it never stops swinging, and the
   * armour is what a 多段 deck has to chew through every single turn.
   */
  hubaoqi: {
    id: 'hubaoqi',
    name: '虎豹骑',
    art: 'enemy-hubaoqi',
    hp: [72, 78],
    // 连人带马的立绘（见 qishou）。
    height: 290,
    passives: { metallicize: 3 },
    moves: [
      { id: 'hoof', label: '铁蹄', damage: 10, weight: 3, maxRepeat: 2 },
      {
        id: 'encircle',
        label: '合围',
        damage: 4,
        hits: 2,
        status: { status: 'vulnerable', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * Four hits of five. Every point of 护甲 is worth four times as much here as
   * it is against 虎豹骑, and every point of 神力 the enemy owns is worth four
   * times as much to it — which is exactly why 军师祭酒 stands behind these.
   */
  lianubing: {
    id: 'lianubing',
    name: '连弩兵',
    art: 'enemy-lianubing',
    hp: [40, 44],
    height: 234,
    moves: [
      { id: 'volley', label: '连弩', damage: 4, hits: 4, weight: 3, maxRepeat: 2 },
      {
        id: 'wind',
        label: '上弦',
        block: 6,
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 第三幕's support, and the reason 连弩兵 come in pairs: 布阵 puts 2 神力 on
   * every body on the field, which on a four-hit volley is +8 a turn each.
   */
  junshi: {
    id: 'junshi',
    name: '军师祭酒',
    art: 'enemy-junshi',
    hp: [50, 56],
    height: 250,
    moves: [
      { id: 'fan', label: '挥扇', damage: 10, weight: 3, maxRepeat: 2 },
      {
        id: 'firescheme',
        label: '火计',
        damage: 7,
        addCards: { defId: 'chuangshang', count: 1, to: 'discard' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'array',
        label: '布阵',
        statusAll: { status: 'strength', amount: 1 },
        weight: 2,
        maxRepeat: 1,
        when: { c: 'alliesAtLeast', n: 2 },
      },
    ],
  },

  /**
   * 暴怒 2 — twice what 管亥 walks in with. Chip damage feeds it, so the pack
   * that looks like the softest room on the floor is the one that punishes a
   * 多段 deck hardest.
   */
  qingzhoubing: {
    id: 'qingzhoubing',
    name: '青州兵',
    art: 'enemy-qingzhoubing',
    hp: [34, 38],
    height: 228,
    passives: { angry: 1 },
    moves: [
      { id: 'loot', label: '抄掠', damage: 9, weight: 3, maxRepeat: 2 },
      { id: 'swarm', label: '蜂拥', damage: 4, hits: 2, weight: 2, maxRepeat: 1 },
    ],
  },

  /**
   * 曹操征汉中的后勤主力，三人一寨。单体不如青州兵重，但 筑垒/秋收 两手
   * 护甲让整寨比看上去耐拆——给 `damageAll` 卡第三幕的用武之地（第一幕的
   * 乱民房是它的回声），也把「先拆谁」变成一道真题。
   */
  tuntianbing: {
    id: 'tuntianbing',
    name: '屯田兵',
    art: 'enemy-tuntianbing',
    hp: [30, 34],
    height: 218,
    moves: [
      { id: 'lei', label: '耒击', damage: 8, weight: 3, maxRepeat: 2 },
      { id: 'rampart', label: '筑垒', block: 9, weight: 2, maxRepeat: 1 },
      { id: 'harvest', label: '秋收', damage: 5, block: 5, weight: 2, maxRepeat: 1 },
    ],
  },

  /**
   * 发丘筹饷的军官，带着屯田兵下地。撒土的【破绽】喂给同房的耒击，盗掘
   * 自垒自涨——第三幕普通房里唯一会给自己人做局的头目位，杀他先于杀兵
   * 是这间房的正解。
   */
  mojinxiaowei: {
    id: 'mojinxiaowei',
    name: '摸金校尉',
    art: 'enemy-mojinxiaowei',
    hp: [42, 46],
    height: 240,
    moves: [
      { id: 'shovel', label: '洛阳铲', damage: 11, weight: 3, maxRepeat: 2 },
      {
        id: 'dust',
        label: '撒土',
        damage: 6,
        status: { status: 'vulnerable', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'grave',
        label: '盗掘',
        block: 8,
        status: { status: 'strength', amount: 1, to: 'self' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 第三幕 精英. 暴怒 2 plus a half-HP lump of 神力 plus 裸衣 buffing itself: the
   * only fight in the game that gets strictly worse the longer it runs, with no
   * defensive move to hide behind. Burst it or lose.
   */
  xuchu: {
    id: 'xuchu',
    name: '许褚',
    art: 'enemy-xuchu',
    hp: [108, 116],
    height: 308,
    passives: { angry: 1 },
    thresholds: [{ percent: 50, gain: { strength: 1 }, shout: '「痴儿在此！」' }],
    moves: [
      { id: 'tiger', label: '虎痴', damage: 14, weight: 3, maxRepeat: 2 },
      {
        id: 'bare',
        label: '裸衣',
        damage: 6,
        hits: 2,
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * The other 第三幕 精英, and the patient one: 死战 stacks 蓄势 2 a turn behind
   * 16 护甲, so every turn spent not killing it is compounding. 射戟's 怯战 2 is
   * what makes racing it hard in the first place.
   */
  pangde: {
    id: 'pangde',
    name: '庞德',
    art: 'enemy-pangde',
    hp: [130, 140],
    height: 302,
    moves: [
      { id: 'coffin', label: '抬榇', damage: 21, weight: 3, maxRepeat: 2 },
      {
        id: 'arrow',
        label: '射戟',
        damage: 7,
        hits: 2,
        status: { status: 'weak', amount: 2, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'laststand',
        label: '死战',
        block: 14,
        status: { status: 'ritual', amount: 1, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 第三幕 首领, scripted. 白地 26 arrives on beat two of five and again every
   * cycle; 立寨 gives it 蓄势 2 so the same beat is worse each time round. The
   * loop is short on purpose — this is the act that assumes the player reads
   * telegraphs.
   */
  xiahouyuan: {
    id: 'xiahouyuan',
    name: '夏侯渊',
    art: 'enemy-xiahouyuan',
    hp: [228, 228],
    height: 328,
    script: { order: ['gallop', 'raid', 'banner', 'strike', 'deluge'], loopFrom: 0 },
    moves: [
      {
        id: 'gallop',
        label: '疾行',
        damage: 8,
        hits: 2,
        status: { status: 'strength', amount: 2, to: 'self' },
      },
      { id: 'raid', label: '白地', damage: 26 },
      {
        id: 'banner',
        label: '立寨',
        block: 16,
        status: { status: 'ritual', amount: 1, to: 'self' },
      },
      {
        id: 'strike',
        label: '妙才',
        damage: 13,
        status: { status: 'vulnerable', amount: 2, to: 'player' },
      },
      {
        id: 'deluge',
        label: '定军',
        damage: 8,
        addCards: { defId: 'chuangshang', count: 1, to: 'draw' },
      },
    ],
    thresholds: [{ percent: 50, phase: 'shensu', shout: '「三日五百，六日一千！」' }],
    phases: {
      /**
       * 神速 — 轻兵急进的后半场：立寨与白地俱废，他不再设防，你也别想
       * 按时抽牌。断粮道废掉的那个玩家回合面对的是最轻的焚粮（6 + 塞牌），
       * 惩罚是节奏不是斩杀。阶段二零新增成长，阶段一攒下的神力与蓄势
       * 继续走表——hits 因此压在 2（继承神力上多段的教训见吕布注释）。
       */
      shensu: {
        script: { order: ['duanliang', 'fenliang', 'qingqi', 'changqu'], loopFrom: 0 },
        moves: [
          {
            id: 'duanliang',
            label: '断粮道',
            status: { status: 'noDraw', amount: 1, to: 'player' },
          },
          {
            id: 'fenliang',
            label: '焚粮',
            damage: 6,
            addCards: { defId: 'xuanyun', count: 1, to: 'draw' },
          },
          { id: 'qingqi', label: '轻骑', damage: 9, hits: 2 },
          { id: 'changqu', label: '长驱', damage: 18 },
        ],
      },
    },
  },

  /**
   * The other 第三幕 首领, weighted. 八百破十万 is four hits of seven — the exact
   * shape 护甲 answers and 破绽 does not — while 突骑 22 is the exact shape 护甲
   * does not. Guessing wrong twice in a row is the loss.
   */
  zhangliao: {
    id: 'zhangliao',
    name: '张辽',
    art: 'enemy-zhangliao',
    hp: [206, 206],
    height: 326,
    moves: [
      { id: 'raid', label: '突骑', damage: 20, weight: 3, maxRepeat: 2 },
      { id: 'eighthundred', label: '八百破十万', damage: 7, hits: 4, weight: 2, maxRepeat: 1 },
      {
        id: 'awe',
        label: '威震逍遥津',
        damage: 10,
        block: 10,
        status: { status: 'vulnerable', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'regroup',
        label: '敛军',
        block: 18,
        status: { status: 'strength', amount: 3, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
    ],
  },

  // -------------------------------------------------------- 终 · 五丈原（新增）

  /**
   * 终章's single 精英, standing between the player and the last 首领 with no
   * room to go around: 隐忍 is 20 护甲 plus 重甲 5, and the half-HP lump is the
   * largest in the game. A run that arrives here without a finisher does not
   * leave.
   */
  simayi: {
    id: 'simayi',
    name: '司马懿',
    art: 'enemy-simayi',
    hp: [152, 162],
    height: 308,
    thresholds: [{ percent: 50, gain: { strength: 4 }, shout: '「天下英雄，唯忍者存。」' }],
    moves: [
      { id: 'hawk', label: '鹰视', damage: 23, weight: 3, maxRepeat: 2 },
      {
        id: 'endure',
        label: '隐忍',
        block: 16,
        status: { status: 'metallicize', amount: 3, to: 'self' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'bite',
        label: '反噬',
        damage: 8,
        hits: 2,
        addCards: { defId: 'nining', count: 1, to: 'draw' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 天命 — the run's last fight, and not a person. Six beats on a fixed loop,
   * every one of them a different kind of pressure: 星落 30 raw, 秋风 as three
   * hits plus 怯战, 五丈 as 24 护甲 and 蓄势 3, 阳寿 straight past armour, 逆天 as
   * 破绽 3, 归尘 as deck rot. There is no beat to relax on, which is the point.
   */
  tianming: {
    id: 'tianming',
    name: '天命',
    art: 'enemy-tianming',
    hp: [252, 252],
    height: 344,
    passives: { metallicize: 3 },
    script: {
      order: ['autumnwind', 'lifespan', 'wuzhang', 'defy', 'starfall', 'dust'],
      loopFrom: 0,
    },
    moves: [
      {
        id: 'autumnwind',
        label: '秋风',
        damage: 5,
        hits: 3,
        status: { status: 'weak', amount: 2, to: 'player' },
      },
      {
        id: 'lifespan',
        label: '阳寿',
        loseHp: 6,
        addCards: { defId: 'nining', count: 1, to: 'draw' },
      },
      {
        id: 'wuzhang',
        label: '五丈',
        block: 20,
        status: { status: 'ritual', amount: 2, to: 'self' },
      },
      {
        id: 'defy',
        label: '逆天',
        damage: 12,
        status: { status: 'vulnerable', amount: 2, to: 'player' },
      },
      { id: 'starfall', label: '星落', damage: 22 },
      {
        id: 'dust',
        label: '归尘',
        damage: 9,
        addCards: { defId: 'chuangshang', count: 2, to: 'draw' },
      },
    ],
    thresholds: [{ percent: 50, phase: 'tianshu', shout: '「星落五丈，天数当倾！」' }],
    phases: {
      /**
       * 天数 — 半血后的倒计时形态。三拍一循环：缴械（力竭）、蓄力（聚星）、
       * 落刀（天倾 26）。塞牌与穿甲全部让位给一条每循环 +3 神力的死线，
       * 聚星的 65 点护甲迫玩家抢在死线前破阵。题目从「均匀抗压」换成
       * 「限时拆解」。天倾恒为单段——继承的神力
       * 只吃一次，这是 hits 上限规则（吕布注释）在终幕的写法。
       */
      tianshu: {
        script: { order: ['xingchen', 'juxing', 'tianqing'], loopFrom: 0 },
        moves: [
          {
            id: 'xingchen',
            label: '星沉',
            status: { status: 'frail', amount: 2, to: 'player' },
          },
          {
            id: 'juxing',
            label: '聚星',
            block: 65,
            status: { status: 'ritual', amount: 3, to: 'self' },
          },
          { id: 'tianqing', label: '天倾', damage: 26 },
        ],
      },
    },
  },
};

// ------------------------------------------------------------------ 遭遇表

export type CombatTier = 'monster' | 'elite' | 'boss';

/**
 * One act's worth of fights. The split the original makes and this table copies:
 * the first `weakCount` normal rooms of an act draw from `weak`, everything
 * after that from `strong`, so an opening room can be trivial without the
 * eleventh one being.
 */
export interface EncounterTable {
  weak: readonly Encounter[];
  weakCount: number;
  strong: readonly Encounter[];
  elite: readonly Encounter[];
  boss: readonly Encounter[];
}

/**
 * 第一幕 · 讨黄巾.
 *
 * `m1`-`m8`, `e1`-`e2` and `b1`-`b2` are the fights the 37 golden snapshots are
 * built on: their ids and enemy rosters are frozen and must not move, only be
 * joined by new rows. Which *act* a frozen fight belongs to is not frozen —
 * `simulateCombat` reaches it by id — but 吕布 stays here anyway, because the
 * whole balance table (`sim/balance.sim.ts`) is calibrated against him as a
 * 第一幕 首领.
 */
export const ACT1: EncounterTable = {
  weakCount: 3,
  weak: [
    { id: 'm1', name: '黄巾散兵', enemies: ['yellowturban'], goldReward: [10, 18] },
    { id: 'm3', name: '山道劫掠', enemies: ['bandit', 'bandit'], goldReward: [12, 20] },
    { id: 'm5', name: '蚁聚之众', enemies: ['luanmin', 'luanmin', 'luanmin'], goldReward: [10, 18] },
  ],
  strong: [
    { id: 'm2', name: '黄巾游骑', enemies: ['yellowturban', 'yellowturban'], goldReward: [14, 22] },
    { id: 'm4', name: '乱军', enemies: ['bandit', 'yellowturban'], goldReward: [14, 22] },
    { id: 'm6', name: '设坛作法', enemies: ['jijiu', 'yellowturban'], goldReward: [15, 23] },
    { id: 'm7', name: '白波马队', enemies: ['qishou', 'qishou'], goldReward: [16, 24] },
    { id: 'm8', name: '祭酒督阵', enemies: ['jijiu', 'luanmin', 'luanmin'], goldReward: [15, 23] },
    { id: 'm9', name: '劫粮流寇', enemies: ['liukou', 'bandit'], goldReward: [12, 20] },
  ],
  elite: [
    { id: 'e1', name: '关下骁将 · 华雄', enemies: ['huaxiong'], goldReward: [28, 42] },
    { id: 'e2', name: '黄巾渠帅 · 管亥', enemies: ['guanhai'], goldReward: [28, 42] },
    { id: 'e3', name: '神上使 · 张曼成', enemies: ['zhangmancheng'], goldReward: [28, 42] },
  ],
  boss: [
    { id: 'b1', name: '虎牢关 · 吕布', enemies: ['lubu'], goldReward: [80, 110] },
    { id: 'b2', name: '人公将军 · 张梁', enemies: ['zhangliang'], goldReward: [80, 110] },
    { id: 'b3', name: '地公将军 · 张宝', enemies: ['zhangbao'], goldReward: [80, 110] },
  ],
};

/**
 * 第二幕 · 战虎牢.
 *
 * The gradient over 第一幕 is deliberate and measured in `tests/acts.test.ts`
 * rather than left to taste: mean 体力 per normal room roughly +24%, mean peak
 * incoming per normal room roughly +30%, and every 精英 body strictly heavier
 * than every 第一幕 精英 body.
 *
 * `weakCount` drops to 2. An act two floors shorter in its opening ramp is what
 * makes 第二幕 feel like it starts mid-sentence, which is the intent.
 *
 * 2026-08 扩池 6→9：贪打路线中位 10 场杂兵，strong 只有 3 行时一幕复读近
 * 三遍。m24 进 weak（开局组合 3 选 2 → 4 选 2），m25/m26 进 strong——
 * 二幕自此有三间 3 敌房（m15/m25/m26）。
 */
export const ACT2: EncounterTable = {
  weakCount: 2,
  weak: [
    { id: 'm10', name: '西凉哨骑', enemies: ['tieqi'], goldReward: [16, 24] },
    { id: 'm11', name: '相府亲兵', enemies: ['dongzhuoqinbing', 'dongzhuoqinbing'], goldReward: [18, 26] },
    { id: 'm12', name: '羌胡游骑', enemies: ['qiangbing', 'dongzhuoqinbing'], goldReward: [17, 25] },
    // 2026-08 扩池：开局第 3 种读法——督战买不买账，在最便宜的房里先问一遍。
    { id: 'm24', name: '鸣镝驱羌', enemies: ['xiliangduwei', 'qiangbing'], goldReward: [16, 24] },
  ],
  strong: [
    { id: 'm13', name: '铁骑冲阵', enemies: ['tieqi', 'tieqi'], goldReward: [20, 27] },
    { id: 'm14', name: '飞熊拒关', enemies: ['feixiongjun', 'dongzhuoqinbing'], goldReward: [21, 27] },
    {
      id: 'm15',
      name: '督尉督战',
      enemies: ['xiliangduwei', 'qiangbing', 'qiangbing'],
      goldReward: [20, 27],
    },
    // 2026-08 扩池：strong 3 行铺不满 15 层（贪打路线中位 10 场杂兵，头 2 场走 weak），
    // 复读近三遍。两间 3 敌房各出一道新题：合势问先杀谁，蚁附给 damageAll 靶场。
    {
      id: 'm25',
      name: '西凉合势',
      enemies: ['xiliangduwei', 'qiangbing', 'dongzhuoqinbing'],
      goldReward: [21, 27],
    },
    { id: 'm26', name: '羌部蚁附', enemies: ['qiangbing', 'qiangbing', 'qiangbing'], goldReward: [20, 27] },
  ],
  elite: [
    { id: 'e4', name: '飞熊中郎将 · 李傕', enemies: ['licui'], goldReward: [40, 56] },
    { id: 'e5', name: '西凉都尉 · 郭汜', enemies: ['guosi'], goldReward: [38, 54] },
  ],
  boss: [
    { id: 'b4', name: '相国 · 董卓', enemies: ['dongzhuo'], goldReward: [95, 130] },
    { id: 'b5', name: '毒士 · 李儒', enemies: ['liru'], goldReward: [95, 130] },
  ],
};

/**
 * 第三幕 · 征汉中.
 *
 * `weakCount` is 2 again and the weak rows step straight off 第二幕's strong
 * band — by this act the ramp exists to place the room, not to protect the
 * player. 2026-08 扩池 8→9：m27 进 strong，是 m22 的镜像题（见行内注释）。
 */
export const ACT3: EncounterTable = {
  weakCount: 2,
  weak: [
    { id: 'm16', name: '虎豹游骑', enemies: ['hubaoqi'], goldReward: [20, 27] },
    { id: 'm17', name: '青州抄掠', enemies: ['qingzhoubing', 'qingzhoubing'], goldReward: [19, 26] },
    {
      id: 'm22',
      name: '军屯列垒',
      enemies: ['tuntianbing', 'tuntianbing', 'tuntianbing'],
      goldReward: [19, 26],
    },
  ],
  strong: [
    { id: 'm18', name: '连弩伏击', enemies: ['lianubing', 'lianubing'], goldReward: [21, 27] },
    { id: 'm19', name: '虎豹合围', enemies: ['hubaoqi', 'hubaoqi'], goldReward: [23, 27] },
    {
      id: 'm20',
      name: '军师督阵',
      enemies: ['junshi', 'qingzhoubing', 'qingzhoubing'],
      goldReward: [22, 27],
    },
    { id: 'm21', name: '阳平关哨', enemies: ['hubaoqi', 'lianubing'], goldReward: [23, 27] },
    {
      id: 'm23',
      name: '发丘筹饷',
      enemies: ['mojinxiaowei', 'tuntianbing', 'tuntianbing'],
      goldReward: [22, 27],
    },
    // 2026-08 扩池：m22 的镜像陷阱——同样的三小兵剪影，暴怒 1 ×3 把横扫的
    // 每一段见血都喂成神力。读被动，不读剪影。
    {
      id: 'm27',
      name: '青州蜂聚',
      enemies: ['qingzhoubing', 'qingzhoubing', 'qingzhoubing'],
      goldReward: [22, 27],
    },
  ],
  elite: [
    { id: 'e6', name: '虎痴 · 许褚', enemies: ['xuchu'], goldReward: [50, 68] },
    { id: 'e7', name: '立义将军 · 庞德', enemies: ['pangde'], goldReward: [48, 66] },
  ],
  boss: [
    { id: 'b6', name: '征西将军 · 夏侯渊', enemies: ['xiahouyuan'], goldReward: [110, 150] },
    { id: 'b7', name: '荡寇将军 · 张辽', enemies: ['zhangliao'], goldReward: [110, 150] },
  ],
};

/**
 * 终 · 五丈原. Three rooms: 精英 → 营帐 → 首领, and no normal rooms at all.
 *
 * `weak` and `strong` are empty on purpose rather than filled with filler, and
 * `weakCount` is 0 so the split is inert. `generateFinalAct` emits exactly one
 * `elite`, one `rest` and the boss crown, so `pickEncounter` is never asked for
 * a `monster` here — an empty pool would otherwise be a silent `undefined`.
 */
export const FINAL: EncounterTable = {
  weakCount: 0,
  weak: [],
  strong: [],
  elite: [{ id: 'e8', name: '冢虎 · 司马懿', enemies: ['simayi'], goldReward: [60, 76] }],
  boss: [{ id: 'b8', name: '五丈原 · 天命', enemies: ['tianming'], goldReward: [150, 200] }],
};

/**
 * Every act's table, in order. The one place that knows how many acts there
 * are: `getEncounter` scans this, and `src/data/acts.ts` indexes into it.
 *
 * Append only — the index *is* `RunState.act - 1`.
 */
export const ACT_TABLES: readonly EncounterTable[] = [ACT1, ACT2, ACT3, FINAL];

/**
 * Fights that are finished as rules and are deliberately **not** reachable from
 * the map yet.
 *
 * **Empty, and that is the point.** Every row that ever sat here was fenced off
 * for one reason: `CombatScene` built one view per enemy in `create()` and
 * never again, so a body that joined mid-fight — 召唤 or 分裂 — was invisible
 * and unclickable, and an enemy that 遁走 left a frozen sprite behind.
 *
 * todos/15 wired those events up (`playSummon` / `playSplit` / `playEscape` /
 * `shout`, and `payTheft` for 夺财), so the fence came down:
 *
 * - `m9` 劫粮流寇 → `ACT1.strong` — 流寇 steals 30 and flees, and the run's
 *   purse actually moves now.
 * - `e3` 神上使 · 张曼成 → `ACT1.elite` — summons two 力士 that can be seen,
 *   clicked and hit by 万人敌.
 * - `b3` 地公将军 · 张宝 → `ACT1.boss` — splits at half HP, and the parent's
 *   body is destroyed rather than left standing for the rest of the fight.
 * - `m10` / `m11` → `ACT2`, by todos/09. Neither declares a mechanic the scene
 *   could not already draw; they were only ever waiting on 第二幕 existing.
 *
 * Kept as an empty table rather than deleted: it is where the *next* mechanic
 * that outruns the screen goes, and `allEncounters` already scans it.
 */
export const PENDING_ENCOUNTERS: Record<CombatTier, Encounter[]> = {
  monster: [],
  elite: [],
  boss: [],
};

/**
 * Picks the fight for one combat node. **Exactly one roll**, whatever the state
 * of the tables — an id already spent this act narrows the pool but never
 * changes how many times the stream is pulled (R3, `src/rooms/rng.ts`).
 *
 * `combatCount` is fights already finished this act (`RunState.actCombatCount`)
 * and `used` is the ids already spent (`RunState.usedEncounters`); an act whose
 * pool runs dry re-opens rather than repeating the last fight forever.
 */
export function pickEncounter(
  rng: Rng,
  table: EncounterTable,
  tier: CombatTier,
  opts: { combatCount: number; used: readonly string[] },
): Encounter {
  const pool =
    tier === 'monster'
      ? opts.combatCount < table.weakCount
        ? table.weak
        : table.strong
      : table[tier];

  const fresh = pool.filter((e) => !opts.used.includes(e.id));
  const from = fresh.length > 0 ? fresh : pool;
  // Still exactly one roll (R3) even when there is nothing to roll for, so the
  // degradation below cannot shift the stream.
  const choice = from[rng.int(Math.max(1, from.length))];
  if (choice) return choice;

  // An empty pool used to return `undefined` and be assigned straight into
  // `record.encounterId` by `ensureEncounter`, i.e. a TypeError one line later.
  // 终章 is the act where this matters: `FINAL.weak` and `FINAL.strong` are
  // deliberately empty, so adding a single 杂兵 node to it would crash the run
  // rather than degrade. Falling back across the tier keeps the fight coming.
  const fallback = table.elite[0] ?? table.boss[0] ?? table.strong[0] ?? table.weak[0];
  if (!fallback) throw new Error('encounter table is empty');
  return fallback;
}

/**
 * Every fight the game ships, every act and both tables, flattened.
 *
 * A *lookup*, never a draw pool: picking uniformly out of this array — which is
 * what `CombatScene` did before the room layer existed — throws away both the
 * weak/strong split and the act it belongs to. `pickEncounter` against one
 * `EncounterTable` is the only legal way to choose a fight.
 */
export function allEncounters(): Encounter[] {
  return [
    ...ACT_TABLES.flatMap((t) => [...t.weak, ...t.strong, ...t.elite, ...t.boss]),
    ...Object.values(PENDING_ENCOUNTERS).flat(),
  ];
}

/**
 * An encounter by id, across every act and both tables — a fight the map cannot
 * open yet is still a fight the rules layer has to look up. Used to read a
 * materialised `RoomRecord.combat.encounterId` back, and by the sim to name its
 * cases.
 */
export function getEncounter(id: string): Encounter {
  const found = allEncounters().find((e) => e.id === id);
  if (!found) throw new Error(`Unknown encounter id: ${id}`);
  return found;
}

/**
 * 一个遭遇 id 属于哪一档——weak/strong 都算杂兵。天命 (todos/19) 的倍率按
 * 档位取值，而无头模拟只认 id，所以档位得能从 id 反查回来；地图开的仗
 * 不走这里（`CombatScene` 手里就有 nodeType）。查无此 id 与 `getEncounter`
 * 同款处理：抛出，而不是默默按杂兵算。
 */
export function encounterTierOf(id: string): CombatTier {
  const inTier = (pool: readonly Encounter[]): boolean => pool.some((e) => e.id === id);
  for (const table of ACT_TABLES) {
    if (inTier(table.elite)) return 'elite';
    if (inTier(table.boss)) return 'boss';
    if (inTier(table.weak) || inTier(table.strong)) return 'monster';
  }
  for (const tier of ['monster', 'elite', 'boss'] as const) {
    if (inTier(PENDING_ENCOUNTERS[tier])) return tier;
  }
  throw new Error(`Unknown encounter id: ${id}`);
}

export const getEnemy = (id: string): EnemyDef => {
  const def = ENEMIES[id];
  if (!def) throw new Error(`Unknown enemy id: ${id}`);
  return def;
};

/**
 * The move table in force for an enemy standing in `phase`: the named phase it
 * switched into, or the default. `engine.moveSet` is a one-line wrapper over
 * this that reads the phase off an `EnemyState`.
 *
 * Split out here — beside the table it indexes — rather than left inside the
 * engine so that 存档 (`src/state/save.ts`) can look a telegraphed move back up
 * without importing the engine and everything the engine drags in.
 */
export const phaseOf = (def: EnemyDef, phase: string | null): EnemyPhase =>
  (phase ? def.phases?.[phase] : undefined) ?? def;

type EnhancedMovePatch = Partial<Omit<EnemyMove, 'id' | 'label'>>;

/**
 * 天命十七至十九重的强化招式数据。只覆盖招式字段，不换 id、不改权重与脚本，
 * 因而同一个 seed 仍会选中同一招，只是那一招更凶。表放在敌军数据层，引擎
 * 不按敌人 id 分支；以后新增或调一名敌人只动这里。
 */
export const ENHANCED_MOVE_PATCHES: Readonly<
  Partial<Record<string, Readonly<Record<string, EnhancedMovePatch>>>>
> = {
  yellowturban: { roar: { status: { status: 'strength', amount: 3, to: 'self' } } },
  bandit: { ambush: { status: { status: 'weak', amount: 2, to: 'player' } } },
  huaxiong: { fury: { block: 11 } },
  lubu: { peerless: { block: 16 } },
  luanmin: { huddle: { block: 7 } },
  jijiu: { preach: { statusAll: { status: 'strength', amount: 2 } } },
  qishou: { trample: { status: { status: 'vulnerable', amount: 2, to: 'player' } } },
  guanhai: { bellow: { block: 11 } },
  zhangliang: { sigil: { block: 15, status: { status: 'ritual', amount: 2, to: 'self' } } },
  liukou: { bolt: { steal: 40 } },
  zhangmancheng: { banner: { block: 9 } },
  zhangbao: { ward: { block: 20 } },
  zhangbaofenshen: { gather: { block: 11 } },
  tieqi: { dust: { addCards: { defId: 'chuangshang', count: 3, to: 'discard' } } },
  dongzhuoqinbing: { parry: { block: 9 } },
  qiangbing: { rally: { block: 11 } },
  feixiongjun: { wall: { block: 16 } },
  xiliangduwei: { drive: { statusAll: { status: 'strength', amount: 2 } } },
  licui: { hold: { block: 18 } },
  guosi: { camp: { block: 20 } },
  liru: { chenmou: { block: 18, status: { status: 'ritual', amount: 2, to: 'self' } } },
  dongzhuo: { fortress: { block: 21 } },
  hubaoqi: { encircle: { status: { status: 'vulnerable', amount: 2, to: 'player' } } },
  lianubing: { wind: { block: 9 } },
  junshi: { array: { statusAll: { status: 'strength', amount: 2 } } },
  qingzhoubing: { swarm: { hits: 3 } },
  tuntianbing: { rampart: { block: 12 } },
  mojinxiaowei: { grave: { block: 11 } },
  xuchu: { bare: { status: { status: 'strength', amount: 3, to: 'self' } } },
  pangde: { laststand: { block: 18, status: { status: 'ritual', amount: 2, to: 'self' } } },
  xiahouyuan: { banner: { block: 20, status: { status: 'ritual', amount: 2, to: 'self' } } },
  zhangliao: { regroup: { block: 23, status: { status: 'strength', amount: 4, to: 'self' } } },
  simayi: { endure: { block: 20, status: { status: 'metallicize', amount: 4, to: 'self' } } },
  tianming: { wuzhang: { block: 25, status: { status: 'ritual', amount: 3, to: 'self' } } },
};

/** 当前阶段实际使用的招式表；强化只做不可变覆盖，不改原始敌军数据。 */
export function moveSetOf(def: EnemyDef, phase: string | null, enhanced = false): EnemyPhase {
  const base = phaseOf(def, phase);
  if (!enhanced) return base;
  const patches = ENHANCED_MOVE_PATCHES[def.id];
  if (!patches) return base;
  return {
    ...base,
    moves: base.moves.map((move) => {
      const patch = patches[move.id];
      return patch ? { ...move, ...patch } : move;
    }),
  };
}

/**
 * A telegraphed move, recovered from what a save can hold.
 *
 * `EnemyState.intent` is a *reference into the table*, so a save can only carry
 * its id and must resolve it back through the same phase the enemy is standing
 * in — a 二阶段 enemy's move ids are not in the default table at all. Null means
 * the row is gone (a table edited under an old save), which the loader treats as
 * an incompatible save rather than re-rolling a different intent under a player
 * who was already shown one.
 */
export const moveById = (
  defId: string,
  phase: string | null,
  moveId: string,
  enhanced = false,
): EnemyMove | null =>
  moveSetOf(getEnemy(defId), phase, enhanced).moves.find((m) => m.id === moveId) ?? null;
