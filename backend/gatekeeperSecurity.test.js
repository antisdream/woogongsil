'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const registerGatekeeperSecurity = require('./middleware/gatekeeperSecurity');
const registerAuthRoutes = require('./routes/auth/authRoutes');
const { createMemberSessionDouble } = require('./test-support/memberSessionDouble');
const registerAdminAuthRoutes = require('./routes/auth/adminAuthRoutes');
const registerAccountRecoveryRoutes = require('./routes/auth/accountRecoveryRoutes');
const registerUserRoutes = require('./routes/userRoutes');
const { createAdminSessionService } = require('./services/adminSessionService');
const { createWgsSecurityHeaders } = require('./services/httpSecurity');

const RATE_ENV_KEYS = [
    'WGS_RATE_LIMIT_ENABLED',
    'WGS_LIMIT_CLIENT_VISITOR_VISIT_PER_MIN',
    'WGS_LIMIT_IP_VISITOR_VISIT_PER_MIN',
    'WGS_LIMIT_CLIENT_GATEKEEPER_PER_MIN',
    'WGS_LIMIT_IP_GATEKEEPER_PER_MIN',
    'WGS_LIMIT_CLIENT_LOGIN_PER_MIN',
    'WGS_LIMIT_ACCOUNT_LOGIN_PER_10MIN',
    'WGS_LIMIT_IP_LOGIN_PER_MIN',
    'WGS_LIMIT_CLIENT_ADMIN_LOGIN_PER_10MIN',
    'WGS_LIMIT_ACCOUNT_ADMIN_LOGIN_PER_15MIN',
    'WGS_LIMIT_IP_ADMIN_LOGIN_PER_10MIN',
    'WGS_LIMIT_CLIENT_REGISTER_PER_10MIN',
    'WGS_LIMIT_EMAIL_REGISTER_PER_10MIN',
    'WGS_LIMIT_IP_REGISTER_PER_10MIN',
    'WGS_LIMIT_CLIENT_ERROR_REPORT_PER_10MIN',
    'WGS_LIMIT_IP_ERROR_REPORT_PER_10MIN',
    'WGS_LIMIT_CLIENT_API_WRITE_PER_MIN',
    'WGS_LIMIT_USER_API_WRITE_PER_MIN',
    'WGS_LIMIT_IP_API_WRITE_PER_MIN',
    'WGS_LIMIT_IP_API_READ_PER_MIN',
    'WGS_LIMIT_IP_QUESTION_READ_PER_MIN',
    'WGS_LIMIT_SESSION_QUESTION_READ_PER_MIN',
];

test('OTP status, resend and verification aliases share the same pre-authentication IP quota', () => {
    withRateEnv({ WGS_RATE_LIMIT_ENABLED: 'true' }, () => {
        const middleware = createRateMiddleware();
        const paths = ['/api/admin/auth/otp/status', '/api/admin/auth/otp/resend/', '/api/admin/auth/otp/verify'];
        for (let i = 0; i < 60; i++) assert.equal(invokeRateMiddleware(middleware, {
            path: paths[i % paths.length], clientId: `otp-client-${i}`, ip: '192.0.2.62',
        }).nextCalled, true);
        assert.equal(invokeRateMiddleware(middleware, { path: paths[0], clientId: 'otp-overflow', ip: '192.0.2.62' }).response.statusCode, 429);
    });
});

function withRateEnv(values, callback) {
    const previous = new Map(RATE_ENV_KEYS.map((key) => [key, process.env[key]]));
    try {
        for (const key of RATE_ENV_KEYS) {
            if (Object.prototype.hasOwnProperty.call(values, key)) {
                process.env[key] = values[key];
            } else {
                delete process.env[key];
            }
        }
        return callback();
    } finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function createRateMiddleware() {
    const unscopedMiddleware = [];
    const app = {
        set() {},
        get() {},
        post() {},
        use(pathOrHandler, maybeHandler) {
            if (typeof pathOrHandler === 'function') {
                unscopedMiddleware.push(pathOrHandler);
                return;
            }
            if (typeof maybeHandler === 'function') return;
            throw new Error('Unexpected middleware registration.');
        },
    };

    registerGatekeeperSecurity({
        app,
        crypto,
        https: {},
        backendDir: `${__dirname}/__missing_gatekeeper_test_env__`,
    });

    assert.ok(unscopedMiddleware.length >= 1, 'rate middleware must be registered first');
    return unscopedMiddleware[0];
}

function invokeRateMiddleware(middleware, {
    path = '/api/visitors/visit',
    method = 'POST',
    clientId = 'wgs-visitor-rate-test-client',
    ip = '203.0.113.10',
    forwardedFor = ip,
    body = {},
} = {}) {
    let nextCalled = false;
    const response = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = String(value);
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
    middleware({
        path,
        method,
        headers: {
            'x-wgs-client-id': clientId,
            'x-forwarded-for': forwardedFor,
        },
        ip,
        body,
        query: {},
    }, response, () => {
        nextCalled = true;
    });
    return { nextCalled, response };
}

test('visitor visits have separate read and write quotas and enforce 12/client and 600/IP defaults', () => {
    withRateEnv({
        WGS_RATE_LIMIT_ENABLED: 'true',
        WGS_LIMIT_CLIENT_VISITOR_VISIT_PER_MIN: '',
        WGS_LIMIT_IP_VISITOR_VISIT_PER_MIN: '',
    }, () => {
        const clientMiddleware = createRateMiddleware();
        for (let index = 0; index < 20; index += 1) {
            const result = invokeRateMiddleware(clientMiddleware, { method: 'GET' });
            assert.equal(result.nextCalled, true);
        }
        for (let index = 0; index < 12; index += 1) {
            const result = invokeRateMiddleware(clientMiddleware);
            assert.equal(result.nextCalled, true, `default client request ${index + 1} should pass`);
        }
        const clientBlocked = invokeRateMiddleware(clientMiddleware);
        assert.equal(clientBlocked.nextCalled, false);
        assert.equal(clientBlocked.response.statusCode, 429);
        assert.equal(clientBlocked.response.body?.error, 'TOO_MANY_REQUESTS');

        const ipMiddleware = createRateMiddleware();
        for (let index = 0; index < 600; index += 1) {
            const result = invokeRateMiddleware(ipMiddleware, {
                clientId: `wgs-rotated-${String(index).padStart(8, '0')}`,
                ip: '198.51.100.25',
            });
            assert.equal(result.nextCalled, true, `default IP request ${index + 1} should pass`);
        }
        const ipBlocked = invokeRateMiddleware(ipMiddleware, {
            clientId: 'wgs-rotated-over-limit',
            ip: '198.51.100.25',
        });
        assert.equal(ipBlocked.nextCalled, false);
        assert.equal(ipBlocked.response.statusCode, 429);

        const spoofMiddleware = createRateMiddleware();
        for (let index = 0; index < 600; index += 1) {
            const result = invokeRateMiddleware(spoofMiddleware, {
                clientId: `wgs-spoof-rotated-${String(index).padStart(8, '0')}`,
                ip: '198.51.100.77',
                forwardedFor: `192.0.2.${index % 255}, 198.51.100.77`,
            });
            assert.equal(result.nextCalled, true);
        }
        const spoofBlocked = invokeRateMiddleware(spoofMiddleware, {
            clientId: 'wgs-spoof-rotated-over-limit',
            ip: '198.51.100.77',
            forwardedFor: '203.0.113.250, 198.51.100.77',
        });
        assert.equal(spoofBlocked.response.statusCode, 429);
    });
});

test('visitor visit rate limits accept environment overrides without affecting unrelated POST routes', () => {
    withRateEnv({
        WGS_RATE_LIMIT_ENABLED: 'true',
        WGS_LIMIT_CLIENT_VISITOR_VISIT_PER_MIN: '2',
        WGS_LIMIT_IP_VISITOR_VISIT_PER_MIN: '3',
    }, () => {
        const middleware = createRateMiddleware();
        for (let index = 0; index < 10; index += 1) {
            const unrelated = invokeRateMiddleware(middleware, {
                path: '/api/unclassified-test',
                clientId: 'wgs-unrelated-client',
            });
            assert.equal(unrelated.nextCalled, true);
        }

        assert.equal(invokeRateMiddleware(middleware, {
            clientId: 'wgs-override-client',
            ip: '192.0.2.10',
        }).nextCalled, true);
        assert.equal(invokeRateMiddleware(middleware, {
            clientId: 'wgs-override-client',
            ip: '192.0.2.10',
        }).nextCalled, true);
        const clientBlocked = invokeRateMiddleware(middleware, {
            clientId: 'wgs-override-client',
            ip: '192.0.2.10',
        });
        assert.equal(clientBlocked.response.statusCode, 429);

        const ipMiddleware = createRateMiddleware();
        for (let index = 0; index < 3; index += 1) {
            const result = invokeRateMiddleware(ipMiddleware, {
                clientId: `wgs-override-rotated-${index}`,
                ip: '192.0.2.20',
            });
            assert.equal(result.nextCalled, true);
        }
        const ipBlocked = invokeRateMiddleware(ipMiddleware, {
            clientId: 'wgs-override-rotated-limit',
            ip: '192.0.2.20',
        });
        assert.equal(ipBlocked.response.statusCode, 429);
    });
});

function responseDouble() {
    return {
        statusCode: 200, headers: {}, body: null, sent: false,
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        getHeader(name) { return this.headers[String(name).toLowerCase()]; },
        append(name, value) {
            const previous = this.getHeader(name);
            this.setHeader(name, previous === undefined ? value : [previous, value].flat());
        },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; this.sent = true; return this; },
    };
}

// Runs real registered route/middleware functions with in-memory request, DB and mail doubles.
// It opens no server port and never imports the production server or its environment loader.
function createRouteRegistry() {
    const middleware = [];
    const routes = [];
    const app = {
        set() {},
        use(prefixOrHandler, handler) {
            middleware.push(typeof prefixOrHandler === 'function'
                ? { prefix: '', handler: prefixOrHandler }
                : { prefix: prefixOrHandler, handler });
        },
    };
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        app[method] = (routePath, ...handlers) => routes.push({ method: method.toUpperCase(), path: routePath, handlers });
    }
    async function runHandlers(handlers, req, res = responseDouble()) {
        async function run(index) {
            if (res.sent || index >= handlers.length) return;
            let downstream;
            await handlers[index](req, res, () => {
                downstream = run(index + 1);
                return downstream;
            });
            if (downstream) await downstream;
        }
        await run(0);
        return res;
    }
    async function dispatch(method, routePath, input = {}) {
        const url = new URL(routePath, 'http://localhost:5000');
        const req = {
            method, path: url.pathname, originalUrl: url.pathname + url.search,
            body: {}, query: Object.fromEntries(url.searchParams), params: {}, headers: {},
            ip: '192.0.2.50', socket: { remoteAddress: '192.0.2.50' }, secure: false,
            ...input,
        };
        req.get = (name) => req.headers[String(name).toLowerCase()];
        const selected = routes.filter((route) => route.method === method && route.path === url.pathname);
        assert.ok(selected.length, `route must be registered: ${method} ${url.pathname}`);
        const handlers = [
            ...middleware.filter((entry) => !entry.prefix || req.path.startsWith(entry.prefix)).map((entry) => entry.handler),
            ...selected.flatMap((route) => route.handlers),
        ];
        return runHandlers(handlers, req);
    }
    return { app, routes, middleware, dispatch, runHandlers };
}

async function withEnvironment(values, callback) {
    const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
    try {
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        return await callback();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test('public access and old APK compatibility require no invite secret, cookie or CAPTCHA even with old flags enabled', async () => {
    await withEnvironment({
        INVITE_CODE: undefined, INVITE_TOKEN_SECRET: undefined,
        HCAPTCHA_ENABLED: 'true', HCAPTCHA_SITE_KEY: 'unit-test-public-key',
        HCAPTCHA_SECRET_KEY: 'unit-test-secret',
        HCAPTCHA_REQUIRED_ACTIONS: 'gatekeeper,login,admin_login,auth_send_code,signup,find_reset,change_pw',
        HCAPTCHA_TRUST_GATEKEEPER: 'false',
    }, async () => {
        const registry = createRouteRegistry();
        let providerRequests = 0;
        const compatibility = registerGatekeeperSecurity({
            app: registry.app, crypto,
            backendDir: `${__dirname}/__missing_gatekeeper_test_env__`,
            https: { request() { providerRequests += 1; assert.fail('CAPTCHA provider must not be contacted'); } },
        });
        registry.app.get('/api/public-probe', (req, res) => res.json({ success: true }));

        for (const cookie of ['', 'wgs_gatekeeper=expired', 'wgs_gatekeeper=%malformed']) {
            const status = await registry.dispatch('GET', '/api/gatekeeper/status', { headers: { cookie } });
            assert.deepEqual(status.body, { success: true, allowed: true });
            assert.equal(status.headers['cache-control'], 'no-store');
            const publicResponse = await registry.dispatch('GET', '/api/public-probe', { headers: { cookie } });
            assert.equal(publicResponse.statusCode, 200);
            assert.equal(publicResponse.body.success, true);
        }
        for (const action of ['', 'gatekeeper', 'login', 'admin_login', 'auth_send_code', 'signup', 'find_reset', 'change_pw']) {
            const config = await registry.dispatch('GET', `/api/gatekeeper/hcaptcha-config?action=${action}`);
            assert.equal(config.body.enabled, false);
            assert.equal(config.body.siteKey, '');
            assert.equal(config.headers['cache-control'], 'no-store');
            assert.equal(await compatibility.requireHcaptcha({}, responseDouble(), action), true);
        }
        for (const body of [{}, { code: '' }, { code: 'obsolete-team-code', hcaptchaToken: 'obsolete-token' }]) {
            const verification = await registry.dispatch('POST', '/api/gatekeeper/verify', { body });
            assert.equal(verification.statusCode, 200);
            assert.equal(verification.body.allowed, true);
            assert.equal(verification.headers['set-cookie'], undefined);
        }
        const logout = await registry.dispatch('POST', '/api/gatekeeper/logout');
        assert.equal(logout.body.allowed, true, 'old clients must not re-close public access after gate logout');
        assert.equal(providerRequests, 0);
    });
});

test('existing gatekeeper, member login, admin login and registration client rate limits are preserved', () => {
    withRateEnv({ WGS_RATE_LIMIT_ENABLED: 'true' }, () => {
        for (const [routePath, limit] of [
            ['/api/gatekeeper/verify', 8], ['/api/login', 8],
            ['/api/admin/auth/login', 6], ['/api/signup', 10],
        ]) {
            const middleware = createRateMiddleware();
            for (let index = 0; index < limit; index += 1) {
                assert.equal(invokeRateMiddleware(middleware, { path: routePath }).nextCalled, true);
            }
            const blocked = invokeRateMiddleware(middleware, { path: routePath });
            assert.equal(blocked.response.statusCode, 429, routePath);
            assert.ok(Number(blocked.response.headers['retry-after']) > 0);
        }
        const accountMiddleware = createRateMiddleware();
        for (let index = 0; index < 10; index += 1) {
            assert.equal(invokeRateMiddleware(accountMiddleware, {
                path: '/api/login', clientId: `login-client-${index}`, body: { id: 'member-a' },
            }).nextCalled, true);
        }
        assert.equal(invokeRateMiddleware(accountMiddleware, {
            path: '/api/login', clientId: 'new-login-client', body: { id: 'member-a' },
        }).response.statusCode, 429, 'account quota must survive client ID rotation');
    });
});

test('both public error report aliases share client and trusted-IP quotas', () => {
    withRateEnv({ WGS_RATE_LIMIT_ENABLED: 'true' }, () => {
        const paths = ['/api/error-report', '/api/error-report/', '/api/error-report/send', '/api/error-report/send/'];
        const clientMiddleware = createRateMiddleware();
        for (let index = 0; index < 8; index += 1) {
            assert.equal(invokeRateMiddleware(clientMiddleware, { path: paths[index % paths.length] }).nextCalled, true);
        }
        assert.equal(invokeRateMiddleware(clientMiddleware, { path: '/api/error-report/send' }).response.statusCode, 429);

        const ipMiddleware = createRateMiddleware();
        for (let index = 0; index < 30; index += 1) {
            assert.equal(invokeRateMiddleware(ipMiddleware, {
                path: paths[index % paths.length], clientId: `report-client-${index}`,
                ip: '198.51.100.45', forwardedFor: `203.0.113.${index}, 198.51.100.45`,
            }).nextCalled, true);
        }
        assert.equal(invokeRateMiddleware(ipMiddleware, {
            path: '/api/error-report', clientId: 'report-client-over-limit',
            ip: '198.51.100.45', forwardedFor: '203.0.113.250, 198.51.100.45',
        }).response.statusCode, 429);
    });
});

test('anonymous error reports without client IDs are limited per IP without sharing a global missing-ID bucket', () => {
    withRateEnv({ WGS_RATE_LIMIT_ENABLED: 'true' }, () => {
        const middleware = createRateMiddleware();
        for (let index = 0; index < 30; index += 1) {
            assert.equal(invokeRateMiddleware(middleware, {
                path: '/api/error-report', clientId: '', ip: '192.0.2.10',
            }).nextCalled, true);
        }
        assert.equal(invokeRateMiddleware(middleware, {
            path: '/api/error-report/send', clientId: '', ip: '192.0.2.10',
        }).response.statusCode, 429);
        assert.equal(invokeRateMiddleware(middleware, {
            path: '/api/error-report/send', clientId: '', ip: '192.0.2.11',
        }).nextCalled, true);
    });
});

test('error report limit overrides do not alter unrelated POST routes', () => {
    withRateEnv({
        WGS_RATE_LIMIT_ENABLED: 'true', WGS_LIMIT_CLIENT_ERROR_REPORT_PER_10MIN: '2',
        WGS_LIMIT_IP_ERROR_REPORT_PER_10MIN: '3',
    }, () => {
        const middleware = createRateMiddleware();
        for (let index = 0; index < 10; index += 1) {
            assert.equal(invokeRateMiddleware(middleware, { path: '/api/unclassified-test' }).nextCalled, true);
        }
        assert.equal(invokeRateMiddleware(middleware, { path: '/api/error-report' }).nextCalled, true);
        assert.equal(invokeRateMiddleware(middleware, { path: '/api/error-report/send' }).nextCalled, true);
        assert.equal(invokeRateMiddleware(middleware, { path: '/api/error-report' }).response.statusCode, 429);
    });
});

function createMemberFixture() {
    const registry = createRouteRegistry();
    const user = {
        id: 'member-a', password: 'unit-test-password-hash', name: 'Unit Member', email: 'member@example.test',
        sessionToken: 'unit-member-session', is_suspended: 0, is_primary_admin: 0, is_operator: 0,
    };
    const queries = [];
    const pool = { async query(sql, params = []) {
        queries.push({ sql: String(sql), params });
        return /^\s*(SELECT|SHOW)\b/i.test(sql) ? [[]] : [{ affectedRows: 1, insertId: 1 }];
    } };
    const getUserById = async (id) => String(id) === user.id ? user : null;
    const bcrypt = {
        compare: async (password, hash) => password === 'correct-unit-password' && hash === user.password,
        hash: async () => 'unit-test-replacement-hash',
    };
    const memberSessionService = createMemberSessionDouble(user, { initiallyActive: true });
    const validateRealtimeSession = req => memberSessionService.validateRequest(req);
    const verificationCodes = {};
    const legalConsentService = {
        async ensureSchema() {},
        async getUserEvidenceStatus() { return { complete: true }; },
    };
    registerGatekeeperSecurity({ app: registry.app, crypto });
    registerAuthRoutes({
        app: registry.app, pool, bcrypt, memberSessionService,
        sendEmail: async () => assert.fail('these tests must never send email'),
        verificationCodes, getUserById, getUserByEmail: async () => null,
        getKSTDateTime: () => '2026-09-07 20:00:00', ensureAdminUserControlSchema: async () => {},
        normalizeAdminBool: (value) => Boolean(Number(value)), getAdminMaintenanceState: () => ({ is_enabled: false }),
        isAdminAccessUser: () => false, adminColumnExists: async () => false,
        touchActiveUser() {}, removeActiveUser() {}, formatDateOnly: (value) => value || null,
        isPrimaryAdminUser: () => false, validateAdminSession: async () => ({ valid: false }),
        saltRounds: 10, adminUserId: 'unit-admin', serverInstanceId: 'unit-server',
        defaultMaintenanceMessage: 'maintenance', legalConsentService,
        visitSessionService: {
            async recordSuccessfulLogin() {}, async linkAuthenticatedSession() {}, async endAuthenticatedSession() {},
        },
        visitorAnalyticsService: { createAdminExclusionCookie: () => '', createAdminExclusionClearCookie: () => '' },
    });
    return { ...registry, user, queries, pool, bcrypt, getUserById, validateRealtimeSession, memberSessionService, verificationCodes, legalConsentService };
}

test('member password and session verification remain required after the public entry gate is removed', async () => {
    const fixture = createMemberFixture();
    await fixture.memberSessionService.revokeCurrent();
    const wrongPassword = await fixture.dispatch('POST', '/api/login', {
        body: { id: fixture.user.id, password: 'wrong-password' },
    });
    assert.equal(wrongPassword.body.success, false);
    assert.equal(wrongPassword.body.errorType, 'pw_wrong');

    const login = await fixture.dispatch('POST', '/api/login', {
        body: { id: fixture.user.id, password: 'correct-unit-password' },
    });
    assert.equal(login.body.success, true);
    assert.equal(login.body.sessionToken, undefined);
    assert.ok(login.body.csrfToken);

    const invalidSession = await fixture.dispatch('POST', '/api/check-session', {
        body: { id: fixture.user.id, sessionToken: 'forged-session' },
    });
    assert.equal(invalidSession.body.valid, false);
    const validSession = await fixture.dispatch('POST', '/api/check-session', {
        body: { id: fixture.user.id }, headers: { cookie: 'wgs_member=unit-cookie-session' },
    });
    assert.equal(validSession.body.valid, true);
});

test('public entry cannot read an anonymous or different member profile', async () => {
    const fixture = createMemberFixture();
    registerUserRoutes({
        app: fixture.app, pool: fixture.pool, bcrypt: fixture.bcrypt, getUserById: fixture.getUserById,
        formatDateOnly: (value) => value || null, getKSTDateTime: () => '2026-09-07 20:00:00',
        validateRealtimeSession: fixture.validateRealtimeSession, legalConsentService: fixture.legalConsentService,
    });
    const anonymous = await fixture.dispatch('GET', '/api/user/:id', { params: { id: fixture.user.id } });
    assert.equal(anonymous.statusCode, 401);
    const differentMember = await fixture.dispatch('GET', '/api/user/:id', {
        params: { id: 'another-member' },
        headers: { 'x-user-id': fixture.user.id, cookie: 'wgs_member=unit-cookie-session' },
    });
    assert.equal(differentMember.statusCode, 403);
    assert.equal(fixture.queries.length, 0, 'rejected profile requests must not read private rows');
    const ownProfile = await fixture.dispatch('GET', '/api/user/:id', {
        params: { id: fixture.user.id },
        headers: { 'x-user-id': fixture.user.id, cookie: 'wgs_member=unit-cookie-session' },
    });
    assert.equal(ownProfile.statusCode, 200);
    assert.equal(ownProfile.body.id, fixture.user.id);
    assert.equal(ownProfile.body.password, undefined);
});

test('password recovery and password change still require verified email and the unsafe legacy reset remains closed', async () => {
    const fixture = createMemberFixture();
    registerAccountRecoveryRoutes({
        app: fixture.app, pool: fixture.pool, bcrypt: fixture.bcrypt,
        getUserById: fixture.getUserById, getUserByEmail: async () => null,
        memberVerificationService: require('./services/memberEmailVerificationService').createMemberEmailVerificationService({
            pool: fixture.pool, sendEmail: async () => assert.fail('no mail should be sent'), env: { NODE_ENV: 'development' },
        }),
        validateRealtimeSession: fixture.validateRealtimeSession,
        memberSessionService: fixture.memberSessionService,
        sendEmail: async () => assert.fail('no mail should be sent'), saltRounds: 10,
        revokeAdminSessionsForUser: async () => assert.fail('unverified requests must not revoke sessions'),
    });
    for (const routePath of ['/api/find-pw/reset', '/api/user/change-pw']) {
        const response = await fixture.dispatch('POST', routePath, {
            headers: { origin: 'http://localhost:5000', cookie: 'wgs_member=unit-cookie-session' },
            body: { id: fixture.user.id, sessionToken: fixture.user.sessionToken, newPassword: 'Test_1234', newPw: 'Test_1234' },
        });
        assert.equal(response.statusCode, 400);
        assert.match(response.body.msg, /이메일 인증/);
    }
    const oldReset = await fixture.dispatch('POST', '/api/reset-pw', { body: { email: fixture.user.email } });
    assert.equal(oldReset.statusCode, 410);
    assert.equal(fixture.queries.length, 0, 'no real or fake password write should be reached');
});

test('administrator origin, credentials, role and separate session cookie checks remain enforced without CAPTCHA', async () => {
    const registry = createRouteRegistry();
    const user = { id: 'skn29', password: 'unit-admin-hash', is_primary_admin: 1, is_operator: 1, is_suspended: 0 };
    const adminSessionService = createAdminSessionService({
        pool: { async query(sql) {
            if (/^\s*CREATE TABLE IF NOT EXISTS wgs_admin_sessions/.test(String(sql))) return [{ affectedRows: 0 }];
            if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'email_otp_verified_at' }]];
            assert.fail('rejected administrator requests must not create a session');
        } },
        crypto,
        env: { NODE_ENV: 'development', PUBLIC_SITE_URL: 'http://localhost:5000', ADMIN_CSRF_SECRET: 'unit-csrf-secret' },
        getAdminUserControl: async () => user, normalizeAdminBool: (value) => Boolean(Number(value)),
        isAdminAccessUser: (candidate) => Boolean(candidate?.is_primary_admin || candidate?.is_operator),
        isPrimaryAdminUser: (candidate) => Boolean(candidate?.is_primary_admin),
    });
    registerGatekeeperSecurity({ app: registry.app, crypto });
    registerAdminAuthRoutes({
        app: registry.app, pool: { query: async () => assert.fail('rejected login must not write an audit') },
        bcrypt: { compare: async (password) => password === 'correct-admin-password' },
        getUserById: async () => user, getAdminUserControl: async () => user,
        ensureAdminUserControlSchema: async () => {}, normalizeAdminBool: (value) => Boolean(Number(value)),
        isAdminAccessUser: (candidate) => Boolean(candidate?.is_primary_admin || candidate?.is_operator),
        isPrimaryAdminUser: (candidate) => Boolean(candidate?.is_primary_admin), adminSessionService,
        visitSessionService: {}, visitorAnalyticsService: {},
        adminEmailOtpService: { begin: async () => assert.fail('rejected password must not send email') },
    });
    const wrongOrigin = await registry.dispatch('POST', '/api/admin/auth/login', {
        headers: { origin: 'https://untrusted.example.test' }, body: { id: user.id, password: 'correct-admin-password' },
    });
    assert.equal(wrongOrigin.statusCode, 403);
    const wrongPassword = await registry.dispatch('POST', '/api/admin/auth/login', {
        headers: { origin: 'http://localhost:5000' }, body: { id: user.id, password: 'wrong-password' },
    });
    assert.equal(wrongPassword.statusCode, 401);
    user.is_primary_admin = 0;
    user.is_operator = 0;
    const nonAdmin = await registry.dispatch('POST', '/api/admin/auth/login', {
        headers: { origin: 'http://localhost:5000' }, body: { id: user.id, password: 'correct-admin-password' },
    });
    assert.equal(nonAdmin.statusCode, 401);

    const protectedResponse = responseDouble();
    let continued = false;
    await adminSessionService.protect({
        method: 'GET', path: '/users', headers: { 'x-user-id': user.id, 'x-session-token': 'member-session-is-not-admin-auth' },
    }, protectedResponse, () => { continued = true; });
    assert.equal(protectedResponse.statusCode, 401);
    assert.equal(continued, false);
});

test('new practical result writes keep the shared learning write rate limit', () => {
    withRateEnv({
        WGS_RATE_LIMIT_ENABLED: 'true',
        WGS_LIMIT_CLIENT_API_WRITE_PER_MIN: '2',
        WGS_LIMIT_USER_API_WRITE_PER_MIN: '50',
        WGS_LIMIT_IP_API_WRITE_PER_MIN: '50',
    }, () => {
        const middleware = createRateMiddleware();
        assert.equal(invokeRateMiddleware(middleware, { path: '/api/learning-attempts/review' }).nextCalled, true);
        assert.equal(invokeRateMiddleware(middleware, { path: '/api/learning-attempts/fixture/submit' }).nextCalled, true);
        const limited = invokeRateMiddleware(middleware, { path: '/api/learning-attempts/fixture/submit' });
        assert.equal(limited.response.statusCode, 429);
        assert.equal(limited.nextCalled, false);
        assert.equal(invokeRateMiddleware(middleware, { path: '/api/online-users' }).nextCalled, true);
    });
});

test('question GET and HEAD share a trusted-IP quota that header rotation cannot bypass', () => {
    withRateEnv({ WGS_RATE_LIMIT_ENABLED:'true', WGS_LIMIT_IP_QUESTION_READ_PER_MIN:'3' }, () => {
        const middleware = createRateMiddleware();
        for (let i=0;i<3;i++) assert.equal(invokeRateMiddleware(middleware, {
            path:'/api/random-question', method:i===2?'HEAD':'GET',clientId:'rotated-'+i,forwardedFor:'192.0.2.'+i,
        }).nextCalled,true);
        const rejected=invokeRateMiddleware(middleware,{path:'/api/ipep/past-exam',method:'GET',clientId:'other'});
        assert.equal(rejected.response.statusCode,429);
        assert.ok(Number(rejected.response.headers['retry-after'])>0);
        assert.equal(invokeRateMiddleware(middleware,{path:'/assets/main.js',method:'GET'}).nextCalled,true);
        assert.equal(invokeRateMiddleware(middleware,{path:'/api/random-question',method:'GET',ip:'198.51.100.2'}).nextCalled,true);
    });
});

test('public read defaults allow 50 learners sharing one IP to each load several questions', () => {
    withRateEnv({WGS_RATE_LIMIT_ENABLED:'true',WGS_LIMIT_IP_QUESTION_READ_PER_MIN:''},()=>{
        const middleware=createRateMiddleware();
        for(let learner=0;learner<50;learner++) for(let action=0;action<3;action++) {
            assert.equal(invokeRateMiddleware(middleware,{method:'GET',path:'/api/random-question',clientId:'learner-'+learner}).nextCalled,true);
        }
    });
});

test('HTTP security headers no longer allow hCaptcha resources and retain the other protection directives', () => {
    const response = responseDouble();
    let continued = false;
    createWgsSecurityHeaders()({}, response, () => { continued = true; });
    const policy = response.headers['content-security-policy'];
    assert.equal(continued, true);
    assert.doesNotMatch(policy, /hcaptcha/i);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
});
