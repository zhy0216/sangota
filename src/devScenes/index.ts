import type Phaser from 'phaser';
import { prepareDevScene } from './prepare';
import type { DevCombatScene } from './types';

interface DevSceneModule {
  default: DevCombatScene;
}

const modules = import.meta.glob<DevSceneModule>('./scenes/*.ts', { eager: true });

export const devSceneNames = (): string[] =>
  Object.keys(modules)
    .map((path) => path.slice('./scenes/'.length, -'.ts'.length))
    .sort();

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
