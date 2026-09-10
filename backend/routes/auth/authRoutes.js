// 로그인, 회원가입, 세션 API를 제공합니다.
'use strict';
const { runtimeLog: wgsRuntimeLog } = require("../../services/runtimeLog");


const crypto = require('crypto');
const { createMemberSessionService } = require('../../services/memberSessionService');
const registerMemberEmailVerificationRoutes = require('./memberEmailVerificationRoutes');
const { createMemberEmailVerificationService, MemberVerificationError, assertPassword } = require('../../services/memberEmailVerificationService');
const { createVisitSessionService } = require('../../services/visitSessionService');
const { createVisitorAnalyticsService } = require('../../services/visitorAnalyticsService');
const { createLegalConsentService } = require('../../services/legalConsentService');

function registerAuthRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const memberSessionService = options.memberSessionService || createMemberSessionService({ pool, env: options.env });
    const bcrypt = options.bcrypt;
    const sendEmail = options.sendEmail;
    const memberVerificationService = options.memberVerificationService || createMemberEmailVerificationService({ pool, sendEmail, env: options.env, clock: options.clock });
    const getUserByEmail = options.getUserByEmail;
    const getUserById = options.getUserById;
    const getKSTDateTime = options.getKSTDateTime;
    const ensureAdminUserControlSchema = options.ensureAdminUserControlSchema;
    const normalizeAdminBool = options.normalizeAdminBool;
    const getAdminMaintenanceState = options.getAdminMaintenanceState;
    const isAdminAccessUser = options.isAdminAccessUser;
    const adminColumnExists = options.adminColumnExists;
    const touchActiveUser = options.touchActiveUser;
    const removeActiveUser = options.removeActiveUser;
    const formatDateOnly = options.formatDateOnly;
    const isPrimaryAdminUser = options.isPrimaryAdminUser;
    const validateAdminSession = options.validateAdminSession;
    const SALT_ROUNDS = options.saltRounds;
    const ADMIN_USER_ID = options.adminUserId;
    const SERVER_INSTANCE_ID = options.serverInstanceId;
    const DEFAULT_MAINTENANCE_MESSAGE = options.defaultMaintenanceMessage;
    let legalConsentService = options.legalConsentService || null;
    const getLegalConsentService = () => {
        if (!legalConsentService) legalConsentService = createLegalConsentService({ pool });
        return legalConsentService;
    };
    const SIGNUP_ADMIN_NOTIFY_EMAIL = String(
        options.signupAdminNotifyEmail || process.env.SIGNUP_ADMIN_NOTIFY_EMAIL || ''
    ).trim();
    const required = {
        app, pool, bcrypt, sendEmail, getUserByEmail,
        getUserById, getKSTDateTime, ensureAdminUserControlSchema, normalizeAdminBool,
        getAdminMaintenanceState, isAdminAccessUser, adminColumnExists, touchActiveUser,
        removeActiveUser, formatDateOnly, isPrimaryAdminUser, validateAdminSession,
        SALT_ROUNDS, ADMIN_USER_ID, SERVER_INSTANCE_ID, DEFAULT_MAINTENANCE_MESSAGE,
    };
    const missing = Object.entries(required).filter(([, value]) => value === undefined || value === null).map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerAuthRoutes missing dependencies: ${missing.join(', ')}`);
    }
    const visitSessionService = options.visitSessionService || createVisitSessionService({
        pool,
        env: options.env,
        clock: options.clock,
        crypto: options.crypto,
    });
    const visitorAnalyticsService = options.visitorAnalyticsService || createVisitorAnalyticsService({
        pool,
        env: options.env,
        clock: options.clock,
        crypto: options.crypto,
    });

    const loginReplaceConfirmations = new Map();
    const LOGIN_REPLACE_CONFIRMATION_TTL_MS = 60 * 1000;

    function visitorClientIdFromRequest(req) {
        const header = req?.headers?.['x-wgs-client-id'];
        const value = Array.isArray(header) ? header[0] : header;
        return value || req?.body?.visitorClientId || null;
    }

    function appendSetCookie(res, cookie) {
        if (typeof res.append === 'function') {
            res.append('Set-Cookie', cookie);
            return;
        }
        const current = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
        const values = current === undefined
            ? cookie
            : [...(Array.isArray(current) ? current : [current]), cookie];
        res.setHeader('Set-Cookie', values);
    }

    async function safelyRecordSuccessfulLogin(user, req, historyId, res) {
        const isExcluded = isAdminAccessUser(user) || isPrimaryAdminUser(user);
        try {
            await visitSessionService.recordSuccessfulLogin({
                clientId: visitorClientIdFromRequest(req),
                memberUserId: user.id,
                historyId,
                isExcluded,
                request: req,
            });
        } catch (error) {
            // Analytics must never turn a valid credential flow into a failed login.
            wgsRuntimeLog("error", "routes/auth/authRoutes.js:101", '[visit sessions] login linkage failed:', error.message);
        }
        if (isExcluded) {
            try {
                appendSetCookie(res, visitorAnalyticsService.createAdminExclusionCookie());
            } catch (error) {
                wgsRuntimeLog("error", "routes/auth/authRoutes.js:107", '[visit sessions] admin exclusion cookie failed:', error.message);
            }
        } else {
            try {
                appendSetCookie(res, visitorAnalyticsService.createAdminExclusionClearCookie());
            } catch (error) {
                wgsRuntimeLog("error", "routes/auth/authRoutes.js:113", '[visit sessions] admin exclusion cookie clear failed:', error.message);
            }
        }
    }

    async function safelyLinkAuthenticatedSession(user, req) {
        try {
            await visitSessionService.linkAuthenticatedSession({
                clientId: visitorClientIdFromRequest(req),
                memberUserId: user.id,
                isExcluded: isAdminAccessUser(user) || isPrimaryAdminUser(user),
                request: req,
            });
        } catch (error) {
            // Session validation remains authoritative even if analytics is unavailable.
            wgsRuntimeLog("error", "routes/auth/authRoutes.js:128", '[visit sessions] session linkage failed:', error.message);
        }
    }

    function tokenHash(value) {
        return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
    }

    function issueLoginReplaceConfirmation(userId, currentSessionToken) {
        if (loginReplaceConfirmations.size >= 1000) loginReplaceConfirmations.delete(loginReplaceConfirmations.keys().next().value);
        const rawToken = crypto.randomBytes(32).toString('base64url');
        loginReplaceConfirmations.set(tokenHash(rawToken), {
            userId: String(userId),
            currentSessionHash: tokenHash(currentSessionToken),
            expiresAt: Date.now() + LOGIN_REPLACE_CONFIRMATION_TTL_MS,
        });
        return rawToken;
    }

    function consumeLoginReplaceConfirmation(rawToken, userId, currentSessionToken) {
        const key = tokenHash(rawToken);
        const record = loginReplaceConfirmations.get(key);
        loginReplaceConfirmations.delete(key);
        if (!record || record.expiresAt < Date.now()) return false;
        return record.userId === String(userId)
            && record.currentSessionHash === tokenHash(currentSessionToken);
    }

    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of loginReplaceConfirmations.entries()) {
            if (!record || record.expiresAt < now) loginReplaceConfirmations.delete(key);
        }
    }, 60 * 1000).unref?.();

    async function ensureSignupApprovalSchema() {
        await getLegalConsentService().ensureSchema();
    }

    async function findPendingSignupRequestByIdOrEmail(id, email) {
        await ensureSignupApprovalSchema();
        const normalizedId = String(id || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const [rows] = await pool.query(
            `SELECT id, login_id AS loginId, email, status
             FROM wgs_signup_requests
             WHERE status = 'PENDING' AND (login_id = ? OR LOWER(email) = ?)
             ORDER BY requested_at DESC, id DESC
             LIMIT 1`,
            [normalizedId, normalizedEmail]
        );
        return rows[0] || null;
    }

    async function getLatestSignupRequestByLoginId(id) {
        await ensureSignupApprovalSchema();
        const normalizedId = String(id || '').trim();
        if (!normalizedId) return null;
        const [rows] = await pool.query(
            `SELECT id, login_id AS loginId, email, status, review_note AS reviewNote,
                    DATE_FORMAT(requested_at, '%Y-%m-%d %H:%i:%s') AS requestedAt,
                    DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewedAt
             FROM wgs_signup_requests
             WHERE login_id = ?
             ORDER BY requested_at DESC, id DESC
             LIMIT 1`,
            [normalizedId]
        );
        return rows[0] || null;
    }

    function getSignupRequestIp(req) {
        const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        return forwarded || req.ip || req.socket?.remoteAddress || null;
    }

    function buildSignupAdminNoticeText({ id, name, email }) {
        return [
            '신규 회원가입 승인 요청이 접수되었습니다.',
            '',
            `아이디: ${id}`,
            `이름: ${name}`,
            `이메일: ${email}`,
            '',
            '관리자 페이지의 [회원가입 승인] 탭에서 승인 또는 거절을 처리해주세요.',
        ].join('\n');
    }

    registerMemberEmailVerificationRoutes({ app, memberVerificationService, getUserById, getUserByEmail,
        validateRealtimeSession: options.validateRealtimeSession });

    // 7. 회원가입 / 로그인 / 계정 찾기
    app.post('/api/check-id', async (req, res) => {
        const id = String(req.body.id || '').trim();

        if (!id) return res.status(400).json({ success: false, msg: '아이디를 입력해주세요.' });

        try {
            const user = await getUserById(id);
            if (user) return res.status(400).json({ success: false, msg: '이미 사용 중인 아이디입니다.' });
            const pendingRequest = await findPendingSignupRequestByIdOrEmail(id, '');
            if (pendingRequest) {
                return res.status(400).json({ success: false, msg: '이미 회원가입 승인 대기 중인 아이디입니다.' });
            }

            return res.json({ success: true, msg: '사용 가능한 아이디입니다.' });
        } catch (error) {
            wgsRuntimeLog("error", "routes/auth/authRoutes.js:235", '아이디 중복 확인 오류:', error);
            return res.status(500).json({ success: false, msg: '아이디 확인 중 서버 오류가 발생했습니다.' });
        }
    });

    app.post('/api/signup', async (req, res) => {

        const id = String(req.body.id || '').trim();
        const password = String(req.body.password || '');
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();

        if (!id || !password || !name || !email) {
            return res.status(400).json({ success: false, msg: '회원가입 정보가 부족합니다.' });
        }

        try {
            memberVerificationService.assertOrigin(req);
            assertPassword(password);
            const consentService = getLegalConsentService();
            const legalValidation = await consentService.validateAcceptanceBundle(
                req.body?.legal,
                'signup',
                { requireAge14: true }
            );
            const duplicatedId = await getUserById(id);
            if (duplicatedId) return res.status(400).json({ success: false, msg: '이미 존재하는 아이디입니다.' });

            const duplicatedEmail = await getUserByEmail(email);
            if (duplicatedEmail) return res.status(400).json({ success: false, msg: '이미 가입된 이메일입니다.' });

            const pendingRequest = await findPendingSignupRequestByIdOrEmail(id, email);
            if (pendingRequest) {
                return res.status(400).json({
                    success: false,
                    msg: pendingRequest.loginId === id
                        ? '이미 회원가입 승인 대기 중인 아이디입니다.'
                        : '이미 회원가입 승인 대기 중인 이메일입니다.',
                });
            }

            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            await memberVerificationService.consume(req, 'signup', { email }, async (connection) => {
                const [insertResult] = await connection.query(
                    `INSERT INTO wgs_signup_requests
                     (login_id, password_hash, name, email, status, request_ip, user_agent)
                     VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
                    [id, hashedPassword, name, email, getSignupRequestIp(req), String(req.headers['user-agent'] || '').slice(0, 1000)]
                );
                await consentService.insertAcceptanceEvents(connection, {
                    signupRequestId: insertResult.insertId,
                    age14Confirmed: legalValidation.age14Confirmed,
                    acceptedDocuments: legalValidation.acceptedDocuments,
                });
            });
            memberVerificationService.clearCookie(res);

            const adminNoticeResult = await sendEmail(
                SIGNUP_ADMIN_NOTIFY_EMAIL,
                '[SKN_우공실] 신규 회원가입 승인 요청',
                buildSignupAdminNoticeText({ id, name, email })
            );

            if (adminNoticeResult?.success === false) {
                wgsRuntimeLog("warn", "routes/auth/authRoutes.js:299", '[signup approval] admin notice email failed:', adminNoticeResult.error?.message || adminNoticeResult.error);
            }

            return res.status(202).json({
                success: true,
                pendingApproval: true,
                msg: '회원가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.',
            });
        } catch (error) {
            if (error instanceof MemberVerificationError) return memberVerificationService.respondError(res, error);
            wgsRuntimeLog("error", "routes/auth/authRoutes.js:309", '회원가입 처리 실패:', error.code || 'unknown');
            if (error?.status && error?.code) {
                return res.status(Number(error.status)).json({
                    success: false,
                    code: error.code,
                    msg: error.message,
                });
            }
            return res.status(500).json({ success: false, msg: '가입 처리 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/login', async (req, res) => {
        const id = String(req.body.id || '').trim();
        const password = String(req.body.password || '');
        const replaceConfirmationToken = String(req.body.replaceConfirmationToken || '').trim();
        const force = Boolean(replaceConfirmationToken);
        const clientSessionHash = memberSessionService.tokenHashFromRequest(req);

        if (req.body.force && !replaceConfirmationToken) {
            return res.status(400).json({
                success: false,
                errorType: 'unsafe_force_login_disabled',
                msg: '보안 확인이 만료되었습니다. 처음부터 다시 로그인해주세요.',
            });
        }

        // 2차 요청은 첫 요청의 비밀번호 검증 뒤 서버가 발급한 60초 일회용 토큰으로만 허용합니다.

        // 점검 모드가 활성화된 경우 일반 사용자의 신규 로그인을 차단합니다.
        // 주 관리자와 운영자 권한 계정은 점검 중에도 로그인할 수 있도록 로그인 검증 이후 권한을 확인합니다.
        try {
            memberSessionService.assertOrigin(req);
            const user = await getUserById(id);

            if (!user) {
                const signupRequest = await getLatestSignupRequestByLoginId(id);
                if (signupRequest?.status === 'PENDING') {
                    return res.json({
                        success: false,
                        requireConfirm: false,
                        errorType: 'approval_pending',
                        msg: '회원가입 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다.',
                    });
                }
                if (signupRequest?.status === 'REJECTED') {
                    return res.json({
                        success: false,
                        requireConfirm: false,
                        errorType: 'signup_rejected',
                        msg: signupRequest.reviewNote
                            ? `회원가입이 거절되었습니다. 사유: ${signupRequest.reviewNote}`
                            : '회원가입이 거절되었습니다. 관리자에게 문의해주세요.',
                    });
                }
                return res.json({ success: false, requireConfirm: false, errorType: 'id_wrong' });
            }

            const isPasswordMatched = await bcrypt.compare(password, user.password);

            if (!isPasswordMatched) {
                return res.json({ success: false, requireConfirm: false, errorType: 'pw_wrong' });
            }

            await ensureAdminUserControlSchema();
            if (normalizeAdminBool(user.is_suspended)) {
                const reason = user.suspension_reason || '관리자에 의해 임시정지되었습니다';
                return res.status(403).json({
                    success: false,
                    suspended: true,
                    msg: `${reason} 사유로 로그인이 불가능합니다. 관리자에게 문의하세요.`,
                    message: `${reason} 사유로 로그인이 불가능합니다. 관리자에게 문의하세요.`,
                });
            }

            const maintenance = getAdminMaintenanceState();
            if (maintenance.is_enabled && !isAdminAccessUser(user)) {
                return res.status(503).json({
                    success: false,
                    maintenance: true,
                    msg: maintenance.message || DEFAULT_MAINTENANCE_MESSAGE,
                    maintenanceInfo: maintenance,
                });
            }

            const activeSession = await memberSessionService.activeForUser(user.id);
            const previousHash = activeSession?.token_hash || null;
            if (previousHash && !force && previousHash !== clientSessionHash) {
                const confirmationToken = issueLoginReplaceConfirmation(id, previousHash);
                return res.json({ success: false, requireConfirm: true, replaceConfirmationToken: confirmationToken,
                    replaceConfirmationExpiresInSeconds: 60, msg: '현재 다른 환경(기기 또는 브라우저)에서 로그인중입니다, 로그아웃 후 계속하시겠습니까?' });
            }
            if (force && !consumeLoginReplaceConfirmation(replaceConfirmationToken, id, previousHash)) {
                return res.status(401).json({ success: false, requireConfirm: false, errorType: 'replace_confirmation_invalid', msg: '로그인 교체 확인이 만료되었거나 이미 사용되었습니다. 다시 시도해주세요.' });
            }

            // 기존 회원도 현재 활성 약관·개인정보 문서에 동의했는지 로그인 시점에 확인합니다.
            // 신규 가입자는 승인 과정에서 가입신청 증적이 회원 ID에 연결되므로 이 값이 false가 됩니다.
            const legalConsentStatus = await getLegalConsentService().getUserEvidenceStatus(user.id);
            const created = await memberSessionService.createSession(user, req, previousHash, async connection => {
                const [history] = await connection.query('INSERT INTO wgs_login_history (userId,time,action) VALUES (?,?,?)',
                    [id, getKSTDateTime(), force ? '다른 기기 로그인 교체' : '로그인']);
                await connection.query('UPDATE wgs_users SET last_login_at=NOW() WHERE id=?', [id]);
                return history.insertId;
            });
            memberSessionService.setCookie(res, created.rawToken);
            await safelyRecordSuccessfulLogin(user, req, created.auditId, res);
            touchActiveUser(user, req, created.sessionHash);

            return res.json({
                success: true,
                msg: '로그인 성공',
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    dDay: formatDateOnly(user.dDay),
                    isOperator: isAdminAccessUser(user),
                    isPrimaryAdmin: isPrimaryAdminUser(user),
                },
                requiresLegalConsent: !legalConsentStatus.complete,
                legalConsentStatus,
                csrfToken: created.csrfToken,
                expiresAt: created.expiresAt,
                idleExpiresAt: created.idleExpiresAt,
                serverInstanceId: SERVER_INSTANCE_ID
            });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ success: false, reason: error.reason, msg: error.message });
            wgsRuntimeLog("error", "routes/auth/authRoutes.js:438", '로그인 오류:', error.code || 'login_failed');
            return res.status(500).json({ success: false, msg: '로그인 시스템 오류' });
        }
    });

    app.post('/api/logout', async (req, res) => {
        try {
            const auth = await memberSessionService.validateRequest(req, { touch: false });
            if (!auth.valid) { memberSessionService.clearCookie(res); return res.status(401).json({ success: false, reason: auth.reason }); }
            await memberSessionService.revokeCurrent(auth);
            memberSessionService.clearCookie(res);
            removeActiveUser(auth.user.id, auth.sessionHash);
            await pool.query('INSERT INTO wgs_login_history(userId,time,action) VALUES(?,?,?)', [auth.user.id, getKSTDateTime(), '로그아웃']);
            return res.json({ success: true, msg: '로그아웃 완료', serverInstanceId: SERVER_INSTANCE_ID });
        } catch (error) { return res.status(error.status || 500).json({ success: false, reason: error.reason || 'logout_failed', msg: '로그아웃을 완료하지 못했습니다. 다시 시도해주세요.' }); }
    });

    const sessionStatus = async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const auth = await memberSessionService.validateRequest(req, { touch: false });
            if (!auth.valid) { memberSessionService.clearCookie(res); return res.json({ valid: false, reason: auth.reason, serverInstanceId: SERVER_INSTANCE_ID }); }
            const user = auth.user;
            touchActiveUser(user, req, auth.sessionHash);
            const isPrimaryAdmin = isPrimaryAdminUser(user), isOperator = isAdminAccessUser(user);
            await safelyLinkAuthenticatedSession(user, req);
            return res.json({ valid: true, csrfToken: auth.csrfToken, expiresAt: auth.expiresAt, idleExpiresAt: auth.idleExpiresAt,
                serverInstanceId: SERVER_INSTANCE_ID, userId: user.id, id: user.id, name: user.name || user.id, email: user.email || '', dDay: formatDateOnly(user.dDay),
                isAdmin: isOperator, is_admin: isOperator ? 1 : 0, isOperator, is_operator: isOperator ? 1 : 0, isPrimaryAdmin, is_primary_admin: isPrimaryAdmin ? 1 : 0 });
        } catch (error) { return res.status(error.status || 503).json({ valid: false, reason: error.reason || 'session_unavailable' }); }
    };
    app.get('/api/member/session', sessionStatus);
    app.post('/api/check-session', sessionStatus);

    app.post('/api/member/session/exchange', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            memberSessionService.assertOrigin(req);
            const id = String(req.body?.id || ''), legacyToken = String(req.body?.sessionToken || '');
            if (!/^[A-Za-z0-9_-]{43}$/.test(legacyToken)) return res.status(401).json({ valid: false, reason: 'member_upgrade_required' });
            const user = await getUserById(id);
            if (!user) return res.status(401).json({ valid: false, reason: 'member_upgrade_required' });
            const created = await memberSessionService.createSession(user, req, null, async () => null, legacyToken);
            memberSessionService.setCookie(res, created.rawToken);
            return res.json({ valid: true, csrfToken: created.csrfToken, expiresAt: created.expiresAt, idleExpiresAt: created.idleExpiresAt,
                id: user.id, userId: user.id, name: user.name, email: user.email || '', dDay: formatDateOnly(user.dDay), isOperator: isAdminAccessUser(user), isPrimaryAdmin: isPrimaryAdminUser(user), serverInstanceId: SERVER_INSTANCE_ID });
        } catch (error) { return res.status(error.status || 500).json({ valid: false, reason: error.reason || 'member_upgrade_failed' }); }
    });
}

module.exports = registerAuthRoutes;
