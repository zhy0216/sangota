import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { clearSave } from '../state/save';
import { getSettings, updateSettings, type Settings } from '../state/settings';
import { toDesign } from './designSpace';
import { openHistory } from './HistoryPanel';
import { overlayDepth, pushOverlay } from './overlayStack';
import {
  keyColumns,
  percentFromTrack,
  SETTINGS_TABS,
  settingRows,
  volumeFromPercent,
  type SettingsSliderKey,
  type SettingsTabId,
} from './settingsView';
import { bodyStyle, brushStyle, inkButton, inkPanel } from './theme';

/**
 * 设置面板 (todos/21 t5) — 全屏覆盖层：左侧分组 tab（画面/音频/游戏/按键），
 * 右侧选项列表，底部「清除存档」与「查看统计」。
 *
 * 骨架照抄 07 `CardGrid` / 22 `HistoryPanel`：`pushOverlay` 管 Esc 与深度，
 * 本文件不自绑 Esc 键；可点蒙布挡下层输入；点空白处关闭是几何判定；scene-level
 * 的指针监听（滑块拖动、点外关闭）每次先问 `overlayDepth` 自己还在不在顶楼
 * ——「查看统计」的战史册页、清档确认都会摞上来。
 *
 * 控件全部自己画（inkPanel/inkButton 风格）：开关是描边小方块（`CustomScene`
 * 的 modifier 同款）、三态是一排可点的字（`CompendiumScene.filterGroup` 同款）、
 * 滑块是轨道＋圆钮。除滑块外每次改动都整面重画（低频操作，重建比找格子稳）；
 * 滑块拖动实时写 `updateSettings`——音乐音量经 t1 定下的 settings↔Audio
 * 同步路径（`onSettingsChange` → `applyMusicVolume`）直接改在播实例，
 * 不用面板自己去摸混音器。
 *
 * 排版全在 `settingsView.ts` 里算（历史册页的 `historyView` 同款拆法），
 * 这里只管摆和接线。
 */

// ------------------------------------------------------------------- 几何

const PANEL_W = 840;
const PANEL_H = 560;
const PANEL_X = Math.round((GAME_WIDTH - PANEL_W) / 2);
const PANEL_Y = Math.round((GAME_HEIGHT - PANEL_H) / 2);

/** tab 列与选项区的分界。 */
const TAB_COL_W = 168;
const BODY_X = PANEL_X + TAB_COL_W + 36;
const BODY_TOP = PANEL_Y + 104;
/** 控件（开关/选项/滑块轨道）的起点 x——标签在左、控件对齐在右。 */
const CTRL_X = PANEL_X + 486;
const ROW_H = 62;

const TRACK_W = 240;

/** 右上角的 ×——CardGrid / HistoryPanel 的同款关门把手。 */
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

/**
 * 全屏是唯一「写账之外还要动浏览器」的开关：`scale` 的全屏门必须在用户
 * 手势的回调里推（这里就在 pointerup 里）。浏览器拒绝时 Phaser 只发事件
 * 不抛错，账照写——下次进面板开关仍如实反映账上的意愿。
 */
function applyFullscreen(scene: Phaser.Scene, on: boolean): void {
  if (on) {
    if (!scene.scale.isFullscreen) scene.scale.startFullscreen();
  } else if (scene.scale.isFullscreen) {
    scene.scale.stopFullscreen();
  }
}

// ------------------------------------------------------------------- 面板

/** 设置面板。任何场景都能开——覆盖层不换场景，关了原地接着玩。 */
export function openSettings(scene: Phaser.Scene): void {
  let closed = false;
  const overlay = pushOverlay(scene, {
    id: 'settings',
    dismissable: true,
    onDismiss: () => close(),
  });
  const DEPTH = overlay.depth;
  const root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);

  // 蒙布自己可点（topOnly），下层场景的按钮全被挡下——HistoryPanel 同款。
  root.add(
    scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.86)
      .setInteractive(),
  );
  root.add(inkPanel(scene, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, { alpha: 0.97 }));
  root.add(
    scene.add
      .text(GAME_WIDTH / 2, PANEL_Y + 22, '设 置', brushStyle(34, C.paper))
      .setOrigin(0.5, 0)
      .setLetterSpacing(6),
  );
  root.add(closeMark(scene, PANEL_X + PANEL_W - 34, PANEL_Y + 22, () => close()));

  const rule = scene.add.graphics();
  rule.lineStyle(1, C.gold, 0.35);
  rule.lineBetween(PANEL_X + 28, PANEL_Y + 76, PANEL_X + PANEL_W - 28, PANEL_Y + 76);
  // tab 列与选项区之间的竖线。
  rule.lineStyle(1, C.gold, 0.22);
  rule.lineBetween(PANEL_X + TAB_COL_W, PANEL_Y + 92, PANEL_X + TAB_COL_W, PANEL_Y + PANEL_H - 100);
  // 底栏（清档/统计）的上沿。
  rule.lineStyle(1, C.gold, 0.35);
  rule.lineBetween(PANEL_X + 28, PANEL_Y + PANEL_H - 88, PANEL_X + PANEL_W - 28, PANEL_Y + PANEL_H - 88);
  root.add(rule);

  // ------------------------------------------------------------------ tab 列

  let active: SettingsTabId = 'display';
  /** tab 名字与侧标，切组时重描颜色——名单短，逐个重画即可。 */
  const tabMarks: { id: SettingsTabId; text: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics }[] = [];

  for (const [i, tab] of SETTINGS_TABS.entries()) {
    const ty = PANEL_Y + 120 + i * 56;
    const bar = scene.add.graphics();
    const text = scene.add
      .text(PANEL_X + 56, ty, tab.label, brushStyle(26, C.paperDim))
      .setOrigin(0, 0.5)
      .setLetterSpacing(4)
      .setInteractive({ useHandCursor: true });
    text.on('pointerover', () => {
      if (active !== tab.id) text.setColor(css(C.goldBright));
    });
    text.on('pointerout', () => paintTabs());
    text.on('pointerup', () => showTab(tab.id));
    root.add(bar);
    root.add(text);
    tabMarks.push({ id: tab.id, text, bar });
  }

  const paintTabs = (): void => {
    for (const [i, mark] of tabMarks.entries()) {
      const picked = mark.id === active;
      mark.text.setColor(css(picked ? C.goldBright : C.paperDim));
      mark.bar.clear();
      if (picked) {
        mark.bar.fillStyle(C.cinnabar, 0.9);
        mark.bar.fillRoundedRect(PANEL_X + 38, PANEL_Y + 120 + i * 56 - 12, 5, 24, 2);
      }
    }
  };

  // ------------------------------------------------------------------ 选项区

  const body = scene.add.container(0, 0);
  root.add(body);

  /**
   * 滑块拖动的在途账：pointerdown 落在哪条轨道上、它怎么重画。scene-level
   * 的 pointermove 全程只挂一份，靠这格找到正主。
   */
  let drag: { key: SettingsSliderKey; trackX: number; apply: (px: number) => void } | null = null;

  /** 一行滑块：轨道＋圆钮＋读数。拖动实时写账，音量即刻生效（见文件头）。 */
  const buildSlider = (
    key: SettingsSliderKey,
    y: number,
    percent: number,
  ): void => {
    let current = percent;
    const g = scene.add.graphics();
    const readout = scene.add
      .text(CTRL_X + TRACK_W + 22, y, `${current}`, bodyStyle(15, C.goldBright))
      .setOrigin(0, 0.5);
    body.add(g);
    body.add(readout);

    const paint = (): void => {
      g.clear();
      g.fillStyle(C.paper, 0.14);
      g.fillRoundedRect(CTRL_X, y - 3, TRACK_W, 6, 3);
      g.fillStyle(C.gold, 0.85);
      g.fillRoundedRect(CTRL_X, y - 3, (TRACK_W * current) / 100, 6, 3);
      g.fillStyle(C.goldBright, 1);
      g.fillCircle(CTRL_X + (TRACK_W * current) / 100, y, 8);
      readout.setText(`${current}`);
    };
    paint();

    const apply = (px: number): void => {
      const pct = percentFromTrack(toDesign(px), CTRL_X, TRACK_W);
      if (pct === current) return;
      current = pct;
      // 写总账——Audio 经 onSettingsChange 跟读，音乐改的是在播实例。
      updateSettings({ [key]: volumeFromPercent(pct) } as Partial<Settings>);
      paint();
    };

    const zone = scene.add
      .zone(CTRL_X + TRACK_W / 2, y, TRACK_W + 24, 30)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      drag = { key, trackX: CTRL_X, apply };
      apply(pointer.x);
    });
    body.add(zone);
  };

  /** 整面重画当前组。低频操作，重建永远比找格子改字稳。 */
  const showTab = (tab: SettingsTabId): void => {
    active = tab;
    drag = null;
    paintTabs();
    body.removeAll(true);

    if (tab === 'keys') {
      buildKeys();
      return;
    }

    const s = getSettings();
    for (const [i, row] of settingRows(tab, s).entries()) {
      const y = BODY_TOP + i * ROW_H + ROW_H / 2;
      const desc = row.kind === 'slider' ? undefined : row.desc;
      body.add(
        scene.add
          .text(BODY_X, desc ? y - 8 : y, row.label, bodyStyle(16, C.paper))
          .setOrigin(0, 0.5),
      );
      if (desc) {
        body.add(
          scene.add.text(BODY_X, y + 13, desc, bodyStyle(12, C.paperFaint)).setOrigin(0, 0.5),
        );
      }

      if (row.kind === 'toggle') {
        // 描边小方块——CustomScene 的 modifier 开关同款。
        const box = scene.add.graphics();
        box.lineStyle(1, row.on ? C.goldBright : C.gold, row.on ? 1 : 0.5);
        box.strokeRoundedRect(CTRL_X, y - 9, 18, 18, 3);
        if (row.on) {
          box.fillStyle(C.gold, 0.9);
          box.fillRoundedRect(CTRL_X + 4, y - 5, 10, 10, 2);
        }
        body.add(box);
        body.add(
          scene.add
            .text(CTRL_X + 30, y, row.on ? '开' : '关', bodyStyle(14, row.on ? C.goldBright : C.paperDim))
            .setOrigin(0, 0.5),
        );
        const zone = scene.add
          .zone(CTRL_X + 32, y, 96, 30)
          .setInteractive({ useHandCursor: true });
        zone.on('pointerup', () => {
          const next = !row.on;
          if (row.key === 'fullscreen') applyFullscreen(scene, next);
          // 计算键出不来精确的 Partial<Settings>，键名来自行描述、值经 sanitize 兜底。
          updateSettings({ [row.key]: next } as Partial<Settings>);
          showTab(tab);
        });
        body.add(zone);
      } else if (row.kind === 'choice') {
        // 一排可点的字——CompendiumScene.filterGroup 同款。
        let at = CTRL_X;
        for (const opt of row.options) {
          const picked = opt.value === row.value;
          const text = scene.add
            .text(at, y, opt.label, bodyStyle(14, picked ? C.goldBright : C.paperDim))
            .setOrigin(0, 0.5)
            .setInteractive({ useHandCursor: true });
          if (picked) text.setBackgroundColor(css(C.inkSoft));
          text.on('pointerover', () => text.setColor(css(C.goldBright)));
          text.on('pointerout', () => text.setColor(css(picked ? C.goldBright : C.paperDim)));
          text.on('pointerup', () => {
            updateSettings({ [row.key]: opt.value } as Partial<Settings>);
            showTab(tab);
          });
          body.add(text);
          at += text.width + 16;
        }
        if (row.note) {
          // 渲染倍率的「重载后生效」：倍率钉死在模块加载期（config.ts t4），面板只能提醒——
          // 但可以替玩家把手伸过去：08 存档在，重载的代价只是回到房间边界。
          const note = scene.add
            .text(at + 6, y, `· ${row.note}`, bodyStyle(12, C.paperFaint))
            .setOrigin(0, 0.5);
          body.add(note);
          const reload = scene.add
            .text(at + 6 + note.width + 14, y, '立即重载', bodyStyle(12, C.gold))
            .setOrigin(0, 0.5)
            .setInteractive({ useHandCursor: true });
          reload.on('pointerover', () => reload.setColor(css(C.goldBright)));
          reload.on('pointerout', () => reload.setColor(css(C.gold)));
          reload.on('pointerup', () => location.reload());
          body.add(reload);
        }
      } else {
        buildSlider(row.key, y, row.percent);
      }
    }
  };

  /** 按键组：两列只读的「动作 — 键帽」。第一版不许改（todo 明说可以）。 */
  const buildKeys = (): void => {
    const [left, right] = keyColumns(getSettings());
    const KEY_ROW_H = 31;
    const colW = 300;
    for (const [c, col] of [left, right].entries()) {
      const x = BODY_X + c * colW;
      for (const [i, row] of col.entries()) {
        const y = BODY_TOP + i * KEY_ROW_H;
        body.add(scene.add.text(x, y, row.label, bodyStyle(14, C.paperDim)).setOrigin(0, 0.5));
        body.add(
          scene.add.text(x + colW - 80, y, row.key, bodyStyle(14, C.goldBright)).setOrigin(0, 0.5),
        );
      }
    }
    body.add(
      scene.add
        .text(BODY_X, BODY_TOP + 10.5 * KEY_ROW_H + 8, '按键暂不可改，仅供查阅。', bodyStyle(12, C.paperFaint))
        .setOrigin(0, 0.5),
    );
  };

  showTab('display');

  // ------------------------------------------------------------------ 底栏

  const FOOT_Y = PANEL_Y + PANEL_H - 46;
  const hint = scene.add
    .text(PANEL_X + 36, FOOT_Y, '改动即存　·　Esc 或点击空白处关闭', bodyStyle(13, C.paperFaint))
    .setOrigin(0, 0.5)
    .setLetterSpacing(1);
  root.add(hint);

  // 「查看统计」链去 22 的战史册页（todo t5：选一个已存在的入口链过去）。
  // openHistory 走同一部覆盖层栈，摞在设置上面，Esc 只合上一层。
  root.add(
    inkButton(scene, PANEL_X + PANEL_W - 316, FOOT_Y, '查 看 统 计', {
      width: 160,
      height: 46,
      fontSize: 20,
      onClick: () => openHistory(scene),
    }),
  );
  root.add(
    inkButton(scene, PANEL_X + PANEL_W - 132, FOOT_Y, '清 除 存 档', {
      width: 160,
      height: 46,
      fontSize: 20,
      accent: C.cinnabar,
      onClick: () => confirmWipe(),
    }),
  );

  /** 清档的确认层——摞在设置上面的第二层，TitleScene.confirmDiscard 的措辞谱系。 */
  const confirmWipe = (): void => {
    const W = 460;
    const H = 208;
    const X = Math.round((GAME_WIDTH - W) / 2);
    const Y = Math.round((GAME_HEIGHT - H) / 2);

    let done = false;
    const sub = pushOverlay(scene, {
      id: 'settings-wipe',
      dismissable: true,
      onDismiss: () => closeSub(),
    });
    const box = scene.add.container(0, 0).setDepth(sub.depth).setScrollFactor(0);
    // 薄一层的蒙布：设置面板还在底下，隐约可见才知道 Esc 会回到哪儿。
    box.add(
      scene.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.6)
        .setInteractive(),
    );
    box.add(inkPanel(scene, X, Y, W, H, { alpha: 0.97 }));
    box.add(
      scene.add
        .text(GAME_WIDTH / 2, Y + 26, '清 除 存 档', brushStyle(28, C.paper))
        .setOrigin(0.5, 0)
        .setLetterSpacing(4),
    );
    box.add(
      scene.add
        .text(GAME_WIDTH / 2, Y + 84, '当前跑团的存档将被抹去，且无法找回。', bodyStyle(14, C.gold))
        .setOrigin(0.5),
    );
    box.add(
      inkButton(scene, GAME_WIDTH / 2 - 100, Y + 152, '仍 要 清 除', {
        width: 168,
        height: 48,
        fontSize: 20,
        accent: C.cinnabar,
        onClick: () => {
          clearSave();
          hint.setText('存档已清除　·　Esc 或点击空白处关闭').setColor(css(C.cinnabarBright));
          closeSub();
        },
      }),
    );
    box.add(
      inkButton(scene, GAME_WIDTH / 2 + 100, Y + 152, '再 想 想', {
        width: 168,
        height: 48,
        fontSize: 20,
        onClick: () => closeSub(),
      }),
    );

    function closeSub(): void {
      if (done) return;
      done = true;
      sub.release();
      box.destroy(true);
    }
  };

  // --------------------------------------------------------------- lifetime

  const onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    // 战史/确认层摞上来时拖动归零——scene-level 事件不认指针下面是谁。
    if (overlayDepth(scene) !== DEPTH || !drag) return;
    if (!pointer.isDown) {
      drag = null;
      return;
    }
    drag.apply(pointer.x);
  };
  const onPointerUp = (): void => {
    drag = null;
  };
  const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (overlayDepth(scene) !== DEPTH) return;
    const x = toDesign(pointer.x);
    const y = toDesign(pointer.y);
    const inside = x >= PANEL_X && x <= PANEL_X + PANEL_W && y >= PANEL_Y && y <= PANEL_Y + PANEL_H;
    if (!inside) close();
  };

  scene.input.on('pointermove', onPointerMove);
  scene.input.on('pointerup', onPointerUp);
  scene.input.on('pointerdown', onPointerDown);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);

  function teardown(): void {
    if (closed) return;
    closed = true;
    overlay.release();
    scene.input.off('pointermove', onPointerMove);
    scene.input.off('pointerup', onPointerUp);
    scene.input.off('pointerdown', onPointerDown);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
    root.destroy(true);
  }

  function close(): void {
    teardown();
  }

  root.setAlpha(0);
  scene.tweens.add({ targets: root, alpha: 1, duration: 180 });
}
