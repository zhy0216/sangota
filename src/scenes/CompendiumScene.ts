import Phaser from 'phaser';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { CARD_TYPE_META, canUpgrade } from '../combat/cards';
import { getEnemy } from '../combat/enemies';
import { RELICS } from '../combat/relics';
import type { CardRarity, CardType, EnemyDef } from '../combat/types';
import { Rng } from '../core/rng';
import { HEROES_IN_ORDER } from '../data/heroes';
import { filterUnlocked, getUnlocks } from '../state/unlocks';
import { CARD_H, CARD_W, CardView, openCardPreview } from '../ui/CardView';
import { sortForDisplay } from '../ui/cardOrder';
import {
  CARD_RARITY_LABEL,
  MOVE_TABLE_HEAD,
  compendiumCardIds,
  defaultCardFilter,
  enemyActSections,
  enemyTraitLines,
  filterCardIds,
  hpRangeText,
  moveRows,
  relicRows,
  type CardFilter,
  type CostBucket,
} from '../ui/compendiumView';
import { toDesign, useDesignSpace } from '../ui/designSpace';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';

/**
 * 典籍 (todos/23 u4) — 牌卷 / 宝卷 / 敌卷 三个 tab 的图鉴场景。标题页的入口
 * 由 u6 接线,这里只认 `scene.start('Compendium')`,Esc / 「返 回」回标题。
 *
 * 排版全在 `src/ui/compendiumView.ts`(纯函数,测试钉住),本场景只管摆:
 * 谁「未获」由 `filterUnlocked` 判,谁「未遇」由 u2 埋的 `seenEnemies` 判,
 * 都在 `create` 里读一次——典籍打开的一瞬就是账面的一瞬,翻页不再碰存储。
 *
 * 牌卷复用 07 的零件而不是 `openCardGrid` 本体:那是一层冻结全场输入的模态,
 * 筛选栏在它底下就点不动了。网格、缩略比例、悬停放大都沿用 `CardGrid` 的
 * 尺码(CELL/THUMB),排序走同一个 `sortForDisplay`。
 */

const LEFT = 64;
/** 内容区的上沿(tab 行之下),三卷共用。 */
const TOP = 168;
const BOTTOM = GAME_HEIGHT - 16;

/** 牌卷网格 — `CardGrid` 的同款格子,整幅画面放得下 8 列。 */
const THUMB = 0.62;
const COLS = 8;
const CELL_W = 124;
const CELL_H = 148;
const GRID_X = Math.round((GAME_WIDTH - COLS * CELL_W) / 2);
const GRID_TOP = 252;

type Tab = 'cards' | 'relics' | 'enemies';

const TAB_LABEL: Record<Tab, string> = { cards: '牌 卷', relics: '宝 卷', enemies: '敌 卷' };

/** 与 `RelicBar` 的 TIER_COLOR 同色——那份是类私有,这里只好再写一遍。 */
const TIER_COLOR: Record<string, number> = {
  starter: C.paper,
  common: C.paperDim,
  uncommon: C.jade,
  rare: C.goldBright,
  boss: C.cinnabarBright,
  shop: C.gold,
};

export class CompendiumScene extends Phaser.Scene {
  /** 同 TitleScene:全部在 `create` 里归位,场景实例跨访问复用。 */
  private tab: Tab = 'cards';
  private filter!: CardFilter;
  private showUpgraded = false;
  private selectedEnemy: string | null = null;
  private leaving = false;

  private tabTexts!: Partial<Record<Tab, Phaser.GameObjects.Text>>;
  private content!: Phaser.GameObjects.Container;
  private preview: Phaser.GameObjects.Container | null = null;
  /** 本 tab 的裁切形——遮罩形不进显示列表,换卷时得亲手销毁。 */
  private masks: Phaser.GameObjects.Graphics[] = [];
  /** 当前 tab 的滚轮去向;没有可滚的就是 null。 */
  private onWheelHook: ((pointer: Phaser.Input.Pointer, dy: number) => void) | null = null;

  /** 三本账,`create` 时各读一次,见文件头。 */
  private unlockedCards!: Set<string>;
  private unlockedRelics!: Set<string>;
  private seenEnemies!: Set<string>;

  constructor() {
    super('Compendium');
  }

  create(): void {
    useDesignSpace(this);
    this.tab = 'cards';
    this.filter = defaultCardFilter();
    this.showUpgraded = false;
    this.selectedEnemy = null;
    this.leaving = false;
    this.preview = null;
    this.tabTexts = {};
    this.masks = [];

    this.unlockedCards = new Set(filterUnlocked('card', compendiumCardIds()));
    this.unlockedRelics = new Set(filterUnlocked('relic', Object.keys(RELICS)));
    this.seenEnemies = new Set(getUnlocks().seenEnemies);

    // --- 底色与题眉,与标题页同一套水墨 -----------------------------------
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'map-bg');
    bg.setScale(Math.max((GAME_WIDTH * 1.1) / bg.width, (GAME_HEIGHT * 1.1) / bg.height));
    bg.setAlpha(0.55);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.72);

    this.add.text(LEFT, 28, '典 籍', brushStyle(54, C.paper)).setLetterSpacing(10);
    this.add
      .text(LEFT + 210, 62, '博览群书，方知天下英雄。', bodyStyle(14, C.paperFaint))
      .setLetterSpacing(3);

    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.5);
    rule.lineBetween(LEFT, 100, GAME_WIDTH - LEFT, 100);
    rule.fillStyle(C.cinnabar, 0.9);
    rule.fillCircle(LEFT, 100, 3);

    inkButton(this, GAME_WIDTH - 132, 56, '返 回', {
      width: 136,
      height: 48,
      fontSize: 20,
      onClick: () => this.leave(),
    });

    // --- Tabs --------------------------------------------------------------
    (['cards', 'relics', 'enemies'] as const).forEach((tab, i) => {
      const text = this.add
        .text(LEFT + i * 150, 114, TAB_LABEL[tab], brushStyle(30, C.paperDim))
        .setLetterSpacing(4)
        .setInteractive({ useHandCursor: true });
      text.on('pointerover', () => {
        if (this.tab !== tab) text.setColor(css(C.goldBright));
      });
      text.on('pointerout', () => this.paintTabs());
      text.on('pointerup', () => this.showTab(tab));
      this.tabTexts[tab] = text;
    });

    this.content = this.add.container(0, 0);

    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.onWheelHook?.(p, dy);
    });

    this.showTab('cards');
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(320, 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Title');
    });
  }

  private paintTabs(): void {
    for (const [tab, text] of Object.entries(this.tabTexts) as [Tab, Phaser.GameObjects.Text][]) {
      text.setColor(css(tab === this.tab ? C.gold : C.paperDim));
    }
  }

  private showTab(tab: Tab): void {
    if (this.leaving) return;
    this.tab = tab;
    this.paintTabs();
    this.hidePreview();
    this.onWheelHook = null;
    this.content.removeAll(true);
    for (const mask of this.masks) mask.destroy();
    this.masks = [];

    if (tab === 'cards') this.buildCards();
    else if (tab === 'relics') this.buildRelics();
    else this.buildEnemies();
  }

  // ------------------------------------------------------------------ 牌卷

  /**
   * 筛选栏的一组选项:一枚题字加一排可点的字。点中重画整卷——筛选是低频
   * 操作,整卷重建比让每个字自己找网格便宜得多也稳得多。
   */
  private filterGroup(
    x: number,
    y: number,
    label: string,
    options: readonly { key: string; label: string }[],
    active: string,
    onPick: (key: string) => void,
  ): number {
    this.content.add(this.add.text(x, y, label, bodyStyle(13, C.paperFaint)));
    let at = x + label.length * 13 + 12;
    for (const opt of options) {
      const picked = opt.key === active;
      const text = this.add
        .text(at, y, opt.label, bodyStyle(13, picked ? C.goldBright : C.paperDim))
        .setInteractive({ useHandCursor: true });
      if (picked) text.setBackgroundColor(css(C.inkSoft));
      text.on('pointerover', () => text.setColor(css(C.goldBright)));
      text.on('pointerout', () => text.setColor(css(picked ? C.goldBright : C.paperDim)));
      text.on('pointerup', () => {
        onPick(opt.key);
        this.showTab('cards');
      });
      this.content.add(text);
      at += text.width + 14;
    }
    return at;
  }

  private buildCards(): void {
    const all = compendiumCardIds();

    // --- 筛选栏 (u4:武将/类型/费用/稀有度 + 显示升级态) --------------------
    const heroOptions = [
      { key: 'all', label: '全部' },
      ...HEROES_IN_ORDER.map((h) => ({ key: h.id, label: h.name })),
      { key: 'colorless', label: '无色' },
      { key: 'negative', label: '咒·厄' },
    ];
    this.filterGroup(LEFT, TOP, '武将', heroOptions, this.filter.hero, (key) => {
      this.filter.hero = key;
    });

    const typeOptions = [
      { key: 'all', label: '全部' },
      ...(Object.keys(CARD_TYPE_META) as CardType[]).map((t) => ({
        key: t as string,
        label: CARD_TYPE_META[t].label,
      })),
    ];
    this.filterGroup(560, TOP, '类型', typeOptions, this.filter.type, (key) => {
      this.filter.type = key as CardFilter['type'];
    });

    const costOptions = [
      { key: 'all', label: '全部' },
      ...(['0', '1', '2', '3+', 'X'] as CostBucket[]).map((c) => ({ key: c as string, label: c })),
    ];
    this.filterGroup(LEFT, TOP + 30, '费用', costOptions, this.filter.cost, (key) => {
      this.filter.cost = key as CardFilter['cost'];
    });

    const rarityOptions = [
      { key: 'all', label: '全部' },
      ...(Object.keys(CARD_RARITY_LABEL) as CardRarity[]).map((r) => ({
        key: r as string,
        label: CARD_RARITY_LABEL[r],
      })),
    ];
    this.filterGroup(560, TOP + 30, '稀有', rarityOptions, this.filter.rarity, (key) => {
      this.filter.rarity = key as CardFilter['rarity'];
    });

    // 「显示升级态」开关:只换脸不换格,见 compendiumView 的筛选注释。
    const toggle = this.add
      .text(
        1010,
        TOP + 30,
        `显示升级态：${this.showUpgraded ? '开' : '关'}`,
        bodyStyle(13, this.showUpgraded ? C.goldBright : C.paperDim),
      )
      .setInteractive({ useHandCursor: true });
    toggle.on('pointerup', () => {
      this.showUpgraded = !this.showUpgraded;
      this.showTab('cards');
    });
    this.content.add(toggle);

    this.content.add(
      this.add
        .text(GAME_WIDTH - LEFT, TOP, `已录 ${this.unlockedCards.size} / ${all.length}`, bodyStyle(13, C.gold))
        .setOrigin(1, 0),
    );

    // --- 网格,`CardGrid` 的同款格子与滚动 ----------------------------------
    const ids = filterCardIds(all, this.filter);
    const entries = sortForDisplay(ids.map((id) => ({ uid: id, defId: id, upgraded: 0 })));

    const viewH = BOTTOM - GRID_TOP;
    const rows = Math.ceil(entries.length / COLS);
    const contentH = rows * CELL_H + 16;
    const maxScroll = Math.max(0, contentH - viewH);

    const grid = this.add.container(0, GRID_TOP);
    this.content.add(grid);
    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(0, GRID_TOP - 4, GAME_WIDTH, viewH + 8);
    grid.setMask(maskShape.createGeometryMask());
    this.masks.push(maskShape);

    if (entries.length === 0) {
      this.content.add(
        this.add
          .text(GAME_WIDTH / 2, GRID_TOP + 120, '查无此牌', bodyStyle(16, C.paperFaint))
          .setOrigin(0.5)
          .setLetterSpacing(4),
      );
    }

    const zones: { zone: Phaser.GameObjects.Zone; y: number }[] = [];
    entries.forEach((entry, i) => {
      const x = GRID_X + CELL_W / 2 + (i % COLS) * CELL_W;
      const y = 12 + CELL_H / 2 + Math.floor(i / COLS) * CELL_H;

      if (!this.unlockedCards.has(entry.defId)) {
        grid.add(this.cardSilhouette(x, y));
        return;
      }

      const face = this.showUpgraded && canUpgrade(entry.defId, 0) ? 1 : 0;
      const view = new CardView(this, entry.uid, entry.defId, face, undefined, 'display');
      view.setPosition(x, y);
      view.setScale(THUMB);
      grid.add(view);
      zones.push({ zone: view.hitZone, y });

      view.hitZone.on('pointerover', () => this.showCardPreview(entry.defId, face, x, grid.y + y));
      view.hitZone.on('pointerout', () => this.hidePreview());
    });

    let scroll = 0;
    const sync = (): void => {
      grid.y = GRID_TOP - scroll;
      for (const { zone, y } of zones) {
        const input = zone.input;
        if (input) input.enabled = grid.y + y >= GRID_TOP && grid.y + y <= GRID_TOP + viewH;
      }
    };
    sync();
    this.onWheelHook = (_p, dy) => {
      if (maxScroll <= 0) return;
      scroll = Phaser.Math.Clamp(scroll + dy * 0.6, 0, maxScroll);
      this.hidePreview();
      sync();
    };
  }

  /** 未解锁的一格:剪影 + 「未获」(u4)。名字、造价一个字不漏。 */
  private cardSilhouette(x: number, y: number): Phaser.GameObjects.Container {
    const holder = this.add.container(x, y);
    const w = CARD_W * THUMB;
    const h = CARD_H * THUMB;
    const g = this.add.graphics();
    g.fillStyle(C.ink, 0.9);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    g.lineStyle(1, C.paperFaint, 0.35);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    holder.add(g);
    holder.add(
      this.add.text(0, -12, '？', brushStyle(40, C.paperFaint)).setOrigin(0.5).setAlpha(0.7),
    );
    holder.add(
      this.add.text(0, 32, '未 获', bodyStyle(13, C.paperFaint)).setOrigin(0.5).setLetterSpacing(2),
    );
    return holder;
  }

  /** 悬停放大——`openCardPreview` 的共享装配：全尺寸牌面带词条面板 (k7)。 */
  private showCardPreview(defId: string, face: number, x: number, y: number): void {
    this.hidePreview();
    this.preview = openCardPreview(this, { defId, upgraded: face, x, y, depth: 40 });
  }

  private hidePreview(): void {
    this.preview?.destroy(true);
    this.preview = null;
  }

  // ------------------------------------------------------------------ 宝卷

  private buildRelics(): void {
    const rows = relicRows();
    this.content.add(
      this.add
        .text(GAME_WIDTH - LEFT, TOP, `已录 ${this.unlockedRelics.size} / ${rows.length}`, bodyStyle(13, C.gold))
        .setOrigin(1, 0),
    );

    const top = TOP + 34;
    const viewH = BOTTOM - top;
    const rowH = 96;
    const colX = [LEFT, GAME_WIDTH / 2 + 16];
    const colW = GAME_WIDTH / 2 - LEFT - 32;
    const contentH = Math.ceil(rows.length / 2) * rowH + 8;
    const maxScroll = Math.max(0, contentH - viewH);

    const list = this.add.container(0, top);
    this.content.add(list);
    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(0, top - 4, GAME_WIDTH, viewH + 8);
    list.setMask(maskShape.createGeometryMask());
    this.masks.push(maskShape);

    rows.forEach((row, i) => {
      const x = colX[i % 2];
      const y = Math.floor(i / 2) * rowH;
      const owned = this.unlockedRelics.has(row.id);
      const tier = TIER_COLOR[row.tier] ?? C.paper;

      list.add(inkPanel(this, x, y, colW, rowH - 10, { alpha: 0.82, border: owned ? tier : C.paperFaint }));

      // 图标:有真图用真图,没有就画 RelicBar 同款的印记;未获只给一团墨。
      const icon = this.add.container(x + 46, y + (rowH - 10) / 2);
      if (!owned) {
        const g = this.add.graphics();
        g.fillStyle(C.inkDeep, 0.95);
        g.fillCircle(0, 0, 22);
        g.lineStyle(1.5, C.paperFaint, 0.4);
        g.strokeCircle(0, 0, 22);
        icon.add(g);
        icon.add(this.add.text(0, 0, '？', brushStyle(24, C.paperFaint)).setOrigin(0.5));
      } else if (this.textures.exists(RELICS[row.id]?.art ?? '')) {
        const art = this.add.image(0, 0, RELICS[row.id].art);
        art.setScale(40 / Math.max(art.width, art.height));
        icon.add(art);
      } else {
        icon.add(this.relicEmblem(row.id, 22, tier));
      }
      list.add(icon);

      list.add(
        this.add
          .text(x + 84, y + 14, owned ? row.name : '？？？', brushStyle(21, owned ? C.paper : C.paperFaint))
          .setLetterSpacing(2),
      );
      list.add(
        this.add
          .text(x + colW - 18, y + 18, row.tierLabel, bodyStyle(12, owned ? tier : C.paperFaint))
          .setOrigin(1, 0)
          .setLetterSpacing(2),
      );
      list.add(
        this.add.text(x + 84, y + 46, owned ? row.text : '未获此宝，其形其用皆不可考。', {
          ...bodyStyle(12, owned ? C.paperDim : C.paperFaint),
          wordWrap: { width: colW - 104 },
          lineSpacing: 3,
        }),
      );
    });

    let scroll = 0;
    this.onWheelHook = (_p, dy) => {
      if (maxScroll <= 0) return;
      scroll = Phaser.Math.Clamp(scroll + dy * 0.6, 0, maxScroll);
      list.y = top - scroll;
    };
  }

  /** `RelicBar.emblem` 的同款印记——同一颗种子,同一件宝物两处一个模样。 */
  private relicEmblem(id: string, r: number, tier: number): Phaser.GameObjects.Graphics {
    const rng = new Rng(`relic:${id}`);
    const g = this.add.graphics();
    g.fillStyle(C.inkDeep, 0.95);
    g.fillCircle(0, 0, r);
    g.fillStyle(tier, 0.12);
    g.fillCircle(0, 0, r);
    const spokes = 3 + rng.int(4);
    const phase = rng.next() * Math.PI * 2;
    for (let i = 0; i < spokes; i++) {
      const a = phase + (i / spokes) * Math.PI * 2;
      const inner = r * (0.2 + rng.next() * 0.2);
      const outer = r * (0.62 + rng.next() * 0.2);
      g.lineStyle(r * 0.16, tier, 0.85);
      g.lineBetween(Math.cos(a) * inner, Math.sin(a) * inner, Math.cos(a) * outer, Math.sin(a) * outer);
    }
    if (spokes % 2 === 0) {
      g.fillStyle(C.paper, 0.9);
      g.fillCircle(0, 0, r * 0.2);
    } else {
      g.lineStyle(r * 0.13, C.paper, 0.85);
      g.strokeCircle(0, 0, r * 0.26);
    }
    return g;
  }

  // ------------------------------------------------------------------ 敌卷

  private buildEnemies(): void {
    const sections = enemyActSections();

    // 默认翻到第一个遭遇过的敌人;一个都没见过就让右页自己说话。
    if (!this.selectedEnemy || !this.seenEnemies.has(this.selectedEnemy)) {
      this.selectedEnemy =
        sections.flatMap((s) => s.enemyIds).find((id) => this.seenEnemies.has(id)) ?? null;
    }

    // --- 左栏:按幕列敌 ------------------------------------------------------
    const LIST_W = 264;
    const viewH = BOTTOM - TOP;
    this.content.add(inkPanel(this, LEFT - 16, TOP - 8, LIST_W + 32, viewH + 8, { alpha: 0.6 }));

    const list = this.add.container(0, TOP);
    this.content.add(list);
    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(LEFT - 16, TOP - 4, LIST_W + 32, viewH - 4);
    list.setMask(maskShape.createGeometryMask());
    this.masks.push(maskShape);

    let at = 8;
    const rowZones: { zone: Phaser.GameObjects.Zone; y: number }[] = [];
    for (const section of sections) {
      list.add(
        this.add.text(LEFT, at, `— ${section.act} —`, bodyStyle(13, C.gold)).setLetterSpacing(3),
      );
      at += 28;
      for (const id of section.enemyIds) {
        const seen = this.seenEnemies.has(id);
        const picked = id === this.selectedEnemy;
        const name = seen ? getEnemy(id).name : '？？？';
        const text = this.add
          .text(LEFT + 14, at, name, bodyStyle(15, picked ? C.goldBright : seen ? C.paper : C.paperFaint))
          .setLetterSpacing(2);
        if (picked) {
          const mark = this.add.graphics();
          mark.fillStyle(C.cinnabar, 0.9);
          mark.fillCircle(LEFT + 4, at + 10, 3);
          list.add(mark);
        }
        list.add(text);
        if (seen && !picked) {
          const zone = this.add
            .zone(LEFT + LIST_W / 2, at + 11, LIST_W, 24)
            .setInteractive({ useHandCursor: true });
          zone.on('pointerover', () => text.setColor(css(C.goldBright)));
          zone.on('pointerout', () => text.setColor(css(C.paper)));
          zone.on('pointerup', () => {
            this.selectedEnemy = id;
            this.showTab('enemies');
          });
          list.add(zone);
          rowZones.push({ zone, y: at });
        }
        at += 26;
      }
      at += 10;
    }

    const maxScroll = Math.max(0, at - viewH + 8);
    let scroll = 0;
    const sync = (): void => {
      list.y = TOP - scroll;
      for (const { zone, y } of rowZones) {
        const input = zone.input;
        if (input) input.enabled = list.y + y >= TOP && list.y + y <= TOP + viewH - 24;
      }
    };
    sync();
    this.onWheelHook = (p, dy) => {
      // 滚轮只归左栏——右页的招式表全放得下,不与名录抢滚动。
      if (toDesign(p.x) > LEFT + LIST_W + 24) return;
      if (maxScroll <= 0) return;
      scroll = Phaser.Math.Clamp(scroll + dy * 0.6, 0, maxScroll);
      sync();
    };

    // --- 右页:立绘 + 体力区间 + 完整招式表 ---------------------------------
    if (this.selectedEnemy) this.buildEnemyDetail(getEnemy(this.selectedEnemy));
    else {
      this.content.add(
        this.add
          .text((LEFT + LIST_W + GAME_WIDTH) / 2, 380, '未曾遭遇一敌，出征归来再翻此卷。', bodyStyle(16, C.paperFaint))
          .setOrigin(0.5)
          .setLetterSpacing(3),
      );
    }
  }

  private buildEnemyDetail(def: EnemyDef): void {
    const DX = LEFT + 264 + 60; // 正文左沿
    const PX = DX + 70; // 立绘中线

    // 立绘:沿用战斗里同一张图,压到 260 高以内,踩在题字的地平线上。
    if (this.textures.exists(def.art)) {
      const img = this.add.image(PX, 452, def.art).setOrigin(0.5, 1);
      img.setScale(Math.min(260, def.height) / img.height);
      this.content.add(img);
    }

    const infoX = PX + 120;
    this.content.add(
      this.add.text(infoX, TOP + 24, def.name, brushStyle(40, C.paper)).setLetterSpacing(6),
    );
    this.content.add(
      this.add
        .text(infoX, TOP + 84, `体力 ${hpRangeText(def)}`, bodyStyle(17, C.cinnabarBright))
        .setLetterSpacing(2),
    );
    enemyTraitLines(def).forEach((line, i) => {
      this.content.add(this.add.text(infoX, TOP + 118 + i * 24, line, bodyStyle(13, C.paperDim)));
    });

    // --- 招式表:六列,数据与 `enemies.ts` 一字不差(compendiumView 拼好) ----
    const tableTop = 486;
    /** 六列的横位与宽,与 `MOVE_TABLE_HEAD` 一一对应。 */
    const colX = [DX, DX + 156, DX + 244, DX + 344, DX + 424, DX + 756];
    const wrapW = colX[5] - colX[4] - 20;

    MOVE_TABLE_HEAD.forEach((head, i) => {
      this.content.add(this.add.text(colX[i], tableTop, head, bodyStyle(13, C.gold)).setLetterSpacing(2));
    });
    const rule = this.add.graphics();
    rule.lineStyle(1, C.gold, 0.35);
    rule.lineBetween(DX, tableTop + 24, GAME_WIDTH - LEFT, tableTop + 24);
    this.content.add(rule);

    let y = tableTop + 34;
    for (const row of moveRows(def)) {
      const cells = [row.name, row.intent, row.damage, row.block, row.status, row.weight];
      let rowH = 26;
      cells.forEach((cell, i) => {
        const text = this.add.text(colX[i], y, cell, {
          ...bodyStyle(13, i === 0 ? C.paper : C.paperDim),
          ...(i === 4 ? { wordWrap: { width: wrapW }, lineSpacing: 2 } : {}),
        });
        this.content.add(text);
        rowH = Math.max(rowH, text.height + 8);
      });
      y += rowH;
    }
  }
}
