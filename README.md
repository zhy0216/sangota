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
npm test            # vitest run
npm run build       # typecheck + production bundle
```

## What's in

**Act map** — a faithful reimplementation of the Slay the Spire generator: 6 random
walks carved bottom-to-top over a 7×15 lattice, edges rejected when they would cross,
then room types assigned under the design rules (floor 1 always combat, floor 9 always
treasure, floor 15 always a camp; elite/camp/shop locked out below floor 6; no repeat
of those types along an edge or between siblings). Maps are seeded — the seed prints
bottom-left, and re-running it reproduces the layout exactly.

Validated across 400 seeds: every node reachable, no rule violations, room mix landing
at roughly monster 49% / event 21% / camp 12% / elite 7% / shop 3%.

**Hero** — 关羽 (Guan Yu), with a title screen card and an in-map drawer (click the HUD
portrait, `Esc` to close). Passive 青龙偃月: the first attack card each turn deals +3,
and the card face shows the boosted number until it is spent.

**Map controls** — wheel or drag to pan, `Space` recenters on your position, hover a
node for its tooltip, click a lit node to advance.

**Combat** — Slay-the-Spire turn structure: draw 5, 3 气 (energy) per turn, block
resets at the start of your turn, enemies telegraph their next move as an intent.
Statuses are 破绽 (Vulnerable, +50% damage taken), 怯战 (Weak, −25% damage dealt) and
神力 (Strength, flat damage per hit); debuffs tick down at the end of their owner's
turn. Cards come in 攻 / 谋 / 势. Click a card to play it; attack cards ask for a
target, so click the enemy (`Esc` cancels). `E` ends the turn. Winning pays gold and
offers one of three cards.

11 cards, 4 enemies (黄巾力士, 山贼, elite 华雄, boss 吕布) and 6 encounter tables.

**Card upgrades** — every card has a forged version, named with a 「·精」 suffix and
framed in bright gold. A card definition declares only what changes (`upgrade: { … }`),
so there is no second copy of the data to keep in sync: 劈砍 6→9 damage, 结营 drops
from 2 气 to 1, 观阵 draws 3 instead of 2. Upgrades ride on the *physical* card, not on
the card id — the deck is `DeckCard[]` (`{ uid, defId, upgraded }`) with monotonic uids,
so forging one of your five 劈砍 leaves the other four alone and a run still replays
from its seed. `resolveCard(defId, upgraded)` is the single place card data is read.

Nothing hands out upgrades yet — the 营帐 blacksmith is the intended entry point.

The rules live in `combat/engine.ts` as pure functions with no Phaser import, so the
whole system is testable headlessly — see below.

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

**Balance** — 150 simulated fights per tier, two AI policies:

| | greedy AI | threat-aware AI |
|---|---|---|
| trash | 100% win · 6.1 turns | 100% win · 4.2 turns |
| elite 华雄 | 85% · 23 hp left | 94% · 29 hp left |
| boss 吕布 | 41% · 17 hp left | 71% · 17 hp left |

The boss gap between the two policies is the point: 吕布 punishes bad sequencing and
is winnable with good play. 吕布 was tuned down from an unwinnable 0% after the first
sim run — Strength compounds viciously on multi-hit moves (+4 Strength on a 4-hit
attack is a 16-damage swing in one turn).

Combat invariants checked across 360 fights with zero violations: card conservation
across draw/hand/discard/exhaust, non-negative energy and block, HP within bounds,
no living enemy at 0 HP, and every fight terminating.

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
  combat/cards.ts      card definitions + status metadata
  combat/enemies.ts    enemy definitions, move tables, encounter tables
  combat/engine.ts     pure combat rules — no Phaser, headlessly testable
  data/heroes.ts       hero definitions + starting decks
  state/run.ts         run state: hp, gold, deck, map, current node, path
  ui/theme.ts          ink panels, buttons, gold rings, gradients
  ui/designSpace.ts    camera setup for HiDPI rendering in design units
  ui/spriteBounds.ts   alpha-bounds measurement for grounding cut-out actors
  ui/CardView.ts       one card face
  ui/vfx.ts            reusable combat effects (slashes, bursts, banners, pop text)
  scenes/              Boot → Title → Map ⇄ Combat
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

Bitmaps are exported for the HiDPI render size, not the design size: the map plate is
generated at 4K and shipped near 1:1 with its on-screen physical pixels, and the hero
is exported ~1900px tall for a ~780 design-unit display. Anything softer than that
shows up immediately once the canvas is pixel-exact.

## Known gaps

- 奇遇 (events) and 商旅 (shops) still show a placeholder toast. 营帐 heals 30% and
  宝藏 pays gold, but neither has a real screen yet.
- One act, one hero. Beating 吕布 ends the map with nothing after it.
- No deck viewer, no relics, no save/resume.
- Card upgrades exist as model + card face + `upgradeCard()`, but no screen grants
  them yet.
- No sound at all — every beat of combat feel is currently visual only.
