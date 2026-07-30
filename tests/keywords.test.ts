import { describe, expect, it } from 'vitest';
import { CARDS, resolveCard } from '../src/combat/cards';
import { ENCOUNTERS } from '../src/combat/enemies';
import {
  MAX_HAND,
  X_COST,
  addStatus,
  canPlay,
  describeCard,
  endPlayerTurn,
  playCard,
  previewValues,
  resolveChoice,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import type { CardDef, CombatState } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, type DeckCard } from '../src/state/run';

/**
 * todos/13 · 卡牌关键词 — one test per line of its 验收标准.
 *
 * The probe cards below are registered into `CARDS` for this file only (vitest
 * isolates a test file's module graph), so the shipped card pool stays exactly
 * what the golden snapshots were recorded against.
 */

const probe = (id: string, over: Partial<CardDef>): CardDef => ({
  id,
  name: id,
  type: 'skill',
  rarity: 'common',
  cost: 0,
  target: 'self',
  art: 'card-tiebi',
  text: '试。',
  effects: [],
  ...over,
});

const PROBES: CardDef[] = [
  probe('t-innate', { keywords: ['innate'], effects: [{ kind: 'block', amount: 1 }] }),
  probe('t-ethereal', { keywords: ['ethereal'] }),
  probe('t-retain', { keywords: ['retain'] }),
  // `type: 'status'` arrives with todos/14; the keyword is what makes it dead.
  probe('t-unplayable', { keywords: ['unplayable'] }),
  probe('t-multi', {
    type: 'attack',
    cost: 1,
    target: 'enemy',
    text: '造成 {D} 点伤害 ×{T}。',
    effects: [{ kind: 'damage', amount: 4, times: 3 }],
  }),
  probe('t-x', {
    type: 'attack',
    cost: X_COST,
    target: 'enemy',
    text: '造成 {D} 点伤害 ×{T}。',
    effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 3 }] }],
  }),
  probe('t-cond', {
    type: 'attack',
    cost: 1,
    target: 'enemy',
    text: '造成 {D} 点伤害。',
    effects: [
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'vulnerable' },
        then: [{ kind: 'damage', amount: 10 }],
        otherwise: [{ kind: 'damage', amount: 5 }],
      },
    ],
  }),
  probe('t-discard', {
    effects: [
      { kind: 'discard', amount: 2 },
      { kind: 'draw', amount: 1 },
    ],
  }),
  probe('t-exhaustpick', { effects: [{ kind: 'exhaustCards', amount: 1 }] }),
  probe('t-kill-then-ask', {
    type: 'attack',
    cost: 1,
    target: 'enemy',
    effects: [
      { kind: 'damageAll', amount: 30 },
      { kind: 'discard', amount: 2 },
    ],
  }),
  probe('t-reckless', {
    type: 'attack',
    cost: 1,
    target: 'enemy',
    effects: [{ kind: 'damageAll', amount: 1, times: 4 }],
  }),
  probe('t-mint', {
    effects: [{ kind: 'addCard', defId: 't-unplayable', count: 2, to: 'discard' }],
  }),
  probe('t-mint-hand', {
    effects: [{ kind: 'addCard', defId: 't-unplayable', count: 2, to: 'hand' }],
  }),
  probe('t-bleed', {
    type: 'attack',
    cost: 1,
    target: 'enemy',
    effects: [
      { kind: 'damage', amount: 5 },
      { kind: 'loseHp', amount: 3 },
    ],
  }),
];
for (const def of PROBES) CARDS[def.id] = def;

const TWO_UP = ENCOUNTERS.monster[1];

function bench(deck: DeckCard[], seed = 'keyword-bench'): CombatState {
  const state = startCombat({
    encounter: TWO_UP,
    deck,
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed,
  });
  state.energy = 99;
  // 青龙偃月 is not what these tests are about; count it as already spent.
  state.attacksThisTurn = 1;
  return state;
}

const cards = (defId: string, n: number): DeckCard[] =>
  Array.from({ length: n }, () => newDeckCard(defId));

/**
 * The probe card, pulled into hand from wherever the shuffle left it. Every
 * test below is about what a card does once played, not about drawing it.
 */
function inHand(state: CombatState, defId: string): string {
  const held = state.hand.find((uid) => state.cards[uid].defId === defId);
  if (held) return held;
  const uid = state.drawPile.find((u) => state.cards[u].defId === defId)!;
  state.drawPile.splice(state.drawPile.indexOf(uid), 1);
  state.hand.push(uid);
  return uid;
}

// ---------------------------------------------------------------- 关键词

describe('消耗', () => {
  it('sends a 势 card to the 消耗堆 through its keyword, not its type', () => {
    const state = bench([newDeckCard('yiyong'), ...cards('tiebi', 4)]);
    const uid = inHand(state, 'yiyong');

    expect(playCard(state, uid)).toBe(true);

    expect(state.exhaustPile).toEqual([uid]);
    expect(state.discardPile).not.toContain(uid);
    expect(state.events.at(-1)).toEqual({ t: 'exhaust', uid });
  });

  it('declares the keyword on every 势 card, since the engine has no type branch', () => {
    for (const def of Object.values(CARDS)) {
      if (def.type !== 'power') continue;
      expect(def.keywords ?? [], def.id).toContain('exhaust');
    }
  });
});

describe('固有', () => {
  it('is in the opening hand of 100 fights out of 100', () => {
    for (let i = 0; i < 100; i++) {
      const deck = [newDeckCard('t-innate'), ...cards('pikan', 9)];
      const state = bench(deck, `innate-${i}`);
      expect(state.hand, `seed innate-${i}`).toContain(deck[0].uid);
      expect(state.hand).toHaveLength(5);
    }
  });
});

describe('虚无 / 保留', () => {
  it('burns a 虚无 card left in hand instead of discarding it', () => {
    const state = bench([newDeckCard('t-ethereal'), ...cards('pikan', 9)]);
    const uid = inHand(state, 't-ethereal');

    endPlayerTurn(state);

    expect(state.exhaustPile).toContain(uid);
    expect(state.discardPile).not.toContain(uid);
    expect(state.hand).not.toContain(uid);
  });

  it('keeps a 保留 card in hand and still respects MAX_HAND next turn', () => {
    const state = bench([newDeckCard('t-retain'), ...cards('pikan', 19)]);
    const uid = inHand(state, 't-retain');

    endPlayerTurn(state);
    expect(state.hand).toEqual([uid]);

    runEnemyTurn(state);
    expect(state.hand).toContain(uid);
    expect(state.hand.length).toBeLessThanOrEqual(MAX_HAND);
    expect(state.hand).toHaveLength(6); // the kept card plus a fresh five
  });
});

describe('不可打出', () => {
  it('refuses the card and leaves it in hand', () => {
    const state = bench([newDeckCard('t-unplayable'), ...cards('pikan', 9)]);
    const uid = inHand(state, 't-unplayable');

    expect(canPlay(state, uid)).toBe(false);
    expect(playCard(state, uid)).toBe(false);
    expect(state.hand).toContain(uid);
  });
});

describe('X 费', () => {
  it('spends every point of 气 and scales with what it spent', () => {
    const state = bench([newDeckCard('t-x'), ...cards('pikan', 9)]);
    const enemy = state.enemies[0];

    state.energy = 1;
    const hp = enemy.hp;
    expect(playCard(state, inHand(state, 't-x'), enemy.id)).toBe(true);
    const atOne = hp - enemy.hp;

    expect(atOne).toBe(3);
    expect(state.energy).toBe(0);
  });

  it('deals exactly three times as much at 3 气', () => {
    const state = bench([...cards('t-x', 2), ...cards('pikan', 8)]);
    const enemy = state.enemies[0];
    state.energy = 3;
    const hp = enemy.hp;

    expect(playCard(state, inHand(state, 't-x'), enemy.id)).toBe(true);

    expect(hp - enemy.hp).toBe(9);
    expect(state.energy).toBe(0);
  });

  it('reads its live value on the card face', () => {
    const state = bench([newDeckCard('t-x'), ...cards('pikan', 9)]);
    state.energy = 4;
    expect(describeCard(state, resolveCard('t-x'), state.enemies[0])).toBe('造成 3 点伤害 ×4。');
  });
});

// ---------------------------------------------------------------- 效果扩容

describe('多段攻击', () => {
  it('prices every hit separately, so 4×3 into 破绽 lands three 6s', () => {
    const state = bench([newDeckCard('t-multi'), ...cards('pikan', 9)]);
    const enemy = state.enemies[0];
    addStatus(state, enemy, 'vulnerable', 5);
    const hp = enemy.hp;
    state.events.length = 0;

    playCard(state, inHand(state, 't-multi'), enemy.id);

    const hits = state.events.filter((e) => e.t === 'damage');
    expect(hits.map((e) => (e.t === 'damage' ? e.amount : 0))).toEqual([6, 6, 6]);
    expect(hp - enemy.hp).toBe(18);
  });

  it('shows the multiplier on the face', () => {
    const state = bench([newDeckCard('t-multi'), ...cards('pikan', 9)]);
    expect(describeCard(state, resolveCard('t-multi'), state.enemies[0])).toBe('造成 4 点伤害 ×3。');
  });

  it('stops mid-combo once the target is down', () => {
    const state = bench([newDeckCard('t-multi'), ...cards('pikan', 9)]);
    const enemy = state.enemies[0];
    enemy.hp = 4;
    state.events.length = 0;

    playCard(state, inHand(state, 't-multi'), enemy.id);

    expect(state.events.filter((e) => e.t === 'damage')).toHaveLength(1);
    expect(state.enemies[1].hp).toBe(state.enemies[1].maxHp);
  });

  /**
   * The mirror case: 反刺 can kill the *player* halfway through their own
   * multi-hit. A corpse does not finish swinging, and every extra hit past the
   * death would keep firing `enemyKilled` hooks on a fight already lost.
   */
  it('stops mid-combo once the player is down', () => {
    const state = bench([newDeckCard('t-reckless'), ...cards('pikan', 9)]);
    state.player.hp = 3;
    for (const enemy of state.enemies) addStatus(state, enemy, 'thorns', 2);
    state.events.length = 0;

    playCard(state, inHand(state, 't-reckless'), state.enemies[0].id);

    expect(state.player.hp).toBe(0);
    expect(state.phase).toBe('lost');
    // Two swings landed and two reflections came back; the remaining six hits
    // of the 4× 全体 never happened.
    expect(state.events.filter((e) => e.t === 'damage' && e.targetId !== 'player')).toHaveLength(2);
  });
});

describe('条件效果', () => {
  it('reads and deals the right branch in both cases', () => {
    const clean = bench([...cards('t-cond', 2), ...cards('pikan', 8)]);
    const target = clean.enemies[0];

    expect(previewValues(clean, resolveCard('t-cond'), target).D).toBe(5);
    const hp = target.hp;
    playCard(clean, inHand(clean, 't-cond'), target.id);
    expect(hp - target.hp).toBe(5);

    addStatus(clean, target, 'vulnerable', 3);
    // 10 base, then ×1.5 from the very 破绽 that switched the branch on.
    expect(previewValues(clean, resolveCard('t-cond'), target).D).toBe(15);
    const hp2 = target.hp;
    playCard(clean, inHand(clean, 't-cond'), target.id);
    expect(hp2 - target.hp).toBe(15);
  });
});

describe('自伤', () => {
  it('ignores block, Strength and Vulnerable', () => {
    const state = bench([newDeckCard('t-bleed'), ...cards('pikan', 9)]);
    addStatus(state, state.player, 'strength', 4);
    addStatus(state, state.player, 'vulnerable', 3);
    state.player.block = 20;
    const hp = state.player.hp;

    playCard(state, inHand(state, 't-bleed'), state.enemies[0].id);

    expect(state.player.hp).toBe(hp - 3);
    expect(state.player.block).toBe(20);
  });
});

// ---------------------------------------------------------------- 选牌

describe('pendingChoice', () => {
  it('asks the player which two cards to discard, then resumes the card', () => {
    const state = bench([newDeckCard('t-discard'), ...cards('pikan', 9)]);
    const uid = inHand(state, 't-discard');

    playCard(state, uid);

    const choice = state.pendingChoice!;
    expect(choice).toMatchObject({ kind: 'discard', min: 2, max: 2 });
    expect(choice.options).toEqual(state.hand);
    expect(choice.options).not.toContain(uid);

    const [a, b] = choice.options;
    const handBefore = state.hand.length;
    expect(resolveChoice(state, [a, b])).toBe(true);

    expect(state.pendingChoice).toBeNull();
    expect(state.discardPile).toContain(a);
    expect(state.discardPile).toContain(b);
    // The queued 「抽 1 张」 ran only after the discard was answered.
    expect(state.hand).toHaveLength(handBefore - 2 + 1);
  });

  it('asks for one when only one card is left to give', () => {
    // A two-card deck: playing one leaves exactly one to be asked for.
    const state = bench([newDeckCard('t-discard'), newDeckCard('pikan')]);
    expect(state.hand).toHaveLength(2);

    playCard(state, inHand(state, 't-discard'));

    expect(state.pendingChoice).toMatchObject({ min: 1, max: 1 });
    expect(state.pendingChoice!.options).toHaveLength(1);
  });

  it('locks the fight until it is answered', () => {
    const state = bench([newDeckCard('t-discard'), ...cards('pikan', 9)]);
    playCard(state, inHand(state, 't-discard'));

    for (const uid of state.hand) expect(canPlay(state, uid)).toBe(false);
    endPlayerTurn(state);
    expect(state.phase).toBe('player');
    expect(state.pendingChoice).not.toBeNull();
  });

  it('rejects an answer that does not fit the prompt', () => {
    const state = bench([newDeckCard('t-discard'), ...cards('pikan', 9)]);
    playCard(state, inHand(state, 't-discard'));
    const options = state.pendingChoice!.options;

    expect(resolveChoice(state, [options[0]])).toBe(false); // too few
    expect(resolveChoice(state, [options[0], options[0]])).toBe(false); // same card twice
    expect(resolveChoice(state, ['not-a-card', options[1]])).toBe(false);
    expect(state.pendingChoice).not.toBeNull();
  });

  /**
   * A fight that ends asks no more questions. The scene runs `settleChoices()`
   * before `checkOutcome()`, so a prompt left standing on a won fight paints a
   * mandatory, non-dismissable grid over a room the player has already cleared
   * — and answering it would resume a queue into a terminal phase.
   */
  it('is dropped, along with the rest of the queue, when the fight ends', () => {
    const state = bench([newDeckCard('t-kill-then-ask'), ...cards('pikan', 9)]);
    for (const enemy of state.enemies) enemy.hp = 1;

    playCard(state, inHand(state, 't-kill-then-ask'), state.enemies[0].id);

    expect(state.phase).toBe('won');
    expect(state.pendingChoice).toBeNull();
    expect(state.effectQueue).toHaveLength(0);
  });

  it('exhausts the picked card rather than discarding it', () => {
    const state = bench([newDeckCard('t-exhaustpick'), ...cards('pikan', 9)]);
    playCard(state, inHand(state, 't-exhaustpick'));

    const pick = state.pendingChoice!.options[0];
    expect(resolveChoice(state, [pick])).toBe(true);

    expect(state.exhaustPile).toContain(pick);
    expect(state.discardPile).not.toContain(pick);
  });
});

// ---------------------------------------------------------------- 生成牌

describe('生成的牌', () => {
  it('is registered in the fight, reachable by the viewer, and dies with it', () => {
    const deck = [newDeckCard('t-mint'), ...cards('pikan', 9)];
    const state = bench(deck);

    playCard(state, inHand(state, 't-mint'));

    const minted = Object.keys(state.cards).filter((uid) => !deck.some((c) => c.uid === uid));
    expect(minted).toHaveLength(2);
    for (const uid of minted) {
      expect(state.discardPile).toContain(uid);
      expect(state.cards[uid].defId).toBe('t-unplayable');
      // The run's deck is a separate object; nothing here can reach it.
      expect(deck.map((c) => c.uid)).not.toContain(uid);
    }
  });

  it('numbers minted uids from a counter, so a seed replays them', () => {
    // One deck, played twice: same physical cards, same seed, same everything.
    const deck = [...cards('t-mint', 2), ...cards('t-mint-hand', 2), ...cards('pikan', 6)];
    const run = (): { uids: string[]; events: string } => {
      const state = bench(deck);
      for (const defId of ['t-mint', 't-mint-hand', 't-mint']) {
        const uid = state.hand.find((u) => state.cards[u].defId === defId);
        if (uid) playCard(state, uid);
      }
      return {
        uids: Object.keys(state.cards).filter((uid) => uid.startsWith('g')),
        events: JSON.stringify(state.events),
      };
    };

    const a = run();
    const b = run();
    expect(a.uids.length).toBeGreaterThan(0);
    expect(a.uids).toEqual(b.uids);
    expect(a.events).toBe(b.events);
  });

  it('discards a card minted into a full hand rather than overfilling it', () => {
    const state = bench([...cards('t-mint-hand', 12)]);
    while (state.hand.length < MAX_HAND) state.hand.push(state.drawPile.pop()!);
    const uid = state.hand[0];

    // Playing it frees one slot, so the first minted card fits and the second
    // has nowhere to go.
    playCard(state, uid);

    expect(state.hand).toHaveLength(MAX_HAND);
    expect(state.discardPile.filter((u) => u.startsWith('g'))).toHaveLength(1);
  });
});
