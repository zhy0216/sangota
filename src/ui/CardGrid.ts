import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { resolveCard } from '../combat/cards';
import { Rng, randomSeed } from '../core/rng';
import type { CombatState } from '../combat/types';
import { CARD_H, CARD_W, CardView, cardTipPanel, placeCardTipPanel } from './CardView';
import { shuffleForDisplay, sortForDisplay, type CardGridEntry } from './cardOrder';
import { pinToCamera, toDesign } from './designSpace';
import { pushOverlay } from './overlayStack';
import { bodyStyle, brushStyle, inkButton, inkPanel } from './theme';
import { popText } from './vfx';

export type { CardGridEntry } from './cardOrder';
export { shuffleForDisplay, sortForDisplay } from './cardOrder';

/**
 * Scenes with camera-panning or hotkey handlers of their own must stand down
 * while a grid is up: freezing the display list stops Game Objects from being
 * hit, but scene-level pointer/wheel/key events fire regardless of what is
 * under the pointer. Now that rooms put panels up too, "is a grid open" is just
 * "is anything open" — kept under the old name so every call site is unchanged.
 */
export { isOverlayOpen as isCardGridOpen } from './overlayStack';

export type CardGridMode = 'view' | 'pick';

export interface CardGridOptions {
  title: string;
  subtitle?: string;
  entries: CardGridEntry[];
  mode: CardGridMode;
  /** How many cards `pick` mode wants. */
  pickCount?: number;
  /** Scramble the display order (the draw pile). */
  shuffleDisplay?: boolean;
  /** Second-step confirmation label; null picks as soon as the count is met. */
  confirmText?: string | null;
  /**
   * Draw the hovered card twice — current face dimmed, forged face lit, a gold
   * arrow between them. 营帐锻造 needs the player to see what the 6 气 buys
   * before spending it.
   */
  compareUpgrade?: boolean;
  /** Replaces the stock 「请选择 N 张」 footer line in `pick` mode. */
  footerHint?: string;
  /**
   * The live fight, when there is one. Card faces then read their real numbers;
   * on the map there is no combat and they read their printed ones.
   */
  state?: CombatState;
  onPick?: (uids: string[]) => void;
  /** In `pick` mode, omitting this makes the choice mandatory — no way out. */
  onClose?: () => void;
}

const THUMB = 0.62;
const COLS = 5;
const CELL_W = 124;
const CELL_H = 148;

const PANEL_W = COLS * CELL_W + 60;
const PANEL_X = Math.round((GAME_WIDTH - PANEL_W) / 2);
/** Panel chrome above and below the scrolling window. */
const HEAD_H = 96;
const FOOT_H = 76;
const MAX_VIEW_H = GAME_HEIGHT - 64 - HEAD_H - FOOT_H;

/** Centre-to-centre spacing of the two faces in an upgrade comparison. */
const COMPARE_GAP = CARD_W + 40;

/**
 * Take every already-interactive object in the scene out of the input system
 * and hand back the undo. This is what stops a grid opened mid-combat from
 * leaking clicks onto the enemies underneath — a full-screen backdrop would
 * only work if it sorted above them, and Phaser sorts input by render-list
 * index, which container children do not have.
 */
function freezeSceneInput(scene: Phaser.Scene): () => void {
  const frozen: Phaser.GameObjects.GameObject[] = [];

  const walk = (children: Phaser.GameObjects.GameObject[]): void => {
    for (const child of children) {
      if (child.input?.enabled) {
        child.input.enabled = false;
        frozen.push(child);
      }
      if (child instanceof Phaser.GameObjects.Container) walk(child.list);
    }
  };
  walk(scene.children.list);

  return () => {
    for (const child of frozen) {
      // A frozen object may have been destroyed while the grid was up.
      if (child.input) child.input.enabled = true;
    }
  };
}

/** An overlay on any scene, owning its own depth and input interception. */
export function openCardGrid(scene: Phaser.Scene, opts: CardGridOptions): void {
  const mode = opts.mode;
  const pickCount = Math.max(1, opts.pickCount ?? 1);
  // A pick with nowhere to bail out to is mandatory; a view always closes.
  const dismissable = mode === 'view' || !!opts.onClose;

  const ordered = opts.shuffleDisplay
    ? // Real entropy, deliberately: the point is that the order tells the
      // player nothing, so it must not be derivable from the run's seed.
      shuffleForDisplay(opts.entries, new Rng(randomSeed()))
    : sortForDisplay(opts.entries);

  // The panel is cut to its contents — a 10-card deck in a full-height frame
  // is mostly empty black — and only then starts scrolling.
  const rows = Math.ceil(ordered.length / COLS);
  const contentH = rows * CELL_H + 24;
  const viewH = Phaser.Math.Clamp(contentH, CELL_H, MAX_VIEW_H);
  const panelH = HEAD_H + viewH + FOOT_H;
  const panelY = Math.round((GAME_HEIGHT - panelH) / 2);
  const viewTop = panelY + HEAD_H;
  const viewBottom = viewTop + viewH;
  const maxScroll = Math.max(0, contentH - viewH);

  const thaw = freezeSceneInput(scene);
  // The stack owns Esc, so two overlays up at once no longer both close on it.
  const overlay = pushOverlay(scene, {
    id: 'cardGrid',
    dismissable,
    onDismiss: () => close(null),
  });
  const DEPTH = overlay.depth;

  const root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);
  const picked: string[] = [];
  let preview: Phaser.GameObjects.Container | null = null;
  let closed = false;

  // ------------------------------------------------------------ decoration

  root.add(
    scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.86)
      .setScrollFactor(0),
  );
  root.add(inkPanel(scene, PANEL_X, panelY, PANEL_W, panelH, { alpha: 0.97 }));

  root.add(
    scene.add
      .text(GAME_WIDTH / 2, panelY + 24, opts.title, brushStyle(34, C.paper))
      .setOrigin(0.5, 0)
      .setLetterSpacing(6),
  );
  root.add(
    scene.add
      .text(
        GAME_WIDTH / 2,
        panelY + 66,
        opts.subtitle ?? `共 ${opts.entries.length} 张`,
        bodyStyle(14, C.paperFaint),
      )
      .setOrigin(0.5, 0)
      .setLetterSpacing(2),
  );

  const rule = scene.add.graphics();
  rule.lineStyle(1, C.gold, 0.35);
  rule.lineBetween(PANEL_X + 28, viewTop - 10, PANEL_X + PANEL_W - 28, viewTop - 10);
  root.add(rule);

  if (ordered.length === 0) {
    root.add(
      scene.add
        .text(GAME_WIDTH / 2, viewTop + viewH / 2, '空空如也', bodyStyle(18, C.paperFaint))
        .setOrigin(0.5)
        .setLetterSpacing(4),
    );
  }

  // ----------------------------------------------------------------- cards

  const content = scene.add.container(0, viewTop);
  root.add(content);

  // Geometry masks render through the camera, so a mask for a scroll-locked
  // overlay has to be scroll-locked too or it drifts on a panning map.
  const maskShape = scene.make.graphics({}, false).setScrollFactor(0);
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(PANEL_X + 6, viewTop - 6, PANEL_W - 12, viewH + 12);
  content.setMask(maskShape.createGeometryMask());

  const views: CardView[] = [];
  ordered.forEach((entry, i) => {
    const view = new CardView(
      scene,
      entry.uid,
      entry.defId,
      entry.previewUpgraded ? 1 : entry.upgraded,
      opts.state,
      'display',
    );
    view.setPosition(
      PANEL_X + 30 + CELL_W / 2 + (i % COLS) * CELL_W,
      16 + CELL_H / 2 + Math.floor(i / COLS) * CELL_H,
    );
    view.setScale(THUMB);
    view.setAlpha(entry.disabled ? 0.45 : 1);
    content.add(view);
    views.push(view);

    view.hitZone.on('pointerover', () => showPreview(view, entry));
    view.hitZone.on('pointerout', () => hidePreview());
    view.hitZone.on('pointerup', () => onCardClick(view, entry));
  });

  let scroll = 0;

  const bar = scene.add.graphics();
  root.add(bar);

  const paintScroll = (): void => {
    bar.clear();
    if (maxScroll <= 0) return;
    const x = PANEL_X + PANEL_W - 16;
    const thumbH = Math.max(40, (viewH / contentH) * viewH);
    bar.fillStyle(C.paper, 0.08);
    bar.fillRoundedRect(x, viewTop, 5, viewH, 2);
    bar.fillStyle(C.gold, 0.65);
    bar.fillRoundedRect(x, viewTop + (scroll / maxScroll) * (viewH - thumbH), 5, thumbH, 2);
  };

  /** A mask hides the cards it clips but leaves their hit areas live. */
  const syncVisible = (): void => {
    for (const view of views) {
      const y = content.y + view.y;
      const input = view.hitZone.input;
      if (input) input.enabled = y >= viewTop && y <= viewBottom;
    }
  };

  const scrollBy = (dy: number): void => {
    if (maxScroll <= 0) return;
    const next = Phaser.Math.Clamp(scroll + dy, 0, maxScroll);
    if (next === scroll) return;
    scroll = next;
    content.y = viewTop - scroll;
    hidePreview();
    paintScroll();
    syncVisible();
  };

  paintScroll();
  syncVisible();

  // --------------------------------------------------------------- preview

  /** A full-size face for the preview layer, deaf to the pointer. */
  function previewFace(entry: CardGridEntry, upgraded: number): CardView {
    const card = new CardView(scene, entry.uid, entry.defId, upgraded, opts.state, 'display');
    // The blown-up copy must not steal the pointer from the thumbnail under it.
    card.hitZone.disableInteractive();
    return card;
  }

  /** The hovered card, redrawn at full size on top of the grid and unclipped. */
  function showPreview(view: CardView, entry: CardGridEntry): void {
    hidePreview();
    // A comparison is two cards wide, so the clamp has to widen with it or the
    // 「before」 face walks off the left edge of the screen.
    const compare = !!opts.compareUpgrade && !entry.disabled;
    const halfW = compare ? COMPARE_GAP / 2 + CARD_W / 2 : CARD_W / 2;
    const x = Phaser.Math.Clamp(view.x, halfW + 12, GAME_WIDTH - halfW - 12);
    const y = Phaser.Math.Clamp(content.y + view.y, CARD_H / 2 + 12, GAME_HEIGHT - CARD_H / 2 - 26);
    const layer = scene.add.container(x, y);

    const face = entry.previewUpgraded ? 1 : entry.upgraded;
    if (compare) {
      const before = previewFace(entry, face);
      before.setPosition(-COMPARE_GAP / 2, 0).setAlpha(0.55);
      const after = previewFace(entry, face + 1);
      after.setPosition(COMPARE_GAP / 2, 0);
      layer.add([before, after]);
      layer.add(
        scene.add.text(0, 0, '→', brushStyle(40, C.goldBright)).setOrigin(0.5).setLetterSpacing(2),
      );
    } else {
      layer.add(previewFace(entry, face));
    }

    // 关键词汇总面板 (k7)：预览放大到可读的同一刻，词条解释一并到位。
    // 比较视图讲**锻后**那张脸——玩家在决定的是买不买它；面板贴在整组
    // 脸的旁边，翻转与出屏 clamp 都走 placeTip 的规则，坐标换回层内。
    const tipDef = resolveCard(entry.defId, compare ? face + 1 : face);
    const panel = cardTipPanel(scene, tipDef, opts.state);
    if (panel) {
      const box = compare
        ? { x: x - COMPARE_GAP / 2 - CARD_W / 2, y: y - CARD_H / 2, w: COMPARE_GAP + CARD_W, h: CARD_H }
        : { x: x - CARD_W / 2, y: y - CARD_H / 2, w: CARD_W, h: CARD_H };
      const at = placeCardTipPanel(panel, box, 'right');
      panel.root.setPosition(at.x - x, at.y - y);
      layer.add(panel.root);
    }

    if (entry.disabledReason) {
      layer.add(
        scene.add
          .text(0, CARD_H / 2 + 8, entry.disabledReason, bodyStyle(14, C.cinnabarBright))
          .setOrigin(0.5, 0),
      );
    }

    root.add(layer);
    preview = layer;
    layer.setScale(THUMB).setAlpha(0.7);
    scene.tweens.add({ targets: layer, scale: 1, alpha: 1, duration: 120, ease: 'Back.easeOut' });
  }

  function hidePreview(): void {
    preview?.destroy(true);
    preview = null;
  }

  // ---------------------------------------------------------------- picking

  const footY = panelY + panelH - 42;
  const hint = scene.add
    .text(GAME_WIDTH / 2, footY, '', bodyStyle(13, C.paperFaint))
    .setOrigin(0.5)
    .setLetterSpacing(2);
  root.add(hint);

  let confirmBtn: Phaser.GameObjects.Container | null = null;

  const refreshFooter = (): void => {
    const need = pickCount - picked.length;
    const wantConfirm = mode === 'pick' && need === 0 && opts.confirmText !== null;

    if (wantConfirm) hint.setText('');
    else if (mode === 'pick') {
      hint.setText(opts.footerHint ?? `请选择 ${need} 张${dismissable ? '　·　Esc 取消' : ''}`);
    }
    else hint.setText(maxScroll > 0 ? '滚轮翻阅　·　Esc 或点击空白处关闭' : 'Esc 或点击空白处关闭');

    if (wantConfirm && !confirmBtn) {
      confirmBtn = inkButton(scene, GAME_WIDTH / 2, footY, opts.confirmText ?? '确 认', {
        width: 180,
        height: 46,
        fontSize: 22,
        onClick: () => close(picked.slice()),
      });
      root.add(confirmBtn);
    } else if (!wantConfirm && confirmBtn) {
      confirmBtn.destroy(true);
      confirmBtn = null;
    }
  };

  function onCardClick(view: CardView, entry: CardGridEntry): void {
    if (mode !== 'pick') return;
    if (entry.disabled) {
      if (entry.disabledReason) {
        popText(scene, view.x, content.y + view.y - 60, entry.disabledReason, {
          color: C.cinnabarBright,
          size: 20,
          depth: DEPTH + 60,
        });
      }
      return;
    }

    const at = picked.indexOf(entry.uid);
    if (at >= 0) {
      picked.splice(at, 1);
      view.setSelected(false);
    } else {
      // One over the limit drops the oldest pick, so the player is never stuck.
      if (picked.length >= pickCount) {
        const dropped = picked.shift();
        views.find((v) => v.uid === dropped)?.setSelected(false);
      }
      picked.push(entry.uid);
      view.setSelected(true);
    }

    if (picked.length === pickCount && opts.confirmText === null) {
      close(picked.slice());
      return;
    }
    refreshFooter();
  }

  refreshFooter();

  // ----------------------------------------------------------------- chrome

  if (dismissable) {
    const closeMark = scene.add
      .text(PANEL_X + PANEL_W - 34, panelY + 22, '×', brushStyle(34, C.paperDim))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    closeMark.on('pointerover', () => closeMark.setColor(css(C.goldBright)));
    closeMark.on('pointerout', () => closeMark.setColor(css(C.paperDim)));
    closeMark.on('pointerup', () => close(null));
    root.add(closeMark);
  }

  // --------------------------------------------------------------- lifetime

  const onWheel = (_p: unknown, _o: unknown, _dx: number, dy: number): void => {
    scrollBy(dy * 0.6);
  };
  // The backdrop is not interactive — everything below is frozen instead — so
  // "click the empty space" is a plain geometry test against the panel.
  const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    const x = toDesign(pointer.x);
    const y = toDesign(pointer.y);
    const inside = x >= PANEL_X && x <= PANEL_X + PANEL_W && y >= panelY && y <= panelY + panelH;
    if (!inside) close(null);
  };

  scene.input.on('wheel', onWheel);
  scene.input.on('pointerdown', onPointerDown);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);

  function teardown(): void {
    if (closed) return;
    closed = true;
    overlay.release();
    scene.input.off('wheel', onWheel);
    scene.input.off('pointerdown', onPointerDown);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
    hidePreview();
    maskShape.destroy();
    root.destroy(true);
    thaw();
  }

  function close(result: string[] | null): void {
    if (closed) return;
    if (result === null && !dismissable) return;
    teardown();
    if (result) opts.onPick?.(result);
    else opts.onClose?.();
  }

  pinToCamera(root);
  root.setAlpha(0);
  scene.tweens.add({ targets: root, alpha: 1, duration: 180 });
}
