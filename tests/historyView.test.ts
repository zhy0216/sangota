import { describe, expect, it } from 'vitest';
import type { RoomType } from '../src/map/types';
import type { RunRecord } from '../src/state/history';
import { emptyRunStats } from '../src/state/run';
import {
  ROUTE_GLYPH,
  actName,
  annalsSubtitle,
  formatDuration,
  historyRow,
  routeLines,
} from '../src/ui/historyView';

/**
 * 战史册页 (todos/22 s8) 的排版层。`HistoryPanel.ts` imports Phaser，Node 下
 * 装不进来——所以字符串全在 `historyView.ts` 里拼、在这里钉，面板与标题页的
 * 接线则按 `summaryFlow.test.ts` 的技法查源文。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

/** 一条平平无奇的败局，逐测试按需覆盖——`history.test.ts` 的同款便签。 */
function rec(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'r0',
    endedAt: 0,
    durationMs: 754_000,
    heroId: 'guanyu',
    ascension: 0,
    victory: false,
    killedBy: '华雄',
    floor: 12,
    act: 1,
    score: 100,
    scoreBreakdown: [],
    deck: [{ defId: 'pikan', upgraded: 0 }],
    relics: ['qinglongdao'],
    stats: emptyRunStats(),
    ...over,
  };
}

// ------------------------------------------------------------------- 行文

describe('historyRow', () => {
  it('sets a defeat row in six columns, hero named and killer blamed', () => {
    expect(historyRow(rec())).toEqual({
      heroName: '关羽',
      ascension: '—',
      floor: '第 12 层',
      score: '100 分',
      duration: '12:34',
      fate: '殁于华雄',
      victory: false,
    });
  });

  it('calls a victory 功成 and blames nobody', () => {
    const row = historyRow(rec({ victory: true, killedBy: null }));
    expect(row.fate).toBe('功成');
    expect(row.victory).toBe(true);
  });

  it('writes an event death as 殁于奇遇 and a nameless one as 乱军之中', () => {
    expect(historyRow(rec({ killedBy: 'event' })).fate).toBe('殁于奇遇');
    expect(historyRow(rec({ killedBy: null })).fate).toBe('殁于乱军之中');
  });

  it('spells 天命 in numerals and dashes it out at zero', () => {
    expect(historyRow(rec({ ascension: 5 })).ascension).toBe('天命五重');
    expect(historyRow(rec({ ascension: 0 })).ascension).toBe('—');
  });

  it('falls back to the raw heroId for a hero this build does not know', () => {
    // 战史与 08 存档取舍相反：史料读不懂也照展示，不拒读——见 history.ts 文件头。
    expect(historyRow(rec({ heroId: 'lvbu' })).heroName).toBe('lvbu');
  });
});

describe('formatDuration', () => {
  it('reads mm:ss below the hour and h:mm:ss above it', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(754_321)).toBe('12:34');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });

  it('clamps a clock that ran backwards at 0:00', () => {
    expect(formatDuration(-500)).toBe('0:00');
  });
});

describe('annalsSubtitle', () => {
  it('counts the book, and says so when the totals outgrow the shelf', () => {
    expect(annalsSubtitle(0, 0, 0)).toBe('尚无一笔');
    expect(annalsSubtitle(2, 2, 1)).toBe('凡 2 局　·　功成 1 局');
    // 总账 55 局、在册只留 50——被挤出去的旧局不从副题里消失。
    expect(annalsSubtitle(50, 55, 3)).toBe('凡 55 局　·　功成 3 局　·　近 50 局在册');
  });
});

// ------------------------------------------------------------------- 路线

describe('routeLines', () => {
  it('gives every room type a distinct single glyph', () => {
    const types: RoomType[] = ['monster', 'elite', 'event', 'shop', 'rest', 'treasure', 'boss'];
    expect(Object.keys(ROUTE_GLYPH).sort()).toEqual([...types].sort());
    const glyphs = Object.values(ROUTE_GLYPH);
    for (const glyph of glyphs) expect(glyph).toHaveLength(1);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('groups the walked route by act, in walk order', () => {
    const route = [
      { act: 1, row: 0, type: 'monster' as const },
      { act: 1, row: 1, type: 'event' as const },
      { act: 1, row: 2, type: 'boss' as const },
      { act: 2, row: 0, type: 'elite' as const },
      { act: 4, row: 0, type: 'rest' as const },
    ];
    expect(routeLines(route)).toEqual([
      { act: '第一幕', line: '战·遇·关' },
      { act: '第二幕', line: '锐' },
      { act: '终章', line: '营' },
    ]);
  });

  it('hands an untravelled route back empty — the panel owns the blank line', () => {
    expect(routeLines([])).toEqual([]);
  });
});

describe('actName', () => {
  it('names the three acts and calls the fourth 终章', () => {
    expect([1, 2, 3, 4].map(actName)).toEqual(['第一幕', '第二幕', '第三幕', '终章']);
  });
});

// ------------------------------------------------------------------- 接线

describe('the 战史 entry is wired into the title screen', () => {
  it('opens from a guarded handler, same one-way gate as every title action', () => {
    const title = read('src/scenes/TitleScene.ts');
    expect(title).toContain("import { openHistory } from '../ui/HistoryPanel'");
    expect(title).toContain('战 史');
    const body = title.slice(title.indexOf('private showHistory(): void'));
    const handler = body.slice(0, body.indexOf('\n  }'));
    expect(handler).toContain('if (this.leaving || isCardGridOpen(this)) return');
    expect(handler).toContain('openHistory(this)');
  });

  it('reads the career, stacks on the overlay skeleton, and covers the blank book', () => {
    const panel = read('src/ui/HistoryPanel.ts');
    // 07 的 overlay 骨架：栈管 Esc 与深度，不自绑 keydown-ESC。
    expect(panel).toContain('pushOverlay(scene');
    expect(panel).not.toContain('keydown-ESC');
    // 只读 `history.ts` 落好的账，一个字也不写回去。
    expect(panel).toContain('getCareer()');
    expect(panel).not.toContain('recordRun(');
    expect(panel).not.toContain('settleRun(');
    // 空态提示 (todos/22 s8)。
    expect(panel).toContain('尚无战史');
    // 两层楼共用一部滚轮：每个 scene-level 监听先问自己还在不在顶楼。
    expect(panel.match(/overlayDepth\(scene\) !== DEPTH/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
