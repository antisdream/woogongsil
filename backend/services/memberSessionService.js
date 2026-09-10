'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const positive = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;
const isSecure = env => env.NODE_ENV === 'production' || String(env.PUBLIC_SITE_URL || '').startsWith('https://');
const cookieName = (env = process.env) => isSecure(env) ? '__Host-wgs_member' : 'wgs_member';
const sameSecret = (a, b) => Boolean(a && b && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)));

function tokenFromRequest(req, env = process.env) {
    const values = String(req?.headers?.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(cookieName(env) + '='));
    if (values.length !== 1) return '';
    const raw = values[0].slice(cookieName(env).length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : '';
}

function memberTokenHashFromRequest(req, env = process.env) {
    const raw = tokenFromRequest(req, env);
    return raw ? hash(raw) : '';
}

function createMemberSessionService({ pool, env = process.env, now = Date.now } = {}) {
    if (!pool?.getConnection) throw new Error('Member sessions require a MySQL pool.');
    const absoluteMs = positive(env.WGS_MEMBER_SESSION_ABSOLUTE_HOURS, 24, 168) * 3600000;
    const idleMs = Math.min(absoluteMs, positive(env.WGS_MEMBER_SESSION_IDLE_HOURS, 4, 24) * 3600000);
    const secure = isSecure(env), name = cookieName(env);
    const origins = new Set(['https://woogongsil.site', 'https://www.woogongsil.site', env.PUBLIC_SITE_URL,
        ...String(env.WGS_MEMBER_ALLOWED_ORIGINS || '').split(',').map(value => value.trim())].filter(Boolean));
    let ready;
    const events = new EventEmitter();

    function assertOrigin(req) {
        const origin = String(req?.headers?.origin || '');
        let allowed = origins.has(origin);
        if (!secure) {
            try { allowed ||= ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { /* Missing origins fail. */ }
        }
        if (!allowed || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'member_origin', '허용되지 않은 로그인 요청입니다.');
    }

    const csrf = raw => crypto.createHmac('sha256', raw).update('wgs-member-session-csrf-v1').digest('base64url');
    function assertCsrf(req, supplied = req.headers['x-wgs-member-csrf']) {
        assertOrigin(req);
        const raw = tokenFromRequest(req, env);
        if (!raw || !sameSecret(csrf(raw), String(supplied || ''))) throw fail(403, 'member_csrf', '로그인 상태를 다시 확인한 뒤 요청해주세요.');
    }

    function setCookie(res, raw, clear = false) {
        res.append('Set-Cookie', `${name}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : Math.floor(absoluteMs / 1000)}${secure ? '; Secure' : ''}`);
        res.setHeader('Cache-Control', 'no-store');
    }

    function ensureSchema() {
        if (!ready) ready = (async () => {
            await pool.query(`CREATE TABLE IF NOT EXISTS wgs_member_sessions (
                token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                active_user_id VARCHAR(100) NULL,
                created_at BIGINT NOT NULL,
                last_seen_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                idle_expires_at BIGINT NOT NULL,
                revoked_at BIGINT NULL,
                revocation_reason VARCHAR(40) NULL,
                UNIQUE KEY uq_member_active_user (active_user_id),
                INDEX idx_member_user (user_id, created_at),
                INDEX idx_member_expiry (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            await pool.query(`CREATE TABLE IF NOT EXISTS wgs_member_session_rollout (
                id TINYINT PRIMARY KEY, legacy_exchange_until BIGINT NOT NULL
            ) ENGINE=InnoDB`);
            // Existing sessions are not cleared in bulk. A valid browser proof can be
            // exchanged once, per account, during a fixed 24-hour transition window.
            // INSERT IGNORE preserves the deadline across application restarts.
            await pool.query('INSERT IGNORE INTO wgs_member_session_rollout(id,legacy_exchange_until) VALUES(1,?)', [now() + 86400000]);
        })().catch(error => { ready = null; throw error; });
        return ready;
    }

    async function activeForUser(id, db = pool) {
        const [rows] = await db.query('SELECT token_hash FROM wgs_member_sessions WHERE active_user_id=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>? LIMIT 1', [id, now(), now()]);
        return rows[0] || null;
    }

    async function revokeAllForUser(id, reason = 'logout_all', db = pool) {
        await db.query('UPDATE wgs_member_sessions SET active_user_id=NULL,revoked_at=?,revocation_reason=? WHERE user_id=? AND revoked_at IS NULL', [now(), reason, id]);
        events.emit('revoked', { userId: String(id) });
    }

    async function revokeCurrent(auth) {
        await pool.query('UPDATE wgs_member_sessions SET active_user_id=NULL,revoked_at=?,revocation_reason=? WHERE token_hash=? AND revoked_at IS NULL', [now(), 'logout', auth.sessionHash]);
        events.emit('revoked', { sessionHash: auth.sessionHash });
    }

    async function createSession(expectedUser, req, previousHash = null, onCreated = async () => null, legacyToken = null) {
        assertOrigin(req);
        const db = await pool.getConnection();
        try {
            await db.beginTransaction();
            const [[user]] = await db.query('SELECT * FROM wgs_users WHERE id=? FOR UPDATE', [expectedUser.id]);
            if (!user || user.password !== expectedUser.password || Number(user.is_suspended)) throw fail(401, 'member_credentials_changed', '계정 상태가 변경되었습니다. 다시 로그인해주세요.');
            if (legacyToken !== null) {
                const [[rollout]] = await db.query('SELECT legacy_exchange_until FROM wgs_member_session_rollout WHERE id=1');
                if (!rollout || Number(rollout.legacy_exchange_until) <= now() || !sameSecret(String(user.sessionToken || ''), legacyToken)) throw fail(401, 'member_upgrade_required', '새 로그인 방식으로 다시 로그인해주세요.');
            }
            const active = await activeForUser(user.id, db);
            if ((active?.token_hash || null) !== previousHash) throw fail(409, 'member_login_changed', '다른 로그인 요청이 처리되었습니다. 다시 로그인해주세요.');
            await revokeAllForUser(user.id, 'duplicate_login', db);
            const rawToken = crypto.randomBytes(32).toString('base64url'), tokenHash = hash(rawToken), time = now();
            await db.query('INSERT INTO wgs_member_sessions(token_hash,user_id,active_user_id,created_at,last_seen_at,expires_at,idle_expires_at) VALUES(?,?,?,?,?,?,?)',
                [tokenHash, user.id, user.id, time, time, time + absoluteMs, time + idleMs]);
            // Only this successfully authenticated account leaves the old protocol.
            await db.query('UPDATE wgs_users SET sessionToken=NULL WHERE id=?', [user.id]);
            const auditId = await onCreated(db);
            await db.commit();
            return { rawToken, sessionHash: tokenHash, csrfToken: csrf(rawToken), expiresAt: new Date(time + absoluteMs).toISOString(), idleExpiresAt: new Date(time + idleMs).toISOString(), auditId };
        } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
    }

    async function authenticate(req, { touch = false, cache = true } = {}) {
        if (cache && req.wgsMemberAuth) return req.wgsMemberAuth;
        const tokenHash = memberTokenHashFromRequest(req, env);
        if (!tokenHash) return { valid: false, reason: 'session_expired' };
        const [[row]] = await pool.query(`SELECT s.token_hash AS session_hash,s.revoked_at,s.revocation_reason,s.expires_at,s.idle_expires_at,s.last_seen_at,u.*
            FROM wgs_member_sessions s JOIN wgs_users u ON u.id=s.user_id WHERE s.token_hash=? LIMIT 1`, [tokenHash]);
        const time = now();
        if (!row || row.revoked_at !== null || Number(row.is_suspended) || Number(row.expires_at) <= time || Number(row.idle_expires_at) <= time) return { valid: false, reason: row?.revocation_reason === 'duplicate_login' ? 'duplicate_login' : 'session_expired' };
        if (touch && Number(row.last_seen_at) < time - 60000) {
            await pool.query('UPDATE wgs_member_sessions SET last_seen_at=?,idle_expires_at=LEAST(expires_at,?) WHERE token_hash=? AND revoked_at IS NULL AND idle_expires_at>?', [time, time + idleMs, tokenHash, time]);
            row.idle_expires_at = Math.min(Number(row.expires_at), time + idleMs);
        }
        const { password: _password, sessionToken: _legacyToken, session_hash, revoked_at: _revoked, revocation_reason: _reason, expires_at, idle_expires_at, last_seen_at: _seen, ...user } = row;
        const auth = { valid: true, user, id: user.id, sessionHash: session_hash, csrfToken: csrf(tokenFromRequest(req, env)), expiresAt: new Date(Number(expires_at)).toISOString(), idleExpiresAt: new Date(Number(idle_expires_at)).toISOString() };
        if (cache) req.wgsMemberAuth = auth;
        return auth;
    }

    async function assertStillActive(auth, db) {
        const [rows] = await db.query('SELECT token_hash FROM wgs_member_sessions WHERE token_hash=? AND active_user_id=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>? FOR UPDATE', [auth.sessionHash, auth.user.id, now(), now()]);
        if (!rows.length) throw fail(401, 'session_expired', '로그인이 변경되었습니다. 다시 진행해주세요.');
    }

    async function validateRequest(req, { touch = true } = {}) {
        const auth = await authenticate(req, { touch });
        if (!auth.valid) return auth;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) assertCsrf(req);
        const suppliedId = req.body?.id ?? req.body?.userId ?? req.query?.id ?? req.query?.userId ?? req.headers['x-user-id'];
        if (suppliedId !== undefined && String(suppliedId).trim() !== String(auth.user.id)) return { valid: false, reason: 'member_identity' };
        return auth;
    }

    async function middleware(req, res, next) {
        if (tokenFromRequest(req, env) && req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'private, no-store');
        if (req.path.startsWith('/api/admin/') || ['/api/login', '/api/member/session/exchange'].includes(req.path) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !tokenFromRequest(req, env)) return next();
        try {
            assertCsrf(req);
            return next();
        } catch (error) { return res.status(error.status || 500).json({ success: false, reason: error.reason || 'session_check_failed', msg: error.status ? error.message : '로그인 상태를 확인하지 못했습니다.' }); }
    }

    async function validateSocket(socket) {
        const req = { headers: socket.handshake.headers || {}, method: 'GET' };
        assertCsrf(req, socket.handshake.auth?.csrfToken);
        return authenticate(req, { cache: false });
    }

    return { ensureSchema, createSession, activeForUser, revokeAllForUser, revokeCurrent, events, authenticate, validateRequest, assertStillActive, validateSocket,
        middleware, assertOrigin, assertCsrf, setCookie, clearCookie: res => setCookie(res, '', true), tokenHashFromRequest: req => memberTokenHashFromRequest(req, env), cookieName: name };
}

module.exports = { createMemberSessionService, memberTokenHashFromRequest, cookieName };
