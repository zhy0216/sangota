/** Global tuning constants and the shared 国风 palette. */

/**
 * Design space. Every layout constant, scene coordinate and font size in this
 * project is expressed in these units — never in physical pixels.
 */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

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
 */
const rawScale = ((): number => {
  if (typeof window === 'undefined') return 1;
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
  paths: 6,
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
