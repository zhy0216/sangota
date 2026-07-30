import type { EnemyDef, Encounter } from './types';

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
};

/** Encounter tables keyed by the map node type that triggers them. */
export const ENCOUNTERS: Record<'monster' | 'elite' | 'boss', Encounter[]> = {
  monster: [
    { id: 'm1', name: '黄巾散兵', enemies: ['yellowturban'], goldReward: [10, 18] },
    { id: 'm2', name: '黄巾游骑', enemies: ['yellowturban', 'yellowturban'], goldReward: [14, 22] },
    { id: 'm3', name: '山道劫掠', enemies: ['bandit', 'bandit'], goldReward: [12, 20] },
    { id: 'm4', name: '乱军', enemies: ['bandit', 'yellowturban'], goldReward: [14, 22] },
  ],
  elite: [{ id: 'e1', name: '关下骁将 · 华雄', enemies: ['huaxiong'], goldReward: [28, 42] }],
  boss: [{ id: 'b1', name: '虎牢关 · 吕布', enemies: ['lubu'], goldReward: [80, 110] }],
};

export const getEnemy = (id: string): EnemyDef => {
  const def = ENEMIES[id];
  if (!def) throw new Error(`Unknown enemy id: ${id}`);
  return def;
};
