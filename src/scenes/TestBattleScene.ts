import Phaser from 'phaser';
import { getAudio } from '../audio/sfx';
import { getEnemy, type CombatTier } from '../combat/enemies';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { ACTS, actLabel, type ActIndex } from '../data/acts';
import { ascensionLabel } from '../data/ascension';
import { HEROES, HEROES_IN_ORDER } from '../data/heroes';
import {
  DEFAULT_TEST_BATTLE,
  TEST_BATTLE_STAGES,
  prepareTestBattle,
  testBattleLoadouts,
  type TestBattleConfig,
} from '../state/testBattle';
import { useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';

const TIER_LABEL: Record<CombatTier, string> = { monster: '普通战', elite: '精英战', boss: '首领战' };
const TIER_COLOR: Record<CombatTier, number> = { monster: C.paperDim, elite: C.gold, boss: C.cinnabarBright };

/** A single fight with a repeatable opening; returning here keeps the last selection. */
export class TestBattleScene extends Phaser.Scene {
  private config!: TestBattleConfig;
  private act: ActIndex = 1;
  private leaving = false;
  private choices!: Phaser.GameObjects.Container;

  constructor() {
    super('TestBattle');
  }

  init(data?: { config?: Partial<TestBattleConfig> }): void {
    this.config = { ...DEFAULT_TEST_BATTLE, ...data?.config };
    this.act = TEST_BATTLE_STAGES.find((stage) => stage.encounter.id === this.config.encounterId)!.act;
    this.leaving = false;
  }

  create(): void {
    useDesignSpace(this);
    const audio = getAudio(this);
    audio.ensureMusic('title', this);
    audio.music('title');
    this.input.once('pointerdown', () => audio.unlock());

    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'combat-bg');
    bg.setScale(Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height));
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.82);
    this.add.text(48, 26, '测 试 战 场', brushStyle(44, C.goldBright)).setLetterSpacing(6);
    this.add.text(50, 86, '自由选将 · 指定关卡 · 不计分，不影响征程存档与解锁进度', bodyStyle(15, C.paperDim));
    inkButton(this, GAME_WIDTH - 116, 56, '返 回', {
      width: 136, height: 46, fontSize: 20,
      onClick: () => this.leave(),
    });

    this.choices = this.add.container(0, 0);
    this.paintChoices();
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.input.keyboard?.on('keydown-ENTER', () => this.beginBattle());
  }

  private paintChoices(): void {
    const root = this.choices;
    root.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      root.add(object);
      return object;
    };
    add(inkPanel(this, 48, 128, 304, 482, { alpha: 0.88 }));
    add(inkPanel(this, 376, 128, 856, 482, { alpha: 0.88 }));
    add(this.add.text(68, 146, '选 将', brushStyle(24, C.gold)));

    HEROES_IN_ORDER.filter((hero) => !hero.wip).forEach((hero, index) => {
      const picked = hero.id === this.config.heroId;
      add(inkButton(this, 104 + index * 96, 208, hero.name, {
        width: 86, height: 48, fontSize: 19,
        accent: picked ? C.cinnabarBright : C.paperFaint,
        onClick: () => {
          if (this.leaving || picked) return;
          this.config.heroId = hero.id;
          this.config.loadoutId = 'starter';
          this.paintChoices();
        },
      }));
    });

    add(this.add.text(68, 260, '测试构筑', brushStyle(24, C.gold)));
    const loadouts = testBattleLoadouts(this.config.heroId);
    loadouts.forEach((loadout, index) => {
      const picked = loadout.id === this.config.loadoutId;
      add(inkButton(this, 200, 316 + index * 52, loadout.name, {
        width: 260, height: 42, fontSize: 19,
        accent: picked ? C.cinnabarBright : C.paperFaint,
        onClick: () => {
          if (this.leaving || picked) return;
          this.config.loadoutId = loadout.id;
          this.paintChoices();
        },
      }));
    });
    const loadout = loadouts.find((entry) => entry.id === this.config.loadoutId)!;
    add(this.add.text(70, 510, loadout.description, {
      ...bodyStyle(14, C.paperDim),
      wordWrap: { width: 258, useAdvancedWrap: true },
      lineSpacing: 5,
    }));
    add(this.add.text(70, 587, loadout.scene ? '预设手牌与气 · 敌军使用关卡原值' : '正常开局 · 固定种子可反复比较', bodyStyle(12, C.gold)));

    Object.values(ACTS).forEach((act, index) => {
      add(inkButton(this, 493 + index * 208, 162, actLabel(act), {
        width: 196, height: 40, fontSize: 17,
        accent: act.index === this.act ? C.cinnabarBright : C.paperFaint,
        onClick: () => {
          if (this.leaving || act.index === this.act) return;
          this.act = act.index;
          this.config.encounterId = TEST_BATTLE_STAGES.find((stage) => stage.act === this.act)!.encounter.id;
          this.paintChoices();
        },
      }));
    });
    const stages = TEST_BATTLE_STAGES.filter((stage) => stage.act === this.act);
    stages.forEach((stage, index) => {
      const x = 396 + (index % 3) * 278;
      const y = 202 + Math.floor(index / 3) * 79;
      const picked = stage.encounter.id === this.config.encounterId;
      const card = add(this.add.container(x, y));
      card.add(inkPanel(this, 0, 0, 260, 68, {
        alpha: picked ? 1 : 0.6,
        border: picked ? C.cinnabarBright : C.paperFaint,
      }));
      card.add(this.add.text(12, 8, `${picked ? '● ' : ''}${TIER_LABEL[stage.tier]}`, bodyStyle(12, TIER_COLOR[stage.tier])));
      card.add(this.add.text(12, 32, stage.encounter.name, brushStyle(18, picked ? C.goldBright : C.paper)));
      const hit = this.add.zone(0, 0, 260, 68).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => {
        if (this.leaving || picked) return;
        getAudio(this).play('ui-click');
        this.config.encounterId = stage.encounter.id;
        this.paintChoices();
      });
      card.add(hit);
    });

    const selected = stages.find((stage) => stage.encounter.id === this.config.encounterId)!;
    const hero = HEROES[this.config.heroId];
    add(this.add.text(50, 634, `${hero.name} · ${selected.encounter.name}`, brushStyle(23, C.paper)));
    const enemies = selected.encounter.enemies.map((id) => getEnemy(id).name).join('、');
    const difficulty = ascensionLabel(this.config.ascension) || '无天命';
    add(this.add.text(50, 673, `${difficulty} · 敌军：${enemies}`, bodyStyle(14, C.paperDim)));
    add(inkButton(this, 1112, 658, '开始测试', {
      width: 236, height: 60, fontSize: 28, accent: C.cinnabar,
      onClick: () => this.beginBattle(),
    }));
  }

  private beginBattle(): void {
    if (this.leaving) return;
    this.leaving = true;
    const prepared = prepareTestBattle(this.config);
    getAudio(this).unlock();
    this.scene.start('Combat', { resume: prepared.combat, testBattle: { ...this.config } });
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.start('Custom');
  }
}
