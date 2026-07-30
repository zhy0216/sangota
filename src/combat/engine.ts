import { Rng } from '../core/rng';
import { resolveCard } from './cards';
import { getEnemy } from './enemies';
import type {
  CardDef,
  CardInstance,
  Combatant,
  CombatState,
  Effect,
  EnemyMove,
  EnemyState,
  Encounter,
  StatusId,
} from './types';

/**
 * Pure combat rules — no Phaser, no rendering. The scene drives it by calling
 * these functions and animating whatever lands in `state.events`.
 */

export const HAND_SIZE = 5;
export const MAX_HAND = 10;
export const BASE_ENERGY = 3;
/** 关羽 · 青龙偃月: the first attack card each turn hits harder. */
export const PASSIVE_ATTACK_BONUS = 3;

const VULNERABLE_MULT = 1.5;
const WEAK_MULT = 0.75;
/** Debuffs tick down at the end of their owner's turn; buffs persist. */
const TICKING: ReadonlySet<StatusId> = new Set<StatusId>(['vulnerable', 'weak']);

export interface StartCombatOptions {
  encounter: Encounter;
  /** Structurally a `DeckCard[]` — the engine stays clear of run state. */
  deck: readonly CardInstance[];
  heroName: string;
  hp: number;
  maxHp: number;
  seed: string;
}

// ------------------------------------------------------------------- setup

export function startCombat(opts: StartCombatOptions): CombatState {
  const rng = new Rng(opts.seed);

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
    maxEnergy: BASE_ENERGY,
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
    drawPile,
    hand: [],
    discardPile: [],
    exhaustPile: [],
    firstAttackUsed: false,
    rng,
    events: [],
  };

  for (const enemy of enemies) pickIntent(state, enemy);
  startPlayerTurn(state);
  return state;
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
  state.turn += 1;
  state.phase = 'player';
  state.energy = state.maxEnergy;
  state.player.block = 0;
  state.firstAttackUsed = false;
  drawCards(state, HAND_SIZE);
}

export function drawCards(state: CombatState, count: number): void {
  for (let i = 0; i < count; i++) {
    if (state.hand.length >= MAX_HAND) return;
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) return;
      state.drawPile = state.rng.shuffle(state.discardPile);
      state.discardPile = [];
      state.events.push({ t: 'shuffle' });
    }
    const uid = state.drawPile.pop();
    if (!uid) return;
    state.hand.push(uid);
    state.events.push({ t: 'draw', uid });
  }
}

export function endPlayerTurn(state: CombatState): void {
  if (state.phase !== 'player') return;
  for (const uid of state.hand) {
    state.discardPile.push(uid);
    state.events.push({ t: 'discard', uid });
  }
  state.hand = [];
  tickStatuses(state.player);
  state.phase = 'enemy';
}

/** Resolves every living enemy's intent, then hands the turn back. */
export function runEnemyTurn(state: CombatState): void {
  if (state.phase !== 'enemy') return;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    enemy.block = 0;
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
    tickStatuses(enemy);
    pickIntent(state, enemy);
  }

  checkEnd(state);
  if (state.phase === 'enemy') startPlayerTurn(state);
}

function executeMove(state: CombatState, enemy: EnemyState, move: EnemyMove): void {
  if (move.block) {
    enemy.block += move.block;
    state.events.push({ t: 'block', targetId: enemy.id, amount: move.block });
  }
  if (move.damage) {
    const hits = move.hits ?? 1;
    for (let i = 0; i < hits; i++) {
      dealAttack(state, enemy, state.player, move.damage);
      if (state.player.hp <= 0) return;
    }
  }
  if (move.status) {
    const target = move.status.to === 'self' ? enemy : state.player;
    addStatus(state, target, move.status.status, move.status.amount);
  }
}

// ------------------------------------------------------------- playing cards

export function canPlay(state: CombatState, uid: string): boolean {
  if (state.phase !== 'player') return false;
  if (!state.hand.includes(uid)) return false;
  const def = defOf(state, uid);
  return state.energy >= def.cost;
}

export function playCard(state: CombatState, uid: string, targetId?: string): boolean {
  if (!canPlay(state, uid)) return false;
  const def = defOf(state, uid);

  let target: EnemyState | undefined;
  if (def.target === 'enemy') {
    target = state.enemies.find((e) => e.id === targetId && e.alive);
    if (!target) return false;
  }

  state.energy -= def.cost;
  state.hand.splice(state.hand.indexOf(uid), 1);

  const passive = def.type === 'attack' && !state.firstAttackUsed;
  if (passive) {
    state.firstAttackUsed = true;
    state.events.push({ t: 'passive', label: '青龙偃月' });
  }
  const bonus = passive ? PASSIVE_ATTACK_BONUS : 0;

  for (const effect of def.effects) applyEffect(state, effect, target, bonus);

  // Powers stay out of the deck for the rest of the fight.
  if (def.type === 'power') state.exhaustPile.push(uid);
  else state.discardPile.push(uid);

  checkEnd(state);
  return true;
}

function applyEffect(
  state: CombatState,
  effect: Effect,
  target: EnemyState | undefined,
  bonus: number,
): void {
  switch (effect.kind) {
    case 'damage':
      if (target?.alive) dealAttack(state, state.player, target, effect.amount + bonus);
      break;
    case 'damageAll':
      for (const enemy of aliveEnemies(state)) {
        dealAttack(state, state.player, enemy, effect.amount + bonus);
      }
      break;
    case 'block':
      state.player.block += effect.amount;
      state.events.push({ t: 'block', targetId: state.player.id, amount: effect.amount });
      break;
    case 'status': {
      const who = effect.to === 'self' ? state.player : target;
      if (who) addStatus(state, who, effect.status, effect.amount);
      break;
    }
    case 'draw':
      drawCards(state, effect.amount);
      break;
  }
}

// -------------------------------------------------------------- damage maths

/** Strength adds flat, Weak scales the attacker down, Vulnerable scales the defender up. */
export function computeAttack(base: number, attacker: Combatant, defender: Combatant): number {
  let damage = base + (attacker.statuses.strength ?? 0);
  if (damage < 0) damage = 0;
  if (attacker.statuses.weak) damage = Math.floor(damage * WEAK_MULT);
  if (defender.statuses.vulnerable) damage = Math.floor(damage * VULNERABLE_MULT);
  return Math.max(0, damage);
}

function dealAttack(
  state: CombatState,
  attacker: Combatant,
  defender: Combatant,
  base: number,
): void {
  applyDamage(state, defender, computeAttack(base, attacker, defender));
}

/** Block soaks first; only the remainder is HP loss, and only that can kill. */
export function applyDamage(state: CombatState, target: Combatant, damage: number): void {
  const blocked = Math.min(target.block, damage);
  target.block -= blocked;
  const hpLoss = damage - blocked;
  target.hp = Math.max(0, target.hp - hpLoss);

  const lethal = target.hp === 0;
  state.events.push({ t: 'damage', targetId: target.id, amount: hpLoss, blocked, lethal });

  if (lethal && target.id !== state.player.id) {
    const enemy = state.enemies.find((e) => e.id === target.id);
    if (enemy && enemy.alive) {
      enemy.alive = false;
      enemy.intent = null;
      state.events.push({ t: 'death', targetId: enemy.id });
    }
  }
}

function addStatus(
  state: CombatState,
  target: Combatant,
  status: StatusId,
  amount: number,
): void {
  target.statuses[status] = (target.statuses[status] ?? 0) + amount;
  state.events.push({ t: 'status', targetId: target.id, status, amount });
}

function tickStatuses(target: Combatant): void {
  for (const key of Object.keys(target.statuses) as StatusId[]) {
    if (!TICKING.has(key)) continue;
    const next = (target.statuses[key] ?? 0) - 1;
    if (next <= 0) delete target.statuses[key];
    else target.statuses[key] = next;
  }
}

export function checkEnd(state: CombatState): void {
  if (state.phase === 'won' || state.phase === 'lost') return;
  if (state.player.hp <= 0) {
    state.phase = 'lost';
    return;
  }
  if (aliveEnemies(state).length === 0) state.phase = 'won';
}

// ----------------------------------------------------------------- helpers

export const aliveEnemies = (state: CombatState): EnemyState[] =>
  state.enemies.filter((e) => e.alive);

export const defOf = (state: CombatState, uid: string): CardDef => {
  const inst = state.cards[uid];
  return resolveCard(inst.defId, inst.upgraded);
};

/**
 * The numbers a card will actually produce right now — Strength, Weak and the
 * pending passive folded in — so the card face never lies about its damage.
 * Target-specific Vulnerable is applied only when `against` is supplied.
 */
export function previewValues(
  state: CombatState,
  def: CardDef,
  against?: Combatant,
): { D: number; B: number } {
  const bonus = def.type === 'attack' && !state.firstAttackUsed ? PASSIVE_ATTACK_BONUS : 0;
  const dummy: Combatant = { id: '_', name: '', hp: 1, maxHp: 1, block: 0, statuses: {} };

  let damage = 0;
  let block = 0;
  for (const effect of def.effects) {
    if (effect.kind === 'damage' || effect.kind === 'damageAll') {
      damage = computeAttack(effect.amount + bonus, state.player, against ?? dummy);
    } else if (effect.kind === 'block') {
      block += effect.amount;
    }
  }
  return { D: damage, B: block };
}

export function describeCard(state: CombatState, def: CardDef, against?: Combatant): string {
  const { D, B } = previewValues(state, def, against);
  return def.text.replace(/\{D\}/g, String(D)).replace(/\{B\}/g, String(B));
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
