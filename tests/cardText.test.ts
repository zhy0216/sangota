import { describe, expect, it } from 'vitest';
import {
  CARD_RULE_TEXT_PRESETS,
  chooseCardRuleTextPreset,
  compactCardRulesText,
} from '../src/ui/cardText';

describe('card rules typography', () => {
  it('compacts Chinese prose without removing authored line breaks', () => {
    expect(
      compactCardRulesText(
        '每消耗 1 点气，对所有敌人造成 6 点伤害。\n再施加 1 层【破绽】。',
      ),
    ).toBe('每消耗1点气，对所有敌人造成6点伤害。\n再施加1层【破绽】。');
  });

  it('uses the largest preset that fits', () => {
    const tried: number[] = [];
    const chosen = chooseCardRuleTextPreset((preset) => {
      tried.push(preset.fontSize);
      return preset.fontSize > 11 ? 48 : 36;
    }, 40);

    expect(chosen).toEqual({ fontSize: 11, lineSpacing: 2 });
    expect(tried).toEqual([13, 12, 11]);
  });

  it('keeps a smallest-size fallback so the fixed print box can clip safely', () => {
    const chosen = chooseCardRuleTextPreset(() => 99, 40);
    expect(chosen).toBe(CARD_RULE_TEXT_PRESETS[CARD_RULE_TEXT_PRESETS.length - 1]);
  });
});

describe('CardView rules box wiring', () => {
  const sources: Record<string, string> = import.meta.glob('../src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const card = sources['../src/ui/CardView.ts'];

  it('wraps CJK text, fixes its height, and measures keyword zones at the fitted size', () => {
    expect(card).toContain('useAdvancedWrap: true');
    expect(card).toContain('setFixedSize(DESC_W, 0)');
    expect(card).toContain('setFixedSize(DESC_W, DESC_H)');
    expect(card).toContain('bodyStyle(this.descFontSize)');
    expect(card).toContain('lineH + this.descLineSpacing');
  });

  it('right-aligns the longer legendary type tag inside the frame', () => {
    const tag = card.slice(card.indexOf('const typeTag'), card.indexOf('// Greys the whole face'));
    expect(tag).toContain('.setOrigin(1, 0.5)');
  });
});
