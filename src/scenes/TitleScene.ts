import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { DEFAULT_HERO } from '../data/heroes';
import { startRun } from '../state/run';
import { toDesign, useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';

/** Cover-fit an image into a box without distorting it. */
function cover(img: Phaser.GameObjects.Image, w: number, h: number): void {
  const scale = Math.max(w / img.width, h / img.height);
  img.setScale(scale);
}

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

  constructor() {
    super('Title');
  }

  create(): void {
    useDesignSpace(this);
    this.leaving = false;
    const hero = DEFAULT_HERO;

    // --- Backdrop ---------------------------------------------------------
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'map-bg');
    cover(bg, GAME_WIDTH * 1.1, GAME_HEIGHT * 1.1);
    bg.setAlpha(0.7);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.56);

    // Large watermark character behind the hero.
    const seal = this.add
      .text(905, 300, '關', brushStyle(420, C.cinnabar))
      .setOrigin(0.5)
      .setAlpha(0.1);

    // Warm backlight so the cut-out hero doesn't look pasted on.
    const halo = this.add
      .image(905, 430, 'glow')
      .setScale(3.6)
      .setTint(0xc98a3a)
      .setAlpha(0.22)
      .setBlendMode(Phaser.BlendModes.ADD);

    // --- Hero ------------------------------------------------------------
    // The image lives inside a container so the breathing tween (on the image)
    // and the parallax offset (on the container) never fight over `y`.
    const heroHolder = this.add.container(905, GAME_HEIGHT);
    const heroImg = this.add.image(0, 20, hero.fullKey).setOrigin(0.5, 1);
    heroImg.setScale(778 / heroImg.height);
    heroImg.setAlpha(0);
    heroHolder.add(heroImg);

    this.tweens.add({ targets: heroImg, alpha: 1, y: 4, duration: 900, ease: 'Cubic.easeOut' });
    this.tweens.add({
      targets: heroImg,
      y: -6,
      duration: 3600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: 900,
    });

    this.parallax = [
      { obj: bg, depth: 0.014, baseX: bg.x, baseY: bg.y },
      { obj: seal, depth: 0.03, baseX: seal.x, baseY: seal.y },
      { obj: halo, depth: 0.02, baseX: halo.x, baseY: halo.y },
      { obj: heroHolder, depth: 0.045, baseX: heroHolder.x, baseY: heroHolder.y },
    ];

    // --- Title block ------------------------------------------------------
    const left = 108;
    const kicker = this.add
      .text(left + 2, 92, '魏 · 蜀 · 吴 · 群雄逐鹿', bodyStyle(17, C.paperFaint))
      .setLetterSpacing(7);

    const title = this.add.text(left, 118, '三國', brushStyle(108, C.paper)).setLetterSpacing(18);
    const subtitle = this.add
      .text(left + 6, 252, '烽 火 尖 塔', brushStyle(44, C.gold))
      .setLetterSpacing(6);

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.5);
    rule.lineBetween(left, 322, left + 430, 322);
    rule.fillStyle(C.cinnabar, 0.9);
    rule.fillCircle(left, 322, 3);

    for (const [i, obj] of [kicker, title, subtitle, rule].entries()) {
      obj.setAlpha(0);
      this.tweens.add({ targets: obj, alpha: 1, duration: 600, delay: 180 + i * 130 });
    }

    // --- Hero card --------------------------------------------------------
    const card = this.add.container(left, 348).setAlpha(0);
    card.add(inkPanel(this, 0, 0, 442, 250, { alpha: 0.72 }));

    card.add(this.add.text(22, 20, hero.name, brushStyle(40, C.paper)).setLetterSpacing(4));
    card.add(this.add.text(132, 34, hero.title, bodyStyle(17, C.paperDim)).setLetterSpacing(3));

    const factionBadge = this.add.graphics();
    factionBadge.fillStyle(C.jade, 0.85);
    factionBadge.fillRoundedRect(384, 20, 36, 36, 3);
    factionBadge.lineStyle(1, C.goldBright, 0.7);
    factionBadge.strokeRoundedRect(384, 20, 36, 36, 3);
    card.add(factionBadge);
    card.add(this.add.text(402, 38, hero.faction, brushStyle(24, C.paper)).setOrigin(0.5));

    card.add(this.add.text(24, 82, `体力 ${hero.maxHp}`, bodyStyle(18, C.cinnabarBright)));
    card.add(this.add.text(140, 82, `资财 ${hero.startingGold}`, bodyStyle(18, C.gold)));

    card.add(this.add.text(24, 122, `【${hero.passive.name}】`, bodyStyle(18, C.goldBright)));
    card.add(
      this.add.text(24, 148, hero.passive.desc, {
        ...bodyStyle(15, C.paperDim),
        wordWrap: { width: 394 },
        lineSpacing: 5,
      }),
    );
    card.add(
      this.add.text(24, 196, hero.blurb, {
        ...bodyStyle(14, C.paperFaint),
        lineSpacing: 5,
      }),
    );

    this.tweens.add({ targets: card, alpha: 1, duration: 700, delay: 620 });

    // --- Actions ----------------------------------------------------------
    const start = inkButton(this, left + 118, 648, '出 征', {
      width: 236,
      height: 66,
      fontSize: 32,
      onClick: () => this.beginRun(),
    });
    start.setAlpha(0);
    this.tweens.add({ targets: start, alpha: 1, duration: 600, delay: 860 });

    const note = this.add
      .text(left + 262, 648, '更多武将\n开发中', bodyStyle(13, C.paperFaint))
      .setOrigin(0, 0.5)
      .setLineSpacing(4);
    note.setAlpha(0);
    this.tweens.add({ targets: note, alpha: 1, duration: 600, delay: 980 });

    this.add.text(16, GAME_HEIGHT - 26, 'v0.1 原型 · 地图与武将', bodyStyle(12, 0x554d40));

    this.input.keyboard?.on('keydown-ENTER', () => this.beginRun());
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.applyParallax(p));
  }

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
    this.leaving = true;
    startRun(DEFAULT_HERO);
    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Map');
    });
  }
}
