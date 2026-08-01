import { CARDS, getCard } from '../combat/cards';
import { ACT_TABLES, ENEMIES, getEnemy } from '../combat/enemies';
import { RELICS, RELIC_TIER_ORDER, relicText, type RelicTier } from '../combat/relics';
import { STATUS_META } from '../combat/statuses';
import type {
  CardDef,
  CardRarity,
  CardType,
  EnemyDef,
  EnemyMove,
  IntentKind,
  MoveCondition,
  StatusId,
} from '../combat/types';
import { actName } from './historyView';

/**
 * 典籍 (todos/23 u4) 的纯排版层 — 场景本体 `CompendiumScene.ts` imports Phaser,
 * Node 下装不进来,所以三卷里要印的每一个字、筛选的每一条取舍都在这里算好、
 * 由 `tests/compendiumView.test.ts` 钉住(`historyView.ts` 之于
 * `HistoryPanel.ts`、`cardOrder.ts` 之于 `CardGrid.ts` 的同款拆法)。
 *
 * 「未获」「未遇」不进这里:谁解锁了、谁遭遇过是 localStorage 里的账,由场景
 * 拿 `filterUnlocked` / `getUnlocks().seenEnemies` 去判——本模块只把**全量**
 * 数据排成版,纯函数不读存储也不掷骰子(约定 2)。表都在函数里读、不在模块
 * 顶层摊开(约定 7)。
 */

// ------------------------------------------------------------------- 牌卷

/** 费用一档:0 / 1 / 2 / 3+,X 费(`cost: -1`)自成一档。 */
export type CostBucket = '0' | '1' | '2' | '3+' | 'X';

/** 筛选栏的四个维度 (u4)。`hero` 取 HeroDef.id / 'colorless' / 'negative'。 */
export interface CardFilter {
  hero: 'all' | string;
  type: 'all' | CardType;
  cost: 'all' | CostBucket;
  rarity: 'all' | CardRarity;
}

export const defaultCardFilter = (): CardFilter => ({
  hero: 'all',
  type: 'all',
  cost: 'all',
  rarity: 'all',
});

/** 稀有度的字。`Record` 铺满四档,新加一档编译期就报。 */
export const CARD_RARITY_LABEL: Record<CardRarity, string> = {
  basic: '起始',
  common: '常见',
  uncommon: '罕见',
  rare: '稀有',
};

/** 全卷卡目:`CARDS` 逐行,含咒/厄——典籍录的是「见过世面」,不是奖池。 */
export const compendiumCardIds = (): string[] => Object.keys(CARDS);

/**
 * 一张牌归哪一栏。咒与状态牌不带 `hero` 标(没有奖池收它们),在牌卷里
 * 合归 'negative' 一栏,免得筛「关羽」时混进泥泞。
 */
export const cardHeroKey = (def: CardDef): string => def.hero ?? 'negative';

export function costBucketOf(cost: number): CostBucket {
  if (cost < 0) return 'X';
  if (cost >= 3) return '3+';
  return `${cost}` as CostBucket;
}

/**
 * 四个维度全 AND。看的是**基础面**(升级态开关只换脸,不换这张牌被筛到
 * 哪一格——否则开个开关,筛好的网格会自己洗牌)。
 */
export function filterCardIds(ids: readonly string[], filter: CardFilter): string[] {
  return ids.filter((id) => {
    const def = getCard(id);
    if (filter.hero !== 'all' && cardHeroKey(def) !== filter.hero) return false;
    if (filter.type !== 'all' && def.type !== filter.type) return false;
    if (filter.cost !== 'all' && costBucketOf(def.cost) !== filter.cost) return false;
    if (filter.rarity !== 'all' && def.rarity !== filter.rarity) return false;
    return true;
  });
}

// ------------------------------------------------------------------- 宝卷

/**
 * 档位的字——与 `RelicBar` 的 `TIER_LABEL` 同文。那份是场景私有的既成事实,
 * 本条线只加不改,故这里另立一份可测的(`historyView.formatDuration` 对
 * `SummaryScene` 的同款取舍)。
 */
export const RELIC_TIER_LABEL: Record<RelicTier, string> = {
  starter: '随身',
  common: '寻常',
  uncommon: '珍品',
  rare: '奇珍',
  boss: '魁首',
  shop: '商货',
};

/** 宝卷的一行,字都拼好——场景只管摆。 */
export interface RelicRowView {
  id: string;
  name: string;
  tier: RelicTier;
  tierLabel: string;
  /** `{N}` 已代入的完整说明。 */
  text: string;
}

/**
 * 全部宝物,按档位归卷(`RELIC_TIER_ORDER` 的次序),档内保持声明序——
 * `Array.prototype.sort` 是稳定的,声明序就是各处奖池的展示序。
 */
export function relicRows(): RelicRowView[] {
  const rank = new Map(RELIC_TIER_ORDER.map((tier, i) => [tier, i]));
  return Object.values(RELICS)
    .map((def) => ({
      id: def.id,
      name: def.name,
      tier: def.tier,
      tierLabel: RELIC_TIER_LABEL[def.tier],
      text: relicText(def),
    }))
    .sort((a, b) => (rank.get(a.tier) ?? 0) - (rank.get(b.tier) ?? 0));
}

// ------------------------------------------------------------------- 敌卷

export interface EnemyActSection {
  /** 「第一幕」…「终章」,与战史册页同一套幕名。 */
  act: string;
  enemyIds: string[];
}

/**
 * 敌卷左栏:按幕列敌,序为该幕遭遇表(弱→强→精英→首领)的初次登场序。
 * 召唤/分裂造出的身体(张宝分身)不在任何遭遇表里,跟着召它/裂它的本体补进
 * 同一幕——走到不动点,分身若再召/再裂(今天没有,规则先立好)也进册。
 */
export function enemyActSections(): EnemyActSection[] {
  return ACT_TABLES.map((table, i) => {
    const ids: string[] = [];
    const add = (id: string): void => {
      if (!ids.includes(id)) ids.push(id);
    };
    for (const pool of [table.weak, table.strong, table.elite, table.boss]) {
      for (const enc of pool) for (const id of enc.enemies) add(id);
    }
    for (let at = 0; at < ids.length; at++) {
      const def = ENEMIES[ids[at]];
      if (!def) continue;
      for (const move of def.moves) if (move.summon) add(move.summon.defId);
      for (const th of def.thresholds ?? []) if (th.split) add(th.split.defId);
    }
    return { act: actName(i + 1), enemyIds: ids };
  });
}

/** 「42–50」;上下限相同印一个数,免得吕布写成「150–150」。 */
export function hpRangeText(def: EnemyDef): string {
  const [lo, hi] = def.hp;
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

/**
 * 一招的意图档 — `intentKindOf`(`intent.ts`)按 move 自身字段推导,但签名
 * 要整个 CombatState/EnemyState(为了首回合意图不明)。典籍印的是**规则书**,
 * 与首回合无关,所以这里按**同一套判序**另立一份只吃 move 的;两份判序不许
 * 漂移,`tests/compendiumView.test.ts` 拿 `ENEMIES` 全表逐招对齐。
 */
export function moveIntentKind(move: EnemyMove): Exclude<IntentKind, 'unknown'> {
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

/** 意图一栏的字。铺满全档(unknown 除外——规则书没有「不明」),漏一档编译期报。 */
export const INTENT_WORD: Record<Exclude<IntentKind, 'unknown'>, string> = {
  attack: '攻',
  'attack-defend': '攻·守',
  'attack-debuff': '攻·乱',
  defend: '守',
  'defend-buff': '守·强',
  buff: '强化',
  debuff: '乱',
  'strong-debuff': '塞牌',
  special: '异动',
  escape: '遁走',
};

/** 招式表的六列表头 (u4 点名的六列),场景与测试共用一份。 */
export const MOVE_TABLE_HEAD: readonly string[] = ['招式', '意图', '伤害', '护甲', '状态', '权重'];

/** 招式表的一行,六列全是拼好的字符串。 */
export interface MoveRowView {
  name: string;
  intent: string;
  /** 「9」「5×2」;直取体力印「穿 4」——护甲不挡,与意图 tooltip 的措辞同义。 */
  damage: string;
  block: string;
  /** 状态/塞牌/召唤/夺财与出招条件,合归一栏。 */
  status: string;
  /** 权重(带连出上限),按谱行招的敌人印谱位。 */
  weight: string;
}

const DASH = '—';

function conditionText(when: MoveCondition): string {
  switch (when.c) {
    case 'selfHpBelow':
      return `体力低于 ${when.percent}% 时`;
    case 'selfHpAtLeast':
      return `体力不低于 ${when.percent}% 时`;
    case 'turnAtLeast':
      return `第 ${when.n} 回合起`;
    case 'alliesAtLeast':
      return `友军 ≥${when.n} 时`;
    case 'alliesAtMost':
      return `友军 ≤${when.n} 时`;
  }
}

/**
 * 伤害一栏印**表上的基础值**,不过 `computeAttack`——战斗中的意图徽章要说
 * 「这一刀真会落多重」,典籍要说「这一招本来多重」,神力/怯战是那一场的事。
 */
function damageCell(move: EnemyMove): string {
  const parts: string[] = [];
  if (move.damage) {
    const hits = move.hits ?? 1;
    parts.push(hits > 1 ? `${move.damage}×${hits}` : `${move.damage}`);
  }
  if (move.loseHp) parts.push(`穿 ${move.loseHp}`);
  return parts.length > 0 ? parts.join('＋') : DASH;
}

function statusCell(move: EnemyMove): string {
  const parts: string[] = [];
  const label = (s: StatusId): string => STATUS_META[s].label;
  if (move.status) {
    parts.push(
      move.status.to === 'player'
        ? `施【${label(move.status.status)}】${move.status.amount}`
        : `自增【${label(move.status.status)}】${move.status.amount}`,
    );
  }
  if (move.statusAll) parts.push(`全军【${label(move.statusAll.status)}】${move.statusAll.amount}`);
  if (move.addCards) parts.push(`塞【${getCard(move.addCards.defId).name}】×${move.addCards.count}`);
  if (move.summon) parts.push(`召【${getEnemy(move.summon.defId).name}】×${move.summon.count}`);
  if (move.steal) parts.push(`夺财 ${move.steal}`);
  if (move.when) parts.push(conditionText(move.when));
  return parts.length > 0 ? parts.join('　') : DASH;
}

/**
 * 按谱行招的敌人权重一栏无意义(掷都不掷),印谱位——「谱 1·2」是流寇的
 * 摸金在第一、二手。掷权重的照印权重,连出上限跟在后面。
 */
function weightCell(def: EnemyDef, move: EnemyMove): string {
  if (def.script) {
    const beats = def.script.order.flatMap((id, i) => (id === move.id ? [i + 1] : []));
    return beats.length > 0 ? `谱 ${beats.join('·')}` : DASH;
  }
  const weight = `${move.weight ?? 1}`;
  return move.maxRepeat ? `${weight}·连${move.maxRepeat}` : weight;
}

/** 完整招式表 (u4):数据全出自 `ENEMIES` 的那一行,一列不少。 */
export function moveRows(def: EnemyDef): MoveRowView[] {
  return def.moves.map((move) => ({
    name: move.label,
    intent: INTENT_WORD[moveIntentKind(move)],
    damage: damageCell(move),
    block: move.block ? `${move.block}` : DASH,
    status: statusCell(move),
    weight: weightCell(def, move),
  }));
}

/**
 * 招式表之外的身家:开场被动、体力线触发、行招方式、首回合意图——
 * 「看了才能精算」的那一层,一行一句。
 */
export function enemyTraitLines(def: EnemyDef): string[] {
  const lines: string[] = [];
  const label = (s: string): string => STATUS_META[s as StatusId].label;

  const passives = Object.entries(def.passives ?? {});
  if (passives.length > 0) {
    lines.push(`开场：${passives.map(([s, n]) => `【${label(s)}】${n}`).join('　')}`);
  }
  for (const th of def.thresholds ?? []) {
    const what: string[] = [];
    for (const [s, n] of Object.entries(th.gain ?? {})) what.push(`得【${label(s)}】${n}`);
    if (th.split) what.push(`分裂为 ${th.split.count} 具【${getEnemy(th.split.defId).name}】`);
    if (th.phase) what.push('变阵');
    lines.push(`体力落至 ${th.percent}%：${what.join('，')}`);
  }
  if (def.script) {
    const from = def.script.loopFrom ?? 0;
    lines.push(from > 0 ? `按谱行招，循环自第 ${from + 1} 手起` : '按谱行招，周而复始');
  }
  if (def.hiddenFirstIntent) lines.push('初上阵时意图不明');
  return lines;
}
