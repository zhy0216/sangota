import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { Rng } from '../core/rng';
import { REWARD_POOL, STATUS_META, STATUS_ORDER } from '../combat/cards';
import { ENCOUNTERS } from '../combat/enemies';
import {
  canPlay,
  endPlayerTurn,
  intentLabel,
  playCard,
  resolveChoice,
  runEnemyTurn,
  startCombat,
} from '../combat/engine';
import { relicByBanner } from '../combat/relics';
import type { CombatEvent, CombatState, EnemyState, Encounter, StatusId } from '../combat/types';
import { addCard, addGold, applyCombatResult, getRun, type RunState } from '../state/run';
import { isCardGridOpen, openCardGrid, type CardGridEntry } from '../ui/CardGrid';
import { CARD_W, CardView } from '../ui/CardView';
import { RelicBar } from '../ui/RelicBar';
import { contentWidthAt, groundSprite } from '../ui/spriteBounds';
import { toDesign, useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, inkButton, paintInkPanel } from '../ui/theme';
import {
  burst,
  dust,
  hitStop,
  inkSplash,
  pop,
  popText,
  screenPulse,
  shieldFlare,
  slash,
  turnBanner,
} from '../ui/vfx';

type CombatNodeType = 'monster' | 'elite' | 'boss';

const BASELINE_Y = 420;
const PLAYER_X = 244;
const HAND_Y = 604;
const HAND_MAX_SPREAD = 760;

const DEPTH = {
  bg: 0,
  actors: 10,
  actorUi: 20,
  hand: 60,
  dragArrow: 70,
  hud: 80,
  float: 120,
  overlay: 200,
} as const;

const DRAW_PILE = { x: 62, y: 682 };
const DISCARD_PILE = { x: GAME_WIDTH - 62, y: 682 };
const EXHAUST_PILE = { x: GAME_WIDTH - 176, y: 682 };

/** A corner pile: an ink card-stack glyph, a count, and a grid behind it. */
interface PileCounter {
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  value: number;
}

interface ActorView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  blockBadge: Phaser.GameObjects.Container;
  blockText: Phaser.GameObjects.Text;
  statusRow: Phaser.GameObjects.Container;
  /** Display height in design units — used to aim effects at the torso. */
  height: number;
  barWidth: number;
  /** Home positions, so lunges and recoils always have something to return to. */
  baseX: number;
  spriteBaseX: number;
  baseScaleY: number;
  /**
   * Trailing HP value. Drains a beat behind the real bar so the player can see
   * how big the hit was after the fact.
   */
  ghost: { value: number };
}

interface EnemyView extends ActorView {
  enemy: EnemyState;
  intent: Phaser.GameObjects.Container;
  intentText: Phaser.GameObjects.Text;
  intentBg: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Zone;
  lastIntentLabel: string;
}

export class CombatScene extends Phaser.Scene {
  private run!: RunState;
  private state!: CombatState;
  private encounter!: Encounter;
  private nodeType: CombatNodeType = 'monster';

  private cardViews = new Map<string, CardView>();
  private enemyViews = new Map<string, EnemyView>();
  private playerView!: ActorView;

  private selectedUid: string | null = null;
  private busy = false;
  private finished = false;

  /** Built on the first hover — most fights never show a status tooltip. */
  private statusTip: Phaser.GameObjects.Container | null = null;
  private statusTipBg: Phaser.GameObjects.Graphics | null = null;
  private statusTipText: Phaser.GameObjects.Text | null = null;

  private energyText!: Phaser.GameObjects.Text;
  private energyMaxText!: Phaser.GameObjects.Text;
  private relicBar!: RelicBar;
  private turnText!: Phaser.GameObjects.Text;
  private drawPile!: PileCounter;
  private discardPile!: PileCounter;
  private exhaustPile!: PileCounter;
  private deckCount!: Phaser.GameObjects.Text;
  private endTurnBtn!: Phaser.GameObjects.Container;
  private arrow!: Phaser.GameObjects.Graphics;
  private energyOrb!: Phaser.GameObjects.Container;
  private lastEnergy = 0;
  /** The enemy currently resolving a move, so its hits can reach for the player. */
  private currentAttacker: ActorView | null = null;

  constructor() {
    super('Combat');
  }

  init(data: { nodeType?: CombatNodeType }): void {
    this.nodeType = data?.nodeType ?? 'monster';
    this.cardViews.clear();
    this.enemyViews.clear();
    this.selectedUid = null;
    this.busy = false;
    this.finished = false;
    this.currentAttacker = null;
    this.lastEnergy = 0;
    this.tweens.timeScale = 1;
  }

  create(): void {
    useDesignSpace(this);
    this.run = getRun();

    const seed = `${this.run.map.seed}:${this.run.currentNodeId ?? 'start'}`;
    const rng = new Rng(seed);
    const table = ENCOUNTERS[this.nodeType];
    this.encounter = rng.pick(table);

    this.state = startCombat({
      encounter: this.encounter,
      deck: this.run.deck,
      heroName: this.run.hero.name,
      hp: this.run.hp,
      maxHp: this.run.maxHp,
      relics: this.run.relics,
      seed,
    });

    this.buildBackground();
    this.buildPlayer();
    this.buildEnemies();
    this.buildHud();

    this.arrow = this.add.graphics().setDepth(DEPTH.dragArrow);

    // A card grid owns the input while it is up: Game Objects under it are
    // frozen, but scene-level pointer and key handlers still fire.
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, targets: unknown[]) => {
      // Clicking empty ground cancels targeting.
      if (targets.length === 0 && !isCardGridOpen(this)) this.clearSelection();
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!isCardGridOpen(this)) this.clearSelection();
    });
    this.input.keyboard?.on('keydown-E', () => {
      if (!isCardGridOpen(this)) void this.onEndTurn();
    });

    this.cameras.main.fadeIn(340, 8, 6, 4);
    this.syncHand();
    this.refresh();
  }

  // ------------------------------------------------------------- scaffolding

  private buildBackground(): void {
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'combat-bg').setDepth(DEPTH.bg);
    // 6% bleed: camera shake would otherwise pull empty space in at the edges.
    const scale = Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height) * 1.06;
    bg.setScale(scale);
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 1.1, GAME_HEIGHT * 1.1, C.inkDeep, 0.42)
      .setDepth(DEPTH.bg);

    // Ground shadow band so the cut-out actors sit on something. The gradient
    // fades in above the baseline and then holds solid to the bottom edge,
    // otherwise the rect's lower edge reads as a hard seam across the screen.
    const ground = this.add.graphics().setDepth(DEPTH.bg);
    const bleed = 60;
    ground.fillGradientStyle(C.inkDeep, C.inkDeep, C.inkDeep, C.inkDeep, 0, 0, 0.72, 0.72);
    ground.fillRect(-bleed, BASELINE_Y - 74, GAME_WIDTH + bleed * 2, 74);
    ground.fillStyle(C.inkDeep, 0.72);
    ground.fillRect(-bleed, BASELINE_Y, GAME_WIDTH + bleed * 2, GAME_HEIGHT - BASELINE_Y + bleed);
  }

  private makeActorView(
    x: number,
    key: string,
    height: number,
    flip: boolean,
    barWidth: number,
    hp: number,
  ): ActorView {
    const container = this.add.container(x, BASELINE_Y).setDepth(DEPTH.actors);

    const sprite = this.add.image(0, 0, key).setOrigin(0.5, 1);
    // Size and ground by the artwork's silhouette, not the plate's rectangle —
    // the cut-outs have inconsistent transparent margins.
    groundSprite(this, sprite, height);
    sprite.setFlipX(flip);

    const shadow = this.add.ellipse(
      0,
      4,
      contentWidthAt(this, key, height) * 0.9,
      height * 0.09,
      0x000000,
      0.45,
    );

    container.add([shadow, sprite]);

    // Idle breath: scaleY on an origin-(0.5, 1) sprite keeps the feet planted.
    // Randomised timing so a row of enemies doesn't pulse in lockstep.
    const baseScaleY = sprite.scaleY;
    this.tweens.add({
      targets: sprite,
      scaleY: baseScaleY * 1.016,
      duration: 1700 + Math.random() * 600,
      delay: Math.random() * 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const ui = this.add.container(x, BASELINE_Y).setDepth(DEPTH.actorUi);
    const bar = this.add.graphics();
    const hpText = this.add.text(0, 22, '', bodyStyle(13, C.paper)).setOrigin(0.5);

    const blockBadge = this.add.container(-barWidth / 2 - 16, 22);
    const shieldBg = this.add.graphics();
    shieldBg.fillStyle(0x2c4a63, 1);
    shieldBg.fillCircle(0, 0, 15);
    shieldBg.lineStyle(1.5, 0x9fc4e0, 0.9);
    shieldBg.strokeCircle(0, 0, 15);
    const blockText = this.add.text(0, 0, '0', bodyStyle(14, 0xdcefff)).setOrigin(0.5);
    blockBadge.add([shieldBg, blockText]);
    blockBadge.setVisible(false);

    const statusRow = this.add.container(0, 46);

    ui.add([bar, hpText, blockBadge, statusRow]);

    return {
      container,
      sprite,
      bar,
      hpText,
      blockBadge,
      blockText,
      statusRow,
      height,
      barWidth,
      baseX: x,
      spriteBaseX: sprite.x,
      baseScaleY,
      ghost: { value: hp },
    };
  }

  private buildPlayer(): void {
    // The hero plate already faces right, toward the enemy line — no flip.
    this.playerView = this.makeActorView(
      PLAYER_X,
      this.run.hero.fullKey,
      300,
      false,
      150,
      this.state.player.hp,
    );
    this.add
      .text(PLAYER_X, BASELINE_Y + 66, this.run.hero.name, brushStyle(18, C.paperDim))
      .setOrigin(0.5)
      .setDepth(DEPTH.actorUi);
  }

  private buildEnemies(): void {
    const xs = this.enemySlots(this.state.enemies.length);

    this.state.enemies.forEach((enemy, i) => {
      const base = this.makeActorView(xs[i], enemy.art, enemy.height, false, 140, enemy.hp);

      // Intent marker, pinned above the sprite but never under the top HUD.
      const intentY = Math.max(Math.min(-enemy.height - 30, -70), -(BASELINE_Y - 42));
      const intent = this.add.container(xs[i], BASELINE_Y + intentY).setDepth(DEPTH.actorUi);
      const intentBg = this.add.graphics();
      const intentText = this.add.text(0, 0, '', brushStyle(19, C.paper)).setOrigin(0.5);
      intent.add([intentBg, intentText]);

      this.add
        .text(xs[i], BASELINE_Y + 66, enemy.name, brushStyle(18, C.paperDim))
        .setOrigin(0.5)
        .setDepth(DEPTH.actorUi)
        .setName(`name-${enemy.id}`);

      const hitW = Math.max(120, contentWidthAt(this, enemy.art, enemy.height));
      const hit = this.add
        .zone(xs[i], BASELINE_Y - enemy.height / 2, hitW, enemy.height)
        .setDepth(DEPTH.actors);
      hit.setInteractive({ useHandCursor: true });

      const view: EnemyView = {
        ...base,
        enemy,
        intent,
        intentBg,
        intentText,
        hit,
        lastIntentLabel: '',
      };
      hit.on('pointerover', () => this.onEnemyOver(view, true));
      hit.on('pointerout', () => this.onEnemyOver(view, false));
      hit.on('pointerup', () => this.onEnemyClick(view));

      this.enemyViews.set(enemy.id, view);
    });
  }

  private enemySlots(count: number): number[] {
    if (count <= 1) return [872];
    if (count === 2) return [782, 1000];
    return [712, 880, 1048];
  }

  private buildHud(): void {
    const fixed = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as { setDepth: (v: number) => void }).setDepth(DEPTH.hud);
      return o;
    };

    // Top-left, not centred: the middle of the top edge belongs to the boss's
    // intent marker, which sits high when the sprite is tall.
    fixed(
      this.add.text(28, 20, this.encounter.name, brushStyle(22, C.paper)).setLetterSpacing(3),
    );
    this.turnText = this.add.text(30, 52, '', bodyStyle(14, C.paperFaint));
    fixed(this.turnText);

    // Energy orb. Wrapped in a container so it can be scale-popped on spend —
    // scaling a Graphics would pivot on the scene origin, not the orb.
    this.energyOrb = this.add.container(88, 556).setDepth(DEPTH.hud);
    const orb = this.add.graphics();
    orb.fillStyle(C.inkDeep, 0.95);
    orb.fillCircle(0, 0, 40);
    orb.lineStyle(3, C.goldBright, 0.95);
    orb.strokeCircle(0, 0, 40);
    orb.lineStyle(1, C.cinnabar, 0.6);
    orb.strokeCircle(0, 0, 46);
    this.energyText = this.add.text(0, -8, '', brushStyle(34, C.goldBright)).setOrigin(0.5);
    // The ceiling is printed too: a relic can move it, and a lone number would
    // give the player no way to tell 3 of 3 from 3 of 4.
    this.energyMaxText = this.add.text(0, 20, '', bodyStyle(13, C.paperDim)).setOrigin(0.5);
    this.energyOrb.add([orb, this.energyText, this.energyMaxText]);
    fixed(this.add.text(88, 606, '气', bodyStyle(13, C.paperFaint)).setOrigin(0.5));

    // Relic bar, clear of the encounter name on the left and of the boss's
    // intent marker, which rides high over the middle of the top edge.
    this.relicBar = new RelicBar(this, {
      x: 196,
      y: 18,
      depth: DEPTH.hud,
      tooltipDepth: DEPTH.float,
    });
    this.relicBar.setRelics(this.run.relics);

    // Piles. All four views read the same engine arrays the rules run on, so a
    // count on screen can never disagree with what is actually in the pile.
    this.drawPile = this.makePileCounter(DRAW_PILE.x, DRAW_PILE.y - 12, '抽牌堆', () =>
      // Contents yes, order no — the draw pile is displayed scrambled.
      this.openPile('抽 牌 堆', this.state.drawPile, true),
    );
    this.discardPile = this.makePileCounter(DISCARD_PILE.x, DISCARD_PILE.y - 12, '弃牌堆', () =>
      this.openPile('弃 牌 堆', this.state.discardPile),
    );
    this.exhaustPile = this.makePileCounter(EXHAUST_PILE.x, EXHAUST_PILE.y - 12, '消耗堆', () =>
      this.openPile('消 耗 堆', this.state.exhaustPile),
    );
    this.exhaustPile.container.setVisible(false);

    fixed(this.makeDeckButton(28, 76));

    this.endTurnBtn = inkButton(this, 1148, 556, '结束回合', {
      width: 186,
      height: 62,
      fontSize: 24,
      onClick: () => this.onEndTurn(),
    });
    this.endTurnBtn.setDepth(DEPTH.hud);
  }

  // -------------------------------------------------------------- pile views

  /**
   * The card-stack glyph is drawn rather than blitted: it has to stay crisp at
   * any RENDER_SCALE, and a real plate would only ever be one more thing to
   * keep in register with the palette.
   */
  private makePileCounter(x: number, y: number, label: string, onOpen: () => void): PileCounter {
    const container = this.add.container(x, y).setDepth(DEPTH.hud);

    const glyph = this.add.graphics();
    for (const [i, dx] of [-5, 0, 5].entries()) {
      glyph.fillStyle(C.ink, 0.92);
      glyph.fillRoundedRect(dx - 30, -19 + i * 2, 30, 40, 3);
      glyph.lineStyle(1.5, i === 2 ? C.gold : C.paperFaint, i === 2 ? 0.85 : 0.5);
      glyph.strokeRoundedRect(dx - 30, -19 + i * 2, 30, 40, 3);
    }

    const text = this.add.text(16, 2, '0', brushStyle(24, C.paper)).setOrigin(0.5);
    const name = this.add.text(-6, -34, label, bodyStyle(12, C.paperFaint)).setOrigin(0.5);
    const hit = this.add.zone(-6, -4, 100, 78).setInteractive({ useHandCursor: true });

    container.add([glyph, name, text, hit]);
    hit.on('pointerover', () => text.setColor(css(C.goldBright)));
    hit.on('pointerout', () => text.setColor(css(C.paper)));
    hit.on('pointerup', () => onOpen());

    return { container, text, value: 0 };
  }

  private makeDeckButton(x: number, y: number): Phaser.GameObjects.Container {
    const w = 116;
    const h = 34;
    const container = this.add.container(x + w / 2, y + h / 2).setDepth(DEPTH.hud);

    const bg = this.add.graphics();
    const paint = (hover: boolean): void => {
      bg.clear();
      bg.fillStyle(C.inkDeep, hover ? 0.92 : 0.72);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 3);
      bg.lineStyle(1, hover ? C.goldBright : C.gold, hover ? 0.9 : 0.45);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 3);
    };
    paint(false);

    const label = this.add.text(-w / 2 + 12, 0, '牌组', bodyStyle(15, C.paperDim)).setOrigin(0, 0.5);
    this.deckCount = this.add
      .text(w / 2 - 12, 0, '', brushStyle(20, C.gold))
      .setOrigin(1, 0.5);
    const hit = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });

    container.add([bg, label, this.deckCount, hit]);
    hit.on('pointerover', () => paint(true));
    hit.on('pointerout', () => paint(false));
    hit.on('pointerup', () => {
      openCardGrid(this, {
        title: '牌 组',
        subtitle: `共 ${this.run.deck.length} 张`,
        entries: this.run.deck.map((card) => ({ ...card })),
        mode: 'view',
        state: this.state,
      });
    });

    return container;
  }

  private openPile(title: string, uids: readonly string[], shuffleDisplay = false): void {
    const entries: CardGridEntry[] = uids.map((uid) => {
      const inst = this.state.cards[uid];
      return { uid, defId: inst.defId, upgraded: inst.upgraded };
    });
    openCardGrid(this, {
      title,
      subtitle: `共 ${entries.length} 张`,
      entries,
      mode: 'view',
      shuffleDisplay,
      state: this.state,
    });
  }

  /** Retype a count, popping the number when it actually moved. */
  private setCount(counter: PileCounter, value: number): void {
    if (counter.value === value) return;
    counter.value = value;
    counter.text.setText(String(value));
    this.tweens.killTweensOf(counter.text);
    counter.text.setScale(1);
    this.tweens.add({
      targets: counter.text,
      scale: 1.45,
      duration: 120,
      yoyo: true,
      ease: 'Back.easeOut',
    });
  }

  // -------------------------------------------------------------- hand cards

  /** Create views for newly drawn cards, destroy views for cards that left. */
  private syncHand(): void {
    // Cards that left the hand sail off to the discard pile.
    let leaving = 0;
    for (const [uid, view] of this.cardViews) {
      if (this.state.hand.includes(uid)) continue;
      this.cardViews.delete(uid);
      const delay = leaving++ * 45;
      view.hitZone.disableInteractive();
      this.tweens.add({
        targets: view,
        x: DISCARD_PILE.x,
        y: DISCARD_PILE.y,
        angle: 28,
        scale: 0.34,
        alpha: 0,
        delay,
        duration: 320,
        ease: 'Cubic.easeIn',
        onComplete: () => view.destroy(),
      });
    }

    // New cards are dealt out of the draw pile.
    let dealt = 0;
    for (const uid of this.state.hand) {
      if (this.cardViews.has(uid)) continue;
      const inst = this.state.cards[uid];
      const view = new CardView(this, uid, inst.defId, inst.upgraded, this.state);
      view.setDepth(DEPTH.hand);
      view.setAlpha(0);
      view.setPosition(DRAW_PILE.x, DRAW_PILE.y);
      view.setScale(0.34);
      view.setAngle(-26);
      view.setData('dealDelay', dealt++ * 60);
      view.hitZone.on('pointerover', () => this.onCardOver(view, true));
      view.hitZone.on('pointerout', () => this.onCardOver(view, false));
      view.hitZone.on('pointerup', () => this.onCardClick(view));
      this.cardViews.set(uid, view);
    }

    this.layoutHand();
  }

  private layoutHand(): void {
    const hand = this.state.hand;
    const n = hand.length;
    if (n === 0) return;

    const spacing = Math.min(CARD_W - 22, HAND_MAX_SPREAD / Math.max(1, n));
    const totalWidth = spacing * (n - 1);

    hand.forEach((uid, i) => {
      const view = this.cardViews.get(uid);
      if (!view) return;
      const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 .. 0.5
      const x = GAME_WIDTH / 2 + t * totalWidth;
      const angle = t * Math.min(12, n * 2.2);
      const y = HAND_Y + Math.abs(t) * 26;

      view.homeX = x;
      view.homeY = y;
      view.homeAngle = angle;
      view.setDepth(DEPTH.hand + i);

      const delay = (view.getData('dealDelay') as number | undefined) ?? 0;
      view.setData('dealDelay', 0);

      this.tweens.add({
        targets: view,
        x,
        y,
        angle,
        alpha: 1,
        scale: 1,
        delay,
        duration: delay > 0 ? 330 : 260,
        ease: delay > 0 ? 'Back.easeOut' : 'Cubic.easeOut',
      });
    });
  }

  private onCardOver(view: CardView, over: boolean): void {
    if (this.busy || this.finished) return;
    if (this.selectedUid && this.selectedUid !== view.uid) return;

    this.tweens.killTweensOf(view);
    if (over) {
      view.setDepth(DEPTH.hand + 40);
      this.tweens.add({
        targets: view,
        y: HAND_Y - 78,
        angle: 0,
        scale: 1.18,
        duration: 150,
        ease: 'Back.easeOut',
      });
    } else {
      view.setDepth(DEPTH.hand + this.state.hand.indexOf(view.uid));
      this.tweens.add({
        targets: view,
        x: view.homeX,
        y: view.homeY,
        angle: view.homeAngle,
        scale: 1,
        duration: 160,
        ease: 'Quad.easeOut',
      });
    }
  }

  private onCardClick(view: CardView): void {
    if (this.busy || this.finished) return;
    if (!canPlay(this.state, view.uid)) {
      popText(this, view.x, view.y - 118, '气不足', { color: C.cinnabarBright, size: 22 });
      this.tweens.add({
        targets: this.energyOrb,
        scale: 1.16,
        duration: 90,
        yoyo: true,
        ease: 'Sine.easeOut',
      });
      return;
    }

    if (view.def.target === 'enemy') {
      // Toggle targeting mode; the actual play happens on the enemy click.
      if (this.selectedUid === view.uid) this.clearSelection();
      else this.select(view);
      return;
    }
    void this.play(view.uid);
  }

  private select(view: CardView): void {
    this.clearSelection();
    this.selectedUid = view.uid;
    view.setSelected(true);
    view.setDepth(DEPTH.hand + 40);
    this.tweens.add({
      targets: view,
      y: HAND_Y - 78,
      angle: 0,
      scale: 1.18,
      duration: 140,
      ease: 'Back.easeOut',
    });
  }

  private clearSelection(): void {
    if (!this.selectedUid) return;
    const view = this.cardViews.get(this.selectedUid);
    this.selectedUid = null;
    this.arrow.clear();
    if (!view) return;
    view.setSelected(false);
    view.setDepth(DEPTH.hand + this.state.hand.indexOf(view.uid));
    this.tweens.add({
      targets: view,
      x: view.homeX,
      y: view.homeY,
      angle: view.homeAngle,
      scale: 1,
      duration: 160,
      ease: 'Quad.easeOut',
    });
  }

  // ------------------------------------------------------------- interaction

  private onEnemyOver(view: EnemyView, over: boolean): void {
    if (this.finished || !view.enemy.alive) return;
    // Only light up while a card is actually waiting for a target.
    if (over && this.selectedUid) view.sprite.setTint(0xffcfae);
    else view.sprite.clearTint();
  }

  private onEnemyClick(view: EnemyView): void {
    if (this.busy || this.finished || !this.selectedUid) return;
    if (!view.enemy.alive) return;
    const uid = this.selectedUid;
    this.selectedUid = null;
    this.arrow.clear();
    this.cardViews.get(uid)?.setSelected(false);
    void this.play(uid, view.enemy.id);
  }

  private async play(uid: string, targetId?: string): Promise<void> {
    const view = this.cardViews.get(uid);
    if (!view) return;
    const def = view.def;

    this.busy = true;

    // Sweep the card up to centre stage, then burst it into ink.
    this.tweens.add({
      targets: view,
      x: GAME_WIDTH / 2,
      y: 300,
      angle: 0,
      scale: 1.12,
      duration: 150,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: view,
      alpha: 0,
      scale: 0.86,
      delay: 170,
      duration: 150,
      ease: 'Quad.easeIn',
    });
    await this.wait(150);
    burst(this, GAME_WIDTH / 2, 300, {
      color: def.type === 'attack' ? 0xe8543c : def.type === 'power' ? 0xf0d67a : 0x6fb0a0,
      count: 12,
      speed: 240,
      scale: 0.13,
    });

    // Take the view out of the map before playing so syncHand doesn't also try
    // to fly the same card to the discard pile.
    this.cardViews.delete(uid);
    view.destroy();

    if (!playCard(this.state, uid, targetId)) {
      this.busy = false;
      this.syncHand();
      this.refresh();
      return;
    }

    if (def.type === 'attack') {
      await this.lunge(this.playerView, 1, 76, 110);
    }

    await this.playEvents();
    await this.settleChoices();
    this.syncHand();
    this.refresh();
    this.busy = false;
    this.checkOutcome();
  }

  /**
   * A card that stopped to ask something holds the whole fight: the grid is
   * opened with no way out, and the engine refuses every other action until it
   * is answered. One card can ask more than once, hence the loop.
   */
  private async settleChoices(): Promise<void> {
    while (this.state.pendingChoice) {
      const choice = this.state.pendingChoice;
      const title = choice.kind === 'exhaust' ? '消 耗' : choice.kind === 'putOnDraw' ? '置 顶' : '弃 牌';

      await new Promise<void>((resolve) => {
        openCardGrid(this, {
          title,
          subtitle: `选 ${choice.min} 张`,
          entries: choice.options.map((uid) => {
            const inst = this.state.cards[uid];
            return { uid, defId: inst.defId, upgraded: inst.upgraded };
          }),
          mode: 'pick',
          pickCount: choice.min,
          state: this.state,
          // No `onClose`: the pick is mandatory, which is what the engine's
          // frozen state already assumes.
          onPick: (uids) => {
            resolveChoice(this.state, uids);
            resolve();
          },
        });
      });

      this.syncHand();
      await this.playEvents();
    }
  }

  /** Step an actor toward its foe and let it drift back on its own. */
  private async lunge(
    view: ActorView,
    dir: number,
    distance = 60,
    ms = 92,
  ): Promise<void> {
    dust(this, view.container.x + dir * 24, BASELINE_Y + 2, dir);
    this.tweens.add({
      targets: view.container,
      x: view.baseX + dir * distance,
      duration: ms,
      ease: 'Quad.easeIn',
    });
    await this.wait(ms);
    this.tweens.add({
      targets: view.container,
      x: view.baseX,
      delay: 90,
      duration: 340,
      ease: 'Back.easeOut',
    });
  }

  /** Knock an actor back from an impact, without disturbing its container. */
  private recoil(view: ActorView, dir: number): void {
    this.tweens.killTweensOf(view.sprite);
    view.sprite.x = view.spriteBaseX;
    this.tweens.add({
      targets: view.sprite,
      x: view.spriteBaseX + dir * 16,
      duration: 70,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeOut',
      onComplete: () => {
        view.sprite.x = view.spriteBaseX;
        // Restore the idle breath the kill above interrupted.
        this.tweens.add({
          targets: view.sprite,
          scaleY: view.baseScaleY * 1.016,
          duration: 1700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });
  }

  /** Aim point for effects — roughly the actor's torso. */
  private torso(view: ActorView): { x: number; y: number } {
    return { x: view.container.x, y: BASELINE_Y - view.height * 0.55 };
  }

  /**
   * Impact flash. Tinting the sprite itself with `setTintFill` flattens it into
   * a solid white silhouette, which reads as a glitch against painterly art —
   * so this lights up an additive copy instead, keeping all the detail.
   */
  private flashHit(view: ActorView): void {
    const flash = this.add
      .image(
        view.container.x + view.sprite.x,
        BASELINE_Y + view.sprite.y,
        view.sprite.texture.key,
      )
      .setOrigin(0.5, 1)
      .setScale(view.sprite.scaleX, view.sprite.scaleY)
      .setFlipX(view.sprite.flipX)
      .setTintFill(0xffdcc0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.62)
      .setDepth(DEPTH.actors + 1);

    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 170,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private async onEndTurn(): Promise<void> {
    if (this.busy || this.finished || this.state.phase !== 'player') return;
    this.clearSelection();
    this.busy = true;

    endPlayerTurn(this.state);
    await this.playEvents();
    this.syncHand();
    this.refresh();

    await turnBanner(this, GAME_WIDTH, GAME_HEIGHT, '敌 方 回 合', C.cinnabarBright);

    runEnemyTurn(this.state);
    await this.playEvents();
    this.currentAttacker = null;
    this.syncHand();
    this.refresh();

    // Fire-and-forget: the band sweeps past while the new hand deals itself in,
    // so the player's turn never waits on it.
    if (this.state.phase === 'player') {
      void turnBanner(this, GAME_WIDTH, GAME_HEIGHT, '我 方 回 合', C.goldBright);
    }

    this.busy = false;
    this.checkOutcome();
  }

  // -------------------------------------------------------------- animation

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.time.delayedCall(ms, resolve);
    });
  }

  private async playEvents(): Promise<void> {
    const events = this.state.events.splice(0);
    for (const ev of events) {
      if (this.finished && ev.t !== 'death') continue;
      await this.playEvent(ev);
    }
  }

  private async playEvent(ev: CombatEvent): Promise<void> {
    switch (ev.t) {
      case 'damage':
        await this.playDamage(ev);
        break;

      case 'block': {
        const view = this.viewOf(ev.targetId);
        if (view) {
          const at = this.torso(view);
          shieldFlare(this, at.x, at.y, view.height * 0.34);
          popText(this, at.x, at.y - 16, `+${ev.amount} 护甲`, { color: 0xdcefff, size: 25 });
          this.popBadge(view.blockBadge);
        }
        this.refreshBars();
        await this.wait(150);
        break;
      }

      case 'status': {
        const view = this.viewOf(ev.targetId);
        const meta = STATUS_META[ev.status];
        if (view) {
          const at = this.torso(view);
          shieldFlare(this, at.x, at.y, view.height * 0.3);
          popText(this, at.x, at.y - 30, `${meta.label} +${ev.amount}`, {
            color: meta.color,
            size: 26,
          });
        }
        this.refreshBars();
        await this.wait(160);
        break;
      }

      case 'statusBlocked': {
        const view = this.viewOf(ev.targetId);
        if (view) {
          const at = this.torso(view);
          shieldFlare(this, at.x, at.y, view.height * 0.3);
          popText(this, at.x, at.y - 30, `抵消【${STATUS_META[ev.status].label}】`, {
            color: STATUS_META.artifact.color,
            size: 24,
          });
        }
        this.refreshBars();
        await this.wait(160);
        break;
      }

      case 'exhaust':
        popText(this, EXHAUST_PILE.x, EXHAUST_PILE.y - 26, '消耗', {
          color: C.paperFaint,
          size: 19,
          drift: 34,
        });
        await this.wait(120);
        break;

      case 'death':
        await this.playDeath(ev.targetId);
        break;

      case 'enemyMove': {
        const view = this.enemyViews.get(ev.enemyId);
        if (view) {
          this.currentAttacker = view;
          // Wind-up: lean away from the player, and pop the intent badge out.
          this.tweens.add({
            targets: view.container,
            x: view.baseX + 30,
            duration: 170,
            ease: 'Quad.easeOut',
          });
          this.tweens.add({
            targets: view.intent,
            scale: 1.3,
            alpha: 0,
            duration: 240,
            ease: 'Quad.easeOut',
          });
          popText(this, view.baseX, BASELINE_Y - view.height - 46, ev.label, {
            color: C.goldBright,
            size: 27,
            drift: 40,
          });
        }
        await this.wait(280);
        break;
      }

      case 'relic':
        this.relicBar.flash(ev.relicId);
        await this.wait(120);
        break;

      case 'heal': {
        const view = this.viewOf(ev.targetId);
        if (view) {
          const at = this.torso(view);
          popText(this, at.x, at.y - 30, `+${ev.amount}`, { color: C.jade, size: 26 });
          // The trailing bar can't lag behind a gain, or the next hit drains
          // from a stale, lower value.
          view.ghost.value = this.hpOf(ev.targetId);
        }
        this.paintHpBars();
        await this.wait(150);
        break;
      }

      case 'passive': {
        const at = this.torso(this.playerView);
        // A bannered relic still owns an icon in the bar — light that too.
        const relic = relicByBanner(ev.label);
        if (relic) this.relicBar.flash(relic.id);
        screenPulse(this, GAME_WIDTH, GAME_HEIGHT, 0xc9a227, 0.16, 360);
        burst(this, at.x, at.y, { color: 0xf0d67a, count: 20, speed: 260, scale: 0.2 });
        popText(this, PLAYER_X, BASELINE_Y - this.playerView.height - 24, `【${ev.label}】`, {
          color: C.goldBright,
          size: 27,
          drift: 44,
        });
        await this.wait(200);
        break;
      }

      case 'shuffle': {
        popText(this, DRAW_PILE.x, DRAW_PILE.y - 26, '洗牌', {
          color: C.paperDim,
          size: 19,
          drift: 34,
        });
        await this.wait(140);
        break;
      }

      default:
        break;
    }
  }

  private async playDamage(ev: Extract<CombatEvent, { t: 'damage' }>): Promise<void> {
    const view = this.viewOf(ev.targetId);
    if (!view) return;

    const hitsPlayer = ev.targetId === 'player';

    // An enemy mid-move actually reaches across before each of its hits.
    if (hitsPlayer && this.currentAttacker) {
      await this.lunge(this.currentAttacker, -1, 52, 90);
    }

    const at = this.torso(view);

    // Fully absorbed: read as a parry, not a wound.
    if (ev.amount === 0 && ev.blocked > 0) {
      shieldFlare(this, at.x, at.y, view.height * 0.36);
      burst(this, at.x, at.y, { color: 0x9fc4e0, count: 10, speed: 190, scale: 0.12 });
      popText(this, at.x, at.y - 20, `挡下 ${ev.blocked}`, { color: 0xdcefff, size: 26 });
      this.cameras.main.shake(90, 0.002);
      this.paintHpBars();
      await this.wait(180);
      return;
    }

    const heavy = ev.amount >= 12;
    slash(this, at.x, at.y, {
      angle: hitsPlayer ? 208 : -32,
      length: heavy ? 260 : 205,
      thickness: heavy ? 38 : 28,
    });
    burst(this, at.x, at.y, {
      color: hitsPlayer ? 0xff9a7a : 0xffd8a8,
      count: heavy ? 24 : 15,
      speed: heavy ? 400 : 300,
    });
    hitStop(this, heavy ? 0.16 : 0.32, heavy ? 95 : 60);
    this.cameras.main.shake(heavy ? 200 : 110, heavy ? 0.007 : 0.0032);
    this.recoil(view, hitsPlayer ? 1 : -1);
    this.flashHit(view);

    popText(this, at.x, at.y - 52, `-${ev.amount}`, {
      color: C.cinnabarBright,
      size: heavy ? 46 : 34,
    });
    if (ev.blocked > 0) {
      popText(this, at.x + 54, at.y + 12, `挡 ${ev.blocked}`, { color: 0x9fc4e0, size: 20 });
    }
    if (hitsPlayer) {
      screenPulse(this, GAME_WIDTH, GAME_HEIGHT, 0x8b2020, heavy ? 0.26 : 0.13, 460);
    }

    this.drainGhost(view, this.hpOf(ev.targetId));
    this.paintHpBars();
    await this.wait(heavy ? 205 : 150);
  }

  private async playDeath(id: string): Promise<void> {
    const view = this.enemyViews.get(id);
    if (!view) return;

    view.hit.disableInteractive();
    this.tweens.killTweensOf(view.sprite);
    this.tweens.add({ targets: view.intent, alpha: 0, duration: 180 });

    inkSplash(this, view.container.x, BASELINE_Y);
    this.cameras.main.shake(200, 0.005);

    // Topple away from the player, then dissolve.
    this.tweens.add({
      targets: view.sprite,
      angle: 16,
      x: view.spriteBaseX + 34,
      duration: 520,
      ease: 'Quad.easeIn',
    });
    this.tweens.add({
      targets: view.container,
      alpha: 0,
      y: BASELINE_Y + 26,
      duration: 520,
      ease: 'Quad.easeIn',
    });
    this.tweens.add({
      targets: [view.bar, view.hpText, view.statusRow, view.blockBadge],
      alpha: 0,
      duration: 320,
    });
    const label = this.children.getByName(`name-${id}`);
    if (label) this.tweens.add({ targets: label, alpha: 0, duration: 320 });

    await this.wait(420);
  }

  private viewOf(id: string): ActorView | undefined {
    if (id === 'player') return this.playerView;
    return this.enemyViews.get(id);
  }

  private hpOf(id: string): number {
    if (id === 'player') return this.state.player.hp;
    return this.state.enemies.find((e) => e.id === id)?.hp ?? 0;
  }

  /** Let the trailing bar catch up a beat later, so the hit size is legible. */
  private drainGhost(view: ActorView, newHp: number): void {
    this.tweens.killTweensOf(view.ghost);
    this.tweens.add({
      targets: view.ghost,
      value: newHp,
      delay: 280,
      duration: 440,
      ease: 'Quad.easeIn',
      onUpdate: () => this.paintHpBars(),
    });
  }

  private popBadge(badge: Phaser.GameObjects.Container): void {
    pop(this, badge, 1.35, 110);
  }

  // ------------------------------------------------------------------ render

  private refresh(): void {
    if (this.state.energy < this.lastEnergy) {
      this.tweens.killTweensOf(this.energyOrb);
      this.energyOrb.setScale(1);
      this.tweens.add({
        targets: this.energyOrb,
        scale: 1.22,
        duration: 110,
        yoyo: true,
        ease: 'Back.easeOut',
      });
    }
    this.lastEnergy = this.state.energy;

    this.energyText.setText(`${this.state.energy}`);
    this.energyMaxText.setText(`/ ${this.state.maxEnergy}`);
    this.turnText.setText(`第 ${this.state.turn} 回合`);
    this.deckCount.setText(String(this.run.deck.length));
    this.setCount(this.drawPile, this.state.drawPile.length);
    this.setCount(this.discardPile, this.state.discardPile.length);
    this.setCount(this.exhaustPile, this.state.exhaustPile.length);
    // Nothing exhausts in most fights; the pile only earns its corner once used.
    this.exhaustPile.container.setVisible(this.state.exhaustPile.length > 0);
    this.endTurnBtn.setAlpha(this.state.phase === 'player' ? 1 : 0.45);

    for (const view of this.cardViews.values()) view.refresh(this.state);
    this.refreshBars();
  }

  /** Full repaint. Not safe to call per-frame — it rebuilds the status pills. */
  private refreshBars(): void {
    this.paintHpBars();

    this.paintBlock(this.playerView, this.state.player.block);
    this.paintStatuses(this.playerView, this.state.player.statuses);

    for (const view of this.enemyViews.values()) {
      if (!view.enemy.alive) continue;
      this.paintBlock(view, view.enemy.block);
      this.paintStatuses(view, view.enemy.statuses);
      this.paintIntent(view);
    }
  }

  /** Cheap repaint — safe to drive from a tween's onUpdate. */
  private paintHpBars(): void {
    this.paintBar(this.playerView, this.state.player.hp, this.state.player.maxHp, C.blood);
    for (const view of this.enemyViews.values()) {
      if (!view.enemy.alive) continue;
      this.paintBar(view, view.enemy.hp, view.enemy.maxHp, 0x7a2f2f);
    }
  }

  private paintBar(view: ActorView, hp: number, maxHp: number, fill: number): void {
    const width = view.barWidth;
    const h = 14;
    const x = -width / 2;
    const y = 14;
    const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    const ghostRatio = Phaser.Math.Clamp(view.ghost.value / maxHp, 0, 1);

    view.bar.clear();
    view.bar.fillStyle(C.inkDeep, 0.92);
    view.bar.fillRect(x, y, width, h);

    // Trailing "damage taken" segment, drawn behind the live fill.
    if (ghostRatio > ratio) {
      view.bar.fillStyle(0xe8846a, 0.85);
      view.bar.fillRect(x + width * ratio, y, width * (ghostRatio - ratio), h);
    }

    view.bar.fillStyle(fill, 1);
    view.bar.fillRect(x, y, width * ratio, h);
    view.bar.fillStyle(C.cinnabar, 0.7);
    view.bar.fillRect(x, y, width * ratio, h * 0.45);
    view.bar.lineStyle(1, C.gold, 0.5);
    view.bar.strokeRect(x - 1, y - 1, width + 2, h + 2);

    view.hpText.setText(`${hp} / ${maxHp}`);
    view.hpText.setY(y + h / 2);
  }

  private paintBlock(view: ActorView, block: number): void {
    view.blockBadge.setVisible(block > 0);
    view.blockText.setText(String(block));
  }

  /**
   * Icon chips, not text pills: eighteen statuses at 62px a piece would run off
   * both sides of the screen. Ordered by `STATUS_ORDER` so the row never
   * reshuffles itself as statuses come and go, and every chip carries its rules
   * text on hover — an icon nobody can read is worse than a word.
   */
  private paintStatuses(view: ActorView, statuses: Partial<Record<StatusId, number>>): void {
    view.statusRow.removeAll(true);
    this.hideStatusTip();

    const entries = STATUS_ORDER.filter((id) => (statuses[id] ?? 0) > 0);
    const chipW = 32;
    const chipH = 22;
    const gap = 3;
    const total = entries.length * (chipW + gap) - gap;

    entries.forEach((id, i) => {
      const meta = STATUS_META[id];
      const count = statuses[id] ?? 0;
      const x = -total / 2 + i * (chipW + gap) + chipW / 2;

      const chip = this.add.container(x, 0);
      const bg = this.add.graphics();
      bg.fillStyle(C.inkDeep, 0.94);
      bg.fillRoundedRect(-chipW / 2, -chipH / 2, chipW, chipH, 3);
      bg.lineStyle(1, meta.color, 0.85);
      bg.strokeRoundedRect(-chipW / 2, -chipH / 2, chipW, chipH, 3);

      const icon = this.add
        .image(-8, 0, meta.icon ?? '')
        .setDisplaySize(16, 16)
        .setTint(meta.color);
      const label = this.add
        .text(chipW / 2 - 4, 1, String(count), bodyStyle(12, C.paper))
        .setOrigin(1, 0.5);

      const hit = this.add.zone(0, 0, chipW, chipH).setInteractive();
      hit.on('pointerover', () =>
        this.showStatusTip(view.container.x + x, view.container.y + view.statusRow.y, id, count),
      );
      hit.on('pointerout', () => this.hideStatusTip());

      chip.add([bg, icon, label, hit]);
      view.statusRow.add(chip);
    });
  }

  /** Rules text for the hovered chip, floated above it. */
  private showStatusTip(x: number, y: number, id: StatusId, count: number): void {
    const meta = STATUS_META[id];
    if (!this.statusTip) {
      const bg = this.add.graphics();
      const text = this.add.text(0, 0, '', {
        ...bodyStyle(13, C.paper),
        wordWrap: { width: 240 },
        lineSpacing: 4,
      });
      this.statusTip = this.add
        .container(0, 0, [bg, text])
        .setDepth(DEPTH.float)
        .setVisible(false);
      this.statusTipBg = bg;
      this.statusTipText = text;
    }

    const text = this.statusTipText!;
    text.setText(`【${meta.label}】${count}\n${meta.desc}`);
    const w = text.width + 24;
    const h = text.height + 20;
    text.setPosition(-w / 2 + 12, -h + 10);
    paintInkPanel(this.statusTipBg!, -w / 2, -h, w, h, { border: meta.color });

    // Clamped so a chip at the screen edge doesn't push its tip off-canvas.
    this.statusTip!.setPosition(Phaser.Math.Clamp(x, w / 2 + 8, GAME_WIDTH - w / 2 - 8), y - 16);
    this.statusTip!.setVisible(true);
  }

  private hideStatusTip(): void {
    this.statusTip?.setVisible(false);
  }

  private paintIntent(view: EnemyView): void {
    const text = intentLabel(this.state, view.enemy);
    view.intentText.setText(text);

    const move = view.enemy.intent;
    const color =
      move?.damage ? C.cinnabarBright : move?.intent === 'buff' ? C.goldBright : C.jade;
    view.intentText.setColor('#' + color.toString(16).padStart(6, '0'));

    const w = view.intentText.width + 26;
    const h = 34;
    view.intentBg.clear();
    view.intentBg.fillStyle(C.inkDeep, 0.92);
    view.intentBg.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
    view.intentBg.lineStyle(1.5, color, 0.85);
    view.intentBg.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
    view.intent.setVisible(this.state.phase === 'player');

    // Announce a newly telegraphed move rather than silently swapping the text.
    if (text !== view.lastIntentLabel) {
      view.lastIntentLabel = text;
      this.tweens.killTweensOf(view.intent);
      view.intent.setScale(0.5).setAlpha(0);
      this.tweens.add({
        targets: view.intent,
        scale: 1,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut',
      });
    } else {
      view.intent.setAlpha(1).setScale(1);
    }
  }

  override update(): void {
    // Targeting line from the raised card to the pointer.
    this.arrow.clear();
    if (!this.selectedUid || this.finished) return;
    const view = this.cardViews.get(this.selectedUid);
    if (!view) return;

    const p = this.input.activePointer;
    const px = toDesign(p.x);
    const py = toDesign(p.y);
    const sx = view.x;
    const sy = view.y - 100;

    const steps = 22;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const cx = (sx + px) / 2;
      const cy = Math.min(sy, py) - 90;
      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * px;
      const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * py;
      this.arrow.fillStyle(C.goldBright, 0.35 + t * 0.6);
      this.arrow.fillCircle(x, y, 2 + t * 3.5);
    }
  }

  // -------------------------------------------------------------- resolution

  private checkOutcome(): void {
    if (this.finished) return;
    if (this.state.phase === 'won') {
      this.finished = true;
      this.time.delayedCall(420, () => this.showVictory());
    } else if (this.state.phase === 'lost') {
      this.finished = true;
      this.time.delayedCall(420, () => this.showDefeat());
    }
  }

  private showVictory(): void {
    applyCombatResult(this.run, this.state.player.hp);

    const rng = new Rng(`${this.run.map.seed}:${this.run.currentNodeId}:reward`);
    const gold = rng.range(this.encounter.goldReward[0], this.encounter.goldReward[1]);
    addGold(this.run, gold);

    const picks = rng.shuffle([...REWARD_POOL]).slice(0, 3);

    const layer = this.add.container(0, 0).setDepth(DEPTH.overlay);
    layer.add(
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.88),
    );
    layer.add(
      this.add.text(GAME_WIDTH / 2, 74, '战 罢', brushStyle(52, C.goldBright)).setOrigin(0.5).setLetterSpacing(10),
    );
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, 140, `获得资财 ${gold}　·　体力 ${this.run.hp} / ${this.run.maxHp}`, bodyStyle(17, C.paperDim))
        .setOrigin(0.5),
    );
    layer.add(
      this.add.text(GAME_WIDTH / 2, 184, '择一牌收入行囊', bodyStyle(15, C.paperFaint)).setOrigin(0.5),
    );

    const spacing = 210;
    picks.forEach((cardId, i) => {
      const x = GAME_WIDTH / 2 + (i - 1) * spacing;
      const card = new CardView(this, `reward-${i}`, cardId, 0, this.state, 'display');
      card.setPosition(x, 400);
      card.setDepth(DEPTH.overlay + 1);
      card.hitZone.on('pointerover', () =>
        this.tweens.add({ targets: card, scale: 1.1, y: 386, duration: 140, ease: 'Back.easeOut' }),
      );
      card.hitZone.on('pointerout', () =>
        this.tweens.add({ targets: card, scale: 1, y: 400, duration: 140 }),
      );
      card.hitZone.on('pointerup', () => {
        addCard(this.run, cardId);
        this.leaveToMap();
      });
      layer.add(card);
    });

    const skip = inkButton(this, GAME_WIDTH / 2, 596, '不取', {
      width: 170,
      height: 54,
      fontSize: 22,
      onClick: () => this.leaveToMap(),
    });
    skip.setDepth(DEPTH.overlay + 1);
    layer.add(skip);

    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 320 });
  }

  private showDefeat(): void {
    applyCombatResult(this.run, 0);

    const layer = this.add.container(0, 0).setDepth(DEPTH.overlay);
    layer.add(
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.93),
    );
    layer.add(
      this.add.text(GAME_WIDTH / 2, 240, '兵 败', brushStyle(64, C.cinnabar)).setOrigin(0.5).setLetterSpacing(14),
    );
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, 320, `止步于第 ${this.run.path.length} 层`, bodyStyle(18, C.paperDim))
        .setOrigin(0.5),
    );

    const again = inkButton(this, GAME_WIDTH / 2, 430, '再 战', {
      width: 200,
      height: 62,
      fontSize: 28,
      onClick: () => {
        this.cameras.main.fadeOut(300, 8, 6, 4);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
          this.scene.start('Title'),
        );
      },
    });
    again.setDepth(DEPTH.overlay + 1);
    layer.add(again);

    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 400 });
  }

  private leaveToMap(): void {
    this.cameras.main.fadeOut(300, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Map'),
    );
  }
}

