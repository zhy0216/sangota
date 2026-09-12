import { afterEach, describe, expect, it, vi } from 'vitest';
import { allEncounters, encounterTierOf, getEnemy } from '../src/combat/enemies';
import { HEROES } from '../src/data/heroes';
import { runSeedOf } from '../src/data/acts';
import { ensureEncounter } from '../src/rooms/fight';
import { getRun } from '../src/state/run';
import { restoreCombat } from '../src/state/save';
import {
  DEFAULT_TEST_BATTLE,
  TEST_BATTLE_STAGES,
  prepareTestBattle,
  testBattleLoadouts,
} from '../src/state/testBattle';
import { isUnlocked } from '../src/state/unlocks';

afterEach(() => vi.unstubAllGlobals());

describe('standalone test battles', () => {
  it('lets a fresh profile try Zhuge Liang without granting an unlock or writing a save', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    expect(isUnlocked('hero', 'zhugeliang')).toBe(false);

    const { run, combat } = prepareTestBattle(DEFAULT_TEST_BATTLE);
    const state = restoreCombat(combat, run.mods);
    expect(getRun()).toBe(run);
    expect(run.custom).toBe(true);
    expect(run.hero.id).toBe('zhugeliang');
    expect(run.deck.map((card) => card.defId)).toEqual(HEROES.zhugeliang.startingDeck);
    expect(run.relics).toEqual(['guanjin']);
    expect(state.player.hp).toBe(68);
    expect(state.maxEnergy).toBe(4);
    expect(state.energy).toBe(4);
    expect(state.hand).toHaveLength(4);
    expect(isUnlocked('hero', 'zhugeliang')).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('offers every shipped encounter exactly once', () => {
    const ids = TEST_BATTLE_STAGES.map((stage) => stage.encounter.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(allEncounters().map((encounter) => encounter.id).sort());
  });

  it.each(TEST_BATTLE_STAGES)('opens $encounter.name in act $act with its real enemy roster', (stage) => {
    const { run, combat } = prepareTestBattle({ ...DEFAULT_TEST_BATTLE, encounterId: stage.encounter.id });
    const state = restoreCombat(combat, run.mods);
    expect(run.act).toBe(stage.act);
    expect(runSeedOf(run)).toBe(DEFAULT_TEST_BATTLE.seed);
    expect(combat.tier).toBe(encounterTierOf(stage.encounter.id));
    expect(ensureEncounter(run, combat.ledgerId!, combat.tier).id).toBe(stage.encounter.id);
    expect(state.enemies.map((enemy) => enemy.defId)).toEqual(stage.encounter.enemies);
    for (const enemy of state.enemies) {
      const definition = getEnemy(enemy.defId);
      expect(enemy.hp).toBeGreaterThanOrEqual(definition.hp[0]);
      expect(enemy.hp).toBeLessThanOrEqual(definition.hp[1]);
    }
  });

  it.each(['jinnang', 'nanzheng', 'legendary'])('carries the %s build into the final boss without snapshot enemy overrides', (loadoutId) => {
    const { run, combat } = prepareTestBattle({ ...DEFAULT_TEST_BATTLE, loadoutId, encounterId: 'b8' });
    const state = restoreCombat(combat, run.mods);
    const preset = testBattleLoadouts('zhugeliang').find((entry) => entry.id === loadoutId)!.scene!;
    expect(run.relics).toEqual(preset.relics);
    expect(state.hand.map((uid) => state.cards[uid].defId)).toEqual(preset.hand);
    expect(state.energy).toBe(preset.player!.energy);
    expect(state.enemies.map((enemy) => enemy.defId)).toEqual(['tianming']);
    expect(state.enemies[0].hp).toBe(getEnemy('tianming').hp[0]);
    expect(state.enemies[0].block).toBe(0);
    expect(state.enemies[0].intent?.id).not.toBe('sweep');
  });

  it.each(['starter', 'jinnang', 'nanzheng', 'legendary'])('restarts %s with the same hand, enemies and random stream', (loadoutId) => {
    const config = { ...DEFAULT_TEST_BATTLE, loadoutId, encounterId: 'b3', seed: 'repeat-me', ascension: 3 };
    const first = prepareTestBattle(config);
    const second = prepareTestBattle(config);
    expect(second.combat).toEqual(first.combat);
    expect(second.run.deck).toEqual(first.run.deck);
    expect(second.run.ascension).toBe(3);
  });

  it.each(['guanyu', 'zhaoyun'])('switches to %s with that hero’s own starter deck and relic', (heroId) => {
    const { run } = prepareTestBattle({ ...DEFAULT_TEST_BATTLE, heroId });
    expect(run.hero.id).toBe(heroId);
    expect(run.deck.map((card) => card.defId)).toEqual(HEROES[heroId].startingDeck);
    expect(run.relics).toEqual([HEROES[heroId].starterRelic]);
    expect(testBattleLoadouts(heroId).map((entry) => entry.id)).toEqual(['starter']);
  });

  it('rejects invalid selections before replacing the active run', () => {
    const { run } = prepareTestBattle(DEFAULT_TEST_BATTLE);
    for (const invalid of [
      { heroId: 'missing' },
      { encounterId: 'missing' },
      { loadoutId: 'missing' },
      { heroId: 'guanyu', loadoutId: 'jinnang' },
    ]) {
      expect(() => prepareTestBattle({ ...DEFAULT_TEST_BATTLE, ...invalid })).toThrow();
      expect(getRun()).toBe(run);
    }
  });
});
