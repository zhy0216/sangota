import { describe, expect, it } from 'vitest';
import { CARDS, UPGRADE_SUFFIX, canUpgrade, getCard, resolveCard } from '../src/combat/cards';
import { isNegative } from '../src/combat/curses';
import { getEncounter } from '../src/combat/enemies';
import {
  canPlay,
  defOf,
  endPlayerTurn,
  playCard,
  previewValues,
  runEnemyTurn,
  startCombat,
} from '../src/combat/engine';
import { RELICS } from '../src/combat/relics';
import type { CombatEvent, CombatState, Effect } from '../src/combat/types';
import { DEFAULT_HERO } from '../src/data/heroes';
import {
  newDeckCard,
  startRun,
  upgradableCards,
  upgradeCard,
  type DeckCard,
} from '../src/state/run';

/** The upgrade table from todos/03 — pinned so balance edits stay deliberate. */
const UPGRADE_TABLE: Record<string, { cost?: number; effects?: Effect[] }> = {
  pikan: { effects: [{ kind: 'damage', amount: 9 }] },
  tiebi: { effects: [{ kind: 'block', amount: 8 }] },
  tuodao: {
    effects: [
      { kind: 'damage', amount: 10 },
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'target' },
    ],
  },
  wenjiu: {
    effects: [
      { kind: 'damage', amount: 10 },
      { kind: 'status', status: 'vulnerable', amount: 2, to: 'target' },
    ],
  },
  wanren: { effects: [{ kind: 'damageAll', amount: 15 }] },
  quedi: {
    effects: [
      { kind: 'block', amount: 11 },
      { kind: 'draw', amount: 1 },
    ],
  },
  yiyong: { effects: [{ kind: 'status', status: 'strength', amount: 3, to: 'self' }] },
  baima: { effects: [{ kind: 'damage', amount: 7 }] },
  jieying: { cost: 1 },
  guanzhen: { effects: [{ kind: 'draw', amount: 3 }] },
  xuzhao: {
    effects: [
      { kind: 'status', status: 'weak', amount: 3, to: 'target' },
      { kind: 'block', amount: 6 },
    ],
  },

  // --- todos/11 pool expansion --------------------------------------------
  dandaofuhui: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'handEmpty' },
        then: [{ kind: 'damage', amount: 16 }],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
  },
  huarongdao: { effects: [{ kind: 'block', amount: 13 }] },
  bingzhudadan: { effects: [{ kind: 'block', amount: 10 }] },
  yeduchunqiu: { effects: [{ kind: 'draw', amount: 3 }] },
  shuiyanqijun: {
    effects: [
      { kind: 'damageAll', amount: 8, times: 2 },
      {
        kind: 'conditional',
        when: { c: 'enemyCountAtLeast', n: 2 },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
  },
  zhanyanliang: {
    effects: [
      { kind: 'damage', amount: 12 },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'vulnerable' },
        then: [{ kind: 'energy', amount: 1 }],
      },
    ],
  },
  hulaoguan: { effects: [{ kind: 'scaleWithEnergy', per: [{ kind: 'damage', amount: 8 }] }] },
  tushanyuesanshi: {
    effects: [
      { kind: 'loseHp', amount: 3 },
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 2 },
    ],
  },
  wubaijiaodaoshou: {
    effects: [{ kind: 'addCard', defId: 'baima', count: 3, to: 'hand', upgraded: 1 }],
  },
  guaguliaodu: {
    effects: [
      { kind: 'loseHp', amount: 3 },
      { kind: 'status', status: 'regen', amount: 6, to: 'self' },
    ],
  },
  weizhenhuaxia: { effects: [{ kind: 'status', status: 'ritual', amount: 2, to: 'self' }] },
  wuguanliujiang: { effects: [{ kind: 'status', status: 'slayer', amount: 3, to: 'self' }] },
  shengougaolei: { cost: 1 },

  // --- 2026-08 关羽池扩 -------------------------------------------------------
  zhuwenchou: {
    effects: [
      { kind: 'damage', amount: 11 },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
  },
  lemahengdao: {
    effects: [
      { kind: 'block', amount: 8 },
      { kind: 'status', status: 'weak', amount: 1, to: 'allEnemies' },
    ],
  },
  daotiaojinpao: {
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'status', status: 'strength', amount: 1, to: 'self' },
    ],
  },
  fengjinguayin: { effects: [{ kind: 'energy', amount: 3 }] },
  yanyuezhan: {
    effects: [
      { kind: 'damage', amount: 24 },
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'target' },
    ],
  },
  qianlizoudanqi: {
    effects: [
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 3 },
    ],
  },
  yibaoyuntian: { effects: [{ kind: 'status', status: 'artifact', amount: 3, to: 'self' }] },
  qinglongjueying: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'vulnerable' },
        then: [{ kind: 'damage', amount: 45 }],
        otherwise: [{ kind: 'damage', amount: 30 }],
      },
      { kind: 'status', status: 'vulnerable', amount: 4, to: 'target' },
    ],
  },
  wushenglinshi: {
    effects: [
      { kind: 'status', status: 'strength', amount: 5, to: 'self' },
      { kind: 'status', status: 'buffer', amount: 2, to: 'self' },
      { kind: 'block', amount: 20 },
    ],
  },
  yijueqianqiu: {
    effects: [
      {
        kind: 'scaleWithEnergy',
        per: [
          { kind: 'damage', amount: 10 },
          { kind: 'block', amount: 4 },
        ],
      },
    ],
  },

  // --- 2026-08 关羽稀有补层 -------------------------------------------------
  shenzaicaoying: { cost: 1 },
  guchenghui: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'handEmpty' },
        then: [
          { kind: 'damage', amount: 30 },
          { kind: 'draw', amount: 2 },
        ],
        otherwise: [{ kind: 'damage', amount: 18 }],
      },
    ],
  },
  wanjunqushou: {
    effects: [
      { kind: 'status', status: 'slayer', amount: 1, to: 'self' },
      { kind: 'damageAll', amount: 12, times: 2 },
    ],
  },
  baimajiewei: {
    effects: [
      { kind: 'damage', amount: 20 },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'vulnerable' },
        then: [{ kind: 'draw', amount: 2 }],
      },
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [{ kind: 'energy', amount: 2 }],
      },
    ],
  },

  // --- 2026-08 关羽中层发动机 ---------------------------------------------
  huimazhan: {
    effects: [
      { kind: 'damage', amount: 11 },
      { kind: 'discard', amount: 1 },
      { kind: 'draw', amount: 1 },
    ],
  },
  mingjinzhengdui: {
    effects: [
      { kind: 'block', amount: 9 },
      { kind: 'shuffleDiscardIn' },
      { kind: 'draw', amount: 1 },
    ],
  },
  duanpaojueyi: {
    effects: [
      { kind: 'damage', amount: 11 },
      { kind: 'exhaustCards', amount: 1 },
    ],
  },
  qingzhuangjiancong: {
    effects: [
      { kind: 'discard', amount: 1 },
      { kind: 'draw', amount: 3 },
    ],
  },
  yanqiyansha: {
    effects: [
      { kind: 'damageAll', amount: 11 },
      { kind: 'discard', amount: 2 },
      { kind: 'draw', amount: 2 },
    ],
  },
  zhenqianlidao: {
    effects: [
      { kind: 'exhaustCards', amount: 1 },
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 2 },
    ],
  },
  bingyinghezhen: {
    effects: [
      { kind: 'block', amount: 11 },
      { kind: 'exhaustCards', amount: 1 },
      { kind: 'draw', amount: 2 },
    ],
  },
  juantuchonglai: { cost: 0 },
  yijiahuanzhen: {
    effects: [
      { kind: 'discard', amount: 2 },
      { kind: 'draw', amount: 4 },
    ],
  },
  baizhanhuifeng: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 4 },
        then: [{ kind: 'damage', amount: 18 }],
        otherwise: [{ kind: 'damage', amount: 11 }],
      },
    ],
  },
  zhengjingwu: {
    effects: [{ kind: 'status', status: 'discipline', amount: 4, to: 'self' }],
  },
  libingmoma: {
    effects: [{ kind: 'status', status: 'armory', amount: 3, to: 'self' }],
  },
  liangdaochangtong: { cost: 0 },
  chizhongdaiji: {
    effects: [{ kind: 'status', status: 'dexterity', amount: 3, to: 'self' }],
  },
  wusheng: { cost: 1 },
  hanbingzaixing: {
    effects: [
      { kind: 'shuffleDiscardIn' },
      { kind: 'energy', amount: 1 },
      { kind: 'draw', amount: 5 },
    ],
  },

  // --- todos/05 无色 stock, sold only over a 商旅's counter -----------------
  qingnangshu: { effects: [{ kind: 'heal', amount: 9 }] },
  lujiao: { effects: [{ kind: 'status', status: 'thorns', amount: 4, to: 'self' }] },
  lijianji: {
    effects: [
      { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'allEnemies' },
    ],
  },
  dushi: {
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'status', status: 'poison', amount: 4, to: 'target' },
    ],
  },
  bazhentu: { effects: [{ kind: 'status', status: 'metallicize', amount: 5, to: 'self' }] },

  // --- todos/17 赵云 · 连击 -------------------------------------------------
  tuzhen: { effects: [{ kind: 'damage', amount: 9 }] },
  luema: { effects: [{ kind: 'block', amount: 8 }] },
  longdan: {
    effects: [
      { kind: 'damage', amount: 5 },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 2 },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
  },
  tingqiang: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'damage', amount: 12 }],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
  },
  qitanpanshe: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'scaleWithAttacks', per: [{ kind: 'damage', amount: 7 }] }],
        otherwise: [{ kind: 'damage', amount: 7 }],
      },
    ],
  },
  kongyingji: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attackPlayedThisTurn' },
        then: [{ kind: 'block', amount: 8 }],
        otherwise: [{ kind: 'block', amount: 14 }],
      },
    ],
  },
  sanjinsanchu: { effects: [{ kind: 'damage', amount: 4, times: 3 }] },
  jiejiang: {
    effects: [
      { kind: 'block', amount: 6 },
      { kind: 'scaleWithAttacks', per: [{ kind: 'block', amount: 4 }] },
    ],
  },
  xueranzhengpao: {
    effects: [
      { kind: 'loseHp', amount: 3 },
      { kind: 'damage', amount: 14 },
    ],
  },
  yishenshidan: {
    effects: [
      { kind: 'status', status: 'buffer', amount: 3, to: 'self' },
      { kind: 'status', status: 'strength', amount: 1, to: 'self' },
    ],
  },
  danqijiuzhu: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'hpBelow', percent: 50 },
        then: [
          { kind: 'damage', amount: 20 },
          { kind: 'heal', amount: 8 },
        ],
        otherwise: [{ kind: 'damage', amount: 11 }],
      },
    ],
  },
  lizhanwujiang: { effects: [{ kind: 'damage', amount: 7, times: 5 }] },

  // --- todos/17 赵云 pool expansion (9 → 20 draftable) ----------------------
  lianhuanqiang: { effects: [{ kind: 'damage', amount: 4, times: 2 }] },
  jici: {
    effects: [
      { kind: 'damage', amount: 5 },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 2 },
        then: [{ kind: 'energy', amount: 1 }],
      },
    ],
  },
  duojian: {
    effects: [
      { kind: 'damage', amount: 8 },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 2 },
        then: [{ kind: 'status', status: 'vulnerable', amount: 2, to: 'target' }],
      },
    ],
  },
  qianghua: {
    effects: [
      { kind: 'block', amount: 8 },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
  },
  chenshi: {
    effects: [
      { kind: 'draw', amount: 2 },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'draw', amount: 1 }],
      },
    ],
  },
  yinqiang: {
    effects: [
      { kind: 'damage', amount: 8 },
      { kind: 'draw', amount: 1 },
    ],
  },
  hengsaoqianjun: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 2 },
        then: [{ kind: 'damageAll', amount: 13 }],
        otherwise: [{ kind: 'damageAll', amount: 8 }],
      },
    ],
  },
  longxiang: {
    effects: [
      { kind: 'loseHp', amount: 1 },
      { kind: 'energy', amount: 1 },
      { kind: 'draw', amount: 1 },
    ],
  },
  yanqixigu: {
    effects: [
      { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
      { kind: 'block', amount: 7 },
    ],
  },
  huwei: { effects: [{ kind: 'status', status: 'dexterity', amount: 3, to: 'self' }] },
  changbanpo: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [
          {
            kind: 'scaleWithAttacks',
            per: [
              { kind: 'damage', amount: 9 },
              { kind: 'block', amount: 4 },
            ],
          },
        ],
        otherwise: [
          { kind: 'damage', amount: 9 },
          { kind: 'block', amount: 4 },
        ],
      },
    ],
  },
  qiruchangban: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 1 },
        then: [{ kind: 'scaleWithAttacks', per: [{ kind: 'damage', amount: 10 }] }],
        otherwise: [{ kind: 'damage', amount: 10 }],
      },
      {
        kind: 'conditional',
        when: { c: 'attacksAtLeast', n: 3 },
        then: [
          { kind: 'energy', amount: 1 },
          { kind: 'draw', amount: 3 },
        ],
      },
    ],
  },
  longyinzhenjun: {
    effects: [
      { kind: 'damageAll', amount: 8, times: 3 },
      { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
    ],
  },
  zhaoyepozhen: {
    effects: [
      { kind: 'loseHp', amount: 3 },
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 4 },
      { kind: 'status', status: 'buffer', amount: 1, to: 'self' },
    ],
  },

  // --- todos/17 诸葛亮 · 锦囊 -----------------------------------------------
  yuanrongnu: { effects: [{ kind: 'damage', amount: 4, times: 2 }] },
  jushou: { effects: [{ kind: 'block', amount: 8 }] },
  longzhongdui: {
    effects: [{ kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' }],
  },
  /**
   * 「锦囊」 is minted in combat and never drafted, so it deliberately carries no
   * `upgrade` — `resolveCard(id, 1)` gives back the base def. Listed with an
   * empty override so this suite still accounts for it rather than skipping it.
   */
  jinnang: {},
  jiejianzhiji: {
    effects: [
      { kind: 'block', amount: 9 },
      { kind: 'addCard', defId: 'jinnang', count: 1, to: 'hand' },
    ],
  },
  jiedongfeng: {
    effects: [
      { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
      { kind: 'draw', amount: 1 },
    ],
  },
  huoji: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'damage', amount: 16 }],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
  },
  kongchengji: {
    effects: [
      { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
      { kind: 'block', amount: 11 },
    ],
  },
  qixingdeng: { effects: [{ kind: 'status', status: 'regen', amount: 6, to: 'self' }] },
  muniuliuma: { cost: 0 },
  wolongchushan: {
    effects: [
      { kind: 'status', status: 'strength', amount: 3, to: 'self' },
      { kind: 'addCard', defId: 'jinnang', count: 2, to: 'hand' },
    ],
  },
  chushibiao: {
    effects: [
      { kind: 'energy', amount: 2 },
      { kind: 'draw', amount: 3 },
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'draw', amount: 2 }],
      },
    ],
  },
  qiqinqizong: {
    effects: [
      { kind: 'status', status: 'vulnerable', amount: 4, to: 'allEnemies' },
      { kind: 'status', status: 'weak', amount: 4, to: 'allEnemies' },
      { kind: 'draw', amount: 2 },
    ],
  },

  // --- todos/17 诸葛亮 pool expansion (9 → 20 draftable) --------------------
  youdi: {
    effects: [
      { kind: 'damage', amount: 7 },
      { kind: 'status', status: 'weak', amount: 2, to: 'target' },
    ],
  },
  shengdongjixi: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'targetHasStatus', status: 'weak' },
        then: [{ kind: 'damage', amount: 12 }],
        otherwise: [{ kind: 'damage', amount: 8 }],
      },
    ],
  },
  miaosuan: {
    effects: [{ kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' }],
  },
  fubing: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'block', amount: 12 }],
        otherwise: [{ kind: 'block', amount: 7 }],
      },
    ],
  },
  jijiangfa: {
    effects: [
      { kind: 'damage', amount: 5 },
      { kind: 'status', status: 'weak', amount: 1, to: 'target' },
    ],
  },
  guanxing: {
    effects: [
      {
        kind: 'scaleWithEnergy',
        per: [
          { kind: 'draw', amount: 1 },
          { kind: 'block', amount: 2 },
        ],
      },
    ],
  },
  huoshaobowang: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 3 },
        then: [{ kind: 'damageAll', amount: 14 }],
        otherwise: [{ kind: 'damageAll', amount: 9 }],
      },
    ],
  },
  jianbingzengzao: {
    effects: [
      { kind: 'exhaustCards', amount: 1 },
      { kind: 'energy', amount: 1 },
      { kind: 'draw', amount: 2 },
    ],
  },
  shenjimiaosuan: { cost: 0 },
  anjupingwulu: {
    effects: [
      { kind: 'block', amount: 15 },
      { kind: 'status', status: 'weak', amount: 2, to: 'allEnemies' },
    ],
  },
  huoshaotengjia: {
    effects: [
      {
        kind: 'conditional',
        when: { c: 'exhaustedAtLeast', n: 5 },
        then: [{ kind: 'damage', amount: 28 }],
        otherwise: [{ kind: 'damage', amount: 14 }],
      },
    ],
  },
  qimenbazhen: {
    effects: [
      { kind: 'block', amount: 24 },
      { kind: 'status', status: 'vulnerable', amount: 3, to: 'allEnemies' },
      { kind: 'status', status: 'weak', amount: 3, to: 'allEnemies' },
      { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
    ],
  },
  dongfengjitian: {
    effects: [
      { kind: 'scaleWithEnergy', per: [{ kind: 'damageAll', amount: 8 }] },
      { kind: 'status', status: 'vulnerable', amount: 2, to: 'allEnemies' },
    ],
  },
  qixingxuming: {
    cost: 2,
    effects: [
      { kind: 'heal', amount: 16 },
      { kind: 'status', status: 'buffer', amount: 2, to: 'self' },
      { kind: 'addCard', defId: 'jinnang', count: 3, to: 'hand' },
    ],
  },
};

/** Minimal combat state to preview a card face against — no enemies needed. */
function bench(deck: DeckCard[]): CombatState {
  return startCombat({
    encounter: getEncounter('m1'),
    deck,
    heroName: DEFAULT_HERO.name,
    hp: DEFAULT_HERO.maxHp,
    maxHp: DEFAULT_HERO.maxHp,
    relics: [DEFAULT_HERO.starterRelic],
    seed: 'bench',
  });
}

describe('resolveCard', () => {
  it('covers every forgeable card with the pinned upgrade table', () => {
    // Curses and status cards are in `CARDS` and deliberately have no upgrade,
    // which is what keeps them off the forge list — checked below.
    const forgeable = Object.keys(CARDS).filter((id) => !isNegative(CARDS[id]));
    expect(forgeable.sort()).toEqual(Object.keys(UPGRADE_TABLE).sort());
    for (const [id, expected] of Object.entries(UPGRADE_TABLE)) {
      const up = resolveCard(id, 1);
      if (expected.effects) expect(up.effects).toEqual(expected.effects);
      expect(up.cost).toBe(expected.cost ?? getCard(id).cost);
    }
  });

  it('marks upgrades with the 「·精」 suffix and leaves the base def alone', () => {
    expect(resolveCard('pikan', 0).name).toBe('劈砍');
    expect(resolveCard('pikan', 1).name).toBe('劈砍' + UPGRADE_SUFFIX);
    expect(getCard('pikan').effects).toEqual([{ kind: 'damage', amount: 6 }]);
    expect(resolveCard('pikan', 1).upgrade).toBeUndefined();
  });

  it('refuses to stack past one upgrade', () => {
    expect(canUpgrade('pikan', 0)).toBe(true);
    expect(canUpgrade('pikan', 1)).toBe(false);
  });
});

describe('upgradeCard', () => {
  it('touches exactly one physical copy', () => {
    const run = startRun(DEFAULT_HERO, 'upgrade-seed');
    const pikans = run.deck.filter((c) => c.defId === 'pikan');
    expect(pikans).toHaveLength(5);

    expect(upgradeCard(run, pikans[2].uid)).toBe(true);

    expect(run.deck.filter((c) => c.defId === 'pikan' && c.upgraded === 1)).toEqual([pikans[2]]);
    for (const other of [pikans[0], pikans[1], pikans[3], pikans[4]]) {
      expect(other.upgraded).toBe(0);
    }
  });

  it('rejects a second upgrade and unknown uids', () => {
    const run = startRun(DEFAULT_HERO, 'upgrade-seed');
    const uid = run.deck[0].uid;
    expect(upgradeCard(run, uid)).toBe(true);
    expect(upgradeCard(run, uid)).toBe(false);
    expect(upgradeCard(run, 'nope')).toBe(false);
  });

  it('drops upgraded copies out of upgradableCards', () => {
    const run = startRun(DEFAULT_HERO, 'upgrade-seed');
    const before = upgradableCards(run).length;
    expect(before).toBe(run.deck.length);
    upgradeCard(run, run.deck[0].uid);
    expect(upgradableCards(run)).toHaveLength(before - 1);
  });

  it('hands out monotonic uids, so a seed replays identically', () => {
    const a = startRun(DEFAULT_HERO, 'same');
    const uidsA = a.deck.map((c) => c.uid);
    const b = startRun(DEFAULT_HERO, 'same');
    expect(b.deck.map((c) => c.uid)).toEqual(uidsA);
    expect(new Set(uidsA).size).toBe(uidsA.length);
  });
});

describe('upgraded card faces', () => {
  it('previews 9 damage, or 12 with 青龙偃月 still available', () => {
    const state = bench([newDeckCard('pikan', 1)]);
    const def = resolveCard('pikan', 1);

    expect(previewValues(state, def).D).toBe(9 + (RELICS.qinglongdao.value ?? 0));
    state.attacksThisTurn = 1;
    expect(previewValues(state, def).D).toBe(9);
  });

  it('deals what the face promised', () => {
    const state = bench([newDeckCard('pikan', 1)]);
    const uid = state.hand[0];
    const enemy = state.enemies[0];
    const promised = previewValues(state, defOf(state, uid), enemy).D;
    const hpBefore = enemy.hp;

    expect(playCard(state, uid, enemy.id)).toBe(true);
    expect(hpBefore - enemy.hp).toBe(promised);
  });

  it('makes 结营·精 playable on 1 气', () => {
    const state = bench([newDeckCard('jieying', 1)]);
    const uid = state.hand[0];
    expect(defOf(state, uid).cost).toBe(1);
    state.energy = 1;
    expect(canPlay(state, uid)).toBe(true);

    playCard(state, uid);
    expect(state.player.block).toBe(15);
  });

  it('keeps unupgraded copies of the same id on their base numbers', () => {
    const state = bench([newDeckCard('pikan', 0), newDeckCard('pikan', 1)]);
    const [plain, forged] = state.hand.map((uid) => defOf(state, uid).effects[0]);
    const amounts = [plain, forged].map((e) => (e.kind === 'damage' ? e.amount : -1)).sort();
    expect(amounts).toEqual([6, 9]);
  });
});

describe('determinism', () => {
  /** Greedy driver: play whatever is affordable, leftmost first, then end turn. */
  function runFight(deck: DeckCard[]): CombatEvent[] {
    const state = bench(deck);
    const log: CombatEvent[] = [];
    let guard = 0;

    while (state.phase !== 'won' && state.phase !== 'lost' && guard++ < 200) {
      const uid = state.hand.find((u) => canPlay(state, u));
      if (uid) {
        const wantsTarget = defOf(state, uid).target === 'enemy';
        const targetId = wantsTarget ? state.enemies.find((e) => e.alive)?.id : undefined;
        playCard(state, uid, targetId);
      } else {
        endPlayerTurn(state);
        runEnemyTurn(state);
      }
      log.push(...state.events.splice(0));
    }
    return log;
  }

  it('replays the same fight from the same seed and the same upgrades', () => {
    const build = (): DeckCard[] => {
      const run = startRun(DEFAULT_HERO, 'replay');
      upgradeCard(run, run.deck.filter((c) => c.defId === 'pikan')[2].uid);
      upgradeCard(run, run.deck.filter((c) => c.defId === 'tiebi')[0].uid);
      return run.deck;
    };
    expect(runFight(build())).toEqual(runFight(build()));
  });

  it('notices when an upgrade changes the fight', () => {
    const plain = startRun(DEFAULT_HERO, 'replay').deck;
    const run = startRun(DEFAULT_HERO, 'replay');
    for (const card of run.deck) upgradeCard(run, card.uid);
    expect(runFight(plain)).not.toEqual(runFight(run.deck));
  });
});
