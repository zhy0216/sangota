import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { DEFAULT_HERO } from '../src/data/heroes';
import { ACT1_LAYOUT, generateMap } from '../src/map/generateMap';
import type { GameMap } from '../src/map/types';
import { startRun } from '../src/state/run';

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

/**
 * Everything that decides an outcome, *including* the scenes. `RULES_FILES`
 * cannot simply grow to cover them — `src/ui/vfx.ts` and the combat backdrop
 * roll cosmetic dice on purpose — but the other three entropy sources 约定 2
 * bans are banned everywhere, cosmetic or not: a tween seeded off the clock is
 * still a run that does not replay.
 */
const ALL_SOURCE = ALL_FILES.filter((path) => path.startsWith('src/') || path.startsWith('sim/'));

describe('determinism', () => {
  it('routes every roll in the rules layer through Rng', () => {
    const offenders = RULES_FILES.filter((path) => read(path).includes('Math.random'));
    expect(offenders).toEqual([]);
  });

  it('keeps the clock out of every file, rules layer or not', () => {
    // 约定 2 names three entropy sources beside `Math.random` and this test
    // used to check none of them: `Date.now() % 3` inside `engine.ts` passed
    // the whole suite green while breaking seed replay outright.
    const CLOCK = /\bDate\.now\s*\(|\bnew Date\s*\(|\bperformance\.now\s*\(/;
    const offenders = ALL_SOURCE.filter((path) => CLOCK.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('allows exactly one source of real entropy, and only to seed a run', () => {
    // `randomSeed()` is the single point where a run is allowed to be
    // unpredictable. Anywhere else, `crypto.getRandomValues` is a roll that no
    // seed can reproduce.
    const offenders = ALL_SOURCE.filter(
      (path) => read(path).includes('getRandomValues') && path !== 'src/core/rng.ts',
    );
    expect(offenders).toEqual([]);
    expect(read('src/core/rng.ts')).toContain('getRandomValues');
  });

  it('addresses every run stream in the scene layer through streamSeed', () => {
    // The victory screen used to spell its own seeds out — `${this.run.map.
    // seed}:${this.run.currentNodeId}:reward` — beside a `streamSeed` that
    // built the same string a different way, and with a different answer when
    // `currentNodeId` was null. One of the two would eventually move without
    // the other, and nothing would have said so.
    //
    // Splicing the run's seed into a `seed:node:purpose` string is the tell.
    // Printing the seed on the HUD is not, and `new Rng('blob:...')` off a node
    // id is procedural art — reproducible for its own reasons, not a run
    // decision — so both stay allowed.
    const scenes = ALL_FILES.filter((path) => path.startsWith('src/scenes/'));
    const offenders = scenes.filter((path) => /map\.seed\}\s*:/.test(read(path)));
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

  it('keeps every die out of startRun', () => {
    // The命门 of all 37 golden snapshots: `sim/golden.test.ts` builds its decks
    // through `startRun`, and the fights are seeded from streams derived after
    // it. One extra draw in here shifts every one of them at once, and every
    // saved run seed with them.
    //
    // A comment inside the function was the only thing guarding this. It is
    // load-bearing enough to be checked as source text: 17 gives heroes their
    // own decks and 18 hangs a whole screen off the run's opening state, and
    // both are one「roll a starting relic」away from silently doing it here.
    const source = read('src/state/run.ts');
    const at = source.indexOf('export function startRun');
    expect(at).toBeGreaterThan(-1);
    // Comments stripped: the note *explaining* the rule says 「one extra roll」.
    const body = source.slice(at, source.indexOf('\n}', at)).replace(/\/\/.*$/gm, '');
    for (const forbidden of ['Rng', 'stream(', 'roll', 'randomSeed(']) {
      expect(body, `startRun must not ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('spends the seed on the map and on nothing else — measured, not spelled', () => {
    // The check above is a substring scan of one function body, so a single
    // helper call (`blessing: openingBlessing()`, rolling in another file)
    // contains none of the four banned strings and walks straight through it.
    // This is the same rule measured behaviourally, which no indirection hides.
    //
    // Two halves. First: everything except the map must be *identical* for
    // every seed — a die rolled anywhere inside `startRun`, however it is
    // spelled or wherever it lives, has to show up as a difference here,
    // because the seed is the only input.
    const seeds = ['aaa', 'bbb', '', 'zz', '999', 'seed:act2'];
    const withoutMap = (seed: string): string => {
      const { map: _map, ...rest } = startRun(DEFAULT_HERO, seed);
      return JSON.stringify(rest);
    };
    const first = withoutMap(seeds[0]);
    for (const seed of seeds.slice(1)) {
      expect(withoutMap(seed), `startRun varied with seed ${JSON.stringify(seed)}`).toBe(first);
    }

    // Second: the map it built is *exactly* the map `generateMap` builds from
    // the bare seed. Anything drawn before the map would offset its stream and
    // move every node; anything drawn after would not show up above only if it
    // were discarded, and a discarded draw is still a draw that moves 第一幕.
    const shape = (m: GameMap): string =>
      [...m.nodes.values()]
        .map((n) => `${n.id}:${n.type}:${n.x.toFixed(4)}:${n.y.toFixed(4)}`)
        .join('|');
    for (const seed of seeds) {
      expect(shape(startRun(DEFAULT_HERO, seed).map), seed).toBe(
        shape(generateMap(seed, ACT1_LAYOUT)),
      );
    }
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

  it('settles a debt the ledger is still carrying before it says 「已了」', () => {
    // `pendingPick` exists so that a deck pick already paid for — 卧龙岗's 12
    // 体力, 五丈原's whole purse — survives the room being rebuilt. `enter()`
    // asked `isResolved` and nothing else, so re-entering a node in that state
    // drew 「此地之事，已了。」 and pocketed what the player had bought.
    const view = read('src/rooms/eventView.ts');
    const body = view.slice(view.indexOf('enter(host: RoomHost)'));
    const guard = body.slice(0, body.indexOf('setEscPolicy'));
    expect(guard).toContain('pendingPick(host.run, host.node.id)');
    expect(guard.indexOf('pendingPick')).toBeLessThan(guard.indexOf('此地之事，已了。'));
  });

  it('leaves the room layer to decide what a result line says', () => {
    // The 营帐 result line 「伤已痊愈」 compared `report.healed` against a number
    // the view recomputed as `restGain(run)` — which is already capped by the
    // wound, so the comparison was `x < x`. The view now reads `report.offered`
    // and the pure layer owns both halves.
    const view = read('src/rooms/campfireView.ts');
    expect(view).toContain('report.healed < report.offered');
    expect(view).not.toMatch(/restGain\(/);
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

  it('bars a second 出征 while the title is fading out', () => {
    // `inkButton` binds `pointerdown` and Enter auto-repeats, and the fade runs
    // 420 ms with both live. Every extra call was another `startRun()`, i.e. a
    // whole new map generated under a player who had already committed.
    const title = read('src/scenes/TitleScene.ts');
    const body = title.slice(title.indexOf('private beginRun(): void'));
    const head = body.slice(0, body.indexOf('startRun('));
    expect(head).toContain('if (this.leaving) return');
    expect(head).toContain('this.leaving = true');
  });
});

/**
 * Phaser keeps **one instance per scene key** for the life of the game:
 * `SceneManager.start` calls `sys.shutdown()` and then `sys.start(data)` on the
 * same object, and never `new`s another. A class-field initialiser therefore
 * runs exactly once — on the first visit — and `init()` is the only per-visit
 * hook there is.
 *
 * Both bugs this guards cost a whole run and neither could be reached by a unit
 * test, because loading `CombatScene` under Node means loading Phaser.
 */
describe('scene state does not survive into the next visit', () => {
  const scene = read('src/scenes/CombatScene.ts');
  const initBody = ((): string => {
    const at = scene.indexOf('  init(data:');
    return scene.slice(at, scene.indexOf('\n  }', at));
  })();

  it('clears the reward gate, so the second fight can still be paid out', () => {
    // Left behind, `claimed` stayed true from the first fight on: the victory
    // overlay came up, every reward card was dead, and the run was unplayable
    // from fight two onwards.
    expect(initBody).toContain('this.claimed = false');
  });

  it('drops the tooltip handles, which point at destroyed Game Objects', () => {
    // `DisplayList.shutdown` destroys every object in the list, and `Text`'s
    // own `preDestroy` nulls its frame source. Hovering a status chip in the
    // second fight then called `setText` straight through to a null texture.
    expect(initBody).toContain('this.statusTip = null');
    expect(initBody).toContain('this.statusTipBg = null');
    expect(initBody).toContain('this.statusTipText = null');
  });

  it('takes the 奇遇 relic off the scene data it was started with', () => {
    // `RoomScene.goCombat` has always passed `bonusRelic` through; the fight
    // read `nodeType` out of the same object and dropped the rest on the floor.
    expect(initBody).toContain('this.bonusRelic = data?.bonusRelic ?? null');
  });

  it('never stacks a second WAKE listener on the map', () => {
    // `Systems.shutdown` clears the four TRANSITION_* events and nothing else,
    // so the handler from the previous `create()` is still attached. Nine
    // fights meant nine `resume()` passes over ~120 nodes on every room exit.
    const map = read('src/scenes/MapScene.ts');
    expect(map).toMatch(
      /this\.events\.off\(Phaser\.Scenes\.Events\.WAKE\);\s*\n\s*this\.events\.on\(Phaser\.Scenes\.Events\.WAKE/,
    );
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
      scene.indexOf('private buildRelicDrop'),
    );

    expect(body).toContain('takeCardReward(this.run, this.nodeId, cardId)');
    expect(body).toContain('takeCardReward(this.run, this.nodeId, null)');
    // Both payouts, and no other way out of the overlay.
    expect(body.match(/this\.claimReward\(/g)).toHaveLength(2);
    expect(body).not.toMatch(/this\.leaveToMap\(\)/);
  });
});

/**
 * The victory screen is the one place in the scene layer that pays a run out,
 * and `RULES_DIRS` above does not cover `src/scenes/`. It cannot: `vfx.ts` and
 * the combat backdrop roll cosmetic dice on purpose, and banning `Math.random`
 * there outright would ban a breathing animation.
 *
 * So the rule enforced here is the *architectural* one, which is stronger
 * anyway: 战利品 does not roll at all. Every number on that screen is decided by
 * `src/rooms/fight.ts`, inside `commit.once`, and written into
 * `run.rooms[nodeId]` — so a re-entry reads it back instead of re-rolling it
 * (R5), and any die added to it lands in a directory the scans above *do* cover.
 */
describe('the victory screen decides nothing on its own', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('rolls no reward dice in the scene', () => {
    // `showSpoils` used to open a `reward` stream, roll the gold, call
    // `rollCardReward` (which moves `run.rareBump`) and roll the 丹药 drop
    // (which moves `run.potionChance`) — none of it gated and none of it
    // materialised. `claimVictoryRelic` two lines below it *was* gated, which
    // is what makes the omission an oversight rather than a decision.
    for (const roll of ['rollCardReward', 'rollPotion', 'rollRelic', 'rollBossOffer']) {
      expect(scene.includes(`${roll}(`), `${roll} belongs to the room layer`).toBe(false);
    }
    // The scene still names its own fight's seed — that is the shuffle — but it
    // must not open a reward or 丹药 stream.
    for (const purpose of ['reward', 'potion', 'eliteRelic', 'bossRelic']) {
      expect(scene).not.toContain(`stream(this.run, this.nodeId, '${purpose}')`);
    }
  });

  it('banks nothing into the run by hand', () => {
    // The rule `src/rooms/*View.ts` and `RoomScene` are already held to,
    // extended to the one scene that was exempt. `removePotion` stays allowed:
    // drinking or discarding mid-fight is a player action on a resource already
    // held, not a payout, and a re-entered fight replays from the top anyway.
    const BANNED = /\b(addGold|addCard|addCurse|addRelic|addPotion|upgradeCard)\s*\(/;
    expect(BANNED.test(scene), 'CombatScene must pay out through src/rooms/fight.ts').toBe(false);
    // 歌钵's 体力上限 was the last one written inline.
    expect(scene).not.toContain('this.run.maxHp +=');
  });
});
