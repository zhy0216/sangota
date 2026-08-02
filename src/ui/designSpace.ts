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

/**
 * Lock an object and every nested child to the camera (scrollFactor 0 all the
 * way down). Rendering multiplies scrollFactors along the container chain, so
 * a fixed root already draws its children screen-locked — but the hit test
 * reads the scrollFactor of the interactive leaf itself (Phaser
 * InputManager.hitTest), and `Container.setScrollFactor(0, 0, true)` cascades
 * only one level. On a scrolled camera (the map, scrollY ≈ 1400) that leaves
 * every zone inside a fixed container hit-tested at world coordinates — pinned
 * panels whose buttons cannot be clicked. Call this after (re)building any
 * interactive subtree that must stay put while the camera scrolls.
 */
export function pinToCamera<T extends Phaser.GameObjects.GameObject>(obj: T): T {
  (obj as { setScrollFactor?: (x: number) => unknown }).setScrollFactor?.(0);
  if (obj instanceof Phaser.GameObjects.Container) {
    for (const child of obj.list) pinToCamera(child);
  }
  return obj;
}
