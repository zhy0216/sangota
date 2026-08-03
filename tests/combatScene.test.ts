import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phaser never loads here. `EnemyRoster` reaches for exactly one thing out of
 * it — `Phaser.Math.Clamp` — and standing that up costs less than a DOM.
 */
vi.mock('phaser', () => ({
  default: {
    Math: { Clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)) },
  },
}));

import { allEncounters, getEncounter } from '../src/combat/enemies';
import { endPlayerTurn, resolveDamage, runEnemyTurn, startCombat } from '../src/combat/engine';
import type { CombatEvent, CombatState, EnemyState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { payTheft } from '../src/rooms/fight';
import { newDeckCard, startRun, type DeckCard } from '../src/state/run';
import { crowdScale, EnemyRoster, slotXs } from '../src/ui/EnemyRoster';
import { stageChange } from '../src/ui/enemyStage';
import type { EnemyViewParts } from '../src/ui/actorView';

/**
 * 战斗场景 — the half of todos/15 that lives on screen.
 *
 * `CombatScene` itself cannot be imported under Node, so this file comes at it
 * from three sides:
 *
 * 1. `EnemyRoster` driven for real against a stub scene — where a body stands,
 *    how big it is drawn, and whether every Game Object it owned is actually
 *    gone once it leaves.
 * 2. The engine's own `summon` / `split` / `escape` events, replayed through
 *    `stageChange` exactly the way the scene replays them, asserting that the
 *    set of bodies on screen ends up equal to the set of bodies in the fight.
 *    That equality *is* the bug that fenced five encounters off the map: a
 *    summon nobody could see, a split parent that never left, a runaway frozen
 *    mid-stride.
 * 3. Source text, for the wiring no unit test can reach — the same technique
 *    `tests/integrity.test.ts` uses on the victory screen.
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

// ------------------------------------------------------- a scene made of nothing

interface Recorded {
  x: number;
  y: number;
  alpha: number;
  scale: number;
  width: number;
  height: number;
  destroyed: boolean;
  interactive: boolean;
}

function obj(x = 0, y = 0): Recorded & Record<string, unknown> {
  const o = {
    x,
    y,
    alpha: 1,
    scale: 1,
    width: 0,
    height: 0,
    destroyed: false,
    interactive: true,
    destroy() {
      o.destroyed = true;
    },
    setScale(s: number) {
      o.scale = s;
      return o;
    },
    setSize(w: number, h: number) {
      o.width = w;
      o.height = h;
      return o;
    },
    setPosition(px: number, py: number) {
      o.x = px;
      o.y = py;
      return o;
    },
    setVisible() {
      return o;
    },
    disableInteractive() {
      o.interactive = false;
      return o;
    },
    on() {
      return o;
    },
  };
  return o;
}

/**
 * Tweens resolve instantly and write their end values straight onto the target,
 * so `layout()` settles inside one `await` and the numbers under test are the
 * numbers a body would come to rest at.
 */
function stubScene(): unknown {
  return {
    tweens: {
      add(cfg: Record<string, unknown>) {
        const targets = Array.isArray(cfg.targets) ? cfg.targets : [cfg.targets];
        for (const target of targets as Record<string, unknown>[]) {
          for (const key of ['x', 'y', 'alpha', 'scale', 'scaleX']) {
            if (key in cfg) target[key] = cfg[key];
          }
        }
        (cfg.onComplete as (() => void) | undefined)?.();
        return {};
      },
      killTweensOf() {},
    },
  };
}

const HEIGHT = 200;
const HIT_WIDTH = 140;

function rosterOf(): { roster: EnemyRoster; parts: Map<string, Record<string, Recorded>> } {
  const parts = new Map<string, Record<string, Recorded>>();

  const roster = new EnemyRoster(stubScene() as never, {
    baselineY: 420,
    depth: { actors: 10, actorUi: 20 },
    build: (enemy: EnemyState, x: number): EnemyViewParts => {
      const built = {
        container: obj(x, 420),
        sprite: obj(),
        ui: obj(x, 420),
        bar: obj(),
        hpText: obj(),
        blockBadge: obj(),
        blockText: obj(),
        statusRow: obj(),
        intent: obj(x, 0),
        intentBg: obj(),
        intentIcon: obj(),
        intentText: obj(),
        intentMarks: obj(),
        intentHit: obj(),
        nameText: obj(x, 486),
        hit: obj(x, 420 - HEIGHT / 2),
      };
      parts.set(enemy.id, built as unknown as Record<string, Recorded>);
      return {
        ...built,
        enemy,
        height: HEIGHT,
        barWidth: 140,
        baseX: x,
        spriteBaseX: 0,
        baseScaleY: 1,
        ghost: { value: enemy.hp },
        hitWidth: HIT_WIDTH,
        intentKey: '',
      } as unknown as EnemyViewParts;
    },
  });

  return { roster, parts };
}

const body = (hp: number, id: string, slot: number): EnemyState =>
  ({
    id,
    defId: 'stub',
    name: id,
    art: 'stub',
    height: HEIGHT,
    hp,
    maxHp: hp,
    block: 0,
    statuses: {},
    intent: null,
    repeat: 0,
    alive: true,
    slot,
    actedTurns: 0,
    phase: null,
    crossed: [],
    escaped: false,
  }) as EnemyState;

// ------------------------------------------------------------------ 站位

describe('where bodies stand', () => {
  it('freezes the one, two and three-body columns', () => {
    expect(slotXs(1)).toEqual([872]);
    expect(slotXs(2)).toEqual([782, 1000]);
    expect(slotXs(3)).toEqual([712, 880, 1048]);
  });

  it('spreads a crowd about the middle column at a capped gap', () => {
    // Four bodies: 460 / 3 = 153.33 apart, centred on 880.
    const four = slotXs(4);
    expect(four).toHaveLength(4);
    expect(four[0]).toBeCloseTo(650, 5);
    expect(four[3]).toBeCloseTo(1110, 5);
    for (let i = 1; i < four.length; i++) expect(four[i] - four[i - 1]).toBeCloseTo(153.333, 2);
    // Centre of the line is still the middle column.
    expect((four[0] + four[3]) / 2).toBeCloseTo(880, 5);
  });

  it('never opens the gap past a body width', () => {
    // Five would want 115 and four wants 153; neither may exceed the 168 cap,
    // which only a very short line could ask for.
    const five = slotXs(5);
    expect(five[1] - five[0]).toBeLessThanOrEqual(168);
    expect(five[1] - five[0]).toBeCloseTo(115, 5);
  });

  it('shrinks a crowd, but never below legibility', () => {
    expect(crowdScale(1)).toBe(1);
    expect(crowdScale(3)).toBe(1);
    expect(crowdScale(4)).toBeCloseTo(0.94, 5);
    expect(crowdScale(6)).toBeCloseTo(0.82, 5);
    expect(crowdScale(20)).toBe(0.78);
  });
});

// ------------------------------------------------------------------ 增删

describe('EnemyRoster', () => {
  it('walks a mid-fight arrival from where it appeared to its slot', async () => {
    const { roster } = rosterOf();
    const a = roster.add(body(30, 'a', 0));
    await roster.layout(false);
    expect(a.baseX).toBe(872);

    // A summon appears at its summoner's feet, then the line opens up.
    const b = roster.add(body(20, 'b', 1), 872);
    expect(b.baseX).toBe(872);
    await roster.layout(true);
    expect(a.baseX).toBe(782);
    expect(b.baseX).toBe(1000);
  });

  it('takes the hit zone with the body, at the right size', async () => {
    const { roster, parts } = rosterOf();
    roster.add(body(30, 'a', 0));
    roster.add(body(30, 'b', 1));
    roster.add(body(30, 'c', 2));
    roster.add(body(30, 'd', 3));
    await roster.layout(true);

    const hit = parts.get('d')!.hit;
    // Four bodies are drawn at 0.94, and the zone shrinks with them.
    expect(hit.width).toBeCloseTo(HIT_WIDTH * 0.94, 5);
    expect(hit.height).toBeCloseTo(HEIGHT * 0.94, 5);
    expect(hit.x).toBeCloseTo(1110, 5);
    // Standing on the baseline, so the zone is centred half a body above it.
    expect(hit.y).toBeCloseTo(420 - (HEIGHT * 0.94) / 2, 5);
  });

  it('moves the readout, the name and the badge with the body', async () => {
    const { roster, parts } = rosterOf();
    roster.add(body(30, 'a', 0));
    roster.add(body(30, 'b', 1));
    await roster.layout(true);

    const a = parts.get('a')!;
    expect(a.container.x).toBe(782);
    expect(a.ui.x).toBe(782);
    expect(a.nameText.x).toBe(782);
    expect(a.intent.x).toBe(782);
  });

  it('leaves nothing behind when a body is removed', () => {
    const { roster, parts } = rosterOf();
    roster.add(body(30, 'a', 0));
    const held = parts.get('a')!;

    roster.remove('a');
    // Every object the view owned, not just the sprite: a surviving `ui`
    // container is a health bar floating over empty ground.
    for (const key of ['container', 'ui', 'intent', 'nameText', 'hit']) {
      expect(held[key].destroyed, key).toBe(true);
    }
    expect(roster.get('a')).toBeUndefined();
    expect(roster.living()).toEqual([]);
    expect(roster.size).toBe(0);
  });

  it('keeps a corpse on stage but out of the line', async () => {
    const { roster } = rosterOf();
    const a = roster.add(body(30, 'a', 0));
    const b = roster.add(body(30, 'b', 1));
    const c = roster.add(body(30, 'c', 2));
    await roster.layout(false);
    expect(c.baseX).toBe(1048);

    // A death does not remove the view — a corpse is meant to lie where it fell.
    b.enemy.alive = false;
    expect(roster.size).toBe(3);
    expect(roster.living().map((v) => v.enemy.id)).toEqual(['a', 'c']);

    // …and if the line is ever re-formed, the two survivors take the two slots.
    await roster.layout(false);
    expect([a.baseX, c.baseX]).toEqual([782, 1000]);
  });

  it('takes a runaway off the stage and leaves the others where they stood', async () => {
    const { roster } = rosterOf();
    const a = roster.add(body(30, 'a', 0));
    const b = roster.add(body(30, 'b', 1));
    const thief = roster.add(body(30, 'c', 2));
    await roster.layout(false);
    expect([a.baseX, b.baseX, thief.baseX]).toEqual([712, 880, 1048]);

    thief.enemy.alive = false;
    thief.enemy.escaped = true;
    roster.remove('c');

    expect(roster.living().map((v) => v.enemy.id)).toEqual(['a', 'b']);
    // 遁走 does not re-form the line. Had it done so the two survivors would
    // now be at 782 / 1000, sliding out from under any click already in flight.
    expect([a.baseX, b.baseX]).toEqual([712, 880]);
  });

  it('destroys the whole stage at once', () => {
    const { roster, parts } = rosterOf();
    roster.add(body(30, 'a', 0));
    roster.add(body(30, 'b', 1));
    roster.destroy();
    expect(roster.size).toBe(0);
    for (const id of ['a', 'b']) expect(parts.get(id)!.container.destroyed).toBe(true);
  });
});

// ------------------------------------------------- the stage follows the fight

const deck = (defId: string, n: number): DeckCard[] =>
  Array.from({ length: n }, () => newDeckCard(defId));

function fight(encounterId: string, seed: string): CombatState {
  return startCombat({
    encounter: getEncounter(encounterId),
    deck: deck('pikan', 10),
    heroName: DEFAULT_HERO.name,
    hp: 999,
    maxHp: 999,
    relics: [],
    seed,
  });
}

/**
 * Replay a batch of events onto a set of on-stage ids exactly the way
 * `CombatScene.applyStage` does: drop first, then add, and never touch anything
 * an event did not name.
 */
function replay(stage: string[], events: readonly CombatEvent[]): string[] {
  let on = [...stage];
  for (const ev of events) {
    const change = stageChange(ev);
    if (!change) continue;
    on = [...on.filter((id) => !change.drop.includes(id)), ...change.add];
  }
  return on;
}

const drain = (state: CombatState): CombatEvent[] => state.events.splice(0);

const livingIds = (state: CombatState): string[] =>
  state.enemies.filter((e) => e.alive).map((e) => e.id);

describe('the stage ends up holding exactly the bodies the fight holds', () => {
  it('e3 神上使 · 张曼成 — every summoned 力士 gets a body', () => {
    const state = fight('e3', 'stage-summon');
    let stage = state.enemies.map((e) => e.id);
    expect(stage).toHaveLength(1);

    // Play on until the 聚众 lands, then a couple more turns for good measure.
    for (let turn = 0; turn < 12; turn++) {
      endPlayerTurn(state);
      runEnemyTurn(state);
      stage = replay(stage, drain(state));
    }

    expect(state.enemies.length).toBeGreaterThan(1);
    // Nothing invisible, nothing left over.
    expect(stage.sort()).toEqual(livingIds(state).sort());
    // …and a summon is a *new* body, not a recycled one.
    expect(new Set(stage).size).toBe(stage.length);
  });

  it('b3 地公将军 · 张宝 — the parent leaves and both halves arrive', () => {
    const state = fight('b3', 'stage-split');
    const parent = state.enemies[0];
    let stage = [parent.id];

    resolveDamage(state, {
      attacker: state.player,
      defender: parent,
      base: Math.ceil(parent.maxHp / 2) + 1,
      isAttack: true,
      pierceBlock: false,
    });
    const events = drain(state);

    // The engine deliberately emits no `death` for a split — that is why the
    // parent's sprite used to stand there for the rest of the fight.
    expect(events.filter((e) => e.t === 'death')).toEqual([]);
    expect(events.filter((e) => e.t === 'split')).toHaveLength(1);
    expect(events.filter((e) => e.t === 'shout')).toHaveLength(1);

    stage = replay(stage, events);
    expect(stage).not.toContain(parent.id);
    expect(stage).toHaveLength(2);
    expect(stage.sort()).toEqual(livingIds(state).sort());
  });

  it('m9 劫粮流寇 — the thief leaves the stage rather than freezing on it', () => {
    const state = fight('m9', 'stage-escape');
    const thief = state.enemies.find((e) => e.defId === 'liukou')!;
    let stage = state.enemies.map((e) => e.id);

    // 摸金, 摸金, 遁走.
    for (let turn = 0; turn < 3; turn++) {
      endPlayerTurn(state);
      runEnemyTurn(state);
      stage = replay(stage, drain(state));
    }

    expect(thief.escaped).toBe(true);
    expect(stage).not.toContain(thief.id);
    expect(stage.sort()).toEqual(livingIds(state).sort());
  });

  it('leaves a corpse on stage, so a kill still reads as a body falling', () => {
    const state = fight('m3', 'stage-death');
    const target = state.enemies[0];
    const stage = state.enemies.map((e) => e.id);

    resolveDamage(state, {
      attacker: state.player,
      defender: target,
      base: 999,
      isAttack: true,
      pierceBlock: false,
    });
    const events = drain(state);
    expect(events.filter((e) => e.t === 'death')).toHaveLength(1);
    // A death changes nothing about who is on screen.
    expect(replay(stage, events)).toEqual(stage);
  });
});

// ------------------------------------------------------------------ 夺财

describe('夺财 moves the run, not just the screen', () => {
  let run = startRun(DEFAULT_HERO, 'theft-seed');

  beforeEach(() => {
    run = startRun(DEFAULT_HERO, 'theft-seed');
    run.gold = 200;
  });

  it('debits the purse by exactly what the event reported', () => {
    const state = fight('m9', 'theft-run');
    let seq = 0;
    let paid = 0;

    for (let turn = 0; turn < 3; turn++) {
      endPlayerTurn(state);
      runEnemyTurn(state);
      for (const ev of drain(state)) {
        if (ev.t !== 'steal') continue;
        expect(ev.amount).toBe(30);
        paid += payTheft(run, '2_3', seq++, ev.amount);
      }
    }

    expect(seq).toBe(1);
    expect(paid).toBe(30);
    expect(run.gold).toBe(170);
  });

  it('cannot charge the same theft twice when the fight is re-entered', () => {
    // The scene's `theftSeq` restarts at 0 on every `create()`, so the second
    // run through the same fight replays index 0 — and must cost nothing.
    expect(payTheft(run, '2_3', 0, 30)).toBe(30);
    expect(payTheft(run, '2_3', 0, 30)).toBe(0);
    expect(run.gold).toBe(170);
  });

  it('cannot take more than the run is carrying', () => {
    run.gold = 11;
    expect(payTheft(run, '2_3', 0, 30)).toBe(11);
    expect(run.gold).toBe(0);
  });
});

// ------------------------------------------------------------------ 接线

describe('CombatScene is wired to every event the engine emits', () => {
  const scene = read('src/scenes/CombatScene.ts');

  /**
   * Every variant of `CombatEvent`, written out rather than derived. A
   * `default: break` swallowed 召唤, 分裂, 遁走 and the threshold 台词 for a
   * whole phase and nothing failed, which is exactly what this list is for.
   */
  const EVENTS = [
    'damage',
    'heal',
    'block',
    'status',
    'statusBlocked',
    'death',
    'draw',
    'discard',
    'exhaust',
    'shuffle',
    'enemyMove',
    'summon',
    'split',
    'escape',
    'steal',
    'shout',
    'relic',
    'potion',
    'passive',
  ];

  it('handles every one of them by name', () => {
    const missing = EVENTS.filter((t) => !scene.includes(`case '${t}':`));
    expect(missing).toEqual([]);
  });

  it('has no catch-all left to swallow the next one', () => {
    const body = scene.slice(
      scene.indexOf('private async playEvent'),
      scene.indexOf('private async applyStage'),
    );
    // Guard the slice itself: an empty string contains no 'default:' either.
    expect(body).toContain("case 'shout':");
    expect(body).not.toContain('default:');
  });

  it('routes every change of bodies through the one staging rule', () => {
    for (const handler of ['playSummon', 'playSplit', 'playEscape']) {
      const at = scene.indexOf(`private async ${handler}`);
      expect(at, handler).toBeGreaterThan(-1);
      const body = scene.slice(at, scene.indexOf('\n  }', at));
      expect(body, handler).toContain('stageChange(ev)');
      expect(body, handler).toContain('this.applyStage(');
    }
  });

  it('never re-slots the line behind a runaway', () => {
    // A body leaving must not slide the survivors: `EnemyState.slot` exists to
    // keep positions stable, and a click already on its way would miss.
    const at = scene.indexOf('private async playEscape');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).not.toContain('relayoutEnemies');
  });

  it('destroys a body rather than fading it, when it is not a corpse', () => {
    const at = scene.indexOf('private async applyStage');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('this.removeEnemyView(id)');
    expect(body).toContain('await this.relayoutEnemies(true)');
  });

  it('does not reach for the death animation on a split', () => {
    // 分裂 is not a kill. `inkSplash` is blood, and paying it here would tell
    // the player 张宝 died when he in fact doubled.
    const at = scene.indexOf('private async playSplit');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).not.toContain('inkSplash');
    expect(body).not.toContain('playDeath');
  });

  it('pays a theft through the room layer, keyed by its index', () => {
    expect(scene).toContain('payTheft(this.run, this.nodeId, this.theftSeq++, ev.amount)');
    const at = scene.indexOf('  init(data:');
    expect(scene.slice(at, scene.indexOf('\n  }', at))).toContain('this.theftSeq = 0');
  });
});

describe('the intent marker is drawn, not written', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('paints the badge off the structured intent, not off a label string', () => {
    const at = scene.indexOf('private paintIntent');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('intentOf(this.state, view.enemy)');
    expect(body).toContain('intentBadge(display)');
    expect(body).toContain('drawGlyph(');
    // The old text-only marker has no business in the scene any more.
    expect(scene).not.toContain('intentLabel');
  });

  it('shows the field total off the same function the sim reads', () => {
    expect(scene).toContain('totalIncomingDamage(this.state)');
    expect(scene).toContain('incomingIsLethal(this.state)');
  });

  it('pulses every badge on a board that is about to kill the player', () => {
    // Field-level, not per enemy: dying to three separate 4-damage hits is the
    // commonest death there is, and no single badge on that board looks scary.
    const at = scene.indexOf('const lethal = incomingIsLethal(this.state)');
    expect(at).toBeGreaterThan(-1);
    expect(scene.slice(at, at + 400)).toContain('this.paintIntent(view, lethal)');

    const paint = scene.slice(
      scene.indexOf('private paintIntent'),
      scene.indexOf('private paintIntentMarks'),
    );
    expect(paint).toContain('C.cinnabarBright');
    // An endless yoyo, started only after the reveal has settled.
    expect(paint).toMatch(/repeat: -1/);
  });

  it('gives the badge and the status chips one tooltip between them', () => {
    // todos/24 k2：两者都走场景级 TooltipManager，同一时刻只有一块面板。
    expect(scene).toContain('new TooltipManager(this, DEPTH.float)');
    // The pointer is a caller of the tooltip, not the owner of it — todos/24
    // needs the same panel off a keyboard cursor, so the content stays a method.
    expect(scene).toContain('private intentTipContent(view: EnemyViewParts)');
    expect(scene).toContain('content: () => this.intentTipContent(view)');
  });

  it('keeps the icons resolution-free', () => {
    // Polygons, not a sprite sheet: the game renders at up to 3× on a Retina
    // panel and a 24 px bitmap magnified is exactly the blur the design space
    // exists to avoid. A runtime Phaser import here would also mean the layout
    // decisions could not be tested at all.
    const icons = read('src/ui/intentIcons.ts');
    expect(icons).toMatch(/^import type Phaser from 'phaser';$/m);
    expect(icons).not.toMatch(/^import Phaser from 'phaser';$/m);
    expect(icons).not.toContain('this.add.image');
  });
});

describe('战斗立绘与战利品排布接线', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('按敌人定义翻转朝向', () => {
    expect(scene).toContain('getEnemy(enemy.defId).flipX ?? false');
  });

  it('为丹药和宝物分配独立收据行', () => {
    const at = scene.indexOf('let receiptY = 184;');
    const body = scene.slice(at, scene.indexOf('const spacing =', at));
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain('receiptY += 54;');
    expect(body).toContain('receiptY += 40;');
    expect(body).toContain('const captionY = drop || relic ? receiptY : 184;');
  });

  it('奖励牌词条面板向外侧展开，不再盖住战利品收据', () => {
    expect(scene).toContain("const side = x < GAME_WIDTH / 2 ? 'left' : 'right';");
    expect(scene).toContain('placeCardTipPanel(rewardTip, { x: x - w / 2, y: 386 - h / 2, w, h }, side);');
  });
});

// ------------------------------------------------- 出手之后，身子要归位

describe('an enemy that acts goes back to where it stood', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('has exactly one place that winds a body up, and one that puts it back', () => {
    // The wind-up (`baseX + 30`) is unconditional on `enemyMove`. The only
    // other tween that ever writes `baseX` back to a container is `lunge`'s
    // return leg, and the scene lunges an enemy **only** from `playDamage`,
    // gated on `hitsPlayer && this.currentAttacker`. So a move that deals no
    // damage used to leave the body 30 px right of its own HP bar, name plate,
    // intent badge and hit zone — permanently, and re-set on the next such
    // move. `settleAttacker` is the counterpart.
    expect(scene).toContain('x: view.baseX + 30');
    const at = scene.indexOf('private settleAttacker');
    expect(at, 'settleAttacker must exist').toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('x: view.baseX');
    // Guarded, or a body destroyed by 遁走 / 分裂 mid-batch is tweened dead.
    expect(body).toContain('view.container.active');
    expect(body).toContain('this.currentAttacker = null');
  });

  it('settles the previous swing before the next one and after the last', () => {
    // Two enemies in one turn: the first must be home before the second leans.
    const move = scene.slice(
      scene.indexOf("case 'enemyMove': {"),
      scene.indexOf("case 'relic':"),
    );
    expect(move).toContain('this.settleAttacker()');
    expect(move.indexOf('this.settleAttacker()')).toBeLessThan(
      move.indexOf('this.currentAttacker = view'),
    );

    // And the last swing of the turn, which has no next move to settle it.
    const from = scene.indexOf('runEnemyTurn(this.state);');
    expect(from).toBeGreaterThan(-1);
    const turn = scene.slice(from, scene.indexOf('this.checkOutcome();', from));
    expect(turn).toContain('this.settleAttacker();');
  });

  it('lets go of a body before destroying it', () => {
    // 流寇 plays 遁走 as its last move; anything that damages the player later
    // in the same batch (a turn-start 中毒 tick, a relic that wounds) then
    // lunges `currentAttacker` — which `EnemyRoster.remove` has destroyed.
    const at = scene.indexOf('removeEnemyView(id: string)');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('this.currentAttacker = null');
    expect(body.indexOf('this.currentAttacker = null')).toBeLessThan(
      body.indexOf('this.roster.remove(id)'),
    );
  });

  it('is not a rare case: most elites and bosses have a move with no damage', () => {
    // The number that makes this worth a fix rather than a note. Every
    // encounter in every act, driven through the real engine, grouped by which
    // `enemyMove` produced no player-damage event before the next move.
    let moves = 0;
    let silent = 0;
    const offenders = new Set<string>();

    for (const encounter of allEncounters()) {
      for (const seed of ['park-a', 'park-b', 'park-c']) {
        const state = fight(encounter.id, `${seed}-${encounter.id}`);
        for (let turn = 0; turn < 12 && state.phase === 'player'; turn++) {
          endPlayerTurn(state);
          runEnemyTurn(state);
          const events = drain(state);
          // Walk the batch, splitting it at each `enemyMove`.
          let open: { id: string; label: string } | null = null;
          let hit = false;
          const close = (): void => {
            if (!open) return;
            moves += 1;
            if (!hit) {
              silent += 1;
              offenders.add(`${encounter.id}:${open.label}`);
            }
          };
          for (const ev of events) {
            if (ev.t === 'enemyMove') {
              close();
              open = { id: ev.enemyId, label: ev.label };
              hit = false;
            } else if (ev.t === 'damage' && ev.targetId === 'player') {
              hit = true;
            }
          }
          close();
        }
      }
    }

    expect(moves).toBeGreaterThan(400);
    // Not a corner: roughly one move in five lands no blow on the player.
    expect(silent / moves).toBeGreaterThan(0.1);
    expect(offenders.size).toBeGreaterThan(15);
  });
});
