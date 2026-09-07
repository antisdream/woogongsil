'use strict';

const cryptoModule = require('crypto');

const TIMEZONE = 'Asia/Seoul';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const VALID_PERIODS = new Set(['day', 'week', 'month', 'year']);
const DEFAULT_SUMMARY_CACHE_MS = 30 * 1000;
const DEFAULT_ADMIN_EXCLUSION_TTL_HOURS = 8;
const MIN_ADMIN_EXCLUSION_TTL_HOURS = 1;
const MAX_ADMIN_EXCLUSION_TTL_HOURS = 24;
const ADMIN_EXCLUSION_COOKIE_NAME = 'wgs_visitor_admin_exclusion';
const LOCAL_FALLBACK_SECRET = cryptoModule.randomBytes(32).toString('hex');
const CLIENT_ID_PATTERN = /^wgs-[A-Za-z0-9._:-]{8,180}$/;
const BOT_USER_AGENT_PATTERN = /(?:bot|crawler|spider|slurp|bingpreview|facebookexternalhit|preview|monitoring|uptime|healthcheck|headlesschrome|lighthouse|curl\/|wget\/|python-requests|node-fetch|postmanruntime)/i;

class VisitorAnalyticsInputError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'VisitorAnalyticsInputError';
        this.code = code;
        this.statusCode = 400;
    }
}

function resolveDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new VisitorAnalyticsInputError('A valid date is required.', 'invalid_date');
    }
    return date;
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatDateParts(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

function getKstParts(value = new Date()) {
    const shifted = new Date(resolveDate(value).getTime() + KST_OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
        millisecond: shifted.getUTCMilliseconds(),
    };
}

function getKstDateKey(value = new Date()) {
    const parts = getKstParts(value);
    return formatDateParts(parts.year, parts.month, parts.day);
}

function getKstDateTime(value = new Date()) {
    const parts = getKstParts(value);
    return `${formatDateParts(parts.year, parts.month, parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}.${String(parts.millisecond).padStart(3, '0')}`;
}

function parseDateKey(value, fieldName = 'anchor') {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) {
        throw new VisitorAnalyticsInputError(`${fieldName} must use YYYY-MM-DD format.`, `invalid_${fieldName}`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
        throw new VisitorAnalyticsInputError(`${fieldName} is not a valid calendar date.`, `invalid_${fieldName}`);
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
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    return addDays(dateKey, -daysSinceMonday);
}

function validateClientId(value) {
    if (typeof value !== 'string') return null;
    const clientId = value.trim();
    if (!CLIENT_ID_PATTERN.test(clientId)) return null;
    return clientId;
}

function headerValue(req, name) {
    const headers = req?.headers || {};
    const value = headers[String(name).toLowerCase()] ?? headers[name];
    return Array.isArray(value) ? value[0] : String(value || '');
}

function isAutomatedVisitRequest(req = {}) {
    const purpose = `${headerValue(req, 'purpose')} ${headerValue(req, 'sec-purpose')} ${headerValue(req, 'x-moz')}`;
    if (/\b(?:prefetch|prerender|preview)\b/i.test(purpose)) return true;

    const userAgent = headerValue(req, 'user-agent');
    return !userAgent || BOT_USER_AGENT_PATTERN.test(userAgent);
}

function buildPeriodDefinition(period, anchor) {
    if (!VALID_PERIODS.has(period)) {
        throw new VisitorAnalyticsInputError('period must be day, week, month, or year.', 'invalid_period');
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
        const length = Math.round((Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
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

    const start = `${parsed.year}-01-01`;
    return {
        period,
        anchor: parsed.key,
        start,
        endExclusive: `${parsed.year + 1}-01-01`,
        bucketType: 'month',
        buckets: Array.from({ length: 12 }, (_, index) => ({
            key: `${parsed.year}-${pad2(index + 1)}`,
            label: `${index + 1}월`,
        })),
    };
}

function previousPeriodDefinition(definition) {
    if (definition.period === 'day') {
        return buildPeriodDefinition('day', addDays(definition.start, -1));
    }
    if (definition.period === 'week') {
        return buildPeriodDefinition('week', addDays(definition.start, -1));
    }
    if (definition.period === 'month') {
        const parsed = parseDateKey(definition.start, 'date');
        return buildPeriodDefinition('month', monthStart(parsed.year, parsed.month - 1));
    }
    const parsed = parseDateKey(definition.start, 'date');
    return buildPeriodDefinition('year', `${parsed.year - 1}-01-01`);
}

function normalizeBucketKey(definition, rawKey) {
    if (definition.bucketType === 'hour') {
        const hour = Number(rawKey);
        return Number.isInteger(hour) && hour >= 0 && hour <= 23
            ? `${definition.start}T${pad2(hour)}`
            : null;
    }
    return String(rawKey || '').slice(0, definition.bucketType === 'month' ? 7 : 10);
}

function zeroFillSeries(definition, rows = []) {
    const counts = new Map();
    for (const row of rows || []) {
        const key = normalizeBucketKey(definition, row.bucket_key ?? row.bucket ?? row.hour);
        if (key) counts.set(key, Number(row.visitor_count ?? row.count ?? 0) || 0);
    }
    return definition.buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: counts.get(bucket.key) || 0,
    }));
}

function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedStartedAt(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return getKstDateKey(value);
    return String(value).slice(0, 10);
}

function createVisitorAnalyticsService(options = {}) {
    const pool = options.pool;
    const env = options.env || process.env;
    const crypto = options.crypto || cryptoModule;
    const clock = options.clock || (() => new Date());

    if (!pool || typeof pool.query !== 'function') {
        throw new Error('createVisitorAnalyticsService requires a MySQL pool.');
    }
    if (typeof clock !== 'function') {
        throw new Error('createVisitorAnalyticsService requires clock to be a function.');
    }

    const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const configuredSecret = String(env.VISITOR_HASH_SECRET || '').trim();
    if (isProduction && configuredSecret.length < 32) {
        throw new Error('VISITOR_HASH_SECRET must contain at least 32 characters in production.');
    }
    const hashSecret = configuredSecret || LOCAL_FALLBACK_SECRET;
    const configuredCacheMs = Number(env.VISITOR_SUMMARY_CACHE_MS);
    const cacheMs = Number.isFinite(configuredCacheMs)
        ? Math.min(Math.max(configuredCacheMs, 0), 5 * 60 * 1000)
        : DEFAULT_SUMMARY_CACHE_MS;
    const configuredExclusionHours = Number(env.VISITOR_ADMIN_EXCLUSION_TTL_HOURS);
    const adminExclusionTtlHours = Number.isFinite(configuredExclusionHours) && configuredExclusionHours > 0
        ? Math.min(Math.max(configuredExclusionHours, MIN_ADMIN_EXCLUSION_TTL_HOURS), MAX_ADMIN_EXCLUSION_TTL_HOURS)
        : DEFAULT_ADMIN_EXCLUSION_TTL_HOURS;
    const adminExclusionMaxAgeSeconds = Math.round(adminExclusionTtlHours * 60 * 60);
    let summaryCache = null;

    function nowDate(override) {
        return resolveDate(override === undefined ? clock() : override);
    }

    function hashClientId(clientId) {
        return crypto.createHmac('sha256', hashSecret).update(clientId, 'utf8').digest('hex');
    }

    function adminExclusionSignature(expiresAtSeconds) {
        return crypto
            .createHmac('sha256', hashSecret)
            .update(`wgs-admin-exclusion:v1:${expiresAtSeconds}`, 'utf8')
            .digest('base64url');
    }

    function issueAdminExclusionToken({ now } = {}) {
        const currentSeconds = Math.floor(nowDate(now).getTime() / 1000);
        const expiresAtSeconds = currentSeconds + adminExclusionMaxAgeSeconds;
        const signature = adminExclusionSignature(expiresAtSeconds);
        return {
            token: `v1.${expiresAtSeconds}.${signature}`,
            expiresAtSeconds,
        };
    }

    function verifyAdminExclusionToken(token, { now } = {}) {
        if (typeof token !== 'string' || token.length > 256) return false;
        const parts = token.split('.');
        if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d{10,12}$/.test(parts[1])) return false;

        const expiresAtSeconds = Number(parts[1]);
        const currentSeconds = Math.floor(nowDate(now).getTime() / 1000);
        if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= currentSeconds) return false;
        if (expiresAtSeconds > currentSeconds + (MAX_ADMIN_EXCLUSION_TTL_HOURS * 60 * 60) + 60) return false;

        const expected = Buffer.from(adminExclusionSignature(expiresAtSeconds), 'utf8');
        const provided = Buffer.from(parts[2], 'utf8');
        if (expected.length !== provided.length) return false;
        return crypto.timingSafeEqual(expected, provided);
    }

    function createAdminExclusionCookie({ now } = {}) {
        const issued = issueAdminExclusionToken({ now });
        const attributes = [
            `Max-Age=${adminExclusionMaxAgeSeconds}`,
            `Expires=${new Date(issued.expiresAtSeconds * 1000).toUTCString()}`,
            'Path=/api/visitors',
            'HttpOnly',
            'SameSite=Strict',
        ];
        if (isProduction) attributes.push('Secure');
        return `${ADMIN_EXCLUSION_COOKIE_NAME}=${encodeURIComponent(issued.token)}; ${attributes.join('; ')}`;
    }

    function createAdminExclusionClearCookie() {
        const attributes = [
            'Max-Age=0',
            'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
            'Path=/api/visitors',
            'HttpOnly',
            'SameSite=Strict',
        ];
        if (isProduction) attributes.push('Secure');
        return `${ADMIN_EXCLUSION_COOKIE_NAME}=; ${attributes.join('; ')}`;
    }

    function invalidateSummaryCache() {
        summaryCache = null;
    }

    async function getPublicSummary({ now, force = false } = {}) {
        const current = nowDate(now);
        const today = getKstDateKey(current);
        const currentMs = current.getTime();
        if (!force && summaryCache && summaryCache.dateKey === today && summaryCache.expiresAt > currentMs) {
            return { ...summaryCache.value };
        }

        const [rows] = await pool.query(
            `/* visitor:public-summary */
             SELECT COUNT(*) AS total_count,
                    SUM(CASE WHEN visit_date = ? THEN 1 ELSE 0 END) AS today_count,
                    DATE_FORMAT(MIN(visit_date), '%Y-%m-%d') AS started_at
               FROM wgs_daily_visitors`,
            [today]
        );
        const row = rows?.[0] || {};
        const value = {
            todayCount: numeric(row.today_count),
            totalCount: numeric(row.total_count),
            timezone: TIMEZONE,
            startedAt: normalizedStartedAt(row.started_at),
        };
        summaryCache = { dateKey: today, expiresAt: currentMs + cacheMs, value };
        return { ...value };
    }

    async function recordVisit({ clientId, request, now } = {}) {
        const validClientId = validateClientId(clientId);
        if (!validClientId) {
            throw new VisitorAnalyticsInputError('A valid WGS client ID is required.', 'invalid_client_id');
        }

        const current = nowDate(now);
        if (isAutomatedVisitRequest(request)) {
            const summary = await getPublicSummary({ now: current });
            return { counted: false, ignored: true, reason: 'automated_request', ...summary };
        }

        const visitDate = getKstDateKey(current);
        const seenAt = getKstDateTime(current);
        const visitorHash = hashClientId(validClientId);
        let counted = false;
        try {
            const [insertResult] = await pool.query(
                `/* visitor:insert */
                 INSERT INTO wgs_daily_visitors
                     (visit_date, visitor_hash, first_seen_at, last_seen_at, request_count)
                 VALUES (?, ?, ?, ?, 1)`,
                [visitDate, visitorHash, seenAt, seenAt]
            );
            if (numeric(insertResult?.affectedRows) !== 1) {
                throw new Error('Visitor row was not inserted.');
            }
            counted = true;
        } catch (error) {
            if (error?.code !== 'ER_DUP_ENTRY') throw error;
        }

        if (counted) {
            invalidateSummaryCache();
        } else {
            await pool.query(
                `/* visitor:touch */
                 UPDATE wgs_daily_visitors
                    SET last_seen_at = GREATEST(last_seen_at, ?),
                        request_count = request_count + 1
                  WHERE visit_date = ? AND visitor_hash = ?`,
                [seenAt, visitDate, visitorHash]
            );
        }

        const summary = await getPublicSummary({ now: current, force: counted });
        return { counted, ignored: false, reason: counted ? null : 'already_counted_today', ...summary };
    }

    async function querySeries(definition) {
        let sql;
        let params;
        if (definition.bucketType === 'hour') {
            sql = `/* visitor:series-hour */
                   SELECT HOUR(first_seen_at) AS bucket_key, COUNT(*) AS visitor_count
                     FROM wgs_daily_visitors
                    WHERE visit_date = ?
                    GROUP BY HOUR(first_seen_at)
                    ORDER BY HOUR(first_seen_at)`;
            params = [definition.start];
        } else if (definition.bucketType === 'month') {
            sql = `/* visitor:series-month */
                   SELECT DATE_FORMAT(visit_date, '%Y-%m') AS bucket_key, COUNT(*) AS visitor_count
                     FROM wgs_daily_visitors
                    WHERE visit_date >= ? AND visit_date < ?
                    GROUP BY DATE_FORMAT(visit_date, '%Y-%m')
                    ORDER BY bucket_key`;
            params = [definition.start, definition.endExclusive];
        } else {
            sql = `/* visitor:series-date */
                   SELECT DATE_FORMAT(visit_date, '%Y-%m-%d') AS bucket_key, COUNT(*) AS visitor_count
                     FROM wgs_daily_visitors
                    WHERE visit_date >= ? AND visit_date < ?
                    GROUP BY visit_date
                    ORDER BY visit_date`;
            params = [definition.start, definition.endExclusive];
        }

        const [rows] = await pool.query(sql, params);
        return zeroFillSeries(definition, rows);
    }

    async function getAdminStats({ period = 'week', anchor, now } = {}) {
        const current = nowDate(now);
        const today = getKstDateKey(current);
        const normalizedPeriod = String(period || 'week').trim().toLowerCase();
        const definition = buildPeriodDefinition(normalizedPeriod, anchor || today);
        const previousDefinition = previousPeriodDefinition(definition);
        const yesterday = addDays(today, -1);
        const weekStart = startOfKstWeek(today);
        const currentParts = parseDateKey(today, 'date');
        const currentMonthStart = monthStart(currentParts.year, currentParts.month);
        const currentYearStart = `${currentParts.year}-01-01`;
        const tomorrow = addDays(today, 1);

        const [summaryRows] = await pool.query(
            `/* visitor:admin-summary */
             SELECT COUNT(*) AS total_count,
                    SUM(CASE WHEN visit_date = ? THEN 1 ELSE 0 END) AS today_count,
                    SUM(CASE WHEN visit_date = ? THEN 1 ELSE 0 END) AS yesterday_count,
                    SUM(CASE WHEN visit_date >= ? AND visit_date < ? THEN 1 ELSE 0 END) AS week_count,
                    SUM(CASE WHEN visit_date >= ? AND visit_date < ? THEN 1 ELSE 0 END) AS month_count,
                    SUM(CASE WHEN visit_date >= ? AND visit_date < ? THEN 1 ELSE 0 END) AS year_count,
                    DATE_FORMAT(MIN(visit_date), '%Y-%m-%d') AS started_at
               FROM wgs_daily_visitors`,
            [today, yesterday, weekStart, tomorrow, currentMonthStart, tomorrow, currentYearStart, tomorrow]
        );
        const [series, previousSeries] = await Promise.all([
            querySeries(definition),
            querySeries(previousDefinition),
        ]);
        const summaryRow = summaryRows?.[0] || {};
        const currentTotal = series.reduce((sum, item) => sum + item.count, 0);
        const previousTotal = previousSeries.reduce((sum, item) => sum + item.count, 0);
        const change = currentTotal - previousTotal;
        const changeRate = previousTotal === 0
            ? (currentTotal === 0 ? 0 : null)
            : Number(((change / previousTotal) * 100).toFixed(1));

        return {
            period: normalizedPeriod,
            anchor: definition.anchor,
            timezone: TIMEZONE,
            range: {
                start: definition.start,
                end: addDays(definition.endExclusive, -1),
            },
            summary: {
                todayCount: numeric(summaryRow.today_count),
                yesterdayCount: numeric(summaryRow.yesterday_count),
                weekCount: numeric(summaryRow.week_count),
                monthCount: numeric(summaryRow.month_count),
                yearCount: numeric(summaryRow.year_count),
                totalCount: numeric(summaryRow.total_count),
                startedAt: normalizedStartedAt(summaryRow.started_at),
            },
            totals: {
                current: currentTotal,
                previous: previousTotal,
                change,
                changeRate,
            },
            series,
        };
    }

    return {
        recordVisit,
        getPublicSummary,
        getAdminStats,
        invalidateSummaryCache,
        hashClientId,
        issueAdminExclusionToken,
        verifyAdminExclusionToken,
        createAdminExclusionCookie,
        createAdminExclusionClearCookie,
        adminExclusionCookieName: ADMIN_EXCLUSION_COOKIE_NAME,
        adminExclusionMaxAgeSeconds,
        timezone: TIMEZONE,
    };
}

module.exports = {
    TIMEZONE,
    VALID_PERIODS,
    ADMIN_EXCLUSION_COOKIE_NAME,
    VisitorAnalyticsInputError,
    createVisitorAnalyticsService,
    validateClientId,
    isAutomatedVisitRequest,
    getKstParts,
    getKstDateKey,
    getKstDateTime,
    parseDateKey,
    addDays,
    startOfKstWeek,
    buildPeriodDefinition,
    zeroFillSeries,
};
