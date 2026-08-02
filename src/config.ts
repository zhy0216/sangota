/** Global tuning constants and the shared 国风 palette. */

/**
 * Design space. Every layout constant, scene coordinate and font size in this
 * project is expressed in these units — never in physical pixels.
 */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * 「渲染倍率」设置项的取值 (todos/21 t4)。与 `src/state/settings.ts` 的
 * `Settings['renderScale']` 同构——那边才是整本设置的事实源，这里只认得
 * 自己要用的这一格。
 */
export type RenderScaleSetting = 'auto' | 1 | 2 | 3;

/**
 * 设置账在 localStorage 里的键。字面量与 `src/state/settings.ts` 的
 * `SETTINGS_KEY` **刻意重复**：本文件在模块加载期跑、又被 theme/场景成片
 * import，若 import settings.ts 就把依赖箭头钉死成 config→settings，将来
 * settings 层想引这里的调色板即成环。两处字面量的同步由
 * `tests/renderScale.test.ts` 盯着。
 */
const SETTINGS_STORAGE_KEY = 'sangota.settings.v1';

/**
 * 从设置账的原始 JSON 里解析 renderScale 一格。纯函数，给测试直接喂串：
 * 账不存在 / 坏 JSON / 缺字段 / 枚举外的值（字符串数字、0、4、2.5）一律
 * 落回 'auto'——解析失败不该把 Retina 用户按在 1× 的模糊里。
 */
export function parseRenderScale(raw: string | null): RenderScaleSetting {
  if (!raw) return 'auto';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'auto';
  }
  if (typeof parsed !== 'object' || parsed === null) return 'auto';
  const v = (parsed as Record<string, unknown>).renderScale;
  return v === 1 || v === 2 || v === 3 ? v : 'auto';
}

/** 现读设置账。存储缺席或敌意（访问即抛）与「没设过」同判：'auto'。 */
const storedRenderScale = (): RenderScaleSetting => {
  try {
    return parseRenderScale(globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY) ?? null);
  } catch {
    return 'auto';
  }
};

/**
 * Physical pixels per design pixel.
 *
 * Phaser 3 has no HiDPI mode: it renders into a backing store the size of the
 * game and lets CSS stretch that to fill the parent. On a Retina panel with a
 * window wider than the design size that is a ~2.4x upscale, which is why text
 * and UI look soft. The fix is to size the backing store to the pixels the
 * canvas will actually occupy, then give every scene camera a matching zoom so
 * scene code keeps working in design units.
 *
 * Computed once at boot. Enlarging the window afterwards falls back to Phaser's
 * FIT scaling, so it softens gradually rather than re-laying out mid-run.
 *
 * todos/21 t4：设置里的「渲染倍率」在 auto 之外开一条旁路——1/2/3 直接用，
 * 'auto' 走下面原有的 dpr×fit 逻辑（Retina 的锐利全靠它，**不动**）。设置
 * 改完只能重载生效：本值钉死 CANVAS_WIDTH/RENDER_SCALE，全项目按它烘焙
 * 纹理，面板侧的职责是提示「重载后生效」。
 */
const rawScale = ((): number => {
  if (typeof window === 'undefined') return 1;
  const pick = storedRenderScale();
  if (pick !== 'auto') return pick;
  const dpr = window.devicePixelRatio || 1;
  const fit = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT);
  // Floor of 1 keeps small windows legible; ceiling of 3 bounds texture memory.
  return Math.max(1, Math.min(fit * dpr, 3));
})();

/** Backing-store size. Derived first so RENDER_SCALE stays exact after rounding. */
export const CANVAS_WIDTH = Math.round(GAME_WIDTH * rawScale);
export const RENDER_SCALE = CANVAS_WIDTH / GAME_WIDTH;
export const CANVAS_HEIGHT = Math.round(GAME_HEIGHT * RENDER_SCALE);

/**
 * Ink-wash palette. Kept as numbers because Phaser's Graphics/tint APIs want
 * numbers; `css()` is for anything that goes through a style object.
 */
export const C = {
  inkDeep: 0x0d0b09,
  ink: 0x1a1613,
  inkSoft: 0x2b241d,
  paper: 0xe8dcc0,
  paperDim: 0xb8a882,
  paperFaint: 0x7a6f5a,
  cinnabar: 0xc8392b,
  cinnabarBright: 0xe8543c,
  gold: 0xc9a227,
  goldBright: 0xf0d67a,
  jade: 0x4a7c6f,
  blood: 0x8b2020,
  shadow: 0x000000,
} as const;

export const css = (n: number): string => '#' + n.toString(16).padStart(6, '0');

/** macOS-first CJK serif stacks — no webfont fetch, so nothing blocks boot. */
export const FONT_SERIF = '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif';
export const FONT_BRUSH = '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif';

/**
 * Map *geometry* — the same for every act. How many floors an act has and where
 * its fixed rooms sit is per-act instead and travels as an `ActLayout`
 * (`src/map/generateMap.ts`), because todos/09 gives 第二幕 a different shape.
 */
export const MAP = {
  cols: 7,
  /**
   * 随机行走的条数，也就是节点密度的总闸。原版尖塔跑 6 条，但它的行走
   * 大量重叠，整幕落在 ~45 间上下；我们的 6 条实测平均 60.1 间（500 seed），
   * 每层挤到 4-5 个。收到 4 条落在 46.9 间、每层 2-4 个，才是原版的剪影。
   * 动这个数等于重排每一张既有地图——SAVE_VERSION 必须跟着走。
   */
  paths: 4,
  /**
   * Share of walkable nodes that should offer more than one onward route.
   * Extra links use an isolated RNG after rooms are typed, so this increases
   * route choice without changing node density, room rolls or visual jitter.
   */
  branchTarget: 0.3,
  colSpacing: 148,
  rowSpacing: 118,
  jitterX: 26,
  jitterY: 16,
  /** Tuned so map width lands exactly on GAME_WIDTH — the map scrolls vertically only. */
  marginX: 196,
  marginTop: 200,
  marginBottom: 150,
  nodeRadius: 34,
} as const;
