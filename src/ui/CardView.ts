import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { CARD_TYPE_META, KEYWORD_LABEL, resolveCard } from '../combat/cards';
import { X_COST, canPlay, describeCard, effectiveCardCost, hasKeyword } from '../combat/engine';
import type { CardDef, CombatState } from '../combat/types';
import { Rng } from '../core/rng';
import { KEYWORDS, cardTipSegments, findKeywords } from './keywords';
import { composeTip, placeTip, type TipBox, type TipSide, type TooltipManager } from './Tooltip';
import { bodyStyle, brushStyle, paintInkPanel } from './theme';
import { dur } from './timing';

export const CARD_W = 144;
export const CARD_H = 200;

/** 悬停抬升的高度（相对手位）。放大后的卡底仍留在屏内。 */
const HOVER_LIFT = 90;

/** 交互增补 (todos/24 k3)。都不传就是老样子——奖励卡、牌堆查看器不动。 */
export interface CardViewOptions {
  /** 悬停放大倍率，~1.35 即全尺寸可读；0 = 沿用旧式轻抬（1.18）。 */
  hoverScale?: number;
  /** 拖拽出牌：把主点击区标成可拖拽，dragstart/drag/dragend 由场景接线。 */
  draggable?: boolean;
}

/** Art window, in card-local coordinates. Matches the 3:2 crop of the plates. */
const ART = { y: -44, w: 136, h: 91 };

/** 规则文本的行距。热区定位（todos/24 k2）要按它算行高，抽出来两处共用。 */
const DESC_LINE_SPACING = 6;
/** Legendary's violet-gold edge is deliberately independent of card type. */
const LEGENDARY_VIOLET = 0xb88cff;

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
  /** Tab 展开排 (todos/24 k6) 在 9-10 张时整排微缩，恢复时回它不回 1。 */
  homeScale = 1;

  private playable = true;
  /** 'display' cards (reward picks, deck viewers) never grey out on energy. */
  private readonly mode: 'hand' | 'display';
  /** Frame + text colour: gold for type, bright gold once forged. */
  private readonly accent: number;
  /**
   * 关键词 tooltip (todos/24 k2)：手牌把战斗场景的管理器递进来，规则文本
   * 里的「破绽」「消耗」就长出悬停热区。不递（奖励卡、牌堆查看器）则
   * 一个热区都不建——那些卡活在 overlay 深度里，场景级面板会被盖住。
   */
  private readonly tips?: TooltipManager;
  private keywordZones: Phaser.GameObjects.Zone[] = [];
  /** 悬停放大倍率 (todos/24 k3)。0 = 旧式轻抬。 */
  private readonly hoverScale: number;
  /** 拖拽出牌 (k3)。关键词热区要按它决定转不转发 drag 三件事。 */
  private readonly draggable: boolean;

  constructor(
    scene: Phaser.Scene,
    uid: string,
    defId: string,
    upgraded: number,
    state: CombatState | undefined,
    mode: 'hand' | 'display' = 'hand',
    tips?: TooltipManager,
    opts: CardViewOptions = {},
  ) {
    super(scene, 0, 0);
    this.uid = uid;
    this.upgraded = upgraded;
    this.mode = mode;
    this.tips = tips;
    this.hoverScale = opts.hoverScale ?? 0;
    this.draggable = opts.draggable === true;

    const def = resolveCard(defId, upgraded);
    this.def = def;

    // Legendary cards keep their own violet-gold identity; forging brightens
    // the copy but does not turn it back into an ordinary type-coloured card.
    const accent =
      def.rarity === 'legendary'
        ? (upgraded > 0 ? C.goldBright : LEGENDARY_VIOLET)
        : (upgraded > 0 ? C.goldBright : CARD_TYPE_META[def.type].color);
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
        lineSpacing: DESC_LINE_SPACING,
      })
      .setOrigin(0.5, 0);

    // Keywords ride along the bottom edge in small grey type, the way the
    // original prints them — they change the card's life cycle, not its numbers,
    // so they must not compete with the rules text above.
    const keywords = scene.add
      .text(
        0,
        CARD_H / 2 - 13,
        (def.keywords ?? []).map((k) => KEYWORD_LABEL[k]).join(' · '),
        bodyStyle(11, C.paperFaint),
      )
      .setOrigin(0.5)
      .setLetterSpacing(1);

    // Cost orb. An unplayable card has no cost to pay, and printing a 0 on one
    // invites the player to keep trying to spend it.
    const payable = !hasKeyword(def, 'unplayable');
    const orb = scene.add.graphics();
    if (payable) {
      orb.fillStyle(C.inkDeep, 1);
      orb.fillCircle(-56, -78, 17);
      orb.lineStyle(2, C.goldBright, 0.95);
      orb.strokeCircle(-56, -78, 17);
    }
    this.costText = scene.add
      .text(
        -56,
        -78,
        payable ? (def.cost === X_COST ? 'X' : String(def.cost)) : '',
        brushStyle(21, C.goldBright),
      )
      .setOrigin(0.5);

    // The type tag keeps its own colour — it reads type, not upgrade state.
    const typeTag = scene.add
      .text(
        56,
        -78,
        def.rarity === 'legendary'
          ? `${CARD_TYPE_META[def.type].label}·传`
          : CARD_TYPE_META[def.type].label,
        brushStyle(def.rarity === 'legendary' ? 15 : 18, CARD_TYPE_META[def.type].color),
      )
      .setOrigin(0.5);

    // Greys the whole face out when the card is unaffordable.
    this.dimmer = scene.add.graphics();
    this.dimmer.fillStyle(C.inkDeep, 0.62);
    this.dimmer.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    this.dimmer.setVisible(false);

    // 拖拽出牌 (todos/24 k3)：draggable 只在这里标一次，三个 drag 事件的
    // 接线在场景层——CardView 不知道箭头和敌人热区长什么样。
    this.hit = scene.add.zone(0, 0, CARD_W, CARD_H).setInteractive({
      useHandCursor: true,
      draggable: this.draggable,
    });

    this.add([shadow, this.frame, art, artFade, rule, name, this.descText, keywords, orb, this.costText, typeTag, this.dimmer, this.hit]);
    this.setSize(CARD_W, CARD_H);
    scene.add.existing(this);

    this.refresh(state);
  }

  private paintFrame(accent: number, highlighted: boolean): void {
    const g = this.frame;
    g.clear();
    g.fillStyle(this.def.type === 'curse' ? C.inkDeep : C.ink, 1);
    g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    if (this.def.type === 'curse') this.paintCracks(g);
    const legendary = this.def.rarity === 'legendary';
    g.lineStyle(
      highlighted ? 3 : legendary ? 3 : 2,
      highlighted ? C.goldBright : accent,
      highlighted ? 1 : legendary ? 0.95 : 0.8,
    );
    g.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    g.lineStyle(legendary ? 1.5 : 1, legendary ? C.goldBright : C.paper, legendary ? 0.7 : 0.12);
    g.strokeRoundedRect(-CARD_W / 2 + 4, -CARD_H / 2 + 4, CARD_W - 8, CARD_H - 8, 5);
    if (legendary) {
      g.fillStyle(C.goldBright, highlighted ? 1 : 0.85);
      for (const x of [-CARD_W / 2 + 10, CARD_W / 2 - 10]) {
        g.fillCircle(x, -CARD_H / 2 + 10, 3.5);
      }
    }
  }

  /**
   * 诅咒 only: a dried-blood fracture running under the whole face, so the card
   * reads as damaged goods from across the table. Seeded off the card id rather
   * than rolled, so the same curse cracks the same way every time it is drawn.
   */
  private paintCracks(g: Phaser.GameObjects.Graphics): void {
    const rng = new Rng(`curse:${this.def.id}`);
    for (let i = 0; i < 3; i++) {
      let x = -CARD_W / 2 + rng.next() * CARD_W;
      let y = -CARD_H / 2;
      g.lineStyle(1.2, C.blood, 0.5);
      g.beginPath();
      g.moveTo(x, y);
      while (y < CARD_H / 2) {
        x += rng.jitter(16);
        y += 14 + rng.next() * 16;
        g.lineTo(x, y);
      }
      g.strokePath();
    }
  }

  /** Re-read the combat state: playability and the live damage/block numbers. */
  refresh(state: CombatState | undefined): void {
    this.descText.setText(describeCard(state, this.def));
    const cost = this.mode === 'hand' ? effectiveCardCost(state, this.def) : this.def.cost;
    this.costText.setText(
      hasKeyword(this.def, 'unplayable') ? '' : cost === X_COST ? 'X' : String(cost),
    );
    // 文本可能换行不同了（数字随状态变宽），热区跟着文本重铺。
    this.rebuildKeywordZones();
    // The engine's own gate, so 束缚 / 不可打出 / X 费 grey the face by exactly
    // the rule that will refuse the click.
    this.playable = this.mode === 'display' || (!!state && canPlay(state, this.uid));
    this.dimmer.setVisible(!this.playable);
    this.costText.setColor(this.playable ? '#f0d67a' : '#8a7f66');
  }

  /**
   * 规则文本里的关键词热区 (todos/24 k2)。`findKeywords` 在**折行后的每一
   * 行**里找词——`getWrappedText` 跑的就是渲染用的同一套折行算法，量出来
   * 的位置和画出来的字不会漂。Phaser 的 `Text` 不吐字符坐标，只能拿同字体
   * 的隐藏 Text 逐段测宽。颜色高亮是第二步，todo 明说可以不做。
   *
   * 热区叠在主点击区 `this.hit` 之上（输入 topOnly 只喂最上层），四个指针
   * 事件原样转发回去——不转发，出牌那一下和悬停抬卡就被词条吞了。可拖拽
   * 的牌 (k3) 连 drag 三件事一起转发：不然从「消耗」两个字上起手就拖不动。
   */
  private rebuildKeywordZones(): void {
    const tips = this.tips;
    if (!tips) return;
    for (const zone of this.keywordZones) zone.destroy();
    this.keywordZones = [];

    const text = this.descText.text;
    if (!text) return;

    const ruler = this.scene.make.text({ style: bodyStyle(13), add: false });
    const measure = (s: string): number => {
      ruler.setText(s);
      return ruler.width;
    };
    ruler.setText('永');
    const lineH = ruler.height;

    this.descText.getWrappedText(text).forEach((line, row) => {
      const hits = findKeywords(line);
      if (hits.length === 0) return;
      // descText 原点 (0.5, 0)、align center：每一行都以 x=0 为中心。
      const lineW = measure(line);
      const rowY = this.descText.y + row * (lineH + DESC_LINE_SPACING) + lineH / 2;
      for (const hit of hits) {
        const termW = measure(hit.term);
        const x = -lineW / 2 + measure(line.slice(0, hit.index)) + termW / 2;
        this.addKeywordZone(tips, hit.term, x, rowY, termW + 4, lineH + 2);
      }
    });
    ruler.destroy();

    // 卡底关键词行：「消耗」「虚无」印在这行小字里，规则文本未必再提
    // 它们——热区只铺规则文本时，悬停真正的「消耗」二字反而什么都不出
    // (验收点名这一条)。行文本是 KEYWORD_LABEL 按「 · 」拼的，逐词量宽。
    const terms = (this.def.keywords ?? []).map((k) => KEYWORD_LABEL[k]);
    if (terms.length > 0) {
      const rowRuler = this.scene.make.text({ style: bodyStyle(11), add: false });
      rowRuler.setLetterSpacing(1);
      const mw = (s: string): number => {
        rowRuler.setText(s);
        return rowRuler.width;
      };
      const joined = terms.join(' · ');
      const rowW = mw(joined);
      rowRuler.setText('永');
      const rowH = rowRuler.height;
      let from = 0;
      for (const term of terms) {
        const at = joined.indexOf(term, from);
        from = at + term.length;
        const termW = mw(term);
        const x = -rowW / 2 + mw(joined.slice(0, at)) + termW / 2;
        this.addKeywordZone(tips, term, x, CARD_H / 2 - 13, termW + 4, rowH + 2);
      }
      rowRuler.destroy();
    }

    // 费用球上的「X」：X 费印在球里而不在规则文本里，上面两轮都扫不到
    // 它——虎牢关的手牌悬停「X」本该有说法（cardTipTerms 同一笔账）。
    if (this.def.cost === X_COST) {
      this.addKeywordZone(tips, 'X', -56, -78, 36, 36);
    }
  }

  /** 一块词条热区：叠在主点击区之上，指针/拖拽事件原样转发回去。 */
  private addKeywordZone(
    tips: TooltipManager,
    term: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const def = KEYWORDS[term];
    if (!def) return;
    const zone = this.scene.add
      .zone(x, y, w, h)
      .setInteractive({ useHandCursor: true, draggable: this.draggable });
    zone.on('pointerover', () => this.hit.emit('pointerover'));
    zone.on('pointerout', () => this.hit.emit('pointerout'));
    zone.on('pointerdown', () => this.hit.emit('pointerdown'));
    zone.on('pointerup', () => this.hit.emit('pointerup'));
    if (this.draggable) {
      zone.on('dragstart', (p: Phaser.Input.Pointer) => this.hit.emit('dragstart', p));
      zone.on('drag', (p: Phaser.Input.Pointer) => this.hit.emit('drag', p));
      zone.on('dragend', (p: Phaser.Input.Pointer) => this.hit.emit('dragend', p));
    }
    tips.register({
      zone,
      content: () => [{ title: def.title, body: def.body, color: def.color }],
    });
    this.add(zone);
    this.keywordZones.push(zone);
  }

  /**
   * 悬停抬牌 (todos/24 k3)：放大到 hoverScale（~1.35 即全尺寸）、抬深度、
   * **旋转归零**——扇形排布的牌带着角度放大，规则文本斜着读不了。深度由
   * 场景传入：手牌的层叠账在场景手里。gate（busy/选敌中）也在场景。
   */
  hoverLift(depth: number): void {
    this.scene.tweens.killTweensOf(this);
    this.setDepth(depth);
    this.scene.tweens.add({
      targets: this,
      y: this.homeY - (this.hoverScale > 0 ? HOVER_LIFT : 78),
      angle: 0,
      scale: this.hoverScale > 0 ? this.hoverScale : 1.18,
      duration: dur(150),
      ease: 'Back.easeOut',
    });
  }

  /** pointerout 恢复：回扇形原位、原角度、原大小（homeScale，k6）。 */
  hoverDrop(depth: number): void {
    this.scene.tweens.killTweensOf(this);
    this.setDepth(depth);
    this.scene.tweens.add({
      targets: this,
      x: this.homeX,
      y: this.homeY,
      angle: this.homeAngle,
      scale: this.homeScale,
      duration: dur(160),
      ease: 'Quad.easeOut',
    });
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

// ---------------------------------------------------- 关键词悬浮面板 (k7)
//
// 战斗手牌逐词铺热区（上面的 rebuildKeywordZones）；其余每一处卡面——
// 战斗奖励、牌堆查看器的放大预览、商旅货架、图鉴、结算——悬停整卡时把
// 该卡的全部词条一次列成一块面板。手牌不用它：出牌途中每次悬停都弹一板
// 字是噪音，逐词热区才是那里的正确密度。
//
// 独立于 `TooltipManager` 的静态构建，因为这些卡活在各自的 overlay 深度
// 里（战罢层、CardGrid 的 900+、商旅的房间层），场景级管理器的面板会被
// 盖住；一块跟着宿主容器走的面板天然继承正确深度。样式与管理器同源：
// 同一块 `paintInkPanel` 墨板、同一套字号行距，玩家看不出两套来。

/** 面板内边距，与 TooltipManager 的 PAD 同值同义。 */
const TIP_PAD = 12;

export interface CardTipPanel {
  root: Phaser.GameObjects.Container;
  w: number;
  h: number;
}

/**
 * 一张卡的关键词汇总面板。没有词条可讲时返回 null——调用方一律先判空，
 * 白板卡（劈砍）悬停不该出一块空墨。
 */
export function cardTipPanel(
  scene: Phaser.Scene,
  def: CardDef,
  state?: CombatState,
): CardTipPanel | null {
  const { blocks, border } = composeTip(cardTipSegments(def, state));
  if (blocks.length === 0) return null;

  const bg = scene.add.graphics();
  const root = scene.add.container(0, 0, [bg]);
  let y = TIP_PAD - 2;
  let w = 96;
  for (const block of blocks) {
    const title = scene.add.text(TIP_PAD, y, block.title, bodyStyle(13, block.color));
    y += title.height + 3;
    const body = scene.add.text(TIP_PAD, y, block.body, {
      ...bodyStyle(13, C.paperDim),
      wordWrap: { width: 240 },
      lineSpacing: 4,
    });
    y += body.height + 9;
    w = Math.max(w, title.width, body.width);
    root.add([title, body]);
  }
  const panelW = w + TIP_PAD * 2;
  const panelH = y - 9 + TIP_PAD - 2;
  paintInkPanel(bg, 0, 0, panelW, panelH, { alpha: 0.94, border });
  return { root, w: panelW, h: panelH };
}

/**
 * 把面板摆到卡面世界坐标框的旁边——贴边翻转与出屏 clamp 走 `placeTip`
 * 的同一套规则。返回的落点是**世界坐标**；面板挂在带偏移的容器里时，
 * 调用方自减容器原点。
 */
export function placeCardTipPanel(
  panel: CardTipPanel,
  target: TipBox,
  side: TipSide | 'auto' = 'top',
): { x: number; y: number } {
  const at = placeTip(side, target, { w: panel.w, h: panel.h }, { w: GAME_WIDTH, h: GAME_HEIGHT });
  panel.root.setPosition(at.x, at.y);
  return at;
}

export interface CardPreviewOptions {
  defId: string;
  upgraded: number;
  /** Desired centre, world coordinates. Clamped so the face never leaves the screen. */
  x: number;
  y: number;
  depth?: number;
  state?: CombatState;
  /** 词条面板开在哪一侧。缺省 'right'；装不下时 placeTip 自会翻转。 */
  tipSide?: TipSide;
}

/**
 * 悬停放大的独卡预览：全尺寸牌面 + 词条面板，一个容器一次建好。
 * 图鉴、结算牌组、史料详录共用——`CardGrid.showPreview` 因为还背着
 * 锻造比较和 disabledReason，保留自己的装配，但面板走同一个构建器。
 *
 * 调用方拿到容器后自持自灭（pointerout / 滚动 / 场景收场时 destroy）。
 */
export function openCardPreview(
  scene: Phaser.Scene,
  opts: CardPreviewOptions,
): Phaser.GameObjects.Container {
  const px = Phaser.Math.Clamp(opts.x, CARD_W / 2 + 12, GAME_WIDTH - CARD_W / 2 - 12);
  const py = Phaser.Math.Clamp(opts.y, CARD_H / 2 + 12, GAME_HEIGHT - CARD_H / 2 - 16);
  const layer = scene.add.container(px, py);
  if (opts.depth !== undefined) layer.setDepth(opts.depth);

  const card = new CardView(
    scene,
    `preview-${opts.defId}`,
    opts.defId,
    opts.upgraded,
    opts.state,
    'display',
  );
  // The blown-up copy must not steal the pointer from the thumbnail under it.
  card.hitZone.disableInteractive();
  layer.add(card);

  const panel = cardTipPanel(scene, resolveCard(opts.defId, opts.upgraded), opts.state);
  if (panel) {
    const at = placeCardTipPanel(
      panel,
      { x: px - CARD_W / 2, y: py - CARD_H / 2, w: CARD_W, h: CARD_H },
      opts.tipSide ?? 'right',
    );
    panel.root.setPosition(at.x - px, at.y - py);
    layer.add(panel.root);
  }

  layer.setScale(0.62).setAlpha(0.7);
  scene.tweens.add({ targets: layer, scale: 1, alpha: 1, duration: 120, ease: 'Back.easeOut' });
  return layer;
}
