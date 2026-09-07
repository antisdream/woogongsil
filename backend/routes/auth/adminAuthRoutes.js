// 일반 회원 로그인과 독립된 관리자 전용 로그인 API입니다.
'use strict';

const { createVisitSessionService } = require('../../services/visitSessionService');
const { createVisitorAnalyticsService } = require('../../services/visitorAnalyticsService');

const DUMMY_BCRYPT_HASH = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';

function registerAdminAuthRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const bcrypt = options.bcrypt;
    const getUserById = options.getUserById;
    const getAdminUserControl = options.getAdminUserControl;
    const ensureAdminUserControlSchema = options.ensureAdminUserControlSchema;
    const normalizeAdminBool = options.normalizeAdminBool;
    const isAdminAccessUser = options.isAdminAccessUser;
    const isPrimaryAdminUser = options.isPrimaryAdminUser;
    const adminSessionService = options.adminSessionService;
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

    const required = {
        app,
        pool,
        bcrypt,
        getUserById,
        getAdminUserControl,
        ensureAdminUserControlSchema,
        normalizeAdminBool,
        isAdminAccessUser,
        isPrimaryAdminUser,
        adminSessionService,
    };
    const missing = Object.entries(required)
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length) {
        throw new Error(`registerAdminAuthRoutes missing dependencies: ${missing.join(', ')}`);
    }

    function setNoStore(res) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
    }

    function visitorClientIdFromRequest(req) {
        const header = req?.headers?.['x-wgs-client-id'];
        return Array.isArray(header) ? header[0] : header;
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

    async function safelyExcludeAdminVisitor(req, res) {
        try {
            await visitSessionService.excludeClientSession({
                clientId: visitorClientIdFromRequest(req),
            });
        } catch (error) {
            // 방문 분석 오류가 유효한 관리자 인증을 실패시키면 안 됩니다.
            console.error('[visit sessions] admin exclusion failed:', error.message);
        }
        appendSetCookie(res, visitorAnalyticsService.createAdminExclusionCookie());
    }

    function publicAdmin(auth) {
        return {
            id: auth.user.id,
            name: auth.user.name || auth.user.id,
            email: auth.user.email || '',
            isAdmin: true,
            isOperator: Boolean(auth.isOperator),
            isPrimaryAdmin: Boolean(auth.isPrimaryAdmin),
        };
    }

    async function writeLoginAudit(userId, action, req) {
        try {
            await pool.query(
                `INSERT INTO wgs_admin_operation_logs
                 (operation_type, action, title, actor_id, actor_name, payload, created_at)
                 VALUES ('admin_auth', ?, ?, ?, ?, ?, NOW())`,
                [
                    action,
                    action === 'login' ? '관리자 로그인' : '관리자 로그아웃',
                    String(userId || ''),
                    String(userId || ''),
                    JSON.stringify({
                        ipHashRecorded: true,
                        userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 240),
                    }),
                ]
            );
        } catch (error) {
            console.warn('[admin auth audit] write failed:', error.message);
        }
    }

    app.post('/api/admin/auth/login', async (req, res) => {
        setNoStore(res);

        if (!adminSessionService.isAllowedOrigin(req)) {
            return res.status(403).json({
                success: false,
                reason: 'invalid_admin_origin',
                message: '허용되지 않은 관리자 로그인 출처입니다.',
            });
        }


        const id = String(req.body?.id || '').trim();
        const password = String(req.body?.password || '');
        if (!id || !password) {
            return res.status(400).json({
                success: false,
                message: '관리자 아이디와 비밀번호를 입력해주세요.',
            });
        }

        try {
            await ensureAdminUserControlSchema();
            const user = await getUserById(id);
            const passwordMatches = await bcrypt.compare(password, user?.password || DUMMY_BCRYPT_HASH);
            const userControl = user ? await getAdminUserControl(user.id) : null;
            const allowed = Boolean(
                user
                && passwordMatches
                && userControl
                && !normalizeAdminBool(userControl.is_suspended)
                && isAdminAccessUser(userControl)
            );

            if (!allowed) {
                adminSessionService.clearSessionCookie(res);
                return res.status(401).json({
                    success: false,
                    reason: 'invalid_admin_credentials',
                    message: '관리자 로그인 정보를 확인해주세요.',
                });
            }

            const created = await adminSessionService.createSession(user.id, req);
            adminSessionService.setSessionCookie(res, created.rawToken);

            const auth = {
                user: {
                    id: userControl.id,
                    name: userControl.name || user.name || userControl.id,
                    email: userControl.email || user.email || '',
                },
                isOperator: true,
                isPrimaryAdmin: isPrimaryAdminUser(userControl),
            };

            await writeLoginAudit(user.id, 'login', req);
            await safelyExcludeAdminVisitor(req, res);

            return res.json({
                success: true,
                valid: true,
                admin: publicAdmin(auth),
                csrfToken: created.csrfToken,
                idleExpiresAt: created.idleExpiresAt,
                expiresAt: created.expiresAt,
            });
        } catch (error) {
            console.error('[admin auth login] error:', error);
            return res.status(500).json({
                success: false,
                reason: 'admin_login_error',
                message: '관리자 로그인 처리 중 오류가 발생했습니다.',
            });
        }
    });

    app.get('/api/admin/auth/me', async (req, res) => {
        setNoStore(res);
        const auth = req.adminAuth;
        await safelyExcludeAdminVisitor(req, res);
        return res.json({
            success: true,
            valid: true,
            admin: publicAdmin(auth),
            csrfToken: auth.csrfToken,
            idleExpiresAt: auth.idleExpiresAt,
            expiresAt: auth.expiresAt,
        });
    });

    app.post('/api/admin/auth/logout', async (req, res) => {
        setNoStore(res);
        const auth = req.adminAuth;
        adminSessionService.clearSessionCookie(res);
        try {
            await adminSessionService.revokeSessionHash(auth.sessionHash, 'logout');
            await writeLoginAudit(auth.user.id, 'logout', req);
            return res.json({ success: true, message: '관리자 로그아웃이 완료되었습니다.' });
        } catch (error) {
            console.error('[admin auth logout] error:', error);
            return res.status(500).json({
                success: false,
                reason: 'admin_logout_error',
                message: '관리자 로그아웃 처리 중 오류가 발생했습니다.',
            });
        }
    });

    app.post('/api/admin/auth/logout-all', async (req, res) => {
        setNoStore(res);
        const auth = req.adminAuth;
        adminSessionService.clearSessionCookie(res);
        try {
            const revokedCount = await adminSessionService.revokeAllForUser(auth.user.id, 'logout_all');
            return res.json({
                success: true,
                revokedCount,
                message: '이 관리자 계정의 모든 관리자 세션을 종료했습니다.',
            });
        } catch (error) {
            console.error('[admin auth logout-all] error:', error);
            return res.status(500).json({
                success: false,
                reason: 'admin_logout_all_error',
                message: '전체 관리자 세션 종료 중 오류가 발생했습니다.',
            });
        }
    });
}

module.exports = registerAdminAuthRoutes;
