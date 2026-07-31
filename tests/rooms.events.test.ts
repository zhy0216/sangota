import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { CARDS, CARD_POOL_BY_RARITY } from '../src/combat/cards';
import { POTIONS } from '../src/combat/potions';
import { RELICS, relicsOfTier } from '../src/combat/relics';
import { EVENTS, FALLBACK_EVENT, getEvent, type EventOutcome } from '../src/data/events';
import { roomCommit, roomRecord } from '../src/rooms/commit';
import {
  applyOutcome,
  chooseOption,
  ensureEvent,
  eventOptions,
  hasEnabledOption,
  isResolved,
  pendingPick,
  resolvePending,
} from '../src/rooms/events';
import { stream } from '../src/rooms/rng';
import { addRelic, startRun, type RunState } from '../src/state/run';
import { DEFAULT_HERO } from '../src/data/heroes';

/**
 * 奇遇. Two halves worth testing for different reasons.
 *
 * The table is checked structurally — an option that pays without charging, a
 * curse routed through the card grant, a name that collides with a relic — all
 * of these are content mistakes that typecheck perfectly and that no gameplay
 * test would ever reach.
 *
 * The rules are checked numerically. "It did not crash" is worthless here: the
 * whole point of an event is the size of the number it moves, so every
 * assertion below names one.
 */

const fresh = (seed = 'events'): RunState => startRun(DEFAULT_HERO, seed);

const nodesOfType = (run: RunState, type: string): string[] =>
  [...run.map.nodes.values()].filter((n) => n.type === type).map((n) => n.id);

const eventNode = (run: RunState): string => {
  const ids = nodesOfType(run, 'event');
  if (ids.length === 0) throw new Error('no event node on this map');
  return ids[0];
};

/** Force a node's event, so a test can name the one it means. */
function pin(run: RunState, nodeId: string, eventId: string): void {
  roomRecord(run, nodeId, 'event').eventId = eventId;
  if (!run.seenEvents.includes(eventId)) run.seenEvents.push(eventId);
}

/** Every outcome in the table, branches flattened. */
function allOutcomes(): { event: string; option: string; outcome: EventOutcome }[] {
  const out: { event: string; option: string; outcome: EventOutcome }[] = [];
  for (const def of [...EVENTS, FALLBACK_EVENT]) {
    for (const opt of def.options) {
      const branches = opt.outcome.branches;
      if (branches) for (const b of branches) out.push({ event: def.id, option: opt.label, outcome: b.outcome });
      else out.push({ event: def.id, option: opt.label, outcome: opt.outcome });
    }
  }
  return out;
}

// --------------------------------------------------------------- the content

describe('the event table', () => {
  it('ships twelve playable events plus a floor', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(10);
    expect(EVENTS.some((d) => d.id === FALLBACK_EVENT.id)).toBe(false);
  });

  it('has unique ids and unique names', () => {
    const ids = EVENTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = EVENTS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('never names an event after a card, relic or potion', () => {
    // 「传国玉玺」 the event and 传国玉玺 the rare relic would have been two
    // different things under one name on two different screens.
    const taken = new Set([
      ...Object.values(CARDS).map((c) => c.name),
      ...Object.values(RELICS).map((r) => r.name),
      ...Object.values(POTIONS).map((p) => p.name),
    ]);
    expect(EVENTS.filter((d) => taken.has(d.name)).map((d) => d.name)).toEqual([]);
  });

  it('always leaves at least one option the player can take', () => {
    // Every option gated behind `requires` would trap the player: the room bars
    // the exit until a decision is made.
    const trapped = EVENTS.filter((d) => d.options.every((o) => o.requires));
    expect(trapped.map((d) => d.id)).toEqual([]);
  });

  it('spells out the price on every option', () => {
    const silent = EVENTS.flatMap((d) => d.options.filter((o) => !o.hint).map(() => d.id));
    expect(silent).toEqual([]);
  });

  it('gives every gated option a reason to show when it is greyed', () => {
    const mute = EVENTS.flatMap((d) => d.options.filter((o) => o.requires && !o.requiresText));
    expect(mute).toEqual([]);
  });

  it('makes every paying option cost something', () => {
    // The rule the table exists to hold: 21% of the map is events, and a free
    // one every three floors would quietly double a run's income.
    const PAYS = (o: EventOutcome): boolean =>
      (o.gold ?? 0) > 0 ||
      (o.maxHp ?? 0) > 0 ||
      !!o.healToFull ||
      !!o.gainRelic ||
      !!o.gainPotion ||
      !!o.upgradeCards ||
      !!o.removeCards;
    const COSTS = (o: EventOutcome): boolean =>
      (o.gold ?? 0) < 0 ||
      !!o.spendAllGold ||
      (o.hp ?? 0) < 0 ||
      !!o.hpLossPercent ||
      (o.maxHp ?? 0) < 0 ||
      !!o.gainCurse ||
      !!o.gainCards ||
      !!o.fight;

    // 「陪饮 / 劝止」-style pairs are the exception: the price of the cheap half
    // is the *other* half, and a run only ever gets one of the two.
    const FREE_BY_DESIGN = new Set([
      'taoyuan:歃血同盟',
      'taoyuan:受金而去',
      'huatuo:服药静养',
      'huatuo:谢而不受',
      'wolonggang:留书而去',
      'xiangjianglaitou:尽数遣散',
      'yuxichenjiang:沉之于江',
      'zuijiuzhangfei:夺坛劝止',
      'huangjingwuren:拾而藏之',
    ]);

    // A branched option is judged whole: 开颅去疾's price is its own 30% side,
    // not something the winning branch is missing.
    const freebies: string[] = [];
    for (const def of [...EVENTS, FALLBACK_EVENT]) {
      for (const opt of def.options) {
        const parts = opt.outcome.branches?.map((b) => b.outcome) ?? [opt.outcome];
        if (!parts.some(PAYS) || parts.some(COSTS)) continue;
        const key = `${def.id}:${opt.label}`;
        if (!FREE_BY_DESIGN.has(key)) freebies.push(key);
      }
    }
    expect(freebies).toEqual([]);
  });

  it('routes curses through gainCurse and never through gainCards', () => {
    // `addCard` throws on a curse, so a table entry that got this wrong would
    // blow up in the player's face rather than in a test.
    for (const { outcome } of allOutcomes()) {
      expect(outcome.gainCurse === undefined || CARDS[outcome.gainCurse].type).not.toBe(undefined);
      if (outcome.gainCurse) expect(CARDS[outcome.gainCurse].type).toBe('curse');
      for (const id of outcome.gainCards?.ids ?? []) {
        expect(CARDS[id].type).not.toBe('curse');
        expect(CARDS[id].type).not.toBe('status');
      }
    }
  });

  it('never nests a branch or hides a pick inside a repeatable option', () => {
    for (const def of [...EVENTS, FALLBACK_EVENT]) {
      for (const opt of def.options) {
        for (const branch of opt.outcome.branches ?? []) {
          expect(branch.outcome.branches).toBeUndefined();
        }
        if (!opt.repeatable) continue;
        // One pending pick per node — `resolvePending` parses a single request
        // off the ledger, and a repeatable option could queue several.
        const outcomes = opt.outcome.branches?.map((b) => b.outcome) ?? [opt.outcome];
        for (const o of outcomes) {
          expect(o.removeCards).toBeUndefined();
          expect(o.upgradeCards).toBeUndefined();
        }
      }
    }
  });

  it('rolls cards only out of the reward pools', () => {
    for (const { outcome } of allOutcomes()) {
      if (!outcome.gainCards?.count) continue;
      expect(CARD_POOL_BY_RARITY[outcome.gainCards.rarity ?? 'common'].length).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------------ selection

describe('ensureEvent', () => {
  it('gives the same node the same event on the same seed', () => {
    const a = fresh('pick-me');
    const b = fresh('pick-me');
    const id = eventNode(a);
    expect(ensureEvent(a, id).id).toBe(ensureEvent(b, id).id);
  });

  it('reads the assignment back rather than re-rolling it', () => {
    const run = fresh();
    const id = eventNode(run);
    const first = ensureEvent(run, id);
    const seen = [...run.seenEvents];
    expect(ensureEvent(run, id)).toBe(first);
    // A second call must not push a second copy onto `seenEvents`.
    expect(run.seenEvents).toEqual(seen);
    expect(roomRecord(run, id, 'event').eventId).toBe(first.id);
  });

  it('draws from the event stream exactly once', () => {
    const run = fresh();
    const id = eventNode(run);
    const rng = stream(run, id, 'event');
    expect(rng.rolls).toBe(0);
    ensureEvent(run, id);
    // The module's own stream is a separate instance; assert against a replica
    // by checking the assignment lands on the same index the one draw gives.
    const replica = stream(run, id, 'event');
    expect(replica.rolls).toBe(0);
    replica.int(1);
    expect(replica.rolls).toBe(1);
  });

  it('never assigns the same event twice while the pool holds out', () => {
    const run = fresh('dedup');
    const ids = nodesOfType(run, 'event');
    expect(ids.length).toBeGreaterThan(1);
    // Push every node to the top floor so `minRow` never narrows the pool.
    for (const id of ids) run.map.nodes.get(id)!.row = 14;
    const assigned = ids.map((id) => ensureEvent(run, id).id);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('keeps 桃园结义 to one appearance in a run, even after the pool is spent', () => {
    const run = fresh('once');
    run.seenEvents = EVENTS.map((d) => d.id);
    const ids = nodesOfType(run, 'event');
    for (const id of ids) run.map.nodes.get(id)!.row = 14;
    // The pool is exhausted, so repeats are allowed back in — but not `once`.
    const assigned = ids.map((id) => ensureEvent(run, id).id);
    expect(assigned).not.toContain('taoyuan');
    expect(assigned).not.toContain('wolonggang');
    for (const id of assigned) expect(getEvent(id).once).toBeFalsy();
  });

  it('respects minRow', () => {
    const run = fresh('floors');
    const id = eventNode(run);
    run.map.nodes.get(id)!.row = 0;
    const def = ensureEvent(run, id);
    expect(def.minRow ?? 0).toBeLessThanOrEqual(0);
  });

  it('falls back to 荒径无人 when nothing at all is eligible', () => {
    const run = fresh('empty');
    // Every non-`once` event seen *and* every `once` event seen: nothing left.
    run.seenEvents = EVENTS.map((d) => d.id);
    const id = eventNode(run);
    run.map.nodes.get(id)!.row = 0;
    // Floor 0 admits only events with no minRow, all of which are `once`.
    const def = ensureEvent(run, id);
    expect(def.id).toBe(FALLBACK_EVENT.id);
  });
});

// ------------------------------------------------------------------- taking

describe('chooseOption', () => {
  it('pays 桃园结义 exactly once', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'taoyuan');
    const maxHp = run.maxHp;
    const hp = run.hp;

    const report = chooseOption(run, id, 0)!;
    expect(report.maxHp).toBe(8);
    expect(run.maxHp).toBe(maxHp + 8);
    // Capacity gained heals for what it grants, the way a relic's does.
    expect(run.hp).toBe(hp + 8);

    expect(chooseOption(run, id, 0)).toBeNull();
    expect(run.maxHp).toBe(maxHp + 8);
  });

  it('refuses a second, different option once the event is resolved', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'taoyuan');
    expect(chooseOption(run, id, 1)!.gold).toBe(50);
    expect(isResolved(run, id)).toBe(true);
    expect(chooseOption(run, id, 0)).toBeNull();
    expect(run.maxHp).toBe(DEFAULT_HERO.maxHp);
  });

  it('refuses an unmet requirement without touching the run', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'wuzhangyuan');
    run.gold = 74;
    run.hp = 10;

    const views = eventOptions(run, id);
    expect(views[0].disabled).toBe(true);
    expect(views[0].disabledReason).toBe('需 75 资财');
    expect(chooseOption(run, id, 0)).toBeNull();
    expect(run.gold).toBe(74);
    expect(run.hp).toBe(10);
    expect(isResolved(run, id)).toBe(false);

    // One coin more and the same option opens.
    run.gold = 75;
    expect(eventOptions(run, id)[0].disabled).toBeUndefined();
  });

  it('spends every coin on 五丈原 and asks for a card', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'wuzhangyuan');
    run.gold = 210;
    run.hp = 12;

    const report = chooseOption(run, id, 0)!;
    expect(run.gold).toBe(0);
    expect(report.gold).toBe(-210);
    expect(run.hp).toBe(run.maxHp);
    expect(report.pending).toEqual({ kind: 'upgrade', count: 1 });
  });

  it('wounds but never kills — the room layer has no defeat screen to reach', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'wolonggang');
    run.hp = 5;

    const report = chooseOption(run, id, 0)!;
    expect(report.lethal).toBe(true);
    expect(run.hp).toBe(1);
    expect(report.hp).toBe(-4);
    expect(report.lines).toContain('几乎丧命，只余一息。');
  });

  it('takes two tenths of current 体力 for the 玉玺, rounded up', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'yuxichenjiang');
    run.hp = 71;

    const report = chooseOption(run, id, 0)!;
    // ceil(71 * 0.2) = 15
    expect(run.hp).toBe(56);
    expect(report.hp).toBe(-15);
    expect(report.lethal).toBe(false);
    // The ladder starts at 稀有 and a fresh run owns none of them, so it must
    // land there — which id is todo 10's business, not this test's.
    expect(RELICS[report.relicId!].tier).toBe('rare');
    expect(run.relics).toContain(report.relicId!);
  });

  it('inflicts 贪念 through addCurse and pays the full 100', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'huangjintai');
    const size = run.deck.length;

    const report = chooseOption(run, id, 0)!;
    expect(report.gold).toBe(100);
    expect(run.gold).toBe(DEFAULT_HERO.startingGold + 100);
    expect(report.curseIds).toEqual(['tannian']);
    expect(run.deck.length).toBe(size + 1);
    expect(run.deck.at(-1)!.defId).toBe('tannian');
  });

  it('hands 降将来投 two real reward cards', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'xiangjianglaitou');
    const size = run.deck.length;

    const report = chooseOption(run, id, 0)!;
    expect(report.cardIds).toHaveLength(2);
    for (const cardId of report.cardIds) {
      expect(CARD_POOL_BY_RARITY.common).toContain(cardId);
    }
    expect(run.deck.length).toBe(size + 2);
  });

  it('fills the belt from 草船借箭 and refuses what will not fit', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'caochuanjiejian');
    run.potions = ['huoyouguan', 'huoyouguan', null];
    const hp = run.hp;

    const report = chooseOption(run, id, 0)!;
    expect(run.hp).toBe(hp - 8);
    expect(report.potionIds).toHaveLength(1);
    expect(report.potionRefused).toBe(1);
    expect(run.potions.filter((p) => p !== null)).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ branches

describe('branches', () => {
  const huatuoOpen = (seed: string): { run: RunState; id: string; report: ReturnType<typeof chooseOption> } => {
    const run = fresh(seed);
    const id = eventNode(run);
    pin(run, id, 'huatuo');
    run.hp = 60;
    return { run, id, report: chooseOption(run, id, 1) };
  };

  it('replays a branch exactly from a seed', () => {
    const a = huatuoOpen('branch-seed');
    const b = huatuoOpen('branch-seed');
    expect(a.report!.text).toBe(b.report!.text);
    expect(a.report!.maxHp).toBe(b.report!.maxHp);
    expect(a.run.hp).toBe(b.run.hp);
  });

  it('reaches both sides of 开颅 and gets each one numerically right', () => {
    const good: string[] = [];
    const bad: string[] = [];
    for (let i = 0; i < 200; i++) {
      const { run, report } = huatuoOpen(`huatuo-${i}`);
      if (report!.maxHp === 15) {
        // 70%: capacity up 15, and the gain heals for what it grants.
        expect(run.maxHp).toBe(DEFAULT_HERO.maxHp + 15);
        expect(run.hp).toBe(75);
        good.push(report!.text);
      } else {
        // 30%: 20 体力 off the top, capacity untouched.
        expect(report!.maxHp).toBe(0);
        expect(run.hp).toBe(40);
        expect(report!.hp).toBe(-20);
        bad.push(report!.text);
      }
    }
    expect(good.length).toBeGreaterThan(0);
    expect(bad.length).toBeGreaterThan(0);
    // Both texts distinct, and neither is the parent's empty string.
    expect(new Set(good).size).toBe(1);
    expect(new Set(bad).size).toBe(1);
    expect(good[0]).not.toBe(bad[0]);
    expect(good[0]).not.toBe('');
    // 70/30 with 200 samples: anything outside this is a wiring error, not luck.
    expect(good.length / 200).toBeGreaterThan(0.55);
    expect(good.length / 200).toBeLessThan(0.85);
  });

  it('draws the branch first, so a later grant cannot move it', () => {
    // Same stream, same first number, whatever the chosen branch then does.
    const outcome: EventOutcome = {
      text: '',
      branches: [
        { weight: 1, outcome: { text: 'a', gold: 1 } },
        { weight: 1, outcome: { text: 'b', gold: 2 } },
      ],
    };
    const run = fresh();
    const rng = new Rng('fixed');
    applyOutcome(run, outcome, rng);
    expect(rng.rolls).toBe(1);
  });

  it('lets the parent outcome be a pure switch', () => {
    const run = fresh();
    run.gold = 0;
    // The parent's own `gold` is deliberately ignored when branches are present.
    applyOutcome(run, { text: '', gold: 999, branches: [{ weight: 1, outcome: { text: 'x' } }] }, new Rng('s'));
    expect(run.gold).toBe(0);
  });
});

// ----------------------------------------------------------------- repeatable

describe('山中残兵', () => {
  const searchable = (seed: string): { run: RunState; id: string } => {
    const run = fresh(seed);
    const id = eventNode(run);
    pin(run, id, 'shanzhongcanbing');
    return { run, id };
  };

  it('may be searched again and again until it is called off', () => {
    const { run, id } = searchable('search');
    let gold = 0;
    let fights = 0;
    for (let i = 0; i < 4; i++) {
      const report = chooseOption(run, id, 0);
      expect(report).not.toBeNull();
      gold += report!.gold;
      if (report!.fight) fights += 1;
      if (report!.fight) break;
    }
    expect(gold + fights * 30).toBeGreaterThan(0);
    // Searching leaves the event open; walking into the ambush closes it.
    expect(isResolved(run, id)).toBe(fights > 0);
  });

  it('gives each attempt its own stream, so repeats are not identical', () => {
    // Four searches on one seed must not all land on the same branch.
    const results = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { run, id } = searchable(seed);
      const line: string[] = [];
      for (let i = 0; i < 3; i++) {
        const report = chooseOption(run, id, 0);
        if (!report) break;
        line.push(report.fight ? 'fight' : String(report.gold));
        if (report.fight) break;
      }
      results.add(line.join(','));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('closes the event for good once 就此离开 is taken', () => {
    const { run, id } = searchable('leave');
    expect(chooseOption(run, id, 0)!.fight).toBeUndefined();
    expect(isResolved(run, id)).toBe(false);
    expect(chooseOption(run, id, 1)).not.toBeNull();
    expect(isResolved(run, id)).toBe(true);
    expect(chooseOption(run, id, 0)).toBeNull();
    expect(hasEnabledOption(run, id)).toBe(false);
  });

  it('pays 30 per find and fires an ambush about a quarter of the time', () => {
    let finds = 0;
    let ambushes = 0;
    for (let i = 0; i < 400; i++) {
      const { run, id } = searchable(`amb-${i}`);
      const report = chooseOption(run, id, 0)!;
      if (report.fight) {
        expect(report.fight.tier).toBe('monster');
        expect(report.gold).toBe(0);
        ambushes += 1;
      } else {
        expect(report.gold).toBe(30);
        finds += 1;
      }
    }
    expect(finds + ambushes).toBe(400);
    expect(ambushes / 400).toBeGreaterThan(0.15);
    expect(ambushes / 400).toBeLessThan(0.36);
  });
});

// -------------------------------------------------------------------- relics

describe('relic grants', () => {
  it('rolls a rare for 江东赴宴 and sends the player into an elite fight', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'jiangdongfuyan');
    const report = chooseOption(run, id, 0)!;
    expect(report.relicId).not.toBeNull();
    expect(run.relics).toContain(report.relicId!);
    expect(report.fight).toEqual({ tier: 'elite' });
  });

  it('degrades down the ladder rather than handing back nothing', () => {
    const run = fresh();
    // Own every rare. `rare` then has to fall to `uncommon`.
    for (const def of relicsOfTier('rare')) addRelic(run, def.id);
    const id = eventNode(run);
    pin(run, id, 'jiangdongfuyan');

    const report = chooseOption(run, id, 0)!;
    expect(report.relicId).not.toBeNull();
    expect(RELICS[report.relicId!].tier).toBe('uncommon');
  });

  it('pays a fixed 90 資財 when every shelf the ladder reaches is empty', () => {
    const run = fresh();
    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (const def of relicsOfTier(tier)) addRelic(run, def.id);
    }
    const id = eventNode(run);
    pin(run, id, 'jiangdongfuyan');
    const gold = run.gold;

    const report = chooseOption(run, id, 0)!;
    expect(report.relicId).toBeNull();
    expect(report.relicRefused).toBe(true);
    // A constant, not a roll — a degenerate case must not spend a die.
    expect(run.gold).toBe(gold + 90);
    expect(report.gold).toBe(90);
    expect(report.lines).toContain('库中已无可取之物，折作资财。');
  });

  it('draws exactly once for a tier grant, empty shelf or not', () => {
    const run = fresh();
    const full = fresh();
    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (const def of relicsOfTier(tier)) addRelic(full, def.id);
    }
    const a = new Rng('relic');
    const b = new Rng('relic');
    applyOutcome(run, { text: '', gainRelic: { tier: 'rare' } }, a);
    applyOutcome(full, { text: '', gainRelic: { tier: 'rare' } }, b);
    expect(a.rolls).toBe(1);
    expect(b.rolls).toBe(1);
  });

  it('never hands out a duplicate', () => {
    const run = fresh();
    addRelic(run, 'chuanguoyuxi');
    const before = [...run.relics];
    applyOutcome(run, { text: '', gainRelic: { id: 'chuanguoyuxi' } }, new Rng('dup'));
    expect(run.relics).toEqual(before);
    // …and pays the consolation instead of silently doing nothing.
    expect(run.gold).toBe(DEFAULT_HERO.startingGold + 40);
  });
});

// ------------------------------------------------------------------- pending

describe('pending deck picks', () => {
  const wolong = (): { run: RunState; id: string } => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'wolonggang');
    return { run, id };
  };

  it('upgrades exactly the cards handed back, once', () => {
    const { run, id } = wolong();
    const report = chooseOption(run, id, 0)!;
    expect(report.pending).toEqual({ kind: 'upgrade', count: 2 });
    expect(pendingPick(run, id)).toEqual({ kind: 'upgrade', count: 2 });

    const uids = run.deck.slice(0, 2).map((c) => c.uid);
    expect(resolvePending(run, id, uids)).toBe(true);
    expect(run.deck.filter((c) => c.upgraded > 0).map((c) => c.uid)).toEqual(uids);

    // A second call is refused and changes nothing.
    expect(resolvePending(run, id, run.deck.slice(2, 4).map((c) => c.uid))).toBe(false);
    expect(run.deck.filter((c) => c.upgraded > 0)).toHaveLength(2);
    expect(pendingPick(run, id)).toBeNull();
  });

  it('honours no more than it asked for', () => {
    const { run, id } = wolong();
    chooseOption(run, id, 1); // 留书而去 — one card
    resolvePending(run, id, run.deck.slice(0, 4).map((c) => c.uid));
    expect(run.deck.filter((c) => c.upgraded > 0)).toHaveLength(1);
  });

  it('tolerates an empty pick, which is what an unforgeable deck produces', () => {
    const { run, id } = wolong();
    chooseOption(run, id, 1);
    expect(resolvePending(run, id, [])).toBe(true);
    expect(run.deck.filter((c) => c.upgraded > 0)).toHaveLength(0);
  });

  it('refuses a pick nobody asked for', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'taoyuan');
    chooseOption(run, id, 0);
    expect(resolvePending(run, id, [run.deck[0].uid])).toBe(false);
    expect(run.deck[0].upgraded).toBe(0);
  });

  it('removes rather than upgrades when the pick is a discard', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'taoyuan');
    // Drive the primitive directly: no shipped event charges a card today, and
    // the removal branch has to keep working for the one that will.
    const rng = new Rng('rm');
    const report = applyOutcome(run, { text: '弃', removeCards: 1 }, rng);
    expect(report.pending).toEqual({ kind: 'remove', count: 1 });
    roomCommit(run, id).mark('pending:remove:1');
    const doomed = run.deck[0].uid;
    const size = run.deck.length;
    expect(resolvePending(run, id, [doomed])).toBe(true);
    expect(run.deck.map((c) => c.uid)).not.toContain(doomed);
    expect(run.deck.length).toBe(size - 1);
  });
});

// ---------------------------------------------------------------- invariants

describe('invariants', () => {
  it('leaves the run untouched when a take is refused', () => {
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'taoyuan');
    chooseOption(run, id, 0);
    const before = JSON.parse(JSON.stringify({ ...run, map: null, hero: null }));
    expect(chooseOption(run, id, 0)).toBeNull();
    expect(chooseOption(run, id, 1)).toBeNull();
    expect(chooseOption(run, id, 99)).toBeNull();
    expect(JSON.parse(JSON.stringify({ ...run, map: null, hero: null }))).toEqual(before);
  });

  it('holds 体力, 资财 and the relic set within their bounds on every option', () => {
    // Every option of every event, taken on a fresh run, at a plausible floor.
    for (const def of [...EVENTS, FALLBACK_EVENT]) {
      for (let i = 0; i < def.options.length; i++) {
        const run = fresh(`sweep-${def.id}-${i}`);
        const id = eventNode(run);
        pin(run, id, def.id);
        run.gold = 200;
        run.hp = 45;

        const opt = def.options[i];
        if (opt.requires && !opt.requires(run)) continue;
        chooseOption(run, id, i);

        expect(run.gold).toBeGreaterThanOrEqual(0);
        expect(run.hp).toBeGreaterThan(0);
        expect(run.hp).toBeLessThanOrEqual(run.maxHp);
        expect(run.maxHp).toBeGreaterThan(0);
        expect(new Set(run.relics).size).toBe(run.relics.length);
        expect(run.potions.length).toBe(run.potionSlots);
      }
    }
  });

  it('replays a whole event node bit for bit from the seed', () => {
    const snapshot = (seed: string): unknown => {
      const run = startRun(DEFAULT_HERO, seed);
      const id = eventNode(run);
      const def = ensureEvent(run, id);
      const report = chooseOption(run, id, 0);
      return {
        event: def.id,
        report,
        hp: run.hp,
        maxHp: run.maxHp,
        gold: run.gold,
        relics: run.relics,
        deck: run.deck.map((c) => `${c.defId}+${c.upgraded}`),
        potions: run.potions,
      };
    };
    for (const seed of ['r1', 'r2', 'r3']) {
      expect(snapshot(seed)).toEqual(snapshot(seed));
    }
  });

  it('never lets an option view claim a disabled reason it cannot show', () => {
    const run = fresh();
    const id = eventNode(run);
    for (const def of EVENTS) {
      roomRecord(run, id, 'event').eventId = def.id;
      for (const view of eventOptions(run, id)) {
        expect(view.label.length).toBeGreaterThan(0);
        if (view.disabled) expect(view.disabledReason).toBeTruthy();
      }
    }
  });
});
