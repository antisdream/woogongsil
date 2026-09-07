'use strict';

const cryptoModule = require('crypto');
const {
    VisitorAnalyticsInputError,
    validateClientId,
    isAutomatedVisitRequest,
    getKstDateKey,
    getKstDateTime,
    buildPeriodDefinition,
    addDays,
} = require('./visitorAnalyticsService');
const {
    createVisitorAnalyticsSchema,
    LOGIN_HISTORY_BACKFILL_START,
} = require('./visitorAnalyticsSchema');

const TIMEZONE = 'Asia/Seoul';
const DEFAULT_INACTIVITY_SECONDS = 5 * 60;
const MIN_INACTIVITY_SECONDS = 60;
const MAX_INACTIVITY_SECONDS = 60 * 60;
const AUTH_LINK_THROTTLE_MS = 45 * 1000;
const AUTH_LINK_CACHE_MAX = 10_000;
const SESSION_TABLE = 'wgs_visit_sessions';
const LOGIN_EVENT_TABLE = 'wgs_visit_login_events';
const LOCAL_FALLBACK_SECRET = cryptoModule.randomBytes(32).toString('hex');
const VALID_TYPES = new Set(['anonymous', 'member']);
const VALID_STATUSES = new Set(['all', 'active', 'ended']);

function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function resolveDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new VisitorAnalyticsInputError('A valid date is required.', 'invalid_date');
    }
    return date;
}

function normalizeDateTime(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.replace('T', ' ').slice(0, 23);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return getKstDateTime(value);
    return String(value).replace('T', ' ').slice(0, 23);
}

function sanitizeEntryPath(value) {
    const text = String(value || '').trim();
    if (!text.startsWith('/')) return null;
    const clean = text.split(/[?#]/, 1)[0].replace(/[\u0000-\u001f\u007f]/g, '');
    return clean ? clean.slice(0, 512) : null;
}

function parseCsv(value, { maxItems = 100, maxLength = 191 } = {}) {
    const rawValues = Array.isArray(value) ? value : String(value || '').split(',');
    const values = [];
    for (const item of rawValues) {
        const normalized = String(item || '').trim();
        if (!normalized || values.includes(normalized)) continue;
        if (normalized.length > maxLength) {
            throw new VisitorAnalyticsInputError('A filter value is too long.', 'invalid_filter');
        }
        values.push(normalized);
        if (values.length > maxItems) {
            throw new VisitorAnalyticsInputError('Too many filter values.', 'invalid_filter');
        }
    }
    return values;
}

function normalizeTypes(value) {
    const values = parseCsv(value || 'anonymous,member', { maxItems: 2, maxLength: 16 })
        .map((item) => item.toLowerCase());
    if (values.length === 0 || values.some((item) => !VALID_TYPES.has(item))) {
        throw new VisitorAnalyticsInputError(
            'types must contain anonymous and/or member.',
            'invalid_types'
        );
    }
    return values;
}

function normalizeFilters(input = {}) {
    const status = String(input.status || 'all').trim().toLowerCase();
    if (!VALID_STATUSES.has(status)) {
        throw new VisitorAnalyticsInputError('status must be all, active, or ended.', 'invalid_status');
    }
    return {
        types: normalizeTypes(input.types),
        memberIds: parseCsv(input.memberIds),
        status,
    };
}

function createVisitSessionService(options = {}) {
    const pool = options.pool;
    const env = options.env || process.env;
    const crypto = options.crypto || cryptoModule;
    const clock = options.clock || (() => new Date());
    const schema = options.schema || createVisitorAnalyticsSchema({ pool });
    const ensureSchema = options.ensureSchema || schema.ensureVisitorAnalyticsSchema;

    if (!pool || typeof pool.query !== 'function') {
        throw new Error('createVisitSessionService requires a MySQL pool.');
    }
    if (typeof clock !== 'function') {
        throw new Error('createVisitSessionService requires clock to be a function.');
    }

    const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const configuredSecret = String(env.VISITOR_HASH_SECRET || '').trim();
    if (isProduction && configuredSecret.length < 32) {
        throw new Error('VISITOR_HASH_SECRET must contain at least 32 characters in production.');
    }
    const hashSecret = configuredSecret || LOCAL_FALLBACK_SECRET;
    const configuredInactivity = Number(env.VISITOR_SESSION_INACTIVITY_SECONDS);
    const inactivitySeconds = Number.isFinite(configuredInactivity)
        ? Math.min(Math.max(Math.round(configuredInactivity), MIN_INACTIVITY_SECONDS), MAX_INACTIVITY_SECONDS)
        : DEFAULT_INACTIVITY_SECONDS;
    const authenticatedLinkCache = new Map();

    function nowDate(override) {
        return resolveDate(override === undefined ? clock() : override);
    }

    function hashClientId(clientId) {
        return crypto.createHmac('sha256', hashSecret).update(clientId, 'utf8').digest('hex');
    }

    function thresholdDate(current) {
        return new Date(current.getTime() - (inactivitySeconds * 1000));
    }

    function requestEntryPath(request, fallback = null) {
        return sanitizeEntryPath(
            request?.body?.entryPath
            || request?.body?.path
            || request?.headers?.['x-wgs-entry-path']
            || fallback
        );
    }

    async function withTransaction(work) {
        if (typeof pool.getConnection !== 'function') return work(pool);
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const result = await work(connection);
            await connection.commit();
            return result;
        } catch (error) {
            try {
                await connection.rollback();
            } catch (_) {
                // Preserve the original transactional failure.
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    function readAuthenticatedLinkCache(key, current) {
        const cached = authenticatedLinkCache.get(key);
        const cachedAt = Number(cached?.cachedAt);
        if (!Number.isFinite(cachedAt)) return null;
        if (current.getTime() - cachedAt >= AUTH_LINK_THROTTLE_MS) {
            authenticatedLinkCache.delete(key);
            return null;
        }
        return cached;
    }

    function rememberAuthenticatedLink(key, current, result = {}) {
        if (authenticatedLinkCache.size >= AUTH_LINK_CACHE_MAX) {
            const oldestKey = authenticatedLinkCache.keys().next().value;
            if (oldestKey !== undefined) authenticatedLinkCache.delete(oldestKey);
        }
        authenticatedLinkCache.delete(key);
        authenticatedLinkCache.set(key, {
            cachedAt: current.getTime(),
            linked: result.linked !== false,
            reason: result.reason || null,
        });
    }

    function invalidateAuthenticatedLinkCache(visitorHash) {
        const prefix = `${visitorHash}:`;
        for (const key of authenticatedLinkCache.keys()) {
            if (key.startsWith(prefix)) authenticatedLinkCache.delete(key);
        }
    }

    async function closeStaleSession(visitorHash, current, database = pool) {
        const threshold = getKstDateTime(thresholdDate(current));
        await database.query(
            `/* visit-session:close-stale */
             UPDATE ${SESSION_TABLE}
                SET active_key = NULL,
                    ended_at = COALESCE(ended_at, last_seen_at)
              WHERE active_key = ?
                AND last_seen_at < ?`,
            [visitorHash, threshold]
        );
    }

    async function getActiveSession(visitorHash, database = pool, { forUpdate = false } = {}) {
        const [rows] = await database.query(
            `/* visit-session:get-active */
             SELECT id, visitor_type, member_user_id, started_at, last_seen_at,
                    entry_path, source, source_ref, is_excluded
               FROM ${SESSION_TABLE}
              WHERE active_key = ?
              LIMIT 1${forUpdate ? '\n              FOR UPDATE' : ''}`,
            [visitorHash]
        );
        return rows?.[0] || null;
    }

    async function touchActiveSession(visitorHash, current, database = pool) {
        const seenAt = getKstDateTime(current);
        const threshold = getKstDateTime(thresholdDate(current));
        const [result] = await database.query(
            `/* visit-session:touch-active */
             UPDATE ${SESSION_TABLE}
                SET last_seen_at = GREATEST(last_seen_at, ?),
                    request_count = request_count + 1
              WHERE active_key = ?
                AND is_excluded = 0
                AND last_seen_at >= ?`,
            [seenAt, visitorHash, threshold]
        );
        return numeric(result?.affectedRows) > 0;
    }

    async function insertSession({
        visitorHash,
        visitorType,
        memberUserId = null,
        current,
        entryPath = null,
        source = 'live',
        sourceRef = null,
        active = true,
    }, database = pool) {
        const seenAt = getKstDateTime(current);
        const [result] = await database.query(
            `/* visit-session:insert */
             INSERT INTO ${SESSION_TABLE}
                 (visitor_hash, active_key, visitor_type, member_user_id,
                  started_at, last_seen_at, ended_at, entry_path, request_count,
                  source, source_ref, is_excluded)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`,
            [
                visitorHash,
                active ? visitorHash : null,
                visitorType,
                memberUserId,
                seenAt,
                seenAt,
                active ? null : seenAt,
                entryPath,
                source,
                sourceRef,
            ]
        );
        return {
            id: result?.insertId,
            visitor_type: visitorType,
            member_user_id: memberUserId,
            started_at: seenAt,
            last_seen_at: seenAt,
            entry_path: entryPath,
            source,
            source_ref: sourceRef,
            is_excluded: 0,
        };
    }

    function publicSessionPayload(row) {
        if (!row) return null;
        return {
            visitorType: row.visitor_type === 'member' ? 'member' : 'anonymous',
            startedAt: normalizeDateTime(row.started_at),
            lastSeenAt: normalizeDateTime(row.last_seen_at),
            idleTimeoutSeconds: inactivitySeconds,
        };
    }

    async function getPublicSummary({ now } = {}) {
        await ensureSchema();
        const current = nowDate(now);
        const today = getKstDateKey(current);
        const [rows] = await pool.query(
            `/* visit-session:public-summary */
             SELECT COUNT(*) AS total_count,
                    COALESCE(SUM(CASE WHEN DATE(started_at) = ? THEN 1 ELSE 0 END), 0) AS today_count,
                    DATE_FORMAT(MIN(started_at), '%Y-%m-%d') AS started_at
               FROM ${SESSION_TABLE}
              WHERE is_excluded = 0`,
            [today]
        );
        const row = rows?.[0] || {};
        return {
            todayCount: numeric(row.today_count),
            totalCount: numeric(row.total_count),
            timezone: TIMEZONE,
            startedAt: row.started_at ? String(row.started_at).slice(0, 10) : null,
        };
    }

    async function recordVisit({ clientId, request, now } = {}) {
        const validClientId = validateClientId(clientId);
        if (!validClientId) {
            throw new VisitorAnalyticsInputError('A valid WGS client ID is required.', 'invalid_client_id');
        }
        const current = nowDate(now);
        await ensureSchema();
        if (isAutomatedVisitRequest(request)) {
            return {
                counted: false,
                ignored: true,
                reason: 'automated_request',
                ...(await getPublicSummary({ now: current })),
                session: null,
            };
        }

        const visitorHash = hashClientId(validClientId);
        await closeStaleSession(visitorHash, current);
        let counted = false;
        let session;
        if (await touchActiveSession(visitorHash, current)) {
            session = await getActiveSession(visitorHash);
        } else {
            try {
                session = await insertSession({
                    visitorHash,
                    visitorType: 'anonymous',
                    current,
                    entryPath: requestEntryPath(request),
                });
                counted = true;
            } catch (error) {
                if (error?.code !== 'ER_DUP_ENTRY') throw error;
                await touchActiveSession(visitorHash, current);
                session = await getActiveSession(visitorHash);
            }
        }
        invalidateAuthenticatedLinkCache(visitorHash);
        return {
            counted,
            ignored: false,
            reason: counted ? null : 'active_session',
            ...(await getPublicSummary({ now: current })),
            session: publicSessionPayload(session),
        };
    }

    async function findLoginEvent(sourceRef, database = pool) {
        if (!sourceRef) return null;
        const [rows] = await database.query(
            `/* visit-session:get-login-event */
             SELECT e.id AS event_id, e.session_id, e.login_at,
                     s.id, s.visitor_type, s.member_user_id, s.started_at,
                     s.last_seen_at, s.entry_path, s.source, s.source_ref,
                     s.is_excluded,
                     (SELECT COUNT(*)
                        FROM ${LOGIN_EVENT_TABLE} session_events
                       WHERE session_events.session_id = s.id
                         AND session_events.is_excluded = 0) AS session_event_count
               FROM ${LOGIN_EVENT_TABLE} e
               JOIN ${SESSION_TABLE} s ON s.id = e.session_id
              WHERE e.source = 'login_history'
                AND e.source_ref = ?
              LIMIT 1`,
            [sourceRef]
        );
        return rows?.[0] || null;
    }

    async function closeActiveSession(visitorHash, current, database = pool) {
        const seenAt = getKstDateTime(current);
        await database.query(
            `/* visit-session:close-active */
             UPDATE ${SESSION_TABLE}
                SET active_key = NULL,
                    ended_at = COALESCE(ended_at, ?),
                    last_seen_at = GREATEST(last_seen_at, ?)
              WHERE active_key = ?`,
            [seenAt, seenAt, visitorHash]
        );
    }

    async function convertAnonymousSession(row, memberUserId, current, database = pool) {
        const seenAt = getKstDateTime(current);
        const [result] = await database.query(
            `/* visit-session:convert-anonymous */
             UPDATE ${SESSION_TABLE}
                SET visitor_type = 'member',
                    member_user_id = ?,
                    last_seen_at = GREATEST(last_seen_at, ?),
                    request_count = request_count + 1
              WHERE id = ?
                AND visitor_type = 'anonymous'
                AND is_excluded = 0`,
            [memberUserId, seenAt, row.id]
        );
        if (numeric(result?.affectedRows) !== 1) {
            const error = new Error('Anonymous visit session changed during member linkage.');
            error.code = 'VISIT_SESSION_TRANSITION_CONFLICT';
            throw error;
        }
        return {
            ...row,
            visitor_type: 'member',
            member_user_id: memberUserId,
            last_seen_at: seenAt,
        };
    }

    async function adoptBackfilledSession(
        row,
        visitorHash,
        memberUserId,
        current,
        entryPath,
        database = pool,
    ) {
        const seenAt = getKstDateTime(current);
        const [result] = await database.query(
            `/* visit-session:adopt-backfilled */
             UPDATE ${SESSION_TABLE}
                SET visitor_hash = ?, active_key = ?, visitor_type = 'member',
                    member_user_id = ?, started_at = ?, last_seen_at = ?, ended_at = NULL,
                    entry_path = COALESCE(entry_path, ?), is_excluded = 0
              WHERE id = ?`,
            [visitorHash, visitorHash, memberUserId, seenAt, seenAt, entryPath, row.id]
        );
        if (numeric(result?.affectedRows) !== 1) {
            const error = new Error('Historical visit session changed during live adoption.');
            error.code = 'VISIT_SESSION_TRANSITION_CONFLICT';
            throw error;
        }
        return {
            ...row,
            visitor_type: 'member',
            member_user_id: memberUserId,
            started_at: seenAt,
            last_seen_at: seenAt,
            entry_path: row.entry_path || entryPath,
            is_excluded: 0,
        };
    }

    async function upsertLoginEvent(
        { sessionId, memberUserId, current, sourceRef },
        database = pool,
    ) {
        const loginAt = getKstDateTime(current);
        if (sourceRef) {
            await database.query(
                `/* visit-session:upsert-login-event */
                 INSERT INTO ${LOGIN_EVENT_TABLE}
                     (session_id, member_user_id, login_at, source, source_ref, is_excluded)
                 VALUES (?, ?, ?, 'login_history', ?, 0)
                 ON DUPLICATE KEY UPDATE
                     session_id = VALUES(session_id),
                     member_user_id = VALUES(member_user_id),
                     login_at = VALUES(login_at),
                     is_excluded = 0`,
                [sessionId, memberUserId, loginAt, sourceRef]
            );
            return;
        }
        await database.query(
            `/* visit-session:insert-login-event */
             INSERT INTO ${LOGIN_EVENT_TABLE}
                 (session_id, member_user_id, login_at, source, source_ref, is_excluded)
             VALUES (?, ?, ?, 'live', NULL, 0)`,
            [sessionId, memberUserId, loginAt]
        );
    }

    async function recordSuccessfulLogin({
        clientId,
        memberUserId,
        historyId,
        isExcluded = false,
        request,
        now,
    } = {}) {
        const memberId = String(memberUserId || '').trim();
        if (!memberId) {
            throw new VisitorAnalyticsInputError('memberUserId is required.', 'invalid_member_id');
        }
        const current = nowDate(now);
        await ensureSchema();
        const sourceRef = historyId === undefined || historyId === null || historyId === ''
            ? null
            : String(historyId);
        const validClientId = validateClientId(clientId);

        const visitorHash = validClientId
            ? hashClientId(validClientId)
            : hashClientId(`login-history:${sourceRef || `${memberId}:${current.getTime()}`}`);
        const entryPath = requestEntryPath(request, '/login');
        const result = await withTransaction(async (database) => {
            if (isExcluded) {
                const seenAt = getKstDateTime(current);
                if (validClientId) {
                    await database.query(
                        `/* visit-session:exclude-login-client */
                         UPDATE ${SESSION_TABLE} s
                         LEFT JOIN ${LOGIN_EVENT_TABLE} e ON e.session_id = s.id
                            SET s.is_excluded = 1, s.active_key = NULL,
                                s.ended_at = COALESCE(s.ended_at, ?),
                                s.last_seen_at = GREATEST(s.last_seen_at, ?),
                                e.is_excluded = 1
                          WHERE s.active_key = ?`,
                        [seenAt, seenAt, visitorHash]
                    );
                }
                if (sourceRef) {
                    await database.query(
                        `/* visit-session:exclude-login-source */
                         UPDATE ${SESSION_TABLE} s
                         JOIN ${LOGIN_EVENT_TABLE} e ON e.session_id = s.id
                            SET s.is_excluded = 1, s.active_key = NULL,
                                s.ended_at = COALESCE(s.ended_at, s.last_seen_at),
                                e.is_excluded = 1
                          WHERE e.source = 'login_history' AND e.source_ref = ?`,
                        [sourceRef]
                    );
                }
                return { counted: false, ignored: true, reason: 'admin_excluded', session: null };
            }

            await closeStaleSession(visitorHash, current, database);
            const existingEvent = await findLoginEvent(sourceRef, database);
            let active = validClientId
                ? await getActiveSession(visitorHash, database, { forUpdate: true })
                : null;
            let session;
            let counted = true;
            let reason = null;
            let mergedHistoricalSessionId = null;

            if (active?.visitor_type === 'anonymous') {
                session = await convertAnonymousSession(active, memberId, current, database);
                counted = false;
                reason = 'anonymous_session_converted';
                if (existingEvent && String(existingEvent.id) !== String(session.id)) {
                    mergedHistoricalSessionId = existingEvent.id;
                }
            } else if (
                active?.visitor_type === 'member'
                && String(active.member_user_id) === memberId
            ) {
                await touchActiveSession(visitorHash, current, database);
                session = await getActiveSession(visitorHash, database, { forUpdate: true });
                counted = false;
                reason = 'same_member_session';
                if (existingEvent && String(existingEvent.id) !== String(session.id)) {
                    mergedHistoricalSessionId = existingEvent.id;
                }
            } else {
                if (active) await closeActiveSession(visitorHash, current, database);
                const canAdoptHistoricalSession = existingEvent
                    && numeric(existingEvent.session_event_count) <= 1;
                if (canAdoptHistoricalSession) {
                    session = await adoptBackfilledSession(
                        existingEvent,
                        visitorHash,
                        memberId,
                        current,
                        entryPath,
                        database,
                    );
                } else {
                    try {
                        session = await insertSession({
                            visitorHash,
                            visitorType: 'member',
                            memberUserId: memberId,
                            current,
                            entryPath,
                            source: existingEvent ? 'live_login' : (sourceRef ? 'login_history' : 'live_login'),
                            sourceRef: existingEvent ? null : sourceRef,
                        }, database);
                        if (existingEvent) mergedHistoricalSessionId = existingEvent.id;
                    } catch (error) {
                        if (error?.code !== 'ER_DUP_ENTRY') throw error;
                        // A heartbeat can win the active-key race between the lookup
                        // and insert. Reuse that session so the login event is not lost.
                        active = await getActiveSession(visitorHash, database, { forUpdate: true });
                        if (active?.visitor_type === 'anonymous') {
                            session = await convertAnonymousSession(
                                active,
                                memberId,
                                current,
                                database,
                            );
                            counted = false;
                            reason = 'anonymous_session_converted';
                        } else if (
                            active?.visitor_type === 'member'
                            && String(active.member_user_id) === memberId
                        ) {
                            await touchActiveSession(visitorHash, current, database);
                            session = await getActiveSession(
                                visitorHash,
                                database,
                                { forUpdate: true },
                            );
                            counted = false;
                            reason = 'same_member_session';
                        } else {
                            throw error;
                        }
                    }
                }
            }

            await upsertLoginEvent({
                sessionId: session.id,
                memberUserId: memberId,
                current,
                sourceRef,
            }, database);
            if (mergedHistoricalSessionId) {
                await database.query(
                    `/* visit-session:exclude-empty-merged-history-session */
                     UPDATE ${SESSION_TABLE} s
                        SET s.is_excluded = 1,
                            s.active_key = NULL,
                            s.ended_at = COALESCE(s.ended_at, s.last_seen_at)
                      WHERE s.id = ?
                        AND NOT EXISTS (
                            SELECT 1 FROM ${LOGIN_EVENT_TABLE} e
                             WHERE e.session_id = s.id AND e.is_excluded = 0
                        )`,
                    [mergedHistoricalSessionId]
                );
            }
            return {
                counted,
                ignored: false,
                reason,
                session: publicSessionPayload(session),
            };
        });
        if (validClientId) invalidateAuthenticatedLinkCache(visitorHash);
        return result;
    }

    async function linkAuthenticatedSession({
        clientId,
        memberUserId,
        isExcluded = false,
        request,
        now,
    } = {}) {
        const validClientId = validateClientId(clientId);
        const memberId = String(memberUserId || '').trim();
        if (!validClientId || !memberId) return { linked: false, reason: 'identity_unavailable' };
        const current = nowDate(now);
        await ensureSchema();
        const visitorHash = hashClientId(validClientId);
        const cacheKey = `${visitorHash}:${isExcluded ? 'excluded' : memberId}`;
        const cached = readAuthenticatedLinkCache(cacheKey, current);
        if (cached) {
            const preservesFailure = ['active_member_conflict', 'no_active_visit'].includes(cached.reason);
            return {
                linked: isExcluded ? false : (preservesFailure ? false : cached.linked),
                counted: false,
                reason: isExcluded
                    ? 'admin_excluded'
                    : (preservesFailure ? cached.reason : 'link_throttled'),
                throttled: true,
            };
        }
        if (isExcluded) {
            await excludeClientSession({ clientId: validClientId, now: current });
            const result = { linked: false, counted: false, reason: 'admin_excluded' };
            rememberAuthenticatedLink(cacheKey, current, result);
            return result;
        }

        const result = await withTransaction(async (database) => {
            await closeStaleSession(visitorHash, current, database);
            const active = await getActiveSession(visitorHash, database, { forUpdate: true });
            if (active?.visitor_type === 'anonymous') {
                const session = await convertAnonymousSession(
                    active,
                    memberId,
                    current,
                    database,
                );
                return { linked: true, counted: false, session: publicSessionPayload(session) };
            }
            if (active?.visitor_type === 'member' && String(active.member_user_id) === memberId) {
                return {
                    linked: true,
                    counted: false,
                    reason: 'same_member_session',
                    session: publicSessionPayload(active),
                };
            }
            if (active) {
                // A successful /api/login request is the only authority allowed to
                // switch one browser visit to a different account. Competing valid
                // tabs may both poll /api/check-session, but those polls must not
                // close and recreate public visit sessions every throttle window.
                return {
                    linked: false,
                    counted: false,
                    reason: 'active_member_conflict',
                    session: publicSessionPayload(active),
                };
            }
            // A session-validation poll proves authentication, not an active page visit.
            // Only the visibility-aware public heartbeat may create a new visit session.
            return { linked: false, counted: false, reason: 'no_active_visit' };
        });
        rememberAuthenticatedLink(cacheKey, current, result);
        return result;
    }

    async function excludeClientSession({ clientId, now } = {}) {
        const validClientId = validateClientId(clientId);
        if (!validClientId) return { excluded: false };
        const current = nowDate(now);
        await ensureSchema();
        const visitorHash = hashClientId(validClientId);
        const seenAt = getKstDateTime(current);
        const [result] = await pool.query(
            `/* visit-session:exclude-client */
             UPDATE ${SESSION_TABLE} s
             LEFT JOIN ${LOGIN_EVENT_TABLE} e ON e.session_id = s.id
                SET s.is_excluded = 1,
                    s.active_key = NULL,
                    s.ended_at = COALESCE(s.ended_at, ?),
                    s.last_seen_at = GREATEST(s.last_seen_at, ?),
                    e.is_excluded = 1
              WHERE s.active_key = ?`,
            [seenAt, seenAt, visitorHash]
        );
        return { excluded: numeric(result?.affectedRows) > 0 };
    }

    async function endAuthenticatedSession({ clientId, memberUserId, now } = {}) {
        const validClientId = validateClientId(clientId);
        const memberId = String(memberUserId || '').trim();
        if (!validClientId || !memberId) return { ended: false };
        const current = nowDate(now);
        await ensureSchema();
        const visitorHash = hashClientId(validClientId);
        const seenAt = getKstDateTime(current);
        const [result] = await pool.query(
            `/* visit-session:end-member */
             UPDATE ${SESSION_TABLE}
                SET active_key = NULL,
                    ended_at = COALESCE(ended_at, ?),
                    last_seen_at = GREATEST(last_seen_at, ?)
              WHERE active_key = ?
                AND visitor_type = 'member'
                AND member_user_id = ?`,
            [seenAt, seenAt, visitorHash, memberId]
        );
        return { ended: numeric(result?.affectedRows) > 0 };
    }

    function typeMemberWhere(filters, alias = 's') {
        const clauses = [`${alias}.is_excluded = 0`];
        const params = [];
        clauses.push(`${alias}.visitor_type IN (${filters.types.map(() => '?').join(', ')})`);
        params.push(...filters.types);
        if (filters.memberIds.length > 0) {
            clauses.push(`${alias}.member_user_id IN (${filters.memberIds.map(() => '?').join(', ')})`);
            params.push(...filters.memberIds);
        }
        return { clauses, params };
    }

    function appendStatusWhere(base, status, current, alias = 's') {
        if (status !== 'all') {
            const threshold = getKstDateTime(thresholdDate(current));
            const activeExpression = `(${alias}.active_key IS NOT NULL AND ${alias}.last_seen_at >= ?)`;
            base.clauses.push(status === 'active' ? activeExpression : `NOT ${activeExpression}`);
            base.params.push(threshold);
        }
        return base;
    }

    function rangeWhere(definition, filters, { alias = 's', status = 'all', current } = {}) {
        const base = typeMemberWhere(filters, alias);
        base.clauses.push(`${alias}.started_at >= ?`, `${alias}.started_at < ?`);
        base.params.push(`${definition.start} 00:00:00.000`, `${definition.endExclusive} 00:00:00.000`);
        return appendStatusWhere(base, status, current, alias);
    }

    async function querySeries(definition, filters, current) {
        const where = rangeWhere(definition, filters, {
            status: filters.status,
            current,
        });
        let bucketExpression;
        if (definition.bucketType === 'hour') bucketExpression = 'HOUR(s.started_at)';
        else if (definition.bucketType === 'month') bucketExpression = "DATE_FORMAT(s.started_at, '%Y-%m')";
        else bucketExpression = "DATE_FORMAT(s.started_at, '%Y-%m-%d')";
        const [rows] = await pool.query(
            `/* visit-session:series */
             SELECT ${bucketExpression} AS bucket_key, COUNT(*) AS session_count
               FROM ${SESSION_TABLE} s
              WHERE ${where.clauses.join(' AND ')}
              GROUP BY ${bucketExpression}
              ORDER BY bucket_key`,
            where.params
        );
        const counts = new Map();
        for (const row of rows || []) {
            const raw = row.bucket_key;
            const key = definition.bucketType === 'hour'
                ? `${definition.start}T${String(Number(raw)).padStart(2, '0')}`
                : String(raw || '').slice(0, definition.bucketType === 'month' ? 7 : 10);
            counts.set(key, numeric(row.session_count));
        }
        return definition.buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            count: counts.get(bucket.key) || 0,
        }));
    }

    async function getAdminStats({ period = 'day', anchor, types, memberIds, status = 'all', now } = {}) {
        await ensureSchema();
        const current = nowDate(now);
        const today = getKstDateKey(current);
        const normalizedPeriod = String(period || 'day').trim().toLowerCase();
        const definition = buildPeriodDefinition(normalizedPeriod, anchor || today);
        const filters = normalizeFilters({ types, memberIds, status });
        const previousAnchor = normalizedPeriod === 'day'
            ? addDays(definition.start, -1)
            : addDays(definition.start, -1);
        const previousDefinition = buildPeriodDefinition(normalizedPeriod, previousAnchor);
        const weekStart = buildPeriodDefinition('week', today).start;
        const monthStart = buildPeriodDefinition('month', today).start;
        const yearStart = buildPeriodDefinition('year', today).start;
        const yesterday = addDays(today, -1);
        const tomorrow = addDays(today, 1);
        const base = appendStatusWhere(typeMemberWhere(filters), filters.status, current);

        const [summaryResult, series, previousSeries] = await Promise.all([
            pool.query(
                `/* visit-session:admin-summary */
                 SELECT COUNT(*) AS total_count,
                        COALESCE(SUM(CASE WHEN DATE(s.started_at) = ? THEN 1 ELSE 0 END), 0) AS today_count,
                        COALESCE(SUM(CASE WHEN DATE(s.started_at) = ? THEN 1 ELSE 0 END), 0) AS yesterday_count,
                        COALESCE(SUM(CASE WHEN s.started_at >= ? AND s.started_at < ? THEN 1 ELSE 0 END), 0) AS week_count,
                        COALESCE(SUM(CASE WHEN s.started_at >= ? AND s.started_at < ? THEN 1 ELSE 0 END), 0) AS month_count,
                        COALESCE(SUM(CASE WHEN s.started_at >= ? AND s.started_at < ? THEN 1 ELSE 0 END), 0) AS year_count,
                        DATE_FORMAT(MIN(s.started_at), '%Y-%m-%d') AS started_at
                   FROM ${SESSION_TABLE} s
                  WHERE ${base.clauses.join(' AND ')}`,
                [
                    today,
                    yesterday,
                    `${weekStart} 00:00:00.000`, `${tomorrow} 00:00:00.000`,
                    `${monthStart} 00:00:00.000`, `${tomorrow} 00:00:00.000`,
                    `${yearStart} 00:00:00.000`, `${tomorrow} 00:00:00.000`,
                    ...base.params,
                ]
            ),
            querySeries(definition, filters, current),
            querySeries(previousDefinition, filters, current),
        ]);
        const periodWhere = rangeWhere(definition, filters, {
            status: filters.status,
            current,
        });
        const [breakdownRows] = await pool.query(
            `/* visit-session:breakdown */
             SELECT s.visitor_type,
                    COUNT(*) AS session_count,
                    COUNT(DISTINCT CASE
                        WHEN s.visitor_type = 'member' THEN s.member_user_id
                        ELSE NULL
                    END) AS unique_member_count
               FROM ${SESSION_TABLE} s
              WHERE ${periodWhere.clauses.join(' AND ')}
              GROUP BY s.visitor_type`,
            periodWhere.params
        );
        const loginWhere = appendStatusWhere(typeMemberWhere(filters), filters.status, current);
        const [loginRows] = await pool.query(
            `/* visit-session:login-count */
             SELECT COUNT(*) AS login_count
               FROM ${LOGIN_EVENT_TABLE} e
               JOIN ${SESSION_TABLE} s ON s.id = e.session_id
              WHERE e.is_excluded = 0
                AND ${loginWhere.clauses.join(' AND ')}
                AND e.login_at >= ? AND e.login_at < ?`,
            [
                ...loginWhere.params,
                `${definition.start} 00:00:00.000`,
                `${definition.endExclusive} 00:00:00.000`,
            ]
        );
        const summaryRow = summaryResult?.[0]?.[0] || {};
        const breakdown = { anonymous: 0, member: 0 };
        let uniqueMembers = 0;
        for (const row of breakdownRows || []) {
            if (VALID_TYPES.has(row.visitor_type)) {
                breakdown[row.visitor_type] = numeric(row.session_count);
                uniqueMembers += numeric(row.unique_member_count);
            }
        }
        const currentTotal = series.reduce((sum, item) => sum + item.count, 0);
        const previousTotal = previousSeries.reduce((sum, item) => sum + item.count, 0);
        const change = currentTotal - previousTotal;
        return {
            metric: 'visit_sessions',
            period: normalizedPeriod,
            anchor: definition.anchor,
            timezone: TIMEZONE,
            inactivitySeconds,
            historicalData: {
                coverageStart: LOGIN_HISTORY_BACKFILL_START,
                sources: ['legacy_daily', 'login_history'],
                exactFiveMinuteReconstruction: false,
            },
            filters,
            range: { start: definition.start, end: addDays(definition.endExclusive, -1) },
            summary: {
                todayCount: numeric(summaryRow.today_count),
                yesterdayCount: numeric(summaryRow.yesterday_count),
                weekCount: numeric(summaryRow.week_count),
                monthCount: numeric(summaryRow.month_count),
                yearCount: numeric(summaryRow.year_count),
                totalCount: numeric(summaryRow.total_count),
                startedAt: summaryRow.started_at ? String(summaryRow.started_at).slice(0, 10) : null,
            },
            totals: {
                current: currentTotal,
                previous: previousTotal,
                change,
                changeRate: previousTotal === 0
                    ? (currentTotal === 0 ? 0 : null)
                    : Number(((change / previousTotal) * 100).toFixed(1)),
            },
            metrics: {
                sessionCount: currentTotal,
                loginCount: numeric(loginRows?.[0]?.login_count),
                anonymousCount: breakdown.anonymous,
                memberCount: breakdown.member,
                uniqueMembers,
            },
            sessionBreakdown: breakdown,
            series,
        };
    }

    async function getAdminSessions({
        period = 'day', anchor, types, memberIds, status = 'all', page = 1, pageSize = 25, now,
    } = {}) {
        await ensureSchema();
        const current = nowDate(now);
        const today = getKstDateKey(current);
        const normalizedPeriod = String(period || 'day').trim().toLowerCase();
        const definition = buildPeriodDefinition(normalizedPeriod, anchor || today);
        const filters = normalizeFilters({ types, memberIds, status });
        const normalizedPage = Math.max(1, Math.floor(numeric(page) || 1));
        const normalizedPageSize = Math.min(100, Math.max(1, Math.floor(numeric(pageSize) || 25)));
        const where = rangeWhere(definition, filters, {
            status: filters.status,
            current,
        });
        const [countRows] = await pool.query(
            `/* visit-session:list-count */
             SELECT COUNT(*) AS total
               FROM ${SESSION_TABLE} s
              WHERE ${where.clauses.join(' AND ')}`,
            where.params
        );
        const total = numeric(countRows?.[0]?.total);
        const offset = (normalizedPage - 1) * normalizedPageSize;
        const [rows] = await pool.query(
            `/* visit-session:list */
             SELECT s.id, s.visitor_type, s.member_user_id,
                    COALESCE(NULLIF(TRIM(u.name), ''), s.member_user_id) AS member_name,
                    s.started_at, s.last_seen_at, s.ended_at, s.entry_path,
                    s.request_count, s.source,
                    CASE WHEN s.active_key IS NOT NULL AND s.last_seen_at >= ? THEN 1 ELSE 0 END AS is_active,
                    TIMESTAMPDIFF(SECOND, s.started_at, s.last_seen_at) AS duration_seconds,
                    COALESCE(events.login_event_count, 0) AS login_event_count
               FROM ${SESSION_TABLE} s
               LEFT JOIN wgs_users u
                 ON CAST(u.id AS BINARY) = CAST(s.member_user_id AS BINARY)
               LEFT JOIN (
                   SELECT session_id, COUNT(*) AS login_event_count
                     FROM ${LOGIN_EVENT_TABLE}
                    WHERE is_excluded = 0
                    GROUP BY session_id
               ) events ON events.session_id = s.id
              WHERE ${where.clauses.join(' AND ')}
              ORDER BY s.started_at DESC, s.id DESC
              LIMIT ? OFFSET ?`,
            [
                getKstDateTime(thresholdDate(current)),
                ...where.params,
                normalizedPageSize,
                offset,
            ]
        );
        return {
            timezone: TIMEZONE,
            inactivitySeconds,
            period: normalizedPeriod,
            anchor: definition.anchor,
            range: { start: definition.start, end: addDays(definition.endExclusive, -1) },
            filters,
            pagination: {
                page: normalizedPage,
                pageSize: normalizedPageSize,
                total,
                totalPages: Math.ceil(total / normalizedPageSize),
            },
            sessions: (rows || []).map((row) => ({
                id: String(row.id),
                visitorType: row.visitor_type === 'member' ? 'member' : 'anonymous',
                member: row.member_user_id ? {
                    id: String(row.member_user_id),
                    name: String(row.member_name || row.member_user_id),
                } : null,
                startedAt: normalizeDateTime(row.started_at),
                lastSeenAt: normalizeDateTime(row.last_seen_at),
                endedAt: normalizeDateTime(row.ended_at),
                durationSeconds: numeric(row.duration_seconds),
                status: numeric(row.is_active) ? 'active' : 'ended',
                entryPath: row.entry_path || null,
                requestCount: numeric(row.request_count),
                loginEventCount: numeric(row.login_event_count),
                source: String(row.source || 'live'),
                historical: !['live', 'live_login', 'session_resume'].includes(String(row.source || '')),
            })),
        };
    }

    async function getAdminMembers({ query = '', limit = 100 } = {}) {
        await ensureSchema();
        const search = String(query || '').trim().slice(0, 100);
        const normalizedLimit = Math.min(200, Math.max(1, Math.floor(numeric(limit) || 100)));
        const params = [];
        let searchSql = '';
        if (search) {
            searchSql = `AND (s.member_user_id LIKE ? OR u.name LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }
        params.push(normalizedLimit);
        const [rows] = await pool.query(
            `/* visit-session:members */
             SELECT s.member_user_id AS id,
                    COALESCE(NULLIF(TRIM(u.name), ''), s.member_user_id) AS name,
                    COUNT(*) AS session_count,
                    MAX(s.last_seen_at) AS last_seen_at
               FROM ${SESSION_TABLE} s
               LEFT JOIN wgs_users u
                 ON CAST(u.id AS BINARY) = CAST(s.member_user_id AS BINARY)
              WHERE s.is_excluded = 0
                AND s.visitor_type = 'member'
                AND s.member_user_id IS NOT NULL
                ${searchSql}
              GROUP BY s.member_user_id, u.name
              ORDER BY name, id
              LIMIT ?`,
            params
        );
        return {
            members: (rows || []).map((row) => ({
                id: String(row.id),
                name: String(row.name || row.id),
                sessionCount: numeric(row.session_count),
                lastSeenAt: normalizeDateTime(row.last_seen_at),
            })),
        };
    }

    return {
        recordVisit,
        recordSuccessfulLogin,
        linkAuthenticatedSession,
        excludeClientSession,
        endAuthenticatedSession,
        getPublicSummary,
        getAdminStats,
        getAdminSessions,
        getAdminMembers,
        hashClientId,
        inactivitySeconds,
        timezone: TIMEZONE,
    };
}

module.exports = {
    TIMEZONE,
    DEFAULT_INACTIVITY_SECONDS,
    SESSION_TABLE,
    LOGIN_EVENT_TABLE,
    createVisitSessionService,
    sanitizeEntryPath,
    normalizeTypes,
    normalizeFilters,
};
