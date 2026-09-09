'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminEmailOtpService, maskEmail } = require('./services/adminEmailOtpService');
const { AdminOtpPool } = require('./test-support/adminOtpPool');

function fixture(options = {}) {
    const pool = new AdminOtpPool();
    const user = { id: 'skn29', email: 'admin@example.test', password: 'test-bcrypt-hash' };
    const mails = [];
    let now = Date.now();
    const config = { pool, clock: () => now, env: { NODE_ENV: 'production' },
        sendEmail: async (to, subject, text, config) => { mails.push({ to, subject, text, config }); return { success: true }; }, ...options };
    return { pool, user, mails, config, service: createAdminEmailOtpService(config),
        advance: ms => { now += ms; }, code: () => mails.at(-1).text.match(/\b\d{6}\b/)[0] };
}
const reason = expected => error => error.reason === expected;

test('OTP uses registered email, opaque secure cookie and HMAC storage', async () => {
    const f = fixture(); const p = await f.service.begin(f.user);
    assert.equal(p.otpRequired, true); assert.equal(p.maskedEmail, 'a***@example.test');
    assert.equal(f.mails[0].to, f.user.email); assert.equal(f.mails[0].config.sensitive, true);
    assert.match(f.code(), /^\d{6}$/); assert.notEqual(f.pool.otpState.codeHash, f.code());
    assert.notEqual(f.pool.otpState.tokenHash, p.rawToken);
    assert.equal(Object.hasOwn(f.pool.otpState, 'code'), false);
    let cookie; f.service.setCookie({ setHeader: (_, value) => { cookie = value; } }, p.rawToken);
    assert.match(cookie, /^__Secure-wgs_admin_otp=/); assert.match(cookie, /HttpOnly; SameSite=Strict; Secure/);
    const restored = await createAdminEmailOtpService(f.config).status(p.rawToken, f.user);
    assert.equal(restored.csrfToken, p.csrfToken); assert.equal('rawToken' in restored, false);
    assert.equal(maskEmail('x@example.test'), 'x***@example.test');
});

test('unknown cookie and wrong CSRF cannot verify or consume an attempt', async () => {
    const f = fixture(); const p = await f.service.begin(f.user);
    await assert.rejects(f.service.verify('unknown', p.csrfToken, f.code(), f.user), reason('admin_otp_restart'));
    await assert.rejects(f.service.verify(p.rawToken, 'wrong', f.code(), f.user), reason('invalid_admin_otp_csrf'));
    await assert.rejects(f.service.resend(p.rawToken, 'wrong', f.user), reason('invalid_admin_otp_csrf'));
    assert.equal(f.pool.otpState.attempts, 0);
});

test('code and pending request expiries are enforced by the server', async () => {
    const f = fixture(); const p = await f.service.begin(f.user);
    f.advance(5 * 60 * 1000);
    await assert.rejects(f.service.verify(p.rawToken, p.csrfToken, f.code(), f.user), reason('admin_otp_expired'));
    assert.equal((await f.service.resend(p.rawToken, p.csrfToken, f.user)).deliveryFailed, false);
    f.advance(10 * 60 * 1000);
    await assert.rejects(f.service.status(p.rawToken, f.user), reason('admin_otp_restart'));
});

test('resend invalidation, cooldown and attempt count survive restart', async () => {
    const f = fixture(); const p = await f.service.begin(f.user); const oldCode = f.code();
    await assert.rejects(f.service.resend(p.rawToken, p.csrfToken, f.user), reason('admin_otp_cooldown'));
    f.advance(60000); await f.service.resend(p.rawToken, p.csrfToken, f.user);
    assert.notEqual(oldCode, f.code());
    const restarted = createAdminEmailOtpService(f.config);
    await assert.rejects(restarted.verify(p.rawToken, p.csrfToken, oldCode, f.user), reason('invalid_admin_otp'));
    assert.equal(f.pool.otpState.attempts, 1);
    assert.deepEqual(await restarted.verify(p.rawToken, p.csrfToken, f.code(), f.user), { emailOtpVerified: true });
});

test('five failures lock issuance across browsers and restarts for fifteen minutes', async () => {
    const f = fixture(); const p = await f.service.begin(f.user);
    for (let i = 1; i <= 5; i++) await assert.rejects(
        f.service.verify(p.rawToken, p.csrfToken, 'bad', f.user), reason(i === 5 ? 'admin_otp_locked' : 'invalid_admin_otp'));
    const restarted = createAdminEmailOtpService(f.config);
    await assert.rejects(restarted.begin(f.user), reason('admin_otp_locked'));
    f.advance(15 * 60 * 1000); const fresh = await restarted.begin(f.user);
    assert.deepEqual(await restarted.verify(fresh.rawToken, fresh.csrfToken, f.code(), f.user), { emailOtpVerified: true });
});

test('send limits cover fresh password challenges and survive restart', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) { await f.service.begin(f.user); f.advance(60000); }
    await assert.rejects(createAdminEmailOtpService(f.config).begin(f.user), reason('admin_otp_send_limit'));
    assert.equal(f.mails.length, 5);
});

test('concurrent correct verifications consume the code exactly once', async () => {
    const f = fixture(); const p = await f.service.begin(f.user);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => f.service.verify(p.rawToken, p.csrfToken, f.code(), f.user)));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(f.pool.otpState.codeHash, null); assert.equal(f.pool.otpState.tokenHash, null);
});

test('email or password changes invalidate a pending challenge', async () => {
    const f = fixture(); const p = await f.service.begin(f.user);
    for (const user of [{ ...f.user, email: 'changed@example.test' }, { ...f.user, password: 'changed-hash' }]) {
        await assert.rejects(f.service.verify(p.rawToken, p.csrfToken, f.code(), user), reason('admin_otp_restart'));
    }
});

test('SMTP failure leaves no usable code and exposes only retry state', async () => {
    const f = fixture({ sendEmail: async () => { throw new Error('simulated SMTP failure'); } });
    const p = await f.service.begin(f.user);
    assert.equal(p.deliveryFailed, true); assert.equal(f.pool.otpState.codeHash, null);
    await assert.rejects(f.service.verify(p.rawToken, p.csrfToken, '000000', f.user), reason('admin_otp_not_sent'));
    assert.equal((await f.service.status(p.rawToken, f.user)).deliveryStatus, 'failed');
});

test('a late mail response cannot activate an older challenge', async () => {
    let completeFirst, started;
    const firstStarted = new Promise(resolve => { started = resolve; });
    const f = fixture({ sendEmail: async () => {
        if (!completeFirst) return new Promise(resolve => { completeFirst = resolve; started(); });
        return { success: true };
    } });
    const first = f.service.begin(f.user); const rejected = assert.rejects(first, reason('admin_otp_restart'));
    await firstStarted; f.advance(60000); const second = await f.service.begin(f.user);
    completeFirst({ success: true }); await rejected;
    assert.equal((await f.service.status(second.rawToken, f.user)).deliveryStatus, 'ready');
});
