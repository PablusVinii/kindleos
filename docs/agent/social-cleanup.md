# Daily Social Cleanup (`cleanupSocial`)

Area notes for the scheduled retention job added 2026-10-21. Read before changing
`firebase-functions/social-cleanup.js`, `firebase-functions/cleanup-lib.js`, the social
RTDB rules, or anything that relies on old social content still existing.

## What it is

A Firebase v2 scheduled function in the **primary** project (`rekindle-dd1fa`) that
runs once a day at **04:00 Australia/Sydney** and prunes expired content owned by
the **social** project (`rekindle-socials`), plus the primary-project `mod_actions`
audit log. It uses the existing `socialAdminApp` (secondary app initialized from
`SOCIAL_SERVICE_ACCOUNT_JSON` in `firebase-functions/.env`), so no new secret is
needed.

Why a Firebase Function and not a Cloudflare Worker: the Admin SDK already provides
`recursiveDelete`, aggregation `count()`, Firestore transactions and the social
service-account wiring. A Worker would need hand-rolled Firestore batch REST and
OAuth token minting for the same Firebase read/delete bill. One Cloud Scheduler job
and one daily invocation fit the free tiers.

## Retention

| Data | Project / path | Kept | Action |
| :--- | :--- | :--- | :--- |
| Chat messages | Social RTDB `kindlechat/messages/{id}` | 30 d, plus the latest 50 | Delete |
| Chat translations | Social RTDB `kindlechat/translations_by_lang/{lang}/{id}` | same as message | Delete in the same multi-path update |
| Art index | Social RTDB `kindlechat/art_index/{id}` | same as message | Delete in the same multi-path update |
| Topic comments | Social Firestore `topics/{id}/comments/{commentId}` | 90 d | Batched deletes, then repair `commentCount`/`lastActive` |
| Empty topics | Social Firestore `topics/{id}` + `pollVotes` | 90 d old and no comments | `recursiveDelete` |
| Neighbourhood posts | Social Firestore `neighbourhood_posts/{id}` + `comments` | 90 d | `recursiveDelete` |
| Reports | Social RTDB `reports/{id}` | 90 d old, resolved/dismissed only | Delete |
| Automod log | Social RTDB `automod_log/{id}` | 30 d | Delete |
| Moderator actions | Primary RTDB `mod_actions/{id}` | 365 d | Delete |

Never deleted: **pending reports**, DM threads/messages (`kindlechat/dm_*`),
`users_public`, `user_cards`, `users_private`, `timeouts`, `banned_ips`,
`suggestions`, and all personal user data.

Art-gallery consequence: `art_index` entries are deleted with their messages. The
gallery already handles missing messages, so it prunes instead of showing broken
items. Preserving old art would require storing the full art in `art_index` (it only
holds thumbnails today), which is a separate design change.

## Config

All cutoffs and caps live in `CLEANUP_CONFIG` in
`firebase-functions/social-cleanup.js`. Change the constants and redeploy; there is no
remote config document.

| Key | Default |
| :--- | :--- |
| `chatRetentionDays` | 30 |
| `keepLatestChatMessages` | 50 |
| `topicRetentionDays` | 90 |
| `neighbourhoodRetentionDays` | 90 |
| `reportRetentionDays` | 90 |
| `automodRetentionDays` | 30 |
| `modActionsRetentionDays` | 365 |
| `chatBatchSize` | 200 messages per multi-path write |
| `firestorePageSize` | 200 topics per page |
| `deleteBatchSize` | 400 comment deletes per Firestore batch |
| `maxChatMessagesPerRun` | 5000 |
| `maxCommentDeletesPerRun` | 10000 |
| `maxPostDeletesPerRun` | 1000 |
| `maxReportDeletesPerRun` | 5000 |
| `maxAutomodDeletesPerRun` | 5000 |
| `maxModActionDeletesPerRun` | 5000 |
| `timeBudgetMs` | 480000 (8 min; the function timeout is 540 s) |

`dryRun` is enabled by setting `SOCIAL_CLEANUP_DRY_RUN=1` in
`firebase-functions/.env` and redeploying. It performs all reads and logs the
candidates but no deletes, batches, transactions or recursive deletes.

## How each task stays cheap

- **Chat:** RTDB REST `shallow=true&orderBy="timestamp"&startAt=0&endAt=...` returns
  only message keys, so pixel-art/base64 bodies are never downloaded. One multi-path
  `update()` deletes the message plus `art_index` and every language translation. The
  live language list is read shallow from `translations_by_lang`; the hard-coded
  `TRANSLATION_LANGS` list is only a fallback.
- **Topics:** scan only topics whose `timestamp` is already older than the retention
  window, page their comments by `timestamp`, delete 400 per batch, then use
  `count()` (an aggregation) and one `orderBy('timestamp', 'desc').limit(1)` read to
  repair the denormalised counter and `lastActive`. Counter updates use a transaction
  so a comment posted during cleanup is not lost. A topic that loses all comments is
  removed with `recursiveDelete`, which also clears `pollVotes`.
- **Neighbourhood:** one query for old posts (selecting only `timestamp`), then
  `recursiveDelete` per post. This removes the whole comment subcollection without
  reading comment bodies; Firestore's list/delete operations replace per-comment
  reads.
- **Reports / automod / mod actions:** RTDB ordered queries. Reports need full values
  to check `status`; automod and moderator actions use `shallow=true` key-only scans.
  Pending reports are skipped. If the oldest report page is entirely pending, the task
  stops rather than re-reading it every day.
- **Bounded work:** every task checks the 8-minute budget and per-run caps. A large
  first backlog is deleted oldest-first over several days.

## Index requirements

Deploy both rules changes **before** deploying the function; without them the
ordered RTDB queries can fall back to downloading the whole node:

- `rtdb-social-rules.json` — `automod_log` block with `.indexOn: ["timestamp"]`
  (read/write remain denied; the service account bypasses rules).
- `rtdb-rules.json` — `mod_actions` `.indexOn: ["createdAt"]`.

No Firestore composite indexes are needed: each query filters and orders by the same
single field (`timestamp`) inside one collection/subcollection, which uses the
automatic single-field index.

## Deploy and first run

```bash
# 1. Add the indexes first.
npm run deploy:rules:rtdb
npm run deploy:rules:social:rtdb

# 2. Deploy in dry-run mode.
#    Add SOCIAL_CLEANUP_DRY_RUN=1 to firebase-functions/.env first.
firebase deploy --only functions:cleanupSocial --project rekindle-dd1fa

# 3. Run the Cloud Scheduler job manually and inspect the logs:
#    Console -> Cloud Scheduler -> firebase-schedule-cleanupSocial-us-central1 -> Run now
#    Expect "social-cleanup: starting/finished", dryRun=true, and candidate counts.

# 4. Remove SOCIAL_CLEANUP_DRY_RUN from firebase-functions/.env and redeploy.
firebase deploy --only functions:cleanupSocial --project rekindle-dd1fa
```

The function name is `cleanupSocial`; the auto-created scheduler job is
`firebase-schedule-cleanupSocial-us-central1`. A scheduled run requires the Blaze plan
and the Cloud Scheduler API (already enabled by the existing v2 functions).

If any task fails, `runSocialCleanup` still runs the remaining tasks and the exported
handler throws at the end so Cloud Monitoring shows the invocation as failed. Check
the per-task error in the logs.

## Verification

1. Dry run: candidate counts are non-zero, `"dryRun": true`, and a known old message
   still exists.
2. First real run: the log shows `dryRun=false`; spot-check that one old message, one
   old topic comment/post, one resolved old report and one old automod entry are gone
   while recent counterparts remain.
3. Topic counters: open a cleaned topic and confirm the sidebar count and relative
   `lastActive` match the remaining comments.
4. Run again the next day: deletion counts should be near zero (idempotent).
5. KindleChat, Topics and Neighbourhood still load; removed nodes only arrive as
   listener removals, which all three clients already handle.

## Edge cases / failure modes

- **Missing timestamps** are excluded by `startAt=0` in RTDB and by Firestore range
  filters. Malformed legacy documents are therefore never deleted by this job.
- **Invalid RTDB keys** (slashes/dots) are filtered before paths are built, so a bad
  key cannot escape the intended subtree.
- **Token failure** skips that RTDB task and logs it; Firestore tasks still run.
  **Missing `SOCIAL_SERVICE_ACCOUNT_JSON`** fails the scheduled invocation visibly.
- **Concurrent activity:** topic counters use a transaction; post/comment deletion
  uses an old cutoff (90 d), so races are negligible.
- **Old pending reports** can block the oldest report page; the task stops and logs
  rather than looping. Resolve/dismiss them in the moderation console.
- **Art/translations for already-deleted messages** are not discovered by this job.
  They need a one-time orphan sweep.
- **Deleting old `mod_actions`** removes their undo data after 12 months.

## Deliberately not cleaned

- `kindlechat/server_rate_limits` — small; revisit if the user base grows.
- `kindlechat/user_recent` — retired stale node; one-time manual delete.
- Orphaned `translations_by_lang` / `art_index` entries from before this job.
- `matchmaking/*` and `games/*` — no reliable server-side age field yet; add a
  `createdAt` at host time first.
- `freewrite_sessions` (primary RTDB) — separate feature; could get its own short
  retention later.
- DM messages — deliberately untouched.

## Tests

`node scripts/test-cleanup.js` (also part of `npm test`) covers cutoff arithmetic,
key/path safety, multi-path construction, report-status rules, timestamp coercion,
and the concurrency helper. The I/O layer is verified in production with the dry-run
rollout above.
