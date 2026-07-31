import type Phaser from 'phaser';
import type { EnemyState } from '../combat/types';

/**
 * The on-screen half of one combatant. Types only — the objects themselves are
 * built by `CombatScene.makeActorView`, which is where the scene's palette,
 * baseline and depth table live.
 *
 * They moved out of `CombatScene` so that `EnemyRoster` can own a *collection*
 * of them. Before that every enemy's presence on screen was five unrelated
 * objects created in `create()` and never touched again: the `ui` container
 * holding the health bar was built and then thrown away without being returned,
 * so an enemy's bar could not be moved after it was made, and the name label
 * was found by `getByName('name-' + id)` — a lookup with no way to destroy the
 * thing it found. A body that joins mid-fight (召唤 / 分裂) could therefore
 * neither be drawn nor cleaned up, which is why five encounters are still
 * fenced off in `PENDING_ENCOUNTERS`.
 */
export interface ActorView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  /**
   * Parent of the bar, the HP text, the block badge and the status row. Held so
   * the whole readout can move with the body — without it the bar stays where
   * the actor was born.
   */
  ui: Phaser.GameObjects.Container;
  bar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  blockBadge: Phaser.GameObjects.Container;
  blockText: Phaser.GameObjects.Text;
  statusRow: Phaser.GameObjects.Container;
  /** Display height in design units — used to aim effects at the torso. */
  height: number;
  barWidth: number;
  /** Home positions, so lunges and recoils always have something to return to. */
  baseX: number;
  spriteBaseX: number;
  baseScaleY: number;
  /**
   * Trailing HP value. Drains a beat behind the real bar so the player can see
   * how big the hit was after the fact.
   */
  ghost: { value: number };
}

/** Everything an enemy view is, minus what the roster attaches when it lands. */
export interface EnemyViewParts extends ActorView {
  enemy: EnemyState;
  intent: Phaser.GameObjects.Container;
  intentText: Phaser.GameObjects.Text;
  intentBg: Phaser.GameObjects.Graphics;
  /** Held rather than looked up by name, so it can be moved and destroyed. */
  nameText: Phaser.GameObjects.Text;
  hit: Phaser.GameObjects.Zone;
  /** Unscaled width of the hit zone, so crowding can shrink it proportionally. */
  hitWidth: number;
  lastIntentLabel: string;
}

export interface EnemyView extends EnemyViewParts {
  /**
   * Scale the body is drawn at. 1 until four or more enemies are alive at once,
   * which only 召唤 can produce.
   */
  crowdScale: number;
  /**
   * Move every piece of this enemy — body, readout, intent badge, name and hit
   * zone — to one x, and **update `baseX` with it**.
   *
   * `lunge`, `recoil` and `playDeath` all treat `baseX` as home. Moving the
   * container without it would send a re-slotted enemy snapping back to where
   * it used to stand the first time it swung.
   */
  moveTo(x: number, animate: boolean): Promise<void>;
}
