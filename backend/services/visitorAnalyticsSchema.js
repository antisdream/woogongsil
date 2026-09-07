'use strict';

const TABLE_NAME = 'wgs_daily_visitors';
const SESSION_TABLE_NAME = 'wgs_visit_sessions';
const LOGIN_EVENT_TABLE_NAME = 'wgs_visit_login_events';
const LOGIN_HISTORY_TABLE_NAME = 'wgs_login_history';
const USER_TABLE_NAME = 'wgs_users';
const LOGIN_HISTORY_BACKFILL_START = '2026-05-08';
const LOGIN_HISTORY_SESSION_GAP_MS = 5 * 60 * 1000;

function quoteIdentifier(value) {
    return `\`${String(value).replace(/`/g, '``')}\``;
}

function columnValue(row, name) {
    return row?.[name] ?? row?.[name.toLowerCase()] ?? null;
}

function groupColumns(rows) {
    const result = new Map();
    for (const row of rows || []) {
        const tableName = String(columnValue(row, 'TABLE_NAME') || '').toLowerCase();
        const columnName = String(columnValue(row, 'COLUMN_NAME') || '');
        if (!tableName || !columnName) continue;
        if (!result.has(tableName)) result.set(tableName, new Map());
        result.get(tableName).set(columnName.toLowerCase(), columnName);
    }
    return result;
}

function selectColumn(columnMap, candidates) {
    for (const candidate of candidates) {
        const actual = columnMap?.get(String(candidate).toLowerCase());
        if (actual) return actual;
    }
    return null;
}

function truthyRoleExpression(alias, column) {
    return `LOWER(TRIM(CAST(COALESCE(${alias}.${quoteIdentifier(column)}, '') AS CHAR)))`
        + " IN ('1', 'true', 'yes', 'y', 'on')";
}

function loginActionExpression(alias, columns) {
    return columns.map((column) => {
        const text = `TRIM(CAST(${alias}.${quoteIdentifier(column)} AS CHAR))`;
        return `(LOWER(${text}) = 'login' OR ${text} = '로그인')`;
    }).join(' OR ');
}

function clusterLoginHistoryRows(rows) {
    const clusters = [];
    let currentCluster = null;

    for (const row of rows || []) {
        const event = {
            historyId: String(row?.history_id || '').trim(),
            memberId: String(row?.member_id || '').trim(),
            loginAt: String(row?.login_at || '').slice(0, 23),
            loginAtMs: Number(row?.login_at_ms),
        };
        if (!event.historyId || !event.memberId || !event.loginAt
            || !Number.isFinite(event.loginAtMs)) {
            continue;
        }

        const startsNewCluster = !currentCluster
            || currentCluster.memberId !== event.memberId
            || event.loginAtMs - currentCluster.lastLoginAtMs > LOGIN_HISTORY_SESSION_GAP_MS;
        if (startsNewCluster) {
            currentCluster = {
                memberId: event.memberId,
                sourceRef: event.historyId,
                startedAt: event.loginAt,
                lastSeenAt: event.loginAt,
                lastLoginAtMs: event.loginAtMs,
                events: [],
            };
            clusters.push(currentCluster);
        }
        currentCluster.events.push(event);
        currentCluster.lastSeenAt = event.loginAt;
        currentCluster.lastLoginAtMs = event.loginAtMs;
    }

    return clusters;
}

function createVisitorAnalyticsSchema({ pool } = {}) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('createVisitorAnalyticsSchema requires a MySQL pool.');
    }

    let schemaReady = false;
    let schemaPromise = null;

    async function backfillLegacyDailyVisitors() {
        await pool.query(`
            /* visit-session:backfill-legacy-daily */
            INSERT IGNORE INTO ${SESSION_TABLE_NAME}
                (visitor_hash, active_key, visitor_type, member_user_id,
                 started_at, last_seen_at, ended_at, entry_path, request_count,
                 source, source_ref, is_excluded)
            SELECT visitor_hash, NULL, 'anonymous', NULL,
                   first_seen_at, last_seen_at, last_seen_at, NULL, request_count,
                   'legacy_daily',
                   CONCAT(DATE_FORMAT(visit_date, '%Y-%m-%d'), ':', visitor_hash),
                   0
              FROM ${TABLE_NAME}
        `);
    }

    async function inspectLoginHistoryColumns() {
        const [rows] = await pool.query(
            `/* visit-session:backfill-columns */
             SELECT TABLE_NAME, COLUMN_NAME
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN (?, ?)
              ORDER BY TABLE_NAME, ORDINAL_POSITION`,
            [LOGIN_HISTORY_TABLE_NAME, USER_TABLE_NAME]
        );
        return groupColumns(rows);
    }

    async function backfillLoginHistory() {
        const grouped = await inspectLoginHistoryColumns();
        const historyColumns = grouped.get(LOGIN_HISTORY_TABLE_NAME) || new Map();
        const userColumns = grouped.get(USER_TABLE_NAME) || new Map();
        const historyIdColumn = selectColumn(historyColumns, ['id', 'history_id', 'log_id', 'idx']);
        const historyUserColumn = selectColumn(historyColumns, ['userId', 'user_id']);
        const historyTimeColumn = selectColumn(historyColumns, ['time', 'created_at']);
        const historyActionColumns = ['action', 'type']
            .map((candidate) => selectColumn(historyColumns, [candidate]))
            .filter(Boolean);

        // A stable source row identity is mandatory for restart-safe backfill.
        if (!historyIdColumn || !historyUserColumn || !historyTimeColumn || historyActionColumns.length === 0) {
            return { available: false, reason: 'login_history_identity_unavailable' };
        }

        const userIdColumn = selectColumn(userColumns, ['id', 'account', 'userId', 'user_id']);
        const roleColumns = [
            'is_primary_admin', 'isPrimaryAdmin', 'is_operator', 'isOperator',
        ].map((candidate) => selectColumn(userColumns, [candidate])).filter(Boolean);
        const adminFilter = userIdColumn && roleColumns.length > 0
            ? `AND NOT EXISTS (
                   SELECT 1
                     FROM ${quoteIdentifier(USER_TABLE_NAME)} u
                    WHERE TRIM(CAST(u.${quoteIdentifier(userIdColumn)} AS CHAR))
                        = TRIM(CAST(h.${quoteIdentifier(historyUserColumn)} AS CHAR))
                      AND (${roleColumns.map((column) => truthyRoleExpression('u', column)).join(' OR ')})
               )`
            : '';
        const historyId = `TRIM(CAST(h.${quoteIdentifier(historyIdColumn)} AS CHAR))`;
        const memberId = `TRIM(CAST(h.${quoteIdentifier(historyUserColumn)} AS CHAR))`;
        const loginAt = `h.${quoteIdentifier(historyTimeColumn)}`;
        const actionPredicate = loginActionExpression('h', historyActionColumns);
        const database = typeof pool.getConnection === 'function'
            ? await pool.getConnection()
            : pool;
        const ownsConnection = database !== pool;
        try {
            if (ownsConnection) await database.beginTransaction();
            const [historyRows] = await database.query(`
                /* visit-session:select-login-backfill */
                SELECT ${historyId} AS history_id,
                       ${memberId} AS member_id,
                       DATE_FORMAT(${loginAt}, '%Y-%m-%d %H:%i:%s.%f') AS login_at,
                       (UNIX_TIMESTAMP(${loginAt}) * 1000) AS login_at_ms
                  FROM ${quoteIdentifier(LOGIN_HISTORY_TABLE_NAME)} h
                 WHERE (${actionPredicate})
                   AND ${historyId} <> ''
                   AND ${memberId} <> ''
                   AND ${loginAt} IS NOT NULL
                   AND DATE(${loginAt}) >= ?
                   AND NOT EXISTS (
                       SELECT 1
                         FROM ${LOGIN_EVENT_TABLE_NAME} existing_event
                        WHERE existing_event.source = 'login_history'
                          AND existing_event.source_ref = ${historyId}
                   )
                   ${adminFilter}
                 ORDER BY member_id, login_at_ms, history_id
            `, [LOGIN_HISTORY_BACKFILL_START]);

            const clusters = clusterLoginHistoryRows(historyRows);

            const loginEvents = [];
            for (const cluster of clusters) {
                await database.query(`
                    /* visit-session:insert-login-cluster */
                    INSERT IGNORE INTO ${SESSION_TABLE_NAME}
                        (visitor_hash, active_key, visitor_type, member_user_id,
                         started_at, last_seen_at, ended_at, entry_path, request_count,
                         source, source_ref, is_excluded)
                    VALUES (
                        SHA2(CONCAT('wgs-login-history-session:', ?), 256),
                        NULL, 'member', ?, ?, ?, ?, '/login', ?,
                        'login_history', ?, 0
                    )
                `, [
                    cluster.sourceRef,
                    cluster.memberId,
                    cluster.startedAt,
                    cluster.lastSeenAt,
                    cluster.lastSeenAt,
                    cluster.events.length,
                    cluster.sourceRef,
                ]);
                const [sessionRows] = await database.query(
                    `/* visit-session:find-login-cluster */
                     SELECT id
                       FROM ${SESSION_TABLE_NAME}
                      WHERE source = 'login_history' AND source_ref = ?
                      LIMIT 1`,
                    [cluster.sourceRef]
                );
                const sessionId = sessionRows?.[0]?.id;
                if (!sessionId) throw new Error('Login history cluster session could not be resolved.');
                for (const event of cluster.events) loginEvents.push({ ...event, sessionId });
            }

            for (let offset = 0; offset < loginEvents.length; offset += 200) {
                const batch = loginEvents.slice(offset, offset + 200);
                if (batch.length === 0) continue;
                const placeholders = batch.map(() => "(?, ?, ?, 'login_history', ?, 0)").join(', ');
                const params = batch.flatMap((event) => [
                    event.sessionId,
                    event.memberId,
                    event.loginAt,
                    event.historyId,
                ]);
                await database.query(`
                    /* visit-session:insert-login-events */
                    INSERT IGNORE INTO ${LOGIN_EVENT_TABLE_NAME}
                        (session_id, member_user_id, login_at, source, source_ref, is_excluded)
                    VALUES ${placeholders}
                `, params);
            }
            if (ownsConnection) await database.commit();
            return {
                available: true,
                clusteredSessions: clusters.length,
                loginEvents: loginEvents.length,
            };
        } catch (error) {
            if (ownsConnection) await database.rollback();
            throw error;
        } finally {
            if (ownsConnection) database.release();
        }
    }

    async function ensureVisitorAnalyticsSchema() {
        if (schemaReady) return;
        if (schemaPromise) return schemaPromise;

        schemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
                    visit_date DATE NOT NULL,
                    visitor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                    first_seen_at DATETIME(3) NOT NULL,
                    last_seen_at DATETIME(3) NOT NULL,
                    request_count INT UNSIGNED NOT NULL DEFAULT 1,
                    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3),
                    PRIMARY KEY (visit_date, visitor_hash),
                    KEY idx_wgs_daily_visitors_first_seen (visit_date, first_seen_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS ${SESSION_TABLE_NAME} (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    visitor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                    active_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
                    visitor_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                    member_user_id VARCHAR(191) NULL,
                    started_at DATETIME(3) NOT NULL,
                    last_seen_at DATETIME(3) NOT NULL,
                    ended_at DATETIME(3) NULL,
                    entry_path VARCHAR(512) NULL,
                    request_count INT UNSIGNED NOT NULL DEFAULT 1,
                    source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'live',
                    source_ref VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
                    is_excluded TINYINT(1) NOT NULL DEFAULT 0,
                    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                        ON UPDATE CURRENT_TIMESTAMP(3),
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_wgs_visit_sessions_active_key (active_key),
                    UNIQUE KEY uq_wgs_visit_sessions_source (source, source_ref),
                    KEY idx_wgs_visit_sessions_started (started_at),
                    KEY idx_wgs_visit_sessions_last_seen (last_seen_at),
                    KEY idx_wgs_visit_sessions_member (member_user_id, started_at),
                    KEY idx_wgs_visit_sessions_type (visitor_type, started_at),
                    CONSTRAINT chk_wgs_visit_sessions_type
                        CHECK (visitor_type IN ('anonymous', 'member'))
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS ${LOGIN_EVENT_TABLE_NAME} (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    session_id BIGINT UNSIGNED NOT NULL,
                    member_user_id VARCHAR(191) NOT NULL,
                    login_at DATETIME(3) NOT NULL,
                    source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'live',
                    source_ref VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
                    is_excluded TINYINT(1) NOT NULL DEFAULT 0,
                    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_wgs_visit_login_events_source (source, source_ref),
                    KEY idx_wgs_visit_login_events_session (session_id),
                    KEY idx_wgs_visit_login_events_member (member_user_id, login_at),
                    KEY idx_wgs_visit_login_events_login_at (login_at),
                    CONSTRAINT fk_wgs_visit_login_events_session
                        FOREIGN KEY (session_id) REFERENCES ${SESSION_TABLE_NAME}(id)
                        ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await backfillLegacyDailyVisitors();
            await backfillLoginHistory();
            schemaReady = true;
        })();

        try {
            await schemaPromise;
        } finally {
            schemaPromise = null;
        }
    }

    return {
        ensureVisitorAnalyticsSchema,
        tableName: TABLE_NAME,
        sessionTableName: SESSION_TABLE_NAME,
        loginEventTableName: LOGIN_EVENT_TABLE_NAME,
    };
}

async function ensureVisitorAnalyticsSchema(pool) {
    const schema = createVisitorAnalyticsSchema({ pool });
    await schema.ensureVisitorAnalyticsSchema();
}

module.exports = {
    TABLE_NAME,
    SESSION_TABLE_NAME,
    LOGIN_EVENT_TABLE_NAME,
    LOGIN_HISTORY_TABLE_NAME,
    LOGIN_HISTORY_BACKFILL_START,
    LOGIN_HISTORY_SESSION_GAP_MS,
    clusterLoginHistoryRows,
    createVisitorAnalyticsSchema,
    ensureVisitorAnalyticsSchema,
};
