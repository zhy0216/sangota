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
const RULES_DIRS = [
  'src/combat/',
  'src/core/',
  'src/map/',
  'src/rooms/',
  'src/state/',
  'src/data/',
  'sim/',
];

/**
 * `src/rooms/*View.ts` is the one exception inside a rules directory: a room's
 * controller lives beside the room it draws, deliberately, so the pair reads as
 * one feature. It is presentation, and it is held to the *opposite* set of
 * rules — see 「the room layer keeps its rules and its paint apart」 below.
 */
const isView = (path: string): boolean => /View\.ts$/.test(path);

const ALL_FILES = Object.keys(SOURCES)
  .map((key) => key.replace(/^\.\.\//, ''))
  .sort();

const RULES_FILES = ALL_FILES.filter(
  (path) => RULES_DIRS.some((dir) => path.startsWith(dir)) && !isView(path),
);

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
    expect(RULES_FILES).toContain('src/rooms/commit.ts');
    expect(RULES_FILES.length).toBeGreaterThanOrEqual(20);
  });
});

/**
 * The room layer's dividing line: rooms decide, scenes draw.
 *
 * Both halves live close together — `campfire.ts` beside `campfireView.ts` —
 * which is what makes the rule worth enforcing mechanically rather than by
 * review. A view that reaches for `addGold` has re-implemented a payout outside
 * the one-shot gate, and it will pay out twice the first time a player walks
 * back into the room.
 */
describe('the room layer keeps its rules and its paint apart', () => {
  const PAINT = ALL_FILES.filter(
    (path) => (path.startsWith('src/rooms/') && isView(path)) || path === 'src/scenes/RoomScene.ts',
  );

  it('has views to check at all', () => {
    // The controller registry ships with one entry; 04 / 05 / 06 add theirs.
    expect(PAINT).toContain('src/scenes/RoomScene.ts');
    expect(PAINT).toContain('src/rooms/treasureView.ts');
  });

  it('never writes to the run from the scene layer', () => {
    const WRITES = /\b(addGold|addCard|addCurse|addRelic|addPotion|heal|upgradeCard|removeCard)\s*\(/;
    const offenders = PAINT.filter((path) => WRITES.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('keeps the one-shot gate out of reach of button callbacks', () => {
    const offenders = PAINT.filter((path) => /commit\.once\(/.test(read(path)));
    expect(offenders).toEqual([]);
  });
});

/**
 * Two scene-lifetime guards that cost a run when they break and that no unit
 * test can reach, so they are checked as source text — the same technique the
 * victory screen uses below.
 *
 * The map bug: committing to a node fades for ~780 ms before combat starts, and
 * `refreshAll` has already lit the new node's children. A second click inside
 * that window ran `travelTo` again, skipping a whole room and opening the fight
 * on the next node's seed.
 */
describe('scene exits are one-way', () => {
  it('bars a second node click while the map is leaving', () => {
    const map = read('src/scenes/MapScene.ts');
    const body = map.slice(map.indexOf('private onNodeClick'));
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('if (this.leaving) return');
  });

  it('kills room input the moment the room starts leaving', () => {
    const room = read('src/scenes/RoomScene.ts');
    const body = room.slice(room.indexOf('private leave(): void'));
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('this.input.enabled = false');
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
