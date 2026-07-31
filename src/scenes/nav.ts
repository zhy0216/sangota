import Phaser from 'phaser';
import { fireRunHook } from '../combat/relics';
import type { MapNode } from '../map/types';
import { roomCommit } from '../rooms/commit';
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

/** The one way back. Wakes the sleeping map, or rebuilds it if it is gone. */
export function returnToMap(from: Phaser.Scene): void {
  if (from.scene.isSleeping('Map')) {
    from.scene.wake('Map');
    from.scene.stop();
    return;
  }
  from.scene.start('Map');
}
