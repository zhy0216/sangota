import type { CombatTier } from '../combat/enemies';
import type { Encounter } from '../combat/types';
import { ACTS, actSeed, type ActIndex } from '../data/acts';
import { HEROES } from '../data/heroes';
import { prepareDevScene, type PreparedDevScene } from '../devScenes/prepare';
import jinnang from '../devScenes/scenes/zhugeliang-jinnang';
import legendary from '../devScenes/scenes/zhugeliang-legendary';
import nanzheng from '../devScenes/scenes/zhugeliang-nanzheng';
import type { DevCombatScene } from '../devScenes/types';
import { generateFinalAct, generateMap } from '../map/generateMap';

export interface TestBattleConfig {
  heroId: string;
  encounterId: string;
  loadoutId: string;
  seed: string;
  ascension: number;
}

export const DEFAULT_TEST_BATTLE: TestBattleConfig = {
  heroId: 'zhugeliang',
  encounterId: 'm1',
  loadoutId: 'starter',
  seed: 'test-battle',
  ascension: 0,
};

export interface TestBattleStage {
  act: ActIndex;
  tier: CombatTier;
  encounter: Encounter;
}

export const TEST_BATTLE_STAGES: TestBattleStage[] = Object.values(ACTS).flatMap((act) => [
  ...[...act.table.weak, ...act.table.strong].map((encounter) => ({
    act: act.index, tier: 'monster' as const, encounter,
  })),
  ...act.table.elite.map((encounter) => ({ act: act.index, tier: 'elite' as const, encounter })),
  ...act.table.boss.map((encounter) => ({ act: act.index, tier: 'boss' as const, encounter })),
]);

export interface TestBattleLoadout {
  id: string;
  name: string;
  description: string;
  scene?: DevCombatScene;
}

const STARTER: TestBattleLoadout = {
  id: 'starter',
  name: '初始牌组',
  description: '使用武将的初始牌组、起手宝物与正常体力和气，直接挑战所选关卡。',
};

const ZHUGELIANG_LOADOUTS: TestBattleLoadout[] = [
  STARTER,
  { id: 'jinnang', name: '锦囊 · 消耗成阵', description: jinnang.description!, scene: jinnang },
  { id: 'nanzheng', name: '南征 · 瘴气破甲', description: nanzheng.description!, scene: nanzheng },
  { id: 'legendary', name: '传世 · 卧龙三策', description: legendary.description!, scene: legendary },
];

export const testBattleLoadouts = (heroId: string): TestBattleLoadout[] =>
  heroId === 'zhugeliang' ? ZHUGELIANG_LOADOUTS : [STARTER];

/** Reuse the snapshots' player builds while keeping the selected encounter's real enemies. */
export function prepareTestBattle(config: TestBattleConfig): PreparedDevScene {
  const hero = HEROES[config.heroId];
  if (!hero || hero.wip) throw new Error(`Unavailable test hero: ${config.heroId}`);
  const stage = TEST_BATTLE_STAGES.find((entry) => entry.encounter.id === config.encounterId);
  if (!stage) throw new Error(`Unknown test encounter: ${config.encounterId}`);
  const loadout = testBattleLoadouts(hero.id).find((entry) => entry.id === config.loadoutId);
  if (!loadout) throw new Error(`Unavailable test loadout: ${config.loadoutId}`);

  const preset = loadout.scene;
  const seed = config.seed.trim() || DEFAULT_TEST_BATTLE.seed;
  const prepared = prepareDevScene('test-battle', {
    name: `${hero.name} · ${stage.encounter.name}`,
    hero: hero.id,
    encounter: stage.encounter.id,
    tier: stage.tier,
    seed,
    ascension: config.ascension,
    relics: preset?.relics,
    player: preset?.player,
    hand: preset?.hand,
    drawPile: preset?.drawPile,
    discardPile: preset?.discardPile,
    exhaustPile: preset?.exhaustPile,
  });
  const run = prepared.run;
  run.act = stage.act;
  if (stage.act !== 1) {
    run.map = stage.act === 4
      ? generateFinalAct(actSeed(seed, stage.act))
      : generateMap(actSeed(seed, stage.act), ACTS[stage.act].layout, run.mods.extraElites);
  }
  return prepared;
}
