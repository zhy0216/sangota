import Phaser from 'phaser';
import { getAudio, type Audio } from '../audio/sfx';
import { C, GAME_HEIGHT, GAME_WIDTH, MAP, css } from '../config';
import { Rng } from '../core/rng';
import { actLabel, actOf } from '../data/acts';
import { ascensionLabel } from '../data/ascension';
import { ROOM_META } from '../map/roomMeta';
import type { MapNode } from '../map/types';
import { ensureEncounter } from '../rooms/fight';
import {
  availableNodes,
  currentFloor,
  getRun,
  removePotion,
  travelTo,
  usePotionOutOfCombat,
  type RunState,
} from '../state/run';
import { isCardGridOpen, openCardGrid } from '../ui/CardGrid';
import { PotionBelt } from '../ui/PotionBelt';
import { RelicBar } from '../ui/RelicBar';
import { openSettings } from '../ui/SettingsPanel';
import { pinToCamera, toDesign, useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, circleMask, goldRing, gradientStrip, inkButton, inkPanel } from '../ui/theme';
import { enterRoom } from './nav';

type NodeState = 'current' | 'available' | 'visited' | 'locked';

interface NodeView {
  node: MapNode;
  container: Phaser.GameObjects.Container;
  disc: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  /** State ornament: the available node's 光圈, the current node's 罗盘. */
  marker: Phaser.GameObjects.Graphics;
  /** Zone carries the hit area — Containers have no origin, so their own
   *  hit-area coordinates are unreliable. */
  hit: Phaser.GameObjects.Zone;
  radius: number;
  pulse?: Phaser.Tweens.Tween;
  markerTween?: Phaser.Tweens.Tween;
}

/** The `glow` sprite is 256px square; this is what fits it to a node. */
const glowScaleFor = (radius: number): number => (radius * 5.2) / 256;

/**
 * The paper each node state is printed on. These are the whole readability
 * budget of the map: the backdrop is a dark painting and every room icon is a
 * dark ink drawing, so this is the one value in the stack that can separate
 * them. Keep `locked` well clear of the silk behind it — it is what ~90% of
 * the map is wearing at any moment.
 */
const NODE_PAPER = {
  current: 0xf4ead2,
  available: C.paper,
  visited: 0x6f685a,
  locked: 0x9d9379,
} as const;

/**
 * How far each state's paper is pulled toward the room's own accent, so the
 * plate says what room it is and not only the ring around it. Weakest on
 * `visited`: a spent room should read as spent before it reads as a shop.
 */
const NODE_TINT = {
  current: 0.16,
  available: 0.24,
  visited: 0.1,
  locked: 0.28,
} as const;

/** Packed-RGB lerp, `t` measured from `a` toward `b`. */
const mixRgb = (a: number, b: number, t: number): number => {
  const chan = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) + ((((b >> shift) & 0xff) - ((a >> shift) & 0xff)) * t));
  return (chan(16) << 16) | (chan(8) << 8) | chan(0);
};

const DEPTH = {
  bg: 0,
  overlay: 1,
  edges: 5,
  edgesHi: 6,
  nodes: 10,
  hudFade: 90,
  hud: 100,
  tooltip: 300,
  drawer: 400,
} as const;

/**
 * The act's 首领, read once when the map is built.
 *
 * This **materialises the boss's record before the player has walked to it**,
 * which is a deliberate exception to the note in `commit.ts` that reading a
 * room does not create one — and it is the whole point of R5 rather than a
 * violation of it: the fight has to be decided now precisely so that the name
 * on the map and the fight at the top of it can never disagree. Announcing the
 * 首领 fifteen floors early is what lets a player build against it.
 *
 * No side effects to worry about: `ensureEncounter` only ticks
 * `actCombatCount` on the `monster` tier, and the boss branch spends its one
 * `encounter` draw and nothing else.
 */
const bossName = (run: RunState): string => ensureEncounter(run, run.map.bossId, 'boss').name;

export class MapScene extends Phaser.Scene {
  /**
   * Public, and read-only by convention: `nav.ts` needs the run and the two HUD
   * widgets to re-sync a room's purchases when the map wakes back up.
   */
  run!: RunState;
  relicBar!: RelicBar;
  potionBelt!: PotionBelt;

  private views = new Map<string, NodeView>();
  private edgeGfx!: Phaser.GameObjects.Graphics;
  private edgeHiGfx!: Phaser.GameObjects.Graphics;

  private hpFill!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private deckText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  private tooltip!: Phaser.GameObjects.Container;
  private tooltipTitle!: Phaser.GameObjects.Text;
  private tooltipDesc!: Phaser.GameObjects.Text;
  private tooltipPanel!: Phaser.GameObjects.Graphics;

  private drawer!: Phaser.GameObjects.Container;
  private drawerOpen = false;

  private dragDistance = 0;
  private dragging = false;
  /** Set the instant a node is committed to; cleared when the map wakes. */
  private leaving = false;

  /** 音效出口 (todos/20 b6)。全局单例，`create` 里经 `getAudio` 取。 */
  private audio!: Audio;

  constructor() {
    super('Map');
  }

  create(): void {
    this.run = getRun();
    this.views.clear();
    this.leaving = false;

    // 场景音乐 (todos/20 b6)：地图曲从进图起懒加载并喊播。从战斗回来是
    // `scene.start('Map')` 重走 create——`Audio.music` 同曲跳过、异曲 400ms
    // 交叉淡入；从房间（睡醒）回来不经这儿，地图曲本来也没停，正好。
    this.audio = getAudio(this);
    this.audio.ensureMusic('map', this);
    this.audio.music('map');

    const { map } = this.run;
    // No setBounds here: its clamping assumes a camera origin of 0.5, and
    // design space needs origin 0. Scroll is clamped by hand instead.
    const cam = useDesignSpace(this);
    // Coming back from a room, resume where the player is standing.
    const resumeNode = this.run.currentNodeId ? map.nodes.get(this.run.currentNodeId) : undefined;
    cam.scrollY = resumeNode
      ? Phaser.Math.Clamp(resumeNode.y - GAME_HEIGHT * 0.66, 0, map.height - GAME_HEIGHT)
      : map.height - GAME_HEIGHT;
    cam.fadeIn(420, 8, 6, 4);

    this.buildBackground();

    this.edgeGfx = this.add.graphics().setDepth(DEPTH.edges);
    this.edgeHiGfx = this.add.graphics().setDepth(DEPTH.edgesHi);
    this.tweens.add({
      targets: this.edgeHiGfx,
      alpha: { from: 0.45, to: 1 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    for (const node of map.nodes.values()) this.createNodeView(node);

    this.buildHud();
    this.buildTooltip();
    this.buildDrawer();
    this.bindCameraControls();

    // `off` first: `Systems.shutdown` clears the four TRANSITION_* events and
    // nothing else, so the handler registered by the previous `create` is still
    // attached. Returning from a fight restarts this scene, and without this
    // every fight added one more `resume()` — nine full `refreshAll()` passes
    // over ~120 nodes and ~200 edges on the ninth trip back from a room.
    this.events.off(Phaser.Scenes.Events.WAKE);
    this.events.on(Phaser.Scenes.Events.WAKE, () => this.resume());

    this.refreshAll();
  }

  /**
   * Coming back from a room. The scene was asleep, not stopped, so nothing has
   * to be rebuilt — but the run it was drawing has moved on underneath it, and
   * both HUD widgets are only otherwise filled in `buildHud`. Forgetting either
   * one is the "bought a relic in the shop and it isn't on the map" bug.
   */
  private resume(): void {
    this.leaving = false;
    this.input.enabled = true;
    this.run = getRun();
    this.relicBar.setRelics(this.run.relics);
    this.potionBelt.setPotions(this.run.potions);
    this.refreshAll();
    this.hideTooltip();
    this.toggleDrawer(false);
    this.cameras.main.fadeIn(260, 8, 6, 4);
  }

  // --------------------------------------------------------------- backdrop

  private buildBackground(): void {
    const { map } = this.run;
    const bg = this.add.image(0, 0, 'map-bg').setOrigin(0, 0).setDepth(DEPTH.bg);
    const scale = Math.max(map.width / bg.width, map.height / bg.height);
    bg.setScale(scale);
    bg.setPosition((map.width - bg.displayWidth) / 2, (map.height - bg.displayHeight) / 2);

    // The painting is a dark 绢本 to begin with; a heavy scrim on top used to
    // take it to mud and drag the nodes down with it. Keep it light — the
    // nodes now carry their own paper plate and no longer need the backdrop
    // held down to be the brightest thing on screen.
    this.add
      .rectangle(0, 0, map.width, map.height, C.inkDeep, 0.28)
      .setOrigin(0, 0)
      .setDepth(DEPTH.overlay);

    // Side vignettes, to keep the eye in the middle lane where the nodes live.
    const edge = 170;
    const vignette = this.add.graphics().setDepth(DEPTH.overlay);
    vignette.fillGradientStyle(C.inkDeep, C.inkDeep, C.inkDeep, C.inkDeep, 0.9, 0, 0.9, 0);
    vignette.fillRect(0, 0, edge, map.height);
    vignette.fillGradientStyle(C.inkDeep, C.inkDeep, C.inkDeep, C.inkDeep, 0, 0.9, 0, 0.9);
    vignette.fillRect(map.width - edge, 0, edge, map.height);
  }

  // ------------------------------------------------------------------ nodes

  private createNodeView(node: MapNode): void {
    const meta = ROOM_META[node.type];
    const isBoss = node.type === 'boss';
    const radius = isBoss ? MAP.nodeRadius * 1.5 : MAP.nodeRadius;

    const container = this.add.container(node.x, node.y).setDepth(DEPTH.nodes);

    const glow = this.add
      .image(0, 0, 'glow')
      .setScale(glowScaleFor(radius))
      .setTint(meta.accent)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);

    const disc = this.add.graphics();
    this.paintNodePlate(
      disc,
      radius,
      node.id,
      mixRgb(NODE_PAPER.locked, meta.accent, NODE_TINT.locked),
      0.72,
    );

    const icon = this.add.image(0, 0, meta.icon);
    const fit = radius * (isBoss ? 1.95 : 1.72);
    icon.setScale(fit / Math.max(icon.width, icon.height));

    const ring = this.add.graphics();
    const marker = this.add.graphics();

    // Hit target: a Zone sized to 2×hitR so its default origin (0.5) puts the
    // circle's centre exactly on the node.
    const hitR = radius * 1.2;
    const hit = this.add.zone(0, 0, hitR * 2, hitR * 2);
    hit.setInteractive(new Phaser.Geom.Circle(hitR, hitR, hitR), Phaser.Geom.Circle.Contains);

    container.add([glow, disc, icon, ring, marker, hit]);
    container.setSize(radius * 2, radius * 2);

    const view: NodeView = { node, container, disc, ring, icon, glow, marker, hit, radius };
    this.views.set(node.id, view);

    hit.on('pointerover', () => this.onNodeOver(view));
    hit.on('pointerout', () => this.onNodeOut(view));
    hit.on('pointerup', () => {
      if (this.dragDistance > 8) return;
      this.onNodeClick(view);
    });
  }

  /**
   * Hand-inked blob: a circle whose radius wobbles per vertex, seeded off the
   * node id so the shape is stable between redraws. Re-seeded per call, so two
   * radii from the same id come out concentric rather than independently wobbly.
   */
  private blobPoints(radius: number, seed: string): Phaser.Math.Vector2[] {
    const rng = new Rng(`blob:${seed}`);
    const steps = 28;
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = radius * (0.94 + rng.next() * 0.13);
      points.push(new Phaser.Math.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
    }
    return points;
  }

  /**
   * A node's plate: a wash of ink with a torn square of paper pressed into it.
   *
   * The paper is the whole point. Every room icon is a **dark** ink drawing,
   * and they used to sit on a near-black disc over a near-black painting —
   * three values within a hair of each other, so the only thing separating a
   * node from the silk behind it was its ring. Ink on paper is the reading the
   * art was drawn for, and it survives whatever the backdrop is doing.
   */
  private paintNodePlate(
    g: Phaser.GameObjects.Graphics,
    radius: number,
    seed: string,
    paper: number,
    alpha: number,
  ): void {
    g.clear();
    // 墨晕 first, a shade wider than the paper: a dark rim is what lifts a light
    // plate off a light patch of the painting (mist, river) — without it the
    // node dissolves wherever the silk happens to be pale.
    g.fillStyle(C.inkDeep, Math.min(0.92, alpha + 0.1));
    g.fillPoints(this.blobPoints(radius * 1.12, seed), true);
    g.fillStyle(paper, alpha);
    g.fillPoints(this.blobPoints(radius, seed), true);
  }

  private nodeState(view: NodeView): NodeState {
    const { run } = this;
    if (run.currentNodeId === view.node.id) return 'current';
    if (availableNodes(run).includes(view.node.id)) return 'available';
    if (view.node.visited) return 'visited';
    return 'locked';
  }

  private refreshAll(): void {
    for (const view of this.views.values()) this.refreshNode(view);
    this.drawEdges();
    this.refreshHud();
  }

  private refreshNode(view: NodeView): void {
    const meta = ROOM_META[view.node.type];
    const state = this.nodeState(view);
    const r = view.radius;

    view.pulse?.stop();
    view.pulse = undefined;
    view.markerTween?.stop();
    view.markerTween = undefined;

    const ring = view.ring;
    ring.clear();
    view.marker.clear().setAngle(0).setScale(1).setAlpha(1);
    // The available pulse leaves the halo mid-swell; a node that stops being
    // available would otherwise keep whatever size the tween died at.
    view.glow.setScale(glowScaleFor(r));

    const paper = mixRgb(NODE_PAPER[state], meta.accent, NODE_TINT[state]);

    switch (state) {
      case 'available': {
        view.container.setAlpha(1);
        view.icon.clearTint().setAlpha(1);
        this.paintNodePlate(view.disc, r, view.node.id, paper, 0.95);
        ring.lineStyle(4.5, meta.accent, 0.95);
        ring.strokeCircle(0, 0, r + 4);

        // 光圈: the ring that grows and shrinks, and the thing actually doing
        // the beckoning. The soft halo below can't do it on its own — the
        // `glow` sprite is a radial gradient whose bright core lands *under*
        // the opaque plate, leaving only its faintest outer falloff visible.
        view.marker.lineStyle(2.5, mixRgb(meta.accent, 0xffffff, 0.35), 0.9);
        view.marker.strokeCircle(0, 0, r + 13);
        view.markerTween = this.tweens.add({
          targets: view.marker,
          scale: { from: 0.93, to: 1.2 },
          alpha: { from: 0.95, to: 0.28 },
          duration: 1100,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });

        // Halo underneath, breathing in step: atmosphere, not the signal.
        // Tinted with the accent pulled toward white because this is an ADD
        // blend and half the accents are dark — 奇遇's 玉 is 0x4a7c6f, which
        // adds almost no light at all as-is.
        const base = glowScaleFor(r);
        view.glow.setTint(mixRgb(meta.accent, 0xffffff, 0.45));
        view.pulse = this.tweens.add({
          targets: view.glow,
          alpha: { from: 0.14, to: 0.55 },
          scale: { from: base * 0.82, to: base * 1.18 },
          duration: 1100,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        break;
      }
      case 'current': {
        view.container.setAlpha(1);
        view.icon.clearTint().setAlpha(1);
        this.paintNodePlate(view.disc, r, view.node.id, paper, 0.98);
        // Double rim, and the only node that holds still: available nodes
        // pulse, so 「我在这儿」 and 「可以去这儿」 read apart by motion before
        // colour or size have to do any work.
        ring.lineStyle(5, C.cinnabar, 1);
        ring.strokeCircle(0, 0, r + 4);
        ring.lineStyle(2.5, C.goldBright, 0.9);
        ring.strokeCircle(0, 0, r + 12);
        view.glow.setTint(C.goldBright).setAlpha(0.4);
        break;
      }
      case 'visited': {
        // Spent, so the paper goes grey and the ink with it: a visited room
        // has to be *recognisable*, not readable — the cinnabar ring and the
        // travelled trail are what name it now.
        view.container.setAlpha(1);
        view.icon.setTint(0x5a5346).setAlpha(0.85);
        this.paintNodePlate(view.disc, r, view.node.id, paper, 0.8);
        ring.lineStyle(3, C.cinnabar, 0.55);
        ring.strokeCircle(0, 0, r + 4);
        view.glow.setAlpha(0);
        break;
      }
      case 'locked': {
        // The resting state of nearly the whole map. Dim enough to sit behind
        // the lit route, bright enough to plan three floors ahead against.
        view.container.setAlpha(1);
        view.icon.clearTint().setAlpha(0.92);
        this.paintNodePlate(view.disc, r, view.node.id, paper, 0.72);
        // Accent, not a neutral hairline: at this weight the ring colour is
        // legible three floors ahead, which is half of what route planning is.
        ring.lineStyle(3, meta.accent, 0.5);
        ring.strokeCircle(0, 0, r + 4);
        view.glow.setAlpha(0);
        break;
      }
    }

    view.container.setScale(state === 'current' ? 1.16 : 1);
    if (view.hit.input) {
      view.hit.input.cursor = state === 'available' ? 'pointer' : 'default';
    }
  }

  private onNodeOver(view: NodeView): void {
    const state = this.nodeState(view);
    this.showTooltip(view.node, state);
    if (state !== 'available') return;
    this.tweens.add({ targets: view.container, scale: 1.16, duration: 140, ease: 'Back.easeOut' });
  }

  private onNodeOut(view: NodeView): void {
    this.hideTooltip();
    if (this.nodeState(view) !== 'available') return;
    this.tweens.add({ targets: view.container, scale: 1, duration: 140, ease: 'Quad.easeOut' });
  }

  /**
   * The gate matters. A combat node fades for ~780 ms before the fight starts,
   * and `refreshAll` has already lit that node's children by then — a second
   * click inside the fade used to run `travelTo` again, walking the player past
   * a whole room and opening the fight with the *next* node's seed.
   */
  private onNodeClick(view: NodeView): void {
    if (this.leaving) return;
    if (this.nodeState(view) !== 'available') return;

    this.leaving = true;
    this.input.enabled = false;
    // 节点落子音 (todos/20 b6)：在 leaving 闸之后——过不了闸的点击不发声。
    this.audio.play('map-select');
    // The one and only `markVisited`: room code never touches `visited`.
    travelTo(this.run, view.node.id);
    this.hideTooltip();
    this.refreshAll();
    this.panTo(view.node);
    enterRoom(this, view.node);
  }

  // ------------------------------------------------------------------ edges

  private drawEdges(): void {
    const { map } = this.run;
    const travelled = new Set<string>();
    for (let i = 0; i < this.run.path.length - 1; i++) {
      travelled.add(`${this.run.path[i]}->${this.run.path[i + 1]}`);
    }

    this.edgeGfx.clear();
    this.edgeHiGfx.clear();

    for (const node of map.nodes.values()) {
      for (const childId of node.children) {
        const child = map.nodes.get(childId);
        if (!child) continue;

        const isOpen = this.run.currentNodeId === node.id;
        const isTravelled = travelled.has(`${node.id}->${childId}`);

        if (isOpen) {
          this.drawInkEdge(this.edgeHiGfx, node, child, C.goldBright, 0.95, 3.1);
        } else if (isTravelled) {
          this.drawInkEdge(this.edgeGfx, node, child, C.cinnabarBright, 0.85, 2.9);
        } else {
          this.drawInkEdge(this.edgeGfx, node, child, C.paperDim, 0.26, 2.1);
        }
      }
    }
  }

  /** StS-style dotted trail, bowed slightly and jittered so it reads as ink. */
  private drawInkEdge(
    g: Phaser.GameObjects.Graphics,
    from: MapNode,
    to: MapNode,
    color: number,
    alpha: number,
    dotRadius: number,
  ): void {
    const rng = new Rng(`edge:${from.id}->${to.id}`);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;

    const nx = -dy / len;
    const ny = dx / len;
    const bow = rng.jitter(13);

    const padFrom = MAP.nodeRadius + 13;
    const padTo = (to.type === 'boss' ? MAP.nodeRadius * 1.5 : MAP.nodeRadius) + 13;
    const t0 = padFrom / len;
    const t1 = 1 - padTo / len;
    if (t1 <= t0) return;

    const count = Math.max(3, Math.round(((t1 - t0) * len) / 16));
    for (let i = 0; i < count; i++) {
      const t = t0 + ((t1 - t0) * i) / (count - 1);
      const bend = Math.sin((i / (count - 1)) * Math.PI) * bow;
      const x = from.x + dx * t + nx * bend + rng.jitter(1.1);
      const y = from.y + dy * t + ny * bend + rng.jitter(1.1);
      g.fillStyle(color, alpha * (0.72 + rng.next() * 0.28));
      g.fillCircle(x, y, dotRadius * (0.82 + rng.next() * 0.36));
    }
  }

  // -------------------------------------------------------------------- HUD

  private buildHud(): void {
    const hero = this.run.hero;
    const fixed = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      // 递归钉住：⚙ 这样的 inkButton 是容器，命中区在孙辈,见 pinToCamera 文档。
      pinToCamera(obj);
      (obj as unknown as { setDepth: (v: number) => void }).setDepth(DEPTH.hud);
      return obj;
    };

    // Fades so map content never collides with the bars.
    fixed(gradientStrip(this, 0, 0, GAME_WIDTH, 128, C.inkDeep, 0.95, 0)).setDepth(DEPTH.hudFade);
    fixed(gradientStrip(this, 0, GAME_HEIGHT - 96, GAME_WIDTH, 96, C.inkDeep, 0, 0.95)).setDepth(
      DEPTH.hudFade,
    );

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.35);
    rule.lineBetween(0, 100, GAME_WIDTH, 100);
    rule.fillStyle(C.cinnabar, 0.8);
    rule.fillCircle(GAME_WIDTH / 2, 100, 3);
    fixed(rule);

    // --- Portrait (click to open the hero drawer) -------------------------
    const px = 62;
    const py = 52;
    const pr = 33;

    const portraitBack = this.add.graphics();
    portraitBack.fillStyle(C.ink, 1);
    portraitBack.fillCircle(px, py, pr);
    fixed(portraitBack);

    const portrait = this.add.image(px, py, hero.portraitKey);
    portrait.setScale((pr * 2.25) / Math.max(portrait.width, portrait.height));
    portrait.setY(py + 4);
    fixed(portrait);
    circleMask(this, portrait, px, py, pr);

    fixed(goldRing(this, px, py, pr));

    const portraitHit = this.add
      .circle(px, py, pr + 6, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    fixed(portraitHit);
    portraitHit.on('pointerup', () => this.toggleDrawer());

    fixed(this.add.text(110, 26, hero.name, brushStyle(28, C.paper)).setLetterSpacing(3));
    fixed(this.add.text(112, 62, hero.title, bodyStyle(14, C.paperDim)).setLetterSpacing(2));

    // --- Vitals ----------------------------------------------------------
    const barX = 268;
    const barY = 44;
    const barW = 208;
    const barH = 18;

    fixed(this.add.text(barX, 22, '体力', bodyStyle(13, C.paperFaint)).setLetterSpacing(3));

    const track = this.add.graphics();
    track.fillStyle(C.ink, 0.95);
    track.fillRect(barX, barY, barW, barH);
    fixed(track);

    this.hpFill = this.add.graphics();
    fixed(this.hpFill);

    const barEdge = this.add.graphics();
    barEdge.lineStyle(1, C.gold, 0.5);
    barEdge.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
    fixed(barEdge);

    this.hpText = this.add
      .text(barX + barW / 2, barY + barH / 2 + 1, '', bodyStyle(13, C.paper))
      .setOrigin(0.5);
    fixed(this.hpText);
    this.hpText.setData('geom', { x: barX, y: barY, w: barW, h: barH });

    fixed(this.add.text(514, 22, '资财', bodyStyle(13, C.paperFaint)).setLetterSpacing(3));
    this.goldText = this.add.text(514, 42, '', brushStyle(24, C.gold));
    fixed(this.goldText);

    // --- Deck (click to leaf through it) ---------------------------------
    fixed(this.add.text(626, 22, '牌组', bodyStyle(13, C.paperFaint)).setLetterSpacing(3));
    this.deckText = this.add.text(626, 42, '', brushStyle(24, C.paperDim));
    fixed(this.deckText);

    const deckFrame = this.add.graphics();
    const paintDeck = (hover: boolean): void => {
      deckFrame.clear();
      deckFrame.lineStyle(1, hover ? C.goldBright : C.gold, hover ? 0.9 : 0.3);
      deckFrame.strokeRoundedRect(614, 14, 104, 62, 3);
    };
    paintDeck(false);
    fixed(deckFrame);

    const deckHit = this.add
      .zone(614, 14, 104, 62)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    fixed(deckHit);
    deckHit.on('pointerover', () => {
      paintDeck(true);
      this.deckText.setColor(css(C.goldBright));
    });
    deckHit.on('pointerout', () => {
      paintDeck(false);
      this.deckText.setColor(css(C.paperDim));
    });
    deckHit.on('pointerup', () => {
      if (this.dragDistance > 8) return;
      this.openDeck();
    });

    // --- Relics -----------------------------------------------------------
    // Between the deck box and the act title, both of which are fixed width.
    this.relicBar = new RelicBar(this, {
      x: 744,
      y: 26,
      depth: DEPTH.hud,
      fixed: true,
      tooltipDepth: DEPTH.tooltip,
    });
    this.relicBar.setRelics(this.run.relics);

    // --- Potions ----------------------------------------------------------
    // Bottom-left, inside the footer fade: the top bar is already three blocks
    // wide plus a relic bar that wraps into a second row, and the belt must not
    // be what gets pushed out when the run gets long.
    fixed(
      this.add.text(44, 606, '丹药', bodyStyle(13, C.paperFaint)).setOrigin(0, 0.5).setLetterSpacing(3),
    );
    this.potionBelt = new PotionBelt(this, {
      x: 58,
      y: 640,
      size: 30,
      depth: DEPTH.hud,
      fixed: true,
      tooltipDepth: DEPTH.tooltip,
      // 火油罐 has nothing to burn out here; only the map-usable ones light up.
      usable: (def) => def.usableOutOfCombat,
      // No toast for either: the HP bar moving and the slot emptying are the
      // feedback, and a floating label here would scroll away with the map.
      onUse: (slot) => {
        if (!usePotionOutOfCombat(this.run, slot)) return;
        this.potionBelt.setPotions(this.run.potions);
        this.refreshHud();
      },
      onDiscard: (slot) => {
        removePotion(this.run, slot);
        this.potionBelt.setPotions(this.run.potions);
      },
    });
    this.potionBelt.setPotions(this.run.potions);

    // --- Act / floor ------------------------------------------------------
    const act = actOf(this.run);
    fixed(
      this.add
        .text(GAME_WIDTH - 24, 20, actLabel(act), brushStyle(22, C.paper))
        .setOrigin(1, 0)
        .setLetterSpacing(2),
    );

    // 天命 (todos/19 a5)：右上角一行小字，压在幕名上方；零重不印。
    if (this.run.ascension > 0) {
      fixed(
        this.add
          .text(GAME_WIDTH - 24, 4, ascensionLabel(this.run.ascension), bodyStyle(12, C.gold))
          .setOrigin(1, 0)
          .setLetterSpacing(2),
      );
    }
    this.floorText = this.add.text(GAME_WIDTH - 24, 52, '', bodyStyle(15, C.gold)).setOrigin(1, 0);
    fixed(this.floorText);

    // The act's 首领, named fifteen floors ahead of time so the deck can be
    // built against it. Cheap: the record is frozen on first read.
    fixed(
      this.add
        .text(GAME_WIDTH - 24, 74, `本幕首领 · ${bossName(this.run)}`, bodyStyle(13, C.cinnabarBright))
        .setOrigin(1, 0)
        .setLetterSpacing(2),
    );

    // 设置入口 (todos/21 t6)：右上角齿轮小按钮，挂在幕况栏下缘；
    // ui-click 音随 `inkButton` 工厂自带，Esc 空档时是同一扇门。
    fixed(
      inkButton(this, GAME_WIDTH - 46, 130, '⚙', {
        width: 44,
        height: 40,
        fontSize: 22,
        onClick: () => openSettings(this),
      }),
    );

    // --- Footer -----------------------------------------------------------
    this.hintText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 44, '', bodyStyle(16, C.paperDim))
      .setOrigin(0.5)
      .setLetterSpacing(2);
    fixed(this.hintText);

    fixed(
      this.add.text(
        GAME_WIDTH / 2,
        GAME_HEIGHT - 20,
        '滚轮 / 拖拽 查看地图   ·   空格 回到当前位置   ·   点击头像 查看武将   ·   点击牌组 查看卡牌',
        bodyStyle(12, 0x6b6355),
      ).setOrigin(0.5),
    );

    fixed(this.add.text(16, GAME_HEIGHT - 22, `种子 ${this.run.map.seed}`, bodyStyle(11, 0x554d40)));

    // 自定义局常驻章 (todos/23 u5)：压在种子行上方，金字——不计分要一直看得见。
    if (this.run.custom) {
      fixed(
        this.add
          .text(16, GAME_HEIGHT - 42, '自定义 · 不计分', bodyStyle(12, C.gold))
          .setLetterSpacing(2),
      );
    }
  }

  /** Public: `nav.ts` repaints the bars after a room hook pays out. */
  refreshHud(): void {
    const { run } = this;
    const geom = this.hpText.getData('geom') as { x: number; y: number; w: number; h: number };
    const ratio = Phaser.Math.Clamp(run.hp / run.maxHp, 0, 1);

    this.hpFill.clear();
    this.hpFill.fillStyle(C.blood, 1);
    this.hpFill.fillRect(geom.x, geom.y, geom.w * ratio, geom.h);
    this.hpFill.fillStyle(C.cinnabar, 0.85);
    this.hpFill.fillRect(geom.x, geom.y, geom.w * ratio, geom.h * 0.5);

    this.hpText.setText(`${run.hp} / ${run.maxHp}`);
    this.goldText.setText(String(run.gold));
    this.deckText.setText(String(run.deck.length));

    const floor = currentFloor(run);
    // The act's own height, not a global: 终章 is three rooms tall.
    const rows = run.map.rows;
    this.floorText.setText(floor === 0 ? `尚未启程 · 共 ${rows} 层` : `第 ${floor} / ${rows} 层`);

    this.hintText.setText(
      run.currentNodeId === null ? '选择一处起点，踏上征途' : '选择前进的路线',
    );
  }

  /** No `CombatState` out here, so the faces read at their printed values. */
  private openDeck(): void {
    openCardGrid(this, {
      title: '牌 组',
      subtitle: `共 ${this.run.deck.length} 张`,
      entries: this.run.deck.map((card) => ({ ...card })),
      mode: 'view',
    });
  }

  // ---------------------------------------------------------------- tooltip

  private buildTooltip(): void {
    this.tooltip = this.add.container(0, 0).setDepth(DEPTH.tooltip).setScrollFactor(0);
    this.tooltipPanel = this.add.graphics();
    this.tooltipTitle = this.add.text(14, 10, '', brushStyle(20, C.paper)).setLetterSpacing(2);
    this.tooltipDesc = this.add.text(14, 38, '', bodyStyle(13, C.paperDim));
    this.tooltip.add([this.tooltipPanel, this.tooltipTitle, this.tooltipDesc]);
    this.tooltip.setVisible(false);
  }

  private showTooltip(node: MapNode, state: NodeState): void {
    const meta = ROOM_META[node.type];
    const isBoss = node.type === 'boss';
    this.tooltipTitle.setText(isBoss ? bossName(this.run) : meta.label).setColor(
      '#' + (state === 'locked' ? C.paperFaint : meta.accent).toString(16).padStart(6, '0'),
    );
    this.tooltipDesc.setText(
      state === 'locked'
        ? isBoss
          ? '本幕之主，候于道尽处。'
          : '此路不通。'
        : state === 'visited'
          ? '已经走过了。'
          : meta.desc,
    );

    const w = Math.max(this.tooltipTitle.width, this.tooltipDesc.width) + 28;
    const h = 66;
    this.tooltipPanel.clear();
    this.tooltipPanel.fillStyle(C.inkDeep, 0.94);
    this.tooltipPanel.fillRoundedRect(0, 0, w, h, 4);
    this.tooltipPanel.lineStyle(1, meta.accent, 0.6);
    this.tooltipPanel.strokeRoundedRect(0, 0, w, h, 4);
    this.tooltip.setData('size', { w, h });
    this.tooltip.setVisible(true);
  }

  private hideTooltip(): void {
    this.tooltip.setVisible(false);
  }

  // ----------------------------------------------------------------- drawer

  private buildDrawer(): void {
    const hero = this.run.hero;
    const w = 430;
    this.drawer = this.add.container(-w, 0).setDepth(DEPTH.drawer).setScrollFactor(0);

    // Fully opaque: the HUD sits at a lower depth and would otherwise ghost through.
    this.drawer.add(inkPanel(this, 0, 0, w, GAME_HEIGHT, { alpha: 1, radius: 0 }));

    const accent = this.add.graphics();
    accent.fillStyle(C.cinnabar, 0.9);
    accent.fillRect(w - 3, 0, 3, GAME_HEIGHT);
    this.drawer.add(accent);

    this.drawer.add(this.add.text(32, 34, hero.name, brushStyle(48, C.paper)).setLetterSpacing(6));
    this.drawer.add(this.add.text(34, 96, hero.title, bodyStyle(17, C.gold)).setLetterSpacing(3));
    this.drawer.add(this.add.text(34, 126, `${hero.faction}　·　体力 ${hero.maxHp}`, bodyStyle(15, C.paperDim)));

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.4);
    rule.lineBetween(32, 160, w - 32, 160);
    this.drawer.add(rule);

    this.drawer.add(this.add.text(32, 178, `【${hero.passive.name}】`, bodyStyle(18, C.goldBright)));
    this.drawer.add(
      this.add.text(32, 206, hero.passive.desc, {
        ...bodyStyle(14, C.paperDim),
        wordWrap: { width: w - 64 },
        lineSpacing: 6,
      }),
    );
    this.drawer.add(
      this.add.text(32, 268, hero.blurb, { ...bodyStyle(13, C.paperFaint), lineSpacing: 6 }),
    );

    const halo = this.add
      .image(w / 2, 560, 'glow')
      .setScale(2.6)
      .setTint(0xc98a3a)
      .setAlpha(0.16)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.drawer.add(halo);

    const full = this.add.image(w / 2, GAME_HEIGHT - 6, hero.fullKey).setOrigin(0.5, 1);
    full.setScale(392 / full.height);
    this.drawer.add(full);

    const close = this.add.text(w - 40, 34, '×', brushStyle(34, C.paperDim)).setOrigin(0.5);
    close.setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.toggleDrawer(false));
    this.drawer.add(close);
    pinToCamera(this.drawer);
  }

  private toggleDrawer(force?: boolean): void {
    const open = force ?? !this.drawerOpen;
    if (open === this.drawerOpen) return;
    this.drawerOpen = open;
    this.tweens.add({
      targets: this.drawer,
      x: open ? 0 : -430,
      duration: 320,
      ease: open ? 'Cubic.easeOut' : 'Cubic.easeIn',
    });
  }

  // --------------------------------------------------------------- controls

  private bindCameraControls(): void {
    const cam = this.cameras.main;
    const maxScroll = Math.max(0, this.run.map.height - GAME_HEIGHT);

    // Every one of these stands down while a card grid is up: it freezes the
    // display list, but scene-level pointer, wheel and key events fire anyway.
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (isCardGridOpen(this)) return;
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY + dy * 0.7, 0, maxScroll);
      this.hideTooltip();
    });

    this.input.on('pointerdown', () => {
      if (isCardGridOpen(this)) return;
      this.dragging = true;
      this.dragDistance = 0;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging || !pointer.isDown || isCardGridOpen(this)) return;
      // Pointer deltas are canvas pixels; scrollY is design units.
      const dy = toDesign(pointer.y - pointer.prevPosition.y);
      if (Math.abs(dy) < 0.01) return;
      this.dragDistance += Math.abs(dy);
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY - dy, 0, maxScroll);
      if (this.dragDistance > 8) this.hideTooltip();
    });

    this.input.on('pointerup', () => {
      this.dragging = false;
      // Reset a frame later so node handlers still see the drag distance.
      this.time.delayedCall(0, () => {
        this.dragDistance = 0;
      });
    });

    this.input.keyboard?.on('keydown-SPACE', () => {
      if (!isCardGridOpen(this)) this.recenter();
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      // Esc 分层 (todos/21 t6)：最上层 overlay 先关——牌堆/设置开着时
      // 覆盖层栈自己收顶层，这里整个让位；抽屉次之；都空了才开设置。
      if (isCardGridOpen(this)) return;
      if (this.drawerOpen) {
        this.toggleDrawer(false);
        return;
      }
      openSettings(this);
    });
  }

  private recenter(): void {
    const id = this.run.currentNodeId ?? this.run.map.byRow[0][0];
    const node = this.run.map.nodes.get(id);
    if (node) this.panTo(node);
  }

  private panTo(node: MapNode): void {
    const cam = this.cameras.main;
    const maxScroll = Math.max(0, this.run.map.height - GAME_HEIGHT);
    const target = Phaser.Math.Clamp(node.y - GAME_HEIGHT * 0.66, 0, maxScroll);
    this.tweens.add({ targets: cam, scrollY: target, duration: 520, ease: 'Cubic.easeInOut' });
  }

  override update(): void {
    if (!this.tooltip.visible) return;
    const size = this.tooltip.getData('size') as { w: number; h: number } | undefined;
    if (!size) return;
    const p = this.input.activePointer;
    const px = toDesign(p.x);
    const py = toDesign(p.y);
    const x = Phaser.Math.Clamp(px + 22, 8, GAME_WIDTH - size.w - 8);
    const y = Phaser.Math.Clamp(py - size.h - 14, 110, GAME_HEIGHT - size.h - 100);
    this.tooltip.setPosition(x, y);
  }
}
