'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
    createAdminSessionService,
    isInternalApprovalBypassRequest,
    parseCookies,
    safeEqual,
} = require('./services/adminSessionService');
const registerAdminAuthRoutes = require('./routes/auth/adminAuthRoutes');

const { AdminOtpPool } = require('./test-support/adminOtpPool');
const { createAdminEmailOtpService } = require('./services/adminEmailOtpService');

class FakePool extends AdminOtpPool {
    constructor() {
        super();
        this.sessions = [];
        this.nextId = 1;
    }

    async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('CREATE TABLE IF NOT EXISTS wgs_admin_sessions')) return [{ affectedRows: 0 }];
        if (normalized.startsWith('CREATE TABLE IF NOT EXISTS wgs_admin_email_otp')) return super.query(normalized);
        if (normalized.startsWith('SHOW COLUMNS')) return [[{ Field: 'email_otp_verified_at' }]];
        if (normalized.startsWith('INSERT INTO wgs_admin_operation_logs')) return [{ affectedRows: 1 }];

        if (normalized.startsWith('INSERT INTO wgs_admin_sessions')) {
            const [sessionHash, userId, createdAt, lastSeenAt, idleExpiresAt, absoluteExpiresAt, ipHash, userAgentHash, emailOtpVerifiedAt] = params;
            const row = {
                id: this.nextId++,
                session_hash: sessionHash,
                user_id: userId,
                created_at: createdAt,
                last_seen_at: lastSeenAt,
                idle_expires_at: idleExpiresAt,
                absolute_expires_at: absoluteExpiresAt,
                revoked_at: null,
                revoke_reason: null,
                ip_hash: ipHash,
                user_agent_hash: userAgentHash,
                email_otp_verified_at: emailOtpVerifiedAt,
            };
            this.sessions.push(row);
            return [{ affectedRows: 1, insertId: row.id }];
        }

        if (normalized.startsWith('SELECT id, session_hash')) {
            const row = this.sessions.find((item) => item.session_hash === params[0]);
            return [row ? [{ ...row }] : []];
        }

        if (normalized.startsWith('UPDATE wgs_admin_sessions SET last_seen_at')) {
            const row = this.sessions.find((item) => item.id === params[2] && !item.revoked_at);
            if (!row) return [{ affectedRows: 0 }];
            row.last_seen_at = params[0];
            row.idle_expires_at = params[1];
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('WHERE session_hash = ?')) {
            const row = this.sessions.find((item) => item.session_hash === params[1]);
            if (!row) return [{ affectedRows: 0 }];
            if (!row.revoked_at) {
                row.revoked_at = new Date();
                row.revoke_reason = params[0];
            }
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('WHERE user_id = ? AND revoked_at IS NULL')) {
            let affectedRows = 0;
            for (const row of this.sessions) {
                if (row.user_id === params[1] && !row.revoked_at) {
                    row.revoked_at = new Date();
                    row.revoke_reason = params[0];
                    affectedRows += 1;
                }
            }
            return [{ affectedRows }];
        }

        throw new Error(`Unexpected SQL in test: ${normalized}`);
    }
}

function responseDouble() {
    return {
        headers: {},
        statusCode: 200,
        body: null,
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

function createFixture(options = {}) {
    const pool = new FakePool();
    const user = {
        id: 'skn29',
        name: '관리자',
        email: 'admin@example.test',
        is_primary_admin: 1,
        is_operator: 1,
        is_suspended: 0,
    };
    const service = createAdminSessionService({
        pool,
        crypto,
        env: {
            NODE_ENV: 'development',
            PUBLIC_SITE_URL: 'http://localhost:5000',
            ADMIN_CSRF_SECRET: 'unit-test-admin-csrf-secret',
            ADMIN_SESSION_IDLE_MINUTES: '30',
            ADMIN_SESSION_ABSOLUTE_HOURS: '8',
        },
        getAdminUserControl: async (userId) => userId === user.id ? { ...user } : null,
        normalizeAdminBool: (value) => value === true || value === 1 || value === '1',
        isAdminAccessUser: (candidate) => Boolean(candidate?.is_primary_admin || candidate?.is_operator),
        isPrimaryAdminUser: (candidate) => Boolean(candidate?.is_primary_admin),
        ...options,
    });
    return { pool, service, user };
}

test('only skn29 can create a session and older operator sessions are revoked', async () => {
    const { service, pool, user } = createFixture();
    await assert.rejects(service.createSession('another-admin', {}), /account is not allowed/);
    const created = await service.createSession(user.id, { headers: {} }, { emailOtpVerified: true });
    pool.sessions[0].user_id = 'another-admin';
    const result = await service.authenticateRequest({ headers: { cookie: `${service.cookieName}=${created.rawToken}` } });
    assert.equal(result.valid, false);
    assert.equal(result.statusCode, 403);
    assert.equal(pool.sessions[0].revoke_reason, 'account_not_allowed');
});

test('HTTP login requires password and email OTP before any administrator session exists', async (t) => {
    const express = require('express');
    const bcrypt = require('bcrypt');
    const { pool, service, user } = createFixture();
    const password = 'isolated-http-test-password';
    const passwordHash = await bcrypt.hash(password, 4);
    const mails = [];
    const otp = createAdminEmailOtpService({ pool, env: { NODE_ENV: 'development' }, sendEmail: async (to, subject, text) => { mails.push({ to, text }); return { success: true }; } });
    const users = [user, { ...user, id: 'another-admin' }, { ...user, id: 'SKN29' }];
    const app = express();
    app.use(express.json());
    app.use('/api/admin', service.protect);
    registerAdminAuthRoutes({
        app, pool, bcrypt,
        getUserById: async (id) => {
            const found = users.find((candidate) => candidate.id === id);
            return found ? { ...found, password: passwordHash } : null;
        },
        getAdminUserControl: async (id) => users.find((candidate) => candidate.id === id),
        ensureAdminUserControlSchema: async () => {},
        normalizeAdminBool: Boolean,
        isAdminAccessUser: (candidate) => Boolean(candidate?.is_primary_admin || candidate?.is_operator),
        isPrimaryAdminUser: (candidate) => Boolean(candidate?.is_primary_admin),
        adminSessionService: service,
        adminEmailOtpService: otp,
        visitSessionService: { excludeClientSession: async () => {} },
        visitorAnalyticsService: { createAdminExclusionCookie: () => 'qa_exclusion=1; Path=/; HttpOnly; SameSite=Strict' },
    });
    app.post('/api/admin/qa-write', (req, res) => res.json({ user: req.adminAuth.user.id }));
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => error ? reject(error) : resolve());
    }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const origin = 'http://localhost:5000';
    const post = (path, body, headers = {}) => fetch(base + path, {
        method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers },
        body: JSON.stringify(body),
    });
    assert.equal((await fetch(base + '/api/admin/auth/me')).status, 401);
    assert.equal((await fetch(base + '/api/admin/auth/me', {
        headers: { 'x-wgs-admin-verify': 'SUCCESS', 'x-wgs-admin-gateway': 'untrusted' },
    })).status, 401);
    for (const id of ['another-admin', 'SKN29', 'missing-user']) {
        const rejected = await post('/api/admin/auth/login', { id, password });
        assert.equal(rejected.status, 401, id);
        assert.equal((await rejected.json()).reason, 'invalid_admin_credentials');
    }
    assert.equal((await post('/api/admin/auth/login', { id: 'skn29', password: 'wrong' })).status, 401);
    user.is_suspended = 1;
    assert.equal((await post('/api/admin/auth/login', { id: 'skn29', password })).status, 401);
    user.is_suspended = 0;
    assert.equal((await post('/api/admin/auth/login', { id: 'skn29', password }, { origin: 'https://evil.example' })).status, 403);
    assert.equal(pool.sessions.length, 0);

    const login = await post('/api/admin/auth/login', { id: 'skn29', password });
    assert.equal(login.status, 202);
    const pending = await login.json();
    assert.equal(pending.valid, false);
    assert.equal(pending.admin, undefined);
    assert.equal(pending.rawToken, undefined);
    assert.equal(pool.sessions.length, 0);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, user.email);
    const pendingCookie = login.headers.getSetCookie().find(value => value.startsWith(otp.cookieName + '=')).split(';')[0];
    assert.equal((await fetch(base + '/api/admin/auth/me', { headers: { cookie: pendingCookie } })).status, 401);
    const otpCode = mails[0].text.match(/\b\d{6}\b/)[0];
    const otpHeaders = { cookie: pendingCookie, 'x-csrf-token': pending.csrfToken };
    assert.equal((await post('/api/admin/auth/otp/verify', { code: otpCode }, { cookie: pendingCookie })).status, 403);
    assert.equal((await post('/api/admin/auth/otp/verify', { code: otpCode }, { ...otpHeaders, origin: 'https://evil.example' })).status, 403);
    user.is_suspended = 1;
    assert.equal((await post('/api/admin/auth/otp/verify', { code: otpCode }, otpHeaders)).status, 401);
    user.is_suspended = 0;
    const verified = await post('/api/admin/auth/otp/verify', { code: otpCode }, otpHeaders);
    assert.equal(verified.status, 200);
    const data = await verified.json();
    assert.equal(data.admin.id, 'skn29');
    assert.equal((await post('/api/admin/auth/otp/verify', { code: otpCode }, otpHeaders)).status, 401);
    const sessionCookie = verified.headers.getSetCookie().find((value) => value.startsWith(service.cookieName + '='));
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /SameSite=Strict/);
    const cookie = sessionCookie.split(';')[0];
    const me = await fetch(base + '/api/admin/auth/me', { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).admin.id, 'skn29');
    assert.equal((await post('/api/admin/qa-write', {}, { cookie })).status, 403);
    const authenticated = { cookie, 'x-csrf-token': data.csrfToken };
    assert.equal((await post('/api/admin/qa-write', {}, { ...authenticated, origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/api/admin/qa-write', {}, authenticated)).status, 200);
    assert.equal((await post('/api/admin/auth/logout', {}, authenticated)).status, 200);
    assert.equal((await fetch(base + '/api/admin/auth/me', { headers: { cookie } })).status, 401);
    assert.equal(pool.sessions[0].revoke_reason, 'logout');
});

test('cookie parser and timing-safe equality reject malformed or different values', () => {
    assert.deepEqual(parseCookies('a=1; admin=value%202; malformed'), { a: '1', admin: 'value 2' });
    assert.equal(safeEqual('same-value', 'same-value'), true);
    assert.equal(safeEqual('same-value', 'different-value'), false);
    assert.equal(safeEqual('', ''), false);
});

test('internal approval bypass requires a loopback request without an external proxy address', () => {
    const token = 'unit-test-internal-approval-token';
    const request = (remoteAddress, headers = {}) => ({
        socket: { remoteAddress },
        headers: { 'x-admin-approval-bypass': token, ...headers },
    });

    assert.equal(isInternalApprovalBypassRequest(request('127.0.0.1'), token), true);
    assert.equal(isInternalApprovalBypassRequest(request('::ffff:127.0.0.1'), token), true);
    assert.equal(isInternalApprovalBypassRequest(request('127.0.0.1', {
        'x-forwarded-for': '127.0.0.1, ::1',
    }), token), true);
    assert.equal(isInternalApprovalBypassRequest(request('203.0.113.10'), token), false);
    assert.equal(isInternalApprovalBypassRequest(request('127.0.0.1', {
        'x-forwarded-for': '203.0.113.10',
    }), token), false);
    assert.equal(isInternalApprovalBypassRequest(request('127.0.0.1', {
        'x-real-ip': '203.0.113.10',
    }), token), false);
    assert.equal(isInternalApprovalBypassRequest(request('127.0.0.1'), 'wrong-token'), false);
});

test('admin session uses an HttpOnly cookie and authenticates without exposing the raw token', async () => {
    const { service, user } = createFixture();
    const created = await service.createSession(user.id, {
        headers: { 'user-agent': 'node-test' },
        ip: '127.0.0.1',
    }, { emailOtpVerified: true });
    assert.ok(created.rawToken.length >= 40);
    assert.notEqual(created.rawToken, created.sessionHash);

    const res = responseDouble();
    service.setSessionCookie(res, created.rawToken);
    const setCookie = res.headers['set-cookie'];
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\/api\/admin/);
    assert.doesNotMatch(setCookie, /Secure/);

    const auth = await service.authenticateRequest({
        method: 'GET',
        headers: { cookie: `${service.cookieName}=${encodeURIComponent(created.rawToken)}` },
    });
    assert.equal(auth.valid, true);
    assert.equal(auth.user.id, user.id);
    assert.equal(auth.isPrimaryAdmin, true);
    assert.equal(Object.hasOwn(auth, 'rawToken'), false);
});

test('state-changing administrator requests require both exact Origin and CSRF token', async () => {
    const { service, user } = createFixture();
    const created = await service.createSession(user.id, { headers: {}, ip: '127.0.0.1' }, { emailOtpVerified: true });
    const cookie = `${service.cookieName}=${encodeURIComponent(created.rawToken)}`;

    const missingCsrfRes = responseDouble();
    await service.protect({
        method: 'POST',
        path: '/users/example/suspend',
        headers: { cookie, origin: 'http://localhost:5000' },
    }, missingCsrfRes, () => assert.fail('request without CSRF must not continue'));
    assert.equal(missingCsrfRes.statusCode, 403);
    assert.equal(missingCsrfRes.body.reason, 'invalid_admin_csrf');

    const wrongOriginRes = responseDouble();
    await service.protect({
        method: 'POST',
        path: '/users/example/suspend',
        headers: { cookie, origin: 'https://evil.example', 'x-csrf-token': created.csrfToken },
    }, wrongOriginRes, () => assert.fail('request from a wrong Origin must not continue'));
    assert.equal(wrongOriginRes.statusCode, 403);
    assert.equal(wrongOriginRes.body.reason, 'invalid_admin_origin');

    let continued = false;
    const validRes = responseDouble();
    const validReq = {
        method: 'POST',
        path: '/users/example/suspend',
        headers: { cookie, origin: 'http://localhost:5000', 'x-csrf-token': created.csrfToken },
    };
    await service.protect(validReq, validRes, () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(validReq.adminAuth.user.id, user.id);
});

test('expired and revoked sessions fail closed', async () => {
    const { pool, service, user } = createFixture();
    const created = await service.createSession(user.id, { headers: {}, ip: '127.0.0.1' }, { emailOtpVerified: true });
    pool.sessions[0].idle_expires_at = new Date(Date.now() - 1000);

    const expired = await service.authenticateRequest({
        headers: { cookie: `${service.cookieName}=${created.rawToken}` },
    });
    assert.equal(expired.valid, false);
    assert.equal(expired.reason, 'admin_session_expired');
    assert.ok(pool.sessions[0].revoked_at);

    const second = await service.createSession(user.id, { headers: {}, ip: '127.0.0.1' }, { emailOtpVerified: true });
    await service.revokeSessionHash(second.sessionHash, 'test_revocation');
    const revoked = await service.authenticateRequest({
        headers: { cookie: `${service.cookieName}=${second.rawToken}` },
    });
    assert.equal(revoked.valid, false);
    assert.equal(revoked.reason, 'invalid_admin_session');
});

test('automatic administrator polls do not extend idle expiry', async () => {
    const { pool, service, user } = createFixture();
    const created = await service.createSession(user.id, { headers: {}, ip: '127.0.0.1' }, { emailOtpVerified: true });
    const cookie = `${service.cookieName}=${encodeURIComponent(created.rawToken)}`;
    const originalLastSeen = new Date(Date.now() - 2 * 60 * 1000);
    const originalIdleExpiry = new Date(Date.now() + 10 * 60 * 1000);
    pool.sessions[0].last_seen_at = originalLastSeen;
    pool.sessions[0].idle_expires_at = originalIdleExpiry;

    let pollContinued = false;
    await service.protect({
        method: 'GET',
        path: '/auth/me',
        headers: { cookie },
    }, responseDouble(), () => { pollContinued = true; });
    assert.equal(pollContinued, true);
    assert.equal(pool.sessions[0].last_seen_at.getTime(), originalLastSeen.getTime());
    assert.equal(pool.sessions[0].idle_expires_at.getTime(), originalIdleExpiry.getTime());

    let activityContinued = false;
    await service.protect({
        method: 'GET',
        path: '/users',
        headers: { cookie },
    }, responseDouble(), () => { activityContinued = true; });
    assert.equal(activityContinued, true);
    assert.ok(pool.sessions[0].last_seen_at.getTime() > originalLastSeen.getTime());
    assert.ok(pool.sessions[0].idle_expires_at.getTime() > originalIdleExpiry.getTime());
});

test('logout clears the browser cookie even when server-side revocation fails', async () => {
    const registeredPosts = new Map();
    const app = {
        post(path, handler) { registeredPosts.set(path, handler); },
        get() {},
    };
    const adminSessionService = {
        isAllowedOrigin: () => true,
        createSession: async () => assert.fail('login is not part of this test'),
        setSessionCookie: () => assert.fail('login is not part of this test'),
        clearSessionCookie: (res) => {
            res.setHeader('Set-Cookie', 'wgs_admin_sid=; Max-Age=0; Path=/api/admin; HttpOnly; SameSite=Strict');
        },
        revokeSessionHash: async () => { throw new Error('database unavailable'); },
        revokeAllForUser: async () => 0,
    };

    registerAdminAuthRoutes({
        app,
        pool: { query: async () => [{ affectedRows: 0 }] },
        bcrypt: { compare: async () => false },
        requireHcaptcha: async () => true,
        getUserById: async () => null,
        getAdminUserControl: async () => null,
        ensureAdminUserControlSchema: async () => {},
        normalizeAdminBool: Boolean,
        isAdminAccessUser: () => false,
        isPrimaryAdminUser: () => false,
        adminSessionService,
        adminEmailOtpService: {},
    });

    const handler = registeredPosts.get('/api/admin/auth/logout');
    assert.equal(typeof handler, 'function');
    const res = responseDouble();
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await handler({
            adminAuth: {
                sessionHash: 'hashed-session',
                user: { id: 'admin1' },
            },
        }, res);
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(res.statusCode, 500);
    assert.match(res.headers['set-cookie'], /Max-Age=0/);
    assert.equal(res.body.reason, 'admin_logout_error');
});

test('sessions from before the OTP release and direct password-only session creation are refused', async () => {
    const { service, pool, user } = createFixture();
    await assert.rejects(service.createSession(user.id, {}), /OTP verification is required/);
    const created = await service.createSession(user.id, {}, { emailOtpVerified: true });
    pool.sessions[0].email_otp_verified_at = null;
    const auth = await service.authenticateRequest({ headers: { cookie: `${service.cookieName}=${created.rawToken}` } });
    assert.equal(auth.valid, false);
    assert.equal(auth.reason, 'admin_email_otp_required');
    assert.equal(pool.sessions[0].revoke_reason, 'email_otp_required');
});
