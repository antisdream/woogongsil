// 일반 회원 세션과 분리된 관리자 전용 세션을 생성하고 검증합니다.
'use strict';
const { runtimeLog: wgsRuntimeLog } = require("./runtimeLog");

const { runtimeSchemaGate } = require('./schemaRuntime');

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_ABSOLUTE_HOURS = 8;
const TOUCH_INTERVAL_MS = 60 * 1000;

function boolEnv(value, fallback = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

function positiveNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function parseCookies(cookieHeader = '') {
    return String(cookieHeader || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((cookies, part) => {
            const separator = part.indexOf('=');
            if (separator <= 0) return cookies;
            try {
                const key = decodeURIComponent(part.slice(0, separator).trim());
                const value = decodeURIComponent(part.slice(separator + 1).trim());
                cookies[key] = value;
            } catch (_) {
                // 잘못 인코딩된 쿠키 하나 때문에 전체 인증 처리가 실패하지 않게 무시합니다.
            }
            return cookies;
        }, {});
}

function safeEqual(leftValue, rightValue) {
    const left = Buffer.from(String(leftValue || ''), 'utf8');
    const right = Buffer.from(String(rightValue || ''), 'utf8');
    if (!left.length || left.length !== right.length) return false;
    return require('crypto').timingSafeEqual(left, right);
}

function isLoopbackAddress(value) {
    const address = String(value || '').trim().toLowerCase();
    return address === '127.0.0.1'
        || address === '::1'
        || address === '::ffff:127.0.0.1';
}

function isInternalApprovalBypassRequest(req, expectedToken) {
    const remoteAddress = req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
    if (!isLoopbackAddress(remoteAddress)) return false;

    // nginx를 거친 외부 요청도 Node 쪽 socket은 loopback으로 보일 수 있으므로
    // 전달된 원본 주소가 하나라도 외부 주소이면 내부 우회로 인정하지 않습니다.
    const forwardedAddresses = String(req?.headers?.['x-forwarded-for'] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const realIp = String(req?.headers?.['x-real-ip'] || '').trim();
    if (realIp) forwardedAddresses.push(realIp);
    if (forwardedAddresses.some((address) => !isLoopbackAddress(address))) return false;

    return safeEqual(req?.headers?.['x-admin-approval-bypass'], expectedToken);
}

function csvValues(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function createAdminSessionService(options = {}) {
    const pool = options.pool;
    const crypto = options.crypto || require('crypto');
    const getAdminUserControl = options.getAdminUserControl;
    const normalizeAdminBool = options.normalizeAdminBool;
    const isAdminAccessUser = options.isAdminAccessUser;
    const isPrimaryAdminUser = options.isPrimaryAdminUser;
    const env = options.env || process.env;

    if (!pool || typeof pool.query !== 'function') {
        throw new Error('createAdminSessionService requires a MySQL pool.');
    }
    if (typeof getAdminUserControl !== 'function' || typeof normalizeAdminBool !== 'function'
        || typeof isAdminAccessUser !== 'function' || typeof isPrimaryAdminUser !== 'function') {
        throw new Error('createAdminSessionService requires administrator permission helpers.');
    }

    const idleMs = positiveNumber(
        env.ADMIN_SESSION_IDLE_MINUTES,
        DEFAULT_IDLE_MINUTES,
        5,
        240
    ) * 60 * 1000;
    const absoluteMs = positiveNumber(
        env.ADMIN_SESSION_ABSOLUTE_HOURS,
        DEFAULT_ABSOLUTE_HOURS,
        1,
        24
    ) * 60 * 60 * 1000;
    const publicSiteUrl = String(env.PUBLIC_SITE_URL || '').trim().toLowerCase();
    const secureByDefault = String(env.NODE_ENV || '').toLowerCase() === 'production'
        || publicSiteUrl.startsWith('https://');
    const secureCookie = boolEnv(env.ADMIN_SESSION_COOKIE_SECURE, secureByDefault);
    const cookieName = String(
        env.ADMIN_SESSION_COOKIE_NAME
        || (secureCookie ? '__Secure-wgs_admin_sid' : 'wgs_admin_sid')
    ).trim();
    const cookiePath = '/api/admin';
    const csrfSecret = String(env.ADMIN_CSRF_SECRET || '').trim()
        || crypto.randomBytes(32).toString('hex');
    const allowedOrigins = new Set([
        'https://woogongsil.site',
        'https://www.woogongsil.site',
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        ...csvValues(env.PUBLIC_SITE_URL),
        ...csvValues(env.ADMIN_ALLOWED_ORIGINS),
    ].map((origin) => origin.replace(/\/$/, '')).filter(Boolean));

    let schemaReady = false;
    let schemaPromise = null;

    function hashValue(value) {
        return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
    }

    function csrfForSessionHash(sessionHash) {
        return crypto
            .createHmac('sha256', csrfSecret)
            .update(String(sessionHash || ''), 'utf8')
            .digest('base64url');
    }

    function clientIp(req) {
        const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
        return forwarded || req?.ip || req?.socket?.remoteAddress || '';
    }

    function requestOrigin(req) {
        return String(req?.headers?.origin || '').trim().replace(/\/$/, '');
    }

    function isAllowedOrigin(req) {
        const origin = requestOrigin(req);
        return Boolean(origin && allowedOrigins.has(origin));
    }

    function cookieAttributes(maxAgeSeconds) {
        const attributes = [
            `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
            `Path=${cookiePath}`,
            'HttpOnly',
            'SameSite=Strict',
        ];
        if (secureCookie) attributes.push('Secure');
        return attributes.join('; ');
    }

    function setSessionCookie(res, rawToken) {
        res.setHeader(
            'Set-Cookie',
            `${cookieName}=${encodeURIComponent(rawToken)}; ${cookieAttributes(absoluteMs / 1000)}`
        );
    }

    function clearSessionCookie(res) {
        res.setHeader(
            'Set-Cookie',
            `${cookieName}=; ${cookieAttributes(0)}`
        );
    }

    async function ensureSchema() {
        const runtime = runtimeSchemaGate(pool); if (runtime) return runtime;
        if (schemaReady) return;
        if (schemaPromise) return schemaPromise;

        schemaPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS wgs_admin_sessions (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                user_id VARCHAR(100) NOT NULL,
                created_at DATETIME(3) NOT NULL,
                last_seen_at DATETIME(3) NOT NULL,
                idle_expires_at DATETIME(3) NOT NULL,
                absolute_expires_at DATETIME(3) NOT NULL,
                revoked_at DATETIME(3) NULL,
                revoke_reason VARCHAR(80) NULL,
                ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
                user_agent_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
                email_otp_verified_at DATETIME(3) NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_wgs_admin_session_hash (session_hash),
                KEY idx_wgs_admin_session_user_active (user_id, revoked_at, absolute_expires_at),
                KEY idx_wgs_admin_session_expiry (idle_expires_at, absolute_expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).then(async () => {
            const [columns] = await pool.query("SHOW COLUMNS FROM wgs_admin_sessions LIKE 'email_otp_verified_at'");
            if (!columns.length) {
                try {
                    await pool.query('ALTER TABLE wgs_admin_sessions ADD COLUMN email_otp_verified_at DATETIME(3) NULL');
                } catch (error) {
                    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
                }
            }
            schemaReady = true;
        });

        try {
            await schemaPromise;
        } finally {
            schemaPromise = null;
        }
    }

    async function createSession(userId, req, proof = {}) {
        if (userId !== 'skn29') throw new Error('Administrator account is not allowed');
        if (proof.emailOtpVerified !== true) throw new Error('Administrator email OTP verification is required');
        await ensureSchema();

        const now = Date.now();
        const absoluteExpiresAt = new Date(now + absoluteMs);
        const idleExpiresAt = new Date(Math.min(now + idleMs, absoluteExpiresAt.getTime()));
        const rawToken = crypto.randomBytes(32).toString('base64url');
        const sessionHash = hashValue(rawToken);
        const ipHash = clientIp(req) ? hashValue(`${csrfSecret}:${clientIp(req)}`) : null;
        const userAgent = String(req?.headers?.['user-agent'] || '');
        const userAgentHash = userAgent ? hashValue(`${csrfSecret}:${userAgent}`) : null;

        await pool.query(
            `INSERT INTO wgs_admin_sessions
             (session_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
              revoked_at, revoke_reason, ip_hash, user_agent_hash, email_otp_verified_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
            [
                sessionHash,
                String(userId),
                new Date(now),
                new Date(now),
                idleExpiresAt,
                absoluteExpiresAt,
                ipHash,
                userAgentHash,
                new Date(now),
            ]
        );

        return {
            rawToken,
            sessionHash,
            csrfToken: csrfForSessionHash(sessionHash),
            idleExpiresAt: idleExpiresAt.toISOString(),
            expiresAt: absoluteExpiresAt.toISOString(),
        };
    }

    async function revokeSessionHash(sessionHash, reason = 'logout') {
        if (!sessionHash) return;
        await ensureSchema();
        await pool.query(
            `UPDATE wgs_admin_sessions
             SET revoked_at = COALESCE(revoked_at, NOW(3)), revoke_reason = COALESCE(revoke_reason, ?)
             WHERE session_hash = ?`,
            [String(reason).slice(0, 80), sessionHash]
        );
    }

    async function revokeAllForUser(userId, reason = 'logout_all', executor = pool) {
        if (!userId) return 0;
        if (executor === pool) await ensureSchema();
        const [result] = await executor.query(
            `UPDATE wgs_admin_sessions
             SET revoked_at = COALESCE(revoked_at, NOW(3)), revoke_reason = COALESCE(revoke_reason, ?)
             WHERE user_id = ? AND revoked_at IS NULL`,
            [String(reason).slice(0, 80), String(userId)]
        );
        return Number(result?.affectedRows || 0);
    }

    function invalid(reason, statusCode = 401) {
        return {
            valid: false,
            ok: false,
            reason,
            statusCode,
            message: statusCode === 403 ? '관리자 권한이 필요합니다.' : '관리자 로그인이 필요합니다.',
            user: null,
            isAdmin: false,
            isPrimaryAdmin: false,
            isOperator: false,
        };
    }

    async function authenticateRequest(req, options = {}) {
        await ensureSchema();

        const cookies = parseCookies(req?.headers?.cookie || '');
        const rawToken = String(cookies[cookieName] || '').trim();
        if (rawToken.length < 32 || rawToken.length > 200) return invalid('missing_admin_session');

        const sessionHash = hashValue(rawToken);
        const [rows] = await pool.query(
            `SELECT id, session_hash, user_id, created_at, last_seen_at, idle_expires_at,
                    absolute_expires_at, revoked_at, revoke_reason, email_otp_verified_at
             FROM wgs_admin_sessions
             WHERE session_hash = ?
             LIMIT 1`,
            [sessionHash]
        );
        const session = rows?.[0];
        if (!session || session.revoked_at) return invalid('invalid_admin_session');
        if (!session.email_otp_verified_at) {
            await revokeSessionHash(sessionHash, 'email_otp_required');
            return invalid('admin_email_otp_required');
        }
        if (session.user_id !== 'skn29') {
            await revokeSessionHash(sessionHash, 'account_not_allowed');
            return invalid('not_admin', 403);
        }

        const now = Date.now();
        const idleExpiresAtMs = new Date(session.idle_expires_at).getTime();
        const absoluteExpiresAtMs = new Date(session.absolute_expires_at).getTime();
        if (!Number.isFinite(idleExpiresAtMs) || !Number.isFinite(absoluteExpiresAtMs)
            || now >= idleExpiresAtMs || now >= absoluteExpiresAtMs) {
            await revokeSessionHash(sessionHash, now >= absoluteExpiresAtMs ? 'absolute_expired' : 'idle_expired');
            return invalid('admin_session_expired');
        }

        const user = await getAdminUserControl(session.user_id);
        const isSuspended = normalizeAdminBool(user?.is_suspended);
        const hasAdminAccess = Boolean(user && isAdminAccessUser(user) && !isSuspended);
        if (!hasAdminAccess) {
            await revokeSessionHash(sessionHash, isSuspended ? 'account_suspended' : 'permission_revoked');
            return invalid(isSuspended ? 'suspended' : 'not_admin', 403);
        }

        const shouldTouch = options.touch !== false;
        const lastSeenMs = new Date(session.last_seen_at).getTime();
        let nextIdleExpiresAtMs = idleExpiresAtMs;
        if (shouldTouch && (!Number.isFinite(lastSeenMs) || now - lastSeenMs >= TOUCH_INTERVAL_MS)) {
            nextIdleExpiresAtMs = Math.min(now + idleMs, absoluteExpiresAtMs);
            await pool.query(
                `UPDATE wgs_admin_sessions
                 SET last_seen_at = ?, idle_expires_at = ?
                 WHERE id = ? AND revoked_at IS NULL`,
                [new Date(now), new Date(nextIdleExpiresAtMs), session.id]
            );
        }

        const isPrimaryAdmin = isPrimaryAdminUser(user);
        return {
            valid: true,
            ok: true,
            reason: null,
            statusCode: 200,
            message: '관리자 인증 완료',
            id: String(user.id || session.user_id),
            user: {
                id: String(user.id || session.user_id),
                name: user.name || user.id || session.user_id,
                email: user.email || '',
                is_primary_admin: isPrimaryAdmin ? 1 : 0,
                is_operator: isAdminAccessUser(user) ? 1 : 0,
            },
            isAdmin: true,
            isPrimaryAdmin,
            isOperator: true,
            sessionHash,
            activityKey: `admin:${sessionHash.slice(0, 24)}`,
            csrfToken: csrfForSessionHash(sessionHash),
            idleExpiresAt: new Date(nextIdleExpiresAtMs).toISOString(),
            expiresAt: new Date(absoluteExpiresAtMs).toISOString(),
        };
    }

    function isStateChanging(req) {
        return !['GET', 'HEAD', 'OPTIONS'].includes(String(req?.method || 'GET').toUpperCase());
    }

    async function protect(req, res, next) {
        const relativePath = String(req.path || '');
        if (req.method === 'POST' && ['/auth/login', '/auth/otp/status', '/auth/otp/resend', '/auth/otp/verify'].includes(relativePath.replace(/\/$/, ''))) {
            return next();
        }

        try {
            const nonActivityPoll = req.method === 'GET' && [
                '/auth/me',
                '/auth/me/',
                '/online-users',
                '/online-users/',
            ].includes(relativePath);
            const auth = await authenticateRequest(req, { touch: !nonActivityPoll });
            if (!auth.valid) {
                clearSessionCookie(res);
                return res.status(auth.statusCode || 401).json({
                    success: false,
                    valid: false,
                    reason: auth.reason,
                    message: auth.message,
                });
            }

            req.adminAuth = auth;

            if (isStateChanging(req)) {
                if (!isAllowedOrigin(req)) {
                    return res.status(403).json({
                        success: false,
                        reason: 'invalid_admin_origin',
                        message: '허용되지 않은 관리자 요청 출처입니다.',
                    });
                }
                const csrfToken = String(req.headers['x-csrf-token'] || '').trim();
                if (!safeEqual(csrfToken, auth.csrfToken)) {
                    return res.status(403).json({
                        success: false,
                        reason: 'invalid_admin_csrf',
                        message: '관리자 보안 토큰이 올바르지 않습니다. 다시 로그인해주세요.',
                    });
                }
            }

            return next();
        } catch (error) {
            wgsRuntimeLog("error", "services/adminSessionService.js:436", '[admin session protection] error:', error);
            return res.status(500).json({
                success: false,
                reason: 'admin_session_error',
                message: '관리자 세션을 확인하는 중 오류가 발생했습니다.',
            });
        }
    }

    return {
        ensureSchema,
        createSession,
        authenticateRequest,
        revokeSessionHash,
        revokeAllForUser,
        setSessionCookie,
        clearSessionCookie,
        isAllowedOrigin,
        protect,
        cookieName,
        cookiePath,
        idleMs,
        absoluteMs,
    };
}

module.exports = {
    createAdminSessionService,
    isInternalApprovalBypassRequest,
    parseCookies,
    safeEqual,
};
