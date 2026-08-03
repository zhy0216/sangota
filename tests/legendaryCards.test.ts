import { describe, expect, it } from 'vitest';
import { CARDS, poolFor, resolveCard } from '../src/combat/cards';
import { playCard, startCombat } from '../src/combat/engine';
import { getEncounter } from '../src/combat/enemies';
import type { CombatState } from '../src/combat/types';
import { newDeckCard } from '../src/state/run';

type HeroId = 'guanyu' | 'zhaoyun' | 'zhugeliang';

const LEGENDARIES: Record<HeroId, readonly string[]> = {
  guanyu: ['qinglongjueying', 'wushenglinshi', 'yijueqianqiu'],
  zhaoyun: ['qiruchangban', 'longyinzhenjun', 'zhaoyepozhen'],
  zhugeliang: ['qimenbazhen', 'dongfengjitian', 'qixingxuming'],
};

function bench(defIds: string[], seed = 'legendary-bench'): CombatState {
  const state = startCombat({
    encounter: getEncounter('b1'),
    deck: defIds.map((id) => newDeckCard(id)),
    heroName: '试',
    hp: 80,
    maxHp: 80,
    relics: [],
    seed,
  });
  state.energy = 20;
  return state;
}

function uidOf(state: CombatState, defId: string): string {
  const uid = state.hand.find((id) => state.cards[id].defId === defId);
  expect(uid, `${defId} not in hand`).toBeDefined();
  return uid!;
}

describe('Legendary card contract', () => {
  it('ships exactly three per hero, each with unique art, VFX, exhaust and an upgrade', () => {
    const art = new Set<string>();
    const vfx = new Set<string>();

    for (const [heroId, ids] of Object.entries(LEGENDARIES) as [HeroId, readonly string[]][]) {
      expect(poolFor(heroId, 'legendary')).toEqual(ids);
      expect(ids).toHaveLength(3);
      for (const id of ids) {
        const def = CARDS[id];
        expect(def.hero, id).toBe(heroId);
        expect(def.rarity, id).toBe('legendary');
        expect(def.keywords, id).toContain('exhaust');
        expect(def.upgrade, id).toBeDefined();
        expect(def.art, id).toBe(`card-${id}`);
        expect(def.playVfx, id).toBeDefined();
        art.add(def.art);
        vfx.add(def.playVfx!);
      }
    }

    expect(art.size).toBe(9);
    expect(vfx.size).toBe(9);
  });

  it('青龙绝影 changes branch against an already-vulnerable target', () => {
    const cold = bench(['qinglongjueying'], 'qinglong-cold');
    const coldEnemy = cold.enemies[0];
    const coldHp = coldEnemy.hp;
    expect(playCard(cold, uidOf(cold, 'qinglongjueying'), coldEnemy.id)).toBe(true);
    expect(coldHp - coldEnemy.hp).toBe(24);
    expect(coldEnemy.statuses.vulnerable).toBe(3);

    const hot = bench(['qinglongjueying'], 'qinglong-hot');
    const hotEnemy = hot.enemies[0];
    hotEnemy.statuses.vulnerable = 1;
    const hotHp = hotEnemy.hp;
    expect(playCard(hot, uidOf(hot, 'qinglongjueying'), hotEnemy.id)).toBe(true);
    expect(hotHp - hotEnemy.hp).toBe(54); // 36 × 1.5 from existing 破绽
    expect(hotEnemy.statuses.vulnerable).toBe(4);
  });

  it('七入长坂 pays the three-attack combo without counting itself', () => {
    const state = bench(['tuzhen', 'tuzhen', 'tuzhen', 'qiruchangban'], 'seven-rides');
    const enemy = state.enemies[0];
    for (let i = 0; i < 3; i++) {
      expect(playCard(state, uidOf(state, 'tuzhen'), enemy.id)).toBe(true);
    }
    const hp = enemy.hp;
    expect(playCard(state, uidOf(state, 'qiruchangban'), enemy.id)).toBe(true);
    expect(hp - enemy.hp).toBe(24);
    expect(state.energy).toBe(16); // 20 − 3 − 2 + 1
    expect(state.attacksThisTurn).toBe(4);
  });

  it('奇门八阵 protects, debuffs and mints its own two 锦囊', () => {
    const state = bench(['qimenbazhen'], 'eight-trigrams');
    const enemy = state.enemies[0];
    expect(playCard(state, uidOf(state, 'qimenbazhen'), enemy.id)).toBe(true);
    expect(state.player.block).toBe(18);
    expect(enemy.statuses.vulnerable).toBe(2);
    expect(enemy.statuses.weak).toBe(2);
    expect(state.hand.map((uid) => state.cards[uid].defId)).toEqual(['jinnang', 'jinnang']);
  });

  it('keeps upgraded Legendary definitions playable and visibly stronger', () => {
    for (const ids of Object.values(LEGENDARIES)) {
      for (const id of ids) {
        const base = resolveCard(id, 0);
        const upgraded = resolveCard(id, 1);
        expect(upgraded.name).toBe(`${base.name}·精`);
        expect(upgraded.effects.length).toBeGreaterThan(0);
        expect(upgraded).not.toEqual(base);
      }
    }
  });
});
