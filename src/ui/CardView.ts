import Phaser from 'phaser';
import { C } from '../config';
import { CARD_TYPE_META, resolveCard } from '../combat/cards';
import { describeCard } from '../combat/engine';
import type { CardDef, CombatState } from '../combat/types';
import { bodyStyle, brushStyle } from './theme';

export const CARD_W = 144;
export const CARD_H = 200;

/** Art window, in card-local coordinates. Matches the 3:2 crop of the plates. */
const ART = { y: -44, w: 136, h: 91 };

/**
 * One card in hand. Owns its own face rendering so the scene only has to move
 * it around and ask it to re-read the combat state.
 */
export class CardView extends Phaser.GameObjects.Container {
  readonly uid: string;
  readonly def: CardDef;
  readonly upgraded: number;

  private frame: Phaser.GameObjects.Graphics;
  private costText: Phaser.GameObjects.Text;
  private descText: Phaser.GameObjects.Text;
  private dimmer: Phaser.GameObjects.Graphics;
  private hit: Phaser.GameObjects.Zone;

  /** Anchor the scene tweens back to after a hover lift. */
  homeX = 0;
  homeY = 0;
  homeAngle = 0;

  private playable = true;
  /** 'display' cards (reward picks, deck viewers) never grey out on energy. */
  private readonly mode: 'hand' | 'display';
  /** Frame + text colour: gold for type, bright gold once forged. */
  private readonly accent: number;

  constructor(
    scene: Phaser.Scene,
    uid: string,
    defId: string,
    upgraded: number,
    state: CombatState,
    mode: 'hand' | 'display' = 'hand',
  ) {
    super(scene, 0, 0);
    this.uid = uid;
    this.upgraded = upgraded;
    this.mode = mode;

    const def = resolveCard(defId, upgraded);
    this.def = def;

    const accent = upgraded > 0 ? C.goldBright : CARD_TYPE_META[def.type].color;
    this.accent = accent;

    const shadow = scene.add.graphics();
    shadow.fillStyle(0x000000, 0.45);
    shadow.fillRoundedRect(-CARD_W / 2 + 3, -CARD_H / 2 + 6, CARD_W, CARD_H, 8);

    this.frame = scene.add.graphics();
    this.paintFrame(accent, false);

    const art = scene.add.image(0, ART.y, def.art);
    art.setDisplaySize(ART.w, ART.h);

    // Ink wash over the bottom of the art so the name never fights the picture.
    const artFade = scene.add.graphics();
    artFade.fillGradientStyle(C.inkDeep, C.inkDeep, C.inkDeep, C.inkDeep, 0, 0, 0.85, 0.85);
    artFade.fillRect(-ART.w / 2, ART.y + ART.h / 2 - 24, ART.w, 24);

    const rule = scene.add.graphics();
    rule.lineStyle(1, accent, 0.65);
    rule.lineBetween(-54, 34, 54, 34);

    // resolveCard already appended 「·精」, so the mark travels with the name —
    // a colour shift alone disappears in a thumbnail.
    const nameStyle = brushStyle(
      upgraded > 0 ? 18 : 20,
      upgraded > 0 ? C.goldBright : C.paper,
    );
    const name = scene.add.text(0, 17, def.name, nameStyle).setOrigin(0.5).setLetterSpacing(2);

    this.descText = scene.add
      .text(0, 42, '', {
        ...bodyStyle(13, upgraded > 0 ? C.goldBright : C.paperDim),
        align: 'center',
        wordWrap: { width: CARD_W - 22 },
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0);

    // Cost orb
    const orb = scene.add.graphics();
    orb.fillStyle(C.inkDeep, 1);
    orb.fillCircle(-56, -78, 17);
    orb.lineStyle(2, C.goldBright, 0.95);
    orb.strokeCircle(-56, -78, 17);
    this.costText = scene.add
      .text(-56, -78, String(def.cost), brushStyle(21, C.goldBright))
      .setOrigin(0.5);

    // The type tag keeps its own colour — it reads type, not upgrade state.
    const typeTag = scene.add
      .text(56, -78, CARD_TYPE_META[def.type].label, brushStyle(18, CARD_TYPE_META[def.type].color))
      .setOrigin(0.5);

    // Greys the whole face out when the card is unaffordable.
    this.dimmer = scene.add.graphics();
    this.dimmer.fillStyle(C.inkDeep, 0.62);
    this.dimmer.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    this.dimmer.setVisible(false);

    this.hit = scene.add.zone(0, 0, CARD_W, CARD_H).setInteractive({ useHandCursor: true });

    this.add([shadow, this.frame, art, artFade, rule, name, this.descText, orb, this.costText, typeTag, this.dimmer, this.hit]);
    this.setSize(CARD_W, CARD_H);
    scene.add.existing(this);

    this.refresh(state);
  }

  private paintFrame(accent: number, highlighted: boolean): void {
    const g = this.frame;
    g.clear();
    g.fillStyle(C.ink, 1);
    g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    g.lineStyle(highlighted ? 3 : 2, highlighted ? C.goldBright : accent, highlighted ? 1 : 0.8);
    g.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    g.lineStyle(1, C.paper, 0.12);
    g.strokeRoundedRect(-CARD_W / 2 + 4, -CARD_H / 2 + 4, CARD_W - 8, CARD_H - 8, 5);
  }

  /** Re-read the combat state: affordability and the live damage/block numbers. */
  refresh(state: CombatState): void {
    this.descText.setText(describeCard(state, this.def));
    this.playable =
      this.mode === 'display' || (state.phase === 'player' && state.energy >= this.def.cost);
    this.dimmer.setVisible(!this.playable);
    this.costText.setColor(this.playable ? '#f0d67a' : '#8a7f66');
  }

  get isPlayable(): boolean {
    return this.playable;
  }

  setSelected(on: boolean): void {
    this.paintFrame(this.accent, on);
  }

  get hitZone(): Phaser.GameObjects.Zone {
    return this.hit;
  }
}
