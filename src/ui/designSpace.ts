import Phaser from 'phaser';
import { RENDER_SCALE } from '../config';

/**
 * Put a scene's camera into design space.
 *
 * The canvas is sized in physical pixels (see RENDER_SCALE), so the camera is
 * zoomed by the same factor and its origin moved to the top-left. With origin
 * (0, 0) the transform collapses to `screen = (world - scroll) * zoom`, which
 * means scroll values, object positions and `getWorldPoint` all stay in design
 * units — input hit-testing included.
 *
 * Note: camera bounds clamping (`setBounds`) assumes an origin of 0.5, so
 * scenes using this must clamp scroll themselves.
 */
export function useDesignSpace(scene: Phaser.Scene): Phaser.Cameras.Scene2D.Camera {
  const cam = scene.cameras.main;
  cam.setOrigin(0, 0);
  cam.setZoom(RENDER_SCALE);
  return cam;
}

/** Convert a pointer position (canvas pixels) into design units. */
export function toDesign(value: number): number {
  return value / RENDER_SCALE;
}
