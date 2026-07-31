import type { Rng } from '../core/rng';
import type { CardRarity } from '../combat/types';
import { getCard, poolFor } from '../combat/cards';
import { getPotion, rollPotion } from '../combat/potions';
import { getRelic } from '../combat/relics';
import { rollRelicOfTier } from '../combat/rewards';
import {
  addCard,
  addCurse,
  addGold,
  addPotion,
  addRelic,
  heal,
  removableCount,
  removeCard,
  upgradeCard,
  type RunState,
} from '../state/run';
import {
  EVENTS,
  FALLBACK_EVENT,
  getEvent,
  type EventDef,
  type EventOption,
  type EventOutcome,
  type EventRelicTier,
} from '../data/events';
import { roomCommit, roomRecord } from './commit';
import { stream } from './rng';
import type { DeckPick, RoomOptionView } from './types';

/**
 * 奇遇 — the rules half. Everything that touches `RunState` for an event is in
 * this file; `eventView.ts` only ever renders what these functions hand back.
 *
 * Three properties this module owes the rest of the game:
 *
 * **The same seed shows the same event.** Which event a node carries is rolled
 * once and written into `run.rooms[nodeId].eventId` (R5). Leaving and coming
 * back re-reads it — a re-roll would produce something else, because the pool
 * is filtered against `seenEvents` and that list grew when the first roll
 * landed.
 *
 * **The same seed resolves the same way.** Each option-take draws from its own
 * `eventBranch:{n}` stream, `n` being how many options this node had already
 * taken. A repeatable option therefore gets a fresh stream per attempt, and no
 * option's dice can shift any other decision point in the run.
 *
 * **An option pays once.** Every payout goes through `commit.once`, so a
 * double-click, a stale button during the exit fade and a save reloaded on the
 * same node all pay exactly the same as one click.
 */

// ------------------------------------------------------------------- reports

/**
 * A deck pick a node still owes. Aliased onto the room layer's shared
 * `DeckPick` (`./types`) because 开局祝福 parks the identical shape on
 * `run.blessing` and both go through `applyPick`.
 */
export type PendingPick = DeckPick;

/**
 * What actually happened, as opposed to what the table asked for — the relic
 * that was rolled, the coin the 聚宝盆 multiplier turned 30 into, the bottle
 * the belt had no room for. The view prints this and nothing else.
 */
export interface OutcomeReport {
  /** The resolved outcome's own narration; a branch's, when one was taken. */
  text: string;
  /** Ready-to-draw result lines, real numbers already substituted. */
  lines: string[];
  /** Signed deltas, measured across the whole application. */
  gold: number;
  hp: number;
  maxHp: number;
  relicId: string | null;
  /** A relic was promised and the shelf was bare — the coin below stood in. */
  relicRefused: boolean;
  /** Bottles that fit. */
  potionIds: string[];
  /** Bottles rolled that the belt had no room for. */
  potionRefused: number;
  cardIds: string[];
  curseIds: string[];
  /** A deck pick the view still has to collect. See `resolvePending`. */
  pending?: PendingPick;
  /**
   * The wound would have killed. Phase three clamps at 1 体力 instead: the
   * defeat screen is private to `CombatScene` and the room layer cannot reach
   * it (todo 22). The field is here so that lifting the clamp is a one-line
   * change rather than a redesign.
   */
  lethal: boolean;
  fight?: { tier: 'monster' | 'elite'; bonusRelic?: string };
}

// --------------------------------------------------------------- commit keys

/** Non-repeatable take. Its presence is what "this event is resolved" means. */
const optKey = (index: number): string => `opt:${index}`;
/** Repeatable take. Deliberately *not* matched by the resolved test below. */
const attemptKey = (index: number, attempt: number): string => `opt:${index}#${attempt}`;
const PENDING_DONE = 'pending:done';
const pendingKey = (pick: PendingPick): string => `pending:${pick.kind}:${pick.count}`;

/** Matches `opt:3` but not `opt:3#1` — searching a wood does not end the event. */
const RESOLVING = /^opt:\d+$/;

/** True once some non-repeatable option has been taken at this node. */
export function isResolved(run: RunState, nodeId: string): boolean {
  return (run.rooms[nodeId]?.committed ?? []).some((key) => RESOLVING.test(key));
}

// ----------------------------------------------------------------- selection

/**
 * The pool, narrowed but never rolled — this runs before the single draw so
 * that adding an event to the table cannot change how many numbers a node
 * pulls (R3).
 *
 * De-duplication is against the whole pool and not just `once` events: 3.14
 * event rooms against twelve events means a repeat is the *norm* without it.
 * When the pool runs dry the repeats are let back in, minus anything flagged
 * `once` — that flag outlives the exhaustion, which is the whole of what it
 * means.
 */
function eligible(run: RunState, row: number): EventDef[] {
  const onFloor = EVENTS.filter((def) => row >= (def.minRow ?? 0));
  const unseen = onFloor.filter((def) => !run.seenEvents.includes(def.id));
  if (unseen.length > 0) return unseen;
  const repeatable = onFloor.filter((def) => !def.once);
  return repeatable.length > 0 ? repeatable : [];
}

/**
 * R5 — the node's event, rolled on first sight and read back forever after.
 * Exactly one draw on the `event` stream, whatever the pool looks like.
 */
export function ensureEvent(run: RunState, nodeId: string): EventDef {
  const record = roomRecord(run, nodeId, 'event');
  if (record.eventId) return getEvent(record.eventId);

  const row = run.map.nodes.get(nodeId)?.row ?? 0;
  const pool = eligible(run, row);
  // Draw #1, and the only one. `int(0)` would still consume a number, but it
  // would also always return 0, so the max keeps the index honest as well.
  const index = stream(run, nodeId, 'event').int(Math.max(1, pool.length));
  const def = pool[index] ?? FALLBACK_EVENT;

  record.eventId = def.id;
  // The floor is 「never rolled and never de-duplicated」 by definition — it is
  // not in `EVENTS`, so `eligible` can never filter against it. Writing it into
  // `seenEvents` only puts an id in the save that nothing will ever read.
  if (def.id !== FALLBACK_EVENT.id && !run.seenEvents.includes(def.id)) {
    run.seenEvents.push(def.id);
  }
  return def;
}

/**
 * Button models for this node's event. An option the player cannot afford is
 * greyed with its reason attached rather than hidden — a hidden option is
 * indistinguishable from an event that simply does not have one.
 */
export function eventOptions(run: RunState, nodeId: string): RoomOptionView[] {
  const def = ensureEvent(run, nodeId);
  return def.options.map((opt, index) => {
    const view: RoomOptionView = { id: String(index), label: opt.label, hint: opt.hint };
    if (opt.tone) view.tone = opt.tone;
    if (opt.requires && !opt.requires(run)) {
      view.disabled = true;
      view.disabledReason = opt.requiresText ?? '时机未到。';
    }
    return view;
  });
}

/** True when nothing on the board can be clicked — the room must let go. */
export function hasEnabledOption(run: RunState, nodeId: string): boolean {
  if (isResolved(run, nodeId)) return false;
  return eventOptions(run, nodeId).some((view) => !view.disabled);
}

// ------------------------------------------------------------------ choosing

/**
 * Take an option. `null` means the take was refused — already resolved, this
 * exact attempt already paid, an unknown index, or a requirement that is not
 * met — and in every one of those cases `run` is left untouched.
 */
export function chooseOption(run: RunState, nodeId: string, index: number): OutcomeReport | null {
  const def = ensureEvent(run, nodeId);
  const opt: EventOption | undefined = def.options[index];
  if (!opt) return null;
  if (opt.requires && !opt.requires(run)) return null;
  if (isResolved(run, nodeId)) return null;

  const commit = roomCommit(run, nodeId);
  const key = opt.repeatable ? attemptKey(index, commit.count(`${optKey(index)}#`)) : optKey(index);
  if (commit.isDone(key)) return null;

  // Read *before* the gate marks this take: `once` marks on the way in, so
  // asking afterwards would already count the attempt being started.
  const taken = commit.count('opt:');
  const rng = stream(run, nodeId, `eventBranch:${taken}`);

  const report = commit.once(key, () => applyOutcome(run, opt.outcome, rng)) ?? null;
  // The pick itself is collected by the view and applied by `resolvePending`;
  // the ledger carries the request across so a reload cannot lose it.
  if (report?.pending) commit.mark(pendingKey(report.pending));
  // A fight closes the event whichever option started it — 山中残兵's ambush
  // ends the search, and the ledger has to say so even though the option that
  // triggered it was repeatable.
  if (report?.fight) commit.mark(optKey(index));
  return report;
}

// ------------------------------------------------------------------ outcomes

/**
 * What a failed relic roll pays instead. Constant, not rolled — R3.
 *
 * Keyed by *tier* rather than by `RelicSource`, so this is not a second copy of
 * `RELIC_MISS_GOLD`: an event names the tier it promised, and a refused 稀有 owes
 * 90 even though every event shares one source. The 常见 40 / 罕见 60 / 稀有 90
 * pricing is the same ladder `RELIC_MISS_GOLD` is priced off; move both together.
 */
const RELIC_CONSOLATION: Record<EventRelicTier, number> = {
  common: 40,
  uncommon: 60,
  rare: 90,
};

// The fallback ladder an 奇遇 relic walks — degrade first, then promote, so a
// run holding every 稀有 is handed a 罕见 rather than nothing — lives in
// `rollRelicOfTier` (`src/combat/rewards.ts`) and is shared with 精英/宝藏/坊市
// drops. This file used to carry its own copy while todo 10 was unlanded; the
// two agreed draw-for-draw, and keeping both would have been two places to get
// the degrade order wrong. `EventRelicTier` is a subset of `RelicTier` by
// construction: 首领 and 坊市 pools are closed, and an event may not reach in.

/**
 * The branch switch, and the *first* draw on the stream whenever an outcome has
 * one. Fixing its position is what keeps a branch's result stable when a grant
 * is later added to one of the branches.
 */
function resolveBranch(outcome: EventOutcome, rng: Rng): EventOutcome {
  if (!outcome.branches || outcome.branches.length === 0) return outcome;
  return rng.weighted(
    outcome.branches.map((b) => b.outcome),
    outcome.branches.map((b) => b.weight),
  );
}

/**
 * Apply one outcome and report what it actually did.
 *
 * The draw order on `rng` is fixed by the outcome's *declaration* and never by
 * what a roll produced: branch, then relic, then potions, then cards. Nothing
 * else in the module draws.
 *
 * Damage is clamped to leave 1 体力. See `OutcomeReport.lethal` for why.
 */
export function applyOutcome(run: RunState, outcome: EventOutcome, rng: Rng): OutcomeReport {
  const o = resolveBranch(outcome, rng);
  const hpBefore = run.hp;
  const goldBefore = run.gold;
  const maxHpBefore = run.maxHp;

  const report: OutcomeReport = {
    text: o.text,
    lines: [],
    gold: 0,
    hp: 0,
    maxHp: 0,
    relicId: null,
    relicRefused: false,
    potionIds: [],
    potionRefused: 0,
    cardIds: [],
    curseIds: [],
    lethal: false,
  };

  // -- 资财. Spending first: 五丈原 charges the purse it found, not the one the
  // same outcome is about to fill.
  if (o.spendAllGold) run.gold = 0;
  if (o.gold) addGold(run, o.gold);

  // -- 体力上限. A gain heals for what it grants, exactly the way `addRelic`
  // does, so raising the ceiling is never a way to look wounded.
  if (o.maxHp) {
    const gained = Math.max(1, run.maxHp + o.maxHp) - run.maxHp;
    run.maxHp += gained;
    if (gained > 0) run.hp += gained;
    run.hp = Math.min(run.hp, run.maxHp);
  }

  // -- 体力. Losses are summed and applied once so that a flat wound and a
  // percentage wound in the same outcome both bite the pre-wound total.
  let damage = 0;
  if (o.hp && o.hp < 0) damage += -o.hp;
  if (o.hpLossPercent) damage += Math.ceil(run.hp * o.hpLossPercent);
  if (o.hp && o.hp > 0) heal(run, o.hp);
  if (damage > 0) {
    report.lethal = run.hp - damage <= 0;
    run.hp = Math.max(1, run.hp - damage);
  }
  if (o.healToFull) heal(run, run.maxHp);

  // -- 宝物
  if (o.gainRelic) {
    const wanted =
      'id' in o.gainRelic ? o.gainRelic.id : rollRelicOfTier(rng, run, o.gainRelic.tier);
    if (wanted && addRelic(run, wanted)) {
      report.relicId = wanted;
    } else {
      // Nothing left on the shelf, or a duplicate of something already owned.
      const tier: EventRelicTier = 'tier' in o.gainRelic ? o.gainRelic.tier : 'common';
      addGold(run, RELIC_CONSOLATION[tier]);
      report.relicRefused = true;
    }
  }

  // -- 丹药
  for (let i = 0; i < (o.gainPotion ?? 0); i++) {
    const id = rollPotion(rng);
    if (addPotion(run, id)) report.potionIds.push(id);
    else report.potionRefused += 1;
  }

  // -- 牌
  if (o.gainCards) {
    for (const id of o.gainCards.ids ?? []) {
      addCard(run, id, o.gainCards.upgraded ?? 0);
      report.cardIds.push(id);
    }
    const pool = poolFor(run.hero.id, o.gainCards.rarity ?? 'common');
    for (let i = 0; i < (o.gainCards.count ?? 0); i++) {
      const id = rng.pick(pool);
      addCard(run, id, o.gainCards.upgraded ?? 0);
      report.cardIds.push(id);
    }
  }

  // 诅咒 has its own door: `addCard` throws on one, deliberately, so that a
  // curse can never arrive through a reward path by accident.
  if (o.gainCurse) {
    addCurse(run, o.gainCurse);
    report.curseIds.push(o.gainCurse);
  }

  if (o.removeCards) report.pending = { kind: 'remove', count: o.removeCards };
  else if (o.upgradeCards) report.pending = { kind: 'upgrade', count: o.upgradeCards };
  else if (o.transformCards) report.pending = { kind: 'transform', count: o.transformCards };
  if (o.fight) report.fight = o.fight;

  report.gold = run.gold - goldBefore;
  report.hp = run.hp - hpBefore;
  report.maxHp = run.maxHp - maxHpBefore;
  report.lines = describe(report);
  return report;
}

// ------------------------------------------------------------------- pending

/** The deck pick this node still owes, or null. Parsed off the ledger so that
 *  it survives a reload with no new save field. */
export function pendingPick(run: RunState, nodeId: string): PendingPick | null {
  const committed = run.rooms[nodeId]?.committed ?? [];
  if (committed.includes(PENDING_DONE)) return null;
  for (const key of committed) {
    const match = /^pending:(remove|upgrade|transform):(\d+)$/.exec(key);
    if (match) return { kind: match[1] as PendingPick['kind'], count: Number(match[2]) };
  }
  return null;
}

/** The node half of a deck pick: the one-shot gate, then `applyPick`. */
export function resolvePending(run: RunState, nodeId: string, uids: string[]): boolean {
  const pick = pendingPick(run, nodeId);
  if (!pick) return false;
  return (
    roomCommit(run, nodeId).once(PENDING_DONE, () => {
      // The stream is built only for 易牌 — a purpose that draws nothing for
      // the other two kinds cannot shift anything downstream of it (R3).
      const rng = pick.kind === 'transform' ? stream(run, nodeId, 'blessingTransform') : undefined;
      applyPick(run, pick, uids, rng);
      return true;
    }) ?? false
  );
}

/**
 * The rarity band a copy is exchanged for. 起手牌 are all `basic` and no pool
 * has a `basic` key, so without this mapping 易牌 would draw from an empty pool
 * 100% of the time on turn one of a run.
 */
export const transformRarity = (defId: string): Exclude<CardRarity, 'basic'> => {
  const rarity = getCard(defId).rarity;
  return rarity === 'basic' ? 'common' : rarity;
};

/**
 * Apply a deck pick. **The one implementation** — the node path
 * (`resolvePending`, gated by `commit.once`) and 开局祝福 (gated by
 * `run.blessing.pending`) both call it, each carrying its own door.
 *
 * Extra uids beyond what was asked for are dropped rather than honoured, and a
 * short list is fine — `RoomHost.pickCards` clamps a request of two against a
 * deck with one upgradable card down to one, and calls back with an empty list
 * when nothing at all qualifies.
 *
 * A removal is additionally floored at `MIN_DECK_SIZE`, the same floor 弃卡
 * answers to. `RoomHost.pickCards` only clamps against how many cards are
 * *selectable*, which for a removal is the whole deck — so an outcome asking
 * for three off a three-card deck emptied it and the next fight could not deal
 * an opening hand. 易牌 is not floored: it hands one back for every one taken.
 *
 * `rng` is required for 易牌 and unused otherwise. Exactly one draw per card
 * transformed, spent against the filtered pool whether or not it had anything
 * in it (R3) — the same-name exclusion is a *filter*, never a re-roll loop.
 */
export function applyPick(
  run: RunState,
  pick: PendingPick,
  uids: readonly string[],
  rng?: Rng,
): void {
  const allowed = pick.kind === 'remove' ? Math.min(pick.count, removableCount(run)) : pick.count;
  for (const uid of uids.slice(0, allowed)) {
    if (pick.kind === 'remove') {
      removeCard(run, uid);
      continue;
    }
    if (pick.kind === 'upgrade') {
      upgradeCard(run, uid);
      continue;
    }
    const card = run.deck.find((c) => c.uid === uid);
    if (!card || !rng) continue;
    const pool = poolFor(run.hero.id, transformRarity(card.defId)).filter(
      (id) => id !== card.defId,
    );
    const at = rng.int(Math.max(1, pool.length));
    const replacement = pool[at];
    removeCard(run, uid);
    if (replacement) addCard(run, replacement);
  }
}

// ----------------------------------------------------------------- narration

/**
 * The result lines, built here rather than in the view: they quote numbers the
 * view has no way to recompute (what the 聚宝盆 multiplier turned 30 into, which
 * relic the ladder degraded to) and the room layer already knows all of them.
 */
function describe(report: OutcomeReport): string[] {
  const lines: string[] = [];
  if (report.text) lines.push(report.text);

  if (report.gold > 0) lines.push(`资财 +${report.gold}。`);
  else if (report.gold < 0) lines.push(`资财 ${report.gold}。`);

  if (report.maxHp !== 0) {
    lines.push(`体力上限 ${report.maxHp > 0 ? '+' : ''}${report.maxHp}。`);
  }
  // The max-HP heal is already inside `hp`; calling it out twice would read as
  // two separate gains.
  const woundOrCure = report.hp - report.maxHp;
  if (woundOrCure > 0) lines.push(`回复体力 ${woundOrCure}。`);
  else if (woundOrCure < 0) lines.push(`失去体力 ${-woundOrCure}。`);
  if (report.lethal) lines.push('几乎丧命，只余一息。');

  if (report.relicId) lines.push(`得宝物「${getRelic(report.relicId)?.name ?? report.relicId}」。`);
  else if (report.relicRefused) lines.push('库中已无可取之物，折作资财。');
  for (const id of report.potionIds) lines.push(`得丹药「${getPotion(id).name}」。`);
  if (report.potionRefused > 0) lines.push(`丹药囊已满，${report.potionRefused} 瓶只得作罢。`);
  for (const id of report.cardIds) lines.push(`「${getCard(id).name}」入册。`);
  for (const id of report.curseIds) lines.push(`「${getCard(id).name}」缠身。`);
  if (report.pending) {
    lines.push(report.pending.kind === 'upgrade' ? '择牌精进。' : '择牌弃之。');
  }
  if (report.fight) lines.push('刀兵已至。');
  return lines;
}
