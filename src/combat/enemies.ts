import type { Rng } from '../core/rng';
import type { EnemyDef, Encounter } from './types';

/**
 * 敌军名录 — every enemy is a row, and every behaviour it has is a field of that
 * row. The engine reads the table and branches on no enemy id anywhere: a new
 * enemy is a new row here and nothing else.
 *
 * Art keys are shared where a portrait has not been painted yet — a missing
 * texture is a green box on screen, which is worse than a reused general. Each
 * such row says so; todos/15 step 7 is the export pass that gives them their own.
 */

export const ENEMIES: Record<string, EnemyDef> = {
  yellowturban: {
    id: 'yellowturban',
    name: '黄巾力士',
    art: 'enemy-yellowturban',
    hp: [42, 50],
    height: 236,
    moves: [
      { id: 'chop', label: '劈斩', intent: 'attack', damage: 9, weight: 3, maxRepeat: 2 },
      {
        id: 'roar',
        label: '鼓噪',
        intent: 'buff',
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
      { id: 'guard', label: '据守', intent: 'attack-defend', damage: 5, block: 6, weight: 2, maxRepeat: 1 },
    ],
  },
  bandit: {
    id: 'bandit',
    name: '山贼',
    art: 'enemy-bandit',
    hp: [28, 34],
    height: 212,
    moves: [
      { id: 'slash', label: '双斧', intent: 'attack', damage: 5, hits: 2, weight: 3, maxRepeat: 2 },
      {
        id: 'ambush',
        label: '偷袭',
        intent: 'debuff',
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
      { id: 'cleave', label: '巨斧', intent: 'attack', damage: 15, weight: 3, maxRepeat: 2 },
      { id: 'sweep', label: '横扫', intent: 'attack', damage: 7, hits: 3, weight: 2, maxRepeat: 1 },
      {
        id: 'fury',
        label: '怒喝',
        intent: 'buff',
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
      { id: 'ji', label: '方天画戟', intent: 'attack', damage: 16, weight: 3, maxRepeat: 2 },
      { id: 'storm', label: '戟雨', intent: 'attack', damage: 6, hits: 3, weight: 2, maxRepeat: 1 },
      {
        id: 'sunder',
        label: '破军',
        intent: 'debuff',
        damage: 9,
        status: { status: 'vulnerable', amount: 2, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'peerless',
        label: '人中吕布',
        intent: 'buff',
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
    art: 'enemy-yellowturban', // TODO(art): 破衣持锄的流民，比力士矮一头
    hp: [10, 14],
    height: 190,
    moves: [
      { id: 'hoe', label: '锄戈', intent: 'attack', damage: 4, weight: 3, maxRepeat: 2 },
      { id: 'huddle', label: '抱团', intent: 'defend', block: 5, weight: 1, maxRepeat: 1 },
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
    art: 'enemy-yellowturban', // TODO(art): 持幡、黄巾裹额的道人
    hp: [38, 44],
    height: 248,
    moves: [
      { id: 'staff', label: '杖击', intent: 'attack', damage: 9, weight: 3, maxRepeat: 2 },
      {
        // 直接扣血, not an attack: holy water goes past armour, ignores 破绽 and
        // 怯战, and provokes no 反刺 — four points that a shield cannot answer.
        id: 'talisman',
        label: '太平符水',
        intent: 'debuff',
        loseHp: 4,
        addCards: { defId: 'nining', count: 1, to: 'discard' },
        weight: 3,
        maxRepeat: 1,
      },
      {
        id: 'preach',
        label: '传道',
        intent: 'buff',
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
    art: 'enemy-bandit', // TODO(art): 骑手立绘，含马身，height 要跟着放大
    hp: [32, 38],
    height: 236,
    hiddenFirstIntent: true,
    moves: [
      { id: 'charge', label: '驰突', intent: 'attack', damage: 4, hits: 3, weight: 3, maxRepeat: 2 },
      {
        id: 'trample',
        label: '踏阵',
        intent: 'debuff',
        damage: 7,
        status: { status: 'vulnerable', amount: 1, to: 'player' },
        weight: 2,
        maxRepeat: 1,
      },
    ],
  },

  /**
   * 暴怒 2 from the first bell: every hit that draws blood makes the next one
   * worse, so the fight rewards big single blows over chip damage — the exact
   * opposite of what 华雄 wants. 血战 only unlocks under half HP, and the same
   * line hands over a lump of 神力, so the back half is a race.
   */
  guanhai: {
    id: 'guanhai',
    name: '管亥',
    art: 'enemy-huaxiong', // TODO(art): 黄巾渠帅，双手大刀
    hp: [76, 84],
    height: 300,
    passives: { angry: 1 },
    thresholds: [{ percent: 50, gain: { strength: 2 }, shout: '「困兽犹斗！」' }],
    moves: [
      { id: 'axe', label: '巨斧', intent: 'attack', damage: 13, weight: 3, maxRepeat: 2 },
      {
        id: 'bellow',
        label: '怒吼',
        intent: 'buff',
        block: 8,
        status: { status: 'strength', amount: 2, to: 'self' },
        weight: 1,
        maxRepeat: 1,
      },
      {
        id: 'deathfight',
        label: '血战',
        intent: 'attack',
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
    art: 'enemy-lubu', // TODO(art): 黄巾三兄弟之一，道袍执剑
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
        intent: 'debuff',
        damage: 8,
        status: { status: 'weak', amount: 2, to: 'player' },
      },
      { id: 'gale', label: '黄风', intent: 'attack', damage: 6, hits: 3 },
      {
        id: 'sigil',
        label: '符咒',
        intent: 'buff',
        block: 12,
        status: { status: 'ritual', amount: 1, to: 'self' },
      },
      {
        id: 'drums',
        label: '擂鼓',
        intent: 'debuff',
        damage: 5,
        addCards: { defId: 'xuanyun', count: 1, to: 'draw' },
      },
      { id: 'surge', label: '地涌', intent: 'attack', damage: 22 },
    ],
  },

  // ------------------------------------------- 未上阵（见 PENDING_ENCOUNTERS）

  /**
   * 摸金 twice, then away with the purse. The theft is reported as a `steal`
   * event and costs nothing until the scene pays it — see `PENDING_ENCOUNTERS`.
   * Killing it before the third turn is the whole minigame.
   */
  liukou: {
    id: 'liukou',
    name: '流寇',
    art: 'enemy-bandit', // TODO(art): 背着鼓囊包袱的溃兵
    hp: [26, 30],
    height: 212,
    script: { order: ['rob', 'rob', 'bolt'], loopFrom: 2 },
    moves: [
      { id: 'rob', label: '摸金', intent: 'debuff', damage: 8 },
      { id: 'bolt', label: '遁走', intent: 'escape', steal: 30, escape: true },
    ],
  },

  /** 神上使. Calls two 力士 to the field whenever it stands alone. */
  zhangmancheng: {
    id: 'zhangmancheng',
    name: '张曼成',
    art: 'enemy-huaxiong', // TODO(art): 神上使，执节杖
    hp: [38, 46],
    height: 292,
    moves: [
      { id: 'hack', label: '劈', intent: 'attack', damage: 8, weight: 3, maxRepeat: 2 },
      {
        id: 'muster',
        label: '聚众',
        intent: 'summon',
        summon: { defId: 'yellowturban', count: 2 },
        weight: 3,
        maxRepeat: 1,
        when: { c: 'alliesAtMost', n: 1 },
      },
      {
        id: 'banner',
        label: '呼旗',
        intent: 'buff',
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
    art: 'enemy-lubu', // TODO(art): 黄巾三兄弟之一，捧钵作法
    hp: [150, 150],
    height: 312,
    thresholds: [
      { percent: 50, split: { defId: 'zhangbaofenshen', count: 2 }, shout: '「化身千万！」' },
    ],
    moves: [
      { id: 'heaven', label: '黄天', intent: 'attack', damage: 18, weight: 3, maxRepeat: 2 },
      {
        id: 'mire',
        label: '泥雨',
        intent: 'debuff',
        damage: 9,
        addCards: { defId: 'nining', count: 2, to: 'draw' },
        weight: 2,
        maxRepeat: 1,
      },
      {
        id: 'ward',
        label: '符阵',
        intent: 'buff',
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
    art: 'enemy-yellowturban', // TODO(art): 半透明的张宝，比本体矮
    hp: [1, 1],
    height: 220,
    moves: [
      { id: 'phantom', label: '幻击', intent: 'attack', damage: 12, weight: 3, maxRepeat: 2 },
      { id: 'gather', label: '聚形', intent: 'defend', block: 8, weight: 1, maxRepeat: 1 },
    ],
  },

  // ---------------------------------- 二 · 战虎牢（表未建，见 todos/09）

  /** 扬尘 buries two 创伤 in the draw pile — the deck-pollution archetype. */
  tieqi: {
    id: 'tieqi',
    name: '西凉铁骑',
    art: 'enemy-bandit', // TODO(art): 重甲骑兵
    hp: [46, 54],
    height: 244,
    passives: { metallicize: 3 },
    moves: [
      { id: 'lance', label: '冲阵', intent: 'attack', damage: 13, weight: 3, maxRepeat: 2 },
      {
        id: 'dust',
        label: '扬尘',
        intent: 'debuff',
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
    art: 'enemy-yellowturban', // TODO(art): 相府甲士，塔盾
    hp: [36, 42],
    height: 232,
    passives: { curlUp: 8 },
    moves: [
      { id: 'stab', label: '突刺', intent: 'attack', damage: 10, weight: 3, maxRepeat: 2 },
      {
        id: 'parry',
        label: '格挡',
        intent: 'attack-defend',
        damage: 6,
        block: 6,
        weight: 2,
        maxRepeat: 1,
      },
    ],
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
 * `m1`-`m4`, `e1` and `b1` are the fights the 26 golden snapshots are built on:
 * their ids, enemy rosters and gold ranges are frozen and must not move, only
 * be joined by new rows.
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
  ],
  elite: [
    { id: 'e1', name: '关下骁将 · 华雄', enemies: ['huaxiong'], goldReward: [28, 42] },
    { id: 'e2', name: '黄巾渠帅 · 管亥', enemies: ['guanhai'], goldReward: [28, 42] },
  ],
  boss: [
    { id: 'b1', name: '虎牢关 · 吕布', enemies: ['lubu'], goldReward: [80, 110] },
    { id: 'b2', name: '人公将军 · 张梁', enemies: ['zhangliang'], goldReward: [80, 110] },
  ],
};

/**
 * The flat table the map still reads. Derived from `ACT1` so there is exactly
 * one place a fight is written down; todos/09 is what replaces the read with a
 * per-act `pickEncounter` call and lets this alias go.
 */
export const ENCOUNTERS: Record<CombatTier, Encounter[]> = {
  monster: [...ACT1.weak, ...ACT1.strong],
  elite: [...ACT1.elite],
  boss: [...ACT1.boss],
};

/**
 * Fights that are finished as rules and are deliberately **not** reachable from
 * the map yet. Two separate reasons, both spelled out per row:
 *
 * 1. `CombatScene` builds one view per enemy in `create()` and never again, so
 *    a body that joins mid-fight — 召唤 or 分裂 — is invisible and unclickable.
 *    An enemy that 遁走 keeps a frozen sprite on screen for the last frame.
 *    Wiring those three events up is scene work; see the handoff in todos/16.
 * 2. Act 2 has no table of its own until todos/09 builds one.
 *
 * `findEncounter` sees this table, so the sim, the golden files and
 * `tests/enemies.test.ts` all drive these fights for real.
 */
export const PENDING_ENCOUNTERS: Record<CombatTier, Encounter[]> = {
  monster: [
    // needs: `steal` debits the run, `escape` clears the sprite
    { id: 'm9', name: '劫粮流寇', enemies: ['liukou', 'bandit'], goldReward: [12, 20] },
    // needs: act 2
    { id: 'm10', name: '西凉哨骑', enemies: ['tieqi'], goldReward: [14, 22] },
    { id: 'm11', name: '相府亲兵', enemies: ['dongzhuoqinbing', 'dongzhuoqinbing'], goldReward: [16, 24] },
  ],
  // needs: a view built for a summoned body
  elite: [{ id: 'e3', name: '神上使 · 张曼成', enemies: ['zhangmancheng'], goldReward: [28, 42] }],
  // needs: a view built for a split body, and the parent's exit animated
  boss: [{ id: 'b3', name: '地公将军 · 张宝', enemies: ['zhangbao'], goldReward: [80, 110] }],
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
  return rng.pick(fresh.length > 0 ? fresh : pool);
}

export const getEnemy = (id: string): EnemyDef => {
  const def = ENEMIES[id];
  if (!def) throw new Error(`Unknown enemy id: ${id}`);
  return def;
};
