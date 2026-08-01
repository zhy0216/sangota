import { MAX_ASCENSION, type AscensionProgress } from '../data/ascension';

/**
 * 天命进度 (todos/19 a5) — heroId → 已通关的最高天命，存 localStorage。
 *
 * 第三本账，第三把钥匙：与 08 的跑团档（`sangota.save.v1`）、22 的战史
 * （`sangota.career.v1`）互不覆盖——清跑团档、清战史都动不了难度进度，
 * 反之亦然。todo 原文点名：「难度进度不该被跑团存档清除影响」。
 *
 * 读档策略随 22 而不随 08：读不到、读不懂、版本不合，一律当白卷重来，
 * 而不是拒读报「损坏」——进度丢了可惜但游戏照打，这边没有一局可输。
 */

/** Bump on any change that makes an old payload unreadable — mismatch resets. */
export const ASCENSION_PROGRESS_VERSION = 1;

const PROGRESS_KEY = 'sangota.ascension.v1';

/** 落盘的形态：`AscensionProgress` 外面再包一个版本号。 */
interface StoredProgress extends AscensionProgress {
  version: number;
}

/**
 * Same guard as `save.ts` / `history.ts`: `localStorage` is absent under Node
 * and *throws on access* under some privacy settings, so it is fetched per
 * call, never cached. 没有存储时进度永远是白卷、写入无害空转。
 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 一页白卷。函数而非常量：`cleared` 不许两处共享同一个对象。 */
export function emptyProgress(): AscensionProgress {
  return { cleared: {} };
}

/** 读回整本进度。读不到、读不懂、版本不合——一律白卷，见文件头的取舍。 */
export function getAscensionProgress(): AscensionProgress {
  const slot = store();
  if (!slot) return emptyProgress();

  let raw: string | null = null;
  try {
    raw = slot.getItem(PROGRESS_KEY);
  } catch {
    return emptyProgress();
  }
  if (!raw) return emptyProgress();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyProgress();
  }
  const stored = parsed as StoredProgress | null;
  if (stored?.version !== ASCENSION_PROGRESS_VERSION) return emptyProgress();
  return { cleared: stored.cleared ?? {} };
}

/** 该武将已通关的最高天命；没打过就是 0（只通过普通难度也是 0）。 */
export function clearedAscension(heroId: string): number {
  return getAscensionProgress().cleared[heroId] ?? 0;
}

/** 选将界面能选到的上限：已通关 +1，封顶 `MAX_ASCENSION`。 */
export function maxSelectableAscension(heroId: string): number {
  return Math.min(clearedAscension(heroId) + 1, MAX_ASCENSION);
}

/**
 * 通关入账：`cleared[heroId] = max(旧账, level)`。只升不降——低重数的
 * 重温不抹高重数的功劳；零重通关也不留一行 0 的空账。
 */
export function recordAscensionClear(heroId: string, level: number): void {
  if (level <= 0) return;
  const progress = getAscensionProgress();
  if ((progress.cleared[heroId] ?? 0) >= level) return;
  progress.cleared[heroId] = level;

  const slot = store();
  if (!slot) return;
  try {
    slot.setItem(
      PROGRESS_KEY,
      JSON.stringify({ version: ASCENSION_PROGRESS_VERSION, ...progress }),
    );
  } catch {
    // Quota exceeded or a store that refuses to write — same as `recordRun`,
    // nothing worth interrupting the 结算界面 over.
  }
}
