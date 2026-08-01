import Phaser from 'phaser';
import { SFX_IDS } from '../audio/sfx';
import { C, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { makeCardArt } from '../ui/cardArt';
import { useDesignSpace } from '../ui/designSpace';
import { makeStatusIcons } from '../ui/statusIcons';
import { bodyStyle, brushStyle } from '../ui/theme';

const ICON_KEYS = ['monster', 'elite', 'event', 'shop', 'rest', 'treasure', 'boss'] as const;
/** Keys match `HeroDef.portraitKey` / `fullKey` minus their prefix. */
const HERO_KEYS = ['guanyu', 'zhaoyun', 'zhugeliang'] as const;
const ENEMY_KEYS = ['yellowturban', 'bandit', 'huaxiong', 'lubu'] as const;
/** Backdrops for the four non-combat rooms — keys match `RoomMeta.plate`. */
const ROOM_KEYS = ['rest', 'shop', 'event', 'treasure'] as const;
/**
 * Cards with a real painting to load. Every card in `CARDS` now has one, but
 * the list stays explicit rather than derived: a key listed here that has no
 * file takes the loader's error path and gets the `?` placeholder, which would
 * then shadow the far better procedural plate `makeCardArt` draws in `create`.
 * A new card therefore lands here only once its art is actually on disk.
 */
const CARD_KEYS = [
  // 关羽 + 通用
  'pikan', 'tiebi', 'tuodao', 'wenjiu', 'wanren',
  'quedi', 'yiyong', 'baima', 'jieying', 'guanzhen',
  'xuzhao', 'dandaofuhui', 'huarongdao', 'bingzhudadan', 'yeduchunqiu',
  'shuiyanqijun', 'zhanyanliang', 'hulaoguan', 'tushanyuesanshi', 'wubaijiaodaoshou',
  'guaguliaodu', 'weizhenhuaxia', 'wuguanliujiang', 'shengougaolei', 'qingnangshu',
  'lujiao', 'lijianji', 'dushi', 'bazhentu',
  // 赵云
  'tuzhen', 'luema', 'longdan', 'tingqiang', 'qitanpanshe',
  'kongyingji', 'sanjinsanchu', 'jiejiang', 'xueranzhengpao', 'yishenshidan',
  'danqijiuzhu', 'lizhanwujiang',
  // 赵云 · 扩池 (todos/17 阶段四)
  'lianhuanqiang', 'jici', 'duojian', 'qianghua', 'chenshi',
  'yinqiang', 'hengsaoqianjun', 'longxiang', 'yanqixigu', 'huwei',
  'changbanpo',
  // 诸葛亮
  'yuanrongnu', 'jushou', 'longzhongdui', 'jinnang', 'jiejianzhiji',
  'jiedongfeng', 'huoji', 'kongchengji', 'qixingdeng', 'muniuliuma',
  'wolongchushan', 'chushibiao', 'qiqinqizong',
  // 诸葛亮 · 扩池 (todos/17 阶段四)
  'youdi', 'shengdongjixi', 'miaosuan', 'fubing', 'jijiangfa',
  'guanxing', 'huoshaobowang', 'jianbingzengzao', 'shenjimiaosuan', 'anjupingwulu',
  'huoshaotengjia',
  // 诅咒与状态牌
  'tannian', 'jiushang', 'yixin', 'shemi', 'fanshi',
  'suming', 'fenying', 'chuangshang', 'xuanyun', 'nining',
  'zui', 'suye',
] as const;

/**
 * 宝物与丹药图标，`RelicDef.art` / `PotionDef.art` 去掉 `relic-` / `potion-`
 * 前缀后的键。与 `CARD_KEYS` 同一条纪律：显式列表而非从表派生——列了却没有
 * 文件的键会走 loader 错误路径拿到 `?` 占位图，反而盖掉 `RelicBar` /
 * `PotionBelt` 里更好的程序绘制兜底，所以图标落盘之后才进这张表。
 */
const RELIC_KEYS = [
  'qinglongdao', 'yajiaoqiang', 'guanjin', 'buyi', 'shufajinguan',
  'dujunlingqi', 'lianu', 'tiemian', 'huxinjing', 'xuanwujia',
  'chuanguoyuxi', 'xingjuntu', 'xiaoshouling', 'lianhuanjia', 'jinchuangyao',
  'xiandengdun', 'xuanjia', 'chitima', 'yaonang', 'qiuxianling',
  'duduan', 'geban', 'jubaopen', 'xingshangfujie', 'yushan',
  'mumaliu', 'huangshishu', 'tengjia', 'gudingdao', 'sunzibingfa',
  'qixingdeng', 'fangtianhuaji', 'hufu', 'tongquetai', 'jiuxi',
  'jiuhulu', 'hanshoutinghouyin', 'qinggangjian', 'liangyinjia', 'kongmingdeng',
  'qimendunjia',
] as const;
const POTION_KEYS = [
  'huoyouguan', 'tiejiasan', 'zhuangxingjiu', 'junqingmibao', 'jiejiasan',
  'mihunsan', 'xumintang', 'hulangzhiyao', 'qingxinsan', 'tiejili',
  'cuidujian', 'jinnang', 'queyuezhen', 'wushisan', 'mengdexinshu',
  'huitiandan',
] as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    useDesignSpace(this);
    this.buildLoadingUi();

    this.load.setPath('assets');
    this.load.image('map-bg', 'map/map-bg.jpg');
    for (const key of HERO_KEYS) {
      this.load.image(`hero-${key}`, `heroes/${key}-full.png`);
      this.load.image(`portrait-${key}`, `heroes/${key}-portrait.png`);
    }
    for (const key of ICON_KEYS) {
      this.load.image(`icon-${key}`, `icons/${key}.png`);
    }
    this.load.image('combat-bg', 'combat/combat-bg.jpg');
    for (const key of ROOM_KEYS) {
      this.load.image(`room-${key}`, `rooms/${key}.jpg`);
    }
    // 拜别 · 出征前夜 — backdrop and the 道人 who offers the blessing.
    this.load.image('blessing-bg', 'rooms/blessing-bg.jpg');
    this.load.image('daoren', 'rooms/daoren.png');
    for (const key of ENEMY_KEYS) {
      this.load.image(`enemy-${key}`, `enemies/${key}.png`);
    }
    for (const key of CARD_KEYS) {
      this.load.image(`card-${key}`, `cards/${key}.jpg`);
    }
    for (const key of RELIC_KEYS) {
      this.load.image(`relic-${key}`, `relics/${key}.png`);
    }
    for (const key of POTION_KEYS) {
      this.load.image(`potion-${key}`, `potions/${key}.png`);
    }
    // 音效 (todos/20 b4)：25 个短音效全量进 boot——加起来远小于一张卡图，
    // 顺带被上面的进度条计入总进度。音乐大件不在此列：由 `Audio.ensureMusic`
    // 延迟到对应场景首次要用时再载（标题曲在 TitleScene.create 起载）。
    // 双格式数组让 Phaser 按浏览器挑：Safari 不解 ogg，只给 ogg 会静默无声。
    for (const id of SFX_IDS) {
      this.load.audio(id, [`audio/sfx/${id}.ogg`, `audio/sfx/${id}.m4a`]);
    }

    // A missing asset should degrade to a visible placeholder, not a black screen.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[boot] asset failed to load: ${file.key} (${file.src})`);
      // 音效载不上没有可看的兜底，也不该占一个纹理 key——`Audio.play`
      // 对 cache 里没有的 id 本来就静默跳过。
      if (file.type !== 'audio') this.makePlaceholder(file.key);
    });
  }

  create(): void {
    this.makeGlowTexture();
    makeStatusIcons(this);
    // After the loader has settled, so a card with a real plate keeps it and
    // only the ones with none — curses, status cards — get a drawn stand-in.
    makeCardArt(this);
    this.scene.start('Title');
  }

  private buildLoadingUi(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    this.add.text(cx, cy - 70, '三國', brushStyle(64, C.paper)).setOrigin(0.5).setLetterSpacing(12);
    this.add
      .text(cx, cy - 18, '烽火尖塔', brushStyle(26, C.gold))
      .setOrigin(0.5)
      .setLetterSpacing(10);

    const barW = 360;
    const barH = 6;
    const barX = cx - barW / 2;
    const barY = cy + 40;

    const track = this.add.graphics();
    track.fillStyle(C.inkSoft, 1);
    track.fillRect(barX, barY, barW, barH);
    track.lineStyle(1, C.gold, 0.35);
    track.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    const fill = this.add.graphics();
    const label = this.add.text(cx, barY + 30, '整军待发…', bodyStyle(15, C.paperFaint)).setOrigin(0.5);

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.clear();
      fill.fillStyle(C.cinnabar, 1);
      fill.fillRect(barX, barY, barW * value, barH);
      fill.fillStyle(C.goldBright, 0.9);
      fill.fillRect(barX + barW * value - 2, barY - 1, 2, barH + 2);
      label.setText(`整军待发…  ${Math.round(value * 100)}%`);
    });
  }

  /** Soft additive halo reused for node highlights and hero backlight. */
  private makeGlowTexture(): void {
    const size = 256;
    if (this.textures.exists('glow')) return;
    const tex = this.textures.createCanvas('glow', size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    grd.addColorStop(0.65, 'rgba(255,255,255,0.14)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  private makePlaceholder(key: string): void {
    if (this.textures.exists(key)) return;
    const size = 128;
    const tex = this.textures.createCanvas(key, size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = '#2b241d';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#c8392b';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, size - 8, size - 8);
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '48px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size / 2, size / 2);
    tex.refresh();
  }
}
