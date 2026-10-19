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

## Akinator API (`akinator.html`)
The Akinator game talks to Akinator.com through third-party **CORS proxies only** — there is no self-hosted backend (the Cloudflare Worker fallback was removed 2026-07 at user request; the old worker code still exists undeployed at `workers/rekindle-akinator/`).

## Transport chain (in `akinator.html`)
- **CORS proxies** (`CORS_PROXIES` list, tried in order). The page itself scrapes `/game` for session/signature/question and POSTs form data to `/answer`, `/cancel_answer`, `/exclude`. Per-proxy entry shape: `{ base, encode }` — `encode: true` means append `encodeURIComponent(targetUrl)` (corsproxy.io, codetabs), `false` means append the raw URL (Zibri's `test.cors.workers.dev`).

`withTransport(fn)` runs each operation against the chain; the first transport that succeeds becomes `activeTransport` and is tried first next time (reset on failure). **Akinator sessions are param-based** (`session` + `signature` in every POST, no cookies), so transports can switch mid-game without losing state.

## Proxy gotchas (verified 2026-07)
- **`X-Requested-With: XMLHttpRequest` is required** on POSTs to Akinator's endpoints — without it Akinator's Cloudflare returns a 403 WAF block page. Browsers can send it (triggers a preflight; working proxies answer OPTIONS correctly).
- `test.cors.workers.dev` (Zibri's cloudflare-cors-anywhere) is the only public proxy verified to work with Akinator. It **rejects requests without an `Origin` header** ("Error: use fetch()") and without a browser User-Agent — both are automatic from a real browser, but curl/node tests must set them manually.
- `corsproxy.io` reaches Akinator but gets a Cloudflare challenge page; codetabs/allorigins are frequently down (522); `proxy.corsfix.com` requires per-domain registration; `cors.sh` needs an API key. Public proxies are flaky — with no worker fallback anymore, all proxies failing means the user sees a start/network error. Re-test before adding/reordering proxies.
- The proxy path validates responses (regex-extracted session/signature/question for start, `JSON.parse` for actions), so a proxy returning a challenge page or HTML just fails through to the next transport.

## Akinator.com endpoint details
- Akinator.com sits behind Cloudflare bot protection; calls can be blocked if the upstream IP/headers are flagged.
- The start endpoint scrapes the Akinator `/game` page. Reliable patterns are:
  - `session: '...'` (inline JS)
  - `signature: '...'` (inline JS)
  - `<p class="question-text" id="question-label">...</p>`
  - Answer labels from `<a class="li-game" href="#" id="a_yes" onclick="chooseAnswer(0)">...</a>` (and `a_no`, `a_dont_know`, `a_probably`, `a_probaly_not`).
- Action endpoints: `/answer` (send 0-4), `/cancel_answer` (back), `/exclude` (continue after wrong guess).
- Supported regions and theme `sid` values: characters=1, objects=2, animals=14.
- Sessions are short numeric strings (e.g. `'886'`) and the signature is base64 — both appear multiple times in the `/game` HTML. `extractFirst()` picks the **longest** match across all patterns to avoid short decoys.
- Continue maps to Akinator `/exclude` and **must** send `forward_answer: '1'` (per the site's own `continuePartie()` JS) — **not** `step_last_proposition`. Without it, Akinator returns the HTML game page instead of JSON, and the browser's `JSON.parse` throws.
- Canonical endpoint params (scraped from the `/game` page inline JS, 2026-07): `/answer` = step, progression, sid, cm, answer, step_last_proposition, session, signature. `/cancel_answer` = step, progression, sid, cm, session, signature. `/exclude` = step, sid, cm, progression, session, signature, forward_answer ('1' = keep playing, '0' = end game).
- akinator.com hard-blocks some residential IPs with a Cloudflare 403 even with full browser headers. Don't trust local `curl` results for diagnosis.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).
