'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createVisitorAnalyticsService,
    validateClientId,
    isAutomatedVisitRequest,
    getKstDateKey,
    getKstDateTime,
    buildPeriodDefinition,
    zeroFillSeries,
} = require('./services/visitorAnalyticsService');
const {
    clusterLoginHistoryRows,
    createVisitorAnalyticsSchema,
} = require('./services/visitorAnalyticsSchema');
const registerVisitorRoutes = require('./routes/visitorRoutes');

class FakeVisitorPool {
    constructor() {
        this.rows = new Map();
        this.createCount = 0;
    }

    async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();

        if (normalized.includes('CREATE TABLE IF NOT EXISTS wgs_daily_visitors')) {
            this.createCount += 1;
            return [{ affectedRows: 0 }];
        }

        if (normalized.includes('CREATE TABLE IF NOT EXISTS wgs_visit_sessions')
            || normalized.includes('CREATE TABLE IF NOT EXISTS wgs_visit_login_events')
            || normalized.includes('visit-session:backfill-legacy-daily')
            || normalized.includes('visit-session:backfill-login-sessions')
            || normalized.includes('visit-session:backfill-login-events')) {
            return [{ affectedRows: 0 }];
        }

        if (normalized.includes('visit-session:backfill-columns')) {
            return [[
                { TABLE_NAME: 'wgs_login_history', COLUMN_NAME: 'id' },
                { TABLE_NAME: 'wgs_login_history', COLUMN_NAME: 'userId' },
                { TABLE_NAME: 'wgs_login_history', COLUMN_NAME: 'time' },
                { TABLE_NAME: 'wgs_login_history', COLUMN_NAME: 'action' },
                { TABLE_NAME: 'wgs_users', COLUMN_NAME: 'id' },
                { TABLE_NAME: 'wgs_users', COLUMN_NAME: 'is_primary_admin' },
                { TABLE_NAME: 'wgs_users', COLUMN_NAME: 'is_operator' },
            ]];
        }

        if (normalized.includes('visit-session:select-login-backfill')) {
            return [[]];
        }

        if (normalized.includes('visitor:insert')) {
            await new Promise((resolve) => setImmediate(resolve));
            const [visitDate, visitorHash, firstSeenAt, lastSeenAt] = params;
            const key = `${visitDate}:${visitorHash}`;
            if (this.rows.has(key)) {
                const error = new Error('Duplicate visitor');
                error.code = 'ER_DUP_ENTRY';
                throw error;
            }
            this.rows.set(key, {
                visitDate,
                visitorHash,
                firstSeenAt,
                lastSeenAt,
                requestCount: 1,
            });
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visitor:touch')) {
            const [lastSeenAt, visitDate, visitorHash] = params;
            const row = this.rows.get(`${visitDate}:${visitorHash}`);
            if (!row) return [{ affectedRows: 0 }];
            if (lastSeenAt > row.lastSeenAt) row.lastSeenAt = lastSeenAt;
            row.requestCount += 1;
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visitor:public-summary')) {
            const today = params[0];
            const values = [...this.rows.values()];
            const startedAt = values.map((row) => row.visitDate).sort()[0] || null;
            return [[{
                total_count: values.length,
                today_count: values.filter((row) => row.visitDate === today).length,
                started_at: startedAt,
            }]];
        }

        if (normalized.includes('visitor:admin-summary')) {
            const [today, yesterday, weekStart, tomorrowForWeek, monthStart, tomorrowForMonth, yearStart, tomorrowForYear] = params;
            const values = [...this.rows.values()];
            const between = (row, start, end) => row.visitDate >= start && row.visitDate < end;
            return [[{
                total_count: values.length,
                today_count: values.filter((row) => row.visitDate === today).length,
                yesterday_count: values.filter((row) => row.visitDate === yesterday).length,
                week_count: values.filter((row) => between(row, weekStart, tomorrowForWeek)).length,
                month_count: values.filter((row) => between(row, monthStart, tomorrowForMonth)).length,
                year_count: values.filter((row) => between(row, yearStart, tomorrowForYear)).length,
                started_at: values.map((row) => row.visitDate).sort()[0] || null,
            }]];
        }

        if (normalized.includes('visitor:series-hour')) {
            const counts = new Map();
            for (const row of this.rows.values()) {
                if (row.visitDate !== params[0]) continue;
                const hour = Number(row.firstSeenAt.slice(11, 13));
                counts.set(hour, (counts.get(hour) || 0) + 1);
            }
            return [[...counts.entries()].map(([bucket_key, visitor_count]) => ({ bucket_key, visitor_count }))];
        }

        if (normalized.includes('visitor:series-date')) {
            const counts = new Map();
            for (const row of this.rows.values()) {
                if (row.visitDate < params[0] || row.visitDate >= params[1]) continue;
                counts.set(row.visitDate, (counts.get(row.visitDate) || 0) + 1);
            }
            return [[...counts.entries()].map(([bucket_key, visitor_count]) => ({ bucket_key, visitor_count }))];
        }

        if (normalized.includes('visitor:series-month')) {
            const counts = new Map();
            for (const row of this.rows.values()) {
                if (row.visitDate < params[0] || row.visitDate >= params[1]) continue;
                const month = row.visitDate.slice(0, 7);
                counts.set(month, (counts.get(month) || 0) + 1);
            }
            return [[...counts.entries()].map(([bucket_key, visitor_count]) => ({ bucket_key, visitor_count }))];
        }

        throw new Error(`Unexpected SQL in visitor test: ${normalized}`);
    }
}

function serviceFixture(
    pool = new FakeVisitorPool(),
    clock = () => new Date('2026-08-04T03:00:00.000Z'),
    envOverrides = {}
) {
    return {
        pool,
        service: createVisitorAnalyticsService({
            pool,
            clock,
            env: {
                NODE_ENV: 'test',
                VISITOR_HASH_SECRET: 'unit-test-visitor-secret-with-at-least-32-characters',
                VISITOR_SUMMARY_CACHE_MS: '0',
                ...envOverrides,
            },
        }),
    };
}

function browserRequest(headers = {}) {
    return {
        headers: {
            'user-agent': 'Mozilla/5.0 WGS visitor analytics test',
            ...headers,
        },
    };
}

function responseDouble() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
        },
        getHeader(name) {
            return this.headers[String(name).toLowerCase()];
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        },
    };
}

function appDouble() {
    const handlers = { get: new Map(), post: new Map() };
    return {
        handlers,
        get(path, handler) { handlers.get.set(path, handler); },
        post(path, handler) { handlers.post.set(path, handler); },
    };
}

test('client ID validation accepts current WGS IDs and rejects unsafe or oversized values', () => {
    assert.equal(validateClientId('wgs-4f7c5cee-d995-49da-bcf4-c08862863b61'), 'wgs-4f7c5cee-d995-49da-bcf4-c08862863b61');
    assert.equal(validateClientId('wgs-fallback-1770000000000-abcd1234'), 'wgs-fallback-1770000000000-abcd1234');
    assert.equal(validateClientId('not-wgs-12345678'), null);
    assert.equal(validateClientId('wgs-too short'), null);
    assert.equal(validateClientId(`wgs-${'a'.repeat(181)}`), null);
    assert.equal(validateClientId(null), null);
});

test('KST date boundaries change at 15:00 UTC and preserve millisecond wall time', () => {
    assert.equal(getKstDateKey(new Date('2026-08-04T14:59:59.999Z')), '2026-08-04');
    assert.equal(getKstDateKey(new Date('2026-08-04T15:00:00.000Z')), '2026-08-05');
    assert.equal(getKstDateTime(new Date('2026-08-04T15:00:00.123Z')), '2026-08-05 00:00:00.123');
});

test('bot, monitoring, prefetch, and missing user agents are ignored', () => {
    assert.equal(isAutomatedVisitRequest(browserRequest()), false);
    assert.equal(isAutomatedVisitRequest(browserRequest({ purpose: 'prefetch' })), true);
    assert.equal(isAutomatedVisitRequest(browserRequest({ 'user-agent': 'Googlebot/2.1' })), true);
    assert.equal(isAutomatedVisitRequest(browserRequest({ 'user-agent': 'curl/8.12.1' })), true);
    assert.equal(isAutomatedVisitRequest(browserRequest({ 'user-agent': 'HeadlessChrome/140.0' })), true);
    assert.equal(isAutomatedVisitRequest(browserRequest({ 'user-agent': 'site-uptime-monitoring' })), true);
    assert.equal(isAutomatedVisitRequest({ headers: {} }), true);
});

test('production requires a stable visitor HMAC secret', () => {
    assert.throws(() => createVisitorAnalyticsService({
        pool: new FakeVisitorPool(),
        env: { NODE_ENV: 'production' },
    }), /VISITOR_HASH_SECRET/);
    assert.throws(() => createVisitorAnalyticsService({
        pool: new FakeVisitorPool(),
        env: { NODE_ENV: 'production', VISITOR_HASH_SECRET: 'too-short' },
    }), /at least 32/);
});

test('admin exclusion tokens are HMAC protected and stop working at expiry', () => {
    const now = new Date('2026-08-04T03:00:00.000Z');
    const { service } = serviceFixture(new FakeVisitorPool(), () => now);
    const issued = service.issueAdminExclusionToken();

    assert.equal(service.verifyAdminExclusionToken(issued.token, {
        now: new Date('2026-08-04T10:59:59.000Z'),
    }), true);
    assert.equal(service.verifyAdminExclusionToken(issued.token, {
        now: new Date('2026-08-04T11:00:00.000Z'),
    }), false);
    assert.equal(service.verifyAdminExclusionToken(`${issued.token.slice(0, -1)}x`, { now }), false);
    assert.equal(service.verifyAdminExclusionToken('v1.9999999999.not-a-signature', { now }), false);

    const { service: differentSecretService } = serviceFixture(
        new FakeVisitorPool(),
        () => now,
        { VISITOR_HASH_SECRET: 'a-different-unit-test-secret-with-at-least-32-characters' }
    );
    assert.equal(differentSecretService.verifyAdminExclusionToken(issued.token, { now }), false);
});

test('admin exclusion cookie has a scoped HttpOnly TTL and is Secure in production', () => {
    const now = new Date('2026-08-04T03:00:00.000Z');
    const { service } = serviceFixture(new FakeVisitorPool(), () => now);
    const localCookie = service.createAdminExclusionCookie();
    assert.match(localCookie, /^wgs_visitor_admin_exclusion=v1\./);
    assert.match(localCookie, /Max-Age=28800/);
    assert.match(localCookie, /Expires=Tue, 04 Aug 2026 11:00:00 GMT/);
    assert.match(localCookie, /Path=\/api\/visitors/);
    assert.match(localCookie, /HttpOnly/);
    assert.match(localCookie, /SameSite=Strict/);
    assert.doesNotMatch(localCookie, /; Secure/);

    const { service: productionService } = serviceFixture(
        new FakeVisitorPool(),
        () => now,
        {
            NODE_ENV: 'production',
            VISITOR_HASH_SECRET: 'production-test-secret-with-at-least-32-characters',
            VISITOR_ADMIN_EXCLUSION_TTL_HOURS: '100',
        }
    );
    const productionCookie = productionService.createAdminExclusionCookie();
    assert.match(productionCookie, /Max-Age=86400/);
    assert.match(productionCookie, /; Secure/);

    const localClearCookie = service.createAdminExclusionClearCookie();
    assert.match(localClearCookie, /^wgs_visitor_admin_exclusion=;/);
    assert.match(localClearCookie, /Max-Age=0/);
    assert.match(localClearCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    assert.match(localClearCookie, /Path=\/api\/visitors/);
    assert.match(localClearCookie, /HttpOnly/);
    assert.match(localClearCookie, /SameSite=Strict/);
    assert.doesNotMatch(localClearCookie, /; Secure/);

    const productionClearCookie = productionService.createAdminExclusionClearCookie();
    assert.match(productionClearCookie, /Max-Age=0/);
    assert.match(productionClearCookie, /; Secure/);
});

test('schema initialization is idempotent even when called concurrently', async () => {
    const pool = new FakeVisitorPool();
    const schema = createVisitorAnalyticsSchema({ pool });
    await Promise.all(Array.from({ length: 20 }, () => schema.ensureVisitorAnalyticsSchema()));
    await schema.ensureVisitorAnalyticsSchema();
    assert.equal(pool.createCount, 1);
});

test('login history rows form five-minute per-member session clusters', () => {
    const minute = 60 * 1000;
    const base = Date.parse('2026-05-08T00:00:00.000Z');
    const rows = [
        { history_id: 'a-0', member_id: 'member-a', login_at: '2026-05-08 09:00:00.000', login_at_ms: base },
        { history_id: 'a-4', member_id: 'member-a', login_at: '2026-05-08 09:04:00.000', login_at_ms: base + 4 * minute },
        { history_id: 'a-8', member_id: 'member-a', login_at: '2026-05-08 09:08:00.000', login_at_ms: base + 8 * minute },
        { history_id: 'a-14', member_id: 'member-a', login_at: '2026-05-08 09:14:00.000', login_at_ms: base + 14 * minute },
        { history_id: 'b-0', member_id: 'member-b', login_at: '2026-05-08 09:00:00.000', login_at_ms: base },
    ];
    const originalRows = rows.map((row) => ({ ...row }));

    const clusters = clusterLoginHistoryRows(rows);

    assert.deepEqual(rows, originalRows);
    assert.equal(clusters.length, 3);
    assert.deepEqual(clusters.map((cluster) => ({
        memberId: cluster.memberId,
        sourceRef: cluster.sourceRef,
        eventIds: cluster.events.map((event) => event.historyId),
    })), [
        { memberId: 'member-a', sourceRef: 'a-0', eventIds: ['a-0', 'a-4', 'a-8'] },
        { memberId: 'member-a', sourceRef: 'a-14', eventIds: ['a-14'] },
        { memberId: 'member-b', sourceRef: 'b-0', eventIds: ['b-0'] },
    ]);
    assert.equal(clusters[0].startedAt, '2026-05-08 09:00:00.000');
    assert.equal(clusters[0].lastSeenAt, '2026-05-08 09:08:00.000');
});

test('concurrent same-day calls count one daily visitor and store only an HMAC', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-4f7c5cee-d995-49da-bcf4-c08862863b61';
    const results = await Promise.all(Array.from({ length: 50 }, () => service.recordVisit({
        clientId,
        request: browserRequest(),
    })));

    assert.equal(results.filter((result) => result.counted).length, 1);
    assert.equal(pool.rows.size, 1);
    const stored = [...pool.rows.values()][0];
    assert.equal(stored.visitorHash.length, 64);
    assert.doesNotMatch(stored.visitorHash, /wgs-/);
    assert.equal(JSON.stringify(stored).includes(clientId), false);
    assert.equal(stored.requestCount, 50);
    assert.equal(results.at(-1).todayCount, 1);
    assert.equal(results.at(-1).totalCount, 1);
});

test('the same browser counts again after the KST day boundary', async () => {
    const { service } = serviceFixture();
    const clientId = 'wgs-12345678-abcd-efgh-ijkl-1234567890ab';
    const before = await service.recordVisit({
        clientId,
        request: browserRequest(),
        now: new Date('2026-08-04T14:59:59.000Z'),
    });
    const after = await service.recordVisit({
        clientId,
        request: browserRequest(),
        now: new Date('2026-08-04T15:00:01.000Z'),
    });
    assert.equal(before.counted, true);
    assert.equal(after.counted, true);
    assert.equal(after.todayCount, 1);
    assert.equal(after.totalCount, 2);
});

test('automated requests do not write a visitor row', async () => {
    const { pool, service } = serviceFixture();
    const result = await service.recordVisit({
        clientId: 'wgs-12345678-abcd-efgh-ijkl-1234567890ab',
        request: browserRequest({ purpose: 'prefetch' }),
    });
    assert.equal(result.counted, false);
    assert.equal(result.ignored, true);
    assert.equal(result.reason, 'automated_request');
    assert.equal(pool.rows.size, 0);
});

test('period builders and zero fill cover every KST bucket including leap day', () => {
    const day = zeroFillSeries(buildPeriodDefinition('day', '2024-02-29'), [
        { bucket_key: 0, visitor_count: 2 },
        { bucket_key: 23, visitor_count: 4 },
    ]);
    assert.equal(day.length, 24);
    assert.equal(day[0].count, 2);
    assert.equal(day[12].count, 0);
    assert.equal(day[23].count, 4);

    const weekDef = buildPeriodDefinition('week', '2026-08-09');
    assert.equal(weekDef.start, '2026-08-03');
    assert.equal(weekDef.endExclusive, '2026-08-10');
    assert.equal(zeroFillSeries(weekDef, []).length, 7);

    const monthDef = buildPeriodDefinition('month', '2024-02-10');
    const month = zeroFillSeries(monthDef, [
        { bucket_key: '2024-02-29', visitor_count: 7 },
    ]);
    assert.equal(month.length, 29);
    assert.equal(month[0].count, 0);
    assert.equal(month[28].count, 7);

    assert.equal(zeroFillSeries(buildPeriodDefinition('year', '2026-08-04'), []).length, 12);
});

test('admin stats return zero-filled series and consistent current totals', async () => {
    const { service } = serviceFixture();
    await service.recordVisit({
        clientId: 'wgs-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        request: browserRequest(),
        now: new Date('2026-08-04T03:00:00.000Z'),
    });
    await service.recordVisit({
        clientId: 'wgs-ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee',
        request: browserRequest(),
        now: new Date('2026-08-04T04:00:00.000Z'),
    });
    const stats = await service.getAdminStats({ period: 'day', anchor: '2026-08-04' });
    assert.equal(stats.series.length, 24);
    assert.equal(stats.series[12].count, 1);
    assert.equal(stats.series[13].count, 1);
    assert.equal(stats.totals.current, 2);
    assert.equal(stats.summary.todayCount, 2);
    assert.equal(stats.summary.totalCount, 2);
    assert.deepEqual(stats.range, { start: '2026-08-04', end: '2026-08-04' });
});

test('admin stats issues a companion marker and public POST excludes it without revalidating admin', async () => {
    const { service, pool } = serviceFixture();
    const app = appDouble();
    let validateCalls = 0;
    registerVisitorRoutes({
        app,
        pool,
        visitorService: service,
        visitSessionService: service,
        ensureVisitorAnalyticsSchema: async () => {},
        validateAdminSession: async () => {
            validateCalls += 1;
            return { valid: true, isAdmin: true };
        },
    });
    const statsHandler = app.handlers.get.get('/api/admin/visitors/stats');
    const visitHandler = app.handlers.post.get('/api/visitors/visit');

    const statsResponse = responseDouble();
    await statsHandler({ query: { period: 'week', anchor: '2026-08-04' } }, statsResponse);
    assert.equal(statsResponse.statusCode, 200);
    assert.equal(statsResponse.body.success, true);
    assert.equal(validateCalls, 1);
    const setCookie = statsResponse.headers['set-cookie'];
    assert.match(setCookie, /Path=\/api\/visitors/);
    const companionCookie = String(setCookie).split(';')[0];

    const adminResponse = responseDouble();
    await visitHandler({
        headers: {
            'x-wgs-client-id': 'wgs-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'user-agent': 'Mozilla/5.0',
            cookie: companionCookie,
        },
    }, adminResponse);
    assert.equal(adminResponse.statusCode, 200);
    assert.equal(adminResponse.body.success, true);
    assert.equal(adminResponse.body.reason, 'admin_excluded');
    assert.equal(pool.rows.size, 0);
    assert.equal(validateCalls, 1);

    const visitorResponse = responseDouble();
    await visitHandler({
        headers: {
            'x-wgs-client-id': 'wgs-bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
            'user-agent': 'Mozilla/5.0',
        },
    }, visitorResponse);
    assert.equal(visitorResponse.statusCode, 200);
    assert.equal(visitorResponse.body.success, true);
    assert.equal(visitorResponse.body.counted, true);
    assert.equal(pool.rows.size, 1);
    assert.equal(validateCalls, 1);
});

test('admin stats route rejects a non-admin and returns direct fields for an admin', async () => {
    const { service, pool } = serviceFixture();
    const app = appDouble();
    let adminMode = false;
    registerVisitorRoutes({
        app,
        pool,
        visitorService: service,
        visitSessionService: service,
        ensureVisitorAnalyticsSchema: async () => {},
        validateAdminSession: async () => adminMode
            ? { valid: true, isOperator: true }
            : { valid: false, reason: 'not_admin' },
    });
    const handler = app.handlers.get.get('/api/admin/visitors/stats');

    const rejected = responseDouble();
    await handler({ query: { period: 'week', anchor: '2026-08-04' } }, rejected);
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.body.success, false);

    adminMode = true;
    const accepted = responseDouble();
    await handler({ query: { period: 'week', anchor: '2026-08-04' } }, accepted);
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.success, true);
    assert.equal(accepted.body.period, 'week');
    assert.equal(accepted.body.series.length, 7);
    assert.match(accepted.headers['set-cookie'], /wgs_visitor_admin_exclusion=/);
});
