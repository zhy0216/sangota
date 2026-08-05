import Phaser from 'phaser';
import { RENDER_SCALE } from '../config';
import { STATUS_META, STATUS_ORDER } from '../combat/statuses';
import type { StatusId } from '../combat/types';

/**
 * PLACEHOLDER ART — status icons are drawn procedurally here rather than
 * loaded, because this repo has no art pipeline. They are white line glyphs on
 * transparent, so the pill tints each one with its own `StatusDef.color`.
 *
 * Everything is drawn in a 20×20 design-unit box and rasterised at
 * `RENDER_SCALE`, so the glyphs stay crisp under the camera zoom instead of
 * being magnified from 20px like a stretched sprite would be.
 */

const BOX = 20;

type Glyph =
  | 'up'
  | 'down'
  | 'wing'
  | 'crack'
  | 'shieldCrack'
  | 'shield'
  | 'drop'
  | 'cross'
  | 'star'
  | 'ring'
  | 'wall'
  | 'ghost'
  | 'dome'
  | 'diamond'
  | 'ban'
  | 'chain'
  | 'spiral'
  | 'bang'
  | 'blade'
  | 'rows'
  | 'hammer'
  | 'cart'
  | 'crescent'
  | 'hook';

/** One glyph per status, grouped so a family reads at a glance. */
const GLYPH: Record<StatusId, Glyph> = {
  strength: 'up',
  weak: 'down',
  dexterity: 'wing',
  vulnerable: 'crack',
  frail: 'shieldCrack',
  metallicize: 'shield',
  poison: 'drop',
  regen: 'cross',
  thorns: 'star',
  artifact: 'ring',
  barricade: 'wall',
  intangible: 'ghost',
  buffer: 'dome',
  ritual: 'diamond',
  slayer: 'blade',
  discipline: 'rows',
  armory: 'hammer',
  supply: 'cart',
  warSaint: 'crescent',
  riposte: 'hook',
  noDraw: 'ban',
  entangled: 'chain',
  curlUp: 'spiral',
  angry: 'bang',
};

function shieldPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(10, 2);
  ctx.lineTo(17, 5);
  ctx.lineTo(17, 10);
  ctx.quadraticCurveTo(17, 15, 10, 18);
  ctx.quadraticCurveTo(3, 15, 3, 10);
  ctx.lineTo(3, 5);
  ctx.closePath();
}

function arrow(ctx: CanvasRenderingContext2D, dir: 1 | -1): void {
  const tip = dir > 0 ? 3 : 17;
  const base = dir > 0 ? 11 : 9;
  ctx.beginPath();
  ctx.moveTo(10, tip);
  ctx.lineTo(17, base);
  ctx.lineTo(3, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(7.5, dir > 0 ? base : 3, 5, 6);
}

function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph): void {
  switch (glyph) {
    case 'up':
      arrow(ctx, 1);
      break;
    case 'down':
      arrow(ctx, -1);
      break;
    case 'wing':
      // Three swept strokes — speed, not a weapon.
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(3, 6 + i * 4);
        ctx.quadraticCurveTo(11, 4 + i * 4, 17, 8 + i * 4);
        ctx.stroke();
      }
      break;
    case 'crack':
      ctx.beginPath();
      ctx.moveTo(12, 2);
      ctx.lineTo(7, 8);
      ctx.lineTo(12, 11);
      ctx.lineTo(6, 18);
      ctx.stroke();
      break;
    case 'shieldCrack':
      shieldPath(ctx);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(11, 4);
      ctx.lineTo(8, 9);
      ctx.lineTo(12, 11);
      ctx.lineTo(9, 16);
      ctx.stroke();
      break;
    case 'shield':
      shieldPath(ctx);
      ctx.fill();
      break;
    case 'drop':
      ctx.beginPath();
      ctx.moveTo(10, 2);
      ctx.quadraticCurveTo(17, 11, 15, 14);
      ctx.arc(10, 13, 5, 0, Math.PI);
      ctx.quadraticCurveTo(3, 11, 10, 2);
      ctx.fill();
      break;
    case 'cross':
      ctx.fillRect(8, 3, 4, 14);
      ctx.fillRect(3, 8, 14, 4);
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 9 : 3.6;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const fn = i === 0 ? ctx.moveTo : ctx.lineTo;
        fn.call(ctx, 10 + Math.cos(a) * r, 10 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rows':
      for (let y = 5; y <= 15; y += 5) {
        ctx.fillRect(3, y - 1, 3, 3);
        ctx.fillRect(9, y - 1, 3, 3);
        ctx.fillRect(15, y - 1, 3, 3);
      }
      break;
    case 'hammer':
      ctx.save();
      ctx.translate(10, 10);
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-2, -7, 4, 14);
      ctx.fillRect(-6, -8, 12, 5);
      ctx.restore();
      break;
    case 'cart':
      ctx.strokeRect(3, 5, 12, 8);
      ctx.beginPath();
      ctx.arc(6, 16, 2, 0, Math.PI * 2);
      ctx.arc(14, 16, 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(15, 7);
      ctx.lineTo(19, 4);
      ctx.stroke();
      break;
    case 'crescent':
      ctx.beginPath();
      ctx.arc(9, 10, 7, -Math.PI / 2, Math.PI / 2);
      ctx.arc(12, 10, 5, Math.PI / 2, -Math.PI / 2, true);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ring':
      ctx.beginPath();
      ctx.arc(10, 10, 7.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(10, 10, 3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'wall':
      for (let row = 0; row < 3; row++) {
        const y = 4 + row * 4.5;
        const offset = row % 2 === 0 ? 0 : 3;
        for (let x = 2 - offset; x < 18; x += 6) {
          ctx.strokeRect(x, y, Math.min(6, 18 - x), 4.5);
        }
      }
      break;
    case 'ghost':
      ctx.beginPath();
      ctx.arc(10, 9, 7, Math.PI, 0);
      ctx.lineTo(17, 17);
      ctx.lineTo(14, 14);
      ctx.lineTo(11.5, 17);
      ctx.lineTo(9, 14);
      ctx.lineTo(6.5, 17);
      ctx.lineTo(3, 17);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'dome':
      ctx.beginPath();
      ctx.arc(10, 14, 8, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(1, 15);
      ctx.lineTo(19, 15);
      ctx.stroke();
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(10, 2);
      ctx.lineTo(17, 10);
      ctx.lineTo(10, 18);
      ctx.lineTo(3, 10);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ban':
      ctx.beginPath();
      ctx.arc(10, 10, 7.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5, 15);
      ctx.lineTo(15, 5);
      ctx.stroke();
      break;
    case 'chain':
      ctx.beginPath();
      ctx.arc(7, 7, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(13, 13, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'spiral':
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 3;
        const r = 1.5 + (i / 40) * 7;
        const x = 10 + Math.cos(a) * r;
        const y = 10 + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    case 'bang':
      ctx.beginPath();
      ctx.moveTo(8, 2);
      ctx.lineTo(12, 2);
      ctx.lineTo(11, 12);
      ctx.lineTo(9, 12);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(10, 16, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'hook':
      // 回马枪 — the shaft doubles back on itself and returns point-first.
      ctx.beginPath();
      ctx.moveTo(14, 3);
      ctx.lineTo(14, 11);
      ctx.arc(10, 11, 4, 0, Math.PI);
      ctx.lineTo(6, 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3, 8);
      ctx.lineTo(6, 4);
      ctx.lineTo(9, 8);
      ctx.stroke();
      break;
    case 'blade':
      // A dagger, point down: the only glyph in the set that reads as a weapon,
      // which is what separates 斩将 from the other gold-tinted buffs.
      ctx.beginPath();
      ctx.moveTo(10, 18);
      ctx.lineTo(7, 11);
      ctx.lineTo(13, 11);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(4, 9, 12, 2);
      ctx.fillRect(9, 2, 2, 7);
      break;
  }
}

/** Registers `status-<id>` for every status. Idempotent. */
export function makeStatusIcons(scene: Phaser.Scene): void {
  const size = Math.max(BOX, Math.round(BOX * RENDER_SCALE));

  for (const id of STATUS_ORDER) {
    const key = STATUS_META[id].icon;
    if (!key || scene.textures.exists(key)) continue;

    const tex = scene.textures.createCanvas(key, size, size);
    if (!tex) continue;

    const ctx = tex.getContext();
    ctx.save();
    ctx.scale(size / BOX, size / BOX);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawGlyph(ctx, GLYPH[id]);
    ctx.restore();
    tex.refresh();
  }
}
