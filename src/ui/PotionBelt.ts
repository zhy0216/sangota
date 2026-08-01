import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { getPotion, potionText, type PotionDef, type PotionRarity } from '../combat/potions';
import { bodyStyle, brushStyle, paintInkPanel } from './theme';
import { pop } from './vfx';

/**
 * The 丹药 belt: one flask per slot, empty ones drawn as an outline so the
 * player can always see how much room is left. Shared by the map and combat
 * HUDs, the same way `RelicBar` is.
 *
 * Every potion ships a painted icon under its `PotionDef.art` texture key
 * (BootScene's `POTION_KEYS`); the vector flask below covers one that fails
 * to load or is added ahead of its art, and stays crisp at any RENDER_SCALE.
 */

const RARITY_COLOR: Record<PotionRarity, number> = {
  common: C.paperDim,
  uncommon: C.jade,
  rare: C.goldBright,
};

const RARITY_LABEL: Record<PotionRarity, string> = {
  common: '寻常',
  uncommon: '珍品',
  rare: '奇珍',
};

export interface PotionBeltOptions {
  x: number;
  y: number;
  depth: number;
  /** Slot width in design units. Height is derived. */
  size?: number;
  /** Stack down the screen instead of across it. */
  vertical?: boolean;
  /** Pin to the viewport — required on a HUD whose camera scrolls. */
  fixed?: boolean;
  tooltipDepth?: number;
  /** Grey out a potion this screen cannot pour, e.g. 火油罐 on the map. */
  usable?: (def: PotionDef) => boolean;
  /** Left click on a filled, usable slot. */
  onUse?: (slot: number, def: PotionDef) => void;
  /**
   * Confirmed discard. Fires on the *second* consecutive right click, with the
   * tooltip asking for it in between — a one-click destroy of a rare potion is
   * the kind of mistake a player never forgives.
   */
  onDiscard?: (slot: number, def: PotionDef) => void;
}

export class PotionBelt {
  private readonly w: number;
  private readonly h: number;
  private readonly gap: number;
  private readonly root: Phaser.GameObjects.Container;
  private readonly slots: Phaser.GameObjects.Container[] = [];
  /** Slot whose discard has been asked for once. Cleared by anything else. */
  private armed: number | null = null;

  private readonly tip: Phaser.GameObjects.Container;
  private readonly tipPanel: Phaser.GameObjects.Graphics;
  private readonly tipName: Phaser.GameObjects.Text;
  private readonly tipRarity: Phaser.GameObjects.Text;
  private readonly tipDesc: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: PotionBeltOptions,
  ) {
    this.w = opts.size ?? 34;
    this.h = Math.round(this.w * 1.32);
    this.gap = (opts.vertical ? this.h : this.w) + 12;

    this.root = scene.add.container(opts.x, opts.y).setDepth(opts.depth);

    this.tip = scene.add.container(0, 0).setDepth(opts.tooltipDepth ?? opts.depth + 1);
    this.tipPanel = scene.add.graphics();
    this.tipName = scene.add.text(14, 10, '', brushStyle(20, C.paper)).setLetterSpacing(2);
    this.tipRarity = scene.add.text(14, 36, '', bodyStyle(12, C.gold)).setLetterSpacing(2);
    this.tipDesc = scene.add.text(14, 58, '', { ...bodyStyle(13, C.paperDim), lineSpacing: 4 });
    this.tip.add([this.tipPanel, this.tipName, this.tipRarity, this.tipDesc]);
    this.tip.setVisible(false);

    if (opts.fixed) {
      this.root.setScrollFactor(0);
      this.tip.setScrollFactor(0);
    }
  }

  /** Rebuilds the row. Cheap enough to call whenever the belt changes. */
  setPotions(ids: readonly (string | null)[]): void {
    this.root.removeAll(true);
    this.slots.length = 0;
    this.armed = null;
    this.hideTip();

    ids.forEach((id, i) => {
      const slot = this.buildSlot(id, i);
      const along = i * this.gap;
      slot.setPosition(this.opts.vertical ? 0 : along, this.opts.vertical ? along : 0);
      this.root.add(slot);
      this.slots.push(slot);
    });
  }

  /** Punch a slot — a potion was just drunk out of it. */
  flash(slot: number): void {
    const view = this.slots[slot];
    if (view) pop(this.scene, view, 1.3, 140);
  }

  private buildSlot(id: string | null, index: number): Phaser.GameObjects.Container {
    const container = this.scene.add.container(0, 0);
    const def = id ? getPotion(id) : null;
    const enabled = !!def && (this.opts.usable?.(def) ?? true);
    const accent = def ? RARITY_COLOR[def.rarity] : C.paperFaint;

    const frame = this.scene.add.graphics();
    frame.lineStyle(1, accent, def ? 0.75 : 0.3);
    frame.strokeRoundedRect(-this.w / 2, -this.h / 2, this.w, this.h, 4);
    container.add(frame);

    if (def) {
      if (this.scene.textures.exists(def.art)) {
        const art = this.scene.add.image(0, 0, def.art);
        art.setScale((this.w * 0.8) / Math.max(art.width, art.height));
        container.add(art);
      } else {
        container.add(this.flask(def));
      }
      container.setAlpha(enabled ? 1 : 0.42);
    }

    const hit = this.scene.add
      .zone(0, 0, this.w + 4, this.h + 4)
      .setInteractive({ useHandCursor: !!def });
    if (this.opts.fixed) hit.setScrollFactor(0);
    container.add(hit);

    if (def) {
      hit.on('pointerover', () => this.showTip(def, index, enabled));
      hit.on('pointerout', () => {
        this.armed = null;
        this.hideTip();
      });
      hit.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pointer.rightButtonReleased()) {
          if (this.armed === index) {
            this.armed = null;
            // The belt only reports it — a slot is never emptied behind the
            // scene's back, so the run stays the single source of truth.
            this.opts.onDiscard?.(index, def);
          } else {
            this.armed = index;
            this.showTip(def, index, enabled);
          }
          return;
        }
        this.armed = null;
        if (enabled) this.opts.onUse?.(index, def);
      });
    }

    return container;
  }

  /** Re-anchor the whole belt. Tooltips follow, since they read `slotAt`. */
  moveTo(x: number, y: number): void {
    this.root.setPosition(x, y);
  }

  /** Where a slot sits in scene coordinates, for a targeting line to start at. */
  slotAt(index: number): { x: number; y: number } {
    const along = index * this.gap;
    return {
      x: this.root.x + (this.opts.vertical ? 0 : along),
      y: this.root.y + (this.opts.vertical ? along : 0),
    };
  }

  /**
   * Procedural stand-in: a stoppered gourd flask with the potion's own colour
   * pooled in the belly. Shape is fixed and only the tint varies, so the belt
   * reads as one row of bottles rather than a row of unrelated sigils.
   */
  private flask(def: PotionDef): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const w = this.w;
    const h = this.h;

    g.fillStyle(C.inkDeep, 0.9);
    g.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 3);

    // Belly, neck, stopper — bottom up, so the liquid line sits where it reads.
    g.fillStyle(def.color, 0.85);
    g.fillEllipse(0, h * 0.14, w * 0.62, h * 0.44);
    g.fillStyle(def.color, 0.55);
    g.fillRect(-w * 0.1, -h * 0.18, w * 0.2, h * 0.22);
    g.fillStyle(C.paperDim, 0.9);
    g.fillRect(-w * 0.14, -h * 0.3, w * 0.28, h * 0.1);

    // Highlight: one stroke, so the glass reads as glass at 34px.
    g.lineStyle(1.5, C.paper, 0.35);
    g.beginPath();
    g.arc(0, h * 0.14, w * 0.24, Math.PI * 1.05, Math.PI * 1.45);
    g.strokePath();
    return g;
  }

  private showTip(def: PotionDef, index: number, enabled: boolean): void {
    const armed = this.armed === index;
    this.tipName.setText(def.name);
    this.tipRarity
      .setText(
        armed
          ? '再按一次右键，弃之'
          : `${RARITY_LABEL[def.rarity]}　·　${enabled ? '左键服用' : '此处不可服'}　·　右键丢弃`,
      )
      .setColor(css(armed ? C.cinnabarBright : enabled ? RARITY_COLOR[def.rarity] : C.paperFaint));
    this.tipDesc.setText(potionText(def));

    const w = Math.max(this.tipName.width, this.tipRarity.width, this.tipDesc.width) + 28;
    const h = this.tipDesc.height + 74;
    paintInkPanel(this.tipPanel, 0, 0, w, h, {
      alpha: 0.94,
      border: armed ? C.cinnabarBright : RARITY_COLOR[def.rarity],
    });

    // Beside a vertical belt, under or over a horizontal one depending on which
    // half of the screen it lives in — combat's sits low, the map's high.
    const at = this.slotAt(index);
    const x = this.opts.vertical ? at.x + this.w / 2 + 8 : at.x - w / 2;
    const y = this.opts.vertical
      ? at.y - h / 2
      : at.y < GAME_HEIGHT / 2
        ? at.y + this.h / 2 + 8
        : at.y - this.h / 2 - h - 8;
    this.tip
      .setPosition(
        Phaser.Math.Clamp(x, 8, GAME_WIDTH - w - 8),
        Phaser.Math.Clamp(y, 8, GAME_HEIGHT - h - 8),
      )
      .setVisible(true);
  }

  hideTip(): void {
    this.tip.setVisible(false);
  }

  /**
   * A HUD belt dies with its scene, but the one inside the "belt is full"
   * prompt outlives nothing — its two containers are parented to the scene, not
   * to the prompt's layer, so the prompt has to say when they go.
   */
  destroy(): void {
    this.root.destroy(true);
    this.tip.destroy(true);
    this.slots.length = 0;
  }
}
