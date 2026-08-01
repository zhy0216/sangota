import { describe, expect, it } from 'vitest';
import { SFX_IDS } from '../src/audio/sfx';

/**
 * 音频接线守护（todo 20 · b4）。`BootScene` / `TitleScene` 载着 Phaser，
 * Node 下 import 不进来，所以照 `tests/integrity.test.ts` 的技法把源码当
 * 文本查——断的都是断了要静默无声、且单元测试够不到的线。
 */

const SOURCES: Record<string, string> = import.meta.glob('../src/scenes/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const read = (name: string): string => SOURCES[`../src/scenes/${name}`];

/** b6 的 UI 音接在按钮工厂里——theme.ts 也载着 Phaser，同样只能当文本查。 */
const UI_SOURCES: Record<string, string> = import.meta.glob('../src/ui/theme.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('BootScene 预载全部音效（b4）', () => {
  const boot = read('BootScene.ts');

  it('逐个遍历 SFX_IDS,双格式且 ogg 在前——漏一个就是运行时静默 404', () => {
    // 循环体逐字钉死:key 用裸 id(Audio.play 按 id 查 cache),路径挂在
    // setPath('assets') 之下。SFX_IDS 是 SfxId 的唯一事实源,类型上多一个
    // id 而这里漏载,在编译期就不可能——这条测试钉的是循环本身还在。
    expect(boot).toContain('for (const id of SFX_IDS)');
    expect(boot).toContain('this.load.audio(id, [`audio/sfx/${id}.ogg`, `audio/sfx/${id}.m4a`])');
    // 清单本身没被腰斩:b1 的 25 个一个不少。
    expect(SFX_IDS).toHaveLength(25);
  });

  it('音乐不进 boot——大件走 ensureMusic 懒加载,首屏不为它买单', () => {
    expect(boot).not.toContain('audio/music');
  });

  it('音效载不上不占纹理位——占位图只给图片', () => {
    expect(boot).toContain("if (file.type !== 'audio') this.makePlaceholder(file.key)");
  });
});

describe('TitleScene 的解锁与标题曲（b4）', () => {
  const title = read('TitleScene.ts');

  it('create 时开始懒加载标题曲并喊播——闸没开就挂账', () => {
    expect(title).toContain("audio.ensureMusic('title', this)");
    expect(title).toContain("audio.music('title')");
  });

  it('挂一次性 pointerdown 拨自动播放闸——once,不是 on', () => {
    expect(title).toContain("this.input.once('pointerdown', () => audio.unlock())");
  });
});

describe('CombatScene 的事件音效接线（b5）', () => {
  const combat = read('CombatScene.ts');

  it('命中音与 hitstop 同帧:play 循环紧贴在 hitStop 调用的上一行,不隔 await', () => {
    // 逐字钉死相邻两行——中间插进一个 await(比如先等 recoil)就是音画脱开。
    expect(combat).toContain(
      'for (const cue of sfxForEvent(ev)) this.audio.play(cue.id, cue.opts);\n    hitStop(this,',
    );
  });

  it('全挡下的分支也发声——那一声甲响不走 hitstop 路径', () => {
    expect(combat).toContain(
      'for (const cue of sfxForEvent(ev)) this.audio.play(cue.id, cue.opts);\n      shieldFlare(this,',
    );
  });

  it('playEvent 顶上有查表钩子,damage/draw 两类各走各的帧', () => {
    expect(combat).toContain("if (ev.t !== 'damage' && ev.t !== 'draw') {");
  });

  it('抽牌音按批内序号 60ms 错峰——不错峰会被 b3 的 40ms 限流吞剩一声', () => {
    expect(combat).toContain('const cue = drawCue(drawn);');
    expect(combat).toContain(
      'this.time.delayedCall(drawn * 60, () => this.audio.play(cue.id, cue.opts));',
    );
  });

  it('打出卡牌按 def.type 发声,气真扣了才响 energy-spend', () => {
    expect(combat).toContain('this.audio.play(cardPlaySfx(def.type));');
    expect(combat).toContain(
      "if (this.state.energy < energyBefore) this.audio.play('energy-spend');",
    );
  });

  it('战罢的进账:资财、宝物、首领三选一各有其声,兵败是 player-death', () => {
    expect(combat).toContain("this.audio.play('gold-gain');");
    expect(combat).toContain("this.audio.play('relic-gain');");
    expect(combat).toContain("if (relicId) this.audio.play('relic-gain');");
    expect(combat).toContain("this.audio.play('player-death');");
  });
});

describe('MapScene 的地图曲与节点音（b6）', () => {
  const map = read('MapScene.ts');

  it('create 时懒加载并喊播地图曲——战斗回来 scene.start 重走这儿,同曲不重启', () => {
    expect(map).toContain("this.audio.ensureMusic('map', this)");
    expect(map).toContain("this.audio.music('map')");
  });

  it('节点落子有 map-select,且在 leaving 闸之后——过不了闸的点击不发声', () => {
    // 逐字钉死顺序:闸先落,声后响。挪到闸前,双击就是两声。
    expect(map).toContain(
      "this.input.enabled = false;\n    // 节点落子音 (todos/20 b6)：在 leaving 闸之后——过不了闸的点击不发声。\n    this.audio.play('map-select');",
    );
  });
});

describe('CombatScene 的战曲与首领 stinger（b6）', () => {
  const combat = read('CombatScene.ts');

  it('首领用 combat-boss,其余(含精英)用 combat——精英战曲属第二批', () => {
    expect(combat).toContain(
      "const track = this.nodeType === 'boss' ? 'combat-boss' : 'combat';",
    );
  });

  it('首领 stinger 在 music 之前响,重音顶铜锣', () => {
    expect(combat).toContain(
      "if (this.nodeType === 'boss') this.audio.play('hit-heavy', { volume: 1.2 });\n    this.audio.ensureMusic(track, this);\n    this.audio.music(track);",
    );
  });
});

describe('inkButton 的 UI 音（b6）', () => {
  const theme = UI_SOURCES['../src/ui/theme.ts'];

  it('hover/click 在按钮工厂一处接线,全游戏按钮自动获益', () => {
    // hover 挂 pointerover(进入才发,非逐帧),click 挂 pointerdown(和 onClick 同拍)。
    expect(theme).toContain("hit.on('pointerover', () => {\n    audio.play('ui-hover');");
    expect(theme).toContain("hit.on('pointerdown', () => {\n    audio.play('ui-click');");
  });
});
