import { describe, expect, it } from 'vitest';
import { hpPreviewSeg } from '../src/ui/hpPreview';

/**
 * todos/24 · k5 — 敌人 HP 条伤害预览 + 必杀标记。两半：`hpPreview.ts` 的
 * 段几何（护甲折算、总伤、致死判定）是纯函数，直接驱动；场景的接线
 * （悬停点亮、取消即收、必杀闪烁）在 Node 里点不动，按
 * `tests/dragPlay.test.ts` 的老办法读源码断言。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

// ---------------------------------------------------------------- 段几何

describe('hpPreviewSeg', () => {
  it('marks the slice this hit removes, hanging off the live edge', () => {
    // 20/40 的目标挨 8：条上 12/40..20/40 那截标红。
    expect(hpPreviewSeg(20, 40, 0, 8, 1)).toEqual({ from: 0.3, to: 0.5, lethal: false });
  });

  it('folds multi-hit damage into one total (hits×n 按总伤算)', () => {
    // 3×3 与一记 9 在条上是同一截。
    expect(hpPreviewSeg(20, 40, 0, 3, 3)).toEqual(hpPreviewSeg(20, 40, 0, 9, 1));
  });

  it('lets block absorb first, exactly like the engine settles it', () => {
    // 8 总伤对 5 甲只掉 3 血——红段只有打穿的那截。
    expect(hpPreviewSeg(20, 40, 5, 8, 1)).toEqual({ from: 0.425, to: 0.5, lethal: false });
    // 甲兜得住整段：什么都不画。
    expect(hpPreviewSeg(20, 40, 8, 8, 1)).toBeNull();
    expect(hpPreviewSeg(20, 40, 99, 4, 2)).toBeNull();
  });

  it('clamps overkill to the HP that is actually there, and calls it lethal', () => {
    // 30 伤打 20 血：段就是整个活条，from 落在 0。
    expect(hpPreviewSeg(20, 40, 0, 30, 1)).toEqual({ from: 0, to: 0.5, lethal: true });
    // 恰好打死也是必杀——差 1 就不是。
    expect(hpPreviewSeg(20, 40, 0, 20, 1)?.lethal).toBe(true);
    expect(hpPreviewSeg(20, 40, 0, 19, 1)?.lethal).toBe(false);
    // 甲挡掉一部分后恰好够到 HP 仍算必杀。
    expect(hpPreviewSeg(20, 40, 5, 25, 1)?.lethal).toBe(true);
  });

  it('draws nothing for a hit that cannot land', () => {
    expect(hpPreviewSeg(20, 40, 0, 0, 1)).toBeNull();
    expect(hpPreviewSeg(20, 40, 0, 8, 0)).toBeNull();
    // 目标已倒下 / 条本身不存在：没有段。
    expect(hpPreviewSeg(0, 40, 0, 8, 1)).toBeNull();
    expect(hpPreviewSeg(20, 0, 0, 8, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------- 接线

describe('伤害预览接进了场景 (源码断言)', () => {
  const scene = read('src/scenes/CombatScene.ts');

  it('reads its numbers from the engine preview, not a second maths', () => {
    // 与卡面同一套算法（previewValues 折进目标破绽），段几何从纯函数来。
    const at = scene.indexOf('private setHpPreview');
    expect(at).toBeGreaterThan(-1);
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('previewValues(this.state, view.def, enemy)');
    expect(body).toContain('hpPreviewSeg(enemy.hp, enemy.maxHp, enemy.block, D, T)');
  });

  it('lights up from both aiming paths: enemy hover and drag hover', () => {
    // 点击选敌模式：onEnemyOver 悬停点亮，移开只收自己的。
    const over = scene.slice(
      scene.indexOf('private onEnemyOver'),
      scene.indexOf('private onEnemyClick'),
    );
    expect(over).toContain('this.setHpPreview(this.selectedUid, view.enemy.id)');
    expect(over).toContain("this.hpPreview?.enemyId === view.enemy.id");

    // 拖拽：onCardDrag 逐帧点名，落在活敌上才有目标。
    const drag = scene.slice(
      scene.indexOf('private onCardDrag('),
      scene.indexOf('private onCardDragEnd'),
    );
    expect(drag).toContain('this.setHpPreview(');
  });

  it('goes out when the aim does: cancel, drag-away, and the play itself', () => {
    for (const owner of ['private clearSelection', 'private endDragVisuals', 'private async play(']) {
      const at = scene.indexOf(owner);
      expect(at).toBeGreaterThan(-1);
      const body = scene.slice(at, scene.indexOf('\n  }', at));
      expect(body).toContain('this.setHpPreview(null, null)');
    }
  });

  it('paints the slice as a translucent red layer on the live bar', () => {
    const at = scene.indexOf('private paintBar');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('fillStyle(C.cinnabarBright, 0.55)');
    expect(body).toContain('width * (preview.to - preview.from)');
    // 只有被瞄着的敌人挨标——paintHpBars 按 enemyId 认领。
    expect(scene).toContain("this.hpPreview?.enemyId === view.enemy.id ? this.hpPreview.seg");
  });

  it('marks a lethal hit with the blink and the 「必杀」 tag, and puts both away', () => {
    const at = scene.indexOf('private setHpPreview');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    // 条身闪烁：环境警示循环，repeat -1。
    expect(body).toContain('repeat: -1');
    // 朱红小签，inkPanel 样式。
    expect(body).toContain("'必杀'");
    expect(body).toContain('border: C.cinnabarBright');
    // 收旧预览时闪烁停、透明度归位、小签销毁——不然红条常亮成了谎。
    expect(body).toContain('this.tweens.killTweensOf(old.bar)');
    expect(body).toContain('old.bar.setAlpha(1)');
    expect(body).toContain('this.killTag?.destroy()');
  });

  it('dedupes per-frame drag calls so the blink is not restarted every frame', () => {
    const at = scene.indexOf('private setHpPreview');
    const body = scene.slice(at, scene.indexOf('\n  }', at));
    expect(body).toContain('if (key === this.hpPreviewKey) return');
  });
});
