import { expect, it } from 'vitest';
import { CARDS, poolFor } from '../src/combat/cards';
import { getEncounter } from '../src/combat/enemies';
import { RELICS } from '../src/combat/relics';
import { HEROES } from '../src/data/heroes';
import { UNLOCK_TRACKS } from '../src/data/unlockTracks';
import { newDeckCard } from '../src/state/run';
import { CARD_AUDIT_CASES, auditRandomKit, pairedResult, sceneKit, type AuditObservation } from './cardAudit';
import { POLICIES } from './policy';
import { simulateCombat } from './runCombat';

const outcome = (won: boolean, hp = 0, aborted: AuditObservation['aborted'] = null): AuditObservation => ({
  won, hp, turns: 3, aborted, seenTurns: 0, playableTurns: 0, plays: 0,
  readyPlays: 0, emptyPlays: 0, unusedEnergy: 0,
});

it('measures matched outcomes and keeps uncertainty when all sampled pairs agree', () => {
  const same = Array.from({ length: 300 }, () => outcome(true, 40));
  const result = pairedResult(same, same);
  expect(result.dWin).toBe(0);
  expect(result.dHp).toBe(0);
  expect(result.ci95![0]).toBeLessThan(0);
  expect(result.ci95![1]).toBeGreaterThan(0);
  const gain = pairedResult([outcome(false), outcome(true, 10)], [outcome(true, 20), outcome(true, 20)]);
  expect(gain.dWin).toBe(0.5);
  expect(gain.dHp).toBe(15);
});

it('invalidates both victory and HP estimates on either kind of protective exit', () => {
  for (const abort of ['noProgress', 'turnLimit'] as const) {
    const good = [outcome(true, 20), outcome(false)];
    const bad = [outcome(true, 30), outcome(false, 10, abort)];
    for (const [base, treatment] of [[good, bad], [bad, good]]) {
      expect(pairedResult(base, treatment)).toMatchObject({
        valid: false, dWin: null, ci95: null, dHp: null, dTurns: null,
      });
    }
  }
  expect(() => pairedResult([], [])).toThrow();
  expect(() => pairedResult([outcome(true)], [])).toThrow();
});

it('reproduces the historical 张宝 timeout and distinguishes its eventual normal loss', () => {
  const hero = HEROES.zhugeliang;
  const seed = 'evalcard-zhugeliang-65';
  const kit = auditRandomKit(seed, hero);
  const opts = {
    ...kit, deck: [...kit.deck, newDeckCard('tuntian'), newDeckCard('tuntian')],
    encounterId: 'b3', hero, hp: hero.maxHp, maxHp: hero.maxHp, seed, policy: POLICIES.greedy,
  };
  expect(simulateCombat(opts)).toMatchObject({ aborted: 'turnLimit', turns: 61 });
  expect(simulateCombat({ ...opts, maxTurns: 180 })).toMatchObject({ aborted: null, won: false, hpLeft: 0 });
});

it('uses attainable deck components and known encounters in every audit fixture', () => {
  for (const item of CARD_AUDIT_CASES) {
    const hero = HEROES[CARDS[item.id].hero!];
    const available = new Set([
      ...hero.startingDeck,
      ...(['common', 'uncommon', 'rare', 'legendary'] as const).flatMap((rarity) => poolFor(hero.id, rarity)),
      ...Object.values(CARDS).filter((card) => card.hero === 'colorless').map((card) => card.id),
    ]);
    for (const scene of item.scenes) {
      const kit = sceneKit(scene, hero, 'audit-fixture-check');
      expect(kit.deck.every((card) => available.has(card.defId)), `${item.id}/${scene.id}`).toBe(true);
      expect(kit.relics.every((id) => RELICS[id])).toBe(true);
      for (const encounter of scene.encounters) expect(getEncounter(encounter)).toBeDefined();
      if (scene.locked) {
        const tracks = UNLOCK_TRACKS.filter((track) => track.heroId === hero.id);
        const locked = new Set(tracks.flatMap((track) => [...(track.cards ?? []), ...(track.cardChoice ?? [])]));
        expect(kit.deck.some((card) => locked.has(card.defId))).toBe(false);
        expect(locked.has(scene.compare ?? item.compare)).toBe(false);
        expect(kit.relics.some((id) => tracks.some((track) => track.relics?.includes(id)))).toBe(false);
      }
    }
  }
});
