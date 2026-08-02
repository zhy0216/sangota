import Phaser from 'phaser';
import { cardPlaySfx, drawCue, sfxForEvent } from '../audio/combatSfx';
import { getAudio, type Audio } from '../audio/sfx';
import { C, GAME_HEIGHT, GAME_WIDTH, css } from '../config';
import { STATUS_META, STATUS_ORDER } from '../combat/cards';
import { resolveCombatEndHooks } from '../combat/curses';
import { incomingIsLethal, intentOf, totalIncomingDamage } from '../combat/intent';
import {
  canPlay,
  endPlayerTurn,
  playCard,
  previewValues,
  resolveChoice,
  runEnemyTurn,
  startCombat,
  usePotion,
} from '../combat/engine';
import { getPotion, type PotionDef } from '../combat/potions';
import { getRelic, relicByBanner, relicModifiers, relicText } from '../combat/relics';
import {
  bossOfferPending,
  claimSpoils,
  claimVictoryRelic,
  declinePotionDrop,
  ensureBossOffer,
  ensureEncounter,
  payTheft,
  takeBossRelic,
  takeCardReward,
  takePotionDrop,
  type VictoryRelic,
} from '../rooms/fight';
import { streamSeed } from '../rooms/rng';
import type {
  CombatEvent,
  CombatState,
  EnemyState,
  Encounter,
  IntentMark,
  StatusId,
} from '../combat/types';
import {
  applyCombatResult,
  getRun,
  recordCombatEvents,
  recordFightSettled,
  removePotion,
  type RunState,
} from '../state/run';
import {
  clearSave,
  combatIsQuiescent,
  restoreCombat,
  snapshotCombat,
  writeSave,
  type SavedCombat,
} from '../state/save';
import { getSettings, type KeyAction } from '../state/settings';
import { recordSeenEnemies } from '../state/unlocks';
import { isCardGridOpen, openCardGrid, type CardGridEntry } from '../ui/CardGrid';
import { CARD_H, CARD_W, CardView, cardTipPanel, placeCardTipPanel, type CardTipPanel } from '../ui/CardView';
import { cardIndexOf, combatKeyEvents, potionIndexOf, soleLivingEnemy } from '../ui/combatKeys';
import { PLAY_LINE_Y, dropVerdict, hitIndex, pastPlayLine } from '../ui/dragPlay';
import { HAND_Y, fanLayout, rowLayout } from '../ui/handLayout';
import { hpPreviewSeg, type HpPreviewSeg } from '../ui/hpPreview';
import type { ActorView, EnemyView, EnemyViewParts } from '../ui/actorView';
import { EnemyRoster } from '../ui/EnemyRoster';
import { stageChange, type StageChange } from '../ui/enemyStage';
import { drawGlyph, intentBadge, intentKey, markColor, markGlyph } from '../ui/intentIcons';
import { PotionBelt } from '../ui/PotionBelt';
import { RelicBar } from '../ui/RelicBar';
import { openSettings } from '../ui/SettingsPanel';
import {
  AUTO_END_DELAY_MS,
  needsEndTurnConfirm,
  needsPlayConfirm,
  shouldAutoEndTurn,
} from '../ui/confirm';
import { contentWidthAt, groundSprite } from '../ui/spriteBounds';
import { toDesign, useDesignSpace } from '../ui/designSpace';
import { TooltipManager, type TipSegment } from '../ui/Tooltip';
import { bodyStyle, brushStyle, inkButton, inkPanel } from '../ui/theme';
import { dur } from '../ui/timing';
import { groupCombatEvents, groupTotal, type DamageEv } from '../ui/eventGroups';
import {
  burst,
  dust,
  healMotes,
  hitStop,
  inkSplash,
  pop,
  popText,
  riseFlare,
  screenPulse,
  screenShake,
  shieldFlare,
  slash,
  turnBanner,
} from '../ui/vfx';
import { returnToMap } from './nav';

type CombatNodeType = 'monster' | 'elite' | 'boss';

/**
 * What `scene.start('Combat', …)` may hand over.
 *
 * A named type rather than an inline object literal on `init` for a mechanical
 * reason: `tests/integrity.test.ts` and `tests/rooms.events.test.ts` both read
 * this scene's `init` body as *source text*, slicing from `init(data:` to the
 * first `\n  }`. A multi-line parameter type puts a `  }` inside the signature
 * and truncates the slice to nothing, and all four guards pass vacuously.
 */
interface CombatSceneData {
  nodeType?: CombatNodeType;
  bonusRelic?: string;
  nodeId?: string;
  /** 存档 (todos/08): resume this fight rather than opening a new one. */
  resume?: SavedCombat;
}

const BASELINE_Y = 420;
const PLAYER_X = 244;

/** 悬停放大 (todos/24 k3)：~1.35 即全尺寸——13px 的规则文本放大到可读。 */
const HAND_HOVER_SCALE = 1.35;
/**
 * 拖拽中指向牌的卡位下限 (k3)：卡不跟着指针进敌阵挡住目标，停在这条线，
 * 剩下的路交给瞄准箭头——和原版「卡停在下半屏、箭头去点人」同一个手感。
 */
const DRAG_HOLD_Y = 520;

const DEPTH = {
  bg: 0,
  actors: 10,
  actorUi: 20,
  hand: 60,
  dragArrow: 70,
  hud: 80,
  float: 120,
  overlay: 200,
} as const;

/**
 * The left gutter is the only column with nothing in it: the hand spreads from
 * x≈260 and the hero plate starts at x≈170, so the belt stacks downward here
 * rather than across the bottom edge where it would sit under the cards.
 */
const POTION_BELT = { x: 40, y: 190 };

/**
 * Intent badge geometry. The headline pill is a fixed height so a line of three
 * enemies reads as a row; the riders hang off its bottom-right corner in a
 * shorter pill, one size down, because they qualify the headline rather than
 * competing with it.
 */
const INTENT_H = 40;
const INTENT_ICON = 24;
const INTENT_MARK_H = 22;
const INTENT_MARK_ICON = 14;

const DRAW_PILE = { x: 62, y: 682 };
const DISCARD_PILE = { x: GAME_WIDTH - 62, y: 682 };
const EXHAUST_PILE = { x: GAME_WIDTH - 176, y: 682 };

/** A corner pile: an ink card-stack glyph, a count, and a grid behind it. */
interface PileCounter {
  container: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  value: number;
}

export class CombatScene extends Phaser.Scene {
  private run!: RunState;
  private state!: CombatState;
  /** 音效出口 (todos/20 b5)。全局单例，`create` 里经 `getAudio` 取。 */
  private audio!: Audio;
  private encounter!: Encounter;
  private nodeType: CombatNodeType = 'monster';
  /**
   * A relic an 奇遇 promised for surviving the fight it started (`EventOutcome.
   * fight.bonusRelic`). Handed over on the victory screen, so declining the
   * card reward still pays it and losing the fight does not.
   */
  private bonusRelic: string | null = null;
  /**
   * The ledger this fight is being fought on, and the key every stream and
   * every one-shot payout is addressed by. Usually the map node the player is
   * standing on; `'start'` only when a fight is opened before the player has
   * committed to a node, which the map cannot do.
   */
  private nodeId = 'start';
  /**
   * An explicit ledger id handed in by the caller, overriding
   * `run.currentNodeId`. Only 奇遇-started fights use it: the node the player
   * stands on already holds an `event` record, and asking it for a `combat` one
   * throws — which it did, inside `create()`, with the map already stopped.
   */
  private ledgerId: string | null = null;
  /**
   * 存档 (todos/08): the fight this scene is being restored into, or null for a
   * fight being opened for the first time.
   *
   * Consumed by `create` and never read again — it is a *constructor argument*
   * with nowhere else to live, since `init` is the only per-visit hook Phaser
   * gives and the state it builds is not wanted until `create`.
   */
  private resumeFrom: SavedCombat | null = null;

  private cardViews = new Map<string, CardView>();
  /**
   * Every enemy on screen. A collection rather than a fixed row: 召唤 and 分裂
   * add bodies mid-fight and 遁走 takes one away, and none of that can be drawn
   * by a view built once in `create()`. Rebuilt per fight in `create`, not in
   * `init` — the previous fight's Game Objects are already destroyed by then.
   */
  private roster!: EnemyRoster;
  private playerView!: ActorView;

  private selectedUid: string | null = null;
  /** A 丹药 waiting for an enemy click, by belt slot. Mutually exclusive with a card. */
  private selectedPotion: number | null = null;
  /**
   * 拖拽出牌 (todos/24 k3)：正被拖着的手牌 uid，非空即拖拽态。与点击出牌
   * 并存——dragDistanceThreshold 之内是点击，之外才起拖。
   */
  private dragUid: string | null = null;
  /**
   * 拖拽收尾的点击压制 (k3)：Phaser 的 dragend **先于** pointerup 派发
   * (InputPlugin 先收 drag 后收 up)，所以 onCardDragEnd 清掉 dragUid 之后
   * 同一记抬手还会作为 pointerup 打到牌上——不压住它，回弹取消的牌会被
   * 这记尾随的「点击」原路打出去，防误触就形同虚设。一次性消费，
   * 兜底延时清掉（抬手落在牌外时 pointerup 不来）。
   */
  private clickSuppressedUid: string | null = null;
  /** 拖拽的原位占位影子：半透明牌框留在手位，松手回弹有处可归。 */
  private dragGhost: Phaser.GameObjects.Graphics | null = null;
  /**
   * Tab 展开手牌 (todos/24 k6)：按住 Tab 为 true，layoutHand 换成一排
   * 端平的展开槽位；松开恢复扇形。keydown/keyup 在 create 里配对接线。
   */
  private handExpanded = false;
  /**
   * HP 条伤害预览 (todos/24 k5)：选敌/拖拽中悬停的目标，及其条上要标红的
   * 段。非空即在预览；`paintBar` 按 enemyId 认领各自的段。
   */
  private hpPreview: { enemyId: string; seg: HpPreviewSeg } | null = null;
  /** 预览的去重键：拖拽每帧都问一遍，同目标同段不重画、闪烁不重启。 */
  private hpPreviewKey = '';
  /** 「必杀」小签，非空即挂在目标 HP 条旁——随预览一起收。 */
  private killTag: Phaser.GameObjects.Container | null = null;
  private busy = false;
  private finished = false;
  /**
   * Set the instant a reward is claimed. `leaveToMap` only starts a 300 ms
   * camera fade, and the victory overlay stays live and interactive for every
   * one of those frames — without this the player can click a second card, or a
   * card and then 「不取」, and bank both payouts.
   *
   * Reset in `init`, not here: Phaser keeps one instance per scene key for the
   * lifetime of the game and calls `init`/`create` again on every `start`, so a
   * class-field initialiser runs exactly once — on the *first* fight.
   */
  private claimed = false;

  /**
   * How many 夺财 events this fight has already paid out. The index is the
   * idempotency key `payTheft` is addressed by — the same seed replays the same
   * thefts in the same order, so 「the second theft of this fight」 identifies
   * one theft for good.
   *
   * Reset in `init` and **not** as a class-field initialiser: Phaser keeps one
   * instance per scene key, so a field initialiser runs once, on the first
   * fight. `claimed` has already been that bug once.
   */
  private theftSeq = 0;

  /**
   * 本场玩家已掉的血 (todos/22)——「全甲」/「秋毫无犯」的判定基线，由
   * `playEvents` 在 drain 事件时累加。跟 `theftSeq` 一样在 `init` 重置、
   * 随存档往返：不存的话，先挨一刀、读档再打完就成了「无伤」。
   */
  private fightDamageTaken = 0;

  /**
   * 统一 tooltip 管理器 (todos/24 k2)：状态图标、意图徽章、卡面关键词全部
   * `register` 进这一个。每次 `create` 新建——它名下的 Game Object 随
   * `shutdown` 一起销毁，不像旧的三件套句柄那样能把上一场的尸体带进下一场。
   */
  private tips!: TooltipManager;

  /** 「← 12」 beside the player's block badge: what the field will land next turn. */
  private incomingText!: Phaser.GameObjects.Text;
  /** The 「+?」 tail, in its own colour — see `buildPlayer`. */
  private incomingHidden!: Phaser.GameObjects.Text;

  private energyText!: Phaser.GameObjects.Text;
  private energyMaxText!: Phaser.GameObjects.Text;
  private relicBar!: RelicBar;
  private potionBelt!: PotionBelt;
  private turnText!: Phaser.GameObjects.Text;
  private drawPile!: PileCounter;
  private discardPile!: PileCounter;
  private exhaustPile!: PileCounter;
  private deckCount!: Phaser.GameObjects.Text;
  private endTurnBtn!: Phaser.GameObjects.Container;
  /**
   * 结束回合的确认气泡 (todos/21 t3)，非空即在屏上。轻量非模态：场上一切
   * 照常可点，「点别处取消」由 create 里的 pointerdown / keydown-ESC 接。
   */
  private endTurnConfirm: Phaser.GameObjects.Container | null = null;
  /**
   * 自动结束回合的定时器 (todos/21 t3)，非空即在倒数。玩家的任何操作——
   * 点卡、点敌人、用丹药、自己按 E——都先 `cancelAutoEnd` 把它掐掉。
   */
  private autoEndTimer: Phaser.Time.TimerEvent | null = null;
  private arrow!: Phaser.GameObjects.Graphics;
  private energyOrb!: Phaser.GameObjects.Container;
  private lastEnergy = 0;
  /** 连击 badge — built only for a hero whose pool reads `attacksThisTurn` (赵云). */
  private comboBadge: Phaser.GameObjects.Container | null = null;
  private comboText: Phaser.GameObjects.Text | null = null;
  private lastCombo = 0;
  /** The enemy currently resolving a move, so its hits can reach for the player. */
  private currentAttacker: ActorView | null = null;

  /**
   * 本场最后行动的敌人名 (todos/22 s3)——结算界面的「殁于 XXX」。在
   * `playEvents` drain `enemyMove` 事件时记下，因为死亡总是落在某次行动
   * 的余波里：直击、烧伤、中毒，账都记在最后动手的那个头上。不随存档
   * 往返——读档回来还没人动过手就死（回合初的灼烧），报「乱军之中」。
   */
  private lastEnemyMoveName: string | null = null;

  constructor() {
    super('Combat');
  }

  /**
   * Every field the scene carries between frames is reset here, including the
   * ones a class-field initialiser looks like it already handles. Phaser reuses
   * the instance across `scene.start`, so `init` is the *only* per-fight hook —
   * a field left out of it keeps the previous fight's value for the rest of the
   * run. `claimed` left behind froze the second victory screen. (`tips` is not
   * here: `create` reassigns it before anything can register.)
   */
  init(data: CombatSceneData): void {
    this.nodeType = data?.nodeType ?? 'monster';
    this.bonusRelic = data?.bonusRelic ?? null;
    // A fight the map opened is ledgered on the map node the player is standing
    // on. A fight an 奇遇 started is not — that node already holds an `event`
    // record — so the room layer hands its own id in (`eventFightNodeId`).
    this.ledgerId = data?.nodeId ?? null;
    this.cardViews.clear();
    // The roster is *replaced* in `create`, not cleared here: `shutdown` has
    // already destroyed every Game Object the old one held, and asking a stale
    // roster to tidy up would reach into them.
    this.theftSeq = 0;
    this.fightDamageTaken = 0;
    this.selectedUid = null;
    this.selectedPotion = null;
    // 影子的 Game Object 本体随 shutdown 销毁，这里只放引用（同下面的气泡）。
    this.dragUid = null;
    this.clickSuppressedUid = null;
    this.dragGhost = null;
    // Tab 摊着牌离开战斗，下一场不能还摊着 (k6)。
    this.handExpanded = false;
    // 伤害预览 (k5) 同理：小签本体随 shutdown 销毁，这里只放引用清预览态。
    this.hpPreview = null;
    this.hpPreviewKey = '';
    this.killTag = null;
    this.busy = false;
    this.finished = false;
    this.claimed = false;
    this.currentAttacker = null;
    this.lastEnemyMoveName = null;
    // 气泡和定时器的 Game Object / TimerEvent 本体随 shutdown 一起销毁，
    // 这里只把手上的引用放掉——攥着已销毁对象的句柄就是下一场的空指针。
    this.endTurnConfirm = null;
    this.autoEndTimer = null;
    this.lastEnergy = 0;
    this.comboBadge = null;
    this.comboText = null;
    this.lastCombo = 0;
    this.tweens.timeScale = 1;

    // 存档 (todos/08). Applied *after* the defaults rather than folded into
    // them, so the four lines above keep saying plainly what a fresh fight
    // does. A resumed fight overrides all four: every one was decided when the
    // fight opened, and the title screen — which is what starts this scene on a
    // reload — knows none of them.
    this.resumeFrom = data?.resume ?? null;
    if (this.resumeFrom) {
      this.nodeType = this.resumeFrom.tier;
      this.bonusRelic = this.resumeFrom.bonusRelic;
      this.ledgerId = this.resumeFrom.ledgerId;
      this.theftSeq = this.resumeFrom.theftSeq;
      this.fightDamageTaken = this.resumeFrom.fightDamageTaken;
    }
  }

  create(): void {
    useDesignSpace(this);
    this.run = getRun();
    this.audio = getAudio(this);

    // 场景音乐 (todos/20 b6)：首领与精英各有独立战曲（精英战曲随第二批
    // 音源补齐），普通战共用一首。交叉淡入 400ms 与「同曲不重启」都在
    // `Audio.music` 里——连打两场普通战，曲子不重头。
    const track =
      this.nodeType === 'boss' ? 'combat-boss'
      : this.nodeType === 'elite' ? 'combat-elite'
      : 'combat';
    // 首领进场 stinger（todo 步骤 7）：铜锣未至，先拿最重的那记闷响顶上，
    // 落在战曲起拍之前。续档重开首领战也响——重新进场，仍是进场。
    if (this.nodeType === 'boss') this.audio.play('hit-heavy', { volume: 1.2 });
    this.audio.ensureMusic(track, this);
    this.audio.music(track);

    // Two decisions, two streams. They used to share one seed, which meant the
    // encounter pick and the fight's own shuffle read the same numbers — adding
    // a single encounter to a table then reshuffled every opening hand.
    //
    // The pick itself belongs to the room layer: it reads and writes
    // `actCombatCount` / `usedEncounters`, and it has to be frozen on the node
    // so that a second `create()` reopens the fight the player walked into.
    this.nodeId = this.ledgerId ?? this.run.currentNodeId ?? 'start';
    const seed = streamSeed(this.run, this.nodeId, 'combat');
    // Materialised on first entry and only read back afterwards (R5), which is
    // what lets a reloaded save reopen *the fight the player walked into* rather
    // than picking a fresh one out of a pool that has moved on.
    this.encounter = ensureEncounter(this.run, this.nodeId, this.nodeType);
    // 敌卷埋点 (todos/23 u2)：上台的敌人记进解锁账。写在场景层——引擎是
    // 纯函数不碰持久化；续档重开同一场也只是幂等地再报一遍，不多记一笔。
    // 自定义局 (u5) 不写：不计分的局连解锁账的敌卷都不碰。
    if (!this.run.custom) recordSeenEnemies(this.encounter.enemies);

    this.state = this.resumeFrom
      ? restoreCombat(this.resumeFrom, this.run.mods)
      : startCombat({
          encounter: this.encounter,
          deck: this.run.deck,
          heroName: this.run.hero.name,
          hp: this.run.hp,
          maxHp: this.run.maxHp,
          relics: this.run.relics,
          seed,
          // 天命 (todos/19)：档位 + 修饰器一并递进去——引擎是纯函数，
          // 不许自己回头读 RunState。
          tier: this.nodeType,
          mods: this.run.mods,
        });

    // 建在所有 build* 之前：敌人视图一出生就要把意图徽章注册进来。
    this.tips = new TooltipManager(this, DEPTH.float);

    this.buildBackground();
    this.buildPlayer();
    this.buildEnemies();
    this.buildHud();

    this.arrow = this.add.graphics().setDepth(DEPTH.dragArrow);

    // 拖拽出牌 (todos/24 k3)：8px 以内算点击，之外才起拖——两种出牌方式
    // 并存的分界。阈值是画布像素，Retina 上更细，只会更偏向点击。
    this.input.dragDistanceThreshold = 8;

    // A card grid owns the input while it is up: Game Objects under it are
    // frozen, but scene-level pointer and key handlers still fire.
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, targets: unknown[]) => {
      // 确认气泡 (todos/21 t3)：点别处即取消。气泡本体除外——它自己的
      // zone 就是「确认」；结束回合按钮也除外——那一下会走 onEndTurn，
      // 由它把气泡当确认收掉，这里先收就成了「按钮永远确认不了」。
      if (this.endTurnConfirm) {
        const spared = targets.some(
          (t) =>
            this.endTurnConfirm!.exists(t as Phaser.GameObjects.GameObject) ||
            this.endTurnBtn.exists(t as Phaser.GameObjects.GameObject),
        );
        if (!spared) this.dismissEndTurnConfirm();
      }
      // Clicking empty ground cancels targeting.
      if (targets.length === 0 && !isCardGridOpen(this)) this.clearSelection();
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      // Esc 分层 (t3/t6)：最上层 overlay 先关——牌堆/设置开着时覆盖层栈
      // 自己收顶层，这里整个让位（isCardGridOpen 即 isOverlayOpen）。
      if (isCardGridOpen(this)) return;
      // 再收确认气泡 (t3)，这一按就只干这一件事——和「选敌中按 Esc
      // 只取消选敌」同一个分层逻辑。
      if (this.endTurnConfirm) {
        this.dismissEndTurnConfirm();
        return;
      }
      // 拖拽中回弹取消 (k6)：在 21 t6 定好的链里自成一档，排在选敌之前
      // ——拖着牌那一按只回弹 (k3：牌 tween 回手位，气一分不动；随后
      // 松手的 dragend 摸不到 dragUid)，不顺手把选中的丹药也收了。
      if (this.dragUid !== null) {
        this.cancelDrag();
        return;
      }
      // 选敌态只取消，不开设置 (t6 验收)。
      if (this.selectedUid !== null || this.selectedPotion !== null) {
        this.clearSelection();
        return;
      }
      // 都空了才轮到设置——t6 只加的这一层。
      openSettings(this);
    });
    // Tab 展开手牌 (todos/24 k6)：按住展开、松开恢复——keydown/keyup
    // 配对。addCapture 让 Phaser 对 Tab preventDefault：不拦的话浏览器
    // 把焦点切出画布，keyup 就永远听不见，手牌永远摊着。
    this.input.keyboard?.addCapture('TAB');
    this.input.keyboard?.on('keydown-TAB', () => this.setHandExpanded(true));
    this.input.keyboard?.on('keyup-TAB', () => this.setHandExpanded(false));
    // 键位 (todos/24 k4)：整表从 21 的设置账读，一个键名都不硬编码——
    // E 结束回合只是默认键帽，重绑了就听重绑的。Esc 不进这张表：它的
    // 分层在上面单独一根线。按键改不了中途换（设置里第一版只读），
    // create 时接一次线足够。
    for (const { action, event } of combatKeyEvents(getSettings().keys)) {
      this.input.keyboard?.on(event, () => this.onKeyAction(action));
    }

    this.cameras.main.fadeIn(dur(340), 8, 6, 4);
    this.syncHand();
    this.refresh();

    // 存档 (todos/08). A fight restored on its victory screen goes straight back
    // to it — settled, so `showVictory` must not settle it a second time (体力 is
    // idempotent, `resolveCombatEndHooks` is not: 贪念 would collect twice).
    // Otherwise the fight is simply live again, and the first thing it does is
    // write itself down, so opening a fight is itself a save point.
    if (this.state.phase === 'won') {
      this.finished = true;
      this.showVictory(true);
    } else {
      this.autosave();
    }
  }

  // ------------------------------------------------------------- 存档

  /**
   * Snapshot the fight as it stands. Called after every player action and on the
   * victory screen, which between them are every moment the run can be left.
   *
   * There is no save-scum hole here, and that is not an accident: a reload
   * replays into the *same* `rngState`, so the shuffle, the intents and the
   * damage rolls that follow are the ones the player already committed to. Only
   * their own decisions are theirs to take back, and those they could take back
   * by not making them.
   */
  private saveFight(): void {
    writeSave(
      this.run,
      snapshotCombat(this.state, {
        tier: this.nodeType,
        ledgerId: this.ledgerId,
        bonusRelic: this.bonusRelic,
        theftSeq: this.theftSeq,
        fightDamageTaken: this.fightDamageTaken,
      }),
    );
  }

  /**
   * The between-actions save. Skips a fight that is mid-resolution — the engine
   * is holding an effect queue and possibly a `pendingChoice` the player has not
   * answered — and skips one that is already decided, which `showVictory` and
   * `showDefeat` own instead.
   */
  private autosave(): void {
    if (this.finished || !combatIsQuiescent(this.state)) return;
    this.saveFight();
  }

  // ------------------------------------------------------------- scaffolding

  private buildBackground(): void {
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'combat-bg').setDepth(DEPTH.bg);
    // 6% bleed: camera shake would otherwise pull empty space in at the edges.
    const scale = Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height) * 1.06;
    bg.setScale(scale);
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 1.1, GAME_HEIGHT * 1.1, C.inkDeep, 0.42)
      .setDepth(DEPTH.bg);

    // Ground shadow band so the cut-out actors sit on something. The gradient
    // fades in above the baseline and then holds solid to the bottom edge,
    // otherwise the rect's lower edge reads as a hard seam across the screen.
    const ground = this.add.graphics().setDepth(DEPTH.bg);
    const bleed = 60;
    ground.fillGradientStyle(C.inkDeep, C.inkDeep, C.inkDeep, C.inkDeep, 0, 0, 0.72, 0.72);
    ground.fillRect(-bleed, BASELINE_Y - 74, GAME_WIDTH + bleed * 2, 74);
    ground.fillStyle(C.inkDeep, 0.72);
    ground.fillRect(-bleed, BASELINE_Y, GAME_WIDTH + bleed * 2, GAME_HEIGHT - BASELINE_Y + bleed);
  }

  private makeActorView(
    x: number,
    key: string,
    height: number,
    flip: boolean,
    barWidth: number,
    hp: number,
  ): ActorView {
    const container = this.add.container(x, BASELINE_Y).setDepth(DEPTH.actors);

    const sprite = this.add.image(0, 0, key).setOrigin(0.5, 1);
    // Size and ground by the artwork's silhouette, not the plate's rectangle —
    // the cut-outs have inconsistent transparent margins.
    groundSprite(this, sprite, height);
    sprite.setFlipX(flip);

    const shadow = this.add.ellipse(
      0,
      4,
      contentWidthAt(this, key, height) * 0.9,
      height * 0.09,
      0x000000,
      0.45,
    );

    container.add([shadow, sprite]);

    // Idle breath: scaleY on an origin-(0.5, 1) sprite keeps the feet planted.
    // Randomised timing so a row of enemies doesn't pulse in lockstep.
    // 环境循环故意不过 dur()——呼吸不占战斗节奏，加速只会像喘（timing.ts 文件头）。
    const baseScaleY = sprite.scaleY;
    this.tweens.add({
      targets: sprite,
      scaleY: baseScaleY * 1.016,
      duration: 1700 + Math.random() * 600,
      delay: Math.random() * 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const ui = this.add.container(x, BASELINE_Y).setDepth(DEPTH.actorUi);
    const bar = this.add.graphics();
    const hpText = this.add.text(0, 22, '', bodyStyle(13, C.paper)).setOrigin(0.5);

    const blockBadge = this.add.container(-barWidth / 2 - 16, 22);
    const shieldBg = this.add.graphics();
    shieldBg.fillStyle(0x2c4a63, 1);
    shieldBg.fillCircle(0, 0, 15);
    shieldBg.lineStyle(1.5, 0x9fc4e0, 0.9);
    shieldBg.strokeCircle(0, 0, 15);
    const blockText = this.add.text(0, 0, '0', bodyStyle(14, 0xdcefff)).setOrigin(0.5);
    blockBadge.add([shieldBg, blockText]);
    blockBadge.setVisible(false);

    const statusRow = this.add.container(0, 46);

    ui.add([bar, hpText, blockBadge, statusRow]);

    return {
      container,
      sprite,
      ui,
      bar,
      hpText,
      blockBadge,
      blockText,
      statusRow,
      height,
      barWidth,
      baseX: x,
      spriteBaseX: sprite.x,
      baseScaleY,
      ghost: { value: hp },
    };
  }

  private buildPlayer(): void {
    // The hero plate already faces right, toward the enemy line — no flip.
    this.playerView = this.makeActorView(
      PLAYER_X,
      this.run.hero.fullKey,
      300,
      false,
      150,
      this.state.player.hp,
    );
    this.add
      .text(PLAYER_X, BASELINE_Y + 66, this.run.hero.name, brushStyle(18, C.paperDim))
      .setOrigin(0.5)
      .setDepth(DEPTH.actorUi);

    // 本回合入伤, opposite the block badge and on the same line as it: armour on
    // the left of the bar, the wound it has to answer on the right.
    //
    // The information is public — every badge on screen already says it — so
    // adding it up for the player costs no difficulty and removes the single
    // commonest way to die, which is arithmetic.
    const x = this.playerView.barWidth / 2 + 20;
    this.incomingText = this.add.text(x, 22, '', brushStyle(21, C.paperDim)).setOrigin(0, 0.5);
    // A second label because 「12+?」 must not be one colour: the 12 is a
    // promise and the ? is an admission, and painting them alike would make the
    // total look complete when it is not.
    this.incomingHidden = this.add.text(x, 22, '', brushStyle(21, C.paperFaint)).setOrigin(0, 0.5);
    this.playerView.ui.add([this.incomingText, this.incomingHidden]);
  }

  /**
   * The Game Objects for one enemy, standing at `x`. Handed to `EnemyRoster`,
   * which decides *where* bodies stand and when they stop existing — this only
   * decides what one looks like.
   */
  private buildEnemyView(enemy: EnemyState, x: number): EnemyViewParts {
    const base = this.makeActorView(x, enemy.art, enemy.height, false, 140, enemy.hp);

    // Intent marker, pinned above the sprite but never under the top HUD.
    // Everything the badge is made of is a child of this container, so the
    // roster moves the whole thing with one tween and destroys it with one call.
    const intentY = Math.max(Math.min(-enemy.height - 30, -70), -(BASELINE_Y - 42));
    const intent = this.add.container(x, BASELINE_Y + intentY).setDepth(DEPTH.actorUi);
    const intentBg = this.add.graphics();
    const intentIcon = this.add.graphics();
    const intentText = this.add.text(0, 0, '', brushStyle(21, C.paper)).setOrigin(1, 0.5);
    const intentMarks = this.add.container(0, 0);
    const intentHit = this.add.zone(0, 0, 80, INTENT_H).setInteractive();
    intent.add([intentBg, intentIcon, intentText, intentMarks, intentHit]);

    // Held, not `setName`d: a label found through `getByName` can be faded but
    // never moved with the body and never destroyed with it.
    const nameText = this.add
      .text(x, BASELINE_Y + 66, enemy.name, brushStyle(18, C.paperDim))
      .setOrigin(0.5)
      .setDepth(DEPTH.actorUi);

    const hitWidth = Math.max(120, contentWidthAt(this, enemy.art, enemy.height));
    const hit = this.add
      .zone(x, BASELINE_Y - enemy.height / 2, hitWidth, enemy.height)
      .setDepth(DEPTH.actors);
    hit.setInteractive({ useHandCursor: true });

    const view: EnemyViewParts = {
      ...base,
      enemy,
      intent,
      intentBg,
      intentIcon,
      intentText,
      intentMarks,
      intentHit,
      nameText,
      hit,
      hitWidth,
      intentKey: '',
    };

    // The pointer is only *one* caller of the tooltip — todos/24 wants the same
    // panel off a keyboard cursor — so the zone only asks the shared manager,
    // and the content is read at show time rather than captured, because the
    // telegraph changes under the badge every turn.
    this.tips.register({ zone: intentHit, content: () => this.intentTipContent(view) });

    return view;
  }

  private buildEnemies(): void {
    this.roster = new EnemyRoster(this, {
      baselineY: BASELINE_Y,
      depth: { actors: DEPTH.actors, actorUi: DEPTH.actorUi },
      build: (enemy, x) => this.buildEnemyView(enemy, x),
      onOver: (view, over) => this.onEnemyOver(view, over),
      onClick: (view) => this.onEnemyClick(view),
    });
    for (const enemy of this.state.enemies) this.addEnemyView(enemy);
    void this.relayoutEnemies(false);
  }

  /**
   * Put a body on screen. `x` is where it *appears* — a summon walks out of its
   * summoner — and `relayoutEnemies` is what walks it to its slot.
   *
   * The engine has already appended the enemy to `state.enemies` and already
   * rolled its intent, so the next `refreshBars` paints its telegraph with no
   * further help. todos/15 calls this from the `summon` and `split` handlers.
   */
  addEnemyView(enemy: EnemyState, x?: number): EnemyView {
    return this.roster.add(enemy, x);
  }

  /** Destroy a body outright — 分裂's parent and 遁走's runaway, never a corpse. */
  removeEnemyView(id: string): void {
    // Drop the handle *before* the Game Objects go: `currentAttacker` outlives
    // the move that set it (`playDamage` lunges it for each of the move's
    // hits), so a 流寇 that 遁走s on its last blow, or a 张宝 that splits
    // mid-move, would leave the scene holding a destroyed Container to tween.
    if (this.currentAttacker && this.currentAttacker === this.roster.get(id)) {
      this.currentAttacker = null;
    }
    this.roster.remove(id);
  }

  /**
   * Re-slot the living bodies. Await it: a hit zone still in flight is a click
   * that lands on nothing.
   *
   * Only when the living count *grows*. A death and a 遁走 deliberately leave
   * the survivors where they are — `EnemyState.slot` exists to keep positions
   * stable once a body is gone, and sliding the line would move the target out
   * from under a click already on its way.
   */
  private relayoutEnemies(animate: boolean): Promise<void> {
    return this.roster.layout(animate);
  }

  private buildHud(): void {
    const fixed = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as { setDepth: (v: number) => void }).setDepth(DEPTH.hud);
      return o;
    };

    // Top-left, not centred: the middle of the top edge belongs to the boss's
    // intent marker, which sits high when the sprite is tall.
    fixed(
      this.add.text(28, 20, this.encounter.name, brushStyle(22, C.paper)).setLetterSpacing(3),
    );
    this.turnText = this.add.text(30, 52, '', bodyStyle(14, C.paperFaint));
    fixed(this.turnText);

    // 自定义局常驻章 (todos/23 u5)：与地图 HUD 同一句话，回合行下一行。
    if (this.run.custom) {
      fixed(this.add.text(30, 74, '自定义 · 不计分', bodyStyle(12, C.gold)).setLetterSpacing(2));
    }

    // Energy orb. Wrapped in a container so it can be scale-popped on spend —
    // scaling a Graphics would pivot on the scene origin, not the orb.
    this.energyOrb = this.add.container(88, 556).setDepth(DEPTH.hud);
    const orb = this.add.graphics();
    orb.fillStyle(C.inkDeep, 0.95);
    orb.fillCircle(0, 0, 40);
    orb.lineStyle(3, C.goldBright, 0.95);
    orb.strokeCircle(0, 0, 40);
    orb.lineStyle(1, C.cinnabar, 0.6);
    orb.strokeCircle(0, 0, 46);
    this.energyText = this.add.text(0, -8, '', brushStyle(34, C.goldBright)).setOrigin(0.5);
    // The ceiling is printed too: a relic can move it, and a lone number would
    // give the player no way to tell 3 of 3 from 3 of 4.
    this.energyMaxText = this.add.text(0, 20, '', bodyStyle(13, C.paperDim)).setOrigin(0.5);
    this.energyOrb.add([orb, this.energyText, this.energyMaxText]);
    fixed(this.add.text(88, 606, '气', bodyStyle(13, C.paperFaint)).setOrigin(0.5));

    // 连击 counter, stacked above the 气 orb in the same gutter — and only for
    // the hero whose pool actually reads the number (赵云). 关羽 and 诸葛亮
    // never see it: a zero that can never move is one more thing to ignore.
    // (When a second combo hero exists, this gate should move onto a
    // `HeroResourceDef` declaration — see todos/17.)
    if (this.run.hero.id === 'zhaoyun') {
      this.comboBadge = this.add.container(88, 462).setDepth(DEPTH.hud);
      const disc = this.add.graphics();
      disc.fillStyle(C.inkDeep, 0.95);
      disc.fillCircle(0, 0, 24);
      disc.lineStyle(2, C.cinnabarBright, 0.9);
      disc.strokeCircle(0, 0, 24);
      // Seeded from the live state, not from 0: a resumed fight (todos/08) can
      // reopen mid-turn with attacks already played, and the first `refresh`
      // must repaint that quietly rather than pop a badge nobody just earned.
      this.lastCombo = this.state.attacksThisTurn;
      this.comboText = this.add
        .text(0, 0, `${this.lastCombo}`, brushStyle(24, C.paper))
        .setOrigin(0.5);
      this.comboBadge.add([disc, this.comboText]);
      fixed(this.add.text(88, 498, '连击', bodyStyle(13, C.paperFaint)).setOrigin(0.5));
    }

    // Relic bar, clear of the encounter name on the left and of the boss's
    // intent marker, which rides high over the middle of the top edge.
    //
    // 宝物条**保留**自己的悬停说明而不并进 `tips` (todos/24 k2 的取舍)：
    // RelicBar 还活在地图 HUD 和战利品 overlay（深度 200+）里，场景级
    // 管理器要伺候它就得学会逐目标深度和滚动锁定——保留是侵入最小的一边。
    this.relicBar = new RelicBar(this, {
      x: 196,
      y: 18,
      depth: DEPTH.hud,
      tooltipDepth: DEPTH.float,
    });
    this.relicBar.setRelics(this.run.relics);

    fixed(
      this.add
        .text(POTION_BELT.x, POTION_BELT.y - 40, '丹药', bodyStyle(13, C.paperFaint))
        .setOrigin(0.5)
        .setLetterSpacing(2),
    );
    this.potionBelt = new PotionBelt(this, {
      x: POTION_BELT.x,
      y: POTION_BELT.y,
      depth: DEPTH.hud,
      vertical: true,
      tooltipDepth: DEPTH.float,
      onUse: (slot, def) => this.onPotionClick(slot, def),
      onDiscard: (slot) => this.discardPotion(slot),
    });
    this.potionBelt.setPotions(this.run.potions);

    // Piles. All four views read the same engine arrays the rules run on, so a
    // count on screen can never disagree with what is actually in the pile.
    this.drawPile = this.makePileCounter(DRAW_PILE.x, DRAW_PILE.y - 12, '抽牌堆', () =>
      // Contents yes, order no — the draw pile is displayed scrambled.
      this.openPile('抽 牌 堆', this.state.drawPile, true),
    );
    this.discardPile = this.makePileCounter(DISCARD_PILE.x, DISCARD_PILE.y - 12, '弃牌堆', () =>
      this.openPile('弃 牌 堆', this.state.discardPile),
    );
    this.exhaustPile = this.makePileCounter(EXHAUST_PILE.x, EXHAUST_PILE.y - 12, '消耗堆', () =>
      this.openPile('消 耗 堆', this.state.exhaustPile),
    );
    this.exhaustPile.container.setVisible(false);

    fixed(this.makeDeckButton(28, 76));

    // 设置入口 (todos/21 t6)：右上角齿轮小按钮，ui-click 音随 `inkButton`
    // 工厂自带；Esc 空档（无 overlay、无气泡、无选中）时是同一扇门。
    fixed(
      inkButton(this, GAME_WIDTH - 36, 40, '⚙', {
        width: 44,
        height: 40,
        fontSize: 22,
        onClick: () => openSettings(this),
      }),
    );

    this.endTurnBtn = inkButton(this, 1148, 556, '结束回合', {
      width: 186,
      height: 62,
      fontSize: 24,
      onClick: () => this.onEndTurn(),
    });
    this.endTurnBtn.setDepth(DEPTH.hud);
  }

  // -------------------------------------------------------------- pile views

  /**
   * The card-stack glyph is drawn rather than blitted: it has to stay crisp at
   * any RENDER_SCALE, and a real plate would only ever be one more thing to
   * keep in register with the palette.
   */
  private makePileCounter(x: number, y: number, label: string, onOpen: () => void): PileCounter {
    const container = this.add.container(x, y).setDepth(DEPTH.hud);

    const glyph = this.add.graphics();
    for (const [i, dx] of [-5, 0, 5].entries()) {
      glyph.fillStyle(C.ink, 0.92);
      glyph.fillRoundedRect(dx - 30, -19 + i * 2, 30, 40, 3);
      glyph.lineStyle(1.5, i === 2 ? C.gold : C.paperFaint, i === 2 ? 0.85 : 0.5);
      glyph.strokeRoundedRect(dx - 30, -19 + i * 2, 30, 40, 3);
    }

    const text = this.add.text(16, 2, '0', brushStyle(24, C.paper)).setOrigin(0.5);
    const name = this.add.text(-6, -34, label, bodyStyle(12, C.paperFaint)).setOrigin(0.5);
    const hit = this.add.zone(-6, -4, 100, 78).setInteractive({ useHandCursor: true });

    container.add([glyph, name, text, hit]);
    hit.on('pointerover', () => text.setColor(css(C.goldBright)));
    hit.on('pointerout', () => text.setColor(css(C.paper)));
    hit.on('pointerup', () => onOpen());

    return { container, text, value: 0 };
  }

  private makeDeckButton(x: number, y: number): Phaser.GameObjects.Container {
    const w = 116;
    const h = 34;
    const container = this.add.container(x + w / 2, y + h / 2).setDepth(DEPTH.hud);

    const bg = this.add.graphics();
    const paint = (hover: boolean): void => {
      bg.clear();
      bg.fillStyle(C.inkDeep, hover ? 0.92 : 0.72);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 3);
      bg.lineStyle(1, hover ? C.goldBright : C.gold, hover ? 0.9 : 0.45);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 3);
    };
    paint(false);

    const label = this.add.text(-w / 2 + 12, 0, '牌组', bodyStyle(15, C.paperDim)).setOrigin(0, 0.5);
    this.deckCount = this.add
      .text(w / 2 - 12, 0, '', brushStyle(20, C.gold))
      .setOrigin(1, 0.5);
    const hit = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });

    container.add([bg, label, this.deckCount, hit]);
    hit.on('pointerover', () => paint(true));
    hit.on('pointerout', () => paint(false));
    hit.on('pointerup', () => this.openDeck());

    return container;
  }

  /** 牌组一览——「牌组」按钮与 viewDeck 键 (todos/24 k4) 的同一入口。 */
  private openDeck(): void {
    openCardGrid(this, {
      title: '牌 组',
      subtitle: `共 ${this.run.deck.length} 张`,
      entries: this.run.deck.map((card) => ({ ...card })),
      mode: 'view',
      state: this.state,
    });
  }

  private openPile(title: string, uids: readonly string[], shuffleDisplay = false): void {
    const entries: CardGridEntry[] = uids.map((uid) => {
      const inst = this.state.cards[uid];
      return { uid, defId: inst.defId, upgraded: inst.upgraded };
    });
    openCardGrid(this, {
      title,
      subtitle: `共 ${entries.length} 张`,
      entries,
      mode: 'view',
      shuffleDisplay,
      state: this.state,
    });
  }

  /** Retype a count, popping the number when it actually moved. */
  private setCount(counter: PileCounter, value: number): void {
    if (counter.value === value) return;
    counter.value = value;
    counter.text.setText(String(value));
    this.tweens.killTweensOf(counter.text);
    counter.text.setScale(1);
    this.tweens.add({
      targets: counter.text,
      scale: 1.45,
      duration: dur(120),
      yoyo: true,
      ease: 'Back.easeOut',
    });
  }

  // -------------------------------------------------------------- hand cards

  /** Create views for newly drawn cards, destroy views for cards that left. */
  private syncHand(): void {
    // Cards that left the hand sail off to the discard pile.
    let leaving = 0;
    for (const [uid, view] of this.cardViews) {
      if (this.state.hand.includes(uid)) continue;
      this.cardViews.delete(uid);
      const delay = dur(leaving++ * 45);
      view.hitZone.disableInteractive();
      this.tweens.add({
        targets: view,
        x: DISCARD_PILE.x,
        y: DISCARD_PILE.y,
        angle: 28,
        scale: 0.34,
        alpha: 0,
        delay,
        duration: dur(320),
        ease: 'Cubic.easeIn',
        onComplete: () => view.destroy(),
      });
    }

    // New cards are dealt out of the draw pile.
    let dealt = 0;
    for (const uid of this.state.hand) {
      if (this.cardViews.has(uid)) continue;
      const inst = this.state.cards[uid];
      // 手牌递 tips 进去：卡面规则文本里的关键词长出悬停热区 (todos/24 k2)。
      const view = new CardView(this, uid, inst.defId, inst.upgraded, this.state, 'hand', this.tips, {
        hoverScale: HAND_HOVER_SCALE,
        draggable: true,
      });
      view.setDepth(DEPTH.hand);
      view.setAlpha(0);
      view.setPosition(DRAW_PILE.x, DRAW_PILE.y);
      view.setScale(0.34);
      view.setAngle(-26);
      view.setData('dealDelay', dealt++ * 60);
      view.hitZone.on('pointerover', () => this.onCardOver(view, true));
      view.hitZone.on('pointerout', () => this.onCardOver(view, false));
      view.hitZone.on('pointerup', () => this.onCardClick(view));
      // 拖拽出牌 (todos/24 k3)：三个 drag 事件都从主点击区来。
      view.hitZone.on('dragstart', () => this.onCardDragStart(view));
      view.hitZone.on('drag', (p: Phaser.Input.Pointer) => this.onCardDrag(view, p));
      view.hitZone.on('dragend', (p: Phaser.Input.Pointer) => this.onCardDragEnd(view, p));
      this.cardViews.set(uid, view);
    }

    this.layoutHand();
  }

  private layoutHand(): void {
    const hand = this.state.hand;
    const n = hand.length;
    if (n === 0) return;

    // 槽位表在 handLayout（k6，纯函数）：扇形随牌数收窄间距和旋转角
    // （实现步骤 9），Tab 按住时换成一排端平的展开位（步骤 8）。
    const slots = this.handExpanded ? rowLayout(n, CARD_W) : fanLayout(n, CARD_W);

    hand.forEach((uid, i) => {
      const view = this.cardViews.get(uid);
      if (!view) return;
      const slot = slots[i];

      view.homeX = slot.x;
      view.homeY = slot.y;
      view.homeAngle = slot.angle;
      view.homeScale = slot.scale;
      view.setDepth(DEPTH.hand + i);

      const delay = (view.getData('dealDelay') as number | undefined) ?? 0;
      view.setData('dealDelay', 0);

      this.tweens.add({
        targets: view,
        x: slot.x,
        y: slot.y,
        angle: slot.angle,
        alpha: 1,
        scale: slot.scale,
        delay: dur(delay),
        duration: dur(delay > 0 ? 330 : 260),
        ease: delay > 0 ? 'Back.easeOut' : 'Cubic.easeOut',
      });
    });
  }

  /**
   * Tab 展开手牌 (todos/24 k6)。按住的 keydown 自动重复靠「状态没变」
   * 挡掉；拖拽中不切——layoutHand 会把叼在指针上的牌也拽回槽位。切换
   * 先收选中/选敌（抬着的牌不归槽位表管，摊开合上都得先放下），再整手
   * 重排；松开那一下同一条路收回扇形。
   */
  private setHandExpanded(on: boolean): void {
    if (this.handExpanded === on || this.dragUid !== null) return;
    this.handExpanded = on;
    this.clearSelection();
    this.layoutHand();
  }

  private onCardOver(view: CardView, over: boolean): void {
    if (this.busy || this.finished || this.dragUid) return;
    if (this.selectedUid && this.selectedUid !== view.uid) return;

    // 抬牌的画法搬进了 CardView (todos/24 k3)：放大、归零旋转、pointerout
    // 恢复都是它自己的事，这里只留 gate 和深度的账。
    if (over) view.hoverLift(DEPTH.hand + 40);
    else view.hoverDrop(DEPTH.hand + this.state.hand.indexOf(view.uid));
  }

  /**
   * 点击出牌，也是数字键的落点 (todos/24 k4)——`directTargetId` 只有
   * `onCardKey` 在单敌直打时才传；点击路径不传，进来后自己按同一把尺
   * （`soleLivingEnemy`）量：指向牌的目标没有第二个答案时，选敌与打出
   * 并成一步，多敌照旧进选敌模式。
   */
  private onCardClick(view: CardView, directTargetId?: string): void {
    this.cancelAutoEnd();
    if (this.busy || this.finished) return;
    // 拖拽的抬手不是点击 (k3)：dragend 先到、dragUid 已空，靠压制账认它。
    if (this.clickSuppressedUid === view.uid) {
      this.clickSuppressedUid = null;
      return;
    }
    if (this.dragUid) return;
    if (!canPlay(this.state, view.uid)) {
      popText(this, view.x, view.y - 118, '气不足', { color: C.cinnabarBright, size: 22 });
      this.tweens.add({
        targets: this.energyOrb,
        scale: 1.16,
        duration: dur(90),
        yoyo: true,
        ease: 'Sine.easeOut',
      });
      return;
    }

    if (view.def.target === 'enemy') {
      // 单敌免选：问的是引擎的活敌名单，不是屏幕上谁还站着。
      const direct = directTargetId ?? soleLivingEnemy(this.state.enemies)?.id;
      if (direct === undefined) {
        // Toggle targeting mode; the actual play happens on the enemy click.
        if (this.selectedUid === view.uid) this.clearSelection();
        else this.select(view);
        return;
      }
      // 单敌直打收掉了「点敌人才结算」这道天然确认，confirmPlay 的闸给
      // 点击路径补回来——首点高亮（瞄准线照画），再点同一张才打出，与
      // 非指向牌的确认手感一致。数字键（directTargetId 已传）照旧直打。
      if (directTargetId === undefined && needsPlayConfirm(view.def) && this.selectedUid !== view.uid) {
        this.select(view);
        return;
      }
      // 单敌直打 (k4)。照 onEnemyClick 的收法手工放下选中，不走
      // clearSelection——那会把牌往手位回收，跟 play 的上挥打架。
      if (this.selectedUid === view.uid) {
        this.selectedUid = null;
        this.arrow.clear();
        view.setSelected(false);
      } else {
        this.clearSelection();
      }
      void this.play(view.uid, direct);
      return;
    }
    // 打牌确认 (todos/21 t3)：非指向牌先高亮不结算，再点同一张才打出——
    // rare 档只拦稀有牌。取消复用选目标那套线：点别处 / Esc 都会
    // clearSelection。指向牌不走这里，「点敌人才结算」本身就是第二次点击。
    if (needsPlayConfirm(view.def)) {
      if (this.selectedUid !== view.uid) {
        this.select(view);
        return;
      }
      // 照 onEnemyClick 的收法手工放下选中，不走 clearSelection——那会把
      // 牌往手位回收，跟 play 的上挥打架。
      this.selectedUid = null;
      view.setSelected(false);
    }
    void this.play(view.uid);
  }

  // ------------------------------------------------------------------ 丹药

  /**
   * A potion that needs a target enters the same aiming mode a card does, so
   * there is one targeting interaction to learn rather than two.
   */
  private onPotionClick(slot: number, def: PotionDef): void {
    this.cancelAutoEnd();
    if (this.busy || this.finished || this.state.phase !== 'player') return;

    if (def.target === 'enemy') {
      if (this.selectedPotion === slot) this.clearSelection();
      else {
        this.clearSelection();
        this.selectedPotion = slot;
      }
      return;
    }
    void this.drinkPotion(slot);
  }

  private async drinkPotion(slot: number, targetId?: string): Promise<void> {
    const id = this.run.potions[slot];
    if (!id || this.busy || this.finished) return;

    this.busy = true;
    // The engine refuses first; only then does the belt lose the bottle, so a
    // rejected pour can never cost the player a potion.
    if (!usePotion(this.state, id, targetId)) {
      this.busy = false;
      return;
    }
    removePotion(this.run, slot);
    this.potionBelt.setPotions(this.run.potions);

    await this.playEvents();
    await this.settleChoices();
    this.syncHand();
    this.refresh();
    this.busy = false;
    this.checkOutcome();
    this.autosave();
  }

  private discardPotion(slot: number): void {
    this.cancelAutoEnd();
    if (this.busy || this.finished) return;
    const id = removePotion(this.run, slot);
    if (!id) return;
    this.clearSelection();
    this.potionBelt.setPotions(this.run.potions);
    // Pouring one away costs a resource and resolves nothing, so it never
    // reaches the action paths above — but it is still a change worth keeping.
    this.autosave();
    const at = this.potionBelt.slotAt(slot);
    popText(this, at.x + 40, at.y, `弃「${getPotion(id).name}」`, {
      color: C.paperFaint,
      size: 19,
      depth: DEPTH.float,
    });
  }

  // ------------------------------------------------- 键位分发 (todos/24 k4)

  /**
   * 键位表的总入口。overlay 开着（牌堆/设置/选牌）整表拦下——与原
   * keydown-E 的门同一扇；finished 后战场已交给结算画面，键一并失效。
   * busy 不在这里拦：每个键都只是现有点击入口的另一个开口（onCardClick /
   * onPotionClick / onEndTurn 自己的门再拦一道），不长第二套判定。
   */
  private onKeyAction(action: KeyAction): void {
    if (this.finished || isCardGridOpen(this)) return;
    // 拖着牌时整表拦下 (k4 校验指出的两处竞态)：D/A/S 会在拖拽中开牌堆
    // overlay、Q/W/R 会在拖拽中灌药，随后的 dragend 都可能穿过各自的门
    // 把牌打进乱掉的局面。拖拽中的键只留 Esc（它走自己的处理器）。
    if (this.dragUid) return;
    if (action === 'endTurn') {
      // 走 21 的 confirmEndTurn 逻辑——气泡该弹 onEndTurn 自己弹，再按
      // 一次同键就是确认，三条确认路照旧汇在那里。
      void this.onEndTurn();
      return;
    }
    // 按了别的键就是「别处」——与 create 里 pointerdown 的收法同一语义，
    // 免得出一张牌之后气泡上「气还剩几点」成了旧账。
    if (this.endTurnConfirm) this.dismissEndTurnConfirm();
    // 牌堆三键接到与角落按钮相同的入口，抽牌堆照旧乱序展示。
    if (action === 'viewDeck') {
      this.openDeck();
      return;
    }
    if (action === 'viewDraw') {
      this.openPile('抽 牌 堆', this.state.drawPile, true);
      return;
    }
    if (action === 'viewDiscard') {
      this.openPile('弃 牌 堆', this.state.discardPile);
      return;
    }
    const card = cardIndexOf(action);
    if (card >= 0) {
      this.onCardKey(card);
      return;
    }
    const potion = potionIndexOf(action);
    if (potion >= 0) this.onPotionKey(potion);
  }

  /**
   * 数字键出牌（实现步骤 5）：第 N 张手牌，与点击同一条路——无目标牌
   * 直接打（confirmPlay 拦的档位照样先高亮，再按一次才出）；指向牌只剩
   * 一个活敌时把目标直接递进去，原版行为省一步，多敌照旧进选敌模式。
   */
  private onCardKey(index: number): void {
    const uid = this.state.hand[index];
    const view = uid ? this.cardViews.get(uid) : undefined;
    if (!view) return;
    const sole = view.def.target === 'enemy' ? soleLivingEnemy(this.state.enemies) : null;
    this.onCardClick(view, sole?.id);
  }

  /** 丹药键：与点击腰带同一入口——指向性丹药照样进选敌模式。 */
  private onPotionKey(slot: number): void {
    const id = this.run.potions[slot];
    if (id) this.onPotionClick(slot, getPotion(id));
  }

  private select(view: CardView): void {
    this.clearSelection();
    this.selectedUid = view.uid;
    view.setSelected(true);
    view.setDepth(DEPTH.hand + 40);
    this.tweens.add({
      targets: view,
      y: HAND_Y - 78,
      angle: 0,
      scale: 1.18,
      duration: dur(140),
      ease: 'Back.easeOut',
    });
  }

  private clearSelection(): void {
    // 取消选择即收预览 (k5)——选敌模式下点空地/Esc，条上的红段一起消失。
    this.setHpPreview(null, null);
    if (this.selectedPotion !== null) {
      this.selectedPotion = null;
      this.arrow.clear();
    }
    if (!this.selectedUid) return;
    const view = this.cardViews.get(this.selectedUid);
    this.selectedUid = null;
    this.arrow.clear();
    if (!view) return;
    view.setSelected(false);
    view.setDepth(DEPTH.hand + this.state.hand.indexOf(view.uid));
    this.tweens.add({
      targets: view,
      x: view.homeX,
      y: view.homeY,
      angle: view.homeAngle,
      // 回 homeScale 不回 1 (k6)：Tab 展开排在 9-10 张时整排微缩过。
      scale: view.homeScale,
      duration: dur(160),
      ease: 'Quad.easeOut',
    });
  }

  // ------------------------------------------------- 拖拽出牌 (todos/24 k3)

  /**
   * 起拖。点击出牌完整保留（验收点名两种并存）：阈值之内 pointerup 照走
   * `onCardClick`，这里只接真拖出去的那种。打不出的牌不起拖——抬手时
   * onCardClick 会喊「气不足」，比拖到一半被弹回去讲得明白，也免得
   * 一次误拖喊两声。
   */
  private onCardDragStart(view: CardView): void {
    this.cancelAutoEnd();
    if (this.busy || this.finished || isCardGridOpen(this)) return;
    if (!canPlay(this.state, view.uid)) return;

    // 选中态（选敌中的牌、确认中的稀有牌）让位给拖拽——先收再拖，
    // clearSelection 的回位 tween 随手被下面的 kill 掐掉。
    this.clearSelection();
    this.dragUid = view.uid;
    this.tweens.killTweensOf(view);
    view.setDepth(DEPTH.dragArrow + 1);
    view.setAngle(0);
    // 悬停时已放大到 1.35，缩回原尺寸再上路——全尺寸的卡叼在指针上，
    // 半个敌阵都在它底下。
    this.tweens.add({ targets: view, scale: 1, duration: dur(90), ease: 'Quad.easeOut' });

    // 原位半透明占位：一圈墨框留在手位，牌去了哪儿、松手回哪儿，一眼有数。
    const ghost = this.add.graphics().setDepth(DEPTH.hand);
    ghost.fillStyle(C.ink, 0.3);
    ghost.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    ghost.lineStyle(1.5, C.gold, 0.4);
    ghost.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 8);
    ghost.setPosition(view.homeX, view.homeY);
    ghost.setAngle(view.homeAngle);
    // Tab 展开排微缩过的槽位 (k6)，影子跟着缩才对得上位。
    ghost.setScale(view.homeScale);
    this.dragGhost = ghost;
  }

  /**
   * 卡片跟随。指向牌被 DRAG_HOLD_Y 拦腰扣住——卡不进敌阵，箭头替它去
   * （update 里画）。敌人高亮只能逐帧自己点名：拖拽中卡片热区压在最上层
   * （topOnly），敌人的 pointerover 根本到不了。
   */
  private onCardDrag(view: CardView, p: Phaser.Input.Pointer): void {
    if (this.dragUid !== view.uid) return;
    const px = toDesign(p.x);
    const py = toDesign(p.y);
    view.x = px;
    view.y = view.def.target === 'enemy' ? Math.max(py, DRAG_HOLD_Y) : py;

    const living = this.roster.living();
    let idx = view.def.target === 'enemy' ? hitIndex(px, py, living.map((v) => v.hit)) : -1;
    // 单敌免瞄准与 dropVerdict 同一条线：唯一活敌 + 过线即锁定——高亮和
    // 伤害预览提前点亮，松手的语义所见即所得。
    if (idx < 0 && view.def.target === 'enemy' && living.length === 1 && pastPlayLine(py)) idx = 0;
    living.forEach((v, i) => {
      if (i === idx) v.sprite.setTint(0xffcfae);
      else v.sprite.clearTint();
    });
    // HP 条伤害预览 (k5)：悬停在活敌热区上点亮，拖走即收。逐帧调用没关系
    // ——setHpPreview 自己按「同目标同段」去重。
    this.setHpPreview(idx >= 0 ? view.uid : null, idx >= 0 ? (living[idx]?.enemy.id ?? null) : null);
  }

  /**
   * 松手裁决（`dropVerdict`，纯函数）：指向牌落在活敌热区上、无目标牌过了
   * 打出线才算打出，其余一律回弹——不消耗气，是拖到一半反悔的防误触。
   *
   * 确认设置（todos/21 的 confirmPlay）在这里**不问**：点击是「可能点错」，
   * 把牌拽过半个屏幕再松手就是明确意图本身，再问一遍只剩烦人——这是
   * 拖拽绕过二次确认的取舍，todo 点名要说明。
   */
  private onCardDragEnd(view: CardView, p: Phaser.Input.Pointer): void {
    // 这记 dragend 后面还跟着同一记抬手的 pointerup（Phaser 先派 drag 后派
    // up）——无论这场拖是在这里正常收尾还是 Esc 里已经取消（dragUid 已空），
    // 那记 pointerup 都不是点击。压制账一次性消费，兜底给一拍清掉：
    // 抬手落在牌外时 pointerup 不打到牌上，账不能烂在手里挡住下一次真点击。
    this.clickSuppressedUid = view.uid;
    this.time.delayedCall(dur(80), () => {
      if (this.clickSuppressedUid === view.uid) this.clickSuppressedUid = null;
    });
    if (this.dragUid !== view.uid) return;
    this.dragUid = null;
    this.endDragVisuals();

    const living = this.roster.living();
    const call = dropVerdict(
      view.def.target,
      toDesign(p.x),
      toDesign(p.y),
      living.map((v) => v.hit),
    );
    if (call.verdict === 'bounce') {
      this.bounceBack(view);
      return;
    }
    const targetId = call.enemyIndex === undefined ? undefined : living[call.enemyIndex]?.enemy.id;
    void this.play(view.uid, targetId);
  }

  /** 拖拽视觉清场：占位影子、箭头、敌人高亮、伤害预览一起收。松手与取消共用。 */
  private endDragVisuals(): void {
    this.dragGhost?.destroy();
    this.dragGhost = null;
    this.arrow.clear();
    this.setHpPreview(null, null);
    for (const v of this.roster.all()) v.sprite.clearTint();
  }

  /** Esc 的取消 (k3)：牌回弹回手位，气一分不动。没在拖时无害空转。 */
  private cancelDrag(): void {
    if (!this.dragUid) return;
    const view = this.cardViews.get(this.dragUid);
    this.dragUid = null;
    this.endDragVisuals();
    if (view) this.bounceBack(view);
  }

  // ------------------------------------------- HP 条伤害预览 (todos/24 k5)

  /**
   * 选敌/拖拽攻击卡悬停目标时，把「这一击会打掉的段」标到目标 HP 条上；
   * 会致死时条身闪烁、条旁挂朱红「必杀」小签。任一参数传 null 即收——
   * 取消选择/拖走时预览消失。
   *
   * 伤害数字走引擎的 `previewValues`——与卡面同一套算法，目标破绽、神力
   * 全折进去；多段攻击（hits×n）按总伤算。段几何在 `hpPreview.ts`（纯函数），
   * 非指向牌/丹药递进来算不出段，各自的门不必再拦一道。
   */
  private setHpPreview(uid: string | null, enemyId: string | null): void {
    const view = uid ? this.cardViews.get(uid) : undefined;
    const enemy = enemyId ? this.state.enemies.find((e) => e.id === enemyId) : undefined;
    let next: { enemyId: string; seg: HpPreviewSeg } | null = null;
    if (view && enemy?.alive && view.def.target === 'enemy') {
      const { D, T } = previewValues(this.state, view.def, enemy);
      const seg = hpPreviewSeg(enemy.hp, enemy.maxHp, enemy.block, D, T);
      if (seg) next = { enemyId: enemy.id, seg };
    }

    // 拖拽每帧都问一遍——同目标同段直接走人，免得闪烁 tween 被逐帧重启。
    const key = next
      ? `${next.enemyId}:${next.seg.from}:${next.seg.to}:${next.seg.lethal}`
      : '';
    if (key === this.hpPreviewKey) return;
    this.hpPreviewKey = key;

    // 收旧的：闪烁停、透明度归位、小签销毁。
    if (this.hpPreview) {
      const old = this.roster.get(this.hpPreview.enemyId);
      if (old) {
        this.tweens.killTweensOf(old.bar);
        old.bar.setAlpha(1);
      }
    }
    this.killTag?.destroy();
    this.killTag = null;

    this.hpPreview = next;
    this.paintHpBars();
    if (!next || !next.seg.lethal) return;

    const target = this.roster.get(next.enemyId);
    if (!target) return;
    // 必杀：条身闪烁。警示循环故意不过 dur()——同致死意图的脉冲一个理
    // （timing.ts 文件头），加速档里警报变快只会像坏了。
    this.tweens.add({
      targets: target.bar,
      alpha: 0.35,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    // 「必杀」小签（inkPanel 样式），挂条右侧——左侧是护甲徽章的位置。
    const tagW = 48;
    const tagH = 24;
    const tag = this.add.container(target.barWidth / 2 + 6, 21);
    const bg = inkPanel(this, 0, -tagH / 2, tagW, tagH, { border: C.cinnabarBright });
    const label = this.add
      .text(tagW / 2, 1, '必杀', brushStyle(16, C.cinnabarBright))
      .setOrigin(0.5);
    tag.add([bg, label]);
    target.ui.add(tag);
    this.killTag = tag;
  }

  /** 回弹：tween 回扇形原位。落空、取消共用的一条路——不走 playCard。 */
  private bounceBack(view: CardView): void {
    view.setDepth(DEPTH.hand + this.state.hand.indexOf(view.uid));
    this.tweens.add({
      targets: view,
      x: view.homeX,
      y: view.homeY,
      angle: view.homeAngle,
      // 回 homeScale 不回 1 (k6)：Tab 展开排在 9-10 张时整排微缩过。
      scale: view.homeScale,
      duration: dur(220),
      ease: 'Back.easeOut',
    });
  }

  // ------------------------------------------------------------- interaction

  private onEnemyOver(view: EnemyView, over: boolean): void {
    if (this.finished || !view.enemy.alive) return;
    // Only light up while a card or potion is actually waiting for a target.
    if (over && (this.selectedUid || this.selectedPotion !== null)) view.sprite.setTint(0xffcfae);
    else view.sprite.clearTint();
    // HP 条伤害预览 (todos/24 k5)：点击选敌模式下悬停目标点亮，移开即收。
    // 收的时候认目标——迟到的 pointerout 不许把新目标刚点亮的预览带走。
    if (over) this.setHpPreview(this.selectedUid, view.enemy.id);
    else if (this.hpPreview?.enemyId === view.enemy.id) this.setHpPreview(null, null);
  }

  private onEnemyClick(view: EnemyView): void {
    this.cancelAutoEnd();
    if (this.busy || this.finished || !view.enemy.alive) return;

    if (this.selectedPotion !== null) {
      const slot = this.selectedPotion;
      this.selectedPotion = null;
      this.arrow.clear();
      void this.drinkPotion(slot, view.enemy.id);
      return;
    }

    if (!this.selectedUid) return;
    // 打牌确认 (todos/21 t3) 高亮中的非指向牌：点敌人是「别处」，取消而
    // 不是打出——不然一张全体攻击会被当成打给了谁。
    const selected = this.cardViews.get(this.selectedUid);
    if (selected && selected.def.target !== 'enemy') {
      this.clearSelection();
      return;
    }
    const uid = this.selectedUid;
    this.selectedUid = null;
    this.arrow.clear();
    this.cardViews.get(uid)?.setSelected(false);
    void this.play(uid, view.enemy.id);
  }

  private async play(uid: string, targetId?: string): Promise<void> {
    const view = this.cardViews.get(uid);
    if (!view) return;
    const def = view.def;

    this.busy = true;
    // 兜底收预览 (k5)：点敌人打出、数字键直打都从这过——真伤害要落条了，
    // 预告没有留到结算动画里的道理。
    this.setHpPreview(null, null);

    // Sweep the card up to centre stage, then burst it into ink.
    this.tweens.add({
      targets: view,
      x: GAME_WIDTH / 2,
      y: 300,
      angle: 0,
      scale: 1.12,
      duration: dur(150),
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: view,
      alpha: 0,
      scale: 0.86,
      delay: dur(170),
      duration: dur(150),
      ease: 'Quad.easeIn',
    });
    await this.wait(150);
    burst(this, GAME_WIDTH / 2, 300, {
      color: def.type === 'attack' ? 0xe8543c : def.type === 'power' ? 0xf0d67a : 0x6fb0a0,
      count: 12,
      speed: 240,
      scale: 0.13,
    });

    // Take the view out of the map before playing so syncHand doesn't also try
    // to fly the same card to the discard pile.
    this.cardViews.delete(uid);
    view.destroy();

    const energyBefore = this.state.energy;
    if (!playCard(this.state, uid, targetId)) {
      this.busy = false;
      this.syncHand();
      this.refresh();
      return;
    }
    // 埋点 (todos/22)：打出即记。没有对应的 CombatEvent 可数——引擎不为
    // 一次成功的 `playCard` 发事件——所以在唯一的调用点数返回值。
    this.run.stats.cardsPlayed += 1;
    // 打出即声 (todos/20 b5)：按牌类型分刀/谋/势。和上面的埋点同理，
    // 打出本身没有事件，音效也只能在唯一的调用点接。气真扣了才响
    // energy-spend——0 费牌白喊一声「消耗」是谎报。
    this.audio.play(cardPlaySfx(def.type));
    if (this.state.energy < energyBefore) this.audio.play('energy-spend');

    if (def.type === 'attack') {
      await this.lunge(this.playerView, 1, 76, 110);
    } else if (def.type === 'power') {
      // 势的登坛拍 (动画优化)：金焰从脚下升起——一张永久改写战局的牌
      // 进场，不能只是屏幕中央 12 颗金粒子一闪而过。
      riseFlare(this, PLAYER_X, BASELINE_Y - 6);
    }

    await this.playEvents();
    await this.settleChoices();
    this.syncHand();
    this.refresh();
    this.busy = false;
    // After `checkOutcome`, never before: a fight that just ended is `finished`
    // by then, and `autosave` steps aside for the screen that owns the payout.
    this.checkOutcome();
    this.autosave();
    // 自动结束回合 (todos/21 t3) 只在这里挂：todo 钉的是「每次 playCard
    // 结算完检查」——用丹药、开新回合都不代按。
    this.scheduleAutoEnd();
  }

  /**
   * A card that stopped to ask something holds the whole fight: the grid is
   * opened with no way out, and the engine refuses every other action until it
   * is answered. One card can ask more than once, hence the loop.
   */
  private async settleChoices(): Promise<void> {
    while (this.state.pendingChoice) {
      const choice = this.state.pendingChoice;
      const title = choice.kind === 'exhaust' ? '消 耗' : choice.kind === 'putOnDraw' ? '置 顶' : '弃 牌';

      await new Promise<void>((resolve) => {
        openCardGrid(this, {
          title,
          subtitle: `选 ${choice.min} 张`,
          entries: choice.options.map((uid) => {
            const inst = this.state.cards[uid];
            return { uid, defId: inst.defId, upgraded: inst.upgraded };
          }),
          mode: 'pick',
          pickCount: choice.min,
          state: this.state,
          // No `onClose`: the pick is mandatory, which is what the engine's
          // frozen state already assumes.
          onPick: (uids) => {
            resolveChoice(this.state, uids);
            resolve();
          },
        });
      });

      this.syncHand();
      await this.playEvents();
    }
  }

  /** Step an actor toward its foe and let it drift back on its own. */
  private async lunge(
    view: ActorView,
    dir: number,
    distance = 60,
    ms = 92,
  ): Promise<void> {
    dust(this, view.container.x + dir * 24, BASELINE_Y + 2, dir);
    this.tweens.add({
      targets: view.container,
      x: view.baseX + dir * distance,
      duration: dur(ms),
      ease: 'Quad.easeIn',
    });
    await this.wait(ms);
    this.tweens.add({
      targets: view.container,
      x: view.baseX,
      delay: dur(90),
      duration: dur(340),
      ease: 'Back.easeOut',
    });
  }

  /**
   * Put the enemy that just acted back on its own ground.
   *
   * `enemyMove` winds the body up to `baseX + 30` and **nothing else ever
   * returns it**: `lunge` is the only tween that writes `baseX` back, and the
   * scene only lunges an enemy that is about to hit the player. So every move
   * with no `damage` — 董卓亲兵's 格挡, 乱民's 抱团, 张宝's 符阵, 张曼成's 呼旗,
   * every 强化 and every 上状态 an 精英 or 首领 owns — parked the sprite 30 px
   * to the right of its own HP bar, name plate, intent badge and hit zone, for
   * the rest of the fight. Measured across all four acts that is 18% of every
   * move executed, and almost every elite and boss in the game triggers it.
   *
   * Guarded on `active`: a body that 遁走'd or split mid-batch has already been
   * destroyed, and tweening a destroyed Container throws.
   */
  private settleAttacker(): void {
    const view = this.currentAttacker;
    this.currentAttacker = null;
    if (!view || !view.container.active) return;
    this.tweens.killTweensOf(view.container);
    this.tweens.add({
      targets: view.container,
      x: view.baseX,
      duration: dur(240),
      ease: 'Quad.easeOut',
    });
  }

  /** Knock an actor back from an impact, without disturbing its container. */
  private recoil(view: ActorView, dir: number): void {
    this.tweens.killTweensOf(view.sprite);
    view.sprite.x = view.spriteBaseX;
    this.tweens.add({
      targets: view.sprite,
      x: view.spriteBaseX + dir * 16,
      duration: dur(70),
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeOut',
      onComplete: () => {
        view.sprite.x = view.spriteBaseX;
        // Restore the idle breath the kill above interrupted.
        // （环境循环，故意不过 dur()——见 makeActorView。）
        this.tweens.add({
          targets: view.sprite,
          scaleY: view.baseScaleY * 1.016,
          duration: 1700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });
  }

  /** Aim point for effects — roughly the actor's torso. */
  private torso(view: ActorView): { x: number; y: number } {
    return { x: view.container.x, y: BASELINE_Y - view.height * 0.55 };
  }

  /**
   * Impact flash. Tinting the sprite itself with `setTintFill` flattens it into
   * a solid white silhouette, which reads as a glitch against painterly art —
   * so this lights up an additive copy instead, keeping all the detail.
   */
  private flashHit(view: ActorView): void {
    const flash = this.add
      .image(
        view.container.x + view.sprite.x,
        BASELINE_Y + view.sprite.y,
        view.sprite.texture.key,
      )
      .setOrigin(0.5, 1)
      .setScale(view.sprite.scaleX, view.sprite.scaleY)
      .setFlipX(view.sprite.flipX)
      .setTintFill(0xffdcc0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.62)
      .setDepth(DEPTH.actors + 1);

    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: dur(170),
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private async onEndTurn(): Promise<void> {
    this.cancelAutoEnd();
    if (this.busy || this.finished || this.state.phase !== 'player') return;
    // 拖到一半按 E (k3)：先把牌弹回手位再谈结束——回合一换，拖着的牌
    // 已不是能打的牌。
    this.cancelDrag();
    // 结束确认 (todos/21 t3)：气未用尽且手里还有可打的牌，先弹气泡等一句
    // 准话；气泡已在，这一按——再按 E、点气泡、再点按钮——就是确认。
    // 气为 0 或无可打牌不问，直接结束。自动结束也从这里过，但它触发的
    // 前提就是无可打牌，撞不上气泡。
    if (this.endTurnConfirm) {
      this.dismissEndTurnConfirm();
    } else if (needsEndTurnConfirm(this.state)) {
      this.clearSelection();
      this.showEndTurnConfirm();
      return;
    }
    this.clearSelection();
    this.busy = true;

    endPlayerTurn(this.state);
    await this.playEvents();
    this.syncHand();
    this.refresh();

    await turnBanner(this, GAME_WIDTH, GAME_HEIGHT, '敌 方 回 合', C.cinnabarBright);

    runEnemyTurn(this.state);
    await this.playEvents();
    // The last swing of the turn goes home too — `playEvents` only settles a
    // body when the *next* enemy steps up, and the last one has no next.
    this.settleAttacker();
    this.syncHand();
    this.refresh();

    // Fire-and-forget: the band sweeps past while the new hand deals itself in,
    // so the player's turn never waits on it.
    if (this.state.phase === 'player') {
      void turnBanner(this, GAME_WIDTH, GAME_HEIGHT, '我 方 回 合', C.goldBright);
    }

    this.busy = false;
    this.checkOutcome();
    this.autosave();
  }

  // ------------------------------------------------- 确认与自动结束 (t3)

  /**
   * 结束确认的小气泡——inkPanel 一块、两行字、一个点击区，悬在结束回合
   * 按钮上方。原版就是气泡不是模态框：不冻结任何东西，场上照常可点，
   * 「点别处 / Esc 取消」在 create 的两个输入口接，「确认」有三条路——
   * 再按 E、点气泡本体、再点结束回合按钮——全都汇进 onEndTurn。
   */
  private showEndTurnConfirm(): void {
    const w = 236;
    const h = 58;
    const bubble = this.add.container(1148, 494).setDepth(DEPTH.float);
    bubble.add(inkPanel(this, -w / 2, -h / 2, w, h, { border: C.goldBright }));
    bubble.add(
      this.add
        .text(0, -10, `气还剩 ${this.state.energy} 点，结束回合？`, bodyStyle(15, C.paper))
        .setOrigin(0.5),
    );
    bubble.add(
      this.add.text(0, 11, '再按 E 或点此确认', bodyStyle(12, C.paperFaint)).setOrigin(0.5),
    );
    // Hit target on a Zone, same reason as `inkButton`: Containers have no
    // Origin component to normalise their own hit area against.
    const hit = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => void this.onEndTurn());
    bubble.add(hit);
    bubble.setAlpha(0);
    this.tweens.add({
      targets: bubble,
      alpha: 1,
      y: 488,
      duration: dur(120),
      ease: 'Quad.easeOut',
    });
    this.endTurnConfirm = bubble;
  }

  /** 收气泡。确认与取消共用——先放引用再销毁，销毁路上没人再摸得到它。 */
  private dismissEndTurnConfirm(): void {
    const bubble = this.endTurnConfirm;
    if (!bubble) return;
    this.endTurnConfirm = null;
    this.tweens.killTweensOf(bubble);
    bubble.destroy();
  }

  /**
   * 自动结束回合 (todos/21 t3)：`play` 的收尾问一次 `shouldAutoEndTurn`——
   * 开着设置、轮到玩家、手里再无可打的牌——是则 700ms 后代按结束。定时器
   * 攥在 `autoEndTimer` 里，玩家的任何操作都先 `cancelAutoEnd` 掐掉它：
   * 想留一手用丹药的人不该被抢走回合。
   */
  private scheduleAutoEnd(): void {
    this.cancelAutoEnd();
    if (this.finished || !shouldAutoEndTurn(this.state)) return;
    this.autoEndTimer = this.time.delayedCall(dur(AUTO_END_DELAY_MS), () => {
      this.autoEndTimer = null;
      void this.onEndTurn();
    });
  }

  /** 掐掉倒数中的自动结束。没在倒数时无害空转——所有输入口都先过这里。 */
  private cancelAutoEnd(): void {
    this.autoEndTimer?.remove(false);
    this.autoEndTimer = null;
  }

  // -------------------------------------------------------------- animation

  /**
   * 动画速度 (todos/21 t2)：`dur()` 在这里换算一次，所有 `await this.wait(…)`
   * 的调用点保持原始毫秒——传进来之前**不要**再包一层 `dur()`，会双重加速。
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.time.delayedCall(dur(ms), resolve);
    });
  }

  private async playEvents(): Promise<void> {
    const events = this.state.events.splice(0);
    // 统计埋点 (todos/22)：约定 8 不让引擎写 RunState，所以账走事件回传，
    // 在 drain 的这一下入账——每个事件恰好经过这里一次，`finished` 只跳过
    // 动画，不跳过记账。
    this.fightDamageTaken += recordCombatEvents(this.run.stats, events, this.state.player.id);
    for (const ev of events) {
      // 死因 (todos/22 s3)：在同一个 drain 点记「谁刚动了手」——`playEvent`
      // 在 `finished` 后会跳过动画，账不能跟着丢。
      if (ev.t === 'enemyMove') {
        this.lastEnemyMoveName =
          this.state.enemies.find((e) => e.id === ev.enemyId)?.name ?? this.lastEnemyMoveName;
      }
    }
    // 抽牌音 (todos/20 b5)：本批第 n 张 detune n*60 递增（`drawCue`），
    // 60ms 错峰——和 `syncHand` 发牌的 60ms 节奏一致，也让每声都落在 b3 的
    // 40ms 限流窗之外，五连抽是五声上行而不是被吞剩一声。
    // 这 60ms 故意不过 dur()：÷1.6 就掉进限流窗，快速挡五连抽只剩一声。
    if (!this.finished) {
      let drawn = 0;
      for (const ev of events) {
        if (ev.t !== 'draw') continue;
        const cue = drawCue(drawn);
        this.time.delayedCall(drawn * 60, () => this.audio.play(cue.id, cue.opts));
        drawn += 1;
      }
    }
    // 合并分组 (todos 动画优化)：连续打在敌人身上的 damage 并成连击/横扫
    // 一场戏——语义在 `eventGroups.ts`（纯函数），怎么演在 playMultiHit /
    // playAoe。`finished` 的跳过规矩不变：damage 组里不含 death，整组跳。
    for (const group of groupCombatEvents(events)) {
      if (group.kind !== 'one') {
        if (this.finished) continue;
        if (group.kind === 'multiHit') await this.playMultiHit(group.events);
        else await this.playAoe(group.events);
        continue;
      }
      const ev = group.ev;
      if (this.finished && ev.t !== 'death') continue;
      await this.playEvent(ev);
    }
  }

  private async playEvent(ev: CombatEvent): Promise<void> {
    // 事件驱动音效 (todos/20 b5)：查 `sfxForEvent` 的表，在各自动画起手的
    // 这一帧发声。两类例外：`damage` 在 `playDamage` 里播——它的响声必须
    // 对齐 hitstop 那一帧，不是排水这一帧；`draw` 在 `playEvents` 里按批
    // 内序号错峰。多段攻击（`hits: 3`）不叠爆音靠 b3 的 40ms 限流。
    if (ev.t !== 'damage' && ev.t !== 'draw') {
      for (const cue of sfxForEvent(ev)) this.audio.play(cue.id, cue.opts);
    }
    switch (ev.t) {
      case 'damage':
        await this.playDamage(ev);
        break;

      case 'block': {
        const view = this.viewOf(ev.targetId);
        if (view) {
          const at = this.torso(view);
          shieldFlare(this, at.x, at.y, view.height * 0.34);
          popText(this, at.x, at.y - 16, `+${ev.amount} 护甲`, { color: 0xdcefff, size: 25 });
          this.popBadge(view.blockBadge);
        }
        this.refreshBars();
        await this.wait(150);
        break;
      }

      case 'status': {
        const view = this.viewOf(ev.targetId);
        const meta = STATUS_META[ev.status];
        if (view) {
          const at = this.torso(view);
          // 状态环用状态自己的颜色，增益上浮、减益下沉——曾与护甲的蓝环
          // 完全撞脸，配色 + 方向一起把三类分开（vfx.FlareOpts）。
          const buff = meta.kind === 'buff';
          shieldFlare(this, at.x, at.y, view.height * 0.3, {
            colors: [meta.color, buff ? 0xfff2d8 : 0x4a3a52],
            driftY: buff ? -18 : 18,
          });
          popText(this, at.x, at.y - 30, `${meta.label} +${ev.amount}`, {
            color: meta.color,
            size: 26,
          });
        }
        this.refreshBars();
        await this.wait(160);
        break;
      }

      case 'statusBlocked': {
        const view = this.viewOf(ev.targetId);
        if (view) {
          const at = this.torso(view);
          shieldFlare(this, at.x, at.y, view.height * 0.3);
          popText(this, at.x, at.y - 30, `抵消【${STATUS_META[ev.status].label}】`, {
            color: STATUS_META.artifact.color,
            size: 24,
          });
        }
        this.refreshBars();
        await this.wait(160);
        break;
      }

      case 'exhaust':
        // 消耗不是弃牌：还在手上的牌当场烧掉（burnCard），不再和弃牌一样
        // 飞向弃牌堆——「这张牌没了」和「这张牌回收了」必须看得出区别。
        // 打出的那张（play 已销毁 view）与牌堆里烧的，落角落的灰字。
        this.burnCard(ev.uid);
        popText(this, EXHAUST_PILE.x, EXHAUST_PILE.y - 26, '消耗', {
          color: C.paperFaint,
          size: 19,
          drift: 34,
        });
        await this.wait(120);
        break;

      case 'death':
        await this.playDeath(ev.targetId);
        break;

      case 'enemyMove': {
        const view = this.roster.get(ev.enemyId);
        // Whoever swung last goes home first — two enemies acting in one turn
        // must not leave the first one leaning.
        this.settleAttacker();
        if (view) {
          this.currentAttacker = view;
          // The 致死 pulse is an endless yoyo on the same property this is
          // about to tween; left running, the badge would never finish leaving.
          this.tweens.killTweensOf(view.intent);
          // Wind-up: lean away from the player, and pop the intent badge out.
          this.tweens.add({
            targets: view.container,
            x: view.baseX + 30,
            duration: dur(170),
            ease: 'Quad.easeOut',
          });
          this.tweens.add({
            targets: view.intent,
            scale: 1.3,
            alpha: 0,
            duration: dur(240),
            ease: 'Quad.easeOut',
          });
          popText(this, view.baseX, BASELINE_Y - view.height - 46, ev.label, {
            color: C.goldBright,
            size: 27,
            drift: 40,
          });
        }
        await this.wait(280);
        break;
      }

      case 'relic':
        this.relicBar.flash(ev.relicId);
        await this.wait(120);
        break;

      case 'potion': {
        const def = getPotion(ev.potionId);
        const at = this.torso(this.playerView);
        burst(this, at.x, at.y, { color: def.color, count: 16, speed: 220, scale: 0.16 });
        popText(this, PLAYER_X, BASELINE_Y - this.playerView.height - 24, `【${def.name}】`, {
          color: def.color,
          size: 26,
          drift: 40,
        });
        await this.wait(180);
        break;
      }

      case 'heal': {
        const view = this.viewOf(ev.targetId);
        if (view) {
          const at = this.torso(view);
          // 全场最寒酸的正反馈补一口气：玉色光尘上浮，数字抬一号。
          healMotes(this, at.x, at.y);
          popText(this, at.x, at.y - 30, `+${ev.amount}`, { color: C.jade, size: 30 });
          // The trailing bar can't lag behind a gain, or the next hit drains
          // from a stale, lower value.
          view.ghost.value = this.hpOf(ev.targetId);
        }
        this.paintHpBars();
        await this.wait(150);
        break;
      }

      case 'passive': {
        const at = this.torso(this.playerView);
        // A bannered relic still owns an icon in the bar — light that too.
        const relic = relicByBanner(ev.label);
        if (relic) this.relicBar.flash(relic.id);
        screenPulse(this, GAME_WIDTH, GAME_HEIGHT, 0xc9a227, 0.16, 360);
        burst(this, at.x, at.y, { color: 0xf0d67a, count: 20, speed: 260, scale: 0.2 });
        popText(this, PLAYER_X, BASELINE_Y - this.playerView.height - 24, `【${ev.label}】`, {
          color: C.goldBright,
          size: 27,
          drift: 44,
        });
        await this.wait(200);
        break;
      }

      case 'shuffle': {
        popText(this, DRAW_PILE.x, DRAW_PILE.y - 26, '洗牌', {
          color: C.paperDim,
          size: 19,
          drift: 34,
        });
        await this.wait(140);
        break;
      }

      case 'steal': {
        // 约定 8: the engine never touches `RunState`, so this is where a theft
        // is actually paid. `theftSeq` is the idempotency key — a fight that is
        // re-entered cannot be charged twice for the same steal.
        const paid = payTheft(this.run, this.nodeId, this.theftSeq++, ev.amount);
        const view = this.roster.get(ev.enemyId);
        const at = view ? this.torso(view) : { x: PLAYER_X, y: BASELINE_Y - 120 };
        if (paid > 0) {
          popText(this, at.x, at.y - 30, `夺 ${paid} 资财`, { color: C.goldBright, size: 27 });
        } else {
          popText(this, at.x, at.y - 30, '囊中已空', { color: C.paperFaint, size: 22 });
        }
        await this.wait(180);
        break;
      }

      case 'summon':
        await this.playSummon(ev);
        break;

      case 'split':
        await this.playSplit(ev);
        break;

      case 'escape':
        await this.playEscape(ev);
        break;

      case 'shout': {
        // A threshold line — 「困兽犹斗！」, 「化身千万！」 — over the enemy's own
        // head, in brush script rather than as a damage number, because it is
        // speech. Held long enough to be read before the split it announces.
        const view = this.roster.get(ev.enemyId);
        const x = view ? view.container.x : GAME_WIDTH / 2;
        const height = view ? view.height : 240;
        popText(this, x, BASELINE_Y - height - 74, ev.text, {
          color: C.cinnabarBright,
          size: 30,
          drift: 26,
        });
        screenPulse(this, GAME_WIDTH, GAME_HEIGHT, C.cinnabar, 0.1, 420);
        await this.wait(520);
        break;
      }

      case 'draw':
      case 'discard':
        // Both are already drawn: `syncHand` deals new views out of the draw
        // pile and flies departing ones to the discard, off the state's own
        // arrays. There is nothing left for an event to animate.
        break;
    }
  }

  // ------------------------------------------------------- 敌阵的增减

  /**
   * Build the bodies a change calls for, retire the ones it drops, and re-form
   * the line if it grew.
   *
   * Every caller goes through here so that the three rules in `stageChange`
   * hold in one place: a corpse is never dropped, a runaway always is, and the
   * line only ever re-slots when it got longer. Newborns are hidden rather than
   * scaled — the roster owns `crowdScale`, and a second tween on the same
   * property would fight it.
   */
  private async applyStage(change: StageChange, spawnX: number): Promise<EnemyView[]> {
    const born: EnemyView[] = [];
    for (const id of change.add) {
      const enemy = this.state.enemies.find((e) => e.id === id);
      if (!enemy) continue;
      const view = this.addEnemyView(enemy, spawnX);
      view.container.setAlpha(0).setY(BASELINE_Y + 24);
      view.ui.setAlpha(0);
      view.nameText.setAlpha(0);
      view.intent.setAlpha(0);
      born.push(view);
    }
    for (const id of change.drop) this.removeEnemyView(id);
    // Awaited: a hit zone still travelling is a click that lands on nothing.
    if (change.relayout) await this.relayoutEnemies(true);
    return born;
  }

  /** Fade newborns up on the spot the roster just walked them to. */
  private async raise(born: EnemyView[]): Promise<void> {
    born.forEach((view, i) => {
      const delay = dur(i * 60);
      this.time.delayedCall(delay, () => dust(this, view.container.x, BASELINE_Y + 2, 1));
      this.tweens.add({
        targets: view.container,
        alpha: 1,
        y: BASELINE_Y,
        delay,
        duration: dur(180),
        ease: 'Cubic.easeOut',
      });
      this.tweens.add({
        targets: [view.ui, view.nameText, view.intent],
        alpha: 1,
        delay,
        duration: dur(180),
      });
    });
    if (born.length > 0) await this.wait(180 + born.length * 60 + 120);
  }

  /**
   * 召唤. The summoner leans into the call, the line opens up to make room, and
   * only then do the new bodies rise out of the dust at its feet.
   *
   * `summonEnemies` has already appended them to `state.enemies` and already
   * rolled their intents, so the next `refreshBars` telegraphs them with no
   * further help from here.
   */
  private async playSummon(ev: Extract<CombatEvent, { t: 'summon' }>): Promise<void> {
    const summoner = this.roster.get(ev.enemyId);
    if (summoner) {
      this.tweens.add({
        targets: summoner.container,
        x: summoner.baseX - 22,
        duration: dur(110),
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    }
    await this.wait(220);

    const change = stageChange(ev);
    if (!change) return;
    const born = await this.applyStage(change, summoner?.baseX ?? GAME_WIDTH / 2);
    await this.raise(born);
    this.refreshBars();
  }

  /**
   * 分裂. The parent does **not** die — `splitEnemy` emits no `death` event on
   * purpose, because a split must not pay 斩将 or any other kill trigger — so
   * this is the only thing that ever takes its body off the screen. Before the
   * roster's `remove`, that sprite stood there for the rest of the fight; it is
   * the whole reason 张宝 was fenced out of the map.
   *
   * Deliberately not the death animation: no ink splash (that is blood), no
   * topple. Two mirrored after-images tear away from a body that collapses
   * inward — the read is 「it became two」, not 「it fell」.
   */
  private async playSplit(ev: Extract<CombatEvent, { t: 'split' }>): Promise<void> {
    const parent = this.roster.get(ev.parentId);
    const anchor = parent?.baseX ?? GAME_WIDTH / 2;

    if (parent) {
      parent.hit.disableInteractive();
      this.tweens.killTweensOf(parent.sprite);

      for (const dir of [-1, 1]) {
        const echo = this.add
          .image(parent.container.x, BASELINE_Y, parent.sprite.texture.key)
          .setOrigin(0.5, 1)
          .setScale(parent.sprite.scaleX * parent.crowdScale, parent.sprite.scaleY * parent.crowdScale)
          .setFlipX(dir < 0)
          .setTintFill(0xdcefff)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setAlpha(0.55)
          .setDepth(DEPTH.actors + 1);
        this.tweens.add({
          targets: echo,
          x: parent.container.x + dir * 90,
          alpha: 0,
          duration: dur(320),
          ease: 'Quad.easeOut',
          onComplete: () => echo.destroy(),
        });
      }

      screenPulse(this, GAME_WIDTH, GAME_HEIGHT, 0xdcefff, 0.12, 320);
      this.tweens.add({
        targets: parent.container,
        scaleX: 0.04,
        alpha: 0,
        duration: dur(320),
        ease: 'Quad.easeIn',
      });
      this.tweens.add({
        targets: [parent.ui, parent.nameText, parent.intent],
        alpha: 0,
        duration: dur(220),
      });
      await this.wait(320);
    }

    const change = stageChange(ev);
    if (!change) return;
    const born = await this.applyStage(change, anchor);
    await this.raise(born);
    screenPulse(this, GAME_WIDTH, GAME_HEIGHT, C.paper, 0.08, 300);
    this.refreshBars();
  }

  /**
   * 遁走. Must be tellable apart from a death at a glance, because the two pay
   * out differently: a kill drops loot and fires 枭首令, a thief who got away
   * drops nothing and keeps the purse it just lifted.
   *
   * So: a death topples backwards into an ink splash; this slides off the right
   * edge on its own feet, upright, trailing dust. And the body is *destroyed*
   * rather than left as a corpse — the frozen sprite that used to stay behind
   * is the other half of why 流寇 was fenced out of the map.
   */
  private async playEscape(ev: Extract<CombatEvent, { t: 'escape' }>): Promise<void> {
    const view = this.roster.get(ev.targetId);
    if (view) {
      view.hit.disableInteractive();
      this.tweens.killTweensOf(view.sprite);
      dust(this, view.container.x, BASELINE_Y + 2, -1);
      popText(this, view.container.x, BASELINE_Y - view.height - 40, '遁走', {
        color: C.paperDim,
        size: 27,
        drift: 34,
      });
      this.tweens.add({
        targets: view.container,
        x: GAME_WIDTH + 240,
        y: BASELINE_Y + 26,
        alpha: 0,
        duration: dur(420),
        ease: 'Quad.easeIn',
      });
      this.tweens.add({
        targets: [view.ui, view.nameText, view.intent],
        alpha: 0,
        duration: dur(260),
      });
      await this.wait(440);
    }

    const change = stageChange(ev);
    if (!change) return;
    // No re-slot: the survivors hold their ground. See `StageChange.relayout`.
    await this.applyStage(change, 0);
    this.refreshBars();
  }

  private async playDamage(ev: Extract<CombatEvent, { t: 'damage' }>): Promise<void> {
    const view = this.viewOf(ev.targetId);
    if (!view) return;

    const hitsPlayer = ev.targetId === 'player';

    // An enemy mid-move actually reaches across before each of its hits.
    if (hitsPlayer && this.currentAttacker) {
      await this.lunge(this.currentAttacker, -1, 52, 90);
    }

    const at = this.torso(view);

    // Fully absorbed: read as a parry, not a wound. 只有甲声，没有闷响——
    // `sfxForEvent` 对 amount 0 恰好只吐 block-break。
    if (ev.amount === 0 && ev.blocked > 0) {
      for (const cue of sfxForEvent(ev)) this.audio.play(cue.id, cue.opts);
      shieldFlare(this, at.x, at.y, view.height * 0.36);
      burst(this, at.x, at.y, { color: 0x9fc4e0, count: 10, speed: 190, scale: 0.12 });
      popText(this, at.x, at.y - 20, `挡下 ${ev.blocked}`, { color: 0xdcefff, size: 26 });
      screenShake(this, 90, 0.002);
      this.paintHpBars();
      await this.wait(180);
      return;
    }

    const heavy = ev.amount >= 12;
    slash(this, at.x, at.y, {
      angle: hitsPlayer ? 208 : -32,
      length: heavy ? 260 : 205,
      thickness: heavy ? 38 : 28,
    });
    burst(this, at.x, at.y, {
      color: hitsPlayer ? 0xff9a7a : 0xffd8a8,
      count: heavy ? 24 : 15,
      speed: heavy ? 400 : 300,
    });
    // 命中音落在 hitstop 开始的这一帧 (todos/20 b5)：`hitStop` 只缩放
    // `tweens.timeScale`，同步 play 而不 await 后补，声音的 attack 才咬住
    // 动画卡顿。三档闷响 + 甲裂声都从 `sfxForEvent` 的同一张表来。
    for (const cue of sfxForEvent(ev)) this.audio.play(cue.id, cue.opts);
    hitStop(this, heavy ? 0.16 : 0.32, heavy ? 95 : 60);
    screenShake(this, heavy ? 200 : 110, heavy ? 0.007 : 0.0032);
    this.recoil(view, hitsPlayer ? 1 : -1);
    this.flashHit(view);

    popText(this, at.x, at.y - 52, `-${ev.amount}`, {
      color: C.cinnabarBright,
      size: heavy ? 46 : 34,
    });
    if (ev.blocked > 0) {
      popText(this, at.x + 54, at.y + 12, `挡 ${ev.blocked}`, { color: 0x9fc4e0, size: 20 });
    }
    if (hitsPlayer) {
      screenPulse(this, GAME_WIDTH, GAME_HEIGHT, 0x8b2020, heavy ? 0.26 : 0.13, 460);
    }

    this.drainGhost(view, this.hpOf(ev.targetId));
    this.paintHpBars();
    await this.wait(heavy ? 205 : 150);
  }

  /**
   * 连击（`times: N` 的多段攻击）的合并展示。逐段复读 `playDamage` 的老演法
   * 是同一刀原地重放 N 次，且 heavy 逐段判——力战无将 5×5 永远拿不到重击
   * 表现。这里改成：斩击左右换边、越砍越长，段间收紧到 120ms，伤害数字
   * 逐段小字错位；末段按**累计**伤害定档——重顿帧配重闷响的纪律
   * （combatSfx.ts 的同档约定）在合并后依然成立，只是尺子换成了整套连击
   * 的分量。收尾一个「共 -N」大字 + 拖影一次排到位。
   */
  private async playMultiHit(events: DamageEv[]): Promise<void> {
    const view = this.viewOf(events[0].targetId);
    if (!view) return;
    const at = this.torso(view);
    const total = groupTotal(events);
    const heavy = total >= 12;

    for (const [k, ev] of events.entries()) {
      const last = k === events.length - 1;
      // 全挡下的段读作招架，不读作创口——与 playDamage 的分支同一语义。
      if (ev.amount === 0 && ev.blocked > 0) {
        for (const cue of sfxForEvent(ev)) this.audio.play(cue.id, cue.opts);
        shieldFlare(this, at.x, at.y, view.height * 0.3);
        popText(this, at.x, at.y - 20, `挡下 ${ev.blocked}`, { color: 0xdcefff, size: 22 });
        this.paintHpBars();
        await this.wait(120);
        continue;
      }
      const side = k % 2 === 0 ? -1 : 1;
      slash(this, at.x, at.y, {
        angle: side * (26 + k * 8),
        length: 165 + k * 18 + (last && heavy ? 56 : 0),
        thickness: 22 + k * 3 + (last && heavy ? 8 : 0),
      });
      burst(this, at.x, at.y, {
        color: 0xffd8a8,
        count: last && heavy ? 24 : 10,
        speed: last && heavy ? 400 : 260,
      });
      // 命中音仍与顿帧同帧；末段以累计伤害定档（音画同档，见方法注释）。
      const cueEv = last ? { ...ev, amount: total } : ev;
      for (const cue of sfxForEvent(cueEv)) this.audio.play(cue.id, cue.opts);
      hitStop(this, last && heavy ? 0.16 : 0.5, last && heavy ? 95 : 40);
      screenShake(this, last && heavy ? 200 : 70, last && heavy ? 0.007 : 0.002);
      this.recoil(view, -1);
      this.flashHit(view);
      popText(this, at.x + side * 38, at.y - 40 - k * 12, `-${ev.amount}`, {
        color: C.cinnabarBright,
        size: 24,
        drift: 40,
      });
      if (ev.blocked > 0) {
        popText(this, at.x + 54, at.y + 12, `挡 ${ev.blocked}`, { color: 0x9fc4e0, size: 18 });
      }
      this.paintHpBars();
      await this.wait(last ? 90 : 120);
    }

    if (total > 0) {
      popText(this, at.x, at.y - 84, `共 -${total}`, {
        color: C.cinnabarBright,
        size: heavy ? 46 : 36,
      });
      this.drainGhost(view, this.hpOf(events[0].targetId));
    }
    await this.wait(heavy ? 205 : 150);
  }

  /**
   * 横扫（`damageAll`）的合并展示。老演法对每个敌人重放一次单体斩击——
   * 三个敌人就是三次串行顿帧 + 三次小屏震，读作「依次砍了三个人」。这里
   * 改成：一记横贯敌阵的大笔触，全体同帧闪白后仰、数字齐弹，一次重顿帧
   * + 一次大屏震收束整场。同一目标的多段（水淹七军 6×2）先按目标聚账，
   * 数字直接给累计。
   */
  private async playAoe(events: DamageEv[]): Promise<void> {
    const perTarget = new Map<string, { view: ActorView; amount: number; blocked: number }>();
    for (const ev of events) {
      const view = this.viewOf(ev.targetId);
      if (!view) continue;
      const acc = perTarget.get(ev.targetId) ?? { view, amount: 0, blocked: 0 };
      acc.amount += ev.amount;
      acc.blocked += ev.blocked;
      perTarget.set(ev.targetId, acc);
    }
    if (perTarget.size === 0) return;

    // 笔触跨过最左到最右的躯干，微倾——横扫的读法。
    const spots = [...perTarget.values()].map((t) => this.torso(t.view));
    const minX = Math.min(...spots.map((s) => s.x));
    const maxX = Math.max(...spots.map((s) => s.x));
    const midY = spots.reduce((sum, s) => sum + s.y, 0) / spots.length;
    slash(this, (minX + maxX) / 2, midY, {
      angle: -8,
      length: maxX - minX + 300,
      thickness: 44,
      bow: 54,
    });

    // 一次顿帧、一次大震收束全场；命中音按全场累计定档。
    const total = groupTotal(events);
    const blockedTotal = events.reduce((sum, e) => sum + e.blocked, 0);
    const cueEv = { ...events[0], amount: total, blocked: blockedTotal };
    for (const cue of sfxForEvent(cueEv)) this.audio.play(cue.id, cue.opts);
    hitStop(this, 0.18, 90);
    screenShake(this, 240, 0.008);

    for (const [id, t] of perTarget) {
      const at = this.torso(t.view);
      if (t.amount === 0 && t.blocked > 0) {
        shieldFlare(this, at.x, at.y, t.view.height * 0.34);
        popText(this, at.x, at.y - 20, `挡下 ${t.blocked}`, { color: 0xdcefff, size: 24 });
        continue;
      }
      burst(this, at.x, at.y, { color: 0xffd8a8, count: 12, speed: 300 });
      this.recoil(t.view, -1);
      this.flashHit(t.view);
      popText(this, at.x, at.y - 52, `-${t.amount}`, {
        color: C.cinnabarBright,
        size: t.amount >= 12 ? 42 : 32,
      });
      if (t.blocked > 0) {
        popText(this, at.x + 54, at.y + 12, `挡 ${t.blocked}`, { color: 0x9fc4e0, size: 20 });
      }
      this.drainGhost(t.view, this.hpOf(id));
    }
    this.paintHpBars();
    await this.wait(260);
  }

  private async playDeath(id: string): Promise<void> {
    const view = this.roster.get(id);
    if (!view) return;

    view.hit.disableInteractive();
    this.tweens.killTweensOf(view.sprite);
    this.tweens.add({ targets: view.intent, alpha: 0, duration: dur(180) });

    inkSplash(this, view.container.x, BASELINE_Y);
    screenShake(this, 200, 0.005);

    // Topple away from the player, then dissolve.
    this.tweens.add({
      targets: view.sprite,
      angle: 16,
      x: view.spriteBaseX + 34,
      duration: dur(520),
      ease: 'Quad.easeIn',
    });
    this.tweens.add({
      targets: view.container,
      alpha: 0,
      y: BASELINE_Y + 26,
      duration: dur(520),
      ease: 'Quad.easeIn',
    });
    this.tweens.add({
      targets: [view.bar, view.hpText, view.statusRow, view.blockBadge],
      alpha: 0,
      duration: dur(320),
    });
    this.tweens.add({ targets: view.nameText, alpha: 0, duration: dur(320) });

    await this.wait(420);
  }

  /**
   * 消耗的当场烧毁：余烬一迸、原地上浮淡出——与 `syncHand` 飞向弃牌堆的
   * 弃牌读法彻底分开。先从 `cardViews` 摘账，syncHand 不会再抢着把同一张
   * 飞一遍（与 `play` 销毁打出牌的摘账手法同一条纪律）。不在手上的
   * （打出的那张、牌堆里烧的）没有 view，静默走过场。
   */
  private burnCard(uid: string): void {
    const view = this.cardViews.get(uid);
    if (!view) return;
    this.cardViews.delete(uid);
    view.hitZone.disableInteractive();
    this.tweens.killTweensOf(view);
    burst(this, view.x, view.y - 20, { color: 0xd97a3c, count: 14, speed: 210, scale: 0.14 });
    this.tweens.add({
      targets: view,
      y: view.y - 46,
      alpha: 0,
      duration: dur(360),
      ease: 'Quad.easeOut',
      onComplete: () => view.destroy(),
    });
  }

  private viewOf(id: string): ActorView | undefined {
    if (id === 'player') return this.playerView;
    return this.roster.get(id);
  }

  private hpOf(id: string): number {
    if (id === 'player') return this.state.player.hp;
    return this.state.enemies.find((e) => e.id === id)?.hp ?? 0;
  }

  /** Let the trailing bar catch up a beat later, so the hit size is legible. */
  private drainGhost(view: ActorView, newHp: number): void {
    this.tweens.killTweensOf(view.ghost);
    this.tweens.add({
      targets: view.ghost,
      value: newHp,
      delay: dur(280),
      duration: dur(440),
      ease: 'Quad.easeIn',
      onUpdate: () => this.paintHpBars(),
    });
  }

  private popBadge(badge: Phaser.GameObjects.Container): void {
    pop(this, badge, 1.35, 110);
  }

  // ------------------------------------------------------------------ render

  private refresh(): void {
    if (this.state.energy < this.lastEnergy) {
      this.tweens.killTweensOf(this.energyOrb);
      this.energyOrb.setScale(1);
      this.tweens.add({
        targets: this.energyOrb,
        scale: 1.22,
        duration: dur(110),
        yoyo: true,
        ease: 'Back.easeOut',
      });
    }
    this.lastEnergy = this.state.energy;

    this.energyText.setText(`${this.state.energy}`);
    this.energyMaxText.setText(`/ ${this.state.maxEnergy}`);

    // 连击: `playCard` increments only after the card has resolved (see
    // heroCards.ts), so by the time this runs the number is the turn's current
    // total — the third 攻 of the turn lands and the badge says 3, even though
    // its own face scaled off the 2 played before it. Pop on the way up only;
    // the turn-start reset (`startPlayerTurn` zeroes it) just repaints.
    if (this.comboBadge && this.comboText) {
      const combo = this.state.attacksThisTurn;
      if (combo !== this.lastCombo) {
        this.comboText.setText(`${combo}`);
        if (combo > this.lastCombo) pop(this, this.comboBadge, 1.35, 110);
        this.lastCombo = combo;
      }
    }
    this.turnText.setText(`第 ${this.state.turn} 回合`);
    this.deckCount.setText(String(this.run.deck.length));
    this.setCount(this.drawPile, this.state.drawPile.length);
    this.setCount(this.discardPile, this.state.discardPile.length);
    this.setCount(this.exhaustPile, this.state.exhaustPile.length);
    // Nothing exhausts in most fights; the pile only earns its corner once used.
    this.exhaustPile.container.setVisible(this.state.exhaustPile.length > 0);
    this.endTurnBtn.setAlpha(this.state.phase === 'player' ? 1 : 0.45);

    for (const view of this.cardViews.values()) view.refresh(this.state);
    this.refreshBars();
  }

  /** Full repaint. Not safe to call per-frame — it rebuilds the status pills. */
  private refreshBars(): void {
    this.paintHpBars();

    this.paintBlock(this.playerView, this.state.player.block);
    this.paintStatuses(this.playerView, this.state.player.statuses);

    // Computed once for the whole line: the pulse warns about the *sum* of what
    // is telegraphed, so every badge on a lethal board pulses together.
    const lethal = incomingIsLethal(this.state);
    for (const view of this.roster.all()) {
      if (!view.enemy.alive) continue;
      this.paintBlock(view, view.enemy.block);
      this.paintStatuses(view, view.enemy.statuses);
      this.paintIntent(view, lethal);
    }
    this.paintIncoming();
  }

  /**
   * 「← 12」 or 「← 12+?」 beside the player's block badge.
   *
   * The unknown enemies are counted but never added in. `totalIncomingDamage`
   * is the same function the sim's threat policy reads, so the number the
   * player is shown and the number a simulated player defends against cannot
   * drift apart.
   */
  private paintIncoming(): void {
    const { known, hiddenCount } = totalIncomingDamage(this.state);
    const show = this.state.phase === 'player' && (known > 0 || hiddenCount > 0);
    this.incomingText.setVisible(show);
    this.incomingHidden.setVisible(show);
    if (!show) return;

    this.incomingText.setText(`← ${known}`);
    // Red only once the armour on hand stops covering it — a total the player
    // has already answered is information, not a warning.
    this.incomingText.setColor(css(known > this.state.player.block ? C.cinnabarBright : C.paperDim));
    this.incomingHidden.setText(hiddenCount > 0 ? '+?' : '');
    this.incomingHidden.setX(this.incomingText.x + this.incomingText.width + 2);
  }

  /** Cheap repaint — safe to drive from a tween's onUpdate. */
  private paintHpBars(): void {
    this.paintBar(this.playerView, this.state.player.hp, this.state.player.maxHp, C.blood);
    for (const view of this.roster.all()) {
      if (!view.enemy.alive) continue;
      // 伤害预览段 (k5) 按 enemyId 认领——只有被瞄着的那条挨标。
      const seg = this.hpPreview?.enemyId === view.enemy.id ? this.hpPreview.seg : undefined;
      this.paintBar(view, view.enemy.hp, view.enemy.maxHp, 0x7a2f2f, seg);
    }
  }

  private paintBar(
    view: ActorView,
    hp: number,
    maxHp: number,
    fill: number,
    preview?: HpPreviewSeg,
  ): void {
    const width = view.barWidth;
    const h = 14;
    const x = -width / 2;
    const y = 14;
    const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    const ghostRatio = Phaser.Math.Clamp(view.ghost.value / maxHp, 0, 1);

    view.bar.clear();
    view.bar.fillStyle(C.inkDeep, 0.92);
    view.bar.fillRect(x, y, width, h);

    // Trailing "damage taken" segment, drawn behind the live fill.
    if (ghostRatio > ratio) {
      view.bar.fillStyle(0xe8846a, 0.85);
      view.bar.fillRect(x + width * ratio, y, width * (ghostRatio - ratio), h);
    }

    view.bar.fillStyle(fill, 1);
    view.bar.fillRect(x, y, width * ratio, h);
    view.bar.fillStyle(C.cinnabar, 0.7);
    view.bar.fillRect(x, y, width * ratio, h * 0.45);

    // 伤害预览段 (todos/24 k5)：盖在活条上的半透明红——选中/拖拽的攻击卡
    // 这一击会打掉的部分。画在拖尾段之后、描边之前，红段压着活条才读得出
    // 「打完剩下的是左边这截」。
    if (preview) {
      view.bar.fillStyle(C.cinnabarBright, 0.55);
      view.bar.fillRect(x + width * preview.from, y, width * (preview.to - preview.from), h);
    }

    view.bar.lineStyle(1, C.gold, 0.5);
    view.bar.strokeRect(x - 1, y - 1, width + 2, h + 2);

    view.hpText.setText(`${hp} / ${maxHp}`);
    view.hpText.setY(y + h / 2);
  }

  private paintBlock(view: ActorView, block: number): void {
    view.blockBadge.setVisible(block > 0);
    view.blockText.setText(String(block));
  }

  /**
   * Icon chips, not text pills: eighteen statuses at 62px a piece would run off
   * both sides of the screen. Ordered by `STATUS_ORDER` so the row never
   * reshuffles itself as statuses come and go, and every chip carries its rules
   * text on hover — an icon nobody can read is worse than a word.
   */
  private paintStatuses(view: ActorView, statuses: Partial<Record<StatusId, number>>): void {
    // removeAll(true) 连热区一起销毁；正开着的面板由管理器接热区的
    // destroy 事件自己收，不必在这里全局 hide 把无关的意图面板也带走。
    view.statusRow.removeAll(true);

    // `!== 0`: 神力 and 身法 are signed, and a -2 神力 must show as a chip
    // reading "-2" rather than quietly vanishing off the row.
    const entries = STATUS_ORDER.filter((id) => (statuses[id] ?? 0) !== 0);
    const chipW = 32;
    const chipH = 22;
    const gap = 3;
    const total = entries.length * (chipW + gap) - gap;

    entries.forEach((id, i) => {
      const meta = STATUS_META[id];
      const count = statuses[id] ?? 0;
      const x = -total / 2 + i * (chipW + gap) + chipW / 2;

      const chip = this.add.container(x, 0);
      const bg = this.add.graphics();
      bg.fillStyle(C.inkDeep, 0.94);
      bg.fillRoundedRect(-chipW / 2, -chipH / 2, chipW, chipH, 3);
      bg.lineStyle(1, meta.color, 0.85);
      bg.strokeRoundedRect(-chipW / 2, -chipH / 2, chipW, chipH, 3);

      const icon = this.add
        .image(-8, 0, meta.icon ?? '')
        .setDisplaySize(16, 16)
        .setTint(meta.color);
      const label = this.add
        .text(chipW / 2 - 4, 1, String(count), bodyStyle(12, C.paper))
        .setOrigin(1, 0.5);

      const hit = this.add.zone(0, 0, chipW, chipH).setInteractive();
      // 内容是函数：层数从闭包里的 statuses 读，面板弹出的那一刻才取值,
      // 名目与层数、规则文本合成一段（多段拼装见 composeTip）。
      this.tips.register({
        zone: hit,
        content: () => [
          {
            title: `【${meta.label}】${statuses[id] ?? 0}`,
            body: meta.desc,
            color: meta.color,
          },
        ],
      });

      chip.add([bg, icon, label, hit]);
      view.statusRow.add(chip);
    });
  }

  /**
   * The 招式 behind the hovered badge, in full.
   *
   * Kept off the pointer handler on purpose: the panel is asked for, never
   * triggered. todos/24's keyboard cursor is the second caller, and a tooltip
   * whose only entry point is `pointerover` is one that cannot be reached
   * without a mouse. 空数组 = 「现在没什么可说」，管理器一块面板也不出。
   */
  private intentTipContent(view: EnemyViewParts): TipSegment[] {
    if (!view.enemy.alive || this.finished) return [];
    const display = intentOf(this.state, view.enemy);
    if (!display || !view.intent.visible) return [];
    return [
      {
        title: display.tooltip.title,
        body: display.tooltip.body,
        color: intentBadge(display).color,
      },
    ];
  }

  /**
   * The intent badge: a glyph, the number it will actually land, and one small
   * rider per thing the move does besides.
   *
   * All of it is Graphics — nothing here is a bitmap — so it stays sharp at any
   * `RENDER_SCALE`. `lethal` is passed in rather than read off this enemy alone
   * because the warning that matters is 「the *field* kills you this turn」: a
   * player dying to three 4-damage hits died to arithmetic, not to a big number.
   */
  private paintIntent(view: EnemyView, lethal: boolean): void {
    const display = intentOf(this.state, view.enemy);
    if (!display) {
      view.intent.setVisible(false);
      return;
    }
    const badge = intentBadge(display);

    // Headline: glyph on the left, number on the right, sized as one unit.
    const iconW = badge.glyph === 'unknown' ? 0 : INTENT_ICON * badge.scale;
    view.intentText.setText(badge.text).setColor(css(badge.color));
    const textW = badge.text ? view.intentText.width : 0;
    const gap = iconW > 0 && textW > 0 ? 7 : 0;
    const inner = iconW + gap + textW;

    view.intentIcon.clear();
    if (iconW > 0) drawGlyph(view.intentIcon, badge.glyph, iconW, badge.color);
    view.intentIcon.setPosition(-inner / 2 + iconW / 2, 0);
    view.intentText.setPosition(inner / 2, 1);

    const w = inner + 26;
    const marksW = this.paintIntentMarks(view, badge.marks);

    view.intentBg.clear();
    view.intentBg.fillStyle(C.inkDeep, 0.92);
    view.intentBg.fillRoundedRect(-w / 2, -INTENT_H / 2, w, INTENT_H, 4);
    if (marksW > 0) {
      // A second, shorter pill tucked under the right-hand corner. Overlapped
      // by 2 px so the pair reads as one badge with a tail rather than as two.
      view.intentBg.fillRoundedRect(
        w / 2 - marksW,
        INTENT_H / 2 - 2,
        marksW,
        INTENT_MARK_H,
        4,
      );
      view.intentMarks.setPosition(w / 2 - marksW + 7, INTENT_H / 2 + INTENT_MARK_H / 2 - 2);
    }
    // 致死 draws its own border: thicker, cinnabar, and pulsing below.
    view.intentBg.lineStyle(lethal ? 2.5 : 1.5, lethal ? C.cinnabarBright : badge.color, lethal ? 1 : 0.85);
    view.intentBg.strokeRoundedRect(-w / 2, -INTENT_H / 2, w, INTENT_H, 4);

    // Hover target over both pills. `Zone.setSize` resizes the input hit area
    // with the object, which is the whole reason the target is a Zone.
    view.intentHit
      .setSize(Math.max(w, marksW), INTENT_H + (marksW > 0 ? INTENT_MARK_H : 0))
      .setPosition(0, marksW > 0 ? (INTENT_MARK_H - 2) / 2 : 0);
    view.intent.setVisible(this.state.phase === 'player');

    // Announce a telegraph that actually changed — see `EnemyViewParts.intentKey`.
    const key = `${intentKey(display)}|${lethal}`;
    if (key === view.intentKey) {
      // 收招时 `enemyMove` 把徽章弹出到 alpha 0（2082 行的 wind-up）。相同的
      // 电报不重播入场动画，但徽章必须接回来——少了这一手，任何连出同一招
      // 的敌人（maxRepeat: 2 比比皆是）整个回合都顶着一块隐形徽章。只在没有
      // 补间在跑时收手：入场/脉冲进行中就别去踩它们的属性。
      if (this.tweens.getTweensOf(view.intent).length === 0) {
        view.intent.setAlpha(1).setScale(1);
        if (lethal) this.armLethalPulse(view);
      }
      return;
    }
    view.intentKey = key;

    this.tweens.killTweensOf(view.intent);
    view.intent.setScale(0.5).setAlpha(0);
    this.tweens.add({
      targets: view.intent,
      scale: 1,
      alpha: 1,
      duration: dur(300),
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!lethal) return;
        // Only after the reveal has landed, or the two tweens would fight over
        // `scale` and the badge would settle at whatever size lost the race.
        this.armLethalPulse(view);
      },
    });
  }

  /** 致死脉冲——环境循环，故意不过 dur()；见 timing.ts 文件头。 */
  private armLethalPulse(view: EnemyView): void {
    this.tweens.add({
      targets: view.intent,
      scale: 1.1,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** The riders, right-aligned under the headline. Returns the pill's width. */
  private paintIntentMarks(view: EnemyView, marks: readonly IntentMark[]): number {
    view.intentMarks.removeAll(true);
    if (marks.length === 0) return 0;

    let x = 0;
    for (const mark of marks) {
      const color = markColor(mark);
      const icon = this.add.graphics();
      drawGlyph(icon, markGlyph(mark), INTENT_MARK_ICON, color);
      icon.setPosition(x + INTENT_MARK_ICON / 2, 0);
      const count = this.add
        .text(x + INTENT_MARK_ICON + 2, 1, String(mark.n), bodyStyle(13, color))
        .setOrigin(0, 0.5);
      view.intentMarks.add([icon, count]);
      x += INTENT_MARK_ICON + 2 + count.width + 8;
    }
    // Trailing gap trimmed, then the pill's own padding on both ends.
    return x - 8 + 14;
  }

  override update(): void {
    // Targeting line from the raised card — or the raised flask — to the pointer.
    this.arrow.clear();
    if (this.finished) return;

    const p = this.input.activePointer;
    const px = toDesign(p.x);
    const py = toDesign(p.y);

    // 拖拽态 (todos/24 k3)：指向牌画瞄准箭头，无目标牌画「打出线」。
    if (this.dragUid) {
      const view = this.cardViews.get(this.dragUid);
      if (!view) return;
      if (view.def.target === 'enemy') {
        // 单敌锁定（与 dropVerdict / onCardDrag 同一条线）：箭头钉在唯一
        // 活敌身上不再跟指针飘——「过线松手即命中」看得见。多敌照旧：
        // 指针越过卡顶才起弧——卡还叼在指针上时，箭头只会是一坨。
        const living = this.roster.living();
        const lock = living.length === 1 && pastPlayLine(py) ? living[0] : null;
        if (lock || py < view.y - 110) {
          this.drawAimCurve(view.x, view.y - 110, lock ? lock.hit.x : px, lock ? lock.hit.y : py);
        }
      } else {
        this.drawPlayLine(pastPlayLine(py));
      }
      return;
    }

    let from: { x: number; y: number } | null = null;
    if (this.selectedPotion !== null) {
      from = this.potionBelt.slotAt(this.selectedPotion);
    } else if (this.selectedUid) {
      const view = this.cardViews.get(this.selectedUid);
      // 打牌确认 (todos/21 t3) 高亮中的非指向牌不画瞄准线——它在等第二次
      // 点击，不是在选目标。
      if (view && view.def.target === 'enemy') from = { x: view.x, y: view.y - 100 };
    }
    if (!from) return;
    this.drawAimCurve(from.x, from.y, px, py);
  }

  /** 选敌与拖拽共用的贝塞尔瞄准线——从起点弓到指针，越近头越粗。 */
  private drawAimCurve(sx: number, sy: number, px: number, py: number): void {
    const steps = 22;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const cx = (sx + px) / 2;
      const cy = Math.min(sy, py) - 90;
      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * px;
      const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * py;
      this.arrow.fillStyle(C.goldBright, 0.35 + t * 0.6);
      this.arrow.fillCircle(x, y, 2 + t * 3.5);
    }
  }

  /**
   * 打出线 (todos/24 k3)：拖着无目标牌时横在敌阵脚下的一道虚线，指针
   * 过线即亮——亮着松手就打出，暗着松手是回弹。阈值本身在 `dragPlay.ts`。
   */
  private drawPlayLine(armed: boolean): void {
    this.arrow.lineStyle(2, armed ? C.goldBright : C.paperDim, armed ? 0.9 : 0.4);
    for (let x = 90; x < GAME_WIDTH - 90; x += 36) {
      this.arrow.lineBetween(x, PLAY_LINE_Y, x + 20, PLAY_LINE_Y);
    }
  }

  // -------------------------------------------------------------- resolution

  private checkOutcome(): void {
    if (this.finished) return;
    if (this.state.phase === 'won') {
      this.finished = true;
      this.time.delayedCall(dur(420), () => this.showVictory());
    } else if (this.state.phase === 'lost') {
      this.finished = true;
      this.time.delayedCall(dur(420), () => this.showDefeat());
    }
  }

  /**
   * The fight is over and won. The run is settled exactly once here, then the
   * screen routes: a 首领 owes the 战利品 chest *before* the ordinary spoils, so
   * the relic that shapes the next act is chosen while it still can be.
   *
   * `resumed` is the 存档 path (todos/08): the run was settled before the save
   * was written, so it must not be settled again. 体力 would survive it —
   * `applyCombatResult` is idempotent — but `resolveCombatEndHooks` is not, and
   * 贪念 would collect a second time off a body already paid for.
   */
  private showVictory(resumed = false): void {
    if (!resumed) {
      applyCombatResult(this.run, this.state.player.hp);
      // 贪念 collects here — before the gold roll, so a curse can never eat the
      // reward the player is about to be shown.
      resolveCombatEndHooks(this.state, this.run);
      // 统计入账 (todos/22)：精英/首领与无伤判定。写在 `saveFight` 之前，
      // 和 `resolveCombatEndHooks` 同一道 `resumed` 闸——存档恢复的胜利
      // 画面已经记过账，再记就是双份。
      recordFightSettled(this.run, this.nodeType, this.fightDamageTaken);
      // Written *now*, still tagged as a won fight, because the screen the
      // player is about to see owes them a card and a 首领 relic. Saved as「on
      // the map」instead, a reload would strand the run on a node whose spoils
      // are gated `once` and can never be claimed.
      this.saveFight();
    }

    if (this.nodeType === 'boss' && bossOfferPending(this.run, this.nodeId)) {
      this.showBossChest(() => this.showSpoils());
      return;
    }
    this.showSpoils();
  }

  /**
   * 战利品 — three 首领 relics, keep one, or decline for the 宝钥. Drawn as text
   * rather than as icons on purpose: every 首领 relic carries a downside, and a
   * choice made off a sigil the player cannot read is not a choice (todo 10).
   */
  private showBossChest(done: () => void): void {
    const offer = ensureBossOffer(this.run, this.nodeId);
    const layer = this.add.container(0, 0).setDepth(DEPTH.overlay);
    layer.add(
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.92),
    );
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, 78, '战 利 品', brushStyle(48, C.goldBright))
        .setOrigin(0.5)
        .setLetterSpacing(10),
    );
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, 138, '取其一，余者尽弃。', bodyStyle(16, C.paperDim))
        .setOrigin(0.5),
    );

    // Answered once, whichever way: `takeBossRelic` is the gate, and this only
    // stops a second click from tearing the panel down twice mid-fade.
    let answered = false;
    const answer = (relicId: string | null): void => {
      if (answered) return;
      answered = true;
      // 拿了宝物才有铃声——「不取 · 换取宝钥」的账在房间层，不在这儿响。
      if (relicId) this.audio.play('relic-gain');
      takeBossRelic(this.run, this.nodeId, relicId);
      this.relicBar.setRelics(this.run.relics);
      this.tweens.add({
        targets: layer,
        alpha: 0,
        duration: dur(220),
        onComplete: () => {
          layer.destroy(true);
          done();
        },
      });
    };

    const spacing = Math.min(400, (GAME_WIDTH - 80) / Math.max(1, offer.length));
    offer.forEach((relicId, i) => {
      const def = getRelic(relicId);
      if (!def) return;
      const x = GAME_WIDTH / 2 + (i - (offer.length - 1) / 2) * spacing;
      const card = this.add.container(x, 340);
      card.add(inkPanel(this, -spacing / 2 + 12, -130, spacing - 24, 260, { alpha: 0.8 }));
      card.add(
        this.add.text(0, -104, def.name, brushStyle(26, C.goldBright)).setOrigin(0.5).setLetterSpacing(3),
      );
      card.add(
        this.add
          .text(0, -62, relicText(def), {
            ...bodyStyle(14, C.paperDim),
            align: 'center',
            wordWrap: { width: spacing - 56 },
            lineSpacing: 6,
          })
          .setOrigin(0.5, 0),
      );
      const hit = this.add
        .zone(0, 0, spacing - 24, 260)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => this.tweens.add({ targets: card, scale: 1.04, duration: dur(140) }));
      hit.on('pointerout', () => this.tweens.add({ targets: card, scale: 1, duration: dur(140) }));
      hit.on('pointerup', () => answer(relicId));
      card.add(hit);
      card.setDepth(DEPTH.overlay + 1);
      layer.add(card);
    });

    const decline = inkButton(this, GAME_WIDTH / 2, 578, '不取 · 换取宝钥', {
      width: 300,
      height: 54,
      fontSize: 22,
      onClick: () => answer(null),
    });
    decline.setDepth(DEPTH.overlay + 1);
    layer.add(decline);

    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: dur(320) });
  }

  private showSpoils(): void {
    // Coin, the cards on offer and the 丹药 roll, all through the room layer's
    // one-shot gate and all frozen on the node (`claimSpoils`). They used to be
    // rolled inline right here, outside the gate and written down nowhere — the
    // only room in the game showing the player a random result with no
    // materialised record behind it — so a second visit paid again and drifted
    // `rareBump` and `potionChance` with it.
    const { gold, cardIds: picks, potionId: drop } = claimSpoils(
      this.run,
      this.nodeId,
      this.nodeType,
      this.encounter,
    );
    // 精英 drops a relic by tier; an 奇遇 that started this fight may instead
    // have promised a named one. Its own stream again, and gated on the node so
    // a scene restart cannot pay it twice.
    const relic = claimVictoryRelic(this.run, this.nodeId, this.nodeType, this.bonusRelic);

    // 战罢的进账各有各的声 (todos/20 b5)：资财一声，宝物（若掉了）另一声。
    this.audio.play('gold-gain');

    const layer = this.add.container(0, 0).setDepth(DEPTH.overlay);
    layer.add(
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.88),
    );
    layer.add(
      this.add.text(GAME_WIDTH / 2, 74, '战 罢', brushStyle(52, C.goldBright)).setOrigin(0.5).setLetterSpacing(10),
    );
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, 140, `获得资财 ${gold + (relic?.gold ?? 0)}　·　体力 ${this.run.hp} / ${this.run.maxHp}`, bodyStyle(17, C.paperDim))
        .setOrigin(0.5),
    );
    // A drop pushes the card row's caption down; with no drop the screen keeps
    // the layout it had before potions existed.
    if (drop) this.buildPotionDrop(layer, drop, 196);
    if (relic) this.buildRelicDrop(layer, relic, drop ? 226 : 196);
    const captionY = 184 + (drop ? 62 : 0) + (relic ? 52 : 0);
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, captionY, '择一牌收入行囊', bodyStyle(15, C.paperFaint))
        .setOrigin(0.5),
    );

    // Laid out from the row's own width rather than around a fixed centre card,
    // so 1, 3 and 4 cards are all centred. Tightened once the row would
    // otherwise run past the screen edge.
    const spacing = Math.min(210, (GAME_WIDTH - 120) / Math.max(1, picks.length));

    // 关键词汇总面板 (k7)：奖励卡是玩家第一次见到一张新牌的地方，词条
    // 解释必须跟着悬停到位。走 `cardTipPanel` 的静态构建而不是 this.tips
    // ——奖励层活在 DEPTH.overlay 之上，场景级管理器的面板会被盖住。
    let rewardTip: CardTipPanel | null = null;
    const hideRewardTip = (): void => {
      rewardTip?.root.destroy(true);
      rewardTip = null;
    };
    picks.forEach((cardId, i) => {
      const x = GAME_WIDTH / 2 + (i - (picks.length - 1) / 2) * spacing;
      const card = new CardView(this, `reward-${i}`, cardId, 0, this.state, 'display');
      card.setPosition(x, 400);
      card.setDepth(DEPTH.overlay + 1);
      card.hitZone.on('pointerover', () => {
        this.tweens.add({ targets: card, scale: 1.1, y: 386, duration: dur(140), ease: 'Back.easeOut' });
        hideRewardTip();
        rewardTip = cardTipPanel(this, card.def, this.state);
        if (rewardTip) {
          // 面板贴着悬停后的卡框摆（1.1 倍、抬到 386），顶不下时翻去底下。
          const w = CARD_W * 1.1;
          const h = CARD_H * 1.1;
          placeCardTipPanel(rewardTip, { x: x - w / 2, y: 386 - h / 2, w, h }, 'top');
          rewardTip.root.setDepth(DEPTH.overlay + 2);
          layer.add(rewardTip.root);
        }
      });
      card.hitZone.on('pointerout', () => {
        this.tweens.add({ targets: card, scale: 1, y: 400, duration: dur(140) });
        hideRewardTip();
      });
      card.hitZone.on('pointerup', () => {
        this.claimReward(() => takeCardReward(this.run, this.nodeId, cardId));
      });
      layer.add(card);
    });

    // 歌钵 turns declining into a decision rather than a concession.
    const skipHp = relicModifiers(this.run.relics).skipRewardMaxHp;
    const skip = inkButton(this, GAME_WIDTH / 2, 596, skipHp > 0 ? `不取 · 体力上限 +${skipHp}` : '不取', {
      width: skipHp > 0 ? 260 : 170,
      height: 54,
      fontSize: 22,
      // `null` is 「declined」 — the 歌钵 体力上限 is paid by the room layer, on
      // the same gate the card itself is, so it cannot be collected twice.
      onClick: () => {
        this.claimReward(() => takeCardReward(this.run, this.nodeId, null));
      },
    });
    skip.setDepth(DEPTH.overlay + 1);
    layer.add(skip);

    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: dur(320) });
  }

  // ------------------------------------------------------------- 宝物 drops

  /**
   * The 精英 / 奇遇 relic line. The relic is already on the run — the room layer
   * granted it — so this is a receipt, not a button; the bar in the HUD is
   * refreshed so the new sigil is where the player will look for it next.
   *
   * A refused drop still gets a line: silently paying coin for a relic the
   * player was told to expect reads as the drop having been forgotten.
   */
  private buildRelicDrop(
    layer: Phaser.GameObjects.Container,
    relic: VictoryRelic,
    y: number,
  ): void {
    if (relic.relicId) {
      this.audio.play('relic-gain');
      const def = getRelic(relic.relicId);
      const bar = new RelicBar(this, {
        x: GAME_WIDTH / 2 - 14,
        y: y - 14,
        depth: DEPTH.overlay + 1,
        tooltipDepth: DEPTH.overlay + 2,
        size: 28,
        perRow: 1,
      });
      bar.setRelics([relic.relicId]);
      layer.add(
        this.add
          .text(GAME_WIDTH / 2 + 28, y, `得宝物「${def?.name ?? relic.relicId}」`, bodyStyle(16, C.goldBright))
          .setOrigin(0, 0.5),
      );
      this.relicBar.setRelics(this.run.relics);
      this.relicBar.flash(relic.relicId);
      return;
    }
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, y, `库中已无可取之物，折作资财 ${relic.gold}`, bodyStyle(16, C.paperDim))
        .setOrigin(0.5),
    );
  }

  // ------------------------------------------------------------- 丹药 drops

  /**
   * The drop row. With room on the belt the potion is already in it and this is
   * a receipt; with a full belt nothing has been taken yet and the flask is the
   * button that opens the swap prompt.
   *
   * *Which* bottle dropped was decided by `claimSpoils` and is frozen on the
   * node; taking it is gated separately, because a full belt leaves the choice
   * open until the player answers the swap prompt.
   */
  private buildPotionDrop(
    layer: Phaser.GameObjects.Container,
    potionId: string,
    y: number,
  ): void {
    const def = getPotion(potionId);
    const taken = takePotionDrop(this.run, this.nodeId, potionId);

    const label = this.add
      .text(GAME_WIDTH / 2 + 26, y, '', bodyStyle(16, C.paperDim))
      .setOrigin(0, 0.5);
    layer.add(label);

    const belt = new PotionBelt(this, {
      x: GAME_WIDTH / 2 - 10,
      y,
      depth: DEPTH.overlay + 1,
      tooltipDepth: DEPTH.overlay + 2,
      onUse: () => {
        if (this.run.potions.includes(potionId)) return;
        this.askPotionSwap(potionId, () => {
          belt.hideTip();
          settle();
        });
      },
    });
    belt.setPotions([potionId]);

    const settle = (): void => {
      const held = this.run.potions.includes(potionId);
      label
        .setText(held ? `得【${def.name}】` : '行囊已满 · 点击此瓶取舍')
        .setColor(css(held ? C.gold : C.cinnabarBright));
      // Centre the flask-plus-caption pair as one unit.
      const width = 36 + label.width;
      belt.moveTo(GAME_WIDTH / 2 - width / 2 + 18, y);
      label.setX(GAME_WIDTH / 2 - width / 2 + 42);
    };
    settle();
    if (taken) this.potionBelt.setPotions(this.run.potions);
  }

  /** Replace one of the bottles already on the belt, or leave the new one. */
  private askPotionSwap(potionId: string, done: () => void): void {
    const def = getPotion(potionId);
    const layer = this.add.container(0, 0).setDepth(DEPTH.overlay + 3);
    layer.add(
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, C.inkDeep, 0.9),
    );
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, 250, `行囊已满，弃一瓶以纳【${def.name}】`, brushStyle(28, C.paper))
        .setOrigin(0.5)
        .setLetterSpacing(3),
    );
    layer.add(
      this.add
        .text(GAME_WIDTH / 2, 296, '点击要舍弃的丹药', bodyStyle(15, C.paperFaint))
        .setOrigin(0.5),
    );

    // Centred on the belt's own width, so 3 slots and 5 slots both look placed.
    const size = 44;
    const gap = size + 12;
    // Declared, not assigned to a const, so `onUse` below can reach it — the
    // belt and its dismissal are mutually recursive.
    function close(): void {
      belt.destroy();
      layer.destroy(true);
      done();
    }

    const belt = new PotionBelt(this, {
      x: GAME_WIDTH / 2 - ((this.run.potions.length - 1) * gap) / 2,
      y: 380,
      size,
      depth: DEPTH.overlay + 4,
      tooltipDepth: DEPTH.overlay + 5,
      onUse: (slot) => {
        takePotionDrop(this.run, this.nodeId, potionId, slot);
        this.potionBelt.setPotions(this.run.potions);
        close();
      },
    });
    belt.setPotions(this.run.potions);

    const keep = inkButton(this, GAME_WIDTH / 2, 486, '放弃新瓶', {
      width: 190,
      height: 54,
      fontSize: 21,
      // Answered, not deferred: the drop is settled either way, so re-entering
      // the node cannot offer the bottle a second time.
      onClick: () => {
        declinePotionDrop(this.run, this.nodeId);
        close();
      },
    });
    keep.setDepth(DEPTH.overlay + 4);
    layer.add(keep);
  }

  /**
   * 兵败改道结算 (todos/22 s3)。原先在这里画的「兵败」占位屏由
   * `SummaryScene` 接手，死因取本场最后行动的敌人名。
   */
  private showDefeat(): void {
    // 玩家死没有 death 事件（引擎只对敌人发，phase 直接落 'lost'），
    // player-death 只能在这儿接 (todos/20 b5)。
    this.audio.play('player-death');
    applyCombatResult(this.run, 0);
    // 存档 (todos/08): the run is over the moment 体力 hits zero. Cleared here
    // rather than on the way to 结算 so that closing the tab mid-fade ends the
    // run too — a roguelike may not offer a way back past this.
    clearSave();

    const killedBy = this.lastEnemyMoveName ?? '乱军之中';
    this.cameras.main.fadeOut(dur(420), 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Summary', { victory: false, killedBy }),
    );
  }

  /**
   * Takes the one payout the victory screen owes and leaves. Every claim path
   * goes through here: `inkButton` binds `on` rather than `once`, and the fade
   * out of the scene takes 300 ms during which every hit zone is still live.
   */
  private claimReward(take: () => void): void {
    if (this.claimed) return;
    this.claimed = true;
    take();
    this.leaveToMap();
  }

  private leaveToMap(): void {
    this.cameras.main.fadeOut(dur(300), 8, 6, 4);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      returnToMap(this),
    );
  }
}

