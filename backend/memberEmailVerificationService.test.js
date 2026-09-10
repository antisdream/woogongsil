'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMemberEmailVerificationService, assertPassword } = require('./services/memberEmailVerificationService');
const { MemberVerificationPool } = require('./test-support/memberVerificationPool');
const registerVerification = require('./routes/auth/memberEmailVerificationRoutes');
const registerRecovery = require('./routes/auth/accountRecoveryRoutes');

function fixture(env = {}) {
    let now = Date.now(), failMail = false;
    const user = { id: 'member1', email: 'member@example.test', name: 'QA Member', password: 'initial-test-hash', sessionToken: 'test-member-session' };
    const pool = new MemberVerificationPool([user]);
    const mails = [];
    const config = { pool, env: { NODE_ENV: 'development', ...env }, clock: () => now,
        sendEmail: async (to, subject, text) => { mails.push({ to, subject, text }); return { success: !failMail }; } };
    const service = createMemberEmailVerificationService(config);
    const origin = env.NODE_ENV === 'production' ? 'https://woogongsil.site' : 'http://localhost:5000';
    const req = { headers: { origin } };
    const response = { cookies: [], append(_key, value) { this.cookies.push(value); }, setHeader() {} };
    let pending;
    return { user, pool, mails, config, service, req, response,
        advance(ms) { now += ms; }, failMail(value) { failMail = value; },
        code: () => mails.at(-1).text.match(/\b\d{6}\b/)[0],
        async issue(purpose = 'find-pw', email = user.email) {
            pending = await service.issue(req, response, { purpose, email, user: purpose === 'signup' ? null : user });
            req.headers.cookie = response.cookies.at(-1).split(';')[0];
            req.headers['x-wgs-verification-csrf'] = pending.csrfToken;
            return pending;
        },
        async verify(purpose = 'find-pw', email = user.email) { return service.verify(req, { purpose, email, code: this.code() }); },
    };
}

test('email verification uses a HttpOnly proof and persists no raw cookie token or code', async () => {
    const f = fixture({ NODE_ENV: 'production' });
    const pending = await f.issue();
    assert.match(f.response.cookies[0], /HttpOnly; SameSite=Strict;.*Secure$/);
    assert.match(f.response.cookies[0], /^__Secure-/);
    const stored = JSON.stringify(f.pool.states);
    assert.ok(!stored.includes(f.req.headers.cookie.split('.')[1]));
    assert.ok(!Object.values(Object.values(f.pool.states)[0]).includes(f.code()));
    assert.ok(!Object.values(pending).includes(f.code()));
});

test('a verified email does not authorize a browser without its proof or CSRF', async () => {
    const f = fixture(); await f.issue(); await f.verify();
    const action = () => assert.fail('unproven request must never run an account action');
    await assert.rejects(f.service.consume({ headers: { origin: f.req.headers.origin } }, 'find-pw', { userId: f.user.id }, action), { code: 'verification_restart' });
    const req = { headers: { ...f.req.headers, 'x-wgs-verification-csrf': '' } };
    await assert.rejects(f.service.consume(req, 'find-pw', { userId: f.user.id }, action), { code: 'invalid_verification_csrf' });
    req.headers['x-wgs-verification-csrf'] = f.req.headers['x-wgs-verification-csrf']; req.headers.origin = 'https://untrusted.example';
    await assert.rejects(f.service.consume(req, 'find-pw', { userId: f.user.id }, action), { code: 'invalid_verification_origin' });
});

test('account, email and purpose cannot be swapped after verification', async () => {
    const f = fixture(); await f.issue('find-id'); await f.verify('find-id');
    for (const [purpose, target] of [['find-pw', { userId: f.user.id }], ['signup', { email: f.user.email }], ['find-id', { userId: 'other' }], ['find-id', { email: 'other@example.test' }]]) {
        await assert.rejects(f.service.consume(f.req, purpose, target, () => assert.fail()), { code: 'verification_restart' });
    }
});

test('code expiry and final proof expiry are enforced separately', async () => {
    const f = fixture(); await f.issue(); f.advance(120000);
    await assert.rejects(f.verify(), { code: 'verification_restart' });
    await f.issue(); await f.verify(); f.advance(300000);
    await assert.rejects(f.service.consume(f.req, 'find-pw', {}, () => assert.fail()), { code: 'verification_restart' });
});

test('a fresh service instance retains proof and five-attempt lockout across resends', async () => {
    const f = fixture(); await f.issue();
    for (let i = 0; i < 3; i++) await assert.rejects(f.service.verify(f.req, { purpose: 'find-pw', email: f.user.email, code: 'bad' }), { code: 'invalid_verification_code' });
    f.advance(60000); await f.issue();
    const fresh = createMemberEmailVerificationService(f.config);
    await assert.rejects(fresh.verify(f.req, { purpose: 'find-pw', email: f.user.email, code: 'bad' }), { code: 'invalid_verification_code' });
    await assert.rejects(fresh.verify(f.req, { purpose: 'find-pw', email: f.user.email, code: 'bad' }), { code: 'verification_locked' });
    f.advance(60000); await assert.rejects(f.issue('find-id'), { code: 'verification_locked' });
});

test('only one simultaneous password change consumes the proof and changes the password', async () => {
    const f = fixture(); await f.issue(); await f.verify();
    let changes = 0;
    const action = async db => { changes++; await db.query('UPDATE wgs_users SET password = ?, sessionToken = NULL WHERE id = ?', ['replacement-hash', f.user.id]); return true; };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => f.service.consume(f.req, 'find-pw', { userId: f.user.id }, action)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(changes, 1); assert.equal(f.pool.users[0].sessionToken, null);
    await assert.rejects(f.service.consume(f.req, 'find-pw', {}, action), { code: 'verification_restart' });
});

test('a failed DB action rolls back both password and consumption, allowing a safe retry', async () => {
    const f = fixture(); await f.issue(); await f.verify();
    await assert.rejects(f.service.consume(f.req, 'find-pw', {}, async db => {
        await db.query('UPDATE wgs_users SET password = ?, sessionToken = NULL WHERE id = ?', ['must-rollback', f.user.id]);
        throw new Error('synthetic database failure');
    }), /synthetic database failure/);
    assert.equal(f.pool.users[0].password, f.user.password);
    assert.equal(await f.service.consume(f.req, 'find-pw', {}, async () => 'retried'), 'retried');
});

test('a changed password or email invalidates previously verified recovery proof', async () => {
    for (const [field, value] of [['password', 'changed-hash'], ['email', 'changed@example.test']]) {
        const f = fixture(); await f.issue(); await f.verify(); f.pool.users[0][field] = value;
        await assert.rejects(f.service.consume(f.req, 'find-pw', {}, () => assert.fail()), { code: 'verification_restart' });
    }
});

test('SMTP failure cannot authorize verification and resend replaces the old browser proof', async () => {
    const f = fixture(); f.failMail(true);
    await assert.rejects(f.issue(), { code: 'verification_delivery_failed' });
    f.failMail(false); f.advance(60000); await f.issue();
    const oldReq = structuredClone(f.req); const oldCode = f.code();
    f.advance(60000); await f.issue();
    await assert.rejects(f.service.verify(oldReq, { purpose: 'find-pw', email: f.user.email, code: oldCode }), { code: 'verification_restart' });
    await f.verify();
});

test('signup proof is single use and bound to its email without granting password-reset privileges', async () => {
    const f = fixture(); await f.issue('signup', 'new@example.test'); await f.verify('signup', 'new@example.test');
    await assert.rejects(f.service.consume(f.req, 'find-pw', {}, () => assert.fail()), { code: 'verification_restart' });
    const fresh = createMemberEmailVerificationService(f.config);
    assert.equal(await fresh.consume(f.req, 'signup', { email: 'new@example.test' }, async () => 'created'), 'created');
    await assert.rejects(f.service.consume(f.req, 'signup', { email: 'new@example.test' }, () => assert.fail()), { code: 'verification_restart' });
});

test('signup, recovery and password change use the same password rules', () => {
    assert.doesNotThrow(() => assertPassword('Test_1234'));
    for (const password of ['', 'short1!', 'onlyletters', '12345678!', 'Aa1!' + 'a'.repeat(20)]) assert.throws(() => assertPassword(password), { code: 'invalid_password' });
});

test('real HTTP recovery routes reject old unbound state, forged purpose and missing member login', async t => {
    const f = fixture(); const app = express(); app.use(express.json());
    const deps = { app, memberVerificationService: f.service, getUserById: async id => id === f.user.id ? f.user : null,
        getUserByEmail: async email => email === f.user.email ? f.user : null, validateRealtimeSession: async () => ({ valid: false }) };
    registerVerification(deps);
    registerRecovery({ ...deps, bcrypt: { hash: async () => assert.fail('unauthorized hashing') }, saltRounds: 4,
        revokeAdminSessionsForUser: async () => assert.fail('unauthorized revocation'), sendEmail: async () => assert.fail('unexpected mail') });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const post = async (path, body) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { origin: f.req.headers.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
    };
    assert.equal((await post('/api/find-pw/reset', { id: f.user.id, newPassword: 'Test_1234' })).status, 400);
    assert.equal((await post('/api/user/change-pw', { id: f.user.id, newPw: 'Test_1234' })).status, 401);
    assert.equal((await post('/api/auth/send-code', { type: 'change-pw', email: f.user.email })).status, 401);
    assert.equal((await post('/api/send-verification', { type: 'find', email: f.user.email })).status, 400);
    assert.equal((await post('/api/auth/send-code', { type: 'find-pw', id: 'other', email: f.user.email })).status, 400);
    assert.equal((await post('/api/reset-pw', {})).status, 410);
});
