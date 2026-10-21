/**
 * Daily social-content retention job (`cleanupSocial`).
 *
 * Deletes expired content owned by the SOCIAL project (rekindle-socials) plus
 * the primary-project moderator action log. Every task is independent and
 * idempotent: a failure in one collection is logged and the rest still run.
 *
 * Efficiency notes (see docs/agent/social-cleanup.md):
 *  - RTDB candidate scans use REST `shallow=true`, so message bodies / pixel
 *    art / report snapshots are not downloaded just to get keys.
 *  - Chat deletes are one multi-path update per batch: message + art_index +
 *    every translations_by_lang entry.
 *  - Firestore deletes use batched deletes for comments and recursiveDelete
 *    for topics/posts (no per-comment document reads).
 *  - The job stops at a time budget before the 540 s function timeout, so a
 *    large backlog is caught up over multiple days (oldest first).
 */

const {
    TRANSLATION_LANGS,
    isSafeRtdbKey,
    cutoffMs,
    buildChatDeletePaths,
    shouldDeleteReport,
    toMillis,
    mapWithConcurrency
} = require('./cleanup-lib');

const SOCIAL_DB_URL = 'https://rekindle-socials-default-rtdb.firebaseio.com';
const PRIMARY_DB_URL = 'https://rekindle-dd1fa-default-rtdb.firebaseio.com';

const CLEANUP_CONFIG = {
    // Retention (days). Keep in sync with docs/agent/social-cleanup.md.
    chatRetentionDays: 30,
    keepLatestChatMessages: 50,
    topicRetentionDays: 90,
    neighbourhoodRetentionDays: 90,
    reportRetentionDays: 90,
    automodRetentionDays: 30,
    modActionsRetentionDays: 365,

    // Batch sizes.
    chatBatchSize: 200,
    firestorePageSize: 200,
    deleteBatchSize: 400,

    // Per-run caps; the time budget is the hard stop.
    maxTopicsPerRun: 2000,
    maxChatMessagesPerRun: 5000,
    maxCommentDeletesPerRun: 10000,
    maxPostDeletesPerRun: 1000,
    maxReportDeletesPerRun: 5000,
    maxAutomodDeletesPerRun: 5000,
    maxModActionDeletesPerRun: 5000,
    timeBudgetMs: 8 * 60 * 1000
};

const RETENTION_KEYS = [
    'chatRetentionDays',
    'topicRetentionDays',
    'neighbourhoodRetentionDays',
    'reportRetentionDays',
    'automodRetentionDays',
    'modActionsRetentionDays'
];

const POSITIVE_INT_KEYS = [
    'chatBatchSize',
    'firestorePageSize',
    'deleteBatchSize',
    'maxTopicsPerRun',
    'maxChatMessagesPerRun',
    'maxCommentDeletesPerRun',
    'maxPostDeletesPerRun',
    'maxReportDeletesPerRun',
    'maxAutomodDeletesPerRun',
    'maxModActionDeletesPerRun',
    'timeBudgetMs'
];

function validateConfig(config, nowMs) {
    if (!Number.isFinite(nowMs)) {
        throw new Error('social-cleanup: now must be a finite timestamp');
    }
    for (const key of RETENTION_KEYS) {
        if (!Number.isInteger(config[key]) || config[key] < 1) {
            throw new Error(`social-cleanup: ${key} must be an integer >= 1`);
        }
    }
    if (!Number.isInteger(config.keepLatestChatMessages) || config.keepLatestChatMessages < 0) {
        throw new Error('social-cleanup: keepLatestChatMessages must be an integer >= 0');
    }
    for (const key of POSITIVE_INT_KEYS) {
        if (!Number.isInteger(config[key]) || config[key] < 1) {
            throw new Error(`social-cleanup: ${key} must be an integer >= 1`);
        }
    }
}

function databaseFor(app) {
    if (!app) return null;
    try {
        return app.database();
    } catch (e) {
        return null;
    }
}

function dbUrlFor(app, fallback) {
    const url = app && app.options && app.options.databaseURL;
    if (typeof url === 'string' && url) return url.replace(/\/+$/, '');
    return fallback;
}

async function runSocialCleanup(options) {
    const opts = options || {};
    const socialApp = opts.socialApp;
    const primaryApp = opts.primaryApp || null;
    const logger = opts.logger || console;
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const config = Object.assign({}, CLEANUP_CONFIG, opts.config || {});
    const dryRun = opts.dryRun === true || process.env.SOCIAL_CLEANUP_DRY_RUN === '1';

    if (!socialApp) {
        throw new Error('social-cleanup: socialApp is required');
    }
    validateConfig(config, now);

    const socialDb = socialApp.firestore();
    const socialRtdb = databaseFor(socialApp);
    const primaryRtdb = databaseFor(primaryApp);
    const socialDbUrl = dbUrlFor(socialApp, SOCIAL_DB_URL);
    const primaryDbUrl = dbUrlFor(primaryApp, PRIMARY_DB_URL);

    const startedAt = Date.now();
    const deadline = startedAt + config.timeBudgetMs;
    const tokens = Object.create(null);

    const summary = {
        dryRun,
        startedAt: new Date(now).toISOString(),
        cutoffs: {
            chat: new Date(cutoffMs(now, config.chatRetentionDays)).toISOString(),
            topics: new Date(cutoffMs(now, config.topicRetentionDays)).toISOString(),
            neighbourhood: new Date(cutoffMs(now, config.neighbourhoodRetentionDays)).toISOString(),
            reports: new Date(cutoffMs(now, config.reportRetentionDays)).toISOString(),
            automod: new Date(cutoffMs(now, config.automodRetentionDays)).toISOString(),
            modActions: new Date(cutoffMs(now, config.modActionsRetentionDays)).toISOString()
        },
        tasks: {},
        errors: []
    };

    function info(message, payload) {
        if (typeof logger.info === 'function') logger.info(message, payload);
        else if (typeof logger.log === 'function') logger.log(message, payload);
    }

    function warn(message, payload) {
        if (typeof logger.warn === 'function') logger.warn(message, payload);
        else if (typeof logger.log === 'function') logger.log(message, payload);
    }

    async function getToken(kind) {
        if (tokens[kind]) return tokens[kind];
        const getter = opts.accessTokens && opts.accessTokens[kind];
        if (typeof getter !== 'function') {
            throw new Error(`social-cleanup: no ${kind} access-token getter configured`);
        }
        const token = await getter();
        if (typeof token !== 'string' || !token) {
            throw new Error(`social-cleanup: empty ${kind} access token`);
        }
        tokens[kind] = token;
        return token;
    }

    async function rtdbFetch(dbUrl, path, params, token) {
        const search = new URLSearchParams(params || {});
        search.set('access_token', token);
        const url = `${dbUrl}/${path}.json?${search.toString()}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
            throw new Error(`RTDB query failed (${response.status})`);
        }
        return response.json();
    }

    function validateQueryField(field) {
        if (field !== 'timestamp' && field !== 'createdAt') {
            throw new Error(`social-cleanup: unsupported RTDB order field ${field}`);
        }
    }

    async function shallowOldKeys(dbUrl, path, field, endAtMs, limit, token) {
        validateQueryField(field);
        const data = await rtdbFetch(dbUrl, path, {
            shallow: 'true',
            orderBy: `"${field}"`,
            startAt: '0',
            endAt: String(endAtMs),
            limitToFirst: String(limit)
        }, token);
        if (!data || typeof data !== 'object') return [];
        return Object.keys(data).filter(isSafeRtdbKey);
    }

    async function shallowKeys(dbUrl, path, token) {
        const data = await rtdbFetch(dbUrl, path, { shallow: 'true' }, token);
        if (!data || typeof data !== 'object') return [];
        return Object.keys(data).filter(isSafeRtdbKey);
    }

    async function latestKeys(dbUrl, path, field, limit, token) {
        validateQueryField(field);
        const data = await rtdbFetch(dbUrl, path, {
            shallow: 'true',
            orderBy: `"${field}"`,
            limitToLast: String(limit)
        }, token);
        if (!data || typeof data !== 'object') return [];
        return Object.keys(data);
    }

    async function rtdbMultiPathDelete(db, updates) {
        if (!db) throw new Error('social-cleanup: RTDB is unavailable');
        if (!updates || Object.keys(updates).length === 0) return;
        await db.ref().update(updates);
    }

    async function translationLangs(token) {
        try {
            const live = await shallowKeys(socialDbUrl, 'kindlechat/translations_by_lang', token);
            if (live.length) return live;
        } catch (e) {
            warn('social-cleanup: could not read live translation languages; using fallback', {
                message: e.message
            });
        }
        return TRANSLATION_LANGS.slice();
    }

    async function cleanupChat() {
        if (!dryRun && !socialRtdb) throw new Error('social-cleanup: social RTDB is unavailable');
        const token = await getToken('social');
        const chatCutoff = cutoffMs(now, config.chatRetentionDays) - 1; // integer ms timestamps
        const keep = new Set(config.keepLatestChatMessages > 0
            ? await latestKeys(socialDbUrl, 'kindlechat/messages', 'timestamp', config.keepLatestChatMessages, token)
            : []);
        const langs = await translationLangs(token);

        let deleted = 0;
        let batches = 0;
        while (deleted < config.maxChatMessagesPerRun && Date.now() < deadline) {
            const ids = await shallowOldKeys(
                socialDbUrl,
                'kindlechat/messages',
                'timestamp',
                chatCutoff,
                config.chatBatchSize,
                token
            );
            if (ids.length === 0) break;

            const deletable = ids.filter(function (id) { return !keep.has(id); });
            // All old keys are in the keep set: the room is dormant and short.
            if (deletable.length === 0) break;

            if (!dryRun) {
                await rtdbMultiPathDelete(socialRtdb, buildChatDeletePaths(deletable, langs));
            }
            deleted += deletable.length;
            batches++;
            if (dryRun) break;
        }

        return {
            deleted,
            batches,
            languages: langs.length,
            truncated: deleted >= config.maxChatMessagesPerRun
        };
    }

    async function cleanupTopics() {
        const commentCutoff = new Date(cutoffMs(now, config.topicRetentionDays));
        const topicDocs = [];
        let last = null;

        while (topicDocs.length < config.maxTopicsPerRun && Date.now() < deadline) {
            let query = socialDb.collection('topics')
                .where('timestamp', '<', commentCutoff)
                .orderBy('timestamp', 'asc')
                .limit(config.firestorePageSize)
                .select('timestamp', 'lastActive', 'commentCount');
            if (last) query = query.startAfter(last);

            const page = await query.get();
            if (page.empty) break;
            topicDocs.push.apply(topicDocs, page.docs);
            last = page.docs[page.docs.length - 1];
            if (page.size < config.firestorePageSize) break;
        }

        let commentsDeleted = 0;
        let topicsDeleted = 0;
        let topicsRepaired = 0;
        let topicErrors = 0;
        let truncated = topicDocs.length >= config.maxTopicsPerRun;

        async function commentCountFor(topicRef) {
            const countSnap = await topicRef.collection('comments').count().get();
            return countSnap.data().count;
        }

        async function processTopic(topicDoc, commentBudget) {
            const data = topicDoc.data() || {};
            let deletedForTopic = 0;

            while (deletedForTopic < commentBudget && Date.now() < deadline) {
                const snapshot = await topicDoc.ref.collection('comments')
                    .where('timestamp', '<', commentCutoff)
                    .orderBy('timestamp', 'asc')
                    .limit(config.deleteBatchSize)
                    .select('timestamp')
                    .get();
                if (snapshot.empty) break;

                if (!dryRun) {
                    const batch = socialDb.batch();
                    snapshot.docs.forEach(function (doc) { batch.delete(doc.ref); });
                    await batch.commit();
                }
                deletedForTopic += snapshot.size;
                // Dry-run counts one batch per topic; no writes, no loops.
                if (dryRun || snapshot.size < config.deleteBatchSize) break;
            }

            if (dryRun) {
                return { commentsDeleted: deletedForTopic, topicDeleted: false, repaired: false };
            }

            const storedCount = Number(data.commentCount);

            if (deletedForTopic > 0) {
                let remaining = await commentCountFor(topicDoc.ref);

                if (remaining === 0) {
                    // Re-check immediately before the destructive step so a
                    // comment posted during the cleanup keeps the topic alive.
                    remaining = await commentCountFor(topicDoc.ref);
                    if (remaining === 0) {
                        await socialDb.recursiveDelete(topicDoc.ref);
                        return { commentsDeleted: deletedForTopic, topicDeleted: true, repaired: false };
                    }
                }

                const newestSnap = await topicDoc.ref.collection('comments')
                    .orderBy('timestamp', 'desc')
                    .limit(1)
                    .select('timestamp')
                    .get();
                const newest = newestSnap.empty ? null : newestSnap.docs[0].data().timestamp;

                await socialDb.runTransaction(async function (tx) {
                    const currentSnap = await tx.get(topicDoc.ref);
                    if (!currentSnap.exists) return;

                    const currentCount = Number(currentSnap.get('commentCount'));
                    const nextCount = Number.isFinite(currentCount) && currentCount >= deletedForTopic
                        ? Math.max(0, currentCount - deletedForTopic)
                        : remaining;

                    const updates = {};
                    if (!Number.isFinite(currentCount) || nextCount !== currentCount) {
                        updates.commentCount = nextCount;
                    }

                    const currentLastActive = toMillis(currentSnap.get('lastActive'));
                    const newestMs = toMillis(newest);
                    if (newestMs > currentLastActive) {
                        updates.lastActive = new Date(newestMs);
                    }

                    if (Object.keys(updates).length > 0) {
                        tx.update(topicDoc.ref, updates);
                    }
                });

                return { commentsDeleted: deletedForTopic, topicDeleted: false, repaired: true };
            }

            // Old topic with no old comments: remove it if it is genuinely
            // empty, otherwise repair a missing/drifted counter.
            if (!Number.isFinite(storedCount) || storedCount <= 0) {
                let remaining = await commentCountFor(topicDoc.ref);
                if (remaining === 0) {
                    remaining = await commentCountFor(topicDoc.ref);
                    if (remaining === 0) {
                        await socialDb.recursiveDelete(topicDoc.ref);
                        return { commentsDeleted: 0, topicDeleted: true, repaired: false };
                    }
                }
                if (!Number.isFinite(storedCount) || storedCount !== remaining) {
                    await topicDoc.ref.update({ commentCount: remaining });
                    return { commentsDeleted: 0, topicDeleted: false, repaired: true };
                }
            }

            return { commentsDeleted: 0, topicDeleted: false, repaired: false };
        }

        for (const topicDoc of topicDocs) {
            if (Date.now() >= deadline) {
                truncated = true;
                break;
            }
            if (commentsDeleted >= config.maxCommentDeletesPerRun) {
                truncated = true;
                break;
            }

            try {
                const result = await processTopic(topicDoc, config.maxCommentDeletesPerRun - commentsDeleted);
                commentsDeleted += result.commentsDeleted;
                if (result.topicDeleted) topicsDeleted++;
                if (result.repaired) topicsRepaired++;
                if (Date.now() >= deadline) {
                    truncated = true;
                    break;
                }
            } catch (e) {
                topicErrors++;
                warn('social-cleanup: topic task skipped', {
                    path: topicDoc.ref.path,
                    message: e.message
                });
            }
        }

        return {
            topicsScanned: topicDocs.length,
            commentsDeleted,
            topicsDeleted,
            topicsRepaired,
            topicErrors,
            truncated: truncated || commentsDeleted >= config.maxCommentDeletesPerRun
        };
    }

    async function cleanupNeighbourhood() {
        const cutoff = new Date(cutoffMs(now, config.neighbourhoodRetentionDays));
        const snapshot = await socialDb.collection('neighbourhood_posts')
            .where('timestamp', '<', cutoff)
            .orderBy('timestamp', 'asc')
            .limit(config.maxPostDeletesPerRun)
            .select('timestamp')
            .get();

        const docs = snapshot.docs;
        const truncated = docs.length >= config.maxPostDeletesPerRun;

        if (dryRun) {
            return { postsDeleted: docs.length, errors: 0, truncated };
        }

        let postsDeleted = 0;
        let errors = 0;
        let timeTruncated = false;

        await mapWithConcurrency(docs, 4, async function (doc) {
            if (Date.now() >= deadline) {
                timeTruncated = true;
                return;
            }
            try {
                await socialDb.recursiveDelete(doc.ref);
                postsDeleted++;
            } catch (e) {
                errors++;
                warn('social-cleanup: post delete failed', {
                    path: doc.ref.path,
                    message: e.message
                });
            }
        });

        return { postsDeleted, errors, truncated: truncated || timeTruncated };
    }

    async function cleanupReports() {
        if (!dryRun && !socialRtdb) throw new Error('social-cleanup: social RTDB is unavailable');
        const token = await getToken('social');
        const reportCutoff = cutoffMs(now, config.reportRetentionDays) - 1;

        let deleted = 0;
        let pendingSkipped = 0;
        let batches = 0;

        while (deleted < config.maxReportDeletesPerRun && batches < 10 && Date.now() < deadline) {
            const data = await rtdbFetch(socialDbUrl, 'reports', {
                orderBy: '"createdAt"',
                startAt: '0',
                endAt: String(reportCutoff),
                limitToFirst: '500'
            }, token);

            if (!data || typeof data !== 'object') break;
            const keys = Object.keys(data);
            if (keys.length === 0) break;

            const deletable = keys.filter(function (id) {
                return isSafeRtdbKey(id) && shouldDeleteReport(data[id], now, config.reportRetentionDays);
            });
            pendingSkipped += keys.length - deletable.length;

            // The oldest page is all pending reports: stop rather than re-read
            // it every day. They stay until a moderator resolves them.
            if (deletable.length === 0) break;

            const updates = {};
            deletable.forEach(function (id) { updates[`reports/${id}`] = null; });
            if (!dryRun) await rtdbMultiPathDelete(socialRtdb, updates);

            deleted += deletable.length;
            batches++;
            if (dryRun || keys.length < 500) break;
        }

        return {
            deleted,
            pendingSkipped,
            batches,
            truncated: deleted >= config.maxReportDeletesPerRun
        };
    }

    async function cleanupAutomod() {
        if (!dryRun && !socialRtdb) throw new Error('social-cleanup: social RTDB is unavailable');
        const token = await getToken('social');
        const cutoff = cutoffMs(now, config.automodRetentionDays) - 1;

        let deleted = 0;
        let batches = 0;

        while (deleted < config.maxAutomodDeletesPerRun && Date.now() < deadline) {
            const ids = await shallowOldKeys(
                socialDbUrl,
                'automod_log',
                'timestamp',
                cutoff,
                500,
                token
            );
            if (ids.length === 0) break;

            const updates = {};
            ids.forEach(function (id) { updates[`automod_log/${id}`] = null; });
            if (!dryRun) await rtdbMultiPathDelete(socialRtdb, updates);

            deleted += ids.length;
            batches++;
            if (dryRun) break;
        }

        return {
            deleted,
            batches,
            truncated: deleted >= config.maxAutomodDeletesPerRun
        };
    }

    async function cleanupModActions() {
        if (!dryRun && !primaryRtdb) throw new Error('social-cleanup: primary RTDB is unavailable');
        const token = await getToken('primary');
        const cutoff = cutoffMs(now, config.modActionsRetentionDays) - 1;

        let deleted = 0;
        let batches = 0;

        while (deleted < config.maxModActionDeletesPerRun && Date.now() < deadline) {
            const ids = await shallowOldKeys(
                primaryDbUrl,
                'mod_actions',
                'createdAt',
                cutoff,
                500,
                token
            );
            if (ids.length === 0) break;

            const updates = {};
            ids.forEach(function (id) { updates[`mod_actions/${id}`] = null; });
            if (!dryRun) await rtdbMultiPathDelete(primaryRtdb, updates);

            deleted += ids.length;
            batches++;
            if (dryRun) break;
        }

        return {
            deleted,
            batches,
            truncated: deleted >= config.maxModActionDeletesPerRun
        };
    }

    async function runTask(name, fn) {
        if (Date.now() >= deadline) {
            summary.tasks[name] = { skipped: 'time_budget' };
            return;
        }

        const taskStarted = Date.now();
        try {
            const result = await fn();
            summary.tasks[name] = Object.assign({}, result, { elapsedMs: Date.now() - taskStarted });
            info(`social-cleanup: ${name}`, summary.tasks[name]);
        } catch (e) {
            const message = e && e.message ? e.message : String(e);
            summary.tasks[name] = { error: message, elapsedMs: Date.now() - taskStarted };
            summary.errors.push({ task: name, message });
            if (typeof logger.error === 'function') {
                logger.error(`social-cleanup: ${name} failed`, { message });
            } else {
                warn(`social-cleanup: ${name} failed`, { message });
            }
        }
    }

    info('social-cleanup: starting', {
        dryRun,
        cutoffs: summary.cutoffs,
        timeBudgetMs: config.timeBudgetMs
    });

    await runTask('chat', cleanupChat);
    await runTask('topics', cleanupTopics);
    await runTask('neighbourhood', cleanupNeighbourhood);
    await runTask('reports', cleanupReports);
    await runTask('automod', cleanupAutomod);
    await runTask('modActions', cleanupModActions);

    summary.elapsedMs = Date.now() - startedAt;
    info('social-cleanup: finished', {
        dryRun,
        elapsedMs: summary.elapsedMs,
        errors: summary.errors.length,
        tasks: summary.tasks
    });

    return summary;
}

module.exports = {
    CLEANUP_CONFIG,
    runSocialCleanup,
    SOCIAL_DB_URL,
    PRIMARY_DB_URL
};
