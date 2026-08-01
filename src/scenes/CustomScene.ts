import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { ASCENSION_STEP_DESC, MAX_ASCENSION, ascensionLabel } from '../data/ascension';
import { DEFAULT_HERO, HEROES_IN_ORDER, type HeroDef } from '../data/heroes';
import { startCustomRun, normaliseSeed, type CustomRunConfig } from '../state/customRun';
import { markRunStart } from '../state/history';
import { isUnlocked } from '../state/unlocks';
import { useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';

/**
 * 自定义模式 (todos/23 u5) — 种子输入 + 天命选择 + modifier 开关的备战屏。
 * 标题页的入口由 u6 接线（典籍 `CompendiumScene` 同款约定），这里只认
 * `scene.start('Custom')`，Esc / 「返 回」回标题。
 *
 * 规则一行没有：种子怎么裁、modifier 改什么组，全在 `startCustomRun`
 * （`src/state/customRun.ts`，纯函数，测试钉住）；本场景只收集三样输入。
 * 天命在这里**任选** 0–10：不计分的局推不动 19 的 `cleared`，也就没有
 * 「通关才放行下一重」的门要守。
 *
 * 种子输入不是 DOM 而是键盘直录：Phaser 没有文本框，`keydown` 收
 * 字母/数字/连字符，Backspace 删——种子本来就是 `randomSeed()` 那一小撮
 * 字符集，全键盘 IME 输入犯不上为它引入一层 DOM 覆盖。
 */

const LEFT = 64;

/** 选将条：标题页同款瓦片，横排。 */
const TILE = { x: LEFT + 48, y: 208, w: 96, h: 104, gap: 18 };

/** 种子录入板。 */
const SEED = { x: LEFT, y: 330, w: 520, h: 128 };

/** modifier 开关板。 */
const MODS = { x: 700, y: 330, w: 516, h: 128 };

/** 天命选择器（标题页 ASC 的横向同款）。 */
const ASC = { x: 958, y: 176, w: 420 };

/** 玩家能敲进种子里的字符——`randomSeed()` 的字符集加上连字符和下划线。 */
const SEED_CHAR = /^[A-Za-z0-9_-]$/;
const SEED_MAX = 24;

export class CustomScene extends Phaser.Scene {
  /** 同 TitleScene：全部在 `create` 里归位，场景实例跨访问复用。 */
  private leaving = false;
  private picked!: HeroDef;
  private seed = '';
  private ascension = 0;
  private startWithAllCards = false;
  private allCurses = false;

  private tiles: { hero: HeroDef; locked: boolean; paint: (picked: boolean) => void }[] = [];
  private seedText!: Phaser.GameObjects.Text;
  private cursor!: Phaser.GameObjects.Text;
  private ascPanel!: Phaser.GameObjects.Container;
  private modsPanel!: Phaser.GameObjects.Container;

  constructor() {
    super('Custom');
  }

  create(): void {
    useDesignSpace(this);
    this.leaving = false;
    this.picked = DEFAULT_HERO;
    this.seed = '';
    this.ascension = 0;
    this.startWithAllCards = false;
    this.allCurses = false;
    this.tiles = [];

    // --- 底色与题眉，与典籍同一套水墨 --------------------------------------
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'map-bg');
    bg.setScale(Math.max((GAME_WIDTH * 1.1) / bg.width, (GAME_HEIGHT * 1.1) / bg.height));
    bg.setAlpha(0.55);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.72);

    this.add.text(LEFT, 28, '自 定 义', brushStyle(54, C.paper)).setLetterSpacing(10);
    this.add
      .text(LEFT + 300, 62, '演武而非征战：不计分、不解锁、不入战史。', bodyStyle(14, C.paperFaint))
      .setLetterSpacing(3);

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.5);
    rule.lineBetween(LEFT, 100, GAME_WIDTH - LEFT, 100);
    rule.fillStyle(C.cinnabar, 0.9);
    rule.fillCircle(LEFT, 100, 3);

    inkButton(this, GAME_WIDTH - 132, 56, '返 回', {
      width: 136,
      height: 48,
      fontSize: 20,
      onClick: () => this.leave(),
    });

    // --- 三栏：选将 / 种子 / 天命与开关 ------------------------------------
    this.add.text(LEFT, 132, '选 将', brushStyle(26, C.gold)).setLetterSpacing(4);
    this.buildTiles();

    this.add.text(ASC.x - 220, 132, '天 命', brushStyle(26, C.gold)).setLetterSpacing(4);
    this.ascPanel = this.add.container(0, 0);
    this.paintAscension();

    this.buildSeedBox();

    this.modsPanel = this.add.container(0, 0);
    this.paintModifiers();

    // --- 出征 ---------------------------------------------------------------
    inkButton(this, GAME_WIDTH / 2, 620, '出 征', {
      width: 236,
      height: 66,
      fontSize: 32,
      accent: C.cinnabar,
      onClick: () => this.beginRun(),
    });
    this.add
      .text(GAME_WIDTH / 2, 672, '自定义 · 不计分 — 此局不入战史、解锁与天命进度', bodyStyle(13, C.gold))
      .setOrigin(0.5)
      .setLetterSpacing(2);

    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  // ------------------------------------------------------------------ 选将

  /** 标题页瓦片的横排版；未解锁的压暗且不可点——自定义局也不发新将。 */
  private buildTiles(): void {
    for (const [i, hero] of HEROES_IN_ORDER.entries()) {
      const x = TILE.x + i * (TILE.w + TILE.gap);
      const tile = this.add.container(x, TILE.y);
      const locked = !isUnlocked('hero', hero.id);

      const bg = this.add.graphics();
      const glyph = this.add.text(0, -14, hero.seal, brushStyle(44, C.paperDim)).setOrigin(0.5);
      const name = this.add
        .text(0, 30, locked ? '未解锁' : hero.name, bodyStyle(15, C.paperDim))
        .setOrigin(0.5);

      const paint = (picked: boolean): void => {
        bg.clear();
        bg.fillStyle(C.inkDeep, locked ? 0.5 : picked ? 0.9 : 0.72);
        bg.fillRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
        bg.lineStyle(picked ? 2 : 1, picked ? C.cinnabar : C.gold, locked ? 0.25 : picked ? 1 : 0.55);
        bg.strokeRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
        glyph.setColor(css(locked ? 0x554d40 : picked ? C.paper : C.paperDim));
        name.setColor(css(locked ? 0x554d40 : picked ? C.goldBright : C.paperDim));
      };
      paint(hero === this.picked);

      if (!locked) {
        const hit = this.add.zone(0, 0, TILE.w, TILE.h).setInteractive({ useHandCursor: true });
        hit.on('pointerup', () => {
          if (this.leaving || hero === this.picked) return;
          this.picked = hero;
          for (const t of this.tiles) t.paint(t.hero === this.picked);
        });
        tile.add(hit);
      }

      tile.add([bg, glyph, name]);
      tile.sendToBack(bg);
      this.tiles.push({ hero, locked, paint });
    }
  }

  // ------------------------------------------------------------------ 种子

  private buildSeedBox(): void {
    inkPanel(this, SEED.x, SEED.y, SEED.w, SEED.h, { alpha: 0.82 });
    this.add.text(SEED.x + 22, SEED.y + 14, '种 子', brushStyle(24, C.paper)).setLetterSpacing(4);
    this.add
      .text(SEED.x + SEED.w - 22, SEED.y + 28, '留空则随机', bodyStyle(12, C.paperFaint))
      .setOrigin(1, 0.5);

    // 录入槽：一条下划线，种子字符落在上面，末端一枚呼吸的光标。
    const line = this.add.graphics();
    line.lineStyle(1, C.gold, 0.5);
    line.lineBetween(SEED.x + 24, SEED.y + 86, SEED.x + SEED.w - 24, SEED.y + 86);

    this.seedText = this.add.text(SEED.x + 26, SEED.y + 78, '', bodyStyle(18, C.goldBright)).setOrigin(0, 1);
    this.cursor = this.add.text(SEED.x + 26, SEED.y + 78, '▏', bodyStyle(18, C.gold)).setOrigin(0, 1);
    this.tweens.add({ targets: this.cursor, alpha: 0.15, duration: 520, yoyo: true, repeat: -1 });

    this.add
      .text(SEED.x + 22, SEED.y + SEED.h - 22, '键盘直接输入 · 字母 / 数字 / 连字符 · 同种子同一局', bodyStyle(11, C.paperFaint))
      .setOrigin(0, 0.5);
    this.paintSeed();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.leaving) return;
    if (e.key === 'Backspace') {
      this.seed = this.seed.slice(0, -1);
      this.paintSeed();
    } else if (SEED_CHAR.test(e.key) && this.seed.length < SEED_MAX) {
      this.seed += e.key;
      this.paintSeed();
    }
  }

  private paintSeed(): void {
    this.seedText.setText(this.seed);
    this.cursor.setX(SEED.x + 26 + this.seedText.width + 2);
  }

  // ------------------------------------------------------------------ 天命

  /**
   * 标题页 `paintAscension` 的同款箭头，上限却是 `MAX_ASCENSION` 本身：
   * 不计分的局没有「通关才放行」的门可守——原版 Custom Mode 的取舍照抄。
   */
  private paintAscension(): void {
    const p = this.ascPanel;
    p.removeAll(true);

    const lv = this.ascension;
    p.add(
      this.add
        .text(ASC.x, 176, lv > 0 ? ascensionLabel(lv) : '无天命', brushStyle(24, lv > 0 ? C.gold : C.paperDim))
        .setOrigin(0.5),
    );

    const arrow = (delta: -1 | 1): void => {
      const usable = delta < 0 ? lv > 0 : lv < MAX_ASCENSION;
      const glyph = this.add
        .text(ASC.x + delta * 88, 176, delta < 0 ? '◀' : '▶', bodyStyle(16, usable ? C.gold : 0x554d40))
        .setOrigin(0.5);
      p.add(glyph);
      if (!usable) return;
      glyph.setInteractive({ useHandCursor: true });
      glyph.on('pointerover', () => glyph.setColor(css(C.goldBright)));
      glyph.on('pointerout', () => glyph.setColor(css(C.gold)));
      glyph.on('pointerup', () => {
        if (this.leaving) return;
        this.ascension = lv + delta;
        this.paintAscension();
      });
    };
    arrow(-1);
    arrow(1);

    p.add(
      this.add
        .text(ASC.x, 210, lv > 0 ? `本重新增 · ${ASCENSION_STEP_DESC[lv]}` : '任选 0–10 重，不受通关进度限制', {
          ...bodyStyle(11, lv > 0 ? C.goldBright : C.paperFaint),
          wordWrap: { width: ASC.w },
          align: 'center',
          lineSpacing: 3,
        })
        .setOrigin(0.5, 0),
    );
  }

  // ---------------------------------------------------------------- 开关

  /**
   * 两个 modifier，都是「开局改一次牌组」的轻开关——名单为什么只有两个、
   * `infiniteEnergy` / `noRelics` 为什么砍，见 `src/state/customRun.ts` 文件头。
   */
  private paintModifiers(): void {
    const p = this.modsPanel;
    p.removeAll(true);
    p.add(inkPanel(this, MODS.x, MODS.y, MODS.w, MODS.h, { alpha: 0.82 }));
    p.add(this.add.text(MODS.x + 22, MODS.y + 14, '战 局 变 数', brushStyle(24, C.paper)).setLetterSpacing(4));

    const rows: { label: string; desc: string; on: boolean; flip: () => void }[] = [
      {
        label: '十全武库',
        desc: '开局获得本将全部牌与无色牌各一张',
        on: this.startWithAllCards,
        flip: () => (this.startWithAllCards = !this.startWithAllCards),
      },
      {
        label: '业障缠身',
        desc: '开局背负全部六种诅咒',
        on: this.allCurses,
        flip: () => (this.allCurses = !this.allCurses),
      },
    ];

    for (const [i, row] of rows.entries()) {
      const y = MODS.y + 58 + i * 32;
      const box = this.add.graphics();
      box.lineStyle(1, row.on ? C.goldBright : C.gold, row.on ? 1 : 0.5);
      box.strokeRoundedRect(MODS.x + 24, y - 9, 18, 18, 3);
      if (row.on) {
        box.fillStyle(C.gold, 0.9);
        box.fillRoundedRect(MODS.x + 28, y - 5, 10, 10, 2);
      }
      p.add(box);
      p.add(
        this.add
          .text(MODS.x + 54, y, row.label, bodyStyle(15, row.on ? C.goldBright : C.paperDim))
          .setOrigin(0, 0.5),
      );
      p.add(
        this.add.text(MODS.x + 140, y, row.desc, bodyStyle(12, C.paperFaint)).setOrigin(0, 0.5),
      );
      const hit = this.add
        .zone(MODS.x + 24, y - 9, MODS.w - 48, 26)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => {
        if (this.leaving) return;
        row.flip();
        this.paintModifiers();
      });
      p.add(hit);
    }
  }

  // ---------------------------------------------------------------- 出入口

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(320, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Title');
    });
  }

  /** 标题页 `beginRun` 的同一条路——`startCustomRun` 替 `startRun`，其余照旧。 */
  private beginRun(): void {
    if (this.leaving) return;
    this.leaving = true;
    const config: CustomRunConfig = {
      seed: normaliseSeed(this.seed),
      ascension: this.ascension,
      modifiers: { startWithAllCards: this.startWithAllCards, allCurses: this.allCurses },
    };
    startCustomRun(this.picked, config);
    // 起表 (todos/22 s4)：自定义局不入史，但结算界面照样要报「本局用时」。
    markRunStart(this.game.getTime());
    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      // 拜别照走：祝福从本局种子上掷，是「同种子同一局」的一部分。
      this.scene.start('Blessing');
    });
  }
}
