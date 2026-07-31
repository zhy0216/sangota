import Phaser from 'phaser';
import { C } from '../config';
import { canUpgrade } from '../combat/cards';
import type { RoomController, RoomHost } from '../scenes/RoomScene';
import { bodyStyle } from '../ui/theme';
import {
  chooseOption,
  ensureEvent,
  eventOptions,
  hasEnabledOption,
  isResolved,
  pendingPick,
  resolvePending,
  type OutcomeReport,
  type PendingPick,
} from './events';
import type { EventDef } from '../data/events';

/**
 * 奇遇 — the paint. Every decision in this file is about pixels: which event a
 * node carries, what an option costs and whether a take is allowed all belong
 * to `events.ts`, and this controller only ever asks it and draws the answer.
 *
 * Note what is absent, and is checked to be absent by `tests/integrity.test.ts`:
 * no `commit.once`, and not one call that writes to `RunState`. A view that
 * paid out directly would pay twice the first time a player walked back in.
 */

/** Body copy sits above the option row, inside the panel. */
const BODY_TOP = 214;
const LINE_H = 32;
/** Long enough to read the line the ambush arrived on. */
const FIGHT_BEAT = 900;

export class EventController implements RoomController {
  private host!: RoomHost;
  private def!: EventDef;
  /** Redrawn in place rather than stacked — each outcome replaces the scene. */
  private body!: Phaser.GameObjects.Container;
  /** True while an outcome is in flight: bars a second click and the exit. */
  private busy = false;
  /** True once the room has drawn its terminal result. */
  private done = false;
  /** Options taken here, including repeated searches. */
  private taken = 0;

  enter(host: RoomHost): void {
    this.host = host;
    this.def = ensureEvent(host.run, host.node.id);
    host.setTitle(this.def.name, this.def.sub);

    if (isResolved(host.run, host.node.id)) {
      // Walked back in. The event is spent — but "spent" and "settled" are not
      // the same thing: 卧龙岗 charges 12 体力 and 五丈原 the whole purse
      // *before* the deck grid opens, and `pendingPick` is written to the
      // ledger precisely so the debt survives the room being rebuilt. Paying
      // and then showing 「此地之事，已了。」 would pocket it.
      const owed = pendingPick(host.run, host.node.id);
      if (owed) {
        this.collectOwedPick(owed);
        return;
      }
      this.done = true;
      host.showResult(['此地之事，已了。'], '离 去');
      return;
    }

    // An event is a decision, so the exit is barred until one is made. The
    // 「离 去」 button stays on screen and lit throughout — Esc is only ever its
    // shortcut — and it opens the moment a choice has been made, or the moment
    // nothing on the board can be clicked at all.
    host.setEscPolicy('blocked');
    this.body = host.layer();
    this.narrate(this.def.body.split('\n'));
    this.offer();
  }

  canLeave(): boolean {
    if (this.done) return true;
    if (this.busy) return false;
    if (this.taken > 0) return true;
    return !hasEnabledOption(this.host.run, this.host.node.id);
  }

  // ----------------------------------------------------------------- drawing

  private narrate(lines: string[]): void {
    this.body.removeAll(true);
    const { area } = this.host;
    lines.forEach((line, i) => {
      this.body.add(
        this.host.scene.add
          .text(area.x + area.w / 2, BODY_TOP + i * LINE_H, line, {
            ...bodyStyle(19, C.paper),
            align: 'center',
            wordWrap: { width: area.w - 40 },
          })
          .setOrigin(0.5, 0)
          .setLetterSpacing(1),
      );
    });
  }

  private offer(): void {
    this.host.showOptions(eventOptions(this.host.run, this.host.node.id), (id) =>
      this.pick(Number(id)),
    );
  }

  // ------------------------------------------------------------------ taking

  private pick(index: number): void {
    if (this.busy || this.done) return;
    const report = chooseOption(this.host.run, this.host.node.id, index);
    // null means the take was refused — a double click, or a stale button left
    // live while the option row redraws. The run is untouched either way.
    if (!report) return;

    this.busy = true;
    this.taken += 1;
    this.host.refreshHud();
    this.floatDeltas(report);

    if (report.pending) {
      this.collectPick(report);
      return;
    }
    this.settle(report);
  }

  /** Floating numbers over the panel — the HUD line alone is too quiet for a
   *  20 体力 wound to register as one. */
  private floatDeltas(report: OutcomeReport): void {
    const mid = this.host.area.x + this.host.area.w / 2;
    if (report.gold !== 0) {
      this.host.floatText(mid - 130, 400, `${report.gold > 0 ? '+' : ''}${report.gold}`, 'gold');
    }
    if (report.hp !== 0) {
      this.host.floatText(
        mid + 130,
        400,
        `${report.hp > 0 ? '+' : ''}${report.hp}`,
        report.hp > 0 ? 'default' : 'danger',
      );
    }
  }

  /**
   * The deck grid for 卧龙岗 / 五丈原. Mandatory: the outcome has already been
   * paid for, so there is nothing to cancel back to. `RoomHost.pickCards`
   * clamps the count to what is actually selectable and calls straight back
   * with an empty list when nothing is, which is what keeps a deck of
   * fully-forged cards from locking the room shut.
   */
  private collectPick(report: OutcomeReport): void {
    this.openPickGrid(report.pending!, () => this.settle(report));
  }

  /**
   * The same grid, opened on re-entry for a pick this node had already paid for
   * and never collected. There is no report to settle into — the outcome text
   * was shown on the visit that bought it — so this ends the room outright.
   */
  private collectOwedPick(pick: PendingPick): void {
    this.openPickGrid(pick, () => {
      this.done = true;
      this.host.showResult(['旧事已了。'], '离 去');
    });
  }

  private openPickGrid(pick: PendingPick, done: () => void): void {
    const forge = pick.kind === 'upgrade';

    this.host.pickCards({
      title: forge ? '精 进' : '弃 牌',
      subtitle: forge ? '择牌改之。' : '割爱一张。',
      count: pick.count,
      compareUpgrade: forge,
      footerHint: forge ? `请择 ${pick.count} 张精进` : `请择 ${pick.count} 张弃去`,
      cancellable: false,
      ...(forge
        ? { disable: (card) => (canUpgrade(card.defId, card.upgraded) ? null : '已至极致') }
        : {}),
      onPick: (uids) => {
        resolvePending(this.host.run, this.host.node.id, uids);
        this.host.refreshHud();
        done();
      },
    });
  }

  /**
   * Where an option ends up. Three exits: into a fight, back to the option row
   * (a repeatable search the player has not called off yet), or into the
   * terminal result panel.
   */
  private settle(report: OutcomeReport): void {
    if (report.fight) {
      // Deliberately *not* `showResult`: that unblocks Esc, and leaving during
      // the beat would fire `goCombat` into a scene the player had already left.
      // `busy` stays true, so `canLeave` keeps refusing until the scene changes.
      this.narrate(report.lines);
      this.host.showOptions([], () => undefined);
      this.host.scene.time.delayedCall(FIGHT_BEAT, () => this.host.goCombat(report.fight!));
      return;
    }

    if (!isResolved(this.host.run, this.host.node.id)) {
      // 山中残兵 — the search paid and may be repeated. The outcome replaces the
      // scene text; the buttons come straight back.
      this.narrate(report.lines);
      this.offer();
      this.busy = false;
      this.host.setEscPolicy('leave');
      return;
    }

    this.done = true;
    this.host.showResult(report.lines, '离 去');
  }
}
