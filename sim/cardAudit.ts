import { CARDS, COLORLESS_POOL, resolveCard } from '../src/combat/cards';
import { canPlay } from '../src/combat/engine';
import { rollCardReward, rollRelicOfTier } from '../src/combat/rewards';
import type { CombatState, Effect, EffectCondition } from '../src/combat/types';
import { Rng } from '../src/core/rng';
import { HEROES, type HeroDef } from '../src/data/heroes';
import { UNLOCK_TRACKS } from '../src/data/unlockTracks';
import { addCard, startRun, upgradableCards, upgradeCard, type DeckCard } from '../src/state/run';
import { POLICIES, type Policy } from './policy';
import { simulateCombat, type SimResult } from './runCombat';
import { TACTICAL_POLICY } from './tactical';

/** The original eval recipe, also used to reproduce historical abort seeds. */
export function auditRandomKit(seed: string, hero: HeroDef, act = 1): {
  deck: DeckCard[]; relics: string[];
} {
  const profile = [
    { rewards: 6, forge: 3, relics: 1, colorless: 0 },
    { rewards: 12, forge: 7, relics: 4, colorless: 2 },
    { rewards: 18, forge: 12, relics: 7, colorless: 4 },
    { rewards: 22, forge: 16, relics: 10, colorless: 5 },
  ][act - 1];
  const run = startRun(hero, seed);
  const rng = new Rng(`${seed}:kit`);
  for (let i = 0; i < profile.rewards; i++) {
    const picks = rollCardReward({ tier: i % 4 === 3 ? 'elite' : 'monster', run, rng });
    if (picks.length) addCard(run, rng.pick(picks));
  }
  for (let i = 0; i < profile.colorless; i++) addCard(run, COLORLESS_POOL[i % COLORLESS_POOL.length]);
  for (let i = 0; i < profile.forge; i++) {
    const open = upgradableCards(run);
    if (open.length) upgradeCard(run, rng.pick(open).uid);
  }
  for (let i = 0; i < profile.relics; i++) {
    const id = rollRelicOfTier(rng, run, i % 4 === 3 ? 'uncommon' : 'common');
    if (id) run.relics.push(id);
  }
  return { deck: run.deck, relics: [...run.relics] };
}

type KitName = 'starting' | 'random' | 'strength' | 'cycle' | 'combo' | 'guard' | 'tactics';
export interface AuditScene {
  id: string;
  kit: KitName;
  encounters: readonly string[];
  act?: number;
  hp?: number;
  relics?: readonly string[];
  /** A short gauntlet carries HP; otherwise encounters rotate by seed. */
  consecutive?: boolean;
  locked?: boolean;
  compare?: string;
}

const START: AuditScene = { id: 'starter-single-group', kit: 'starting', encounters: ['m1', 'm2', 'm5'] };
const BOSS: AuditScene = { id: 'act1-bosses', kit: 'random', encounters: ['b1', 'b2', 'b3'] };
const ELITE: AuditScene = { id: 'anger-summon', kit: 'random', encounters: ['e2', 'e3', 'm2'] };
const COMBO: AuditScene = { id: 'combo-3qi', kit: 'combo', encounters: ['b1', 'b3', 'e2'] };
const GUARD: AuditScene = { id: 'guard-single-multihit', kit: 'guard', encounters: ['e1', 'b2', 'm18'] };
const CYCLE: AuditScene = { id: 'discard-exhaust-shuffle', kit: 'cycle', encounters: ['b1', 'b2', 'e3'] };
const TACTICS: AuditScene = { id: 'tactics', kit: 'tactics', encounters: ['b1', 'b2', 'b3'] };

export interface AuditCase {
  id: string;
  compare: string;
  group: 'primary' | 'watch' | 'counterexample' | 'wip';
  scenes: readonly AuditScene[];
}

export const CARD_AUDIT_CASES: readonly AuditCase[] = [
  { id: 'wanren', compare: 'shuiyanqijun', group: 'primary', scenes: [
    START, BOSS, ELITE,
    { id: 'new-account', kit: 'random', encounters: ['m2', 'm5', 'b1'], locked: true, compare: 'yanqiyansha' },
    { id: 'strength', kit: 'strength', encounters: ['m2', 'e2', 'b3'] },
    { id: 'act3-4qi', kit: 'random', act: 3, encounters: ['m19', 'b7'], relics: ['chitima'] },
  ] },
  { id: 'hengsaoqianjun', compare: 'changshanzhaozilong', group: 'primary', scenes: [
    START, BOSS, ELITE, COMBO,
    { id: 'combo-4qi', kit: 'combo', encounters: ['m2', 'm5', 'b3'], relics: ['chitima'] },
    { id: 'act2', kit: 'random', act: 2, encounters: ['m13', 'b4'] },
  ] },
  { id: 'qiangtiaogaolan', compare: 'lizhanwujiang', group: 'primary', scenes: [
    START, BOSS, COMBO,
    { id: 'combo-4qi', kit: 'combo', encounters: ['e2', 'b1'], relics: ['chitima'] },
    { id: 'act3', kit: 'random', act: 3, encounters: ['e6', 'b6'] },
    { id: 'final', kit: 'random', act: 4, encounters: ['e8', 'b8'] },
  ] },
  { id: 'xueranzhengpao', compare: 'tingqiang', group: 'primary', scenes: [
    START, BOSS, COMBO,
    { id: 'half-hp', kit: 'combo', encounters: ['b1', 'm2'], hp: 0.45 },
    { id: 'buffer', kit: 'guard', encounters: ['b1', 'b2'], relics: ['adouqiangbao'] },
    { id: 'consecutive', kit: 'combo', encounters: ['m1', 'm2', 'e1'], consecutive: true },
  ] },
  { id: 'yibaoyuntian', compare: 'shenzaicaoying', group: 'watch', scenes: [
    BOSS, { id: 'debuffs', kit: 'random', act: 2, encounters: ['b5', 'b2'] },
  ] },
  { id: 'wuguanliujiang', compare: 'yiyong', group: 'watch', scenes: [ELITE, BOSS] },
  { id: 'shunpinghou', compare: 'huwei', group: 'watch', scenes: [GUARD, BOSS] },
  { id: 'fengjinguayin', compare: 'qianlizoudanqi', group: 'watch', scenes: [BOSS, CYCLE] },
  { id: 'juantuchonglai', compare: 'guanzhen', group: 'watch', scenes: [BOSS, CYCLE] },
  { id: 'changbanpo', compare: 'qitanpanshe', group: 'counterexample', scenes: [COMBO, GUARD] },
  { id: 'qiruchangban', compare: 'qitanpanshe', group: 'counterexample', scenes: [COMBO] },
  { id: 'qiangchurulong', compare: 'lituizhanghe', group: 'counterexample', scenes: [GUARD] },
  { id: 'juma', compare: 'hengsaoqianjun', group: 'counterexample', scenes: [GUARD, START] },
  { id: 'yinqiang', compare: 'tingqiang', group: 'counterexample', scenes: [COMBO] },
  { id: 'guanzhen', compare: 'juantuchonglai', group: 'counterexample', scenes: [CYCLE] },
  { id: 'fubing', compare: 'tuntian', group: 'wip', scenes: [START, TACTICS] },
  { id: 'guanxing', compare: 'muniuliuma', group: 'wip', scenes: [BOSS, TACTICS] },
  { id: 'jueying', compare: 'duandao', group: 'wip', scenes: [
    TACTICS, { id: 'enemy-guard', kit: 'random', act: 3, encounters: ['m22', 'e7'] },
  ] },
  { id: 'wolongchushan', compare: 'liufulong', group: 'wip', scenes: [BOSS, TACTICS] },
  { id: 'qiaoshe', compare: 'lijianji', group: 'wip', scenes: [START, TACTICS] },
  { id: 'huoshaotengjia', compare: 'fenju', group: 'wip', scenes: [BOSS, TACTICS] },
];

const ARCHETYPES: Partial<Record<KitName, readonly string[]>> = {
  strength: ['wenjiu', 'wenjiu', 'yiyong', 'baima', 'daotiaojinpao', 'zhanyanliang', 'quedi'],
  cycle: ['huimazhan', 'yanqiyansha', 'zhenqianlidao', 'bingyinghezhen', 'zhengjingwu',
    'libingmoma', 'liangdaochangtong', 'wusheng'],
  combo: ['jici', 'jici', 'tingqiang', 'qitanpanshe', 'chenshi', 'longxiang', 'shatouchongwei'],
  guard: ['kongyingji', 'baipao', 'huwei', 'qiangwulihua', 'panhejiugong', 'huaibaoyoudou', 'jiejiang'],
  tactics: ['jiedongfeng', 'huoji', 'jiejianzhiji', 'jianbingzengzao', 'miaosuan',
    'jingtianfa', 'jimu', 'zhangqi'],
};

export function sceneKit(scene: AuditScene, hero: HeroDef, seed: string): {
  deck: DeckCard[]; relics: string[];
} {
  if (scene.kit === 'random') {
    const kit = auditRandomKit(seed, hero, scene.act);
    if (scene.locked) {
      // Explicit fixture, not a mutation of browser unlocks. Burned RNG rolls
      // stay as drawn; replace unavailable rewards with a legal early card.
      const locked = new Set(UNLOCK_TRACKS.filter((track) => track.heroId === hero.id)
        .flatMap((track) => [...(track.cards ?? []), ...(track.cardChoice ?? [])]));
      kit.deck = kit.deck.map((card) => locked.has(card.defId) ? { ...card, defId: 'wenjiu' } : card);
      const lockedRelics = new Set(UNLOCK_TRACKS.flatMap((track) => track.relics ?? []));
      kit.relics = kit.relics.filter((id) => !lockedRelics.has(id));
    }
    return { ...kit, relics: [...new Set([...kit.relics, ...(scene.relics ?? [])])] };
  }
  const ids = scene.kit === 'starting' ? hero.startingDeck : [
    ...hero.startingDeck.slice(0, 3), ...hero.startingDeck.slice(5, 8),
    hero.startingDeck.at(-1)!, ...ARCHETYPES[scene.kit]!,
  ];
  return {
    deck: ids.map((defId, i) => ({ uid: `audit-${i}`, defId, upgraded: 0 })),
    relics: [hero.starterRelic, ...(scene.relics ?? [])],
  };
}

/** Pre-play readiness, not a claim that a mid-effect condition fired. */
function ready(state: CombatState, condition: EffectCondition, targetId?: string): boolean {
  const target = state.enemies.find((enemy) => enemy.id === targetId);
  switch (condition.c) {
    case 'attacksAtLeast': return state.attacksThisTurn >= condition.n;
    case 'attackPlayedThisTurn': return state.attacksThisTurn > 0;
    case 'exhaustedAtLeast': return state.exhaustPile.length >= condition.n;
    case 'blockAtLeast': return state.player.block >= condition.n;
    case 'hpBelow': return state.player.hp * 100 < state.player.maxHp * condition.percent;
    case 'handEmpty': return state.hand.length === 1;
    case 'enemyCountAtLeast': return state.enemies.filter((enemy) => enemy.alive).length >= condition.n;
    case 'selfHasStatus': return (state.player.statuses[condition.status] ?? 0) >= (condition.min ?? 1);
    case 'targetHasStatus': return (target?.statuses[condition.status] ?? 0) >= (condition.min ?? 1);
  }
}

function conditions(effects: readonly Effect[]): EffectCondition[] {
  return effects.flatMap((effect) => effect.kind === 'conditional'
    ? [effect.when, ...conditions(effect.then), ...conditions(effect.otherwise ?? [])]
    : effect.kind === 'scaleWithAttacks' || effect.kind === 'scaleWithEnergy' ? conditions(effect.per) : []);
}

export interface AuditObservation {
  won: boolean; hp: number; turns: number; aborted: SimResult['aborted'];
  seenTurns: number; playableTurns: number; plays: number; readyPlays: number;
  emptyPlays: number; unusedEnergy: number;
}
export interface AbortExample { seed: string; reason: string; turns: number }

function trial(
  item: AuditCase, scene: AuditScene, kit: ReturnType<typeof sceneKit>,
  seed: string, index: number, policy: Policy, probe: string | null, copies: number, upgraded: number,
): AuditObservation {
  const hero = HEROES[CARDS[item.id].hero!];
  const deck = [...kit.deck, ...Array.from({ length: copies }, (_, i) => ({
    uid: `audit-probe-${i}`, defId: probe!, upgraded,
  }))];
  let hp = Math.max(1, Math.round(hero.maxHp * (scene.hp ?? 1)));
  const result: AuditObservation = {
    won: true, hp, turns: 0, aborted: null,
    seenTurns: 0, playableTurns: 0, plays: 0, readyPlays: 0, emptyPlays: 0, unusedEnergy: 0,
  };
  const encounters = scene.consecutive ? scene.encounters : [scene.encounters[index % scene.encounters.length]];
  for (const [fight, encounterId] of encounters.entries()) {
    const seen = new Set<string>();
    const playable = new Set<string>();
    let eventStart = 0;
    let playedOnTurn = 0;
    const combat = simulateCombat({
      encounterId, deck, relics: kit.relics, hero, hp, maxHp: hero.maxHp,
      seed: `${seed}:fight:${fight}`, policy,
      onDecision(state, action) {
        for (const uid of state.hand.filter((held) => state.cards[held].defId === probe)) {
          const key = `${state.turn}:${uid}`;
          seen.add(key);
          if (canPlay(state, uid)) playable.add(key);
        }
        if (action && state.cards[action.uid].defId === probe) {
          eventStart = state.events.length;
          const gates = conditions(resolveCard(probe!, state.cards[action.uid].upgraded).effects);
          if (gates.length && gates.every((gate) => ready(state, gate, action.targetId))) result.readyPlays++;
        }
        if (!action && state.turn === playedOnTurn) result.unusedEnergy += state.energy;
      },
      onPlayed(state, action) {
        if (state.cards[action.uid].defId !== probe) return;
        result.plays++;
        playedOnTurn = state.turn;
        const useful = state.events.slice(eventStart).some((event) =>
          event.t === 'draw' || event.t === 'heal' || event.t === 'status' || event.t === 'statusBlocked'
          || event.t === 'block' || event.t === 'shuffle'
          || event.t === 'damage' && event.targetId !== 'player' && event.amount + event.blocked > 0);
        // Pure energy cards do not emit an event; count their effect as useful.
        const energyCard = resolveCard(probe!, upgraded).effects.some((effect) => effect.kind === 'energy');
        if (!useful && !energyCard) result.emptyPlays++;
      },
    });
    result.seenTurns += seen.size;
    result.playableTurns += playable.size;
    result.turns += combat.turns;
    result.aborted = combat.aborted;
    hp = combat.hpLeft;
    if (!combat.won || combat.aborted) { result.won = false; break; }
  }
  result.hp = hp;
  return result;
}

export interface PairedResult {
  valid: boolean; n: number; dWin: number | null; ci95: [number, number] | null;
  dHp: number | null; dTurns: number | null;
}

/** Aborts invalidate a comparison; never silently drop them or call them losses. */
export function pairedResult(base: readonly AuditObservation[], treatment: readonly AuditObservation[]): PairedResult {
  if (base.length !== treatment.length || base.length === 0) throw new Error('paired samples must align');
  const n = base.length;
  if ([...base, ...treatment].some((result) => result.aborted)) {
    return { valid: false, n, dWin: null, ci95: null, dHp: null, dTurns: null };
  }
  const ds = treatment.map((result, i) => Number(result.won) - Number(base[i].won));
  const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / n;
  const dWin = mean(ds);
  // Δ = P(gain) - P(loss) on paired discordant outcomes. Subtract two 97.5%
  // Wilson intervals (Bonferroni) for a conservative approximate 95% interval.
  // Unlike a raw paired-normal interval this stays nonzero when all pairs agree.
  const wilson = (count: number): [number, number] => {
    const z = 2.2414027276;
    const p = count / n;
    const divisor = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / divisor;
    const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / divisor;
    return [Math.max(0, center - radius), Math.min(1, center + radius)];
  };
  const gain = wilson(ds.filter((d) => d === 1).length);
  const loss = wilson(ds.filter((d) => d === -1).length);
  return {
    valid: true, n, dWin, ci95: n > 1 ? [gain[0] - loss[1], gain[1] - loss[0]] : null,
    dHp: mean(treatment.map((result, i) => result.hp - base[i].hp)),
    dTurns: mean(treatment.map((result, i) => result.turns - base[i].turns)),
  };
}

export interface AuditRow extends PairedResult {
  card: string; compare: string; scene: string; policy: string; upgraded: number;
  mode: 'add1' | 'add2' | 'replace';
  winRate: number | null; controlWinRate: number | null;
  totals: Omit<AuditObservation, 'won' | 'hp' | 'turns' | 'aborted'>;
  aborts: AbortExample[];
  /** Keep paired samples for later audits, not just rounded aggregate scores. */
  samples: { control: AuditObservation[]; treatment: AuditObservation[] };
}

export function auditCard(item: AuditCase, n: number): AuditRow[] {
  const rows: AuditRow[] = [];
  const hero = HEROES[CARDS[item.id].hero!];
  for (const scene of item.scenes) for (const policy of [POLICIES.greedy, TACTICAL_POLICY]) {
    const compare = scene.compare ?? item.compare;
    for (const upgraded of [0, 1]) {
      const arms: AuditObservation[][] = [[], [], [], []]; // skip / add1 / add2 / comparator
      for (let i = 0; i < n; i++) {
        const seed = `cardaudit-${hero.id}-${scene.id}-${i}`;
        const kit = sceneKit(scene, hero, seed);
        arms[0].push(trial(item, scene, kit, seed, i, policy, null, 0, upgraded));
        arms[1].push(trial(item, scene, kit, seed, i, policy, item.id, 1, upgraded));
        arms[2].push(trial(item, scene, kit, seed, i, policy, item.id, 2, upgraded));
        arms[3].push(trial(item, scene, kit, seed, i, policy, compare, 1, upgraded));
      }
      for (const [mode, control, treatment] of [
        ['add1', arms[0], arms[1]], ['add2', arms[0], arms[2]], ['replace', arms[3], arms[1]],
      ] as const) {
        const paired = pairedResult(control, treatment);
        const totals = { seenTurns: 0, playableTurns: 0, plays: 0, readyPlays: 0, emptyPlays: 0, unusedEnergy: 0 };
        for (const result of treatment) for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
          totals[key] += result[key];
        }
        const aborts = [...control.entries(), ...treatment.entries()]
          .filter(([, result]) => result.aborted)
          .map(([i, result]) => ({ seed: `cardaudit-${hero.id}-${scene.id}-${i}`, reason: result.aborted!, turns: result.turns }));
        rows.push({
          ...paired, card: item.id, compare, scene: scene.id,
          policy: policy.name, upgraded, mode, totals, aborts,
          winRate: paired.valid ? treatment.filter((result) => result.won).length / n : null,
          controlWinRate: paired.valid ? control.filter((result) => result.won).length / n : null,
          samples: { control, treatment },
        });
      }
    }
  }
  return rows;
}
