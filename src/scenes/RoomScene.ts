import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { ROOM_META } from '../map/roomMeta';
import type { MapNode, RoomType } from '../map/types';
import { CampfireController } from '../rooms/campfireView';
import { roomCommit, type RoomCommit } from '../rooms/commit';
import type { PickRequest, RoomOptionView } from '../rooms/types';
import { EventController } from '../rooms/eventView';
import { ShopController } from '../rooms/shopView';
import { TreasureController } from '../rooms/treasureView';
import { getRun, type RunState } from '../state/run';
import { isCardGridOpen, openCardGrid, type CardGridEntry } from '../ui/CardGrid';
import { useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, gradientStrip, inkButton, inkPanel } from '../ui/theme';
import { popText } from '../ui/vfx';
import { returnToMap } from './nav';

/**
 * 房间场景 — one scene for 营帐 / 商旅 / 奇遇 / 宝藏, driven by a controller.
 *
 * The map launches this and puts *itself* to sleep rather than stopping: a
 * sleeping scene neither updates nor accepts input, so the map's ~120 node
 * views, its scroll position, its drawer and its tooltip all survive the visit
 * with no new save fields and no restore code. Waking it is the whole of
 * "return to the map".
 *
 * The split this file exists to enforce: **not one statement here writes to
 * `RunState`.** Rooms decide, the scene draws. `tests/integrity.test.ts` checks
 * that as source text, along with the rule that `commit.once` never appears
 * outside `src/rooms/*.ts` — the scene layer must not be able to route around
 * the one-shot gate.
 */

const DEPTH = {
  bg: 0,
  tint: 1,
  panel: 10,
  content: 20,
  chrome: 100,
} as const;

/** Panel geometry. The option row lives inside it, not hanging off the edge. */
const PANEL_TOP = 96;
const PANEL_H = 470;

/** Where a controller may draw. Everything outside is scene chrome. */
const AREA = { x: 190, y: 200, w: GAME_WIDTH - 380, h: 240 } as const;

const OPTION_ROW_Y = 490;
const OPTION_W = 268;
const OPTION_H = 62;

/** What a room controller is handed. The only door back to the run state. */
export interface RoomHost {
  readonly scene: Phaser.Scene;
  readonly run: RunState;
  readonly node: MapNode;
  readonly commit: RoomCommit;
  readonly area: { x: number; y: number; w: number; h: number };
  /**
   * A container inside the content band; `depth` is relative to it. The scene
   * owns what it hands out: `showResult` clears every layer, because a resolved
   * room's outcome replaces its scenery rather than being drawn over it.
   */
  layer(depth?: number): Phaser.GameObjects.Container;
  setTitle(label: string, sub?: string): void;
  showOptions(opts: RoomOptionView[], onPick: (id: string) => void): void;
  /** Idempotent — calling it twice redraws rather than stacking. */
  showResult(lines: string[], leaveLabel?: string): void;
  refreshHud(): void;
  pickCards(req: PickRequest): void;
  floatText(x: number, y: number, text: string, tone?: string): void;
  setEscPolicy(policy: 'blocked' | 'leave'): void;
  /** Wraps a callback so it does nothing once the room is on its way out. */
  action(fn: () => void): () => void;
  /** The one exit. */
  requestLeave(): void;
  goCombat(req: { tier: 'monster' | 'elite'; bonusRelic?: string }): void;
}

export interface RoomController {
  enter(host: RoomHost): void;
  /** False keeps the player in the room — an unresolved forced choice. */
  canLeave?(): boolean;
  dispose?(): void;
}

/**
 * The one place in this file that names a room type. Every other branch on
 * "which room is this" belongs in a controller; 04 / 05 / 06 each add exactly
 * one line here.
 */
const CONTROLLERS: Partial<Record<RoomType, () => RoomController>> = {
  rest: () => new CampfireController(),
  shop: () => new ShopController(),
  event: () => new EventController(),
  treasure: () => new TreasureController(),
};

export class RoomScene extends Phaser.Scene {
  private nodeId!: string;
  private run!: RunState;
  private node!: MapNode;
  private controller: RoomController | null = null;
  private leaving = false;
  private escPolicy: 'blocked' | 'leave' = 'leave';
  /** Everything `layer()` handed the controller, so the scene can clear it. */
  private layers: Phaser.GameObjects.Container[] = [];

  private panel!: Phaser.GameObjects.Container;
  private titleText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private optionRow!: Phaser.GameObjects.Container;
  private resultBox!: Phaser.GameObjects.Container;
  private hudText!: Phaser.GameObjects.Text;
  private leaveBtn!: Phaser.GameObjects.Container;
  private leaveLabel = '离 去';
  private escNote!: Phaser.GameObjects.Text;

  constructor() {
    super('Room');
  }

  init(data: { nodeId: string }): void {
    // The id, never the node object: a `MapNode` handed across scenes can
    // outlive the map that owns it.
    this.nodeId = data.nodeId;
    this.controller = null;
    this.leaving = false;
    this.escPolicy = 'leave';
    this.leaveLabel = '离 去';
    this.layers = [];
  }

  create(): void {
    useDesignSpace(this);
    this.run = getRun();
    this.node = this.run.map.nodes.get(this.nodeId)!;

    this.buildBackdrop();
    this.buildChrome();

    const meta = ROOM_META[this.node.type];
    this.setTitle(meta.label, meta.desc);

    const make = CONTROLLERS[this.node.type];
    if (make) {
      this.controller = make();
      this.controller.enter(this.host());
    } else {
      // A room type with no controller yet still opens and still leaves.
      this.showResult(['此处的玩法尚未实装。']);
    }

    this.input.keyboard?.on('keydown-ESC', () => this.onEsc());
    this.cameras.main.fadeIn(280, 8, 6, 4);
  }

  // ------------------------------------------------------------------ chrome

  private buildBackdrop(): void {
    const meta = ROOM_META[this.node.type];
    if (meta.plate && this.textures.exists(meta.plate)) {
      const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, meta.plate).setDepth(DEPTH.bg);
      const scale = Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height);
      bg.setScale(scale);
    }
    // The plates are bright paintings; knock them back so the panel reads.
    this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.72)
      .setOrigin(0, 0)
      .setDepth(DEPTH.tint);
    gradientStrip(this, 0, GAME_HEIGHT - 180, GAME_WIDTH, 180, C.inkDeep, 0, 0.92).setDepth(
      DEPTH.tint,
    );
  }

  private buildChrome(): void {
    const meta = ROOM_META[this.node.type];

    this.panel = this.add.container(0, 0).setDepth(DEPTH.panel);
    this.panel.add(
      inkPanel(this, AREA.x - 34, PANEL_TOP, AREA.w + 68, PANEL_H, {
        alpha: 0.9,
        border: meta.accent,
      }),
    );

    this.titleText = this.add
      .text(GAME_WIDTH / 2, 118, '', brushStyle(40, meta.accent))
      .setOrigin(0.5, 0)
      .setLetterSpacing(8);
    this.subText = this.add
      .text(GAME_WIDTH / 2, 168, '', bodyStyle(15, C.paperDim))
      .setOrigin(0.5, 0)
      .setLetterSpacing(2);
    this.panel.add([this.titleText, this.subText]);

    this.optionRow = this.add.container(0, 0).setDepth(DEPTH.chrome);
    this.resultBox = this.add.container(0, 0).setDepth(DEPTH.chrome);

    this.hudText = this.add
      .text(GAME_WIDTH - 26, 26, '', bodyStyle(16, C.paperDim))
      .setOrigin(1, 0)
      .setDepth(DEPTH.chrome)
      .setLetterSpacing(2);

    this.escNote = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 22, '', bodyStyle(13, C.cinnabarBright))
      .setOrigin(0.5)
      .setDepth(DEPTH.chrome);

    // Always on screen, whatever the Esc policy says: Esc is a shortcut for
    // this button, never the only way out.
    this.leaveBtn = inkButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 74, this.leaveLabel, {
      width: 200,
      height: 54,
      fontSize: 24,
      onClick: () => this.leave(),
    });
    this.leaveBtn.setDepth(DEPTH.chrome);

    this.refreshHud();
  }

  private setLeaveLabel(label: string): void {
    this.leaveLabel = label;
    const text = this.leaveBtn.list.find(
      (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text,
    );
    text?.setText(label);
  }

  // -------------------------------------------------------------------- host

  private host(): RoomHost {
    return {
      scene: this,
      run: this.run,
      node: this.node,
      commit: roomCommit(this.run, this.nodeId),
      area: AREA,
      layer: (depth = 0) => {
        const container = this.add.container(0, 0).setDepth(DEPTH.content + depth);
        this.layers.push(container);
        return container;
      },
      setTitle: (label, sub) => this.setTitle(label, sub),
      showOptions: (opts, onPick) => this.showOptions(opts, onPick),
      showResult: (lines, leaveLabel) => this.showResult(lines, leaveLabel),
      refreshHud: () => this.refreshHud(),
      pickCards: (req) => this.pickCards(req),
      floatText: (x, y, text, tone) =>
        popText(this, x, y, text, {
          color: tone === 'danger' ? C.cinnabarBright : tone === 'gold' ? C.goldBright : C.paper,
          size: 26,
          depth: DEPTH.chrome + 40,
        }),
      setEscPolicy: (policy) => {
        this.escPolicy = policy;
      },
      action: (fn) => this.action(fn),
      requestLeave: () => this.leave(),
      goCombat: (req) => this.goCombat(req),
    };
  }

  /** Every button callback goes through here, so a click during the exit fade
   *  cannot pay out into a run the player has already left. */
  private action(fn: () => void): () => void {
    return () => {
      if (this.leaving) return;
      fn();
    };
  }

  // ----------------------------------------------------------------- drawing

  private setTitle(label: string, sub?: string): void {
    this.titleText.setText(label);
    this.subText.setText(sub ?? '');
  }

  private showOptions(opts: RoomOptionView[], onPick: (id: string) => void): void {
    this.optionRow.removeAll(true);
    const step = OPTION_W + 26;
    const left = GAME_WIDTH / 2 - ((opts.length - 1) * step) / 2;

    opts.forEach((opt, i) => {
      const x = left + i * step;
      const accent =
        opt.tone === 'danger' ? C.cinnabar : opt.tone === 'gold' ? C.goldBright : C.gold;
      const btn = inkButton(this, x, OPTION_ROW_Y, opt.label, {
        width: OPTION_W,
        height: OPTION_H,
        fontSize: 25,
        accent: opt.disabled ? C.paperFaint : accent,
        onClick: this.action(() => {
          if (opt.disabled) {
            if (opt.disabledReason) {
              popText(this, x, OPTION_ROW_Y - 48, opt.disabledReason, {
                color: C.cinnabarBright,
                size: 20,
                depth: DEPTH.chrome + 40,
              });
            }
            return;
          }
          onPick(opt.id);
        }),
      });
      btn.setAlpha(opt.disabled ? 0.5 : 1);
      this.optionRow.add(btn);

      if (opt.hint) {
        this.optionRow.add(
          this.add
            .text(x, OPTION_ROW_Y + OPTION_H / 2 + 12, opt.hint, bodyStyle(13, C.paperFaint))
            .setOrigin(0.5, 0),
        );
      }
    });
  }

  private showResult(lines: string[], leaveLabel?: string): void {
    this.optionRow.removeAll(true);
    this.resultBox.removeAll(true);
    // The outcome replaces the room's scenery. Leaving the 木匣 drawn under
    // 「启封得资财 35」 is how the first draft looked, and it read as a bug.
    for (const layer of this.layers) layer.destroy(true);
    this.layers = [];

    const top = AREA.y + Math.max(0, (AREA.h - lines.length * 34) / 2);
    lines.forEach((line, i) => {
      this.resultBox.add(
        this.add
          .text(GAME_WIDTH / 2, top + i * 34, line, bodyStyle(19, C.paper))
          .setOrigin(0.5)
          .setLetterSpacing(2),
      );
    });

    this.setLeaveLabel(leaveLabel ?? '离 去');
    // A resolved room is always leavable, whatever it asked for on the way in.
    this.escPolicy = 'leave';
  }

  private refreshHud(): void {
    const { run } = this;
    this.hudText.setText(
      `体力 ${run.hp} / ${run.maxHp}　·　资财 ${run.gold}　·　牌组 ${run.deck.length}`,
    );
  }

  // ----------------------------------------------------------------- picking

  /**
   * The three things `CardGrid` deliberately does not do: clamp the count to
   * what is actually pickable, hand out copies rather than the deck's own
   * objects, and refresh the HUD on the way out.
   */
  private pickCards(req: PickRequest): void {
    const pool = req.filter ? this.run.deck.filter(req.filter) : this.run.deck;
    const entries: CardGridEntry[] = pool.map((card) => {
      const reason = req.disable?.(card) ?? null;
      // A copy: the grid must never hold the deck's own objects.
      const entry: CardGridEntry = { ...card };
      if (reason) {
        entry.disabled = true;
        entry.disabledReason = reason;
      }
      return entry;
    });

    const selectable = entries.filter((e) => !e.disabled).length;
    const count = Math.min(req.count, selectable);
    // Nothing to pick: never open a mandatory grid the player cannot satisfy —
    // the footer would ask for a card forever with no way out.
    if (count <= 0) {
      req.onPick([]);
      return;
    }

    const done = (uids: string[]): void => {
      this.refreshHud();
      req.onPick(uids);
    };

    openCardGrid(this, {
      title: req.title,
      subtitle: req.subtitle ?? `共 ${entries.length} 张`,
      entries,
      mode: 'pick',
      pickCount: count,
      confirmText: req.confirmText ?? null,
      compareUpgrade: req.compareUpgrade,
      footerHint: req.footerHint,
      onPick: done,
      ...(req.cancellable
        ? {
            onClose: (): void => {
              this.refreshHud();
              req.onCancel?.();
            },
          }
        : {}),
    });
  }

  // ---------------------------------------------------------------- lifetime

  private onEsc(): void {
    // A card grid on top owns the key; the stack has already handled it.
    if (this.leaving || isCardGridOpen(this)) return;
    if (this.escPolicy === 'leave') {
      this.leave();
      return;
    }
    this.nudge('先做个了断。');
  }

  /** Refuse to leave, visibly: the panel flinches and the footer says why. */
  private nudge(message: string): void {
    this.escNote.setText(message);
    this.time.delayedCall(1600, () => this.escNote.setText(''));
    this.tweens.killTweensOf(this.panel);
    this.panel.x = 0;
    this.tweens.add({
      targets: this.panel,
      x: { from: -6, to: 6 },
      duration: 60,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        this.panel.x = 0;
      },
    });
  }

  private leave(): void {
    if (this.leaving) return;
    if (this.controller?.canLeave?.() === false) {
      this.nudge('先做个了断。');
      return;
    }
    this.leaving = true;
    this.input.enabled = false;
    this.controller?.dispose?.();
    this.cameras.main.fadeOut(240, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      returnToMap(this),
    );
  }

  /**
   * An event that ends in a fight. The map is asleep behind us and would be
   * stale by the time the fight ends, so it is dropped here and rebuilt from
   * scratch when combat exits.
   */
  private goCombat(req: { tier: 'monster' | 'elite'; bonusRelic?: string }): void {
    if (this.leaving) return;
    this.leaving = true;
    this.input.enabled = false;
    this.controller?.dispose?.();
    this.scene.stop('Map');
    this.cameras.main.fadeOut(300, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      // `bonusRelic` rides along for todo 10 to grant on the victory screen.
      this.scene.start('Combat', { nodeType: req.tier, bonusRelic: req.bonusRelic }),
    );
  }
}
