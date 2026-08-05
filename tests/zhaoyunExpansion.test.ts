import { describe, expect, it } from 'vitest';
import { CARDS, poolFor, resolveCard } from '../src/combat/cards';
import { getEncounter } from '../src/combat/enemies';
import {
  endPlayerTurn,
  playCard,
  previewValues,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import { RELICS, relicsOfTier } from '../src/combat/relics';
import { relicPool } from '../src/combat/rewards';
import type { CombatState, EnemyMove, EnemyState } from '../src/combat/types';
import { HEROES } from '../src/data/heroes';
import { newDeckCard, startRun } from '../src/state/run';

/**
 * 2026-08 赵云扩池（枪胆防反）的机制台架。照 guanyuExpansion.test.ts 的模式：
 * append 校验钉死池序，再对每个新机制做冷/热双态断言。
 *
 * bench 与关羽版的三处不同（tests 契约报告）：heroName/hp 用 HEROES.zhaoyun；
 * relics 缺省为空——涯角枪付的是「本回合第二次攻」，带上它任何两连击断言都
 * 会混入 +4，机制台架裸跑最干净；连击机制恰恰读 attacksThisTurn，不能借关羽
 * 版「预设计数器」的招。
 */

const ADDED = {
  common: [
    'qingweixianfeng', 'juqiang', 'xianmei', 'touzhen',
    'rangshantuwei', 'baipao', 'yushiyuekeng', 'lianzhonggushou',
  ],
  uncommon: [
    'huimaqiang', 'jianbi', 'juma', 'chengxi', 'panhejiugong', 'bowangqinlan',
    'hanshuijushou', 'huaibaoyoudou', 'qiangwulihua', 'guochuang',
    'shatouchongwei', 'yimadangxian',
  ],
  rare: [
    'qiangchurulong', 'qiangcijiankan', 'changshanzhaozilong', 'lituizhanghe',
    'huzhuchongzhen', 'shunpinghou', 'zairuchongwei', 'qiangtiaogaolan',
  ],
} as const;

const ZHAOYUN_RELICS = {
  common: ['hongying', 'yamenqi', 'suzhengpao', 'changshanjunqi'],
  uncommon: ['baiying', 'yijunyin', 'jili', 'adouqiangbao', 'deshenggu'],
  rare: ['longdanqiangpu'],
} as const;

function bench(ids: string[], seed: string, relics: string[] = []): CombatState {
  const state = startCombat({
    encounter: getEncounter('m1'),
    deck: ids.map((id) => newDeckCard(id)),
    heroName: HEROES.zhaoyun.name,
    hp: HEROES.zhaoyun.maxHp,
    maxHp: HEROES.zhaoyun.maxHp,
    relics,
    seed: `zhaoyun-expansion-${seed}`,
  });
  state.energy = 99;
  // 多段/连击断言不许被一条尸体吞掉伤害。
  for (const enemy of state.enemies) {
    enemy.hp = 999;
    enemy.maxHp = 999;
  }
  return state;
}

const uidOf = (state: CombatState, defId: string): string => {
  const uid = state.hand.find((held) => state.cards[held].defId === defId);
  if (!uid) throw new Error(`${defId} not in hand`);
  return uid;
};

/**
 * Decks of exactly five land whole in the opening hand; anything bigger deals
 * a random five. Benches that need a specific card *and* a stocked draw pile
 * swap it in deterministically instead of hoping the shuffle cooperates.
 */
function fetchToHand(state: CombatState, defId: string): void {
  if (state.hand.some((held) => state.cards[held].defId === defId)) return;
  const at = state.drawPile.findIndex((uid) => state.cards[uid].defId === defId);
  if (at < 0) throw new Error(`${defId} not in draw pile`);
  const [uid] = state.drawPile.splice(at, 1);
  state.drawPile.push(state.hand.pop()!);
  state.hand.push(uid);
}

const cards = (defId: string, n: number): string[] => Array.from({ length: n }, () => defId);

/** statuses.test.ts 的同款：跳过抽牌把回合直接交给敌人。 */
function enemyPlays(state: CombatState, move: EnemyMove, enemy: EnemyState = state.enemies[0]): void {
  state.phase = 'enemy';
  for (const other of state.enemies) other.intent = null;
  enemy.intent = move;
  runEnemyTurn(state);
}

const attackMove = (damage: number, hits?: number): EnemyMove => ({
  id: 'probe',
  label: '试',
  damage,
  hits,
  weight: 1,
});

// ------------------------------------------------------------------ 池序契约

describe('赵云 pool expansion', () => {
  it('appends exactly 8 common, 12 uncommon and 8 rare cards', () => {
    expect(poolFor('zhaoyun', 'common').slice(-ADDED.common.length)).toEqual(ADDED.common);
    expect(poolFor('zhaoyun', 'uncommon').slice(-ADDED.uncommon.length)).toEqual(ADDED.uncommon);
    expect(poolFor('zhaoyun', 'rare').slice(-ADDED.rare.length)).toEqual(ADDED.rare);
    expect(poolFor('zhaoyun', 'legendary')).toHaveLength(3);
    expect(poolFor('zhaoyun', 'common')).toHaveLength(16);
    expect(poolFor('zhaoyun', 'uncommon')).toHaveLength(20);
    expect(poolFor('zhaoyun', 'rare')).toHaveLength(12);
  });

  it('adds three 势 cards and leaves every new card forgeable and hero-stamped', () => {
    const all = [...ADDED.common, ...ADDED.uncommon, ...ADDED.rare];
    expect(all.filter((id) => CARDS[id].type === 'power')).toEqual([
      'huimaqiang',
      'yimadangxian',
      'shunpinghou',
    ]);
    for (const id of all) {
      expect(CARDS[id].upgrade, id).toBeDefined();
      expect(CARDS[id].hero, id).toBe('zhaoyun');
      expect(CARDS[id].art, id).toBe(`card-${id}`);
    }
    // 势牌照池规矩消耗离场。
    for (const id of ['huimaqiang', 'yimadangxian', 'shunpinghou']) {
      expect(CARDS[id].keywords, id).toContain('exhaust');
    }
  });
});

// ------------------------------------------------------------- 据守反击轴

describe('blockAtLeast 条件', () => {
  it('previews and resolves 据枪 from the same wall, both sides of the threshold', () => {
    const state = bench([...cards('juqiang', 2), ...cards('luema', 3)], 'juqiang');
    const enemy = state.enemies[0];
    const def = resolveCard('juqiang');

    expect(previewValues(state, def, enemy).D).toBe(6);
    let hp = enemy.hp;
    expect(playCard(state, uidOf(state, 'juqiang'), enemy.id)).toBe(true);
    expect(hp - enemy.hp).toBe(6);

    expect(playCard(state, uidOf(state, 'luema'))).toBe(true);
    expect(state.player.block).toBe(5);
    expect(previewValues(state, def, enemy).D).toBe(10);
    hp = enemy.hp;
    expect(playCard(state, uidOf(state, 'juqiang'), enemy.id)).toBe(true);
    expect(hp - enemy.hp).toBe(10);
  });

  it('draws through 乘隙 only from behind a standing wall', () => {
    const state = bench([...cards('chengxi', 2), ...cards('luema', 3)], 'chengxi');
    const draws = (): number => state.events.filter((event) => event.t === 'draw').length;

    const before = draws();
    expect(playCard(state, uidOf(state, 'chengxi'), state.enemies[0].id)).toBe(true);
    expect(draws()).toBe(before);

    playCard(state, uidOf(state, 'luema'));
    const armed = draws();
    expect(playCard(state, uidOf(state, 'chengxi'), state.enemies[0].id)).toBe(true);
    expect(draws()).toBe(armed + 1);
  });
});

// ----------------------------------------------------------------- 回枪

describe('回枪', () => {
  it('returns armour after each hit, so the triggering blow is never softened', () => {
    const state = bench([...cards('huimaqiang', 1), ...cards('tuzhen', 4)], 'riposte');
    expect(playCard(state, uidOf(state, 'huimaqiang'))).toBe(true);
    expect(state.player.statuses.riposte).toBe(3);

    const hp = state.player.hp;
    enemyPlays(state, attackMove(10, 2));
    // Hit one lands whole (10), 回枪 raises 3; hit two is blunted to 7.
    expect(hp - state.player.hp).toBe(17);
    expect(
      state.events.filter((event) => event.t === 'block' && event.targetId === 'player'),
    ).toHaveLength(2);
  });

  it('ignores non-attack losses — 直接扣血 wakes no spear', () => {
    const state = bench([...cards('huimaqiang', 1), ...cards('tuzhen', 4)], 'riposte-loseHp');
    playCard(state, uidOf(state, 'huimaqiang'));
    enemyPlays(state, { id: 'p', label: '毒', loseHp: 5, weight: 1 });
    expect(
      state.events.filter((event) => event.t === 'block' && event.targetId === 'player'),
    ).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- 连击新卡

describe('连击 payoffs', () => {
  it('opens 请为先锋 in the starting hand and pays it for going first', () => {
    const state = bench(['qingweixianfeng', ...cards('tuzhen', 11)], 'xianfeng');
    expect(state.hand.map((uid) => state.cards[uid].defId)).toContain('qingweixianfeng');

    const enemy = state.enemies[0];
    let hp = enemy.hp;
    expect(playCard(state, uidOf(state, 'qingweixianfeng'), enemy.id)).toBe(true);
    expect(hp - enemy.hp).toBe(8);

    // 后手缩水：再来一张已不是第一枪。
    const late = bench(['qingweixianfeng', ...cards('tuzhen', 11)], 'xianfeng-late');
    playCard(late, uidOf(late, 'tuzhen'), late.enemies[0].id);
    hp = late.enemies[0].hp;
    expect(playCard(late, uidOf(late, 'qingweixianfeng'), late.enemies[0].id)).toBe(true);
    expect(hp - late.enemies[0].hp).toBe(5);
  });

  it('pays 透阵 its armour only after two spears', () => {
    const state = bench([...cards('touzhen', 2), ...cards('tuzhen', 3)], 'touzhen');
    expect(playCard(state, uidOf(state, 'touzhen'), state.enemies[0].id)).toBe(true);
    expect(state.player.block).toBe(0);

    playCard(state, uidOf(state, 'tuzhen'), state.enemies[0].id);
    expect(playCard(state, uidOf(state, 'touzhen'), state.enemies[0].id)).toBe(true);
    expect(state.player.block).toBe(5);
  });

  it('relights the turn through 再入重围 only after two attacks', () => {
    const cold = bench([...cards('zairuchongwei', 1), ...cards('tuzhen', 9)], 'zairu-cold');
    fetchToHand(cold, 'zairuchongwei');
    const coldDraws = cold.events.filter((event) => event.t === 'draw').length;
    playCard(cold, uidOf(cold, 'zairuchongwei'));
    expect(cold.events.filter((event) => event.t === 'draw')).toHaveLength(coldDraws + 1);

    const hot = bench([...cards('zairuchongwei', 1), ...cards('tuzhen', 9)], 'zairu-hot');
    fetchToHand(hot, 'zairuchongwei');
    playCard(hot, uidOf(hot, 'tuzhen'), hot.enemies[0].id);
    playCard(hot, uidOf(hot, 'tuzhen'), hot.enemies[0].id);
    const energy = hot.energy;
    const draws = hot.events.filter((event) => event.t === 'draw').length;
    expect(playCard(hot, uidOf(hot, 'zairuchongwei'))).toBe(true);
    expect(hot.energy).toBe(energy); // paid 1, the condition returned 1
    expect(hot.events.filter((event) => event.t === 'draw')).toHaveLength(draws + 3);
  });
});

// ------------------------------------------------------------------ 宝物

describe('赵云宝物扩充', () => {
  it('appends ten hero-tagged definitions and reaches 15/14/7 for 赵云', () => {
    for (const [tier, ids] of Object.entries(ZHAOYUN_RELICS)) {
      expect(
        relicsOfTier(tier as keyof typeof ZHAOYUN_RELICS).slice(-ids.length).map((r) => r.id),
      ).toEqual(ids);
      for (const id of ids) expect(RELICS[id].hero, id).toBe('zhaoyun');
    }

    const zhaoyun = startRun(HEROES.zhaoyun, 'zy-relic-pool');
    expect(relicPool(zhaoyun, 'common')).toHaveLength(15);
    expect(relicPool(zhaoyun, 'uncommon')).toHaveLength(14);
    expect(relicPool(zhaoyun, 'rare')).toHaveLength(7);

    // 关羽's pools do not move by a single id — the whole point of the tag.
    const guanyu = startRun(HEROES.guanyu, 'gy-relic-pool');
    expect(relicPool(guanyu, 'common')).toHaveLength(15);
    expect(relicPool(guanyu, 'uncommon')).toHaveLength(15);
    expect(relicPool(guanyu, 'rare')).toHaveLength(10);
    for (const id of Object.values(ZHAOYUN_RELICS).flat()) {
      for (const tier of ['common', 'uncommon', 'rare'] as const) {
        expect(relicPool(guanyu, tier), `${tier}/${id}`).not.toContain(id);
      }
    }
  });

  it('红缨 armours the first spear of each turn, once', () => {
    const state = bench(cards('tuzhen', 5), 'hongying', ['hongying']);
    playCard(state, uidOf(state, 'tuzhen'), state.enemies[0].id);
    expect(state.player.block).toBe(2);
    playCard(state, uidOf(state, 'tuzhen'), state.enemies[0].id);
    expect(state.player.block).toBe(2);
  });

  it('翊军印 refunds the fourth spear', () => {
    const state = bench(cards('tuzhen', 6), 'yijunyin', ['yijunyin']);
    for (let i = 0; i < 3; i++) playCard(state, uidOf(state, 'tuzhen'), state.enemies[0].id);
    expect(state.energy).toBe(96);
    playCard(state, uidOf(state, 'tuzhen'), state.enemies[0].id);
    expect(state.energy).toBe(96); // paid 1, the seal returned 1
  });

  it('龙胆枪谱 replays the fifth attack and only an attack', () => {
    const state = bench(cards('tuzhen', 5), 'qiangpu', ['longdanqiangpu']);
    const enemy = state.enemies[0];
    for (let i = 0; i < 4; i++) playCard(state, uidOf(state, 'tuzhen'), enemy.id);

    const hp = enemy.hp;
    playCard(state, uidOf(state, 'tuzhen'), enemy.id);
    expect(hp - enemy.hp).toBe(12); // 6 printed, resolved twice

    // 谋牌不领这份复读：四攻之后的掠马仍是一份 5 甲。
    const skills = bench([...cards('tuzhen', 4), 'luema'], 'qiangpu-skill', ['longdanqiangpu']);
    for (let i = 0; i < 4; i++) playCard(skills, uidOf(skills, 'tuzhen'), skills.enemies[0].id);
    playCard(skills, uidOf(skills, 'luema'));
    expect(skills.player.block).toBe(5);
  });

  it('蒺藜 turns a standing wall into a permanent thorn at turn end', () => {
    const state = bench(cards('luema', 6), 'jili', ['jili']);
    playCard(state, uidOf(state, 'luema'));
    playCard(state, uidOf(state, 'luema'));
    expect(state.player.block).toBe(10);
    endPlayerTurn(state);
    expect(state.player.statuses.thorns).toBe(1);

    // 矮墙不长刺。
    const low = bench(cards('luema', 6), 'jili-low', ['jili']);
    playCard(low, uidOf(low, 'luema'));
    endPlayerTurn(low);
    expect(low.player.statuses.thorns).toBeUndefined();
  });

  it('阿斗襁褓 grants one 天佑 the first time the bar halves, and never again', () => {
    const state = bench(cards('tuzhen', 8), 'qiangbao', ['adouqiangbao']);
    enemyPlays(state, attackMove(40));
    expect(state.player.hp).toBe(HEROES.zhaoyun.maxHp - 40);
    expect(state.player.statuses.buffer).toBe(1);

    // 下一击被那层天佑整笔吃掉；层没了也不再补。
    enemyPlays(state, attackMove(5));
    expect(state.player.hp).toBe(HEROES.zhaoyun.maxHp - 40);
    expect(state.player.statuses.buffer).toBeUndefined();
  });

  it('得胜鼓 rolls a four-spear turn into next turn’s draw', () => {
    const state = bench(cards('tuzhen', 12), 'deshenggu', ['deshenggu']);
    for (let i = 0; i < 4; i++) playCard(state, uidOf(state, 'tuzhen'), state.enemies[0].id);
    endPlayerTurn(state);
    state.phase = 'enemy';
    for (const enemy of state.enemies) enemy.intent = null;
    runEnemyTurn(state);
    expect(state.hand).toHaveLength(6); // 5 dealt + 1 from the drum

    endPlayerTurn(state);
    state.phase = 'enemy';
    for (const enemy of state.enemies) enemy.intent = null;
    runEnemyTurn(state);
    expect(state.hand).toHaveLength(5); // a quiet turn earns nothing
  });

  it('常山军旗 draws on the fifth card of the turn, whatever its type', () => {
    const state = bench(cards('luema', 12), 'junqi', ['changshanjunqi']);
    const draws = (): number => state.events.filter((event) => event.t === 'draw').length;
    for (let i = 0; i < 4; i++) playCard(state, uidOf(state, 'luema'));
    const before = draws();
    playCard(state, uidOf(state, 'luema'));
    expect(draws()).toBe(before + 1);
  });
});
