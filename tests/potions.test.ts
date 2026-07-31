import { describe, expect, it } from 'vitest';
import { getEncounter } from '../src/combat/enemies';
import {
  addStatus,
  drawCards,
  endPlayerTurn,
  resolveDamage,
  startPlayerTurn,
  startCombat,
  stacks,
  usePotion,
} from '../src/combat/engine';
import {
  POTIONS,
  POTION_DROP,
  POTION_POOL_BY_RARITY,
  getPotion,
  nextPotionChance,
  outOfCombatPotions,
  potionText,
  rollPotion,
} from '../src/combat/potions';
import { Rng } from '../src/core/rng';
import type { CombatState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import {
  BASE_POTION_SLOTS,
  addPotion,
  addRelic,
  hasPotionSpace,
  newDeckCard,
  removePotion,
  startRun,
  usePotionOutOfCombat,
  type DeckCard,
} from '../src/state/run';

/**
 * todos/02 · 丹药 — one test per line of its 验收标准, plus the drop-rate drift
 * and the shared-`applyEffect` claim the whole design rests on.
 */

function bench(deck: DeckCard[], encounterId = 'b1', seed = 'potion-bench'): CombatState {
  const encounter = getEncounter(encounterId);
  return startCombat({
    encounter,
    deck,
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed,
  });
}

const cards = (defId: string, n: number): DeckCard[] =>
  Array.from({ length: n }, () => newDeckCard(defId));

const hpLost = (state: CombatState, before: number): number => before - state.enemies[0].hp;

describe('丹药 · 验收标准', () => {
  it('火油罐 deals its printed 20 to 吕布', () => {
    const state = bench(cards('tiebi', 10));
    const before = state.enemies[0].hp;
    expect(usePotion(state, 'huoyouguan', state.enemies[0].id)).toBe(true);
    expect(hpLost(state, before)).toBe(20);
  });

  /**
   * The load-bearing one. If potions ever stop routing through `applyEffect`
   * this is the test that fails: 破绽 is applied by the pipeline, not by the
   * potion, so a second effect system would silently deal a flat 20 here.
   */
  it('火油罐 takes 破绽 — proof it shares the card damage pipeline', () => {
    const state = bench(cards('tiebi', 10));
    addStatus(state, state.enemies[0], 'vulnerable', 3);
    const before = state.enemies[0].hp;
    usePotion(state, 'huoyouguan', state.enemies[0].id);
    expect(hpLost(state, before)).toBe(Math.floor(20 * 1.5));
  });

  it('火油罐 takes 神力 as well, once', () => {
    const state = bench(cards('tiebi', 10));
    addStatus(state, state.player, 'strength', 4);
    const before = state.enemies[0].hp;
    usePotion(state, 'huoyouguan', state.enemies[0].id);
    expect(hpLost(state, before)).toBe(24);
  });

  it('壮行酒 takes 气 to 5, and the turn boundary puts it back to 3', () => {
    const state = bench(cards('tiebi', 10));
    expect(state.energy).toBe(3);
    usePotion(state, 'zhuangxingjiu');
    expect(state.energy).toBe(5);

    endPlayerTurn(state);
    startPlayerTurn(state);
    expect(state.energy).toBe(3);
  });

  it('回天丹 refunds exactly one death, and the next one kills', () => {
    const state = bench(cards('tiebi', 10));
    usePotion(state, 'huitiandan');

    const lethal = (): void => {
      resolveDamage(state, {
        attacker: null,
        defender: state.player,
        base: 999,
        isAttack: false,
        pierceBlock: true,
      });
    };

    lethal();
    expect(state.player.hp).toBe(25);
    expect(state.pendingRevive).toBe(0);

    lethal();
    expect(state.player.hp).toBe(0);
  });

  it('回天丹 never lets a corpse be observed — no death event on the refunded hit', () => {
    const state = bench(cards('tiebi', 10));
    usePotion(state, 'huitiandan');
    state.events.length = 0;
    resolveDamage(state, {
      attacker: null,
      defender: state.player,
      base: 999,
      isAttack: false,
      pierceBlock: true,
    });
    expect(state.events.find((e) => e.t === 'damage' && e.lethal)).toBeUndefined();
  });

  it('清心散 strips every debuff and leaves the buffs standing', () => {
    const state = bench(cards('tiebi', 10));
    addStatus(state, state.player, 'weak', 3);
    addStatus(state, state.player, 'frail', 2);
    addStatus(state, state.player, 'strength', 2);

    usePotion(state, 'qingxinsan');
    expect(stacks(state.player, 'weak')).toBe(0);
    expect(stacks(state.player, 'frail')).toBe(0);
    expect(stacks(state.player, 'strength')).toBe(2);
    // The block rider still lands, so the potion is never a dead slot.
    expect(state.player.block).toBe(6);
  });

  it('孟德新书 copies the hand once, not recursively', () => {
    const state = bench(cards('tiebi', 20));
    state.hand.length = 0;
    drawCards(state, 4);
    const before = [...state.hand];

    usePotion(state, 'mengdexinshu');
    expect(state.hand.length).toBe(before.length * 2);
    // Same cards, new uids — copies, not the originals moved around.
    expect(new Set(state.hand).size).toBe(state.hand.length);
  });

  it('a potion costs no 气 and no play limit', () => {
    const state = bench(cards('tiebi', 10));
    state.energy = 0;
    expect(usePotion(state, 'tiejiasan')).toBe(true);
    expect(state.energy).toBe(0);
    expect(state.cardsPlayedThisTurn).toBe(0);
  });

  it('refuses to pour while a card waits on a choice, and outside the player turn', () => {
    const state = bench(cards('tiebi', 10));
    state.pendingChoice = { kind: 'discard', options: [], min: 1, max: 1 };
    expect(usePotion(state, 'tiejiasan')).toBe(false);

    state.pendingChoice = null;
    state.phase = 'enemy';
    expect(usePotion(state, 'tiejiasan')).toBe(false);
  });

  it('an enemy-targeted potion with no live target is refused, not wasted', () => {
    const state = bench(cards('tiebi', 10));
    expect(usePotion(state, 'huoyouguan', 'no-such-enemy')).toBe(false);
    expect(state.events.some((e) => e.t === 'potion')).toBe(false);
  });
});

describe('丹药 · the belt', () => {
  it('starts at 3 slots, all empty', () => {
    const run = startRun(DEFAULT_HERO, 'belt');
    expect(run.potionSlots).toBe(BASE_POTION_SLOTS);
    expect(run.potions).toEqual([null, null, null]);
  });

  it('fills the first free slot and reports a full belt', () => {
    const run = startRun(DEFAULT_HERO, 'belt');
    expect(addPotion(run, 'huoyouguan')).toBe(true);
    expect(addPotion(run, 'tiejiasan')).toBe(true);
    expect(addPotion(run, 'xumintang')).toBe(true);
    expect(hasPotionSpace(run)).toBe(false);
    // Full: the caller has to ask the player, never silently drop it.
    expect(addPotion(run, 'wushisan')).toBe(false);
  });

  it('removePotion hands the id back so a swap is two calls', () => {
    const run = startRun(DEFAULT_HERO, 'belt');
    addPotion(run, 'huoyouguan');
    expect(removePotion(run, 0)).toBe('huoyouguan');
    expect(run.potions[0]).toBeNull();
    expect(removePotion(run, 0)).toBeNull();
  });

  it('药囊 widens the belt on pickup without disturbing what is in it', () => {
    const run = startRun(DEFAULT_HERO, 'belt');
    addPotion(run, 'huoyouguan');
    addPotion(run, 'tiejiasan');

    addRelic(run, 'yaonang');
    expect(run.potionSlots).toBe(BASE_POTION_SLOTS + 2);
    expect(run.potions.length).toBe(BASE_POTION_SLOTS + 2);
    expect(run.potions[0]).toBe('huoyouguan');
    expect(run.potions[1]).toBe('tiejiasan');
  });
});

describe('丹药 · out of combat', () => {
  it('续命汤 pours on the map, 火油罐 does not', () => {
    const run = startRun(DEFAULT_HERO, 'map');
    run.hp = 40;
    addPotion(run, 'xumintang');
    addPotion(run, 'huoyouguan');

    expect(usePotionOutOfCombat(run, 0)).toBe(true);
    expect(run.hp).toBe(56);
    expect(run.potions[0]).toBeNull();

    expect(usePotionOutOfCombat(run, 1)).toBe(false);
    // Refused, not consumed — the bottle is still on the belt.
    expect(run.potions[1]).toBe('huoyouguan');
  });

  it('never heals past max, and an empty slot is a no-op', () => {
    const run = startRun(DEFAULT_HERO, 'map');
    addPotion(run, 'xumintang');
    usePotionOutOfCombat(run, 0);
    expect(run.hp).toBe(run.maxHp);
    expect(usePotionOutOfCombat(run, 2)).toBe(false);
  });

  it('outOfCombatPotions lists exactly the map-usable bottles', () => {
    expect(outOfCombatPotions(['huoyouguan', null, 'xumintang'])).toEqual(['xumintang']);
  });
});

describe('丹药 · drops', () => {
  it('the same seed rolls the same potion every time', () => {
    const roll = (): string => rollPotion(new Rng('map:node-7:potion'));
    expect(roll()).toBe(roll());
  });

  it('a dry streak raises the chance and a drop lowers it, clamped', () => {
    expect(nextPotionChance(40, false)).toBe(50);
    expect(nextPotionChance(40, true)).toBe(30);
    expect(nextPotionChance(POTION_DROP.max, false)).toBe(POTION_DROP.max);
    expect(nextPotionChance(POTION_DROP.min, true)).toBe(POTION_DROP.min);
  });

  it('a run starts at the designed 40%', () => {
    expect(startRun(DEFAULT_HERO, 'drop').potionChance).toBe(POTION_DROP.start);
  });

  it('rollPotion only ever names a real potion', () => {
    const rng = new Rng('sweep');
    for (let i = 0; i < 400; i++) expect(POTIONS[rollPotion(rng)]).toBeDefined();
  });
});

describe('丹药 · the table', () => {
  it('every rarity tier has stock', () => {
    for (const [rarity, ids] of Object.entries(POTION_POOL_BY_RARITY)) {
      expect(ids.length, rarity).toBeGreaterThan(0);
    }
  });

  it('ids are self-consistent and every potion is reachable from a pool', () => {
    const pooled = new Set(Object.values(POTION_POOL_BY_RARITY).flat());
    for (const [id, def] of Object.entries(POTIONS)) {
      expect(def.id, id).toBe(id);
      expect(pooled.has(id), id).toBe(true);
    }
  });

  it('every potion does something — effects or a special, never neither', () => {
    for (const def of Object.values(POTIONS)) {
      expect(def.effects.length > 0 || !!def.special, def.id).toBe(true);
    }
  });

  it('potionText substitutes every placeholder it prints', () => {
    for (const def of Object.values(POTIONS)) {
      expect(potionText(def), def.id).not.toMatch(/\{[DB]\}/);
    }
    expect(potionText(getPotion('huoyouguan'))).toContain('20');
    expect(potionText(getPotion('tiejiasan'))).toContain('12');
  });

  it('getPotion is loud about an unknown id', () => {
    expect(() => getPotion('no-such-potion')).toThrow(/Unknown potion/);
  });

  it('only map-usable potions are pure heals — anything else needs a fight', () => {
    for (const def of Object.values(POTIONS)) {
      if (!def.usableOutOfCombat) continue;
      expect(def.special, def.id).toBeUndefined();
      for (const effect of def.effects) expect(effect.kind, def.id).toBe('heal');
    }
  });
});
