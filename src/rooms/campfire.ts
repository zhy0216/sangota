import { canUpgrade, resolveCard } from '../combat/cards';
import { hasRelic, heal, upgradeCard, upgradableCards, type DeckCard, type RunState } from '../state/run';
import { roomCommit } from './commit';
import type { RoomOptionView } from './types';

/**
 * 营帐 — the one room whose whole point is that you cannot have both.
 *
 * A campfire is a single decision: heal, or get stronger. That tension only
 * exists because the two share **one** ledger key (`rest`, see the key table in
 * the phase-three contract), so committing either one closes the other. There
 * is no second key, no per-option flag, and no way for a view to spend the camp
 * twice — 「选完不可反悔」 is a property of the gate, not of a disabled button.
 *
 * Nothing here draws from an `Rng`: a campfire has no randomness to materialise
 * and its ledger record stays `{ kind: 'rest', committed: ['rest'] }` forever.
 * `tests/rooms.campfire.test.ts` asserts that record shape exactly, which is
 * what keeps a stray roll from creeping in later.
 */

/** The whole camp, spelled once. Both options burn it. */
const CAMP_KEY = 'rest';

export type CampfireOptionId = 'rest' | 'smith';

export interface CampfireReport {
  id: CampfireOptionId;
  /** HP that actually landed — 0 for 锻造, and less than the full roll near max. */
  healed: number;
  /**
   * What the night was worth before the wound capped it, i.e. `restAmount`.
   *
   * Reported rather than left to the view to recompute: the view had
   * `restGain` — already `min(offered, missing)` and therefore exactly what
   * `heal` returns — so its 「healed < offered」 test was a tautological false
   * and the line behind it could never print. A number the room layer knows is
   * a number the room layer should hand over.
   */
  offered: number;
  hp: number;
  maxHp: number;
  /** The copy that was forged, named as it reads *after* the upgrade. */
  card: { uid: string; defId: string; name: string } | null;
}

/**
 * A menu entry before the run is consulted. The table is the extension point:
 * 掘藏 / 弃甲 / 举鼎 are one row each, gated by `unlock`, the day the relics
 * behind them exist. They do not exist today — `RELICS` has no 工兵铲, 静心香
 * or 石鼎 — so the menu ships with the two permanent rows and no dead rows
 * pretending otherwise.
 */
export interface CampfireOptionDef {
  id: CampfireOptionId;
  label: string;
  /** Relic id that puts this row on the menu at all. Undefined = always on it. */
  unlock?: string;
  tone?: RoomOptionView['tone'];
  /** The line under the label. Quotes live numbers, so it must read the run. */
  hint: (run: RunState) => string;
  /** null when the row can be taken; a string is the reason it is greyed. */
  blocked: (run: RunState) => string | null;
}

/**
 * What 休整 would restore if taken right now, capped by the wound.
 *
 * 天命 (todos/19 a3)：比例从 `run.mods.restHealPercent` 读——零重 50、
 * 五重起 40，见 `ASCENSION_STEPS`。难度修改一律
 * 走集中修饰器，这里不许再长第二个数。
 */
export const restAmount = (run: RunState): number =>
  Math.round((run.maxHp * run.mods.restHealPercent) / 100);
export const restGain = (run: RunState): number =>
  Math.min(restAmount(run), run.maxHp - run.hp);

/** Why this copy cannot go on the anvil, or null if it can. */
export const forgeDisabledReason = (card: DeckCard): string | null =>
  canUpgrade(card.defId, card.upgraded) ? null : '已至极致';

export const CAMPFIRE_OPTIONS: CampfireOptionDef[] = [
  {
    id: 'rest',
    label: '休 整',
    hint: (run) => `回复 ${restGain(run)} 点体力`,
    blocked: (run) => (run.hp >= run.maxHp ? '体力已满' : null),
  },
  {
    id: 'smith',
    label: '锻 造',
    tone: 'gold',
    hint: () => '精进一张牌，永久生效',
    blocked: (run) => (upgradableCards(run).length === 0 ? '无可精进之牌' : null),
  },
];

const unlocked = (run: RunState, def: CampfireOptionDef): boolean =>
  !def.unlock || hasRelic(run, def.unlock);

/**
 * The menu as buttons. Split from `campfireOptions` so the relic gate can be
 * tested against a row that does not exist yet — the mechanism is what has to
 * work on the day todo 01 adds 工兵铲, not today's two rows.
 */
export function campfireMenu(
  run: RunState,
  spent: boolean,
  defs: CampfireOptionDef[] = CAMPFIRE_OPTIONS,
): RoomOptionView[] {
  return defs
    .filter((def) => unlocked(run, def))
    .map((def) => {
      // A spent camp greys every row for the same reason, whatever each row
      // would otherwise have said: there is no night left, not "no wound left".
      const reason = spent ? '一夜已尽' : def.blocked(run);
      const view: RoomOptionView = { id: def.id, label: def.label, hint: def.hint(run) };
      if (def.tone) view.tone = def.tone;
      if (reason) {
        view.disabled = true;
        view.disabledReason = reason;
      }
      return view;
    });
}

export const isCampfireSpent = (run: RunState, nodeId: string): boolean =>
  roomCommit(run, nodeId).isDone(CAMP_KEY);

export function campfireOptions(run: RunState, nodeId: string): RoomOptionView[] {
  return campfireMenu(run, isCampfireSpent(run, nodeId));
}

/**
 * Whether the player may walk out. A campfire refuses Esc *and* its own leave
 * button until it has been used — walking past one is throwing a heal away, and
 * a mis-click on the map should not be able to do that silently.
 *
 * The escape hatch matters more than the rule: a full-health player holding a
 * fully-upgraded deck can take neither option, and without this they would be
 * sealed in the tent with two grey buttons.
 */
export function canLeaveCampfire(run: RunState, nodeId: string): boolean {
  if (isCampfireSpent(run, nodeId)) return true;
  return !campfireOptions(run, nodeId).some((opt) => !opt.disabled);
}

/** The physical copy 锻造 would work on, or null if the request is not legal. */
function forgeTarget(run: RunState, uid: string | undefined): DeckCard | null {
  if (!uid) return null;
  const card = run.deck.find((c) => c.uid === uid);
  if (!card || forgeDisabledReason(card)) return null;
  return card;
}

/**
 * Take one option. `null` means nothing happened *and the camp is still unlit* —
 * a refused choice must never cost the night.
 *
 * Every reason to refuse is therefore checked **before** the gate: `once` marks
 * its key ahead of running the body, so a 锻造 with no legal card behind it
 * would otherwise burn the whole campfire and hand back nothing.
 */
export function applyCampfireOption(
  run: RunState,
  nodeId: string,
  id: CampfireOptionId,
  arg?: { uid?: string },
): CampfireReport | null {
  const def = CAMPFIRE_OPTIONS.find((o) => o.id === id);
  if (!def || !unlocked(run, def) || def.blocked(run)) return null;

  const target = id === 'smith' ? forgeTarget(run, arg?.uid) : null;
  if (id === 'smith' && !target) return null;

  return (
    roomCommit(run, nodeId).once(CAMP_KEY, (): CampfireReport => {
      if (id === 'rest') {
        // `heal` clamps, so the report carries what landed rather than what was
        // offered — the result line must not claim 25 when 5 was the whole wound.
        const offered = restAmount(run);
        const healed = heal(run, offered);
        return { id, healed, offered, hp: run.hp, maxHp: run.maxHp, card: null };
      }
      const card = target!;
      upgradeCard(run, card.uid);
      return {
        id,
        healed: 0,
        offered: 0,
        hp: run.hp,
        maxHp: run.maxHp,
        // Read after the upgrade: the name the player is shown is the forged one.
        card: { uid: card.uid, defId: card.defId, name: resolveCard(card.defId, card.upgraded).name },
      };
    }) ?? null
  );
}
