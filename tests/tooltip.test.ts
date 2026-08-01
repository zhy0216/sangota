import { describe, expect, it, vi } from 'vitest';

/**
 * Phaser never loads here (仓库惯例：Phaser 本体进不了 Node)。`Tooltip.ts`
 * 自己只以类型引 Phaser,但它经 `theme.ts` 拖进真包,所以照
 * combatScene.test.ts 的做法给个空壳——theme 顶层只定义函数,壳够用。
 */
vi.mock('phaser', () => ({ default: {} }));

import { C } from '../src/config';
import {
  TooltipManager,
  composeTip,
  placeTip,
  resolveTipSide,
  type TipSegment,
  type TooltipTarget,
} from '../src/ui/Tooltip';

/**
 * todos/24 · k2 — tooltip 管理器。三个层面：
 *
 * 1. 纯函数——翻转决策与多段拼装,todo 点名拆出来测的那两块。
 * 2. `TooltipManager` 对着假 scene 真跑:悬停延迟走场景时钟、同一时刻
 *    只有一块面板、pointerout 掐倒数、热区销毁自动收面板。
 * 3. 场景接线的源码断言——状态图标、意图徽章、卡面关键词都走同一个
 *    管理器,旧的三件套一根线头不剩。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

const SCREEN = { w: 1280, h: 720 };

// ---------------------------------------------------------------- 翻转决策

describe('resolveTipSide', () => {
  const panel = { w: 200, h: 80 };

  it('prefers top when there is room, auto or unset alike', () => {
    const target = { x: 600, y: 400, w: 40, h: 20 };
    expect(resolveTipSide('auto', target, panel, SCREEN)).toBe('top');
    expect(resolveTipSide(undefined, target, panel, SCREEN)).toBe('top');
  });

  it('flips top to bottom against the upper edge — the boss badge case', () => {
    // 高个子首领的意图徽章顶着屏幕上沿,面板往上开就出屏。
    const target = { x: 600, y: 30, w: 40, h: 20 };
    expect(resolveTipSide('top', target, panel, SCREEN)).toBe('bottom');
  });

  it('flips right to left against the right edge — the rightmost enemy case', () => {
    const target = { x: 1200, y: 300, w: 60, h: 40 };
    expect(resolveTipSide('right', target, panel, SCREEN)).toBe('left');
    // 左边贴墙的反过来。
    expect(resolveTipSide('left', { x: 10, y: 300, w: 60, h: 40 }, panel, SCREEN)).toBe('right');
  });

  it('keeps the preferred side when both are blocked, and lets clamp cope', () => {
    const tall = { w: 200, h: 700 };
    expect(resolveTipSide('top', { x: 600, y: 350, w: 40, h: 20 }, tall, SCREEN)).toBe('top');
  });
});

describe('placeTip', () => {
  const panel = { w: 200, h: 80 };

  it('centres above the target with a gap', () => {
    const at = placeTip('top', { x: 600, y: 400, w: 40, h: 20 }, panel, SCREEN);
    expect(at).toEqual({ x: 600 + 20 - 100, y: 400 - 10 - 80 });
  });

  it('never runs off the right edge — 靠右的元素向左展开 (验收)', () => {
    // 最右侧敌人的状态图标:居中放面板会超出右缘,clamp 把它整个推回屏内。
    const at = placeTip('auto', { x: 1240, y: 300, w: 32, h: 22 }, panel, SCREEN);
    expect(at.x + panel.w).toBeLessThanOrEqual(SCREEN.w - 8);
    expect(at.x).toBeGreaterThanOrEqual(8);
  });

  it('stays inside every edge whatever the side asked for', () => {
    for (const side of ['top', 'bottom', 'left', 'right', 'auto'] as const) {
      for (const target of [
        { x: 4, y: 4, w: 20, h: 20 },
        { x: 1250, y: 700, w: 20, h: 20 },
        { x: 640, y: 10, w: 20, h: 20 },
      ]) {
        const at = placeTip(side, target, panel, SCREEN);
        expect(at.x).toBeGreaterThanOrEqual(8);
        expect(at.y).toBeGreaterThanOrEqual(8);
        expect(at.x + panel.w).toBeLessThanOrEqual(SCREEN.w - 8);
        expect(at.y + panel.h).toBeLessThanOrEqual(SCREEN.h - 8);
      }
    }
  });
});

// ---------------------------------------------------------------- 多段拼装

describe('composeTip', () => {
  it('keeps segment order and fills the default colour', () => {
    const { blocks, border } = composeTip([
      { title: '【破绽】3', body: '受到的攻击伤害 +50%。', color: 0xe8543c },
      { title: '消耗', body: '打出后进入消耗堆。' },
    ]);
    expect(blocks.map((b) => b.title)).toEqual(['【破绽】3', '消耗']);
    expect(blocks[1].color).toBe(C.gold);
    // 描边跟头一段走:面板「属于」谁由它说了算。
    expect(border).toBe(0xe8543c);
  });

  it('drops empty segments and falls back to gold with nothing left', () => {
    const { blocks, border } = composeTip([{ title: '', body: '' }]);
    expect(blocks).toEqual([]);
    expect(border).toBe(C.gold);
  });
});

// ------------------------------------------------- a scene made of nothing

interface StubTimer {
  delay: number;
  cb: () => void;
  removed: boolean;
  remove: (dispatch?: boolean) => void;
}

interface StubText {
  x: number;
  y: number;
  text: string;
  width: number;
  height: number;
  destroyed: boolean;
  destroy: () => void;
}

function stubScene(): {
  scene: unknown;
  timers: StubTimer[];
  texts: StubText[];
  root: { x: number; y: number; visible: boolean; depth: number };
} {
  const timers: StubTimer[] = [];
  const texts: StubText[] = [];
  const root = {
    x: 0,
    y: 0,
    visible: true,
    depth: 0,
    add: () => root,
    setDepth: (d: number) => ((root.depth = d), root),
    setVisible: (v: boolean) => ((root.visible = v), root),
    setPosition: (x: number, y: number) => ((root.x = x), (root.y = y), root),
    destroy: () => undefined,
  };
  const noop = (): void => undefined;
  const scene = {
    time: {
      delayedCall(delay: number, cb: () => void): StubTimer {
        const t: StubTimer = {
          delay,
          cb,
          removed: false,
          remove: () => {
            t.removed = true;
          },
        };
        timers.push(t);
        return t;
      },
    },
    add: {
      graphics: () => ({
        clear: noop,
        fillStyle: noop,
        fillRoundedRect: noop,
        lineStyle: noop,
        strokeRoundedRect: noop,
      }),
      container: () => root,
      text(x: number, y: number, str: string, _style: unknown): StubText {
        const lines = String(str).split('\n');
        const t: StubText = {
          x,
          y,
          text: str,
          width: Math.max(...lines.map((l) => l.length)) * 13,
          height: lines.length * 16,
          destroyed: false,
          destroy: () => {
            t.destroyed = true;
          },
        };
        texts.push(t);
        return t;
      },
    },
  };
  return { scene, timers, texts, root };
}

interface StubZone {
  active: boolean;
  emit: (ev: string) => void;
  on: (ev: string, fn: () => void) => StubZone;
  once: (ev: string, fn: () => void) => StubZone;
  getBounds: () => { x: number; y: number; width: number; height: number };
}

function stubZone(x: number, y: number, w: number, h: number): StubZone {
  const handlers: Record<string, (() => void)[]> = {};
  const zone: StubZone = {
    active: true,
    on(ev, fn) {
      (handlers[ev] ??= []).push(fn);
      return zone;
    },
    once(ev, fn) {
      (handlers[ev] ??= []).push(fn);
      return zone;
    },
    emit(ev) {
      for (const fn of handlers[ev] ?? []) fn();
    },
    getBounds: () => ({ x, y, width: w, height: h }),
  };
  return zone;
}

const asTarget = (zone: StubZone, content: () => TipSegment[]): TooltipTarget =>
  ({ zone, content }) as unknown as TooltipTarget;

describe('TooltipManager', () => {
  it('waits ~150ms on the scene clock before showing', () => {
    const { scene, timers, root } = stubScene();
    const tips = new TooltipManager(scene as never, 120);
    const zone = stubZone(600, 400, 32, 22);
    tips.register(asTarget(zone, () => [{ title: '【破绽】2', body: '受创加深。' }]));

    root.visible = true; // 管理器构造时已置 false;这里故意弄脏再验证
    tips.hide();
    zone.emit('pointerover');
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(150);
    expect(root.visible).toBe(false); // 倒数中,还没出

    timers[0].cb();
    expect(root.visible).toBe(true);
  });

  it('a pointerout during the countdown cancels it — 扫过不闪', () => {
    const { scene, timers, root } = stubScene();
    const tips = new TooltipManager(scene as never, 120);
    const zone = stubZone(600, 400, 32, 22);
    tips.register(asTarget(zone, () => [{ title: 'x', body: 'y' }]));

    zone.emit('pointerover');
    zone.emit('pointerout');
    expect(timers[0].removed).toBe(true);
    expect(root.visible).toBe(false);
  });

  it('shows one panel at a time, and reads content at show time', () => {
    const { scene, timers, texts, root } = stubScene();
    const tips = new TooltipManager(scene as never, 120);
    let stacks = 2;
    const a = stubZone(200, 400, 32, 22);
    const b = stubZone(900, 400, 32, 22);
    tips.register(asTarget(a, () => [{ title: `【破绽】${stacks}`, body: '受创加深。' }]));
    tips.register(asTarget(b, () => [{ title: '【神力】1', body: '攻击加深。' }]));

    a.emit('pointerover');
    timers[0].cb();
    const first = texts.filter((t) => !t.destroyed);
    expect(first.some((t) => t.text === '【破绽】2')).toBe(true);

    // 层数动态:同一个热区不重建,下次弹出报的是新层数。
    stacks = 5;
    a.emit('pointerout');
    a.emit('pointerover');
    timers[1].cb();
    expect(texts.filter((t) => !t.destroyed).some((t) => t.text === '【破绽】5')).toBe(true);

    // 换一个热区:旧字全部销毁,面板还是同一块 root——同一时刻只有一个。
    a.emit('pointerout');
    b.emit('pointerover');
    timers[2].cb();
    const alive = texts.filter((t) => !t.destroyed);
    expect(alive.some((t) => t.text === '【神力】1')).toBe(true);
    expect(alive.some((t) => t.text.startsWith('【破绽】'))).toBe(false);
    expect(root.visible).toBe(true);
  });

  it('stays hidden on empty content — the hidden intent case', () => {
    const { scene, timers, root } = stubScene();
    const tips = new TooltipManager(scene as never, 120);
    const zone = stubZone(600, 400, 32, 22);
    tips.register(asTarget(zone, () => []));
    zone.emit('pointerover');
    timers[0].cb();
    expect(root.visible).toBe(false);
  });

  it('hides when the active zone is destroyed — 状态行重建的那一刻', () => {
    const { scene, timers, root } = stubScene();
    const tips = new TooltipManager(scene as never, 120);
    const zone = stubZone(600, 400, 32, 22);
    tips.register(asTarget(zone, () => [{ title: 'x', body: 'y' }]));
    zone.emit('pointerover');
    timers[0].cb();
    expect(root.visible).toBe(true);

    zone.emit('destroy');
    expect(root.visible).toBe(false);
  });

  it('a destroyed zone whose countdown fires shows nothing', () => {
    const { scene, timers, root } = stubScene();
    const tips = new TooltipManager(scene as never, 120);
    const zone = stubZone(600, 400, 32, 22);
    tips.register(asTarget(zone, () => [{ title: 'x', body: 'y' }]));
    zone.emit('pointerover');
    zone.active = false; // removeAll(true) 把热区销毁了,倒数还挂着
    timers[0].cb();
    expect(root.visible).toBe(false);
  });
});

// ---------------------------------------------------------------- 场景接线

describe('the fight wires every hover through the one manager', () => {
  const scene = read('src/scenes/CombatScene.ts');
  const cardView = read('src/ui/CardView.ts');
  const tooltip = read('src/ui/Tooltip.ts');

  it('builds the manager before the enemy views that register into it', () => {
    const built = scene.indexOf('new TooltipManager(this, DEPTH.float)');
    expect(built).toBeGreaterThan(-1);
    expect(built).toBeLessThan(scene.indexOf('this.buildEnemies()'));
  });

  it('registers the status chips with live stack counts', () => {
    expect(scene).toMatch(/zone: hit,\s*\n\s*content: \(\) => \[\s*\n\s*\{\s*\n\s*title: `【\$\{meta\.label\}】\$\{statuses\[id\] \?\? 0\}`/);
    // 旧的直连路径一根线头不剩。
    expect(scene).not.toContain('showStatusTip');
    expect(scene).not.toContain('hideStatusTip');
    expect(scene).not.toContain('private showTip(');
  });

  it('registers the intent badge, content still a method for the keyboard cursor', () => {
    expect(scene).toContain(
      "this.tips.register({ zone: intentHit, content: () => this.intentTipContent(view) });",
    );
  });

  it('hands the manager to hand cards only — overlays would cover the panel', () => {
    expect(scene).toContain("'hand', this.tips");
    // 奖励卡照旧不带 tips:它活在 DEPTH.overlay 之上。
    expect(scene).toMatch(/new CardView\(this, `reward-\$\{i\}`, cardId, 0, this\.state, 'display'\)/);
  });

  it('keeps the relic bar on its own tip, and says why', () => {
    // k2 的取舍:RelicBar 同时活在地图 HUD 和 overlay 里,保留侵入最小。
    expect(scene).toMatch(/宝物条\*\*保留\*\*自己的悬停说明/);
    expect(read('src/ui/RelicBar.ts')).toContain('private showTip(');
  });

  it('lays keyword hotspots over the card rules text and forwards the click', () => {
    expect(cardView).toContain('findKeywords(line)');
    expect(cardView).toContain('getWrappedText(text)');
    expect(cardView).toContain('tips.register({');
    // 热区叠在主点击区之上,不转发出牌那一下就被词条吞了。
    expect(cardView).toContain("this.hit.emit('pointerup')");
    expect(cardView).toContain("this.hit.emit('pointerover')");
  });

  it('delays on the scene clock, never the wall clock', () => {
    expect(tooltip).toContain('this.scene.time.delayedCall(HOVER_DELAY_MS');
    expect(tooltip).not.toContain('Date.now');
    // 样式与地图节点 tooltip 同源:同一块墨板。
    expect(tooltip).toContain('paintInkPanel(');
  });
});
