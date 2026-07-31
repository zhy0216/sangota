import { describe, expect, it } from 'vitest';
import { getEnemy } from '../src/combat/enemies';
import {
  addStatus,
  endPlayerTurn,
  gainBlock,
  resolveDamage,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import { incomingIsLethal, intentOf, totalIncomingDamage } from '../src/combat/intent';
import type { CombatState, EnemyMove, EnemyState, Encounter } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import { newDeckCard, type DeckCard } from '../src/state/run';
import { glyphPoly, intentBadge, intentKey, markColor, tierScale } from '../src/ui/intentIcons';
import { stageChange } from '../src/ui/enemyStage';

/**
 * 意图系统 (todos/16) and the 敌阵 half of todos/15.
 *
 * Every number here is written out as a literal rather than read back off the
 * thing under test. The whole point of the badge is that the figure on it is
 * the figure the fight will land — a test that computed its expectation the
 * same way the badge does would pass on a badge that lied.
 */

const deck = (defId: string, n: number): DeckCard[] =>
  Array.from({ length: n }, () => newDeckCard(defId));

function probe(enemies: string[], seed = 'intent-probe'): CombatState {
  const encounter: Encounter = { id: 'probe', name: 'probe', enemies, goldReward: [0, 0] };
  return startCombat({
    encounter,
    deck: deck('pikan', 10),
    heroName: DEFAULT_HERO.name,
    hp: 82,
    maxHp: 82,
    relics: [],
    seed,
  });
}

/** Force a named move onto an enemy, so a table row can be isolated. */
function telegraph(state: CombatState, index: number, moveId: string): EnemyState {
  const enemy = state.enemies[index];
  const move = getEnemy(enemy.defId).moves.find((m) => m.id === moveId);
  if (!move) throw new Error(`no move ${moveId} on ${enemy.defId}`);
  enemy.intent = move;
  return enemy;
}

/** A move that no table ships, for the derivation rules content does not cover. */
function fabricate(state: CombatState, index: number, move: EnemyMove): EnemyState {
  const enemy = state.enemies[index];
  enemy.intent = move;
  return enemy;
}

const display = (state: CombatState, enemy: EnemyState) => {
  const d = intentOf(state, enemy);
  if (!d) throw new Error('no intent');
  return d;
};

// ------------------------------------------------------------------ 推导

describe('intentOf — the kind is derived from the move alone', () => {
  it('reads a plain swing as 攻', () => {
    const state = probe(['yellowturban']);
    const d = display(state, telegraph(state, 0, 'chop'));
    expect(d.kind).toBe('attack');
    expect(d.damage).toBe(9);
    expect(d.hits).toBe(1);
    expect(d.loseHp).toBeNull();
    expect(d.marks).toEqual([]);
  });

  it('reads a swing that also walls up as 攻 · 守', () => {
    const state = probe(['yellowturban']);
    const d = display(state, telegraph(state, 0, 'guard'));
    expect(d.kind).toBe('attack-defend');
    expect(d.damage).toBe(5);
    expect(d.marks).toEqual([{ m: 'block', n: 6 }]);
  });

  it('reads a swing that hangs a status as 攻 · 减益', () => {
    const state = probe(['bandit']);
    const d = display(state, telegraph(state, 0, 'ambush'));
    expect(d.kind).toBe('attack-debuff');
    expect(d.damage).toBe(4);
    expect(d.marks).toEqual([{ m: 'debuff', status: 'weak', n: 1 }]);
  });

  it('reads a bare wall as 守', () => {
    const state = probe(['luanmin']);
    const d = display(state, telegraph(state, 0, 'huddle'));
    expect(d.kind).toBe('defend');
    expect(d.damage).toBeNull();
    expect(d.marks).toEqual([{ m: 'block', n: 5 }]);
  });

  it('reads 护甲 plus 神力 as 守 · 强化', () => {
    const state = probe(['huaxiong']);
    const d = display(state, telegraph(state, 0, 'fury'));
    expect(d.kind).toBe('defend-buff');
    expect(d.marks).toEqual([
      { m: 'block', n: 8 },
      { m: 'buff', status: 'strength', n: 3 },
    ]);
  });

  it('reads a bare self-buff as 强化', () => {
    const state = probe(['yellowturban']);
    const d = display(state, telegraph(state, 0, 'roar'));
    expect(d.kind).toBe('buff');
    expect(d.marks).toEqual([{ m: 'buff', status: 'strength', n: 2 }]);
  });

  it('reads a bare debuff as 减益', () => {
    // No shipped row is only a debuff, so the rule is driven directly.
    const state = probe(['yellowturban']);
    const d = display(
      state,
      fabricate(state, 0, {
        id: 'hex',
        label: '咒',
        status: { status: 'weak', amount: 2, to: 'player' },
      }),
    );
    expect(d.kind).toBe('debuff');
    expect(d.marks).toEqual([{ m: 'debuff', status: 'weak', n: 2 }]);
  });

  it('reads deck pollution as 强力减益, damage or not', () => {
    const state = probe(['jijiu']);
    const d = display(state, telegraph(state, 0, 'talisman'));
    expect(d.kind).toBe('strong-debuff');
    expect(d.damage).toBeNull();
    expect(d.loseHp).toBe(4);
    expect(d.marks).toEqual([{ m: 'cards', n: 1 }]);
  });

  it('reads 召唤 as 特殊', () => {
    const state = probe(['zhangmancheng']);
    const d = display(state, telegraph(state, 0, 'muster'));
    expect(d.kind).toBe('special');
    expect(d.marks).toEqual([{ m: 'summon', n: 2 }]);
  });

  it('reads 遁走 as its own kind, with the theft riding along', () => {
    const state = probe(['liukou']);
    const d = display(state, telegraph(state, 0, 'bolt'));
    expect(d.kind).toBe('escape');
    expect(d.marks).toEqual([{ m: 'steal', n: 30 }]);
  });

  it('reads a first-turn 骑手 as 意图不明 without touching the move it rolled', () => {
    const state = probe(['qishou']);
    const enemy = state.enemies[0];
    const rolled = enemy.intent!.id;
    const d = display(state, enemy);

    expect(d.kind).toBe('unknown');
    expect(d.hidden).toBe(true);
    // The pick is untouched — hiding a telegraph must never change the fight.
    expect(enemy.intent!.id).toBe(rolled);
    // …and the true fields are still filled in behind the mask.
    expect(d.damage).toBeGreaterThan(0);

    enemy.actedTurns = 1;
    expect(display(state, enemy).hidden).toBe(false);
  });
});

// ----------------------------------------------------------------- 数字

describe('intentOf — the number is the one the fight will land', () => {
  it('grows with the attacker 神力', () => {
    const state = probe(['guanhai']);
    const enemy = telegraph(state, 0, 'axe');
    expect(display(state, enemy).damage).toBe(13);

    addStatus(state, enemy, 'strength', 2);
    expect(display(state, enemy).damage).toBe(15);
  });

  it('grows with the defender 破绽 and shrinks with the attacker 怯战', () => {
    const state = probe(['yellowturban']);
    const enemy = telegraph(state, 0, 'chop');

    addStatus(state, state.player, 'vulnerable', 1);
    expect(display(state, enemy).damage).toBe(13); // 9 × 1.5 → 13.5, floored

    // STATUS_ORDER puts 怯战 before 破绽, and each step floors: 9 → 6 → 9.
    addStatus(state, enemy, 'weak', 1);
    expect(display(state, enemy).damage).toBe(9);
  });

  it('collapses to 1 under 金蝉脱壳', () => {
    const state = probe(['lubu']);
    const enemy = telegraph(state, 0, 'ji');
    expect(display(state, enemy).damage).toBe(16);

    addStatus(state, state.player, 'intangible', 1);
    expect(display(state, enemy).damage).toBe(1);
  });

  it('keeps the per-hit number per hit, and bands on the total', () => {
    const state = probe(['huaxiong']);
    const enemy = telegraph(state, 0, 'sweep');
    const d = display(state, enemy);

    expect(d.damage).toBe(7);
    expect(d.hits).toBe(3);
    // 21 of 82 体力 is a quarter of the player, not the twelfth that 7 is.
    expect(d.tier).toBe('heavy');

    const single = display(state, telegraph(state, 0, 'cleave'));
    expect(single.damage).toBe(15);
    expect(single.tier).toBe('medium');
  });

  it('bands 直接失去体力 as damage, because a shield cannot answer it', () => {
    const state = probe(['jijiu']);
    const d = display(state, telegraph(state, 0, 'talisman'));
    expect(d.loseHp).toBe(4);
    // 4 is under a tenth of 82.
    expect(d.tier).toBe('light');
  });

  it('calls it 致死 only once the blow beats 体力 and 护甲 together', () => {
    const state = probe(['lubu']);
    const enemy = telegraph(state, 0, 'ji'); // 16
    state.player.hp = 16;
    expect(display(state, enemy).tier).toBe('lethal');

    gainBlock(state, state.player, 1, 'card');
    expect(display(state, enemy).tier).toBe('heavy');

    state.player.hp = 15;
    expect(display(state, enemy).tier).toBe('lethal');
  });

  it('has no tier at all when nothing is coming', () => {
    const state = probe(['yellowturban']);
    expect(display(state, telegraph(state, 0, 'roar')).tier).toBe('none');
  });
});

// --------------------------------------------------------------- 总入伤

describe('totalIncomingDamage', () => {
  it('adds the whole line up, 直接失去体力 included', () => {
    const state = probe(['yellowturban', 'jijiu']);
    telegraph(state, 0, 'chop'); // 9
    telegraph(state, 1, 'talisman'); // loseHp 4
    expect(totalIncomingDamage(state)).toEqual({ known: 13, hiddenCount: 0 });
  });

  it('counts multi-hit once per hit', () => {
    const state = probe(['huaxiong', 'bandit']);
    telegraph(state, 0, 'sweep'); // 7 × 3
    telegraph(state, 1, 'slash'); // 5 × 2
    expect(totalIncomingDamage(state)).toEqual({ known: 31, hiddenCount: 0 });
  });

  it('leaves a hidden intent out of the total and says so', () => {
    const state = probe(['qishou', 'yellowturban']);
    telegraph(state, 1, 'chop');
    // 骑手 has not acted, so its real number stays behind the mask.
    expect(totalIncomingDamage(state)).toEqual({ known: 9, hiddenCount: 1 });

    state.enemies[0].actedTurns = 1;
    telegraph(state, 0, 'trample'); // 7
    expect(totalIncomingDamage(state)).toEqual({ known: 16, hiddenCount: 0 });
  });

  it('drops a body that is no longer on the field', () => {
    const state = probe(['yellowturban', 'bandit']);
    telegraph(state, 0, 'chop');
    telegraph(state, 1, 'slash');
    expect(totalIncomingDamage(state).known).toBe(19);

    resolveDamage(state, {
      attacker: state.player,
      defender: state.enemies[1],
      base: 999,
      isAttack: true,
      pierceBlock: false,
    });
    expect(state.enemies[1].alive).toBe(false);
    expect(totalIncomingDamage(state).known).toBe(9);
  });

  it('warns at exactly lethal, never one point later', () => {
    const state = probe(['yellowturban']);
    telegraph(state, 0, 'chop'); // 9
    state.player.hp = 10;
    expect(incomingIsLethal(state)).toBe(false);

    state.player.hp = 9;
    expect(incomingIsLethal(state)).toBe(true);

    gainBlock(state, state.player, 1, 'card');
    expect(incomingIsLethal(state)).toBe(false);
  });

  it('is the number the turn actually takes off the player', () => {
    // The one claim the HUD makes. Two bodies, four hits between them, both
    // telegraphs read before the turn and the wound measured after it.
    const state = probe(['huaxiong', 'bandit']);
    telegraph(state, 0, 'sweep'); // 7 × 3
    telegraph(state, 1, 'slash'); // 5 × 2
    const promised = totalIncomingDamage(state).known;
    const before = state.player.hp;

    endPlayerTurn(state);
    runEnemyTurn(state);

    expect(promised).toBe(31);
    expect(before - state.player.hp).toBe(promised);
  });

  it('still matches once 怯战 and 破绽 are in play', () => {
    const state = probe(['yellowturban']);
    const enemy = telegraph(state, 0, 'chop');
    addStatus(state, state.player, 'vulnerable', 3);
    addStatus(state, enemy, 'weak', 3);

    const promised = totalIncomingDamage(state).known;
    const before = state.player.hp;
    endPlayerTurn(state);
    runEnemyTurn(state);

    expect(promised).toBe(9);
    expect(before - state.player.hp).toBe(promised);
  });

  it('is the sum, so three small hits still read as lethal', () => {
    const state = probe(['luanmin', 'luanmin', 'luanmin']);
    for (let i = 0; i < 3; i++) telegraph(state, i, 'hoe'); // 4 each
    state.player.hp = 12;
    expect(totalIncomingDamage(state).known).toBe(12);
    expect(incomingIsLethal(state)).toBe(true);
  });
});

// ------------------------------------------------------------- 悬停详情

describe('the tooltip says what the move actually does', () => {
  it('names the status rather than calling everything 弱', () => {
    const state = probe(['lubu']);
    const d = display(state, telegraph(state, 0, 'sunder'));
    expect(d.tooltip.title).toBe('破军');
    expect(d.tooltip.body).toBe('造成 9 点伤害；令你添 2 层【破绽】。');
  });

  it('names the card it is about to bury and the pile it goes in', () => {
    const state = probe(['jijiu']);
    const d = display(state, telegraph(state, 0, 'talisman'));
    expect(d.tooltip.body).toBe('直取 4 点体力，护甲不能挡；将 1 张【泥泞】塞入你的弃牌堆。');
  });

  it('counts the hits', () => {
    const state = probe(['huaxiong']);
    expect(display(state, telegraph(state, 0, 'sweep')).tooltip.body).toBe('造成 7 点伤害，共 3 次。');
  });

  it('names who it is calling', () => {
    const state = probe(['zhangmancheng']);
    expect(display(state, telegraph(state, 0, 'muster')).tooltip.body).toBe('召来 2 名【黄巾力士】。');
  });

  it('says both halves of a robbery', () => {
    const state = probe(['liukou']);
    expect(display(state, telegraph(state, 0, 'bolt')).tooltip.body).toBe(
      '夺你 30 资财；得手即遁，不留一物。',
    );
  });

  it('quotes the computed damage, not the table value', () => {
    const state = probe(['guanhai']);
    const enemy = telegraph(state, 0, 'axe');
    addStatus(state, enemy, 'strength', 2);
    expect(display(state, enemy).tooltip.body).toBe('造成 15 点伤害。');
  });

  it('gives away nothing at all while the intent is hidden', () => {
    const state = probe(['qishou']);
    const d = display(state, state.enemies[0]);
    expect(d.tooltip.title).toBe('意图不明');
    expect(d.tooltip.body).toBe('此敌初上阵，招式不可预知。');
  });
});

// ------------------------------------------------------------------ 徽章

describe('intentBadge — what the marker draws', () => {
  it('leads with the blade and demotes everything else to a rider', () => {
    const state = probe(['lubu']);
    const badge = intentBadge(display(state, telegraph(state, 0, 'sunder')));
    expect(badge.glyph).toBe('blade');
    expect(badge.text).toBe('9');
    expect(badge.marks).toEqual([{ m: 'debuff', status: 'vulnerable', n: 2 }]);
    expect(badge.color).toBe(0xe8543c);
  });

  it('prints a multi-hit as N×M', () => {
    const state = probe(['huaxiong']);
    expect(intentBadge(display(state, telegraph(state, 0, 'sweep'))).text).toBe('7×3');
  });

  it('leads with the shield and prints the armour as the headline', () => {
    const state = probe(['huaxiong']);
    const badge = intentBadge(display(state, telegraph(state, 0, 'fury')));
    expect(badge.glyph).toBe('shield');
    expect(badge.text).toBe('8');
    expect(badge.marks).toEqual([{ m: 'buff', status: 'strength', n: 3 }]);
    expect(badge.color).toBe(0x9fc4e0);
  });

  it('uses a droplet for 直接失去体力, never a blade', () => {
    const state = probe(['jijiu']);
    const badge = intentBadge(display(state, telegraph(state, 0, 'talisman')));
    expect(badge.glyph).toBe('drain');
    expect(badge.text).toBe('4');
    expect(badge.marks).toEqual([{ m: 'cards', n: 1 }]);
    expect(badge.color).toBe(0x9a6fbf);
  });

  it('leads with the banner for a 召唤, over the armour it also gains', () => {
    const state = probe(['zhangmancheng']);
    const muster = intentBadge(display(state, telegraph(state, 0, 'muster')));
    expect(muster.glyph).toBe('banner');
    expect(muster.text).toBe('2');
    expect(muster.color).toBe(0x4a7c6f);

    // 呼旗 is 护甲 6 plus a field-wide buff and has no summon: shield leads.
    const banner = intentBadge(display(state, telegraph(state, 0, 'banner')));
    expect(banner.glyph).toBe('shield');
    expect(banner.text).toBe('6');
    expect(banner.marks).toEqual([{ m: 'buff', status: 'strength', n: 1 }]);
  });

  it('leads with the footprint for a 遁走 and keeps the purse as a rider', () => {
    const state = probe(['liukou']);
    const badge = intentBadge(display(state, telegraph(state, 0, 'bolt')));
    expect(badge.glyph).toBe('foot');
    expect(badge.text).toBe('');
    expect(badge.marks).toEqual([{ m: 'steal', n: 30 }]);
  });

  it('draws a brush 「？」 and no riders at all while hidden', () => {
    const state = probe(['qishou']);
    const badge = intentBadge(display(state, state.enemies[0]));
    expect(badge.glyph).toBe('unknown');
    expect(badge.text).toBe('？');
    expect(badge.marks).toEqual([]);
    expect(badge.color).toBe(0x7a6f5a);
    expect(badge.scale).toBe(1);
  });

  it('grows the blade with the severity band', () => {
    const state = probe(['lubu']);
    const enemy = telegraph(state, 0, 'ji'); // 16

    state.player.hp = 400;
    expect(intentBadge(display(state, enemy)).scale).toBe(0.8);
    state.player.hp = 100;
    expect(intentBadge(display(state, enemy)).scale).toBe(1);
    state.player.hp = 50;
    expect(intentBadge(display(state, enemy)).scale).toBe(1.25);
    state.player.hp = 16;
    expect(intentBadge(display(state, enemy)).scale).toBe(1.45);
  });

  it('bands every tier to its own size', () => {
    expect([
      tierScale('none'),
      tierScale('light'),
      tierScale('medium'),
      tierScale('heavy'),
      tierScale('lethal'),
    ]).toEqual([1, 0.8, 1, 1.25, 1.45]);
  });

  it('paints a rider in the colour of the status it is about to hang', () => {
    expect(markColor({ m: 'debuff', status: 'vulnerable', n: 1 })).toBe(
      markColor({ m: 'buff', status: 'vulnerable', n: 1 }),
    );
    expect(markColor({ m: 'block', n: 1 })).toBe(0x9fc4e0);
    expect(markColor({ m: 'steal', n: 1 })).toBe(0xf0d67a);
  });
});

describe('intentKey — when the badge flashes', () => {
  it('holds still while the same telegraph is shown twice', () => {
    const state = probe(['yellowturban']);
    const enemy = telegraph(state, 0, 'chop');
    const first = intentKey(display(state, enemy));
    telegraph(state, 0, 'chop');
    expect(intentKey(display(state, enemy))).toBe(first);
  });

  it('changes when the same move starts hitting harder', () => {
    const state = probe(['yellowturban']);
    const enemy = telegraph(state, 0, 'chop');
    const before = intentKey(display(state, enemy));
    addStatus(state, enemy, 'strength', 2);
    expect(intentKey(display(state, enemy))).not.toBe(before);
  });

  it('is empty for an enemy with nothing telegraphed', () => {
    expect(intentKey(null)).toBe('');
  });
});

// ------------------------------------------------------------------ 图标

describe('glyph geometry', () => {
  const GLYPHS = [
    'blade',
    'shield',
    'up',
    'down',
    'drain',
    'banner',
    'foot',
    'cards',
    'purse',
  ] as const;

  it('keeps every glyph inside the box it was asked for', () => {
    for (const glyph of GLYPHS) {
      const polys = glyphPoly(glyph, 24);
      expect(polys.length, glyph).toBeGreaterThan(0);
      for (const poly of polys) {
        expect(poly.length, glyph).toBeGreaterThanOrEqual(3);
        for (const p of poly) {
          expect(Math.abs(p.x), `${glyph} x`).toBeLessThanOrEqual(12);
          expect(Math.abs(p.y), `${glyph} y`).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it('scales linearly, so one path serves all four blade sizes', () => {
    const small = glyphPoly('blade', 20);
    const large = glyphPoly('blade', 40);
    expect(large[0].map((p) => p.x)).toEqual(small[0].map((p) => p.x * 2));
    expect(large[0].map((p) => p.y)).toEqual(small[0].map((p) => p.y * 2));
  });

  it('fills the box rather than rattling around in a corner of it', () => {
    for (const glyph of GLYPHS) {
      const all = glyphPoly(glyph, 100).flat();
      const spanX = Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x));
      const spanY = Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y));
      expect(Math.max(spanX, spanY), glyph).toBeGreaterThanOrEqual(80);
    }
  });

  it('has no geometry for 「？」, which is drawn as brush text', () => {
    expect(glyphPoly('unknown', 24)).toEqual([]);
  });
});

// ------------------------------------------------------------------ 敌阵

describe('stageChange — who joins the stage and who leaves it', () => {
  it('adds a summon and re-forms the line', () => {
    expect(stageChange({ t: 'summon', enemyId: 'e0', spawned: ['e1', 'e2'] })).toEqual({
      add: ['e1', 'e2'],
      drop: [],
      relayout: true,
      spawnFrom: 'e0',
    });
  });

  it('destroys the parent of a split, which emits no death of its own', () => {
    expect(stageChange({ t: 'split', parentId: 'e0', spawned: ['e1', 'e2'] })).toEqual({
      add: ['e1', 'e2'],
      drop: ['e0'],
      relayout: true,
      spawnFrom: 'e0',
    });
  });

  it('destroys a runaway and leaves the survivors standing where they were', () => {
    expect(stageChange({ t: 'escape', targetId: 'e0' })).toEqual({
      add: [],
      drop: ['e0'],
      relayout: false,
      spawnFrom: null,
    });
  });

  it('leaves a corpse alone — a death is not a removal', () => {
    expect(stageChange({ t: 'death', targetId: 'e0' })).toBeNull();
  });

  it('ignores everything that is not a change of bodies', () => {
    expect(stageChange({ t: 'steal', enemyId: 'e0', amount: 30 })).toBeNull();
    expect(stageChange({ t: 'shout', enemyId: 'e0', text: '「化身千万！」' })).toBeNull();
    expect(
      stageChange({ t: 'damage', targetId: 'player', amount: 5, blocked: 0, lethal: false }),
    ).toBeNull();
  });
});
