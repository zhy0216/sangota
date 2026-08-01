import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { markRunStart, runElapsed, settleRun, type ScoreLine } from '../state/history';
import { endRun, getRun, startRun, type RunState } from '../state/run';
import { clearSave } from '../state/save';
import { sortForDisplay } from '../ui/cardOrder';
import { CardView } from '../ui/CardView';
import { useDesignSpace } from '../ui/designSpace';
import { RelicBar } from '../ui/RelicBar';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';

/**
 * 史笔 (todos/22 s4) — 结算界面，做成战报的样子。跑团的三条终点都改道到这里：
 *
 * - 兵败：`CombatScene.showDefeat`，`killedBy` 是本场最后行动的敌人名；
 * - 凯旋：`InterludeScene`（`actExit === 'victory'`），`victory: true`；
 * - 奇遇致死：`RoomScene.goSummary`，`killedBy: 'event'`。
 *
 * 进场即入史：`settleRun` 算分（`computeScore`）、写 `RunRecord`、同步
 * `Career.totals`，并在落账前对着旧的 `highScore` 判「新纪录」。19 天命的
 * `cleared` 与 23 的解锁检查是 `settleRun` 里留好的接线点，这里不做。
 *
 * 画面从右往左读，战报的规矩：右缘竖排题字「功成」/「殁」，中央分数明细
 * 逐行淡入（每行 120ms 错开，最后总分放大弹出），左侧最终牌组（07 网格的
 * 缩小内嵌，升级过的牌由 `resolveCard` 带「·精」），右侧宝物架。
 *
 * 存档 (todos/08) 在三个入口处就已清掉——跑团在踏进这一屏之前就结束了，
 * 在这一屏上关掉标签页也绝不能回到「继续」。这里再清一次只是双保险。
 * `endRun` 则押到离场：画面自己还要读 run。
 */
export interface SummarySceneData {
  victory: boolean;
  /** 死因：本场最后行动的敌人名，或 'event'（奇遇致死）。victory 时为 null。 */
  killedBy?: string | null;
}

// ---------------------------------------------------------------- 版面尺寸

/** 左侧牌组卷轴。 */
const DECK = { x: 36, y: 64, w: 434, h: 560 } as const;
const DECK_COLS = 5;
/** 07 网格的缩小内嵌：CardView 原尺寸 144×200，半大正好五列一排。 */
const THUMB = 0.5;
const CELL_W = 82;
const CELL_H = 112;

/** 右侧宝物架。 */
const RELICS = { x: 990, y: 64, w: 254, h: 380 } as const;

/** 中央战报栏与右缘题字。 */
const MID_X = 716;
const TITLE_X = 924;
const LIST_W = 300;
const LIST_Y = 150;
const LIST_STEP = 26;
/** 逐行淡入的起拍与错拍 (todos/22 s4：每行 120ms)。 */
const LIST_DELAY = 480;
const LIST_STAGGER = 120;

/** 毫秒 → 「12:34」/「1:02:03」。史册里存毫秒，屏上给人读的是钟面。 */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export class SummaryScene extends Phaser.Scene {
  private victory = false;
  private killedBy: string | null = null;
  /** Same one-way gate as every other scene exit — see `TitleScene.leaving`. */
  private leaving = false;

  constructor() {
    super('Summary');
  }

  /** Per-visit reset. A class field would only ever run once — see 约定 in
   *  `tests/integrity.test.ts`, 「scene state does not survive」. */
  init(data: SummarySceneData): void {
    this.victory = data?.victory ?? false;
    this.killedBy = data?.killedBy ?? null;
    this.leaving = false;
  }

  create(): void {
    useDesignSpace(this);
    const run = getRun();
    clearSave();

    // 入史 (s4 + s7)：算分、记账、同步 Career.totals，全在踏进这一屏的一刻。
    // 「新纪录」要跟落账前的旧 highScore 比，先后由 settleRun 排好。时间走
    // 游戏时钟——约定 2 禁墙钟，见 `history.ts` 的「本局用时」一节。
    const now = this.game.getTime();
    const { record, newRecord } = settleRun(run, {
      victory: this.victory,
      killedBy: this.killedBy,
      endedAt: now,
      durationMs: runElapsed(now),
    });

    this.cameras.main.fadeIn(520, 8, 6, 4);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 1);
    // 主将的印章淡在史页底下——标题页的同一枚水印。
    this.add
      .text(MID_X, 352, run.hero.seal, brushStyle(340, C.cinnabar))
      .setOrigin(0.5)
      .setAlpha(0.05);

    this.buildVerdict(run);
    this.buildScore(record.scoreBreakdown, record.score, record.durationMs, newRecord);
    this.buildDeckPanel(run);
    this.buildRelicPanel(run);

    inkButton(this, MID_X - 118, 684, '重 开', {
      width: 200,
      height: 56,
      fontSize: 24,
      accent: C.cinnabar,
      onClick: () => this.restart(),
    });
    inkButton(this, MID_X + 118, 684, '回 标 题', {
      width: 200,
      height: 56,
      fontSize: 24,
      onClick: () => this.leave(),
    });
  }

  // ------------------------------------------------------------------ 题字

  /** 右缘竖排毛笔大字，加一行「第 N 层 · 殁于 华雄」的提要。 */
  private buildVerdict(run: RunState): void {
    const color = this.victory ? C.goldBright : C.cinnabar;
    const chars = [...(this.victory ? '功成' : '殁')];
    // 单字居中落在双字的重心上，免得「殁」孤零零吊在页眉。
    const top = chars.length > 1 ? 84 : 132;
    chars.forEach((ch, i) => {
      const glyph = this.add
        .text(TITLE_X, top + i * 104, ch, brushStyle(84, color))
        .setOrigin(0.5, 0)
        .setAlpha(0);
      this.tweens.add({ targets: glyph, alpha: 1, duration: 600, delay: 240 + i * 180 });
    });

    // 「殁于」写敌人名；奇遇致死没有敌人可指名，按 todos/22 记作奇遇本身。
    const floor = `第 ${run.stats.floorsClimbed} 层`;
    const line = this.victory
      ? `${floor}　·　天下大势，已定于此`
      : `${floor}　·　殁于${this.killedBy === 'event' ? '奇遇' : (this.killedBy ?? '乱军之中')}`;
    this.add.text(MID_X, 96, line, bodyStyle(19, C.paperDim)).setOrigin(0.5).setLetterSpacing(2);

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.35);
    rule.lineBetween(MID_X - 170, 122, MID_X + 170, 122);
    rule.fillStyle(C.cinnabar, 0.9);
    rule.fillCircle(MID_X - 170, 122, 2.5);
  }

  // ------------------------------------------------------------------ 分数

  /** 分数明细逐行淡入，总分放大弹出，底下缀本局用时与「新纪录」。 */
  private buildScore(
    breakdown: readonly ScoreLine[],
    total: number,
    durationMs: number,
    newRecord: boolean,
  ): void {
    const left = MID_X - LIST_W / 2;
    const right = MID_X + LIST_W / 2;

    breakdown.forEach((line, i) => {
      const y = LIST_Y + i * LIST_STEP;
      const label = this.add
        .text(left, y, line.label, bodyStyle(16, C.paperDim))
        .setOrigin(0, 0.5)
        .setLetterSpacing(2)
        .setAlpha(0);
      const value = this.add
        .text(right, y, String(line.value), bodyStyle(16, C.gold))
        .setOrigin(1, 0.5)
        .setAlpha(0);
      this.tweens.add({
        targets: [label, value],
        alpha: 1,
        duration: 280,
        delay: LIST_DELAY + i * LIST_STAGGER,
      });
    });

    // computeScore 只列得了分的行；一行都没有时给句话，别让战报开天窗。
    if (breakdown.length === 0) {
      const blank = this.add
        .text(MID_X, LIST_Y + 6, '寸功未录', bodyStyle(16, C.paperFaint))
        .setOrigin(0.5)
        .setLetterSpacing(4)
        .setAlpha(0);
      this.tweens.add({ targets: blank, alpha: 1, duration: 280, delay: LIST_DELAY });
    }

    const doneAt = LIST_DELAY + breakdown.length * LIST_STAGGER + 200;
    const totalY = Math.min(LIST_Y + breakdown.length * LIST_STEP + 54, 574);
    const totalText = this.add
      .text(MID_X, totalY, `总分　${total}`, brushStyle(42, C.goldBright))
      .setOrigin(0.5)
      .setLetterSpacing(4)
      .setAlpha(0)
      .setScale(0.5);
    this.tweens.add({
      targets: totalText,
      alpha: 1,
      scale: 1,
      duration: 340,
      ease: 'Back.easeOut',
      delay: doneAt,
    });

    if (newRecord) {
      // 斜盖一方朱印，从大处砸下来——盖章，不是弹窗。
      const seal = this.add.container(MID_X + 194, totalY - 8).setAngle(-10).setAlpha(0);
      const box = this.add.graphics();
      box.lineStyle(2, C.cinnabarBright, 0.95);
      box.strokeRoundedRect(-44, -20, 88, 40, 3);
      box.fillStyle(C.cinnabar, 0.16);
      box.fillRoundedRect(-44, -20, 88, 40, 3);
      seal.add(box);
      seal.add(
        this.add
          .text(0, 0, '新纪录', brushStyle(24, C.cinnabarBright))
          .setOrigin(0.5)
          .setLetterSpacing(3),
      );
      seal.setScale(1.8);
      this.tweens.add({
        targets: seal,
        alpha: 1,
        scale: 1,
        duration: 260,
        ease: 'Back.easeIn',
        delay: doneAt + 240,
      });
    }

    const info = this.add
      .text(MID_X, 640, `本局用时　${formatDuration(durationMs)}`, bodyStyle(14, C.paperFaint))
      .setOrigin(0.5)
      .setLetterSpacing(2)
      .setAlpha(0);
    this.tweens.add({ targets: info, alpha: 1, duration: 300, delay: doneAt + 120 });
  }

  // ------------------------------------------------------------------ 牌组

  /**
   * 最终牌组——07 牌堆查看器的网格缩小内嵌：同一套 `sortForDisplay` 排序、
   * 同一张 `CardView` 牌面（升级过的牌由 `resolveCard` 带上「·精」和金字）。
   * 只看不选，所以整块是死物，超高时才配一根滚条。
   */
  private buildDeckPanel(run: RunState): void {
    inkPanel(this, DECK.x, DECK.y, DECK.w, DECK.h, { alpha: 0.82 });
    this.add.text(DECK.x + 24, DECK.y + 14, '最终牌组', brushStyle(24, C.paper)).setLetterSpacing(4);
    this.add
      .text(DECK.x + DECK.w - 24, DECK.y + 30, `共 ${run.deck.length} 张`, bodyStyle(13, C.paperFaint))
      .setOrigin(1, 0.5);

    const viewTop = DECK.y + 58;
    const viewH = DECK.h - 58 - 18;
    const entries = sortForDisplay(
      run.deck.map((c) => ({ uid: c.uid, defId: c.defId, upgraded: c.upgraded })),
    );

    const content = this.add.container(0, viewTop);
    for (const [i, entry] of entries.entries()) {
      const view = new CardView(this, entry.uid, entry.defId, entry.upgraded, undefined, 'display');
      view.setPosition(
        DECK.x + 26 + CELL_W / 2 + (i % DECK_COLS) * CELL_W,
        14 + CELL_H / 2 + Math.floor(i / DECK_COLS) * CELL_H,
      );
      view.setScale(THUMB);
      // 结算页只看不选——留着手型光标只会骗一次点击。
      view.hitZone.disableInteractive();
      content.add(view);
    }

    // Geometry masks render through the camera — scroll-locked, same as 07.
    const maskShape = this.make.graphics({}, false).setScrollFactor(0);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(DECK.x + 6, viewTop - 4, DECK.w - 12, viewH + 8);
    content.setMask(maskShape.createGeometryMask());

    const contentH = Math.ceil(entries.length / DECK_COLS) * CELL_H + 24;
    const maxScroll = Math.max(0, contentH - viewH);
    if (maxScroll <= 0) return;

    let scroll = 0;
    const bar = this.add.graphics();
    const barX = DECK.x + DECK.w - 14;
    const paintScroll = (): void => {
      const thumbH = Math.max(36, (viewH / contentH) * viewH);
      bar.clear();
      bar.fillStyle(C.paper, 0.08);
      bar.fillRoundedRect(barX, viewTop, 5, viewH, 2);
      bar.fillStyle(C.gold, 0.65);
      bar.fillRoundedRect(barX, viewTop + (scroll / maxScroll) * (viewH - thumbH), 5, thumbH, 2);
    };
    paintScroll();

    // 屏上唯一会滚的东西，所以不做指针命中判定——滚轮到哪儿都翻牌组。
    // 场景关闭时 InputPlugin 自会把监听拆干净，无需手动 off。
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      scroll = Phaser.Math.Clamp(scroll + dy * 0.6, 0, maxScroll);
      content.y = viewTop - scroll;
      paintScroll();
    });
  }

  // ------------------------------------------------------------------ 宝物

  /** 右侧宝物架——复用 HUD 的 `RelicBar`，悬停自带名称与说明。 */
  private buildRelicPanel(run: RunState): void {
    inkPanel(this, RELICS.x, RELICS.y, RELICS.w, RELICS.h, { alpha: 0.82 });
    this.add.text(RELICS.x + 22, RELICS.y + 14, '宝物', brushStyle(24, C.paper)).setLetterSpacing(4);
    this.add
      .text(RELICS.x + RELICS.w - 22, RELICS.y + 30, `${run.relics.length} 件`, bodyStyle(13, C.paperFaint))
      .setOrigin(1, 0.5);

    if (run.relics.length === 0) {
      this.add
        .text(RELICS.x + RELICS.w / 2, RELICS.y + RELICS.h / 2, '两袖清风', bodyStyle(16, C.paperFaint))
        .setOrigin(0.5)
        .setLetterSpacing(4);
      return;
    }

    const relicBar = new RelicBar(this, {
      x: RELICS.x + 26,
      y: RELICS.y + 58,
      depth: 4,
      size: 34,
      perRow: 5,
      tooltipDepth: 60,
    });
    relicBar.setRelics(run.relics);
  }

  // ------------------------------------------------------------------ 出口

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.input.enabled = false;
    // 跑团到此为止，活跃的 run 在离场时才放手。`endRun` 而不是 `startRun`：
    // 后者会生成一张没人要的地图，白费第一幕整条随机流。
    endRun();
    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Title'),
    );
  }

  /**
   * 「重开」——同一员主将再出征，走标题页 `beginRun` 的同一条路
   * （`startRun` → 拜别），只是不绕回标题。主将要在 `endRun` 撒手前抓住。
   */
  private restart(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.input.enabled = false;
    const hero = getRun().hero;
    endRun();
    startRun(hero);
    markRunStart(this.game.getTime());
    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Blessing'),
    );
  }
}
