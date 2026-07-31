import Phaser from 'phaser';

/**
 * 覆盖层栈 — one Esc listener per scene, owned here, delivered to the top of the
 * stack only.
 *
 * Before this, every overlay bound its own `keydown-ESC`. Two of them up at once
 * (a card grid opened from a room panel) both fired on the same key press, and
 * the one underneath closed first. Scenes with hotkeys of their own — the map's
 * SPACE/Esc, combat's end-turn — ask `isOverlayOpen` and stand down instead.
 *
 * This is orthogonal to `freezeSceneInput` in `CardGrid`: that stops Game
 * Objects below from being clicked, this decides who owns the keyboard.
 */

export interface OverlaySpec {
  /** Debug label, and what `top` reports. */
  id: string;
  /** False makes the overlay mandatory: Esc and click-outside do nothing. */
  dismissable: boolean;
  /** Custom Esc behaviour. Default: dismiss, if dismissable. */
  onEsc?: () => void;
  /** Tear the overlay down. Called at most once. */
  onDismiss: () => void;
}

export interface OverlayHandle {
  /** Render depth this overlay owns; children may use depth + 1..99. */
  readonly depth: number;
  /** Pop without dismissing — for an overlay that closed itself. */
  release(): void;
}

interface Entry extends OverlaySpec {
  depth: number;
}

/** Above every scene's own layers (Combat 200, Map 500). */
const BASE_DEPTH = 900;
const STEP = 100;

const stacks = new WeakMap<Phaser.Scene, Entry[]>();
const listeners = new WeakMap<Phaser.Scene, () => void>();

const stackOf = (scene: Phaser.Scene): Entry[] => {
  let stack = stacks.get(scene);
  if (!stack) {
    stack = [];
    stacks.set(scene, stack);
  }
  return stack;
};

export const isOverlayOpen = (scene: Phaser.Scene): boolean => stackOf(scene).length > 0;

/** Depth of the topmost overlay, or the base when nothing is up. */
export const overlayDepth = (scene: Phaser.Scene): number => {
  const stack = stackOf(scene);
  return stack.length ? stack[stack.length - 1].depth : BASE_DEPTH;
};

export function pushOverlay(scene: Phaser.Scene, spec: OverlaySpec): OverlayHandle {
  const stack = stackOf(scene);
  const entry: Entry = { ...spec, depth: BASE_DEPTH + stack.length * STEP };
  stack.push(entry);

  if (!listeners.has(scene)) {
    const onEsc = (): void => {
      const top = stackOf(scene).at(-1);
      if (!top) return;
      if (top.onEsc) top.onEsc();
      else if (top.dismissable) top.onDismiss();
    };
    scene.input.keyboard?.on('keydown-ESC', onEsc);
    // A scene shutting down takes its whole stack with it.
    const onShutdown = (): void => {
      scene.input.keyboard?.off('keydown-ESC', onEsc);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
      listeners.delete(scene);
      stacks.delete(scene);
    };
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
    listeners.set(scene, onShutdown);
  }

  let released = false;
  return {
    depth: entry.depth,
    release(): void {
      if (released) return;
      released = true;
      const live = stackOf(scene);
      const at = live.indexOf(entry);
      if (at >= 0) live.splice(at, 1);
    },
  };
}
