import { describe, expect, it } from 'vitest';
import { invokeAuthorJudgment, startCombat } from '../src/combat/engine';
import type { Encounter } from '../src/combat/types';
import {
  AUTHOR_EASTER_EGG_CLICKS,
  advanceAuthorEasterEgg,
} from '../src/ui/authorEasterEgg';
import { newDeckCard } from '../src/state/run';
import bootSceneSource from '../src/scenes/BootScene.ts?raw';
import combatSceneSource from '../src/scenes/CombatScene.ts?raw';

const encounter: Encounter = {
  id: 'author-egg-test',
  name: '作者彩蛋试阵',
  enemies: ['yellowturban', 'bandit'],
  goldReward: [0, 0],
};

const fight = () =>
  startCombat({
    encounter,
    deck: Array.from({ length: 6 }, () => newDeckCard('pikan')),
    heroName: '试阵者',
    hp: 80,
    maxHp: 80,
    relics: [],
    seed: 'author-easter-egg',
  });

describe('作者彩蛋隐藏和弦', () => {
  it('only triggers on the fifth eligible click in one continuous Space hold', () => {
    let clicks = 0;
    for (let i = 1; i <= AUTHOR_EASTER_EGG_CLICKS; i++) {
      const result = advanceAuthorEasterEgg(clicks, {
        phase: 'player',
        energy: 0,
        busy: false,
        finished: false,
        spaceHeld: true,
      });
      clicks = result.clicks;
      expect(result.triggered).toBe(i === AUTHOR_EASTER_EGG_CLICKS);
    }
    expect(clicks).toBe(0);
  });

  it('breaks the sequence when Space is released or the battle gate is false', () => {
    const held = advanceAuthorEasterEgg(3, {
      phase: 'player',
      energy: 0,
      busy: false,
      finished: false,
      spaceHeld: false,
    });
    expect(held).toEqual({ clicks: 0, triggered: false });

    for (const context of [
      { phase: 'enemy' as const, energy: 0, busy: false, finished: false, spaceHeld: true },
      { phase: 'player' as const, energy: 1, busy: false, finished: false, spaceHeld: true },
      { phase: 'player' as const, energy: 0, busy: true, finished: false, spaceHeld: true },
      { phase: 'player' as const, energy: 0, busy: false, finished: true, spaceHeld: true },
    ]) {
      expect(advanceAuthorEasterEgg(4, context)).toEqual({ clicks: 0, triggered: false });
    }
  });
});

describe('作者神罚', () => {
  it('kills every living enemy in one damage run and hands victory to checkEnd', () => {
    const state = fight();
    state.events.length = 0;
    state.energy = 0;
    state.enemies[0].block = 7;
    state.enemies[1].block = 13;
    const hp = state.enemies.map((enemy) => enemy.hp);

    expect(invokeAuthorJudgment(state)).toBe(true);

    expect(state.phase).toBe('won');
    expect(state.enemies.every((enemy) => !enemy.alive && enemy.hp === 0 && enemy.block === 0)).toBe(true);
    expect(state.enemies.every((enemy) => enemy.intent === null)).toBe(true);
    expect(state.events.slice(0, 2)).toEqual([
      { t: 'damage', targetId: state.enemies[0].id, amount: hp[0], blocked: 7, lethal: true },
      { t: 'damage', targetId: state.enemies[1].id, amount: hp[1], blocked: 13, lethal: true },
    ]);
    expect(state.events.filter((event) => event.t === 'death')).toHaveLength(2);
  });

  it('refuses to fire outside an empty-qi player turn', () => {
    const state = fight();
    const hp = state.enemies.map((enemy) => enemy.hp);

    state.energy = 1;
    expect(invokeAuthorJudgment(state)).toBe(false);
    state.energy = 0;
    state.phase = 'enemy';
    expect(invokeAuthorJudgment(state)).toBe(false);
    expect(state.enemies.map((enemy) => enemy.hp)).toEqual(hp);
  });
});

describe('作者彩蛋场景接线', () => {
  const files = Object.keys(
    import.meta.glob('../public/assets/easter-eggs/descends.jpg', { query: '?url' }),
  );

  it('loads the generated cinematic art from disk', () => {
    expect(files).toHaveLength(1);
    expect(bootSceneSource).toContain(
      "this.load.image('author-yang-descends', 'easter-eggs/descends.jpg')",
    );
  });

  it('wires Space hold, qi-orb clicks, the easter-egg notice and judgment', () => {
    expect(combatSceneSource).toContain("this.input.keyboard?.on('keydown-SPACE'");
    expect(combatSceneSource).toContain("this.input.keyboard?.on('keyup-SPACE'");
    expect(combatSceneSource).toContain("authorHit.on('pointerdown', () => this.onAuthorOrbClick())");
    expect(combatSceneSource).toContain('“这是我的彩蛋。”');
    expect(combatSceneSource).toContain('invokeAuthorJudgment(this.state)');
  });
});
