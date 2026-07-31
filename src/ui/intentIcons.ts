import type Phaser from 'phaser';
import { C } from '../config';
import { STATUS_META } from '../combat/statuses';
import type { IntentDisplay, IntentMark } from '../combat/types';

/**
 * 意图图标 — the marker over an enemy's head, as geometry and as a decision.
 *
 * **Drawn, not blitted.** Every glyph here is a list of polygons in a unit box,
 * scaled at paint time and filled into a `Graphics`. That is the whole reason
 * this file exists rather than a sprite sheet: the game renders at whatever
 * `RENDER_SCALE` the panel asks for (up to 3× on a Retina display), and a 24 px
 * bitmap magnified 2.4× is the exact blur the design space was built to avoid.
 * A polygon has no resolution.
 *
 * Phaser is imported **for types only** — erased at build time — so the layout
 * decisions below (`intentBadge`, `intentKey`, `markColor`) can be unit tested
 * without a canvas. The bug class that buys: a badge whose number disagrees
 * with what the fight will actually do is invisible to any screenshot and
 * fatal to the player who planned around it.
 */

/**
 * The shapes. `'unknown'` has no geometry on purpose — 「？」 is drawn as brush
 * text, because a hand-painted question mark is the one glyph a polygon makes
 * worse.
 */
export type IntentGlyph =
  | 'blade'
  | 'shield'
  | 'up'
  | 'down'
  | 'drain'
  | 'banner'
  | 'foot'
  | 'cards'
  | 'purse'
  | 'unknown';

type UnitPoly = readonly (readonly [number, number])[];

/**
 * Unit geometry, y down (screen order). Every vertex is inside ±0.5 so a glyph
 * always fits the box it is asked for — `tests/intent.test.ts` holds that line,
 * because a blade that overflowed its badge would only be found by eye.
 */
const GLYPHS: Record<IntentGlyph, readonly UnitPoly[]> = {
  // 环首刀: point up, single guard, straight tang.
  blade: [
    [
      [0, -0.5],
      [0.13, -0.16],
      [0.1, 0.2],
      [0.26, 0.22],
      [0.26, 0.31],
      [0.07, 0.31],
      [0.07, 0.5],
      [-0.07, 0.5],
      [-0.07, 0.31],
      [-0.26, 0.31],
      [-0.26, 0.22],
      [-0.1, 0.2],
      [-0.13, -0.16],
    ],
  ],
  // 盾: flat top, tapering to a point.
  shield: [
    [
      [-0.34, -0.42],
      [0.34, -0.42],
      [0.32, 0.06],
      [0, 0.5],
      [-0.32, 0.06],
    ],
  ],
  up: [
    [
      [0, -0.5],
      [0.34, -0.08],
      [0.15, -0.08],
      [0.15, 0.5],
      [-0.15, 0.5],
      [-0.15, -0.08],
      [-0.34, -0.08],
    ],
  ],
  down: [
    [
      [0, 0.5],
      [0.34, 0.08],
      [0.15, 0.08],
      [0.15, -0.5],
      [-0.15, -0.5],
      [-0.15, 0.08],
      [-0.34, 0.08],
    ],
  ],
  // 血滴: direct 体力 loss, which is not an attack and must not read as one.
  drain: [
    [
      [0, -0.5],
      [0.16, -0.14],
      [0.3, 0.16],
      [0.22, 0.42],
      [0, 0.5],
      [-0.22, 0.42],
      [-0.3, 0.16],
      [-0.16, -0.14],
    ],
  ],
  // 旗: pole plus a swallow-tailed banner — 召唤 and anything else 特殊.
  banner: [
    [
      [-0.1, -0.5],
      [-0.02, -0.5],
      [-0.02, 0.5],
      [-0.1, 0.5],
    ],
    [
      [-0.02, -0.46],
      [0.42, -0.32],
      [0.24, -0.18],
      [0.42, -0.04],
      [-0.02, -0.02],
    ],
  ],
  // 足印: sole and heel. Deliberately not a running figure — it has to read at
  // 20 px, and it has to be legible as "leaving" rather than "attacking".
  foot: [
    [
      [-0.1, -0.44],
      [0.16, -0.36],
      [0.2, 0.04],
      [0.02, 0.22],
      [-0.14, 0.1],
      [-0.16, -0.24],
    ],
    [
      [-0.06, 0.28],
      [0.1, 0.32],
      [0.1, 0.48],
      [-0.06, 0.46],
    ],
  ],
  // 塞牌: two cards fanned, so 「牌组要脏了」 reads without a word of text.
  cards: [
    [
      [-0.42, -0.26],
      [0.06, -0.34],
      [0.16, 0.24],
      [-0.32, 0.32],
    ],
    [
      [-0.06, -0.32],
      [0.42, -0.24],
      [0.32, 0.34],
      [-0.16, 0.26],
    ],
  ],
  // 钱囊: drawstring neck over a round purse.
  purse: [
    [
      [-0.14, -0.4],
      [0.14, -0.4],
      [0.2, -0.08],
      [-0.2, -0.08],
    ],
    [
      [-0.28, -0.08],
      [0.28, -0.08],
      [0.34, 0.28],
      [0, 0.48],
      [-0.34, 0.28],
    ],
  ],
  unknown: [],
};

/** The polygons of one glyph at one size, in design units, centred on (0, 0). */
export function glyphPoly(glyph: IntentGlyph, size: number): { x: number; y: number }[][] {
  return GLYPHS[glyph].map((poly) => poly.map(([x, y]) => ({ x: x * size, y: y * size })));
}

/** Fill a glyph into a Graphics at (0, 0). The caller owns `clear()`. */
export function drawGlyph(
  g: Phaser.GameObjects.Graphics,
  glyph: IntentGlyph,
  size: number,
  color: number,
  alpha = 1,
): void {
  for (const poly of glyphPoly(glyph, size)) {
    g.fillStyle(color, alpha);
    g.fillPoints(poly, true);
  }
}

/**
 * How big the blade is drawn, by severity.
 *
 * This is the single most useful thing the badge does: the player reads the
 * *size* across the whole enemy line in one glance and only then reads the
 * numbers. A flat icon makes 「4 三次」 and 「22」 look identical until they are
 * added up, which is how players die to arithmetic.
 */
export function tierScale(tier: IntentDisplay['tier']): number {
  switch (tier) {
    case 'light':
      return 0.8;
    case 'medium':
      return 1;
    case 'heavy':
      return 1.25;
    case 'lethal':
      return 1.45;
    case 'none':
      return 1;
  }
}

/** 紫: the deck is about to get worse, which is its own kind of damage. */
const POLLUTE = 0x9a6fbf;
/** The blue every piece of 护甲 in the game is drawn in. */
const GUARD = 0x9fc4e0;

/** Which glyph rides beside the headline for each kind of rider. */
export function markGlyph(mark: IntentMark): IntentGlyph {
  switch (mark.m) {
    case 'block':
      return 'shield';
    case 'buff':
      return 'up';
    case 'debuff':
      return 'down';
    case 'cards':
      return 'cards';
    case 'summon':
      return 'banner';
    case 'steal':
      return 'purse';
  }
}

/**
 * A rider's colour. 增益 and 减益 borrow the status's own colour so the chip on
 * the enemy's status row and the rider on its intent are the same colour for
 * the same thing — 破绽 orange stays 破绽 orange wherever it appears.
 */
export function markColor(mark: IntentMark): number {
  switch (mark.m) {
    case 'block':
      return GUARD;
    case 'buff':
    case 'debuff':
      return STATUS_META[mark.status].color;
    case 'cards':
      return POLLUTE;
    case 'summon':
      return C.jade;
    case 'steal':
      return C.goldBright;
  }
}

/** Colour of the headline, by what the move fundamentally is. */
export function intentColor(display: IntentDisplay): number {
  if (display.hidden) return C.paperFaint;
  switch (display.kind) {
    case 'attack':
    case 'attack-defend':
    case 'attack-debuff':
      return C.cinnabarBright;
    case 'defend':
    case 'defend-buff':
      return GUARD;
    case 'buff':
      return C.goldBright;
    case 'debuff': {
      // The status it is about to hang on you, so the warning is the colour of
      // the thing being warned about.
      const hung = display.marks.find((m) => m.m === 'debuff');
      return hung ? markColor(hung) : C.cinnabar;
    }
    case 'strong-debuff':
      return POLLUTE;
    case 'special':
    case 'escape':
      return C.jade;
    case 'unknown':
      return C.paperFaint;
  }
}

/** Everything the badge draws, decided in one place and testable on its own. */
export interface IntentBadge {
  glyph: IntentGlyph;
  /** The number beside the glyph — `'5'`, `'5×3'`, `'？'`, or `''`. */
  text: string;
  /** Riders, minus whatever the headline already said out loud. */
  marks: readonly IntentMark[];
  color: number;
  /** Multiplier on the glyph. Only a damaging intent ever grows. */
  scale: number;
}

/**
 * Turn an intent into a badge.
 *
 * The order of the branches is the specification. A move that both hits and
 * walls up leads with the blade and demotes the 护甲 to a rider; a move that
 * only walls up leads with the shield and prints the armour as its headline
 * number, because 「守」 with no number was the single least useful thing the
 * old text marker said.
 */
export function intentBadge(display: IntentDisplay): IntentBadge {
  const color = intentColor(display);

  // 意图不明. Every other field of `display` is real, and none of it is shown.
  if (display.hidden) return { glyph: 'unknown', text: '？', marks: [], color, scale: 1 };

  if (display.damage !== null) {
    return {
      glyph: 'blade',
      text: display.hits > 1 ? `${display.damage}×${display.hits}` : `${display.damage}`,
      marks: display.marks,
      color,
      scale: tierScale(display.tier),
    };
  }

  // 直接失去体力: a droplet, never a blade — 护甲 does not answer it and the
  // player must not read it as something a shield can be spent on.
  if (display.loseHp !== null) {
    return {
      glyph: 'drain',
      text: `${display.loseHp}`,
      marks: display.marks,
      color,
      scale: tierScale(display.tier),
    };
  }

  // 遁走 leads with the footprint and nothing else, whatever it is carrying
  // off. 「it is leaving」 is the fact the player has to act on this turn or
  // never — the 30 資財 in its hand is a rider on that, not the headline.
  if (display.kind === 'escape') {
    return { glyph: 'foot', text: '', marks: display.marks, color, scale: 1 };
  }

  // Otherwise the headline is the largest thing the move does, in this order.
  // 召唤 outranks 护甲 deliberately: two new bodies change the fight, six
  // armour changes one exchange.
  const lead =
    display.marks.find((m) => m.m === 'summon') ??
    display.marks.find((m) => m.m === 'block') ??
    display.marks[0];

  return {
    glyph: lead ? markGlyph(lead) : KIND_GLYPH[display.kind],
    text: lead ? `${lead.n}` : '',
    marks: lead ? display.marks.filter((m) => m !== lead) : display.marks,
    color,
    scale: 1,
  };
}

/** Fallback glyph for an intent that carries no rider to lead with at all. */
const KIND_GLYPH: Record<IntentDisplay['kind'], IntentGlyph> = {
  attack: 'blade',
  'attack-defend': 'blade',
  'attack-debuff': 'blade',
  defend: 'shield',
  'defend-buff': 'shield',
  buff: 'up',
  debuff: 'down',
  'strong-debuff': 'cards',
  special: 'banner',
  escape: 'foot',
  unknown: 'unknown',
};

/**
 * A signature of what the badge currently says.
 *
 * The reveal animation fires when this changes and not when the underlying move
 * changes: an enemy that rolls 劈斩 twice running is telegraphing the same
 * thing twice and must not flash, while 神力 landing between two 劈斩 changes
 * the number and must.
 */
export function intentKey(display: IntentDisplay | null): string {
  if (!display) return '';
  const badge = intentBadge(display);
  const marks = badge.marks.map((m) => `${m.m}:${'status' in m ? m.status : ''}:${m.n}`);
  return [badge.glyph, badge.text, badge.scale, badge.color, ...marks].join('|');
}
