# KindleChat Deep Dives

Area notes for `kindlechat.html` and its supporting assets (`emojis.js`, `sw.js`, `_headers`, the moderation worker's emoji list). Cross-cutting rules are in [AGENTS.md](../../AGENTS.md); read that first.

## KindleChat Translations Listener Must Be Key-Scoped

**Never attach a bare-ref listener to `kindlechat/translations_by_lang/{lang}`.** Each language node holds every translation ever written (~25,000 entries / ~1.2 MB per language as of 2026-07, growing unboundedly). A bare `.on('child_added')` forces every client to download ~1 MB and process ~25k callbacks on every page load, which effectively kills the Kindle browser — this was the root cause of "translations not showing" even though the `rekindle-translate` worker was writing them correctly.

**Pattern (implemented in `kindlechat.html` `loadGeneralFromRTDB()`):**
- Push IDs sort chronologically, so scope the listener to the rendered window: `ref.orderByKey().startAt(oldestGeneralKey)` where `oldestGeneralKey` is the first (oldest) key from the initial `limitToLast(50)` messages load. This covers the live window plus all future messages (new keys are always greater).
- Paginated older messages (`loadMoreGeneralFromRTDB()`) are older than `startAt`, so fetch their translations individually on demand: `translations_by_lang/{lang}/{msgId}.once('value')`, cache into `langTranslations`, then re-render that bubble.
- New translation features that add listener paths must follow the same scoping rule.

To audit translation pipeline health, query RTDB directly with `service-account-social.json` (in repo root) via firebase-admin: compare `kindlechat/messages` timestamps against `kindlechat/translations_by_lang` keys.

## KindleChat Translation Worker Pipeline (rebuilt 2026-07-22)

**Regression lesson:** the June 2026 "confidence score" commit added an `isProbablyEnglish()` early-bail in `translateToAllLanguages()` that wrote **zero translations in any language** for English messages. Non-English coverage collapsed from ~78% of messages to <1% overnight ("translation never works" for non-English readers). **Never skip translating entirely based on detected source language** — only suppress the same-language target.

Current design in `workers/rekindle-translate/worker.js`:

- **Canonical source detection:** `detectLanguageInfo()` makes ONE Google call (`sl=auto&tl=en`) that returns the detected language, a confidence score (`data[6]`), AND the English translation. `resolveSourceLang()` picks the source: `isProbablyEnglish()` heuristics → `'en'`, otherwise the detected code. All target translations then use explicit `sl=sourceLang` (never 10 independent auto-detects).
- **Identity entries:** the entry for the source language itself is always the original text (e.g. `es: <original>` for a Spanish message). Clients already suppress translations identical to the original, so source-language readers see the original and every other language gets a real translation.
- **Detect/en merge:** for non-English sources, the detect call's English output (`translatedToEn`) is reused as the `en` entry — non-English messages cost 9 Google calls total, not 10-11.
- **Sequential targets:** the remaining 8-9 target calls run sequentially with a 75ms stagger. Do **NOT** `Promise.all` them — Google's gtx endpoint 429s parallel bursts from shared Cloudflare egress IPs (verified 2026-07: a parallel fan-out got all 9 target calls rate-limited while the identity entry still wrote, producing en-only coverage). `translateWithGoogle()` makes 3 attempts with jittered exponential backoff (600ms, 1800ms) and returns `retryable: true` only for 429/5xx/network failures (not for identical/suppressed results — those must never be retried).
- **Client-scheduled retries (no cron — deliberate, to avoid idle Firebase usage):** every worker response includes `missing: [...]` (languages that failed retryably) and `sourceLang`. `fireTranslationRequest()` in `kindlechat.html` re-fires with `missingLangs` + `sourceLang` in the body after 20s/60s/180s (max 4 attempts), and the worker then translates ONLY those languages without re-detecting. Retries live and die with the sender's browser session — if the sender leaves, remaining languages stay untranslated. Google's per-IP 429s come in multi-minute bursts, so spreading retries over minutes is what fills the gaps; in-request backoff alone cannot.
- **Confidence thresholds in `isProbablyEnglish()`:** `detectedLang === 'en'` → English; `confidence >= 0.85` → trust the non-English detection; identical/contained after stripping punctuation → English; `confidence < 0.85` with >85% Latin/ASCII chars → English (the `< 0.85` bound deliberately covers the 0.75-0.85 mid-confidence window where English slang was being force-translated from a mis-detected language into garbage `en` output).
- **Every message should now produce all 10 language entries** (immediately in clear windows, within ~4 minutes via client retries during 429 storms). If an audit shows English messages stuck at en-only with no other entries appearing over time, the client retry loop is broken — that is the signature to look for.

## KindleChat Art Gallery & `kindlechat/art_index`

The KindleChat gallery (`kindlechat.html`) shows only pixel art and flipbooks. To avoid downloading every chat message, the gallery reads from a dedicated RTDB index at `kindlechat/art_index`.

### Architecture

- `kindlechat/art_index/{messageId}` stores a lightweight record for every art post:
  - `type`: `"pixel_art"` or `"flipbook"`
  - `uid`: author UID
  - `timestamp`: server timestamp
  - `thumbnail`: data URL (pixel art image or first flipbook frame)
  - `text`: caption text
- The gallery queries `art_index` ordered by `timestamp` and paginates with `limitToLast` + `endAt`.
- Clicking a gallery item fetches the full message from `kindlechat/messages/{messageId}` to show the large pixel art or play the full flipbook.
- Pixel-art saves from the gallery reuse `savePixelArtData()` with the current message cached in `window.galleryPixelArtData`; never put the base64 image URL into an inline `onclick` handler.
- `showPixelArtModal()` replaces `#generic-modal-content.innerHTML`, which destroys the default `#modal-message` and `#modal-btns` children. `showModal()` must rebuild those nodes and reset the generic modal's inline width/max-width before displaying another message.
- Both viewer modals reuse `#generic-modal-content` (a `.modal-box` with `padding: 20px`), so `showPixelArtModal()` and `showFlipbookModal()` must set `modalBox.style.padding = '0'` (hideModal/showModal reset it back to ''). Without this the flipbook viewer keeps the 20px modal padding.
- Chat-view pixel art and flipbook bubbles open the same gallery viewer via `openGalleryItem(msgId)` (it fetches the full message from `kindlechat/messages` and handles deleted messages). Inline `playFlipnote()` is now only used for the auto-play-on-render; clicking a flipbook thumbnail opens the modal.
- The moderation worker automatically writes the index entry when a pixel art or flipbook message is posted, and deletes it when a message is auto-deleted from a report.

### Files involved
- `workers/rekindle-moderate/worker.js` — writes/deletes index entries.
- `rtdb-social-rules.json` — security rules for `kindlechat/art_index`.
- `kindlechat.html` — gallery view reads from `art_index`.
- `scripts/backfill-art-index.js` — one-time migration to populate the index for existing art posts.

### Backfill

Existing pixel art and flipbook posts do not automatically appear in the index. Run the migration once:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/rekindle-socials-service-account.json
node scripts/backfill-art-index.js
```

### Important rule for future art features

Any new feature that posts pixel art or flipbooks to KindleChat must also write an entry to `kindlechat/art_index/{messageId}` with the same shape, or update the moderation worker to do it on the feature's behalf. Otherwise the gallery will not show those posts.

## KindleChat Pixel Art Duplicate Prevention

To stop users from reposting the exact same pixel art repeatedly in KindleChat, duplicate prevention is enforced both client-side and server-side.

### Client-side `postedToKindleChat` flag (`pixel.html`)

Each drawing in the user's manifest can carry a `postedToKindleChat: true` flag.

*   When a drawing is successfully posted to KindleChat, `postToPixelChat()` sets `item.postedToKindleChat = true` on the current manifest item and saves the manifest.
*   Before posting, `postToPixelChat()` checks the flag and shows a modal if the drawing has already been posted unchanged.
*   Any modification to the drawing (saved via `performSave()`) clears the flag to `false`, so the edited drawing can be posted again.
*   Translation key: `pixel.status.already_posted` — "This pixel art has already been posted to KindleChat. Modify it to post again."
*   Blank (all-white) pixel art is also blocked from posting. Use `pixel.status.blank` — "Blank pixel art cannot be posted."

### Server-side duplicate detection (`workers/rekindle-moderate/worker.js`)

*   Pixel art posts skip the text-only duplicate check (the placeholder text `"Shared a pixel art!"` would otherwise block different pixel art).
*   Instead, the worker hashes `body.grid_data` and checks `kindlechat/user_recent/{uid}/kindlechat_pixel_art/{hash}` for a 5-minute duplicate window.
*   After a successful post, the grid data hash is recorded under `kindlechat_pixel_art` for duplicate detection.
*   No RTDB rule changes are required: `kindlechat/user_recent/{uid}` is already writable by the social service account for any child path.

## Unicode Emoji Picker (`POPULAR_EMOJIS` in emojis.js)
`emojis.js` also defines `POPULAR_EMOJIS` (~120 curated `{emoji, name}` entries — deliberately trimmed to the most popular/wholesome set for the all-ages community: no edgy/gross, alcohol, anger, or money emojis) used by the KindleChat emoji picker (`initAsciiPicker()` in `kindlechat.html`). It is a **category object** (`{"Smileys": [...], "Hearts": [...], "Hands": [...], "Animals": [...], "Nature": [...], "Food": [...], "Fun": [...]}`), NOT a flat array — category keys become the picker sidebar tab labels. This is a **separate global from `ASCII_EMOJIS`** on purpose: the worker's `ASCII_EMOJI_ARTS` strip-list mirrors `ASCII_EMOJIS` only, so do NOT merge these arrays or the strip-list invariant breaks. Standard Unicode emojis do not trip omni-moderation the way ASCII art does, so they need no stripping.

How the picker works:
- The emoji categories are prepended to the picker as sidebar tabs (Smileys first = default active), built by merging each `POPULAR_EMOJIS` category into `pickerCategories`; all `ASCII_EMOJIS` categories are then flattened into ONE trailing tab labeled `っ◕‿◕)っ`. Emoji category tabs render an OpenMoji icon (the category's first emoji, `.emoji-tab` class, inverted on hover/active) instead of a text label — the category key is only used for the section id and `title` tooltip.
- The emoji section uses its own `.emoji-grid` (CSS Grid with `gap`, 48px cells / 32px images) and `.emoji-option` classes — do NOT reuse `.ascii-grid`/`.ascii-option` for emoji sections: `.ascii-grid>*+* { margin-left: 5px }` indents every wrapped row and has no vertical gaps, and the base `.ascii-option` styles (min-width, flex-grow, Courier font) fight the image cells. `.emoji-option img` also needs `image-rendering: auto` to undo the body's `image-rendering: pixelated` for smooth SVG scaling.
- Each option renders as an `<img src="openmoji/{file}">` looked up via `EMOJI_SVG_MAP` from `js/emoji-render.js` (the Kindle cannot render emoji glyphs). **Do not** call `renderEmojis()` on the picker container — the ASCII art sections contain chars ≥ U+2600 (☁, ♥, ✿) that are also in `EMOJI_SVG_MAP` and would get mangled into images.
- `insertAscii()` inserts the raw Unicode char for ASCII art, but for Unicode emojis it inserts an `<img class="composer-emoji">` (OpenMoji) — see the composer note below.
- **Entries must use bare codepoints WITHOUT the `FE0F` variation selector** (e.g. `"❤"` U+2764, not `"❤️"` U+2764 U+FE0F) — the auto-generated `EMOJI_SVG_MAP` keys are FE0F-less for these, so FE0F forms silently miss.
- After editing `emojis.js`, bump its `?v=` query in `kindlechat.html` (only page that includes it).

## KindleChat Composer Is `contenteditable` (Not a `<textarea>`)
The KindleChat message composer (`#msg-input` in `kindlechat.html`) is a `contenteditable` div, not a textarea, because a textarea can only hold plain text and Unicode emojis render as blank boxes on Kindle. Emojis live in the composer as real `<img class="composer-emoji" src="openmoji/..." alt="{unicode}">` nodes that flow inline with the text.

Invariants to preserve when touching the composer:
- **Never read/write `.value`** — it does nothing on a div. Read with `getComposerText()` (serializes childNodes: text → nodeValue, `<img>` → `alt`, `<br>`/`<div>` → `\n`), clear with `innerHTML = ''`, set plain text with `textContent = ...`.
- The `alt` attribute on composer emoji imgs is the source of truth for the sent Unicode char — `serializeComposer()` converts imgs back to `alt` text, so messages still send/render as before (and `renderEmojis()` in bubbles handles display).
- Paste is force-plain-text via a `paste` listener (`text/plain` only) — do not remove it or rich HTML (incl. foreign images) can enter the composer.
- Placeholder is CSS `#msg-input:empty:before { content: attr(placeholder) }`; an `input` listener normalizes a fully-empty composer to `innerHTML = ''` so `:empty` matches again. Because of this, `js/i18n.js` sets `data-i18n-placeholder` via `setAttribute('placeholder', ...)` (property assignment does not reflect to `attr()` on a div).
- Disabled state = `contentEditable="false"` + `.composer-disabled` class (managed by `setChatInputEnabled`), not the `disabled` attribute.
- `user-select: text` on `#msg-input` overrides the body's `user-select: none`, or the caret/selection breaks.

## OpenMoji Caching (sw.js + _headers)
`/openmoji/*` requests are cached at two layers so Kindles never re-download emoji icons:

1. **Service worker (`sw.js`)** — route `1b` serves `/openmoji/*` **cache-first** (not stale-while-revalidate): OpenMoji filenames are codepoint-addressed so content never changes, and SWR would waste a background revalidation request per icon. The ~115 picker icons (`EMOJI_ASSETS`, ~0.5MB) are precached at install (best-effort per-file so one flaky icon can't fail the whole install); any other emoji first seen in a message is runtime-cached on demand via `cache.put`. Do NOT precache the whole 19MB openmoji/ dir (64MB Kindle global cache limit).
2. **HTTP headers (`_headers`, Cloudflare Pages)** — `/openmoji/*` gets `Cache-Control: public, max-age=31536000, immutable`, covering first visits before the SW installs (Pages' default is `max-age=0, must-revalidate`, which forces a revalidation round-trip per file per session). The same file also sets: `/sw.js` → `no-cache` (SW updates must never stall), `/fonts/*` → immutable year, `/locales/*` → 1 hour, and global `X-Content-Type-Options: nosniff`. Do NOT long-cache `/js/*` or HTML — most JS has no `?v=` buster, so users would be stranded on stale code.

**Regeneration rules:** when `POPULAR_EMOJIS` changes, regenerate `EMOJI_ASSETS` in `sw.js` (derive filenames from `EMOJI_SVG_MAP`); if the openmoji/ art itself is ever regenerated (library upgrade, same filenames new content), bump `CACHE_NAME` so clients drop the stale icons.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).
