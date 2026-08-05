import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { getRelic, relicText, type RelicDef, type RelicTier } from '../combat/relics';
import { Rng } from '../core/rng';
import { bodyStyle, brushStyle, paintInkPanel } from './theme';
import { pop } from './vfx';

/**
 * The 宝物 bar: every relic the run owns, in pickup order, with a hover panel
 * and a flash when one fires. Shared by the map and combat HUDs.
 *
 * Every relic ships a painted icon under its `RelicDef.art` texture key
 * (BootScene's `RELIC_KEYS`); the drawn emblem below covers a plate that
 * fails to load and any relic added ahead of its art, and being vector it
 * stays crisp at any RENDER_SCALE.
 */

const TIER_COLOR: Record<RelicTier, number> = {
  starter: C.paper,
  common: C.paperDim,
  uncommon: C.jade,
  rare: C.goldBright,
  boss: C.cinnabarBright,
  shop: C.gold,
};

const TIER_LABEL: Record<RelicTier, string> = {
  starter: '随身',
  common: '寻常',
  uncommon: '珍品',
  rare: '奇珍',
  boss: '魁首',
  shop: '商货',
};

export interface RelicBarOptions {
  x: number;
  y: number;
  depth: number;
  /** Icon diameter in design units. */
  size?: number;
  /** Icons per row before wrapping. */
  perRow?: number;
  /** Pin to the viewport — required on a HUD whose camera scrolls. */
  fixed?: boolean;
  /** Defaults to just above the bar; pass a scene's tooltip layer if it has one. */
  tooltipDepth?: number;
}

export class RelicBar {
  private readonly size: number;
  private readonly perRow: number;
  private readonly gap: number;
  private readonly icons = new Map<string, Phaser.GameObjects.Container>();
  /** Rows currently in use, so the hover panel can clear the whole bar. */
  private rows = 1;
  private readonly root: Phaser.GameObjects.Container;
  private readonly tip: Phaser.GameObjects.Container;
  private readonly tipPanel: Phaser.GameObjects.Graphics;
  private readonly tipName: Phaser.GameObjects.Text;
  private readonly tipTier: Phaser.GameObjects.Text;
  private readonly tipDesc: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: RelicBarOptions,
  ) {
    this.size = opts.size ?? 26;
    this.perRow = opts.perRow ?? 10;
    this.gap = this.size + 6;

    this.root = scene.add.container(opts.x, opts.y).setDepth(opts.depth);

    this.tip = scene.add.container(0, 0).setDepth(opts.tooltipDepth ?? opts.depth + 1);
    this.tipPanel = scene.add.graphics();
    this.tipName = scene.add.text(14, 10, '', brushStyle(20, C.paper)).setLetterSpacing(2);
    this.tipTier = scene.add.text(14, 36, '', bodyStyle(12, C.gold)).setLetterSpacing(2);
    this.tipDesc = scene.add.text(14, 58, '', bodyStyle(13, C.paperDim));
    this.tip.add([this.tipPanel, this.tipName, this.tipTier, this.tipDesc]);
    this.tip.setVisible(false);

    if (opts.fixed) {
      this.root.setScrollFactor(0);
      this.tip.setScrollFactor(0);
    }
  }

  /** Rebuilds the row. Cheap enough to call whenever the run's relics change. */
  setRelics(ids: readonly string[]): void {
    this.root.removeAll(true);
    this.icons.clear();
    this.hideTip();

    ids.forEach((id, i) => {
      const def = getRelic(id);
      if (!def) return;
      const icon = this.buildIcon(def);
      icon.setPosition((i % this.perRow) * this.gap, Math.floor(i / this.perRow) * this.gap);
      this.root.add(icon);
      this.icons.set(id, icon);
    });
    this.rows = Math.max(1, Math.ceil(this.icons.size / this.perRow));
  }

  /**
   * Re-anchor the whole bar. The root is the *centre* of the first icon, not a
   * corner. Tooltips follow, since `showTip` reads `root` live.
   */
  moveTo(x: number, y: number): void {
    this.root.setPosition(x, y);
  }

  /** Punch the icon and ring it in gold — a relic just did something. */
  flash(id: string): void {
    const icon = this.icons.get(id);
    if (!icon) return;
    pop(this.scene, icon, 1.25, 130);

    const ring = this.scene.add.graphics().setDepth(this.opts.depth);
    ring.lineStyle(2, C.goldBright, 0.95);
    ring.strokeCircle(0, 0, this.size / 2);
    if (this.opts.fixed) ring.setScrollFactor(0);
    icon.add(ring);
    this.scene.tweens.add({
      targets: ring,
      scale: 2.1,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private buildIcon(def: RelicDef): Phaser.GameObjects.Container {
    const r = this.size / 2;
    const icon = this.scene.add.container(r, r);
    const tier = TIER_COLOR[def.tier];

    if (this.scene.textures.exists(def.art)) {
      const art = this.scene.add.image(0, 0, def.art);
      art.setScale((this.size * 0.92) / Math.max(art.width, art.height));
      icon.add(art);
    } else {
      icon.add(this.emblem(def, r, tier));
    }

    const frame = this.scene.add.graphics();
    frame.lineStyle(1.5, tier, 0.9);
    frame.strokeCircle(0, 0, r);
    frame.lineStyle(1, tier, 0.28);
    frame.strokeCircle(0, 0, r + 3);
    icon.add(frame);

    const hit = this.scene.add
      .zone(0, 0, this.size + 6, this.size + 6)
      .setInteractive({ useHandCursor: true });
    // Rendering rides on the root container's scroll factor, but hit-testing
    // reads the Zone's own — on a scrolling camera an unlocked zone drifts a
    // whole map's height away from the icon the player is pointing at.
    if (this.opts.fixed) hit.setScrollFactor(0);
    icon.add(hit);
    hit.on('pointerover', () => this.showTip(def, icon));
    hit.on('pointerout', () => this.hideTip());

    return icon;
  }

  /**
   * Procedural stand-in art: an ink disc under a wreath of strokes seeded off
   * the relic id, so every relic reads as a distinct sigil and the same relic
   * looks the same on every run.
   */
  private emblem(def: RelicDef, r: number, tier: number): Phaser.GameObjects.Graphics {
    const rng = new Rng(`relic:${def.id}`);
    const g = this.scene.add.graphics();

    g.fillStyle(C.inkDeep, 0.95);
    g.fillCircle(0, 0, r);
    g.fillStyle(tier, 0.12);
    g.fillCircle(0, 0, r);

    const spokes = 3 + rng.int(4);
    const phase = rng.next() * Math.PI * 2;
    for (let i = 0; i < spokes; i++) {
      const a = phase + (i / spokes) * Math.PI * 2;
      const inner = r * (0.2 + rng.next() * 0.2);
      const outer = r * (0.62 + rng.next() * 0.2);
      g.lineStyle(r * 0.16, tier, 0.85);
      g.lineBetween(
        Math.cos(a) * inner,
        Math.sin(a) * inner,
        Math.cos(a) * outer,
        Math.sin(a) * outer,
      );
    }

    // Centre mark: a filled core for even sigils, a ring for odd ones.
    if (spokes % 2 === 0) {
      g.fillStyle(C.paper, 0.9);
      g.fillCircle(0, 0, r * 0.2);
    } else {
      g.lineStyle(r * 0.13, C.paper, 0.85);
      g.strokeCircle(0, 0, r * 0.26);
    }
    return g;
  }

  private showTip(def: RelicDef, icon: Phaser.GameObjects.Container): void {
    this.tipName.setText(def.name);
    this.tipTier.setText(TIER_LABEL[def.tier]).setColor(css(TIER_COLOR[def.tier]));
    this.tipDesc.setText(relicText(def));

    const w = Math.max(this.tipName.width, this.tipTier.width, this.tipDesc.width) + 28;
    const h = 92;
    paintInkPanel(this.tipPanel, 0, 0, w, h, { alpha: 0.94, border: TIER_COLOR[def.tier] });

    // Under the whole bar rather than under the icon, so a wrapped second row
    // isn't hidden by the panel describing the row above it.
    const x = Phaser.Math.Clamp(this.root.x + icon.x - w / 2, 8, GAME_WIDTH - w - 8);
    const y = Phaser.Math.Clamp(this.root.y + this.rows * this.gap + 4, 8, GAME_HEIGHT - h - 8);
    this.tip.setPosition(x, y).setVisible(true);
  }

  private hideTip(): void {
    this.tip.setVisible(false);
  }
}
