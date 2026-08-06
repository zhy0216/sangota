import { HEROES } from '../data/heroes';
import { HERO_UNLOCKS, UNLOCK_TRACKS, type UnlockBatch } from '../data/unlockTracks';
import type { RunRecord } from './history';

/**
 * 解锁进度 (todos/23 u1) — 跨局的解锁状态，存 localStorage。
 *
 * 第四本账，第四把钥匙：与 08 的跑团档（`sangota.save.v1`）、22 的战史
 * （`sangota.career.v1`）、19 的天命进度（`sangota.ascension.v1`）互不覆盖——
 * 清跑团存档动不了解锁，反之亦然（验收标准点名）。读档策略随 22/19 而不随
 * 08：读不到、读不懂、版本不合，一律当白卷重来——解锁丢了可惜但游戏照打。
 *
 * **默认解锁、轨道设门**：`isUnlocked` 只对出现在 `UNLOCK_TRACKS` /
 * `HERO_UNLOCKS` 里的 id 查账，其余一律放行。所以 `cards` / `relics` /
 * `heroes` 里存的只是「从门后赢出来的」那部分，初始内容（关羽、他的原始
 * 11 张、全部无色牌、未点名的宝物）不用登记也开着——第一局照常能玩。
 *
 * 约定 2 全项目禁时钟，本模块不读时钟也不掷骰子：分数从 `RunRecord` 进来，
 * 三选一由玩家的手指决定。自定义模式（u7，不计分不解锁）由调用方把关——
 * 不计分的局根本不要调 `applyRunUnlocks`。
 */

export interface UnlockState {
  version: number;
  /** 每个武将的累积解锁分数（「史笔」分，见 `computeScore`）。 */
  progress: Record<string, number>;
  /** 任意武将的累计通关次数——武将解锁按它数。 */
  victories: number;
  /** 已解锁的卡牌 id（只记轨道里设了门的那些）。 */
  cards: string[];
  /** 已解锁的宝物 id。 */
  relics: string[];
  /** 已解锁的武将 id。 */
  heroes: string[];
  /** 已见过的敌人 id（敌卷用；u3 埋点来写）。 */
  seenEnemies: string[];
  /** 已见过的事件 id（典籍第四卷用，可选）。 */
  seenEvents: string[];
  /** 待玩家三选一的解锁批次；u5 的界面拿它画三张牌。 */
  pendingChoice: { heroId: string; options: string[] } | null;
}

/** Bump on any change that makes an old payload unreadable — mismatch resets. */
export const UNLOCKS_VERSION = 1;

/** 与其余三把钥匙并列，见文件头。 */
const UNLOCKS_KEY = 'sangota.unlocks.v1';

/**
 * Same guard as `save.ts` / `history.ts` / `ascension.ts`: `localStorage` is
 * absent under Node and *throws on access* under some privacy settings, so it
 * is fetched per call, never cached. 没有存储时解锁账永远是白卷、写入无害空转。
 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 一页白卷。函数而非常量：内层数组不许两处共享同一个对象。 */
export function emptyUnlocks(): UnlockState {
  return {
    version: UNLOCKS_VERSION,
    progress: {},
    victories: 0,
    cards: [],
    relics: [],
    heroes: [],
    seenEnemies: [],
    seenEvents: [],
    pendingChoice: null,
  };
}

/** 读回整本解锁账。读不到、读不懂、版本不合——一律白卷，见文件头的取舍。 */
export function getUnlocks(): UnlockState {
  const slot = store();
  if (!slot) return emptyUnlocks();

  let raw: string | null = null;
  try {
    raw = slot.getItem(UNLOCKS_KEY);
  } catch {
    return emptyUnlocks();
  }
  if (!raw) return emptyUnlocks();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyUnlocks();
  }
  const stored = parsed as Partial<UnlockState> | null;
  if (stored?.version !== UNLOCKS_VERSION) return emptyUnlocks();
  // 逐字段落回白卷的默认值：老账少一个数组不至于让下面的每个 push 炸掉。
  return { ...emptyUnlocks(), ...stored };
}

/** 写回。配额爆了或存储拒写——同 `recordRun`，不值得为此打断结算界面。 */
function writeUnlocks(state: UnlockState): void {
  const slot = store();
  if (!slot) return;
  try {
    slot.setItem(UNLOCKS_KEY, JSON.stringify(state));
  } catch {
    // 空转，见上。
  }
}

// ------------------------------------------------------------------- 门牌

/** 出现在分数轨道里的卡/宝物——只有它们上锁，其余默认解锁。 */
const GATED_CARDS: ReadonlySet<string> = new Set(
  UNLOCK_TRACKS.flatMap((b) => [...(b.cardChoice ?? []), ...(b.cards ?? [])]),
);

const GATED_RELICS: ReadonlySet<string> = new Set(UNLOCK_TRACKS.flatMap((b) => b.relics ?? []));

/**
 * 上锁的武将。`HEROES` 里查不到的 heroId（比如还没进武将表的周瑜）直接
 * 跳过——数据行可以先写，门却不能锁到一个不存在的人身上。
 */
const GATED_HEROES: ReadonlySet<string> = new Set(
  HERO_UNLOCKS.filter((h) => h.heroId in HEROES).map((h) => h.heroId),
);

/**
 * 内容是否已解锁——所有随机池抽取（u2）和选将界面（u6）都要过这个过滤。
 * 不设门的 id 恒为 true，所以调用方不用关心一张牌「有没有资格上锁」。
 *
 * **无存储即全开**（u2 的取舍）：Node 下没有 `localStorage`——既有测试、
 * headless sim 和 37 个黄金快照全在那里跑，把它们锁进初始集合等于改掉
 * 每一处期望值；而无处记账的环境里解锁进度本来就无从积累，门形同虚设。
 * 所以门只对能存账的浏览器生效，存储缺席时一律放行。浏览器里
 * `localStorage` 恒在（拒访问的隐私模式除外，那种环境攒不下进度，
 * 全开是比永锁初始集合更体面的降级），玩家不受此路影响。
 */
export function isUnlocked(kind: 'card' | 'relic' | 'hero', id: string): boolean {
  if (!store()) return true;
  switch (kind) {
    case 'card':
      return !GATED_CARDS.has(id) || getUnlocks().cards.includes(id);
    case 'relic':
      return !GATED_RELICS.has(id) || getUnlocks().relics.includes(id);
    case 'hero':
      return !GATED_HEROES.has(id) || getUnlocks().heroes.includes(id);
  }
}

/**
 * 整池过滤 (u2)——随机池在**抽之前**用它收窄，绝不抽后重抽：R3
 * （`src/rooms/rng.ts`）要求掷骰次数不随池子内容变，收窄池子改的是
 * 「能出什么」，永远不改「掷几次」。与 `isUnlocked` 同一本账、同一个
 * 无存储全开的取舍，只是一次读账过滤整池，免得每个 id 各解析一遍
 * localStorage。全解锁时逐字返回原池，顺序不动——顺序是被种子索引的。
 */
export function filterUnlocked(kind: 'card' | 'relic', ids: readonly string[]): string[] {
  if (!store()) return [...ids];
  const state = getUnlocks();
  const gated = kind === 'card' ? GATED_CARDS : GATED_RELICS;
  const owned = kind === 'card' ? state.cards : state.relics;
  return ids.filter((id) => !gated.has(id) || owned.includes(id));
}

// ------------------------------------------------------------------- 敌卷

/**
 * 敌卷埋点 (u2)：战斗开始时把上台的敌人记入册。由 `CombatScene` 在
 * 建完遭遇后调——引擎是纯函数，不碰持久化（实现步骤 3 点名）。幂等：
 * 同名敌人一场多只、续档重开同一场，都只记一笔、不多写一次。
 */
export function recordSeenEnemies(ids: readonly string[]): void {
  const state = getUnlocks();
  const fresh = [...new Set(ids)].filter((id) => !state.seenEnemies.includes(id));
  if (fresh.length === 0) return;
  state.seenEnemies.push(...fresh);
  writeUnlocks(state);
}

// ------------------------------------------------------------------- 入账

/** `applyRunUnlocks` 的回执——结算界面 (u3) 照它逐个展示新解锁。 */
export interface RunUnlockReport {
  newCards: string[];
  newRelics: string[];
  newHeroes: string[];
  pendingChoice: UnlockState['pendingChoice'];
}

/** `rec.heroId` 的分数轨道，按阈值从低到高。 */
const trackOf = (heroId: string): UnlockBatch[] =>
  UNLOCK_TRACKS.filter((b) => b.heroId === heroId).sort((a, b) => a.atScore - b.atScore);

/**
 * 局末入账 (todos/23 u4 在结算处调它)：累加分数、结算跨过的阈值，返回本次
 * **新**解锁的内容给结算界面逐个展示。自定义模式不计分不解锁——那种局
 * 别调这个函数。
 *
 * 三选一的语义（设计方案「玩家选一个优先解锁，其余下一批自动解锁」）：
 * - 跨过一个带 `cardChoice` 的批次时不直接发牌，而是把选项挂到
 *   `pendingChoice`，由 u5 的界面调 `chooseUnlock` 领走一张；
 * - 更高的 choice 批次被跨过时，较低批次剩下的选项自动解锁；
 * - 轨道**最后**一个 choice 批次没有「下一批」，其剩余选项在选完之后的
 *   下一次入账自动解锁——门后不留永远拿不到的牌。
 */
export function applyRunUnlocks(rec: RunRecord): RunUnlockReport {
  const state = getUnlocks();
  const newCards: string[] = [];
  const newRelics: string[] = [];
  const newHeroes: string[] = [];
  const unlockCard = (id: string): void => {
    if (state.cards.includes(id)) return;
    state.cards.push(id);
    newCards.push(id);
  };

  // ----- 分数与通关数入账 --------------------------------------------------
  state.progress[rec.heroId] = (state.progress[rec.heroId] ?? 0) + rec.score;
  if (rec.victory) state.victories += 1;

  // ----- 分数轨道：只有 rec.heroId 的进度动了，只看他的轨道 ----------------
  const reached = trackOf(rec.heroId).filter(
    (b) => b.atScore <= (state.progress[rec.heroId] ?? 0),
  );
  for (const batch of reached) {
    for (const id of batch.relics ?? []) {
      if (state.relics.includes(id)) continue;
      state.relics.push(id);
      newRelics.push(id);
    }
    for (const id of batch.cards ?? []) unlockCard(id);
  }

  const choiceBatches = reached.filter((b) => b.cardChoice?.length);
  const current = choiceBatches.at(-1);
  // 已被更高批次越过的 choice 批：剩余选项全部自动解锁（「下一批」到了）。
  for (const batch of choiceBatches) {
    if (batch !== current) for (const id of batch.cardChoice ?? []) unlockCard(id);
  }
  if (current) {
    const options = current.cardChoice ?? [];
    // 「已选过」只看进账**之前**的旧账——本函数从不直接发 current 的选项。
    const resolved = options.some((id) => state.cards.includes(id));
    const remaining = options.filter((id) => !state.cards.includes(id));
    const isLast = current === trackOf(rec.heroId).filter((b) => b.cardChoice?.length).at(-1);
    if (!resolved && remaining.length > 0) {
      // 生成/保持三选一。挂的是剩余项——老账局部损坏也不至于重发已有的牌。
      state.pendingChoice = { heroId: rec.heroId, options: remaining };
    } else if (resolved && isLast) {
      // 最后一批已选完：剩下两张随下一次入账放出，见函数头。
      for (const id of remaining) unlockCard(id);
      if (state.pendingChoice?.heroId === rec.heroId) state.pendingChoice = null;
    }
  }

  // ----- 武将门：按累计通关次数，全轨道逐行对账 ----------------------------
  for (const gate of HERO_UNLOCKS) {
    if (!(gate.heroId in HEROES)) continue; // 周瑜还没进武将表——跳过，见 unlockTracks.ts。
    // 制作中的同样不发：结算界面许出去的人，选将界面必须点得开。跳过时账上
    // 没记，通关数还在——旗一摘，下一次入账当场补发。
    if (HEROES[gate.heroId].wip) continue;
    if (state.victories < gate.victories) continue;
    if (state.heroes.includes(gate.heroId)) continue;
    state.heroes.push(gate.heroId);
    newHeroes.push(gate.heroId);
  }

  writeUnlocks(state);
  return {
    newCards,
    newRelics,
    newHeroes,
    pendingChoice: state.pendingChoice
      ? { heroId: state.pendingChoice.heroId, options: [...state.pendingChoice.options] }
      : null,
  };
}

/**
 * 三选一落子 (u5 的界面调它)：把选中的一张立刻解锁，清掉 `pendingChoice`。
 * 不在选项里的 id 一律拒绝——按钮回调传错牌不该能白拿一张。
 */
export function chooseUnlock(cardId: string): boolean {
  const state = getUnlocks();
  if (!state.pendingChoice?.options.includes(cardId)) return false;
  if (!state.cards.includes(cardId)) state.cards.push(cardId);
  state.pendingChoice = null;
  writeUnlocks(state);
  return true;
}
