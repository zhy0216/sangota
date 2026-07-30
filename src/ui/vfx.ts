import Phaser from 'phaser';
import { C } from '../config';
import { brushStyle } from './theme';

/**
 * Reusable combat effects. Everything here is fire-and-forget: each helper
 * creates its own objects, tweens them, and destroys them on completion, so
 * callers never have to track handles.
 */

export interface SlashOpts {
  angle?: number;
  length?: number;
  thickness?: number;
  bow?: number;
  color?: number;
  coreColor?: number;
  depth?: number;
  duration?: number;
}

/**
 * A tapered brush stroke, drawn as a polygon that swells in the middle and
 * comes to a point at both ends — the ink-wash read we want rather than a
 * generic glowing arc.
 */
export function slash(scene: Phaser.Scene, x: number, y: number, opts: SlashOpts = {}): void {
  const {
    angle = -34,
    length = 210,
    thickness = 30,
    bow = 34,
    color = 0x1a1613,
    coreColor = 0xfff2d8,
    depth = 130,
    duration = 280,
  } = opts;

  const build = (scaleThickness: number, fill: number, alpha: number) => {
    const g = scene.add.graphics({ x, y }).setDepth(depth);
    const steps = 18;
    const top: Phaser.Math.Vector2[] = [];
    const bottom: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = -length / 2 + length * t;
      const py = -Math.sin(t * Math.PI) * bow;
      const w = Math.sin(t * Math.PI) * ((thickness * scaleThickness) / 2);
      top.push(new Phaser.Math.Vector2(px, py - w));
      bottom.push(new Phaser.Math.Vector2(px, py + w));
    }
    g.fillStyle(fill, alpha);
    g.fillPoints([...top, ...bottom.reverse()], true);
    g.setAngle(angle);
    return g;
  };

  // Dark ink body with a hot core, so the stroke reads on light and dark alike.
  const body = build(1, color, 0.85);
  const core = build(0.42, coreColor, 0.95);

  for (const [i, g] of [body, core].entries()) {
    g.setScale(0.55, 0.8);
    scene.tweens.add({
      targets: g,
      scaleX: 1.18,
      scaleY: 1,
      alpha: 0,
      duration: duration + i * 60,
      ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    });
  }
}

/** Radial spray of specks. Used for weapon impacts. */
export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  opts: { color?: number; count?: number; speed?: number; depth?: number; scale?: number } = {},
): void {
  const { color = 0xffd8a8, count = 16, speed = 320, depth = 128, scale = 0.16 } = opts;
  const emitter = scene.add.particles(x, y, 'glow', {
    speed: { min: speed * 0.35, max: speed },
    angle: { min: 0, max: 360 },
    scale: { start: scale, end: 0 },
    alpha: { start: 0.95, end: 0 },
    lifespan: { min: 240, max: 430 },
    blendMode: Phaser.BlendModes.ADD,
    tint: color,
    emitting: false,
  });
  emitter.setDepth(depth);
  emitter.explode(count);
  scene.time.delayedCall(700, () => emitter.destroy());
}

/** Low, slow, gravity-bound puff for footfalls and landings. */
export function dust(scene: Phaser.Scene, x: number, y: number, dir = 1, depth = 15): void {
  const emitter = scene.add.particles(x, y, 'glow', {
    speedX: { min: -60 * dir, max: -170 * dir },
    speedY: { min: -50, max: -8 },
    gravityY: 130,
    scale: { start: 0.2, end: 0.42 },
    alpha: { start: 0.34, end: 0 },
    lifespan: { min: 320, max: 560 },
    tint: 0x9d8f78,
    emitting: false,
  });
  emitter.setDepth(depth);
  emitter.explode(9);
  scene.time.delayedCall(800, () => emitter.destroy());
}

/** Expanding double ring, for gaining block. */
export function shieldFlare(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  depth = 128,
): void {
  for (const [i, color] of [0x9fc4e0, 0xdcefff].entries()) {
    const g = scene.add.graphics({ x, y }).setDepth(depth);
    g.lineStyle(i === 0 ? 5 : 2, color, 0.9);
    g.strokeCircle(0, 0, radius);
    g.setScale(0.6);
    scene.tweens.add({
      targets: g,
      scale: 1.25 + i * 0.12,
      alpha: 0,
      duration: 420 + i * 90,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }
}

/** Spreading ink blot, used when something dies. */
export function inkSplash(scene: Phaser.Scene, x: number, y: number, depth = 12): void {
  const g = scene.add.graphics({ x, y }).setDepth(depth);
  const rng = () => Math.random();
  const points: Phaser.Math.Vector2[] = [];
  const steps = 22;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = 60 * (0.6 + rng() * 0.65);
    points.push(new Phaser.Math.Vector2(Math.cos(a) * r, Math.sin(a) * r * 0.42));
  }
  g.fillStyle(C.inkDeep, 0.6);
  g.fillPoints(points, true);
  g.setScale(0.3);
  scene.tweens.add({
    targets: g,
    scale: 1.5,
    alpha: 0,
    duration: 720,
    ease: 'Cubic.easeOut',
    onComplete: () => g.destroy(),
  });

  const emitter = scene.add.particles(x, y - 30, 'glow', {
    speed: { min: 60, max: 240 },
    angle: { min: 200, max: 340 },
    gravityY: 320,
    scale: { start: 0.18, end: 0 },
    alpha: { start: 0.8, end: 0 },
    lifespan: { min: 380, max: 700 },
    tint: 0x2b241d,
    emitting: false,
  });
  emitter.setDepth(depth + 1);
  emitter.explode(18);
  scene.time.delayedCall(900, () => emitter.destroy());
}

/**
 * Brief slow-motion on impact. Only the tween clock is scaled — the scene time
 * clock drives the animation `await`s, so slowing that too would stretch the
 * whole sequence instead of punctuating it.
 */
export function hitStop(scene: Phaser.Scene, factor = 0.22, ms = 70): void {
  scene.tweens.timeScale = factor;
  scene.time.delayedCall(ms, () => {
    scene.tweens.timeScale = 1;
  });
}

type Poppable = Phaser.GameObjects.GameObject & { setScale(value: number): unknown };

/**
 * Scale punch — the workhorse "this just fired" beat for icons, badges and
 * counters. Any in-flight pop is killed first so rapid triggers don't stack
 * into a permanently oversized object.
 */
export function pop(scene: Phaser.Scene, target: Poppable, scale = 1.25, duration = 120): void {
  scene.tweens.killTweensOf(target);
  target.setScale(1);
  scene.tweens.add({ targets: target, scale, duration, yoyo: true, ease: 'Back.easeOut' });
}

export interface PopTextOpts {
  color?: number;
  size?: number;
  depth?: number;
  drift?: number;
  spread?: number;
}

/** Damage / status number with a scale pop and a slight sideways arc. */
export function popText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: PopTextOpts = {},
): void {
  const { color = C.paper, size = 30, depth = 140, drift = 62, spread = 26 } = opts;
  const label = scene.add
    .text(x, y, text, brushStyle(size, color))
    .setOrigin(0.5)
    .setDepth(depth)
    .setStroke('#0d0b09', Math.max(3, size * 0.16))
    .setScale(0.4);

  scene.tweens.add({
    targets: label,
    scale: 1.18,
    duration: 130,
    ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({ targets: label, scale: 1, duration: 90 });
    },
  });
  scene.tweens.add({
    targets: label,
    x: x + (Math.random() * 2 - 1) * spread,
    y: y - drift,
    duration: 760,
    ease: 'Quad.easeOut',
  });
  scene.tweens.add({
    targets: label,
    alpha: 0,
    delay: 380,
    duration: 380,
    onComplete: () => label.destroy(),
  });
}

/** Full-screen colour wash, for taking a hit or a passive firing. */
export function screenPulse(
  scene: Phaser.Scene,
  width: number,
  height: number,
  color: number,
  strength = 0.3,
  duration = 420,
): void {
  const rect = scene.add
    .rectangle(width / 2, height / 2, width, height, color, strength)
    .setDepth(150)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: rect,
    alpha: 0,
    duration,
    ease: 'Quad.easeOut',
    onComplete: () => rect.destroy(),
  });
}

/**
 * Ink band that sweeps across the screen announcing a turn. Resolves when it
 * has fully cleared, so callers can await it before continuing.
 */
export function turnBanner(
  scene: Phaser.Scene,
  width: number,
  height: number,
  text: string,
  accent: number,
): Promise<void> {
  return new Promise((resolve) => {
    const y = height * 0.36;
    const band = scene.add.container(0, y).setDepth(160);

    const bg = scene.add.graphics();
    bg.fillGradientStyle(C.inkDeep, C.inkDeep, C.inkDeep, C.inkDeep, 0, 0.92, 0, 0.92);
    bg.fillRect(-width / 2, -34, width / 2, 68);
    bg.fillGradientStyle(C.inkDeep, C.inkDeep, C.inkDeep, C.inkDeep, 0.92, 0, 0.92, 0);
    bg.fillRect(0, -34, width / 2, 68);
    bg.lineStyle(1.5, accent, 0.8);
    bg.lineBetween(-width * 0.4, -34, width * 0.4, -34);
    bg.lineBetween(-width * 0.4, 34, width * 0.4, 34);

    const label = scene.add
      .text(0, 0, text, brushStyle(40, accent))
      .setOrigin(0.5)
      .setLetterSpacing(12);

    band.add([bg, label]);
    band.setX(-width * 0.35);
    band.setAlpha(0);

    scene.tweens.add({
      targets: band,
      x: width / 2,
      alpha: 1,
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        // Resolve at the top of the hold, not after the exit sweep: callers
        // want to act while the band is still clearing, not wait it out.
        resolve();
        scene.tweens.add({
          targets: band,
          x: width * 1.35,
          alpha: 0,
          delay: 170,
          duration: 250,
          ease: 'Cubic.easeIn',
          onComplete: () => band.destroy(true),
        });
      },
    });
  });
}
