# Deferred optimisation & QoL backlog — 2026-10-20

Everything flagged by the [2026-10-20 audit](audit-2026-10-20.md) that was **not** attempted in
the fix pass, plus the places where a fix was deliberately partial. Each entry has the evidence
needed to start without re-doing the investigation.

The audits were static (line-cited code review + `npm test` + a production build). Nothing here
has been verified on a Kindle or an e-ink panel — that is part of the work.

**Order:** P1 = user-visible or correctness risk; P2 = measurable slowdown on the target device;
P3 = maintainability. `risk` is the chance the change breaks something a test cannot catch.

---

## P1 — correctness / user-visible

### BL-01 · Lite / Legacy / Kobo dashboard never got the live-lobby validator
- **Where:** `build-automation.js:1703` swaps `index_old.html` in as `index.html` for the Lite and
  Legacy deploys; `index.html:12` also redirects `rekindle_layout=old` users there.
- **Evidence:** `grep -c validateLiveMatch index.html` → 3, `index_old.html` → 0;
  `grep -c matchmaking index_old.html` → 0.
- **Symptom:** ghost `LIVE` badges and dead lobbies on the oldest Kindles and Kobas — exactly the
  bug AGENTS §11 fixed for the main build.
- **Fix:** either (a) port `validateLiveMatch` + the `cachedMatchValidation` cache and both call
  sites into `index_old.html`, or (b) extract the dashboard body (app grid, favourites, live
  validation, badge) to `js/dashboard.js` and leave only layout deltas in the two files.
- **Verify:** build the Lite target (`_deploy/lite/index.html`), load it with a stale
  `matchmaking` entry, confirm the card disappears and the listing is cleaned up.
- **Effort:** medium · **Risk:** medium · **Why deferred:** the Lite build cannot be exercised
  here and a half-port is worse than none.

### BL-02 · Topic search rebuilds the whole sidebar per keystroke
- **Where:** `topics.html:867` `oninput="renderSidebar()"`; the rebuild is `topics.html:1592–1700`.
- **Symptom:** every character typed wipes and rebuilds up to 200 topic rows (200
  `createElement` + 200 `innerHTML` parses + 200 `renderEmojis()` walks) plus a sort and a filter
  over the 500-doc snapshot — multi-second freeze per keystroke on a jitless Kindle.
- **Fix:** point the input at a debounced wrapper (~250 ms; a debounce helper already exists two
  functions above), and cache the rendered emoji per topic id instead of re-running `renderEmojis`
  on every row.
- **Verify:** type 10 characters in the topic search on a slow profile; expect one rebuild.
- **Effort:** small · **Risk:** low · **Why deferred:** was queued behind the higher-impact P0s
  and not reached.

### BL-03 · Neighbourhood loses every paginated post when Admin/Mod Mode toggles
- **Where:** `neighbourhood.html:3010–3013` re-renders from `recentPosts`; `loadMorePosts`
  (`:2957–2978`) never appends to it.
- **Symptom:** toggling admin mode drops loaded pages for the rest of the session —
  `renderedPostKeys` still holds them, so `loadMorePosts` filters them out and they cannot return
  without a reload. `editPost` also no-ops for paginated posts because it uses
  `recentPosts.find(...)` (`:3821`).
- **Fix:** append every loaded page to `recentPosts` (or keep one `renderedPosts` list both paths
  write to), call `updateEndOfFeed(feed)` after the re-render, and make `editPost` fall back to the
  card's `data-post-id`/`data-original`.
- **Effort:** small · **Risk:** medium · **Verify:** open Neighbourhood, scroll to load 3 pages,
  toggle admin mode, confirm all posts remain and edit still works on the oldest one.

### BL-04 · Neighbourhood never detaches its listeners
- **Where:** `neighbourhood.html:2880` `postsListener` is assigned but never called; the scroll
  handler is added at `:2936` with no `removeEventListener`; `grep -c pagehide` → 0.
  `topics.html:3377` already implements the teardown to copy.
- **Symptom:** live snapshots keep arriving into a bfcache-restored page and the feed DOM +
  closures are retained.
- **Fix:** store the unsubscribe, add a `pagehide` handler that calls it, drains
  `commentListeners`, and removes the scroll handler.
- **Effort:** small · **Risk:** low.

### BL-05 · KindleChat translation arrivals rebuild whole bubbles
- **Where:** `kindlechat.html` translation `child_added` handler → `renderMessage` (look for
  `getMessageInsertionInfo` and the `existing` lookup); the comment near the scoped listener
  admits the whole rendered window re-fires on load.
- **Symptom:** ~50 full bubble rebuilds per page load; each rebuild does `innerHTML`, an emoji
  tree walk, an avatar canvas redraw and a `localStorage` parse via `rekindleFetchUserCard`, even
  when the translation equals the original (the worker writes an identity entry for the source
  language).
- **Fix:** look up `existing` first; when it exists skip the insertion-info scan and patch only
  the bubble text (`data-original`/`data-translated` + the bubble's `innerHTML`). Batch arrivals
  into one dirty-flag pass instead of one rebuild per snapshot.
- **Effort:** medium · **Risk:** medium · **Verify:** load general chat with translations on;
  count `renderMessage` calls (temporary counter) — expect ~N, not ~2N.

### BL-06 · KindleChat ASCII picker scroll spy forces layout per scroll event
- **Where:** `kindlechat.html:2666` scroll handler.
- **Symptom:** reads `scrollHeight`/`clientHeight` (forced layout), re-runs
  `querySelectorAll('.ascii-sidebar-item')`, toggles classes on all of them, and calls
  `scrollIntoView({behavior:'smooth'})` — a JS-driven animation e-ink's `transition: none` does not
  suppress — and re-enters itself.
- **Fix:** cache the metrics when the picker opens, query the sidebar items once, add a
  leading-edge timestamp guard, and use `behavior: 'auto'`.
- **Effort:** small · **Risk:** low.

### BL-07 · Journal: no merge, only a flush
- **Where:** fixed pass debounced the cache write, flushed on `pagehide`, and skips the cloud
  snapshot while a save is pending (`journal.html`, `flushPendingSave`).
- **Still open:** if the page is killed before the Firestore write lands, the next load still
  replaces `notes` with the older cloud copy. There is no `updated`-based merge.
- **Fix:**

  ```js
  var localById = {}; notes.forEach(function (n) { localById[n.id] = n; });
  notes = cloudNotes.map(function (c) {
      var l = localById[c.id];
      return (l && (l.updated || 0) > (c.updated || 0)) ? l : c;
  });
  // then re-push the newer local notes
  ```
- **Effort:** small · **Risk:** medium (deletions vs. newer-local semantics).
- **Verify:** type in a note, kill the tab before the 1 s debounce completes on a throttled
  connection, reopen, confirm the text survives.

### BL-08 · Report button still under the 48 px touch-target rule
- **Where:** `neighbourhood.html:336`, `topics.html:328` — now 32 px with `margin: -6px`.
- **Why not 48:** the button sits beside a timestamp (`neighbourhood`) and an Edit button
  (`topics.html:887`) with only an 8 px gap; a 48 px hit area would steal those taps.
- **Fix:** restructure the action row so Report has its own 48 px slot — e.g. move it into the
  comment/post action row with the same `min-height` as `.sys-btn`, or wrap the 20 px dot in a
  48 px transparent button and give the neighbouring controls their own row.
- **Effort:** small · **Risk:** low (visual only).
- **Verify:** tap-target audit at 1× zoom (48×48 minimum), and a mistap check around Edit.

### BL-09 · `getIdToken(true)` before every social write
- **Where:** 13 sites: `kindlechat.html` (4), `neighbourhood.html` (4), `topics.html` (2),
  `flipbook.html`, `pixel.html`, `files.html`.
- **Trade-off:** the forced refresh is what makes a newly granted `pro`/`ageVerified` claim reach
  the worker immediately, so it was deliberately kept.
- **Fix:** use the cached `getIdToken()` and force a refresh **once** after a `401`/`403` from the
  worker, then retry the request. Saves one Identity Toolkit round trip per post.
- **Effort:** medium · **Risk:** medium (claim propagation) · **Verify:** grant Pro, return to chat,
  post immediately — must be allowed.

---

## P2 — performance on the target device

### BL-10 · Reader lays the whole book out as one DOM
- **Where:** `reader.html:1942` `MAX_CHARS = 2000000`, one `innerHTML` into `#gb-pane`;
  `changeFont` writes `fontSize` then reads `scrollHeight` twice (`:2732`, `:2863`).
- **Symptom:** multi-second freeze per font/header change on a long book.
- **Fix:** mount only the current chapter ±1 (one `innerHTML` per mount, so the i18n observer
  behaviour stays the same); at minimum drop `MAX_CHARS` to ~300k and add
  `contain: layout style` to `#gb-pane p`; cache the measured page height per render.
- **Effort:** large · **Risk:** high (pagination, scroll anchors, resume position) · **Verify:**
  open a 1 MB book, change font 5×, confirm page count and resume still work.

### BL-11 · Books list rebuilds both lists on every snapshot
- **Where:** `books.html:530–534` clears `#want-to-read-list` and `#read-list`; rows are rebuilt
  with fresh `<img>` covers (`:557–564`); query has no `.limit()`.
- **Fix:** `snapshot.docChanges()` — added builds one row, modified patches status/stars in place
  and leaves the `<img>` node alone, removed removes the node; add `.limit(100)` and `data-doc-id`.
- **Effort:** medium · **Risk:** medium · **Verify:** change one book's status; no cover re-fetch.

### BL-12 · Calendar day view does 24×N timezone conversions
- **Where:** `calendar.html:1476–1481` filters the day's events once per hour, calling
  `getZonedDate` per event per hour; agenda converts 3× per event and builds an `eventsMap` it
  never uses (`:1262`, `:1281`, `:1291`, `:1307`).
- **Fix:** convert each event once per render into a bucketed map (hour key / day key), reuse it
  for the day and agenda views, and delete or use the unused `eventsMap` argument.
- **Effort:** medium · **Risk:** low · **Verify:** event crossing midnight and a DST day.

### BL-13 · `time.js` re-parses storage and builds Intl formatters per call
- **Where:** `time.js:31–38`, `:61–73`, `:176–178` — two `localStorage` reads, two `JSON.parse`
  attempts and two `Intl` formats per formatted timestamp.
- **Fix:** cache the parsed location module-scope (invalidate on the settings/DST events) and one
  `Intl.DateTimeFormat` per zone+options key; format once.
- **Effort:** medium · **Risk:** low · **Verify:** feed with 50 messages; compare render time and
  displayed times across a DST boundary.

### BL-14 · Bluesky refetches the timeline and every image on return
- **Where:** `bluesky.html:846–854` `showFeed()` always calls `loadTimeline()`; embeds render up
  to 4 full-size `<img>` each with no dimensions (`:1219–1223`).
- **Fix:** keep the timeline in memory, refetch only on explicit refresh or after ~5 min; cap
  embeds at 2 + "+N images"; give images explicit CSS `width`/`height` so decode does not reflow.
- **Effort:** medium · **Risk:** low.

### BL-15 · Chat/DM/topic writes pay a serial RTDB timeout read first
- **Where:** `workers/rekindle-moderate/worker.js:1803` `checkTimeout` runs before
  `consumeRateLimitToken` (`:1844`); both hit the same RTDB, and the timeout node is empty for
  almost every user.
- **Fix:** cache the timeout per uid for 30–60 s (same pattern as `dmFlagCache` / `isDmEnabledForOrigin`)
  and run the two reads in one `Promise.all`.
- **Effort:** small · **Risk:** medium (a stale timeout could let one message through) ·
  **Verify:** set a timeout, confirm the next message is still rejected.

### BL-16 · `getSocialToken` makes 5–8 serial hops per social page load
- **Where:** `firebase-functions/index.js:1223–1298` — moderators, `isUserPro` (up to 2 reads),
  ageVerification, `admin.auth().getUser`, and a social-project `getUser`/`updateUser` kept only so
  users appear in the Firebase Console.
- **Symptom:** blocks `signInWithCustomToken`, so chat/feeds/art cannot load until all of it
  resolves.
- **Fix:** `Promise.all` the independent reads, drop the Console-visibility social lookup from the
  request path (do it once after first sign-in, fire-and-forget), cache moderators/pro per uid for
  ~5 min.
- **Effort:** medium · **Risk:** medium (auth claims) · **Verify:** cold visit to chat, measure
  time-to-first-message; confirm moderator/pro/ageVerified survive.

### BL-17 · `api/price.js` caps, but `stocks.html` still retries per symbol
- **Where:** `stocks.html:546` fires one request per symbol and `:612` retries 3× with a fixed
  500 ms delay; the proxy is now cached (fixed), but a cold cache still fans out.
- **Fix:** one `/api/price?symbols=A,B,C` batch (Yahoo supports it), or at least serialise with a
  cap and honour the cached response before retrying.
- **Effort:** small · **Risk:** low.

### BL-18 · Pixel wallpaper re-encodes a PNG per touched pixel
- **Where:** `settings.html:1386–1390` `updatePixel` → `renderGridUI()` + `updateWallpaper()`;
  `:1446–1450` `canvas.toDataURL('image/png')` + two `localStorage` writes.
- **Fix:** split into a cheap in-memory canvas paint (per pixel) and a commit path
  (`toDataURL` + `setItem`) called from `endDraw`/`savePixelData`; repaint only the changed cell.
- **Effort:** medium · **Risk:** low.

### BL-19 · Mail "load more" rebuilds every accumulated row
- **Where:** `mail.html:1194–1206` concatenates then calls `renderEmailList()`. Mark-read is now
  patched in place; paging is not.
- **Fix:** append only the new page's rows when `append` is set; keep the existing scroll offset.
- **Effort:** small · **Risk:** low.

### BL-20 · Sheet-music composer images grow `localStorage` without eviction
- **Where:** `sheetmusic.html` `fetchComposerImage` (~`:1193–1231`) writes `rekindle_img_*` keys
  forever. Search is now debounced; the cache is still unbounded (64 MB global limit → OS wipes
  the whole cache).
- **Fix:** cap at ~100 keys with an LRU index (same shape as `reddit.html`'s
  `reddit_feed_xml_lru`), and skip the fetch for cards already rendered.
- **Effort:** small · **Risk:** low.

---

## P3 — maintainability (needs a visual QA pass)

### BL-21 · Shared helpers duplicated across pages, already diverged
- **Measured:** `escapeHtml`/`escapeHTML` 64 definitions (36 + 28, 14 distinct bodies);
  `showModal` 32 (20 bodies); `drawAvatar` 12 (2 variants); `sanitizeBackgroundImage` 28 —
  27 identical, `chords.html:742` also allows `http`/`/` URLs.
- **Fix:** one `escapeHtml` in `js/safe-html.js`, `showModal`/`drawAvatar` in `js/ui-kit.js`, one
  `sanitizeBackgroundImage` (decide whether `http` is allowed), then delete the page copies and
  bump `?v=` for the shared files.
- **Effort:** medium · **Risk:** medium (32 pages' modal behaviour differs subtly) ·
  **Verify:** per-page modal open/close, avatar rendering, chords background.

### BL-22 · System 7 chrome re-declared in 135 pages
- **Measured:** 1,464,426 B of inline CSS across 137 pages (avg 10,689 B); `:root` 137, `body` 137,
  `.window` 135, `.title-bar` 136, `.title-stripes`/`.title-text`/`.close-box` 135 each;
  ~367 KB of byte-similar chrome.
- **Fix:** `css/system7.css` (~3 KB) for the canonical chrome + `sw.js` precache, page-specific
  overrides stay inline.
- **Effort:** medium · **Risk:** medium–high (every page's layout) · **Verify:** screenshot
  harness in [visual-audit.md](visual-audit.md) across a sample of 20 pages.

### BL-23 · Locale files carry dead keys
- **Measured:** `en.json` 3,520 keys / 172,942 B. 1,110 have no literal reference; excluding
  dynamically composed namespaces puts genuinely dead keys at 454 (~32 KB, ×10 locales).
  `gamerules.*` (29) are dead *and* the rules stay English-only because `js/gamerules.js` hardcodes
  the same HTML.
- **Fix:** script the reference check into `npm test`, prune, and make `js/gamerules.js` read
  `window.t('gamerules.' + id, fallback)`.
- **Effort:** medium · **Risk:** medium (a wrong prune shows raw keys) · **Verify:** load every
  page in `?lang=de|es|pt` and diff visible text against `en`.

### BL-24 · Four pages still use native `<select>`
- **Where:** `akinator.html` (1), `comics.html` (1), `moderation.html` (5), `readwise.html` (2).
  The other 23 pages use `js/custom-select.js`.
- **Fix:** include the widget and re-apply the modal layout rules from AGENTS ("Modal gotcha").
- **Effort:** small per page · **Risk:** medium (modal CSS) · **Verify:** each page's select opens,
  selects, and respects `disabled`.

### BL-25 · `index_old.html` is a 66 KB fork that has already drifted
- **Where:** `build-automation.js:1703`; differs from `index.html` by features added since the
  fork (live validation — BL-01 — is the visible one).
- **Fix:** same shared-dashboard extraction as BL-01; until then, treat `index_old.html` as a file
  that must be updated alongside `index.html` for dashboard features.
- **Effort:** large · **Risk:** high.

### BL-26 · Dead files and dead code still shipped
- **Where:** `manga.html` (51 KB) and `texasholdem.html` (38 KB) are unreachable (not in
  `icons.js` APPS, no inbound links) yet still built, with locale keys and a third-party CDN
  dependency; `sw-offline.js` and `sw-killswitch.js` are referenced by nothing but still deployed,
  and `sw-offline.js` has its own asset list that would fight `sw.js`.
- **Fix:** register the two apps (manga needs a MangaDex API review) or delete them plus their
  locale keys / gamerules / score entries; delete the two stale service workers.
- **Effort:** small · **Risk:** low.

### BL-27 · Backend payment/maintenance scripts
- **`workers/rekindle-stripe/worker.js:371`, `:644`, `:1103`, `:1141`** — mints a fresh OAuth token
  per call and refetches Google JWKs per checkout; the moderate worker already caches both
  (`worker.js:25`, `:545`). Copy that pattern.
- **`workers/rekindle-stripe/worker.js:958–1038`** — `addToSupportersConfig` /
  `removeFromSupportersConfig` read-modify-write the whole supporters map with no field mask; two
  concurrent webhooks drop a subscriber. Use `updateMask.fieldPaths` or one doc per email.
- **`firebase-functions/index.js:205–213`, `:555`** — every mail callable re-checks Pro with up to
  2 Firestore reads and opens a cold IMAP session; `mail.html:1064` awaits folders *then* emails.
  Cache the Pro result ~60 s, invalidated by the Stripe webhook, and parallelise the two callables.
- **Effort:** small each · **Risk:** medium–high (auth/payments; cannot be exercised locally).

### BL-28 · Remaining smaller items
- `theme.js:647` presence poll ticks every second ×30 waiting for Firebase; replace with a hook on
  `firebase.initializeApp`/`load`.
- `topics.html:1328` re-maps all 200 docs per snapshot; use `docChanges()` like the comment feed.
- `topics.html:2001` downloads the whole `pollVotes` collection per open and per vote; store an
  aggregate count on the topic.
- `index.html` attaches two full-node `matchmaking` listeners (badge at `:1506`, tab at `:2089`),
  both before auth resolves, with no `pagehide` detach; filter server-side and reuse the cache.
- `moderation.html` loads neither `theme.js` nor `js/i18n.js` (only page with a different shell);
  decide whether that is intentional and comment it.
- Repo-wide emoji sweep: only `books.html` and `mastodon.html` were fixed; dingbats (★/☆) are fine,
  but any remaining emoji-presentation glyph needs the same treatment.

---

## Partially done (and where it stopped)

| Item | Done | Not done |
|---|---|---|
| Report button | 20 → 32 px, layout footprint unchanged | full 48 px (BL-08) |
| Journal persistence | debounced cache + `pagehide` flush + pending-save guard | `updated`-based merge (BL-07) |
| Watchlist | seasons fetched in batches of 3 | lazy episode loading / store only season count |
| Bible | lazy dataset load, `onLibraryChange` awaits it | request sequencing (`reqId`/abort) and a chapter cache |
| Dropbox | `has_more`/`cursor` pagination | per-path navigation cache (Back re-lists) |
| Calendar | listener unsubscribes, no stacking | date-bounded event query (still `.get()` of the whole collection) |
| Mail | mark-read patches one row | load-more append (BL-19) |
| Reddit | feed cache capped at 5 subs | wrapper-level cache (relies on the proxy) |
| Dropbox / Books / Readers | — | `contain:` additions need a visual pass (BL-22 covers the shared CSS) |

## Verification notes for whoever picks these up

- `npm test` covers i18n keys, Chromium-75 compatibility, the proxy guard, claim merging, chat
  spam, DMs and Oregon Trail — but **not** layout, Firebase behaviour, or anything on a device.
- Inline scripts can be syntax-checked without a browser:
  extract each `<script>` without `src` and `new Function(code)` (this is how the fix pass checked
  160 scripts across 136 pages).
- After touching a shared script, bump `?v=` in **every** including page (and `sw.js`
  `ASSETS_TO_CACHE` if listed), then `npm run build` — the deploy ships `_deploy/main`.
