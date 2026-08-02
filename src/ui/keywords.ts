import { KEYWORD_LABEL } from '../combat/cards';
import { X_COST, describeCard } from '../combat/engine';
import { STATUS_META, STATUS_ORDER } from '../combat/statuses';
import type { CardDef, CardKeyword, CombatState } from '../combat/types';
import { C } from '../config';

/**
 * 关键词注册表（todos/24 · 关键词 tooltip 系统的数据层）。
 *
 * 三个来源汇进同一张表，tooltip 与文本高亮都只查这里：
 * 1. 状态 — 从 `STATUS_META` 自动生成。18 种状态的措辞与颜色只在
 *    `statuses.ts` 维护一份，这里照抄，绝不手写第二遍。
 * 2. 卡牌关键词 — 词条从 `KEYWORD_LABEL` 来（术语和卡面底部那行小字
 *    保持同一出处），说明文案在本文件补齐。
 * 3. 通用术语 — 护甲、气、三个牌堆这些不属于任何状态或关键词、
 *    但规则文本里反复出现的词。
 *
 * 无 Phaser 依赖，理由同 `cardOrder.ts`：Node 下可直接单测。
 */

export interface KeywordDef {
  /** 在规则文本里匹配的词。 */
  term: string;
  title: string;
  body: string;
  /** 高亮颜色。状态用 STATUS_META.color，关键词用固定色。 */
  color: number;
}

/**
 * 卡牌关键词的说明文案。`Record<CardKeyword, string>` 与状态表同一用意：
 * 第 6 个关键词出现时这里不补一行就是编译错误。措辞对齐
 * `tests/keywords.test.ts` 锁死的引擎行为。
 */
const CARD_KEYWORD_BODY: Record<CardKeyword, string> = {
  exhaust: '打出后进入【消耗堆】，本场战斗不再回到牌堆。',
  ethereal: '回合结束时若仍留在手中，直接【消耗】。',
  innate: '每场战斗必定出现在起始手牌中。',
  retain: '回合结束时不弃置，保留在手中。',
  unplayable: '无法打出，只会占据手牌位置。',
};

/** 状态 + 卡牌关键词 + 通用术语（护甲/气/消耗堆…）统一注册。 */
export const KEYWORDS: Record<string, KeywordDef> = {};

function register(def: KeywordDef): void {
  KEYWORDS[def.term] = def;
}

// --- (1) 状态：照抄 STATUS_META，走它的既定迭代序 ------------------------
for (const id of STATUS_ORDER) {
  const meta = STATUS_META[id];
  register({ term: meta.label, title: meta.label, body: meta.desc, color: meta.color });
}

// --- (2) 卡牌关键词：术语从 KEYWORD_LABEL 来 ------------------------------
for (const [id, term] of Object.entries(KEYWORD_LABEL) as [CardKeyword, string][]) {
  register({ term, title: term, body: CARD_KEYWORD_BODY[id], color: C.goldBright });
}

// X 费不在 CardKeyword 里——它是 `cost === X_COST`，卡面费用球印的就是「X」。
register({
  term: 'X',
  title: 'X 费',
  body: '打出时花光当前全部的气，每花 1 点气便结算一次效果。',
  color: C.goldBright,
});

// --- (3) 通用术语：不属于任何状态或关键词的规则名词 -----------------------
register({
  term: '护甲',
  title: '护甲',
  body: '先于体力承受伤害。回合开始时清零（【深沟高垒】除外）。',
  color: C.paperDim,
});
register({
  term: '气',
  title: '气',
  body: '打出卡牌所花的资源，每回合开始时回满。',
  color: C.goldBright,
});
register({
  term: '抽牌堆',
  title: '抽牌堆',
  body: '待抽的牌。见底时把弃牌堆洗回来继续抽。',
  color: C.paperDim,
});
register({
  term: '弃牌堆',
  title: '弃牌堆',
  body: '打出与弃置的牌落在这里，抽牌堆见底时整堆洗回。',
  color: C.paperDim,
});
register({
  term: '消耗堆',
  title: '消耗堆',
  body: '被【消耗】的牌落在这里，本场战斗不再回来。',
  color: C.paperDim,
});

/**
 * 一张卡面值得解释的全部词条，按出现顺序去重（todos/24 k7 · 关键词
 * 悬浮全覆盖）。三个来源，顺序即优先级：
 *
 * 1. X 费——它印在费用球上而不在规则文本里，`findKeywords` 扫不到，
 *    单独领头一段。
 * 2. 规则文本——走 `describeCard`，所以带 `state` 时热区文案和卡面
 *    打出的实际数字同一出处；不带 `state`（奖励卡、牌库、商店）读印
 *    刷值，同样是玩家眼前那行字。
 * 3. 卡底关键词行——「消耗」「虚无」印在小字里，规则文本未必再提。
 *
 * 纯函数，Node 可测；悬浮面板（`cardTipPanel`, CardView.ts）和任何想
 * 列出「这张卡有哪些词条」的地方都从这里拿，不各自扫一遍。
 */
export function cardTipTerms(def: CardDef, state?: CombatState): string[] {
  const terms: string[] = [];
  const push = (term: string): void => {
    if (KEYWORDS[term] && !terms.includes(term)) terms.push(term);
  };

  if (def.cost === X_COST) push('X');
  for (const hit of findKeywords(describeCard(state, def))) push(hit.term);
  for (const k of def.keywords ?? []) push(KEYWORD_LABEL[k]);
  return terms;
}

/** `cardTipTerms`, delivered as tooltip segments — the shape `composeTip` eats. */
export function cardTipSegments(
  def: CardDef,
  state?: CombatState,
): { title: string; body: string; color: number }[] {
  return cardTipTerms(def, state).map((term) => {
    const kw = KEYWORDS[term];
    return { title: kw.title, body: kw.body, color: kw.color };
  });
}

/**
 * 匹配用的词表：按长度降序，防止短词吃掉长词——「消耗堆」先占位，
 * 「消耗」就进不了它的字符区间。同长度按字典序，只为结果稳定可测。
 */
const TERMS_BY_LENGTH: readonly string[] = Object.keys(KEYWORDS).sort(
  (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
);

/**
 * 从规则文本里找出所有关键词及其位置，供 CardView 高亮 / 挂悬停热区。
 * 命中区间两两不重叠（同一个字只属于一个词条），结果按出现位置升序。
 */
export function findKeywords(text: string): { term: string; index: number }[] {
  const hits: { term: string; index: number }[] = [];
  const claimed = new Array<boolean>(text.length).fill(false);

  for (const term of TERMS_BY_LENGTH) {
    let from = 0;
    while (from <= text.length - term.length) {
      const at = text.indexOf(term, from);
      if (at === -1) break;
      let free = true;
      for (let i = at; i < at + term.length; i++) {
        if (claimed[i]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let i = at; i < at + term.length; i++) claimed[i] = true;
        hits.push({ term, index: at });
        from = at + term.length;
      } else {
        // 被长词占掉的位置跳过一格再找，后面可能还有干净的出现。
        from = at + 1;
      }
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return hits;
}
