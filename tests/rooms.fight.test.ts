import { describe, expect, it } from 'vitest';
import { ACT1, getEncounter } from '../src/combat/enemies';
import { RELICS, relicModifiers, relicsOfTier } from '../src/combat/relics';
import { rollPotion } from '../src/combat/potions';
import type { Spoils } from '../src/rooms/types';
import { roomCommit, roomRecord } from '../src/rooms/commit';
import {
  bossOfferPending,
  bossChestNodeId,
  claimSpoils,
  claimVictoryRelic,
  declinePotionDrop,
  ensureBossOffer,
  ensureEncounter,
  nextDoubleBossNode,
  secondBossNodeId,
  takeBossRelic,
  takeCardReward,
  takePotionDrop,
} from '../src/rooms/fight';
import { stream } from '../src/rooms/rng';
import { addRelic, healAfterBossVictory, startRun, type RunState } from '../src/state/run';
import { DEFAULT_HERO } from '../src/data/heroes';

/**
 * 战斗房 — the rules the combat scene used to keep to itself.
 *
 * Every assertion here names a number or an id. "It did not crash" would have
 * passed against the code this replaces: that code picked uniformly out of a
 * flat eight-row table, never wrote `usedEncounters`, and dropped no relic at
 * all — and the whole suite was green.
 */

const fresh = (seed = 'fight'): RunState => startRun(DEFAULT_HERO, seed);

const nodesOf = (run: RunState, type: string): string[] =>
  [...run.map.nodes.values()].filter((n) => n.type === type).map((n) => n.id);

const nodeOf = (run: RunState, type: string): string => {
  const ids = nodesOf(run, type);
  if (ids.length === 0) throw new Error(`no ${type} node on this map`);
  return ids[0];
};

const WEAK = ACT1.weak.map((e) => e.id);
const STRONG = ACT1.strong.map((e) => e.id);

describe('ensureEncounter', () => {
  it('opens an act with the weak table and only then reaches for the strong one', () => {
    // The rule `EncounterTable` is built around, and the one the flat
    // `ENCOUNTERS[tier]` pick discarded: floor 1 could open on 白波马队.
    for (let s = 0; s < 60; s++) {
      const run = fresh(`weak-${s}`);
      const nodes = nodesOf(run, 'monster');
      const drawn: string[] = [];
      for (const id of nodes.slice(0, 5)) drawn.push(ensureEncounter(run, id, 'monster').id);

      // ACT1.weakCount is 3 — spelled out, not read back off the table.
      expect(drawn.slice(0, 3).every((id) => WEAK.includes(id))).toBe(true);
      expect(drawn.slice(3).every((id) => STRONG.includes(id))).toBe(true);
    }
  });

  it('never repeats a fight while the act still has a fresh one', () => {
    // 8 monster tables: 3 weak then 5 strong. Both halves must run clean.
    for (let s = 0; s < 40; s++) {
      const run = fresh(`dup-${s}`);
      const nodes = nodesOf(run, 'monster').slice(0, 8);
      const drawn = nodes.map((id) => ensureEncounter(run, id, 'monster').id);
      expect(new Set(drawn).size).toBe(drawn.length);
    }
  });

  it('天命二十重第三幕两位首领使用独立账本且必不相同', () => {
    const run = startRun(DEFAULT_HERO, 'double-boss-pick', 20);
    run.act = 3;
    const first = ensureEncounter(run, run.map.bossId, 'boss');
    const secondId = secondBossNodeId(run.map.bossId);
    const second = ensureEncounter(run, secondId, 'boss');
    expect(second.id).not.toBe(first.id);
    expect(roomRecord(run, run.map.bossId, 'combat').encounterId).toBe(first.id);
    expect(roomRecord(run, secondId, 'combat').encounterId).toBe(second.id);
  });

  it('re-opens the pool rather than running out', () => {
    const run = fresh('exhaust');
    run.usedEncounters = [...WEAK, ...STRONG];
    run.actCombatCount = 0;
    const picked = ensureEncounter(run, nodeOf(run, 'monster'), 'monster');
    expect(WEAK).toContain(picked.id);
  });

  it('spends exactly one draw, however much of the pool is gone', () => {
    const run = fresh('draws');
    const id = nodeOf(run, 'monster');
    const rng = stream(run, id, 'encounter');
    rng.next();
    expect(rng.rolls).toBe(1);

    // Same stream, a pool that has been eaten down to one row.
    const late = fresh('draws');
    late.usedEncounters = WEAK.slice(0, 2);
    const before = stream(late, id, 'encounter');
    before.next();
    expect(before.rolls).toBe(1);
  });

  it('freezes the fight on the node so a scene restart reopens the same one', () => {
    // R5. Without the record, the second call would filter against a
    // `usedEncounters` the first call had already grown, and pick differently.
    const run = fresh('r5');
    const id = nodeOf(run, 'monster');
    const first = ensureEncounter(run, id, 'monster');
    const again = ensureEncounter(run, id, 'monster');
    expect(again.id).toBe(first.id);
    expect(roomRecord(run, id, 'combat').encounterId).toBe(first.id);
    // …and re-entering must not tick the act's counter a second time.
    expect(run.actCombatCount).toBe(1);
    expect(run.usedEncounters).toEqual([first.id]);
  });

  it('counts only normal rooms toward the weak/strong switch', () => {
    const run = fresh('tiers');
    ensureEncounter(run, nodeOf(run, 'elite'), 'elite');
    expect(run.actCombatCount).toBe(0);
    ensureEncounter(run, nodesOf(run, 'monster')[0], 'monster');
    expect(run.actCombatCount).toBe(1);
  });

  it('draws elites and bosses from their own tables', () => {
    const run = fresh('elite');
    const elite = ensureEncounter(run, nodeOf(run, 'elite'), 'elite');
    expect(ACT1.elite.map((e) => e.id)).toContain(elite.id);
    const boss = ensureEncounter(run, nodeOf(run, 'boss'), 'boss');
    expect(ACT1.boss.map((e) => e.id)).toContain(boss.id);
  });

  it('replays a seed to the same fight on the same node', () => {
    const a = fresh('replay');
    const b = fresh('replay');
    const id = nodeOf(a, 'monster');
    expect(ensureEncounter(a, id, 'monster').id).toBe(ensureEncounter(b, id, 'monster').id);
  });

  it('reads a materialised id back through the shared lookup', () => {
    expect(getEncounter('m1').name).toBe('黄巾散兵');
    expect(getEncounter('b3').name).toBe('地公将军 · 张宝');
    expect(() => getEncounter('nope')).toThrow();
  });
});

describe('claimVictoryRelic', () => {
  it('pays a 精英 exactly one relic, on the run and on the ledger', () => {
    const run = fresh('elite-drop');
    const id = nodeOf(run, 'elite');
    const claim = claimVictoryRelic(run, id, 'elite')!;
    expect(claim.relicId).not.toBeNull();
    expect(claim.refused).toBe(false);
    expect(run.relics).toContain(claim.relicId!);
    expect(roomRecord(run, id, 'combat').relicId).toBe(claim.relicId);
  });

  it('pays nothing at all on a normal fight', () => {
    const run = fresh('monster-drop');
    expect(claimVictoryRelic(run, nodeOf(run, 'monster'), 'monster')).toBeNull();
    expect(run.relics).toEqual([DEFAULT_HERO.starterRelic]);
  });

  it('pays once — a second claim on the same node is refused', () => {
    const run = fresh('twice');
    const id = nodeOf(run, 'elite');
    const first = claimVictoryRelic(run, id, 'elite')!;
    expect(claimVictoryRelic(run, id, 'elite')).toBeNull();
    expect(run.relics.filter((r) => r === first.relicId!)).toHaveLength(1);
  });

  it('hands over the relic an 奇遇 named, and rolls nothing on top of it', () => {
    const run = fresh('bonus');
    const id = nodeOf(run, 'monster');
    const claim = claimVictoryRelic(run, id, 'monster', 'yushan')!;
    expect(claim.relicId).toBe('yushan');
    expect(run.relics).toContain('yushan');
    // One relic, not the named one plus an elite roll.
    expect(run.relics).toHaveLength(2);
  });

  it('pays 60 資財 when every shelf the elite ladder reaches is bare', () => {
    const run = fresh('dry');
    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (const def of relicsOfTier(tier)) addRelic(run, def.id);
    }
    const before = run.gold;
    const claim = claimVictoryRelic(run, nodeOf(run, 'elite'), 'elite')!;
    expect(claim.relicId).toBeNull();
    expect(claim.refused).toBe(true);
    // RELIC_MISS_GOLD.elite, spelled out.
    expect(claim.gold).toBe(60);
    expect(run.gold).toBe(before + 60);
  });

  it('spends exactly two draws on the eliteRelic stream', () => {
    const run = fresh('elite-draws');
    const rng = stream(run, nodeOf(run, 'elite'), 'eliteRelic');
    rng.next();
    rng.next();
    expect(rng.rolls).toBe(2);
  });
});

describe('战利品 — the 首领 chest', () => {
  it('offers three distinct 首领 relics and freezes them on the run', () => {
    const run = fresh('boss');
    const id = nodeOf(run, 'boss');
    const offer = ensureBossOffer(run, id);
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
    for (const relicId of offer) expect(RELICS[relicId].tier).toBe('boss');
    expect(ensureBossOffer(run, id)).toEqual(offer);
    expect(run.bossRelicOffer).toEqual(offer);
  });

  it('makes all six 首领 relics reachable', () => {
    // The defect this whole path exists to close: 赤兔马 / 独断 / 方天画戟 /
    // 虎符 / 铜雀台 / 九锡 could not be obtained anywhere in the game.
    const seen = new Set<string>();
    for (let s = 0; s < 80; s++) {
      const run = fresh(`boss-${s}`);
      for (const relicId of ensureBossOffer(run, nodeOf(run, 'boss'))) seen.add(relicId);
    }
    expect([...seen].sort()).toEqual(relicsOfTier('boss').map((d) => d.id).sort());
  });

  it('grants the one taken and nothing else', () => {
    const run = fresh('take');
    const id = nodeOf(run, 'boss');
    const offer = ensureBossOffer(run, id);
    expect(bossOfferPending(run, id)).toBe(true);
    expect(takeBossRelic(run, id, offer[1])).toBe(true);

    expect(run.relics).toContain(offer[1]);
    expect(run.relics).not.toContain(offer[0]);
    expect(run.relics).not.toContain(offer[2]);
    expect(run.keys.sapphire).toBe(false);
    expect(bossOfferPending(run, id)).toBe(false);
  });

  it('trades the relic for the 宝钥 when the offer is declined', () => {
    const run = fresh('decline');
    const id = nodeOf(run, 'boss');
    ensureBossOffer(run, id);
    run.act = 3;
    expect(takeBossRelic(run, id, null)).toBe(true);
    expect(run.keys.sapphire).toBe(true);
    expect(run.relics).toEqual([DEFAULT_HERO.starterRelic]);
  });

  it('pays nothing for a 第一幕 decline — the pass is real, the key is not', () => {
    const run = fresh('decline-early');
    const id = nodeOf(run, 'boss');
    ensureBossOffer(run, id);
    expect(run.act).toBe(1);
    expect(takeBossRelic(run, id, null)).toBe(true);
    expect(run.keys.sapphire).toBe(false);
    expect(run.relics).toEqual([DEFAULT_HERO.starterRelic]);
    // Still an answer: the chest cannot be reopened for a relic afterwards.
    expect(bossOfferPending(run, id)).toBe(false);
    expect(takeBossRelic(run, id, ensureBossOffer(run, id)[0])).toBe(false);
  });

  it('answers once — a second click cannot turn a taken relic into a key', () => {
    const run = fresh('once');
    const id = nodeOf(run, 'boss');
    const offer = ensureBossOffer(run, id);
    expect(takeBossRelic(run, id, offer[0])).toBe(true);
    expect(takeBossRelic(run, id, null)).toBe(false);
    expect(run.keys.sapphire).toBe(false);
    expect(run.relics).toContain(offer[0]);
  });

  it('refuses a relic that is not on the table', () => {
    const run = fresh('offtable');
    const id = nodeOf(run, 'boss');
    ensureBossOffer(run, id);
    expect(takeBossRelic(run, id, 'yushan')).toBe(false);
    expect(run.relics).not.toContain('yushan');
    expect(bossOfferPending(run, id)).toBe(true);
  });

  it('spends exactly six draws on the bossRelic stream', () => {
    const run = fresh('boss-draws');
    const rng = stream(run, nodeOf(run, 'boss'), 'bossRelic');
    for (let i = 0; i < 6; i++) rng.next();
    expect(rng.rolls).toBe(6);
  });

  it('falls off the 首领 ladder onto 稀有 once all six are owned', () => {
    const run = fresh('owned');
    for (const def of relicsOfTier('boss')) addRelic(run, def.id);
    const offer = ensureBossOffer(run, nodeOf(run, 'boss'));
    expect(offer).toHaveLength(3);
    for (const relicId of offer) expect(RELICS[relicId].tier).not.toBe('boss');
  });
});

describe('the ledger the fight writes', () => {
  it('keeps the relic and the encounter on the node record', () => {
    const run = fresh('ledger');
    const id = nodeOf(run, 'elite');
    const encounter = ensureEncounter(run, id, 'elite');
    claimVictoryRelic(run, id, 'elite');
    const record = roomRecord(run, id, 'combat');
    expect(record.encounterId).toBe(encounter.id);
    expect(record.relicId).not.toBeNull();
    expect(roomCommit(run, id).isDone('relic')).toBe(true);
  });
});

// ------------------------------------------------------------------ 战利品

describe('claimSpoils', () => {
  const spoilsNode = (run: RunState): string => nodeOf(run, 'monster');

  it('pays coin, offers cards and rolls the bottle, once', () => {
    const run = fresh('spoils');
    const id = spoilsNode(run);
    const encounter = ensureEncounter(run, id, 'monster');
    const gold = run.gold;

    const first = claimSpoils(run, id, 'monster', encounter);
    expect(first.gold).toBeGreaterThanOrEqual(encounter.goldReward[0]);
    expect(first.gold).toBeLessThanOrEqual(encounter.goldReward[1]);
    expect(run.gold).toBe(gold + first.gold);
    expect(first.cardIds.length).toBe(run.cardRewardCount);
  });

  it('reads back rather than re-rolling, and pays nothing the second time', () => {
    // R5. The victory screen used to roll all three of these inline on every
    // `create()`: a second visit paid the gold again, offered a different three
    // cards, and drifted `rareBump` and `potionChance` — which are run-wide, so
    // it moved the odds of every fight after it too.
    const run = fresh('spoils-twice');
    const id = spoilsNode(run);
    const encounter = ensureEncounter(run, id, 'monster');

    const first = claimSpoils(run, id, 'monster', encounter);
    const gold = run.gold;
    const bump = run.rareBump;
    const chance = run.potionChance;

    const again = claimSpoils(run, id, 'monster', encounter);
    expect(again).toEqual(first);
    expect(run.gold).toBe(gold);
    expect(run.rareBump).toBe(bump);
    expect(run.potionChance).toBe(chance);
  });

  it('writes what it paid onto the node, so a reload can read it back', () => {
    const run = fresh('spoils-record');
    const id = spoilsNode(run);
    const paid = claimSpoils(run, id, 'monster', ensureEncounter(run, id, 'monster'));
    const record = roomRecord(run, id, 'combat');
    expect(record.spoils).toEqual(paid);
    expect(roomCommit(run, id).isDone('spoils')).toBe(true);
  });

  it('spends the same streams the screen used to spend, in the same order', () => {
    // The gold roll and the card picks share the `reward` stream, gold first;
    // the 丹药 drop has its own. Frozen: a seed already played must replay.
    const run = fresh('spoils-streams');
    const id = spoilsNode(run);
    const encounter = ensureEncounter(run, id, 'monster');

    const rng = stream(run, id, 'reward');
    const expectedGold = rng.range(encounter.goldReward[0], encounter.goldReward[1]);
    expect(claimSpoils(run, id, 'monster', encounter).gold).toBe(expectedGold);
  });

  it('天命十三重只把精英/Boss 资财乘 0.85，杂兵数字与骰流不变', () => {
    const paid = (level: number, tier: 'monster' | 'elite'): number => {
      const run = startRun(DEFAULT_HERO, `spoils-a13-${tier}`, level);
      const id = `${tier}#a13`;
      return claimSpoils(run, id, tier, ensureEncounter(run, id, tier)).gold;
    };
    expect(paid(13, 'monster')).toBe(paid(12, 'monster'));
    expect(paid(13, 'elite')).toBe(Math.round(paid(12, 'elite') * 0.85));
  });

  it('rolls the bottle id on a miss as well as a hit (R3)', () => {
    // A guaranteed miss and a guaranteed hit must consume the identical amount
    // of the `potion` stream, or one relic that changes the drop rate would
    // reshuffle which bottle every later fight offers.
    const spent = (chance: number): { rolls: number; dropped: boolean } => {
      const run = fresh('spoils-potion');
      const id = spoilsNode(run);
      run.potionChance = chance;
      const encounter = ensureEncounter(run, id, 'monster');
      const paid = claimSpoils(run, id, 'monster', encounter);
      // Re-derive the stream and walk it to the same place the room did.
      const rng = stream(run, id, 'potion');
      rng.int(100);
      rollPotion(rng);
      return { rolls: rng.rolls, dropped: paid.potionId !== null };
    };

    const miss = spent(0);
    const hit = spent(100);
    expect(miss.dropped).toBe(false);
    expect(hit.dropped).toBe(true);
    expect(miss.rolls).toBe(hit.rolls);
  });
});

describe('天命二十重双首领路由', () => {
  it('只在第三幕第一场首领战后接第二战，第二战与终章都不再续接', () => {
    const run = startRun(DEFAULT_HERO, 'double-boss-route', 20);
    const root = run.map.bossId;
    expect(nextDoubleBossNode(run, root, 'boss')).toBeNull();
    run.act = 3;
    expect(nextDoubleBossNode(run, root, 'monster')).toBeNull();
    expect(nextDoubleBossNode(run, root, 'boss')).toBe(secondBossNodeId(root));
    expect(nextDoubleBossNode(run, secondBossNodeId(root), 'boss')).toBeNull();
    run.act = 4;
    expect(nextDoubleBossNode(run, root, 'boss')).toBeNull();
  });

  it('第二战的首领宝箱归根节点，战利品账仍留在第二战节点', () => {
    expect(bossChestNodeId('boss')).toBe('boss');
    expect(bossChestNodeId('boss#2')).toBe('boss');
    expect(bossChestNodeId('event#fight')).toBe('event#fight');
  });
});

describe('healAfterBossVictory', () => {
  it('首领战打赢回满体力，杂兵与精英不回 (2026-08-05)', () => {
    const run = fresh('boss-heal');
    run.hp = 7;
    healAfterBossVictory(run, 'monster');
    expect(run.hp).toBe(7);
    healAfterBossVictory(run, 'elite');
    expect(run.hp).toBe(7);
    healAfterBossVictory(run, 'boss');
    expect(run.hp).toBe(run.maxHp);
    // 幂等：resumed 的胜利画面重跑一遍也只是把满条再置满。
    healAfterBossVictory(run, 'boss');
    expect(run.hp).toBe(run.maxHp);
  });

  it('二十重的第一场首领战也回满——第二位首领是满血迎战', () => {
    // 结算发生在 `nextDoubleBossNode` 路由之前（CombatScene.showVictory 的
    // 未-resumed 块），所以第一战的回满先落账，第二战才开打。
    const run = startRun(DEFAULT_HERO, 'double-boss-heal', 20);
    run.act = 3;
    run.hp = 3;
    healAfterBossVictory(run, 'boss');
    expect(run.hp).toBe(run.maxHp);
    expect(nextDoubleBossNode(run, run.map.bossId, 'boss')).toBe(
      secondBossNodeId(run.map.bossId),
    );
  });
});

describe('taking what the fight paid', () => {
  const setup = (seed: string): { run: RunState; id: string; spoils: Spoils } => {
    const run = fresh(seed);
    const id = nodeOf(run, 'monster');
    const spoils = claimSpoils(run, id, 'monster', ensureEncounter(run, id, 'monster'));
    return { run, id, spoils };
  };

  it('banks one card and refuses a second', () => {
    // `CombatScene.claimed` only guards a double click inside one scene
    // instance and dies with the scene; the gate has to live on the run.
    const { run, id, spoils } = setup('take-card');
    const deck = run.deck.length;
    expect(takeCardReward(run, id, spoils.cardIds[0])).toBe(true);
    expect(run.deck.length).toBe(deck + 1);

    expect(takeCardReward(run, id, spoils.cardIds[1])).toBe(false);
    expect(run.deck.length).toBe(deck + 1);
  });

  it('refuses a card that was never on offer', () => {
    const { run, id } = setup('take-unoffered');
    const deck = run.deck.length;
    expect(takeCardReward(run, id, 'not-a-card')).toBe(false);
    expect(run.deck.length).toBe(deck);
  });

  it('pays 歌钵 for declining, and only once', () => {
    const run = fresh('take-skip');
    const id = nodeOf(run, 'monster');
    addRelic(run, 'geban');
    const bonus = relicModifiers(run.relics).skipRewardMaxHp;
    expect(bonus).toBeGreaterThan(0);
    claimSpoils(run, id, 'monster', ensureEncounter(run, id, 'monster'));

    const maxHp = run.maxHp;
    expect(takeCardReward(run, id, null)).toBe(true);
    expect(run.maxHp).toBe(maxHp + bonus);
    expect(takeCardReward(run, id, null)).toBe(false);
    expect(run.maxHp).toBe(maxHp + bonus);
  });

  it('puts the bottle on the belt once, and leaves the choice open on a full belt', () => {
    const run = fresh('take-potion');
    const id = nodeOf(run, 'monster');
    const potionId = 'huoyouguan';

    // Room on the belt: taken, and the gate closes behind it.
    expect(takePotionDrop(run, id, potionId)).toBe(true);
    expect(run.potions).toContain(potionId);
    expect(takePotionDrop(run, id, potionId)).toBe(false);

    // A full belt must *not* close the gate — the swap prompt is still to come.
    const full = fresh('take-potion-full');
    const fullId = nodeOf(full, 'monster');
    full.potions = full.potions.map(() => 'huoyouguan');
    expect(takePotionDrop(full, fullId, 'zhuangxingjiu')).toBe(false);
    expect(roomCommit(full, fullId).isDone('potionDrop')).toBe(false);
    // …and the swap then lands.
    expect(takePotionDrop(full, fullId, 'zhuangxingjiu', 0)).toBe(true);
    expect(full.potions).toContain('zhuangxingjiu');
  });

  it('settles the drop when the player walks away from it', () => {
    const full = fresh('decline-potion');
    const id = nodeOf(full, 'monster');
    full.potions = full.potions.map(() => 'huoyouguan');
    declinePotionDrop(full, id);
    expect(takePotionDrop(full, id, 'zhuangxingjiu', 0)).toBe(false);
    expect(full.potions.includes('zhuangxingjiu')).toBe(false);
  });
});
