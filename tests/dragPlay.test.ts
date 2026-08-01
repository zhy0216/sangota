import { describe, expect, it } from 'vitest';
import { PLAY_LINE_Y, dropVerdict, hitIndex, pastPlayLine } from '../src/ui/dragPlay';

/**
 * todos/24 · k3 — 拖拽出牌。两半：`dragPlay.ts` 的回弹判定 / 打出线阈值
 * 是纯函数，直接驱动；场景和 CardView 的接线在 Node 里点不动，按
 * `tests/combatScene.test.ts` 的老办法读源码断言。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

// ---------------------------------------------------------------- 打出线

describe('打出线', () => {
  it('sits between the enemy ground (420) and the hover lift (~514)', () => {
    // 抬着悬停的牌自己够不到线——想打必须真往上拖一段。
    expect(PLAY_LINE_Y).toBeGreaterThan(420);
    expect(PLAY_LINE_Y).toBeLessThan(514);
  });

  it('counts crossed only when truly past, not when touching', () => {
    expect(pastPlayLine(PLAY_LINE_Y - 1)).toBe(true);
    expect(pastPlayLine(PLAY_LINE_Y)).toBe(false);
    expect(pastPlayLine(PLAY_LINE_Y + 200)).toBe(false);
  });

  it('takes a caller-supplied line for the scene that moves it', () => {
    expect(pastPlayLine(299, 300)).toBe(true);
    expect(pastPlayLine(300, 300)).toBe(false);
  });
});

// ---------------------------------------------------------------- 热区命中

describe('hitIndex', () => {
  // Phaser Zone 的形状：中心点 + 宽高（origin 0.5）。
  const zones = [
    { x: 782, y: 320, width: 140, height: 200 },
    { x: 1000, y: 320, width: 140, height: 200 },
  ];

  it('finds the zone under the pointer, edges included', () => {
    expect(hitIndex(1000, 320, zones)).toBe(1);
    // 边线也算命中——70 = width / 2。
    expect(hitIndex(782 + 70, 320, zones)).toBe(0);
    expect(hitIndex(782, 320 + 100, zones)).toBe(0);
  });

  it('misses cleanly past the edge and on an empty field', () => {
    expect(hitIndex(782 + 71, 320 + 101, zones)).toBe(-1);
    expect(hitIndex(0, 0, zones)).toBe(-1);
    expect(hitIndex(872, 320, [])).toBe(-1);
  });

  it('lets the first zone win an overlap, matching input order on screen', () => {
    const overlapping = [
      { x: 872, y: 320, width: 200, height: 200 },
      { x: 900, y: 320, width: 200, height: 200 },
    ];
    expect(hitIndex(890, 320, overlapping)).toBe(0);
  });
});

// ---------------------------------------------------------------- 松手裁决

describe('dropVerdict', () => {
  const zones = [
    { x: 782, y: 320, width: 140, height: 200 },
    { x: 1000, y: 320, width: 140, height: 200 },
  ];

  it('plays a targeted card dropped on an enemy, naming which', () => {
    expect(dropVerdict('enemy', 1000, 320, zones)).toEqual({ verdict: 'play', enemyIndex: 1 });
  });

  it('bounces a targeted card dropped past the line but on nobody', () => {
    // 指向牌不能靠打出线糊弄——必须点名一个目标。
    expect(dropVerdict('enemy', 400, 200, zones)).toEqual({ verdict: 'bounce' });
  });

  it('bounces a targeted card released half-way — the anti-misclick', () => {
    expect(dropVerdict('enemy', 872, 560, zones)).toEqual({ verdict: 'bounce' });
  });

  it('plays a no-target card once the pointer crossed the line', () => {
    expect(dropVerdict('self', 640, PLAY_LINE_Y - 1, zones)).toEqual({ verdict: 'play' });
    expect(dropVerdict('all', 640, 200, [])).toEqual({ verdict: 'play' });
  });

  it('bounces a no-target card released below the line', () => {
    expect(dropVerdict('self', 640, PLAY_LINE_Y + 1, zones)).toEqual({ verdict: 'bounce' });
    // 落在敌人身上也没用——无目标牌只有打出线一个门。
    expect(dropVerdict('all', 1000, 560, zones)).toEqual({ verdict: 'bounce' });
  });
});

// ---------------------------------------------------------------- 接线

describe('拖拽出牌接进了场景 (源码断言)', () => {
  const scene = read('src/scenes/CombatScene.ts');
  const card = read('src/ui/CardView.ts');

  it('CardView marks its hit zone draggable off the option, nowhere else', () => {
    expect(card).toContain('this.draggable = opts.draggable === true');
    expect(card).toContain('draggable: this.draggable');
    // 奖励卡、牌堆查看器不传 opts，不长拖拽。
    expect(read('src/ui/CardGrid.ts')).not.toContain('draggable');
  });

  it('keyword hotspots forward the drag, so a term is not a dead patch', () => {
    // k2 的词条热区叠在主点击区上；不转发 drag，从「消耗」上起手就拖不动。
    for (const evt of ['dragstart', 'drag', 'dragend']) {
      expect(card).toContain(`this.hit.emit('${evt}', p)`);
    }
  });

  it('hoverLift zeroes the fan rotation — a tilted enlargement is unreadable', () => {
    const at = card.indexOf('hoverLift(');
    expect(at).toBeGreaterThan(-1);
    const body = card.slice(at, card.indexOf('\n  }', at));
    expect(body).toContain('angle: 0');
    expect(body).toContain('this.hoverScale');
  });

  it('the hand asks for the full-size hover and the drag, in one place', () => {
    expect(scene).toContain('hoverScale: HAND_HOVER_SCALE');
    expect(scene).toContain('draggable: true');
    for (const evt of ['dragstart', 'drag', 'dragend']) {
      expect(scene).toContain(`view.hitZone.on('${evt}'`);
    }
  });

  it('keeps click-to-play alive, and stops a drag from posing as one', () => {
    // 两种出牌方式并存（验收点名）。
    expect(scene).toContain("view.hitZone.on('pointerup', () => this.onCardClick(view))");
    // Phaser 先派 dragend 后派 pointerup——dragUid 到抬手时已空，拦不住。
    // onCardDragEnd 记压制账，onCardClick 一次性消费掉这记尾随的假点击。
    const endAt = scene.indexOf('private onCardDragEnd');
    const endBody = scene.slice(endAt, scene.indexOf('\n  }', endAt));
    expect(endBody).toContain('this.clickSuppressedUid = view.uid');
    const at = scene.indexOf('private onCardClick');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('this.clickSuppressedUid === view.uid');
    // 阈值之内仍是点击——手抖不该变成拖拽。
    expect(scene).toContain('this.input.dragDistanceThreshold = 8');
  });

  it('routes the release through dropVerdict and bounces without paying', () => {
    const at = scene.indexOf('private onCardDragEnd');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('dropVerdict(');
    expect(body).toContain('this.bounceBack(view)');
    // 回弹不走 play——气一分不扣。
    expect(body.indexOf('this.bounceBack(view)')).toBeLessThan(body.indexOf('void this.play('));
    // 拖拽视为明确意图：不再过 confirmPlay 的二次确认（取舍在注释里说明）。
    expect(body).not.toContain('needsPlayConfirm');
  });

  it('reuses the one aim curve for targeting and dragging alike', () => {
    // todo 点名复用 this.arrow 的贝塞尔——不许长出第二套画法。
    expect(scene).toContain('private drawAimCurve(');
    expect(scene.match(/this\.drawAimCurve\(/g)?.length).toBe(2);
    // 无目标牌画打出线，阈值从 dragPlay 读，不在场景里另抄一份。
    expect(scene).toContain('this.drawPlayLine(pastPlayLine(py))');
    expect(scene).toContain('this.arrow.lineBetween(x, PLAY_LINE_Y, x + 20, PLAY_LINE_Y)');
  });

  it('cancels a drag on Esc without opening the settings', () => {
    const at = scene.indexOf("keydown-ESC");
    const body = scene.slice(at, scene.indexOf('openSettings(this)', at));
    expect(body).toContain('this.dragUid !== null');
    expect(body).toContain('this.cancelDrag()');
  });

  it('leaves a ghost at the home slot and clears every drag visual on release', () => {
    const start = scene.slice(
      scene.indexOf('private onCardDragStart'),
      scene.indexOf('private onCardDrag('),
    );
    // 起拖不放行打不出的牌——回弹判定救不了没气的牌。
    expect(start).toContain('canPlay(this.state, view.uid)');
    expect(start).toContain('this.dragGhost = ghost');

    const clean = scene.slice(
      scene.indexOf('private endDragVisuals'),
      scene.indexOf('private cancelDrag'),
    );
    expect(clean).toContain('this.dragGhost?.destroy()');
    expect(clean).toContain('this.arrow.clear()');
    expect(clean).toContain('clearTint()');
  });
});
