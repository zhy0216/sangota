import { Rng } from '../core/rng';
import type { AscensionMods } from '../data/ascension';
import { resolveCard } from './cards';
import { getEnemy, phaseOf, type CombatTier } from './enemies';
import { REVIVE_HP, getPotion, type PotionSpecial } from './potions';
import { fireHook, relicDamageBonus, relicEvent, relicModifiers } from './relics';
import { STATUS_META, STATUS_ORDER, type BlockSource, type TickPhase } from './statuses';
import type {
  CardDef,
  CardHooks,
  CardInstance,
  CardKeyword,
  Combatant,
  CombatState,
  Effect,
  EffectCondition,
  EnemyDef,
  EnemyMove,
  EnemyPhase,
  EnemyState,
  Encounter,
  MoveCondition,
  PendingChoice,
  QueuedStep,
  StatusId,
} from './types';

/**
 * Pure combat rules — no Phaser, no rendering. The scene drives it by calling
 * these functions and animating whatever lands in `state.events`.
 */

/**
 * Baselines only: relic modifiers are added on top in `startCombat`, and the
 * rest of the engine reads `state.handSize` / `state.maxEnergy` rather than
 * these, so a relic can move either number.
 */
export const HAND_SIZE = 5;
export const MAX_HAND = 10;
export const BASE_ENERGY = 3;

/** A card printed with this cost spends every point of 气 the player has. */
export const X_COST = -1;

/** 身法/力竭 shape block a fighter *earns* by acting; 重甲 and 宝物 grant flat. */
const SHAPED_BLOCK: readonly BlockSource[] = ['card', 'enemyMove'];

export interface StartCombatOptions {
  encounter: Encounter;
  /** Structurally a `DeckCard[]` — the engine stays clear of run state. */
  deck: readonly CardInstance[];
  heroName: string;
  hp: number;
  maxHp: number;
  /** Relic ids, in pickup order. Ids alone — the engine never sees run state. */
  relics: readonly string[];
  seed: string;
  /** 天命 (todos/19)：遭遇档位，天命倍率按它取档。缺省按杂兵算。 */
  tier?: CombatTier;
  /**
   * 天命 (todos/19)：难度修饰器。和 relics 一个待遇——由调用方传进来，引擎
   * 绝不自己去读 RunState 或 localStorage。缺省即零重，所有倍率恒等。
   */
  mods?: AscensionMods;
}

// ------------------------------------------------------------------- setup

export function startCombat(opts: StartCombatOptions): CombatState {
  const rng = new Rng(opts.seed);
  const mods = relicModifiers(opts.relics);

  // 天命 (todos/19)：两个倍率在这一刻按档位取死，此后整场只读。零重（或不传）
  // 恒为 1——乘 1 不动任何数字也不多花一次骰，37 个黄金快照因此一枚不漂。
  const tier = opts.tier ?? 'monster';
  const enemyHpMult = opts.mods?.hpMult[tier] ?? 1;
  const enemyDamageMult = opts.mods?.damageMult[tier] ?? 1;

  const cards: Record<string, CardInstance> = {};
  const drawPile: string[] = [];
  for (const card of opts.deck) {
    cards[card.uid] = { ...card };
    drawPile.push(card.uid);
  }
  rng.shuffle(drawPile);

  const enemies = opts.encounter.enemies.map((defId, slot) =>
    makeEnemy(defId, slot, rng, enemyHpMult),
  );

  const state: CombatState = {
    turn: 0,
    phase: 'player',
    energy: 0,
    maxEnergy: BASE_ENERGY + mods.energy,
    handSize: Math.max(0, HAND_SIZE + mods.handSize),
    enemyHpMult,
    enemyDamageMult,
    player: {
      id: 'player',
      name: opts.heroName,
      hp: opts.hp,
      maxHp: opts.maxHp,
      block: 0,
      statuses: {},
    },
    enemies,
    cards,
    drawPile: liftInnate(cards, drawPile),
    hand: [],
    discardPile: [],
    exhaustPile: [],
    attacksThisTurn: 0,
    cardsPlayedThisTurn: 0,
    effectQueue: [],
    pendingChoice: null,
    pendingRevive: 0,
    nextUid: 0,
    relics: [...opts.relics],
    relicCounters: {},
    rng,
    events: [],
  };

  // Granted rather than assigned, so the 护甲 event and the `blockGained` hook
  // see it like any other block. `'relic'` keeps it off the 身法/力竭 scale —
  // 先登盾 promises a flat 4 and must hand over exactly 4.
  gainBlock(state, state.player, mods.startingBlock, 'relic');

  for (const enemy of enemies) pickIntent(state, enemy);
  fireHook(state, 'combatStart');
  startPlayerTurn(state);
  return state;
}

/**
 * 固有 cards are moved to the top of the shuffled pile — `drawPile` is drawn
 * from its end — so they are always in the opening hand. Order is otherwise
 * untouched, which keeps a deck with no innate card bit-identical.
 */
function liftInnate(cards: Record<string, CardInstance>, drawPile: string[]): string[] {
  const innate = (uid: string): boolean => {
    const inst = cards[uid];
    return hasKeyword(resolveCard(inst.defId, inst.upgraded), 'innate');
  };
  if (!drawPile.some(innate)) return drawPile;
  return [...drawPile.filter((uid) => !innate(uid)), ...drawPile.filter(innate)];
}

/**
 * `passives` are written straight into the literal rather than pushed through
 * `addStatus`: a 龟缩 8 an enemy was *printed* with is not something that was
 * applied to it, so it must not emit a `status` event, must not be warded off
 * by a 护身符 it also carries, and must not depend on table order. `rng.range`
 * still runs exactly once per enemy, which is what keeps every seed replaying.
 *
 * `hpMult` 是天命 (todos/19) 的 HP 倍率：先照旧掷区间，再乘、再取整——骰数
 * 不变，零重乘 1 就是原数，任何一个既有 seed 的敌人一滴血都不动。
 */
function makeEnemy(defId: string, slot: number, rng: Rng, hpMult: number): EnemyState {
  const def = getEnemy(defId);
  const hp = Math.round(rng.range(def.hp[0], def.hp[1]) * hpMult);
  return {
    id: `${defId}-${slot}`,
    defId,
    name: def.name,
    art: def.art,
    height: def.height,
    hp,
    maxHp: hp,
    block: 0,
    statuses: { ...def.passives },
    intent: null,
    repeat: 0,
    alive: true,
    slot,
    actedTurns: 0,
    phase: null,
    crossed: [],
    escaped: false,
  };
}

/** The move table in force: the phase the enemy switched into, or the default. */
const moveSet = (def: EnemyDef, enemy: EnemyState): EnemyPhase => phaseOf(def, enemy.phase);

/** Living enemies, the one asking included — 「友军」 in a `MoveCondition`. */
const allyCount = (state: CombatState): number => aliveEnemies(state).length;

function moveAllowed(state: CombatState, enemy: EnemyState, cond: MoveCondition): boolean {
  switch (cond.c) {
    // Integer maths, like every other HP condition: no float decides a move.
    case 'selfHpBelow':
      return enemy.hp * 100 < enemy.maxHp * cond.percent;
    case 'selfHpAtLeast':
      return enemy.hp * 100 >= enemy.maxHp * cond.percent;
    case 'turnAtLeast':
      return state.turn >= cond.n;
    case 'alliesAtLeast':
      return allyCount(state) >= cond.n;
    case 'alliesAtMost':
      return allyCount(state) <= cond.n;
  }
}

/**
 * Weighted pick over the moves currently on the table, skipping any move that
 * has already run `maxRepeat` times in a row so enemies don't lock into one
 * action. A table with no `when` on any row rolls over exactly the pool — same
 * members, same order, same weights — that it always did.
 */
function rollMove(state: CombatState, enemy: EnemyState, moves: EnemyMove[]): EnemyMove {
  const open = moves.filter((m) => !m.when || moveAllowed(state, enemy, m.when));
  let pool = open.filter(
    (m) => !(enemy.intent?.id === m.id && enemy.repeat >= (m.maxRepeat ?? Infinity)),
  );
  // Two fallbacks, narrowest first: the repeat cap yields before a `when` gate
  // does, and a table that gates every row out still has to produce something.
  if (pool.length === 0) pool = open;
  if (pool.length === 0) pool = moves;

  return state.rng.weighted(
    pool,
    pool.map((m) => m.weight ?? 1),
  );
}

/**
 * The scripted branch. Rolls nothing at all: the whole value of a 套路 is that
 * the same seed and a different one produce the same order.
 */
function scriptedMove(set: EnemyPhase, enemy: EnemyState): EnemyMove {
  const order = set.script!.order;
  const from = Math.min(Math.max(set.script!.loopFrom ?? 0, 0), order.length - 1);
  let i = enemy.actedTurns;
  if (i >= order.length) i = from + ((i - from) % (order.length - from));

  const move = set.moves.find((m) => m.id === order[i]);
  if (!move) throw new Error(`${enemy.defId}: script names unknown move '${order[i]}'`);
  return move;
}

/** Chooses and telegraphs the enemy's next move. */
export function pickIntent(state: CombatState, enemy: EnemyState): void {
  const set = moveSet(getEnemy(enemy.defId), enemy);
  const picked = set.script ? scriptedMove(set, enemy) : rollMove(state, enemy, set.moves);

  enemy.repeat = enemy.intent?.id === picked.id ? enemy.repeat + 1 : 1;
  enemy.intent = picked;
}

// -------------------------------------------------------------- turn cycle

export function startPlayerTurn(state: CombatState): void {
  // Turn 1 keeps whatever combatStart relics granted; later turns wipe as usual.
  if (state.turn > 0) clearBlock(state.player);
  state.turn += 1;
  state.phase = 'player';
  state.energy = state.maxEnergy;
  state.attacksThisTurn = 0;
  state.cardsPlayedThisTurn = 0;
  // 中毒 bites after the block wipe and before the draw, so a stack can never
  // be soaked by armour that is about to be thrown away anyway.
  tickStatuses(state, state.player, 'ownerTurnStart');
  if (state.player.hp <= 0) {
    state.phase = 'lost';
    return;
  }
  fireHook(state, 'turnStart');
  drawCards(state, state.handSize);
}

/** Turn-start wipe. 深沟高垒 keeps the wall standing. */
function clearBlock(target: Combatant): void {
  if (stacks(target, 'barricade') > 0) return;
  target.block = 0;
}

export function drawCards(state: CombatState, count: number): void {
  // 断粮 stops every draw for the turn, card and relic alike.
  if (stacks(state.player, 'noDraw') > 0) return;

  for (let i = 0; i < count; i++) {
    if (state.hand.length >= MAX_HAND) return;
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) return;
      state.drawPile = state.rng.shuffle(state.discardPile);
      state.discardPile = [];
      state.events.push({ t: 'shuffle' });
      fireHook(state, 'shuffle');
    }
    const uid = state.drawPile.pop();
    if (!uid) return;
    state.hand.push(uid);
    state.events.push({ t: 'draw', uid });
    // 醉 charges its 气 here, while the turn can still be replanned around it.
    fireCardHook(state, uid, 'onDrawn');
  }
}

/**
 * A card's own hook, for the handful of cards whose behaviour fires from
 * somewhere other than being played. Looked up per call rather than cached —
 * `defOf` already resolves upgrades, and no card in either table has one.
 */
function fireCardHook(
  state: CombatState,
  uid: string,
  hook: 'onDrawn' | 'onEndTurnInHand' | 'onCardPlayedInHand',
): void {
  const fn: CardHooks[typeof hook] = defOf(state, uid).hooks?.[hook];
  fn?.(state, uid);
}

export function endPlayerTurn(state: CombatState): void {
  if (state.phase !== 'player') return;
  // A card is still asking the player a question; the turn cannot end on it.
  if (state.pendingChoice) return;

  fireHook(state, 'turnEnd');

  /*
   * Statuses tick *before* the hand is dealt with, which is what lets 疑心's
   * 怯战 survive into the enemy turn — ticking afterwards would strip the layer
   * the curse had just applied and the card would do nothing at all. 焚营 in
   * turn needs its hook to run while it is still in hand, which the same order
   * gives. Nothing in the hand pass reads a status, so this costs the existing
   * pool nothing.
   */
  tickStatuses(state, state.player, 'ownerTurnEnd');
  for (const uid of [...state.hand]) fireCardHook(state, uid, 'onEndTurnInHand');

  // 虚无 burns, 保留 stays, everything else goes to the discard pile.
  const kept: string[] = [];
  for (const uid of state.hand) {
    const def = defOf(state, uid);
    if (hasKeyword(def, 'ethereal')) {
      exhaustCard(state, uid);
    } else if (hasKeyword(def, 'retain')) {
      kept.push(uid);
    } else {
      state.discardPile.push(uid);
      state.events.push({ t: 'discard', uid });
    }
  }
  state.hand = kept;

  state.phase = 'enemy';
  // 焚营 can be the killing blow, and a dead player takes no enemy turn.
  checkEnd(state);
}

/**
 * Resolves every living enemy's intent, then hands the turn back.
 *
 * Both loops walk one snapshot taken before anything moves, so a summon that
 * lands mid-turn neither acts on the turn it was called (it was not on the
 * field when the turn opened) nor has its telegraph re-rolled — `summonEnemies`
 * already picked one for it.
 */
export function runEnemyTurn(state: CombatState): void {
  if (state.phase !== 'enemy') return;
  const acting = [...state.enemies];

  for (const enemy of acting) {
    if (!enemy.alive) continue;
    clearBlock(enemy);
    tickStatuses(state, enemy, 'ownerTurnStart');
    if (!enemy.alive) continue;
    const move = enemy.intent;
    if (!move) continue;
    state.events.push({ t: 'enemyMove', enemyId: enemy.id, label: move.label });
    executeMove(state, enemy, move);
    // Counted even for a move cut short by a 反刺 kill: the script cursor tracks
    // turns taken, not blows landed.
    enemy.actedTurns += 1;
    if (state.player.hp <= 0) {
      // Through `checkEnd`, not by assigning the phase: a fight that ends must
      // also drop `pendingChoice` and drain `effectQueue` (`endCombat`), or the
      // scene is left showing a mandatory, non-dismissable card grid over a
      // finished combat. Setting the phase inline was the one path in the
      // engine that skipped the very cleanup `endCombat` exists for.
      checkEnd(state);
      return;
    }
  }

  for (const enemy of acting) {
    if (!enemy.alive) continue;
    tickStatuses(state, enemy, 'ownerTurnEnd');
    pickIntent(state, enemy);
  }

  fireHook(state, 'enemyTurnEnd');
  checkEnd(state);
  if (state.phase === 'enemy') startPlayerTurn(state);
}

/**
 * One move, resolved in a fixed order:
 *
 *   护甲 → 伤害 → 状态 → 群体状态 → 直接扣血 → 塞牌 → 召唤 → 掠夺 → 遁走
 *
 * The first three are the order the game shipped with and are deliberately
 * untouched. The rest hang off the back of it, and 遁走 is last for the obvious
 * reason: an enemy has to finish what it came to do before it leaves.
 */
function executeMove(state: CombatState, enemy: EnemyState, move: EnemyMove): void {
  if (move.block) gainBlock(state, enemy, move.block, 'enemyMove');
  if (move.damage) {
    // 天命 (todos/19)：倍率乘在这里、`computeAttack` 之前——它是「基础值更高」，
    // 不是又一层状态乘区，顺序反了就和怯战/破绽的取整次序对不上。
    const damage = scaleEnemyDamage(state, move.damage);
    const hits = move.hits ?? 1;
    for (let i = 0; i < hits; i++) {
      dealAttack(state, enemy, state.player, damage);
      if (state.player.hp <= 0) return;
      // 反刺 can kill the attacker mid-combo; a corpse does not finish swinging.
      if (!enemy.alive) return;
    }
  }
  if (move.status) {
    const target = move.status.to === 'self' ? enemy : state.player;
    addStatus(state, target, move.status.status, move.status.amount);
  }
  if (move.statusAll) {
    // Snapshot: 群体状态 must not reach a body that joins later in this move.
    for (const ally of aliveEnemies(state)) {
      addStatus(state, ally, move.statusAll.status, move.statusAll.amount);
    }
  }
  if (move.loseHp) {
    resolveDamage(state, {
      attacker: null,
      defender: state.player,
      base: move.loseHp,
      isAttack: false,
      pierceBlock: true,
    });
    if (state.player.hp <= 0) return;
  }
  if (move.addCards) {
    const { defId, count, to } = move.addCards;
    for (let i = 0; i < count; i++) placeCard(state, mintCard(state, defId, 0), to);
  }
  if (move.summon) summonEnemies(state, enemy, move.summon);
  if (move.steal) state.events.push({ t: 'steal', enemyId: enemy.id, amount: move.steal });
  if (move.escape) leaveFight(state, enemy);
}

/**
 * Appends bodies to the field. `slot` is `enemies.length` and the array only
 * ever grows, so both `slot` and the derived `id` stay unique for the whole
 * fight even when the same def is called twice.
 */
function summonEnemies(
  state: CombatState,
  summoner: EnemyState,
  spec: { defId: string; count: number },
): void {
  const spawned: string[] = [];
  for (let i = 0; i < spec.count; i++) {
    // 天命倍率照给：中途入场的身体和开场的同属一个遭遇档位。
    const child = makeEnemy(spec.defId, state.enemies.length, state.rng, state.enemyHpMult);
    state.enemies.push(child);
    // Telegraphed at birth, like any enemy `startCombat` builds.
    pickIntent(state, child);
    spawned.push(child.id);
  }
  state.events.push({ t: 'summon', enemyId: summoner.id, spawned });
}

/**
 * Off the field without dying. No `death` event and no `enemyKilled` hook — 枭首令
 * must not pay 神力 for a thief who got away — but `alive: false` all the same,
 * so a room emptied by flight is still a win.
 */
function leaveFight(state: CombatState, enemy: EnemyState): void {
  if (!enemy.alive) return;
  enemy.alive = false;
  enemy.escaped = true;
  enemy.intent = null;
  state.events.push({ t: 'escape', targetId: enemy.id });
}

// ------------------------------------------------------------- playing cards

export const hasKeyword = (def: CardDef, keyword: CardKeyword): boolean =>
  !!def.keywords?.includes(keyword);

export function canPlay(state: CombatState, uid: string): boolean {
  if (state.phase !== 'player') return false;
  // Everything is frozen while a card waits on the player's pick.
  if (state.pendingChoice) return false;
  if (!state.hand.includes(uid)) return false;

  const def = defOf(state, uid);
  if (hasKeyword(def, 'unplayable')) return false;
  if (def.type === 'attack' && stacks(state.player, 'entangled') > 0) return false;
  // A curse in hand may forbid every other card — 宿命's three-card cap.
  for (const other of state.hand) {
    const gate = defOf(state, other).hooks?.restrictPlay;
    if (gate && !gate(state)) return false;
  }
  // An X-cost card is affordable at any 气, including none.
  return def.cost === X_COST || state.energy >= def.cost;
}

export function playCard(state: CombatState, uid: string, targetId?: string): boolean {
  if (!canPlay(state, uid)) return false;
  const def = defOf(state, uid);

  let target: EnemyState | undefined;
  if (def.target === 'enemy') {
    target = state.enemies.find((e) => e.id === targetId && e.alive);
    if (!target) return false;
  }

  const spent = def.cost === X_COST ? state.energy : def.cost;
  state.energy -= spent;
  state.hand.splice(state.hand.indexOf(uid), 1);

  // Announced before the effects resolve, so the flourish leads the damage.
  const bonus = relicDamageBonus(state, def);
  for (const relic of bonus.sources) state.events.push(relicEvent(relic));

  enqueue(state, def.effects, {
    target,
    bonus: bonus.amount,
    energy: spent,
    attacks: state.attacksThisTurn,
  });
  pumpEffects(state);

  /*
   * The card leaves play now even if its own effects are still parked on a
   * `pendingChoice`: the choice picks out of the hand, and a card that is
   * simultaneously resolving and choosable would be able to exhaust itself.
   */
  if (hasKeyword(def, 'exhaust')) exhaustCard(state, uid);
  else state.discardPile.push(uid);

  if (def.type === 'attack') state.attacksThisTurn += 1;
  state.cardsPlayedThisTurn += 1;
  // 反噬 bleeds for a card that actually resolved. The card just played has
  // already left the hand, so a lone 反噬 never charges for itself.
  for (const other of [...state.hand]) fireCardHook(state, other, 'onCardPlayedInHand');

  fireHook(state, 'cardPlayed', def);
  if (def.type === 'attack') fireHook(state, 'attackPlayed', def);

  checkEnd(state);
  return true;
}

/** Sends a card to the 消耗堆 from wherever it was. */
export function exhaustCard(state: CombatState, uid: string): void {
  state.exhaustPile.push(uid);
  state.events.push({ t: 'exhaust', uid });
}

// ------------------------------------------------------------------ potions

/**
 * 丹药 cost no 气, no card and no play limit — but they resolve through the
 * same `applyEffect` queue everything else does, so 火油罐 takes 破绽 and 神力
 * exactly the way an attack card would. That shared path is the entire reason
 * `PotionDef.effects` is the card `Effect` union rather than a second system.
 */
export function usePotion(state: CombatState, potionId: string, targetId?: string): boolean {
  if (state.phase !== 'player') return false;
  // Everything is frozen while a card waits on the player's pick.
  if (state.pendingChoice) return false;

  const def = getPotion(potionId);
  let target: EnemyState | undefined;
  if (def.target === 'enemy') {
    target = state.enemies.find((e) => e.id === targetId && e.alive);
    if (!target) return false;
  }

  state.events.push({ t: 'potion', potionId });
  if (def.special) applyPotionSpecial(state, def.special);
  // `bonus: 0` deliberately: the relic damage bonus is keyed on 「打出【攻】牌」
  // and a 丹药 is no card, so drinking one must never spend that turn's passive.
  enqueue(state, def.effects, { target, bonus: 0, energy: 0, attacks: state.attacksThisTurn });
  pumpEffects(state);
  checkEnd(state);
  return true;
}

/** The three behaviours no `Effect` expresses. Nothing else branches on an id. */
function applyPotionSpecial(state: CombatState, special: PotionSpecial): void {
  switch (special) {
    case 'cleanseDebuffs':
      for (const id of STATUS_ORDER) {
        if (STATUS_META[id].kind !== 'debuff' || stacks(state.player, id) === 0) continue;
        delete state.player.statuses[id];
        state.events.push({ t: 'statusBlocked', targetId: state.player.id, status: id });
      }
      break;
    case 'reviveOnce':
      state.pendingRevive = REVIVE_HP;
      break;
    case 'duplicateHand':
      // Snapshot the hand first, or the copies start copying themselves.
      for (const uid of [...state.hand]) {
        const inst = state.cards[uid];
        placeCard(state, mintCard(state, inst.defId, inst.upgraded), 'hand');
      }
      break;
  }
}

// ---------------------------------------------------------------- effects

type StepContext = Omit<QueuedStep, 'effect'>;

function enqueue(
  state: CombatState,
  effects: readonly Effect[],
  ctx: StepContext,
  front = false,
): void {
  const steps = effects.map((effect) => ({ effect, ...ctx }));
  if (front) state.effectQueue.unshift(...steps);
  else state.effectQueue.push(...steps);
}

/**
 * Drains the queue. Stops dead on a `pendingChoice` and leaves the remaining
 * steps parked, which is what keeps "弃 2 张牌，然后抽 2 张" resolving in order
 * across the interruption.
 */
export function pumpEffects(state: CombatState): void {
  while (!state.pendingChoice && state.effectQueue.length > 0) {
    applyEffect(state, state.effectQueue.shift()!);
  }
}

function applyEffect(state: CombatState, step: QueuedStep): void {
  const effect = step.effect;
  const ctx: StepContext = {
    target: step.target,
    bonus: step.bonus,
    energy: step.energy,
    attacks: step.attacks,
  };

  switch (effect.kind) {
    case 'damage': {
      // Each hit is priced on its own, so 破绽 applies to every one of them.
      // 反刺 can kill mid-combo, and a corpse does not finish swinging either.
      for (let i = 0; i < (effect.times ?? 1); i++) {
        if (!step.target?.alive || state.player.hp <= 0) break;
        dealAttack(state, state.player, step.target, effect.amount + step.bonus);
      }
      break;
    }
    case 'damageAll': {
      for (let i = 0; i < (effect.times ?? 1); i++) {
        if (state.player.hp <= 0) break;
        for (const enemy of aliveEnemies(state)) {
          if (state.player.hp <= 0) break;
          dealAttack(state, state.player, enemy, effect.amount + step.bonus);
        }
      }
      break;
    }
    case 'block':
      gainBlock(state, state.player, effect.amount, 'card');
      break;
    case 'status': {
      if (effect.to === 'allEnemies') {
        for (const enemy of aliveEnemies(state)) {
          addStatus(state, enemy, effect.status, effect.amount);
        }
        break;
      }
      const who = effect.to === 'self' ? state.player : step.target;
      if (who) addStatus(state, who, effect.status, effect.amount);
      break;
    }
    case 'draw':
      drawCards(state, effect.amount);
      break;
    case 'loseHp':
      resolveDamage(state, {
        attacker: null,
        defender: state.player,
        base: effect.amount,
        isAttack: false,
        pierceBlock: true,
      });
      break;
    case 'heal':
      healCombatant(state, state.player, effect.amount);
      break;
    case 'energy':
      state.energy = Math.max(0, state.energy + effect.amount);
      break;
    case 'discard':
      chooseFromHand(state, 'discard', effect.amount, effect.random ?? false);
      break;
    case 'exhaustCards':
      chooseFromHand(state, 'exhaust', effect.amount, false);
      break;
    case 'addCard':
      for (let i = 0; i < effect.count; i++) {
        placeCard(state, mintCard(state, effect.defId, effect.upgraded ?? 0), effect.to);
      }
      break;
    case 'shuffleDiscardIn':
      if (state.discardPile.length === 0) break;
      state.drawPile = state.rng.shuffle([...state.drawPile, ...state.discardPile]);
      state.discardPile = [];
      state.events.push({ t: 'shuffle' });
      fireHook(state, 'shuffle');
      break;
    case 'conditional': {
      const branch = conditionMet(state, effect.when, step.target)
        ? effect.then
        : (effect.otherwise ?? []);
      // Front of the queue: a conditional's body belongs to the card's own turn
      // of the resolution, ahead of whatever the card queued after it.
      enqueue(state, branch, ctx, true);
      break;
    }
    case 'scaleWithEnergy': {
      const repeated: Effect[] = [];
      for (let i = 0; i < step.energy; i++) repeated.push(...effect.per);
      enqueue(state, repeated, ctx, true);
      break;
    }
    case 'scaleWithAttacks': {
      // `step.attacks`, never `state.attacksThisTurn`: the count is the one
      // frozen when the card was queued, so a card cannot count the attacks
      // its own effects are in the middle of making.
      const repeated: Effect[] = [];
      for (let i = 0; i < step.attacks; i++) repeated.push(...effect.per);
      enqueue(state, repeated, ctx, true);
      break;
    }
  }
}

/**
 * `handSize` is a parameter rather than a read of `state.hand` because a card
 * is spliced out of the hand *before* its effects resolve, so 单刀赴会 asks
 * "will my hand be empty once this is gone?". `applyEffect` therefore gets the
 * default — the post-play hand it is already looking at — while `previewValues`
 * passes the same count one card early, so the face promises what will land.
 */
function conditionMet(
  state: CombatState,
  cond: EffectCondition,
  target: Combatant | undefined,
  handSize: number = state.hand.length,
): boolean {
  switch (cond.c) {
    case 'targetHasStatus':
      return target ? stacks(target, cond.status) >= (cond.min ?? 1) : false;
    case 'selfHasStatus':
      return stacks(state.player, cond.status) >= (cond.min ?? 1);
    case 'handEmpty':
      return handSize === 0;
    case 'attackPlayedThisTurn':
      return state.attacksThisTurn > 0;
    case 'hpBelow':
      // Integer maths: no float compare decides whether a card fires.
      return state.player.hp * 100 < state.player.maxHp * cond.percent;
    case 'enemyCountAtLeast':
      return aliveEnemies(state).length >= cond.n;
    case 'attacksAtLeast':
      return state.attacksThisTurn >= cond.n;
    case 'exhaustedAtLeast':
      return state.exhaustPile.length >= cond.n;
  }
}

/** Engine-minted card. `nextUid` and never `rng`, so a seed replays the uids. */
function mintCard(state: CombatState, defId: string, upgraded: number): string {
  const uid = `g${state.nextUid++}`;
  state.cards[uid] = { uid, defId, upgraded };
  return uid;
}

function placeCard(state: CombatState, uid: string, to: 'hand' | 'draw' | 'discard'): void {
  if (to === 'discard') {
    state.discardPile.push(uid);
    return;
  }
  if (to === 'draw') {
    // Anywhere in the pile, so a generated card cannot be played around.
    state.drawPile.splice(state.rng.int(state.drawPile.length + 1), 0, uid);
    return;
  }
  // A full hand has nowhere to put it; the card is still minted, just discarded.
  if (state.hand.length >= MAX_HAND) {
    state.discardPile.push(uid);
    return;
  }
  state.hand.push(uid);
  state.events.push({ t: 'draw', uid });
}

/**
 * Random picks resolve here and now; a player pick parks the rest of the queue
 * on `state.pendingChoice`. Either way the count is capped by the hand, so
 * "弃 2 张" with one card left asks for one.
 */
function chooseFromHand(
  state: CombatState,
  kind: 'discard' | 'exhaust',
  amount: number,
  random: boolean,
): void {
  const count = Math.min(amount, state.hand.length);
  if (count <= 0) return;

  if (random) {
    for (let i = 0; i < count; i++) {
      applyChoice(state, kind, state.hand[state.rng.int(state.hand.length)]);
    }
    return;
  }
  state.pendingChoice = { kind, options: [...state.hand], min: count, max: count };
}

function applyChoice(state: CombatState, kind: PendingChoice['kind'], uid: string): void {
  const at = state.hand.indexOf(uid);
  if (at < 0) return;
  state.hand.splice(at, 1);
  if (kind === 'exhaust') {
    exhaustCard(state, uid);
  } else if (kind === 'putOnDraw') {
    state.drawPile.push(uid);
  } else {
    state.discardPile.push(uid);
    state.events.push({ t: 'discard', uid });
  }
}

/**
 * Answers the parked question and resumes the queue. Rejects an answer that
 * does not fit the prompt rather than half-applying it, so a buggy UI or policy
 * cannot desync the piles.
 */
export function resolveChoice(state: CombatState, uids: readonly string[]): boolean {
  const choice = state.pendingChoice;
  if (!choice) return false;

  const picked = [...new Set(uids)].filter((uid) => choice.options.includes(uid));
  if (picked.length !== uids.length) return false;
  if (picked.length < choice.min || picked.length > choice.max) return false;

  state.pendingChoice = null;
  for (const uid of picked) applyChoice(state, choice.kind, uid);
  pumpEffects(state);
  checkEnd(state);
  return true;
}

// -------------------------------------------------------------- damage maths

/** Everything one blow needs to know. `attacker: null` means poison or an event. */
export interface DamageContext {
  attacker: Combatant | null;
  defender: Combatant;
  base: number;
  /** Attacks alone read 神力/怯战/破绽 and provoke 反刺. */
  isAttack: boolean;
  /** 中毒 and 自伤 go straight to the body. */
  pierceBlock: boolean;
}

/**
 * 天命 (todos/19)：敌方招式的**基础**伤害过档位倍率，四舍五入成整数。
 *
 * 唯一的入口，`executeMove` 和 `intentOf`/`intentLabel` 都从这里走——分开各乘
 * 一次，意图上的数字和真挨的那一下就有得漂。零重倍率恒 1，乘完取整还是原数。
 */
export const scaleEnemyDamage = (state: CombatState, base: number): number =>
  Math.round(base * state.enemyDamageMult);

/**
 * Strength adds flat, Weak scales the attacker down, Vulnerable scales the
 * defender up — in `STATUS_ORDER`, with a floor after *each* multiply. Folding
 * the two multiplies into one would make a base-5 hit under both read 5 where
 * the original gives 4.
 */
export function computeAttack(base: number, attacker: Combatant, defender: Combatant): number {
  let damage = base;
  for (const id of STATUS_ORDER) {
    const mod = STATUS_META[id].modify;
    if (!mod || mod.slot === 'clamp') continue;
    const owner = mod.slot === 'defenderMult' ? defender : attacker;
    const n = stacks(owner, id);
    if (n === 0) continue;
    damage = mod.fn(n, damage);
    // Negative Strength must not invert into a heal once a multiplier lands.
    if (damage < 0) damage = 0;
  }
  return Math.max(0, damage);
}

/** 金蝉脱壳's clamp — applied to every incoming hit, attack or not. */
export function clampIncoming(damage: number, defender: Combatant): number {
  for (const id of STATUS_ORDER) {
    const mod = STATUS_META[id].modify;
    if (mod?.slot !== 'clamp') continue;
    if (stacks(defender, id) > 0) damage = mod.fn(stacks(defender, id), damage);
  }
  return damage;
}

function dealAttack(
  state: CombatState,
  attacker: Combatant,
  defender: Combatant,
  base: number,
): void {
  resolveDamage(state, { attacker, defender, base, isAttack: true, pierceBlock: false });
}

/**
 * The one damage pipeline, in the original's order:
 *
 *   基础 → 神力 → 怯战 → 破绽 → 金蝉脱壳 → 护甲 → 天佑 → 体力 → 反刺
 *
 * The clamp sits *before* block on purpose: 金蝉脱壳 plus five block against a
 * thirty-damage swing must cost one point of block and no HP.
 */
export function resolveDamage(state: CombatState, ctx: DamageContext): void {
  const defender = ctx.defender;

  let damage =
    ctx.isAttack && ctx.attacker
      ? computeAttack(ctx.base, ctx.attacker, defender)
      : Math.max(0, ctx.base);
  damage = clampIncoming(damage, defender);

  let blocked = 0;
  if (!ctx.pierceBlock) {
    blocked = Math.min(defender.block, damage);
    defender.block -= blocked;
  }

  let hpLoss = damage - blocked;
  if (hpLoss > 0 && stacks(defender, 'buffer') > 0) {
    consumeLayer(defender, 'buffer');
    state.events.push({ t: 'statusBlocked', targetId: defender.id, status: 'buffer' });
    hpLoss = 0;
  }

  defender.hp = Math.max(0, defender.hp - hpLoss);

  // 回天丹 refunds exactly one death, and only the player's. Consumed here
  // rather than in `checkEnd` so nothing downstream — 反刺, the enemy's next
  // hit of a combo, `phase` — ever observes a corpse that is coming back.
  const revive =
    defender.hp === 0 && defender.id === state.player.id && state.pendingRevive > 0
      ? Math.min(state.pendingRevive, defender.maxHp)
      : 0;
  const lethal = defender.hp === 0 && revive === 0;
  state.events.push({ t: 'damage', targetId: defender.id, amount: hpLoss, blocked, lethal });
  if (revive > 0) {
    state.pendingRevive = 0;
    defender.hp = revive;
    state.events.push({ t: 'heal', targetId: defender.id, amount: revive });
  }

  // 血线触发 lands inside the blow that crossed the line, after the kill has
  // been ruled out and before the death event — a half-HP transformation is
  // live for the player's very next card, not a turn late. A corpse transforms
  // into nothing, hence `!lethal`.
  if (!lethal && defender.id !== state.player.id) checkThresholds(state, defender.id);

  if (lethal && defender.id !== state.player.id) {
    const enemy = state.enemies.find((e) => e.id === defender.id);
    if (enemy && enemy.alive) {
      enemy.alive = false;
      enemy.intent = null;
      state.events.push({ t: 'death', targetId: enemy.id });
      fireHook(state, 'enemyKilled', enemy);
      // 斩将 and anything else that reads a kill. Player-scoped, and read fresh
      // per status so one that grants another cannot see a stale count.
      for (const id of STATUS_ORDER) {
        const def = STATUS_META[id];
        const n = stacks(state.player, id);
        if (def.onEnemyKilled && n > 0) def.onEnemyKilled(state, state.player, n);
      }
    }
  }

  if (defender.id === state.player.id && hpLoss > 0) fireHook(state, 'damageTaken', hpLoss);

  // Reactions are the defender's answer to being *attacked*: reflected and
  // reactive damage carries `isAttack: false`, which is what bounds the
  // recursion between two 反刺 holders at one exchange. A dead defender still
  // gets its answer — 反刺 is paid by whoever swung, killing blow or not — and
  // each row decides for itself whether a corpse or a fully blocked hit counts.
  if (ctx.isAttack) {
    for (const id of STATUS_ORDER) {
      const def = STATUS_META[id];
      if (def.onAttacked && stacks(defender, id) > 0) {
        def.onAttacked(state, defender, ctx, hpLoss, blocked);
      }
    }
  }
}

/** Block soaks first; only the remainder is HP loss, and only that can kill. */
export function applyDamage(state: CombatState, target: Combatant, damage: number): void {
  resolveDamage(state, {
    attacker: null,
    defender: target,
    base: damage,
    isAttack: false,
    pierceBlock: false,
  });
}

// ------------------------------------------------------------- 血线触发

/**
 * Spends whichever `thresholds` rows the enemy has just fallen through. Each
 * row fires at most once per fight, tracked by index on the body rather than by
 * a boolean per effect, so a def can carry as many lines as it likes.
 */
function checkThresholds(state: CombatState, targetId: string): void {
  const enemy = state.enemies.find((e) => e.id === targetId);
  if (!enemy || !enemy.alive) return;
  const def = getEnemy(enemy.defId);
  // The early exit that keeps this off the hot path: every hit on every enemy
  // in the game runs the two lookups above and then stops here.
  if (!def.thresholds) return;

  def.thresholds.forEach((row, i) => {
    if (!enemy.alive || enemy.crossed.includes(i)) return;
    // Integer maths: no float compare decides whether a boss transforms.
    if (enemy.hp * 100 > enemy.maxHp * row.percent) return;
    enemy.crossed.push(i);

    if (row.shout) state.events.push({ t: 'shout', enemyId: enemy.id, text: row.shout });
    if (row.gain) {
      for (const [id, n] of Object.entries(row.gain)) {
        addStatus(state, enemy, id as StatusId, n as number);
      }
    }
    if (row.phase) enterPhase(state, enemy, row.phase);
    if (row.split) splitEnemy(state, enemy, row.split);
  });
}

/**
 * Switches move tables. The script cursor and the repeat counter both reset —
 * a new form starts its 套路 at the beginning — and the intent is re-picked at
 * once, so the badge over the enemy's head answers to the new table before the
 * player takes another action.
 */
function enterPhase(state: CombatState, enemy: EnemyState, phase: string): void {
  enemy.phase = phase;
  enemy.actedTurns = 0;
  enemy.repeat = 0;
  enemy.intent = null;
  pickIntent(state, enemy);
}

/**
 * Breaks a body into `count` smaller ones, each carrying half of what was left
 * of it, rounded up. The parent leaves the field *without dying*: no `death`
 * event, no `enemyKilled` hook and no kill-triggered status — splitting is not
 * a kill, and paying 斩将 for it would let a boss hand out free 神力.
 */
function splitEnemy(
  state: CombatState,
  parent: EnemyState,
  spec: { defId: string; count: number },
): void {
  const hp = Math.ceil(parent.hp / 2);
  const spawned: string[] = [];
  for (let i = 0; i < spec.count; i++) {
    // 倍率照传，但下两行就把 HP 改写成父体的一半——分裂体继承的是已经吃过
    // 倍率的父体血量，这里的乘积随掷出的数一起被丢弃，不会叠加第二次。
    const child = makeEnemy(spec.defId, state.enemies.length, state.rng, state.enemyHpMult);
    // The def's own roll is spent and then overwritten: a child's HP is a
    // function of the parent, and the roll has to happen either way so that
    // adding a split to a table cannot shift the stream for everything after it.
    child.hp = hp;
    child.maxHp = hp;
    state.enemies.push(child);
    pickIntent(state, child);
    spawned.push(child.id);
  }
  parent.alive = false;
  parent.intent = null;
  state.events.push({ t: 'split', parentId: parent.id, spawned });
}

/** What `amount` block from `source` is actually worth to `target` right now. */
export function shapeBlock(target: Combatant, amount: number, source: BlockSource): number {
  if (!SHAPED_BLOCK.includes(source)) return amount;
  let total = amount;
  for (const id of STATUS_ORDER) {
    const fn = STATUS_META[id].blockGain;
    const n = stacks(target, id);
    // `!== 0` and not `> 0`: 身法 is signed, and negative 身法 must subtract.
    if (fn && n !== 0) total = fn(n, total);
  }
  return total;
}

/**
 * The one place block is granted, so 身法/力竭 can't be routed around.
 *
 * `source` is deliberately required. A default would let a new grant site
 * compile as `'card'` and be shaped by 身法/力竭 when the spec says a relic or a
 * power hands out its printed number — which is exactly how four relics ended
 * up mis-scaled. Getting it wrong should be a type error, not a silent number.
 */
export function gainBlock(
  state: CombatState,
  target: Combatant,
  amount: number,
  source: BlockSource,
): void {
  if (amount <= 0) return;
  const total = shapeBlock(target, amount, source);
  if (total <= 0) return;
  target.block += total;
  state.events.push({ t: 'block', targetId: target.id, amount: total });
  if (target.id === state.player.id) fireHook(state, 'blockGained', total);
}

/** Combat healing. The run carries the survivor's HP back out afterwards. */
export function healCombatant(state: CombatState, target: Combatant, amount: number): void {
  const healed = Math.min(amount, target.maxHp - target.hp);
  if (healed <= 0) return;
  target.hp += healed;
  state.events.push({ t: 'heal', targetId: target.id, amount: healed });
}

// ------------------------------------------------------------------ statuses

export const stacks = (who: Combatant, status: StatusId): number => who.statuses[status] ?? 0;

function consumeLayer(target: Combatant, status: StatusId): void {
  const next = stacks(target, status) - 1;
  if (next <= 0) delete target.statuses[status];
  else target.statuses[status] = next;
}

/**
 * The single entrance for statuses, which is what lets 护身符 ward one off:
 * a debuff — or anything applied as a negative, e.g. -2 神力 — burns a layer
 * and never lands at all.
 */
export function addStatus(
  state: CombatState,
  target: Combatant,
  status: StatusId,
  amount: number,
): void {
  if (amount === 0) return;

  const hostile = STATUS_META[status].blockable || amount < 0;
  if (hostile && stacks(target, 'artifact') > 0) {
    consumeLayer(target, 'artifact');
    state.events.push({ t: 'statusBlocked', targetId: target.id, status });
    return;
  }

  // 神力/身法 are signed: an enemy at 神力 2 hit with -3 must sit at -1, or a
  // 削弱 effect silently under-applies. Everything else is a layer count and
  // floors at zero.
  const next = stacks(target, status) + amount;
  if (next === 0 || (next < 0 && !STATUS_META[status].signed)) delete target.statuses[status];
  else target.statuses[status] = next;
  state.events.push({ t: 'status', targetId: target.id, status, amount });
}

/**
 * Turn boundary for one combatant: fire whatever ticks in this phase, then
 * decay. Only ever called for a combatant at its *own* boundary, which is why
 * `endOfTurn` needs no "every side's turn" variant.
 */
export function tickStatuses(state: CombatState, owner: Combatant, phase: TickPhase): void {
  for (const id of STATUS_ORDER) {
    const def = STATUS_META[id];
    const n = stacks(owner, id);
    if (n === 0) continue;

    if (def.tick?.phase === phase) def.tick.run(state, owner, n);
    // The tick may have removed the status — or killed its owner.
    if (stacks(owner, id) === 0) continue;

    if (def.decay === 'clearAtTurnEnd') {
      if (phase === 'ownerTurnEnd') delete owner.statuses[id];
    } else if (def.decay === 'endOfTurn') {
      if (phase === 'ownerTurnEnd') consumeLayer(owner, id);
    } else if (def.decay === 'tickDown') {
      if (def.tick?.phase === phase) consumeLayer(owner, id);
    }
  }
}

export function checkEnd(state: CombatState): void {
  if (state.phase === 'won' || state.phase === 'lost') return;
  if (state.player.hp <= 0) {
    state.phase = 'lost';
    endCombat(state);
    return;
  }
  if (aliveEnemies(state).length !== 0) return;
  state.phase = 'won';
  endCombat(state);
  // Only on a win: rewards follow, and nothing a relic does can save a corpse.
  fireHook(state, 'combatEnd');
}

/**
 * A finished fight asks no more questions. Without this a card that parked on
 * 「弃 2 张牌」 and then killed the room leaves the scene showing a mandatory,
 * non-dismissable grid over a won combat, and the queue behind it would resume
 * into a terminal phase.
 */
function endCombat(state: CombatState): void {
  state.pendingChoice = null;
  state.effectQueue.length = 0;
}

// ----------------------------------------------------------------- helpers

export const aliveEnemies = (state: CombatState): EnemyState[] =>
  state.enemies.filter((e) => e.alive);

export const defOf = (state: CombatState, uid: string): CardDef => {
  const inst = state.cards[uid];
  return resolveCard(inst.defId, inst.upgraded);
};

/** Status-free stand-in, so a face can be read with no combat in progress. */
const NEUTRAL: Combatant = { id: '_', name: '', hp: 1, maxHp: 1, block: 0, statuses: {} };

export interface PreviewValues {
  /** Damage of one hit of the last damage effect. */
  D: number;
  /** Total block the card grants, 身法/力竭 folded in. */
  B: number;
  /** How many times that damage lands. */
  T: number;
}

/**
 * The numbers a card will actually produce right now — Strength, Weak, 身法 and
 * any relic bonus folded in — so the card face never lies. Target-specific
 * Vulnerable is applied only when `against` is supplied.
 *
 * `state` is optional because the deck viewer also runs on the map, where no
 * combat exists; without one the card reads at its printed values.
 */
export function previewValues(
  state: CombatState | undefined,
  def: CardDef,
  against?: Combatant,
): PreviewValues {
  const bonus = relicDamageBonus(state, def).amount;
  const player = state?.player ?? NEUTRAL;
  const out: PreviewValues = { D: 0, B: 0, T: 1 };
  // A preview is a preview of *playing* this card, so it reads the hand the
  // effects will see: one card lighter than the one on screen right now.
  const handAfterPlay = Math.max(0, (state?.hand.length ?? 0) - 1);

  const walk = (effects: readonly Effect[], repeat: number): void => {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'damage':
        case 'damageAll':
          // Clamped like a real hit would be: a 金蝉脱壳 target takes 1, and the
          // face must say 1 rather than the number the maths produced.
          out.D = clampIncoming(
            computeAttack(effect.amount + bonus, player, against ?? NEUTRAL),
            against ?? NEUTRAL,
          );
          out.T = (effect.times ?? 1) * repeat;
          break;
        case 'block':
          out.B += shapeBlock(player, effect.amount, 'card') * repeat;
          break;
        case 'conditional':
          // Without a fight to ask, the card reads at its headline branch.
          walk(
            !state || conditionMet(state, effect.when, against, handAfterPlay)
              ? effect.then
              : (effect.otherwise ?? []),
            repeat,
          );
          break;
        case 'scaleWithEnergy':
          walk(effect.per, repeat * (def.cost === X_COST ? (state?.energy ?? 0) : def.cost));
          break;
        case 'scaleWithAttacks':
          // The face reads the attacks already made this turn — the same count
          // the card will freeze when it is actually played.
          walk(effect.per, repeat * (state?.attacksThisTurn ?? 0));
          break;
        default:
          break;
      }
    }
  };
  walk(def.effects, 1);
  return out;
}

export function describeCard(
  state: CombatState | undefined,
  def: CardDef,
  against?: Combatant,
): string {
  const { D, B, T } = previewValues(state, def, against);
  return def.text
    .replace(/\{D\}/g, String(D))
    .replace(/\{B\}/g, String(B))
    .replace(/\{T\}/g, String(T));
}
