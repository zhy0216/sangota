import Phaser from 'phaser';
import type { CardPlayVfx } from '../combat/types';
import { C } from '../config';
import { dur, skipDecor } from './timing';
import { burst, hitStop, riseFlare, screenPulse, screenShake, slash } from './vfx';

export interface VfxPoint {
  x: number;
  y: number;
}

export interface LegendaryVfxContext {
  player: VfxPoint;
  target?: VfxPoint;
  enemies: VfxPoint[];
  width: number;
  height: number;
}

const wait = (scene: Phaser.Scene, ms: number): Promise<void> =>
  new Promise((resolve) => scene.time.delayedCall(dur(ms), resolve));

function expandingRing(
  scene: Phaser.Scene,
  at: VfxPoint,
  color: number,
  radius: number,
  depth = 148,
): void {
  const ring = scene.add.graphics({ x: at.x, y: at.y }).setDepth(depth);
  ring.lineStyle(4, color, 0.9);
  ring.strokeCircle(0, 0, radius);
  ring.setScale(0.28);
  scene.tweens.add({
    targets: ring,
    scale: 1.65,
    alpha: 0,
    duration: dur(480),
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
}

function lightPillar(
  scene: Phaser.Scene,
  at: VfxPoint,
  color: number,
  height: number,
  width = 72,
): void {
  const beam = scene.add
    .rectangle(at.x, at.y - height / 2, width, height, color, 0.32)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(147)
    .setScale(0.3, 0.05);
  scene.tweens.add({
    targets: beam,
    scaleX: 1,
    scaleY: 1,
    alpha: 0,
    duration: dur(560),
    ease: 'Cubic.easeOut',
    onComplete: () => beam.destroy(),
  });
}

function sweepLines(
  scene: Phaser.Scene,
  from: VfxPoint,
  to: VfxPoint,
  color: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * 14;
    const line = scene.add.graphics().setDepth(148).setBlendMode(Phaser.BlendModes.ADD);
    line.lineStyle(i === Math.floor(count / 2) ? 5 : 2, color, 0.82);
    line.lineBetween(from.x, from.y + offset, to.x, to.y - offset * 0.55);
    line.setAlpha(0);
    scene.tweens.add({
      targets: line,
      alpha: 1,
      duration: dur(90 + i * 12),
      yoyo: true,
      hold: dur(70),
      ease: 'Quad.easeOut',
      onComplete: () => line.destroy(),
    });
  }
}

interface CometOpts {
  color?: number;
  coreColor?: number;
  duration?: number;
  scale?: number;
  depth?: number;
}

/**
 * A glowing head streaking along a straight line, towing a particle wake —
 * a rider read without drawing a rider: pure speed, rendered as light.
 * Resolves when the head reaches `to`; the wake fades on its own.
 */
function cometDash(
  scene: Phaser.Scene,
  from: VfxPoint,
  to: VfxPoint,
  opts: CometOpts = {},
): Promise<void> {
  const { color = 0x9fc4e0, coreColor = 0xffffff, duration = 180, scale = 0.42, depth = 149 } = opts;
  return new Promise((resolve) => {
    const outer = scene.add
      .image(from.x, from.y, 'glow')
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setScale(scale * 2)
      .setAlpha(0.7);
    const core = scene.add
      .image(from.x, from.y, 'glow')
      .setDepth(depth + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(coreColor)
      .setScale(scale);
    const wake = scene.add
      .particles(from.x, from.y, 'glow', {
        speed: { min: 10, max: 70 },
        angle: { min: 0, max: 360 },
        scale: { start: scale * 0.5, end: 0 },
        alpha: { start: 0.7, end: 0 },
        lifespan: { min: dur(140), max: dur(300) },
        frequency: 12,
        blendMode: Phaser.BlendModes.ADD,
        tint: color,
      })
      .setDepth(depth);
    wake.startFollow(core);
    scene.tweens.add({
      targets: [outer, core],
      x: to.x,
      y: to.y,
      duration: dur(duration),
      ease: 'Sine.easeIn',
      onComplete: () => {
        wake.stopFollow();
        wake.stop();
        outer.destroy();
        core.destroy();
        scene.time.delayedCall(dur(320), () => wake.destroy());
        resolve();
      },
    });
  });
}

/** Radiating spokes that flash and fade — the count is the message (七芒). */
function rayFan(
  scene: Phaser.Scene,
  at: VfxPoint,
  color: number,
  count: number,
  inner: number,
  outer: number,
  depth = 151,
): void {
  const g = scene.add.graphics({ x: at.x, y: at.y }).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(3, color, 0.95);
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / count;
    g.lineBetween(Math.cos(a) * inner, Math.sin(a) * inner, Math.cos(a) * outer, Math.sin(a) * outer);
  }
  g.setScale(0.4);
  scene.tweens.add({
    targets: g,
    scale: 1.18,
    alpha: 0,
    duration: dur(430),
    ease: 'Cubic.easeOut',
    onComplete: () => g.destroy(),
  });
}

/** Expanding open arc aimed at `facing` — a shout, not a shield. */
function roarArc(
  scene: Phaser.Scene,
  at: VfxPoint,
  facing: number,
  color: number,
  radius: number,
  delay: number,
): void {
  const arc = scene.add.graphics({ x: at.x, y: at.y }).setDepth(150).setBlendMode(Phaser.BlendModes.ADD);
  arc.lineStyle(5, color, 0.9);
  arc.beginPath();
  arc.arc(0, 0, radius, facing - 1.1, facing + 1.1);
  arc.strokePath();
  arc.setScale(0.3).setAlpha(0);
  scene.tweens.add({
    targets: arc,
    scale: 2.4,
    alpha: { from: 0.95, to: 0 },
    delay: dur(delay),
    duration: dur(480),
    ease: 'Cubic.easeOut',
    onComplete: () => arc.destroy(),
  });
}

/**
 * A serpent of additive glow segments strung along a spline — the 子龙 read.
 * The head carries swept-back horns and whiskers and rides the curve's
 * tangent; the body is sampled behind it *by parameter*, not by frame
 * history, so the shape is identical at any frame rate. `onEnemyPass` fires
 * once per enemy the head crosses. Resolves when the head reaches the end of
 * the path; the tail-first dissolve is fire-and-forget so the roar can start
 * while the serpent is still pouring into its head.
 */
function dragonSweep(
  scene: Phaser.Scene,
  waypoints: VfxPoint[],
  enemies: VfxPoint[],
  onEnemyPass: (enemy: VfxPoint) => void,
  duration = 620,
): Promise<void> {
  const curve = new Phaser.Curves.Spline(waypoints.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
  const start = waypoints[0];

  const head = scene.add.container(start.x, start.y).setDepth(151);
  const halo = scene.add
    .image(0, 0, 'glow')
    .setBlendMode(Phaser.BlendModes.ADD)
    .setTint(0x86c9ef)
    .setScale(1.1)
    .setAlpha(0.8);
  const eye = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffffff).setScale(0.55);
  const crest = scene.add.graphics();
  crest.lineStyle(3, 0xdcefff, 0.9);
  crest.lineBetween(-4, -8, -30, -24);
  crest.lineBetween(2, -12, -20, -32);
  crest.lineStyle(2, 0x86c9ef, 0.8);
  crest.lineBetween(2, 8, -22, 18);
  crest.lineBetween(8, 4, -16, 22);
  head.add([halo, eye, crest]);

  const SEGMENTS = 20;
  const GAP = 0.034; // parameter distance between segments — the serpent spans ~2/3 of the path
  const body: Phaser.GameObjects.Image[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const falloff = 1 - i / SEGMENTS;
    body.push(
      scene.add
        .image(start.x, start.y, 'glow')
        .setDepth(150)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(i % 4 === 2 ? 0xdcefff : 0x86c9ef)
        .setScale(0.16 + 0.34 * falloff)
        .setAlpha(0.28 + 0.4 * falloff),
    );
  }
  const sparks = scene.add
    .particles(start.x, start.y, 'glow', {
      speed: { min: 20, max: 90 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.13, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: { min: dur(180), max: dur(380) },
      frequency: 24,
      blendMode: Phaser.BlendModes.ADD,
      tint: 0xb9e8ff,
    })
    .setDepth(149);
  sparks.startFollow(head);

  const visited = enemies.map(() => false);
  const state = { t: 0 };
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: state,
      t: 1,
      duration: dur(duration),
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const pos = curve.getPoint(state.t);
        const tan = curve.getTangent(state.t);
        head.setPosition(pos.x, pos.y).setRotation(Math.atan2(tan.y, tan.x));
        for (const [i, seg] of body.entries()) {
          const p = curve.getPoint(Math.max(0, state.t - (i + 1) * GAP));
          seg.setPosition(p.x, p.y);
        }
        for (const [i, enemy] of enemies.entries()) {
          if (!visited[i] && Phaser.Math.Distance.Between(pos.x, pos.y, enemy.x, enemy.y) < 54) {
            visited[i] = true;
            onEnemyPass(enemy);
          }
        }
      },
      onComplete: () => {
        sparks.stopFollow();
        sparks.stop();
        scene.time.delayedCall(dur(400), () => sparks.destroy());
        for (const [i, seg] of body.entries()) {
          scene.tweens.add({
            targets: seg,
            alpha: 0,
            scale: 0.05,
            delay: dur((SEGMENTS - i) * 16),
            duration: dur(220),
            onComplete: () => seg.destroy(),
          });
        }
        scene.tweens.add({
          targets: head,
          alpha: 0,
          delay: dur(320),
          duration: dur(240),
          onComplete: () => head.destroy(true),
        });
        resolve();
      },
    });
  });
}

/**
 * Code-native set pieces for the nine Legendary cards — no video decoder, no
 * per-card atlas: everything is drawn from `glow`, Graphics and the shared
 * primitives, so a Legendary can afford a full second of stage time without
 * costing the bundle a byte. 赵云's three are staged as multi-phase
 * mini-cinematics (six rides then a seventh, an ink dragon down the enemy
 * line, night falling and shattering); the other six keep their single-beat
 * flourishes. Every duration passes through `dur()`, and the whole file is
 * decor: `skipDecor()` exits before the first object is allocated.
 */
export async function playLegendaryVfx(
  scene: Phaser.Scene,
  id: CardPlayVfx,
  ctx: LegendaryVfxContext,
): Promise<void> {
  if (skipDecor()) return;
  const target = ctx.target ?? ctx.enemies[0] ?? { x: ctx.width * 0.7, y: ctx.height * 0.45 };
  const enemyCentre =
    ctx.enemies.length > 0
      ? {
          x: ctx.enemies.reduce((sum, p) => sum + p.x, 0) / ctx.enemies.length,
          y: ctx.enemies.reduce((sum, p) => sum + p.y, 0) / ctx.enemies.length,
        }
      : target;

  switch (id) {
    case 'emeraldDragon': {
      screenPulse(scene, ctx.width, ctx.height, 0x2b8f68, 0.2, 520);
      for (let i = 0; i < 3; i++) {
        slash(scene, target.x - 24 + i * 22, target.y - 12 + i * 4, {
          angle: -52 + i * 34,
          length: 260 + i * 24,
          thickness: 24 + i * 5,
          bow: 48,
          color: 0x143f31,
          coreColor: i === 1 ? 0xcdf8ce : 0x65d89a,
          depth: 149 + i,
          duration: 360,
        });
      }
      expandingRing(scene, target, 0x65d89a, 78);
      burst(scene, target.x, target.y, { color: 0x8ff0b8, count: 28, speed: 390, scale: 0.19 });
      await wait(scene, 390);
      return;
    }

    case 'warGod': {
      screenPulse(scene, ctx.width, ctx.height, C.goldBright, 0.22, 620);
      lightPillar(scene, ctx.player, 0xf0d67a, 420, 110);
      riseFlare(scene, ctx.player.x, ctx.player.y + 90, 0xf0d67a);
      expandingRing(scene, ctx.player, C.cinnabarBright, 82);
      expandingRing(scene, ctx.player, C.goldBright, 112, 146);
      burst(scene, ctx.player.x, ctx.player.y, { color: 0xf0d67a, count: 34, speed: 300, scale: 0.2 });
      await wait(scene, 520);
      return;
    }

    case 'oathSeal': {
      const seal = scene.add.graphics({ x: target.x, y: target.y }).setDepth(149);
      seal.lineStyle(3, C.cinnabarBright, 0.9);
      seal.strokeCircle(0, 0, 76);
      seal.lineStyle(2, C.goldBright, 0.82);
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        seal.lineBetween(Math.cos(a) * 48, Math.sin(a) * 48, Math.cos(a) * 84, Math.sin(a) * 84);
      }
      seal.setScale(0.25).setAngle(-28);
      scene.tweens.add({
        targets: seal,
        scale: 1.3,
        angle: 16,
        alpha: 0,
        duration: dur(560),
        ease: 'Back.easeOut',
        onComplete: () => seal.destroy(),
      });
      sweepLines(scene, ctx.player, target, C.goldBright, 3);
      slash(scene, target.x, target.y, { angle: -24, length: 300, thickness: 42, coreColor: C.goldBright });
      await wait(scene, 430);
      return;
    }

    case 'sevenRides': {
      // 七进七出，三拍：暮色压场 → 六骑流光交替方向穿阵，节奏渐紧，每骑
      // 在目标身上留一道未愈的枪痕 → 顿帧蓄势，第七骑白虹贯穿，七芒同绽。
      screenPulse(scene, ctx.width, ctx.height, 0x16202c, 0.26, 950);
      const weave = [-26, 16, -8, 24, -18, 8];
      for (const [i, off] of weave.entries()) {
        const fromLeft = i % 2 === 0;
        void cometDash(
          scene,
          { x: fromLeft ? -70 : ctx.width + 70, y: target.y + off + 8 },
          { x: fromLeft ? ctx.width + 70 : -70, y: target.y + off - 8 },
          { duration: 200 - i * 16, scale: 0.4, coreColor: 0xe9f6ff },
        );
        slash(scene, target.x + (fromLeft ? -12 : 12), target.y + off * 0.8, {
          angle: (fromLeft ? -1 : 1) * (5 + i * 3),
          length: 310,
          thickness: 10,
          bow: 8,
          color: 0x1c2836,
          coreColor: 0xdcefff,
          depth: 148,
          duration: 430,
        });
        burst(scene, target.x, target.y + off, { color: 0xdcefff, count: 9, speed: 250, scale: 0.12 });
        screenShake(scene, 70, 0.003);
        await wait(scene, 130 - i * 13);
      }
      // The seventh ride: everything freezes a beat, then a white lance
      // crosses the whole field and the tally flashes as a seven-point star.
      hitStop(scene, 0.16, 90);
      await wait(scene, 80);
      void cometDash(
        scene,
        { x: -80, y: target.y + 6 },
        { x: ctx.width + 80, y: target.y - 10 },
        { color: 0xe9f6ff, coreColor: 0xffffff, duration: 150, scale: 0.6, depth: 151 },
      );
      await wait(scene, 80);
      slash(scene, target.x, target.y, {
        angle: -18,
        length: 440,
        thickness: 46,
        bow: 26,
        color: 0x263847,
        coreColor: 0xffffff,
        depth: 152,
        duration: 430,
      });
      rayFan(scene, target, 0xe9f6ff, 7, 26, 128);
      expandingRing(scene, target, 0xe9f6ff, 66, 151);
      expandingRing(scene, target, 0x9fc4e0, 98, 150);
      burst(scene, target.x, target.y, { color: 0xffffff, count: 34, speed: 460, scale: 0.16 });
      screenPulse(scene, ctx.width, ctx.height, 0xdcefff, 0.2, 380);
      screenShake(scene, 280, 0.011);
      await wait(scene, 400);
      return;
    }

    case 'dragonRoar': {
      // 龙吟震军，三拍：起势（枪尖聚光柱）→ 青龙出渊（水墨长蛇沿敌阵蜿蜒
      // 贯穿，过身即炸）→ 昂首长吟（三重音浪对着敌阵外扩，全场塌波）。
      screenPulse(scene, ctx.width, ctx.height, 0x101c28, 0.24, 1050);
      lightPillar(scene, ctx.player, 0x86c9ef, 380, 92);
      riseFlare(scene, ctx.player.x, ctx.player.y + 80, 0x9fc4e0);
      expandingRing(scene, ctx.player, 0x86c9ef, 72);
      await wait(scene, 230);

      // Waypoints thread every enemy left-to-right with alternating crests,
      // then pull up past the line so the roar lands from above.
      const ordered = [...ctx.enemies].sort((a, b) => a.x - b.x);
      const pts: VfxPoint[] = [{ x: ctx.player.x + 30, y: ctx.player.y - 26 }];
      let crestUp = true;
      for (const enemy of ordered) {
        const prev = pts[pts.length - 1];
        pts.push({ x: (prev.x + enemy.x) / 2, y: Math.min(prev.y, enemy.y) - (crestUp ? 130 : 58) });
        pts.push(enemy);
        crestUp = !crestUp;
      }
      const apexY = ordered.length ? Math.min(...ordered.map((e) => e.y)) : enemyCentre.y;
      const roarAt = { x: enemyCentre.x + 46, y: apexY - 150 };
      pts.push({ x: roarAt.x - 64, y: roarAt.y + 78 }, roarAt);

      await dragonSweep(scene, pts, ordered, (enemy) => {
        burst(scene, enemy.x, enemy.y, { color: 0xb9e8ff, count: 14, speed: 300, scale: 0.14 });
        expandingRing(scene, enemy, 0x86c9ef, 44, 148);
        screenShake(scene, 90, 0.004);
      });

      // 长吟 — the held note, aimed down the enemy line.
      hitStop(scene, 0.2, 80);
      const facing = Math.atan2(enemyCentre.y - roarAt.y, enemyCentre.x - roarAt.x);
      for (let i = 0; i < 3; i++) {
        roarArc(scene, roarAt, facing, i === 1 ? 0xffffff : 0x86c9ef, 56 + i * 26, i * 90);
      }
      screenPulse(scene, ctx.width, ctx.height, 0x9fc4e0, 0.18, 520);
      screenShake(scene, 320, 0.01);
      for (const [i, enemy] of ctx.enemies.entries()) {
        const wave = scene.add.graphics({ x: enemy.x, y: enemy.y }).setDepth(148);
        wave.lineStyle(5, i % 2 === 0 ? 0x86c9ef : 0xffffff, 0.8);
        wave.strokeEllipse(0, 0, 96, 36);
        wave.setScale(0.24);
        scene.tweens.add({
          targets: wave,
          scaleX: 2.5,
          scaleY: 1.7,
          alpha: 0,
          delay: dur(i * 70),
          duration: dur(430),
          ease: 'Cubic.easeOut',
          onComplete: () => wave.destroy(),
        });
        burst(scene, enemy.x, enemy.y, { color: 0xb9e8ff, count: 16, speed: 300, scale: 0.15 });
      }
      await wait(scene, 450);
      return;
    }

    case 'nightRaid': {
      // 照夜破阵，四拍：夜幕垂、孤月悬 → 照夜玉狮子化银驹踏阵（蹄下生花，
      // 过主公身侧一闪）→ 夜幕如阵图崩碎 → 金气自碎光里回到主公掌中。
      // 夜幕压在 float 层之上（144）纯属安全：伤害数字要等 VFX 结束、
      // playEvents 结算才起飞，暗场里没有会被压暗的战况信息。
      const veil = scene.add
        .rectangle(ctx.width / 2, ctx.height / 2, ctx.width, ctx.height, 0x0a1220, 0.62)
        .setDepth(144)
        .setAlpha(0);
      const moonAt = { x: ctx.width * 0.79, y: 128 };
      const moonGlow = scene.add
        .image(moonAt.x, moonAt.y, 'glow')
        .setDepth(145)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xdce8ff)
        .setScale(2.4)
        .setAlpha(0);
      const moon = scene.add.graphics({ x: moonAt.x, y: moonAt.y }).setDepth(145).setAlpha(0);
      moon.fillStyle(0xe8f0ff, 0.95);
      moon.fillCircle(0, 0, 36);
      moon.lineStyle(2, C.goldBright, 0.5);
      moon.strokeCircle(0, 0, 41);
      const stars = [0.12, 0.3, 0.52, 0.66, 0.92].map((fx, i) =>
        scene.add
          .image(ctx.width * fx, 64 + ((i * 47) % 110), 'glow')
          .setDepth(145)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(0xdce8ff)
          .setScale(0.09)
          .setAlpha(0),
      );
      scene.tweens.add({ targets: veil, alpha: 1, duration: dur(260), ease: 'Quad.easeOut' });
      scene.tweens.add({ targets: moon, alpha: 1, duration: dur(300) });
      scene.tweens.add({ targets: moonGlow, alpha: 0.5, duration: dur(300) });
      scene.tweens.add({ targets: stars, alpha: 0.8, duration: dur(300), delay: dur(120) });
      await wait(scene, 300);

      // 银驹踏阵 — one full-field gallop at torso height, hooves sparking the
      // ground line, the hero flashing as the steed passes.
      const groundY = ctx.player.y + 62;
      const ride = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(-90, ctx.player.y - 18),
        new Phaser.Math.Vector2(ctx.width * 0.46, ctx.player.y + 42),
        new Phaser.Math.Vector2(ctx.width + 90, ctx.player.y - 74),
      );
      const steed = scene.add.container(-90, ctx.player.y - 18).setDepth(150);
      steed.add(
        scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xbcd2ff).setAlpha(0.75),
      );
      steed.add(scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffffff).setScale(0.5));
      const mane = scene.add
        .particles(-90, ctx.player.y - 18, 'glow', {
          speed: { min: 30, max: 110 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.2, end: 0 },
          alpha: { start: 0.8, end: 0 },
          lifespan: { min: dur(200), max: dur(420) },
          frequency: 10,
          blendMode: Phaser.BlendModes.ADD,
          tint: 0xdce8ff,
        })
        .setDepth(149);
      mane.startFollow(steed);

      const hoofMarks = [0.16, 0.32, 0.48, 0.64, 0.8];
      let nextHoof = 0;
      let flashedPlayer = false;
      await new Promise<void>((resolve) => {
        const state = { t: 0 };
        scene.tweens.add({
          targets: state,
          t: 1,
          duration: dur(380),
          ease: 'Sine.easeIn',
          onUpdate: () => {
            const pos = ride.getPoint(state.t);
            steed.setPosition(pos.x, pos.y);
            if (nextHoof < hoofMarks.length && state.t >= hoofMarks[nextHoof]) {
              nextHoof += 1;
              burst(scene, pos.x, groundY, { color: 0xdce8ff, count: 8, speed: 200, scale: 0.11, depth: 148 });
              expandingRing(scene, { x: pos.x, y: groundY }, 0xbcd2ff, 26, 147);
            }
            if (!flashedPlayer && pos.x >= ctx.player.x) {
              flashedPlayer = true;
              burst(scene, ctx.player.x, ctx.player.y, { color: 0xffffff, count: 16, speed: 280, scale: 0.15, depth: 149 });
              expandingRing(scene, ctx.player, 0xe7efff, 52, 149);
              screenShake(scene, 90, 0.004);
            }
          },
          onComplete: () => {
            mane.stopFollow();
            mane.stop();
            scene.time.delayedCall(dur(360), () => mane.destroy());
            steed.destroy(true);
            resolve();
          },
        });
      });

      // 破阵 — the night shatters like a broken formation chart: ink shards
      // and light slivers alternate so the break reads on both fields.
      hitStop(scene, 0.2, 80);
      scene.tweens.add({ targets: veil, alpha: 0, duration: dur(220), onComplete: () => veil.destroy() });
      for (let i = 0; i < 14; i++) {
        const a = (Math.PI * 2 * i) / 14 + (i % 3) * 0.31;
        const r0 = 26 + (i % 4) * 14;
        const lit = i % 2 === 1;
        const shard = scene.add
          .graphics({ x: enemyCentre.x + Math.cos(a) * r0, y: enemyCentre.y + Math.sin(a) * r0 })
          .setDepth(150);
        if (lit) shard.setBlendMode(Phaser.BlendModes.ADD);
        shard.fillStyle(lit ? 0xdce8ff : 0x0a1220, lit ? 0.9 : 0.66);
        const s = 12 + (i % 3) * 8;
        shard.fillTriangle(0, -s, s * 0.8, s * 0.6, -s * 0.7, s * 0.5);
        shard.setRotation(a);
        scene.tweens.add({
          targets: shard,
          x: enemyCentre.x + Math.cos(a) * (240 + (i % 5) * 46),
          y: enemyCentre.y + Math.sin(a) * (170 + (i % 4) * 40),
          rotation: a + ((i % 2) * 2 - 1) * 2.2,
          alpha: 0,
          duration: dur(520),
          ease: 'Cubic.easeOut',
          onComplete: () => shard.destroy(),
        });
      }
      expandingRing(scene, enemyCentre, 0xe7efff, 72, 151);
      expandingRing(scene, enemyCentre, 0xbcd2ff, 110, 150);
      burst(scene, enemyCentre.x, enemyCentre.y, { color: 0xe7efff, count: 30, speed: 430, scale: 0.16 });
      screenPulse(scene, ctx.width, ctx.height, 0xdce8ff, 0.2, 360);
      screenShake(scene, 300, 0.011);

      // 气回掌 — six gold motes fold back into the hero, then the gain flare.
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
        const mote = scene.add
          .image(ctx.player.x + Math.cos(a) * 120, ctx.player.y + Math.sin(a) * 92, 'glow')
          .setDepth(151)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(C.goldBright)
          .setScale(0.16)
          .setAlpha(0);
        scene.tweens.add({
          targets: mote,
          x: ctx.player.x,
          y: ctx.player.y,
          alpha: { from: 0.95, to: 0.4 },
          scale: 0.05,
          delay: dur(90 + i * 36),
          duration: dur(260),
          ease: 'Cubic.easeIn',
          onComplete: () => mote.destroy(),
        });
      }
      scene.time.delayedCall(dur(430), () => riseFlare(scene, ctx.player.x, ctx.player.y + 70, C.goldBright));
      scene.tweens.add({
        targets: [moon, moonGlow, ...stars],
        alpha: 0,
        delay: dur(320),
        duration: dur(300),
        onComplete: () => {
          moon.destroy();
          moonGlow.destroy();
          for (const star of stars) star.destroy();
        },
      });
      await wait(scene, 500);
      return;
    }

    case 'eightTrigrams': {
      screenPulse(scene, ctx.width, ctx.height, 0xdcefff, 0.12, 620);
      const wheel = scene.add.graphics({ x: enemyCentre.x, y: enemyCentre.y }).setDepth(149);
      wheel.lineStyle(3, C.goldBright, 0.9);
      wheel.strokeCircle(0, 0, 116);
      wheel.lineStyle(2, 0xdcefff, 0.72);
      wheel.strokeCircle(0, 0, 72);
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        const x1 = Math.cos(a) * 76;
        const y1 = Math.sin(a) * 76;
        const x2 = Math.cos(a) * 118;
        const y2 = Math.sin(a) * 118;
        wheel.lineBetween(x1, y1, x2, y2);
        wheel.fillStyle(i % 2 === 0 ? C.goldBright : C.paper, 0.8);
        wheel.fillCircle(Math.cos(a) * 96, Math.sin(a) * 96, 4);
      }
      wheel.setScale(0.25).setAngle(-45);
      scene.tweens.add({
        targets: wheel,
        scale: 1.5,
        angle: 24,
        alpha: 0,
        duration: dur(680),
        ease: 'Cubic.easeOut',
        onComplete: () => wheel.destroy(),
      });
      await wait(scene, 520);
      return;
    }

    case 'eastWind': {
      screenPulse(scene, ctx.width, ctx.height, 0xd9502e, 0.2, 620);
      sweepLines(scene, { x: ctx.player.x, y: ctx.player.y - 24 }, enemyCentre, 0xffb25e, 5);
      for (const [i, enemy] of ctx.enemies.entries()) {
        slash(scene, enemy.x, enemy.y, {
          angle: -12 + i * 8,
          length: 250,
          thickness: 36,
          bow: 62,
          color: 0x6e1f14,
          coreColor: 0xffc16a,
          duration: 430,
        });
        burst(scene, enemy.x, enemy.y, { color: 0xff8a42, count: 22, speed: 320, scale: 0.18 });
      }
      await wait(scene, 480);
      return;
    }

    case 'sevenStars': {
      screenPulse(scene, ctx.width, ctx.height, 0x776bb0, 0.2, 720);
      const stars = scene.add.graphics({ x: ctx.player.x, y: ctx.player.y - 70 }).setDepth(149);
      const points = [
        [-88, 12],
        [-52, -50],
        [-8, -16],
        [30, -76],
        [62, -22],
        [94, 28],
        [34, 62],
      ] as const;
      stars.lineStyle(2, 0xded9ff, 0.7);
      stars.beginPath();
      stars.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) stars.lineTo(x, y);
      stars.strokePath();
      for (const [i, [x, y]] of points.entries()) {
        stars.fillStyle(i === 3 ? C.goldBright : 0xe9e5ff, 0.95);
        stars.fillCircle(x, y, i === 3 ? 8 : 5);
      }
      stars.setScale(0.35).setAlpha(0.2);
      scene.tweens.add({
        targets: stars,
        scale: 1.35,
        angle: 12,
        alpha: 0,
        duration: dur(760),
        ease: 'Cubic.easeOut',
        onComplete: () => stars.destroy(),
      });
      lightPillar(scene, ctx.player, 0xc7bfff, 360, 76);
      riseFlare(scene, ctx.player.x, ctx.player.y + 80, 0xc7bfff);
      await wait(scene, 560);
      return;
    }
  }
}
