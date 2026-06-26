// 관리자 인증, 결재, 사용자 관리, 공지 API를 제공합니다.
'use strict';

const registerMealmapRoutes = require('./mealmapRoutes');
const registerAdminQuestionRoutes = require('./admin/adminQuestionRoutes');
const registerAdminUserCalendarRoutes = require('./admin/adminUserCalendarRoutes');
const registerAdminSignupRequestRoutes = require('./admin/adminSignupRequestRoutes');
const registerAdminNoticeMaintenanceRoutes = require('./admin/adminNoticeMaintenanceRoutes');
const registerAdminUserListRoutes = require('./admin/adminUserListRoutes');

function registerAdminRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const https = options.https;
    const validateAdminSession = options.validateAdminSession;
    const validateRealtimeSession = options.validateRealtimeSession;
    const getUserById = options.getUserById;
    const ensureAdminUserControlSchema = options.ensureAdminUserControlSchema;
    const adminTableExists = options.adminTableExists;
    const adminColumnExists = options.adminColumnExists;
    const normalizeAdminBool = options.normalizeAdminBool;
    const isPrimaryAdminUser = options.isPrimaryAdminUser;
    const validatePrimaryAdmin = options.validatePrimaryAdmin;
    const isAdminAccessUser = options.isAdminAccessUser;
    const getAdminUserControl = options.getAdminUserControl;
    const isUserManagementTargetProtected = options.isUserManagementTargetProtected;
    const getApprovalBypassToken = options.getApprovalBypassToken;
    const isApprovalBypassRequest = options.isApprovalBypassRequest;
    const touchActiveUser = options.touchActiveUser;
    const pruneActiveUsers = options.pruneActiveUsers;
    const getActiveUserList = options.getActiveUserList;
    const sanitizeAdminNoticeText = options.sanitizeAdminNoticeText;
    const getAdminBroadcastHistory = options.getAdminBroadcastHistory;
    const createAdminBroadcastNotice = options.createAdminBroadcastNotice;
    const getAdminBroadcastsForUser = options.getAdminBroadcastsForUser;
    const getAdminMaintenanceState = options.getAdminMaintenanceState;
    const updateAdminMaintenanceState = options.updateAdminMaintenanceState;
    const formatAdminDateTime = options.formatAdminDateTime;
    const sendEmail = options.sendEmail;
    const notifyMealMapPlaceDecisionV2515 = options.notifyMealMapPlaceDecisionV2515;
    const notifyMealMapEditDecisionV2515 = options.notifyMealMapEditDecisionV2515;
    const getUndeliveredMealMapUserNoticesV2515 = options.getUndeliveredMealMapUserNoticesV2515;
    const ADMIN_USER_ID = options.adminUserId;
    const SERVER_INSTANCE_ID = options.serverInstanceId;
    const ADMIN_ONLY_USER_ID = options.adminOnlyUserId;
    const DEFAULT_MAINTENANCE_MESSAGE = options.defaultMaintenanceMessage;

    const required = {
        app, pool, https, validateAdminSession, validateRealtimeSession, getUserById,
        ensureAdminUserControlSchema, adminTableExists, adminColumnExists, normalizeAdminBool,
        isAdminAccessUser, getAdminUserControl, isUserManagementTargetProtected,
        getApprovalBypassToken, isApprovalBypassRequest, touchActiveUser, pruneActiveUsers, getActiveUserList,
        sanitizeAdminNoticeText, getAdminBroadcastHistory, createAdminBroadcastNotice,
        getAdminBroadcastsForUser, getAdminMaintenanceState, updateAdminMaintenanceState,
        formatAdminDateTime, sendEmail, notifyMealMapPlaceDecisionV2515,
        notifyMealMapEditDecisionV2515, getUndeliveredMealMapUserNoticesV2515, ADMIN_USER_ID, SERVER_INSTANCE_ID,
        ADMIN_ONLY_USER_ID, DEFAULT_MAINTENANCE_MESSAGE,
    };
    const missing = Object.entries(required).filter(([, value]) => value === undefined || value === null).map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerAdminRoutes missing dependencies: ${missing.join(', ')}`);
    }

    function shouldBypassAdminApproval(req) {
        const path = req.path || "";
        if (req.method === "GET") return true;
        if (isApprovalBypassRequest(req)) return true;
        // 관리자 화면/홈 공지 조회처럼 데이터 변경이 없는 POST 조회 API는 결재 요청으로 만들지 않습니다.
        // 특히 /api/admin/notices/latest는 App.jsx에서 약 5초마다 호출되는 조회용 폴링 API입니다.
        if (req.method === "POST" && (path.endsWith("/list") || path.endsWith("/latest") || path.endsWith("/search") || path.endsWith("/stats"))) return true;

        const directPaths = [
            "/check-auth",
            "/online-users",
            "/users",
            "/approvals",
            "/email-user",
            "/notices/list",
            "/notices/latest",
            // 공지 발송과 점검 모드는 운영자 권한자도 결재 없이 즉시 적용합니다.
            "/notices/broadcast",
            "/maintenance",
            "/operation-logs",
            "/signup-requests",
            "/mealmap",
        ];

        return directPaths.some((item) => path === item || path.startsWith(`${item}/`));
    }

    async function getAdminActorFromRequest(req) {
        // 공통 이력에 실제 적용자를 남기기 위해 현재 세션의 사용자 정보를 조회합니다.
        try {
            const sessionUser = await validateRealtimeSession(req);
            if (!sessionUser?.id) return null;
            const user = await getUserById(sessionUser.id);
            return {
                id: sessionUser.id,
                name: user?.name || sessionUser.name || sessionUser.id,
            };
        } catch (error) {
            console.error('[관리자 이력 사용자 조회 오류]', error.message);
            return null;
        }
    }

    async function writeAdminOperationLog({ operationType, action, title, message, actor, payload }) {
        // 결재 없이 바로 적용되는 관리자 관리 이력을 DB에 저장하여 관리자들이 동일한 내역을 확인합니다.
        try {
            await pool.query(
                `INSERT INTO wgs_admin_operation_logs
                 (operation_type, action, title, message, actor_id, actor_name, payload, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    operationType,
                    action,
                    title || null,
                    message || null,
                    actor?.id || null,
                    actor?.name || null,
                    payload ? JSON.stringify(payload) : null,
                ]
            );
        } catch (error) {
            console.error('[관리자 적용 이력 저장 오류]', error.message);
        }
    }

    function summarizeAdminApproval(req) {
        const body = req.body && typeof req.body === "object"? req.body : {};
        const method = req.method || "POST";
        const path = req.originalUrl || req.url || "";

        let resource = "관리자 기능";
        if (path.includes("class-schedules")) resource = "달력·일정";
        else if (path.includes("notices")) resource = "공지";
        else if (path.includes("questions") || path.includes("problem")) resource = "문제·해설";
        else if (path.includes("settings") || path.includes("screen")) resource = "화면 설정";
        else if (path.includes("users")) resource = "사용자";

        let action = "수정";
        if (method === "POST") action = "추가/요청";
        if (method === "PUT" || method === "PATCH") action = "수정";
        if (method === "DELETE") action = "삭제";

        const nameHint = body.title || body.event_name || body.eventName || body.name || body.subject || body.question || body.id || body.targetId || "";
        const actionTitle = `[${resource}] ${action}${nameHint ? ` - ${String(nameHint).slice(0, 80)}` : ""}`;
        const actionPreview = JSON.stringify({ method, path, body }, null, 2).slice(0, 12000);

        return { actionTitle, actionPreview };
    }

    async function createAdminApprovalRequest({ requesterId, requesterName, method, path, body, actionTitle, actionPreview }) {
        // 운영자가 read를 제외한 관리자 작업을 누르면 실제 DB에 바로 반영하지 않고 결재 테이블에만 저장합니다.
        // 이 함수 하나로 일반 관리자 CRUD 미들웨어와 사용자관리 버튼 요청을 같은 형태로 기록합니다.
        await ensureAdminUserControlSchema();

        const safeMethod = String(method || 'POST').toUpperCase();
        const safePath = String(path || '');
        const safeBody = body && typeof body === 'object'? body : {};
        const safeTitle = actionTitle || `[관리자 기능] ${safeMethod}`;
        const safePreview = actionPreview || JSON.stringify({ method: safeMethod, path: safePath, body: safeBody }, null, 2).slice(0, 12000);

        const [result] = await pool.query(
            `INSERT INTO wgs_admin_approvals
             (requester_id, requester_name, action_method, action_path, action_title, action_body, action_preview, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [
                String(requesterId || ''),
                requesterName || requesterId || '',
                safeMethod,
                safePath,
                safeTitle,
                JSON.stringify(safeBody),
                safePreview,
            ]
        );

        return result.insertId;
    }

    function buildUserActionApprovalSummary({ actionName, targetUserId, targetUser, body, method, path }) {
        // 사용자관리 작업은 목록에서 봤을 때 어떤 회원에게 무엇을 요청했는지 바로 보이도록 제목/미리보기를 별도로 만든다.
        const targetName = targetUser?.name || targetUserId || '대상 사용자';
        const title = `[사용자] ${actionName} - ${targetName}(${targetUserId})`;
        const preview = JSON.stringify(
            {
                method,
                path,
                targetUser: {
                    id: targetUserId,
                    name: targetUser?.name || '',
                    email: targetUser?.email || '',
                },
                body,
            },
            null,
            2
        ).slice(0, 12000);

        return { actionTitle: title, actionPreview: preview };
    }

    async function adminApprovalMiddleware(req, res, next) {
        try {
            // body.userId는 이메일/사용자관리 API에서 대상 회원 id로 쓰이는 경우가 있어 요청자 판별에 쓰지 않는다.
            // 요청자는 프론트 공통 헤더(x-user-id) 또는 기존 admin_id/id 필드만 사용합니다.
            const body = req.body && typeof req.body === "object"? req.body : {};
            const userId = req.headers["x-user-id"] || req.headers["user-id"] || body.admin_id || body.adminId || body.id || req.query?.userId;

            if (shouldBypassAdminApproval(req)) return next();
            if (await validatePrimaryAdmin(userId)) return next();

            const user = await getAdminUserControl(userId);
            if (!user || !normalizeAdminBool(user.is_operator) || normalizeAdminBool(user.is_suspended)) {
                return res.status(403).json({ success: false, message: "관리자 권한이 없습니다." });
            }

            const { actionTitle, actionPreview } = summarizeAdminApproval(req);
            const approvalId = await createAdminApprovalRequest({
                requesterId: user.account || userId,
                requesterName: user.name || user.account || userId,
                method: req.method,
                path: req.originalUrl || req.url,
                body,
                actionTitle,
                actionPreview,
            });

            return res.json({
                success: true,
                pendingApproval: true,
                approvalId,
                message: "운영자 요청이 관리자 결재 대기 목록에 등록되었습니다. 최종 관리자 승인 후 실제 반영됩니다.",
            });
        } catch (err) {
            console.error("[adminApprovalMiddleware] error", err);
            return res.status(500).json({ success: false, message: "결재 요청 등록 중 오류가 발생했습니다." });
        }
    }

    async function applyApprovedAdminRequest(approval) {
        const method = String(approval.action_method || "POST").toUpperCase();
        const targetPath = String(approval.action_path || "");
        const body = approval.action_body ? JSON.parse(approval.action_body) : {};
        const baseUrl = `http://127.0.0.1:${Number(process.env.PORT || 5000)}`;

        // 내부 승인 반영은 관리자 API 상대경로만 허용합니다. 외부 URL이나 엉뚱한 경로가 저장돼도 호출하지 않는다.
        if (!targetPath.startsWith('/api/admin/')) {
            const err = new Error('승인 반영 실패: 허용되지 않은 관리자 API 경로입니다.');
            err.applyResult = { targetPath };
            throw err;
        }

        const response = await fetch(`${baseUrl}${targetPath}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                "x-user-id": ADMIN_USER_ID,
                "x-admin-approval-bypass": getApprovalBypassToken(),
            },
            body: ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify(body),
        });

        const text = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }

        if (!response.ok) {
            const err = new Error(`승인 반영 실패: HTTP ${response.status}`);
            err.applyResult = parsed;
            throw err;
        }

        return parsed;
    }

    async function adminGroupedCount(tableName, userColumn, userIds) {
        if (!Array.isArray(userIds) || userIds.length === 0) return {};

        try {
            const tableOk = await adminTableExists(tableName);
            const columnOk = tableOk ? await adminColumnExists(tableName, userColumn) : false;
            if (!tableOk || !columnOk) return {};

            const [rows] = await pool.query(
                `SELECT ${userColumn} AS userId, COUNT(*) AS cnt
                 FROM ${tableName}
                 WHERE ${userColumn} IN (?)
                 GROUP BY ${userColumn}`,
                [userIds]
            );

            return rows.reduce((acc, row) => {
                acc[String(row.userId)] = Number(row.cnt || 0);
                return acc;
            }, {});
        } catch (error) {
            console.warn(`관리자 사용자별 집계 실패(${tableName}.${userColumn}):`, error.message);
            return {};
        }
    }


    // 관리자 페이지 흐름: 실시간 접속자 현황 API입니다.
    // - 프론트에서 GET /api/admin/online-users로 호출합니다.
    // - DB를 변경하지 않고 서버 메모리(activeUsers)에 기록된 현재 접속자만 조회합니다.
    // - body가 없는 GET 요청에서도 validateRealtimeSession이 오류 없이 처리되도록 준비합니다.
    app.get('/api/admin/online-users', async (req, res) => {
        try {
            const adminUser = await validateAdminSession(req);
            if (!adminUser.valid || !adminUser.isAdmin) {
                const status = adminUser.reason === 'not_admin'? 403 : 401;
                return res.status(status).json({ success: false, msg: '관리자 권한이 필요합니다.', reason: adminUser.reason });
            }

            // 관리자 본인도 현재 활동 중인 사용자로 갱신합니다.
            touchActiveUser(adminUser.user, req, adminUser.sessionToken);

            const users = getActiveUserList().map((user) => ({
                id: user.id,
                name: user.name || user.id,
                role: user.role || (String(user.id).toLowerCase() === ADMIN_USER_ID ? 'admin' : 'user'),
                lastSeenAt: user.lastSeenAt,
                loginAt: user.loginAt || user.lastSeenAt,
            }));

            return res.json({
                success: true,
                count: users.length,
                serverTime: new Date().toISOString(),
                users,
            });
        } catch (error) {
            console.error('관리자 실시간 접속자 조회 오류:', error);
            return res.status(500).json({ success: false, msg: '관리자 실시간 접속자 조회 중 오류가 발생했습니다.' });
        }
    });


    // 관리자 API 요청값 통합 헬퍼.
    // GET 요청은 req.query, POST 요청은 req.body에 값이 들어오므로 둘을 합쳐서 같은 로직으로 처리합니다.
    function getAdminRequestData(req) {
        return {
            ...(req && req.query && typeof req.query === 'object'? req.query : {}),
            ...(req && req.body && typeof req.body === 'object'? req.body : {}),
        };
    }

    registerMealmapRoutes({
        app,
        pool,
        https,
        validateAdminSession,
        validateRealtimeSession,
        notifyMealMapPlaceDecisionV2515,
        notifyMealMapEditDecisionV2515,
        createAdminApprovalRequest,
    });

    // 운영자 쓰기 작업은 먼저 결재 대기 목록에 등록합니다.
    app.use('/api/admin', adminApprovalMiddleware);

    // 관리자 . 문제/해설 관리 API
    // ------------------------------------------------------------
    // 목적:
    // 1) 기존 문제 풀이 API(/api/random-question, /api/past-exam, /api/ipep/*)는 그대로 두고
    //  /api/admin/questions 아래에 관리자 전용 조회/수정 API만 새로 추가합니다.
    // 2) 필기 문제(questions/options/answers)와 실기 문제(ipep_random_questions/ipep_past_questions)를
    //  같은 관리자 화면에서 검색하고, 선택한 1문제만 안전하게 수정합니다.
    // 3) 실기 테이블에는 원래 해설 텍스트 컬럼이 없을 수 있으므로 explanation_text 컬럼만 없을 때 추가합니다.
    //  이미 있는 데이터와 기존 기능은 변경하지 않는다.
    registerAdminQuestionRoutes({
        app,
        pool,
        validateAdminSession,
        adminTableExists,
        adminColumnExists,
        serverInstanceId: SERVER_INSTANCE_ID,
    });

    registerAdminUserCalendarRoutes({
        app,
        pool,
        validateAdminSession,
    });

    registerAdminNoticeMaintenanceRoutes({
        app,
        pool,
        validateAdminSession,
        validateRealtimeSession,
        pruneActiveUsers,
        getActiveUserList,
        sanitizeAdminNoticeText,
        getAdminBroadcastHistory,
        createAdminBroadcastNotice,
        getAdminBroadcastsForUser,
        getAdminMaintenanceState,
        updateAdminMaintenanceState,
        formatAdminDateTime,
        writeAdminOperationLog,
        getUndeliveredMealMapUserNoticesV2515,
        adminOnlyUserId: ADMIN_ONLY_USER_ID,
        defaultMaintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
    });

    registerAdminSignupRequestRoutes({
        app,
        pool,
        validateAdminSession,
        ensureAdminUserControlSchema,
        sendEmail,
        writeAdminOperationLog,
        adminUserId: ADMIN_USER_ID,
    });

    registerAdminUserListRoutes({
        app,
        pool,
        ensureAdminUserControlSchema,
        adminTableExists,
        adminColumnExists,
        adminGroupedCount,
        getActiveUserList,
        formatAdminDateTime,
        normalizeAdminBool,
        isPrimaryAdminUser,
        isAdminAccessUser,
    });

    // 사용자 접속자 관리 - 접속 제한/삭제/운영자 권한/개별 메일/결재 현황 API
    app.post('/api/admin/users/:userId/suspend', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
            }

            await ensureAdminUserControlSchema();
            const requesterId = auth.user?.id || auth.id;
            const targetId = String(req.params.userId || '').trim();
            const suspend = normalizeAdminBool(req.body?.suspend);
            const reason = String(req.body?.reason || '').trim();

            if (!targetId) return res.status(400).json({ success: false, message: '대상 사용자가 없습니다.' });
            if (await isUserManagementTargetProtected(requesterId, targetId)) {
                return res.status(400).json({ success: false, message: '보호 대상 계정은 임시정지할 수 없습니다.' });
            }
            if (suspend && !reason) return res.status(400).json({ success: false, message: '임시정지 사유를 입력해주세요.' });

            const targetUser = await getAdminUserControl(targetId);
            if (!targetUser) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

            // 최고관리자는 즉시 반영, 운영자는 결재 요청만 등록합니다.
            if (!auth.isPrimaryAdmin) {
                const body = { suspend, reason };
                const { actionTitle, actionPreview } = buildUserActionApprovalSummary({
                    actionName: suspend ? '임시정지 적용 요청' : '임시정지 해제 요청',
                    targetUserId: targetId,
                    targetUser,
                    body,
                    method: 'POST',
                    path: req.originalUrl || req.url,
                });
                const approvalId = await createAdminApprovalRequest({
                    requesterId,
                    requesterName: auth.user?.name || requesterId,
                    method: 'POST',
                    path: req.originalUrl || req.url,
                    body,
                    actionTitle,
                    actionPreview,
                });

                return res.json({
                    success: true,
                    pendingApproval: true,
                    approvalId,
                    message: '운영자 요청이 결재 대기 목록에 등록되었습니다. 최고관리자 승인 후 임시정지가 실제 반영됩니다.',
                });
            }

            const [result] = await pool.query(
                `UPDATE wgs_users
                 SET is_suspended = ?, suspension_reason = ?, suspended_at = NOW(), sessionToken = IF(?, NULL, sessionToken)
                 WHERE id = ?`,
                [suspend ? 1 : 0, suspend ? reason : null, suspend ? 1 : 0, targetId]
            );

            if (!result.affectedRows) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
            return res.json({ success: true, message: suspend ? '임시정지 처리되었습니다.' : '임시정지가 해제되었습니다.' });
        } catch (error) {
            console.error('[admin suspend user] error', error);
            return res.status(500).json({ success: false, message: '임시정지 처리 중 오류가 발생했습니다.' });
        }
    });


    app.delete('/api/admin/users/:userId', async (req, res) => {
        const conn = await pool.getConnection();
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
            }

            await ensureAdminUserControlSchema();
            const requesterId = auth.user?.id || auth.id;
            const targetId = String(req.params.userId || '').trim();
            if (!targetId) return res.status(400).json({ success: false, message: '대상 사용자가 없습니다.' });
            if (await isUserManagementTargetProtected(requesterId, targetId)) {
                return res.status(400).json({ success: false, message: '보호 대상 계정은 삭제할 수 없습니다.' });
            }

            const targetUser = await getAdminUserControl(targetId);
            if (!targetUser) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

            // 운영자 계정 삭제 요청은 위험도가 높으므로 즉시 삭제하지 않고 결재 대기 목록에만 저장합니다.
            if (!auth.isPrimaryAdmin) {
                const body = {};
                const { actionTitle, actionPreview } = buildUserActionApprovalSummary({
                    actionName: '계정삭제 요청',
                    targetUserId: targetId,
                    targetUser,
                    body,
                    method: 'DELETE',
                    path: req.originalUrl || req.url,
                });
                const approvalId = await createAdminApprovalRequest({
                    requesterId,
                    requesterName: auth.user?.name || requesterId,
                    method: 'DELETE',
                    path: req.originalUrl || req.url,
                    body,
                    actionTitle,
                    actionPreview,
                });

                return res.json({
                    success: true,
                    pendingApproval: true,
                    approvalId,
                    message: '운영자 요청이 결재 대기 목록에 등록되었습니다. 최고관리자 승인 후 계정 삭제가 실제 반영됩니다.',
                });
            }

            await conn.beginTransaction();
            const knownDeleteTargets = [
                ['wgs_login_history', ['userId', 'user_id']],
                ['wgs_wrong_notes', ['userId', 'user_id']],
                ['wgs_ranking_random', ['userId', 'user_id', 'account']],
                ['wgs_ranking_past', ['userId', 'user_id', 'account']],
                ['wgs_admin_approvals', ['requester_id']],
            ];

            for (const [tableName, columns] of knownDeleteTargets) {
                if (!(await adminTableExists(tableName))) continue;
                for (const columnName of columns) {
                    if (await adminColumnExists(tableName, columnName)) {
                        await conn.query(`DELETE FROM ${tableName} WHERE ${columnName} = ?`, [targetId]);
                    }
                }
            }

            const [result] = await conn.query('DELETE FROM wgs_users WHERE id = ?', [targetId]);
            if (!result.affectedRows) {
                await conn.rollback();
                return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
            }

            await conn.commit();
            return res.json({ success: true, message: '계정이 삭제되었습니다. 같은 정보로 다시 회원가입할 수 있습니다.' });
        } catch (error) {
            try { await conn.rollback(); } catch {}
            console.error('[admin delete user] error', error);
            return res.status(500).json({ success: false, message: '계정 삭제 중 오류가 발생했습니다.' });
        } finally {
            conn.release();
        }
    });


    app.post('/api/admin/users/:userId/operator', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
            }

            await ensureAdminUserControlSchema();
            const requesterId = auth.user?.id || auth.id;
            const targetId = String(req.params.userId || '').trim();
            const enable = normalizeAdminBool(req.body?.enable);
            const reason = String(req.body?.reason || '').trim();

            if (!targetId) return res.status(400).json({ success: false, message: '대상 사용자가 없습니다.' });
            if (await validatePrimaryAdmin(targetId)) {
                return res.status(400).json({ success: false, message: '최종 관리자 계정은 항상 운영자 권한을 가집니다.' });
            }
            if (await isUserManagementTargetProtected(requesterId, targetId)) {
                return res.status(400).json({ success: false, message: '보호 대상 계정은 관리자 권한을 변경할 수 없습니다.' });
            }
            if (!enable && !reason) return res.status(400).json({ success: false, message: '운영자 비활성화 사유를 입력해주세요.' });

            const targetUser = await getAdminUserControl(targetId);
            if (!targetUser) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

            // 최고관리자는 운영자 권한을 즉시 변경할 수 있고, 운영자는 일반 사용자에 대한 변경 요청만 등록할 수 있습니다.
            if (!auth.isPrimaryAdmin) {
                const body = { enable, reason };
                const { actionTitle, actionPreview } = buildUserActionApprovalSummary({
                    actionName: enable ? '관리자 권한 활성화 요청' : '관리자 권한 비활성화 요청',
                    targetUserId: targetId,
                    targetUser,
                    body,
                    method: 'POST',
                    path: req.originalUrl || req.url,
                });
                const approvalId = await createAdminApprovalRequest({
                    requesterId,
                    requesterName: auth.user?.name || requesterId,
                    method: 'POST',
                    path: req.originalUrl || req.url,
                    body,
                    actionTitle,
                    actionPreview,
                });

                return res.json({
                    success: true,
                    pendingApproval: true,
                    approvalId,
                    message: '운영자 요청이 결재 대기 목록에 등록되었습니다. 최고관리자 승인 후 관리자 권한 변경이 실제 반영됩니다.',
                });
            }

            const [result] = await pool.query(
                `UPDATE wgs_users
                 SET is_operator = ?, operator_reason = ?, operator_updated_at = NOW(), operator_updated_by = ?
                 WHERE id = ?`,
                [enable ? 1 : 0, reason || null, auth.user?.id || ADMIN_USER_ID, targetId]
            );

            if (!result.affectedRows) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
            return res.json({ success: true, message: enable ? '운영자 권한이 활성화되었습니다.' : '운영자 권한이 비활성화되었습니다.' });
        } catch (error) {
            console.error('[admin operator user] error', error);
            return res.status(500).json({ success: false, message: '운영자 권한 처리 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/admin/email-user', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });

            const targetId = String(req.body?.userId || '').trim();
            const subject = String(req.body?.subject || '').trim();
            const text = String(req.body?.text || req.body?.message || '').trim();

            if (!targetId || !subject || !text) {
                return res.status(400).json({ success: false, message: '대상, 제목, 내용을 모두 입력해주세요.' });
            }

            const [rows] = await pool.query('SELECT id, name, email FROM wgs_users WHERE id = ? LIMIT 1', [targetId]);
            const target = rows?.[0];
            if (!target || !target.email) return res.status(404).json({ success: false, message: '수신자 이메일을 찾을 수 없습니다.' });

            const mailText = [`안녕하세요, ${target.name || target.id}님.`, '', text, '', '- SKN_우공실 -'].join('\n');
            const result = await sendEmail(target.email, subject, mailText);
            if (result?.success === false) {
                return res.status(500).json({ success: false, message: result.error?.message || '이메일 전송에 실패했습니다.' });
            }
            return res.json({ success: true, message: '이메일을 전송했습니다.', result });
        } catch (error) {
            console.error('[admin email user] error', error);
            return res.status(500).json({ success: false, message: '이메일 전송 중 오류가 발생했습니다.' });
        }
    });

    app.get('/api/admin/approvals', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });

            await ensureAdminUserControlSchema();
            const params = [];
            let where = ' WHERE hidden_from_primary = 0';
            if (!auth.isPrimaryAdmin) {
                // 운영자는 본인이 올린 결재만 보고, 운영자 본인 화면에서 숨긴 결재는 제외합니다.
                where = ' WHERE requester_id = ? AND hidden_from_requester = 0';
                params.push(auth.user?.id || auth.id);
            }

            const [rows] = await pool.query(
                `SELECT id, requester_id AS requesterId, requester_name AS requesterName,
                        action_method AS actionMethod, action_path AS actionPath, action_title AS actionTitle,
                        action_preview AS actionPreview, status,
                        DATE_FORMAT(requested_at, '%Y-%m-%d %H:%i:%s') AS requestedAt,
                        reviewed_by AS reviewedBy,
                        DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewedAt,
                        reject_reason AS rejectReason, apply_result AS applyResult
                 FROM wgs_admin_approvals
                 ${where}
                 ORDER BY requested_at DESC, id DESC
                 LIMIT 5000`,
                params
            );

            return res.json({ success: true, isPrimaryAdmin: auth.isPrimaryAdmin, approvals: rows });
        } catch (error) {
            console.error('[admin approvals list] error', error);
            return res.status(500).json({ success: false, message: '결재 목록 조회 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/admin/approvals/:approvalId/approve', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid || !auth.isPrimaryAdmin) {
                return res.status(403).json({ success: false, message: '최종 관리자만 승인할 수 있습니다.' });
            }

            await ensureAdminUserControlSchema();
            const approvalId = Number(req.params.approvalId);
            const [rows] = await pool.query('SELECT * FROM wgs_admin_approvals WHERE id = ? LIMIT 1', [approvalId]);
            const approval = rows?.[0];
            if (!approval) return res.status(404).json({ success: false, message: '결재 요청을 찾을 수 없습니다.' });
            if (approval.status !== 'PENDING') return res.status(400).json({ success: false, message: '이미 처리된 결재 요청입니다.' });

            const applyResult = await applyApprovedAdminRequest(approval);
            await pool.query(
                `UPDATE wgs_admin_approvals
                 SET status = 'APPROVED', reviewed_by = ?, reviewed_at = NOW(), apply_result = ?
                 WHERE id = ?`,
                [auth.user?.id || ADMIN_USER_ID, JSON.stringify(applyResult).slice(0, 60000), approvalId]
            );

            return res.json({ success: true, message: '승인 및 실제 반영이 완료되었습니다.', applyResult });
        } catch (error) {
            console.error('[admin approval approve] error', error);
            return res.status(500).json({ success: false, message: error.message || '결재 승인 중 오류가 발생했습니다.', detail: error.applyResult || null });
        }
    });

    app.post('/api/admin/approvals/:approvalId/reject', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid || !auth.isPrimaryAdmin) {
                return res.status(403).json({ success: false, message: '최종 관리자만 반려할 수 있습니다.' });
            }

            await ensureAdminUserControlSchema();
            const approvalId = Number(req.params.approvalId);
            const reason = String(req.body?.reason || '').trim();
            if (!reason) return res.status(400).json({ success: false, message: '반려 사유를 입력해주세요.' });

            const [result] = await pool.query(
                `UPDATE wgs_admin_approvals
                 SET status = 'REJECTED', reviewed_by = ?, reviewed_at = NOW(), reject_reason = ?
                 WHERE id = ? AND status = 'PENDING'`,
                [auth.user?.id || ADMIN_USER_ID, reason, approvalId]
            );

            if (!result.affectedRows) return res.status(404).json({ success: false, message: '대기 중인 결재 요청을 찾을 수 없습니다.' });
            return res.json({ success: true, message: '반려 처리되었습니다.' });
        } catch (error) {
            console.error('[admin approval reject] error', error);
            return res.status(500).json({ success: false, message: '결재 반려 중 오류가 발생했습니다.' });
        }
    });

    // 결재 내역 정리용 숨김 처리입니다. 승인 또는 반려가 끝난 내역만 정리할 수 있습니다.
    // 최고관리자와 운영자의 숨김 컬럼을 분리해서 한쪽이 정리해도 다른 쪽 목록에는 영향을 주지 않는다.
    app.delete('/api/admin/approvals', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
            await ensureAdminUserControlSchema();

            const ids = Array.isArray(req.body?.ids)
                ? req.body.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id >0)
                : [];
            const uniqueIds = [...new Set(ids)];
            if (!uniqueIds.length) {
                return res.status(400).json({ success: false, message: '정리할 결재 항목을 선택해주세요.' });
            }
            if (uniqueIds.length >50) {
                return res.status(400).json({ success: false, message: '한 번에 최대 50개까지만 정리할 수 있습니다.' });
            }

            const placeholders = uniqueIds.map(() => '?').join(',');
            const requesterFilter = auth.isPrimaryAdmin ? '' : ' AND requester_id = ?';
            const selectParams = auth.isPrimaryAdmin ? uniqueIds : [...uniqueIds, auth.user?.id || auth.id];
            const [rows] = await pool.query(
                `SELECT id, status, requester_id FROM wgs_admin_approvals WHERE id IN (${placeholders})${requesterFilter}`,
                selectParams
            );

            if (!rows.length) {
                return res.status(404).json({ success: false, message: '정리 가능한 결재 항목을 찾지 못했습니다.' });
            }
            if (rows.some((row) => String(row.status || '').toUpperCase() === 'PENDING')) {
                return res.status(400).json({ success: false, message: '대기 상태 결재는 승인 또는 반려 후 정리할 수 있습니다.' });
            }

            const targetIds = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id >0);
            const updatePlaceholders = targetIds.map(() => '?').join(',');
            const hideColumn = auth.isPrimaryAdmin ? 'hidden_from_primary' : 'hidden_from_requester';
            const updateRequesterFilter = auth.isPrimaryAdmin ? '' : ' AND requester_id = ?';
            const updateParams = auth.isPrimaryAdmin ? targetIds : [...targetIds, auth.user?.id || auth.id];
            const [result] = await pool.query(
                `UPDATE wgs_admin_approvals
                 SET ${hideColumn} = 1
                 WHERE id IN (${updatePlaceholders}) AND status <> 'PENDING'${updateRequesterFilter}`,
                updateParams
            );

            return res.json({
                success: true,
                deletedCount: result?.affectedRows || 0,
                message: '선택한 결재 내역을 현재 화면에서 정리했습니다.',
            });
        } catch (error) {
            console.error('[admin approval delete] error', error);
            return res.status(500).json({ success: false, message: '결재 내역 정리 중 오류가 발생했습니다.' });
        }
    });
}

module.exports = registerAdminRoutes;
