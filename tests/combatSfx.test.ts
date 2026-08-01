import { describe, expect, it } from 'vitest';
import {
  cardPlaySfx,
  DRAW_DETUNE_STEP,
  drawCue,
  HIT_HEAVY_MIN,
  HIT_LIGHT_MAX,
  hitSfx,
  sfxForEvent,
} from '../src/audio/combatSfx';
import { STATUS_META } from '../src/combat/statuses';
import type { CombatEvent, StatusId } from '../src/combat/types';

/**
 * 战斗事件 → 音效的映射表 (todos/20 b5)。表是纯函数，整表逐行验；
 * 场景层的接线（在哪一帧喊 play）由 `tests/audioWiring.test.ts` 钉。
 */

// ------------------------------------------------------------- 命中三档

describe('hitSfx — 伤害三档', () => {
  it('轻/中/重的边界各就各位', () => {
    expect(hitSfx(1)).toBe('hit-light');
    expect(hitSfx(HIT_LIGHT_MAX)).toBe('hit-light');
    expect(hitSfx(HIT_LIGHT_MAX + 1)).toBe('hit-mid');
    expect(hitSfx(HIT_HEAVY_MIN - 1)).toBe('hit-mid');
    expect(hitSfx(HIT_HEAVY_MIN)).toBe('hit-heavy');
    expect(hitSfx(40)).toBe('hit-heavy');
  });

  it('重档线与 playDamage 的视觉重击线同为 12——音画同档', () => {
    // `CombatScene.playDamage` 写死 `heavy = ev.amount >= 12`：重 hitstop
    // 配重闷响。谁要动这条线，两处一起动。
    expect(HIT_HEAVY_MIN).toBe(12);
  });
});

// ------------------------------------------------------------- damage 组合

const dmg = (amount: number, blocked: number): CombatEvent => ({
  t: 'damage',
  targetId: 'player',
  amount,
  blocked,
  lethal: false,
});

describe('sfxForEvent — damage 的四种组合', () => {
  it('未挡的伤害只有闷响', () => {
    expect(sfxForEvent(dmg(5, 0))).toEqual([{ id: 'hit-light' }]);
    expect(sfxForEvent(dmg(20, 0))).toEqual([{ id: 'hit-heavy' }]);
  });

  it('挡了一部分：闷响 + 甲裂，两声都有', () => {
    expect(sfxForEvent(dmg(8, 4))).toEqual([{ id: 'hit-mid' }, { id: 'block-break' }]);
  });

  it('全挡下（amount 0）：只有甲声，没有闷响', () => {
    expect(sfxForEvent(dmg(0, 9))).toEqual([{ id: 'block-break' }]);
  });

  it('0 伤未挡（力竭挥空）：无声', () => {
    expect(sfxForEvent(dmg(0, 0))).toEqual([]);
  });
});

// ------------------------------------------------------------- 状态分 buff/debuff

describe('sfxForEvent — status 按 STATUS_META.kind 分', () => {
  const status = (id: StatusId): CombatEvent => ({
    t: 'status',
    targetId: 'player',
    status: id,
    amount: 2,
  });

  it('buff 与 debuff 各走各的音', () => {
    expect(sfxForEvent(status('strength'))).toEqual([{ id: 'status-buff' }]);
    expect(sfxForEvent(status('vulnerable'))).toEqual([{ id: 'status-debuff' }]);
  });

  it('全表覆盖：每个状态都落在两声之一，跟 kind 一字不差', () => {
    for (const id of Object.keys(STATUS_META) as StatusId[]) {
      const expected = STATUS_META[id].kind === 'buff' ? 'status-buff' : 'status-debuff';
      expect(sfxForEvent(status(id))).toEqual([{ id: expected }]);
    }
  });
});

// ------------------------------------------------------------- 其余事件逐行

describe('sfxForEvent — 事件表其余各行', () => {
  it('death 按 targetId 分敌我', () => {
    expect(sfxForEvent({ t: 'death', targetId: 'e1' })).toEqual([{ id: 'enemy-death' }]);
    expect(sfxForEvent({ t: 'death', targetId: 'player' })).toEqual([{ id: 'player-death' }]);
  });

  it('弃牌/洗牌/消耗/丹药各一声', () => {
    expect(sfxForEvent({ t: 'discard', uid: 'c1' })).toEqual([{ id: 'card-discard' }]);
    expect(sfxForEvent({ t: 'shuffle' })).toEqual([{ id: 'shuffle' }]);
    expect(sfxForEvent({ t: 'exhaust', uid: 'c1' })).toEqual([{ id: 'card-exhaust' }]);
    expect(sfxForEvent({ t: 'potion', potionId: 'p1' })).toEqual([{ id: 'potion-use' }]);
  });

  it('relic 与 passive 都是宝物触发音——passive 只是带横幅的 relic', () => {
    expect(sfxForEvent({ t: 'relic', relicId: 'r1' })).toEqual([{ id: 'relic-trigger' }]);
    expect(sfxForEvent({ t: 'passive', label: '仁德' })).toEqual([{ id: 'relic-trigger' }]);
  });

  it('表外事件静默：没有声音的一刀仍然是一刀', () => {
    expect(sfxForEvent({ t: 'heal', targetId: 'player', amount: 3 })).toEqual([]);
    expect(sfxForEvent({ t: 'enemyMove', enemyId: 'e1', label: '斩' })).toEqual([]);
    expect(sfxForEvent({ t: 'steal', enemyId: 'e1', amount: 12 })).toEqual([]);
    expect(sfxForEvent({ t: 'shout', enemyId: 'e1', text: '困兽犹斗！' })).toEqual([]);
    expect(sfxForEvent({ t: 'escape', targetId: 'e1' })).toEqual([]);
    expect(sfxForEvent({ t: 'statusBlocked', targetId: 'player', status: 'weak' })).toEqual([]);
  });
});

// ------------------------------------------------------------- 抽牌与打出

describe('drawCue — 批内递增的抽牌音', () => {
  it('第 n 张抬 n*60 cents，jitter 归零保住音阶', () => {
    expect(sfxForEvent({ t: 'draw', uid: 'c1' }, 0)).toEqual([
      { id: 'card-draw', opts: { detune: 0, pitchJitter: 0 } },
    ]);
    expect(drawCue(4)).toEqual({
      id: 'card-draw',
      opts: { detune: 4 * DRAW_DETUNE_STEP, pitchJitter: 0 },
    });
  });

  it('连抽 5 张：5 个 detune 严格递增（验收标准原文）', () => {
    const detunes = [0, 1, 2, 3, 4].map((n) => drawCue(n).opts?.detune ?? 0);
    for (let i = 1; i < detunes.length; i++) {
      expect(detunes[i]).toBeGreaterThan(detunes[i - 1]);
    }
  });
});

describe('cardPlaySfx — 打出卡牌按类型', () => {
  it('攻/势各有其声，其余归谋', () => {
    expect(cardPlaySfx('attack')).toBe('card-attack');
    expect(cardPlaySfx('power')).toBe('card-power');
    expect(cardPlaySfx('skill')).toBe('card-skill');
    expect(cardPlaySfx('curse')).toBe('card-skill');
    expect(cardPlaySfx('status')).toBe('card-skill');
  });
});
