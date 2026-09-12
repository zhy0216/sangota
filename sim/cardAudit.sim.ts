import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import { afterAll, expect, test } from 'vitest';
import { CARDS } from '../src/combat/cards';
import { CARD_AUDIT_CASES, auditCard, type AuditRow } from './cardAudit';

// Replay a saved catalog with today's diagnostic, without checking out source
// or changing card order/reward pools. Only tuning fields may differ.
if (env.CARD_AUDIT_BASELINE) {
  const saved = JSON.parse(readFileSync(env.CARD_AUDIT_BASELINE, 'utf8')) as {
    definitions?: typeof CARDS; overrides?: typeof CARDS;
  };
  const definitions = saved.definitions ?? saved.overrides;
  if (!definitions || saved.definitions && Object.keys(definitions).length !== Object.keys(CARDS).length) {
    throw new Error('baseline must contain a full catalog or explicit tuning overrides');
  }
  for (const [id, prior] of Object.entries(definitions)) {
    const def = CARDS[id];
    if (!def || prior.id !== id || prior.hero !== def.hero || prior.rarity !== def.rarity || prior.type !== def.type) {
      throw new Error(`baseline catalog identity differs: ${id}`);
    }
  }
  for (const id of Object.keys(definitions)) CARDS[id] = definitions[id];
}

const n = Number(env.CARD_AUDIT_N ?? 300);
if (!Number.isInteger(n) || n < 2 || n > 2000) throw new Error('CARD_AUDIT_N must be an integer from 2 to 2000');
const label = env.CARD_AUDIT_LABEL ?? 'latest';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('CARD_AUDIT_LABEL must be a lowercase slug');
const selected = env.CARD_AUDIT_CARDS?.split(',');
if (selected?.some((id) => !CARD_AUDIT_CASES.some((item) => item.id === id))) throw new Error('unknown CARD_AUDIT_CARDS id');
const cases = CARD_AUDIT_CASES.filter((item) => !selected || selected.includes(item.id));
const rows: AuditRow[] = [];

for (const item of cases) test(`卡牌场景诊断: ${item.id} (${item.group})`, () => {
  const result = auditCard(item, n);
  rows.push(...result);
  const invalid = result.filter((row) => !row.valid);
  console.log(`${CARDS[item.id].name}: ${result.length} comparisons; ${invalid.length} invalid (aborts recorded, no balance verdict)`);
  expect(result.length).toBe(item.scenes.length * 2 * 2 * 3);
  expect(result.every((row) => row.valid || row.dWin === null)).toBe(true);
});

afterAll(() => {
  mkdirSync('out/card-audit', { recursive: true });
  const report = {
    format: 1, n, label,
    method: 'paired skip/add1/add2/same-size comparison; base/upgraded; greedy/tactical (optimistic seeded four-play search)',
    cases, definitions: CARDS,
    rows,
  };
  writeFileSync(`out/card-audit/${label}.json`, JSON.stringify(report, null, 2) + '\n');
  const pct = (value: number | null): string => value === null ? 'invalid' : `${(value * 100).toFixed(1)}`;
  const lines = [
    `# Card audit: ${label}`, '', `${n} paired seeds per row. Δwin is percentage points, not human usage.`,
    'Tactical previews seeded draws and uses heuristic long-term values. Any abort invalidates the comparison. Intervals subtract 97.5% Wilson intervals for paired gains/losses (conservative approximate 95%).',
    'Opportunity and play counts include all copies of the candidate in the deck. Ready is the condition before play; unused qi is end-turn qi after a candidate was used, not proven wasted qi caused by that card.',
    'New-account is a legal-card fixture, not a sampled browser unlock distribution. Different deck lengths change shuffle outcomes despite paired seeds.', '',
    '| Card | Group | Scene | Policy | Upgrade | Mode | Control | Δwin | 95% interval | ΔHP | Plays / ready | Aborts |',
    '|---|---|---|---|---:|---|---|---:|---|---:|---|---:|',
    ...rows.map((row) => `| ${CARDS[row.card].name} | ${cases.find((item) => item.id === row.card)!.group} | ${row.scene} | ${row.policy} | ${row.upgraded} | ${row.mode} | ${row.mode === 'replace' ? CARDS[row.compare].name : 'skip'} | ${pct(row.dWin)} | ${row.ci95?.map(pct).join(' … ') ?? '—'} | ${row.dHp?.toFixed(1) ?? '—'} | ${row.totals.plays} / ${row.totals.readyPlays} | ${row.aborts.length} |`),
  ];
  writeFileSync(`out/card-audit/${label}.md`, lines.join('\n') + '\n');
  console.log(`Card audit saved: out/card-audit/${label}.{json,md}`);
});
