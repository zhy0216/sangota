import Phaser from 'phaser';
import { C, CANVAS_HEIGHT, CANVAS_WIDTH, css } from './config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { MapScene } from './scenes/MapScene';
import { CombatScene } from './scenes/CombatScene';
import { RoomScene } from './scenes/RoomScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  // Backing store in physical pixels; scenes still work in design units via
  // the camera zoom applied by useDesignSpace().
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  backgroundColor: css(C.inkDeep),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: false,
    powerPreference: 'high-performance',
  },
  // RoomScene sits after MapScene: a room runs as a second scene on top of a
  // sleeping map, and render order follows this array.
  scene: [BootScene, TitleScene, MapScene, CombatScene, RoomScene],
};

const game = new Phaser.Game(config);

if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
