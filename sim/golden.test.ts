import { describe, expect, it } from 'vitest';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, startRun, upgradeCard, type DeckCard } from '../src/state/run';
import { POLICIES, type Policy, type PolicyName } from './policy';
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
  /**
   * `forged` upgrades one 劈砍 and one 铁壁, so the upgrade path is covered too.
   * `wide` is the phase-2 deck: 关键词, 生成牌, 条件效果 and two curses.
   */
  deck?: 'base' | 'forged' | 'wide';
  /** Defaults to the hero's starter relic alone. */
  relics?: string[];
  potions?: string[];
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

  /*
   * Cases 21-26 exist because the twenty above play the same ten starter cards
   * they played in phase 1, while phase 2 added 21 rewardable cards, 11 curse
   * and 状态 cards, 21 relics, 16 potions and the whole keyword lifecycle — and
   * added no golden fights. todos/15 and 19 are the next rules refactors queued
   * against this net, so the net has to cover what they will touch: 消耗/虚无,
   * 生成牌, 条件效果, X 费, the curse hooks, hook-driven relics and 丹药.
   */
  { encounterId: 'm2', seed: 'gold-21', policy: 'greedy', deck: 'wide' },
  { encounterId: 'm4', seed: 'gold-22', policy: 'threat', deck: 'wide' },
  { encounterId: 'b1', seed: 'gold-23', policy: 'random', deck: 'wide' },
  {
    encounterId: 'e1',
    seed: 'gold-24',
    policy: 'greedy',
    deck: 'wide',
    relics: ['qinglongdao', 'xiandengdun', 'lianhuanjia', 'xuanwujia', 'xingjuntu'],
  },
  {
    encounterId: 'b1',
    seed: 'gold-25',
    policy: 'threat',
    deck: 'wide',
    relics: ['qinglongdao', 'chitima', 'tiemian', 'xiaoshouling'],
  },
  {
    encounterId: 'e1',
    seed: 'gold-26',
    policy: 'greedy',
    potions: ['huoyouguan', 'zhuangxingjiu', 'hulangzhiyao'],
  },
];

/**
 * One of each shape phase 2 introduced rather than one of everything: 攻/谋/势,
 * a multi-hit, an X-cost, a conditional, a card that mints cards, a 消耗 card,
 * and the three curses that actually own a hook (每张打出牌扣血 / 回合结束加
 * 怯战 / 战斗结束扣钱).
 */
const WIDE_DECK: string[] = [
  'pikan',
  'pikan',
  'tiebi',
  'tiebi',
  'tuodao',
  'wenjiu',
  'quedi',
  'baima',
  'xuzhao',
  'dandaofuhui',
  'wanren',
  'yiyong',
  'hulaoguan',
  'wubaijiaodaoshou',
  'weizhenhuaxia',
  'yixin',
  'fanshi',
  'tannian',
];

function deckFor(kind: Case['deck'], seed: string): DeckCard[] {
  // `startRun` resets the deck-uid counter, which is what makes a replay in the
  // same process produce the same uids — so it runs first even for `wide`.
  const run = startRun(DEFAULT_HERO, seed);
  if (kind === 'wide') {
    // Built by hand rather than through `addCard`, which now — correctly —
    // refuses to let a curse in through the reward door.
    return WIDE_DECK.map((defId) => newDeckCard(defId));
  }
  if (kind === 'forged') {
    upgradeCard(run, run.deck.find((c) => c.defId === 'pikan')!.uid);
    upgradeCard(run, run.deck.find((c) => c.defId === 'tiebi')!.uid);
  }
  return run.deck;
}

/**
 * Drinks the first bottle on the belt as soon as the fight starts. Crude on
 * purpose: what the potion cases are pinning is that a 丹药 resolves through
 * the shared effect queue, not that a policy drinks one well.
 */
const drinkEarly = (name: PolicyName): Policy => ({
  ...POLICIES[name],
  name: `${name}+potions`,
  choosePotion: (state, belt) =>
    state.turn <= belt.length ? { id: belt[0], targetId: state.enemies.find((e) => e.alive)?.id } : null,
});

function play(c: Case): SimResult {
  return simulateCombat({
    encounterId: c.encounterId,
    deck: deckFor(c.deck, c.seed),
    hero: DEFAULT_HERO,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    seed: c.seed,
    relics: c.relics,
    potions: c.potions,
    policy: c.potions ? drinkEarly(c.policy) : POLICIES[c.policy],
  });
}

const serialise = (c: Case, r: SimResult): string =>
  JSON.stringify(
    {
      encounter: c.encounterId,
      seed: c.seed,
      policy: c.policy,
      deck: c.deck ?? 'base',
      // Only when set, so the twenty phase-1 files stay byte-identical.
      ...(c.relics ? { relics: c.relics } : {}),
      ...(c.potions ? { potions: c.potions } : {}),
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
