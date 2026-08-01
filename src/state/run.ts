import { canUpgrade, getCard, isNegative } from '../combat/cards';
import type { CombatTier } from '../combat/enemies';
import { POTION_DROP, getPotion } from '../combat/potions';
import { RELICS, relicModifiers } from '../combat/relics';
import { BASE_CARD_REWARD_COUNT } from '../combat/rewards';
import type { CombatEvent } from '../combat/types';
import { ACT1_LAYOUT, generateMap } from '../map/generateMap';
import type { GameMap, RoomType } from '../map/types';
import type { DeckPick, RoomRecord } from '../rooms/types';
import { modsFor, type AscensionMods } from '../data/ascension';
import { DEFAULT_HERO, type HeroDef } from '../data/heroes';

/**
 * 跑团全程的统计账本 (todos/22)。只进不出:埋点各处只做「+=」，任何规则都不许
 * 反过来读它做决定——它是给结算界面看的史料，不是游戏状态。
 *
 * todos/22 的草稿还带一个 `startedAt` 时间戳，这里没有：约定 2 全项目禁时钟
 * （见 `tests/integrity.test.ts` 「keeps the clock out of every file」），
 * 「本局用时」与 08 存档的 `savedAt` 是同一行建不出来的字段。
 *
 * 战斗内的数字**只走 `CombatEvent` 回传**（`recordCombatEvents`）：约定 8
 * 不让引擎碰 `RunState`，无头模拟里也根本没有跑团可写。
 */
export interface RunStats {
  floorsClimbed: number;
  enemiesSlain: number;
  elitesSlain: number;
  bossesSlain: number;
  /** 无伤（本场 damageTaken 增量为 0）打完的精英/首领场数。 */
  flawlessElites: number;
  flawlessBosses: number;
  goldEarned: number;
  goldSpent: number;
  damageTaken: number;
  damageDealt: number;
  cardsPlayed: number;
  potionsUsed: number;
  /** 结算 (todos/22 s2) 时写入；跑团进行中恒为 0。 */
  maxHpAtEnd: number;
  /** 每层进入的房间类型，结算界面画路线用。跨幕累积，不随 `clearActProgress` 清。 */
  route: { act: number; row: number; type: RoomType }[];
}

/** 全零的新账本。函数而非常量：`route` 是数组，共享一份会让两局互相记账。 */
export function emptyRunStats(): RunStats {
  return {
    floorsClimbed: 0,
    enemiesSlain: 0,
    elitesSlain: 0,
    bossesSlain: 0,
    flawlessElites: 0,
    flawlessBosses: 0,
    goldEarned: 0,
    goldSpent: 0,
    damageTaken: 0,
    damageDealt: 0,
    cardsPlayed: 0,
    potionsUsed: 0,
    maxHpAtEnd: 0,
    route: [],
  };
}

/** One physical card in the deck. Upgrades ride on the copy, not on the id. */
export interface DeckCard {
  /** Stable instance id — lets "upgrade the 3rd 劈砍" and UI selection work. */
  uid: string;
  defId: string;
  upgraded: number;
}

export interface RunState {
  hero: HeroDef;
  hp: number;
  maxHp: number;
  gold: number;
  act: number;
  map: GameMap;
  /** One entry per physical copy. */
  deck: DeckCard[];
  /** Relic ids in pickup order — the HUD bar and the hooks both read this order. */
  relics: string[];
  /** Relic counters that outlive a single fight, keyed by relic id. */
  relicCounters: Record<string, number>;
  /** Always exactly `potionSlots` long; an empty slot is null. */
  potions: (string | null)[];
  /** 3 plus whatever 药囊-style relics add. Kept in step by `syncPotionSlots`. */
  potionSlots: number;
  /** Drop chance for the next monster fight, in percent. Drifts, see POTION_DROP. */
  potionChance: number;
  /** Rewards since the last rare, added to the rare weight. See `rollCardReward`. */
  rareBump: number;
  /** Cards a reward offers. Relic-modified; kept in step by `syncRewardCount`. */
  cardRewardCount: number;
  /** null until the player commits to a starting node on floor 1. */
  currentNodeId: string | null;
  /** Node ids in visit order — used to paint the travelled path. */
  path: string[];

  // ------------------------------------------------------------ 房间层
  // Added whole rather than in instalments: every one of these is read by more
  // than one room, and a field that lands later would need a save migration.

  /**
   * Per-node room ledger plus that node's materialised randomness. Keyed by
   * `MapNode.id`. `committed` inside a record is the single source of truth for
   * "has this already been done" — see `src/rooms/commit.ts`.
   */
  rooms: Record<string, RoomRecord>;
  /**
   * Event ids resolved this run. Drives both `once` events and same-run
   * de-duplication — 3.14 event rooms against a 12-event pool means repeats are
   * the norm, not the exception, without this.
   */
  seenEvents: string[];
  /** Card-removal price escalation. Run-long: it survives leaving the shop. */
  cardRemovalSurcharge: number;
  /** Fights finished in the current act — picks the weak vs strong table. */
  actCombatCount: number;
  /** Encounter ids spent this act; cleared on an act change. */
  usedEncounters: string[];
  /** The three boss relics on offer, frozen the moment the chest is opened. */
  bossRelicOffer: string[] | null;
  /**
   * Locked doors this run has the key to. One key, deliberately: 宝钥 opens the
   * 终章 and its only source is declining a 首领 relic (`takeBossRelic(..., null)`).
   * A second colour needs a door and a source, and neither exists.
   */
  keys: { sapphire: boolean };

  // ------------------------------------------------------------ 开局祝福

  /**
   * 开局祝福 (todos/18) — null until the 祝福 screen has been entered, and null
   * forever on a run that predates it.
   *
   * Parked on the run rather than on a node ledger because it happens **before
   * the player has stood anywhere**: `roomRecord(run, 'neow', 'event')` throws
   * (there is no such node), and `RoomRecord` is a union tagged by *map node
   * type*, which a blessing does not have.
   */
  blessing: BlessingState | null;

  // ------------------------------------------------------------ 统计 (22)

  /** 结算界面的账本，见 `RunStats`。 */
  stats: RunStats;

  // ------------------------------------------------------------ 天命 (19)

  /** 本局的天命等级，0 = 无天命。开局定死，中途不变。 */
  ascension: number;
  /**
   * `modsFor(ascension)` 的结果，开局在 `startRun` 算好，全程**只读**
   * （对象是冻结的）。接线点一律读这里，不许自己按 `ascension` 写 if——
   * 集中修饰器是 todos/19 的关键架构决策。
   */
  mods: AscensionMods;
}

/**
 * The 祝福 the run was offered and what it owes. Ids only — R6 forbids parking
 * an `Rng` or a cursor in `RunState`, and the same discipline applies to the
 * objects a table can grow: an outcome stored whole would be a save that
 * disagrees with the table it came from.
 */
export interface BlessingState {
  /** The four-up, materialised on first sight (R5) and read-only after. */
  offered: BlessingOffer[];
  /** The one that was taken. Non-null is the door: a blessing is taken once. */
  takenId: string | null;
  /** A deck pick the taken blessing bought and has not been answered yet. */
  pending: DeckPick | null;
}

/**
 * One option on the 祝福 screen. `costId` is set only on the 交易 class, whose
 * benefit and price are rolled as two independent draws and shown as one line.
 */
export interface BlessingOffer {
  id: string;
  costId: string | null;
}

let active: RunState | null = null;
/** Monotonic, not random: a seed alone must reproduce the whole run. */
let nextUid = 0;

/** Slots before any relic touches them. */
export const BASE_POTION_SLOTS = 3;

export function newDeckCard(defId: string, upgraded = 0): DeckCard {
  return { uid: `d${nextUid++}`, defId, upgraded };
}

export function startRun(hero: HeroDef = DEFAULT_HERO, seed?: string, ascension = 0): RunState {
  nextUid = 0;
  // 天命 (todos/19)：等级和修饰器都在这一刻定死。默认 0 = `DEFAULT_MODS`，
  // 即现状原样，所以每一个既有调用点和测试都不受影响。接线点：extraElites
  // （下面的地图）、hpMult/damageMult（引擎，CombatScene 递入）、maxHpMult /
  // potionSlots / startingCurses（本函数与 `syncPotionSlots`）。
  const mods = modsFor(ascension);
  const relics = [hero.starterRelic];
  // 十四重的 -5% 上限（后十级数据）乘在遗物加成之后，四舍五入；零重乘 1 恒等。
  const maxHp = Math.round((hero.maxHp + relicModifiers(relics).maxHp) * mods.maxHpMult);
  active = {
    ascension,
    mods,
    hero,
    hp: maxHp,
    maxHp,
    gold: hero.startingGold,
    act: 1,
    map: generateMap(seed, ACT1_LAYOUT, mods.extraElites),
    deck: hero.startingDeck.map((defId) => newDeckCard(defId)),
    relics,
    relicCounters: {},
    potions: [],
    potionSlots: 0,
    potionChance: POTION_DROP.start,
    rareBump: 0,
    cardRewardCount: 0,
    currentNodeId: null,
    path: [],
    // Constants, every one of them: `startRun` must never draw from an Rng.
    // `sim/golden.test.ts` builds its decks through here, and one extra roll
    // would invalidate all 37 golden snapshots. `tests/integrity.test.ts`
    // checks this as source text — the comment alone was the only guard.
    rooms: {},
    seenEvents: [],
    cardRemovalSurcharge: 0,
    actCombatCount: 0,
    usedEncounters: [],
    bossRelicOffer: null,
    keys: { sapphire: false },
    blessing: null,
    stats: emptyRunStats(),
  };
  // 天命十重 (todos/19 a3)：开局诅咒逐张入组。零至九重列表为空，一张不加；
  // 「宿业」的卡面由 a4 落地（id 见 `SUYE_ID`），这里只按 mods 里的 id 找卡。
  for (const curseId of mods.startingCurses) addCurse(active, curseId);
  syncPotionSlots(active);
  syncRewardCount(active);
  return active;
}

/**
 * Re-derives the reward width from the relics owned right now. Clamped at 1: a
 * relic that subtracts more than the pool offers must still leave something to
 * pick, and 「不取」 is already the way to decline.
 */
export function syncRewardCount(run: RunState): void {
  const mods = relicModifiers(run.relics);
  run.cardRewardCount = Math.max(1, BASE_CARD_REWARD_COUNT + mods.cardRewardCount);
}

/**
 * Re-derives the belt from the relics owned right now. `potions` is grown and
 * trimmed rather than rebuilt, so picking up 药囊 mid-run never disturbs what is
 * already in the first three slots. Shrinking is a no-op today — nothing takes
 * slots away — and deliberately drops from the tail if one ever does.
 */
export function syncPotionSlots(run: RunState): void {
  // 天命 (todos/19 a3)：基础槽位从 `run.mods.potionSlots` 读，零重与
  // `BASE_POTION_SLOTS` 同为 3——十一重的 3 → 2 落表那天只改数据不改这里。
  run.potionSlots = run.mods.potionSlots + relicModifiers(run.relics).potionSlots;
  while (run.potions.length < run.potionSlots) run.potions.push(null);
  run.potions.length = run.potionSlots;
}

export function getRun(): RunState {
  if (!active) return startRun();
  return active;
}

/**
 * The deck-uid cursor, so 存档 can park it and put it back.
 *
 * `nextUid` is module state rather than a field of `RunState` on purpose — it is
 * monotonic and must never be drawn from an `Rng` — but that makes it the one
 * piece of a run that `JSON.stringify(run)` cannot see. Restored without it, the
 * counter starts at 0 again and the very next 战利品 card is minted as `d0`,
 * which the opening deck already holds: `removeCard` and every 选牌 overlay
 * address a copy *by uid*, so 弃卡 would shed whichever of the two the array
 * happened to find first.
 */
export const uidCursor = (): number => nextUid;

/**
 * Install a rebuilt run as the active one. The only door 存档 has into this
 * module's state, and it takes the cursor with it for the reason above.
 *
 * Deliberately not `restoreRun(saved)`: rebuilding a `RunState` needs the act
 * table (`src/data/acts.ts`) to know which map generator an act uses, and that
 * module already imports this one. The mapping therefore lives in
 * `src/state/save.ts`, which is a leaf, and this stays a two-line setter.
 */
export function adoptRun(run: RunState, cursor: number): RunState {
  active = run;
  nextUid = cursor;
  return run;
}

/**
 * Forget the active run without starting another.
 *
 * `startRun` is not a substitute: it *generates a map*, which is 第一幕's whole
 * random stream spent on a run nobody asked for. The title screen needs the
 * former and not the latter when a save is discarded.
 */
export function endRun(): void {
  active = null;
  nextUid = 0;
}

/** Display floor number (1-based). 0 means "not yet entered the map". */
export function currentFloor(run: RunState): number {
  if (!run.currentNodeId) return 0;
  return run.map.nodes.get(run.currentNodeId)!.row + 1;
}

/** Node ids the player may click right now. */
export function availableNodes(run: RunState): string[] {
  if (!run.currentNodeId) return [...run.map.byRow[0]];
  return [...run.map.nodes.get(run.currentNodeId)!.children];
}

export function travelTo(run: RunState, nodeId: string): void {
  const node = run.map.nodes.get(nodeId);
  if (!node) return;
  node.visited = true;
  run.currentNodeId = nodeId;
  run.path.push(nodeId);
  // 埋点 (todos/22)：`path` 每幕清空，登临数和路线要跨幕活到结算，所以另记。
  run.stats.floorsClimbed += 1;
  run.stats.route.push({ act: run.act, row: node.row, type: node.type });
}

/**
 * Wipe everything an act owns, leaving 体力 / 牌组 / 宝物 / 资财 alone.
 *
 * The half of todos/09's `advanceAct` that has nothing to do with which act
 * comes next, split out so it can be tested on its own and so the act table
 * (`src/data/acts.ts`) is the only thing 09 has to add on top:
 * `advanceAct` asserts the 战利品 chest has been answered, calls this, then
 * bumps `run.act`, builds the new map and pays the 幕间 heal.
 *
 * **`rooms` is cleared, not prefixed.** Node ids are `${row}_${col}` plus the
 * literal `boss`, so every id repeats in the next act. Left in place: a combat
 * node would read back the *previous* act's `encounterId`, a mismatched ledger
 * kind would throw the player out of the run outright, and
 * `bossOfferPending('boss')` would answer false — the 战利品 chest would never
 * open again. Cross-act history belongs to a field of its own (todos/22), not
 * to the room ledger.
 */
export function clearActProgress(run: RunState): void {
  run.rooms = {};
  run.usedEncounters = [];
  run.actCombatCount = 0;
  run.bossRelicOffer = null;
  run.currentNodeId = null;
  run.path = [];
}

// ------------------------------------------------------------- run mutations

export function heal(run: RunState, amount: number): number {
  const before = run.hp;
  run.hp = Math.min(run.maxHp, run.hp + amount);
  return run.hp - before;
}

/** Gains are scaled by the relic multiplier; spending is charged at face value. */
export function addGold(run: RunState, amount: number): void {
  const gained =
    amount > 0 ? Math.floor(amount * relicModifiers(run.relics).goldMultiplier) : amount;
  const before = run.gold;
  run.gold = Math.max(0, run.gold + gained);
  // 埋点 (todos/22)：按钱袋的实际进出记——宝物加成算进「入」，被 0 兜底的
  // 那截扣不到就不记，账本上的数永远是真发生过的。
  const delta = run.gold - before;
  if (delta > 0) run.stats.goldEarned += delta;
  else run.stats.goldSpent -= delta;
}

export const hasRelic = (run: RunState, id: string): boolean => run.relics.includes(id);

/** Rejects unknown ids and duplicates — a relic is owned once or not at all. */
export function addRelic(run: RunState, id: string): boolean {
  const def = RELICS[id];
  if (!def || hasRelic(run, id)) return false;
  run.relics.push(id);
  // A max-HP relic heals for what it grants, so picking one up is never a loss.
  const gain = def.modifiers?.maxHp ?? 0;
  run.maxHp += gain;
  run.hp += gain;
  // 药囊 widens the belt the moment it is picked up, not at the next fight,
  // and 求贤令 / 独断 widen or narrow the next reward the same way.
  syncPotionSlots(run);
  syncRewardCount(run);
  return true;
}

// ------------------------------------------------------------------- potions

export const hasPotionSpace = (run: RunState): boolean => run.potions.includes(null);

/** Into the first free slot. False means the belt is full — ask the player. */
export function addPotion(run: RunState, id: string): boolean {
  getPotion(id);
  const slot = run.potions.indexOf(null);
  if (slot < 0) return false;
  run.potions[slot] = id;
  return true;
}

/** Empties a slot and hands back what was in it, so a swap is two calls. */
export function removePotion(run: RunState, slot: number): string | null {
  const id = run.potions[slot] ?? null;
  if (id !== null) run.potions[slot] = null;
  return id;
}

/**
 * The map's half of `usePotion`. Only `heal` is honoured out here, which is
 * exactly the set `usableOutOfCombat` marks — anything else has no combat to
 * resolve against, so the potion is refused rather than silently wasted.
 */
export function usePotionOutOfCombat(run: RunState, slot: number): boolean {
  const id = run.potions[slot];
  if (!id) return false;
  const def = getPotion(id);
  if (!def.usableOutOfCombat) return false;

  for (const effect of def.effects) {
    if (effect.kind === 'heal') heal(run, effect.amount);
  }
  run.potions[slot] = null;
  // 埋点 (todos/22)：战斗内的那半由 `recordCombatEvents` 数 `potion` 事件。
  run.stats.potionsUsed += 1;
  return true;
}

/**
 * The reward channel. A 状态牌 exists for one fight and is minted into
 * `state.cards`; letting one into the deck would make it permanent, which is
 * the single thing that separates it from a curse. A 诅咒 is permanent by
 * definition but is never *won* — it is inflicted, and that has its own door.
 *
 * Loud rather than silent, and a runtime check rather than a rarity convention:
 * `CARD_POOL_BY_RARITY` only types its keys, so a curse pushed into one of its
 * arrays would otherwise typecheck all the way into the player's deck.
 */
export function addCard(run: RunState, cardId: string, upgraded = 0): DeckCard {
  const def = getCard(cardId);
  if (isNegative(def)) {
    throw new Error(`${def.type} cards are never a reward: ${cardId} — use addCurse`);
  }
  return pushCard(run, cardId, upgraded);
}

/** Events, relics and enemies inflict these; they ride in the deck for good. */
export function addCurse(run: RunState, defId: string): DeckCard {
  if (getCard(defId).type !== 'curse') throw new Error(`Not a curse: ${defId}`);
  return pushCard(run, defId, 0);
}

function pushCard(run: RunState, cardId: string, upgraded: number): DeckCard {
  const card = newDeckCard(cardId, upgraded);
  run.deck.push(card);
  return card;
}

/**
 * No door may thin a deck below this. Nothing in the engine breaks at four
 * cards, but a deck that cannot fill an opening hand is a run the player cannot
 * recover, and nothing should be able to sell that.
 *
 * It lives here rather than in `shop.ts` because the shop is not the only door:
 * `EventOutcome.removeCards` reaches `removeCard` through `resolvePending`, and
 * that path had no floor at all — an event asking for three cards from a
 * three-card deck emptied it.
 */
export const MIN_DECK_SIZE = 4;

/**
 * 「不可移除」之牌 (todos/19 a4 的宿业)。商店弃卡、奇遇/祝福的弃牌与易牌——
 * 一切「从牌组移除」的门——都拿这一个谓词问，答案永远一致。
 */
export const isRemovable = (card: DeckCard): boolean => getCard(card.defId).removable !== false;

/** 选牌网格压暗一张不可移除的牌时给出的理由；可移除返回 null。 */
export const removeDisabledReason = (card: DeckCard): string | null =>
  isRemovable(card) ? null : '不可移除';

/**
 * How many copies may still be shed before the floor is reached. Capped a
 * second way by what is removable at all (a4)：一副全是宿业的牌组一张也弃
 * 不得，无论它比地板厚多少。
 */
export const removableCount = (run: RunState): number =>
  Math.min(Math.max(0, run.deck.length - MIN_DECK_SIZE), run.deck.filter(isRemovable).length);

/**
 * The one removal primitive, by uid so the right physical copy goes. 商店弃卡,
 * 营帐弃甲 and 五丈原 all end up here — a curse the player cannot shed is just
 * punishment, so this must exist before any curse is handed out.
 *
 * Deliberately *not* floored itself: a caller that means "shed this exact copy"
 * — undoing a grant, a future 弃甲 — must still be able to. The floor belongs
 * to the doors the player walks through, and both of them apply it. 同理，
 * `removable === false`（宿业）也拦在门上（`buyRemoval` / `applyPick`），
 * 不拦在这里。
 */
export function removeCard(run: RunState, uid: string): boolean {
  const at = run.deck.findIndex((c) => c.uid === uid);
  if (at < 0) return false;
  run.deck.splice(at, 1);
  return true;
}

/** Cards the blacksmith may offer — already-upgraded copies are excluded. */
export function upgradableCards(run: RunState): DeckCard[] {
  return run.deck.filter((c) => canUpgrade(c.defId, c.upgraded));
}

export function upgradeCard(run: RunState, uid: string): boolean {
  const card = run.deck.find((c) => c.uid === uid);
  if (!card || !canUpgrade(card.defId, card.upgraded)) return false;
  card.upgraded += 1;
  return true;
}

/** Carry the surviving HP total back out of a fight. */
export function applyCombatResult(run: RunState, hpAfter: number): void {
  run.hp = Math.max(0, hpAfter);
}

export const isRunOver = (run: RunState): boolean => run.hp <= 0;

// ------------------------------------------------------------- 统计 (22)

/**
 * 把一批战斗事件累入账本 (todos/22)。约定 8 不让引擎写 `RunState`——无头模拟
 * 里没有跑团可写——所以引擎只发 `CombatEvent`，由驱动战斗的一方（`CombatScene`
 * drain 事件队列时）把同一批事件喂到这里。每个事件恰好被 drain 一次
 * （`events.splice(0)`），所以这里不需要任何去重。
 *
 * `damage` 事件的 `amount` 已是穿过护甲的实际掉血，按 target 是否玩家分两栏；
 * `death` 只有真死才发（逃走是 `escape`、分裂是 `split`），数它就是斩获；
 * `potion` 每喝一瓶恰好一枚。
 *
 * 返回本批事件里**玩家**掉的血——`CombatScene` 拿它累「本场无伤」的判定。
 */
export function recordCombatEvents(
  stats: RunStats,
  events: readonly CombatEvent[],
  playerId: string,
): number {
  let taken = 0;
  for (const ev of events) {
    if (ev.t === 'damage') {
      if (ev.targetId === playerId) {
        stats.damageTaken += ev.amount;
        taken += ev.amount;
      } else {
        stats.damageDealt += ev.amount;
      }
    } else if (ev.t === 'death') {
      stats.enemiesSlain += 1;
    } else if (ev.t === 'potion') {
      stats.potionsUsed += 1;
    }
  }
  return taken;
}

/**
 * 一场打赢的战斗按档次入账 (todos/22)：精英/首领各记一笔，无伤（本场掉血
 * 恰为 0，含被护甲全挡下的）另记「全甲」/「秋毫无犯」。杂兵不入此账——
 * 斩获已经按 `death` 事件数过了。
 *
 * 只能在**未 resumed** 的胜利里调一次：存档恢复的胜利画面在写档前已经
 * 结算过（见 `CombatScene.showVictory` 对 `resolveCombatEndHooks` 的同款处理）。
 */
export function recordFightSettled(
  run: RunState,
  tier: CombatTier,
  fightDamageTaken: number,
): void {
  if (tier === 'elite') {
    run.stats.elitesSlain += 1;
    if (fightDamageTaken === 0) run.stats.flawlessElites += 1;
  } else if (tier === 'boss') {
    run.stats.bossesSlain += 1;
    if (fightDamageTaken === 0) run.stats.flawlessBosses += 1;
  }
}
