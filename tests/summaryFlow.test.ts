import { describe, expect, it } from 'vitest';

/**
 * 死亡/胜利流程改道 (todos/22 s3) — the wiring that sends every run ending
 * through `SummaryScene`: 兵败、凯旋、奇遇致死. None of these scenes load
 * under Node (they import Phaser), so the routing is checked as source text —
 * the same technique `tests/integrity.test.ts` uses on the victory screen.
 * 事件钳位摘除本身是行为测试，在 `tests/rooms.events.test.ts`.
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => SOURCES[`../${path}`];

describe('every run ending routes through 结算', () => {
  it('registers the scene at all', () => {
    const main = read('src/main.ts');
    expect(main).toContain("from './scenes/SummaryScene'");
    expect(main.indexOf('SummaryScene,')).toBeGreaterThan(main.indexOf('InterludeScene,'));
  });

  it('sends a lost fight to Summary with the killer named', () => {
    const scene = read('src/scenes/CombatScene.ts');
    const body = scene.slice(scene.indexOf('private showDefeat(): void'));
    const defeat = body.slice(0, body.indexOf('\n  }'));
    expect(defeat).toContain("this.scene.start('Summary', { victory: false, killedBy })");
    // 存档先清：在改道的路上关掉标签页，标题页也不能再有「继续」。
    expect(defeat.indexOf('clearSave()')).toBeGreaterThan(-1);
    expect(defeat.indexOf('clearSave()')).toBeLessThan(defeat.indexOf("scene.start('Summary'"));
    // 占位屏已拆：兵败不再自己画结局。
    expect(defeat).not.toContain('兵 败');
  });

  it('remembers who acted last, and forgets it between fights', () => {
    const scene = read('src/scenes/CombatScene.ts');
    // 死因在 drain 点记账——`playEvent` 在 `finished` 后跳过动画，账不能跟着丢。
    const drain = scene.slice(scene.indexOf('private async playEvents'));
    expect(drain.slice(0, drain.indexOf('playEvent(ev)'))).toContain("ev.t === 'enemyMove'");
    // Phaser 复用场景实例，init 是唯一的每场钩子——见 integrity 的
    // 「scene state does not survive」约定。
    const at = scene.indexOf('  init(data:');
    expect(scene.slice(at, scene.indexOf('\n  }', at))).toContain('this.lastEnemyMoveName = null');
  });

  it('sends a finished run from the interlude to Summary, not to a placeholder', () => {
    const scene = read('src/scenes/InterludeScene.ts');
    expect(scene).toContain("this.scene.start('Summary', { victory: true })");
    expect(scene).not.toContain('paintVictory');
    // 清档与改道同一口气，且都在 advanceAct 之前——胜利的跑团不再有下一幕。
    const branch = scene.slice(
      scene.indexOf("actExit(this.run) === 'victory'"),
      scene.indexOf('advanceAct(this.run)'),
    );
    expect(branch).toContain('clearSave()');
    expect(branch).toContain("this.scene.start('Summary'");
  });

  it('routes an event death to Summary as killedBy event', () => {
    const view = read('src/rooms/eventView.ts');
    const pick = view.slice(view.indexOf('private pick(index: number)'));
    // 死在 pending 之前查：死人无牌可择。
    const lethal = pick.slice(pick.indexOf('report.lethal'), pick.indexOf('report.pending'));
    expect(lethal).toContain("this.host.goSummary('event')");

    const room = read('src/scenes/RoomScene.ts');
    const go = room.slice(room.indexOf('private goSummary'));
    expect(go).toContain('clearSave()');
    // 沉睡的地图已经陈旧,和 goCombat 同款处理:丢掉,不留一个醒来还画着
    // 旧一幕的场景。
    expect(go).toContain("this.scene.stop('Map')");
    expect(go).toContain("this.scene.start('Summary', { victory: false, killedBy })");
  });

  it('lets go of the run only on the way out of the summary', () => {
    const scene = read('src/scenes/SummaryScene.ts');
    // create 还在读 run（层数、体力、牌组），endRun 必须押到 leave。
    const create = scene.slice(scene.indexOf('create(): void'), scene.indexOf('private leave'));
    expect(create).not.toContain('endRun()');
    expect(create).toContain('clearSave()');

    const leave = scene.slice(scene.indexOf('private leave'));
    expect(leave).toContain('endRun()');
    expect(leave).toContain("this.scene.start('Title')");
    // 一次性出口，和其他场景出口同款闸。
    expect(leave).toContain('if (this.leaving) return');
  });
});
