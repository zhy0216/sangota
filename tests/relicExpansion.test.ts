import { describe, expect, it } from 'vitest';
import { resolveCard } from '../src/combat/cards';
import { getEncounter } from '../src/combat/enemies';
import {
  BASE_ENERGY,
  applyDamage,
  canPlay,
  drawCards,
  effectiveCardCost,
  endPlayerTurn,
  exhaustCard,
  gainBlock,
  playCard,
  resolveChoice,
  stacks,
  startCombat,
  startPlayerTurn,
} from '../src/combat/engine';
import { RELICS, relicModifiers, relicsOfTier } from '../src/combat/relics';
import { relicPool } from '../src/combat/rewards';
import type { CombatState } from '../src/combat/types';
import { HEROES } from '../src/data/heroes';
import { buyRemoval, removalPrice } from '../src/rooms/shop';
import { fromSaved, toSaved } from '../src/state/save';
import { addCard, addRelic, newDeckCard, startRun } from '../src/state/run';

const ADDED = {
  common: [
    'zhuquejie',
    'duanjinwan',
    'bingliangce',
    'pohujia',
    'huatuoyaofang',
    'fenghuotai',
  ],
  uncommon: [
    'shangjiangling',
    'jingzhouyin',
    'liangcaojie',
    'hujunxin',
    'tunbingfu',
    'yanxingling',
  ],
  rare: [
    'qinglongdaopu',
    'qinglongnizhan',
    'chunqiubaodian',
    'jingzhougudao',
    'longlin',
  ],
  boss: ['shouhanzhaoshu', 'maichengcanqi'],
  shop: ['xiaojiling'],
} as const;

const GUANYU_ONLY = [
  ...ADDED.common.filter((id) => id !== 'fenghuotai'),
  ...ADDED.uncommon,
  ...ADDED.rare.filter((id) => id !== 'longlin'),
];

const SOURCES = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function bench(
  relics: string[],
  cards: string[] = ['pikan', 'pikan', 'tiebi', 'quedi', 'wenjiu'],
  encounter = 'm1',
): CombatState {
  const state = startCombat({
    encounter: getEncounter(encounter),
    deck: cards.map((id) => newDeckCard(id)),
    heroName: HEROES.guanyu.name,
    hp: HEROES.guanyu.maxHp,
    maxHp: HEROES.guanyu.maxHp,
    relics,
    seed: `relic-expansion:${relics.join('-')}:${cards.join('-')}:${encounter}`,
  });
  state.enemies.forEach((enemy) => {
    enemy.hp = 999;
    enemy.maxHp = 999;
  });
  return state;
}

const uidOf = (state: CombatState, defId: string): string => {
  const uid = state.hand.find((held) => state.cards[held].defId === defId);
  if (!uid) throw new Error(`${defId} not in hand`);
  return uid;
};

describe('关羽宝物池扩充', () => {
  it('appends exactly twenty definitions and reaches 15/15/10/8/5 for 关羽', () => {
    // A consecutive window rather than a tail anchor: the 2026-08 赵云批
    // appends behind this one, so "last N of the tier" now belongs to it —
    // what this batch owns is its ids, contiguous and in declaration order.
    for (const [tier, ids] of Object.entries(ADDED)) {
      const tierIds = relicsOfTier(tier as keyof typeof ADDED).map((r) => r.id);
      const at = tierIds.indexOf(ids[0]);
      expect(at, tier).toBeGreaterThanOrEqual(0);
      expect(tierIds.slice(at, at + ids.length), tier).toEqual(ids);
    }
    expect(Object.values(ADDED).flat()).toHaveLength(20);

    const run = startRun(HEROES.guanyu, 'relic-pool-count');
    expect(relicPool(run, 'common')).toHaveLength(15);
    expect(relicPool(run, 'uncommon')).toHaveLength(15);
    expect(relicPool(run, 'rare')).toHaveLength(10);
    expect(relicPool(run, 'boss')).toHaveLength(8);
    expect(relicPool(run, 'shop')).toHaveLength(5);
  });

  it('keeps fifteen open-ladder additions exclusive to 关羽', () => {
    expect(GUANYU_ONLY).toHaveLength(15);
    for (const id of GUANYU_ONLY) expect(RELICS[id].hero, id).toBe('guanyu');

    const zhaoyun = startRun(HEROES.zhaoyun, 'relic-owner-gate');
    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (const id of GUANYU_ONLY) expect(relicPool(zhaoyun, tier), `${tier}/${id}`).not.toContain(id);
    }
    expect(relicPool(zhaoyun, 'common')).toContain('fenghuotai');
    expect(relicPool(zhaoyun, 'rare')).toContain('longlin');
  });
});

describe('常见宝物', () => {
  it('朱雀节 and 烽火台 open a wide fight with control and scaling', () => {
    const state = bench(['zhuquejie', 'fenghuotai'], undefined, 'm3');
    expect(state.enemies.every((enemy) => stacks(enemy, 'weak') === 1)).toBe(true);
    expect(stacks(state.player, 'strength')).toBe(1);
  });

  it('断金腕 adds armour only to the turn first grant and does not recurse', () => {
    const state = bench(['duanjinwan']);
    gainBlock(state, state.player, 5, 'card');
    expect(state.player.block).toBe(8);
    gainBlock(state, state.player, 5, 'card');
    expect(state.player.block).toBe(13);
    expect(state.relicCounters.duanjinwan).toBe(1);
  });

  it('兵粮册 draws from the freshly shuffled pile exactly once', () => {
    const state = bench(['bingliangce']);
    const uid = state.hand.pop()!;
    state.discardPile.push(uid);
    const before = state.events.filter((event) => event.t === 'draw').length;

    drawCards(state, 1);

    expect(state.hand).toContain(uid);
    expect(state.events.filter((event) => event.t === 'draw')).toHaveLength(before + 1);
    expect(state.events.filter((event) => event.t === 'shuffle')).toHaveLength(1);
  });

  it('兵粮册 never lets a nested shuffle draw exceed the hand limit', () => {
    const state = bench(['bingliangce'], Array.from({ length: 12 }, () => 'pikan'));
    while (state.hand.length < 9) state.hand.push(state.drawPile.pop()!);
    state.discardPile.push(...state.drawPile.splice(0));

    drawCards(state, 2);

    expect(state.hand).toHaveLength(10);
  });

  it('破胡甲 reacts once per turn and 华佗药方 pays a kill', () => {
    const armour = bench(['pohujia']);
    applyDamage(armour, armour.player, 6);
    expect(armour.player.block).toBe(4);
    applyDamage(armour, armour.player, 10);
    expect(armour.player.block).toBe(0);

    const healing = bench(['huatuoyaofang']);
    healing.player.hp -= 5;
    healing.enemies[0].hp = 1;
    healing.energy = 99;
    playCard(healing, uidOf(healing, 'pikan'), healing.enemies[0].id);
    expect(healing.player.hp).toBe(healing.player.maxHp - 4);
  });
});

describe('罕见宝物', () => {
  it('上将令 draws only for the turn first expensive attack', () => {
    const state = bench(['shangjiangling'], ['tuodao', 'tuodao', 'pikan', 'tiebi', 'quedi']);
    state.energy = 99;
    const before = state.events.filter((event) => event.t === 'draw').length;

    playCard(state, uidOf(state, 'tuodao'), state.enemies[0].id);
    expect(state.events.filter((event) => event.t === 'draw')).toHaveLength(before + 1);
    playCard(state, uidOf(state, 'tuodao'), state.enemies[0].id);
    expect(state.events.filter((event) => event.t === 'draw')).toHaveLength(before + 1);
  });

  it('荆州印 rewards an empty hand on the next turn', () => {
    const state = bench(['jingzhouyin']);
    state.hand = [];
    state.energy = 0;
    endPlayerTurn(state);
    startPlayerTurn(state);
    expect(state.energy).toBe(BASE_ENERGY + 1);
  });

  it('粮草节 spends at most three leftover energy for armour', () => {
    const state = bench(['liangcaojie']);
    state.energy = 5;
    endPlayerTurn(state);
    expect(state.energy).toBe(2);
    expect(state.player.block).toBe(6);
  });

  it('护军心 blocks one debuff and 屯兵符 answers one heavy loss per turn', () => {
    const warded = bench(['hujunxin']);
    expect(stacks(warded.player, 'artifact')).toBe(1);

    const hurt = bench(['tunbingfu']);
    applyDamage(hurt, hurt.player, 10);
    applyDamage(hurt, hurt.player, 12);
    expect(stacks(hurt.player, 'strength')).toBe(1);
  });

  it('严行令 pays only the first deliberate discard of a turn', () => {
    const state = bench(
      ['yanxingling'],
      ['qingzhuangjiancong', 'qingzhuangjiancong', 'pikan', 'tiebi', 'quedi'],
    );
    state.energy = 0;

    playCard(state, uidOf(state, 'qingzhuangjiancong'));
    resolveChoice(state, [uidOf(state, 'pikan')]);
    expect(state.energy).toBe(1);

    playCard(state, uidOf(state, 'qingzhuangjiancong'));
    resolveChoice(state, [uidOf(state, 'tiebi')]);
    expect(state.energy).toBe(1);
  });
});

describe('稀有规则改写器', () => {
  it('青龙刀谱 keeps displayed, playable and charged cost on one query', () => {
    const state = bench(
      ['qinglongdaopu'],
      ['yanyuezhan', 'yanyuezhan', 'pikan', 'tiebi', 'quedi'],
    );
    state.energy = 2;
    const first = uidOf(state, 'yanyuezhan');

    // The actual CardDef goes through the same helper the hand view imports.
    const firstDef = resolveCard('yanyuezhan');
    expect(effectiveCardCost(state, firstDef)).toBe(2);
    expect(canPlay(state, first)).toBe(true);
    expect(playCard(state, first, state.enemies[0].id)).toBe(true);
    expect(state.energy).toBe(0);
    expect(effectiveCardCost(state, firstDef)).toBe(3);

    const cardView = SOURCES['../src/ui/CardView.ts'];
    expect(cardView).toContain('effectiveCardCost(state, this.def)');
  });

  it('青龙逆斩 repeats effects, not the card lifecycle or play counters', () => {
    const state = bench(
      ['qinglongnizhan'],
      ['wanren', 'wanren', 'pikan', 'tiebi', 'quedi'],
    );
    state.energy = 99;
    const enemy = state.enemies[0];
    const hp = enemy.hp;
    const first = uidOf(state, 'wanren');

    playCard(state, first, enemy.id);

    expect(hp - enemy.hp).toBe(22);
    expect(state.attacksThisTurn).toBe(1);
    expect(state.cardsPlayedThisTurn).toBe(1);
    expect(state.discardPile.filter((uid) => uid === first)).toHaveLength(1);

    const hp2 = enemy.hp;
    playCard(state, uidOf(state, 'wanren'), enemy.id);
    expect(hp2 - enemy.hp).toBe(11);
  });

  it('春秋宝笺 draws for only two non-power exhausts per turn', () => {
    const state = bench(['chunqiubaodian']);
    for (const suffix of ['a', 'b', 'c']) {
      const uid = `draw-${suffix}`;
      state.cards[uid] = { uid, defId: 'pikan', upgraded: 0 };
      state.drawPile.push(uid);
    }
    const before = state.events.filter((event) => event.t === 'draw').length;

    for (let i = 0; i < 3; i++) {
      const uid = state.hand.shift()!;
      exhaustCard(state, uid);
    }

    expect(state.events.filter((event) => event.t === 'draw')).toHaveLength(before + 2);
    expect(state.relicCounters.chunqiubaodian).toBe(2);
  });

  it('荆州古道 counts a discard, then lets the same card be drawn back', () => {
    const state = bench(
      ['jingzhougudao'],
      ['qingzhuangjiancong', 'pikan', 'tiebi', 'quedi', 'wenjiu'],
    );
    const picked = uidOf(state, 'pikan');
    playCard(state, uidOf(state, 'qingzhuangjiancong'));

    expect(resolveChoice(state, [picked])).toBe(true);
    expect(state.hand).toContain(picked);
    expect(state.discardPile).not.toContain(picked);
    expect(state.relicCounters.jingzhougudao).toBe(1);
  });

  it('龙鳞 cancels the first HP loss', () => {
    const state = bench(['longlin']);
    const hp = state.player.hp;
    applyDamage(state, state.player, 20);
    expect(state.player.hp).toBe(hp);
    expect(stacks(state.player, 'buffer')).toBe(0);
  });
});

describe('首领与坊市规则改写器', () => {
  it('受汉诏书 forges future cards and narrows rewards without touching the old deck', () => {
    const run = startRun(HEROES.guanyu, 'edict');
    const old = run.deck.map((card) => card.upgraded);
    addRelic(run, 'shouhanzhaoshu');

    const gained = addCard(run, 'wenjiu');
    expect(gained.upgraded).toBe(1);
    expect(run.deck.slice(0, old.length).map((card) => card.upgraded)).toEqual(old);
    expect(run.cardRewardCount).toBe(2);
  });

  it('麦城残旗 carries at most two energy and charges one draw', () => {
    const state = bench(['maichengcanqi']);
    expect(state.hand).toHaveLength(4);
    state.energy = 5;
    endPlayerTurn(state);
    startPlayerTurn(state);
    expect(state.energy).toBe(BASE_ENERGY + 2);
  });

  it('销籍令 halves removal and stops its surcharge', () => {
    const run = startRun(HEROES.guanyu, 'registry');
    run.gold = 999;
    addRelic(run, 'xiaojiling');
    expect(removalPrice(run)).toBe(26);

    expect(buyRemoval(run, 'shop-a', run.deck[0].uid)).toBe(true);
    expect(run.cardRemovalSurcharge).toBe(0);
    expect(removalPrice(run)).toBe(26);
  });

  it('re-derives every new run-side rule after save/load', () => {
    const run = startRun(HEROES.guanyu, 'relic-save');
    addRelic(run, 'shouhanzhaoshu');
    addRelic(run, 'xiaojiling');
    const restored = fromSaved(toSaved(run, null));

    expect(restored.cardRewardCount).toBe(2);
    expect(addCard(restored, 'wenjiu').upgraded).toBe(1);
    expect(removalPrice(restored)).toBe(26);
    expect(relicModifiers(restored.relics).energyCarryCap).toBe(0);
  });
});
