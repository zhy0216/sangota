# 三國 · 烽火尖塔 (sangota)

A Three Kingdoms take on the *Slay the Spire* formula — Phaser 3 + TypeScript + Vite.

Current state: **v0.2 prototype — act map, first hero, and full card combat.**
Fights, cards, enemies, intents, statuses and post-combat rewards all work end to
end. Events and shops are still placeholders.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run — unit + property + golden, under a second
npm run check       # typecheck + test, what CI runs
npm run sim         # balance simulation, 9000 fights (~1s), prints markdown
npm run build       # typecheck + production bundle
```

## What's in

**Act map** — a faithful reimplementation of the Slay the Spire generator: 6 random
walks carved bottom-to-top over a 7×15 lattice, edges rejected when they would cross,
then room types assigned under the design rules (floor 1 always combat, floor 9 always
treasure, floor 15 always a camp; elite/camp/shop locked out below floor 6; no repeat
of those types along an edge or between siblings). Maps are seeded — the seed prints
bottom-left, and re-running it reproduces the layout exactly.

Validated across 400 seeds on every `npm test` (`tests/generateMap.test.ts`): every node
reachable from floor 1, no crossing edges, fixed floors correct, elite/camp/shop never
below floor 6, and no restricted type repeating up an edge or between siblings.

**Heroes** — 关羽, 赵云 and 诸葛亮, chosen on the title screen and shown in an in-map
drawer (click the HUD portrait, `Esc` to close). No hero is special-cased anywhere in the
engine. A passive is a starter relic — 青龙偃月刀 pays for the turn's *first* attack card
(+3), 涯角枪 for its *second* (+4), 纶巾 trades a card of hand size for a point of 气 —
and each hero's card pool reads exactly one number the engine already tracked: 赵云's the
attack count this turn, 诸葛亮's the size of the exhaust pile. Card faces show the
boosted number until the bonus is spent.

**Map controls** — wheel or drag to pan, `Space` recenters on your position, hover a
node for its tooltip, click a lit node to advance.

**Combat** — Slay-the-Spire turn structure: draw 5, 3 气 (energy) per turn, block
resets at the start of your turn, enemies telegraph their next move as an intent.
Statuses are 破绽 (Vulnerable, +50% damage taken), 怯战 (Weak, −25% damage dealt) and
神力 (Strength, flat damage per hit); debuffs tick down at the end of their owner's
turn. Cards come in 攻 / 谋 / 势. Click a card to play it; attack cards ask for a
target, so click the enemy (`Esc` cancels). `E` ends the turn. Winning pays gold and
offers a card reward.

24 cards, 4 enemies (黄巾力士, 山贼, elite 华雄, boss 吕布) and 6 encounter tables.

**宝物 (relics)** — permanent passives on a data-driven hook system. A relic is a row in
`combat/relics.ts`: static `modifiers` (max HP, 气 ceiling, hand size, starting block,
gold multiplier) folded in where the engine reads its constants, plus callbacks on named
hooks — `combatStart`, `turnStart`, `turnEnd`, `enemyTurnEnd`, `cardPlayed`,
`attackPlayed`, `damageTaken`, `blockGained`, `enemyKilled`, `shuffle`, `combatEnd`, and
`roomEnter` for the ones that fire out on the map. The engine calls `fireHook` at each of
those points and never names a relic, so adding one is pure data.

17 to start: 关羽's 青龙偃月刀, counter relics (督军令旗 pays block every 3 cards, 连弩
shoots every 3 attacks), 赤兔马's +1 气 for −1 card, 行商符节's gold on entering a room,
and so on. The bar sits in both HUDs — hover for the description, and an icon flashes
when its relic fires. Icons are procedural sigils seeded off the relic id; real art drops
in under the `relic-<id>` texture keys with no code change.

Nothing hands relics out yet beyond the hero's starter — 精英战 / 宝箱 / 商店 rewards are
todos 10, 05 and 11.

**Card upgrades** — every card has a forged version, named with a 「·精」 suffix and
framed in bright gold. A card definition declares only what changes (`upgrade: { … }`),
so there is no second copy of the data to keep in sync: 劈砍 6→9 damage, 结营 drops
from 2 气 to 1, 观阵 draws 3 instead of 2. Upgrades ride on the *physical* card, not on
the card id — the deck is `DeckCard[]` (`{ uid, defId, upgraded }`) with monotonic uids,
so forging one of your five 劈砍 leaves the other four alone and a run still replays
from its seed. `resolveCard(defId, upgraded)` is the single place card data is read.

Nothing hands out upgrades yet — the 营帐 blacksmith is the intended entry point.

**诅咒 / 状态牌** — the deck can now get *worse*. 诅咒 (6) ride in `run.deck` for the
whole run; 状态牌 (5) are minted into one fight and die with it. Both are ordinary cards
otherwise: they take a hand slot, obey 虚无 / 消耗 / 不可打出, and sort last in every card
screen. 焚营 burns 2 体力 at end of turn then exhausts, 醉 charges a 气 the moment it is
drawn, 反噬 costs a 体力 per card played while it sits in hand, 宿命 caps the turn at
three cards, 贪念 takes 15 资财 when the fight ends.

The behaviour that no `Effect` can express rides on `CardDef.hooks` — `onDrawn`,
`onEndTurnInHand`, `onCardPlayedInHand`, `restrictPlay` and `onCombatEnd` — fired from
five fixed points in the engine that name no card, the same contract relics run on.
`restrictPlay` is deliberately separate from `onCardPlayedInHand`: `canPlay` is what
greys a card face and is called once per card per repaint, so the gate must stay pure —
folding 反噬 onto it would cost a 体力 per frame instead of per card.

Two invariants are enforced rather than documented: `addCard` throws on a 状态牌, so one
can never become permanent, and both kinds carry `basic` rarity, which is what keeps them
structurally out of the reward pool. `removeCard(run, uid)` is the removal primitive
商店弃卡 / 营帐弃甲 / 五丈原 will all share — a curse the player cannot shed is
punishment, not a decision.

**卡牌稀有度与奖励** — the reward pool is `CARD_POOL_BY_RARITY`, keyed by
`Exclude<CardRarity, 'basic'>`, and `rollCardReward` rolls a rarity per card before
picking inside it. Weights are the original's — monster 60/37/3, elite 50/37/13, boss
40/40/20 — plus the escalation: a reward that produces no rare adds 1 to the rare weight
of the next one, and a rare resets it. Three distinct cards, never a duplicate, and a
drained tier falls *down* first so running out of commons cannot start handing out rares.

The `basic` keying is the point: the three starters, the six 诅咒 and the five 状态牌 are
all `basic`, so they are structurally unable to appear as loot. It is a type error rather
than a filter someone has to remember.

The pool went from 11 cards to 24 — 10 common, 8 uncommon, 3 rare — built on the keywords
and statuses todos 13 and 12 landed rather than being damage variants of 劈砍: 华容道 is
虚无 block, 秉烛达旦 is 保留 block, 虎牢关 is an X-cost, 水淹七军 hits everyone twice,
五百校刀手 mints three 白马义从 into hand, and the three rares are 蓄势 / 斩将 / 深沟高垒
engines. 斩将 is the one new status, and it hangs off the same kill moment 枭首令 does.

`run.cardRewardCount` is relic-driven — 求贤令 offers 4, 独断 offers 1 in exchange for
being a boss relic, and 歌钵 pays 2 最大体力 for taking 「不取」. The reward row lays out
from its own width, so 1, 3 and 4 cards are all centred.

**丹药 (potions)** — the run's only emergency resource: free to drink, no 气, no play
limit, gone after. 17 of them across three rarities — 火油罐 (20 damage), 壮行酒 (+2 气
this turn), 清心散 (strip every debuff), 孟德新书 (copy the hand), 回天丹 (refund one
death for 25 体力).

`PotionDef.effects` is the **card** `Effect` union, and `usePotion` routes it through the
same `applyEffect` queue a card uses. That is the whole design: 火油罐 into a 破绽'd 吕布
deals 30, not 20, because nothing about potions is a second damage path. Only three
behaviours the union genuinely cannot express get a `special` — `reviveOnce`,
`cleanseDebuffs`, `duplicateHand` — and the engine branches on nothing else.

Three slots, widened by relics through `modifiers.potionSlots` (药囊 grants +2, and the
belt grows the moment it is picked up without disturbing what is already in it). Drops
are seeded off the node like gold and card rewards: monster fights start at 40% and the
chance drifts ±10 so a dry streak self-corrects, elites always pay, bosses never do —
they pay in relics. A full belt asks which bottle to give up rather than silently binning
the new one.

The belt sits in both HUDs. In combat a targeted potion enters the same aiming mode a
card does, so there is one targeting interaction to learn; on the map only
`usableOutOfCombat` bottles light up, and 续命汤 is the only kind that qualifies today.
Right-click discards, twice, with the tooltip asking in between.

**Deck viewer** — `ui/CardGrid.ts` is one overlay serving every pile: the whole 牌组 from
either the combat HUD or the map HUD, plus the draw / discard / exhaust piles from the
counters in the combat corners (exhaust only appears once something has been exhausted).
Counts are live and pop when they change; hovering a thumbnail blows it up to full size
with its rules text. The panel is cut to its contents and only scrolls once the cards
overflow it.

The draw pile is displayed **shuffled**, freshly on every open. Slay the Spire lets you
know *what* is left but never *when* it comes, and that asymmetry is load-bearing for the
deck-thinning decisions — so the display order is drawn from real entropy rather than the
run's seed, and the pile itself is never touched.

The grid also has a `pick` mode returning the chosen `uid`s, which is what the campfire,
shop, events, Neow blessing and run summary will all use to point at one physical card.
`sortForDisplay` is exported so every one of those screens orders cards identically:
攻 → 谋 → 势, then cost, then id — cost read off the *resolved* def, so 结营·精 files with
the 1-cost cards the way its face reads.

Two things worth knowing here:

- Phaser sorts input hits by camera render-list index, and container children have no
  index — so a full-screen backdrop cannot be relied on to sort above the enemies. The
  overlay instead walks the display list and disables input on everything already there,
  restoring it on close. Scene-level pointer/wheel/key handlers fire regardless of what
  is under the pointer, so `MapScene` and `CombatScene` bail out of theirs on
  `isCardGridOpen(scene)`.
- `previewValues` / `describeCard` take `CombatState | undefined`: the map has no fight
  to read, and the alternative — a dummy state at each call site — is a card face that
  lies as soon as the dummy drifts.

The rules live in `combat/engine.ts` as pure functions with no Phaser import, so the
whole system is testable headlessly — see [Testing](#testing).

**Combat feel** — `ui/vfx.ts` holds the reusable effects (tapered brush-stroke slashes,
impact bursts, dust, shield flares, ink splashes, pop text, screen washes, turn bands);
the scene layers on lunges, recoils, idle breathing, topple-and-dissolve deaths,
trailing "damage taken" HP segments, energy-orb pops, intent-badge reveals, and cards
that deal out of the draw pile and sail off to the discard.

The engine emits a `CombatEvent[]` and the scene drains it, so animation is sequenced
off the rules rather than interleaved with them — the two can be tuned independently.

Two things worth knowing if you touch this:

- `setTintFill` on a sprite flattens it to a solid silhouette, which reads as a render
  glitch against painterly art. The hit flash is an additive *copy* of the sprite
  instead, so all the detail survives.
- `hitStop()` scales only `tweens.timeScale`, never `time.timeScale` — the animation
  `await`s run on the scene clock, so slowing that would stretch the whole sequence
  instead of punctuating it.
- Camera shake pulls empty space in at the edges, so the combat backdrop and ground
  band are drawn with ~6% bleed.

## Testing

Three layers, cheapest first. `npm test` is all of layers 1–2 and finishes in well
under a second; the balance sim is opt-in.

**Layer 1 · unit and property tests** (`tests/`) — exact assertions on the pure rules:
the composition order and per-step flooring of 神力/怯战/破绽 in `computeAttack`, block
absorption in `applyDamage`, debuff decay, draw-pile reshuffling and the `MAX_HAND` cap,
`maxRepeat` on intents across 200 seeds per enemy, and the 400-seed map property test.

The one that matters most is card-face consistency: every one of the 24 cards is
actually played, in both upgrade states, against five status loadouts and with the
passive both available and spent — 480 cases asserting that the number on the card face
equals the HP that comes off. A card face that lies is the worst bug this genre has, and
this suite caught one during the pool expansion: 单刀赴会 promised 6 and dealt 12,
because a card leaves the hand *before* its effects resolve and only the resolver knew
it. `previewValues` now reads the hand the effects will see.

`tests/integrity.test.ts` also greps the rules layer for `Math.random` and for Phaser
imports, so determinism and headlessness can't be lost by accident.

`tests/cardGrid.test.ts` pins the display ordering every card screen shares, and the
draw pile's scrambled display: same contents, a different order on essentially every
opening (60 openings, >50 distinct orders, at most one matching the real pile order).

**Layer 2 · golden snapshots** (`sim/__snapshots__/`) — 20 fixed fights across every
encounter table, with the complete `CombatEvent` stream committed byte-for-byte. These
are the record of correct behaviour *before* the damage-pipeline work, so a silent
numeric drift shows up as a diff rather than as a game that quietly got easier.

The net is verified, not assumed: setting `VULNERABLE_MULT` to 1.4 fails 18 of the 20
snapshots plus 3 unit assertions. The two that survive are the two fights where
Vulnerable never landed.

**Layer 3 · balance simulation** (`npm run sim`) — 500 fights per cell over three AI
policies (`random` as a floor, `greedy`, `threat`) and three deck profiles.

**starting deck** (10 cards, floor 1)

| | random AI | greedy AI | threat AI |
|---|---|---|---|
| trash | 99% win · 6.6 turns · 45 hp left | 100% · 4.2 turns · 56 hp | 100% · 4.2 turns · 56 hp |
| elite 华雄 | 65% · 7.0 turns · 16 hp | 100% · 4.8 turns · 26 hp | 99% · 4.8 turns · 27 hp |
| boss 吕布 | 0% · 8.0 turns | 12% · 6.1 turns · 6 hp | 7% · 6.8 turns · 6 hp |

**act-1 deck** (16 cards, three forged — what you actually reach floor 15 with)

| | random AI | greedy AI | threat AI |
|---|---|---|---|
| trash | 100% · 6.2 turns · 58 hp | 100% · 4.3 turns · 60 hp | 100% · 4.2 turns · 60 hp |
| elite 华雄 | 92% · 7.3 turns · 31 hp | 100% · 4.7 turns · 34 hp | 100% · 4.7 turns · 35 hp |
| boss 吕布 | 49% · 9.6 turns · 14 hp | 53% · 6.7 turns · 10 hp | 62% · 7.6 turns · 9 hp |

**act-1 rolled deck** (the same shape, drafted out of `rollCardReward` instead of a
hard-coded list — this is the profile that actually measures the expanded pool)

| | random AI | greedy AI | threat AI |
|---|---|---|---|
| trash | 100% · 5.6 turns · 58 hp | 100% · 4.1 turns · 61 hp | 100% · 4.1 turns · 62 hp |
| elite 华雄 | 95% · 6.3 turns · 33 hp | 100% · 4.5 turns · 39 hp | 100% · 4.5 turns · 40 hp |
| boss 吕布 | 49% · 8.4 turns · 18 hp | 71% · 6.5 turns · 15 hp | **78%** · 6.8 turns · 16 hp |

⚠️ **The pool expansion overshoots its own acceptance band.** todos/11 asks for a 吕布
win rate inside 40–75% after the pool reaches 24 cards; drafting from the new pool the
threat policy reaches **78%**, three points over. The hard-coded `act-1` profile above is
held fixed as a control and reads 49/53/62% — bit-identical to what it read before the
expansion — so the drift is the new cards, not the rules.

A per-card sweep (control deck plus two copies, 500 fights on 吕布) isolates it to two
cards, both of which hand back the 气 they cost:

| card | greedy | Δ | threat | Δ |
|---|---|---|---|---|
| 土山约三事 | 95% | +42 | 95% | +27 |
| 斩颜良 | 90% | +38 | 90% | +21 |
| *every other new card* | ≤59% | ≤+6 | ≤67% | ≤−1 |

土山约三事 is 0 气 for +2 气 and +2 cards, so it is card- and tempo-positive at once and
snowballs into itself; 斩颜良 refunds its 气 against a 破绽'd target, which this deck
keeps up more or less permanently. Everything else in the 13 is neutral or a slight loss
at boss scale. Left as-is and recorded rather than quietly re-tuned — the numbers above
are the brief for that decision.

Deck profile turns out to matter more than policy, which is why all three are reported. 吕布
is close to unwinnable against the bare starting deck (12% / 7%) and a real fight once
the deck has grown (53% / 62%) — quoting one number per tier without saying which deck
it assumes hides the whole difficulty curve. The threat-aware policy only pulls ahead on
the boss, and only with a grown deck: 吕布 punishes bad sequencing, while 华雄 dies fast
enough that blocking is wasted tempo.

The sim also prints HP-left deciles. An average of 10 HP left can mean "everyone
finishes around 10" or "half die, half finish at 20", and those are completely different
to play — on the act-1 boss the deciles read `0 · 0 · 0 · 1 · 3 · 5 · 7 · 11 · 18`, so it
is the second one.

Combat invariants are re-checked after every single action across 360 fights
(`sim/invariants.test.ts`): card conservation over draw/hand/discard/exhaust with no
uid in two piles, non-negative energy and block, HP within bounds, no living enemy at
0 HP, no dead enemy still telegraphing, and every fight terminating.

The driver has two protective bail-outs so a rules bug reports itself instead of hanging
CI: a turn cap, and a state-hash detector that fires when nothing has changed for 16
iterations. Both are themselves tested.

**Layer 4 · balance evaluation** (`npm run eval`, `sim/evaluate.sim.ts`) — the tuning
compass, where the sim above is the acceptance gate. It asserts no balance number;
it ranks. Three instruments, each answering a question the banded tables cannot:

- **卡牌边际价值** — every draftable card, for every hero: act-1 kit ± two copies
  against the act-1 bosses, paired seeds, Δ win rate per card and per rarity pool.
  The instrument that found 土山约三事/斩颜良 by hand, automated.
- **宝物边际价值** — every droppable relic on a bare act-2 deck: Δ boss win rate and
  Δ elite HP cost, the same two metrics the bands are written in.
- **难度曲线** — the 天命连场 walk re-run with per-step bookkeeping: entries, deaths
  and HP at every one of the 36 steps, so the difficulty spike is a row you point at
  rather than a mode hidden in "最常阵亡处". Seeds are shared with the gate's table,
  so its clear rates must match that table exactly — drift means the copy rotted.

Output goes to the console and to `out/eval/report.{md,json}`; the JSON is the
cross-commit artifact — run before and after a tuning change and diff it. Caveats
printed in the report header: Δ is policy-playable value (X-cost and engine cards
read low), ±10 points is noise at 300 fights, and map-economy relics measure ≈0 by
construction.

## Retina / HiDPI

Phaser 3 has no HiDPI mode — it renders into a backing store the size of the game
and lets CSS stretch it. On a Retina Mac with a window wider than 1280 that was a
~2.4× upscale, which made text and UI visibly soft.

The fix, in `config.ts` + `ui/designSpace.ts`: size the canvas to the physical pixels
it will actually occupy (`RENDER_SCALE = fitScale × devicePixelRatio`, clamped to
1–3), then give every scene camera a matching `setZoom(RENDER_SCALE)` with
`setOrigin(0, 0)`. With origin 0 the camera transform collapses to
`screen = (world − scroll) × zoom`, so all scene code, scroll values and input
hit-testing keep working in 1280×720 design units — nothing else had to move.

Two consequences worth knowing:

- Text needs `resolution: RENDER_SCALE` in its style or the glyph canvas is rasterised
  at design size and then magnified. Both style helpers in `ui/theme.ts` set it.
- `Camera.setBounds` clamping assumes an origin of 0.5, so scenes using design space
  clamp scroll themselves (`MapScene` already did).

`RENDER_SCALE` is computed once at boot. Enlarging the window afterwards falls back to
Phaser's FIT scaling, so it softens gradually rather than re-laying out mid-run;
reload to re-sharpen.

## Layout

```
src/
  config.ts            palette, fonts, map layout, RENDER_SCALE
  core/rng.ts          seeded mulberry32 — one seed drives a whole run
  map/generateMap.ts   the act generator (walks + room-type rules)
  map/roomMeta.ts      room labels, flavour, icon keys, accent colours
  combat/types.ts      card / enemy / combat-state shapes
  combat/cards.ts      card definitions (re-exports the status table)
  combat/statuses.ts   the 18-status table: damage slots, ticks, decay
  combat/enemies.ts    enemy definitions, move tables, encounter tables
  combat/engine.ts     pure combat rules — no Phaser, headlessly testable
  data/heroes.ts       hero definitions + starting decks
  state/run.ts         run state: hp, gold, deck, map, current node, path
  ui/theme.ts          ink panels, buttons, gold rings, gradients
  ui/designSpace.ts    camera setup for HiDPI rendering in design units
  ui/spriteBounds.ts   alpha-bounds measurement for grounding cut-out actors
  ui/CardView.ts       one card face
  ui/CardGrid.ts       the deck / pile overlay — view and pick modes
  ui/cardOrder.ts      display ordering shared by every screen that lists cards
  ui/vfx.ts            reusable combat effects (slashes, bursts, banners, pop text)
  ui/statusIcons.ts    procedural 20×20 status glyphs (placeholder art)
  scenes/              Boot → Title → Map ⇄ Combat
sim/
  policy.ts            AI drivers: random / greedy / threat
  runCombat.ts         headless combat driver + protective bail-outs
  balance.sim.ts       balance tables (npm run sim, not npm test)
  golden.test.ts       20 committed CombatEvent streams
  invariants.test.ts   per-action invariant fuzz
tests/                 unit + property tests
public/assets/         generated art (map, hero, icons, enemies, card art)
```

## Notes on two things that bite

**Cut-out actors float.** Background removal leaves a different transparent margin on
every plate, so scaling and positioning by the image rectangle puts characters at
inconsistent sizes hovering above the ground. `ui/spriteBounds.ts` measures the opaque
bounding box once at boot and `groundSprite()` sizes by *content* height and plants the
feet on the baseline.

**Masks are in screen space.** A Phaser geometry mask is rendered through the camera,
so masking a card's art window breaks the moment the card moves, scales or fans. Card
art is instead pre-cropped to the window's 3:2 aspect at asset-processing time.

## Art

Generated with the `genmedia` CLI (fal.ai): `nano-banana-pro` for the plates,
`bria/background/remove` for cut-outs. Style brief is one shared line — ink-wash
(水墨) crossed with hand-painted dark-fantasy card art, ink black and aged rice paper
with cinnabar and antique gold accents. Source plates are kept in `out/gen/`;
`public/assets/` holds the downscaled versions the game actually loads.

Everything on screen is generated — all 65 card faces, three heroes in portrait and
full body, the four room plates, the enemies, the map and the 拜别 screen. Nothing
falls through to a procedural stand-in any more, though every stand-in is still in
the code and still takes over for a texture that fails to load.

The shared line alone was not enough to keep 60-odd plates in one style. What holds
them together is passing an already-shipped plate as a **style reference** to
`nano-banana-pro/edit` — `cards/pikan.jpg` for every card face, the 关羽 portrait and
full body for every actor — with the prompt naming the new scene and stating that only
the palette, brush treatment and framing carry over. Asked for the same style in words
only, the model drifts pale and draws a torn-paper border around the art, which is
exactly the wrong thing for a plate that gets cropped into a card window.

Bitmaps are exported for the HiDPI render size, not the design size: the map plate is
generated at 4K and shipped near 1:1 with its on-screen physical pixels, and the hero
is exported ~1900px tall for a ~780 design-unit display. Anything softer than that
shows up immediately once the canvas is pixel-exact. Card faces ship at 480×320 for a
136×91 design-unit window, and actors keep the canvas sizes the cut-outs already used
(640×640 portraits, 1060×1900 full bodies) so `spriteBounds` grounds them all alike.

The 拜别 backdrop is composed against the layout rather than cropped to fit it: the
shrine and moon sit left under 道人, the right half is left empty for the four gift
rows, and the horizon is placed where `FIGURE_ART_H` puts his feet — so the figure
stands on the road instead of on the shrine roof.

## Known gaps

- ~~No save/resume~~ — **done (todos/08, 阶段六).** One `localStorage` slot, written at
  every room boundary and at every quiescent moment of a fight; the title screen offers
  继续 (mid-fight included), asks before overwriting, and refuses stale or broken
  payloads with a reason instead of silently starting over. The map is regrown from its
  seed rather than stored, `SavedRun` is derived from `RunState` via `Omit` so a new
  field is a compile error rather than a lost one, and the draft's `savedAt` field does
  not exist because 约定 2 bans the clock project-wide. The debts 09 and 18 logged
  against this item are repaid with tests (`tests/save.test.ts`, 34 of them).
- **Events and shops are one global pool**, not one per act. `ActDef` has the extension
  point; nothing fills it.
- **The victory screen is a placeholder.** `InterludeScene.paintVictory()` prints three
  numbers. The real 结算 is todos/22; its entry point is already wired.
- **赵云's 连击 count is not on the combat HUD.** The counter itself
  (`state.attacksThisTurn`) has existed since 阶段三 — what is missing is one readout in
  `CombatScene`, deliberately not added blind because Phaser UI cannot be tested here.
- **No hero-locked droppable relics.** `RelicDef.hero` filters correctly and the three
  starter relics are unobtainable by design, but nothing uses the hook to ship a relic
  only one general can find.
- **Five balance rows are out of band, and all five are frozen.** 张曼成 costs 28–31% of
  a health bar where an elite should cost 40–55%, 张梁 wins 73% of the time and 张宝
  74/82% against a 45–70% band, and 华雄 costs 57–59%. Every one is a 第一幕 enemy owned
  by a golden snapshot, so none can move without a sanctioned re-record. Diagnoses are
  written down; 第二幕 onward is in band.
- **An engine hang is reachable in normal play.** `playCard` → `pumpEffects` →
  `applyEffect` → `drawCards` can re-enter unbounded on a deck holding three 观阵, and
  both existing guards miss it — `maxTurns` is only checked between actions, and
  `hashState` counts `state.events.length` as progress, so a loop that appends events
  looks like forward motion forever. A repro seed is recorded at the `GAUNTLETS`
  declaration in `sim/balance.sim.ts`.
- **Best-rarity drafting measures worse than uniform drafting** (张辽 16% vs 25%) — the
  rare cards are either overcosted or unusable by the greedy/threat policies.
- **No sound at all** — every beat of combat feel is currently visual only.
