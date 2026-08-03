import { getCard } from '../combat/cards';
import { encounterTierOf, getEncounter, moveById } from '../combat/enemies';
import { startCombat } from '../combat/engine';
import { getPotion } from '../combat/potions';
import { getRelic, relicModifiers } from '../combat/relics';
import type { CardInstance, CombatState } from '../combat/types';
import { HEROES } from '../data/heroes';
import {
  newDeckCard,
  startRun,
  syncPotionSlots,
  syncRewardCount,
  type DeckCard,
  type RunState,
} from '../state/run';
import { snapshotCombat, type SavedCombat } from '../state/save';
import type { DevCombatScene, DevSceneCard } from './types';

export interface PreparedDevScene {
  run: RunState;
  combat: SavedCombat;
}

interface InstalledPiles {
  cards: Record<string, CardInstance>;
  deck: DeckCard[];
  hand: string[];
  drawPile: string[];
  discardPile: string[];
  exhaustPile: string[];
}

const cardParts = (spec: DevSceneCard): { id: string; upgraded: number } =>
  typeof spec === 'string'
    ? { id: spec, upgraded: 0 }
    : { id: spec.id, upgraded: spec.upgraded ?? 0 };

function installPiles(scene: DevCombatScene): InstalledPiles | null {
  const hasLayout =
    scene.hand !== undefined ||
    scene.drawPile !== undefined ||
    scene.discardPile !== undefined ||
    scene.exhaustPile !== undefined;
  if (!hasLayout) return null;

  const cards: Record<string, CardInstance> = {};
  const deck: DeckCard[] = [];

  const build = (specs: readonly DevSceneCard[]): string[] =>
    specs.map((spec) => {
      const { id, upgraded } = cardParts(spec);
      getCard(id);
      if (upgraded < 0 || !Number.isInteger(upgraded)) {
        throw new Error(`Card '${id}' has invalid upgrade count: ${upgraded}`);
      }
      const card = newDeckCard(id, upgraded);
      deck.push(card);
      cards[card.uid] = { ...card };
      return card.uid;
    });

  const hand = build(scene.hand ?? []);
  const drawOrder = build(scene.drawPile ?? []);
  const discardPile = build(scene.discardPile ?? []);
  const exhaustPile = build(scene.exhaustPile ?? []);

  return {
    cards,
    deck,
    hand,
    // The engine draws with pop(); scene files list the next draw first.
    drawPile: [...drawOrder].reverse(),
    discardPile,
    exhaustPile,
  };
}

function configureRun(scene: DevCombatScene): RunState {
  const hero = HEROES[scene.hero ?? 'guanyu'];
  if (!hero) throw new Error(`Unknown hero id: ${scene.hero}`);

  const run = startRun(hero, scene.seed ?? `dev-scene:${scene.name}`, scene.ascension ?? 0);
  run.custom = true;
  run.gold = scene.gold ?? run.gold;

  if (scene.relics) {
    for (const id of scene.relics) {
      if (!getRelic(id)) throw new Error(`Unknown relic id: ${id}`);
    }
    run.relics = [...scene.relics];
    run.relicCounters = {};
    syncPotionSlots(run);
    syncRewardCount(run);
  }

  const naturalMaxHp = Math.round(
    (hero.maxHp + relicModifiers(run.relics).maxHp) * run.mods.maxHpMult,
  );
  run.maxHp = scene.player?.maxHp ?? naturalMaxHp;
  run.hp = scene.player?.hp ?? run.maxHp;
  if (run.maxHp <= 0 || run.hp <= 0 || run.hp > run.maxHp) {
    throw new Error(`Invalid player HP: ${run.hp}/${run.maxHp}`);
  }

  if (scene.potions) {
    if (scene.potions.length > run.potionSlots) {
      throw new Error(`Scene has ${scene.potions.length} potions but only ${run.potionSlots} slots`);
    }
    for (const id of scene.potions) {
      if (id) getPotion(id);
    }
    run.potions = [...scene.potions];
    while (run.potions.length < run.potionSlots) run.potions.push(null);
  }

  return run;
}

function configureEnemies(state: CombatState, scene: DevCombatScene): void {
  if ((scene.enemies?.length ?? 0) > state.enemies.length) {
    throw new Error(
      `Scene overrides ${scene.enemies!.length} enemies, encounter has ${state.enemies.length}`,
    );
  }

  scene.enemies?.forEach((override, slot) => {
    const enemy = state.enemies[slot];
    if (override.defId && override.defId !== enemy.defId) {
      throw new Error(
        `Enemy slot ${slot} is '${enemy.defId}', scene expected '${override.defId}'`,
      );
    }

    if (override.phase !== undefined) enemy.phase = override.phase;
    if (override.maxHp !== undefined) enemy.maxHp = override.maxHp;
    if (override.hp !== undefined) {
      enemy.hp = override.hp;
      if (override.maxHp === undefined && enemy.hp > enemy.maxHp) enemy.maxHp = enemy.hp;
    }
    if (override.block !== undefined) enemy.block = override.block;
    if (override.statuses !== undefined) enemy.statuses = { ...override.statuses };
    if (override.actedTurns !== undefined) enemy.actedTurns = override.actedTurns;
    if (override.repeat !== undefined) enemy.repeat = override.repeat;
    enemy.alive = override.alive ?? enemy.hp > 0;

    if (override.intent !== undefined) {
      enemy.intent =
        override.intent === null
          ? null
          : moveById(enemy.defId, enemy.phase, override.intent, state.enemyMovesEnhanced);
      if (override.intent !== null && !enemy.intent) {
        throw new Error(`Unknown move '${override.intent}' for enemy '${enemy.defId}'`);
      }
    }
  });
}

export function prepareDevScene(sceneKey: string, scene: DevCombatScene): PreparedDevScene {
  const encounter = getEncounter(scene.encounter);
  const tier = scene.tier ?? encounterTierOf(scene.encounter);
  const run = configureRun(scene);
  const piles = installPiles(scene);
  if (piles) run.deck = piles.deck;

  const state = startCombat({
    encounter,
    // Exact pile layouts are installed after combat-start hooks. With no layout,
    // keep the ordinary shuffled opening so a scene can override only the board.
    deck: piles ? [] : run.deck,
    heroName: run.hero.name,
    hp: run.hp,
    maxHp: run.maxHp,
    relics: run.relics,
    seed: scene.seed ?? `dev-scene:${sceneKey}`,
    tier,
    mods: run.mods,
  });

  if (piles) {
    state.cards = piles.cards;
    state.hand = piles.hand;
    state.drawPile = piles.drawPile;
    state.discardPile = piles.discardPile;
    state.exhaustPile = piles.exhaustPile;
  }

  state.turn = scene.turn ?? state.turn;
  state.attacksThisTurn = scene.attacksThisTurn ?? 0;
  state.cardsPlayedThisTurn = scene.cardsPlayedThisTurn ?? 0;
  state.player.hp = run.hp;
  state.player.maxHp = run.maxHp;
  state.player.block = scene.player?.block ?? state.player.block;
  state.player.statuses = scene.player?.statuses
    ? { ...scene.player.statuses }
    : state.player.statuses;
  state.energy = scene.player?.energy ?? state.energy;
  state.maxEnergy = scene.player?.maxEnergy ?? state.maxEnergy;
  state.handSize = scene.player?.handSize ?? state.handSize;
  state.events = [];
  configureEnemies(state, scene);

  const ledgerId = `dev:${sceneKey}`;
  run.rooms[ledgerId] = {
    kind: 'combat',
    committed: [],
    encounterId: encounter.id,
    relicId: null,
    spoils: null,
  };

  return {
    run,
    combat: snapshotCombat(state, {
      tier,
      ledgerId,
      bonusRelic: null,
      theftSeq: 0,
      fightDamageTaken: 0,
    }),
  };
}
