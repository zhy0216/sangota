import { describe, expect, it } from 'vitest';

/**
 * 音效素材清单守护(todo 20 · b1)。
 *
 * 代码(后续的 `src/audio/sfx.ts`)按这些文件名逐字引用素材,文件名错一个
 * 就是运行时静默 404。这里把 25 个音效 × 2 种格式钉死:
 * - `.ogg` 给 Chrome / Firefox;
 * - `.m4a` 给 Safari(不支持 ogg,只给 ogg 会静默无声)。
 *
 * 和 integrity.test.ts 一样走 Vite 的 glob 而不是 `fs`,测试网不引入 Node 类型。
 */

const SFX_IDS = [
  'ui-click',
  'ui-hover',
  'map-select',
  'card-draw',
  'card-attack',
  'card-skill',
  'card-power',
  'card-discard',
  'card-exhaust',
  'shuffle',
  'hit-light',
  'hit-mid',
  'hit-heavy',
  'block-gain',
  'block-break',
  'hp-loss',
  'status-buff',
  'status-debuff',
  'enemy-death',
  'player-death',
  'energy-spend',
  'gold-gain',
  'relic-gain',
  'relic-trigger',
  'potion-use',
] as const;

/** 只要键名,不加载文件内容——glob 非 eager 时值是懒加载函数。 */
const FILES = Object.keys(
  import.meta.glob('../public/assets/audio/sfx/*.{ogg,m4a}', { query: '?url' }),
).map((path) => path.replace(/^.*\//, ''));

describe('音效素材清单', () => {
  it('25 个音效每个都有 ogg + m4a 双格式', () => {
    const missing = SFX_IDS.flatMap((id) =>
      (['ogg', 'm4a'] as const)
        .map((ext) => `${id}.${ext}`)
        .filter((name) => !FILES.includes(name)),
    );
    expect(missing).toEqual([]);
  });

  it('目录里没有清单之外的散文件', () => {
    const known = new Set(
      SFX_IDS.flatMap((id) => [`${id}.ogg`, `${id}.m4a`]),
    );
    const strays = FILES.filter((name) => !known.has(name));
    expect(strays).toEqual([]);
  });
});
