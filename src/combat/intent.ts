import { clampIncoming, computeAttack } from './engine';
import { getEnemy } from './enemies';
import { STATUS_META } from './statuses';
import type { CombatState, EnemyMove, EnemyState, IntentKind } from './types';

/**
 * 意图 — what the marker over an enemy's head says, derived from the move's own
 * fields and from nothing else.
 *
 * `EnemyMove` used to carry a hand-written `intent` and two of the forty-one
 * rows had it wrong: 偷袭 (伤害 + 怯战) was tagged `debuff` and 怒喝 (护甲 +
 * 神力) was tagged `buff`, so the table and its telegraph could disagree
 * without anything saying so. The field is gone; this file is the one place
 * that decides what a move *is*.
 *
 * No Phaser (约定 1) and no module-scope read of another table (约定 7) —
 * `computeAttack` / `clampIncoming` / `getEnemy` / `STATUS_META` are all called
 * from inside functions, so the import cycle through `engine` stays safe.
 *
 * todos/16 (泳道 S) grows `intentOf(): IntentDisplay` and
 * `totalIncomingDamage()` on top of `intentKindOf`; the icons, the tooltip and
 * the HUD total all read those. `intentLabel` is the text-only marker that
 * shipped in 阶段三 and its output is frozen — `tests/enemies.test.ts` pins it.
 */

/**
 * The kind, top-down: the first rule that matches wins. Order is the whole
 * specification, so a move that both hits and shoves cards reads as an attack
 * with a rider rather than as a debuff.
 *
 * Reading `hiddenFirstIntent` here affects the *label only*. `pickIntent` never
 * consults it — hiding a telegraph must not change which move was rolled, or a
 * seed would replay differently under a presentation flag.
 */
export function intentKindOf(state: CombatState, enemy: EnemyState, move: EnemyMove): IntentKind {
  void state;
  if (getEnemy(enemy.defId).hiddenFirstIntent && enemy.actedTurns === 0) return 'unknown';

  if (move.escape) return 'escape';
  if (move.summon) return 'special';

  const buffsSelf = move.status?.to === 'self' || !!move.statusAll;
  const debuffs = move.status?.to === 'player';

  if (move.damage) {
    if (move.block) return 'attack-defend';
    if (debuffs || move.addCards) return 'attack-debuff';
    return 'attack';
  }
  if (move.addCards) return 'strong-debuff';
  if (move.loseHp || debuffs) return 'debuff';
  if (move.block) return buffsSelf ? 'defend-buff' : 'defend';
  if (buffsSelf) return 'buff';
  return 'special';
}

/**
 * Compact intent label for the marker above an enemy, e.g. "攻 5×2".
 *
 * A rider on an attack has to name *itself*. The label used to print 「弱」 for
 * any `status` at all, so 黄巾骑手's 踏阵 (破绽 1) and 吕布's 破军 (破绽 2) both
 * read as "he is about to cut my damage" when they in fact make the next blow
 * land harder — the player defends against the wrong thing. `STATUS_META` is
 * the one place that knows what a status is called, so it is read here rather
 * than a second table being written down.
 *
 * 「强化」 covers `defend-buff` as well as `buff`: a move that walls up *and*
 * gains 神力 is announced by the buff, with 「守」 riding along as a rider. That
 * is what this printed before the kind was derived, and the output is pinned.
 */
export function intentLabel(state: CombatState, enemy: EnemyState): string {
  const move = enemy.intent;
  if (!move) return '';
  const kind = intentKindOf(state, enemy, move);
  // 意图不可知. Read off the *label* alone, deliberately: hiding a telegraph must
  // not change which move was picked, or the same seed would play differently
  // depending on a presentation flag.
  if (kind === 'unknown') return '？';

  // Riders, in the order they matter to a defence decision. `addCards` is the
  // one that cost the most to miss: 扬尘 / 擂鼓 / 泥雨 / 太平符水 all shovel
  // cards into the deck and every one of them used to telegraph as a bare hit.
  const riders: string[] = [];
  if (move.block) riders.push('守');
  if (move.status) riders.push(STATUS_META[move.status.status].label);
  if (move.statusAll) riders.push(STATUS_META[move.statusAll.status].label);
  if (move.addCards) riders.push(`塞牌 ${move.addCards.count}`);
  if (move.steal) riders.push(`夺 ${move.steal}`);
  const tail = riders.length > 0 ? ` · ${riders.join(' · ')}` : '';

  if (move.damage) {
    const perHit = clampIncoming(computeAttack(move.damage, enemy, state.player), state.player);
    const hits = move.hits ?? 1;
    const dmg = hits > 1 ? `${perHit}×${hits}` : `${perHit}`;
    return `攻 ${dmg}${tail}`;
  }
  if (move.loseHp) return `伤 ${move.loseHp}${tail}`;
  if (move.summon) return `召${tail}`;
  if (move.escape) return `遁${tail}`;
  if (kind === 'buff' || kind === 'defend-buff') return `强化${tail}`;
  if (kind === 'defend') return `守${riders.slice(1).map((r) => ` · ${r}`).join('')}`;
  return `${move.label}${tail}`;
}
