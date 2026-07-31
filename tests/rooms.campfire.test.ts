import { describe, expect, it } from 'vitest';
import { resolveCard } from '../src/combat/cards';
import { DEFAULT_HERO } from '../src/data/heroes';
import {
  applyCampfireOption,
  campfireMenu,
  campfireOptions,
  canLeaveCampfire,
  forgeDisabledReason,
  isCampfireSpent,
  restAmount,
  restGain,
  type CampfireOptionDef,
} from '../src/rooms/campfire';
import { addRelic, startRun, upgradeCard, type RunState } from '../src/state/run';

/**
 * 营帐 — the room whose only rule is "one of these, not both".
 *
 * The numbers are asserted against literals as well as against the formula:
 * `Math.round(82 * 0.3)` is 25, and a test that only re-computes the expression
 * it is checking would pass just as happily against `Math.floor`.
 */

const restNodes = (run: RunState): string[] =>
  [...run.map.nodes.values()].filter((n) => n.type === 'rest').map((n) => n.id);

const camp = (run: RunState): string => {
  const [id] = restNodes(run);
  if (!id) throw new Error('no rest node on this map');
  return id;
};

const fresh = (seed = 'campfire'): RunState => startRun(DEFAULT_HERO, seed);

/** A wounded hero, so 休整 has room to land its full roll. */
const wounded = (seed = 'campfire'): RunState => {
  const run = fresh(seed);
  run.hp = 1;
  return run;
};

describe('休整', () => {
  it('restores 30% of 最大体力, rounded rather than truncated', () => {
    const run = wounded();
    expect(run.maxHp).toBe(82);
    // 82 * 0.3 = 24.6 — a floor would pay 24.
    expect(restAmount(run)).toBe(25);

    const report = applyCampfireOption(run, camp(run), 'rest')!;
    expect(report.healed).toBe(25);
    expect(report.offered).toBe(25);
    expect(run.hp).toBe(26);
    expect(report.hp).toBe(26);
    expect(report.maxHp).toBe(82);
    expect(report.card).toBeNull();
  });

  it('rounds a half up rather than to even', () => {
    const run = wounded();
    run.maxHp = 75; // 22.5
    expect(restAmount(run)).toBe(23);
    expect(applyCampfireOption(run, camp(run), 'rest')!.healed).toBe(23);
  });

  it('tracks 最大体力 granted by relics rather than the hero sheet', () => {
    const run = fresh();
    expect(addRelic(run, 'xuanjia')).toBe(true); // 玄甲: 最大体力 +8
    expect(run.maxHp).toBe(90);
    run.hp = 1;
    expect(restAmount(run)).toBe(27); // 90 * 0.3, not 82 * 0.3
    expect(applyCampfireOption(run, camp(run), 'rest')!.healed).toBe(27);
  });

  it('reports what landed, not what was offered, near full health', () => {
    const run = fresh();
    run.hp = run.maxHp - 5;
    // The button promises 5 because 5 is all the wound will take.
    const rest = campfireOptions(run, camp(run)).find((o) => o.id === 'rest')!;
    expect(restGain(run)).toBe(5);
    expect(rest.hint).toBe('回复 5 点体力');

    const report = applyCampfireOption(run, camp(run), 'rest')!;
    expect(report.healed).toBe(5);
    expect(run.hp).toBe(run.maxHp);

    // …and the report says what the night was worth as well as what landed, so
    // the view can tell "healed everything" from "healed all it was offered".
    // The view used to compute this from `restGain`, which is itself already
    // capped by the wound, so the two were equal by construction and the
    // 「伤已痊愈」 line was dead code.
    expect(report.offered).toBe(25);
    expect(report.healed).toBeLessThan(report.offered);
  });

  it('offers the full night when the wound is deep enough to take it', () => {
    const run = wounded();
    const report = applyCampfireOption(run, camp(run), 'rest')!;
    expect(report.offered).toBe(25);
    expect(report.healed).toBe(25);
    expect(report.healed).toBe(report.offered);
  });

  it('is greyed at full health, and refusing it does not cost the night', () => {
    const run = fresh();
    const id = camp(run);
    const rest = campfireOptions(run, id).find((o) => o.id === 'rest')!;
    expect(rest.disabled).toBe(true);
    expect(rest.disabledReason).toBe('体力已满');

    const before = structuredClone(run.rooms);
    expect(applyCampfireOption(run, id, 'rest')).toBeNull();
    expect(run.rooms).toEqual(before);
    expect(isCampfireSpent(run, id)).toBe(false);
    // The camp is still there to be forged at.
    expect(applyCampfireOption(run, id, 'smith', { uid: run.deck[0].uid })).not.toBeNull();
  });
});

describe('锻造', () => {
  it('upgrades exactly the chosen copy and nothing else', () => {
    const run = fresh();
    const target = run.deck[2];
    expect(target.defId).toBe('pikan');
    const size = run.deck.length;
    const hp = run.hp;

    const report = applyCampfireOption(run, camp(run), 'smith', { uid: target.uid })!;
    expect(report.id).toBe('smith');
    expect(report.healed).toBe(0);
    expect(report.card).toEqual({
      uid: target.uid,
      defId: 'pikan',
      name: resolveCard('pikan', 1).name,
    });
    // The name shown is the forged one — 劈砍·精, not 劈砍.
    expect(report.card!.name).toContain('·精');

    expect(target.upgraded).toBe(1);
    expect(run.deck.filter((c) => c.upgraded > 0)).toEqual([target]);
    expect(run.deck.length).toBe(size);
    expect(run.hp).toBe(hp);
  });

  it('refuses an unknown uid, a missing uid and an already-forged copy', () => {
    const run = fresh();
    const id = camp(run);
    upgradeCard(run, run.deck[0].uid);

    for (const arg of [undefined, {}, { uid: 'nope' }, { uid: run.deck[0].uid }]) {
      expect(applyCampfireOption(run, id, 'smith', arg)).toBeNull();
    }
    // Not one of those four burned the camp.
    expect(isCampfireSpent(run, id)).toBe(false);
    expect(run.rooms).toEqual({});
    expect(applyCampfireOption(run, id, 'rest')).toBeNull(); // full health, still refused
    expect(applyCampfireOption(run, id, 'smith', { uid: run.deck[1].uid })).not.toBeNull();
  });

  it('is greyed when the deck has nothing left to forge', () => {
    const run = fresh();
    for (const card of run.deck) upgradeCard(run, card.uid);
    const smith = campfireOptions(run, camp(run)).find((o) => o.id === 'smith')!;
    expect(smith.disabled).toBe(true);
    expect(smith.disabledReason).toBe('无可精进之牌');
    expect(applyCampfireOption(run, camp(run), 'smith', { uid: run.deck[0].uid })).toBeNull();
  });

  it('names the reason a copy cannot go on the anvil', () => {
    const run = fresh();
    expect(forgeDisabledReason(run.deck[0])).toBeNull();
    upgradeCard(run, run.deck[0].uid);
    expect(forgeDisabledReason(run.deck[0])).toBe('已至极致');
  });
});

describe('一夜只得其一', () => {
  it('closes 锻造 the moment 休整 is taken', () => {
    const run = wounded();
    const id = camp(run);
    expect(applyCampfireOption(run, id, 'rest')).not.toBeNull();

    const snapshot = structuredClone({ deck: run.deck, hp: run.hp, rooms: run.rooms });
    expect(applyCampfireOption(run, id, 'smith', { uid: run.deck[0].uid })).toBeNull();
    expect({ deck: run.deck, hp: run.hp, rooms: run.rooms }).toEqual(snapshot);
  });

  it('closes 休整 the moment 锻造 is taken', () => {
    const run = wounded();
    const id = camp(run);
    expect(applyCampfireOption(run, id, 'smith', { uid: run.deck[0].uid })).not.toBeNull();

    const hp = run.hp;
    expect(applyCampfireOption(run, id, 'rest')).toBeNull();
    expect(run.hp).toBe(hp);
  });

  it('pays a repeat of the same option nothing at all', () => {
    const run = wounded();
    const id = camp(run);
    applyCampfireOption(run, id, 'rest');
    const after = structuredClone({ hp: run.hp, deck: run.deck, rooms: run.rooms });
    expect(applyCampfireOption(run, id, 'rest')).toBeNull();
    expect({ hp: run.hp, deck: run.deck, rooms: run.rooms }).toEqual(after);
  });

  it('greys the whole menu once the night is spent', () => {
    const run = wounded();
    const id = camp(run);
    applyCampfireOption(run, id, 'rest');
    const menu = campfireOptions(run, id);
    expect(menu.map((o) => o.id)).toEqual(['rest', 'smith']);
    expect(menu.every((o) => o.disabled && o.disabledReason === '一夜已尽')).toBe(true);
  });

  it('leaves a ledger with one key and no rolled state in it', () => {
    // A campfire draws from no Rng: its record must stay exactly this shape, or
    // a later option has quietly started materialising randomness.
    const run = wounded();
    const id = camp(run);
    applyCampfireOption(run, id, 'rest');
    expect(run.rooms).toEqual({ [id]: { kind: 'rest', committed: ['rest'] } });
  });

  it('keeps each camp on the map independent', () => {
    const run = wounded();
    const [first, second] = restNodes(run);
    expect(second).toBeDefined();
    expect(applyCampfireOption(run, first, 'rest')).not.toBeNull();
    expect(isCampfireSpent(run, second)).toBe(false);
    expect(applyCampfireOption(run, second, 'smith', { uid: run.deck[0].uid })).not.toBeNull();
  });
});

describe('离营', () => {
  it('holds the player until the night is used', () => {
    const run = wounded();
    const id = camp(run);
    expect(canLeaveCampfire(run, id)).toBe(false);
    applyCampfireOption(run, id, 'rest');
    expect(canLeaveCampfire(run, id)).toBe(true);
  });

  it('never seals a player in with two grey buttons', () => {
    // Full health and a deck already at its peak: neither option can be taken,
    // so refusing to leave would be a soft lock rather than a decision.
    const run = fresh();
    for (const card of run.deck) upgradeCard(run, card.uid);
    const id = camp(run);
    expect(campfireOptions(run, id).every((o) => o.disabled)).toBe(true);
    expect(canLeaveCampfire(run, id)).toBe(true);
    expect(isCampfireSpent(run, id)).toBe(false);
  });
});

describe('遗物解锁', () => {
  /** Stands in for 工兵铲 / 静心香 / 石鼎, none of which exist in `RELICS` yet. */
  const gated: CampfireOptionDef = {
    id: 'smith',
    label: '掘 藏',
    unlock: 'yaonang',
    hint: () => '取一物',
    blocked: () => null,
  };

  it('keeps a gated row off the menu until its relic is owned', () => {
    const run = fresh();
    expect(campfireMenu(run, false, [gated])).toEqual([]);
    addRelic(run, 'yaonang');
    expect(campfireMenu(run, false, [gated]).map((o) => o.label)).toEqual(['掘 藏']);
  });

  it('ships the two permanent rows and no dead ones', () => {
    // 掘藏 / 弃甲 / 举鼎 stay off the menu while their relics do not exist, so
    // the room never offers something the run cannot honour.
    const run = fresh();
    expect(campfireOptions(run, camp(run)).map((o) => o.id)).toEqual(['rest', 'smith']);
  });
});
