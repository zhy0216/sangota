import { describe, expect, it } from 'vitest';
import { CARD_POOL_BY_RARITY, CARDS, resolveCard } from '../src/combat/cards';
import { getEncounter } from '../src/combat/enemies';
import {
  endPlayerTurn,
  playCard,
  previewValues,
  resolveChoice,
  startCombat,
} from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard } from '../src/state/run';

const ADDED = {
  common: ['huimazhan', 'mingjinzhengdui', 'duanpaojueyi', 'qingzhuangjiancong'],
  uncommon: [
    'yanqiyansha',
    'zhenqianlidao',
    'bingyinghezhen',
    'juantuchonglai',
    'yijiahuanzhen',
    'baizhanhuifeng',
    'zhengjingwu',
    'libingmoma',
    'liangdaochangtong',
    'chizhongdaiji',
  ],
  rare: ['wusheng', 'hanbingzaixing'],
} as const;

function bench(ids: string[]): CombatState {
  const state = startCombat({
    encounter: getEncounter('m1'),
    deck: ids.map((id) => newDeckCard(id)),
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed: `guanyu-expansion-${ids.join('-')}`,
  });
  state.energy = 99;
  // Keep 青龙偃月刀 out of the mechanic assertions below.
  state.attacksThisTurn = 1;
  state.enemies[0].hp = 999;
  state.enemies[0].maxHp = 999;
  return state;
}

const uidOf = (state: CombatState, defId: string): string => {
  const uid = state.hand.find((held) => state.cards[held].defId === defId);
  if (!uid) throw new Error(`${defId} not in hand`);
  return uid;
};

describe('关羽 48-card engine expansion', () => {
  it('appends exactly 4 common, 10 uncommon and 2 rare cards', () => {
    expect(CARD_POOL_BY_RARITY.common.slice(-4)).toEqual(ADDED.common);
    expect(CARD_POOL_BY_RARITY.uncommon.slice(-10)).toEqual(ADDED.uncommon);
    expect(CARD_POOL_BY_RARITY.rare.slice(-2)).toEqual(ADDED.rare);
    expect(Object.values(CARD_POOL_BY_RARITY).flat()).toHaveLength(48);
  });

  it('adds five 势 cards and leaves every new card forgeable', () => {
    const all = [...ADDED.common, ...ADDED.uncommon, ...ADDED.rare];
    expect(all.filter((id) => CARDS[id].type === 'power')).toEqual([
      'zhengjingwu',
      'libingmoma',
      'liangdaochangtong',
      'chizhongdaiji',
      'wusheng',
    ]);
    for (const id of all) expect(CARDS[id].upgrade, id).toBeDefined();
  });
});

describe('关羽 pile engines', () => {
  it('turns a deliberate discard into 整军 block, then resumes the draw', () => {
    const state = bench(['zhengjingwu', 'huimazhan', 'pikan', 'tiebi', 'quedi']);
    expect(playCard(state, uidOf(state, 'zhengjingwu'))).toBe(true);
    expect(state.player.statuses.discipline).toBe(3);

    expect(playCard(state, uidOf(state, 'huimazhan'), state.enemies[0].id)).toBe(true);
    expect(state.pendingChoice).toMatchObject({ kind: 'discard', min: 1, max: 1 });
    const picked = uidOf(state, 'pikan');
    const draws = state.events.filter((event) => event.t === 'draw').length;

    expect(resolveChoice(state, [picked])).toBe(true);
    expect(state.player.block).toBe(3);
    expect(state.events.filter((event) => event.t === 'draw')).toHaveLength(draws + 1);
  });

  it('does not treat ordinary end-of-turn cleanup as an active discard', () => {
    const state = bench(['zhengjingwu', 'pikan', 'tiebi', 'quedi', 'wenjiu']);
    expect(playCard(state, uidOf(state, 'zhengjingwu'))).toBe(true);

    endPlayerTurn(state);

    expect(state.player.block).toBe(0);
    expect(state.discardPile.length).toBeGreaterThan(0);
  });

  it('converts a chosen non-势 exhaust into both 砺兵 block and 武圣 strength', () => {
    const state = bench(['libingmoma', 'wusheng', 'duanpaojueyi', 'pikan', 'tiebi']);
    expect(playCard(state, uidOf(state, 'libingmoma'))).toBe(true);
    expect(playCard(state, uidOf(state, 'wusheng'))).toBe(true);
    // The two setup powers exhaust as part of their normal lifecycle, but 势
    // is not fuel for either payoff.
    expect(state.player.block).toBe(0);
    expect(state.player.statuses.strength ?? 0).toBe(0);

    expect(playCard(state, uidOf(state, 'duanpaojueyi'), state.enemies[0].id)).toBe(true);
    expect(state.pendingChoice).toMatchObject({ kind: 'exhaust', min: 1, max: 1 });
    expect(resolveChoice(state, [uidOf(state, 'pikan')])).toBe(true);

    expect(state.player.block).toBe(2);
    expect(state.player.statuses.strength).toBe(1);
  });

  it('refunds the cost of an explicit shuffle through 粮道 exactly once', () => {
    const state = bench(['liangdaochangtong', 'mingjinzhengdui', 'pikan', 'tiebi', 'quedi']);
    expect(playCard(state, uidOf(state, 'liangdaochangtong'))).toBe(true);
    expect(playCard(state, uidOf(state, 'pikan'), state.enemies[0].id)).toBe(true);
    const before = state.energy;
    const shuffles = state.events.filter((event) => event.t === 'shuffle').length;

    expect(playCard(state, uidOf(state, 'mingjinzhengdui'))).toBe(true);

    expect(state.energy).toBe(before); // paid 1, 粮道 returned 1
    expect(state.events.filter((event) => event.t === 'shuffle')).toHaveLength(shuffles + 1);
  });

  it('previews and resolves 百战回锋 from the same exhaust threshold', () => {
    const state = bench(['baizhanhuifeng', 'pikan', 'tiebi', 'quedi', 'wenjiu']);
    state.exhaustPile.push('spent-1', 'spent-2', 'spent-3', 'spent-4');
    const enemy = state.enemies[0];
    const def = resolveCard('baizhanhuifeng');
    const promised = previewValues(state, def, enemy).D;
    const hp = enemy.hp;

    expect(promised).toBe(14);
    expect(playCard(state, uidOf(state, 'baizhanhuifeng'), enemy.id)).toBe(true);
    expect(hp - enemy.hp).toBe(promised);
  });
});
