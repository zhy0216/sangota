import { describe, expect, it } from 'vitest';
import { CARDS, CARD_POOL_BY_RARITY, canUpgrade } from '../src/combat/cards';
import {
  CURSES,
  CURSE_POOL,
  STATUS_CARDS,
  isNegative,
  resolveCombatEndHooks,
} from '../src/combat/curses';
import { ENCOUNTERS } from '../src/combat/enemies';
import {
  canPlay,
  drawCards,
  endPlayerTurn,
  playCard,
  startCombat,
} from '../src/combat/engine';
import type { CardDef, CombatState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import {
  addCard,
  addCurse,
  applyCombatResult,
  newDeckCard,
  removeCard,
  startRun,
  upgradableCards,
  type RunState,
} from '../src/state/run';

/**
 * todos/14 · 诅咒与状态牌 — one test per line of its 验收标准.
 *
 * The two probe cards are registered into `CARDS` for this file only (vitest
 * isolates a test file's module graph), so the shipped pool the golden
 * snapshots were recorded against is untouched.
 */

const MINT: CardDef = {
  id: 'c-mint',
  name: '试·生成',
  type: 'skill',
  rarity: 'common',
  cost: 0,
  target: 'self',
  art: 'card-tiebi',
  text: '生成两张焚营。',
  effects: [{ kind: 'addCard', defId: 'fenying', count: 2, to: 'hand' }],
};

/** Something free to play, for counting what 反噬 and 宿命 do to a turn. */
const FREE: CardDef = {
  id: 'c-free',
  name: '试·白',
  type: 'skill',
  rarity: 'common',
  cost: 0,
  target: 'self',
  art: 'card-tiebi',
  text: '无事发生。',
  effects: [],
};

CARDS[MINT.id] = MINT;
CARDS[FREE.id] = FREE;

function bench(defIds: string[], seed = 'curse'): CombatState {
  return startCombat({
    encounter: ENCOUNTERS.monster[0],
    deck: defIds.map((id) => newDeckCard(id)),
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed,
  });
}

/** A fight fought with the run's own deck, the way `CombatScene` starts one. */
const fightWith = (run: RunState, seed: string): CombatState =>
  startCombat({
    encounter: ENCOUNTERS.monster[0],
    deck: run.deck,
    heroName: run.hero.name,
    hp: run.hp,
    maxHp: run.maxHp,
    relics: run.relics,
    seed,
  });

const uidsOf = (state: CombatState, pile: readonly string[], defId: string): string[] =>
  pile.filter((uid) => state.cards[uid].defId === defId);

describe('状态牌', () => {
  it('焚营: burns 2 体力 at end of turn and exhausts instead of discarding', () => {
    const state = bench(['fenying']);
    const uid = state.hand[0];
    expect(state.hand).toEqual([uid]);

    endPlayerTurn(state);

    expect(state.player.hp).toBe(DEFAULT_HERO.maxHp - 2);
    expect(state.exhaustPile).toEqual([uid]);
    expect(state.discardPile).toEqual([]);
  });

  it('眩晕: 虚无 sends it to the 消耗堆 at end of turn', () => {
    const state = bench(['xuanyun']);
    const uid = state.hand[0];

    endPlayerTurn(state);

    expect(state.exhaustPile).toEqual([uid]);
    expect(state.player.hp).toBe(DEFAULT_HERO.maxHp);
  });

  it('醉: charges 1 气 on draw and never pushes 气 negative', () => {
    expect(bench(['zui']).energy).toBe(2);

    // Six copies against a 5-card hand: the pool is empty long before the last
    // one is drawn, and the sixth is drawn by hand afterwards.
    const state = bench(Array<string>(6).fill('zui'));
    expect(state.energy).toBe(0);
    drawCards(state, 1);
    expect(state.energy).toBe(0);
  });

  it('never reaches run.deck — not through addCard, not through a fight', () => {
    const run = startRun(DEFAULT_HERO, 'seed-mint');
    expect(() => addCard(run, 'fenying')).toThrow(/never enter the deck/);

    const state = fightWith(run, 'mint');
    // Force the generator into hand rather than fishing for it in the shuffle.
    const minted = newDeckCard('c-mint');
    state.cards[minted.uid] = minted;
    state.hand.push(minted.uid);
    expect(playCard(state, minted.uid)).toBe(true);
    expect(uidsOf(state, state.hand, 'fenying')).toHaveLength(2);

    applyCombatResult(run, state.player.hp);
    expect(run.deck.some((c) => c.defId === 'fenying')).toBe(false);
  });
});

describe('诅咒牌', () => {
  it('反噬: costs 1 体力 per card played, and stops once it leaves the hand', () => {
    const state = bench(['fanshi', 'c-free', 'c-free', 'c-free']);
    const free = state.hand.filter((uid) => state.cards[uid].defId === 'c-free');

    expect(playCard(state, free[0])).toBe(true);
    expect(state.player.hp).toBe(DEFAULT_HERO.maxHp - 1);
    expect(playCard(state, free[1])).toBe(true);
    expect(state.player.hp).toBe(DEFAULT_HERO.maxHp - 2);

    // Off to the discard pile with the rest of the hand.
    endPlayerTurn(state);
    const after = state.player.hp;
    state.phase = 'player';
    state.hand = [free[2]];
    expect(playCard(state, free[2])).toBe(true);
    expect(state.player.hp).toBe(after);
  });

  it('宿命: greys out every other card once three have been played', () => {
    const state = bench(['suming', 'c-free', 'c-free', 'c-free', 'c-free']);
    const free = state.hand.filter((uid) => state.cards[uid].defId === 'c-free');

    for (let i = 0; i < 3; i++) {
      expect(canPlay(state, free[i]), `card ${i + 1}`).toBe(true);
      expect(playCard(state, free[i])).toBe(true);
    }
    expect(state.cardsPlayedThisTurn).toBe(3);
    expect(canPlay(state, free[3])).toBe(false);
    expect(playCard(state, free[3])).toBe(false);
  });

  it('疑心: the 怯战 it applies survives into the enemy turn', () => {
    const state = bench(['yixin']);
    endPlayerTurn(state);
    // Applied after the end-of-turn decay pass, so the layer is still standing.
    expect(state.player.statuses.weak).toBe(1);
  });

  it('贪念: takes 15 资财 when the fight ends, and never past zero', () => {
    const run = startRun(DEFAULT_HERO, 'seed-gold');
    addCurse(run, 'tannian');

    run.gold = 20;
    resolveCombatEndHooks(fightWith(run, 'gold-a'), run);
    expect(run.gold).toBe(5);

    run.gold = 10;
    resolveCombatEndHooks(fightWith(run, 'gold-b'), run);
    expect(run.gold).toBe(0);
  });

  it('stays in run.deck after the fight', () => {
    const run = startRun(DEFAULT_HERO, 'seed-keep');
    const curse = addCurse(run, 'jiushang');
    const state = fightWith(run, 'keep');

    endPlayerTurn(state);
    applyCombatResult(run, state.player.hp);

    expect(run.deck.map((c) => c.uid)).toContain(curse.uid);
  });

  it('is never forgeable, so the 营帐 list drops it with a reason to show', () => {
    const run = startRun(DEFAULT_HERO, 'seed-forge');
    const curse = addCurse(run, 'yixin');

    for (const id of Object.keys(CURSES)) expect(canUpgrade(id, 0), id).toBe(false);
    expect(upgradableCards(run).map((c) => c.uid)).not.toContain(curse.uid);
  });

  it('can be shed through the removal primitive every channel shares', () => {
    const run = startRun(DEFAULT_HERO, 'seed-remove');
    const curse = addCurse(run, 'shemi');
    const before = run.deck.length;

    expect(removeCard(run, curse.uid)).toBe(true);
    expect(run.deck).toHaveLength(before - 1);
    expect(run.deck.some((c) => c.defId === 'shemi')).toBe(false);
    // A second removal of the same physical card is a no-op, not a hole.
    expect(removeCard(run, curse.uid)).toBe(false);
  });
});

describe('pool hygiene', () => {
  it('keeps both kinds out of every reward pool', () => {
    for (const id of Object.values(CARD_POOL_BY_RARITY).flat()) {
      expect(isNegative(CARDS[id]), id).toBe(false);
    }
    // `basic` is what structurally excludes them now that todos/11 keys the pool
    // by rarity, so it is the property worth pinning rather than the list above.
    for (const def of [...Object.values(CURSES), ...Object.values(STATUS_CARDS)]) {
      expect(def.rarity, def.id).toBe('basic');
    }
  });

  it('offers only removable curses to the events that hand them out', () => {
    for (const id of CURSE_POOL) {
      expect(CURSES[id], id).toBeDefined();
      expect(CURSES[id].type).toBe('curse');
    }
  });

  it('refuses to smuggle a status card in through addCurse', () => {
    const run = startRun(DEFAULT_HERO, 'seed-smuggle');
    expect(() => addCurse(run, 'fenying')).toThrow(/Not a curse/);
  });
});
