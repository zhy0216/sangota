import { describe, expect, it } from 'vitest';
import { DEFAULT_HERO } from '../src/data/heroes';
import { startRun, upgradeCard, type DeckCard } from '../src/state/run';
import { POLICIES, type PolicyName } from './policy';
import { simulateCombat, type SimResult } from './runCombat';

/**
 * Golden regression. Twenty fixed fights spread over every encounter table,
 * with the complete `CombatEvent` stream committed byte-for-byte.
 *
 * These freeze the engine as it behaves after the DeckCard/upgrade work
 * (todos/03). The damage-pipeline rewrites in 12 / 13 / 15 must either leave
 * them identical or update them on purpose — a silent numeric drift is exactly
 * what they exist to catch.
 */

interface Case {
  encounterId: string;
  seed: string;
  policy: PolicyName;
  /** `forged` upgrades one 劈砍 and one 铁壁, so the upgrade path is covered too. */
  deck?: 'base' | 'forged';
}

const CASES: Case[] = [
  { encounterId: 'm1', seed: 'gold-01', policy: 'greedy' },
  { encounterId: 'm1', seed: 'gold-02', policy: 'threat' },
  { encounterId: 'm1', seed: 'gold-03', policy: 'random' },
  { encounterId: 'm2', seed: 'gold-04', policy: 'greedy' },
  { encounterId: 'm2', seed: 'gold-05', policy: 'threat' },
  { encounterId: 'm2', seed: 'gold-06', policy: 'random' },
  { encounterId: 'm3', seed: 'gold-07', policy: 'greedy' },
  { encounterId: 'm3', seed: 'gold-08', policy: 'threat' },
  { encounterId: 'm4', seed: 'gold-09', policy: 'greedy' },
  { encounterId: 'm4', seed: 'gold-10', policy: 'threat' },
  { encounterId: 'm4', seed: 'gold-11', policy: 'random' },
  { encounterId: 'e1', seed: 'gold-12', policy: 'greedy' },
  { encounterId: 'e1', seed: 'gold-13', policy: 'threat' },
  { encounterId: 'e1', seed: 'gold-14', policy: 'random' },
  { encounterId: 'b1', seed: 'gold-15', policy: 'greedy' },
  { encounterId: 'b1', seed: 'gold-16', policy: 'threat' },
  { encounterId: 'b1', seed: 'gold-17', policy: 'random' },
  { encounterId: 'm2', seed: 'gold-18', policy: 'greedy', deck: 'forged' },
  { encounterId: 'e1', seed: 'gold-19', policy: 'threat', deck: 'forged' },
  { encounterId: 'b1', seed: 'gold-20', policy: 'threat', deck: 'forged' },
];

function deckFor(kind: Case['deck'], seed: string): DeckCard[] {
  const run = startRun(DEFAULT_HERO, seed);
  if (kind === 'forged') {
    upgradeCard(run, run.deck.find((c) => c.defId === 'pikan')!.uid);
    upgradeCard(run, run.deck.find((c) => c.defId === 'tiebi')!.uid);
  }
  return run.deck;
}

function play(c: Case): SimResult {
  return simulateCombat({
    encounterId: c.encounterId,
    deck: deckFor(c.deck, c.seed),
    hero: DEFAULT_HERO,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    seed: c.seed,
    policy: POLICIES[c.policy],
  });
}

const serialise = (c: Case, r: SimResult): string =>
  JSON.stringify(
    {
      encounter: c.encounterId,
      seed: c.seed,
      policy: c.policy,
      deck: c.deck ?? 'base',
      result: { won: r.won, turns: r.turns, hpLeft: r.hpLeft, hpMax: r.hpMax, aborted: r.aborted },
      events: r.events,
    },
    null,
    2,
  ) + '\n';

describe('golden combats', () => {
  for (const c of CASES) {
    it(`${c.encounterId} · ${c.seed} · ${c.policy}`, async () => {
      const result = play(c);
      expect(result.aborted).toBeNull();
      expect(result.events.length).toBeGreaterThan(0);
      await expect(serialise(c, result)).toMatchFileSnapshot(
        `./__snapshots__/combat-${c.encounterId}-${c.seed}-${c.policy}.json`,
      );
    });
  }

  it('replays every case identically within one process', () => {
    for (const c of CASES) {
      expect(serialise(c, play(c)), c.seed).toBe(serialise(c, play(c)));
    }
  });
});
