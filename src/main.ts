import Phaser from 'phaser';
import { C, CANVAS_HEIGHT, CANVAS_WIDTH, css } from './config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { BlessingScene } from './scenes/BlessingScene';
import { MapScene } from './scenes/MapScene';
import { CombatScene } from './scenes/CombatScene';
import { RoomScene } from './scenes/RoomScene';
import { InterludeScene } from './scenes/InterludeScene';
import { SummaryScene } from './scenes/SummaryScene';
import { CompendiumScene } from './scenes/CompendiumScene';
import { CustomScene } from './scenes/CustomScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  // Cards use the right button for in-game interaction; the browser menu must
  // never steal that click once the pointer is over the game canvas.
  disableContextMenu: true,
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
  // sleeping map, and render order follows this array. BlessingScene sits
  // between the title and the map because that is the order a run walks them:
  // 出征 hands off to 拜别, and only 拜别 opens the map.
  scene: [
    BootScene,
    TitleScene,
    BlessingScene,
    MapScene,
    CombatScene,
    RoomScene,
    InterludeScene,
    SummaryScene,
    // 典籍 (todos/23 u4) 走的是标题页往返,从不与上面任何场景同台,排尾即可。
    CompendiumScene,
    // 自定义 (todos/23 u5) 同上:标题页进出的备战屏,入口由 u6 接线。
    CustomScene,
  ],
};

const game = new Phaser.Game(config);

if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
