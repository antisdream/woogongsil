'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    MemberLoginActivityInputError,
    createMemberLoginActivityService,
} = require('./services/memberLoginActivityService');
const registerVisitorRoutes = require('./routes/visitorRoutes');

const DEFAULT_HISTORY_COLUMNS = ['id', 'userId', 'time', 'action'];
const DEFAULT_USER_COLUMNS = ['id', 'is_primary_admin', 'is_operator'];

function firstValue(row, candidates) {
    for (const candidate of candidates) {
        const entry = Object.entries(row || {}).find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (!entry) continue;
        const value = entry[1];
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        return value;
    }
    return null;
}

function truthyRole(value) {
    return ['1', 'true', 'yes', 'y', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

class FakeMemberLoginPool {
    constructor({
        historyColumns = DEFAULT_HISTORY_COLUMNS,
        userColumns = DEFAULT_USER_COLUMNS,
        historyRows = [],
        users = [],
    } = {}) {
        this.historyColumns = [...historyColumns];
        this.userColumns = [...userColumns];
        this.historyRows = [...historyRows];
        this.users = [...users];
        this.queries = [];
    }

    hasColumn(columns, candidate) {
        return columns.some((column) => column.toLowerCase() === candidate.toLowerCase());
    }

    adminFilteringAvailable() {
        const hasUserKey = ['id', 'account', 'userId', 'user_id']
            .some((candidate) => this.hasColumn(this.userColumns, candidate));
        const hasRole = ['is_primary_admin', 'isPrimaryAdmin', 'is_operator', 'isOperator']
            .some((candidate) => this.hasColumn(this.userColumns, candidate));
        return hasUserKey && hasRole;
    }

    dailyRows() {
        const byMemberDay = new Map();
        for (const row of this.historyRows) {
            const member = firstValue(row, ['userId', 'user_id']);
            const loginAt = firstValue(row, ['time', 'created_at']);
            const actions = ['action', 'type']
                .map((column) => firstValue(row, [column]))
                .filter((value) => value !== null)
                .map((value) => String(value).trim());
            const isLogin = actions.some((action) => action.toLowerCase() === 'login' || action === '로그인');
            if (!member || !loginAt || !isLogin) continue;

            if (this.adminFilteringAvailable()) {
                const account = this.users.find((user) => (
                    String(firstValue(user, ['id', 'account', 'userId', 'user_id']) || '') === String(member)
                ));
                const isExcluded = account && ['is_primary_admin', 'isPrimaryAdmin', 'is_operator', 'isOperator']
                    .some((column) => truthyRole(firstValue(account, [column])));
                if (isExcluded) continue;
            }

            const loginText = String(loginAt).replace('T', ' ').slice(0, 19);
            const activityDate = loginText.slice(0, 10);
            const key = `${activityDate}\u0000${member}`;
            const existing = byMemberDay.get(key);
            if (!existing || loginText < existing.first_login_at) {
                byMemberDay.set(key, {
                    activity_date: activityDate,
                    member_key: String(member),
                    first_login_at: loginText,
                });
            }
        }
        return [...byMemberDay.values()];
    }

    async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        this.queries.push({ sql: normalized, params: [...params] });

        if (normalized.includes('member-login:columns')) {
            const rows = [
                ...this.historyColumns.map((column) => ({
                    TABLE_NAME: 'wgs_login_history',
                    COLUMN_NAME: column,
                    DATA_TYPE: 'varchar',
                })),
                ...this.userColumns.map((column) => ({
                    TABLE_NAME: 'wgs_users',
                    COLUMN_NAME: column,
                    DATA_TYPE: 'varchar',
                })),
            ];
            return [rows];
        }

        const dailyRows = this.dailyRows();
        if (normalized.includes('member-login:summary')) {
            const [
                today,
                weekStart, weekEnd,
                monthStart, monthEnd,
                yearStart, yearEnd,
                rangeStart, rangeEnd,
            ] = params;
            const inRange = (row, start, end) => row.activity_date >= start && row.activity_date < end;
            const first = dailyRows.map((row) => row.first_login_at).sort()[0] || null;
            return [[{
                total_count: dailyRows.length,
                today_count: dailyRows.filter((row) => row.activity_date === today).length,
                week_count: dailyRows.filter((row) => inRange(row, weekStart, weekEnd)).length,
                month_count: dailyRows.filter((row) => inRange(row, monthStart, monthEnd)).length,
                year_count: dailyRows.filter((row) => inRange(row, yearStart, yearEnd)).length,
                started_at: first ? first.slice(0, 10) : null,
                first_recorded_at: first,
                unique_member_count: new Set(dailyRows.map((row) => row.member_key)).size,
                range_unique_member_count: new Set(
                    dailyRows.filter((row) => inRange(row, rangeStart, rangeEnd)).map((row) => row.member_key)
                ).size,
            }]];
        }

        if (normalized.includes('member-login:series-hour')) {
            const counts = new Map();
            for (const row of dailyRows) {
                if (row.activity_date !== params[0]) continue;
                const hour = Number(row.first_login_at.slice(11, 13));
                counts.set(hour, (counts.get(hour) || 0) + 1);
            }
            return [[...counts.entries()].map(([bucket_key, activity_count]) => ({
                bucket_key,
                activity_count,
            }))];
        }

        if (normalized.includes('member-login:series-date')) {
            const counts = new Map();
            for (const row of dailyRows) {
                if (row.activity_date < params[0] || row.activity_date >= params[1]) continue;
                counts.set(row.activity_date, (counts.get(row.activity_date) || 0) + 1);
            }
            return [[...counts.entries()].map(([bucket_key, activity_count]) => ({
                bucket_key,
                activity_count,
            }))];
        }

        if (normalized.includes('member-login:series-month')) {
            const counts = new Map();
            for (const row of dailyRows) {
                if (row.activity_date < params[0] || row.activity_date >= params[1]) continue;
                const month = row.activity_date.slice(0, 7);
                counts.set(month, (counts.get(month) || 0) + 1);
            }
            return [[...counts.entries()].map(([bucket_key, activity_count]) => ({
                bucket_key,
                activity_count,
            }))];
        }

        throw new Error(`Unexpected SQL in member login activity test: ${normalized}`);
    }
}

function serviceFixture(pool, clock = () => new Date('2026-05-08T03:00:00.000Z')) {
    return createMemberLoginActivityService({ pool, clock });
}

function responseDouble() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        },
        append(name, value) {
            this.headers[String(name).toLowerCase()] = value;
        },
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
        },
        getHeader(name) {
            return this.headers[String(name).toLowerCase()];
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

function visitorServiceStub() {
    return {
        recordVisit: async () => ({ counted: false }),
        getPublicSummary: async () => ({ todayCount: 0, totalCount: 0 }),
        getAdminStats: async () => ({ period: 'day', series: [] }),
        verifyAdminExclusionToken: () => false,
        createAdminExclusionCookie: () => 'visitor-cookie=value',
        adminExclusionCookieName: 'visitor-cookie',
    };
}

test('daily activity deduplicates by member and KST date, uses first login hour, and excludes admin roles', async () => {
    const pool = new FakeMemberLoginPool({
        historyRows: [
            { userId: 'member-1', time: '2026-05-08 09:00:00', action: '로그인' },
            { userId: 'member-1', time: '2026-05-08 10:00:00', action: 'login' },
            { userId: 'member-1', time: '2026-05-09 08:00:00', action: 'LOGIN' },
            { userId: 'member-2', time: '2026-05-08 11:00:00', action: 'login' },
            { userId: 'member-2', time: '2026-05-08 12:00:00', action: '로그아웃' },
            { userId: 'primary', time: '2026-05-08 07:00:00', action: '로그인' },
            { userId: 'operator', time: '2026-05-08 08:00:00', action: 'login' },
            { userId: null, time: '2026-05-08 13:00:00', action: 'login' },
            { userId: '   ', time: '2026-05-08 14:00:00', action: '로그인' },
            { userId: 'member-3', time: null, action: '로그인' },
            { userId: 'member-3', time: '2026-05-08 15:00:00', action: null },
        ],
        users: [
            { id: 'member-1', is_primary_admin: 0, is_operator: 0 },
            { id: 'member-2', is_primary_admin: 0, is_operator: 0 },
            { id: 'primary', is_primary_admin: 1, is_operator: 0 },
            { id: 'operator', is_primary_admin: 0, is_operator: 1 },
        ],
    });
    const result = await serviceFixture(pool).getStats({ period: 'day', anchor: '2026-05-08' });

    assert.equal(result.available, true);
    assert.equal(result.metric, 'daily_unique_member_logins');
    assert.equal(result.scope, 'authenticated_members_only');
    assert.equal(result.timezone, 'Asia/Seoul');
    assert.deepEqual(result.range, { start: '2026-05-08', end: '2026-05-08' });
    assert.deepEqual(result.summary, {
        todayCount: 2,
        weekCount: 2,
        monthCount: 2,
        yearCount: 2,
        totalCount: 3,
        startedAt: '2026-05-08',
        firstRecordedAt: '2026-05-08 09:00:00',
        uniqueMemberCount: 2,
        rangeUniqueMemberCount: 2,
    });
    assert.equal(result.series.length, 24);
    assert.equal(result.series[9].count, 1);
    assert.equal(result.series[10].count, 0);
    assert.equal(result.series[11].count, 1);
    assert.deepEqual(result.metadata, { dailyDeduplicated: true, adminExcluded: true });

    const allSql = pool.queries.map((query) => query.sql).join('\n');
    assert.match(allSql, /wgs_login_history/);
    assert.match(allSql, /MIN\(source_rows\.login_at\)/);
    assert.match(allSql, /GROUP BY DATE\(source_rows\.login_at\), source_rows\.member_key/);
    assert.match(allSql, /NOT EXISTS/);
    assert.doesNotMatch(allSql, /wgs_daily_visitors/);
    assert.doesNotMatch(allSql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test('legacy user_id, created_at, and type columns remain available without role columns', async () => {
    const pool = new FakeMemberLoginPool({
        historyColumns: ['id', 'user_id', 'created_at', 'type'],
        userColumns: ['id', 'name'],
        historyRows: [
            { user_id: 'legacy-1', created_at: '2026-06-01 01:00:00', type: 'login' },
            { user_id: 'legacy-1', created_at: '2026-06-01 02:00:00', type: '로그인' },
            { user_id: 'legacy-2', created_at: '2026-06-01 03:00:00', type: 'LOGIN' },
        ],
    });
    const result = await serviceFixture(pool, () => new Date('2026-05-31T16:00:00.000Z'))
        .getStats({ period: 'day', anchor: '2026-06-01' });

    assert.equal(result.available, true);
    assert.equal(result.summary.totalCount, 2);
    assert.equal(result.summary.uniqueMemberCount, 2);
    assert.equal(result.summary.rangeUniqueMemberCount, 2);
    assert.equal(result.series[1].count, 1);
    assert.equal(result.series[3].count, 1);
    assert.equal(result.metadata.adminExcluded, false);
});

test('mixed schemas coalesce legacy values when newer columns are null', async () => {
    const pool = new FakeMemberLoginPool({
        historyColumns: ['id', 'userId', 'user_id', 'time', 'created_at', 'action', 'type'],
        userColumns: [],
        historyRows: [{
            userId: null,
            user_id: 'mixed-1',
            time: null,
            created_at: '2026-07-02 04:05:06',
            action: null,
            type: '로그인',
        }],
    });
    const result = await serviceFixture(pool, () => new Date('2026-07-01T19:05:06.000Z'))
        .getStats({ period: 'day', anchor: '2026-07-02' });

    assert.equal(result.available, true);
    assert.equal(result.summary.totalCount, 1);
    assert.equal(result.summary.firstRecordedAt, '2026-07-02 04:05:06');
    assert.equal(result.series[4].count, 1);
});

test('periods are zero-filled and the default anchor follows the KST day boundary', async () => {
    const pool = new FakeMemberLoginPool({ userColumns: [] });
    const service = serviceFixture(pool, () => new Date('2026-08-04T15:00:00.000Z'));

    const day = await service.getStats();
    const week = await service.getStats({ period: 'week', anchor: '2026-08-09' });
    const month = await service.getStats({ period: 'month', anchor: '2024-02-10' });
    const year = await service.getStats({ period: 'year', anchor: '2026-08-04' });

    assert.equal(day.anchor, '2026-08-05');
    assert.equal(day.series.length, 24);
    assert.deepEqual(week.range, { start: '2026-08-03', end: '2026-08-09' });
    assert.equal(week.series.length, 7);
    assert.equal(month.series.length, 29);
    assert.equal(year.series.length, 12);
    assert.ok([...day.series, ...week.series, ...month.series, ...year.series]
        .every((point) => point.count === 0));
});

test('missing history table or required legacy columns returns an explicit unavailable contract', async (t) => {
    const cases = [
        { name: 'table', columns: [], reason: 'login_history_table_missing' },
        { name: 'user column', columns: ['id', 'time', 'action'], reason: 'login_history_user_column_missing' },
        { name: 'time column', columns: ['id', 'userId', 'action'], reason: 'login_history_time_column_missing' },
        { name: 'action column', columns: ['id', 'userId', 'time'], reason: 'login_history_action_column_missing' },
    ];

    for (const item of cases) {
        await t.test(item.name, async () => {
            const pool = new FakeMemberLoginPool({ historyColumns: item.columns, userColumns: [] });
            const result = await serviceFixture(pool).getStats({ period: 'week', anchor: '2026-05-08' });
            assert.equal(result.available, false);
            assert.equal(result.reason, item.reason);
            assert.equal(result.metric, 'daily_unique_member_logins');
            assert.equal(result.summary.totalCount, 0);
            assert.equal(result.summary.startedAt, null);
            assert.equal(result.series.length, 7);
            assert.ok(result.series.every((point) => point.count === 0));
            assert.equal(pool.queries.length, 1);
        });
    }
});

test('invalid period and anchor values fail with stable 400 input errors', async () => {
    const service = serviceFixture(new FakeMemberLoginPool());
    await assert.rejects(
        service.getStats({ period: 'quarter', anchor: '2026-05-08' }),
        (error) => error instanceof MemberLoginActivityInputError
            && error.statusCode === 400
            && error.code === 'invalid_period'
    );
    await assert.rejects(
        service.getStats({ period: 'day', anchor: '2026-02-30' }),
        (error) => error instanceof MemberLoginActivityInputError
            && error.statusCode === 400
            && error.code === 'invalid_anchor'
    );
});

test('the separate admin route enforces admin auth and does not set the visitor exclusion cookie', async () => {
    const app = appDouble();
    let adminMode = false;
    let memberCalls = 0;
    const memberResult = {
        available: true,
        metric: 'daily_unique_member_logins',
        scope: 'authenticated_members_only',
        timezone: 'Asia/Seoul',
        period: 'week',
        anchor: '2026-05-08',
        range: { start: '2026-05-04', end: '2026-05-10' },
        summary: {
            todayCount: 0,
            weekCount: 0,
            monthCount: 0,
            yearCount: 0,
            totalCount: 0,
            startedAt: null,
            firstRecordedAt: null,
            uniqueMemberCount: 0,
            rangeUniqueMemberCount: 0,
        },
        series: [],
        metadata: { dailyDeduplicated: true, adminExcluded: true },
    };
    registerVisitorRoutes({
        app,
        visitorService: visitorServiceStub(),
        memberLoginActivityService: {
            getStats: async () => {
                memberCalls += 1;
                return memberResult;
            },
        },
        ensureVisitorAnalyticsSchema: async () => {},
        validateAdminSession: async () => adminMode
            ? { valid: true, isOperator: true }
            : { valid: false, reason: 'not_admin' },
    });
    const handler = app.handlers.get.get('/api/admin/member-login-activity/stats');

    assert.equal(typeof handler, 'function');
    assert.equal(typeof app.handlers.get.get('/api/admin/visitors/stats'), 'function');
    assert.equal(typeof app.handlers.post.get('/api/visitors/visit'), 'function');

    const rejected = responseDouble();
    await handler({ query: { period: 'week', anchor: '2026-05-08' } }, rejected);
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.body.success, false);
    assert.equal(memberCalls, 0);

    adminMode = true;
    const accepted = responseDouble();
    await handler({ query: { period: 'week', anchor: '2026-05-08' } }, accepted);
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(accepted.body, { success: true, ...memberResult });
    assert.equal(memberCalls, 1);
    assert.equal(accepted.headers['set-cookie'], undefined);
});

test('member login route returns input failures without calling or changing public visitor handlers', async () => {
    const app = appDouble();
    registerVisitorRoutes({
        app,
        visitorService: visitorServiceStub(),
        memberLoginActivityService: {
            getStats: async () => {
                throw new MemberLoginActivityInputError('bad period', 'invalid_period');
            },
        },
        ensureVisitorAnalyticsSchema: async () => {},
        validateAdminSession: async () => ({ valid: true, isPrimaryAdmin: true }),
    });
    const memberHandler = app.handlers.get.get('/api/admin/member-login-activity/stats');
    const response = responseDouble();
    await memberHandler({ query: { period: 'bad' } }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.reason, 'invalid_period');
    assert.equal(typeof app.handlers.get.get('/api/admin/visitors/stats'), 'function');
    assert.equal(typeof app.handlers.post.get('/api/visitors/visit'), 'function');
});
