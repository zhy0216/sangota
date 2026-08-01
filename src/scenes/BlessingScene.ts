import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { canUpgrade } from '../combat/cards';
import {
  blessingPending,
  blessingSettled,
  blessingTaken,
  blessingViews,
  ensureBlessing,
  resolveBlessingPick,
  takeBlessing,
  type BlessingView,
} from '../rooms/blessing';
import { getRun, removableCount, removeDisabledReason, type RunState } from '../state/run';
import { writeSave } from '../state/save';
import { isCardGridOpen, openCardGrid, type CardGridEntry } from '../ui/CardGrid';
import { useDesignSpace } from '../ui/designSpace';
import { groundSprite } from '../ui/spriteBounds';
import { bodyStyle, brushStyle, gradientStrip, inkButton, inkPanel } from '../ui/theme';
import { popText } from '../ui/vfx';

/**
 * 拜别 · 出征前夜 — the 开局祝福 screen.
 *
 * A scene of its own rather than a `RoomController`, for one blunt reason:
 * `RoomScene` is addressed by node id from the first line of `init` to the last
 * line of `leave`, and a 祝福 has no node. `RoomHost` hands a controller a
 * `MapNode` and a `RoomCommit`; neither exists before the player has stood
 * anywhere. What it *does* share with the room layer is the discipline: not one
 * statement in this file writes to `RunState`. Every payout goes through
 * `src/rooms/blessing.ts`, behind the one-shot gate that lives there.
 *
 * The screen is a fork in the road, so it is deliberately hard to leave: there
 * is no 「离去」, Esc does not dismiss it, and the deck grid a gift opens is
 * mandatory. The only way out is forward.
 */

const DEPTH = { bg: 0, art: 5, panel: 10, rows: 20, chrome: 100 } as const;

/** The four-up. One column, because a 2×2 grid reads as two pairs. */
const ROW = { x: 452, y: 132, w: 800, h: 112, gap: 14 } as const;

/** 道人's side of the screen. */
const FIGURE = { x: 40, y: 96, w: 380, h: 520 } as const;

/** Content height of the 道人 plate — his feet land just above the caption. */
const FIGURE_ART_H = 300;

const CONFIRM_Y = GAME_HEIGHT - 56;

export class BlessingScene extends Phaser.Scene {
  private run!: RunState;
  /** One-way exit gate — the same one every other scene keeps. */
  private leaving = false;
  /** True from the moment 「就此定夺」 is pressed until the result is drawn. */
  private busy = false;
  private picked: string | null = null;

  private rows: { view: BlessingView; paint: (state: 'idle' | 'hover' | 'picked') => void }[] = [];
  private rowLayer!: Phaser.GameObjects.Container;
  private confirmRow!: Phaser.GameObjects.Container;
  private resultLayer!: Phaser.GameObjects.Container;
  private hudText!: Phaser.GameObjects.Text;
  private speech!: Phaser.GameObjects.Text;

  constructor() {
    super('Blessing');
  }

  /** Per-visit reset. A class-field initialiser runs once per *game*, not once
   *  per visit — see 「scene state does not survive」 in `tests/integrity.test.ts`. */
  init(): void {
    this.leaving = false;
    this.busy = false;
    this.picked = null;
    this.rows = [];
  }

  create(): void {
    useDesignSpace(this);
    this.run = getRun();

    this.paintBackdrop();
    this.paintChrome();

    this.rowLayer = this.add.container(0, 0).setDepth(DEPTH.rows);
    this.confirmRow = this.add.container(0, 0).setDepth(DEPTH.chrome);
    this.resultLayer = this.add.container(0, 0).setDepth(DEPTH.rows);

    // Already answered — a reload, or a second entry through some future door.
    // Nothing is re-rolled and nothing is re-paid; the debt is settled if one
    // is still owed, and the run moves on.
    if (blessingTaken(this.run)) {
      const owed = blessingPending(this.run);
      if (owed) this.collectPick();
      else this.showResult(['此别已定。'], '启 程');
      this.cameras.main.fadeIn(420, 8, 6, 4);
      return;
    }

    // R5 — the four-up is materialised here, on first sight, and read back
    // unchanged forever after.
    ensureBlessing(this.run);
    this.buildRows();

    this.input.keyboard?.on('keydown-ESC', () => this.nudge());
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.picked) this.confirm();
    });
    this.cameras.main.fadeIn(620, 8, 6, 4);
  }

  // ------------------------------------------------------------------ 布景

  /**
   * Night, a hill road, one lamp. The painted plate is laid out to match the
   * wash below it — shrine and moon on the left under 道人, the right side left
   * quiet for the four rows — so the two are interchangeable. The wash stays as
   * the fallback: it is honest about a missing plate in a way a missing-texture
   * checkerboard is not.
   */
  private paintBackdrop(): void {
    this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 1)
      .setOrigin(0, 0)
      .setDepth(DEPTH.bg);

    if (this.textures.exists('blessing-bg')) {
      this.add
        .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'blessing-bg')
        .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
        .setDepth(DEPTH.bg);
      // The plate is a night scene already; this only seats the rows on it.
      gradientStrip(this, 0, GAME_HEIGHT - 200, GAME_WIDTH, 200, C.inkDeep, 0, 0.94).setDepth(
        DEPTH.bg,
      );
      return;
    }

    const wash = this.add.graphics().setDepth(DEPTH.bg);
    // A low moon behind the figure, and the ridge line under it.
    wash.fillStyle(C.paperDim, 0.06);
    wash.fillCircle(FIGURE.x + FIGURE.w / 2, 250, 128);
    wash.fillStyle(C.paperDim, 0.03);
    wash.fillCircle(FIGURE.x + FIGURE.w / 2, 250, 190);
    wash.fillStyle(C.ink, 0.9);
    wash.beginPath();
    wash.moveTo(0, GAME_HEIGHT);
    wash.lineTo(0, 470);
    for (let x = 0; x <= GAME_WIDTH; x += 160) {
      wash.lineTo(x + 80, 470 - (x % 320 === 0 ? 34 : 8));
      wash.lineTo(x + 160, 470 + (x % 320 === 0 ? 12 : 30));
    }
    wash.lineTo(GAME_WIDTH, GAME_HEIGHT);
    wash.closePath();
    wash.fillPath();

    gradientStrip(this, 0, GAME_HEIGHT - 200, GAME_WIDTH, 200, C.inkDeep, 0, 0.94).setDepth(
      DEPTH.bg,
    );
  }

  private paintChrome(): void {
    this.add
      .text(GAME_WIDTH / 2, 32, '拜 别 · 出 征 前 夜', brushStyle(38, C.goldBright))
      .setOrigin(0.5, 0)
      .setLetterSpacing(10)
      .setDepth(DEPTH.chrome);
    this.add
      .text(GAME_WIDTH / 2, 84, '山道古庙 · 灯下一卦', bodyStyle(14, C.paperFaint))
      .setOrigin(0.5, 0)
      .setLetterSpacing(4)
      .setDepth(DEPTH.chrome);

    // 道人. Grounded by silhouette like every other cut-out, so the figure's
    // feet land on the caption rule rather than wherever the plate's transparent
    // margin happens to end. A seal-script watermark stands in until the
    // painting lands, the way 选将 does for a hero with no portrait yet.
    if (this.textures.exists('daoren')) {
      const feet = this.add
        .container(FIGURE.x + FIGURE.w / 2, FIGURE.y + FIGURE_ART_H)
        .setDepth(DEPTH.art);
      const sprite = this.add.image(0, 0, 'daoren').setOrigin(0.5, 1);
      groundSprite(this, sprite, FIGURE_ART_H);
      feet.add(sprite);
    } else {
      this.add
        .text(FIGURE.x + FIGURE.w / 2, FIGURE.y + 150, '道', brushStyle(260, C.paperFaint))
        .setOrigin(0.5)
        .setAlpha(0.18)
        .setDepth(DEPTH.art);
    }
    this.add
      .text(FIGURE.x + FIGURE.w / 2, FIGURE.y + 320, '云游道人', brushStyle(28, C.paper))
      .setOrigin(0.5)
      .setLetterSpacing(6)
      .setDepth(DEPTH.art);

    this.add
      .graphics()
      .setDepth(DEPTH.panel)
      .lineStyle(1, C.gold, 0.35)
      .lineBetween(FIGURE.x + 60, FIGURE.y + 356, FIGURE.x + FIGURE.w - 60, FIGURE.y + 356);

    this.speech = this.add
      .text(FIGURE.x + FIGURE.w / 2, FIGURE.y + 380, '「将军此去，可有所求？\n　　四者取一，取过不悔。」', {
        ...bodyStyle(17, C.paperDim),
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.art);

    this.hudText = this.add
      .text(GAME_WIDTH - 26, 26, '', bodyStyle(15, C.paperDim))
      .setOrigin(1, 0)
      .setLetterSpacing(2)
      .setDepth(DEPTH.chrome);
    this.refreshHud();
  }

  private refreshHud(): void {
    const { run } = this;
    this.hudText.setText(
      `${run.hero.name}　·　体力 ${run.hp} / ${run.maxHp}　·　资财 ${run.gold}　·　牌组 ${run.deck.length}`,
    );
  }

  // ------------------------------------------------------------------ 四选一

  private buildRows(): void {
    const views = blessingViews(this.run);
    views.forEach((view, i) => {
      const y = ROW.y + i * (ROW.h + ROW.gap);
      const container = this.add.container(ROW.x, y).setAlpha(0);

      const bg = this.add.graphics();
      const paint = (state: 'idle' | 'hover' | 'picked'): void => {
        const border = state === 'picked' ? C.cinnabar : state === 'hover' ? C.goldBright : C.gold;
        bg.clear();
        bg.fillStyle(C.inkDeep, state === 'idle' ? 0.74 : 0.92);
        bg.fillRoundedRect(0, 0, ROW.w, ROW.h, 4);
        bg.lineStyle(state === 'picked' ? 2 : 1, border, state === 'idle' ? 0.5 : 1);
        bg.strokeRoundedRect(0, 0, ROW.w, ROW.h, 4);
        bg.lineStyle(1, C.paper, state === 'idle' ? 0.06 : 0.16);
        bg.strokeRoundedRect(5, 5, ROW.w - 10, ROW.h - 10, 2);
      };
      paint('idle');

      // The class first — 交易 must be readable as a class before the player
      // reads what it pays, or the price line looks like a punishment.
      const tag = this.add
        .text(24, 18, view.categoryLabel, bodyStyle(13, C.gold))
        .setLetterSpacing(4);
      const label = this.add.text(24, 44, view.label, brushStyle(38, C.paper)).setLetterSpacing(4);
      const desc = this.add.text(150, view.cost ? 34 : 46, view.desc, {
        ...bodyStyle(17, C.paper),
        wordWrap: { width: ROW.w - 190 },
        lineSpacing: 4,
      });
      container.add([bg, tag, label, desc]);

      if (view.cost) {
        container.add(
          this.add.text(150, 70, view.cost, {
            ...bodyStyle(16, C.cinnabarBright),
            wordWrap: { width: ROW.w - 190 },
          }),
        );
      }

      const hit = this.add.zone(ROW.w / 2, ROW.h / 2, ROW.w, ROW.h).setInteractive({
        useHandCursor: true,
      });
      hit.on('pointerover', () => paint(this.picked === view.id ? 'picked' : 'hover'));
      hit.on('pointerout', () => paint(this.picked === view.id ? 'picked' : 'idle'));
      hit.on('pointerup', () => this.select(view.id));
      container.add(hit);

      this.rowLayer.add(container);
      this.tweens.add({ targets: container, alpha: 1, duration: 460, delay: 260 + i * 110 });
      this.rows.push({ view, paint });
    });
  }

  private select(id: string): void {
    if (this.leaving || this.busy || isCardGridOpen(this)) return;
    this.picked = id;
    for (const row of this.rows) row.paint(row.view.id === id ? 'picked' : 'idle');
    this.showConfirm();
  }

  /**
   * The second step the design asks for. An irreversible choice made on one
   * click is a choice made by accident — and this one is the run's first fork.
   */
  private showConfirm(): void {
    this.confirmRow.removeAll(true);
    const view = this.rows.find((r) => r.view.id === this.picked)?.view;
    if (!view) return;

    this.confirmRow.add(
      this.add
        .text(
          ROW.x + 12,
          CONFIRM_Y,
          view.cost ? `取「${view.label}」　${view.cost}` : `取「${view.label}」。`,
          bodyStyle(15, view.cost ? C.cinnabarBright : C.paperDim),
        )
        .setOrigin(0, 0.5),
    );
    this.confirmRow.add(
      inkButton(this, ROW.x + ROW.w - 320, CONFIRM_Y, '再 想 想', {
        width: 150,
        height: 48,
        fontSize: 20,
        accent: C.paperFaint,
        onClick: () => this.cancel(),
      }),
    );
    this.confirmRow.add(
      inkButton(this, ROW.x + ROW.w - 130, CONFIRM_Y, '就此定夺', {
        width: 190,
        height: 52,
        fontSize: 24,
        onClick: () => this.confirm(),
      }),
    );
  }

  private cancel(): void {
    if (this.leaving || this.busy) return;
    this.picked = null;
    for (const row of this.rows) row.paint('idle');
    this.confirmRow.removeAll(true);
  }

  private confirm(): void {
    if (this.leaving || this.busy || !this.picked || isCardGridOpen(this)) return;
    this.busy = true;
    this.confirmRow.removeAll(true);

    // The single write, and the only one this file makes. A second click during
    // the fade below is refused twice over: by `busy` here, and by `takenId`
    // inside `takeBlessing`.
    const report = takeBlessing(this.run, this.picked);
    if (!report) {
      this.busy = false;
      return;
    }

    this.refreshHud();
    popText(this, ROW.x + ROW.w / 2, 300, '天意如此', {
      color: C.goldBright,
      size: 44,
      depth: DEPTH.chrome + 40,
    });

    this.tweens.add({
      targets: this.rowLayer,
      alpha: 0,
      duration: 420,
      onComplete: () => {
        this.rowLayer.removeAll(true);
        if (blessingPending(this.run)) {
          this.showResult(report.lines, '启 程', false);
          this.collectPick();
          return;
        }
        this.showResult(report.lines, '启 程');
      },
    });
  }

  // -------------------------------------------------------------------- 选牌

  /**
   * The deck grid a gift opens — 弃芜 / 精简 / 锻炼 / 易牌.
   *
   * Mandatory: no `onClose`, so the overlay has no × and no Esc. The debt is
   * already paid for at this point, and `run.blessing.pending` carries it
   * across a reload precisely so it cannot be pocketed.
   */
  private collectPick(): void {
    const pick = blessingPending(this.run);
    if (!pick) return;

    const upgrade = pick.kind === 'upgrade';
    const pool = upgrade
      ? this.run.deck.filter((card) => canUpgrade(card.defId, card.upgraded))
      : this.run.deck;
    const entries: CardGridEntry[] = pool.map((card) => {
      const entry: CardGridEntry = { ...card };
      // 弃芜/易牌都是「从牌组移除」的门：不可移除的牌（宿业，天命十重的开局
      // 诅咒就在这副牌里）压暗不可选。`applyPick` 在门后还有同一道闸。
      const reason = upgrade ? null : removeDisabledReason(card);
      if (reason) {
        entry.disabled = true;
        entry.disabledReason = reason;
      }
      return entry;
    });
    // Copies, never the deck's own objects. The count is clamped twice over:
    // against what is actually selectable here, and against `MIN_DECK_SIZE`
    // inside `applyPick` — a grid that asks for a card it will then refuse to
    // take is a footer the player cannot satisfy.
    const selectable = entries.filter((e) => !e.disabled).length;
    const ceiling = pick.kind === 'remove' ? removableCount(this.run) : selectable;
    const count = Math.min(pick.count, selectable, ceiling);

    const title =
      pick.kind === 'remove' ? '弃去何牌' : upgrade ? '精进何牌' : '换去何牌';
    const hint =
      pick.kind === 'remove'
        ? `请择 ${count} 张弃之`
        : upgrade
          ? `请择 ${count} 张精进`
          : `请择 ${count} 张，换作同品的另一张`;

    if (count <= 0) {
      // Nothing qualifies — every copy already forged, say. The debt is still
      // discharged, or the screen would ask forever.
      resolveBlessingPick(this.run, []);
      this.refreshHud();
      this.enableDeparture();
      return;
    }

    openCardGrid(this, {
      title,
      subtitle: `共 ${entries.length} 张`,
      entries,
      mode: 'pick',
      pickCount: count,
      compareUpgrade: upgrade,
      footerHint: hint,
      confirmText: null,
      onPick: (uids) => {
        resolveBlessingPick(this.run, uids);
        this.refreshHud();
        this.enableDeparture();
      },
    });
  }

  // -------------------------------------------------------------------- 结果

  private showResult(lines: string[], leaveLabel: string, withButton = true): void {
    this.resultLayer.removeAll(true);
    this.resultLayer.setAlpha(0);

    const panelH = Math.max(180, 74 + lines.length * 34);
    const panelY = Math.max(140, (GAME_HEIGHT - panelH) / 2 - 30);
    this.resultLayer.add(
      inkPanel(this, ROW.x, panelY, ROW.w, panelH, { alpha: 0.92, border: C.gold }),
    );

    lines.forEach((line, i) => {
      this.resultLayer.add(
        this.add
          .text(ROW.x + ROW.w / 2, panelY + 46 + i * 34, line, bodyStyle(19, C.paper))
          .setOrigin(0.5, 0)
          .setLetterSpacing(2),
      );
    });

    this.tweens.add({ targets: this.resultLayer, alpha: 1, duration: 420 });
    if (withButton) this.enableDeparture(leaveLabel);
  }

  /** The one exit, and it only appears once nothing is owed. */
  private enableDeparture(label = '启 程'): void {
    if (!blessingSettled(this.run)) return;
    this.confirmRow.removeAll(true);
    this.confirmRow.add(
      inkButton(this, GAME_WIDTH / 2, CONFIRM_Y, label, {
        width: 220,
        height: 56,
        fontSize: 26,
        onClick: () => this.leave(),
      }),
    );
    this.input.keyboard?.once('keydown-ENTER', () => this.leave());
    this.input.keyboard?.once('keydown-SPACE', () => this.leave());
  }

  /** Refuse to leave, visibly. There is no 「离去」 on this screen by design. */
  private nudge(): void {
    if (this.leaving || isCardGridOpen(this) || blessingTaken(this.run)) return;
    this.speech.setColor(css(C.cinnabarBright));
    this.speech.setText('「四者取一，方可上路。」');
    this.tweens.add({
      targets: this.speech,
      x: { from: this.speech.x - 5, to: this.speech.x + 5 },
      duration: 60,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        this.speech.x = FIGURE.x + FIGURE.w / 2;
      },
    });
  }

  private leave(): void {
    if (this.leaving || !blessingSettled(this.run)) return;
    this.leaving = true;
    this.input.enabled = false;
    // 存档 (todos/08). The first write of the run, and it lands here rather than
    // in `startRun` because the 祝福 can still rewrite the deck, the purse and
    // 体力上限 — a save taken before it would restore a run that owes a blessing
    // it has already been given. `blessingSettled` is the gate on both.
    writeSave(this.run, null);
    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Map'),
    );
  }
}
