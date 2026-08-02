import Phaser from 'phaser';
import { C } from '../config';
import { brushStyle } from './theme';
import { dur, shakeIntensity, skipDecor } from './timing';

/**
 * Reusable combat effects. Everything here is fire-and-forget: each helper
 * creates its own objects, tweens them, and destroys them on completion, so
 * callers never have to track handles.
 *
 * 动画速度 (todos/21 t2)：所有时长在**使用处**过 `dur()`——参数与默认值
 * 保持原始毫秒，换算只发生一次。纯装饰的三件（尘土、水墨飞溅、屏幕洗色）
 * 在 instant 挡整个跳过；伤害数字、护甲变化、死亡反馈永远保留。
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
      duration: dur(duration + i * 60),
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
    lifespan: { min: dur(240), max: dur(430) },
    blendMode: Phaser.BlendModes.ADD,
    tint: color,
    emitting: false,
  });
  emitter.setDepth(depth);
  emitter.explode(count);
  scene.time.delayedCall(dur(700), () => emitter.destroy());
}

/** Low, slow, gravity-bound puff for footfalls and landings. 纯装饰。 */
export function dust(scene: Phaser.Scene, x: number, y: number, dir = 1, depth = 15): void {
  if (skipDecor()) return;
  const emitter = scene.add.particles(x, y, 'glow', {
    speedX: { min: -60 * dir, max: -170 * dir },
    speedY: { min: -50, max: -8 },
    gravityY: 130,
    scale: { start: 0.2, end: 0.42 },
    alpha: { start: 0.34, end: 0 },
    lifespan: { min: dur(320), max: dur(560) },
    tint: 0x9d8f78,
    emitting: false,
  });
  emitter.setDepth(depth);
  emitter.explode(9);
  scene.time.delayedCall(dur(800), () => emitter.destroy());
}

export interface FlareOpts {
  depth?: number;
  /** 双环配色（粗环、细环）。默认护甲的蓝白——block 的读法保持原样。 */
  colors?: readonly [number, number];
  /**
   * 扩散时的纵向漂移：增益向上浮（负值）、减益向下沉（正值）、护甲原地
   * ——三类曾共用一个蓝环「完全撞脸」，方向 + 配色一起把它们分开。
   */
  driftY?: number;
}

/** Expanding double ring — block, buffs and debuffs, told apart by `FlareOpts`. */
export function shieldFlare(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  opts: FlareOpts = {},
): void {
  const { depth = 128, colors = [0x9fc4e0, 0xdcefff], driftY = 0 } = opts;
  for (const [i, color] of colors.entries()) {
    const g = scene.add.graphics({ x, y }).setDepth(depth);
    g.lineStyle(i === 0 ? 5 : 2, color, 0.9);
    g.strokeCircle(0, 0, radius);
    g.setScale(0.6);
    scene.tweens.add({
      targets: g,
      scale: 1.25 + i * 0.12,
      y: y + driftY,
      alpha: 0,
      duration: dur(420 + i * 90),
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }
}

/**
 * 治疗的上升灵光——从躯干缓缓浮起的一撮玉色光尘。纯装饰：治疗反馈的
 * 本体是 `+N` 数字与血条回涨，instant 挡跳过这撮尘不丢信息。
 */
export function healMotes(scene: Phaser.Scene, x: number, y: number, color = 0x8fd0a8): void {
  if (skipDecor()) return;
  const emitter = scene.add.particles(x, y + 26, 'glow', {
    speedY: { min: -110, max: -40 },
    speedX: { min: -34, max: 34 },
    scale: { start: 0.15, end: 0 },
    alpha: { start: 0.8, end: 0 },
    lifespan: { min: dur(420), max: dur(760) },
    blendMode: Phaser.BlendModes.ADD,
    tint: color,
    emitting: false,
  });
  emitter.setDepth(128);
  emitter.explode(14);
  scene.time.delayedCall(dur(900), () => emitter.destroy());
}

/**
 * 势落地的登坛金焰——从脚下升起的一柱光尘，宣告一张永久生效的牌进了
 * 战场。纯装饰：势的账面本体是 status 事件的飘字与状态栏图标。
 */
export function riseFlare(scene: Phaser.Scene, x: number, baseY: number, color = 0xf0d67a): void {
  if (skipDecor()) return;
  const emitter = scene.add.particles(x, baseY, 'glow', {
    x: { min: -30, max: 30 },
    speedY: { min: -240, max: -90 },
    speedX: { min: -16, max: 16 },
    scale: { start: 0.2, end: 0 },
    alpha: { start: 0.9, end: 0 },
    lifespan: { min: dur(420), max: dur(820) },
    blendMode: Phaser.BlendModes.ADD,
    tint: color,
    emitting: false,
  });
  emitter.setDepth(129);
  emitter.explode(24);
  scene.time.delayedCall(dur(950), () => emitter.destroy());
}

/**
 * Spreading ink blot, used when something dies. 纯装饰——死亡反馈本体是
 * `playDeath` 的倾倒溶解，墨点在 instant 挡可以整个不画。
 */
export function inkSplash(scene: Phaser.Scene, x: number, y: number, depth = 12): void {
  if (skipDecor()) return;
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
    duration: dur(720),
    ease: 'Cubic.easeOut',
    onComplete: () => g.destroy(),
  });

  const emitter = scene.add.particles(x, y - 30, 'glow', {
    speed: { min: 60, max: 240 },
    angle: { min: 200, max: 340 },
    gravityY: 320,
    scale: { start: 0.18, end: 0 },
    alpha: { start: 0.8, end: 0 },
    lifespan: { min: dur(380), max: dur(700) },
    tint: 0x2b241d,
    emitting: false,
  });
  emitter.setDepth(depth + 1);
  emitter.explode(18);
  scene.time.delayedCall(dur(900), () => emitter.destroy());
}

/**
 * Brief slow-motion on impact. Only the tween clock is scaled — the scene time
 * clock drives the animation `await`s, so slowing that too would stretch the
 * whole sequence instead of punctuating it. 冻结时长同样过 `dur()`：快速挡
 * 的顿帧跟着整体节奏缩短，缩放的轴（timeScale）不变。
 */
export function hitStop(scene: Phaser.Scene, factor = 0.22, ms = 70): void {
  scene.tweens.timeScale = factor;
  scene.time.delayedCall(dur(ms), () => {
    scene.tweens.timeScale = 1;
  });
}

/**
 * 屏幕震动的唯一出口 (todos/21 t2)。挡位换算在 `shakeIntensity`：off 整个
 * 不摇（关掉后完全无震动——背景带 6% 出血，不摇也不露边，见 README），
 * reduced 强度减半，时长照过 `dur()`。
 */
export function screenShake(scene: Phaser.Scene, duration: number, intensity: number): void {
  const strength = shakeIntensity(intensity);
  if (strength === null) return;
  scene.cameras.main.shake(dur(duration), strength);
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
  scene.tweens.add({ targets: target, scale, duration: dur(duration), yoyo: true, ease: 'Back.easeOut' });
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
    duration: dur(130),
    ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({ targets: label, scale: 1, duration: dur(90) });
    },
  });
  scene.tweens.add({
    targets: label,
    x: x + (Math.random() * 2 - 1) * spread,
    y: y - drift,
    duration: dur(760),
    ease: 'Quad.easeOut',
  });
  scene.tweens.add({
    targets: label,
    alpha: 0,
    delay: dur(380),
    duration: dur(380),
    onComplete: () => label.destroy(),
  });
}

/** Full-screen colour wash, for taking a hit or a passive firing. 纯装饰。 */
export function screenPulse(
  scene: Phaser.Scene,
  width: number,
  height: number,
  color: number,
  strength = 0.3,
  duration = 420,
): void {
  if (skipDecor()) return;
  const rect = scene.add
    .rectangle(width / 2, height / 2, width, height, color, strength)
    .setDepth(150)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: rect,
    alpha: 0,
    duration: dur(duration),
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
      duration: dur(220),
      ease: 'Cubic.easeOut',
      onComplete: () => {
        // Resolve at the top of the hold, not after the exit sweep: callers
        // want to act while the band is still clearing, not wait it out.
        resolve();
        scene.tweens.add({
          targets: band,
          x: width * 1.35,
          alpha: 0,
          delay: dur(170),
          duration: dur(250),
          ease: 'Cubic.easeIn',
          onComplete: () => band.destroy(true),
        });
      },
    });
  });
}
