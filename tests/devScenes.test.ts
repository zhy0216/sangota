import { describe, expect, it } from 'vitest';
import { restoreCombat } from '../src/state/save';
import { prepareDevScene } from '../src/devScenes/prepare';
import scene1 from '../src/devScenes/scenes/scene1';

describe('dev combat scenes', () => {
  it('builds scene1 into the exact requested hand, piles and battlefield', () => {
    const { run, combat } = prepareDevScene('scene1', scene1);
    const state = restoreCombat(combat, run.mods);
    const ids = (uids: string[]): string[] => uids.map((uid) => state.cards[uid].defId);

    expect(run.custom).toBe(true);
    expect(run.rooms['dev:scene1']).toMatchObject({ encounterId: 'e1' });
    expect(state.energy).toBe(8);
    expect(ids(state.hand)).toEqual([
      'wushenglinshi',
      'qinglongjueying',
      'yijueqianqiu',
      'wenjiu',
      'tiebi',
    ]);
    expect(ids([...state.drawPile].reverse())).toEqual(['pikan', 'guaguliaodu', 'tiebi']);
    expect(ids(state.discardPile)).toEqual(['tuodao']);
    expect(state.enemies[0]).toMatchObject({
      defId: 'huaxiong',
      hp: 220,
      maxHp: 220,
      statuses: { vulnerable: 1 },
    });
    expect(state.enemies[0].intent?.id).toBe('sweep');
  });

  it('rejects a scene whose enemy slot does not match its encounter', () => {
    expect(() =>
      prepareDevScene('bad', {
        name: 'bad',
        encounter: 'e1',
        enemies: [{ defId: 'lubu' }],
      }),
    ).toThrow("Enemy slot 0 is 'huaxiong', scene expected 'lubu'");
  });

  it('keeps the ordinary shuffled opening when no pile layout is declared', () => {
    const { run, combat } = prepareDevScene('board-only', {
      name: 'board only',
      encounter: 'm1',
      player: { hp: 40 },
    });
    const state = restoreCombat(combat, run.mods);

    expect(state.hand).toHaveLength(5);
    expect(Object.keys(state.cards)).toHaveLength(run.deck.length);
  });
});
