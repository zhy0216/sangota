import { getCard, isCurse } from '../combat/cards';
import type { RunState, RunStats } from './run';

/**
 * 战史 (todos/22 s2) — 跨局的评分、记录与累计统计。
 *
 * 与 08 存档 (`save.ts`) 是两本账，两把钥匙互不覆盖：那边存「一局进行中的
 * 状态」，一局一格，结束即清；这边存「打完的局」，只进不出。所以这边的
 * 读档策略也和 08 的 S4 **相反**——版本不合或解析不动就当从零开始，而不是
 * 拒读报「损坏」：史料丢了可惜但游戏照打，卡死统计换不来任何东西；08 那边
 * 有一局可输，这边没有。
 *
 * 约定 2 全项目禁时钟（见 `tests/integrity.test.ts` 「keeps the clock out of
 * every file」），本模块因此**永远不读时钟**：`endedAt` / `durationMs` /
 * `totalPlayMs` 都只是过账的数字，调用方（结算场景）从哪里拿时间是它自己
 * 的事——Phaser 的 `game.getTime()` 也好、拿不到传 0 也好，账本照记。
 */

// ------------------------------------------------------------------- 评分

/** 结算界面上的一行：来源名 + 分值。 */
export interface ScoreLine {
  label: string;
  value: number;
}

/**
 * 「史笔」评分 (todos/22 设计方案的分数表)。
 *
 * `ascension` 从参数进来而不是从 `run` 上读：todo 19 未做，`RunState` 还没有
 * 天命字段——接线时把它传进来即可，默认 0 表示「无天命」。天命加成最后乘在
 * 总分上（总分 × (1 + 0.05 × 级数)），零头舍去——分数是整数。
 *
 * 明细只列**得了分的行**：结算界面逐行淡入，一排 0 分的空行不是仪式感。
 */
export function computeScore(
  run: RunState,
  victory: boolean,
  ascension = 0,
): { total: number; breakdown: ScoreLine[] } {
  const s = run.stats;
  const breakdown: ScoreLine[] = [];
  const add = (label: string, value: number): void => {
    if (value > 0) breakdown.push({ label, value });
  };

  add('登临', s.floorsClimbed * 1);
  add('斩获', s.enemiesSlain * 2);
  add('破锐', s.elitesSlain * 10);
  add('定鼎', s.bossesSlain * 50);
  add('全甲', s.flawlessElites * 25);
  add('秋毫无犯', s.flawlessBosses * 50);

  // 专精：同名牌攒到 4 张，每一种记一笔 25（原版 Collector 的记法）。
  const copies = new Map<string, number>();
  for (const card of run.deck) copies.set(card.defId, (copies.get(card.defId) ?? 0) + 1);
  let mastery = 0;
  for (const n of copies.values()) if (n >= 4) mastery += 1;
  add('专精', mastery * 25);

  // 博采：defId 去重后长度 === 牌组长度，即全牌组无一重复。
  if (run.deck.length > 0 && copies.size === run.deck.length) add('博采', 100);

  // 通关限定项——输掉的局没有「通关」可言，一律不给。
  if (victory) {
    if (run.deck.length <= 15) add('精兵', 30);
    if (run.deck.length >= 40) add('众志', 30);
    if (run.relics.length === 0) add('布衣', 60);
    const curses = run.deck.filter((c) => isCurse(getCard(c.defId))).length;
    if (curses >= 3) add('负重', 40);
  }

  const base = breakdown.reduce((sum, line) => sum + line.value, 0);
  const total = Math.floor(base * (1 + 0.05 * ascension));
  // 加成单独成行，让明细的和恒等于总分——界面上逐行加起来不许对不上账。
  if (total > base) breakdown.push({ label: '天命', value: total - base });
  return { total, breakdown };
}

// ------------------------------------------------------------------- 记录

/** 一局打完后的全部史料。牌组按 defId 存——`uid` 是活跑团才需要的地址。 */
export interface RunRecord {
  /** 由调用方给的唯一 id（如地图 seed）——本模块自己不掷任何骰子。 */
  id: string;
  /** 结束时刻。约定 2 禁时钟：给多少记多少，给不出就是 0。 */
  endedAt: number;
  /** 本局用时，毫秒。同上，只过账不生产。 */
  durationMs: number;
  heroId: string;
  /** todo 19 未做，当前恒 0。字段先占位，接线时免得动存储格式。 */
  ascension: number;
  victory: boolean;
  /** 死因：敌人名，或 'event'；胜利为 null。 */
  killedBy: string | null;
  floor: number;
  act: number;
  score: number;
  scoreBreakdown: ScoreLine[];
  deck: { defId: string; upgraded: number }[];
  relics: string[];
  stats: RunStats;
}

export interface Career {
  version: number;
  /** 最近 `CAREER_RECORD_LIMIT` 局，新的在前。 */
  records: RunRecord[];
  totals: {
    runs: number;
    victories: number;
    totalPlayMs: number;
    /** heroId → 最高分。 */
    highScore: Record<string, number>;
    /** 敌人名 → 死于其手的次数。 */
    deathsBy: Record<string, number>;
    /** defId → 出现在最终牌组里的张数，「最爱的卡」的原始数据。 */
    cardsTaken: Record<string, number>;
    relicsTaken: Record<string, number>;
  };
}

/** Bump on any change that makes an old payload unreadable — mismatch resets. */
export const CAREER_VERSION = 1;

/**
 * 只留最近这么多局。localStorage 通常 5MB，一条记录含牌组约 1-2KB，
 * 50 条离配额还很远。
 */
export const CAREER_RECORD_LIMIT = 50;

/** 与 `save.ts` 的 `sangota.save.v1` 分开——清档清不掉战史，反之亦然。 */
const CAREER_KEY = 'sangota.career.v1';

/**
 * Same guard as `save.ts`: `localStorage` is absent under Node and *throws on
 * access* under some privacy settings, so it is fetched per call, never cached.
 * 没有存储时这里的每个函数都退化成无害的空转——「localStorage 被禁用时
 * 游戏仍能正常玩」对战史同样成立。
 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 一页白卷。函数而非常量，理由同 `emptyRunStats`：内层对象不许两处共享。 */
export function emptyCareer(): Career {
  return {
    version: CAREER_VERSION,
    records: [],
    totals: {
      runs: 0,
      victories: 0,
      totalPlayMs: 0,
      highScore: {},
      deathsBy: {},
      cardsTaken: {},
      relicsTaken: {},
    },
  };
}

/** 读回整本战史。读不到、读不懂、版本不合——一律白卷，见文件头的取舍。 */
export function getCareer(): Career {
  const slot = store();
  if (!slot) return emptyCareer();

  let raw: string | null = null;
  try {
    raw = slot.getItem(CAREER_KEY);
  } catch {
    return emptyCareer();
  }
  if (!raw) return emptyCareer();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyCareer();
  }
  if ((parsed as { version?: unknown } | null)?.version !== CAREER_VERSION) return emptyCareer();
  return parsed as Career;
}

// --------------------------------------------------------------- 本局用时

/**
 * 起跑刻度 (todos/22 s4)。约定 2 本模块不读时钟，这两个函数便只是「寄存一个
 * 数、给个差值」：出征/续档时场景把游戏时钟的读数（`game.getTime()`）塞进来，
 * 结算时再用同一只钟读当下。没有刻度就是 0——史册容得下没记时的局。
 *
 * 模块态而非 `RunState` 字段：它是**本次会话**时钟的读数，跨存档毫无意义
 * （08 的 `savedAt` 也是同一行建不出来的字段，见 `save.ts` S3），所以续档
 * 回来的「本局用时」只从续上那一刻起算。
 */
let runStartMark: number | null = null;

export function markRunStart(now: number): void {
  runStartMark = now;
}

/** 从起跑刻度到 `now` 的毫秒数。没标记过或钟往回走，都记 0。 */
export function runElapsed(now: number): number {
  return runStartMark === null ? 0 : Math.max(0, now - runStartMark);
}

// ------------------------------------------------------------------- 收官

/** 结算场景交来的终局信息。时间是过账的数字——本模块不读时钟，见文件头。 */
export interface RunEndInfo {
  victory: boolean;
  /** 死因：敌人名或 'event'。victory 时无论传什么都按 null 入史。 */
  killedBy: string | null;
  /** 游戏时钟读出的结束刻度；拿不到传 0。 */
  endedAt: number;
  durationMs: number;
}

/**
 * 收官入史 (todos/22 s4)：算分、盖上 `maxHpAtEnd`、写一条 `RunRecord` 并同步
 * `Career.totals`。返回记录和「新纪录」判定——判定必须在 `recordRun` 落账
 * **之前**读旧的 `highScore`，落账之后旧账就被自己盖掉了；0 分不称纪录。
 *
 * `ascension` 恒 0：todo 19 未做。接线点——19 落地后从跑团上读天命级数传给
 * `computeScore`，并在胜利时同步 19 的 `cleared[heroId]`；23 的解锁检查也在
 * 这里接（拿着返回的 `record` 查一遍即可）。本函数现在不做这两件事。
 */
export function settleRun(
  run: RunState,
  info: RunEndInfo,
): { record: RunRecord; newRecord: boolean } {
  const ascension = 0; // 接线点 (todos/19)：天命级数从这里传入。
  const previousBest = getCareer().totals.highScore[run.hero.id] ?? 0;
  const { total, breakdown } = computeScore(run, info.victory, ascension);

  run.stats.maxHpAtEnd = run.maxHp;
  const record: RunRecord = {
    // 地图 seed 当 id（见 `RunRecord.id` 的约定）。同 seed 重打会重名，但
    // `records` 是列表不是索引，重名无妨。
    id: run.map.seed,
    endedAt: info.endedAt,
    durationMs: info.durationMs,
    heroId: run.hero.id,
    ascension,
    victory: info.victory,
    killedBy: info.victory ? null : info.killedBy,
    floor: run.stats.floorsClimbed,
    act: run.act,
    score: total,
    scoreBreakdown: breakdown,
    deck: run.deck.map((c) => ({ defId: c.defId, upgraded: c.upgraded })),
    relics: [...run.relics],
    // 快照，不是引用：入史之后跑团的账本再动，记录不许跟着动。
    stats: { ...run.stats, route: [...run.stats.route] },
  };
  recordRun(record);
  // 接线点 (todos/23)：解锁检查在此接入。
  return { record, newRecord: total > previousBest && total > 0 };
}

const bump = (table: Record<string, number>, key: string): void => {
  table[key] = (table[key] ?? 0) + 1;
};

/**
 * 入史：记一条 `RunRecord`，同步累计 `totals`，写回存储。
 *
 * `records` 新的在前并截到 `CAREER_RECORD_LIMIT`，但 `totals` 永远全量累计——
 * 被挤出去的旧局从列表里消失，不从总账里消失。`deathsBy` 只记败局：胜局的
 * `killedBy` 本来就该是 null，就算调用方传了名字也不算一次死。
 */
export function recordRun(rec: RunRecord): void {
  const career = getCareer();

  career.records.unshift(rec);
  if (career.records.length > CAREER_RECORD_LIMIT) career.records.length = CAREER_RECORD_LIMIT;

  const t = career.totals;
  t.runs += 1;
  if (rec.victory) t.victories += 1;
  t.totalPlayMs += rec.durationMs;
  if (rec.score > (t.highScore[rec.heroId] ?? 0)) t.highScore[rec.heroId] = rec.score;
  if (!rec.victory && rec.killedBy) bump(t.deathsBy, rec.killedBy);
  for (const card of rec.deck) bump(t.cardsTaken, card.defId);
  for (const id of rec.relics) bump(t.relicsTaken, id);

  const slot = store();
  if (!slot) return;
  try {
    slot.setItem(CAREER_KEY, JSON.stringify(career));
  } catch {
    // Quota exceeded or a store that refuses to write — same as `writeSave`,
    // nothing worth interrupting the 结算界面 over.
  }
}
