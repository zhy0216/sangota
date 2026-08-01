import { HEROES } from '../data/heroes';
import type { RoomType } from '../map/types';
import type { RunRecord } from '../state/history';
import type { RunStats } from '../state/run';

/**
 * 战史 (todos/22 s8) 的纯排版层 — 界面本体 `HistoryPanel.ts` imports Phaser,
 * 在 Node 下装不进来，所以册页上要印的每一个字都在这里拼好、由
 * `tests/historyView.test.ts` 钉住（`cardOrder.ts` 之于 `CardGrid.ts` 的同款
 * 拆法）。
 *
 * 「时间」一列印的是**用时**而不是日期：约定 2 全项目禁墙钟（见
 * `tests/integrity.test.ts` 「keeps the clock out of every file」），
 * `RunRecord.endedAt` 只是游戏时钟的读数，换算不出任何日历——列表按新旧排序
 * 本身就是时间轴，缺的只是钟面没有的东西。
 */

// ------------------------------------------------------------------- 钟面

/**
 * 毫秒 → 「12:34」/「1:02:03」。`SummaryScene` 有一份场景私有的同款——那是
 * 22 s4 的既成事实，本条线（s8）只加不改，故这里另立一份可测的。
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ------------------------------------------------------------------- 名目

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

/** 幕名，与 `save.ts` 的 `summarise` 同一套写法：第四幕称「终章」。 */
export const actName = (act: number): string =>
  act === 4 ? '终章' : `第${CN_NUM[act - 1] ?? act}幕`;

/**
 * 路线图例：一层一字，竖排卷轴里排得下 16 层。自成一表而不引 `ROOM_META`——
 * 那张表为了节点配色 import 了 `config.ts`，把窗口对象拖进 Node 测试；
 * `Record<RoomType, string>` 让漏一个房型直接在编译期报出来。
 */
export const ROUTE_GLYPH: Record<RoomType, string> = {
  monster: '战',
  elite: '锐',
  event: '遇',
  shop: '商',
  rest: '营',
  treasure: '宝',
  boss: '关',
};

// ------------------------------------------------------------------- 行文

/** 列表里的一行，六列全是拼好的字符串——面板只管摆，不管想。 */
export interface HistoryRowView {
  heroName: string;
  /** 「天命五重」，无天命时 「—」（todo 19 未做，当前恒为后者）。 */
  ascension: string;
  floor: string;
  score: string;
  duration: string;
  /** 「功成」或「殁于华雄」——战果一列，也是详录的题眉。 */
  fate: string;
  victory: boolean;
}

export function historyRow(rec: RunRecord): HistoryRowView {
  return {
    heroName: HEROES[rec.heroId]?.name ?? rec.heroId,
    ascension: rec.ascension > 0 ? `天命${CN_NUM[rec.ascension - 1] ?? rec.ascension}重` : '—',
    floor: `第 ${rec.floor} 层`,
    score: `${rec.score} 分`,
    duration: formatDuration(rec.durationMs),
    // 「殁于」的措辞与 SummaryScene 的题字同一套：奇遇致死按 todos/22 记作
    // 奇遇本身，败而无名（老史料）算乱军之中。
    fate: rec.victory
      ? '功成'
      : `殁于${rec.killedBy === 'event' ? '奇遇' : (rec.killedBy ?? '乱军之中')}`,
    victory: rec.victory,
  };
}

/** 册页的副题。总账可能比在册的多（只留最近 50 局），多出来时说明白。 */
export function annalsSubtitle(listed: number, runs: number, victories: number): string {
  if (listed === 0) return '尚无一笔';
  const tail = runs > listed ? `　·　近 ${listed} 局在册` : '';
  return `凡 ${runs} 局　·　功成 ${victories} 局${tail}`;
}

// ------------------------------------------------------------------- 路线

export interface RouteLine {
  act: string;
  line: string;
}

/**
 * 路线按幕分行：「第一幕　战·遇·商…」。`route` 是 `travelTo` 顺序追加的，
 * 幕号天然递增，按插入序分组即按幕分组。空路线给空数组，空态由界面说话。
 */
export function routeLines(route: RunStats['route']): RouteLine[] {
  const byAct = new Map<number, string[]>();
  for (const step of route) {
    const glyphs = byAct.get(step.act) ?? [];
    if (!byAct.has(step.act)) byAct.set(step.act, glyphs);
    glyphs.push(ROUTE_GLYPH[step.type]);
  }
  return [...byAct.entries()].map(([act, glyphs]) => ({
    act: actName(act),
    line: glyphs.join('·'),
  }));
}
