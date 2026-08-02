import { describe, expect, it } from 'vitest';
import { CARDS, KEYWORD_LABEL, STATUS_META, getCard } from '../src/combat/cards';
import { KEYWORDS, cardTipSegments, cardTipTerms, findKeywords } from '../src/ui/keywords';

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

// ---------------------------------------------------------------- cardTipTerms

describe('cardTipTerms — 一张卡面值得解释的全部词条 (k7)', () => {
  it('reads the rules text and the bottom keyword row, in that order', () => {
    // 义勇：文本讲【神力】，卡底那行小字印「消耗」——两处各出一段。
    expect(cardTipTerms(getCard('yiyong'))).toEqual(['神力', '消耗']);
  });

  it('leads with X 费 on an X-cost card — the orb is not in the rules text', () => {
    const terms = cardTipTerms(getCard('hulaoguan'));
    expect(terms[0]).toBe('X');
    expect(terms).toContain('气');
  });

  it('comes back empty on a plain face — 劈砍悬停不该出一块空墨', () => {
    expect(cardTipTerms(getCard('pikan'))).toEqual([]);
  });

  it('mentions a term once however often the face repeats it', () => {
    for (const def of Object.values(CARDS)) {
      const terms = cardTipTerms(def);
      expect(new Set(terms).size, def.id).toBe(terms.length);
    }
  });

  it('segments carry the registry copy verbatim, colour included', () => {
    const segs = cardTipSegments(getCard('tuodao'));
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) {
      const kw = Object.values(KEYWORDS).find((k) => k.title === seg.title);
      expect(kw, seg.title).toBeDefined();
      expect(seg.body).toBe(kw!.body);
      expect(seg.color).toBe(kw!.color);
    }
  });
});
