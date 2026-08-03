import { describe, expect, it } from 'vitest';
import { defaultSettings, KEY_ACTIONS } from '../src/state/settings';
import {
  KEY_ACTION_LABEL,
  keyColumns,
  keyDisplay,
  keyRows,
  percentFromTrack,
  percentFromVolume,
  SETTINGS_TABS,
  settingRows,
  volumeFromPercent,
} from '../src/ui/settingsView';

/**
 * 设置面板 (todos/21 t5) 的排版层。`SettingsPanel.ts` imports Phaser，Node 下
 * 装不进来——行描述、滑块换算、按键名册全在 `settingsView.ts` 里算、在这里钉；
 * 面板的控件接线按 `historyView.test.ts` 的技法查源文。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

// ------------------------------------------------------------------- 分组

describe('SETTINGS_TABS', () => {
  it('lists the four groups of the todo, in order', () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(['display', 'audio', 'game', 'keys']);
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(['画 面', '音 频', '游 戏', '按 键']);
  });
});

// ------------------------------------------------------------------- 行描述

describe('settingRows', () => {
  it('画面: fullscreen toggle, renderScale choice with a reload note, screenShake tri-state', () => {
    const rows = settingRows('display', defaultSettings());
    expect(rows.map((r) => [r.kind, r.key])).toEqual([
      ['toggle', 'fullscreen'],
      ['choice', 'renderScale'],
      ['choice', 'screenShake'],
    ]);
    const scale = rows[1];
    if (scale.kind !== 'choice') throw new Error('renderScale must be a choice row');
    // 倍率钉死在模块加载期（config.ts t4），面板只能提醒重载。
    expect(scale.note).toBe('重载后生效');
    expect(scale.options.map((o) => o.value)).toEqual(['auto', 1, 2, 3]);
    expect(scale.value).toBe('auto');
    const shake = rows[2];
    if (shake.kind !== 'choice') throw new Error('screenShake must be a choice row');
    expect(shake.options.map((o) => o.label)).toEqual(['开', '弱', '关']);
  });

  it('音频: two sliders, the 0..1 ledger shown as 0..100', () => {
    const s = defaultSettings();
    s.musicVolume = 0.8;
    s.sfxVolume = 0.35;
    expect(settingRows('audio', s)).toEqual([
      { kind: 'slider', key: 'musicVolume', label: '音乐音量', percent: 80 },
      { kind: 'slider', key: 'sfxVolume', label: '音效音量', percent: 35 },
    ]);
  });

  it('游戏: the five rows of the todo, animSpeed and confirmPlay as tri-states', () => {
    const rows = settingRows('game', defaultSettings());
    expect(rows.map((r) => [r.kind, r.key])).toEqual([
      ['choice', 'animSpeed'],
      ['toggle', 'confirmEndTurn'],
      ['choice', 'confirmPlay'],
      ['toggle', 'autoEndTurn'],
      ['toggle', 'showIncomingDamage'],
    ]);
    const speed = rows[0];
    if (speed.kind !== 'choice') throw new Error('animSpeed must be a choice row');
    expect(speed.options).toEqual([
      { value: 'normal', label: '正常' },
      { value: 'fast', label: '快速' },
      { value: 'instant', label: '极速' },
    ]);
    const confirm = rows[2];
    if (confirm.kind !== 'choice') throw new Error('confirmPlay must be a choice row');
    expect(confirm.options.map((o) => o.label)).toEqual(['关', '仅稀有', '全部']);
  });

  it('mirrors the current settings, not the defaults', () => {
    const s = defaultSettings();
    s.fullscreen = true;
    s.renderScale = 2;
    s.animSpeed = 'instant';
    s.confirmEndTurn = false;
    const display = settingRows('display', s);
    expect(display[0]).toMatchObject({ key: 'fullscreen', on: true });
    expect(display[1]).toMatchObject({ key: 'renderScale', value: 2 });
    const game = settingRows('game', s);
    expect(game[0]).toMatchObject({ key: 'animSpeed', value: 'instant' });
    expect(game[1]).toMatchObject({ key: 'confirmEndTurn', on: false });
  });
});

// ------------------------------------------------------------------- 滑块换算

describe('slider maths', () => {
  it('converts the 0..1 ledger to whole percents and back', () => {
    expect(percentFromVolume(0)).toBe(0);
    expect(percentFromVolume(0.8)).toBe(80);
    expect(percentFromVolume(1)).toBe(100);
    expect(volumeFromPercent(0)).toBe(0);
    expect(volumeFromPercent(80)).toBe(0.8);
    expect(volumeFromPercent(100)).toBe(1);
    // 每一格来回换算都不漂——拖到 37 存 0.37，再开面板还是 37。
    for (let p = 0; p <= 100; p++) expect(percentFromVolume(volumeFromPercent(p))).toBe(p);
  });

  it('clamps out-of-range and rubbish values instead of writing them', () => {
    expect(percentFromVolume(1.5)).toBe(100);
    expect(percentFromVolume(-1)).toBe(0);
    expect(percentFromVolume(Number.NaN)).toBe(0);
    expect(volumeFromPercent(120)).toBe(1);
    expect(volumeFromPercent(-5)).toBe(0);
    expect(volumeFromPercent(Number.NaN)).toBe(0);
  });

  it('maps a pointer on the track to whole percents, clamped at both ends', () => {
    expect(percentFromTrack(100, 100, 240)).toBe(0);
    expect(percentFromTrack(340, 100, 240)).toBe(100);
    expect(percentFromTrack(220, 100, 240)).toBe(50);
    // 拖出轨道两端不越界。
    expect(percentFromTrack(-999, 100, 240)).toBe(0);
    expect(percentFromTrack(999, 100, 240)).toBe(100);
    // 空轨道（防御）不除零。
    expect(percentFromTrack(50, 100, 0)).toBe(0);
  });
});

// ------------------------------------------------------------------- 按键组

describe('key rows', () => {
  it('names every bindable action, in KEY_ACTIONS order', () => {
    const rows = keyRows(defaultSettings());
    expect(rows.map((r) => r.action)).toEqual([...KEY_ACTIONS]);
    // 名字铺满且不重样——两行同名玩家就分不清谁是谁。
    const labels = Object.values(KEY_ACTION_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('prints keycap words for Phaser suffixes and the raw letter otherwise', () => {
    expect(keyDisplay('ESC')).toBe('Esc');
    expect(keyDisplay('SPACE')).toBe('空格');
    expect(keyDisplay('ONE')).toBe('1');
    expect(keyDisplay('ZERO')).toBe('0');
    expect(keyDisplay('E')).toBe('E');
    const rows = keyRows(defaultSettings());
    expect(rows.find((r) => r.action === 'endTurn')?.key).toBe('E');
    expect(rows.find((r) => r.action === 'card10')?.key).toBe('0');
  });

  it('splits the twenty actions into two even columns', () => {
    const [left, right] = keyColumns(defaultSettings());
    expect(left.length).toBe(10);
    expect(right.length).toBe(10);
    expect([...left, ...right].map((r) => r.action)).toEqual([...KEY_ACTIONS]);
  });
});

// ------------------------------------------------------------------- 接线

describe('the settings panel is wired like the other overlays', () => {
  it('stacks on the overlay skeleton and never binds its own Esc', () => {
    const panel = read('src/ui/SettingsPanel.ts');
    // 07 的 overlay 骨架：栈管 Esc 与深度。
    expect(panel).toContain('pushOverlay(scene');
    expect(panel).not.toContain('keydown-ESC');
    // scene-level 指针监听逐个先问自己还在不在顶楼——战史/确认层会摞上来。
    expect(panel.match(/overlayDepth\(scene\) !== DEPTH/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('writes every control through updateSettings — the one ledger of t1', () => {
    const panel = read('src/ui/SettingsPanel.ts');
    expect(panel).toContain("import { getSettings, updateSettings, type Settings } from '../state/settings'");
    // 开关、三态、滑块三种控件各自的写账口。
    expect(panel).toContain('updateSettings({ [row.key]: next }');
    expect(panel).toContain('updateSettings({ [row.key]: opt.value }');
    expect(panel).toContain('updateSettings({ [key]: volumeFromPercent(pct) }');
    // 面板不自己摸混音器——音乐音量走 settings↔Audio 的同步路径。
    expect(panel).not.toContain('setMusicVolume');
    expect(panel).not.toContain('setSfxVolume');
  });

  it('drives fullscreen through the scale manager, from the toggle', () => {
    const panel = read('src/ui/SettingsPanel.ts');
    expect(panel).toContain('scene.scale.startFullscreen()');
    expect(panel).toContain('scene.scale.stopFullscreen()');
    expect(panel).toContain("if (row.key === 'fullscreen') applyFullscreen(scene, next)");
  });

  it('puts 清除存档 behind a confirm and 查看统计 onto the existing annals', () => {
    const panel = read('src/ui/SettingsPanel.ts');
    // 清档要过确认层，直接就清是事故。
    expect(panel).toContain("import { clearSave } from '../state/save'");
    expect(panel).toContain('清 除 存 档');
    expect(panel).toContain('仍 要 清 除');
    expect(panel).toContain('再 想 想');
    expect(panel).toContain('clearSave()');
    // 统计链去 22 的战史册页——已存在的入口，不另造一份。
    expect(panel).toContain("import { openHistory } from './HistoryPanel'");
    expect(panel).toContain('openHistory(scene)');
    expect(panel).toContain('查 看 统 计');
  });

  it('只在局内设置显示回到主菜单，且保留存档', () => {
    const panel = read('src/ui/SettingsPanel.ts');
    expect(panel).toContain("scene.scene.key === 'Map' || scene.scene.key === 'Combat'");
    expect(panel).toContain('回 到 主 菜 单');
    expect(panel).toContain("onClick: () => scene.scene.start('Title')");

    const returnButton = panel.slice(panel.indexOf('// 标题页也复用'), panel.indexOf('const paintTabs'));
    expect(returnButton).not.toContain('clearSave()');
  });

  it('shows the keys tab read-only in this first cut', () => {
    const panel = read('src/ui/SettingsPanel.ts');
    expect(panel).toContain('按键暂不可改，仅供查阅。');
  });
});

// ------------------------------------------------------------- 入口 (t6)

/** Esc 处理器切片：`keydown-ESC` 到收笔的 `});`——两个场景同一把尺。 */
const escHandler = (src: string): string => {
  const at = src.indexOf("keydown-ESC'");
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('});', at));
};

describe('the gear entries of t6, and the Esc pecking order', () => {
  it('地图与战斗右上角各有一枚齿轮小按钮，走 inkButton 开同一面板', () => {
    for (const path of ['src/scenes/MapScene.ts', 'src/scenes/CombatScene.ts']) {
      const scene = read(path);
      expect(scene, path).toContain("import { openSettings } from '../ui/SettingsPanel'");
      // ui-click 音随 inkButton 工厂自带——齿轮不许自绑音效或自画按钮。
      const gear = scene.indexOf("inkButton(this, GAME_WIDTH - ");
      expect(gear, path).toBeGreaterThan(-1);
      expect(scene.slice(gear, scene.indexOf('})', gear)), path).toContain("'⚙'");
      expect(scene, path).toContain('onClick: () => openSettings(this)');
    }
  });

  it('战斗 Esc 分层：overlay 让位 → 收气泡 → 拖拽回弹 → 取消选敌 → 都空才开设置', () => {
    const handler = escHandler(read('src/scenes/CombatScene.ts'));
    // 牌堆 overlay 开着：覆盖层栈自己收顶层，这里整个让位，不开设置。
    expect(handler).toContain('if (isCardGridOpen(this)) return;');
    // 拖拽态 (24 k6)：自成一档排在选敌之前——只回弹，不顺手收丹药。
    expect(handler).toContain('if (this.dragUid !== null) {');
    // 选敌态（选中卡或丹药）：只取消，随手 return，轮不到设置。
    expect(handler).toContain(
      'if (this.selectedUid !== null || this.selectedPotion !== null) {',
    );
    const order = [
      'isCardGridOpen(this)',
      'this.dismissEndTurnConfirm();',
      'this.cancelDrag();',
      'this.clearSelection();',
      'openSettings(this);',
    ].map((mark) => handler.indexOf(mark));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 取消选敌后必须收手——openSettings 只能是无事可收时的兜底档。
    const cancel = handler.slice(handler.indexOf('this.clearSelection();'));
    expect(cancel.indexOf('return;')).toBeLessThan(cancel.indexOf('openSettings(this);'));
  });

  it('地图 Esc 分层：overlay 让位 → 关抽屉 → 都空才开设置', () => {
    const handler = escHandler(read('src/scenes/MapScene.ts'));
    const order = [
      'if (isCardGridOpen(this)) return;',
      'this.toggleDrawer(false);',
      'openSettings(this);',
    ].map((mark) => handler.indexOf(mark));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 抽屉开着这一按只关抽屉——关完 return，不连开设置。
    const drawer = handler.slice(handler.indexOf('this.toggleDrawer(false);'));
    expect(drawer.indexOf('return;')).toBeLessThan(drawer.indexOf('openSettings(this);'));
  });
});
