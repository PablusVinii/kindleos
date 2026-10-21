/**
 * Pure helpers for the daily social-content retention job (`cleanupSocial`).
 *
 * Deliberately free of firebase-admin / firebase-functions imports so
 * `scripts/test-cleanup.js` can exercise the cutoffs and multi-path builder
 * without credentials. The I/O layer lives in social-cleanup.js.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Keep in sync with targetLangs in workers/rekindle-translate/worker.js.
// social-cleanup.js prefers the live keys under kindlechat/translations_by_lang
// and only falls back to this list if that shallow read fails.
const TRANSLATION_LANGS = ['en', 'es', 'pt', 'pl', 'de', 'it', 'fr', 'ru', 'zh', 'vi'];

// Firebase push IDs are URL-safe; reject slashes/dots so a malformed key can
// never escape the intended RTDB subtree.
const RTDB_KEY_RE = /^[A-Za-z0-9_-]{1,768}$/;

function isSafeRtdbKey(key) {
    return typeof key === 'string' && RTDB_KEY_RE.test(key);
}

function cutoffMs(nowMs, days) {
    if (!Number.isFinite(nowMs)) {
        throw new Error('cutoffMs: nowMs must be a finite number');
    }
    if (!Number.isInteger(days) || days < 1) {
        throw new Error('cutoffMs: days must be a positive integer');
    }
    return nowMs - days * DAY_MS;
}

function chunk(items, size) {
    const list = Array.isArray(items) ? items : [];
    const width = Math.max(1, Math.trunc(Number(size)) || 1);
    const out = [];
    for (let i = 0; i < list.length; i += width) {
        out.push(list.slice(i, i + width));
    }
    return out;
}

/**
 * Run `fn` over `items` with at most `limit` concurrent calls. Results keep the
 * input order so callers can log deterministic summaries.
 */
async function mapWithConcurrency(items, limit, fn) {
    const list = Array.isArray(items) ? items : [];
    const width = Math.max(1, Math.min(Math.trunc(Number(limit)) || 1, list.length || 1));
    const results = new Array(list.length);
    let next = 0;

    async function worker() {
        for (;;) {
            const index = next++;
            if (index >= list.length) return;
            results[index] = await fn(list[index], index);
        }
    }

    await Promise.all(Array.from({ length: width }, () => worker()));
    return results;
}

/**
 * Build the single multi-path RTDB update that removes a batch of chat
 * messages plus everything derived from them. Passing null deletes the path.
 *
 * Each message costs 2 + N_languages paths (message, art_index, translations).
 * social-cleanup.js keeps batches at 200 messages (~2,400 paths) so one write
 * stays comfortably small.
 */
function buildChatDeletePaths(ids, langs) {
    const updates = {};
    const safeLangs = Array.from(new Set((Array.isArray(langs) ? langs : []).filter(isSafeRtdbKey)));

    for (const id of Array.isArray(ids) ? ids : []) {
        if (!isSafeRtdbKey(id)) continue;

        updates[`kindlechat/messages/${id}`] = null;
        updates[`kindlechat/art_index/${id}`] = null;
        for (const lang of safeLangs) {
            updates[`kindlechat/translations_by_lang/${lang}/${id}`] = null;
        }
    }

    return updates;
}

/**
 * Resolved/dismissed reports are pruned after `retentionDays`. Pending reports
 * are deliberately never auto-deleted: they are the moderator queue.
 */
function shouldDeleteReport(report, nowMs, retentionDays) {
    if (!report || typeof report !== 'object') return false;
    if (report.status !== 'resolved' && report.status !== 'dismissed') return false;

    const createdAt = Number(report.createdAt);
    if (!Number.isFinite(createdAt)) return false;

    return createdAt < cutoffMs(nowMs, retentionDays);
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : 0;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : 0;
    }
    return 0;
}

module.exports = {
    DAY_MS,
    TRANSLATION_LANGS,
    isSafeRtdbKey,
    cutoffMs,
    chunk,
    mapWithConcurrency,
    buildChatDeletePaths,
    shouldDeleteReport,
    toMillis
};
