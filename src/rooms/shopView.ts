import Phaser from 'phaser';
import { C, GAME_WIDTH } from '../config';
import { getPotion, potionText } from '../combat/potions';
import { getRelic, relicText } from '../combat/relics';
import type { RoomController, RoomHost } from '../scenes/RoomScene';
import { removeDisabledReason } from '../state/run';
import { CARD_H, CARD_W, CardView } from '../ui/CardView';
import { bodyStyle, brushStyle, inkPanel, paintInkPanel } from '../ui/theme';
import {
  buy,
  buyRemoval,
  isCleanedOut,
  removalBlocked,
  removalPrice,
  shelf,
  type ShelfItem,
} from './shop';
import type { RoomOptionView } from './types';

/**
 * 商旅 — the counter. Every number on this screen was decided in `shop.ts`;
 * this file lays the goods out and reads back what a sale returned.
 *
 * Note what is absent, and is checked to be absent by `tests/integrity.test.ts`:
 * no `commit.once`, and not one call that writes to `RunState`. A tile that paid
 * itself out would sell the same relic twice the first time a player walked back
 * in from a fight taken elsewhere.
 *
 * The layout is one shelf rather than a menu of pop-ups on purpose: a shop's
 * only real decision is 「the purse covers one of these — which one」, and that
 * question cannot be asked unless all four kinds of goods are on screen at once.
 * The deck grid appears here for exactly one thing, 弃牌, where the choice is
 * which copy rather than which purchase.
 */

/**
 * Cards are drawn at full size and scaled down, and the scale is what the whole
 * vertical budget hangs off: the panel runs 96–566, the option row sits at 490,
 * and five card faces, their tags and six plates all have to land above it.
 * Hovering swells a card in place rather than lifting it — a lift at this height
 * would push the face up through the subtitle.
 */
const CARD_SCALE = 0.64;
const CARD_HOVER = 0.74;
const CARD_ROW_Y = 262;
const CARD_STEP = 152;
const CARD_TAG_Y = CARD_ROW_Y + (CARD_H * CARD_SCALE) / 2 + 22;

/** 宝物 and 丹药 share one row of plates under the cards, tags included. */
const PLATE_ROW_Y = 406;
const PLATE_STEP = 130;
const PLATE_W = 118;
const PLATE_H = 84;
const PLATE_TAG_DY = 28;

const TIP_W = 250;

const slotKey = (item: ShelfItem): string => `${item.slot.kind}:${item.slot.index}`;

export class ShopController implements RoomController {
  private host!: RoomHost;
  /** Cleared and rebuilt after every sale rather than patched in place. */
  private goods!: Phaser.GameObjects.Container;
  /** One container per slot, so a refusal can shake the tile that was clicked. */
  private tiles = new Map<string, Phaser.GameObjects.Container>();

  private tip!: Phaser.GameObjects.Container;
  private tipPanel!: Phaser.GameObjects.Graphics;
  private tipText!: Phaser.GameObjects.Text;

  enter(host: RoomHost): void {
    this.host = host;
    host.setTitle('商 旅', '车马载货，明码标价。');
    // A shop asks nothing of the player, so the door is never barred.
    host.setEscPolicy('leave');

    this.goods = host.layer();
    this.buildTip();
    this.redraw();
  }

  dispose(): void {
    this.killTweens();
  }

  /** Tweens outlive the objects they move unless something says otherwise. */
  private killTweens(): void {
    const { scene } = this.host;
    for (const tile of this.tiles.values()) {
      scene.tweens.killTweensOf(tile);
      scene.tweens.killTweensOf(tile.list);
    }
  }

  // --------------------------------------------------------------- tooltip

  private buildTip(): void {
    const { scene } = this.host;
    this.tip = this.host.layer(20);
    this.tipPanel = scene.add.graphics();
    this.tipText = scene.add.text(0, 0, '', {
      ...bodyStyle(13, C.paperDim),
      wordWrap: { width: TIP_W - 24 },
      lineSpacing: 4,
    });
    this.tip.add([this.tipPanel, this.tipText]);
    this.tip.setVisible(false);
  }

  private showTip(x: number, top: number, name: string, text: string): void {
    this.tipText.setText(`${name}\n${text}`);
    const h = this.tipText.height + 22;
    const left = Phaser.Math.Clamp(x - TIP_W / 2, 12, GAME_WIDTH - TIP_W - 12);
    paintInkPanel(this.tipPanel, left, top - h - 10, TIP_W, h);
    this.tipText.setPosition(left + 12, top - h + 1);
    this.tip.setVisible(true);
  }

  private hideTip(): void {
    this.tip.setVisible(false);
  }

  // ----------------------------------------------------------------- drawing

  private redraw(): void {
    this.killTweens();
    this.goods.removeAll(true);
    this.tiles.clear();
    this.hideTip();

    const items = shelf(this.host.run, this.host.node.id);
    // The counter says so itself once there is nothing left on it — the seals
    // alone read as "sold out to me", not as "the caravan is packing up".
    this.host.setTitle(
      '商 旅',
      isCleanedOut(this.host.run, this.host.node.id)
        ? '货已售罄，车马将行。'
        : '车马载货，明码标价。',
    );

    const cards = items.filter((item) => item.slot.kind === 'card');
    const rest = items.filter((item) => item.slot.kind !== 'card');

    cards.forEach((item, i) =>
      this.drawCard(item, GAME_WIDTH / 2 + (i - (cards.length - 1) / 2) * CARD_STEP),
    );
    rest.forEach((item, i) =>
      this.drawPlate(item, GAME_WIDTH / 2 + (i - (rest.length - 1) / 2) * PLATE_STEP),
    );

    this.showRemoval();
  }

  /** A tile owns everything drawn for one slot, so it can be shaken as one. */
  private tileFor(item: ShelfItem): Phaser.GameObjects.Container {
    const tile = this.host.scene.add.container(0, 0);
    this.goods.add(tile);
    this.tiles.set(slotKey(item), tile);
    return tile;
  }

  private drawCard(item: ShelfItem, x: number): void {
    const { scene } = this.host;
    const tile = this.tileFor(item);

    const card = new CardView(
      scene,
      `shop-${slotKey(item)}`,
      item.id,
      item.upgraded,
      undefined,
      'display',
    );
    card.setPosition(x, CARD_ROW_Y);
    card.setScale(CARD_SCALE);
    tile.add(card);
    this.priceTag(tile, item, x, CARD_TAG_Y);

    if (item.sold) {
      card.setAlpha(0.3);
      this.seal(tile, x, CARD_ROW_Y, CARD_W * CARD_SCALE - 8);
      return;
    }
    // Unaffordable stock stays lit enough to read: the player is deciding what
    // to come back for, not being told to look away.
    if (item.blocked) card.setAlpha(0.55);

    const swell = (scale: number): void => {
      scene.tweens.add({ targets: card, scale, duration: 140, ease: 'Back.easeOut' });
    };
    card.hitZone.on('pointerover', () => swell(CARD_HOVER));
    card.hitZone.on('pointerout', () => swell(CARD_SCALE));
    card.hitZone.on(
      'pointerup',
      this.host.action(() => this.attempt(item, x, CARD_ROW_Y)),
    );
  }

  private drawPlate(item: ShelfItem, x: number): void {
    const { scene } = this.host;
    const tile = this.tileFor(item);
    const isRelic = item.slot.kind === 'relic';
    const accent = item.sold ? C.paperFaint : isRelic ? C.gold : C.jade;

    tile.add([
      inkPanel(scene, x - PLATE_W / 2, PLATE_ROW_Y - PLATE_H / 2, PLATE_W, PLATE_H, {
        border: accent,
      }),
      scene.add
        .text(
          x,
          PLATE_ROW_Y - PLATE_H / 2 + 8,
          isRelic ? '宝 物' : '丹 药',
          bodyStyle(11, C.paperFaint),
        )
        .setOrigin(0.5, 0),
      scene.add
        .text(x, PLATE_ROW_Y - 4, item.name, brushStyle(19, item.sold ? C.paperFaint : C.paper))
        .setOrigin(0.5)
        .setLetterSpacing(1),
    ]);
    // Inside the plate, not under it: the option row starts at 459 and a tag
    // hanging off the bottom edge would sit on top of the 弃牌 button.
    this.priceTag(tile, item, x, PLATE_ROW_Y + PLATE_TAG_DY);

    if (item.sold) {
      this.seal(tile, x, PLATE_ROW_Y, PLATE_W - 20);
      return;
    }

    const relic = isRelic ? getRelic(item.id) : undefined;
    const text = isRelic ? (relic ? relicText(relic) : '') : potionText(getPotion(item.id));

    const hit = scene.add
      .zone(x, PLATE_ROW_Y, PLATE_W, PLATE_H)
      .setInteractive({ useHandCursor: true });
    tile.add(hit);
    hit.on('pointerover', () => this.showTip(x, PLATE_ROW_Y - PLATE_H / 2, item.name, text));
    hit.on('pointerout', () => this.hideTip());
    hit.on(
      'pointerup',
      this.host.action(() => this.attempt(item, x, PLATE_ROW_Y)),
    );
  }

  /**
   * The tag. A discounted slot prints the old number struck through beside the
   * new one — a lone 「32」 with nothing to measure it against is not a bargain,
   * it is just a price.
   */
  private priceTag(
    tile: Phaser.GameObjects.Container,
    item: ShelfItem,
    x: number,
    y: number,
  ): void {
    const { scene } = this.host;
    if (item.sold) {
      tile.add(scene.add.text(x, y, '已 售', bodyStyle(15, C.paperFaint)).setOrigin(0.5));
      return;
    }

    const label = scene.add
      .text(x, y, `价 ${item.price}`, brushStyle(19, item.blocked ? C.cinnabarBright : C.goldBright))
      .setOrigin(0.5)
      .setLetterSpacing(1);
    tile.add(label);
    if (item.listPrice === null) return;

    const old = scene.add
      .text(x - label.width / 2 - 6, y + 1, String(item.listPrice), bodyStyle(13, C.paperFaint))
      .setOrigin(1, 0.5);
    const strike = scene.add.graphics();
    strike.lineStyle(1, C.cinnabarBright, 0.9);
    strike.lineBetween(old.x - old.width - 1, old.y, old.x + 1, old.y);
    // 「减」 rather than a percentage: it is the merchant's seal, not a label.
    tile.add([
      old,
      strike,
      scene.add
        .text(x + label.width / 2 + 7, y, '减', brushStyle(16, C.goldBright))
        .setOrigin(0, 0.5),
    ]);
  }

  /** A cinnabar seal across a slot that is spoken for. */
  private seal(tile: Phaser.GameObjects.Container, x: number, y: number, w: number): void {
    const { scene } = this.host;
    const box = scene.add.graphics();
    box.lineStyle(2, C.cinnabar, 0.85);
    box.strokeRect(-w / 2, -18, w, 36);
    box.setPosition(x, y).setAngle(-12);
    tile.add([
      box,
      scene.add
        .text(x, y, '售 罄', brushStyle(23, C.cinnabar))
        .setOrigin(0.5)
        .setLetterSpacing(3)
        .setAngle(-12),
    ]);
  }

  // -------------------------------------------------------------------- 弃牌

  private showRemoval(): void {
    const { run, node } = this.host;
    const blocked = removalBlocked(run, node.id);
    const option: RoomOptionView = {
      id: 'removal',
      label: '弃 牌',
      hint: `资财 ${removalPrice(run)}　·　去牌一张`,
      tone: 'gold',
    };
    if (blocked) {
      option.disabled = true;
      option.disabledReason = blocked;
      option.hint = blocked;
    }
    this.host.showOptions([option], () => this.openRemoval());
  }

  /**
   * The deck, so the player picks the physical copy. Cancellable and confirmed:
   * this is the most expensive irreversible click in a run, and 「劈砍」 against
   * 「劈砍·精」 is a distinction the grid has to let them make.
   */
  private openRemoval(): void {
    const { host } = this;
    const price = removalPrice(host.run);
    host.pickCards({
      title: '弃 牌',
      subtitle: `割爱一张，资财 ${price}`,
      count: 1,
      confirmText: '割 爱',
      footerHint: `择一张弃去　·　资财 ${price}`,
      cancellable: true,
      // 不可移除的牌（宿业，todos/19 a4）压暗不可选——`buyRemoval` 在门后
      // 还有同一道闸，这里只是让玩家先看见。
      disable: (card) => removeDisabledReason(card),
      onPick: (uids) => {
        const uid = uids[0];
        // Cancelled, or a deck with nothing left to give: the counter is
        // untouched either way, so the shelf simply comes back.
        if (uid && buyRemoval(host.run, host.node.id, uid)) {
          host.refreshHud();
          host.floatText(GAME_WIDTH / 2, PLATE_ROW_Y + 70, `-${price}`, 'gold');
        }
        this.redraw();
      },
      onCancel: () => this.redraw(),
    });
  }

  // ------------------------------------------------------------------ buying

  private attempt(item: ShelfItem, x: number, y: number): void {
    const { host } = this;
    const result = buy(host.run, host.node.id, item.slot);
    if (result === 'ok') {
      host.refreshHud();
      host.floatText(x, y - 40, `-${item.price}`, 'gold');
      this.redraw();
      return;
    }
    if (result === 'sold') {
      // The slot closed under us — a relic won from an 奇遇 while this shelf sat
      // frozen, or a click that landed twice. Redraw rather than argue.
      this.redraw();
      return;
    }
    host.floatText(x, y - 40, result === 'poor' ? '资财不足' : '丹药囊已满', 'danger');
    this.nudge(item);
  }

  /** Refused, visibly: the tile flinches rather than swallowing the click. */
  private nudge(item: ShelfItem): void {
    const tile = this.tiles.get(slotKey(item));
    if (!tile) return;
    const { scene } = this.host;
    scene.tweens.killTweensOf(tile);
    tile.x = 0;
    scene.tweens.add({
      targets: tile,
      x: { from: -5, to: 5 },
      duration: 55,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        tile.x = 0;
      },
    });
  }
}
