import Phaser from 'phaser';
import type { CardPlayVfx } from '../combat/types';
import { C } from '../config';
import { dur, skipDecor } from './timing';
import { burst, riseFlare, screenPulse, slash } from './vfx';

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

/**
 * Nine lightweight, code-native flourishes. They share primitives but not a
 * silhouette: every Legendary card gets a recognisable beat without loading a
 * video decoder or holding a full-screen clip in memory for every play.
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
      screenPulse(scene, ctx.width, ctx.height, 0xdcefff, 0.13, 420);
      for (let i = 0; i < 7; i++) {
        const angle = -74 + i * 18;
        slash(scene, target.x + (i - 3) * 10, target.y + ((i % 2) * 14 - 7), {
          angle,
          length: 170 + i * 10,
          thickness: 11 + (i % 3) * 3,
          bow: 12,
          color: 0x263847,
          coreColor: 0xe9f6ff,
          duration: 260 + i * 18,
        });
      }
      burst(scene, target.x, target.y, { color: 0xdcefff, count: 30, speed: 430, scale: 0.14 });
      await wait(scene, 420);
      return;
    }

    case 'dragonRoar': {
      screenPulse(scene, ctx.width, ctx.height, 0x9fc4e0, 0.18, 520);
      for (let i = 0; i < 3; i++) {
        const wave = scene.add.graphics({ x: enemyCentre.x, y: enemyCentre.y }).setDepth(148 + i);
        wave.lineStyle(7 - i * 2, i === 1 ? 0xffffff : 0x86c9ef, 0.8);
        wave.strokeEllipse(0, 0, 90 + i * 54, 34 + i * 16);
        wave.setScale(0.2);
        scene.tweens.add({
          targets: wave,
          scaleX: 2.7,
          scaleY: 1.8,
          alpha: 0,
          duration: dur(420 + i * 80),
          ease: 'Cubic.easeOut',
          onComplete: () => wave.destroy(),
        });
      }
      for (const enemy of ctx.enemies) {
        burst(scene, enemy.x, enemy.y, { color: 0xb9e8ff, count: 14, speed: 270, scale: 0.14 });
      }
      await wait(scene, 480);
      return;
    }

    case 'nightRaid': {
      screenPulse(scene, ctx.width, ctx.height, 0x334764, 0.2, 460);
      sweepLines(scene, { x: ctx.player.x - 30, y: ctx.player.y }, enemyCentre, 0xe7efff, 7);
      for (let i = 0; i < 3; i++) {
        expandingRing(scene, { x: ctx.player.x + i * 58, y: ctx.player.y - i * 16 }, 0xb6c8ea, 32 + i * 8, 147 + i);
      }
      lightPillar(scene, ctx.player, 0xa9bdea, 260, 38);
      await wait(scene, 410);
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
