import { describe, expect, it } from 'vitest';
import { CARDS, resolveCard } from '../src/combat/cards';
import { isNegative } from '../src/combat/curses';
import { intentLabel } from '../src/combat/intent';
import { getEncounter } from '../src/combat/enemies';
import {
  describeCard,
  playCard,
  previewValues,
  startCombat,
} from '../src/combat/engine';
import type { CardDef, CombatState, Effect, StatusId } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard } from '../src/state/run';

/**
 * A card face that lies about its damage is the worst bug this genre has, so
 * every card is played for real and the number the face promised is compared
 * with the HP that actually came off.
 */

/** Two enemies, so `damageAll` can be checked per target. */
const TWO_UP = getEncounter('m3');

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
  // Nor is lethality: an enemy that dies partway through a multi-hit card would
  // absorb less than the face promised for a reason the face is right about.
  for (const enemy of state.enemies) {
    enemy.hp = 99999;
    enemy.maxHp = 99999;
  }
  Object.assign(state.player.statuses, loadout.player);
  // Uneven Vulnerable across the two enemies catches a preview that ignores the
  // defender, which a single-target-only check would miss.
  if (loadout.vulnerable > 0) state.enemies[0].statuses.vulnerable = loadout.vulnerable;
  return state;
}

/**
 * Damage can sit under a `conditional` branch or inside `scaleWithEnergy`, so
 * both predicates walk the tree. Reading only the top level used to make every
 * nested-damage card look like it dealt none, which is a test that passes by
 * checking nothing.
 */
function walkEffects(effects: readonly Effect[], seen: Effect[] = []): Effect[] {
  for (const effect of effects) {
    seen.push(effect);
    if (effect.kind === 'conditional') {
      walkEffects(effect.then, seen);
      walkEffects(effect.otherwise ?? [], seen);
    } else if (effect.kind === 'scaleWithEnergy') {
      walkEffects(effect.per, seen);
    }
  }
  return seen;
}

const damageEffects = (def: CardDef): number =>
  walkEffects(def.effects).filter((e) => e.kind === 'damage' || e.kind === 'damageAll').length;

const hitsEveryone = (def: CardDef): boolean =>
  walkEffects(def.effects).some((e) => e.kind === 'damageAll');

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

            // `D` is one hit and `T` is how many land, so the total a card
            // promises is the product — 水淹七军 prints 5 and deals 10.
            const promised = state.enemies.map((e) => {
              const { D, T } = previewValues(state, def, e);
              return D * T;
            });
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
   * A card is spliced out of the hand before its effects resolve, so 单刀赴会's
   * 「若手牌已空」 is really "if this was your last card". The preview has to
   * model the same thing or the face under-reports by half its damage on
   * exactly the turn the card is meant to shine.
   */
  it('reads 手牌已空 as the hand this card is about to leave', () => {
    const alone = bench('dandaofuhui', 0, LOADOUTS[0]);
    alone.attacksThisTurn = 1; // passive spent, so the numbers are the printed ones
    const def = resolveCard('dandaofuhui', 0);
    expect(alone.hand.length).toBe(1);
    expect(previewValues(alone, def, alone.enemies[0]).D).toBe(12);

    // With a second card in hand the payoff branch is correctly not promised.
    const crowded = bench('dandaofuhui', 0, LOADOUTS[0]);
    crowded.attacksThisTurn = 1;
    crowded.hand.push(crowded.drawPile[0] ?? crowded.hand[0]);
    expect(previewValues(crowded, def, crowded.enemies[0]).D).toBe(6);
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

  /**
   * 金蝉脱壳 sits in the `clamp` slot, which `computeAttack` deliberately skips
   * — the clamp belongs to `resolveDamage`, ahead of block. The preview has to
   * apply it separately or the face reads 攻 12 against a target that will take
   * exactly 1.
   */
  it('folds 金蝉脱壳 into the number, on both sides of the swing', () => {
    const state = bench('pikan', 0, LOADOUTS[0]);
    state.attacksThisTurn = 1;
    const def = resolveCard('pikan', 0);
    const target = state.enemies[0];

    expect(previewValues(state, def, target).D).toBe(6);
    target.statuses.intangible = 1;
    expect(previewValues(state, def, target).D).toBe(1);
    expect(describeCard(state, def, target)).toContain('1');

    // And the marker over an enemy telegraphing at an intangible player.
    const marked = bench('pikan', 0, LOADOUTS[0]);
    const enemy = marked.enemies[0];
    enemy.intent = { id: 'axe', label: '巨斧', damage: 30, weight: 1 };
    expect(intentLabel(marked, enemy)).toBe('攻 30');
    marked.player.statuses.intangible = 2;
    expect(intentLabel(marked, enemy)).toBe('攻 1');
  });

  /**
   * `scaleWithEnergy` resolves its body once per 气 spent. The damage arm has
   * always carried the multiplier through; block did not, so a 势 card whose
   * `per` held block would promise a third of what it granted.
   */
  it('multiplies block by the repeat count under 虎牢关-style scaling', () => {
    const SCALED: CardDef = {
      id: 'c-scaled-block',
      name: '测试',
      type: 'skill',
      rarity: 'common',
      cost: 3,
      target: 'self',
      art: 'card-tiebi',
      text: '获得 {B} 点护甲。',
      effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'block', amount: 4 }] }],
    };
    const state = bench('tiebi', 0, LOADOUTS[0]);

    expect(previewValues(state, SCALED).B).toBe(12);
    state.player.statuses.dexterity = 2;
    // 身法 lands per instance, exactly as it will when the effects resolve.
    expect(previewValues(state, SCALED).B).toBe(18);
  });
});
