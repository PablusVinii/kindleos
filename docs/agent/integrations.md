# Third-Party Integrations

Akinator, NRL scores and the Internet Archive comic reader. Read before touching those pages or their backing Pages Functions.

## 🏉 NRL Scores (scores.html)

ESPN's JSON scoreboard API (`site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`) supports NFL/NBA/MLB/NHL/soccer/AFL but **does not expose NRL**. To add NRL, `scores.html` uses a dedicated Cloudflare Pages Function at `functions/api/nrl-scores.js` that scrapes `https://www.espn.com/nrl/scoreboard` and returns ESPN-compatible JSON.

*   The scraper is regex-based and relies on ESPN's current server-rendered HTML structure. If ESPN changes their markup, the parser will return empty events.
*   Only games where both teams are in the known NRL team list are returned (filters out State of Origin / Tests).
*   The response is cached for 2 minutes via `caches.default`, but only when games are successfully parsed.
*   In `scores.html`, NRL is added to `LEAGUES` with `source: "nrl-scores"`, and `fetchFromAPI()` routes it to `/api/nrl-scores` instead of the ESPN proxy.

## 📚 Comic Reader (comics.html) — Internet Archive, not MangaDex/Manga Plus

`comics.html` (dashboard id `comics`, formerly `manga.html`) was rewritten (2026-07) to remove MangaDex (unlicensed scanlations = piracy). It is now a **public domain / openly licensed comic reader** backed by the Internet Archive. The original MangaDex app survives untouched as `manga.html` (a copy of the old `mangadex.html`, still redirecting to `index`); it is not linked from the dashboard.

### Why not Manga Plus (official Shueisha)?
Manga Plus was evaluated and is **technically unusable** for this project:
1.  **Datacenter IP ban:** `jumpg-webapi.tokyo-cdn.com` returns a protobuf "Account Banned (10900)" error for ALL Cloudflare egress IPs (verified via the deployed `/api/proxy`) and VPN/unknown IPs. It only works from clean residential IPs.
2.  **CORS-locked:** the API only sends `access-control-allow-origin: https://mangaplus.shueisha.co.jp`, so the Kindle browser cannot call it directly.
3.  **Protobuf-only:** responses are `application/x-protobuf`; there is no JSON mode.

### Internet Archive integration (what the app uses)
*   **Catalog search:** `https://archive.org/advancedsearch.php?q=mediatype:texts AND collection:comics* AND licenseurl:*&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=20&page=N&sort[]=downloads desc&output=json`. The `licenseurl:*` filter is **mandatory** — the general `comics` collections are full of pirated Disney/manga scans; only items with an explicit license (public domain mark, CC) are legal. Sends `access-control-allow-origin: *`, so it is fetched **directly** (no proxy).
*   **Metadata:** `https://archive.org/metadata/{id}` — also CORS-open, direct fetch. Used to find the `*_scandata.xml` file. Note: `metadata.imagecount` is often absent, so page count must come from scandata.
*   **Scandata:** `https://archive.org/download/{id}/{file}_scandata.xml` — **does NOT send CORS headers**, so it is fetched through `/api/proxy` (IA does not ban cloud IPs). Parse with `DOMParser`, collect `<page leafNum="N">` where `addToAccessFormats != false`.
*   **Page images:** `https://archive.org/download/{id}/page/n{leaf}_w1080.jpg` — 302-redirects to `ia*.us.archive.org/BookReader/BookReaderImages.php`. Used as direct `<img src>` (no CORS needed for images).
*   **Covers:** `https://archive.org/services/img/{id}` — direct `<img src>`.
*   Items without scandata (CBZ-only uploads) cannot be read in-app; the reader shows an "Open on archive.org" fallback link.

### Library migration
Library items are stored in localforage key `manga_library` and must have `source: 'ia'` (IA identifier as `id`). Legacy MangaDex entries (UUID ids) are silently dropped on load with a status-bar notice.

### Dashboard entry
The `icons.js` entry uses `id: 'comics'` (file `comics.html`) with `name: 'Comics'`. All locale files translate `manga.title` as their word for "Comics".

## Akinator (`akinator.html` + `firebase-functions/akinator.js`)

**Current transport (2026-10):** a self-hosted Firebase HTTPS relay, with the public CORS proxies kept only as a last-resort fallback. The 2026-07 decision to run proxies-only no longer works — see below.

### Why the public proxies all died
Akinator.com's Cloudflare now fingerprints the **TLS ClientHello (JA3/JA4)**, not just headers:

- Browser `fetch`, `curl`, Node `undici` (even with a full Chrome header set) and **Cloudflare Workers/Pages Functions** all get the 403 "Just a moment..." challenge page. Verified against the deployed `rekindle.ink/api/proxy`.
- `got-scraping` (Chrome TLS + HTTP/2 fingerprint) gets the real page and JSON, from both a residential IP and Cloud Run.
- Every public proxy is dead: `test.cors.workers.dev` → Cloudflare `error 1027` (account banned for abuse), `corsproxy.io` → Cloudflare challenge, `codetabs`/`allorigins` → 522, `cors.lol` → 429, several others → 404/DNS fail.
- `en.akinator.com` sends **no** `Access-Control-Allow-Origin`, so the browser can never call it directly. A relay is unavoidable.
- Cloudflare Workers cannot fake a Chrome TLS fingerprint, so the old `workers/rekindle-akinator/` worker (still in the repo, undeployed) would fail even if redeployed. That is why the relay lives on Firebase (Node) instead.

### The relay
Defined in `firebase-functions/akinator.js`, exported as `exports.akinator` at the end of `firebase-functions/index.js`.

- URL: `https://us-central1-rekindle-dd1fa.cloudfunctions.net/akinator`
- Deploy: `firebase deploy --only functions:akinator` · remove: `firebase functions:delete akinator`
- `onRequest`, us-central1, 256 MiB, 30 s, **`maxInstances: 5`**, no min-instances (idle cost $0).
- **Stateless**: one HTTP request → one Akinator request. The `session` token is all that is needed (verified with and without cookies), so no Firestore/RTDB is used.
- **Quota:** zero Firestore/RTDB/Auth/Storage usage. A game is ~21 invocations; the Cloud Functions free tier (2M invocations / 400k GB-s / 200k CPU-s per month) covers roughly **40,000 games/month**.
- CORS allowlist: the four `rekindle.ink` origins + localhost. OPTIONS answered manually.
- Per-instance token bucket (~120 burst, 2 req/s per IP) as a cheap abuse guard; keyed off the first `x-forwarded-for` entry so Cloud Run can't collapse all users into one bucket.
- `got-scraping` is imported lazily so the other functions don't pay its cold start.
- In `akinator.html`, the relay is always tried first. The dead public proxies are only a fallback for a relay *reachability* failure (`network`/`relay_error`); `session_expired`, `bad_request`, `rate_limited` and all `upstream_*` errors stop immediately so users don't stare at ~45 s of proxy timeouts before the same error.

Request/response contract:

| Request | Response |
| :--- | :--- |
| `{action:'start', region, childMode}` | `{session, question, step:1, progression:0, answers[], baseUrl, sid, region}` |
| `{action:'answer', region, childMode, session, step, progression, answer:0-4, stepLast}` | `{step, progression, question}` or `{..., guess:{id,name,description,photo,noQuestion}}` |
| `{action:'back', region, childMode, session, step, progression}` | `{step, progression, question}` |
| `{action:'continue', region, childMode, session, step, progression}` | `{step, progression, question}` or next `guess` |

Errors: `{error:'session_expired'|'bad_request'|'upstream_blocked'|'upstream_timeout'|'upstream_parse', message}` with 400/409/502/504. `session_expired` is **not** retried on another transport — the page shows the modal and resets to the start screen.

### Akinator protocol changes (2026-10) — the bugs that broke the page even with a working proxy
1. **`step` starts at 1**, not 0. Sending `step: 0` makes `/answer` return `{"completion":"KO"}`; the old page treated that as "no new question" and silently re-rendered the same question forever.
2. **`signature` no longer exists** anywhere in the page (no hidden input, no JS variable). The old `apiStart()` required it, so every start threw even when the transport worked.
3. `/cancel_answer` must receive the **current** step, not `step - 1`. The wrong value returns the full HTML game page instead of JSON (and invalidates the session). Back is only valid during a question, never at a proposition.
4. `/exclude` still needs `forward_answer: '1'`. After a wrong guess the returned `step` can jump (e.g. 9 → 11); always copy `step`/`progression` from the response.
5. Guesses may carry `no_question: "1"` (genie out of questions); the page then ends the game instead of continuing.

### Endpoint details
- Start: `POST /game` with `cm`, `sid`, `anim` → HTML. Parse `session: '...'` and the `id="question-label"` `<p>` (the tag spans two lines — match `id` without requiring `class` to come first).
- Themes: characters `sid=1`, objects `2`, animals `14`.
- `region` maps to `<lang>.akinator.com`. Only these hosts resolve: en, de, es, fr, it, nl, pl, pt, ru, tr, id, ar, cn, il, jp, kr, uk, vn, fa. (`gr` and `sp` do **not** — the page uses `es` for Spanish and `jp` for Japanese.)
- Answer labels: `a_yes`, `a_no`, `a_dont_know`, `a_probably`, `a_probaly_not` (Akinator's own typo).
- Action response fields: `step`, `progression`, `question`, `id_proposition`, `id_base_proposition`, `name_proposition`, `description_proposition`, `photo`, `no_question`, or `completion: "KO"`.
- `X-Requested-With: XMLHttpRequest`, `Origin` and `Referer` (…/game, or …/theme-selection for `/game`) are all sent by the relay.

### Testing
- Local harness: load `firebase-functions/akinator.js`, call `akinatorHandler({method:'POST', body, headers:{origin:'https://rekindle.ink'}, ip}, fakeRes)`. This exercises the real upstream.
- Deployed: `curl -X POST https://us-central1-rekindle-dd1fa.cloudfunctions.net/akinator -H 'Content-Type: application/json' -H 'Origin: https://rekindle.ink' --data '{"action":"start","region":"en"}'`.
- The page can be tested without a browser by running its extracted inline script in a `vm` sandbox with a fake DOM (see the 2026-10 fix). The proxy fallback path can't be tested meaningfully while the proxies are dead.

---

## 📚 Project Gutenberg (gutenberg.html + functions/api/gutenberg.js, 2026-10-20)

In-app search and reader for Project Gutenberg's ~70,000 books, added as the
in-app counterpart to `epub.html` (which only links out to gutenberg.org).

### Gutendex is dead — use Gutenberg's own OPDS
The obvious API, `gutendex.com`, was unreachable when this was built (connection
hangs, then `000`; its API now 301-redirects to itself). Do **not** reintroduce it
as the primary search source.

Use the official catalogue instead:

| Need | URL |
| :--- | :--- |
| Search | `https://www.gutenberg.org/ebooks/search.opds/?query=<q>` |
| Next page | follow the feed's own `<link rel="next" href="...&start_index=26">` |
| Book text (primary) | `https://www.gutenberg.org/cache/epub/{id}/pg{id}.txt` |
| Text fallbacks | `/files/{id}/{id}-0.txt`, `/ebooks/{id}.txt.utf-8` (302 → follow) |

Search results are Atom `<entry>` blocks carrying `<title>`, `<content type="text">`
(author) and `https://www.gutenberg.org/ebooks/{id}.opds`. There is **no
download_count and no language** in the search feed, and no plain-text link in the
detail feed — the text URL has to be constructed from the id. Thumbnails are
multi-KB base64 data URIs: strip `<link ... rel="http://opds-spec.org/image" .../>`
before matching entries or the regex pass gets expensive on the Kindle. Regex
parsing beats `DOMParser` here for the same reason.

### CORS and the proxy
`www.gutenberg.org` sends no CORS headers, so every OPDS/text fetch goes through
`functions/api/gutenberg.js?url=<encoded>` first, with a direct `fetch` only as a
last resort. The proxy mirrors `functions/api/reddit.js`: exact allowlist
(`gutenberg.org`, `www.gutenberg.org` — no suffix matching), GET/HEAD only,
`redirect:'follow'`, 15s `AbortController` timeout, `body.tee()` +
`context.waitUntil` edge caching, and 3 attempts with 400ms/1200ms backoff on
429/5xx (honouring `Retry-After`). Cache TTLs: 1800s for `.opds`, 86400s for
`.txt`, 3600s otherwise.

### Reader choices that matter on e-ink
- **Pagination by viewport, not measurement**: the pane is fixed-height and
  `overflow-y:auto`; Prev/Next set `scrollTop` by exactly `clientHeight`
  (instant, never smooth). Page count is `ceil(scrollHeight/clientHeight)`; when
  `scrollTop >= scrollMax - 0.5` the index is pinned to the last page so the final
  partial page is reachable and Prev can leave it.
- **One `innerHTML` for the whole book**: thousands of individual paragraph
  appends would each trip the i18n `MutationObserver`.
- **Cache-first reopen**: browser Cache API `rekindle-gutenberg-v1` keyed by the
  text URL, then network. Guard `typeof caches !== 'undefined'` — the Kindle
  browser may not have it.
- Text is cleaned between the `*** START/END OF (THE|THIS) PROJECT GUTENBERG
  EBOOK ***` markers, CRLF normalised, 3+ blank lines collapsed. Over 2,000,000
  chars is truncated with a visible notice rather than risking a jitless freeze.

### Storage keys
`rekindle_gb_recent` (`{id,title,author,pct,ts}`, max 8), `rekindle_gb_pos_<id>`
(`{scrollTop, pct}`), `rekindle_gb_font` (16/18/20/24).

### Testing
Local static servers cannot exercise Pages Functions, and direct gutenberg.org
fetches fail CORS locally, so expect the network-error state outside
`wrangler pages dev`/Pages. The page itself can be driven headlessly with `jsdom`
and a stubbed `window.fetch` returning a saved OPDS feed + a text excerpt (verified:
25 Dickens results, correct first title, contents modal, paragraph render, error
state, shelf). The proxy was tested in Node against the live site (allowlist,
403/405/OPTIONS/HEAD, redirect-follow, cache headers all correct).

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).
