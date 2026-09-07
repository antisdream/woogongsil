'use strict';

const TIMEZONE = 'Asia/Seoul';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HISTORY_TABLE = 'wgs_login_history';
const USER_TABLE = 'wgs_users';
const VALID_PERIODS = new Set(['day', 'week', 'month', 'year']);
const METRIC = 'daily_unique_member_logins';
const SCOPE = 'authenticated_members_only';

class MemberLoginActivityInputError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'MemberLoginActivityInputError';
        this.code = code;
        this.statusCode = 400;
    }
}

function resolveDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new MemberLoginActivityInputError('A valid date is required.', 'invalid_date');
    }
    return date;
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatDateParts(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

function getKstDateKey(value = new Date()) {
    const shifted = new Date(resolveDate(value).getTime() + KST_OFFSET_MS);
    return formatDateParts(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth() + 1,
        shifted.getUTCDate()
    );
}

function parseDateKey(value, fieldName = 'anchor') {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) {
        throw new MemberLoginActivityInputError(
            `${fieldName} must use YYYY-MM-DD format.`,
            `invalid_${fieldName}`
        );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
        check.getUTCFullYear() !== year
        || check.getUTCMonth() + 1 !== month
        || check.getUTCDate() !== day
    ) {
        throw new MemberLoginActivityInputError(
            `${fieldName} is not a valid calendar date.`,
            `invalid_${fieldName}`
        );
    }

    return { key: text, year, month, day };
}

function addDays(dateKey, amount) {
    const parsed = parseDateKey(dateKey, 'date');
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + Number(amount || 0)));
    return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function monthStart(year, month) {
    const date = new Date(Date.UTC(year, month - 1, 1));
    return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function startOfKstWeek(dateKey) {
    const parsed = parseDateKey(dateKey, 'date');
    const dayOfWeek = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
    return addDays(dateKey, -((dayOfWeek + 6) % 7));
}

function buildPeriodDefinition(period, anchor) {
    if (!VALID_PERIODS.has(period)) {
        throw new MemberLoginActivityInputError(
            'period must be day, week, month, or year.',
            'invalid_period'
        );
    }

    const parsed = parseDateKey(anchor);
    if (period === 'day') {
        return {
            period,
            anchor: parsed.key,
            start: parsed.key,
            endExclusive: addDays(parsed.key, 1),
            bucketType: 'hour',
            buckets: Array.from({ length: 24 }, (_, hour) => ({
                key: `${parsed.key}T${pad2(hour)}`,
                label: `${pad2(hour)}:00`,
            })),
        };
    }

    if (period === 'week') {
        const start = startOfKstWeek(parsed.key);
        return {
            period,
            anchor: parsed.key,
            start,
            endExclusive: addDays(start, 7),
            bucketType: 'date',
            buckets: Array.from({ length: 7 }, (_, index) => {
                const key = addDays(start, index);
                return { key, label: key.slice(5) };
            }),
        };
    }

    if (period === 'month') {
        const start = monthStart(parsed.year, parsed.month);
        const endExclusive = monthStart(parsed.year, parsed.month + 1);
        const length = Math.round(
            (Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000
        );
        return {
            period,
            anchor: parsed.key,
            start,
            endExclusive,
            bucketType: 'date',
            buckets: Array.from({ length }, (_, index) => {
                const key = addDays(start, index);
                return { key, label: key.slice(8) };
            }),
        };
    }

    return {
        period,
        anchor: parsed.key,
        start: `${parsed.year}-01-01`,
        endExclusive: `${parsed.year + 1}-01-01`,
        bucketType: 'month',
        buckets: Array.from({ length: 12 }, (_, index) => ({
            key: `${parsed.year}-${pad2(index + 1)}`,
            label: `${index + 1}월`,
        })),
    };
}

function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedDate(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return getKstDateKey(value);
    return String(value).slice(0, 10);
}

function normalizedDateTime(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 19);
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const shifted = new Date(value.getTime() + KST_OFFSET_MS);
        return shifted.toISOString().replace('T', ' ').slice(0, 19);
    }
    return String(value).slice(0, 19);
}

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

function selectColumns(columnMap, candidates) {
    const selected = [];
    for (const candidate of candidates) {
        const actual = columnMap?.get(String(candidate).toLowerCase());
        if (actual && !selected.includes(actual)) selected.push(actual);
    }
    return selected;
}

function nonBlankTextExpression(alias, columns) {
    const expressions = columns.map((column) => (
        `NULLIF(TRIM(CAST(${alias}.${quoteIdentifier(column)} AS CHAR)), '')`
    ));
    return expressions.length === 1 ? expressions[0] : `COALESCE(${expressions.join(', ')})`;
}

function coalescedValueExpression(alias, columns) {
    const expressions = columns.map((column) => `${alias}.${quoteIdentifier(column)}`);
    return expressions.length === 1 ? expressions[0] : `COALESCE(${expressions.join(', ')})`;
}

function roleTruthyExpression(alias, column) {
    return `LOWER(TRIM(CAST(COALESCE(${alias}.${quoteIdentifier(column)}, '') AS CHAR)))`
        + " IN ('1', 'true', 'yes', 'y', 'on')";
}

function emptySummary() {
    return {
        todayCount: 0,
        weekCount: 0,
        monthCount: 0,
        yearCount: 0,
        totalCount: 0,
        startedAt: null,
        firstRecordedAt: null,
        uniqueMemberCount: 0,
        rangeUniqueMemberCount: 0,
    };
}

function zeroSeries(definition) {
    return definition.buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: 0,
    }));
}

function baseResult(definition, { available, reason, adminExcluded }) {
    return {
        available,
        ...(reason ? { reason } : {}),
        metric: METRIC,
        scope: SCOPE,
        timezone: TIMEZONE,
        period: definition.period,
        anchor: definition.anchor,
        range: {
            start: definition.start,
            end: addDays(definition.endExclusive, -1),
        },
        summary: emptySummary(),
        series: zeroSeries(definition),
        metadata: {
            dailyDeduplicated: true,
            adminExcluded: Boolean(adminExcluded),
        },
    };
}

function createMemberLoginActivityService(options = {}) {
    const pool = options.pool;
    const clock = options.clock || (() => new Date());

    if (!pool || typeof pool.query !== 'function') {
        throw new Error('createMemberLoginActivityService requires a MySQL pool.');
    }
    if (typeof clock !== 'function') {
        throw new Error('createMemberLoginActivityService requires clock to be a function.');
    }

    async function inspectSource() {
        const [rows] = await pool.query(
            `/* member-login:columns */
             SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN (?, ?)
              ORDER BY TABLE_NAME, ORDINAL_POSITION`,
            [HISTORY_TABLE, USER_TABLE]
        );
        const grouped = groupColumns(rows);
        const historyColumns = grouped.get(HISTORY_TABLE) || new Map();
        if (historyColumns.size === 0) {
            return { available: false, reason: 'login_history_table_missing', adminExcluded: false };
        }

        const userColumns = selectColumns(historyColumns, ['userId', 'user_id']);
        const timeColumns = selectColumns(historyColumns, ['time', 'created_at']);
        const actionColumns = selectColumns(historyColumns, ['action', 'type']);
        if (userColumns.length === 0) {
            return { available: false, reason: 'login_history_user_column_missing', adminExcluded: false };
        }
        if (timeColumns.length === 0) {
            return { available: false, reason: 'login_history_time_column_missing', adminExcluded: false };
        }
        if (actionColumns.length === 0) {
            return { available: false, reason: 'login_history_action_column_missing', adminExcluded: false };
        }

        const userExpression = nonBlankTextExpression('h', userColumns);
        const timeExpression = coalescedValueExpression('h', timeColumns);
        const actionPredicate = actionColumns.map((column) => {
            const text = `TRIM(CAST(h.${quoteIdentifier(column)} AS CHAR))`;
            return `(LOWER(${text}) = 'login' OR ${text} = '로그인')`;
        }).join(' OR ');

        const accountColumns = grouped.get(USER_TABLE) || new Map();
        const accountIdColumn = selectColumns(accountColumns, ['id', 'account', 'userId', 'user_id'])[0];
        const roleColumns = selectColumns(accountColumns, [
            'is_primary_admin',
            'isPrimaryAdmin',
            'is_operator',
            'isOperator',
        ]);
        const adminExcluded = Boolean(accountIdColumn && roleColumns.length > 0);
        const adminFilter = adminExcluded
            ? `AND NOT EXISTS (
                   SELECT 1
                     FROM ${quoteIdentifier(USER_TABLE)} u
                    WHERE NULLIF(TRIM(CAST(u.${quoteIdentifier(accountIdColumn)} AS CHAR)), '') = ${userExpression}
                      AND (${roleColumns.map((column) => roleTruthyExpression('u', column)).join(' OR ')})
               )`
            : '';

        const filteredSourceSql = `
            SELECT ${userExpression} AS member_key,
                   ${timeExpression} AS login_at
              FROM ${quoteIdentifier(HISTORY_TABLE)} h
             WHERE (${actionPredicate})
               AND ${userExpression} IS NOT NULL
               AND ${timeExpression} IS NOT NULL
               ${adminFilter}`;
        const dailyUniqueSql = `
            SELECT DATE(source_rows.login_at) AS activity_date,
                   source_rows.member_key,
                   MIN(source_rows.login_at) AS first_login_at
              FROM (${filteredSourceSql}) source_rows
             GROUP BY DATE(source_rows.login_at), source_rows.member_key`;

        return {
            available: true,
            adminExcluded,
            dailyUniqueSql,
        };
    }

    async function querySeries(source, definition) {
        let sql;
        let params;
        if (definition.bucketType === 'hour') {
            sql = `/* member-login:series-hour */
                   SELECT HOUR(first_login_at) AS bucket_key, COUNT(*) AS activity_count
                     FROM (${source.dailyUniqueSql}) daily_activity
                    WHERE activity_date = ?
                    GROUP BY HOUR(first_login_at)
                    ORDER BY HOUR(first_login_at)`;
            params = [definition.start];
        } else if (definition.bucketType === 'month') {
            sql = `/* member-login:series-month */
                   SELECT DATE_FORMAT(activity_date, '%Y-%m') AS bucket_key, COUNT(*) AS activity_count
                     FROM (${source.dailyUniqueSql}) daily_activity
                    WHERE activity_date >= ? AND activity_date < ?
                    GROUP BY DATE_FORMAT(activity_date, '%Y-%m')
                    ORDER BY bucket_key`;
            params = [definition.start, definition.endExclusive];
        } else {
            sql = `/* member-login:series-date */
                   SELECT DATE_FORMAT(activity_date, '%Y-%m-%d') AS bucket_key, COUNT(*) AS activity_count
                     FROM (${source.dailyUniqueSql}) daily_activity
                    WHERE activity_date >= ? AND activity_date < ?
                    GROUP BY activity_date
                    ORDER BY activity_date`;
            params = [definition.start, definition.endExclusive];
        }

        const [rows] = await pool.query(sql, params);
        const counts = new Map();
        for (const row of rows || []) {
            let key;
            if (definition.bucketType === 'hour') {
                const hour = Number(row.bucket_key ?? row.hour);
                key = Number.isInteger(hour) && hour >= 0 && hour <= 23
                    ? `${definition.start}T${pad2(hour)}`
                    : null;
            } else {
                key = String(row.bucket_key || '').slice(0, definition.bucketType === 'month' ? 7 : 10);
            }
            if (key) counts.set(key, numeric(row.activity_count ?? row.count));
        }

        return definition.buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            count: counts.get(bucket.key) || 0,
        }));
    }

    async function getStats({ period = 'day', anchor, now } = {}) {
        const current = resolveDate(now === undefined ? clock() : now);
        const today = getKstDateKey(current);
        const normalizedPeriod = String(period || 'day').trim().toLowerCase();
        const definition = buildPeriodDefinition(normalizedPeriod, anchor || today);
        const source = await inspectSource();
        if (!source.available) {
            return baseResult(definition, source);
        }

        const tomorrow = addDays(today, 1);
        const weekStart = startOfKstWeek(today);
        const currentParts = parseDateKey(today, 'date');
        const currentMonthStart = monthStart(currentParts.year, currentParts.month);
        const currentYearStart = `${currentParts.year}-01-01`;
        const summaryPromise = pool.query(
            `/* member-login:summary */
             SELECT COUNT(*) AS total_count,
                    COALESCE(SUM(CASE WHEN activity_date = ? THEN 1 ELSE 0 END), 0) AS today_count,
                    COALESCE(SUM(CASE WHEN activity_date >= ? AND activity_date < ? THEN 1 ELSE 0 END), 0) AS week_count,
                    COALESCE(SUM(CASE WHEN activity_date >= ? AND activity_date < ? THEN 1 ELSE 0 END), 0) AS month_count,
                    COALESCE(SUM(CASE WHEN activity_date >= ? AND activity_date < ? THEN 1 ELSE 0 END), 0) AS year_count,
                    DATE_FORMAT(MIN(activity_date), '%Y-%m-%d') AS started_at,
                    DATE_FORMAT(MIN(first_login_at), '%Y-%m-%d %H:%i:%s') AS first_recorded_at,
                    COUNT(DISTINCT member_key) AS unique_member_count,
                    COUNT(DISTINCT CASE
                        WHEN activity_date >= ? AND activity_date < ? THEN member_key
                        ELSE NULL
                    END) AS range_unique_member_count
               FROM (${source.dailyUniqueSql}) daily_activity`,
            [
                today,
                weekStart, tomorrow,
                currentMonthStart, tomorrow,
                currentYearStart, tomorrow,
                definition.start, definition.endExclusive,
            ]
        );
        const [summaryResult, series] = await Promise.all([
            summaryPromise,
            querySeries(source, definition),
        ]);
        const summaryRow = summaryResult?.[0]?.[0] || {};
        const result = baseResult(definition, {
            available: true,
            adminExcluded: source.adminExcluded,
        });
        result.summary = {
            todayCount: numeric(summaryRow.today_count),
            weekCount: numeric(summaryRow.week_count),
            monthCount: numeric(summaryRow.month_count),
            yearCount: numeric(summaryRow.year_count),
            totalCount: numeric(summaryRow.total_count),
            startedAt: normalizedDate(summaryRow.started_at),
            firstRecordedAt: normalizedDateTime(summaryRow.first_recorded_at),
            uniqueMemberCount: numeric(summaryRow.unique_member_count),
            rangeUniqueMemberCount: numeric(summaryRow.range_unique_member_count),
        };
        result.series = series;
        return result;
    }

    return {
        getStats,
        inspectSource,
        timezone: TIMEZONE,
        metric: METRIC,
        scope: SCOPE,
    };
}

module.exports = {
    TIMEZONE,
    HISTORY_TABLE,
    USER_TABLE,
    VALID_PERIODS,
    METRIC,
    SCOPE,
    MemberLoginActivityInputError,
    createMemberLoginActivityService,
    getKstDateKey,
    parseDateKey,
    addDays,
    startOfKstWeek,
    buildPeriodDefinition,
};
