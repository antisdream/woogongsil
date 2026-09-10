'use strict';

const crypto = require('node:crypto');
const { parseCookies, safeEqual } = require('./adminSessionService');

const PURPOSES = new Set(['signup', 'find-id', 'find-pw', 'change-pw']);
const WINDOW_MS = 15 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const PROOF_TTL_MS = 5 * 60 * 1000;
const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[@!,._-])[a-zA-Z0-9@!,._-]{8,15}$/;
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const mac = (token, value) => crypto.createHmac('sha256', token).update(value).digest('hex');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const fingerprint = user => hash(JSON.stringify([String(user.id), normalizeEmail(user.email), user.password]));

class MemberVerificationError extends Error {
    constructor(code, message, status = 400, retryAfterSeconds = 0) {
        super(message);
        Object.assign(this, { code, status, retryAfterSeconds });
    }
}

function assertPassword(password) {
    if (!PASSWORD_PATTERN.test(String(password || ''))) {
        throw new MemberVerificationError('invalid_password', '비밀번호는 영문, 숫자, 기호(@!.,-_) 포함 8~15자여야 합니다.');
    }
}

function createMemberEmailVerificationService({ pool, sendEmail, env = process.env, clock = Date.now } = {}) {
    const secure = env.NODE_ENV === 'production' || String(env.PUBLIC_SITE_URL || '').startsWith('https://');
    const cookieName = secure ? '__Secure-wgs_member_verification' : 'wgs_member_verification';
    const allowedOrigins = new Set(['https://woogongsil.site', 'https://www.woogongsil.site',
        ...String(env.PUBLIC_SITE_URL || '').split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean),
        ...(env.NODE_ENV === 'production' ? [] : ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:5173', 'http://127.0.0.1:5173']),
    ]);
    let schemaPromise;

    function ensureSchema() {
        if (!schemaPromise) schemaPromise = pool.query(`CREATE TABLE IF NOT EXISTS wgs_member_email_verifications (
            email_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
            state JSON NOT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            KEY idx_member_verification_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
            .catch(error => { schemaPromise = undefined; throw error; });
        return schemaPromise;
    }

    function assertOrigin(req) {
        if (!allowedOrigins.has(String(req.headers?.origin || '').replace(/\/$/, ''))) {
            throw new MemberVerificationError('invalid_verification_origin', '사이트에서 다시 인증을 요청해주세요.', 403);
        }
    }

    function invalid() {
        return new MemberVerificationError('verification_restart', '인증 요청이 만료되었거나 변경되었습니다. 이메일 인증부터 다시 진행해주세요.');
    }

    function requestProof(req) {
        assertOrigin(req);
        const value = parseCookies(req.headers?.cookie)[cookieName] || '';
        if (!/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(value)) throw invalid();
        const [key, token] = value.split('.');
        if (!safeEqual(req.headers?.['x-wgs-verification-csrf'], mac(token, 'member-verification-csrf'))) {
            throw new MemberVerificationError('invalid_verification_csrf', '인증 화면을 새로 열어 다시 진행해주세요.', 403);
        }
        return { key, token };
    }

    function setCookie(res, value, maxAge = WINDOW_MS / 1000) {
        const cookie = `${cookieName}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
        res.append('Set-Cookie', cookie);
        res.setHeader('Cache-Control', 'no-store');
    }

    async function locked(key, action, create = false) {
        await ensureSchema();
        const db = await pool.getConnection();
        let committed = false;
        try {
            await db.beginTransaction();
            if (create) await db.query('INSERT INTO wgs_member_email_verifications (email_hash, state) VALUES (?, ?) ON DUPLICATE KEY UPDATE email_hash = email_hash', [key, '{}']);
            const [rows] = await db.query('SELECT state FROM wgs_member_email_verifications WHERE email_hash = ? FOR UPDATE', [key]);
            if (!rows.length) throw invalid();
            const state = typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state;
            const result = await action(state, db);
            await db.query('UPDATE wgs_member_email_verifications SET state = ? WHERE email_hash = ?', [JSON.stringify(state), key]);
            await db.commit();
            committed = true;
            if (result instanceof MemberVerificationError) throw result;
            return result;
        } catch (error) {
            if (!committed) await db.rollback();
            throw error;
        } finally { db.release(); }
    }

    function check(state, token, purpose, email, userId) {
        if (!PURPOSES.has(purpose) || state.purpose !== purpose || !safeEqual(state.tokenHash, hash(token))
            || (email !== undefined && state.email !== normalizeEmail(email))
            || (userId !== undefined && state.userId !== String(userId))
            || clock() >= state.pendingExpiresAt) throw invalid();
        if (state.lockedUntil > clock()) throw new MemberVerificationError('verification_locked', '인증 시도 횟수를 초과했습니다. 15분 후 다시 요청해주세요.', 429,
            Math.ceil((state.lockedUntil - clock()) / 1000));
    }

    function publicState(state, token) {
        return { success: true, csrfToken: mac(token, 'member-verification-csrf'), purpose: state.purpose,
            expiresAt: new Date(state.status === 'verified' ? state.verifiedExpiresAt : state.expiresAt).toISOString(),
            serverTime: new Date(clock()).toISOString(), resendAfterSeconds: 60 };
    }

    async function issue(req, res, { email, purpose, user }) {
        assertOrigin(req);
        email = normalizeEmail(email);
        if (!PURPOSES.has(purpose) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            throw new MemberVerificationError('invalid_verification_request', '이메일과 인증 목적을 확인해주세요.');
        }
        const key = hash(email);
        const token = crypto.randomBytes(32).toString('base64url');
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const codeHash = mac(token, `member-email:${code}`);
        await locked(key, state => {
            const now = clock();
            if (state.lockedUntil > now) throw new MemberVerificationError('verification_locked', '인증 시도 횟수를 초과했습니다. 잠시 후 다시 요청해주세요.', 429, Math.ceil((state.lockedUntil - now) / 1000));
            if (state.resendAt > now) throw new MemberVerificationError('verification_cooldown', '1분 후 인증번호를 다시 요청해주세요.', 429, Math.ceil((state.resendAt - now) / 1000));
            if (!state.windowStart || now >= state.windowStart + WINDOW_MS) Object.assign(state, { windowStart: now, sends: 0, attempts: 0 });
            if (state.sends >= 5) throw new MemberVerificationError('verification_send_limit', '메일 발송 횟수를 초과했습니다. 잠시 후 다시 요청해주세요.', 429, Math.ceil((state.windowStart + WINDOW_MS - now) / 1000));
            Object.assign(state, { email, purpose, userId: user ? String(user.id) : null, fingerprint: user ? fingerprint(user) : null,
                tokenHash: hash(token), codeHash, status: 'sending', expiresAt: now + CODE_TTL_MS,
                pendingExpiresAt: now + WINDOW_MS, verifiedExpiresAt: null, resendAt: now + 60000, sends: state.sends + 1 });
        }, true);
        let delivered = false;
        try {
            delivered = (await sendEmail(email, '[우공실] 이메일 본인 인증번호',
                `인증번호는 ${code} 입니다. 2분 이내에 입력해주세요.\n요청한 화면에서만 사용할 수 있으며, 다른 사람에게 알려주지 마세요.\n본인이 요청하지 않았다면 이 메일을 무시해주세요.`, { sensitive: true }))?.success === true;
        } catch (_) { /* Mail body, address and delivery errors must not enter logs. */ }
        const result = await locked(key, state => {
            check(state, token, purpose, email);
            state.status = delivered ? 'ready' : 'failed';
            if (!delivered) state.codeHash = null;
            return publicState(state, token);
        });
        setCookie(res, `${key}.${token}`);
        if (!delivered) throw new MemberVerificationError('verification_delivery_failed', '인증 메일을 보내지 못했습니다. 잠시 후 다시 요청해주세요.', 503);
        await pool.query('DELETE FROM wgs_member_email_verifications WHERE updated_at < UTC_TIMESTAMP() - INTERVAL 1 DAY LIMIT 100');
        return result;
    }

    async function verify(req, { purpose, email, code }) {
        const { key, token } = requestProof(req);
        return locked(key, state => {
            check(state, token, purpose, email);
            if (state.status === 'verified' && clock() < state.verifiedExpiresAt) return publicState(state, token);
            if (state.status !== 'ready' || clock() >= state.expiresAt) throw invalid();
            if (!/^\d{6}$/.test(String(code || '')) || !safeEqual(state.codeHash, mac(token, `member-email:${code}`))) {
                state.attempts = (state.attempts || 0) + 1;
                if (state.attempts >= 5) {
                    state.lockedUntil = clock() + WINDOW_MS;
                    state.status = 'locked';
                    state.codeHash = null;
                    return new MemberVerificationError('verification_locked', '인증번호를 5회 잘못 입력했습니다. 15분 후 다시 요청해주세요.', 429, WINDOW_MS / 1000);
                }
                return new MemberVerificationError('invalid_verification_code', '인증번호가 일치하지 않습니다.');
            }
            state.status = 'verified';
            state.codeHash = null;
            state.verifiedExpiresAt = Math.min(clock() + PROOF_TTL_MS, state.pendingExpiresAt);
            return publicState(state, token);
        });
    }

    async function consume(req, purpose, { email, userId } = {}, action) {
        const { key, token } = requestProof(req);
        return locked(key, async (state, db) => {
            check(state, token, purpose, email, userId);
            if (state.status !== 'verified' || clock() >= state.verifiedExpiresAt) throw invalid();
            let user;
            if (state.userId) {
                const [rows] = await db.query('SELECT id, name, email, password, sessionToken FROM wgs_users WHERE id = ? FOR UPDATE', [state.userId]);
                user = rows[0];
                if (!user || !safeEqual(state.fingerprint, fingerprint(user))) throw invalid();
            }
            const result = await action(db, { ...state, user });
            state.status = 'consumed';
            state.tokenHash = null;
            state.codeHash = null;
            return result;
        });
    }

    function respondError(res, error) {
        res.setHeader('Cache-Control', 'no-store');
        if (error instanceof MemberVerificationError) {
            if (error.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
            return res.status(error.status).json({ success: false, code: error.code, msg: error.message });
        }
        return res.status(500).json({ success: false, msg: '인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
    }

    return { ensureSchema, issue, verify, consume, respondError, assertOrigin, clearCookie: res => setCookie(res, '', 0), cookieName };
}

module.exports = { createMemberEmailVerificationService, MemberVerificationError, assertPassword, PURPOSES };
