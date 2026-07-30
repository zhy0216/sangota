import { describe, expect, it } from 'vitest';
import { CARDS, UPGRADE_SUFFIX, canUpgrade, getCard, resolveCard } from '../src/combat/cards';
import { ENCOUNTERS } from '../src/combat/enemies';
import {
  PASSIVE_ATTACK_BONUS,
  canPlay,
  defOf,
  endPlayerTurn,
  playCard,
  previewValues,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import type { CombatEvent, CombatState, Effect } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import {
  newDeckCard,
  startRun,
  upgradableCards,
  upgradeCard,
  type DeckCard,
} from '../src/state/run';

/** The upgrade table from todos/03 — pinned so balance edits stay deliberate. */
const UPGRADE_TABLE: Record<string, { cost?: number; effects?: Effect[] }> = {
  pikan: { effects: [{ kind: 'damage', amount: 9 }] },
  tiebi: { effects: [{ kind: 'block', amount: 8 }] },
  tuodao: {
    effects: [
      { kind: 'damage', amount: 10 },
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'target' },
    ],
  },
  wenjiu: {
    effects: [
      { kind: 'damage', amount: 10 },
      { kind: 'status', status: 'vulnerable', amount: 2, to: 'target' },
    ],
  },
  wanren: { effects: [{ kind: 'damageAll', amount: 12 }] },
  quedi: {
    effects: [
      { kind: 'block', amount: 11 },
      { kind: 'draw', amount: 1 },
    ],
  },
  yiyong: { effects: [{ kind: 'status', status: 'strength', amount: 3, to: 'self' }] },
  baima: { effects: [{ kind: 'damage', amount: 7 }] },
  jieying: { cost: 1 },
  guanzhen: { effects: [{ kind: 'draw', amount: 3 }] },
  xuzhao: {
    effects: [
      { kind: 'status', status: 'weak', amount: 3, to: 'target' },
      { kind: 'block', amount: 6 },
    ],
  },
};

/** Minimal combat state to preview a card face against — no enemies needed. */
function bench(deck: DeckCard[]): CombatState {
  return startCombat({
    encounter: ENCOUNTERS.monster[0],
    deck,
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    seed: 'bench',
  });
}

describe('resolveCard', () => {
  it('covers all 11 cards with the pinned upgrade table', () => {
    expect(Object.keys(CARDS).sort()).toEqual(Object.keys(UPGRADE_TABLE).sort());
    for (const [id, expected] of Object.entries(UPGRADE_TABLE)) {
      const up = resolveCard(id, 1);
      if (expected.effects) expect(up.effects).toEqual(expected.effects);
      expect(up.cost).toBe(expected.cost ?? getCard(id).cost);
    }
  });

  it('marks upgrades with the 「·精」 suffix and leaves the base def alone', () => {
    expect(resolveCard('pikan', 0).name).toBe('劈砍');
    expect(resolveCard('pikan', 1).name).toBe('劈砍' + UPGRADE_SUFFIX);
    expect(getCard('pikan').effects).toEqual([{ kind: 'damage', amount: 6 }]);
    expect(resolveCard('pikan', 1).upgrade).toBeUndefined();
  });

  it('refuses to stack past one upgrade', () => {
    expect(canUpgrade('pikan', 0)).toBe(true);
    expect(canUpgrade('pikan', 1)).toBe(false);
  });
});

describe('upgradeCard', () => {
  it('touches exactly one physical copy', () => {
    const run = startRun(DEFAULT_HERO, 'upgrade-seed');
    const pikans = run.deck.filter((c) => c.defId === 'pikan');
    expect(pikans).toHaveLength(5);

    expect(upgradeCard(run, pikans[2].uid)).toBe(true);

    expect(run.deck.filter((c) => c.defId === 'pikan' && c.upgraded === 1)).toEqual([pikans[2]]);
    for (const other of [pikans[0], pikans[1], pikans[3], pikans[4]]) {
      expect(other.upgraded).toBe(0);
    }
  });

  it('rejects a second upgrade and unknown uids', () => {
    const run = startRun(DEFAULT_HERO, 'upgrade-seed');
    const uid = run.deck[0].uid;
    expect(upgradeCard(run, uid)).toBe(true);
    expect(upgradeCard(run, uid)).toBe(false);
    expect(upgradeCard(run, 'nope')).toBe(false);
  });

  it('drops upgraded copies out of upgradableCards', () => {
    const run = startRun(DEFAULT_HERO, 'upgrade-seed');
    const before = upgradableCards(run).length;
    expect(before).toBe(run.deck.length);
    upgradeCard(run, run.deck[0].uid);
    expect(upgradableCards(run)).toHaveLength(before - 1);
  });

  it('hands out monotonic uids, so a seed replays identically', () => {
    const a = startRun(DEFAULT_HERO, 'same');
    const uidsA = a.deck.map((c) => c.uid);
    const b = startRun(DEFAULT_HERO, 'same');
    expect(b.deck.map((c) => c.uid)).toEqual(uidsA);
    expect(new Set(uidsA).size).toBe(uidsA.length);
  });
});

describe('upgraded card faces', () => {
  it('previews 9 damage, or 12 with 青龙偃月 still available', () => {
    const state = bench([newDeckCard('pikan', 1)]);
    const def = resolveCard('pikan', 1);

    expect(previewValues(state, def).D).toBe(9 + PASSIVE_ATTACK_BONUS);
    state.firstAttackUsed = true;
    expect(previewValues(state, def).D).toBe(9);
  });

  it('deals what the face promised', () => {
    const state = bench([newDeckCard('pikan', 1)]);
    const uid = state.hand[0];
    const enemy = state.enemies[0];
    const promised = previewValues(state, defOf(state, uid), enemy).D;
    const hpBefore = enemy.hp;

    expect(playCard(state, uid, enemy.id)).toBe(true);
    expect(hpBefore - enemy.hp).toBe(promised);
  });

  it('makes 结营·精 playable on 1 气', () => {
    const state = bench([newDeckCard('jieying', 1)]);
    const uid = state.hand[0];
    expect(defOf(state, uid).cost).toBe(1);
    state.energy = 1;
    expect(canPlay(state, uid)).toBe(true);

    playCard(state, uid);
    expect(state.player.block).toBe(14);
  });

  it('keeps unupgraded copies of the same id on their base numbers', () => {
    const state = bench([newDeckCard('pikan', 0), newDeckCard('pikan', 1)]);
    const [plain, forged] = state.hand.map((uid) => defOf(state, uid).effects[0]);
    const amounts = [plain, forged].map((e) => (e.kind === 'damage' ? e.amount : -1)).sort();
    expect(amounts).toEqual([6, 9]);
  });
});

describe('determinism', () => {
  /** Greedy driver: play whatever is affordable, leftmost first, then end turn. */
  function runFight(deck: DeckCard[]): CombatEvent[] {
    const state = bench(deck);
    const log: CombatEvent[] = [];
    let guard = 0;

    while (state.phase !== 'won' && state.phase !== 'lost' && guard++ < 200) {
      const uid = state.hand.find((u) => canPlay(state, u));
      if (uid) {
        const wantsTarget = defOf(state, uid).target === 'enemy';
        const targetId = wantsTarget ? state.enemies.find((e) => e.alive)?.id : undefined;
        playCard(state, uid, targetId);
      } else {
        endPlayerTurn(state);
        runEnemyTurn(state);
      }
      log.push(...state.events.splice(0));
    }
    return log;
  }

  it('replays the same fight from the same seed and the same upgrades', () => {
    const build = (): DeckCard[] => {
      const run = startRun(DEFAULT_HERO, 'replay');
      upgradeCard(run, run.deck.filter((c) => c.defId === 'pikan')[2].uid);
      upgradeCard(run, run.deck.filter((c) => c.defId === 'tiebi')[0].uid);
      return run.deck;
    };
    expect(runFight(build())).toEqual(runFight(build()));
  });

  it('notices when an upgrade changes the fight', () => {
    const plain = startRun(DEFAULT_HERO, 'replay').deck;
    const run = startRun(DEFAULT_HERO, 'replay');
    for (const card of run.deck) upgradeCard(run, card.uid);
    expect(runFight(plain)).not.toEqual(runFight(run.deck));
  });
});
