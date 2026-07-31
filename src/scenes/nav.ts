import Phaser from 'phaser';
import { fireRunHook } from '../combat/relics';
import type { MapNode } from '../map/types';
import { roomCommit } from '../rooms/commit';
import { bossOfferPending } from '../rooms/fight';
import { getRun, type RunState } from '../state/run';
import { writeSave } from '../state/save';
import type { MapScene } from './MapScene';

/**
 * 场景导航 — the two moves between the map and everything else, in one place so
 * the sleep/wake pairing cannot drift apart.
 *
 * `MapScene` is only ever a *type* here, so this module and that one can import
 * each other without a runtime cycle.
 */

/**
 * Commit to a node and open whatever is on it. Fights take over the scene;
 * everything else runs as a second scene on top of a sleeping map.
 */
export function enterRoom(map: MapScene, node: MapNode): void {
  const run = map.run;

  // Through the gate, not around it: 行商符节 pays 5 资财 on entering a room, and
  // a save reloaded on the same node would otherwise pay it again every time.
  roomCommit(run, node.id).once('enter', () => {
    for (const id of fireRunHook(run, 'roomEnter', node.type)) map.relicBar.flash(id);
  });
  map.refreshHud();

  // 存档 (todos/08). Here rather than in `MapScene.onNodeClick` because this is
  // where the step is *finished*: `travelTo` has run, the node is committed and
  // 行商符节 has been paid. Saving a beat earlier would restore a run standing on
  // a node whose entry hooks had not fired, and they are gated `once` — so they
  // would never fire at all.
  writeSave(run, null);

  switch (node.type) {
    case 'monster':
    case 'elite':
    case 'boss':
      // The beat before the fade is deliberate: the node lights up as the
      // player's, and only then does the map go dark.
      map.time.delayedCall(460, () => {
        map.cameras.main.fadeOut(320, 8, 6, 4);
        map.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
          map.scene.start('Combat', { nodeType: node.type }),
        );
      });
      break;

    case 'rest':
    case 'shop':
    case 'event':
    case 'treasure':
      // Sleep, not stop: a sleeping scene neither updates nor takes input, so
      // the map's scroll position, node views, drawer and tooltip all survive
      // the visit with no save state and no rebuild.
      map.scene.launch('Room', { nodeId: node.id });
      map.scene.sleep();
      break;
  }
}

/**
 * The act is over: the player is standing on the 首领 node and the 战利品 chest
 * has been answered.
 *
 * Both halves are needed. `currentNodeId === bossId` alone is true from the
 * moment the fight is committed to, and the chest is answered *inside*
 * `CombatScene` before the ordinary spoils — so this only reads true on the way
 * out, which is exactly when the act should end. A run that ended in defeat
 * never reaches here: `showDefeat` goes to 「Title」 and not through this door.
 */
export function actCleared(run: RunState): boolean {
  const bossId = run.map.bossId;
  return run.currentNodeId === bossId && !bossOfferPending(run, bossId);
}

/**
 * The one way back. Wakes the sleeping map, or rebuilds it if it is gone —
 * except when the act is finished, which routes through 幕间 instead.
 *
 * The act check lives here rather than in `CombatScene` on purpose: this is the
 * single funnel every room and every fight leaves through, so an act can only
 * ever end in one place, and `advanceAct` can only ever be reached one way.
 */
export function returnToMap(from: Phaser.Scene): void {
  const run = getRun();
  // The single funnel every room and every fight leaves through, so it is also
  // the one place that can promise "whatever just happened is on disk". A fight
  // is over by the time this runs, which is what takes `combat` back to null.
  writeSave(run, null);

  if (actCleared(run)) {
    // A map left asleep under the interlude would wake up still drawing the act
    // that just ended, complete with its stale node views.
    if (from.scene.isSleeping('Map')) from.scene.stop('Map');
    from.scene.start('Interlude');
    return;
  }

  if (from.scene.isSleeping('Map')) {
    from.scene.wake('Map');
    from.scene.stop();
    return;
  }
  from.scene.start('Map');
}
