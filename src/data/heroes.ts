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
  /**
   * The one character the 选将 screen prints as a watermark behind the hero,
   * and the stand-in it draws while a hero has no painting yet. Traditional
   * form, to match 「三國」 on the title.
   */
  seal: string;
  /** Relic id the hero starts the run with — where the passive actually lives. */
  starterRelic: string;
  /** Title-screen flavour for that relic. It drives no rules. */
  passive: { name: string; desc: string };
  /**
   * The hero's mechanical theme, in the player's words. Also drives no rules —
   * it names the thing his pool is built to read, so the 选将 screen can say
   * what a hero *plays like* rather than only what he starts with.
   */
  mechanic: { name: string; desc: string };
  blurb: string;
  /** Card ids, one entry per physical copy. */
  startingDeck: string[];
}

/**
 * The playable heroes, in pick order.
 *
 * 关羽's numbers are frozen: all 37 golden snapshots build their deck from his
 * `startingDeck` and fight with his `starterRelic`, so `maxHp`, `name`,
 * `startingDeck` (contents *and* order) and `starterRelic` may not change by a
 * character. New heroes are appended; nothing above them moves.
 *
 * Every difference between heroes is data, not an engine branch: 体力 and 资财
 * are here, the passive is a `tier: 'starter'` relic (never dropped, never
 * sold), 气上限 and 手牌数 are that relic's `modifiers`, and the draftable pool
 * is keyed by `id` in `HERO_CARD_POOLS`. `startCombat` still takes only a
 * `heroName` — it must never learn what a `HeroDef` is, or the snapshotted draw
 * order would be one relic lookup away from moving.
 */
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
    seal: '關',
    starterRelic: 'qinglongdao',
    passive: {
      name: '青龙偃月',
      desc: '每回合首次打出【攻】牌时，该牌额外造成 3 点伤害。',
    },
    mechanic: {
      name: '神力',
      desc: '少而重的刀法。叠【神力】、攒大牌，一刀之威胜过十次挥砍。',
    },
    blurb: '身长九尺，髯长二尺。温酒斩华雄，过五关斩六将。\n手提青龙偃月，所向者破。',
    startingDeck: [
      'pikan', 'pikan', 'pikan', 'pikan', 'pikan',
      'tiebi', 'tiebi', 'tiebi', 'tiebi',
      'tuodao',
    ],
  },

  zhaoyun: {
    id: 'zhaoyun',
    name: '赵云',
    title: '常胜 · 子龙',
    faction: '蜀',
    // 8 体力 under 关羽: the 连击 plan spends cards, not 体力, and a thinner bar
    // is what stops it from also being the safest plan.
    maxHp: 74,
    startingGold: 99,
    portraitKey: 'portrait-zhaoyun',
    fullKey: 'hero-zhaoyun',
    seal: '趙',
    starterRelic: 'yajiaoqiang',
    passive: {
      name: '涯角枪',
      desc: '每回合第二次打出【攻】牌时，该牌额外造成 4 点伤害。',
    },
    mechanic: {
      name: '连击',
      desc: '一回合内每多打出一张【攻】牌，其后的枪势便重一分；「七探盘蛇」按已出的【攻】牌数连刺。',
    },
    blurb: '长坂坡前，怀抱幼主，七进七出。\n一身是胆，枪出如龙，万军之中不曾坠鞍。',
    startingDeck: [
      'tuzhen', 'tuzhen', 'tuzhen', 'tuzhen', 'tuzhen',
      'luema', 'luema', 'luema', 'luema',
      'longdan',
    ],
  },

  zhugeliang: {
    id: 'zhugeliang',
    name: '诸葛亮',
    title: '卧龙 · 孔明',
    faction: '蜀',
    // The thinnest bar in the game, and the price of the extra 气. He is the
    // only hero who cannot pay 体力 for anything.
    maxHp: 68,
    startingGold: 99,
    portraitKey: 'portrait-zhugeliang',
    fullKey: 'hero-zhugeliang',
    seal: '諸',
    starterRelic: 'guanjin',
    passive: {
      name: '纶巾',
      desc: '气上限 +1，但每回合少抽 1 张牌。',
    },
    mechanic: {
      name: '锦囊',
      desc: '手牌少一张，气多一点。自造 0 气的【锦囊】补手，再让「火计」「出师表」按消耗堆发难。',
    },
    blurb: '躬耕南阳，三顾而出。羽扇纶巾，谈笑间樯橹灰飞。\n未出茅庐，已定三分天下。',
    startingDeck: [
      'yuanrongnu', 'yuanrongnu', 'yuanrongnu', 'yuanrongnu', 'yuanrongnu',
      'jushou', 'jushou', 'jushou', 'jushou',
      'longzhongdui',
    ],
  },
};

/**
 * Pick order on the 选将 screen, and the order every test that walks the roster
 * uses. Append only — 关羽 leads because he is the one the snapshots are built
 * from and `DEFAULT_HERO` must keep pointing at him.
 */
export const HERO_ORDER: readonly string[] = ['guanyu', 'zhaoyun', 'zhugeliang'];

export const HEROES_IN_ORDER: readonly HeroDef[] = HERO_ORDER.map((id) => HEROES[id]);

export const DEFAULT_HERO = HEROES.guanyu;
