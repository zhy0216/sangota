import type Phaser from 'phaser';
import { getAudio } from '../audio/sfx';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { bodyStyle, brushStyle, inkPanel } from '../ui/theme';
import { prepareDevScene } from './prepare';
import type { DevCombatScene } from './types';

interface DevSceneModule {
  default: DevCombatScene;
}

const modules = import.meta.glob<DevSceneModule>('./scenes/*.ts', { eager: true });

export interface DevSceneEntry {
  key: string;
  scene: DevCombatScene;
}

export const devSceneEntries = (): DevSceneEntry[] =>
  Object.entries(modules)
    .map(([path, module]) => ({
      key: path.slice('./scenes/'.length, -'.ts'.length),
      scene: module.default,
    }))
    .sort(
      (a, b) =>
        (a.scene.order ?? Number.MAX_SAFE_INTEGER) -
          (b.scene.order ?? Number.MAX_SAFE_INTEGER) ||
        a.key.localeCompare(b.key),
    );

export const devSceneNames = (): string[] => devSceneEntries().map((entry) => entry.key);

export function launchDevScene(scene: Phaser.Scene, sceneKey: string): void {
  const module = modules[`./scenes/${sceneKey}.ts`];
  if (!module) {
    throw new Error(
      `Unknown dev scene '${sceneKey}'. Available: ${devSceneNames().join(', ') || '(none)'}`,
    );
  }

  const prepared = prepareDevScene(sceneKey, module.default);
  document.title = `${module.default.name} · Sangota`;
  console.info(`[dev-scene] ${sceneKey}: ${module.default.name}`);
  if (module.default.description) console.info(`[dev-scene] ${module.default.description}`);
  scene.scene.start('Combat', { resume: prepared.combat });
}

/**
 * Boot-time scene browser. The click that chooses a scene also opens the
 * browser autoplay gate, so combat music and the very first card sound work.
 */
export function showDevSceneBrowser(scene: Phaser.Scene, requestedKey: string | null): void {
  const all = devSceneEntries();
  const entries = requestedKey ? all.filter((entry) => entry.key === requestedKey) : all;
  if (requestedKey && entries.length === 0) {
    throw new Error(
      `Unknown dev scene '${requestedKey}'. Available: ${devSceneNames().join(', ') || '(none)'}`,
    );
  }

  scene.children.removeAll(true);
  document.title = requestedKey ? `${entries[0].scene.name} · Sangota` : '测试场景 · Sangota';

  const bg = scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'combat-bg');
  bg.setScale(Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height) * 1.05);
  scene.add.rectangle(
    GAME_WIDTH / 2,
    GAME_HEIGHT / 2,
    GAME_WIDTH,
    GAME_HEIGHT,
    C.inkDeep,
    0.72,
  );

  scene.add
    .text(GAME_WIDTH / 2, 54, '测 试 战 场', brushStyle(48, C.goldBright))
    .setOrigin(0.5)
    .setLetterSpacing(10);
  scene.add
    .text(
      GAME_WIDTH / 2,
      106,
      requestedKey
        ? '点击下方场景进入 · 此次点击会同时启用声音'
        : '选择一份固定战斗快照 · 修改场景文件后刷新即可重置',
      bodyStyle(16, C.paperDim),
    )
    .setOrigin(0.5);

  if (entries.length === 0) {
    scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '尚无测试场景', brushStyle(30, C.paperDim))
      .setOrigin(0.5);
    return;
  }

  const audio = getAudio(scene);
  let launching = false;
  const single = entries.length === 1;
  const columns = single ? 1 : 2;
  const width = single ? 680 : 540;
  const height = single ? 190 : 132;
  const gapX = 36;
  const gapY = 22;
  const rows = Math.ceil(entries.length / columns);
  const totalHeight = rows * height + (rows - 1) * gapY;
  const top = 150 + Math.max(0, (GAME_HEIGHT - 180 - totalHeight) / 2);

  entries.forEach((entry, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const rowCount = Math.min(columns, entries.length - row * columns);
    const x =
      GAME_WIDTH / 2 +
      (col - (rowCount - 1) / 2) * (width + gapX);
    const y = top + row * (height + gapY) + height / 2;
    const card = scene.add.container(x, y);
    const panel = inkPanel(scene, -width / 2, -height / 2, width, height, {
      alpha: 0.9,
      border: C.gold,
    });
    const key = scene.add
      .text(-width / 2 + 22, -height / 2 + 18, entry.key, bodyStyle(13, C.gold))
      .setOrigin(0, 0);
    const title = scene.add
      .text(-width / 2 + 22, -height / 2 + 43, entry.scene.name, brushStyle(single ? 30 : 25))
      .setOrigin(0, 0);
    const description = scene.add
      .text(-width / 2 + 22, -height / 2 + (single ? 91 : 79), entry.scene.description ?? '', {
        ...bodyStyle(single ? 16 : 14, C.paperDim),
        wordWrap: { width: width - 44, useAdvancedWrap: true },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
    const enter = scene.add
      .text(width / 2 - 22, height / 2 - 17, '点击进入 →', bodyStyle(14, C.goldBright))
      .setOrigin(1, 1);
    const hit = scene.add
      .zone(0, 0, width, height)
      .setInteractive({ useHandCursor: true });

    hit.on('pointerover', () => {
      scene.tweens.add({ targets: card, scale: 1.025, duration: 110, ease: 'Quad.easeOut' });
      title.setColor(`#${C.goldBright.toString(16).padStart(6, '0')}`);
    });
    hit.on('pointerout', () => {
      scene.tweens.add({ targets: card, scale: 1, duration: 110, ease: 'Quad.easeOut' });
      title.setColor(`#${C.paper.toString(16).padStart(6, '0')}`);
    });
    hit.on('pointerdown', () => {
      if (launching) return;
      launching = true;
      audio.unlock();
      audio.play('ui-click', { pitchJitter: 0 });
      launchDevScene(scene, entry.key);
    });

    card.add([panel, key, title, description, enter, hit]);
    card.setAlpha(0);
    scene.tweens.add({
      targets: card,
      alpha: 1,
      y: y - 6,
      duration: 260,
      delay: index * 55,
      ease: 'Quad.easeOut',
    });
  });
}
