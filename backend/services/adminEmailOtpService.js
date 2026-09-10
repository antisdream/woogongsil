'use strict';
const { runtimeSchemaGate } = require('./schemaRuntime');

const crypto = require('node:crypto');
const { parseCookies, safeEqual } = require('./adminSessionService');

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;

class AdminOtpError extends Error {
    constructor(reason, message, statusCode = 401, retryAfterSeconds = 0) {
        super(message);
        this.reason = reason;
        this.statusCode = statusCode;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

function maskEmail(value) {
    const [name, domain] = String(value).split('@');
    return `${name.slice(0, 1)}***@${domain}`;
}

function createAdminEmailOtpService({ pool, sendEmail, env = process.env, clock = Date.now } = {}) {
    if (!pool?.getConnection || typeof sendEmail !== 'function') {
        throw new Error('Admin email OTP requires a transactional pool and mail sender.');
    }
    const secure = env.NODE_ENV === 'production' || String(env.PUBLIC_SITE_URL || '').startsWith('https://');
    const cookieName = secure ? '__Secure-wgs_admin_otp' : 'wgs_admin_otp';
    const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
    const mac = (token, value) => crypto.createHmac('sha256', token).update(value).digest('hex');
    const fingerprint = user => hash(JSON.stringify([user.id, user.email.trim().toLowerCase(), user.password]));
    let schemaPromise;

    function ensureSchema() {
        const runtime = runtimeSchemaGate(pool); if (runtime) return runtime;
        if (!schemaPromise) {
            schemaPromise = pool.query(`CREATE TABLE IF NOT EXISTS wgs_admin_email_otp (
                user_id VARCHAR(100) NOT NULL PRIMARY KEY,
                state JSON NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
                .catch(error => { schemaPromise = undefined; throw error; });
        }
        return schemaPromise;
    }

    // One bounded row per administrator; the row lock serializes sends, attempts and single use.
    // Neither the raw browser token nor the six digit code is persisted.
    async function locked(action) {
        await ensureSchema();
        const db = await pool.getConnection();
        try {
            await db.beginTransaction();
            // Upsert takes an exclusive row lock. INSERT IGNORE can deadlock while
            // several duplicate-key shared locks upgrade to SELECT FOR UPDATE.
            await db.query('INSERT INTO wgs_admin_email_otp (user_id, state) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id', ['skn29', '{}']);
            const [rows] = await db.query('SELECT state FROM wgs_admin_email_otp WHERE user_id = ? FOR UPDATE', ['skn29']);
            const state = typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state;
            const result = await action(state);
            await db.query('UPDATE wgs_admin_email_otp SET state = ? WHERE user_id = ?', [JSON.stringify(state), 'skn29']);
            await db.commit();
            if (result instanceof AdminOtpError) throw result;
            return result;
        } catch (error) {
            await db.rollback();
            throw error;
        } finally {
            db.release();
        }
    }

    function invalid() {
        return new AdminOtpError('admin_otp_restart', '인증 요청이 만료되었거나 변경되었습니다. 비밀번호부터 다시 확인해주세요.');
    }

    function validateUser(user) {
        if (user?.id !== 'skn29' || !user.password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email || '').trim())) {
            throw new AdminOtpError('admin_otp_unavailable', '관리자 인증 메일을 보낼 수 없습니다. 계정의 이메일 설정을 확인해주세요.', 503);
        }
    }

    function checkChallenge(state, token, user, csrf) {
        if (!token || !safeEqual(state.tokenHash, hash(token)) || clock() >= state.pendingExpiresAt
            || !['sending', 'ready', 'failed'].includes(state.status)) throw invalid();
        if (user) {
            validateUser(user);
            if (!safeEqual(state.fingerprint, fingerprint(user))) throw invalid();
        }
        if (csrf !== undefined && !safeEqual(csrf, mac(token, 'admin-otp-csrf'))) {
            throw new AdminOtpError('invalid_admin_otp_csrf', '보안 토큰을 확인할 수 없습니다. 페이지를 새로고침해주세요.', 403);
        }
    }

    function checkLock(state) {
        if (state.lockedUntil > clock()) {
            throw new AdminOtpError('admin_otp_locked', '인증번호를 5회 잘못 입력했습니다. 15분 후 다시 로그인해주세요.', 429,
                Math.ceil((state.lockedUntil - clock()) / 1000));
        }
    }

    function publicState(state, token) {
        return {
            otpRequired: true,
            maskedEmail: state.maskedEmail,
            csrfToken: mac(token, 'admin-otp-csrf'),
            expiresAt: new Date(state.expiresAt).toISOString(),
            resendAt: new Date(state.resendAt).toISOString(),
            serverTime: new Date(clock()).toISOString(),
            deliveryStatus: state.status,
        };
    }

    async function issue(user, token, csrf, resend) {
        validateUser(user);
        const rawToken = resend ? token : crypto.randomBytes(32).toString('base64url');
        let code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        let codeHash = mac(rawToken, `admin-email-otp:${code}`);
        await locked(state => {
            if (resend) checkChallenge(state, rawToken, user, csrf);
            checkLock(state);
            while (resend && safeEqual(state.codeHash, codeHash)) {
                code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
                codeHash = mac(rawToken, `admin-email-otp:${code}`);
            }
            const now = clock();
            if (state.resendAt > now) {
                throw new AdminOtpError('admin_otp_cooldown', '잠시 후 인증번호를 다시 요청해주세요.', 429, Math.ceil((state.resendAt - now) / 1000));
            }
            if (!state.windowStart || now >= state.windowStart + WINDOW_MS) {
                state.windowStart = now;
                state.sends = 0;
                state.attempts = 0;
            }
            if (state.sends >= MAX_SENDS) {
                throw new AdminOtpError('admin_otp_send_limit', '메일 발송 횟수를 초과했습니다. 잠시 후 다시 로그인해주세요.', 429,
                    Math.ceil((state.windowStart + WINDOW_MS - now) / 1000));
            }
            if (!resend) state.pendingExpiresAt = now + WINDOW_MS;
            Object.assign(state, {
                tokenHash: hash(rawToken), codeHash, fingerprint: fingerprint(user),
                maskedEmail: maskEmail(user.email.trim().toLowerCase()),
                expiresAt: Math.min(now + CODE_TTL_MS, state.pendingExpiresAt),
                resendAt: now + RESEND_MS, sends: state.sends + 1, status: 'sending',
            });
        });

        // SMTP has finite timeouts. Send outside the transaction so failures never hold a DB lock.
        let delivered = false;
        try {
            const result = await sendEmail(user.email.trim().toLowerCase(), '[우공실] 관리자 로그인 인증번호',
                `관리자 로그인 인증번호는 ${code} 입니다.\n\n5분 이내에 입력해주세요. 재전송하면 이전 번호는 사용할 수 없습니다.\n본인이 요청하지 않았다면 이 메일을 무시하고 사이트 비밀번호를 확인해주세요.\n인증번호를 다른 사람에게 알려주지 마세요.`,
                { sensitive: true });
            delivered = result?.success === true;
        } catch (_) { /* Never log a recipient, mail body or SMTP error containing personal data. */ }
        return locked(state => {
            if (!safeEqual(state.tokenHash, hash(rawToken)) || !safeEqual(state.codeHash, codeHash)) throw invalid();
            state.status = delivered ? 'ready' : 'failed';
            if (!delivered) state.codeHash = null;
            return { rawToken, ...publicState(state, rawToken), deliveryFailed: !delivered };
        });
    }

    async function status(token, user) {
        return locked(state => {
            checkChallenge(state, token, user);
            checkLock(state);
            return publicState(state, token);
        });
    }

    async function verify(token, csrf, code, user) {
        return locked(state => {
            checkChallenge(state, token, user, csrf);
            checkLock(state);
            if (state.status !== 'ready') throw new AdminOtpError('admin_otp_not_sent', '메일 발송 상태를 확인하고 인증번호를 다시 요청해주세요.', 409);
            if (clock() >= state.expiresAt) throw new AdminOtpError('admin_otp_expired', '인증번호가 만료되었습니다. 새 인증번호를 요청해주세요.');
            if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !safeEqual(state.codeHash, mac(token, `admin-email-otp:${code}`))) {
                state.attempts = (state.attempts || 0) + 1;
                if (state.attempts >= MAX_ATTEMPTS) {
                    state.lockedUntil = clock() + WINDOW_MS;
                    state.status = 'locked';
                    state.codeHash = null;
                    return new AdminOtpError('admin_otp_locked', '인증번호를 5회 잘못 입력했습니다. 15분 후 다시 로그인해주세요.', 429, WINDOW_MS / 1000);
                }
                return new AdminOtpError('invalid_admin_otp', `인증번호가 올바르지 않습니다. ${MAX_ATTEMPTS - state.attempts}회 더 입력할 수 있습니다.`);
            }
            state.status = 'consumed';
            state.codeHash = null;
            state.tokenHash = null;
            return { emailOtpVerified: true };
        });
    }

    function setCookie(res, token) {
        const value = `${cookieName}=${encodeURIComponent(token || '')}; Max-Age=${token ? WINDOW_MS / 1000 : 0}; Path=/api/admin/auth; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
        if (res.append) res.append('Set-Cookie', value);
        else {
            const current = res.getHeader?.('Set-Cookie');
            res.setHeader('Set-Cookie', current ? [].concat(current, value) : value);
        }
    }

    return {
        ensureSchema, cookieName, setCookie,
        tokenFromRequest: req => parseCookies(req?.headers?.cookie)[cookieName] || '',
        begin: user => issue(user, undefined, undefined, false),
        resend: (token, csrf, user) => issue(user, token, csrf, true),
        status, verify,
    };
}

module.exports = { createAdminEmailOtpService, AdminOtpError, maskEmail };
