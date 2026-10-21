# Reports & Moderation

Report UI -> `rekindle-moderate` worker -> RTDB -> Discord. Read before touching `js/reports.js`, any report button, `moderation.html`, or the worker's `report` handler.

## 📋 Reporting System

Users can report content across all social apps. Reports are stored in Firestore and trigger Discord notifications.

### Architecture
- **Client Module:** `js/reports.js` — provides `rekindleOpenReportModal()` with System 7 styling
- **Backend Handler:** `workers/rekindle-moderate/worker.js` handles `type: "report"` requests
- **Storage:** RTDB `/reports` on the **social** project (`rekindle-socials`)
- **Notifications:** Discord bot via `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` environment variables. Fires on every report submission. Includes action buttons (Delete, Timeout, Dismiss) for manual moderation.

### Data Model (`/reports` RTDB)
Each entry is keyed by a Firebase push ID and contains:
```javascript
{
  reporterId, reporterName,
  reportedUserId, reportedUserName,
  contentType, contentId, contentPath,
  reason, comment, contentSnapshot,
  dmContext?,                       // KindleChat DM reports only: last 10 messages
  status: "pending" | "resolved" | "dismissed",
  createdAt, resolvedAt, resolvedBy, resolutionNote
}
```

### KindleChat direct-message reports (`dm_message`)
DM reports are special because message IDs are only unique inside a thread:
- The client sends `contentType: 'dm_message'`, `contentId: '<messageId>'` and `contentPath: 'kindlechat/dm_messages/<threadId>/<messageId>'`.
- The worker **ignores** the client's author/snapshot/path: it verifies the reporter is a thread participant, reads the message from the social RTDB, derives the path/author/snapshot, and attaches `dmContext` (last 10 messages). A forged path cannot auto-delete another thread.
- `dm_message` is in `IMMEDIATE_DELETE_TYPES` (first report deletes) and `autoDeleteContent` only accepts the strict DM path shape.
- Moderators deliberately have **no blanket read rule** on `dm_threads`/`dm_messages`; the report's `dmContext` is the only context they see. Discord's delete action looks up the report to recover the thread path.
- Cleanup of a deleted user's DM data is done by `admin/cleanup_user.js` / `admin/nuke_user.js` (service account), not the moderation console.

### RTDB Rules
Reports live under `/reports` in `rtdb-social-rules.json`:
- `.read`: `ukiyo@rekindle.ink` or moderators
- `.write`: `ukiyo@rekindle.ink` or the social service account
- `.indexOn`: `["contentId", "contentType", "status", "createdAt"]`

### RTDB Indexes Required
Add this index in the Firebase Console under the social RTDB for the `/reports` node:
- `contentId`
- `contentType`
- `status`
- `createdAt`

### Rate Limits
- 60 reports per hour per user (enforced in moderation worker)

### Adding Report Buttons to New Social Apps
1. Include `<script src="js/reports.js"></script>` in the HTML `<head>`
2. Call `rekindleOpenReportModal({contentType, contentId, contentPath, reportedUserId, contentSnapshot})`

### Files Modified
- `js/reports.js` (new)
- `workers/rekindle-moderate/worker.js` — added report handler + Discord notification
- `kindlechat.html` — report buttons on general messages and DM messages
- `neighbourhood.html` — report buttons on posts and comments
- `topics.html` — report buttons on topics and comments
- `moderation.html` — added "User Reports" panel with pending/resolved/dismissed filters
- `firestore-social.rules` — added `reports` collection rules

### Discord Bot Setup
Set `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` as Cloudflare Worker environment variables. **No fallback** — if not set, notifications are silently skipped. Never commit the bot token to the repository — use environment variables.

**Setup Steps:**
1. Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to "Bot" tab → Click "Reset Token" → Copy the token
3. Invite the bot to your server with "Send Messages", "Embed Links", and "Use Application Commands" permissions
4. Set `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` as Cloudflare Worker secrets

**Auto-Deletion:** When 2 different users report the same content (same `contentType` + `contentId`), the content is automatically deleted and both reports are marked as "resolved". The Discord notification will show a green embed indicating the auto-deletion.

**Discord Action Buttons:** Each Discord notification includes 3 buttons:
- **Delete Content** — Manually deletes the reported content
- **Timeout User (24h)** — Applies a 24-hour timeout to the reported user
- **Dismiss Report** — Marks the report as resolved without action

To enable buttons, you must set up Discord Interactions:
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → Your Application
2. Go to "General Information" → Set "Interactions Endpoint URL" to: `https://rekindle-moderate.timjarnott.workers.dev/discord-interaction`
3. Set `DISCORD_PUBLIC_KEY` as a Cloudflare Worker environment variable (found in Discord Developer Portal under "General Information")

### RTDB Indexes Required
Reports live under `/reports` in the social RTDB. The dashboard reads from RTDB and filters/sorts in memory, but the worker query for existing reports uses `orderByChild('contentId').equalTo(...)`, so an index on `contentId` is required for performance at scale.

1. **Reports node:**
    - **Path:** `/reports`
    - **Index fields:** `contentId`

### Auto-Delete Behaviour
When 2 different users report the same content (same `contentType` + `contentId`), the worker attempts to automatically delete the content. If deletion succeeds, both reports are marked as `resolved`. If deletion fails (e.g. RTDB permission issue), both reports remain `pending` so moderators can review them manually. The Discord notification will indicate whether the auto-delete succeeded or failed.

### Security: Escaping for JS String Literals
When passing user-generated text into `onclick` HTML attributes, **never rely solely on `escapeHtml()`**. HTML entity decoding happens before JS execution, so `&#039;` becomes `'` and breaks out of the string literal.

**Correct pattern** (used in all report buttons):
```javascript
var safeText = userText
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u0026/g, '\u0026amp;')
    .replace(/\u003c/g, '\u0026lt;')
    .replace(/\u003e/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;');
```

### Guarding Optional Firebase / CDN Dependencies
If an app can function without Firebase (e.g., local-only games), wrap Firebase initialization and all `auth`/`db` usage in feature checks. A blocked or failed CDN script must not prevent the rest of the page script from running. Use `typeof firebase !== 'undefined' && typeof firebase.auth === 'function' && typeof firebase.firestore === 'function'` before initializing, and guard every `db.collection(...)` / `auth.onAuthStateChanged(...)` call. See `nonograms.html` for the pattern used in this codebase.

---

New findings for this area go here, not in `AGENTS.md` (65,536-byte budget).

## 2026-10-21 backlog pass

- **Timeout lookups are cached per uid for 30 s** (`timeoutCache` in
  `workers/rekindle-moderate/worker.js`). Every content write used to pay an RTDB GET for
  `timeouts/{uid}`, a node that is empty for almost every user. Repeat attempts from a timed-out
  user now stop costing a Firebase round trip. A newly set timeout takes effect within 30 s.
- **Report buttons are 48×48 touch targets**: the 20 px circle is now a `.report-dot` inside a
  transparent `.report-btn` that occupies real layout space (no overlap with the timestamp /
  Edit button). Applied in `neighbourhood.html` and `topics.html`.
- **Discord "Delete" now resolves comment paths from the stored report.** `getContentPath()` used
  to return `topics/{commentId}` / `neighbourhood_posts/{commentId}` for `topic_comment` /
  `neighbourhood_comment`, i.e. it treated a comment id as a parent id — the delete hit a
  non-existent document and did nothing. Those types (and `suggestion_comment`, `dm_message`) now
  return `""` from `getContentPath()` and `handleDiscordInteraction()` falls back to the
  `contentPath` stored on the pending report. `autoDeleteContent()` also validates the path shape
  (`parseCommentPath()`) and that the trailing id matches `contentId` before deleting, and adjusts
  the parent's `commentCount` afterwards (see `performance.md`).

