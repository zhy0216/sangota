import { describe, expect, it } from 'vitest';
import { CARDS, resolveCard } from '../src/combat/cards';
import { isNegative } from '../src/combat/curses';
import { ENCOUNTERS } from '../src/combat/enemies';
import { describeCard, playCard, previewValues, startCombat } from '../src/combat/engine';
import type { CardDef, CombatState, StatusId } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard } from '../src/state/run';

/**
 * A card face that lies about its damage is the worst bug this genre has, so
 * every card is played for real and the number the face promised is compared
 * with the HP that actually came off.
 */

/** Two enemies, so `damageAll` can be checked per target. */
const TWO_UP = ENCOUNTERS.monster[1];

/**
 * Curses and status cards are in `CARDS` but print no numbers and mostly cannot
 * be played at all, so the promise this suite checks does not apply to them.
 * `tests/curses.test.ts` covers what they do instead.
 */
const HERO_CARDS = Object.keys(CARDS).filter((id) => !isNegative(CARDS[id]));

const LOADOUTS: { name: string; player: Partial<Record<StatusId, number>>; vulnerable: number }[] = [
  { name: 'clean', player: {}, vulnerable: 0 },
  { name: 'vulnerable', player: {}, vulnerable: 2 },
  { name: 'weak', player: { weak: 2 }, vulnerable: 0 },
  { name: 'strength', player: { strength: 3 }, vulnerable: 0 },
  { name: 'all three', player: { weak: 2, strength: 3 }, vulnerable: 2 },
];

function bench(defId: string, upgraded: number, loadout: (typeof LOADOUTS)[number]): CombatState {
  const state = startCombat({
    encounter: TWO_UP,
    // A one-card deck keeps the hand unambiguous; draw effects find empty piles.
    deck: [newDeckCard(defId, upgraded)],
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed: `face-${defId}-${upgraded}-${loadout.name}`,
  });
  // 气 is not what is under test here.
  state.energy = 99;
  Object.assign(state.player.statuses, loadout.player);
  // Uneven Vulnerable across the two enemies catches a preview that ignores the
  // defender, which a single-target-only check would miss.
  if (loadout.vulnerable > 0) state.enemies[0].statuses.vulnerable = loadout.vulnerable;
  return state;
}

const damageEffects = (def: CardDef): number =>
  def.effects.filter((e) => e.kind === 'damage' || e.kind === 'damageAll').length;

const hitsEveryone = (def: CardDef): boolean => def.effects.some((e) => e.kind === 'damageAll');

describe('previewValues matches what resolves', () => {
  for (const defId of HERO_CARDS) {
    for (const upgraded of [0, 1]) {
      for (const loadout of LOADOUTS) {
        for (const passiveSpent of [false, true]) {
          const label = `${defId}${upgraded ? '·精' : ''} · ${loadout.name}${
            passiveSpent ? ' · passive spent' : ''
          }`;

          it(label, () => {
            const state = bench(defId, upgraded, loadout);
            // Spending the passive is now "an attack already went out this turn".
            state.attacksThisTurn = passiveSpent ? 1 : 0;

            const def = resolveCard(defId, upgraded);
            const uid = state.hand[0];
            const target = state.enemies[0];

            const promised = state.enemies.map((e) => previewValues(state, def, e).D);
            const promisedBlock = previewValues(state, def).B;

            const hpBefore = state.enemies.map((e) => e.hp);
            const blockBefore = state.player.block;

            expect(playCard(state, uid, target.id)).toBe(true);

            const dealt = state.enemies.map((e, i) => hpBefore[i] - e.hp);
            expect(state.player.block - blockBefore).toBe(promisedBlock);

            if (damageEffects(def) === 0) {
              expect(dealt).toEqual([0, 0]);
            } else if (hitsEveryone(def)) {
              expect(dealt).toEqual(promised);
            } else {
              expect(dealt[0]).toBe(promised[0]);
              expect(dealt[1]).toBe(0);
            }
          });
        }
      }
    }
  }
});

describe('describeCard', () => {
  it('leaves no placeholder unfilled on any card', () => {
    for (const defId of HERO_CARDS) {
      for (const upgraded of [0, 1]) {
        const state = bench(defId, upgraded, LOADOUTS[0]);
        const text = describeCard(state, resolveCard(defId, upgraded), state.enemies[0]);
        expect(text, defId).not.toMatch(/\{[DB]\}/);
      }
    }
  });

  it('prints the same numbers previewValues computed', () => {
    for (const defId of HERO_CARDS) {
      for (const loadout of LOADOUTS) {
        const state = bench(defId, 0, loadout);
        const def = resolveCard(defId, 0);
        const target = state.enemies[0];
        const { D, B } = previewValues(state, def, target);
        const text = describeCard(state, def, target);

        if (damageEffects(def) > 0) expect(text, defId).toContain(String(D));
        if (def.effects.some((e) => e.kind === 'block')) expect(text, defId).toContain(String(B));
      }
    }
  });

  /**
   * Known gap, pinned so it cannot drift silently: `CardView.refresh` calls
   * `describeCard(state, def)` with no target, so the face folds in Strength,
   * Weak and the passive but not the defender's Vulnerable. Against a
   * Vulnerable enemy the printed number is lower than what lands. Fixing it
   * means plumbing the hovered/selected target into CardView.
   */
  it('under-reports against a Vulnerable target because the UI passes no target', () => {
    const state = bench('pikan', 0, LOADOUTS[1]);
    const def = resolveCard('pikan', 0);

    expect(previewValues(state, def).D).toBe(9);
    expect(previewValues(state, def, state.enemies[0]).D).toBe(13);
  });
});
