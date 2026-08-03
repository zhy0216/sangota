/** Build-time flag injected only by `bun run dev:scene <name>`. */
export const DEV_SCENE_MENU = '__menu__';

export const DEV_SCENE_NAME =
  import.meta.env.DEV && import.meta.env.VITE_DEV_SCENE
    ? import.meta.env.VITE_DEV_SCENE.trim()
    : '';

export const isDevSceneMode = (): boolean => DEV_SCENE_NAME.length > 0;
