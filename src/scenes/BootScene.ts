import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle } from '../ui/theme';

const ICON_KEYS = ['monster', 'elite', 'event', 'shop', 'rest', 'treasure', 'boss'] as const;
const ENEMY_KEYS = ['yellowturban', 'bandit', 'huaxiong', 'lubu'] as const;
const CARD_KEYS = [
  'pikan', 'tiebi', 'tuodao', 'wenjiu', 'wanren',
  'quedi', 'yiyong', 'baima', 'jieying', 'guanzhen', 'xuzhao',
] as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    useDesignSpace(this);
    this.buildLoadingUi();

    this.load.setPath('assets');
    this.load.image('map-bg', 'map/map-bg.jpg');
    this.load.image('hero-guanyu', 'heroes/guanyu-full.png');
    this.load.image('portrait-guanyu', 'heroes/guanyu-portrait.png');
    for (const key of ICON_KEYS) {
      this.load.image(`icon-${key}`, `icons/${key}.png`);
    }
    this.load.image('combat-bg', 'combat/combat-bg.jpg');
    for (const key of ENEMY_KEYS) {
      this.load.image(`enemy-${key}`, `enemies/${key}.png`);
    }
    for (const key of CARD_KEYS) {
      this.load.image(`card-${key}`, `cards/${key}.jpg`);
    }

    // A missing asset should degrade to a visible placeholder, not a black screen.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[boot] asset failed to load: ${file.key} (${file.src})`);
      this.makePlaceholder(file.key);
    });
  }

  create(): void {
    this.makeGlowTexture();
    this.scene.start('Title');
  }

  private buildLoadingUi(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    this.add.text(cx, cy - 70, '三國', brushStyle(64, C.paper)).setOrigin(0.5).setLetterSpacing(12);
    this.add
      .text(cx, cy - 18, '烽火尖塔', brushStyle(26, C.gold))
      .setOrigin(0.5)
      .setLetterSpacing(10);

    const barW = 360;
    const barH = 6;
    const barX = cx - barW / 2;
    const barY = cy + 40;

    const track = this.add.graphics();
    track.fillStyle(C.inkSoft, 1);
    track.fillRect(barX, barY, barW, barH);
    track.lineStyle(1, C.gold, 0.35);
    track.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    const fill = this.add.graphics();
    const label = this.add.text(cx, barY + 30, '整军待发…', bodyStyle(15, C.paperFaint)).setOrigin(0.5);

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.clear();
      fill.fillStyle(C.cinnabar, 1);
      fill.fillRect(barX, barY, barW * value, barH);
      fill.fillStyle(C.goldBright, 0.9);
      fill.fillRect(barX + barW * value - 2, barY - 1, 2, barH + 2);
      label.setText(`整军待发…  ${Math.round(value * 100)}%`);
    });
  }

  /** Soft additive halo reused for node highlights and hero backlight. */
  private makeGlowTexture(): void {
    const size = 256;
    if (this.textures.exists('glow')) return;
    const tex = this.textures.createCanvas('glow', size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    grd.addColorStop(0.65, 'rgba(255,255,255,0.14)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  private makePlaceholder(key: string): void {
    if (this.textures.exists(key)) return;
    const size = 128;
    const tex = this.textures.createCanvas(key, size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = '#2b241d';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#c8392b';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, size - 8, size - 8);
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '48px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size / 2, size / 2);
    tex.refresh();
  }
}
