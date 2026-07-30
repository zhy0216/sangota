import { Rng } from '../core/rng';
import { resolveCard } from './cards';
import { getEnemy } from './enemies';
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
  EnemyMove,
  EnemyState,
  Encounter,
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
}

// ------------------------------------------------------------------- setup

export function startCombat(opts: StartCombatOptions): CombatState {
  const rng = new Rng(opts.seed);
  const mods = relicModifiers(opts.relics);

  const cards: Record<string, CardInstance> = {};
  const drawPile: string[] = [];
  for (const card of opts.deck) {
    cards[card.uid] = { ...card };
    drawPile.push(card.uid);
  }
  rng.shuffle(drawPile);

  const enemies = opts.encounter.enemies.map((defId, slot) => makeEnemy(defId, slot, rng));

  const state: CombatState = {
    turn: 0,
    phase: 'player',
    energy: 0,
    maxEnergy: BASE_ENERGY + mods.energy,
    handSize: Math.max(0, HAND_SIZE + mods.handSize),
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

  // Starting block is granted rather than assigned, so 身法 and the 护甲 event
  // reach it like any other block would.
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

function makeEnemy(defId: string, slot: number, rng: Rng): EnemyState {
  const def = getEnemy(defId);
  const hp = rng.range(def.hp[0], def.hp[1]);
  return {
    id: `${defId}-${slot}`,
    defId,
    name: def.name,
    art: def.art,
    height: def.height,
    hp,
    maxHp: hp,
    block: 0,
    statuses: {},
    intent: null,
    repeat: 0,
    alive: true,
    slot,
  };
}

/**
 * Weighted pick over the enemy's moves, skipping any move that has already run
 * `maxRepeat` times in a row so enemies don't lock into one action.
 */
export function pickIntent(state: CombatState, enemy: EnemyState): void {
  const def = getEnemy(enemy.defId);
  let pool = def.moves.filter(
    (m) => !(enemy.intent?.id === m.id && enemy.repeat >= (m.maxRepeat ?? Infinity)),
  );
  if (pool.length === 0) pool = def.moves;

  const picked = state.rng.weighted(
    pool,
    pool.map((m) => m.weight),
  );
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

/** Resolves every living enemy's intent, then hands the turn back. */
export function runEnemyTurn(state: CombatState): void {
  if (state.phase !== 'enemy') return;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    clearBlock(enemy);
    tickStatuses(state, enemy, 'ownerTurnStart');
    if (!enemy.alive) continue;
    const move = enemy.intent;
    if (!move) continue;
    state.events.push({ t: 'enemyMove', enemyId: enemy.id, label: move.label });
    executeMove(state, enemy, move);
    if (state.player.hp <= 0) {
      state.phase = 'lost';
      return;
    }
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    tickStatuses(state, enemy, 'ownerTurnEnd');
    pickIntent(state, enemy);
  }

  fireHook(state, 'enemyTurnEnd');
  checkEnd(state);
  if (state.phase === 'enemy') startPlayerTurn(state);
}

function executeMove(state: CombatState, enemy: EnemyState, move: EnemyMove): void {
  if (move.block) gainBlock(state, enemy, move.block, 'enemyMove');
  if (move.damage) {
    const hits = move.hits ?? 1;
    for (let i = 0; i < hits; i++) {
      dealAttack(state, enemy, state.player, move.damage);
      if (state.player.hp <= 0) return;
      // 反刺 can kill the attacker mid-combo; a corpse does not finish swinging.
      if (!enemy.alive) return;
    }
  }
  if (move.status) {
    const target = move.status.to === 'self' ? enemy : state.player;
    addStatus(state, target, move.status.status, move.status.amount);
  }
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

  enqueue(state, def.effects, { target, bonus: bonus.amount, energy: spent });
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
  enqueue(state, def.effects, { target, bonus: 0, energy: 0 });
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
  const ctx: StepContext = { target: step.target, bonus: step.bonus, energy: step.energy };

  switch (effect.kind) {
    case 'damage': {
      // Each hit is priced on its own, so 破绽 applies to every one of them.
      for (let i = 0; i < (effect.times ?? 1); i++) {
        if (!step.target?.alive) break;
        dealAttack(state, state.player, step.target, effect.amount + step.bonus);
      }
      break;
    }
    case 'damageAll': {
      for (let i = 0; i < (effect.times ?? 1); i++) {
        for (const enemy of aliveEnemies(state)) {
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
  }
}

function conditionMet(
  state: CombatState,
  cond: EffectCondition,
  target: Combatant | undefined,
): boolean {
  switch (cond.c) {
    case 'targetHasStatus':
      return target ? stacks(target, cond.status) >= (cond.min ?? 1) : false;
    case 'selfHasStatus':
      return stacks(state.player, cond.status) >= (cond.min ?? 1);
    case 'handEmpty':
      return state.hand.length === 0;
    case 'attackPlayedThisTurn':
      return state.attacksThisTurn > 0;
    case 'hpBelow':
      // Integer maths: no float compare decides whether a card fires.
      return state.player.hp * 100 < state.player.maxHp * cond.percent;
    case 'enemyCountAtLeast':
      return aliveEnemies(state).length >= cond.n;
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
function clampIncoming(damage: number, defender: Combatant): number {
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

  if (lethal && defender.id !== state.player.id) {
    const enemy = state.enemies.find((e) => e.id === defender.id);
    if (enemy && enemy.alive) {
      enemy.alive = false;
      enemy.intent = null;
      state.events.push({ t: 'death', targetId: enemy.id });
      fireHook(state, 'enemyKilled', enemy);
    }
  }

  if (defender.id === state.player.id && hpLoss > 0) fireHook(state, 'damageTaken', hpLoss);

  // Reactions are the defender's answer to being *attacked*: reflected and
  // reactive damage carries `isAttack: false`, which is what bounds the
  // recursion between two 反刺 holders at one exchange.
  if (ctx.isAttack && defender.hp > 0) {
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

/** What `amount` block from `source` is actually worth to `target` right now. */
export function shapeBlock(target: Combatant, amount: number, source: BlockSource): number {
  if (!SHAPED_BLOCK.includes(source)) return amount;
  let total = amount;
  for (const id of STATUS_ORDER) {
    const fn = STATUS_META[id].blockGain;
    const n = stacks(target, id);
    if (fn && n > 0) total = fn(n, total);
  }
  return total;
}

/** The one place block is granted, so 身法/力竭 can't be routed around. */
export function gainBlock(
  state: CombatState,
  target: Combatant,
  amount: number,
  source: BlockSource = 'card',
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

  const next = stacks(target, status) + amount;
  if (next <= 0) delete target.statuses[status];
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

    if (def.decay === 'clearOnTurn') {
      if (phase === 'ownerTurnStart') delete owner.statuses[id];
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
    return;
  }
  if (aliveEnemies(state).length !== 0) return;
  state.phase = 'won';
  // Only on a win: rewards follow, and nothing a relic does can save a corpse.
  fireHook(state, 'combatEnd');
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

  const walk = (effects: readonly Effect[], repeat: number): void => {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'damage':
        case 'damageAll':
          out.D = computeAttack(effect.amount + bonus, player, against ?? NEUTRAL);
          out.T = (effect.times ?? 1) * repeat;
          break;
        case 'block':
          out.B += shapeBlock(player, effect.amount, 'card');
          break;
        case 'conditional':
          // Without a fight to ask, the card reads at its headline branch.
          walk(
            !state || conditionMet(state, effect.when, against) ? effect.then : (effect.otherwise ?? []),
            repeat,
          );
          break;
        case 'scaleWithEnergy':
          walk(effect.per, repeat * (def.cost === X_COST ? (state?.energy ?? 0) : def.cost));
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

/** Compact intent label for the marker above an enemy, e.g. "攻 5×2". */
export function intentLabel(state: CombatState, enemy: EnemyState): string {
  const move = enemy.intent;
  if (!move) return '';
  if (move.damage) {
    const perHit = computeAttack(move.damage, enemy, state.player);
    const hits = move.hits ?? 1;
    const dmg = hits > 1 ? `${perHit}×${hits}` : `${perHit}`;
    if (move.block) return `攻 ${dmg} · 守`;
    if (move.status) return `攻 ${dmg} · 弱`;
    return `攻 ${dmg}`;
  }
  if (move.intent === 'buff') return move.block ? '强化 · 守' : '强化';
  if (move.intent === 'defend') return '守';
  return move.label;
}
