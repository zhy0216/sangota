import type Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { bodyStyle, paintInkPanel } from './theme';

/**
 * 场景级 tooltip 管理器（todos/24 · 关键词 tooltip 系统的组件层）。
 *
 * 所有能悬停的地方——状态图标、意图徽章、卡面关键词——都 `register`
 * 进同一个实例：同一时刻只有一块面板，样式一份（`paintInkPanel`，和
 * 地图节点 tooltip 同一块墨板），翻转与贴边一套规则。
 *
 * 悬停延迟走 `scene.time.delayedCall` 而不是墙钟——时钟禁令覆盖全
 * `src/`（tests/integrity.test.ts 连注释一起数，这里不拼出那个名字），
 * 且场景时钟随暂停/加速一起走。
 *
 * Phaser 只以类型进来（`import type`）：运行时全部经构造时传入的 scene
 * 走，于是翻转决策、多段拼装这些纯函数能在 Node 下被 vitest 直接测，
 * `TooltipManager` 本身也能拿假 scene 测（仓库惯例：Phaser 进不了 Node）。
 */

// ------------------------------------------------------------------ 数据结构

/** 面板里的一段：一个状态图标可以同时说「破绽」的规则和当前层数。 */
export interface TipSegment {
  title: string;
  body: string;
  /** 标题与描边色。缺省用 C.gold。 */
  color?: number;
}

export type TipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipTarget {
  /** 触发区域。项目里所有悬停热区都是 Zone——它带 getBounds 又不画东西。 */
  zone: Phaser.GameObjects.Zone;
  /** 内容。函数形式支持动态内容（当前层数、随回合变的意图）。 */
  content: () => TipSegment[];
  /** 相对触发区的位置偏好。缺省 'auto'（先试上方）。 */
  side?: TipSide | 'auto';
}

// -------------------------------------------------------- 纯函数：翻转与拼装

const TIP_GAP = 10;
const TIP_MARGIN = 8;

export interface TipBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const FLIP: Record<TipSide, TipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * 翻转决策：偏好侧装不下就开对侧——右缘敌人的 'right' 面板往左开，
 * 顶着屏幕上沿的意图徽章往下开。两侧都装不下时保持原侧，交给
 * `placeTip` 的贴边 clamp 兜底。
 */
export function resolveTipSide(
  pref: TipSide | 'auto' | undefined,
  target: TipBox,
  panel: { w: number; h: number },
  screen: { w: number; h: number },
): TipSide {
  const want: TipSide = pref === undefined || pref === 'auto' ? 'top' : pref;
  const fits: Record<TipSide, boolean> = {
    top: target.y - TIP_GAP - panel.h >= TIP_MARGIN,
    bottom: target.y + target.h + TIP_GAP + panel.h <= screen.h - TIP_MARGIN,
    left: target.x - TIP_GAP - panel.w >= TIP_MARGIN,
    right: target.x + target.w + TIP_GAP + panel.w <= screen.w - TIP_MARGIN,
  };
  if (fits[want]) return want;
  return fits[FLIP[want]] ? FLIP[want] : want;
}

/**
 * 面板左上角的落点。先 `resolveTipSide` 定侧，再沿另一轴贴边 clamp——
 * 靠右的状态图标面板向左展开，永远不出屏。
 */
export function placeTip(
  pref: TipSide | 'auto' | undefined,
  target: TipBox,
  panel: { w: number; h: number },
  screen: { w: number; h: number },
): { x: number; y: number } {
  const side = resolveTipSide(pref, target, panel, screen);
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  let x: number;
  let y: number;
  switch (side) {
    case 'top':
      x = cx - panel.w / 2;
      y = target.y - TIP_GAP - panel.h;
      break;
    case 'bottom':
      x = cx - panel.w / 2;
      y = target.y + target.h + TIP_GAP;
      break;
    case 'left':
      x = target.x - TIP_GAP - panel.w;
      y = cy - panel.h / 2;
      break;
    case 'right':
      x = target.x + target.w + TIP_GAP;
      y = cy - panel.h / 2;
      break;
  }
  return {
    x: clamp(x, TIP_MARGIN, screen.w - panel.w - TIP_MARGIN),
    y: clamp(y, TIP_MARGIN, screen.h - panel.h - TIP_MARGIN),
  };
}

export interface TipBlock {
  title: string;
  body: string;
  color: number;
}

/**
 * 多段拼装：滤掉空段、补上缺省色，描边取第一段的颜色——面板的「属于谁」
 * 由头一段说了算（状态用状态色，意图用威胁色）。
 */
export function composeTip(segments: readonly TipSegment[]): {
  blocks: TipBlock[];
  border: number;
} {
  const blocks = segments
    .filter((s) => s.title !== '' || s.body !== '')
    .map((s) => ({ title: s.title, body: s.body, color: s.color ?? C.gold }));
  return { blocks, border: blocks[0]?.color ?? C.gold };
}

// ------------------------------------------------------------------ 管理器

/** 悬停多久才出面板。扫过一排图标时不闪一串。 */
const HOVER_DELAY_MS = 150;

const PAD = 12;

/** 场景级 tooltip 管理器：同一时刻只显示一个，自动避开屏幕边缘。 */
export class TooltipManager {
  private readonly root: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  /** 本次显示建的 Text，下次显示前整批销毁——面板只有一块，字是换的。 */
  private items: Phaser.GameObjects.Text[] = [];
  private pending: Phaser.Time.TimerEvent | null = null;
  private pendingZone: Phaser.GameObjects.Zone | null = null;
  private activeZone: Phaser.GameObjects.Zone | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.bg = scene.add.graphics();
    this.root = scene.add.container(0, 0, [this.bg]).setDepth(depth).setVisible(false);
  }

  register(target: TooltipTarget): void {
    const zone = target.zone;
    zone.on('pointerover', () => {
      this.cancelPending();
      this.pendingZone = zone;
      // 150ms 走场景时钟，不碰墙钟——见文件头。
      this.pending = this.scene.time.delayedCall(HOVER_DELAY_MS, () => {
        this.pending = null;
        this.pendingZone = null;
        this.show(target);
      });
    });
    zone.on('pointerout', () => this.release(zone));
    // 热区常随所在的行重建（状态图标、卡面）而销毁，pointerout 不会再来。
    zone.once('destroy', () => this.release(zone));
  }

  /** 立即收起，倒数中的也掐掉。场景层「关掉一切浮层」的那种收法。 */
  hide(): void {
    this.cancelPending();
    this.activeZone = null;
    this.root.setVisible(false);
  }

  destroy(): void {
    this.cancelPending();
    this.items = [];
    this.root.destroy(true);
  }

  /**
   * 只收**这一个**热区名下的东西。比 `hide` 精细：指针从 A 挪到 B 时
   * A 的 pointerout 不能顺手掐掉 B 刚起的倒数。
   */
  private release(zone: Phaser.GameObjects.Zone): void {
    if (this.pendingZone === zone) this.cancelPending();
    if (this.activeZone === zone) {
      this.activeZone = null;
      this.root.setVisible(false);
    }
  }

  private cancelPending(): void {
    this.pending?.remove(false);
    this.pending = null;
    this.pendingZone = null;
  }

  private show(target: TooltipTarget): void {
    const zone = target.zone;
    // 倒数期间热区可能已随所在的行销毁（refreshBars 重建状态图标）。
    if (!zone.active) return;
    const { blocks, border } = composeTip(target.content());
    // 内容方说「现在没什么可说」——意图徽章隐藏时就是这样——面板不出。
    if (blocks.length === 0) return;

    for (const item of this.items) item.destroy();
    this.items = [];

    // 逐段排版：标题一行段色，正文折行灰纸色，段间空一口气。
    let y = PAD - 2;
    let w = 96;
    for (const block of blocks) {
      const title = this.scene.add.text(PAD, y, block.title, bodyStyle(13, block.color));
      y += title.height + 3;
      const body = this.scene.add.text(PAD, y, block.body, {
        ...bodyStyle(13, C.paperDim),
        wordWrap: { width: 240 },
        lineSpacing: 4,
      });
      y += body.height + 9;
      w = Math.max(w, title.width, body.width);
      this.root.add([title, body]);
      this.items.push(title, body);
    }
    const panelW = w + PAD * 2;
    const panelH = y - 9 + PAD - 2;

    paintInkPanel(this.bg, 0, 0, panelW, panelH, { alpha: 0.94, border });

    // getBounds 折算了所有父容器的变换——扇形手牌上被抬起放大的卡也算对。
    const b = zone.getBounds();
    const at = placeTip(
      target.side,
      { x: b.x, y: b.y, w: b.width, h: b.height },
      { w: panelW, h: panelH },
      { w: GAME_WIDTH, h: GAME_HEIGHT },
    );
    this.root.setPosition(at.x, at.y).setVisible(true);
    this.activeZone = zone;
  }
}
