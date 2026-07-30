import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';

/**
 * Guards on the two properties the whole test net rests on: the rules layer is
 * deterministic, and it is headless. Both are easy to break by accident and
 * neither shows up as a failing behaviour test.
 *
 * Sources are pulled through Vite's own glob rather than `fs`, so the suite
 * needs no Node typings and `src` stays checked against browser globals only.
 */

const SOURCES: Record<string, string> = {
  ...import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../sim/**/*.ts', { query: '?raw', import: 'default', eager: true }),
};

/** Everything that decides an outcome. UI and VFX may roll cosmetic dice. */
const RULES_DIRS = ['src/combat/', 'src/core/', 'src/map/', 'src/state/', 'src/data/', 'sim/'];

const RULES_FILES = Object.keys(SOURCES)
  .map((key) => key.replace(/^\.\.\//, ''))
  .filter((path) => RULES_DIRS.some((dir) => path.startsWith(dir)))
  .sort();

const read = (path: string): string => SOURCES[`../${path}`];

describe('determinism', () => {
  it('routes every roll in the rules layer through Rng', () => {
    const offenders = RULES_FILES.filter((path) => read(path).includes('Math.random'));
    expect(offenders).toEqual([]);
  });

  it('replays a stream from a seed and from a saved cursor', () => {
    const a = new Rng('same-seed');
    const b = new Rng('same-seed');
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );

    const cursor = a.getState();
    const ahead = Array.from({ length: 10 }, () => a.next());
    const resumed = new Rng(0);
    resumed.fromState(cursor);
    expect(Array.from({ length: 10 }, () => resumed.next())).toEqual(ahead);
  });

  it('gives different seeds different streams', () => {
    expect(new Rng('a').next()).not.toBe(new Rng('b').next());
  });
});

describe('headlessness', () => {
  it('keeps Phaser out of the rules layer', () => {
    const offenders = RULES_FILES.filter((path) => /from '.*phaser'/i.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('covers the rules layer with the audit', () => {
    // A moved or renamed file must not silently drop out of the checks above.
    expect(RULES_FILES).toContain('src/combat/engine.ts');
    expect(RULES_FILES).toContain('sim/policy.ts');
    expect(RULES_FILES.length).toBeGreaterThanOrEqual(11);
  });
});

/**
 * `CombatScene` cannot be loaded under Node — it imports Phaser — so the one
 * property of it that costs a run if it breaks is checked as source text, the
 * same way `cardGrid.test.ts` checks the deck viewer's re-export.
 *
 * The bug: leaving the victory screen only starts a 300 ms camera fade, and the
 * reward row stays live and interactive for every frame of it. `inkButton` and
 * `hitZone` both bind `on`, not `once`. Clicking two cards banked two cards;
 * clicking a card and then 「不取」 banked the card and the 歌钵 max-HP payout.
 */
describe('the victory screen pays out once', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('guards the claim itself', () => {
    expect(scene).toMatch(
      /private claimReward\(take: \(\) => void\): void \{\s*if \(this\.claimed\) return;\s*this\.claimed = true;/,
    );
  });

  it('leaves the screen only by claiming, so a payout cannot be taken twice', () => {
    const body = scene.slice(
      scene.indexOf('private showVictory'),
      scene.indexOf('private rollPotionDrop'),
    );

    expect(body).toContain('addCard(this.run, cardId)');
    expect(body).toContain('this.run.maxHp += skipHp');
    // Both payouts, and no other way out of the overlay.
    expect(body.match(/this\.claimReward\(/g)).toHaveLength(2);
    expect(body).not.toMatch(/this\.leaveToMap\(\)/);
  });
});
