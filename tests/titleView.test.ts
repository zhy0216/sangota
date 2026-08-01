import { describe, expect, it } from 'vitest';
import { HEROES } from '../src/data/heroes';
import { HERO_UNLOCKS } from '../src/data/unlockTracks';
import {
  ASC_PANEL_LEFT,
  heroLockReason,
  layoutTitleActions,
  titleActionIds,
  type TitleSlotKind,
} from '../src/ui/titleView';

/**
 * 标题页六入口 (todos/23 u6) 的排版层。`TitleScene.ts` imports Phaser,
 * Node 下装不进来——所以谁出场、摆在哪全在 `titleView.ts` 里算、在这里钉;
 * 场景的接线按 `historyView.test.ts` 的技法查源文。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

const SLOTS: TitleSlotKind[] = ['empty', 'ok', 'stale', 'broken'];
const COMBOS = SLOTS.flatMap((slot) => [false, true].map((pending) => ({ slot, pending })));

// ------------------------------------------------------------------- 名册

describe('title action roster', () => {
  it('opens the plain slate with 出征 and the three standing entries', () => {
    expect(titleActionIds('empty', false)).toEqual(['begin', 'compendium', 'annals', 'custom']);
  });

  it('promotes 继续 over a live save, with 重新出征 beside it', () => {
    expect(titleActionIds('ok', false)).toEqual([
      'resume',
      'again',
      'compendium',
      'annals',
      'custom',
    ]);
  });

  it('offers 清除存档 instead of 重新出征 on a stale or broken slot', () => {
    for (const slot of ['stale', 'broken'] as const) {
      expect(titleActionIds(slot, false)).toEqual([
        'begin',
        'wipe',
        'compendium',
        'annals',
        'custom',
      ]);
    }
  });

  it('appends 新卷可阅 last whenever a choice hangs, and only then', () => {
    for (const { slot, pending } of COMBOS) {
      const ids = titleActionIds(slot, pending);
      expect(ids.at(-1) === 'scroll').toBe(pending);
      expect(ids.filter((id) => id === 'scroll')).toHaveLength(pending ? 1 : 0);
    }
  });
});

// ------------------------------------------------------------------- 几何

describe('title action geometry', () => {
  it('frames follow the roster order, primary first and biggest', () => {
    for (const { slot, pending } of COMBOS) {
      const frames = layoutTitleActions(slot, pending);
      expect(frames.map((f) => f.id)).toEqual(titleActionIds(slot, pending));
      const [primary, ...rest] = frames;
      expect(primary.height).toBe(66);
      for (const f of rest) expect(f.width).toBeLessThan(primary.width);
    }
  });

  it('never overlaps horizontally and never crosses the 天命 panel', () => {
    for (const { slot, pending } of COMBOS) {
      const frames = layoutTitleActions(slot, pending);
      const sorted = [...frames].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        const prevRight = sorted[i - 1].x + sorted[i - 1].width / 2;
        const left = sorted[i].x - sorted[i].width / 2;
        expect(prevRight).toBeLessThan(left);
      }
      // 高重天命的累积名单会垂到按钮那一行——右缘必须让开选择器。
      for (const f of frames) expect(f.x + f.width / 2).toBeLessThan(ASC_PANEL_LEFT);
    }
  });

  it('keeps the roomy row only on the plainest slate', () => {
    const roomy = layoutTitleActions('empty', false);
    for (const f of roomy.slice(1)) expect(f.y).toBe(658);
    for (const { slot, pending } of COMBOS) {
      if (slot === 'empty' && !pending) continue;
      for (const f of layoutTitleActions(slot, pending).slice(1)) expect(f.y).toBe(646);
    }
  });

  it('fades in on the old cadence — 860 for the primary, +40 per follower', () => {
    for (const { slot, pending } of COMBOS) {
      const [primary, ...rest] = layoutTitleActions(slot, pending);
      expect(primary.delay).toBe(860);
      rest.forEach((f, i) => expect(f.delay).toBe(980 + i * 40));
    }
  });
});

// --------------------------------------------------------------- 解锁门

describe('hero lock reasons', () => {
  it('translates every gated hero threshold into words', () => {
    for (const gate of HERO_UNLOCKS) {
      const reason = heroLockReason(gate.heroId);
      expect(reason).toContain('通关');
      expect(reason).toContain('可解锁');
    }
  });

  it('counts in Chinese for the thresholds the tracks actually use', () => {
    expect(heroLockReason('zhaoyun')).toBe('通关一次可解锁');
    expect(heroLockReason('zhugeliang')).toBe('通关两次可解锁');
  });

  it('leaves ungated heroes alone — 关羽 has no door', () => {
    expect(heroLockReason(HEROES.guanyu.id)).toBeNull();
  });
});

// ------------------------------------------------------------------- 接线

describe('the six entries are wired into the title screen', () => {
  const title = read('src/scenes/TitleScene.ts');

  it('lays the row out through the pure function, labels in the scene', () => {
    expect(title).toContain('layoutTitleActions(this.slot.kind, pending !== null)');
    for (const label of ['典 籍', '战 史', '自 定 义', '新 卷 可 阅']) {
      expect(title).toContain(label);
    }
  });

  it('opens 典籍 and 自定义 from guarded handlers, u4/u5 的约定', () => {
    for (const [method, key] of [
      ['private openCompendium(): void', "this.scene.start('Compendium')"],
      ['private openCustom(): void', "this.scene.start('Custom')"],
    ] as const) {
      const body = title.slice(title.indexOf(method));
      const handler = body.slice(0, body.indexOf('\n  }'));
      expect(handler).toContain('if (this.leaving || isCardGridOpen(this)) return');
      expect(handler).toContain(key);
    }
  });

  it('gates the 选将 tiles on isUnlocked and prints the reason', () => {
    expect(title).toContain("isUnlocked('hero', hero.id)");
    expect(title).toContain('heroLockReason(hero.id)');
    // 锁着的瓦片没有命中区——交互只发给解锁的那支。
    const tiles = title.slice(title.indexOf('private buildTiles(): void'));
    const build = tiles.slice(0, tiles.indexOf('\n  }'));
    expect(build.indexOf('} else {')).toBeLessThan(build.indexOf('setInteractive'));
  });

  it('keyboard hero stepping walks through the same gate', () => {
    const body = title.slice(title.indexOf('private step(delta: number): void'));
    const handler = body.slice(0, body.indexOf('\n  }'));
    expect(handler).toContain('.locked');
    expect(handler).toContain('this.pick(');
  });
});
