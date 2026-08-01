import { KEY_ACTIONS, type KeyAction, type Settings } from '../state/settings';

/**
 * 设置面板 (todos/21 t5) 的纯排版层 — 面板本体 `SettingsPanel.ts` imports
 * Phaser，Node 下装不进来，所以四组 tab 各摆哪些行、每行是什么控件、滑块的
 * 百分比怎么换算，全在这里算好、由 `tests/settingsView.test.ts` 钉住
 * （`historyView.ts` 之于 `HistoryPanel.ts` 的同款拆法）。
 *
 * 行描述从 `Settings` **现值**生成——面板改一格就重问一次，这里永远不缓存
 * （`timing.ts` 的规矩）。控件怎么画、点了怎么写回 `updateSettings`，
 * 是面板的事；本模块不 import `config.ts`，免得把窗口对象拖进 Node 测试。
 */

// ------------------------------------------------------------------- 分组

export type SettingsTabId = 'display' | 'audio' | 'game' | 'keys';

/** 左侧分组 tab 的名册，自上而下。 */
export const SETTINGS_TABS: readonly { id: SettingsTabId; label: string }[] = [
  { id: 'display', label: '画 面' },
  { id: 'audio', label: '音 频' },
  { id: 'game', label: '游 戏' },
  { id: 'keys', label: '按 键' },
] as const;

// ------------------------------------------------------------------- 行描述

/** 开关行的四个键——都是 `Settings` 里的布尔格。 */
export type SettingsToggleKey =
  | 'fullscreen'
  | 'confirmEndTurn'
  | 'autoEndTurn'
  | 'showIncomingDamage';

/** 多态行的四个键——枚举格，一行一排可点的字（典籍筛选栏的同款控件）。 */
export type SettingsChoiceKey = 'screenShake' | 'animSpeed' | 'confirmPlay' | 'renderScale';

/** 滑块行的两个键——0..1 的音量格，界面上以 0..100 示人。 */
export type SettingsSliderKey = 'musicVolume' | 'sfxVolume';

export interface ToggleRowView {
  kind: 'toggle';
  key: SettingsToggleKey;
  label: string;
  /** 标签说不尽的补一句小字；没有就不印。 */
  desc?: string;
  on: boolean;
}

export interface ChoiceRowView {
  kind: 'choice';
  key: SettingsChoiceKey;
  label: string;
  desc?: string;
  options: { value: string | number; label: string }[];
  value: string | number;
  /** 改完才生效的警示（渲染倍率的「重载后生效」）。 */
  note?: string;
}

export interface SliderRowView {
  kind: 'slider';
  key: SettingsSliderKey;
  label: string;
  /** 0..100 的整数，账上的 0..1 经 `percentFromVolume` 换算。 */
  percent: number;
}

export type SettingsRowView = ToggleRowView | ChoiceRowView | SliderRowView;

/**
 * 三组控件 tab 的行描述（按键组自成一格，见 `keyColumns`）。选项文案与
 * todo 设计方案一字不差：屏幕震动 开/弱/关、动画速度 正常/快速/极速、
 * 打出牌前确认 关/仅稀有/全部、渲染倍率 自动/1×/2×/3×。
 */
export function settingRows(tab: Exclude<SettingsTabId, 'keys'>, s: Settings): SettingsRowView[] {
  switch (tab) {
    case 'display':
      return [
        { kind: 'toggle', key: 'fullscreen', label: '全屏', desc: '切换浏览器全屏', on: s.fullscreen },
        {
          kind: 'choice',
          key: 'renderScale',
          label: '渲染倍率',
          value: s.renderScale,
          note: '重载后生效',
          options: [
            { value: 'auto', label: '自动' },
            { value: 1, label: '1×' },
            { value: 2, label: '2×' },
            { value: 3, label: '3×' },
          ],
        },
        {
          kind: 'choice',
          key: 'screenShake',
          label: '屏幕震动',
          value: s.screenShake,
          options: [
            { value: 'full', label: '开' },
            { value: 'reduced', label: '弱' },
            { value: 'off', label: '关' },
          ],
        },
      ];
    case 'audio':
      return [
        { kind: 'slider', key: 'musicVolume', label: '音乐音量', percent: percentFromVolume(s.musicVolume) },
        { kind: 'slider', key: 'sfxVolume', label: '音效音量', percent: percentFromVolume(s.sfxVolume) },
      ];
    case 'game':
      return [
        {
          kind: 'choice',
          key: 'animSpeed',
          label: '动画速度',
          value: s.animSpeed,
          options: [
            { value: 'normal', label: '正常' },
            { value: 'fast', label: '快速' },
            { value: 'instant', label: '极速' },
          ],
        },
        { kind: 'toggle', key: 'confirmEndTurn', label: '能量未尽时确认结束回合', on: s.confirmEndTurn },
        {
          kind: 'choice',
          key: 'confirmPlay',
          label: '打出牌前确认',
          value: s.confirmPlay,
          options: [
            { value: 'off', label: '关' },
            { value: 'rare', label: '仅稀有' },
            { value: 'all', label: '全部' },
          ],
        },
        { kind: 'toggle', key: 'autoEndTurn', label: '自动结束回合', desc: '无可打牌时自动结束', on: s.autoEndTurn },
        { kind: 'toggle', key: 'showIncomingDamage', label: '显示本回合总入伤', on: s.showIncomingDamage },
      ];
  }
}

// ------------------------------------------------------------------- 滑块换算

/** 账上的 0..1 → 界面的 0..100 整数。越界与坏值夹回量程（账经 sanitize，防的是调用方）。 */
export function percentFromVolume(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(1, Math.max(0, v)) * 100);
}

/** 界面的 0..100 → 账上的 0..1。写回 `updateSettings` 前的唯一换算口。 */
export function volumeFromPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p))) / 100;
}

/**
 * 拖动：指针的设计坐标 x 落在轨道 [trackX, trackX+trackW] 的哪一格。
 * 取整到 1%——拖动实时写账（音乐音量直接改在播实例），整数格让
 * `updateSettings` 的「无变不写」挡掉同格内的抖动，不磨 localStorage。
 */
export function percentFromTrack(x: number, trackX: number, trackW: number): number {
  if (trackW <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, (x - trackX) / trackW)) * 100);
}

// ------------------------------------------------------------------- 按键组

/** 每个可绑动作的中文名。`Record` 铺满名单，24 加一个动作这里编译期就报。 */
export const KEY_ACTION_LABEL: Record<KeyAction, string> = {
  endTurn: '结束回合',
  cancel: '取消 / 关闭',
  recenter: '地图归位',
  viewDeck: '查看牌组',
  viewDraw: '查看抽牌堆',
  viewDiscard: '查看弃牌堆',
  settings: '打开设置',
  card1: '第 1 张手牌',
  card2: '第 2 张手牌',
  card3: '第 3 张手牌',
  card4: '第 4 张手牌',
  card5: '第 5 张手牌',
  card6: '第 6 张手牌',
  card7: '第 7 张手牌',
  card8: '第 8 张手牌',
  card9: '第 9 张手牌',
  card10: '第 10 张手牌',
  potion1: '丹药 1',
  potion2: '丹药 2',
  potion3: '丹药 3',
};

/** Phaser 键名后缀 → 键帽上的字。名单外的原样印（'E' / 'D' 本来就是键帽）。 */
const KEY_WORD: Record<string, string> = {
  ESC: 'Esc',
  SPACE: '空格',
  ENTER: 'Enter',
  ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5',
  SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9', ZERO: '0',
};

export function keyDisplay(key: string): string {
  return KEY_WORD[key] ?? key;
}

export interface KeyRowView {
  action: KeyAction;
  label: string;
  /** 键帽字，`keyDisplay` 已换算。 */
  key: string;
}

/** 按键组的全部行，`KEY_ACTIONS` 的声明序——与 24 战斗交互共用同一份名单。 */
export function keyRows(s: Settings): KeyRowView[] {
  return KEY_ACTIONS.map((action) => ({
    action,
    label: KEY_ACTION_LABEL[action],
    key: keyDisplay(s.keys[action]),
  }));
}

/**
 * 二十个动作一列放不下（面板高度有限），对半劈成两列：左列在前、右列
 * 在后，各 10 行。第一版只展示不许改（todo 明说可以），改键随 24 一起来。
 */
export function keyColumns(s: Settings): [KeyRowView[], KeyRowView[]] {
  const rows = keyRows(s);
  const half = Math.ceil(rows.length / 2);
  return [rows.slice(0, half), rows.slice(half)];
}
