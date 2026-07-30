export type Faction = '蜀' | '魏' | '吴' | '群';

export interface HeroDef {
  id: string;
  name: string;
  /** Honorific / epithet shown under the name. */
  title: string;
  faction: Faction;
  maxHp: number;
  startingGold: number;
  /** Texture keys registered in BootScene. */
  portraitKey: string;
  fullKey: string;
  passive: { name: string; desc: string };
  blurb: string;
  /** Card ids, one entry per physical copy. */
  startingDeck: string[];
}

export const HEROES: Record<string, HeroDef> = {
  guanyu: {
    id: 'guanyu',
    name: '关羽',
    title: '武圣 · 云长',
    faction: '蜀',
    maxHp: 82,
    startingGold: 99,
    portraitKey: 'portrait-guanyu',
    fullKey: 'hero-guanyu',
    passive: {
      name: '青龙偃月',
      desc: '每回合首次打出【攻】牌时，该牌额外造成 3 点伤害。',
    },
    blurb: '身长九尺，髯长二尺。温酒斩华雄，过五关斩六将。\n手提青龙偃月，所向者破。',
    startingDeck: [
      'pikan', 'pikan', 'pikan', 'pikan', 'pikan',
      'tiebi', 'tiebi', 'tiebi', 'tiebi',
      'tuodao',
    ],
  },
};

export const DEFAULT_HERO = HEROES.guanyu;
