import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { CARDS, CARD_POOL_BY_RARITY, poolFor } from '../src/combat/cards';
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
import { claimVictoryRelic, ensureEncounter, eventFightNodeId } from '../src/rooms/fight';
import { stream, streamSeed } from '../src/rooms/rng';
import { addRelic, startRun, type RunState } from '../src/state/run';
import { DEFAULT_HERO, HEROES_IN_ORDER } from '../src/data/heroes';

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
  it('ships twenty-nine playable events plus a floor', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(28);
    expect(EVENTS.length).toBeLessThanOrEqual(32);
    expect(EVENTS.some((d) => d.id === FALLBACK_EVENT.id)).toBe(false);
  });

  it('offers eleven global events and six exclusive events per act', () => {
    expect(EVENTS.filter((def) => !def.acts)).toHaveLength(11);
    for (const act of [1, 2, 3] as const) {
      expect(EVENTS.filter((def) => def.acts?.includes(act)), `act ${act}`).toHaveLength(6);
      expect(EVENTS.filter((def) => !def.acts || def.acts.includes(act)), `pool ${act}`).toHaveLength(
        17,
      );
    }
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
      'baimenlou:明正典刑',
      'hanshuibaoyi:掩堤缓进',
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

  it('charges a repeatable option on the branch that pays, not on a sibling', () => {
    // 山中残兵 passed the whole-option test above and was still a faucet: the
    // 25% ambush counted as the price of the 75% payout, but an ambush is a
    // *fight*, and a fight pays 資財, a card and a 丹药 roll of its own. Three
    // finds on average is 90 資財 out of a room, against ~300 for a whole run.
    //
    // A repeatable option is therefore judged branch by branch, and `fight` is
    // not a price: the player chooses how many times to take it, so anything
    // net-positive per attempt is unbounded income.
    const PAYS_COIN = (o: EventOutcome): boolean =>
      (o.gold ?? 0) > 0 ||
      (o.maxHp ?? 0) > 0 ||
      !!o.healToFull ||
      !!o.gainRelic ||
      !!o.gainPotion ||
      !!o.upgradeCards ||
      !!o.removeCards;
    const CHARGES_BLOOD = (o: EventOutcome): boolean =>
      (o.gold ?? 0) < 0 ||
      !!o.spendAllGold ||
      (o.hp ?? 0) < 0 ||
      !!o.hpLossPercent ||
      (o.maxHp ?? 0) < 0 ||
      !!o.gainCurse ||
      !!o.gainCards;

    const faucets: string[] = [];
    for (const def of EVENTS) {
      for (const opt of def.options) {
        if (!opt.repeatable) continue;
        const parts = opt.outcome.branches?.map((b) => b.outcome) ?? [opt.outcome];
        for (const part of parts) {
          if (PAYS_COIN(part) && !CHARGES_BLOOD(part)) faucets.push(`${def.id}:${opt.label}`);
        }
      }
    }
    expect(faucets).toEqual([]);
  });

  it('charges a purse it cannot see through spendAllGold, never through negative gold', () => {
    // `addGold` clamps at zero, so an outcome declaring `gold: -200` against a
    // 10-資財 purse silently charges 10 and then reports 「资财 -10。」 as if that
    // had been the price. Nothing in the table does this today; the rule is
    // written down here so that the first outcome that tries has to either gate
    // itself with `requires` or use `spendAllGold`, which is honest by design.
    const unguarded: string[] = [];
    for (const def of EVENTS) {
      for (const opt of def.options) {
        const parts = opt.outcome.branches?.map((b) => b.outcome) ?? [opt.outcome];
        for (const part of parts) {
          if ((part.gold ?? 0) < 0 && !opt.requires) unguarded.push(`${def.id}:${opt.label}`);
        }
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('gates every option that ends in a fight on being able to survive one', () => {
    // The room layer clamps a wound at 1 体力 precisely because it cannot show
    // a defeat screen — and then handed a 1-体力 player to an 精英 through the
    // back door. Any option that can start a fight has to have a floor.
    const ungated: string[] = [];
    for (const def of EVENTS) {
      for (const opt of def.options) {
        const parts = opt.outcome.branches?.map((b) => b.outcome) ?? [opt.outcome];
        if (parts.some((p) => p.fight) && !opt.requires) ungated.push(`${def.id}:${opt.label}`);
      }
    }
    expect(ungated).toEqual([]);
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

  it('reads a materialised event even if its act gate no longer matches', () => {
    const run = fresh('materialised-act');
    const id = eventNode(run);
    pin(run, id, 'baimenlou');
    run.act = 1;
    expect(ensureEvent(run, id).id).toBe('baimenlou');
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
    // 'dedup2'：paths 6→4 后原 'dedup' 的图上有 14 间事件房，超出了 12 个
    // 事件的池子——「池未耗尽」的前提先破了。这颗种子给 9 间，前提站得住。
    const run = fresh('dedup2');
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
    // Asserting `def.minRow <= row` is the event's own account of itself and
    // passes against any filter at all, including none. What has to be checked
    // is the *converse*: an event with a higher floor never turns up below it.
    for (const def of EVENTS) {
      const floor = def.minRow ?? 0;
      if (floor === 0) continue;

      for (let row = 0; row < floor; row++) {
        for (let s = 0; s < 8; s++) {
          const run = fresh(`floor-${def.id}-${row}-${s}`);
          run.act = def.acts?.[0] ?? 1;
          const id = eventNode(run);
          run.map.nodes.get(id)!.row = row;
          expect(ensureEvent(run, id).id, `${def.id} on row ${row}`).not.toBe(def.id);
        }
      }
    }
  });

  it('is an at-or-above gate, not an above gate', () => {
    // `row >= minRow` becoming `row > minRow` shifts the whole table up a
    // floor. Every event has to be reachable on its own printed floor.
    for (const def of EVENTS) {
      const floor = def.minRow ?? 0;
      let reached = false;
      for (let s = 0; s < 80 && !reached; s++) {
        const run = fresh(`atfloor-${def.id}-${s}`);
        run.act = def.acts?.[0] ?? 1;
        const id = eventNode(run);
        run.map.nodes.get(id)!.row = floor;
        // Narrow the pool to this one event so the sample is not the map's.
        run.seenEvents = EVENTS.filter((d) => d.id !== def.id).map((d) => d.id);
        if (ensureEvent(run, id).id === def.id) reached = true;
      }
      expect(reached, `${def.id} unreachable on its own floor ${floor}`).toBe(true);
    }
  });

  it('keeps 五丈原 and 卧龙岗 off the low floors specifically', () => {
    // The two the generic loop above would still miss if `eligible` were
    // rewritten to special-case `once` events: both are `once`, and the
    // exhausted-pool branch drops `once` entries, so a broken `minRow` on
    // either was invisible to the fallback test as well.
    for (const [id, floor] of [
      ['wuzhangyuan', 8],
      ['wolonggang', 4],
      ['baizouhuarong', 6],
    ] as const) {
      expect(getEvent(id).minRow).toBe(floor);
      for (let s = 0; s < 40; s++) {
        const run = fresh(`low-${id}-${s}`);
        run.act = getEvent(id).acts?.[0] ?? 1;
        const node = eventNode(run);
        run.map.nodes.get(node)!.row = 1;
        expect(ensureEvent(run, node).id).not.toBe(id);
      }
    }
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

  it('filters act-exclusive events before de-duplication and exhaustion', () => {
    for (const def of EVENTS.filter((event) => event.acts)) {
      const correct = def.acts![0];
      const wrong = ([1, 2, 3] as const).find((act) => !def.acts!.includes(act))!;

      const allowed = fresh(`act-allowed-${def.id}`);
      allowed.act = correct;
      const allowedNode = eventNode(allowed);
      allowed.map.nodes.get(allowedNode)!.row = 14;
      allowed.seenEvents = EVENTS.filter((event) => event.id !== def.id).map((event) => event.id);
      expect(ensureEvent(allowed, allowedNode).id).toBe(def.id);

      const barred = fresh(`act-barred-${def.id}`);
      barred.act = wrong;
      const barredNode = eventNode(barred);
      barred.map.nodes.get(barredNode)!.row = 14;
      barred.seenEvents = EVENTS.filter((event) => event.id !== def.id).map((event) => event.id);
      expect(ensureEvent(barred, barredNode).id).not.toBe(def.id);
    }
  });

  it('keeps global events reachable in every act and de-duplicates them across acts', () => {
    for (const act of [1, 2, 3] as const) {
      const run = fresh(`global-act-${act}`);
      run.act = act;
      const id = eventNode(run);
      run.map.nodes.get(id)!.row = 14;
      run.seenEvents = EVENTS.filter((event) => event.id !== 'caochuanjiejian').map(
        (event) => event.id,
      );
      expect(ensureEvent(run, id).id).toBe('caochuanjiejian');
    }

    const run = fresh('global-cross-act');
    run.act = 2;
    run.seenEvents = ['caochuanjiejian'];
    const id = eventNode(run);
    run.map.nodes.get(id)!.row = 14;
    expect(ensureEvent(run, id).id).not.toBe('caochuanjiejian');
  });

  it('keeps a non-once event available by row one in every act', () => {
    for (const act of [1, 2, 3] as const) {
      const run = fresh(`row-one-act-${act}`);
      run.act = act;
      run.seenEvents = EVENTS.map((def) => def.id);
      const id = eventNode(run);
      run.map.nodes.get(id)!.row = 1;
      expect(ensureEvent(run, id).id, `act ${act}`).not.toBe(FALLBACK_EVENT.id);
    }
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

  it('kills for real — the clamp came off with todos/22 s3', () => {
    // 曾经钳位在 1 体力：结算界面没建成前，房间层无处可去。现在有了
    // `SummaryScene`，视图读 `lethal` 改道结算，体力照实落到 0。
    const run = fresh();
    const id = eventNode(run);
    pin(run, id, 'wolonggang');
    run.hp = 5;

    const report = chooseOption(run, id, 0)!;
    expect(report.lethal).toBe(true);
    expect(run.hp).toBe(0);
    expect(report.hp).toBe(-5);
    expect(report.lines).toContain('伤重不治，命陨于此。');
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

  it('pays 30 per find, charges 5 体力 for it, and ambushes about a quarter of the time', () => {
    let finds = 0;
    let ambushes = 0;
    for (let i = 0; i < 400; i++) {
      const { run, id } = searchable(`amb-${i}`);
      const report = chooseOption(run, id, 0)!;
      if (report.fight) {
        expect(report.fight.tier).toBe('monster');
        expect(report.gold).toBe(0);
        expect(report.hp).toBe(0);
        ambushes += 1;
      } else {
        expect(report.gold).toBe(30);
        // The price. Without it this option was the table's one strictly
        // positive line and the search was free money on a timer.
        expect(report.hp).toBe(-5);
        finds += 1;
      }
    }
    expect(finds + ambushes).toBe(400);
    expect(ambushes / 400).toBeGreaterThan(0.15);
    expect(ambushes / 400).toBeLessThan(0.36);
  });

  it('cannot be farmed: every 30 資財 costs 5 体力 off the same purse', () => {
    // Search a single node until the ambush lands, and hold the two totals
    // against each other. 90 資財 for nothing was 30% of a run's whole income.
    let bled = 0;
    let earned = 0;
    for (let i = 0; i < 60; i++) {
      const { run, id } = searchable(`farm-${i}`);
      const hp0 = run.hp;
      const gold0 = run.gold;
      for (let attempt = 0; attempt < 40; attempt++) {
        const report = chooseOption(run, id, 0);
        if (!report || report.fight) break;
      }
      bled += hp0 - run.hp;
      earned += run.gold - gold0;
    }
    expect(earned).toBeGreaterThan(0);
    // 30 資財 per 5 体力, exactly, however long the streak ran. Never less:
    // the 1-体力 clamp would make the last few searches free, which is why the
    // option is gated above the clamp rather than relying on it.
    expect(earned / bled).toBe(6);
  });

  it('bars the search once the purse it is charged against is nearly empty', () => {
    // The clamp in `applyOutcome` stops a wound at 1 体力, so blood alone is not
    // a budget: pinned at the floor, a repeatable option costs nothing at all
    // and pays forever. The gate is what bounds it.
    const { run, id } = searchable('floor');
    run.hp = Math.floor(run.maxHp * 0.25);
    expect(eventOptions(run, id)[0].disabled).toBe(true);
    expect(chooseOption(run, id, 0)).toBeNull();

    run.hp = run.maxHp;
    expect(eventOptions(run, id)[0].disabled).toBeUndefined();

    // …and the total take is bounded by 体力 rather than by patience.
    let earned = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const report = chooseOption(run, id, 0);
      if (!report || report.fight) break;
      earned += report.gold;
    }
    // ⌈(maxHp − maxHp/4) / 5⌉ finds at 30 資財 each, and a run's whole income
    // is about 300 — so even the 0.75^n tail cannot buy the shop out.
    expect(earned).toBeLessThanOrEqual(Math.ceil((run.maxHp * 0.75) / 5) * 30);
    expect(run.hp).toBeGreaterThan(1);
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

// ---------------------------------------------------------- 未覆盖的三个事件

/**
 * 官渡焚粮, 醉酒张飞 and the 荒径无人 floor had no test of their own, so every
 * number on them was free to move: 失 10 体力 → 失 1, 资财 +70 → +700 and a
 * 常见 relic grant → 稀有 all passed the whole suite.
 */
describe('the three events nothing named', () => {
  const take = (eventId: string, index: number, seed: string): { run: RunState; report: ReturnType<typeof chooseOption> } => {
    const run = fresh(seed);
    const id = eventNode(run);
    pin(run, id, eventId);
    return { run, report: chooseOption(run, id, index) };
  };

  it('官渡焚粮 · 举火焚之 costs 10 体力 and pays a 常见 relic', () => {
    const { run, report } = take('guandufenliang', 0, 'gdfl-0');
    expect(report!.hp).toBe(-10);
    expect(report!.relicId).not.toBeNull();
    expect(RELICS[report!.relicId!].tier).toBe('common');
    expect(run.relics).toContain(report!.relicId!);
  });

  it('官渡焚粮 · 尽数运回 pays 70 資財 and inflicts 奢靡', () => {
    const { run, report } = take('guandufenliang', 1, 'gdfl-1');
    expect(report!.gold).toBe(70);
    expect(report!.curseIds).toEqual(['shemi']);
    expect(run.deck.filter((c) => c.defId === 'shemi')).toHaveLength(1);
  });

  it('官渡焚粮 · 不敢妄动 moves nothing at all', () => {
    const { run, report } = take('guandufenliang', 2, 'gdfl-2');
    expect(report!.gold).toBe(0);
    expect(report!.hp).toBe(0);
    expect(report!.relicId).toBeNull();
    expect(run.deck.some((c) => c.defId === 'shemi')).toBe(false);
  });

  it('醉酒张飞 heals to full for a 旧伤, or pays 10 体力 for nothing', () => {
    const wounded = fresh('zjzf-0');
    const id = eventNode(wounded);
    pin(wounded, id, 'zuijiuzhangfei');
    wounded.hp = 20;
    const drunk = chooseOption(wounded, id, 0)!;
    expect(wounded.hp).toBe(wounded.maxHp);
    expect(drunk.curseIds).toEqual(['jiushang']);

    const sober = fresh('zjzf-1');
    const soberId = eventNode(sober);
    pin(sober, soberId, 'zuijiuzhangfei');
    sober.hp = 20;
    expect(chooseOption(sober, soberId, 1)!.hp).toBe(10);
    expect(sober.hp).toBe(30);
    expect(sober.deck.some((c) => c.defId === 'jiushang')).toBe(false);
  });

  it('荒径无人 pays 25 資財 or nothing, and is never rolled into a node', () => {
    expect(EVENTS.some((d) => d.id === FALLBACK_EVENT.id)).toBe(false);
    const run = fresh('floor-event');
    const id = eventNode(run);
    roomRecord(run, id, 'event').eventId = FALLBACK_EVENT.id;
    expect(chooseOption(run, id, 0)!.gold).toBe(25);
  });

  it('never writes the floor event into seenEvents', () => {
    // It is not in `EVENTS`, so `eligible` can never filter against it —
    // recording it only puts an id in the save that nothing will ever read.
    const run = fresh('floor-seen');
    run.seenEvents = EVENTS.map((d) => d.id);
    const id = eventNode(run);
    run.map.nodes.get(id)!.row = 0;
    // Row 0 with every non-`once` repeat also spent leaves nothing eligible.
    run.seenEvents = EVENTS.map((d) => d.id);
    const before = [...run.seenEvents];
    ensureEvent(run, id);
    expect(run.seenEvents).toEqual(before);
    expect(run.seenEvents).not.toContain(FALLBACK_EVENT.id);
  });
});

// --------------------------------------------------- 结算顺序与边界

describe('applyOutcome ordering and boundaries', () => {
  const only = (outcome: Parameters<typeof applyOutcome>[1], run: RunState) =>
    applyOutcome(run, outcome, new Rng('outcome'));

  it('spends the purse before it fills it, not after', () => {
    // 五丈原 charges the purse it *found*. Nothing in the table pairs
    // `spendAllGold` with positive `gold` yet, so swapping the two lines was
    // invisible — and the day one is added, the bug is silent money.
    const run = fresh('order');
    run.gold = 200;
    const report = only({ text: '', spendAllGold: true, gold: 30 }, run);
    expect(run.gold).toBe(30);
    expect(report.gold).toBe(-170);
  });

  it('flags lethal on a wound that exactly empties the bar', () => {
    // `<= 0`, not `< 0`. At the boundary the run is over — a player left
    // standing on exactly 0 with no flag would walk on dead.
    const run = fresh('exact');
    run.hp = 12;
    const report = only({ text: '', hp: -12 }, run);
    expect(report.lethal).toBe(true);
    expect(run.hp).toBe(0);
    expect(report.lines).toContain('伤重不治，命陨于此。');

    const survived = fresh('spare');
    survived.hp = 13;
    expect(only({ text: '', hp: -12 }, survived).lethal).toBe(false);
    expect(survived.hp).toBe(1);
  });

  it('hands over the exact cards an outcome names', () => {
    // `gainCards.ids` is a real branch that no event uses yet, so the loop over
    // it could be deleted without a single test noticing.
    const run = fresh('named-cards');
    const before = run.deck.length;
    const report = only({ text: '', gainCards: { ids: ['wenjiu', 'wanren'], upgraded: 1 } }, run);
    expect(report.cardIds).toEqual(['wenjiu', 'wanren']);
    expect(run.deck).toHaveLength(before + 2);
    for (const id of ['wenjiu', 'wanren']) {
      expect(run.deck.find((c) => c.defId === id)!.upgraded).toBe(1);
    }
  });

  it('never hands the same card twice out of one gainCards', () => {
    // 秘录 asks for three cards out of a 稀有 pool holding exactly three, which
    // is the whole point of it — and with a with-replacement `rng.pick` it paid
    // two of a kind in 76% of seeds, for the largest price in the table.
    // Swept, not spot-checked: one bad seed proves nothing either way.
    for (const hero of HEROES_IN_ORDER) {
      for (let i = 0; i < 300; i++) {
        const run = startRun(hero, `dup-${hero.id}-${i}`);
        const report = applyOutcome(
          run,
          { text: '', gainCards: { count: 3, rarity: 'rare' } },
          new Rng(`dup-${hero.id}-${i}`),
        );
        expect(report.cardIds).toHaveLength(3);
        expect(new Set(report.cardIds).size, `${hero.id}/${i}: ${report.cardIds}`).toBe(3);
      }
    }
  });

  it('still draws once per card when the pool is smaller than the ask', () => {
    // R3: filtering narrows *what* comes out, never how many times the stream
    // is pulled. Asking for more cards than exist must repeat rather than
    // silently spend fewer draws and shift everything downstream.
    const run = fresh('overask');
    const rng = new Rng('overask');
    const pool = poolFor(run.hero.id, 'rare');
    const report = applyOutcome(run, { text: '', gainCards: { count: pool.length + 2, rarity: 'rare' } }, rng);
    expect(report.cardIds).toHaveLength(pool.length + 2);
    expect(rng.rolls).toBe(pool.length + 2);
    // The first pass is still exhaustive before anything repeats.
    expect(new Set(report.cardIds.slice(0, pool.length)).size).toBe(pool.length);
  });

  it('floors a removal at four cards, the same floor 弃卡 answers to', () => {
    // `RoomHost.pickCards` only clamps against what is *selectable*, which for
    // a removal is the whole deck. An outcome asking for three off a
    // three-card deck emptied it, and the next fight could not deal a hand.
    const run = fresh('strip');
    const id = eventNode(run);
    pin(run, id, 'wuzhangyuan');
    run.deck = run.deck.slice(0, 5);
    roomCommit(run, id).mark('pending:remove:99');

    expect(resolvePending(run, id, run.deck.map((c) => c.uid))).toBe(true);
    expect(run.deck).toHaveLength(4);
  });
});

// ------------------------------------------------------------------ 叙述

describe('the narration a player actually reads', () => {
  it('names the relic it handed over', () => {
    const run = fresh('narrate-relic');
    const id = eventNode(run);
    pin(run, id, 'guandufenliang');
    const report = chooseOption(run, id, 0)!;
    expect(report.lines).toContain(`得宝物「${RELICS[report.relicId!].name}」。`);
  });

  it('calls a wound a wound and a cure a cure', () => {
    // `report.hp - report.maxHp` with its sign flipped reported 「回复体力 8」
    // for an 8-体力 wound, and 764 lines of event tests never read a line.
    const hurt = fresh('narrate-hurt');
    hurt.hp = 60;
    const wound = applyOutcome(hurt, { text: '', hp: -8 }, new Rng('n'));
    expect(wound.lines).toContain('失去体力 8。');
    expect(wound.lines.join()).not.toContain('回复体力');

    const healed = fresh('narrate-heal');
    healed.hp = 60;
    const cure = applyOutcome(healed, { text: '', hp: 8 }, new Rng('n'));
    expect(cure.lines).toContain('回复体力 8。');

    // A 体力上限 gain heals for what it grants and must be called out once.
    const grown = fresh('narrate-max');
    const grow = applyOutcome(grown, { text: '', maxHp: 15 }, new Rng('n'));
    expect(grow.lines).toContain('体力上限 +15。');
    expect(grow.lines.join()).not.toContain('回复体力');
  });

  it('does not bill a lost ceiling as extra cure', () => {
    // 于吉符水 is the first outcome to pair `healToFull` with a *negative*
    // `maxHp`. The old `report.hp - report.maxHp` re-billed the loss as cure:
    // a 48-点 heal read as 「回复体力 52」. Only a positive ceiling change
    // carries an implicit heal.
    const run = fresh('narrate-ceiling');
    run.hp = 30;
    const report = applyOutcome(run, { text: '', maxHp: -4, healToFull: true }, new Rng('n'));
    expect(report.lines).toContain('体力上限 -4。');
    expect(report.lines).toContain(`回复体力 ${run.hp - 30}。`);
  });

  it('says so when the shelf was bare and coin stood in', () => {
    const run = fresh('narrate-refused');
    for (const def of relicsOfTier('common')) addRelic(run, def.id);
    for (const def of relicsOfTier('uncommon')) addRelic(run, def.id);
    for (const def of relicsOfTier('rare')) addRelic(run, def.id);
    const report = applyOutcome(run, { text: '', gainRelic: { tier: 'common' } }, new Rng('n'));
    expect(report.relicRefused).toBe(true);
    expect(report.lines).toContain('库中已无可取之物，折作资财。');
  });

  it('warns that steel is coming', () => {
    const run = fresh('narrate-fight');
    const report = applyOutcome(run, { text: '', fight: { tier: 'monster' } }, new Rng('n'));
    expect(report.lines).toContain('刀兵已至。');
  });

  it('gives 弃 / 精进 / 易 three different lines', () => {
    // 易牌 and 换血 swap each card for another of the same rarity and the deck
    // ends exactly as large as it started. Sharing 「择牌弃之」 with `remove`
    // told the player they were about to lose two cards when they lose none —
    // and the same wrong line covered every 奇遇 and 祝福 with `transformCards`.
    const line = (o: Parameters<typeof applyOutcome>[1]): string[] =>
      applyOutcome(fresh('narrate-pending'), o, new Rng('n')).lines;

    expect(line({ text: '', removeCards: 2 })).toContain('择牌弃之。');
    expect(line({ text: '', upgradeCards: 2 })).toContain('择牌精进。');
    expect(line({ text: '', transformCards: 2 })).toContain('择牌易之。');
    // The one that was wrong: a 换 must never be announced as a 弃.
    expect(line({ text: '', transformCards: 2 }).join()).not.toContain('弃');
  });
});

// ------------------------------------------------------- 打起来就关掉事件

describe('a fight closes the event whichever option started it', () => {
  it('shuts 山中残兵 down the moment the ambush lands', () => {
    // 继续搜寻 is `repeatable`, so its commit key is `opt:0#n` and the
    // resolved test does not match it. Without the explicit `mark(optKey(0))`
    // the node stays open and the whole room can be farmed again after the
    // fight the player was just handed.
    for (let i = 0; i < 200; i++) {
      const run = fresh(`ambush-${i}`);
      const id = eventNode(run);
      pin(run, id, 'shanzhongcanbing');
      let ambushed = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const report = chooseOption(run, id, 0);
        if (!report) break;
        if (report.fight) {
          ambushed = true;
          break;
        }
      }
      if (!ambushed) continue;
      expect(isResolved(run, id), `seed ${i}`).toBe(true);
      expect(chooseOption(run, id, 0)).toBeNull();
      expect(chooseOption(run, id, 1)).toBeNull();
      expect(hasEnabledOption(run, id)).toBe(false);
      return;
    }
    throw new Error('no ambush landed in 200 runs');
  });
});

// ------------------------------------------- 奇遇打起来的那一仗，账记在哪

describe('a fight an 奇遇 started gets its own ledger', () => {
  const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const readSrc = (path: string): string => SOURCES[`../${path}`];

  /** Walk an event node exactly the way `nav.enterRoom` + `EventController` do. */
  function standOnEvent(seed: string, eventId: string): { run: RunState; id: string } {
    const run = fresh(seed);
    const id = eventNode(run);
    run.currentNodeId = id;
    roomCommit(run, id).once('enter', () => undefined);
    pin(run, id, eventId);
    return { run, id };
  }

  it('does not ask an event node for a combat record', () => {
    // The failure this replaces: `goCombat` stops 「Map」 and starts 「Combat」,
    // whose `create()` ran `ensureEncounter(run, currentNodeId, tier)`. By then
    // the node held a `{ kind: 'event' }` record, `roomRecord` threw on the
    // mismatch, and it threw *before* the first Game Object — black screen with
    // no map behind it and no way back into the run.
    const { run, id } = standOnEvent('event-fight', 'jiangdong');
    expect(run.rooms[id]!.kind).toBe('event');
    expect(() => ensureEncounter(run, id, 'elite')).toThrow(/not combat/);

    // What the room layer hands the scene instead.
    const fightId = eventFightNodeId(id);
    expect(fightId).not.toBe(id);
    const encounter = ensureEncounter(run, fightId, 'elite');
    expect(encounter.id).toBeTruthy();
    expect(run.rooms[fightId]!.kind).toBe('combat');
    // Both ledgers coexist; neither overwrote the other.
    expect(run.rooms[id]!.kind).toBe('event');
    expect(() => claimVictoryRelic(run, fightId, 'elite')).not.toThrow();
  });

  it('freezes the ambush fight the same way a map node freezes one', () => {
    // R5 still applies: the fight the player walked into is the fight they
    // fight, even if the scene is rebuilt.
    const { run, id } = standOnEvent('ambush-ledger', 'shanzhongcanbing');
    const fightId = eventFightNodeId(id);
    const first = ensureEncounter(run, fightId, 'monster');
    const before = run.actCombatCount;
    expect(ensureEncounter(run, fightId, 'monster').id).toBe(first.id);
    expect(run.actCombatCount).toBe(before);
  });

  it('gives the fight its own streams, separate from the event that started it', () => {
    // Sharing them would let the event's branch roll and the fight's shuffle
    // read the same numbers.
    const { run, id } = standOnEvent('streams', 'jiangdong');
    const fightId = eventFightNodeId(id);
    for (const purpose of ['combat', 'reward', 'potion'] as const) {
      expect(streamSeed(run, fightId, purpose)).not.toBe(streamSeed(run, id, purpose));
    }
    // `#` is not a legal map node id, so the derived id can never shadow one.
    expect([...run.map.nodes.keys()].some((k) => k.includes('#'))).toBe(false);
  });

  it('is what RoomScene actually hands to CombatScene', () => {
    // The wiring no unit test can reach — the same source-text technique
    // `tests/combatScene.test.ts` uses on the rest of the scene.
    const roomScene = readSrc('src/scenes/RoomScene.ts');
    const at = roomScene.indexOf('private goCombat');
    expect(at).toBeGreaterThan(-1);
    const body = roomScene.slice(at, roomScene.indexOf('\n  }', at));
    expect(body).toContain('eventFightNodeId(this.node.id)');
  });

  it('is what CombatScene prefers over the node the player is standing on', () => {
    const combatScene = readSrc('src/scenes/CombatScene.ts');
    // Order matters: `currentNodeId` first would put the fight back on the
    // event's own ledger and throw again.
    expect(combatScene).toContain('this.nodeId = this.ledgerId ?? this.run.currentNodeId');
    // And it has to be reset per fight, or a map fight after an 奇遇 fight
    // inherits the derived id and books its spoils on the wrong ledger.
    const init = combatScene.slice(
      combatScene.indexOf('  init(data:'),
      combatScene.indexOf('\n  }', combatScene.indexOf('  init(data:')),
    );
    expect(init).toContain('this.ledgerId = data?.nodeId ?? null');
  });
});

// ------------------------------------------------------------- 二十池的新八事

/**
 * 每个新事件一组数字断言，延续「三个没人点名的事件」的教训：没有被点名的
 * 数字就是可以随意漂移的数字。分支事件按 华佗 的办法扫种子，比率给宽带
 * （65% ±3σ@200 在 0.55–0.75，35%/45% 同理，带宽再放半档）。
 */
describe('the eight events of the wider pool', () => {
  const take = (eventId: string, index: number, seed: string): { run: RunState; id: string; report: ReturnType<typeof chooseOption> } => {
    const run = fresh(seed);
    const id = eventNode(run);
    pin(run, id, eventId);
    return { run, id, report: chooseOption(run, id, index) };
  };

  it('月旦评 · 依评黜陟 swaps exactly two cards and keeps the deck the same size', () => {
    const { run, id, report } = take('yuedanping', 0, 'ydp-0');
    expect(report!.pending).toEqual({ kind: 'transform', count: 2 });
    const size = run.deck.length;
    const uids = run.deck.slice(0, 2).map((c) => c.uid);
    expect(resolvePending(run, id, uids)).toBe(true);
    expect(run.deck.length).toBe(size);
    for (const uid of uids) expect(run.deck.map((c) => c.uid)).not.toContain(uid);
  });

  it('呼卢喝雉 bars the table below 50 資財 and settles ±50 at house odds', () => {
    const broke = fresh('hlz-broke');
    const bid = eventNode(broke);
    pin(broke, bid, 'huluhezhi');
    broke.gold = 49;
    expect(eventOptions(broke, bid)[0].disabled).toBe(true);
    expect(eventOptions(broke, bid)[0].disabledReason).toBe('需 50 资财');
    expect(chooseOption(broke, bid, 0)).toBeNull();

    let wins = 0;
    for (let i = 0; i < 400; i++) {
      const { report } = take('huluhezhi', 0, `hlz-${i}`);
      expect(Math.abs(report!.gold)).toBe(50);
      if (report!.gold > 0) wins += 1;
    }
    // 45% 的胜面，55% 的庄家——EV −5，抽头明码。
    expect(wins / 400).toBeGreaterThan(0.35);
    expect(wins / 400).toBeLessThan(0.55);
  });

  it('青梅煮酒 pours two bottles or plants 疑心, at roughly 65/35', () => {
    let bottles = 0;
    let doubts = 0;
    for (let i = 0; i < 200; i++) {
      const { run, report } = take('qingmeizhujiu', 0, `qmz-${i}`);
      if (report!.curseIds.length > 0) {
        expect(report!.curseIds).toEqual(['yixin']);
        expect(run.deck.at(-1)!.defId).toBe('yixin');
        expect(report!.potionIds).toHaveLength(0);
        doubts += 1;
      } else {
        expect(report!.potionIds.length + report!.potionRefused).toBe(2);
        bottles += 1;
      }
    }
    expect(bottles + doubts).toBe(200);
    expect(bottles / 200).toBeGreaterThan(0.5);
    expect(bottles / 200).toBeLessThan(0.8);
  });

  it('白门楼 · 松绑而纳 hands two distinct 罕见 cards with 反噬 chained on', () => {
    const { run, report } = take('baimenlou', 0, 'bml-0');
    expect(report!.cardIds).toHaveLength(2);
    expect(new Set(report!.cardIds).size).toBe(2);
    for (const cardId of report!.cardIds) {
      expect(CARD_POOL_BY_RARITY.uncommon).toContain(cardId);
    }
    expect(report!.curseIds).toEqual(['fanshi']);
    expect(run.deck.at(-1)!.defId).toBe('fanshi');
  });

  it('白门楼 · 明正典刑 pays 55 and leaves the deck alone', () => {
    const { run, report } = take('baimenlou', 1, 'bml-1');
    expect(report!.gold).toBe(55);
    expect(run.deck.some((c) => c.defId === 'fanshi')).toBe(false);
  });

  it('文姬归汉 wants the full hundred before it opens, then charges it whole', () => {
    const run = fresh('wjg-gate');
    const id = eventNode(run);
    pin(run, id, 'wenjiguihan');
    // 开局 99 資財——差一金，门就不开。
    const views = eventOptions(run, id);
    expect(views[0].disabled).toBe(true);
    expect(views[0].disabledReason).toBe('需 100 资财');

    run.gold = 150;
    const report = chooseOption(run, id, 0)!;
    expect(report.gold).toBe(-100);
    expect(run.gold).toBe(50);
    expect(report.pending).toEqual({ kind: 'remove', count: 2 });
    const size = run.deck.length;
    expect(resolvePending(run, id, run.deck.slice(0, 2).map((c) => c.uid))).toBe(true);
    expect(run.deck.length).toBe(size - 2);
  });

  it('于吉符水 heals to a ceiling four lower, and says both numbers straight', () => {
    const run = fresh('yjf-0');
    const id = eventNode(run);
    pin(run, id, 'yujifushui');
    run.hp = 30;
    const report = chooseOption(run, id, 0)!;
    expect(run.maxHp).toBe(DEFAULT_HERO.maxHp - 4);
    expect(run.hp).toBe(run.maxHp);
    expect(report.maxHp).toBe(-4);
    expect(report.lines).toContain('体力上限 -4。');
    expect(report.lines).toContain(`回复体力 ${DEFAULT_HERO.maxHp - 4 - 30}。`);
  });

  it('败走华容 · 依令擒之 pays a 罕见 up front and closes into a monster fight', () => {
    const { run, id, report } = take('baizouhuarong', 0, 'bzh-0');
    expect(RELICS[report!.relicId!].tier).toBe('uncommon');
    expect(run.relics).toContain(report!.relicId!);
    expect(report!.fight).toEqual({ tier: 'monster' });
    expect(isResolved(run, id)).toBe(true);
  });

  it('败走华容 keeps the chase behind the risk floor', () => {
    const run = fresh('bzh-floor');
    const id = eventNode(run);
    pin(run, id, 'baizouhuarong');
    run.hp = Math.floor(run.maxHp * 0.25);
    expect(eventOptions(run, id)[0].disabled).toBe(true);
    expect(chooseOption(run, id, 0)).toBeNull();
  });

  it('败走华容 · 念旧放行 heals to full and hangs 宿命 over the deck', () => {
    const run = fresh('bzh-1');
    const id = eventNode(run);
    pin(run, id, 'baizouhuarong');
    run.hp = 25;
    const report = chooseOption(run, id, 1)!;
    expect(run.hp).toBe(run.maxHp);
    expect(report.curseIds).toEqual(['suming']);
  });

  it('汉水暴溢 charges 12 体力 for a 罕见, or pays 35 for mercy', () => {
    const a = take('hanshuibaoyi', 0, 'hsb-0');
    expect(a.report!.hp).toBe(-12);
    expect(RELICS[a.report!.relicId!].tier).toBe('uncommon');

    const b = take('hanshuibaoyi', 1, 'hsb-1');
    expect(b.report!.gold).toBe(35);
    expect(b.report!.hp).toBe(0);
  });
});
