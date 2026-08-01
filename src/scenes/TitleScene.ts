import Phaser from 'phaser';
import { getAudio } from '../audio/sfx';
import { C, css, FONT_BRUSH, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';
import { ASCENSION_STEP_DESC, MAX_ASCENSION, ascensionLabel } from '../data/ascension';
import { DEFAULT_HERO, HEROES_IN_ORDER, type HeroDef } from '../data/heroes';
import { maxSelectableAscension } from '../state/ascension';
import { markRunStart } from '../state/history';
import { startRun } from '../state/run';
import {
  SAVE_VERSION,
  clearSave,
  fromSaved,
  readSlot,
  summarise,
  type SaveSlot,
} from '../state/save';
import { chooseUnlock, getUnlocks, isUnlocked } from '../state/unlocks';
import { isCardGridOpen, openCardGrid } from '../ui/CardGrid';
import { toDesign, useDesignSpace } from '../ui/designSpace';
import { openHistory } from '../ui/HistoryPanel';
import { pushOverlay } from '../ui/overlayStack';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';
import { heroLockReason, layoutTitleActions, type TitleActionId } from '../ui/titleView';

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

/** 天命选择器 (todos/19 a5)：挂在选将条正下方的一栏，难度随武将走。 */
const ASC = { x: 1196, y: 502, w: 156 };

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

  /**
   * 出征的天命重数 (todos/19 a5)。同 `picked` 一样在 `create` 里归零；换将时
   * 由 `paintAscension` 按新武将的上限收口——各武将各自的进度，级数不跨将。
   */
  private ascension = 0;
  private ascPanel!: Phaser.GameObjects.Container;

  private seal!: Phaser.GameObjects.Text;
  private heroHolder!: Phaser.GameObjects.Container;
  private heroImg!: Phaser.GameObjects.Image;
  private panel!: Phaser.GameObjects.Container;
  private tiles: {
    hero: HeroDef;
    locked: boolean;
    paint: (state: 'idle' | 'hover' | 'picked') => void;
  }[] = [];

  /**
   * 存档 (todos/08). Read once in `create` and repainted from, so the four
   * outcomes each get their own row of buttons — and so a save that turns out
   * to be unreadable at the moment it is opened can demote itself to 「损坏」
   * without the scene being rebuilt.
   */
  private slot: SaveSlot = { kind: 'empty' };
  private actions!: Phaser.GameObjects.Container;

  constructor() {
    super('Title');
  }

  create(): void {
    useDesignSpace(this);
    this.leaving = false;
    this.picked = DEFAULT_HERO;
    this.ascension = 0;
    this.tiles = [];

    // 音频 (todos/20 b4)：标题曲从这一刻起懒加载——音乐不进 boot，首屏
    // 不为它多等一帧；`ensureMusic` 已载/在途都空转，回到标题页重喊无害。
    // `music('title')` 在闸没开时只挂账，载好且解锁后自动补播。
    const audio = getAudio(this);
    audio.ensureMusic('title', this);
    audio.music('title');
    // 自动播放闸 (todo 步骤 4)：浏览器要求先有用户手势。挂一次性
    // pointerdown——`unlock` 幂等，从别的场景转回来重挂也只是空转。
    this.input.once('pointerdown', () => audio.unlock());

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

    // 天命选择器：容器先立好，`showHero` 每次换将都重画它。
    this.ascPanel = this.add.container(0, 0).setAlpha(0);
    this.tweens.add({ targets: this.ascPanel, alpha: 1, duration: 500, delay: 980 });

    this.showHero(this.picked, false);

    // --- Actions ----------------------------------------------------------
    this.slot = readSlot();
    this.actions = this.add.container(0, 0);
    this.buildActions();

    // Bottom-right, out of the way of the 存档 line the action row prints under
    // 「继续」 — the two used to share the bottom-left corner.
    this.add
      .text(GAME_WIDTH - 16, GAME_HEIGHT - 26, 'v0.1 原型 · 三将逐鹿', bodyStyle(12, 0x554d40))
      .setOrigin(1, 0);

    this.input.keyboard?.on('keydown-ENTER', () => this.onEnter());
    this.input.keyboard?.on('keydown-UP', () => this.step(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.step(1));
    this.input.keyboard?.on('keydown-LEFT', () => this.step(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.step(1));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.applyParallax(p));
  }

  // ------------------------------------------------------------------ 存档

  /**
   * The action row, which is four different rows depending on what is in the
   * slot. Rebuilt rather than toggled so that 「清除」 and a save that fails to
   * open can both repaint it without touching anything else on the screen.
   *
   * 「继续」 is the primary when there is a run to continue: it is the action the
   * player almost certainly came back for, and 「重新出征」 throws away 40 minutes
   * of play, so the sizes say which is which before the labels do.
   */
  private buildActions(): void {
    this.actions.removeAll(true);
    const resumable = this.slot.kind === 'ok';
    const pending = getUnlocks().pendingChoice;

    // 六入口 (todos/23 u6)：谁出场、摆在哪全由 `layoutTitleActions` 这只
    // 纯函数定（`titleView.ts`，测试钉住）；这里只按名册配标签、配色和
    // 点法。「新卷可阅」(u5) 仍是三选一挂账时才出现，金字压阵——它是
    // 上一局挣来的赏，不是又一个菜单项。
    const meta: Record<
      Exclude<TitleActionId, 'resume' | 'begin'>,
      { label: string; accent?: number; onClick: () => void }
    > = {
      again: { label: '重 新 出 征', accent: C.cinnabar, onClick: () => this.confirmDiscard() },
      wipe: { label: '清 除 存 档', accent: C.cinnabar, onClick: () => this.discardSave() },
      compendium: { label: '典 籍', accent: C.jade, onClick: () => this.openCompendium() },
      annals: { label: '战 史', onClick: () => this.showHistory() },
      custom: { label: '自 定 义', onClick: () => this.openCustom() },
      scroll: { label: '新 卷 可 阅', accent: C.goldBright, onClick: () => this.openUnlockChoice() },
    };

    for (const frame of layoutTitleActions(this.slot.kind, pending !== null)) {
      // 主位吃 Enter 的同一条路：有档续档，无档出征。
      const m =
        frame.id === 'resume' || frame.id === 'begin'
          ? {
              label: resumable ? '继 续 征 程' : '出 征',
              accent: undefined,
              onClick: () => (resumable ? this.continueRun() : this.beginRun()),
            }
          : meta[frame.id];
      const btn = inkButton(this, frame.x, frame.y, m.label, {
        width: frame.width,
        height: frame.height,
        fontSize: frame.fontSize,
        accent: m.accent,
        onClick: m.onClick,
      });
      this.actions.add(btn);
      this.fadeIn(btn, frame.delay);
    }

    if (this.slot.kind === 'ok') {
      const s = summarise(this.slot.saved);
      const line = this.add.text(
        LEFT,
        698,
        `${s.actLabel} · 第 ${s.floor} 层　·　${s.heroName}　·　体力 ${s.hp}/${s.maxHp}　·　资财 ${s.gold}　·　牌组 ${s.deckSize}${s.inCombat ? '　·　鏖战中' : ''}`,
        bodyStyle(13, C.paperFaint),
      );
      this.actions.add(line);
      this.fadeIn(line, 940);
    }

    if (this.slot.kind === 'stale' || this.slot.kind === 'broken') {
      // Neither loaded nor silently dropped (S4): the player is told, and the
      // only thing that removes it is a button they press themselves.
      const why =
        this.slot.kind === 'stale'
          ? `存档版本不符（v${this.slot.version} → v${SAVE_VERSION}），无法继续。`
          : '存档已损坏，无法继续。';
      const line = this.add.text(LEFT, 698, why, bodyStyle(13, C.cinnabarBright));
      this.actions.add(line);
      this.fadeIn(line, 940);
    }
  }

  /**
   * 三选一 (todos/23 u5)：三张牌横排选一——`CardGrid` 的 `pick` 模式原样就是
   * 这个界面。选中的立刻入册（`chooseUnlock`），其余两张按设计随下一批自动
   * 解锁（`applyRunUnlocks` 的「下一批」语义，见 `unlocks.ts`）。Esc 可退：
   * 卷还挂着，下次再阅。
   */
  private openUnlockChoice(): void {
    if (this.leaving || isCardGridOpen(this)) return;
    const pending = getUnlocks().pendingChoice;
    if (!pending) return;
    const hero = HEROES_IN_ORDER.find((h) => h.id === pending.heroId);
    openCardGrid(this, {
      title: '有 新 卷 可 阅',
      subtitle: `${hero?.name ?? pending.heroId}的新牌三择其一，先行入册`,
      entries: pending.options.map((defId) => ({ uid: defId, defId, upgraded: 0 })),
      mode: 'pick',
      pickCount: 1,
      confirmText: '先 阅 此 卷',
      footerHint: '择一先解锁　·　其余两张随下一卷放出　·　Esc 稍后再选',
      // uid 就是 defId——三张牌来自轨道数据,天然无重复。
      onPick: (uids) => {
        chooseUnlock(uids[0]);
        this.buildActions();
      },
      onClose: () => undefined,
    });
  }

  private fadeIn(obj: Phaser.GameObjects.Container | Phaser.GameObjects.Text, delay: number): void {
    obj.setAlpha(0);
    this.tweens.add({ targets: obj, alpha: 1, duration: 600, delay });
  }

  /** Enter takes the primary action, which is 「继续」 whenever there is one. */
  private onEnter(): void {
    if (this.slot.kind === 'ok') this.continueRun();
    else this.beginRun();
  }

  private continueRun(): void {
    if (this.leaving || isCardGridOpen(this)) return;
    if (this.slot.kind !== 'ok') return;
    const saved = this.slot.saved;

    try {
      fromSaved(saved);
    } catch {
      // S4: refused, never approximated. The payload parsed and carried the
      // right version but names something this build has not got — a hero, an
      // act, a map node. Demote to 「损坏」 and let the player clear it.
      this.slot = { kind: 'broken' };
      this.buildActions();
      return;
    }

    this.leaving = true;
    // 起表 (todos/22 s4)：续档也从这一刻起算——约定 2 禁墙钟，存档里没有
    // `savedAt`，「本局用时」只能记本次会话打了多久。
    markRunStart(this.game.getTime());
    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      // 拜别 is not on this path: a saved run has already been blessed, and
      // `run.blessing.takenId` came back with it. Straight to wherever the
      // player was standing — mid-fight included.
      if (saved.combat) this.scene.start('Combat', { resume: saved.combat });
      else this.scene.start('Map');
    });
  }

  /**
   * 「重新出征」 over a live save. One slot and one run in it, so starting a new
   * one destroys the old one — which is a thing to be asked about, once.
   */
  private confirmDiscard(): void {
    if (this.leaving || isCardGridOpen(this)) return;

    const layer = this.add.container(0, 0);
    const handle = pushOverlay(this, {
      id: 'discard-save',
      dismissable: true,
      onDismiss: () => {
        layer.destroy(true);
      },
    });
    layer.setDepth(handle.depth);

    const close = (): void => {
      handle.release();
      layer.destroy(true);
    };

    layer.add(
      this.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.86)
        .setInteractive(),
    );

    const W = 560;
    const H = 236;
    const box = this.add.container((GAME_WIDTH - W) / 2, (GAME_HEIGHT - H) / 2);
    box.add(inkPanel(this, 0, 0, W, H, { alpha: 0.96 }));
    box.add(
      this.add.text(W / 2, 34, '放 弃 当 前 征 程 ？', brushStyle(34, C.paper)).setOrigin(0.5),
    );

    const s = this.slot.kind === 'ok' ? summarise(this.slot.saved) : null;
    box.add(
      this.add
        .text(
          W / 2,
          92,
          s
            ? `${s.heroName} · ${s.actLabel}第 ${s.floor} 层 · 体力 ${s.hp}/${s.maxHp}`
            : '当前存档将被清除。',
          bodyStyle(17, C.gold),
        )
        .setOrigin(0.5),
    );
    box.add(
      this.add
        .text(W / 2, 124, '存档只有一格，新的一局会把它覆盖，且无法找回。', bodyStyle(13, C.paperFaint))
        .setOrigin(0.5),
    );

    box.add(
      inkButton(this, W / 2 - 108, 186, '仍 要 出 征', {
        width: 176,
        height: 52,
        fontSize: 22,
        accent: C.cinnabar,
        onClick: () => {
          close();
          this.discardSave();
          this.beginRun();
        },
      }),
    );
    box.add(
      inkButton(this, W / 2 + 108, 186, '再 想 想', {
        width: 176,
        height: 52,
        fontSize: 22,
        onClick: close,
      }),
    );

    layer.add(box);
  }

  private discardSave(): void {
    clearSave();
    this.slot = { kind: 'empty' };
    this.buildActions();
  }

  // ------------------------------------------------------------------ 选将

  private buildTiles(): void {
    for (const [i, hero] of HEROES_IN_ORDER.entries()) {
      const y = TILE.y + i * (TILE.h + TILE.gap);
      const tile = this.add.container(TILE.x, y).setAlpha(0);

      // 解锁门 (todos/23 u6)：`isUnlocked` 无存储时全放行，浏览器里按账收口。
      // `CustomScene` 的同款——锁着的压暗且不可点，这里再多印一行理由。
      const locked = !isUnlocked('hero', hero.id);

      const bg = this.add.graphics();
      const glyph = this.add
        .text(0, -14, hero.seal, brushStyle(44, C.paperDim))
        .setOrigin(0.5);
      const name = this.add.text(0, 30, hero.name, bodyStyle(15, C.paperDim)).setOrigin(0.5);

      const paint = (state: 'idle' | 'hover' | 'picked'): void => {
        if (locked) {
          // 门就长这样：怎么重画都是暗的，悬停也不亮。
          bg.clear();
          bg.fillStyle(C.inkDeep, 0.5);
          bg.fillRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
          bg.lineStyle(1, C.gold, 0.25);
          bg.strokeRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
          glyph.setColor(css(0x554d40));
          name.setColor(css(0x554d40));
          return;
        }
        const border = state === 'picked' ? C.cinnabar : state === 'hover' ? C.goldBright : C.gold;
        bg.clear();
        bg.fillStyle(C.inkDeep, state === 'idle' ? 0.72 : 0.9);
        bg.fillRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
        bg.lineStyle(state === 'picked' ? 2 : 1, border, state === 'idle' ? 0.55 : 1);
        bg.strokeRoundedRect(-TILE.w / 2, -TILE.h / 2, TILE.w, TILE.h, 4);
        glyph.setColor(css(state === 'idle' ? C.paperDim : C.paper));
        name.setColor(css(state === 'picked' ? C.goldBright : C.paperDim));
      };

      tile.add([bg, glyph, name]);

      if (locked) {
        // 理由 (u6)：`HERO_UNLOCKS` 的门槛译成人话，压在名字底下。
        const reason = heroLockReason(hero.id) ?? '未解锁';
        tile.add(this.add.text(0, 45, reason, bodyStyle(10, 0x554d40)).setOrigin(0.5));
      } else {
        const hit = this.add.zone(0, 0, TILE.w, TILE.h).setInteractive({ useHandCursor: true });
        hit.on('pointerover', () => paint(hero === this.picked ? 'picked' : 'hover'));
        hit.on('pointerout', () => paint(hero === this.picked ? 'picked' : 'idle'));
        hit.on('pointerup', () => this.pick(hero));
        tile.add(hit);
      }

      this.tweens.add({ targets: tile, alpha: 1, duration: 500, delay: 700 + i * 90 });
      this.tiles.push({ hero, locked, paint });
    }
  }

  private step(delta: number): void {
    if (this.leaving || isCardGridOpen(this)) return;
    const n = HEROES_IN_ORDER.length;
    const at = HEROES_IN_ORDER.indexOf(this.picked);
    // 键盘选将走同一道解锁门 (u6)：跳过锁着的，兜一圈没有可选的就不动。
    for (let hop = 1; hop <= n; hop++) {
      const idx = (((at + delta * hop) % n) + n) % n;
      if (!this.tiles[idx].locked) {
        this.pick(this.tiles[idx].hero);
        return;
      }
    }
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
    this.paintAscension();
  }

  // ------------------------------------------------------------------ 天命

  /**
   * 天命选择器 (todos/19 a5)。左右箭头调级，上限是该武将已通关的下一重
   * （`cleared[heroId] + 1`，封顶 `MAX_ASCENSION`）；零重印「无天命」。
   * 该级的新增修改高亮在上，全部累积修改列在下面——修改是累积的，选五重
   * 就是一到五重全部生效。
   */
  private paintAscension(): void {
    const p = this.ascPanel;
    p.removeAll(true);

    const cap = maxSelectableAscension(this.picked.id);
    // 换将时收口：级数不跨将，超出新武将上限就压回来。
    if (this.ascension > cap) this.ascension = cap;
    const lv = this.ascension;

    p.add(
      this.add
        .text(ASC.x, ASC.y, '天 命', bodyStyle(13, C.paperFaint))
        .setOrigin(0.5)
        .setLetterSpacing(3),
    );
    p.add(
      this.add
        .text(
          ASC.x,
          ASC.y + 32,
          lv > 0 ? ascensionLabel(lv) : '无天命',
          brushStyle(22, lv > 0 ? C.gold : C.paperDim),
        )
        .setOrigin(0.5),
    );

    // 出界的一侧压暗且不可点——只能选到 cleared + 1，这就是那道门。
    const arrow = (delta: -1 | 1): void => {
      const usable = delta < 0 ? lv > 0 : lv < cap;
      const glyph = this.add
        .text(ASC.x + delta * 64, ASC.y + 32, delta < 0 ? '◀' : '▶', bodyStyle(15, usable ? C.gold : 0x554d40))
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

    if (lv === 0) {
      p.add(
        this.add
          .text(ASC.x, ASC.y + 58, '不附加难度修改', bodyStyle(11, C.paperFaint))
          .setOrigin(0.5, 0),
      );
      return;
    }

    // 本重新增，高亮成金。
    const fresh = this.add
      .text(ASC.x, ASC.y + 58, `本重新增 · ${ASCENSION_STEP_DESC[lv]}`, {
        ...bodyStyle(11, C.goldBright),
        wordWrap: { width: ASC.w },
        align: 'center',
        lineSpacing: 3,
      })
      .setOrigin(0.5, 0);
    p.add(fresh);

    // 全部累积修改：一到本重逐条连排，压暗——名单，不是重点。
    const all = Array.from({ length: lv }, (_, i) => ASCENSION_STEP_DESC[i + 1]).join('　');
    const list = this.add.text(ASC.x - ASC.w / 2, ASC.y + 58 + fresh.height + 10, all, {
      ...bodyStyle(10, C.paperDim),
      wordWrap: { width: ASC.w },
      lineSpacing: 2,
    });
    p.add(list);

    if (lv === cap && cap < MAX_ASCENSION) {
      p.add(
        this.add
          .text(ASC.x, list.y + list.height + 10, '通关本重，解锁下一重', bodyStyle(10, 0x554d40))
          .setOrigin(0.5, 0),
      );
    }
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

  /** 战史 (todos/22 s8)：最近 50 局的册页，点一行看全录。 */
  private showHistory(): void {
    if (this.leaving || isCardGridOpen(this)) return;
    openHistory(this);
  }

  /** 典籍 (todos/23 u6)：图鉴的入口。u4 的约定——只认 `scene.start('Compendium')`。 */
  private openCompendium(): void {
    if (this.leaving || isCardGridOpen(this)) return;
    this.scene.start('Compendium');
  }

  /** 自定义 (todos/23 u6)：备战屏的入口。u5 的约定——只认 `scene.start('Custom')`。 */
  private openCustom(): void {
    if (this.leaving || isCardGridOpen(this)) return;
    this.scene.start('Custom');
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
    startRun(this.picked, undefined, this.ascension);
    // 起表 (todos/22 s4)：结算的「本局用时」从这一刻读游戏时钟起算。
    markRunStart(this.game.getTime());
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
