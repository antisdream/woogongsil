'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const registerAdminUserListRoutes = require('./routes/admin/adminUserListRoutes');

function responseRecorder() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

function createHarness({ primary = true, passwordMatches = true } = {}) {
    const handlers = new Map();
    const app = {
        get(path, handler) { handlers.set(`GET ${path}`, handler); },
        post(path, handler) { handlers.set(`POST ${path}`, handler); },
    };
    const privacyLogs = [];
    const operationLogs = [];
    const rawUser = {
        id: 'member01',
        account: 'member01',
        userId: 'member01',
        name: '홍길동',
        email: 'member01@example.com',
        dDay: null,
        has_active_session: 1,
        created_at: new Date('2026-05-01T00:00:00Z'),
        last_login_at: null,
        last_logout_at: null,
        is_suspended: 0,
        suspension_reason: '',
        suspended_at: null,
        is_primary_admin: 0,
        is_operator: 0,
        operator_reason: '',
        operator_updated_at: null,
        operator_updated_by: '',
    };
    const pool = {
        async query(sql) {
            if (/SELECT COUNT\(\*\) AS total FROM wgs_users/i.test(sql)) return [[{ total: 1 }]];
            if (/SELECT COUNT\(\*\) AS cnt FROM wgs_users/i.test(sql)) return [[{ cnt: 1 }]];
            if (/SELECT[\s\S]+FROM wgs_users u[\s\S]+LIMIT \? OFFSET \?/i.test(sql)) return [[rawUser]];
            if (/SELECT id, name, email FROM wgs_users WHERE id = \? LIMIT 1/i.test(sql)) {
                return [[{ id: rawUser.id, name: rawUser.name, email: rawUser.email }]];
            }
            throw new Error(`Unexpected query in test: ${sql}`);
        },
    };
    const auth = {
        valid: true,
        isAdmin: true,
        isPrimaryAdmin: primary,
        user: { id: primary ? 'skn29' : 'operator01', name: primary ? '최고관리자' : '운영자' },
    };

    registerAdminUserListRoutes({
        app,
        pool,
        ensureAdminUserControlSchema: async () => {},
        adminTableExists: async (table) => table === 'wgs_users',
        adminColumnExists: async (_table, column) => [
            'email', 'dDay', 'sessionToken', 'created_at', 'last_login_at', 'last_logout_at',
            'is_suspended', 'suspension_reason', 'suspended_at', 'is_primary_admin', 'is_operator',
            'operator_reason', 'operator_updated_at', 'operator_updated_by', 'account',
        ].includes(column),
        adminGroupedCount: async () => ({}),
        getActiveUserList: () => [{ id: rawUser.id }],
        formatAdminDateTime: (value) => value ? new Date(value).toISOString() : '-',
        normalizeAdminBool: (value) => value === true || Number(value) === 1,
        isPrimaryAdminUser: (user) => Number(user?.is_primary_admin || 0) === 1,
        isAdminAccessUser: (user) => Number(user?.is_operator || 0) === 1,
        validateAdminSession: async () => auth,
        getUserById: async () => ({ id: auth.user.id, password: 'stored-hash' }),
        bcrypt: { compare: async () => passwordMatches },
        writeAdminOperationLog: async (entry) => operationLogs.push(entry),
        privacyService: {
            writeAccessLog: async (entry) => privacyLogs.push(entry),
        },
    });

    return { handlers, privacyLogs, operationLogs, rawUser };
}

test('member list returns masked fields, no-store headers, and server pagination metadata', async () => {
    const harness = createHarness();
    const handler = harness.handlers.get('GET /api/admin/users');
    const req = {
        query: { page: '1', pageSize: '20', sortKey: 'name', sortDirection: 'asc' },
        headers: { 'user-agent': 'unit-test' },
        params: {},
    };
    const res = responseRecorder();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'private, no-store, max-age=0');
    assert.equal(res.body.pagination.total, 1);
    assert.equal(res.body.pagination.pageSize, 20);
    assert.equal(res.body.users[0].name, '홍*동');
    assert.equal(res.body.users[0].email, 'm***1@example.com');
    assert.equal(res.body.users[0].hasEmail, true);
    assert.equal(JSON.stringify(res.body).includes('홍길동'), false);
    assert.equal(JSON.stringify(res.body).includes('member01@example.com'), false);
    assert.equal(harness.privacyLogs[0].action, 'list_masked');
});

test('operator cannot reveal member name or email', async () => {
    const harness = createHarness({ primary: false });
    const handler = harness.handlers.get('POST /api/admin/users/:userId/privacy-reveal');
    const req = {
        params: { userId: harness.rawUser.id },
        body: { password: 'correct-password', reason: '회원 문의 본인 확인' },
        headers: {},
    };
    const res = responseRecorder();

    await handler(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.reason, 'primary_admin_required');
    assert.equal(JSON.stringify(res.body).includes(harness.rawUser.email), false);
    assert.equal(harness.privacyLogs[0].outcome, 'denied_role');
});

test('primary admin reauthentication reveals one record and writes both privacy and operation audit logs', async () => {
    const harness = createHarness({ primary: true, passwordMatches: true });
    const handler = harness.handlers.get('POST /api/admin/users/:userId/privacy-reveal');
    const req = {
        params: { userId: harness.rawUser.id },
        body: { password: 'correct-password', reason: '회원 문의 본인 확인' },
        headers: {},
    };
    const res = responseRecorder();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.target, {
        id: harness.rawUser.id,
        name: harness.rawUser.name,
        email: harness.rawUser.email,
    });
    assert.equal(res.body.expiresInSeconds, 60);
    assert.equal(harness.privacyLogs.at(-1).outcome, 'success');
    assert.equal(harness.operationLogs.length, 1);
    assert.equal(harness.operationLogs[0].operationType, 'privacy_access');
});

test('wrong primary-admin password never returns raw personal data', async () => {
    const harness = createHarness({ primary: true, passwordMatches: false });
    const handler = harness.handlers.get('POST /api/admin/users/:userId/privacy-reveal');
    const req = {
        params: { userId: harness.rawUser.id },
        body: { password: 'wrong-password', reason: '회원 문의 본인 확인' },
        headers: {},
    };
    const res = responseRecorder();

    await handler(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.reason, 'invalid_admin_password');
    assert.equal(JSON.stringify(res.body).includes(harness.rawUser.name), false);
    assert.equal(JSON.stringify(res.body).includes(harness.rawUser.email), false);
    assert.equal(harness.privacyLogs.at(-1).outcome, 'denied_password');
});
