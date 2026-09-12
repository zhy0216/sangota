import { describe, expect, it } from 'vitest';
import { endPlayerTurn, playCard, runEnemyTurn, stacks } from '../src/combat/engine';
import type { CombatState } from '../src/combat/types';
import { prepareDevScene } from '../src/devScenes/prepare';
import jinnang from '../src/devScenes/scenes/zhugeliang-jinnang';
import nanzheng from '../src/devScenes/scenes/zhugeliang-nanzheng';
import legendary from '../src/devScenes/scenes/zhugeliang-legendary';
import type { DevCombatScene } from '../src/devScenes/types';
import { restoreCombat, snapshotCombat } from '../src/state/save';

function prepare(definition: DevCombatScene): CombatState {
  const { run, combat } = prepareDevScene('zhugeliang-release', definition);
  return restoreCombat(combat, run.mods);
}

function play(state: CombatState, id: string): void {
  const uid = state.hand.find((card) => state.cards[card].defId === id);
  expect(uid, `${id} must be in hand`).toBeDefined();
  expect(playCard(state, uid!, state.enemies[0].id), id).toBe(true);
}

describe('诸葛亮完整构筑试玩', () => {
  it('turns generated 锦囊 into armour, healing and a live exhaust finisher across a save', () => {
    let state = prepare(jinnang);
    play(state, 'jingtianfa');
    expect(state.player.block).toBe(5); // 八卦炉；井田法自身是势，不触发砺兵。
    play(state, 'longzhongdui');
    play(state, 'jinnang');
    expect(state.exhaustPile).toHaveLength(3);
    expect(state.player.block).toBe(13);
    expect(state.player.hp).toBe(56);
    expect(stacks(state.player, 'strength')).toBe(1);

    const saved = snapshotCombat(state, {
      tier: 'elite', ledgerId: 'dev:zhugeliang-release', bonusRelic: null,
      theftSeq: 0, fightDamageTaken: 0,
    });
    state = restoreCombat(JSON.parse(JSON.stringify(saved)));
    play(state, 'jinnang');
    play(state, 'caolu');
    expect(state.exhaustPile).toHaveLength(5);
    expect(state.player.block).toBe(21);
    play(state, 'fenju');
    expect(state.enemies[0].hp).toBe(159); // 热分支 20 + 武侯祠神力 1。
    expect(state.energy).toBe(3);
  });

  it('combines single and group poison while the second 谋 draws and the turn end heals', () => {
    const state = prepare(nanzheng);
    play(state, 'zhangqi');
    play(state, 'wuxilu');
    expect(stacks(state.enemies[0], 'poison')).toBe(7);
    expect(state.hand.some((uid) => state.cards[uid].defId === 'duandao')).toBe(true);
    expect(state.relicCounters.jiangyuantu).toBe(2);
    play(state, 'jueying');
    expect(stacks(state.enemies[0], 'frail')).toBe(4); // 赤壁图符 2 + 绝营 2。
    endPlayerTurn(state);
    expect(state.player.hp).toBe(50);
    runEnemyTurn(state);
    expect(state.enemies[0].hp).toBe(173);
    expect(stacks(state.enemies[0], 'poison')).toBe(6);
  });

  it('plays all three legendary stratagems with the first-skill discount and remaining 气', () => {
    const state = prepare(legendary);
    play(state, 'qimenbazhen');
    expect(state.energy).toBe(7);
    expect(state.player.block).toBe(18);
    play(state, 'qixingxuming');
    expect(state.player.hp).toBe(40);
    expect(stacks(state.player, 'buffer')).toBe(2);
    expect(state.relicCounters.sanguzhili).toBe(1);
    expect(state.energy).toBe(4);
    play(state, 'dongfengjitian');
    expect(state.energy).toBe(0);
    expect(state.enemies[0].hp).toBe(204);
    expect(state.exhaustPile.map((uid) => state.cards[uid].defId)).toEqual([
      'qimenbazhen', 'qixingxuming', 'dongfengjitian',
    ]);
  });
});
