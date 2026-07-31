import Phaser from 'phaser';
import { C } from '../config';
import type { RoomController, RoomHost } from '../scenes/RoomScene';
import { bodyStyle, brushStyle } from '../ui/theme';
import {
  applyCampfireOption,
  campfireOptions,
  canLeaveCampfire,
  forgeDisabledReason,
  isCampfireSpent,
  type CampfireOptionId,
  type CampfireReport,
} from './campfire';

/**
 * 营帐 — the fire, the two offers, and the one night they share.
 *
 * Everything that decides anything lives in `campfire.ts`; this file draws a
 * fire and reads a report. In particular it never calls `heal` or
 * `upgradeCard`, and it never touches the one-shot gate — the forge overlay can
 * be opened, cancelled and opened again precisely *because* the camp is not
 * spent until the pure layer says so.
 */

/** Ember flicker. Slow enough to read as breathing, not as a strobe. */
const FLICKER_MS = 900;

export class CampfireController implements RoomController {
  private host!: RoomHost;
  private flicker: Phaser.Tweens.Tween | null = null;

  enter(host: RoomHost): void {
    this.host = host;
    host.setTitle('营帐', '休整疗伤，或参悟兵法。');

    if (isCampfireSpent(host.run, host.node.id)) {
      // Back on a camp that was already used — a reloaded save, or a fight taken
      // from somewhere else and walked back out of.
      host.showResult(['薪尽火冷，此间已无可为。'], '离 营');
      return;
    }

    this.drawFire();
    this.showMenu();
  }

  /** The camp holds the player until it is used — see `canLeaveCampfire`. */
  canLeave(): boolean {
    return canLeaveCampfire(this.host.run, this.host.node.id);
  }

  dispose(): void {
    this.stopFire();
  }

  /** `showResult` destroys the layer the glow lives on; the tween has to go
   *  with it rather than keep writing to a dead Game Object. */
  private stopFire(): void {
    this.flicker?.remove();
    this.flicker = null;
  }

  // ----------------------------------------------------------------- drawing

  private centre(): { x: number; y: number } {
    const { area } = this.host;
    return { x: area.x + area.w / 2, y: area.y + area.h / 2 };
  }

  private drawFire(): void {
    const { scene } = this.host;
    const { area } = this.host;
    const layer = this.host.layer();
    const cx = area.x + area.w / 2;

    const glow = scene.add.graphics();
    glow.fillStyle(C.cinnabar, 0.22);
    glow.fillEllipse(cx, area.y + 96, 260, 90);
    glow.fillStyle(0xd98b3a, 0.35);
    glow.fillEllipse(cx, area.y + 96, 150, 54);
    glow.fillStyle(C.goldBright, 0.5);
    glow.fillEllipse(cx, area.y + 96, 74, 26);
    layer.add(glow);

    // One tween on the whole glow rather than three on three ellipses: the fire
    // should breathe as one body of light.
    this.flicker = scene.tweens.add({
      targets: glow,
      alpha: { from: 0.78, to: 1 },
      scaleY: { from: 0.94, to: 1.06 },
      duration: FLICKER_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    layer.add(
      scene.add
        .text(cx, area.y + 20, '〔 篝火正旺 〕', brushStyle(30, 0xd98b3a))
        .setOrigin(0.5)
        .setLetterSpacing(6),
    );
    layer.add(
      scene.add
        .text(
          cx,
          area.y + 140,
          '夜宿荒营，火光映甲。伤处可疗，兵刃可淬。',
          bodyStyle(17, C.paperDim),
        )
        .setOrigin(0.5)
        .setLetterSpacing(2),
    );
    layer.add(
      scene.add
        .text(cx, area.y + 176, '一夜苦短，只得择其一。', bodyStyle(15, C.cinnabarBright))
        .setOrigin(0.5)
        .setLetterSpacing(4),
    );
  }

  private showMenu(): void {
    const { host } = this;
    // Blocked while the night is still ahead; the moment nothing can be done
    // here — full health, a deck already at its peak — the door opens again.
    host.setEscPolicy(this.canLeave() ? 'leave' : 'blocked');
    // `showOptions` already runs its callback through `host.action`, so a click
    // landing during the exit fade is dropped before it reaches this.
    host.showOptions(campfireOptions(host.run, host.node.id), (id) =>
      this.pick(id as CampfireOptionId),
    );
  }

  // ------------------------------------------------------------------ acting

  private pick(id: CampfireOptionId): void {
    if (id === 'smith') {
      this.openForge();
      return;
    }
    const { host } = this;
    this.resolve(applyCampfireOption(host.run, host.node.id, 'rest'));
  }

  /**
   * The whole deck, not just what can be forged: seeing 铁壁·精 greyed out is
   * how the player learns the upgrade already happened. `compareUpgrade` puts
   * the current face beside the forged one — 6 → 9 is the decision, and it has
   * to be visible before the night is spent.
   */
  private openForge(): void {
    const { host } = this;
    host.pickCards({
      title: '锻 造',
      subtitle: '择一牌精进，火候只此一回',
      count: 1,
      compareUpgrade: true,
      confirmText: '入 炉',
      footerHint: '择一牌精进　·　Esc 另作打算',
      cancellable: true,
      disable: (card) => forgeDisabledReason(card),
      onPick: (uids) => {
        const uid = uids[0];
        // No card came back (an empty forge, or a cancel routed here): the camp
        // is untouched, so put the menu back rather than resolving nothing.
        if (!uid) {
          this.showMenu();
          return;
        }
        this.resolve(applyCampfireOption(host.run, host.node.id, 'smith', { uid }));
      },
      onCancel: () => this.showMenu(),
    });
  }

  /**
   * `null` means the pure layer refused — the camp is still unlit, so the menu
   * comes back rather than the room resolving into nothing.
   */
  private resolve(report: CampfireReport | null): void {
    const { host } = this;
    if (!report) {
      this.showMenu();
      return;
    }

    const { x, y } = this.centre();
    this.stopFire();
    host.refreshHud();

    if (report.id === 'rest') {
      host.floatText(x, y - 40, `+${report.healed}`, 'gold');
      const lines = ['篝火哔剥，血痂渐合。', `体力回复 ${report.healed} 点，今为 ${report.hp} / ${report.maxHp}。`];
      // Only worth saying when the wound was smaller than the night's rest.
      // Both numbers come off the report: the view used to recompute the offer
      // itself from a helper that was already capped by the wound, which made
      // this comparison `x < x` and this line unreachable.
      if (report.healed < report.offered) lines.push('伤已痊愈，余下的力气便留给明日。');
      host.showResult(lines, '离 营');
      return;
    }

    const name = report.card!.name;
    host.floatText(x, y - 40, name, 'gold');
    host.showResult([`炉火通红，${name} 淬炼而成。`, '刃上新霜，来日可期。'], '离 营');
  }
}
