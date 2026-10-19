# Game Deep Dives

Per-game notes plus the shared game helpers. Constraints that apply to every page are in [AGENTS.md](../../AGENTS.md); read that first.

## ❓ Game Rules Helper (js/gamerules.js)

`js/gamerules.js` adds a "?" button to the title bar of games whose rules may not be universally known, opening a System 7 "How to Play" modal.

### How it works
- Pages opt in simply by including `<script src="js/gamerules.js"></script>` (in `<head>`, next to `js/i18n.js`).
- The game is detected from the page **filename** via the `ALIASES` map (e.g. `2pchess`, `livechess` → `chess`), so variants share one rules entry.
- Rules text lives in the `RULES` registry as English default HTML. At open time it calls `window.t('gamerules.<key>', defaultHtml)`, so translations can be added to locale files later without touching this script. Title/close use `gamerules.title` / `gamerules.close`.
- The modal (`#gamerules-overlay`) is appended to `<body>` (never inside `.window`) to dodge the stacking-context trap, with all CSS scoped under `#gamerules-*` selectors and explicit resets per the injected-UI rules in `AGENTS.md` (Standard UI Patterns, section 6).

### Button placement gotcha
Several games already have right-side title-bar controls (e.g. `yahtzee.html` New/Scores buttons, `chess.html` Stats, `2048.html` Reset, `spellbound.html` Stats, `oregontrail.html` Restart). The script measures those siblings with `offsetLeft`/`offsetWidth` (**pre-zoom layout units** — safe under theme.js CSS `zoom`, unlike `getBoundingClientRect()`) and shifts the "?" button left of them. All target pages' `.title-bar` rules have `position: relative`, which this relies on.

### Adding a new game
1. Add an entry to `RULES` (key) and `ALIASES` (filename → key) in `js/gamerules.js`.
2. Include the script tag in the page's `<head>`.
3. Optionally add `gamerules.<key>` translations to the locale files.

Games deliberately **excluded** (rules universally known / self-evident): tictactoe (+2p/live), snake, tetris, crossy, dino, hangman, memory, maze, jigsaw, circle, doom, mario, trivia, airtype, uno.html (menu wrapper — rules live on `liveuno.html`), life.html (life calendar, not a game).

## 🎮 Single-Player Games Catalog

The dashboard (`index.html`) reads the app registry from `icons.js`. Games are grouped by the `cat` property:

| Category | Purpose |
| :--- | :--- |
| `games` | Single-player / solitaire games |
| `two_player` | Local pass-and-play multiplayer |
| `live_game` | Firebase real-time online multiplayer |

### Single-player vs multiplayer split

Several games exist as both a single-player file and a multiplayer file. The single-player version is the canonical game name (e.g. `chess.html`), and the local/online variants add a prefix (`2pchess.html`, `livechess.html`). Following this convention keeps the catalog consistent and avoids confusing users.

### Single-player games added

*   **Tic-Tac-Toe** — `tictactoe.html` (vs CPU with Easy/Hard). Based on `2ptictactoe.html`; uses a minimax AI on Hard and random on Easy.
*   **Connect 4** — `connect4.html` (vs CPU with Easy/Hard). Based on `2pconnect4.html`; supports the same 4-in-a-row and 5-in-a-row toggle. Hard mode uses minimax with alpha-beta pruning to depth 4 plus a heuristic window evaluation.
*   **Dots & Boxes** — `dotsandboxes.html` (vs CPU with Easy/Hard). Based on `2pdotsandboxes.html`. Easy is greedy-box. Hard completes boxes, avoids giving the opponent a 3-sided box, and prefers moves that set up future boxes.
*   **Battleship** — `battleship.html` (vs CPU). Based on `2pbattleships.html`. Player places ships manually or with Auto; CPU places ships randomly and fires using hunt/target mode after a hit.
*   **Uno** — `uno.html` (solo vs bots). A wrapper that launches `liveuno.html?single=1`. The live game detects the `single=1` parameter and automatically hosts a 4-player match with 3 bots, starting immediately. The `liveuno.html` menu also has a "Play Solo vs Bots" button for the same mode.
*   **Jumpy** — `jumpy.html` (Doodle Jump-style vertical platformer). See its own section below.

All new single-player files disable CSS animations/transitions (`* { transition: none !important; animation: none !important; }`) and reuse the same System 7 window/title-bar patterns as their 2-player counterparts.

### Game mode badges and folder grouping

Games that exist in multiple modes are grouped by name in the dashboard (`index.html` → `getGroupedApps()`). The folder modal uses mode badges instead of mode names as the icon labels:

| Mode | Property | Badge |
| :--- | :--- | :--- |
| Single-player | `single: true` in `icons.js` | `1P` (`one-p-label`) |
| Local 2-player | `cat: 'two_player'` | `2P` (`two-p-label`) |
| Live online | `live: true` | `LIVE` (`live-label`) |
| New app | `new: true` in `icons.js` | `NEW` (`new-label`) |

Single-player entries that have a multiplayer counterpart (e.g. `chess`, `checkers`, `pool`, `yahtzee`, `battleship`, `connect4`, `dotsandboxes`, `tictactoe`, `uno`) should set `single: true` so the folder items are labeled with the game name and the correct badge.

**Important:** Do **not** add `single: true` to games that are single-player-only and have no multiplayer variant in the project (e.g. `crossy`, `dino`). That flag is only for the folder-grouping badge system. For solid pixel-art icons, use `filled: true` instead.

## 🟦 Cube Dash (cubedash.html)

An original cube/ship platformer inspired by Geometry Dash. It started as a port of kindle-geometrydash.netlify.app but was rewritten (2026-07) with **original branding, original level designs, and new mechanics** — do not reintroduce the reference's level strings or names. All 10 levels are original and were verified completable (with all gears reachable) by a headless bot harness.

### Mechanics (beyond the reference)
*   **Ship mode:** `w`/`q` portals switch between cube and ship. Ship physics: hold input to thrust (`SHIP_RISE -0.85` vs `SHIP_FALL 0.65`, terminal ±6.5), floor/ceiling contact is safe, any solid obstacle kills. `inputHeld` drives ship thrust AND cube auto-hop (holding = repeated jumps, like GD).
*   **Gears (`*`):** collectible, saved per-level as a bitmask in `cubedash_save_v1`. Hitbox is `x-60, w 70, top 76, h 110` — deliberately offset so a gear one char after a spike is grabbed mid jump-arc, and NOT collectable while running grounded. **If you change jump physics, re-verify gear reachability.**
*   **Obstacle grammar:** `s` spike / `d` double / `3` triple, `b` block / `h` tall block, `S` block+spike (pure kill zone), `c` ceiling spike, `P` floor pillar 88 / `U` hanging pillar 88 / `B` floating platform (top 124 — landable from a floor jump; do not move it lower), `p` pad, `r` ring, `g`/`n` gravity, `f`/`o` speed, `w`/`q` ship portals, `*` gear, `e` end gate.
*   **Physics:** 60Hz fixed timestep; gravity 1.0, jump -14, terminal 13, 80% hitbox, coyote 6 / buffer 7. Triple spikes have only a ~3-frame jump window (authentic GD tightness, do not "fix"). Portals/gates/end flag span the full corridor (`CEIL_Y 40`..`FLOOR_Y 216`) so they trigger at any altitude.
*   **Rendering is strict 1-bit — Simple Mode is FORCED ON and settings are removed** (2026-07). Like Surfer, any anti-aliased canvas pixel forces full e-ink grayscale refreshes (constant flashing), so `drawFrame()` may only use integer `fillRect` via the `fillB`/`fillW`/`rectB` helpers, Bresenham `lineB()` for diagonals, and midpoint `circleB()`/`discB()` for circles. **Banned:** `arc()`, `stroke()`/`strokeRect()`, `beginPath`/`lineTo` strokes, `ctx.rotate`/`translate` for gameplay sprites, and fractional coordinates. The cube's spin is faked with a quantized 8-direction spoke; the ship tilts via `rotPts()` + scanline `fillPolyW()` on integer-rounded points; the ring pulse steps integer radii 10–12. There is no parallax, no death particles, no settings overlay — do not reintroduce them without keeping the 1-bit rule.

### Level design & validation
Level strings live in `LEVELS` (char = 130px grid, start x 520). **Any level edit must be re-validated headlessly**: stub the DOM, `eval` the inline script, and auto-play — cube bot jumps at gap 58 (single) / 46 (double+S) / 20 (triple) / 105 (block family) measured from obstacle-left to player-right (123); ship bot holds when `y+13 > targetY` where targetY is the gap center of the nearest solid. Rules learned: gears belong exactly one char after spike-family hazards; never put floor spikes inside ship sections; after `q` (cube portal) leave ≥3 chars before the next hazard (ship-exit fall distance).

### Saves
`localStorage` `cubedash_save_v1` = `{progress[], gears[]}`. The old `gdash_*` keys, `gdash.html`, and the `cubedash_simple_v1` simple-mode key are all deleted; there is no migration (progress was trivial to re-earn). No Firebase/leaderboard — if one is added, update `firestore.rules` per the rule checklist.

## 🐸 Jumpy (jumpy.html) — Doodle Jump-Style Platformer (2026-07)

Portrait canvas (256×384 buffer, 2:3), pure B&W primitives drawn with `fillRect` (no sprite assets). Fixed 60Hz timestep with an rAF accumulator (dt clamped to 250 ms) so physics are identical on 7fps e-ink and 144Hz desktop. **`TIME_SCALE = 0.55`** scales real→simulated ms in the accumulator — this is THE e-ink pacing knob (bounce period ~1.9s, move speed ~119 px/s at 0.55; users reported 1.0 as "way too fast" on e-ink). Always tune speed via `TIME_SCALE`, never via gravity/jump velocity, so the spatial invariants below stay valid. Input: holdable ◀ ▶ buttons, arrow keys/A-D, or touch halves of the canvas (multi-source flags synced via `syncMove()`). Leaderboard `leaderboard_jumpy` (rules in `firestore.rules`); localStorage key `jumpy_highscore_v1`.

### Generator invariants (found via headless bot harness — do NOT break)
The platform generator tracks the last **bouncable** platform (`lastBouncableY/X/Type`) because breakable platforms don't bounce, and constraint checks must apply to the bouncable chain, not consecutive platforms:

1. **Vertical:** every bouncable platform ≤ 100px above the previous bouncable one (max jump height is ~166px at `GRAVITY 0.35` / `JUMP_V -10.8`). Enforced by clamping `y = lastBouncableY - 100`, NOT by converting types — converting a breakable to normal when >100px above the last bouncable does NOT help (the new platform itself ends up too far). This bug appeared twice before the clamp was added.
2. **Breakables:** only spawn ≤55px above the last bouncable platform, leaving ≥45px room for the next bouncable one. This also prevents two breakables in a row.
3. **Horizontal:** bouncable-to-bouncable center distance ≤110px. Constraining only consecutive platforms lets dx chain through breakables up to ±240px — beyond the ~173px horizontal range of a max-gap jump (verified unreachable by bot).
4. **No consecutive moving platforms** in the bouncable chain — at speed a moving pair can phase away together and become untimeable on a ~7-15fps e-ink screen. Moving speed capped at 1.2 px/step (72 px/s) for the same reason.
5. The full-width start platform never breaks, so a no-input player idles forever at score 0 — intentional, not a bug.

### Validation harness
Validated like Oregon Trail: DOM-stub + `eval` the inline script + auto-play bot that commits to a target platform on each bounce (naive per-frame targeting dithers and bounces in place on the full-width start platform — a bot flaw, not a game flaw). Assertions: no NaN, platform array stays bounded (~≤20), and **every death must have had a reachable platform at the last bounce** (`hadReachable` check) — deaths are bot skill, walls are generator bugs. 30 seeded runs passed. Note: `hadReachable` can false-positive on spring bounces (spring range ~389px vs normal 166px).

## 🏃 Surfer (surfer.html) — Subway Surfers-Style Runner (2026-07)

3-lane pseudo-3D endless runner built for e-ink: portrait canvas 256×320, fixed 10Hz timestep that **only redraws on ticks** (never per-rAF). Obstacles: barrier (jump), overhead sign (roll), train (lane-change only). Coins: low + high (jump-arc over barriers). Leaderboard: `leaderboard_surfer` (rules in `firestore.rules`); localStorage key `surfer_highscore`.

### ⚠ Canvas anti-aliasing forces full e-ink refreshes (applies to ALL canvas games)
**Any anti-aliased pixel (gray) in the canvas makes the Kindle do a full grayscale screen refresh every frame** — visible as constant flashing. Canvas AA sources: `arc()`, `stroke()`/`strokeRect()` (stroke is centered on the path → half-pixel coverage), diagonal `lineTo()`, `fillText()`, round `lineCap`, and fractional `fillRect` coordinates. Surfer's renderer is strict **1-bit**: only integer `fillRect`, Bresenham `pixelLine()` for diagonals, precomputed midpoint-circle row masks (`FILL_MASKS`/`OUTLINE_MASKS`, radii 1–12) for circles, a 3×5 `GLYPHS` pixel font for HUD text, and a static offscreen background canvas (`bgCanvas`, drawn once: skyline + track edges) blitted 1:1 per frame with `imageSmoothingEnabled = false`. Quantizing scaled geometry to integers causes minor 1px stepping as objects grow — acceptable, grays are not. Reuse this pattern for any new animated canvas game.

### Tuning invariants (found via headless bot harness — do NOT change blindly)
*   **`JUMP_DUR` (0.6s) must be SHORTER than the minimum spawn gap** (`speed * 0.55` in `spawnRow`). With 0.85s jumps, consecutive barrier rows forced land-into-death with no re-jump window — the bot died every run. Same reason `ROLL_DUR` is 0.9s (must outlast the approach + tick quantization at max speed 15).
*   **`JUMP_SAFE = 0.3` is the 1-tick reaction floor.** At 10Hz, a jump started one tick before impact gives `jumpFrac() = sin(π·0.1/0.6) ≈ 0.36`. Any threshold above ~0.35 kills players who jumped on the last valid tick. Grounded = frac 0, so barriers still kill non-jumpers.
*   **`COLLIDE_Z = 0.5`** resolves hits at the visual contact plane. 1.2 resolved ~25px before the obstacle visually reached the player ("I wasn't touching it" deaths); resolution is a monotonic `z <= COLLIDE_Z` crossing check, so there is no tunneling even at dz=1.5/tick.
*   **Spawn fairness rules in `spawnRow()`:** never 3 trains in one row (at least one lane is always jumpable/rollable/open); triple rows (train+barrier+sign) only at speed ≥ 9.5; no obstacles at all for the first 50 units. Inputs mutate `player.lane` instantly (no per-tick queue), so double-tap lane escapes are legal — don't add an input queue.
*   **Speed ramp:** `6 + min(9, distance/120)` → cap 15 at ~1080 distance. Gap formula keeps obstacle *time* spacing (~0.55–0.8s) constant at all speeds.

### Validation harness
Validated like Oregon Trail: DOM-stub + `eval` + auto-play bot (perfect play survived 25×180s with 0 deaths; idle player dies at ~17s; ~135 coins/run collected). **Any change to jump/roll physics, `COLLIDE_Z`, spawn gaps, or speed ramp must re-run a survival bot** — fairness regressions are invisible to eyeball testing. Harness pattern: capture rAF manually, step 100ms frames, bot dodges/jumps/rolls from a state export.

## 🐂 Oregon Trail (oregontrail.html) — Full Rebuild (2026-07)

Rebuilt from scratch as a faithful classic-style trail sim. The previous version (single health stat, four buttons, no party/landmarks/forts) was replaced entirely; its `rekindle_oregontrail_save` key was superseded by `rekindle_oregontrail_save_v2` (old saves are ignored, not migrated).

### Structure
*   **Screens:** setup (profession/party names/departure month) → general store → trail → win/game-over. Forts and hunting are overlay screens on top of the trail.
*   **Day engine:** everything runs through `advanceDay(opts)` (`{travel, resting, fixedMiles, log}`) which rolls weather, consumes food, applies pace/climate/affliction damage, fires random events, checks landmarks and game end, saves, renders, and drains the modal queue.
*   **Modal sequencing:** two queues — `deathQueue` (filled by `hurtMember` whenever a member hits 0 HP, merged into `modalQueue` by `advanceDay`) and `modalQueue` (events, deaths, river/fort/landmark/dalles arrivals, win, gameover). `processQueue()` shifts ONE item per call; each modal's close handler calls `processQueue()` again. Never show two modals at once outside this queue.
*   **The Dalles multi-day road:** `state._dallesActive` flag + empty-queue branch in `processQueue()` chains the next `dallesRoadStep()` only after any event/death modal from the previous day has been dismissed. Do not replace this with a plain loop or a `modalQueue.length === 0` check right after `advanceDay()` — `processQueue` shifts items synchronously, so the queue is empty while a modal is still on screen.
*   **Balance invariants** (found by simulation — see below): resting while `food <= 0` gives NO healing (otherwise a starving party rests forever); repair without parts has a pity timer (`repairFails`, 25%→100% over 4 attempts) so `wagonBroken + 0 parts` can't softlock; blizzard travel multiplier is 0.25, not lower, or winter mountains become unfinishable.
*   **Landmarks/rivers** are data-driven from the `LANDMARKS` array (distance, type, ferry flag, fort price multiplier). `checkLandmarks()` caps distance at the landmark and must early-return when `state.riverPending` — otherwise waiting at a river re-rolls its depth every day.
*   **Hunting minigame:** canvas, step-based (`setInterval` 700 ms hops, not rAF) to stay readable on e-ink. The page uses the standard canvas zoom-exemption CSS block (section 6 of `AGENTS.md`) so tap coordinates line up. **Sizing:** on open, set `canvas.width/height` from `canvas.clientWidth/clientHeight` (flex-computed) so the drawing buffer matches layout pixels 1:1 — never let CSS stretch a fixed-size canvas buffer (that was the "graphics are stretched" bug). All draw/spawn coordinates are derived from `hunt.W`/`hunt.H`, never hard-coded.
*   **Trail scene SVG:** viewBox `0 0 300 64` with `.art-scene svg { width: 100%; height: auto; }` so the scene fills the window width at any size. A narrow viewBox (e.g. 100 wide) with fixed CSS height letterboxes into a tiny centered strip on wide windows.
*   **i18n:** short UI strings are translated in all 10 locale files (`oregontrail.*`); long narrative strings (event/log text) live in `en.json` + in-code fallbacks elsewhere. Dynamic interpolated text goes through the local `tpl()` helper (manual `${var}` replace) — never `window.t(key, vars)`. **Gotcha:** when a rebuilt feature reuses an *existing* locale key but changes the value to include `${...}` placeholders, an add-only-if-missing locale update will keep the old static value and silently show wrong numbers (bit us on `event.fruit` "Gain 30 food"). Overwrite those keys in all 10 locales instead.

### Testing narrative games headlessly
The game was balance-tested with a Node DOM-stub harness: stub `document`/`localStorage`/`window` (memoized `getElementById`, classList via `Set`, no-op canvas 2d context via `Proxy`), `eval` the extracted `<script>`, then auto-play full runs draining modals each day. This caught: party-wide simultaneous deaths from uniform damage (fixed with per-member `variedDamage`), the starving-rest exploit, repair softlocks, and winter death spirals. Target outcome for a "reasonable player" harness: ~90% win rate with occasional mid-trail wipes; reckless play should still lose. If you change difficulty knobs, re-run a few dozen simulated playthroughs rather than guessing.

## 📓 Flipbook (flipbook.html) — Frame Corruption & Performance Fixes (2026-07)

A user report ("multiple clicks to open, drastic lag, flipbooks merge together, frames double") traced to four bugs, all now fixed:

1. **Doubled frames (re-entrancy):** `openAnimation()` had no loading feedback and no guard, so impatient extra taps re-entered it. Interleaved async decode loops each did `frames = []` then pushed into the shared global → 2N frames, persisted by autosave. Fix: `isOpening` guard, a `showLoadingModal()`/`hideLoadingModal()` overlay, and decoding into **local arrays** via `Promise.all(data.frames.map(decodeFrame))`, swapping the globals atomically only after all frames decode.
2. **Merged flipbooks (async ID race):** old `performSave()` read the global `currentAnimationId` *after* `await`ing thumbnail generation, so switching animations mid-save wrote A's frames under B's ID; a pending 1s autosave timer could also fire after `openAnimation` had assigned the new ID. Fix: `performSave()` is now fully synchronous up to the fire-and-forget Firestore write, captures `animId` up front, and `openAnimation()` clears the autosave timer + flushes `performSave()` for the old animation *before* assigning the new ID (`currentAnimationId = id` now happens only after a successful load).
3. **Lag (autosave re-encoding):** every autosave (1s after each stroke) re-encoded **every** frame to a 256×256 PNG data URL. Fix: `frameUrlCache[]` parallel to `frames[]` holds encoded PNGs; `saveCurrentFrame()` marks the edited index dirty (`null`), `getAllFrameUrls()` re-encodes only dirty frames, and `openAnimation()` seeds the cache from the stored base64 (an open-then-repost now encodes nothing). `createThumbnail()` is synchronous and reuses module-level scratch canvases.
4. **Lag (per-pointermove allocation):** `renderCanvas()` allocated a new 256×256 canvas on every pointermove for onion skin. Fix: one reusable `onionCanvas`, only re-`putImageData` when `currentFrameIndex` changes (`onionLoadedIndex`).

Also: `requirePro()` gates create/open — if the Firestore subscription check hasn't resolved yet (`subChecked === false`) it shows "Verifying subscription..." instead of flashing the paywall, which was part of the "multiple clicks" complaint. `localStorage.setItem` of animation data is wrapped in try/catch (64MB cache limit). When touching frame add/delete/save logic, keep `frameUrlCache` spliced/pushed in sync with `frames`.

### Fill bucket & undo/redo (2026-07, both pixel.html and flipbook.html)

*   **Flipbook `floodFill` must match on ALPHA ONLY** (`data[idx+3] < 240`), not on color+alpha tolerance vs the tapped pixel. Strokes are opaque black on a transparent buffer with anti-aliased (partial-alpha) edges; color/tolerance matching stops at the AA fringe and leaves visible "gap" pixels between the fill and the stroke. Alpha-threshold matching lets the fill flow under the AA edge. The fill sets alpha 255, so filled cells never re-match (no infinite loop).
*   **Pixel `floodFill` must compare grid values with a tolerance (0.05)**, not exact float equality. The shade slider is continuous, so regions that look uniform on e-ink can differ by 0.01–0.02 and silently block an exact-match fill. Guard `if (Math.abs(targetValue - newValue) <= tolerance) return;` — this also prevents filled cells (now > tolerance from target) from re-matching forever.
*   **Flipbook undo/redo** uses action descriptors in `undoStack`/`redoStack` (`MAX_HISTORY = 10`, each ≤ one 256×256 ImageData ≈ 256 KB): `{type:'edit', index, image}` (stroke/fill/clear — snapshot via `bufferCtx.getImageData` BEFORE mutating), `{type:'insert', index}` (add/duplicate frame), `{type:'delete', index, image}`. `resetHistory()` is called in `createNew()` and `openAnimation()`. Stroke snapshots are pushed in `startDrawing`; fill snapshots only when `floodFill` returns true (it no-ops on solid-stroke taps). After any undo/redo, reset `onionLoadedIndex = -1` and mark `frameUrlCache[index] = null` (dirty). `saveCurrentFrame()` is called at the top of `undo()`/`redo()`/`deleteFrame()` so snapshots reflect pending buffer state.

## Fitting a square game canvas + controls vertically (`crossy.html`)
A canvas styled only with `width: 100%; max-width: 512px` scales with **width** only, so on short screens the canvas + on-screen controls overflow the `95vh` window — and with `body { overflow: hidden; touch-action: none; }` the window cannot be scrolled to reach the controls.

**Pattern:** Size the canvas in JS from the actual leftover vertical space, measuring the other chrome via the DOM so title-bar zoom/padding are accounted for:

```javascript
function resizeCanvas() {
    if (!canvas) return;
    var win = document.querySelector('.window');
    var content = document.querySelector('.window-content');
    var maxW = Math.min(content.clientWidth - 30, 512); // content box width, capped
    var maxWindowH = Math.floor(window.innerHeight * 0.95); // matches .window max-height
    var othersH = win.offsetHeight - canvas.offsetHeight;   // everything except the canvas
    var size = Math.floor(Math.min(maxW, maxWindowH - othersH - 8)); // -8 = canvas border
    if (size < 128) size = 128;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
}
```

Call it in init, on `resize`/`orientationchange`/`load`, and with a couple of delayed `setTimeout`s (theme.js may apply title-bar zoom after first paint, changing available height).

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).
