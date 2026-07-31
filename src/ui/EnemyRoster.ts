import Phaser from 'phaser';
import type { EnemyState } from '../combat/types';
import type { EnemyView, EnemyViewParts } from './actorView';

/**
 * 敌阵 — the set of enemy views on screen, as a thing that can be added to and
 * taken from.
 *
 * `CombatScene` used to build one view per enemy in `create()` and never again.
 * Everything that follows from that is a bug the rules layer already supports
 * and the screen cannot show: a 召唤 arrives invisible and unclickable, a
 * 分裂 leaves the parent's corpse standing forever (`splitEnemy` deliberately
 * emits no `death`, so `playDeath` never runs), and an enemy that 遁走 freezes
 * mid-stride. Five encounters were fenced off in `PENDING_ENCOUNTERS` for
 * exactly this; todos/15 emptied that table and they now ship.
 *
 * This class owns *where* bodies stand and *when* they stop existing. What a
 * body looks like is still the scene's — `build` is handed in, because the
 * palette, the baseline and the sprite bounds all live there.
 *
 * The event handlers that consume 召唤 / 分裂 / 遁走 are the scene's, not this
 * class's: they decide *what happened* through `src/ui/enemyStage.ts` and then
 * say it here in this vocabulary.
 */

export interface EnemyRosterOptions {
  /** Ground line every body stands on, in design units. */
  baselineY: number;
  depth: { actors: number; actorUi: number };
  /** Builds the Game Objects for one enemy, standing at `x`. */
  build: (enemy: EnemyState, x: number) => EnemyViewParts;
  onOver?: (view: EnemyView, over: boolean) => void;
  onClick?: (view: EnemyView) => void;
}

/**
 * Where bodies stand.
 *
 * **The one, two and three-body coordinates are frozen.** Every encounter in
 * the game today has three enemies or fewer, and the golden fights were tuned
 * with the sprites at these exact x's; a nudge would move every 突进 and every
 * 飘字 in the whole game for no reason.
 *
 * Four and up is new ground — only 召唤 and 分裂 can produce it — and spreads
 * evenly about the middle body's column instead.
 */
const FIXED_SLOTS: Record<number, number[]> = {
  1: [872],
  2: [782, 1000],
  3: [712, 880, 1048],
};

const CROWD_CENTRE = 880;
const CROWD_MAX_GAP = 168;
const CROWD_SPAN = 460;

export function slotXs(count: number): number[] {
  if (count <= 1) return [...FIXED_SLOTS[1]];
  if (count <= 3) return [...FIXED_SLOTS[count]];
  const gap = Math.min(CROWD_MAX_GAP, CROWD_SPAN / (count - 1));
  const left = CROWD_CENTRE - (gap * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => left + i * gap);
}

/** Bodies shrink as the line gets long, but never past legibility. */
export function crowdScale(count: number): number {
  if (count <= 3) return 1;
  return Phaser.Math.Clamp(1 - 0.06 * (count - 3), 0.78, 1);
}

/** How long a re-slot takes. Callers must await it — see `layout`. */
const MOVE_MS = 260;

export class EnemyRoster {
  private views = new Map<string, EnemyView>();
  /** Insertion order, which is slot order. Survives a death, unlike the map. */
  private order: string[] = [];

  constructor(
    private scene: Phaser.Scene,
    private opts: EnemyRosterOptions,
  ) {}

  /**
   * Build and register one enemy's view. Does **not** lay out: a summoned body
   * wants to appear at its summoner's feet and walk to its slot, so placement
   * is the caller's next call, not this one's side effect.
   */
  add(enemy: EnemyState, x: number = CROWD_CENTRE): EnemyView {
    const parts = this.opts.build(enemy, x);
    const view: EnemyView = Object.assign(parts, {
      crowdScale: 1,
      moveTo: (to: number, animate: boolean): Promise<void> => this.moveTo(view, to, animate),
    });

    parts.hit.on('pointerover', () => this.opts.onOver?.(view, true));
    parts.hit.on('pointerout', () => this.opts.onOver?.(view, false));
    parts.hit.on('pointerup', () => this.opts.onClick?.(view));

    this.views.set(enemy.id, view);
    if (!this.order.includes(enemy.id)) this.order.push(enemy.id);
    return view;
  }

  get(id: string): EnemyView | undefined {
    return this.views.get(id);
  }

  /**
   * Destroy every Game Object this view owns and forget it.
   *
   * For 分裂 and 遁走 — a corpse is *not* removed, because a death is supposed
   * to leave a faded body where it fell. Destroying `ui` takes the bar, the HP
   * text, the block badge and the status chips with it, since they are its
   * children.
   */
  remove(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.scene.tweens.killTweensOf([view.sprite, view.container, view.ui, view.intent]);
    view.hit.destroy();
    view.intent.destroy();
    view.nameText.destroy();
    view.ui.destroy();
    view.container.destroy();
    this.views.delete(id);
    this.order = this.order.filter((other) => other !== id);
  }

  /** Views of enemies still in the fight, in slot order. */
  living(): EnemyView[] {
    return this.order
      .map((id) => this.views.get(id))
      .filter((view): view is EnemyView => !!view && view.enemy.alive && !view.enemy.escaped);
  }

  all(): Iterable<EnemyView> {
    return this.views.values();
  }

  get size(): number {
    return this.views.size;
  }

  /**
   * Re-slot the living bodies and rescale them for how many there are.
   *
   * **Await it.** A hit zone that is still travelling is a hit zone the player
   * can click through to nothing, and a summon animated without awaiting leaves
   * its zone at the spawn point for a frame.
   *
   * Call it when the living count *grows* (召唤, 分裂). Not on a death and not
   * on a 遁走: `EnemyState.slot` exists so that positions stay put once a body
   * is gone, and sliding the survivors would move the target out from under a
   * click that is already in flight.
   */
  async layout(animate: boolean): Promise<void> {
    const living = this.living();
    const xs = slotXs(living.length);
    const scale = crowdScale(living.length);

    await Promise.all(
      living.map((view, i) => {
        this.applyScale(view, scale, animate);
        return this.moveTo(view, xs[i], animate);
      }),
    );
  }

  /** Keyboard target selection (todos/24) hangs off this. */
  focus(index: number): void {
    const living = this.living();
    living.forEach((view, i) => this.opts.onOver?.(view, i === index));
  }

  destroy(): void {
    for (const id of [...this.order]) this.remove(id);
    this.views.clear();
    this.order = [];
  }

  // ------------------------------------------------------------------ private

  private applyScale(view: EnemyView, scale: number, animate: boolean): void {
    if (view.crowdScale === scale) return;
    view.crowdScale = scale;

    // The container's origin sits on the baseline and the sprite's origin is
    // its feet, so scaling here keeps every body planted on the same ground.
    if (animate) {
      this.scene.tweens.add({
        targets: view.container,
        scale,
        duration: MOVE_MS,
        ease: 'Cubic.easeOut',
      });
    } else {
      view.container.setScale(scale);
    }
    this.placeFurniture(view, view.baseX, scale);
  }

  private moveTo(view: EnemyView, x: number, animate: boolean): Promise<void> {
    // `baseX` is home for `lunge`, `recoil` and `playDeath`. Updated with the
    // move, or a re-slotted body snaps back to its old column when it swings.
    view.baseX = x;
    if (!animate) {
      view.container.x = x;
      this.placeFurniture(view, x, view.crowdScale);
      return Promise.resolve();
    }

    this.placeFurniture(view, x, view.crowdScale, true);
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: view.container,
        x,
        duration: MOVE_MS,
        ease: 'Cubic.easeOut',
        onComplete: () => resolve(),
      });
    });
  }

  /** Everything that hangs off the body: readout, badge, name, hit zone. */
  private placeFurniture(view: EnemyView, x: number, scale: number, animate = false): void {
    const baseline = this.opts.baselineY;
    const height = view.height * scale;
    // Pinned above the sprite but never under the top HUD.
    const intentY = baseline + Math.max(Math.min(-height - 30, -70), -(baseline - 42));

    // `Zone.setSize` resizes the input hit area with the object by default,
    // which is the whole reason the zone is a Zone and not a rectangle.
    view.hit.setSize(Math.max(60, view.hitWidth * scale), height);
    view.hit.setPosition(x, baseline - height / 2);

    if (!animate) {
      view.ui.x = x;
      view.intent.setPosition(x, intentY);
      view.nameText.x = x;
      return;
    }
    this.scene.tweens.add({
      targets: [view.ui, view.nameText],
      x,
      duration: MOVE_MS,
      ease: 'Cubic.easeOut',
    });
    this.scene.tweens.add({
      targets: view.intent,
      x,
      y: intentY,
      duration: MOVE_MS,
      ease: 'Cubic.easeOut',
    });
  }
}
