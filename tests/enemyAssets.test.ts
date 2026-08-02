import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/combat/enemies';
// Vite 的 ?raw 读源码文本——BootScene 引 Phaser，测试网里 import 不起。
import bootSceneSource from '../src/scenes/BootScene.ts?raw';

/**
 * 敌人立绘清单守护。
 *
 * 一个敌人的图要在三处对上：`EnemyDef.art`（enemy-<key>）、磁盘上的
 * `public/assets/enemies/<key>.png`、BootScene 的 `ENEMY_KEYS`。键无图走
 * 加载错误的 `?` 占位，图无键是 Phaser 的绿色缺纹理框，art 指错键则整队
 * 敌人共用一张脸——立绘补齐（todos/15 step 7）之前靠共享掩着，补齐之后
 * 三方漂移只会越漂越远，这里钉死。
 *
 * 和 sfxAssets.test.ts 一样走 Vite 的 glob / ?raw，不引入 Node 类型。
 */

const FILE_KEYS = new Set(
  Object.keys(import.meta.glob('../public/assets/enemies/*.png', { query: '?url' })).map((path) =>
    path.replace(/^.*\//, '').replace(/\.png$/, ''),
  ),
);

/** BootScene 里 `const ENEMY_KEYS = [...]` 的字面内容。 */
const bootKeys = (): Set<string> => {
  const match = bootSceneSource.match(/const ENEMY_KEYS = \[([^\]]*)\]/);
  if (!match) throw new Error('BootScene 里找不到 ENEMY_KEYS');
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
};

describe('敌人立绘清单', () => {
  it('每个敌人的 art 都指向磁盘上真实存在的图', () => {
    const missing = Object.values(ENEMIES)
      .map((def) => def.art.replace(/^enemy-/, ''))
      .filter((key) => !FILE_KEYS.has(key));
    expect(missing).toEqual([]);
  });

  it('BootScene 登记的每把钥匙都有图，每张图都有钥匙', () => {
    const keys = bootKeys();
    expect([...keys].filter((k) => !FILE_KEYS.has(k))).toEqual([]);
    expect([...FILE_KEYS].filter((k) => !keys.has(k))).toEqual([]);
  });

  it('每个敌人的 art 键都在 BootScene 里登记过', () => {
    const keys = bootKeys();
    const unregistered = Object.values(ENEMIES)
      .map((def) => def.art.replace(/^enemy-/, ''))
      .filter((key) => !keys.has(key));
    expect(unregistered).toEqual([]);
  });
});
