import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { actExit, advanceAct, type ActDef } from '../data/acts';
import { getRun, type RunState } from '../state/run';
import { clearSave, writeSave } from '../state/save';
import { useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle } from '../ui/theme';

/**
 * 幕间 — the black card between two acts, and the only caller of `advanceAct`.
 *
 * The ledger wipe happens **here**, in `create`, before a single tween starts.
 * `CombatScene` must not do it: the 战利品 chest and the ordinary spoils are
 * both still being paid out while that scene is up, and both are gated on
 * `run.rooms[bossNode]`. Clearing the ledger a beat early silently drops the
 * chest's answer, and with it the 宝钥 that decides whether 终章 opens.
 *
 * 「跳过」 therefore only accelerates the animation. There is nothing to skip:
 * by the time the card is drawn the run is already standing in the next act.
 */

/** How long the card holds before it fades on its own. */
const HOLD_MS = 2500;

export class InterludeScene extends Phaser.Scene {
  private run!: RunState;
  /** Same one-way gate as every other scene exit — see `TitleScene.leaving`. */
  private leaving = false;
  private layer!: Phaser.GameObjects.Container;
  private holdTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('Interlude');
  }

  /** Per-visit reset. A class field would only ever run once — see 约定 in
   *  `tests/integrity.test.ts`, 「scene state does not survive」. */
  init(): void {
    this.leaving = false;
    this.holdTimer = undefined;
  }

  create(): void {
    useDesignSpace(this);
    this.run = getRun();

    // One decision, made before anything is drawn: either the run moves on, or
    // it is over — and a run that is over goes straight to 结算 (todos/22 s3),
    // not through the card. 存档 cleared here, in the same breath: a run that
    // just ended keeps no save at all, and the title must not offer 「继续」.
    // `endRun` is the summary screen's to call — it still reads the run.
    if (actExit(this.run) === 'victory') {
      clearSave();
      this.scene.start('Summary', { victory: true });
      return;
    }

    const act = advanceAct(this.run);

    // 存档 (todos/08), immediately and in the same breath as the act change.
    // `advanceAct` is a one-way door that wipes the room ledger and rebuilds the
    // map: a save written before it and reloaded after would put the player back
    // in front of a 首领 whose 战利品 chest is已答, and `advanceAct` throws on the
    // second pass through.
    writeSave(this.run, null);

    this.cameras.main.fadeIn(520, 8, 6, 4);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 1);

    this.layer = this.add.container(0, 0);
    this.paintAct(act);

    this.holdTimer = this.time.delayedCall(HOLD_MS, () => this.leave());

    // Anything at all moves it along: click, tap, Enter, Space, Esc.
    this.input.once('pointerdown', () => this.leave());
    for (const key of ['ENTER', 'SPACE', 'ESC']) {
      this.input.keyboard?.once(`keydown-${key}`, () => this.leave());
    }

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 44, '点击继续', bodyStyle(14, 0x6b6355))
      .setOrigin(0.5)
      .setLetterSpacing(4);
  }

  // ------------------------------------------------------------------- paint

  private paintAct(act: ActDef): void {
    const midX = GAME_WIDTH / 2;

    // 竖排 title: one glyph per line, the way a chapter card would be brushed
    // on a scroll. `setLineSpacing` rather than one Text per glyph so the whole
    // column tweens as a single object.
    const column = this.add
      .text(midX, 96, [...act.name].join('\n'), brushStyle(76, C.paper))
      .setOrigin(0.5, 0)
      .setLineSpacing(18)
      .setAlign('center');
    this.fadeUp(column, 0);

    const seal = this.add
      .text(midX, 92, act.index === 4 ? '终' : ['一', '二', '三'][act.index - 1], brushStyle(360, C.cinnabar))
      .setOrigin(0.5, 0)
      .setAlpha(0);
    seal.setDepth(-1);
    this.tweens.add({ targets: seal, alpha: 0.09, duration: 1400, delay: 120 });
    this.layer.add(seal);

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.45);
    rule.lineBetween(midX - 190, GAME_HEIGHT - 214, midX + 190, GAME_HEIGHT - 214);
    rule.fillStyle(C.cinnabar, 0.9);
    rule.fillCircle(midX, GAME_HEIGHT - 214, 3);
    this.fadeUp(rule, 220);

    const subtitle = this.add
      .text(midX, GAME_HEIGHT - 188, act.subtitle, bodyStyle(20, C.gold))
      .setOrigin(0.5, 0)
      .setLetterSpacing(6);
    this.fadeUp(subtitle, 300);

    if (act.epigraph) {
      const epigraph = this.add
        .text(midX, GAME_HEIGHT - 152, act.epigraph, bodyStyle(15, C.paperFaint))
        .setOrigin(0.5, 0)
        .setLetterSpacing(3);
      this.fadeUp(epigraph, 420);
    }

    // The one line that reports a number: 终章 pays 30% of 体力上限 on the way in
    // and the player must be able to see it land.
    const healed = act.interActHealPercent > 0;
    const line = this.add
      .text(
        midX,
        GAME_HEIGHT - 112,
        healed
          ? `休整片刻　·　体力 ${this.run.hp} / ${this.run.maxHp}`
          : `体力 ${this.run.hp} / ${this.run.maxHp}　·　资财 ${this.run.gold}`,
        bodyStyle(16, healed ? C.jade : C.paperDim),
      )
      .setOrigin(0.5, 0)
      .setLetterSpacing(2);
    this.fadeUp(line, 520);
  }

  private fadeUp(obj: Phaser.GameObjects.GameObject, delay: number): void {
    const target = obj as Phaser.GameObjects.GameObject & { alpha: number; y: number };
    const restY = target.y;
    target.alpha = 0;
    target.y = restY + 16;
    this.tweens.add({
      targets: target,
      alpha: 1,
      y: restY,
      duration: 620,
      delay,
      ease: 'Cubic.easeOut',
    });
    this.layer.add(target as Phaser.GameObjects.GameObject);
  }

  // ------------------------------------------------------------------- exit

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.holdTimer?.remove();
    this.input.enabled = false;

    this.cameras.main.fadeOut(420, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Map'),
    );
  }
}
