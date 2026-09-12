import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/combat/cards';
import { RELICS } from '../src/combat/relics';
import { HEROES_IN_ORDER } from '../src/data/heroes';
import bootSceneSource from '../src/scenes/BootScene.ts?raw';

const files = new Set(Object.keys(import.meta.glob('../public/assets/**/*.{jpg,png}', {
  query: '?url',
})).map((path) => path.replace('../public/assets/', '')));

function loadedKeys(group: 'CARD' | 'RELIC' | 'HERO'): Set<string> {
  const match = bootSceneSource.match(new RegExp(`const ${group}_KEYS = \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`Missing ${group}_KEYS`);
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
}

describe('已开放武将的素材交付', () => {
  for (const hero of HEROES_IN_ORDER.filter((entry) => !entry.wip)) {
    it(`${hero.name} has a portrait, full figure and loaded art for every card and exclusive relic`, () => {
      const cardKeys = loadedKeys('CARD');
      const relicKeys = loadedKeys('RELIC');
      expect(loadedKeys('HERO').has(hero.id)).toBe(true);
      expect(files.has(`heroes/${hero.id}-full.png`)).toBe(true);
      expect(files.has(`heroes/${hero.id}-portrait.png`)).toBe(true);
      for (const card of Object.values(CARDS).filter((entry) => entry.hero === hero.id)) {
        const key = card.art.replace('card-', '');
        expect(files.has(`cards/${key}.jpg`), card.id).toBe(true);
        expect(cardKeys.has(key), card.id).toBe(true);
      }
      const relics = Object.values(RELICS).filter((entry) =>
        entry.hero === hero.id || entry.id === hero.starterRelic,
      );
      for (const relic of relics) {
        const key = relic.art!.replace('relic-', '');
        expect(files.has(`relics/${key}.png`), relic.id).toBe(true);
        expect(relicKeys.has(key), relic.id).toBe(true);
      }
    });
  }
});
