import { ACT1, ACT2, ACT3, FINAL, type EncounterTable } from '../combat/enemies';
import { ACT1_LAYOUT, generateFinalAct, generateMap, type ActLayout } from '../map/generateMap';
import { roomCommit } from '../rooms/commit';
import { clearActProgress, heal, type RunState } from '../state/run';

/**
 * 幕 — the four chapters of a run, and the only place that knows how to get
 * from one to the next.
 *
 * The direction is one-way and must stay that way: this module reads
 * `src/combat/enemies.ts`, and `enemies.ts` must never read this one. The
 * encounter tables are combat data and live beside the enemies they field; a
 * 幕 is a *frame* around one of those tables — a name, a map shape, a seed
 * suffix and what the player is paid on arrival.
 */

export type ActIndex = 1 | 2 | 3 | 4;

export interface ActDef {
  index: ActIndex;
  /** 「讨黄巾」 — the chapter title, drawn large on the interlude card. */
  name: string;
  /** 「中平元年 · 颍川」 — era and place, drawn small beneath it. */
  subtitle: string;
  /** One line of flavour on the interlude card. Empty on 第一幕: nobody sees it. */
  epigraph: string;
  /** Map shape. Ignored for 终章, which is built by hand. */
  layout: ActLayout;
  /** The fights this act draws from. */
  table: EncounterTable;
  /**
   * 体力 restored on *arriving* in this act, as a percentage of 体力上限.
   *
   * A percentage rather than a flat number because 体力上限 grows across a run
   * (养精 / 歌钵 / 玉玺), and a flat 20 that mattered in 第一幕 is noise by 第三幕.
   *
   * 第二幕 and 第三幕 pay nothing, exactly as the original does: an act's
   * 篝火 rooms are the recovery, and a free top-up between acts would make the
   * last 篝火 of every act a wasted node. 终章 is the exception — three fixed
   * rooms with one 营帐 between them is not enough runway to bank anything, so
   * the door pays for itself.
   */
  interActHealPercent: number;
  /** Map backdrop texture. All four share one plate until the art lands. */
  bgKey: string;
}

/**
 * 第一幕's layout object is `ACT1_LAYOUT` *by reference*, not a copy of its
 * numbers. `startRun` passes the same object, so 第一幕 of every existing seed
 * generates exactly the map it always did; a copy here would be one careless
 * edit away from silently regenerating every saved run.
 */
export const ACTS: Record<ActIndex, ActDef> = {
  1: {
    index: 1,
    name: '讨黄巾',
    subtitle: '中平元年 · 颍川',
    epigraph: '',
    layout: ACT1_LAYOUT,
    table: ACT1,
    interActHealPercent: 0,
    bgKey: 'map-bg',
  },
  2: {
    index: 2,
    name: '战虎牢',
    subtitle: '初平元年 · 汜水',
    epigraph: '关东有义士，兴兵讨群凶。',
    // Elites open two floors earlier and the 宝箱 floor moves down: 第二幕 is the
    // same fifteen floors, arranged so the player meets 精英 sooner and banks
    // the free relic sooner to survive them.
    layout: { rows: 15, treasureRow: 7, restRow: 14, minAdvancedRow: 4 },
    table: ACT2,
    interActHealPercent: 0,
    bgKey: 'map-bg',
  },
  3: {
    index: 3,
    name: '征汉中',
    subtitle: '建安二十年 · 阳平',
    epigraph: '鸡肋鸡肋，食之无肉，弃之有味。',
    layout: { rows: 15, treasureRow: 6, restRow: 14, minAdvancedRow: 3 },
    table: ACT3,
    interActHealPercent: 0,
    bgKey: 'map-bg',
  },
  4: {
    index: 4,
    name: '五丈原',
    subtitle: '建兴十二年 · 渭滨',
    epigraph: '出师未捷身先死，长使英雄泪满襟。',
    // Unused: `generateFinalAct` rolls nothing and reads no layout. Kept honest
    // rather than left null so `ActDef` needs no optional field.
    layout: { rows: 2, treasureRow: null, restRow: 1, minAdvancedRow: 0 },
    table: FINAL,
    interActHealPercent: 30,
    bgKey: 'map-bg',
  },
};

/** The act the run is standing in. Falls back to 第一幕 on a nonsense index. */
export const actOf = (run: RunState): ActDef => ACTS[run.act as ActIndex] ?? ACTS[1];

/** The act's own display label — 「第二幕 · 战虎牢」. */
export const actLabel = (act: ActDef): string =>
  `${act.index === 4 ? '终章' : `第${['一', '二', '三'][act.index - 1]}幕`} · ${act.name}`;

/**
 * What happens once this act's 首领 is down.
 *
 * - `interlude` — 第一幕 / 第二幕: on to the next chapter.
 * - `finale` — 第三幕 with the 宝钥 in hand: 五丈原 opens.
 * - `victory` — 第三幕 without the 宝钥, or 终章 cleared. The run ends here.
 *
 * The 宝钥's only source is declining a 首领's 战利品 chest
 * (`takeBossRelic(run, nodeId, null)`), so reaching 终章 costs the player one
 * act's worth of 首领 relic. That trade *is* the door — there is no second
 * currency and no super-elite to farm.
 */
export type ActExit = 'interlude' | 'finale' | 'victory';

export function actExit(run: RunState): ActExit {
  if (run.act >= 4) return 'victory';
  if (run.act === 3) return run.keys.sapphire ? 'finale' : 'victory';
  return 'interlude';
}

/**
 * The run's seed, recovered from the act map it is currently holding.
 *
 * `RunState` deliberately gains **no** field for this (阶段四契约 §2.5: todos/09
 * adds zero fields). 第一幕's map seed *is* the bare run seed — which is load
 * bearing, because prefixing it would re-roll 第一幕 for every seed ever played
 * — and every act after it appends `:act{n}`. So the suffix comes off exactly
 * as it went on, matched against the act the run is actually in rather than by
 * a loose regex: a player-typed seed literally ending in `:act2` is then still
 * safe everywhere except the one act that would have produced that string.
 */
export function runSeedOf(run: RunState): string {
  const suffix = `:act${run.act}`;
  const seed = run.map.seed;
  return seed.endsWith(suffix) ? seed.slice(0, -suffix.length) : seed;
}

/** The map seed for an act. 第一幕 is the bare run seed; see `runSeedOf`. */
export const actSeed = (runSeed: string, index: ActIndex): string =>
  index === 1 ? runSeed : `${runSeed}:act${index}`;

/**
 * Move the run into the next act. **The only writer of `RunState.act`.**
 *
 * Order is fixed and every step is load bearing:
 *
 * 0. The previous 战利品 chest must already be answered. Clearing the ledger
 *    first would erase the `bossRelic` commit — and with it the 宝钥 that
 *    decides whether 终章 opens at all.
 * 1. `run.act` moves before the map is built, so `actSeed` and `actOf` agree.
 * 2. `clearActProgress` wipes the room ledger, the spent encounter ids, the
 *    fight counter, the frozen 首领 offer and the travelled path. Node ids are
 *    `row_col` plus the literal `boss`, so **every id repeats next act**: left
 *    in place, a combat node reads back the previous act's `encounterId`, a
 *    mismatched ledger kind throws the player out of the run outright, and
 *    `bossOfferPending('boss')` answers false forever after.
 * 3. 终章 is built by hand and spends no draws at all; the others take a seed
 *    derived from the run's, so three acts of one seed are three different maps
 *    and each is reproducible on its own.
 * 4. The 幕间 heal lands last, against the *new* act's rate.
 *
 * Called from exactly one place — `InterludeScene.create()` — so that the
 * chest, the spoils and the ledger wipe can never interleave. Skipping the
 * interlude animation must not skip this.
 */
export function advanceAct(run: RunState): ActDef {
  const prevBossId = run.map.bossId;
  if (!roomCommit(run, prevBossId).isDone('bossRelic')) {
    throw new Error('advanceAct before the 战利品 chest was answered');
  }

  const nextIndex = (run.act + 1) as ActIndex;
  const next = ACTS[nextIndex];
  if (!next) throw new Error(`No act after ${run.act}`);

  const runSeed = runSeedOf(run);
  run.act = nextIndex;
  clearActProgress(run);
  // 终章 rolls nothing, but it is still seeded: `GameMap.seed` is what every
  // room stream in the act hangs off and what `runSeedOf` reads the run's seed
  // back out of, so it must be derived like any other act's.
  run.map =
    nextIndex === 4
      ? generateFinalAct(actSeed(runSeed, nextIndex))
      : generateMap(actSeed(runSeed, nextIndex), next.layout);
  heal(run, Math.floor((run.maxHp * next.interActHealPercent) / 100));
  return next;
}
