'use strict';

// Route/analytics isolation only. Cookie cryptography, expiry, transactions and
// revocation are exercised against real MySQL by the full runtime QA suite.
function createMemberSessionDouble(user, { initiallyActive = false } = {}) {
    let active = initiallyActive;
    const token = 'unit-cookie-session';
    return {
        assertOrigin() {},
        tokenHashFromRequest(req) { return req.headers?.cookie === 'wgs_member=' + token ? 'unit-session-hash' : ''; },
        async activeForUser() { return active ? { token_hash: 'unit-session-hash' } : null; },
        async createSession(_user, _req, _previous, onCreated) {
            active = true;
            const auditId = await onCreated({ async query() { return [{ insertId: 1, affectedRows: 1 }]; } });
            return { rawToken: token, sessionHash: 'unit-session-hash', csrfToken: 'unit-csrf', auditId };
        },
        setCookie(res, raw) { res.append('Set-Cookie', 'wgs_member=' + raw + '; HttpOnly; Path=/; SameSite=Strict'); },
        clearCookie(res) { res.append('Set-Cookie', 'wgs_member=; Max-Age=0; Path=/'); },
        async validateRequest(req) {
            const id = req.body?.id || req.body?.userId || req.headers?.['x-user-id'];
            return active && this.tokenHashFromRequest(req) && (!id || id === user.id)
                ? { valid: true, user, id: user.id, sessionHash: 'unit-session-hash', csrfToken: 'unit-csrf' }
                : { valid: false, reason: 'session_expired' };
        },
        async revokeCurrent() { active = false; },
        async revokeAllForUser() { active = false; },
        async assertStillActive() { if (!active) throw new Error('session_expired'); },
    };
}

module.exports = { createMemberSessionDouble };
