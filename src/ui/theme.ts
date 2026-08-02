import Phaser from 'phaser';
import { getAudio } from '../audio/sfx';
import { C, css, FONT_BRUSH, FONT_SERIF, RENDER_SCALE } from '../config';

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

/**
 * `resolution` rasterises the text's internal canvas at RENDER_SCALE so it
 * stays sharp under the camera zoom. Without it, glyphs are drawn at design
 * size and then magnified — the exact blur the zoom is there to avoid.
 */
export const bodyStyle = (size: number, color: number = C.paper): TextStyle => ({
  fontFamily: FONT_SERIF,
  fontSize: `${size}px`,
  color: css(color),
  resolution: RENDER_SCALE,
});

export const brushStyle = (size: number, color: number = C.paper): TextStyle => ({
  fontFamily: FONT_BRUSH,
  fontSize: `${size}px`,
  color: css(color),
  resolution: RENDER_SCALE,
});

export interface InkPanelOpts {
  alpha?: number;
  border?: number;
  radius?: number;
}

/**
 * Ink-wash panel: a dark slab with a hairline gold border and a slightly
 * lighter inner bevel. Returned as a Graphics so callers can position it.
 */
export function inkPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: InkPanelOpts = {},
): Phaser.GameObjects.Graphics {
  return paintInkPanel(scene.add.graphics(), x, y, w, h, opts);
}

/**
 * The same panel painted into a Graphics that already exists — for tooltips,
 * which resize to their text on every hover and shouldn't leak an object per
 * repaint.
 */
export function paintInkPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: InkPanelOpts = {},
): Phaser.GameObjects.Graphics {
  const { alpha = 0.86, border = C.gold, radius = 6 } = opts;
  g.clear();
  g.fillStyle(C.inkDeep, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(1, border, 0.55);
  g.strokeRoundedRect(x, y, w, h, radius);
  g.lineStyle(1, C.paper, 0.07);
  g.strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, Math.max(1, radius - 2));
  return g;
}

/** A double gold ring, used around portraits and the boss node. */
export function goldRing(
  scene: Phaser.Scene,
  x: number,
  y: number,
  r: number,
  color: number = C.gold,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.lineStyle(2.5, color, 0.9);
  g.strokeCircle(x, y, r);
  g.lineStyle(1, color, 0.4);
  g.strokeCircle(x, y, r + 5);
  return g;
}

/**
 * Circular crop for a portrait image, given the final on-screen centre.
 *
 * A geometry mask is rendered through the camera transform, so a mask shape
 * left at the default scroll factor drifts away from a scroll-locked HUD
 * element as soon as the camera moves. `fixed` pins the shape to the viewport
 * to match a `setScrollFactor(0)` target.
 */
export function circleMask(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Image,
  x: number,
  y: number,
  r: number,
  fixed = true,
): void {
  const shape = scene.make.graphics({}, false);
  shape.fillStyle(0xffffff);
  shape.fillCircle(x, y, r);
  if (fixed) shape.setScrollFactor(0);
  target.setMask(shape.createGeometryMask());
}

/** Vertical gradient strip — used to fade the map under the HUD bars. */
export function gradientStrip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  fromAlpha: number,
  toAlpha: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillGradientStyle(color, color, color, color, fromAlpha, fromAlpha, toAlpha, toAlpha);
  g.fillRect(x, y, w, h);
  return g;
}

export interface InkButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  accent?: number;
  onClick: () => void;
}

/** Bordered brush-script button with a hover lift. */
export function inkButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  opts: InkButtonOpts,
): Phaser.GameObjects.Container {
  const { width = 220, height = 64, fontSize = 30, accent = C.gold, onClick } = opts;
  const container = scene.add.container(x, y);

  const bg = scene.add.graphics();
  const paint = (hover: boolean) => {
    bg.clear();
    bg.fillStyle(hover ? C.cinnabar : C.inkDeep, hover ? 0.92 : 0.8);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, 4);
    bg.lineStyle(2, hover ? C.goldBright : accent, hover ? 1 : 0.7);
    bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 4);
    bg.lineStyle(1, C.paper, hover ? 0.25 : 0.1);
    bg.strokeRoundedRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, 2);
  };
  paint(false);

  const text = scene.add
    .text(0, 0, label, brushStyle(fontSize, C.paper))
    .setOrigin(0.5)
    .setLetterSpacing(6);

  // Hit target lives on a Zone: Containers have no Origin component, so their
  // own hit-area coordinates don't get normalised the way Zones' do.
  const hit = scene.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });

  container.add([bg, text, hit]);
  container.setSize(width, height);

  // UI 音 (todos/20 b6)：按钮工厂一处接线，全游戏按钮自动有声。
  // `pointerover` 每次进入只发一次（不是逐帧事件），hover 不会连响；
  // 扫过一排按钮的极端情况还有 `Audio.play` 的 40ms 限流兜底。
  const audio = getAudio(scene);

  hit.on('pointerover', () => {
    audio.play('ui-hover');
    paint(true);
    scene.tweens.add({ targets: container, scale: 1.04, duration: 120, ease: 'Quad.easeOut' });
  });
  hit.on('pointerout', () => {
    paint(false);
    scene.tweens.add({ targets: container, scale: 1, duration: 120, ease: 'Quad.easeOut' });
  });
  hit.on('pointerdown', () => {
    audio.play('ui-click');
    scene.tweens.add({ targets: container, scale: 0.97, duration: 60, yoyo: true });
  });
  // onClick 必须在 pointerup：覆盖层（设置/战史）的「点面板外关闭」听的是
  // scene 级 pointerdown，而 Phaser 先发对象级、后发 scene 级——pointerdown
  // 里开面板，开门的这次按下会立刻命中刚挂上的关闭监听（按钮都在面板外）。
  hit.on('pointerup', () => onClick());

  return container;
}
