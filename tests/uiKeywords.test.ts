import { describe, expect, it } from 'vitest';
import { KEYWORD_LABEL, STATUS_META } from '../src/combat/cards';
import { KEYWORDS, findKeywords } from '../src/ui/keywords';

/**
 * todos/24 · k1 — 关键词注册表。两件事：注册表对上游（STATUS_META /
 * KEYWORD_LABEL）不缺行不走样，findKeywords 的匹配规则站得住。
 */

// ---------------------------------------------------------------- 注册表

describe('KEYWORDS 注册表', () => {
  it('covers every STATUS_META entry, copy and colour included', () => {
    // 锁一致性：状态词条是自动生成的，一旦有人手抄一份，这里就会撕开。
    for (const meta of Object.values(STATUS_META)) {
      const def = KEYWORDS[meta.label];
      expect(def, meta.id).toBeDefined();
      expect(def.title).toBe(meta.label);
      expect(def.body).toBe(meta.desc);
      expect(def.color).toBe(meta.color);
    }
  });

  it('covers every card keyword plus the X cost', () => {
    for (const term of Object.values(KEYWORD_LABEL)) {
      expect(KEYWORDS[term], term).toBeDefined();
      expect(KEYWORDS[term].body.length).toBeGreaterThan(0);
    }
    expect(KEYWORDS['X'].title).toBe('X 费');
  });

  it('carries the hand-registered common terms', () => {
    for (const term of ['护甲', '气', '抽牌堆', '弃牌堆', '消耗堆']) {
      expect(KEYWORDS[term], term).toBeDefined();
    }
  });

  it('keys every entry by its own term', () => {
    for (const [key, def] of Object.entries(KEYWORDS)) {
      expect(def.term).toBe(key);
    }
  });
});

// ---------------------------------------------------------------- findKeywords

describe('findKeywords', () => {
  it('finds terms in card copy at their exact positions', () => {
    const text = '造成 6 点伤害，施加 2 层破绽。';
    expect(findKeywords(text)).toEqual([{ term: '破绽', index: text.indexOf('破绽') }]);
  });

  it('reads a term through the 【】 brackets the status copy uses', () => {
    const text = '回合结束时获得等量【神力】。';
    expect(findKeywords(text)).toEqual([{ term: '神力', index: text.indexOf('神力') }]);
  });

  it('lets 消耗堆 win over 消耗, and still matches a bare 消耗 elsewhere', () => {
    const text = '消耗。被消耗的牌进入消耗堆。';
    const hits = findKeywords(text);

    expect(hits).toEqual([
      { term: '消耗', index: 0 },
      { term: '消耗', index: 4 },
      { term: '消耗堆', index: 10 },
    ]);
    // 长词占住的三个字里,短词一个都没挤进去。
    expect(hits.filter((h) => h.index >= 10 && h.term === '消耗')).toHaveLength(0);
  });

  it('never yields overlapping ranges, and sorts by position', () => {
    const text = '获得 5 点护甲和 1 点气,弃牌堆洗回抽牌堆,消耗堆不动。';
    const hits = findKeywords(text);

    expect(hits.map((h) => h.term)).toEqual(['护甲', '气', '弃牌堆', '抽牌堆', '消耗堆']);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].index).toBeGreaterThanOrEqual(hits[i - 1].index + hits[i - 1].term.length);
    }
  });

  it('returns what the text actually says at each index', () => {
    // 全库自检:每个词条的说明文案自己也能被扫,命中处的原文就是该词。
    for (const def of Object.values(KEYWORDS)) {
      for (const hit of findKeywords(def.body)) {
        expect(def.body.slice(hit.index, hit.index + hit.term.length)).toBe(hit.term);
        expect(KEYWORDS[hit.term]).toBeDefined();
      }
    }
  });

  it('comes back empty on text without keywords', () => {
    expect(findKeywords('抽 2 张牌。')).toEqual([]);
    expect(findKeywords('')).toEqual([]);
  });
});
