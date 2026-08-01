import { describe, expect, it } from 'vitest';
import { parseRenderScale } from '../src/config';
import { SETTINGS_KEY } from '../src/state/settings';

/**
 * 渲染倍率旁路 — todos/21 t4。
 *
 * 两节：**parseRenderScale 纯函数**（缺账/坏 JSON/缺字段/枚举外一律回
 * 'auto'——解析失败不许把 Retina 用户按在 1× 里）、**接线守护**（config.ts
 * 为避免 config→settings 的依赖边，把 `sangota.settings.v1` 的字面量抄了
 * 一份——照 `audioWiring.test.ts` 的技法把源码当 ?raw 文本查，钉死两处字面量
 * 同步、且旁路真的挂在 rawScale 的 IIFE 里，'auto' 仍走 dpr×fit 原逻辑）。
 */

// --------------------------------------------------------------- 纯函数

describe('parseRenderScale：合法值直通', () => {
  it("显式 'auto' 回 auto", () => {
    expect(parseRenderScale(JSON.stringify({ renderScale: 'auto' }))).toBe('auto');
  });

  it.each([1, 2, 3] as const)('数字 %d 直接用', (n) => {
    expect(parseRenderScale(JSON.stringify({ renderScale: n }))).toBe(n);
  });

  it('整本账里其余字段不碍事', () => {
    const raw = JSON.stringify({ version: 1, musicVolume: 0.5, renderScale: 2 });
    expect(parseRenderScale(raw)).toBe(2);
  });
});

describe('parseRenderScale：读不懂一律回 auto', () => {
  it('账不存在（null / 空串）', () => {
    expect(parseRenderScale(null)).toBe('auto');
    expect(parseRenderScale('')).toBe('auto');
  });

  it('坏 JSON', () => {
    expect(parseRenderScale('{renderScale:')).toBe('auto');
  });

  it('JSON 合法但不是对象', () => {
    expect(parseRenderScale('2')).toBe('auto');
    expect(parseRenderScale('"auto"')).toBe('auto');
    expect(parseRenderScale('[2]')).toBe('auto');
    expect(parseRenderScale('null')).toBe('auto');
  });

  it('缺字段', () => {
    expect(parseRenderScale('{}')).toBe('auto');
    expect(parseRenderScale(JSON.stringify({ version: 1 }))).toBe('auto');
  });

  it.each([['字符串数字', '2'], ['越下界', 0], ['越上界', 4], ['非整', 2.5], ['布尔', true]])(
    '枚举外的值（%s）',
    (_label, v) => {
      expect(parseRenderScale(JSON.stringify({ renderScale: v }))).toBe('auto');
    },
  );
});

// --------------------------------------------------------------- 接线守护

// config.ts 本身 Node 下 import 得进来，但字面量守护要看的是**源码文本**——
// 照 `audioWiring.test.ts` 的技法用 ?raw 拿。
const RAW: Record<string, string> = import.meta.glob('../src/config.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const configSrc = RAW['../src/config.ts'];

describe('config.ts 的接线', () => {
  it('抄写的存储键与 settings.ts 的 SETTINGS_KEY 同一字面量', () => {
    expect(configSrc).toContain(`SETTINGS_STORAGE_KEY = '${SETTINGS_KEY}'`);
  });

  it("旁路挂在 rawScale 里：先问设置，'auto' 才走 dpr×fit", () => {
    const iife = configSrc.slice(configSrc.indexOf('const rawScale'));
    const pick = iife.indexOf('storedRenderScale()');
    const dpr = iife.indexOf('window.devicePixelRatio');
    expect(pick).toBeGreaterThan(-1);
    expect(dpr).toBeGreaterThan(pick);
    // Retina 用户的 auto 路径原样保留——memory 点名 HiDPI 模糊敏感。
    expect(iife).toContain('Math.max(1, Math.min(fit * dpr, 3))');
  });
});
