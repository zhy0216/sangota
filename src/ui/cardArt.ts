import Phaser from 'phaser';
import { C, RENDER_SCALE, css } from '../config';
import { CARDS, CARD_TYPE_META } from '../combat/cards';
import { Rng } from '../core/rng';

/**
 * PLACEHOLDER ART — a fallback, not the normal path. Most cards in `CARDS`
 * ship a painting; this covers the card whose plate fails to load and every
 * card added ahead of its art (currently the 22 阶段七 赵云/诸葛亮 cards).
 * Dropping a real plate into `assets/cards/` and listing it in BootScene's
 * `CARD_KEYS` takes over with no code change here.
 *
 * The plate is an ink ground under a seeded brush figure tinted by card type,
 * so every card reads as its own picture and the same card looks the same on
 * every run. Rasterised at RENDER_SCALE — a 136×91 canvas magnified by the
 * camera zoom is exactly the blur the design space exists to avoid.
 */

/** The art window in `CardView`, in design units. */
const W = 136;
const H = 91;

export function makeCardArt(scene: Phaser.Scene): void {
  for (const def of Object.values(CARDS)) {
    if (scene.textures.exists(def.art)) continue;
    paint(scene, def.art, def.id, CARD_TYPE_META[def.type].color);
  }
}

function paint(scene: Phaser.Scene, key: string, seed: string, tint: number): void {
  const tex = scene.textures.createCanvas(
    key,
    Math.round(W * RENDER_SCALE),
    Math.round(H * RENDER_SCALE),
  );
  if (!tex) return;

  const rng = new Rng(`art:${seed}`);
  const ctx = tex.getContext();
  ctx.save();
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  ctx.fillStyle = css(C.inkSoft);
  ctx.fillRect(0, 0, W, H);

  // A low sun disc behind the figure, offset so the composition is never centred.
  ctx.fillStyle = css(tint);
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(W * (0.3 + rng.next() * 0.4), H * 0.42, 22 + rng.next() * 12, 0, Math.PI * 2);
  ctx.fill();

  // Brush strokes: a few sweeps of the type colour over a horizon line.
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = css(tint);
  ctx.lineCap = 'round';
  const strokes = 3 + rng.int(4);
  for (let i = 0; i < strokes; i++) {
    const x = 14 + rng.next() * (W - 28);
    const y = 18 + rng.next() * (H - 40);
    ctx.lineWidth = 1.5 + rng.next() * 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + rng.jitter(30),
      y + rng.jitter(24),
      x + rng.jitter(46),
      y + 10 + rng.next() * 26,
    );
    ctx.stroke();
  }

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = css(C.paperFaint);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.72);
  ctx.lineTo(W, H * 0.72);
  ctx.stroke();

  ctx.restore();
  tex.refresh();
}
