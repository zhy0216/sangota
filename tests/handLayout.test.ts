import { describe, expect, it } from 'vitest';
import { GAME_WIDTH } from '../src/config';
import { MAX_HAND } from '../src/combat/engine';
import {
  FAN_MAX_SPREAD,
  HAND_Y,
  fanLayout,
  fanSpacing,
  rowLayout,
} from '../src/ui/handLayout';

/**
 * todos/24 · k6 — Tab 展开手牌 + 扇形自适应。两半：`handLayout.ts` 的
 * 槽位表（间距/角度/缩放随 n）是纯函数，直接驱动；Tab 的 keydown/keyup
 * 配对、addCapture 和 homeScale 恢复在 Node 里点不动，按
 * `tests/dragPlay.test.ts` 的老办法读源码断言。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

/** 卡宽与 `CardView.CARD_W` 对齐——那头改了这头的账本得跟着改。 */
const CARD_W = 144;

// ---------------------------------------------------------------- 扇形自适应

describe('fanSpacing：间距随牌数收窄', () => {
  it('narrows monotonically as the hand grows', () => {
    for (let n = 2; n <= MAX_HAND; n++) {
      expect(fanSpacing(n, CARD_W)).toBeLessThanOrEqual(fanSpacing(n - 1, CARD_W));
    }
  });

  it('caps a thin hand near card width, and a full hand by the spread', () => {
    // 牌少：近乎并排（卡宽 − 22），不靠 FAN_MAX_SPREAD。
    expect(fanSpacing(1, CARD_W)).toBe(CARD_W - 22);
    // MAX_HAND=10：均摊收到 76——每张牌左缘露出的竖带就是这个宽。
    expect(fanSpacing(MAX_HAND, CARD_W)).toBe(FAN_MAX_SPREAD / MAX_HAND);
  });
});

describe('fanLayout：扇形槽位表', () => {
  it('centers a single card flat on the hand line', () => {
    expect(fanLayout(1, CARD_W)).toEqual([
      { x: GAME_WIDTH / 2, y: HAND_Y, angle: 0, scale: 1 },
    ]);
  });

  it('keeps MAX_HAND cards all visible and clickable — 76px of face each', () => {
    const slots = fanLayout(MAX_HAND, CARD_W);
    expect(slots).toHaveLength(MAX_HAND);
    for (let i = 1; i < slots.length; i++) {
      // 相邻卡的错位就是这张牌露在外面的竖带——费用珠和牌名都在带里。
      const exposed = slots[i].x - slots[i - 1].x;
      expect(exposed).toBeGreaterThanOrEqual(70);
    }
    // 全部在屏内——两端的卡也不出血。
    for (const s of slots) {
      expect(s.x - CARD_W / 2).toBeGreaterThanOrEqual(0);
      expect(s.x + CARD_W / 2).toBeLessThanOrEqual(GAME_WIDTH);
      expect(s.scale).toBe(1);
    }
  });

  it('fans symmetrically: edges tilt and sink, the middle stays flat', () => {
    for (const n of [3, 5, 7, 9]) {
      const slots = fanLayout(n, CARD_W);
      const mid = slots[(n - 1) / 2];
      expect(mid.angle).toBe(0);
      expect(mid.y).toBe(HAND_Y);
      // 左右对称：角度反号、下沉相同。
      expect(slots[0].angle).toBeCloseTo(-slots[n - 1].angle, 10);
      expect(slots[0].y).toBeCloseTo(slots[n - 1].y, 10);
      expect(slots[0].y).toBeGreaterThan(HAND_Y);
    }
  });

  it('caps the edge tilt at ±6° no matter how fat the hand gets', () => {
    for (let n = 1; n <= MAX_HAND; n++) {
      for (const s of fanLayout(n, CARD_W)) {
        expect(Math.abs(s.angle)).toBeLessThanOrEqual(6);
      }
    }
  });
});

// ---------------------------------------------------------------- Tab 展开排

describe('rowLayout：Tab 展开的一排', () => {
  it('lays every hand size flat: zero angle, one shared baseline', () => {
    for (let n = 1; n <= MAX_HAND; n++) {
      for (const s of rowLayout(n, CARD_W)) {
        expect(s.angle).toBe(0);
        expect(s.y).toBe(HAND_Y);
      }
    }
  });

  it('never overlaps — the whole point of holding Tab', () => {
    for (let n = 2; n <= MAX_HAND; n++) {
      const slots = rowLayout(n, CARD_W);
      for (let i = 1; i < slots.length; i++) {
        // 相邻中心距 ≥ 缩放后的卡宽，即卡缘不相交。
        expect(slots[i].x - slots[i - 1].x).toBeGreaterThanOrEqual(CARD_W * slots[i].scale);
      }
    }
  });

  it('keeps full size up to 8 cards, shrinking only when 1280 runs out', () => {
    for (const n of [1, 4, 8]) {
      for (const s of rowLayout(n, CARD_W)) expect(s.scale).toBe(1);
    }
    // 9-10 张全尺寸塞不下：整排等比微缩，缩幅有底线（仍然可读）。
    const full = rowLayout(MAX_HAND, CARD_W);
    expect(full[0].scale).toBeLessThan(1);
    expect(full[0].scale).toBeGreaterThan(0.8);
  });

  it('stays inside the screen, edges included, at MAX_HAND', () => {
    const slots = rowLayout(MAX_HAND, CARD_W);
    const half = (CARD_W * slots[0].scale) / 2;
    expect(slots[0].x - half).toBeGreaterThanOrEqual(0);
    expect(slots[MAX_HAND - 1].x + half).toBeLessThanOrEqual(GAME_WIDTH);
  });
});

// ---------------------------------------------------------------- 接线

describe('Tab 展开与扇形槽位接进了场景 (源码断言)', () => {
  const scene = read('src/scenes/CombatScene.ts');
  const card = read('src/ui/CardView.ts');

  it('layoutHand reads both tables from handLayout, keeping none of its own', () => {
    expect(scene).toContain(
      'this.handExpanded ? rowLayout(n, CARD_W) : fanLayout(n, CARD_W)',
    );
    // 旧的就地几何一根线头不剩——间距/角度只有 handLayout 一处账。
    expect(scene).not.toContain('HAND_MAX_SPREAD');
    expect(scene).not.toContain('n * 2.2');
  });

  it('pairs keydown/keyup and captures Tab away from the browser', () => {
    // 不 addCapture，浏览器把焦点切出画布，keyup 永远听不见。
    expect(scene).toContain("this.input.keyboard?.addCapture('TAB')");
    expect(scene).toContain("on('keydown-TAB', () => this.setHandExpanded(true))");
    expect(scene).toContain("on('keyup-TAB', () => this.setHandExpanded(false))");
  });

  it('ignores the key-repeat and a mid-drag Tab, and resets per fight', () => {
    const at = scene.indexOf('private setHandExpanded');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    // 自动重复靠状态相同挡掉；拖拽中不切——layoutHand 会拽回叼着的牌。
    expect(body).toContain('if (this.handExpanded === on || this.dragUid !== null) return;');
    // 抬着的牌不归槽位表管：先放下再整手重排。
    expect(body.indexOf('this.clearSelection()')).toBeLessThan(body.indexOf('this.layoutHand()'));
    // Phaser 复用场景实例，init 不清就把摊开的手带进下一场。
    const initAt = scene.indexOf('init(data: CombatSceneData)');
    const init = scene.slice(initAt, scene.indexOf('\n  create(', initAt));
    expect(init).toContain('this.handExpanded = false;');
  });

  it('restores homeScale, not 1 — the expanded row shrinks at 9-10 cards', () => {
    // CardView 的悬停恢复与场景的回弹/取消选中，三条路都回 homeScale。
    const drop = card.slice(card.indexOf('hoverDrop('), card.indexOf('\n  }', card.indexOf('hoverDrop(')));
    expect(drop).toContain('scale: this.homeScale');
    expect(scene.match(/scale: view\.homeScale/g)?.length).toBe(2);
    // 拖拽的原位影子也得跟着缩，不然对不上槽位。
    expect(scene).toContain('ghost.setScale(view.homeScale)');
  });
});
