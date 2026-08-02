import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { getRelic } from '../combat/relics';
import { getCareer, type RunRecord } from '../state/history';
import { CardView, openCardPreview } from './CardView';
import { sortForDisplay } from './cardOrder';
import { pinToCamera, toDesign } from './designSpace';
import { actName, annalsSubtitle, historyRow, routeLines } from './historyView';
import { overlayDepth, pushOverlay } from './overlayStack';
import { bodyStyle, brushStyle, inkPanel } from './theme';

/**
 * 战史 (todos/22 s8) — 标题页的册页覆盖层，两层楼：
 *
 * - **册页**：最近 50 局（`getCareer().records`）一局一行，六列
 *   （武将/天命/层数/分数/用时/战果），点一行翻开详录；
 * - **详录**：一条 `RunRecord` 的全部——牌组（07 网格的缩小内嵌）、宝物、
 *   按幕分行的路线——摞在册页**上面**的第二个覆盖层，Esc 只合上一层。
 *
 * 骨架照抄 07 `CardGrid`：`pushOverlay` 管 Esc 与深度，几何蒙版管滚动，
 * 点空白处关闭是对面板的几何判定。挡下层输入用的却是 `confirmDiscard` 的
 * 那块可点蒙布——标题页没有会滚的镜头，`topOnly` 一盖就够，不必冻结全场。
 * 唯一的新问题是**两层楼共用一部滚轮**：scene-level 的 `wheel`/`pointerdown`
 * 不看指针下面是谁，所以每个监听先问 `overlayDepth` 自己还在不在顶楼。
 *
 * 全程只读：这里翻的是 `history.ts` 落好的账，一个字也不写回去。
 */

// ------------------------------------------------------------------- 册页

const LIST_W = 780;
const LIST_X = Math.round((GAME_WIDTH - LIST_W) / 2);
/** 题字 + 副题 + 列名，比 07 的头厚一行。 */
const HEAD_H = 118;
const FOOT_H = 56;
const ROW_H = 34;
const MAX_VIEW_H = GAME_HEIGHT - 64 - HEAD_H - FOOT_H;

/** 列位：面板内的 x 偏移。表头与行共用同一张表，才对得齐。 */
const COL = { hero: 44, ascension: 148, floor: 250, score: 356, duration: 452, fate: 548 } as const;
const COL_LABEL: { key: keyof typeof COL; text: string }[] = [
  { key: 'hero', text: '武将' },
  { key: 'ascension', text: '天命' },
  { key: 'floor', text: '层数' },
  { key: 'score', text: '分数' },
  { key: 'duration', text: '用时' },
  { key: 'fate', text: '战果' },
];

/** 右上角的 ×——CardGrid 的同款关门把手。 */
function closeMark(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onClose: () => void,
): Phaser.GameObjects.Text {
  const mark = scene.add
    .text(x, y, '×', brushStyle(34, C.paperDim))
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  mark.on('pointerover', () => mark.setColor(css(C.goldBright)));
  mark.on('pointerout', () => mark.setColor(css(C.paperDim)));
  mark.on('pointerup', onClose);
  return mark;
}

/** 标题页「战史」按钮开的那本册子。 */
export function openHistory(scene: Phaser.Scene): void {
  const career = getCareer();
  const records = career.records;

  const contentH = records.length * ROW_H + 16;
  // 空册也要有一页纸放空态提示，所以下限不是一行的高度。
  const viewH = records.length === 0 ? 148 : Phaser.Math.Clamp(contentH, ROW_H + 16, MAX_VIEW_H);
  const panelH = HEAD_H + viewH + FOOT_H;
  const panelY = Math.round((GAME_HEIGHT - panelH) / 2);
  const viewTop = panelY + HEAD_H;
  const viewBottom = viewTop + viewH;
  const maxScroll = Math.max(0, contentH - viewH);

  let closed = false;
  const overlay = pushOverlay(scene, {
    id: 'history',
    dismissable: true,
    onDismiss: () => close(),
  });
  const DEPTH = overlay.depth;
  const root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);

  // 蒙布自己可点（topOnly），标题页的选将块与按钮全被挡下——confirmDiscard 同款。
  root.add(
    scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.86)
      .setInteractive(),
  );
  root.add(inkPanel(scene, LIST_X, panelY, LIST_W, panelH, { alpha: 0.97 }));
  root.add(
    scene.add
      .text(GAME_WIDTH / 2, panelY + 22, '战 史', brushStyle(34, C.paper))
      .setOrigin(0.5, 0)
      .setLetterSpacing(6),
  );
  root.add(
    scene.add
      .text(
        GAME_WIDTH / 2,
        panelY + 64,
        annalsSubtitle(records.length, career.totals.runs, career.totals.victories),
        bodyStyle(14, C.paperFaint),
      )
      .setOrigin(0.5, 0)
      .setLetterSpacing(2),
  );

  const rule = scene.add.graphics();
  rule.lineStyle(1, C.gold, 0.35);
  rule.lineBetween(LIST_X + 28, viewTop - 8, LIST_X + LIST_W - 28, viewTop - 8);
  root.add(rule);

  if (records.length === 0) {
    // 空态 (todos/22 s8)：一句交代这册子是干什么的，别只给一页白纸。
    root.add(
      scene.add
        .text(GAME_WIDTH / 2, viewTop + viewH / 2 - 16, '尚无战史', brushStyle(30, C.paperDim))
        .setOrigin(0.5)
        .setLetterSpacing(6),
    );
    root.add(
      scene.add
        .text(
          GAME_WIDTH / 2,
          viewTop + viewH / 2 + 28,
          '出征归来，无论功成还是折戟，皆记于此册。',
          bodyStyle(14, C.paperFaint),
        )
        .setOrigin(0.5)
        .setLetterSpacing(2),
    );
  } else {
    for (const { key, text } of COL_LABEL) {
      root.add(
        scene.add
          .text(LIST_X + COL[key], panelY + 92, text, bodyStyle(12, C.paperFaint))
          .setLetterSpacing(2),
      );
    }
  }

  // ------------------------------------------------------------------- 行

  const content = scene.add.container(0, viewTop);
  root.add(content);

  // Geometry masks render through the camera — scroll-locked, same as 07.
  const maskShape = scene.make.graphics({}, false).setScrollFactor(0);
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(LIST_X + 6, viewTop - 4, LIST_W - 12, viewH + 8);
  content.setMask(maskShape.createGeometryMask());

  const zones: Phaser.GameObjects.Zone[] = [];
  records.forEach((rec, i) => {
    const y = 10 + i * ROW_H;
    const row = historyRow(rec);

    const hover = scene.add.graphics();
    hover.fillStyle(C.paper, 0.06);
    hover.fillRoundedRect(LIST_X + 20, y - 2, LIST_W - 40, ROW_H - 2, 3);
    hover.setVisible(false);
    content.add(hover);

    const put = (x: number, text: string, color: number): void => {
      content.add(
        scene.add
          .text(LIST_X + x, y + (ROW_H - 4) / 2, text, bodyStyle(14, color))
          .setOrigin(0, 0.5),
      );
    };
    put(COL.hero, row.heroName, C.paper);
    put(COL.ascension, row.ascension, C.paperDim);
    put(COL.floor, row.floor, C.paperDim);
    put(COL.score, row.score, C.gold);
    put(COL.duration, row.duration, C.paperDim);
    put(COL.fate, row.fate, row.victory ? C.goldBright : C.cinnabarBright);

    const zone = scene.add
      .zone(LIST_X + LIST_W / 2, y + (ROW_H - 4) / 2, LIST_W - 40, ROW_H - 2)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => hover.setVisible(true));
    zone.on('pointerout', () => hover.setVisible(false));
    zone.on('pointerup', () => openDetail(scene, rec));
    content.add(zone);
    zones.push(zone);
  });

  // ----------------------------------------------------------------- 滚动

  let scroll = 0;
  const bar = scene.add.graphics();
  root.add(bar);

  const paintScroll = (): void => {
    bar.clear();
    if (maxScroll <= 0) return;
    const x = LIST_X + LIST_W - 16;
    const thumbH = Math.max(40, (viewH / contentH) * viewH);
    bar.fillStyle(C.paper, 0.08);
    bar.fillRoundedRect(x, viewTop, 5, viewH, 2);
    bar.fillStyle(C.gold, 0.65);
    bar.fillRoundedRect(x, viewTop + (scroll / maxScroll) * (viewH - thumbH), 5, thumbH, 2);
  };

  /** A mask hides the rows it clips but leaves their hit areas live — 07 同款。 */
  const syncVisible = (): void => {
    for (const zone of zones) {
      const y = content.y + zone.y;
      if (zone.input) zone.input.enabled = y >= viewTop && y <= viewBottom;
    }
  };

  paintScroll();
  syncVisible();

  const hint =
    records.length === 0
      ? 'Esc 或点击空白处关闭'
      : `${maxScroll > 0 ? '滚轮翻阅　·　' : ''}点一行看全录　·　Esc 或点击空白处关闭`;
  root.add(
    scene.add
      .text(GAME_WIDTH / 2, panelY + panelH - 34, hint, bodyStyle(13, C.paperFaint))
      .setOrigin(0.5)
      .setLetterSpacing(2),
  );
  root.add(closeMark(scene, LIST_X + LIST_W - 34, panelY + 22, () => close()));

  // --------------------------------------------------------------- lifetime

  const onWheel = (_p: unknown, _o: unknown, _dx: number, dy: number): void => {
    // 详录摞在上面时滚轮归它——scene-level 事件不认指针下面是谁。
    if (overlayDepth(scene) !== DEPTH || maxScroll <= 0) return;
    scroll = Phaser.Math.Clamp(scroll + dy * 0.6, 0, maxScroll);
    content.y = viewTop - scroll;
    paintScroll();
    syncVisible();
  };
  const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (overlayDepth(scene) !== DEPTH) return;
    const x = toDesign(pointer.x);
    const y = toDesign(pointer.y);
    const inside = x >= LIST_X && x <= LIST_X + LIST_W && y >= panelY && y <= panelY + panelH;
    if (!inside) close();
  };

  scene.input.on('wheel', onWheel);
  scene.input.on('pointerdown', onPointerDown);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);

  function teardown(): void {
    if (closed) return;
    closed = true;
    overlay.release();
    scene.input.off('wheel', onWheel);
    scene.input.off('pointerdown', onPointerDown);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
    maskShape.destroy();
    root.destroy(true);
  }

  function close(): void {
    teardown();
  }

  pinToCamera(root);
  root.setAlpha(0);
  scene.tweens.add({ targets: root, alpha: 1, duration: 180 });
}

// ------------------------------------------------------------------- 详录

const DETAIL = { w: 880, h: 600 } as const;
/** 07 网格的缩小内嵌，与 `SummaryScene.buildDeckPanel` 同一组数。 */
const DECK_COLS = 5;
const CELL_W = 82;
const CELL_H = 112;
const THUMB = 0.5;

/** 一条 `RunRecord` 的全录：牌组、宝物、路线。第二层覆盖层，Esc 只合它。 */
function openDetail(scene: Phaser.Scene, rec: RunRecord): void {
  const X = Math.round((GAME_WIDTH - DETAIL.w) / 2);
  const Y = Math.round((GAME_HEIGHT - DETAIL.h) / 2);

  let closed = false;
  const overlay = pushOverlay(scene, {
    id: 'history-detail',
    dismissable: true,
    onDismiss: () => close(),
  });
  const DEPTH = overlay.depth;
  const root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);

  // 薄一层的蒙布：册页还在底下，隐约可见才知道 Esc 会回到哪儿。
  root.add(
    scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.6)
      .setInteractive(),
  );
  root.add(inkPanel(scene, X, Y, DETAIL.w, DETAIL.h, { alpha: 0.97 }));

  // ------------------------------------------------------------------ 题眉
  const row = historyRow(rec);
  const title = scene.add
    .text(X + 32, Y + 20, row.heroName, brushStyle(32, C.paper))
    .setLetterSpacing(3);
  root.add(title);
  root.add(
    scene.add
      .text(
        X + 44 + title.width,
        Y + 40,
        row.fate,
        brushStyle(22, row.victory ? C.goldBright : C.cinnabarBright),
      )
      .setOrigin(0, 0.5)
      .setLetterSpacing(2),
  );

  const sub = [actName(rec.act), row.floor, `总分 ${rec.score}`, `用时 ${row.duration}`];
  if (rec.ascension > 0) sub.push(row.ascension);
  root.add(
    scene.add.text(X + 34, Y + 64, sub.join('　·　'), bodyStyle(14, C.paperDim)).setLetterSpacing(1),
  );

  const rule = scene.add.graphics();
  rule.lineStyle(1, C.gold, 0.35);
  rule.lineBetween(X + 28, Y + 94, X + DETAIL.w - 28, Y + 94);
  root.add(rule);

  // ------------------------------------------------------------------ 牌组
  const deckX = X + 28;
  root.add(
    scene.add
      .text(deckX, Y + 106, `牌组 · ${rec.deck.length} 张`, bodyStyle(14, C.goldBright))
      .setLetterSpacing(2),
  );

  const gridTop = Y + 134;
  const gridW = DECK_COLS * CELL_W + 20;
  const gridH = Y + DETAIL.h - 26 - gridTop;
  // 史料里的牌组没有 uid（活跑团才需要地址），给排序和牌面现造一个。
  const entries = sortForDisplay(
    rec.deck.map((c, i) => ({ uid: `h${i}`, defId: c.defId, upgraded: c.upgraded })),
  );

  const deckContent = scene.add.container(0, gridTop);
  root.add(deckContent);

  // 悬停预览 (k7)：详录仍旧只看不选，但 0.62 的缩样读不清 13px 的规则
  // 文本——悬停放出全尺寸牌面带词条面板，和图鉴同一副手感。预览开在
  // scene 层而不是 root 里，所以收场路径上（teardown / 滚动）都要亲手收。
  let preview: Phaser.GameObjects.Container | null = null;
  const hidePreview = (): void => {
    preview?.destroy(true);
    preview = null;
  };

  const deckViews: CardView[] = [];
  for (const [i, entry] of entries.entries()) {
    const view = new CardView(scene, entry.uid, entry.defId, entry.upgraded, undefined, 'display');
    view.setPosition(
      deckX + 10 + CELL_W / 2 + (i % DECK_COLS) * CELL_W,
      8 + CELL_H / 2 + Math.floor(i / DECK_COLS) * CELL_H,
    );
    view.setScale(THUMB);
    view.hitZone.on('pointerover', () => {
      hidePreview();
      preview = openCardPreview(scene, {
        defId: entry.defId,
        upgraded: entry.upgraded,
        x: view.x,
        y: deckContent.y + view.y,
        depth: DEPTH + 60,
      });
    });
    view.hitZone.on('pointerout', () => hidePreview());
    deckContent.add(view);
    deckViews.push(view);
  }

  /** 蒙版只裁画面不裁热区——滚出窗外的缩样得亲手关掉输入（同 CardGrid）。 */
  const cullDeck = (): void => {
    for (const view of deckViews) {
      const input = view.hitZone.input;
      if (input) {
        input.enabled = deckContent.y + view.y >= gridTop && deckContent.y + view.y <= gridTop + gridH;
      }
    }
  };
  cullDeck();

  const deckMask = scene.make.graphics({}, false).setScrollFactor(0);
  deckMask.fillStyle(0xffffff);
  deckMask.fillRect(deckX - 2, gridTop - 4, gridW + 4, gridH + 8);
  deckContent.setMask(deckMask.createGeometryMask());

  const deckContentH = Math.ceil(entries.length / DECK_COLS) * CELL_H + 16;
  const deckMaxScroll = Math.max(0, deckContentH - gridH);
  let deckScroll = 0;
  const deckBar = scene.add.graphics();
  root.add(deckBar);
  const paintDeckScroll = (): void => {
    deckBar.clear();
    if (deckMaxScroll <= 0) return;
    const x = deckX + gridW + 6;
    const thumbH = Math.max(36, (gridH / deckContentH) * gridH);
    deckBar.fillStyle(C.paper, 0.08);
    deckBar.fillRoundedRect(x, gridTop, 5, gridH, 2);
    deckBar.fillStyle(C.gold, 0.65);
    deckBar.fillRoundedRect(
      x,
      gridTop + (deckScroll / deckMaxScroll) * (gridH - thumbH),
      5,
      thumbH,
      2,
    );
  };
  paintDeckScroll();

  // ------------------------------------------------------------------ 右栏
  const rx = X + 540;
  const rw = X + DETAIL.w - 34 - rx;
  let ry = Y + 106;

  root.add(
    scene.add
      .text(rx, ry, `宝物 · ${rec.relics.length} 件`, bodyStyle(14, C.goldBright))
      .setLetterSpacing(2),
  );
  ry += 28;
  const relicText = scene.add.text(
    rx,
    ry,
    rec.relics.length
      ? rec.relics.map((id) => getRelic(id)?.name ?? id).join('　')
      : '两袖清风',
    { ...bodyStyle(14, C.paperDim), wordWrap: { width: rw }, lineSpacing: 6 },
  );
  root.add(relicText);
  ry += Math.max(22, relicText.height) + 26;

  root.add(scene.add.text(rx, ry, '路线', bodyStyle(14, C.goldBright)).setLetterSpacing(2));
  ry += 28;
  const lines = routeLines(rec.stats.route);
  if (lines.length === 0) {
    root.add(scene.add.text(rx, ry, '未及启程', bodyStyle(13, C.paperFaint)));
  }
  for (const line of lines) {
    const text = scene.add.text(rx, ry, `${line.act}　${line.line}`, {
      ...bodyStyle(13, C.paperDim),
      wordWrap: { width: rw },
      lineSpacing: 5,
    });
    root.add(text);
    ry += text.height + 10;
  }

  root.add(closeMark(scene, X + DETAIL.w - 34, Y + 22, () => close()));

  // --------------------------------------------------------------- lifetime

  const onWheel = (_p: unknown, _o: unknown, _dx: number, dy: number): void => {
    if (overlayDepth(scene) !== DEPTH || deckMaxScroll <= 0) return;
    deckScroll = Phaser.Math.Clamp(deckScroll + dy * 0.6, 0, deckMaxScroll);
    deckContent.y = gridTop - deckScroll;
    hidePreview();
    cullDeck();
    paintDeckScroll();
  };
  const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (overlayDepth(scene) !== DEPTH) return;
    const x = toDesign(pointer.x);
    const y = toDesign(pointer.y);
    const inside = x >= X && x <= X + DETAIL.w && y >= Y && y <= Y + DETAIL.h;
    if (!inside) close();
  };

  scene.input.on('wheel', onWheel);
  scene.input.on('pointerdown', onPointerDown);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);

  function teardown(): void {
    if (closed) return;
    closed = true;
    overlay.release();
    scene.input.off('wheel', onWheel);
    scene.input.off('pointerdown', onPointerDown);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
    hidePreview();
    deckMask.destroy();
    root.destroy(true);
  }

  function close(): void {
    teardown();
  }

  pinToCamera(root);
  root.setAlpha(0);
  scene.tweens.add({ targets: root, alpha: 1, duration: 160 });
}
