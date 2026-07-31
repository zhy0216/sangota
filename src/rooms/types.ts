import type { ChestSize } from '../combat/rewards';
import type { DeckCard } from '../state/run';

/**
 * The shared vocabulary of the room layer. Types only — no Phaser, no runtime
 * value that another module could read at import time (约定 7), so both the
 * pure room modules and the scene that draws them can import it freely.
 *
 * Everything a room decides at random is *materialised* into `RunState.rooms`
 * the first time the player walks in (R5). Leaving and coming back re-reads the
 * record rather than re-rolling it: a seeded stream alone is not enough,
 * because a shop's stock roll filters against relics the player may have bought
 * from that very shelf.
 */

// ------------------------------------------------------------------- 商店

/**
 * `price` is always what the player pays. `listPrice` is set only on the one
 * discounted slot and holds what the tag *would* have said — a struck-through
 * number the view can print beside the real one. Storing the discount as the
 * pre-discount price rather than as a flag keeps the arithmetic in the room
 * layer, where it can be tested, instead of in the tag that draws it.
 */
export interface ShopCardOffer {
  defId: string;
  upgraded: number;
  price: number;
  listPrice?: number;
}

export interface ShopRelicOffer {
  id: string;
  price: number;
  listPrice?: number;
}

export interface ShopPotionOffer {
  id: string;
  price: number;
  listPrice?: number;
}

/**
 * A shelf. `sold` slots stay in place with a struck-through price rather than
 * collapsing, so the layout does not jump under the player's cursor — the
 * "was it bought" truth lives in the commit ledger, not here.
 */
export interface ShopStock {
  cards: ShopCardOffer[];
  relics: ShopRelicOffer[];
  potions: ShopPotionOffer[];
}

/** Addresses one shelf slot. `index` indexes the matching `ShopStock` array. */
export type ShopSlot =
  | { kind: 'card'; index: number }
  | { kind: 'relic'; index: number }
  | { kind: 'potion'; index: number };

// ------------------------------------------------------------------- 宝藏

/**
 * What a chest holds, frozen on first sight. `size` picks the relic's tier
 * weights and the 丹药 chance; `gold` is the base roll plus the consolation a
 * dry relic pool owes, so it is what the player banks and not what was printed.
 * Both ids stay nullable: a chest whose whole ladder is owned holds no relic,
 * and a 小宝藏 never holds a bottle.
 */
export interface ChestLoot {
  size: ChestSize;
  gold: number;
  relicId: string | null;
  potionId: string | null;
}

export interface TreasureReport {
  gold: number;
  relicId: string | null;
  potionId: string | null;
  /** True when the belt was full and the bottle had to be left behind. */
  potionRefused: boolean;
}

// --------------------------------------------------------------- 选牌

/**
 * What a deck pick that has been paid for but not yet answered is asking for.
 *
 * Lives here rather than beside `applyOutcome` because three unrelated places
 * hold one: an 奇遇's node ledger (`pendingPick`), 开局祝福's `run.blessing`
 * (todos/18), and the grid that draws either of them. Types only, so none of
 * them has to import another's module.
 */
export type DeckPickKind = 'remove' | 'upgrade' | 'transform';

export interface DeckPick {
  kind: DeckPickKind;
  count: number;
}

// --------------------------------------------------------------- 房间台账

/**
 * Per-node ledger. `committed` is the *only* source of truth for "has this
 * already been done" — a shop node carries eight or more unrelated one-shot
 * actions, which no single `done` boolean can express.
 *
 * A payload of `null` means "not materialised yet"; the room module fills it on
 * first entry and every later visit reads it back unchanged.
 */
/**
 * 战利品 — what a won fight paid, frozen on the node.
 *
 * The victory screen used to roll all three of these inline in `CombatScene`
 * and materialise none of them, which made it the one room in the game showing
 * the player a random result with nowhere to write it down (R5). It also drifts
 * two run-wide counters as a side effect — `rareBump` on the card roll and
 * `potionChance` on the drop — so a second `create()` on a won node paid twice
 * *and* moved the odds of every later fight.
 */
export interface Spoils {
  gold: number;
  cardIds: string[];
  /** The bottle that dropped, or null for a miss. The id is rolled either way. */
  potionId: string | null;
}

export type RoomRecord =
  | {
      kind: 'combat';
      committed: string[];
      encounterId: string | null;
      relicId: string | null;
      spoils: Spoils | null;
    }
  | { kind: 'rest'; committed: string[] }
  | { kind: 'shop'; committed: string[]; stock: ShopStock | null }
  | { kind: 'event'; committed: string[]; eventId: string | null }
  | { kind: 'treasure'; committed: string[]; loot: ChestLoot | null };

export type RoomKind = RoomRecord['kind'];

// --------------------------------------------------------------- 场景数据

/**
 * One button in a room's option row. Rooms describe what they offer; the scene
 * decides how it looks. `id` is the room module's own vocabulary and comes
 * straight back through `onPick`.
 */
export interface RoomOptionView {
  id: string;
  label: string;
  /** Second line under the label — the cost, the odds, the warning. */
  hint?: string;
  disabled?: boolean;
  /** Shown instead of acting when a disabled option is clicked. */
  disabledReason?: string;
  tone?: 'default' | 'gold' | 'danger';
}

/**
 * A deck-picking request handed to `RoomHost.pickCards`. The host — not the
 * grid — clamps `count` to what is actually selectable and skips the overlay
 * entirely when nothing is: a mandatory pick of 2 from a pool of 1 would
 * otherwise leave the footer asking for a card that cannot be given.
 */
export interface PickRequest {
  title: string;
  subtitle?: string;
  count: number;
  /** Which copies may be offered at all. Default: the whole deck. */
  filter?: (card: DeckCard) => boolean;
  /** Non-null greys the card out and explains why. */
  disable?: (card: DeckCard) => string | null;
  /** Draw the forged face beside the current one — 营帐锻造 and 商店升级. */
  compareUpgrade?: boolean;
  /** Replaces the stock 「请选择 N 张」 footer. */
  footerHint?: string;
  /** null picks the moment the count is met; a string labels a confirm button. */
  confirmText?: string | null;
  /** False makes the choice mandatory — no ×, no Esc, no click-outside. */
  cancellable?: boolean;
  onPick: (uids: string[]) => void;
  onCancel?: () => void;
}
