export interface CardRuleTextPreset {
  fontSize: number;
  lineSpacing: number;
}

/**
 * Card rules are rendered into a deliberately tiny print area. Start at the
 * normal face size and step down only as far as the current copy requires.
 */
export const CARD_RULE_TEXT_PRESETS: readonly CardRuleTextPreset[] = [
  { fontSize: 13, lineSpacing: 4 },
  { fontSize: 12, lineSpacing: 3 },
  { fontSize: 11, lineSpacing: 2 },
  { fontSize: 10, lineSpacing: 1 },
  { fontSize: 9, lineSpacing: 0 },
  { fontSize: 8, lineSpacing: 0 },
];

/** Chinese card typography does not need prose spaces around numbers. */
export function compactCardRulesText(text: string): string {
  return text.replace(/[ \t]+/g, '');
}

/** Pick the first preset whose measured height fits, or the smallest fallback. */
export function chooseCardRuleTextPreset(
  measureHeight: (preset: CardRuleTextPreset) => number,
  maxHeight: number,
): CardRuleTextPreset {
  let chosen = CARD_RULE_TEXT_PRESETS[CARD_RULE_TEXT_PRESETS.length - 1];
  for (const preset of CARD_RULE_TEXT_PRESETS) {
    chosen = preset;
    if (measureHeight(preset) <= maxHeight) break;
  }
  return chosen;
}
