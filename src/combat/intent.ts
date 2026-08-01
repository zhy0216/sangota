import { getCard } from './cards';
import { aliveEnemies, clampIncoming, computeAttack, scaleEnemyDamage } from './engine';
import { getEnemy } from './enemies';
import { STATUS_META } from './statuses';
import type {
  CombatState,
  EnemyMove,
  EnemyState,
  IntentDisplay,
  IntentKind,
  IntentMark,
} from './types';

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
 * `intentOf` is what the badge, the tooltip and the HUD's incoming total all
 * read; `intentLabel` is the text-only marker that shipped in 阶段三 and its
 * output is frozen — `tests/enemies.test.ts` pins it.
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
    // 天命 (todos/19)：基础值先过档位倍率——引擎真打时同一入口，数字才对得上。
    const perHit = clampIncoming(
      computeAttack(scaleEnemyDamage(state, move.damage), enemy, state.player),
      state.player,
    );
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

// ------------------------------------------------------------ 结构化的意图

/** Where a shoved card lands, in the words the player sees on the pile. */
const PILE_LABEL: Record<'draw' | 'discard' | 'hand', string> = {
  draw: '抽牌堆',
  discard: '弃牌堆',
  hand: '手牌',
};

/**
 * Everything the marker over an enemy's head needs, as data.
 *
 * The one number that matters is `damage`: it is **per hit and final** — run
 * through `computeAttack` for 神力/怯战/破绽 and then through `clampIncoming`,
 * so 金蝉脱壳 telegraphs the 1 it will actually take. A telegraph that showed
 * the table's base value would be a lie the player plans their turn around.
 */
export function intentOf(state: CombatState, enemy: EnemyState): IntentDisplay | null {
  const move = enemy.intent;
  if (!move) return null;

  const kind = intentKindOf(state, enemy, move);
  const hidden = kind === 'unknown';

  // 天命 (todos/19)：和 `executeMove` 走同一个 `scaleEnemyDamage` 入口，
  // 徽章上的数就是真会落下的数——差一点它就是玩家照着排兵的一句谎。
  const damage = move.damage
    ? clampIncoming(
        computeAttack(scaleEnemyDamage(state, move.damage), enemy, state.player),
        state.player,
      )
    : null;
  const hits = move.hits ?? 1;
  const loseHp = move.loseHp ?? null;

  return {
    kind,
    damage,
    hits,
    loseHp,
    tier: tierOf(incomingOf(damage, hits, loseHp), state),
    marks: marksOf(move),
    // A hidden intent tells the truth about *being* hidden and nothing else.
    // Every other field is still filled in with the real values, because the
    // rules layer must not start disagreeing with itself over a display flag.
    tooltip: hidden
      ? { title: '意图不明', body: '此敌初上阵，招式不可预知。' }
      : { title: move.label, body: describeMove(move, damage) },
    hidden,
  };
}

/**
 * What one enemy will take off the player next turn.
 *
 * `loseHp` counts. 太平符水's four points ignore 护甲, ignore 破绽 and ignore
 * 怯战 — leaving them out under-reports the very move that a shield cannot
 * answer, which is the one the player most needs the warning for.
 */
const incomingOf = (damage: number | null, hits: number, loseHp: number | null): number =>
  (damage ?? 0) * hits + (loseHp ?? 0);

/**
 * Severity, measured against the body it is aimed at rather than against a
 * fixed number: 15 damage is a scratch at 82 体力 and a funeral at 20.
 *
 * Integer maths throughout — no float compare decides whether the player is
 * shown the word 「lethal」.
 */
function tierOf(incoming: number, state: CombatState): IntentDisplay['tier'] {
  if (incoming <= 0) return 'none';
  const { hp, block } = state.player;
  if (incoming >= hp + block) return 'lethal';
  if (incoming * 10 < hp) return 'light';
  if (incoming * 4 < hp) return 'medium';
  return 'heavy';
}

/**
 * The riders, in the order they matter to a defence decision. Written down once
 * here so the badge, the tooltip and any future keyboard readout cannot drift
 * apart on which rider an intent carries.
 */
function marksOf(move: EnemyMove): IntentMark[] {
  const marks: IntentMark[] = [];
  if (move.block) marks.push({ m: 'block', n: move.block });
  if (move.status?.to === 'self') {
    marks.push({ m: 'buff', status: move.status.status, n: move.status.amount });
  }
  if (move.statusAll) marks.push({ m: 'buff', status: move.statusAll.status, n: move.statusAll.amount });
  if (move.status?.to === 'player') {
    marks.push({ m: 'debuff', status: move.status.status, n: move.status.amount });
  }
  if (move.addCards) marks.push({ m: 'cards', n: move.addCards.count });
  if (move.summon) marks.push({ m: 'summon', n: move.summon.count });
  if (move.steal) marks.push({ m: 'steal', n: move.steal });
  return marks;
}

/**
 * The full sentence, assembled from the move's own fields in a fixed order.
 * `damage` is passed in already computed so the hover and the headline number
 * can never print two different figures for the same swing.
 */
function describeMove(move: EnemyMove, damage: number | null): string {
  const parts: string[] = [];
  if (move.block) parts.push(`得 ${move.block} 点护甲`);
  if (damage !== null) {
    const hits = move.hits ?? 1;
    parts.push(hits > 1 ? `造成 ${damage} 点伤害，共 ${hits} 次` : `造成 ${damage} 点伤害`);
  }
  if (move.loseHp) parts.push(`直取 ${move.loseHp} 点体力，护甲不能挡`);
  if (move.status) {
    const label = STATUS_META[move.status.status].label;
    parts.push(
      move.status.to === 'player'
        ? `令你添 ${move.status.amount} 层【${label}】`
        : `自身添 ${move.status.amount} 层【${label}】`,
    );
  }
  if (move.statusAll) {
    parts.push(`全军各添 ${move.statusAll.amount} 层【${STATUS_META[move.statusAll.status].label}】`);
  }
  if (move.addCards) {
    const { defId, count, to } = move.addCards;
    parts.push(`将 ${count} 张【${getCard(defId).name}】塞入你的${PILE_LABEL[to]}`);
  }
  if (move.summon) {
    parts.push(`召来 ${move.summon.count} 名【${getEnemy(move.summon.defId).name}】`);
  }
  if (move.steal) parts.push(`夺你 ${move.steal} 资财`);
  if (move.escape) parts.push('得手即遁，不留一物');
  return parts.length > 0 ? `${parts.join('；')}。` : `${move.label}。`;
}

/**
 * What the whole field is about to land, for the HUD's 「← 12」 readout and for
 * the sim's threat policy.
 *
 * A **hidden** intent is counted separately, never folded into `known`. The
 * honest thing to show is 「12 and one I cannot read」; quietly adding the
 * unknown enemy's real number in would leak exactly the information
 * `hiddenFirstIntent` exists to withhold, and quietly dropping it without
 * saying so would read as 「12 total」 and get the player killed.
 */
export function totalIncomingDamage(state: CombatState): { known: number; hiddenCount: number } {
  let known = 0;
  let hiddenCount = 0;
  for (const enemy of aliveEnemies(state)) {
    const display = intentOf(state, enemy);
    if (!display) continue;
    if (display.hidden) {
      hiddenCount += 1;
      continue;
    }
    known += incomingOf(display.damage, display.hits, display.loseHp);
  }
  return { known, hiddenCount };
}

/**
 * Whether what is telegraphed *right now* kills the player outright.
 *
 * `>=`, not `>`: intents under-report on purpose. 神力 and 蓄势 resolve at the
 * top of the enemy's turn, and 破军 lands its 破绽 in the same turn it swings,
 * so the real number is never smaller than this one. Warning at exactly lethal
 * is therefore already the optimistic reading.
 */
export function incomingIsLethal(state: CombatState): boolean {
  const { known } = totalIncomingDamage(state);
  return known > 0 && known >= state.player.hp + state.player.block;
}
