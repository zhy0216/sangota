import {
  aliveEnemies,
  canPlay,
  computeAttack,
  defOf,
  MAX_HAND,
  previewValues,
} from '../src/combat/engine';
import type { CardDef, CombatState, EnemyState, PendingChoice } from '../src/combat/types';

/**
 * AI drivers for the headless sim. A policy is a pure decision function over a
 * `CombatState` — it never mutates, `runCombat` applies whatever it returns.
 *
 * Every roll goes through `state.rng` rather than an unseeded generator, so a
 * seed replays a whole fight including the policy's own coin flips.
 */

export type PolicyName = 'random' | 'greedy' | 'threat' | 'adaptive';

export interface SimAction {
  uid: string;
  targetId?: string;
}

/**
 * The prompt a card parks the engine on. Was forward-declared here before
 * todos/13 landed it; now it is the engine's own type, so a policy answering it
 * is answering the real thing.
 */
export type { PendingChoice } from '../src/combat/types';

export interface Policy {
  name: string;
  /** The card to play and its target, or null to end the turn. */
  chooseAction(state: CombatState): SimAction | null;
  /** [13] pendingChoice — returns between `choice.min` and `choice.max` uids. */
  resolveChoice?(state: CombatState, choice: PendingChoice): string[];
  /** [02] potions. */
  choosePotion?(
    state: CombatState,
    potions: string[],
  ): { id: string; targetId?: string } | null;
}

/**
 * Damage the telegraphed intents will land next turn, statuses folded in.
 *
 * **Do not replace this with `totalIncomingDamage` from `src/combat/intent.ts`
 * without re-recording the golden snapshots.** todos/16 landed that function and
 * the HUD reads it, but the two do not agree and are not meant to: the intent
 * version is what a *player* is allowed to know, so it withholds a hidden
 * first-turn telegraph (`hiddenFirstIntent`) and counts `loseHp`, while this one
 * is what the modelled player *decides* on and has always read every enemy's
 * `intent` outright. Swapping it changes what `threat` blocks against, which
 * changes the event stream of all 37 frozen fights. The unification is a
 * sanctioned re-record commit, not a drive-by.
 */
export function totalIncomingDamage(state: CombatState): number {
  let total = 0;
  for (const enemy of aliveEnemies(state)) {
    const move = enemy.intent;
    if (!move?.damage) continue;
    total += computeAttack(move.damage, enemy, state.player) * (move.hits ?? 1);
  }
  return total;
}

/**
 * Share of remaining HP a telegraphed swing has to threaten before the threat
 * policy stops attacking and blocks. Just under 1 rather than at it: intents
 * under-report, because 破军 lands its Vulnerable in the same turn it hits and
 * a Strength buff resolves before the swing does.
 *
 * Blocking earlier than this measurably loses fights — 吕布 has 150 HP and 铁壁
 * trades 1 气 for 5 mitigation, so turtling loses the race it was meant to win.
 */
const DANGER_RATIO = 0.9;

/** A draw-only card at the hand cap is a proven no-op; replaying it can loop forever. */
const isDeadDraw = (state: CombatState, uid: string): boolean => {
  if (state.hand.length < MAX_HAND) return false;
  const effects = defOf(state, uid).effects;
  return effects.length > 0 && effects.every((effect) => effect.kind === 'draw');
};

const playable = (state: CombatState): string[] =>
  state.hand.filter((uid) => canPlay(state, uid) && !isDeadDraw(state, uid));

const needsTarget = (def: CardDef): boolean => def.target === 'enemy';

/** Whatever is closest to dying — one fewer attacker beats spread damage. */
const weakest = (enemies: EnemyState[]): EnemyState =>
  enemies.reduce((a, b) => (b.hp + b.block < a.hp + a.block ? b : a));

const aim = (state: CombatState, uid: string, target: EnemyState): SimAction =>
  needsTarget(defOf(state, uid)) ? { uid, targetId: target.id } : { uid };

/** Highest-damage playable attack against `target`, or null. */
function bestAttack(state: CombatState, options: string[], target: EnemyState): SimAction | null {
  let best: SimAction | null = null;
  let bestD = 0;
  for (const uid of options) {
    const def = defOf(state, uid);
    if (def.type !== 'attack') continue;
    const d = previewValues(state, def, target).D;
    if (d > bestD) {
      bestD = d;
      best = aim(state, uid, target);
    }
  }
  return best;
}

/** Highest-block playable card, or null if nothing in hand grants any. */
function bestGuard(state: CombatState, options: string[], target: EnemyState): SimAction | null {
  let best: SimAction | null = null;
  let bestB = 0;
  for (const uid of options) {
    const b = previewValues(state, defOf(state, uid)).B;
    if (b > bestB) {
      bestB = b;
      best = aim(state, uid, target);
    }
  }
  return best;
}

/**
 * What a card is worth to a policy right now, used to decide which cards to
 * give up when something asks for a discard. Crude on purpose: the sim only
 * needs a stable ordering, not a good one.
 */
const cardValue = (state: CombatState, uid: string): number => {
  const def = defOf(state, uid);
  const { D, B, T } = previewValues(state, def);
  return Math.max(D * T, B);
};

/** The `choice.min` cheapest cards on offer — ties broken by hand order. */
function shedWorst(state: CombatState, choice: PendingChoice): string[] {
  return [...choice.options]
    .sort((a, b) => cardValue(state, a) - cardValue(state, b))
    .slice(0, choice.min);
}

const random: Policy = {
  name: 'random',
  chooseAction(state) {
    const options = playable(state);
    const alive = aliveEnemies(state);
    if (options.length === 0 || alive.length === 0) return null;
    const uid = state.rng.pick(options);
    return aim(state, uid, state.rng.pick(alive));
  },
  resolveChoice(state, choice) {
    // Through `state.rng`, so a seed replays the policy's coin flips too.
    return state.rng.shuffle([...choice.options]).slice(0, choice.min);
  },
};

const greedy: Policy = {
  name: 'greedy',
  chooseAction(state) {
    const options = playable(state);
    const alive = aliveEnemies(state);
    if (options.length === 0 || alive.length === 0) return null;

    const target = weakest(alive);
    const attack = bestAttack(state, options, target);
    if (attack) return attack;

    // No attack affordable — spend the leftover 气 on defence, then on
    // anything at all rather than passing with energy in hand.
    return bestGuard(state, options, target) ?? aim(state, options[0], target);
  },
  resolveChoice: shedWorst,
};

const threat: Policy = {
  name: 'threat',
  chooseAction(state) {
    const options = playable(state);
    const alive = aliveEnemies(state);
    if (options.length === 0 || alive.length === 0) return null;

    // 1. Take a kill the moment one is on the table — a dead enemy telegraphs
    //    nothing, which is worth more than any amount of block.
    for (const uid of options) {
      const def = defOf(state, uid);
      if (def.type !== 'attack') continue;
      for (const enemy of alive) {
        if (previewValues(state, def, enemy).D >= enemy.hp + enemy.block) {
          return aim(state, uid, enemy);
        }
      }
    }

    // 2. Survive the telegraphed swing before thinking about damage.
    const exposure = totalIncomingDamage(state) - state.player.block;
    if (exposure > 0 && exposure >= state.player.hp * DANGER_RATIO) {
      const guard = bestGuard(state, options, weakest(alive));
      if (guard) return guard;
    }

    // 3. Otherwise behave greedily.
    return greedy.chooseAction(state);
  },
  resolveChoice: shedWorst,
};

/**
 * 诊断用策略（2026-08-06）。**不参与任何黄金快照**——`sim/golden.test.ts` 的
 * CASES 只引用 random/greedy/threat，新增一个名字不动任何既有文件。
 *
 * 存在的理由：`threat` 与 `greedy` 的差值被当作「会读意图值多少分」在看，
 * 但那个差值在五重以上塌到 0、十重甚至倒挂（greedy 22% vs threat 20%）。
 * 更聪明的策略不该打得更差，所以嫌疑先落在尺子上而不是游戏上：`threat` 的
 * 挡刀条件是「威胁 ≥ 剩余体力 × 0.9」这个**固定比例**，而天命把敌人伤害整体
 * 乘上去之后，这个条件在高天命下几乎每回合都成立——于是它一路龟缩，打不出
 * 输出，被消耗死。0.9 是照零重调的。
 *
 * `adaptive` 换掉的只有这一条判据：**只在挡得住的时候挡**。
 *
 * - 这一击不致命 → 不挡，血是资源；
 * - 这一击致命，且手里最厚的一张护甲能把它挡成不致命 → 挡，这一手救命；
 * - 这一击致命，且怎么挡都还是致命 → **不挡，去抢血**。龟缩救不了的回合，
 *   把气花在护甲上是纯亏——赢面只剩在敌人倒下这一边。
 *
 * 斩杀优先那一条与 `threat` 逐字相同，所以两者的差值干净地只反映挡刀判据。
 */
const adaptive: Policy = {
  name: 'adaptive',
  chooseAction(state) {
    const options = playable(state);
    const alive = aliveEnemies(state);
    if (options.length === 0 || alive.length === 0) return null;

    // 1. 与 threat 同：能斩杀就斩杀，死人不出意图。
    for (const uid of options) {
      const def = defOf(state, uid);
      if (def.type !== 'attack') continue;
      for (const enemy of alive) {
        if (previewValues(state, def, enemy).D >= enemy.hp + enemy.block) {
          return aim(state, uid, enemy);
        }
      }
    }

    // 2. 只在挡刀能改变结局时挡刀。
    const exposure = totalIncomingDamage(state) - state.player.block;
    if (exposure >= state.player.hp) {
      const guard = bestGuard(state, options, weakest(alive));
      if (guard) {
        const gained = previewValues(state, defOf(state, guard.uid)).B;
        if (exposure - gained < state.player.hp) return guard;
      }
      // 挡不住：这一手护甲救不了命，不如把它换成伤害。
    }

    // 3. 其余照 greedy。
    return greedy.chooseAction(state);
  },
  resolveChoice: shedWorst,
};

export const POLICIES: Record<PolicyName, Policy> = { random, greedy, threat, adaptive };
