import Phaser from 'phaser';

export interface ContentBounds {
  /** Pixel bounds of the non-transparent content within the source image. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  /** Source image size, for converting to display units. */
  imageWidth: number;
  imageHeight: number;
}

const cache = new Map<string, ContentBounds>();
const ALPHA_THRESHOLD = 12;

/**
 * Measure where the actual artwork sits inside a cut-out plate.
 *
 * Background removal leaves a transparent margin whose size varies per image,
 * so scaling and positioning by the image rectangle makes characters float
 * above the ground and come out at inconsistent sizes. Measuring the opaque
 * content once at boot lets the scene place actors by their real silhouette.
 */
export function measureSprite(scene: Phaser.Scene, key: string): ContentBounds | null {
  const cached = cache.get(key);
  if (cached) return cached;
  if (!scene.textures.exists(key)) return null;

  const source = scene.textures.get(key).getSourceImage();
  const imageWidth = source.width;
  const imageHeight = source.height;
  if (!imageWidth || !imageHeight) return null;

  let data: Uint8ClampedArray;
  try {
    const canvas = Phaser.Display.Canvas.CanvasPool.create(null, imageWidth, imageHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    data = ctx.getImageData(0, 0, imageWidth, imageHeight).data;
    Phaser.Display.Canvas.CanvasPool.remove(canvas);
  } catch (err) {
    console.warn(`[spriteBounds] could not measure ${key}:`, err);
    return null;
  }

  let top = imageHeight;
  let bottom = -1;
  let left = imageWidth;
  let right = -1;

  for (let y = 0; y < imageHeight; y++) {
    const row = y * imageWidth * 4;
    for (let x = 0; x < imageWidth; x++) {
      if (data[row + x * 4 + 3] <= ALPHA_THRESHOLD) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  // Fully transparent (or opaque JPEG): fall back to the whole rectangle.
  if (bottom < 0) {
    top = 0;
    left = 0;
    bottom = imageHeight - 1;
    right = imageWidth - 1;
  }

  const bounds: ContentBounds = {
    left,
    right,
    top,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    imageWidth,
    imageHeight,
  };
  cache.set(key, bounds);
  return bounds;
}

/**
 * Scale an origin-(0.5, 1) sprite so its *content* is `targetHeight` tall and
 * its feet land exactly on the container's y = 0 line, horizontally centred on
 * the content rather than on the image.
 */
export function groundSprite(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Image,
  targetHeight: number,
): void {
  const bounds = measureSprite(scene, sprite.texture.key);
  if (!bounds) {
    sprite.setScale(targetHeight / sprite.height);
    sprite.setPosition(0, 0);
    return;
  }

  const scale = targetHeight / bounds.height;
  sprite.setScale(scale);

  const bottomPadding = bounds.imageHeight - 1 - bounds.bottom;
  const contentCentreX = (bounds.left + bounds.right) / 2;
  sprite.setPosition(
    (bounds.imageWidth / 2 - contentCentreX) * scale,
    bottomPadding * scale,
  );
}

/** Content width in display units once `groundSprite` has been applied. */
export function contentWidthAt(
  scene: Phaser.Scene,
  key: string,
  targetHeight: number,
): number {
  const bounds = measureSprite(scene, key);
  if (!bounds) return targetHeight * 0.55;
  return bounds.width * (targetHeight / bounds.height);
}
