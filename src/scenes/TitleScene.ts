import Phaser from 'phaser';
import { C, css, FONT_BRUSH, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';
import { DEFAULT_HERO, HEROES_IN_ORDER, type HeroDef } from '../data/heroes';
import { startRun } from '../state/run';
import { isCardGridOpen, openCardGrid } from '../ui/CardGrid';
import { toDesign, useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';

/** Cover-fit an image into a box without distorting it. */
function cover(img: Phaser.GameObjects.Image, w: number, h: number): void {
  const scale = Math.max(w / img.width, h / img.height);
  img.setScale(scale);
}

const LEFT = 108;
const PANEL = { x: LEFT, y: 326, w: 442, h: 292 };
const HERO_X = 905;

/** The 选将 strip down the right edge: one tile per hero, top to bottom. */
const TILE = { x: 1196, y: 190, w: 96, h: 104, gap: 18 };

export class TitleScene extends Phaser.Scene {
  private parallax: { obj: Phaser.GameObjects.GameObject & { x: number; y: number }; depth: number; baseX: number; baseY: number }[] = [];
  /**
   * The same gate `MapScene.leaving`, `RoomScene.leaving` and
   * `CombatScene.claimed` are: `inkButton` binds `pointerdown` and Enter
   * auto-repeats, and the fade out runs for 420 ms with both still live. Every
   * extra call was another `startRun()` — a whole new map generated under a
   * player who had already committed to the one being faded out.
   */
  private leaving = false;

  /**
   * Assigned in `create`, never as a class field: Phaser keeps one instance per
   * scene key for the life of the game, so a field initialiser runs once and a
   * hero picked on a previous visit would still be picked on the next one.
   */
  private picked!: HeroDef;

  private seal!: Phaser.GameObjects.Text;
  private heroHolder!: Phaser.GameObjects.Container;
  private heroImg!: Phaser.GameObjects.Image;
  private panel!: Phaser.GameObjects.Container;
  private tiles: { hero: HeroDef; paint: (state: 'idle' | 'hover' | 'picked') => void }[] = [];

  constructor() {
    super('Title');
  }

  create(): void {
    useDesignSpace(this);
    this.leaving = false;
    this.picked = DEFAULT_HERO;
    this.tiles = [];

    // --- Backdrop ---------------------------------------------------------
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'map-bg');
    cover(bg, GAME_WIDTH * 1.1, GAME_HEIGHT * 1.1);
    bg.setAlpha(0.7);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.56);

    // Large watermark character behind the hero. Repainted on every pick.
    this.seal = this.add
      .text(HERO_X, 300, this.picked.seal, brushStyle(420, C.cinnabar))
      .setOrigin(0.5)
      .setAlpha(0.1);

    // Warm backlight so the cut-out hero doesn't look pasted on.
    const halo = this.add
      .image(HERO_X, 430, 'glow')
      .setScale(3.6)
      .setTint(0xc98a3a)
      .setAlpha(0.22)
      .setBlendMode(Phaser.BlendModes.ADD);

    // --- Hero ------------------------------------------------------------
    // The image lives inside a container so the breathing tween (on the image)
    // and the parallax offset (on the container) never fight over `y`.
    this.heroHolder = this.add.container(HERO_X, GAME_HEIGHT);

    this.parallax = [
      { obj: bg, depth: 0.014, baseX: bg.x, baseY: bg.y },
      { obj: this.seal, depth: 0.03, baseX: this.seal.x, baseY: this.seal.y },
      { obj: halo, depth: 0.02, baseX: halo.x, baseY: halo.y },
      { obj: this.heroHolder, depth: 0.045, baseX: this.heroHolder.x, baseY: this.heroHolder.y },
    ];

    // --- Title block ------------------------------------------------------
    const kicker = this.add
      .text(LEFT + 2, 92, '魏 · 蜀 · 吴 · 群雄逐鹿', bodyStyle(17, C.paperFaint))
      .setLetterSpacing(7);

    const title = this.add.text(LEFT, 118, '三國', brushStyle(108, C.paper)).setLetterSpacing(18);
    const subtitle = this.add
      .text(LEFT + 6, 252, '烽 火 尖 塔', brushStyle(44, C.gold))
      .setLetterSpacing(6);

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.5);
    rule.lineBetween(LEFT, 306, LEFT + 430, 306);
    rule.fillStyle(C.cinnabar, 0.9);
    rule.fillCircle(LEFT, 306, 3);

    for (const [i, obj] of [kicker, title, subtitle, rule].entries()) {
      obj.setAlpha(0);
      this.tweens.add({ targets: obj, alpha: 1, duration: 600, delay: 180 + i * 130 });
    }

    // --- Hero card --------------------------------------------------------
    this.panel = this.add.container(PANEL.x, PANEL.y).setAlpha(0);
    this.tweens.add({ targets: this.panel, alpha: 1, duration: 700, delay: 620 });

    this.buildTiles();
    this.showHero(this.picked, false);

    // --- Actions ----------------------------------------------------------
    const start = inkButton(this, LEFT + 118, 658, '出 征', {
      width: 236,
      height: 66,
      fontSize: 32,
      onClick: () => this.beginRun(),
    });
    start.setAlpha(0);
    this.tweens.add({ targets: start, alpha: 1, duration: 600, delay: 860 });

    const deck = inkButton(this, LEFT + 358, 658, '初 始 牌 组', {
      width: 190,
      height: 52,
      fontSize: 20,
      accent: C.jade,
      onClick: () => this.showDeck(),
    });
    deck.setAlpha(0);
    this.tweens.add({ targets: deck, alpha: 1, duration: 600, delay: 980 });

    this.add.text(16, GAME_HEIGHT - 26, 'v0.1 原型 · 三将逐鹿', bodyStyle(12, 0x554d40));

    this.input.keyboard?.on('keydown-ENTER', () => this.beginRun());
    this.input.keyboard?.on('keydown-UP', () => this.step(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.step(1));
    this.input.keyboard?.on('keydown-LEFT', () => this.step(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.step(1));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.applyParallax(p));
  }

  // ------------------------------------------------------------------ 选将

  private buildTiles(): void {
    for (const [i, hero] of HEROES_IN_ORDER.entries()) {
      const y = TILE.y + i * (TILE.h + TILE.gap);
      const tile = this.add.container(TILE.x, y).setAlpha(0);

      const bg = this.add.graphics();
      const glyph = this.add
        .text(0, -14, hero.seal, brushStyle(44, C.paperDim))
        .setOrigin(0.5);
      const name = this.add.text(0, 30, hero.name, bodyStyle(15, C.paperDim)).setOrigin(0.5);

      const paint = (state: 'idle' | 'hover' | 'picked'): void => {
        const border = state === 'picked' ? C.cinnabar : state === 'hover' ? C.goldBright : C.gold;
        bg.clear();
        bg.fillStyle(C.inkDeep, state === 'idle' ? 0.72 : 0.9);
        bg.fillRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
        bg.lineStyle(state === 'picked' ? 2 : 1, border, state === 'idle' ? 0.55 : 1);
        bg.strokeRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
        glyph.setColor(css(state === 'idle' ? C.paperDim : C.paper));
        name.setColor(css(state === 'picked' ? C.goldBright : C.paperDim));
      };

      const hit = this.add.zone(0, 0, TILE.w, TILE.h).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => paint(hero === this.picked ? 'picked' : 'hover'));
      hit.on('pointerout', () => paint(hero === this.picked ? 'picked' : 'idle'));
      hit.on('pointerup', () => this.pick(hero));

      tile.add([bg, glyph, name, hit]);
      this.tweens.add({ targets: tile, alpha: 1, duration: 500, delay: 700 + i * 90 });
      this.tiles.push({ hero, paint });
    }
  }

  private step(delta: number): void {
    if (this.leaving || isCardGridOpen(this)) return;
    const at = HEROES_IN_ORDER.indexOf(this.picked);
    const next = (at + delta + HEROES_IN_ORDER.length) % HEROES_IN_ORDER.length;
    this.pick(HEROES_IN_ORDER[next]);
  }

  private pick(hero: HeroDef): void {
    if (this.leaving || hero === this.picked) return;
    this.picked = hero;
    this.showHero(hero, true);
  }

  /** Repaints everything that depends on which hero is selected. */
  private showHero(hero: HeroDef, animate: boolean): void {
    for (const tile of this.tiles) tile.paint(tile.hero === hero ? 'picked' : 'idle');

    this.seal.setText(hero.seal);
    this.ensureHeroArt(hero);

    this.heroImg?.destroy();
    this.heroImg = this.add.image(0, 20, hero.fullKey).setOrigin(0.5, 1);
    this.heroImg.setScale(778 / this.heroImg.height);
    this.heroImg.setAlpha(0);
    this.heroHolder.add(this.heroImg);

    const target = this.heroImg;
    this.tweens.add({
      targets: target,
      alpha: 1,
      y: 4,
      duration: animate ? 420 : 900,
      ease: 'Cubic.easeOut',
    });
    this.tweens.add({
      targets: target,
      y: -6,
      duration: 3600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: animate ? 420 : 900,
    });

    this.paintPanel(hero);
  }

  private paintPanel(hero: HeroDef): void {
    const p = this.panel;
    p.removeAll(true);
    p.add(inkPanel(this, 0, 0, PANEL.w, PANEL.h, { alpha: 0.72 }));

    p.add(this.add.text(22, 16, hero.name, brushStyle(40, C.paper)).setLetterSpacing(4));
    p.add(this.add.text(22 + hero.name.length * 44, 30, hero.title, bodyStyle(17, C.paperDim)).setLetterSpacing(3));

    const badge = this.add.graphics();
    badge.fillStyle(C.jade, 0.85);
    badge.fillRoundedRect(384, 16, 36, 36, 3);
    badge.lineStyle(1, C.goldBright, 0.7);
    badge.strokeRoundedRect(384, 16, 36, 36, 3);
    p.add(badge);
    p.add(this.add.text(402, 34, hero.faction, brushStyle(24, C.paper)).setOrigin(0.5));

    p.add(this.add.text(24, 76, `体力 ${hero.maxHp}`, bodyStyle(18, C.cinnabarBright)));
    p.add(this.add.text(140, 76, `资财 ${hero.startingGold}`, bodyStyle(18, C.gold)));
    p.add(this.add.text(256, 78, `牌 ${hero.startingDeck.length} 张`, bodyStyle(16, C.paperDim)));

    p.add(this.add.text(24, 108, `【起手宝物 · ${hero.passive.name}】`, bodyStyle(16, C.goldBright)));
    p.add(
      this.add.text(24, 132, hero.passive.desc, {
        ...bodyStyle(13, C.paperDim),
        wordWrap: { width: 396 },
        lineSpacing: 5,
      }),
    );

    // A lit jade: `C.jade` itself is a fill colour and reads as mud on ink.
    p.add(this.add.text(24, 178, `【路数 · ${hero.mechanic.name}】`, bodyStyle(16, 0x7fbfa8)));
    p.add(
      this.add.text(24, 202, hero.mechanic.desc, {
        ...bodyStyle(13, C.paperDim),
        wordWrap: { width: 396 },
        lineSpacing: 5,
      }),
    );

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.3);
    rule.lineBetween(24, 250, PANEL.w - 24, 250);
    p.add(rule);

    p.add(
      this.add.text(24, 258, hero.blurb, {
        ...bodyStyle(12, C.paperFaint),
        wordWrap: { width: 396 },
        lineSpacing: 4,
      }),
    );
  }

  /** The 07 deck viewer, pointed at a deck that does not exist yet. */
  private showDeck(): void {
    if (this.leaving || isCardGridOpen(this)) return;
    const hero = this.picked;
    openCardGrid(this, {
      title: `${hero.name} · 初始牌组`,
      subtitle: `共 ${hero.startingDeck.length} 张　·　${hero.mechanic.name}`,
      entries: hero.startingDeck.map((defId, i) => ({ uid: `${hero.id}-${i}`, defId, upgraded: 0 })),
      mode: 'view',
      onClose: () => undefined,
    });
  }

  // ------------------------------------------------------------- 立绘占位

  /**
   * Heroes shipped ahead of their paintings. `BootScene` only makes a
   * placeholder for a file it *tried* to load, so a hero with no asset at all
   * would render Phaser's missing-texture checkerboard in three scenes —
   * here, the 地图 drawer and the fight. One plate drawn once, under the exact
   * keys `HeroDef` names, fixes all three: the title runs before any of them.
   *
   * Drawn at `RENDER_SCALE` and scaled back down by the callers (all of which
   * size by `height`), so the stand-in is as sharp as the real art would be.
   */
  private ensureHeroArt(hero: HeroDef): void {
    this.paintPlate(hero.fullKey, 400, 760, hero.seal, 260, true);
    this.paintPlate(hero.portraitKey, 240, 240, hero.seal, 150, false);
  }

  private paintPlate(
    key: string,
    w: number,
    h: number,
    glyph: string,
    size: number,
    caption: boolean,
  ): void {
    if (this.textures.exists(key)) return;
    // Integer supersample: a fractional one leaves the glyph edges soft on the
    // very displays the scale factor exists for.
    const s = Math.max(1, Math.ceil(RENDER_SCALE));
    const canvas = this.textures.createCanvas(key, Math.round(w * s), Math.round(h * s));
    if (!canvas) return;

    const ctx = canvas.getContext();
    ctx.save();
    ctx.scale(s, s);

    // A hanging scroll: inset from the plate so `measureSprite` finds real
    // content bounds and the callers ground it like any other cut-out.
    const inset = Math.round(w * 0.1);
    const top = Math.round(h * 0.06);
    const bw = w - inset * 2;
    const bh = h - top * 2;

    ctx.fillStyle = css(C.ink);
    ctx.globalAlpha = 0.92;
    ctx.fillRect(inset, top, bw, bh);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = css(C.gold);
    ctx.lineWidth = 2;
    ctx.strokeRect(inset + 1, top + 1, bw - 2, bh - 2);
    ctx.strokeStyle = css(C.cinnabar);
    ctx.lineWidth = 1;
    ctx.strokeRect(inset + 9, top + 9, bw - 18, bh - 18);

    ctx.fillStyle = css(C.paperDim);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${size}px ${FONT_BRUSH}`;
    ctx.fillText(glyph, w / 2, h / 2);

    if (caption) {
      ctx.fillStyle = css(C.paperFaint);
      ctx.font = `20px ${FONT_BRUSH}`;
      ctx.fillText('立绘未至', w / 2, h - top - 40);
    }

    ctx.restore();
    canvas.refresh();
  }

  // ------------------------------------------------------------------ 其他

  private applyParallax(pointer: Phaser.Input.Pointer): void {
    // Pointer positions arrive in canvas pixels; layout here is design units.
    const dx = toDesign(pointer.x) - GAME_WIDTH / 2;
    const dy = toDesign(pointer.y) - GAME_HEIGHT / 2;
    for (const layer of this.parallax) {
      layer.obj.x = layer.baseX - dx * layer.depth;
      layer.obj.y = layer.baseY - dy * layer.depth * 0.6;
    }
  }

  private beginRun(): void {
    if (this.leaving) return;
    if (isCardGridOpen(this)) return;
    this.leaving = true;
    startRun(this.picked);
    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      // 拜别 comes before the map, not after it: the blessing rolls off the run
      // seed and can rewrite the deck, the purse and 体力上限, so it has to land
      // before the first node is ever committed to. `BlessingScene` starts
      // 「Map」 itself once the four-up is answered.
      this.scene.start('Blessing');
    });
  }
}
