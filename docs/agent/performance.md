# Performance Playbook (e-ink / slow devices)

The 2026-07 audit behind the perf rules. Read before optimising any page for the Kindle.

## ⚡ Performance Patterns for Slow Devices (2026-07 audit + fixes)

A codebase-wide performance audit for the Kindle target produced these fixes and reusable patterns. Follow them in any new feed/game/editor.

### CSS containment on repeated feed items
`.msg` / `.gallery-item` (kindlechat.html), `.post-card` / `.comment-item` (neighbourhood.html), `.topic-item` / `.msg` (topics.html) carry `contain: content` (when the rule already has `overflow: hidden`) or `contain: layout style` (otherwise, so overflowing decorations aren't clipped). This stops per-append reflows from walking the whole feed. Add it to any new repeated feed/list item.

### Dirty-flag rendering (tetris.html, crossy.html, pet.html)
Unconditional `draw()` every rAF costs e-ink compositing + (with any AA pixel) full grayscale refreshes even when idle. Pattern: a `drawNeeded`/`renderSig` gate — set the flag wherever visible state changes (moves, drops, spawns, camera/black movement on visible rows), draw only when set. tetris.html also had per-cell `strokeRect` with `lineWidth 0.1` (AA grays = the Surfer full-refresh bug) — removed; filled cells are `fillRect` only. pet.html's tick additionally caches the `.title-text` element and only writes `innerText` when the age string changes, and only runs `updateIconUI()` when its inputs (menuIndex/attention blink phase/stage) change.

### Coordinate-conversion rect caching (livepictionary/pixel/flipbook/pool)
`getBoundingClientRect()` per pointermove (or per coalesced point) forces synchronous layout per event. Pattern: cache the rect on stroke/drag start (`pointerdown`), use it for all moves in that stroke, null it on stroke end and on canvas resize. livepictionary.html additionally caches the `--rekindle-scale` `getComputedStyle` read the same way (see `computeCanvasTransform()`).

### Incremental comments via `docChanges()` (neighbourhood.html)
The comments listener was `innerHTML = ''` + re-render ALL (≤100) comments per snapshot. Now uses `snapshot.docChanges()`: added → render only the new node (position via `snapshot.docs[change.newIndex - 1]` — query is newest-first, DOM is oldest-first), removed → remove that node, modified → re-render in place. Elements carry `data-comment-id` for lookup. topics.html comments were already incremental; their eager initial load now appends through a `DocumentFragment` (`appendMessage(msg, prepend, container)`).

### KindleChat message pipeline (kindlechat.html)
- Initial 50-message batch renders with `history.style.display = 'none'`, then shows + scrolls once (one reflow instead of 50). Safe because `renderMessage`/`getMessageInsertionInfo` do no layout reads — keep it that way.
- `generalMsgData` mirrors `renderedKindlechatIds` with the message bodies, so translation `child_added`/`child_changed` handlers re-render from cache instead of an extra `generalChatRef.child(msgId).once('value')` per message (was ~50 fetches + 50 full rebuilds at load). Both handlers also bail if the `.msg[data-msg-id]` element is gone — re-rendering a window-slid message would wrongly re-append it.
- Flipnote autoplay loops (`playFlipnote`, `playGalleryFlipbook`) guard `!imgEl.isConnected` — detached message nodes kept their `dataset.playing` and animated forever before. `hideModal()` also explicitly stops the gallery flipbook timer.
- The dead `getCachedMessages`/`getLastCachedTimestamp`/`cacheMessages` localStorage block was removed; don't re-add without wiring it up.

### Misc
- `liveuno.html` hand/opponent render builds HTML in an array + single `innerHTML` assignment (was `innerHTML +=` per card = O(n²) reparse per game event). Same pattern fixed in `journal.html` month render (~49 `+=` per month), which also indexes notes by id (`notesById`) instead of `notes.find()` per day.
- `words.html` board cells are cached in the `boardCells[y][x]` 2D array built by `initBoard()` — never re-query `.sq[data-x][data-y]` per tile.
- `wordle.html`/`nerdle.html` no longer `console.log` the answer (also a cheat vector).

### Two traps when applying these perf patterns (hit 2026-07, fixed)
1. **Don't add a debounce helper without wiring it.** `notes.html` gained `scheduleCacheWrite()`/`flushCacheWrite()`/`pagehide` flush, but `saveNoteData()` still called `updateCache()` directly — the optimisation was inert until `saveNoteData` was changed to call `scheduleCacheWrite()` (it runs on every keystroke via `saveCurrentNote`'s `oninput`). Note the two storage keys: logged-in cache is `rekindle_notes_cache` (`NOTES_CACHE_KEY`, via `updateCache()`), the anonymous list is `rekindle_notes` — `flushCacheWrite()` must branch on `currentUser` to pick the right one. If you add a debounced write anywhere, grep for its call site in the same commit.
2. **When you delete a listener, delete every reference to its unsubscribe var.** `topics.html`'s poll listener was converted to a one-time `loadPollVotesOnce()`, the `var pollVotesUnsubscribe = null;` declaration was removed, but `detachAllListeners()` still did `if (pollVotesUnsubscribe) { pollVotesUnsubscribe(); }`. Reading an undeclared identifier throws `ReferenceError`, which the function's `catch (e) { /* ignore */ }` silently swallowed — so `topicsListenerRef`, `rulesListenerRef`, `sidebarRenderTimer` and all the state resets after it were **skipped on every pagehide**. Any `try/catch` that wraps a whole teardown sequence will hide this class of bug: after removing a `var`, grep the file (and other scripts) for the name and run the inline-script syntax check before shipping.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).
