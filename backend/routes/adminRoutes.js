// 관리자 인증, 결재, 사용자 관리, 공지 API를 제공합니다.
'use strict';

const registerMealmapRoutes = require('./mealmapRoutes');

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
        getApprovalBypassToken, isApprovalBypassRequest, touchActiveUser, getActiveUserList,
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

    // 관리자 전체 공지 최근 발송 이력을 조회합니다.
    // 관리자 화면 새로고침 또는 발송 후 이력 갱신에 사용합니다.
    const handleAdminNoticeList = async (req, res) => {
        try {
            const adminSession = await validateAdminSession(req);
            if (!adminSession.valid || !adminSession.isAdmin) {
                const statusCode = adminSession.reason === 'not_admin'? 403 : 401;
                return res.status(statusCode).json({ success: false, msg: adminSession.message || '관리자 인증이 필요합니다.' });
            }

            return res.json({
                success: true,
                history: getAdminBroadcastHistory(),
            });
        } catch (error) {
            console.error('[admin notice list error]', error);
            return res.status(500).json({ success: false, msg: '공지 이력을 불러오는 중 오류가 발생했습니다.' });
        }
    };

    // 관리자 권한 사용자가 현재 접속 중인 사용자에게 전체 공지를 발송합니다.
    // DB 구조를 바꾸지 않기 위해 공지는 서버 메모리에 보관하고, 사용자는 /api/admin/notices/latest 폴링으로 수신합니다.
    const handleAdminNoticeBroadcast = async (req, res) => {
        try {
            const adminSession = await validateAdminSession(req);
            if (!adminSession.valid || !adminSession.isAdmin) {
                const statusCode = adminSession.reason === 'not_admin'? 403 : 401;
                return res.status(statusCode).json({ success: false, msg: adminSession.message || '관리자 인증이 필요합니다.' });
            }

            const body = req.body || {};
            const title = sanitizeAdminNoticeText(body.title, 80) || '관리자 공지';
            const message = sanitizeAdminNoticeText(body.message, 800);
            const requestedLevel = String(body.level || 'info').trim();
            const level = ['info', 'warning', 'urgent'].includes(requestedLevel) ? requestedLevel : 'info';

            if (message.length < 2) {
                return res.status(400).json({ success: false, msg: '공지 내용은 최소 2글자 이상 입력해주세요.' });
            }

            pruneActiveUsers();
            const activeList = getActiveUserList();
            const notice = createAdminBroadcastNotice({
                title,
                message,
                level,
                authorId: adminSession.user.id,
                authorName: adminSession.user.name || adminSession.user.id,
                deliveredTo: activeList.length,
            });

            await writeAdminOperationLog({
                operationType: 'notice',
                action: '발송',
                title,
                message,
                actor: {
                    id: adminSession.user.id,
                    name: adminSession.user.name || adminSession.user.id,
                },
                payload: { level, deliveredTo: activeList.length },
            });

            console.log(`[admin notice] ${adminSession.user.id} -> ${activeList.length} users: ${title}`);

            return res.json({
                success: true,
                msg: '전체 공지를 발송했습니다.',
                notice,
                deliveredTo: activeList.length,
                history: getAdminBroadcastHistory(),
            });
        } catch (error) {
            console.error('[admin notice broadcast error]', error);
            return res.status(500).json({ success: false, msg: '공지 발송 중 오류가 발생했습니다.' });
        }
    };

    // 점검 모드 API 응답용 데이터를 만듭니다.
    // 프론트에서 바로 표시할 수 있게 updatedAtText도 같이 내려줍니다.
    function buildMaintenanceResponse() {
        const state = getAdminMaintenanceState();
        return {
            ...state,
            updatedAtText: formatAdminDateTime(state.updatedAt),
            adminOnlyUserId: ADMIN_ONLY_USER_ID,
        };
    }

    // 모든 사용자가 현재 점검 상태를 조회하는 공개 API입니다.
    // 비로그인 상태에서도 점검 여부를 확인해야 하므로 관리자 검증을 붙이지 않습니다.
    function handleMaintenanceStatus(req, res) {
        return res.json({
            success: true,
            maintenance: buildMaintenanceResponse(),
        });
    }

    // 관리자 페이지에서 점검 모드를 켜고 끄는 API입니다.
    // 기존 validateAdminSession을 그대로 사용해서 관리자 권한이 없으면 변경할 수 없습니다.
    async function handleAdminMaintenanceUpdate(req, res) {
        try {
            const adminCheck = await validateAdminSession(req);
            if (!adminCheck.valid || !adminCheck.isAdmin) {
                const statusCode = adminCheck.reason === 'not_admin'? 403 : 401;
                return res.status(statusCode).json({ success: false, msg: adminCheck.message || '관리자 인증이 필요합니다.' });
            }

            const enabled = Boolean(req.body?.enabled);
            const message = String(req.body?.message || DEFAULT_MAINTENANCE_MESSAGE).trim() || DEFAULT_MAINTENANCE_MESSAGE;
            const nextState = updateAdminMaintenanceState({
                enabled,
                message,
                updatedBy: adminCheck.user.id,
            });

            await writeAdminOperationLog({
                operationType: 'maintenance',
                action: enabled ? ' ON' : 'OFF',
                title: enabled ? '점검 모드 ON' : '점검 모드 OFF',
                message,
                actor: {
                    id: adminCheck.user.id,
                    name: adminCheck.user.name || adminCheck.user.id,
                },
                payload: { enabled },
            });

            console.log(`[admin maintenance] ${adminCheck.user.id} -> ${enabled ? ' ON' : 'OFF'}`);
            return res.json({
                success: true,
                maintenance: {
                    ...nextState,
                    updatedAtText: formatAdminDateTime(nextState.updatedAt),
                    adminOnlyUserId: ADMIN_ONLY_USER_ID,
                },
                msg: enabled ? '점검 모드가 활성화되었습니다.' : '점검 모드가 해제되었습니다.',
            });
        } catch (error) {
            console.error('[admin maintenance error]', error);
            return res.status(500).json({
                success: false,
                msg: '점검 모드 변경 중 서버 오류가 발생했습니다.',
            });
        }
    }


    // 로그인 사용자가 새 관리자 공지를 확인합니다.
    // 현재 프로젝트는 별도 소켓 클라이언트를 붙이지 않았기 때문에 5초 폴링 방식으로 안전하게 전달합니다.
    async function handleAdminOperationLogList(req, res) {
        // 전체 공지/점검 모드 적용 이력을 같은 API에서 타입별로 조회합니다.
        try {
            const adminCheck = await validateAdminSession(req);
            if (!adminCheck.valid || !adminCheck.isAdmin) {
                return res.status(403).json({ success: false, msg: '관리자 권한이 필요합니다.' });
            }

            const requestedType = String(req.query.type || 'notice').trim();
            const operationType = requestedType === 'maintenance'? 'maintenance' : 'notice';
            const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
            const sort = String(req.query.sort || 'desc').toLowerCase() === 'asc'? 'ASC' : 'DESC';
            const offset = (page - 1) * limit;

            const [[countRow]] = await pool.query(
                'SELECT COUNT(*) AS total FROM wgs_admin_operation_logs WHERE operation_type = ?',
                [operationType]
            );
            const [rows] = await pool.query(
                `SELECT id, operation_type AS operationType, action, title, message,
                        actor_id AS actorId, actor_name AS actorName, payload, created_at AS createdAt
                 FROM wgs_admin_operation_logs
                 WHERE operation_type = ?
                 ORDER BY created_at ${sort}, id ${sort}
                 LIMIT ? OFFSET ?`,
                [operationType, limit, offset]
            );

            const total = Number(countRow?.total || 0);
            const items = rows.map((row) => {
                let payload = null;
                if (row.payload) {
                    try { payload = JSON.parse(row.payload); } catch (_) { payload = null; }
                }
                return {
                    ...row,
                    payload,
                    createdAt: formatAdminDateTime(row.createdAt),
                };
            });

            return res.json({
                success: true,
                type: operationType,
                items,
                total,
                page,
                totalPages: Math.max(Math.ceil(total / limit), 1),
                limit,
                sort: sort.toLowerCase(),
            });
        } catch (error) {
            console.error('[관리자 적용 이력 조회 오류]', error);
            return res.status(500).json({ success: false, msg: '적용 이력을 불러오지 못했습니다.' });
        }
    }

    const handleLatestAdminNotices = async (req, res) => {
        try {
            const session = await validateRealtimeSession(req);
            if (!session.valid) {
                return res.status(401).json({ success: false, msg: session.reason || '로그인이 필요합니다.' });
            }

            const body = req.body || {};
            const sinceMs = Number(body.sinceMs || 0);
            const adminNotices = getAdminBroadcastsForUser(session.user.id, sinceMs);
            const mealmapNotices = await getUndeliveredMealMapUserNoticesV2515(session.user.id);
            const notices = [...adminNotices, ...mealmapNotices];

            return res.json({
                success: true,
                notices,
                serverNow: Date.now(),
            });
        } catch (error) {
            console.error('[admin notice latest error]', error);
            return res.status(500).json({ success: false, msg: '관리자 공지 확인 중 오류가 발생했습니다.' });
        }
    };

    const handleAdminUsers = async (req, res) => {
        // 사용자접속 관리 탭 목록 조회 안정화.
        // 기존 DB에 신규 컬럼이 없거나, 일부 활동 테이블 구조가 달라도 목록 API가 전체 실패하지 않도록 분리 조회합니다.
        try {
            if (!(await adminTableExists('wgs_users'))) {
                return res.json({
                    success: true,
                    summary: { totalUsers: 0, onlineUsers: 0, loginKeepUsers: 0, todayLoginCount: 0 },
                    users: [],
                    recentLoginLogs: [],
                });
            }

            try {
                // 신규 컬럼은 가능하면 자동 생성합니다. 실패해도 목록 조회 자체는 호환 모드로 계속 진행합니다.
                await ensureAdminUserControlSchema();
            } catch (schemaError) {
                console.warn('[admin/users] user-control schema check failed; list will use compatibility mode:', schemaError.message);
            }

            const keyword = String(req.query.q || req.query.keyword || req.query.search || '').trim();
            const hasEmail = await adminColumnExists('wgs_users', 'email');
            const hasDDay = await adminColumnExists('wgs_users', 'dDay');
            const hasSessionToken = await adminColumnExists('wgs_users', 'sessionToken');
            const hasCreatedAt = await adminColumnExists('wgs_users', 'created_at');
            const hasLastLoginAt = await adminColumnExists('wgs_users', 'last_login_at');
            const hasLastLogoutAt = await adminColumnExists('wgs_users', 'last_logout_at');
            const hasIsSuspended = await adminColumnExists('wgs_users', 'is_suspended');
            const hasSuspensionReason = await adminColumnExists('wgs_users', 'suspension_reason');
            const hasSuspendedAt = await adminColumnExists('wgs_users', 'suspended_at');
            const hasIsPrimaryAdmin = await adminColumnExists('wgs_users', 'is_primary_admin');
            const hasIsOperator = await adminColumnExists('wgs_users', 'is_operator');
            const hasOperatorReason = await adminColumnExists('wgs_users', 'operator_reason');
            const hasOperatorUpdatedAt = await adminColumnExists('wgs_users', 'operator_updated_at');
            const hasOperatorUpdatedBy = await adminColumnExists('wgs_users', 'operator_updated_by');
            const hasAccount = await adminColumnExists('wgs_users', 'account');

            const where = [];
            const params = [];
            if (keyword) {
                const searchColumns = [hasAccount ? 'account' : 'id', 'name'];
                if (hasEmail) searchColumns.push('email');
                where.push(`(${searchColumns.map((col) => `u.${col} LIKE ?`).join(' OR ')})`);
                searchColumns.forEach(() => params.push(`%${keyword}%`));
            }
            const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

            const accountExpr = hasAccount ? 'u.account' : 'u.id';

            const selectParts = [
                'u.id AS id',
                `${accountExpr} AS account`,
                `${accountExpr} AS userId`,
                'u.name AS name',
                hasEmail ? 'u.email AS email' : "''AS email",
                hasDDay ? 'u.dDay AS dDay' : 'NULL AS dDay',
                hasSessionToken ? 'u.sessionToken AS sessionToken' : 'NULL AS sessionToken',
                hasCreatedAt ? 'u.created_at AS created_at' : 'NULL AS created_at',
                hasLastLoginAt ? 'u.last_login_at AS last_login_at' : 'NULL AS last_login_at',
                hasLastLogoutAt ? 'u.last_logout_at AS last_logout_at' : 'NULL AS last_logout_at',
                hasIsSuspended ? 'COALESCE(u.is_suspended, 0) AS is_suspended' : '0 AS is_suspended',
                hasSuspensionReason ? 'u.suspension_reason AS suspension_reason' : "''AS suspension_reason",
                hasSuspendedAt ? 'u.suspended_at AS suspended_at' : 'NULL AS suspended_at',
                hasIsPrimaryAdmin ? 'COALESCE(u.is_primary_admin, 0) AS is_primary_admin' : '0 AS is_primary_admin',
                hasIsOperator ? 'COALESCE(u.is_operator, 0) AS is_operator' : '0 AS is_operator',
                hasOperatorReason ? 'u.operator_reason AS operator_reason' : "''AS operator_reason",
                hasOperatorUpdatedAt ? 'u.operator_updated_at AS operator_updated_at' : 'NULL AS operator_updated_at',
                hasOperatorUpdatedBy ? 'u.operator_updated_by AS operator_updated_by' : "''AS operator_updated_by",
            ];

            const [users] = await pool.query(
                `SELECT ${selectParts.join(',\n                   ')}
                   FROM wgs_users u
                   ${whereSql}
                  ORDER BY ${hasCreatedAt ? 'u.created_at DESC,' : ''} u.id DESC`,
                params
            );

            const userIds = users.map((user) => String(user.userId || user.account || '')).filter(Boolean);

            async function getHistoryCountByType(typeValues) {
                if (!userIds.length) return {};
                if (!(await adminTableExists('wgs_login_history'))) return {};
                const hasUserId = await adminColumnExists('wgs_login_history', 'userId');
                const hasType = await adminColumnExists('wgs_login_history', 'type');
                const hasAction = await adminColumnExists('wgs_login_history', 'action');
                if (!hasUserId || (!hasType && !hasAction)) return {};
                const actionColumn = hasType ? 'type' : 'action';
                const values = Array.isArray(typeValues) ? typeValues : [typeValues];
                try {
                    const [rows] = await pool.query(
                        `SELECT userId, COUNT(*) AS cnt
                           FROM wgs_login_history
                          WHERE userId IN (?) AND ${actionColumn} IN (?)
                          GROUP BY userId`,
                        [userIds, values]
                    );
                    return Object.fromEntries((rows || []).map((row) => [String(row.userId), Number(row.cnt || 0)]));
                } catch (error) {
                    console.warn(`[admin/users] login history count failed (${values.join(',')}):`, error.message);
                    return {};
                }
            }

            async function getHistoryLatestByType(typeValues) {
                // 최근 로그인/로그아웃 보조 컬럼이 비어 있어도 wgs_login_history 기준으로 최신 시각을 표시합니다.
                if (!userIds.length) return {};
                if (!(await adminTableExists('wgs_login_history'))) return {};
                const hasUserId = await adminColumnExists('wgs_login_history', 'userId');
                const hasTime = await adminColumnExists('wgs_login_history', 'time');
                const hasType = await adminColumnExists('wgs_login_history', 'type');
                const hasAction = await adminColumnExists('wgs_login_history', 'action');
                if (!hasUserId || !hasTime || (!hasType && !hasAction)) return {};
                const actionColumn = hasType ? 'type' : 'action';
                const values = Array.isArray(typeValues) ? typeValues : [typeValues];
                try {
                    const [rows] = await pool.query(
                        `SELECT userId, MAX(time) AS latestAt
                           FROM wgs_login_history
                          WHERE userId IN (?) AND ${actionColumn} IN (?)
                          GROUP BY userId`,
                        [userIds, values]
                    );
                    return Object.fromEntries((rows || []).map((row) => [String(row.userId), row.latestAt]));
                } catch (error) {
                    console.warn(`[admin/users] latest login history lookup failed (${values.join(',')}):`, error.message);
                    return {};
                }
            }

            const loginCounts = await getHistoryCountByType(['login', '로그인']);
            const logoutCounts = await getHistoryCountByType(['logout', '로그아웃']);
            const loginLatestMap = await getHistoryLatestByType(['login', '로그인']);
            const logoutLatestMap = await getHistoryLatestByType(['logout', '로그아웃']);
            const postCounts = await adminGroupedCount('wgs_posts', 'authorId', userIds);
            const commentCounts = await adminGroupedCount('wgs_comments', 'authorId', userIds);
            const wrongCounts = await adminGroupedCount('wgs_wrong_notes', 'userId', userIds);

            const mappedUsers = users.map((user) => {
                const key = String(user.userId || user.account || '');
                const joinedAtValue = user.created_at || null;
                const lastLoginValue = user.last_login_at || loginLatestMap[key] || null;
                const lastLogoutValue = user.last_logout_at || logoutLatestMap[key] || null;
                return {
                    id: user.id,
                    account: user.account,
                    userId: key,
                    name: user.name || user.account || key,
                    email: user.email || '',
                    dDay: user.dDay || null,
                    sessionToken: user.sessionToken || null,
                    isOnline: Boolean(user.sessionToken),
                    // wgs_users.created_at 값을 가입일자로 표시합니다.
                    registrationDate: joinedAtValue ? formatAdminDateTime(joinedAtValue) : '-',
                    registrationDateRaw: joinedAtValue,
                    createdAt: joinedAtValue ? formatAdminDateTime(joinedAtValue) : null,
                    created_at: joinedAtValue ? formatAdminDateTime(joinedAtValue) : null,
                    // 보조 컬럼이 없거나 비어 있으면 wgs_login_history에서 최신 값을 보완합니다.
                    lastLoginAt: lastLoginValue ? formatAdminDateTime(lastLoginValue) : '-',
                    lastLoginAtRaw: lastLoginValue,
                    recentLoginAt: lastLoginValue ? formatAdminDateTime(lastLoginValue) : null,
                    last_login_at: lastLoginValue ? formatAdminDateTime(lastLoginValue) : null,
                    lastLogoutAt: lastLogoutValue ? formatAdminDateTime(lastLogoutValue) : '-',
                    lastLogoutAtRaw: lastLogoutValue,
                    recentLogoutAt: lastLogoutValue ? formatAdminDateTime(lastLogoutValue) : null,
                    last_logout_at: lastLogoutValue ? formatAdminDateTime(lastLogoutValue) : null,
                    isSuspended: normalizeAdminBool(user.is_suspended),
                    suspensionReason: user.suspension_reason || '',
                    suspendedAt: user.suspended_at ? formatAdminDateTime(user.suspended_at) : '-',
                    suspendedAtRaw: user.suspended_at || null,
                    isPrimaryAdmin: isPrimaryAdminUser(user),
                    isOperator: isAdminAccessUser({ ...user, id: key }),
                    operatorReason: user.operator_reason || '',
                    operatorUpdatedAt: user.operator_updated_at ? formatAdminDateTime(user.operator_updated_at) : '-',
                    operatorUpdatedAtRaw: user.operator_updated_at || null,
                    operatorUpdatedBy: user.operator_updated_by || '',
                    activity: {
                        login: Number(loginCounts[key] || 0),
                        logout: Number(logoutCounts[key] || 0),
                        posts: Number(postCounts[key] || 0),
                        comments: Number(commentCounts[key] || 0),
                        wrongNotes: Number(wrongCounts[key] || 0),
                    },
                };
            });

            async function getTodayLoginCount() {
                if (!(await adminTableExists('wgs_login_history'))) return 0;
                const hasType = await adminColumnExists('wgs_login_history', 'type');
                const hasAction = await adminColumnExists('wgs_login_history', 'action');
                const hasCreatedAt = await adminColumnExists('wgs_login_history', 'created_at');
                const hasTime = await adminColumnExists('wgs_login_history', 'time');
                if ((!hasType && !hasAction) || (!hasCreatedAt && !hasTime)) return 0;
                const actionColumn = hasType ? 'type' : 'action';
                const timeColumn = hasCreatedAt ? 'created_at' : 'time';
                try {
                    const [[row]] = await pool.query(
                        `SELECT COUNT(*) AS cnt
                           FROM wgs_login_history
                          WHERE ${actionColumn} = 'login' AND DATE(${timeColumn}) = CURDATE()`
                    );
                    return Number(row?.cnt || 0);
                } catch (error) {
                    console.warn('[admin/users] today login count failed:', error.message);
                    return 0;
                }
            }

            async function getRecentLoginLogs() {
                if (!(await adminTableExists('wgs_login_history'))) return [];
                const hasUserId = await adminColumnExists('wgs_login_history', 'userId');
                const hasType = await adminColumnExists('wgs_login_history', 'type');
                const hasAction = await adminColumnExists('wgs_login_history', 'action');
                const hasCreatedAt = await adminColumnExists('wgs_login_history', 'created_at');
                const hasTime = await adminColumnExists('wgs_login_history', 'time');
                if (!hasUserId || (!hasType && !hasAction) || (!hasCreatedAt && !hasTime)) return [];
                const actionColumn = hasType ? 'type' : 'action';
                const timeColumn = hasCreatedAt ? 'created_at' : 'time';
                try {
                    const [rows] = await pool.query(
                        `SELECT userId, ${actionColumn} AS action, ${timeColumn} AS actionTime
                           FROM wgs_login_history
                          ORDER BY ${timeColumn} DESC
                          LIMIT 20`
                    );
                    return (rows || []).map((row) => ({
                        userId: row.userId,
                        action: row.action,
                        time: row.actionTime ? formatAdminDateTime(row.actionTime) : '-',
                        rawTime: row.actionTime || null,
                    }));
                } catch (error) {
                    console.warn('[admin/users] recent login logs failed:', error.message);
                    return [];
                }
            }

            const onlineUsers = mappedUsers.filter((user) => user.isOnline).length;
            const loginKeepUsers = mappedUsers.filter((user) => !user.isSuspended).length;
            const todayLoginCount = await getTodayLoginCount();
            const recentLoginLogs = await getRecentLoginLogs();

            res.json({
                success: true,
                summary: {
                    totalUsers: mappedUsers.length,
                    onlineUsers,
                    loginKeepUsers,
                    todayLoginCount,
                },
                users: mappedUsers,
                recentLoginLogs,
            });
        } catch (error) {
            console.error('관리자 사용자 목록 조회 오류:', error);
            res.status(500).json({
                success: false,
                msg: '관리자 사용자 목록 조회 중 오류가 발생했습니다.',
                detail: error.message,
            });
        }
    };




    // 관리자 . 문제/해설 관리 API
    // ------------------------------------------------------------
    // 목적:
    // 1) 기존 문제 풀이 API(/api/random-question, /api/past-exam, /api/ipep/*)는 그대로 두고
    //  /api/admin/questions 아래에 관리자 전용 조회/수정 API만 새로 추가합니다.
    // 2) 필기 문제(questions/options/answers)와 실기 문제(ipep_random_questions/ipep_past_questions)를
    //  같은 관리자 화면에서 검색하고, 선택한 1문제만 안전하게 수정합니다.
    // 3) 실기 테이블에는 원래 해설 텍스트 컬럼이 없을 수 있으므로 explanation_text 컬럼만 없을 때 추가합니다.
    //  이미 있는 데이터와 기존 기능은 변경하지 않는다.
    const ADMIN_QUESTION_TYPES = new Set(['written', 'ipep_random', 'ipep_past']);
    const IPEP_GRADING_POLICIES = new Set(['FLEX_TERM', 'MULTI_TERM', 'EXACT_OUTPUT', 'SQL_TEXT', 'SELF_CHECK']);

    function normalizeAdminQuestionType(value) {
        const type = String(value || 'written').trim();
        return ADMIN_QUESTION_TYPES.has(type) ? type : 'written';
    }

    function adminCleanText(value, maxLength = 20000) {
        const text = value === null || value === undefined ? '' : String(value);
        return text.length >maxLength ? text.slice(0, maxLength) : text;
    }

    function adminNullableText(value, maxLength = 20000) {
        const text = adminCleanText(value, maxLength).trim();
        return text === ''? null : text;
    }

    function adminNumber(value, fallback = null) {
        if (value === null || value === undefined || value === '') return fallback;
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function adminTinyInt(value, fallback = 1) {
        const num = adminNumber(value, fallback);
        return num ? 1 : 0;
    }

    function adminLimit(value) {
        const num = Number(value || 20);
        if (!Number.isFinite(num)) return 20;
        return Math.min(Math.max(Math.floor(num), 5), 100);
    }

    function adminPage(value) {
        const num = Number(value || 1);
        if (!Number.isFinite(num)) return 1;
        return Math.max(Math.floor(num), 1);
    }

    function adminToJsonColumn(value) {
        if (value === null || value === undefined || value === '') return null;

        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
            return JSON.stringify(value);
        }

        const textValue = String(value).trim();
        if (!textValue) return null;

        try {
            JSON.parse(textValue);
            return textValue;
        } catch (error) {
            const err = new Error('JSON 입력값 형식이 올바르지 않습니다. 예: ["정답1", "정답2"]');
            err.statusCode = 400;
            throw err;
        }
    }

    async function requireAdminQuestionAccess(req, res) {
        const adminCheck = await validateAdminSession(req);
        if (!adminCheck.valid || !adminCheck.isAdmin) {
            const statusCode = adminCheck.reason === 'not_admin'? 403 : 401;
            res.status(statusCode).json({
                success: false,
                msg: adminCheck.message || '관리자 인증이 필요합니다.',
                reason: adminCheck.reason || 'not_admin',
                serverInstanceId: SERVER_INSTANCE_ID,
            });
            return null;
        }
        return adminCheck;
    }

    async function ensureIpepAdminExplanationColumns() {
        const targets = ['ipep_random_questions', 'ipep_past_questions'];

        for (const tableName of targets) {
            const tableOk = await adminTableExists(tableName);
            if (!tableOk) continue;

            const hasExplanationText = await adminColumnExists(tableName, 'explanation_text');
            if (!hasExplanationText) {
                // 실기 데이터에 해설 텍스트를 추가로 적어둘 수 있도록 NULL 허용 컬럼만 더합니다.
                // 기존 문제 풀이/채점 로직은 이 컬럼을 필수로 사용하지 않으므로 안전하다.
                await pool.query(`ALTER TABLE ${tableName} ADD COLUMN explanation_text TEXT NULL`);
            }
        }
    }

    function buildWrittenQuestionWhere(query) {
        const whereParts = [];
        const params = [];

        const keyword = String(query.search || query.keyword || '').trim();
        if (keyword) {
            whereParts.push(`(
                CAST(q.question_id AS CHAR) LIKE ?
                OR q.question LIKE ?
                OR COALESCE(a.explanation_text, '') LIKE ?
                OR COALESCE(o.opt1, '') LIKE ?
                OR COALESCE(o.opt2, '') LIKE ?
                OR COALESCE(o.opt3, '') LIKE ?
                OR COALESCE(o.opt4, '') LIKE ?
            )`);
            const like = `%${keyword}%`;
            params.push(like, like, like, like, like, like, like);
        }

        const year = adminNumber(query.year, null);
        if (year !== null) {
            whereParts.push('q.year = ?');
            params.push(year);
        }

        const session = adminNumber(query.session, null);
        if (session !== null) {
            whereParts.push('q.session = ?');
            params.push(session);
        }

        const subject = adminNumber(query.subject, null);
        if (subject !== null) {
            whereParts.push('q.subject = ?');
            params.push(subject);
        }

        return {
            whereSql: whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '',
            params,
        };
    }

    function buildIpepQuestionWhere(type, query) {
        const whereParts = [];
        const params = [];
        const keyword = String(query.search || query.keyword || '').trim();

        if (keyword) {
            whereParts.push(`(
                CAST(q.question_id AS CHAR) LIKE ?
                OR q.question_text LIKE ?
                OR COALESCE(q.answer_raw, '') LIKE ?
                OR COALESCE(q.answer_normalized, '') LIKE ?
                OR COALESCE(q.explanation_text, '') LIKE ?
                OR COALESCE(q.choice_img_file, '') LIKE ?
                OR COALESCE(q.explanation_img_file, '') LIKE ?
            )`);
            const like = `%${keyword}%`;
            params.push(like, like, like, like, like, like, like);
        }

        const active = String(query.active || '').trim();
        if (active === '1' || active === '0') {
            whereParts.push('q.is_active = ?');
            params.push(Number(active));
        }

        if (type === 'ipep_random') {
            const subjectCode = String(query.subjectCode || query.subject_code || '').trim();
            if (subjectCode) {
                whereParts.push('q.subject_code = ?');
                params.push(subjectCode.padStart(2, '0'));
            }
        }

        if (type === 'ipep_past') {
            const year = adminNumber(query.year, null);
            if (year !== null) {
                whereParts.push('q.exam_year = ?');
                params.push(year);
            }

            const session = adminNumber(query.session, null);
            if (session !== null) {
                whereParts.push('q.exam_session = ?');
                params.push(session);
            }
        }

        return {
            whereSql: whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '',
            params,
        };
    }

    function normalizeWrittenAdminRow(row) {
        return {
            type: 'written',
            id: row.question_id,
            question_id: row.question_id,
            year: row.year,
            session: row.session,
            info_id: row.info_id,
            subject: row.subject,
            subjectName: row.subject_name || '',
            question: row.question || '',
            question_text: row.question || '',
            question_img: row.question_img || '',
            opt1: row.opt1 || '',
            opt2: row.opt2 || '',
            opt3: row.opt3 || '',
            opt4: row.opt4 || '',
            option_1: row.opt1 || '',
            option_2: row.opt2 || '',
            option_3: row.opt3 || '',
            option_4: row.opt4 || '',
            answer: row.answer || '',
            correct_label: row.correct_label === null || row.correct_label === undefined ? '' : row.correct_label,
            explanation_text: row.explanation_text || '',
            explanation_img: row.explanation_img || '',
            updated_at: row.updated_at || null,
        };
    }

    function normalizeIpepAdminRow(row, type) {
        return {
            type,
            id: row.question_id,
            question_id: row.question_id,
            subject_code: row.subject_code || '',
            subject_name: row.subject_name || '',
            subject_no: row.subject_no || '',
            exam_year: row.exam_year || '',
            exam_session: row.exam_session || '',
            question_no: row.question_no || '',
            question_text: row.question_text || '',
            answer_raw: row.answer_raw || '',
            answer_normalized: row.answer_normalized || '',
            answer_aliases_json: row.answer_aliases_json || null,
            answer_slots_json: row.answer_slots_json || null,
            grading_policy: row.grading_policy || 'FLEX_TERM',
            score: row.score || 5,
            choice_img_stem: row.choice_img_stem || '',
            choice_img_file: row.choice_img_file || '',
            choice_img_path: row.choice_img_path || '',
            explanation_img_stem: row.explanation_img_stem || '',
            explanation_img_file: row.explanation_img_file || '',
            explanation_img_path: row.explanation_img_path || '',
            explanation_text: row.explanation_text || '',
            is_active: Number(row.is_active || 0),
            created_at: row.created_at || null,
            updated_at: row.updated_at || null,
        };
    }

    async function getAdminQuestionDetail(type, questionId) {
        if (type === 'written') {
            const [rows] = await pool.query(
                `SELECT
                    q.question_id,
                    q.year,
                    q.session,
                    q.info_id,
                    q.subject,
                    s.name AS subject_name,
                    q.question,
                    q.question_img,
                    o.option_id,
                    o.opt1,
                    o.opt2,
                    o.opt3,
                    o.opt4,
                    o.answer,
                    a.correct_label,
                    a.explanation_text,
                    a.explanation_img
                 FROM questions q
                 LEFT JOIN subjects s ON q.subject = s.subject_id
                 LEFT JOIN options o ON q.question_id = o.question_id
                 LEFT JOIN answers a ON q.question_id = a.question_id
                 WHERE q.question_id = ?
                 LIMIT 1`,
                [questionId]
            );
            return rows[0] ? normalizeWrittenAdminRow(rows[0]) : null;
        }

        await ensureIpepAdminExplanationColumns();
        const tableName = type === 'ipep_past'? 'ipep_past_questions' : 'ipep_random_questions';

        if (type === 'ipep_random') {
            const [rows] = await pool.query(
                `SELECT q.*, s.subject_name
                 FROM ${tableName} q
                 LEFT JOIN ipep_subjects s ON q.subject_code = s.subject_code
                 WHERE q.question_id = ?
                 LIMIT 1`,
                [questionId]
            );
            return rows[0] ? normalizeIpepAdminRow(rows[0], type) : null;
        }

        const [rows] = await pool.query(
            `SELECT q.*
             FROM ${tableName} q
             WHERE q.question_id = ?
             LIMIT 1`,
            [questionId]
        );
        return rows[0] ? normalizeIpepAdminRow(rows[0], type) : null;
    }

    async function handleAdminQuestionMeta(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;
            await ensureIpepAdminExplanationColumns();

            const [[writtenCountRows], [ipepRandomCountRows], [ipepPastCountRows], [subjectRows], [ipepSubjectRows], [catalogRows]] = await Promise.all([
                pool.query('SELECT COUNT(*) AS total FROM questions'),
                pool.query('SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM ipep_random_questions'),
                pool.query('SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM ipep_past_questions'),
                pool.query('SELECT subject_id, name FROM subjects ORDER BY subject_id ASC'),
                pool.query('SELECT subject_code, subject_name, display_order FROM ipep_subjects ORDER BY display_order ASC'),
                pool.query('SELECT exam_year, exam_session, question_count, is_open FROM ipep_exam_catalog ORDER BY exam_year DESC, exam_session ASC'),
            ]);

            return res.json({
                success: true,
                summary: {
                    written: Number(writtenCountRows?.[0]?.total || 0),
                    ipepRandom: Number(ipepRandomCountRows?.[0]?.total || 0),
                    ipepRandomActive: Number(ipepRandomCountRows?.[0]?.active || 0),
                    ipepPast: Number(ipepPastCountRows?.[0]?.total || 0),
                    ipepPastActive: Number(ipepPastCountRows?.[0]?.active || 0),
                },
                subjects: subjectRows,
                ipepSubjects: ipepSubjectRows,
                ipepExamCatalog: catalogRows,
            });
        } catch (error) {
            console.error('[admin questions meta error]', error);
            return res.status(500).json({ success: false, msg: '문제/해설 관리 기본 정보를 불러오는 중 오류가 발생했습니다.' });
        }
    }

    async function handleAdminQuestionList(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;

            const type = normalizeAdminQuestionType(req.query.type);
            const limit = adminLimit(req.query.limit);
            const page = adminPage(req.query.page);
            const offset = (page - 1) * limit;

            if (type === 'written') {
                const { whereSql, params } = buildWrittenQuestionWhere(req.query);
                const [countRows] = await pool.query(
                    `SELECT COUNT(DISTINCT q.question_id) AS total
                     FROM questions q
                     LEFT JOIN options o ON q.question_id = o.question_id
                     LEFT JOIN answers a ON q.question_id = a.question_id
                     ${whereSql}`,
                    params
                );
                const [rows] = await pool.query(
                    `SELECT
                        q.question_id,
                        q.year,
                        q.session,
                        q.info_id,
                        q.subject,
                        s.name AS subject_name,
                        q.question,
                        q.question_img,
                        o.opt1,
                        o.opt2,
                        o.opt3,
                        o.opt4,
                        o.answer,
                        a.correct_label,
                        a.explanation_text,
                        a.explanation_img
                     FROM questions q
                     LEFT JOIN subjects s ON q.subject = s.subject_id
                     LEFT JOIN options o ON q.question_id = o.question_id
                     LEFT JOIN answers a ON q.question_id = a.question_id
                     ${whereSql}
                     ORDER BY q.year DESC, q.session ASC, q.info_id ASC, q.question_id ASC
                     LIMIT ? OFFSET ?`,
                    [...params, limit, offset]
                );

                const total = Number(countRows?.[0]?.total || 0);
                return res.json({ success: true, type, page, limit, total, rows: rows.map(normalizeWrittenAdminRow) });
            }

            await ensureIpepAdminExplanationColumns();
            const tableName = type === 'ipep_past'? 'ipep_past_questions' : 'ipep_random_questions';
            const { whereSql, params } = buildIpepQuestionWhere(type, req.query);
            const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM ${tableName} q ${whereSql}`, params);

            if (type === 'ipep_random') {
                const [rows] = await pool.query(
                    `SELECT q.*, s.subject_name
                     FROM ${tableName} q
                     LEFT JOIN ipep_subjects s ON q.subject_code = s.subject_code
                     ${whereSql}
                     ORDER BY q.subject_code ASC, q.subject_no ASC, q.question_id ASC
                     LIMIT ? OFFSET ?`,
                    [...params, limit, offset]
                );
                const total = Number(countRows?.[0]?.total || 0);
                return res.json({ success: true, type, page, limit, total, rows: rows.map((row) => normalizeIpepAdminRow(row, type)) });
            }

            const [rows] = await pool.query(
                `SELECT q.*
                 FROM ${tableName} q
                 ${whereSql}
                 ORDER BY q.exam_year DESC, q.exam_session ASC, q.question_no ASC, q.question_id ASC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            const total = Number(countRows?.[0]?.total || 0);
            return res.json({ success: true, type, page, limit, total, rows: rows.map((row) => normalizeIpepAdminRow(row, type)) });
        } catch (error) {
            console.error('[admin questions list error]', error);
            return res.status(500).json({ success: false, msg: '문제 목록을 불러오는 중 오류가 발생했습니다.' });
        }
    }

    async function handleAdminQuestionDetail(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;

            const type = normalizeAdminQuestionType(req.params.type);
            const questionId = adminNumber(req.params.questionId, null);
            if (!questionId) return res.status(400).json({ success: false, msg: 'questionId가 필요합니다.' });

            const detail = await getAdminQuestionDetail(type, questionId);
            if (!detail) return res.status(404).json({ success: false, msg: '문제를 찾을 수 없습니다.' });

            return res.json({ success: true, type, detail });
        } catch (error) {
            console.error('[admin questions detail error]', error);
            return res.status(500).json({ success: false, msg: '문제 상세 정보를 불러오는 중 오류가 발생했습니다.' });
        }
    }

    async function updateWrittenAdminQuestion(questionId, body) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await connection.query(
                `UPDATE questions
                 SET year = ?, session = ?, info_id = ?, subject = ?, question = ?, question_img = ?
                 WHERE question_id = ?`,
                [
                    adminNumber(body.year, null),
                    adminNumber(body.session, null),
                    adminNumber(body.info_id, null),
                    adminNumber(body.subject, null),
                    adminCleanText(body.question || body.question_text, 50000),
                    adminNullableText(body.question_img, 255),
                    questionId,
                ]
            );

            const [optionRows] = await connection.query('SELECT option_id FROM options WHERE question_id = ? LIMIT 1', [questionId]);
            const optionValues = [
                adminCleanText(body.opt1 || body.option_1, 20000),
                adminCleanText(body.opt2 || body.option_2, 20000),
                adminCleanText(body.opt3 || body.option_3, 20000),
                adminCleanText(body.opt4 || body.option_4, 20000),
                adminCleanText(body.answer, 5000),
            ];

            if (optionRows.length >0) {
                await connection.query(
                    `UPDATE options SET opt1 = ?, opt2 = ?, opt3 = ?, opt4 = ?, answer = ? WHERE question_id = ?`,
                    [...optionValues, questionId]
                );
            } else {
                await connection.query(
                    `INSERT INTO options (question_id, opt1, opt2, opt3, opt4, answer) VALUES (?, ?, ?, ?, ?, ?)`,
                    [questionId, ...optionValues]
                );
            }

            await connection.query(
                `INSERT INTO answers (question_id, correct_label, explanation_text, explanation_img)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    correct_label = VALUES(correct_label),
                    explanation_text = VALUES(explanation_text),
                    explanation_img = VALUES(explanation_img)`,
                [
                    questionId,
                    adminNumber(body.correct_label, 1),
                    adminCleanText(body.explanation_text, 50000),
                    adminNullableText(body.explanation_img, 255),
                ]
            );

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function updateIpepAdminQuestion(type, questionId, body) {
        await ensureIpepAdminExplanationColumns();
        const tableName = type === 'ipep_past'? 'ipep_past_questions' : 'ipep_random_questions';
        const gradingPolicy = IPEP_GRADING_POLICIES.has(String(body.grading_policy || '').trim())
            ? String(body.grading_policy).trim()
            : 'FLEX_TERM';

        if (type === 'ipep_random') {
            await pool.query(
                `UPDATE ${tableName}
                 SET subject_code = ?,
                     subject_no = ?,
                     question_text = ?,
                     answer_raw = ?,
                     answer_normalized = ?,
                     answer_aliases_json = ?,
                     answer_slots_json = ?,
                     grading_policy = ?,
                     score = ?,
                     choice_img_stem = ?,
                     choice_img_file = ?,
                     choice_img_path = ?,
                     explanation_img_stem = ?,
                     explanation_img_file = ?,
                     explanation_img_path = ?,
                     explanation_text = ?,
                     is_active = ?
                 WHERE question_id = ?`,
                [
                    String(body.subject_code || '').trim().padStart(2, '0'),
                    adminNumber(body.subject_no, null),
                    adminCleanText(body.question_text, 50000),
                    adminCleanText(body.answer_raw, 50000),
                    adminCleanText(body.answer_normalized, 50000),
                    adminToJsonColumn(body.answer_aliases_json),
                    adminToJsonColumn(body.answer_slots_json),
                    gradingPolicy,
                    adminNumber(body.score, 5),
                    adminNullableText(body.choice_img_stem, 100),
                    adminNullableText(body.choice_img_file, 255),
                    adminNullableText(body.choice_img_path, 255),
                    adminNullableText(body.explanation_img_stem, 100),
                    adminNullableText(body.explanation_img_file, 255),
                    adminNullableText(body.explanation_img_path, 255),
                    adminCleanText(body.explanation_text, 50000),
                    adminTinyInt(body.is_active, 1),
                    questionId,
                ]
            );
            return;
        }

        await pool.query(
            `UPDATE ${tableName}
             SET exam_year = ?,
                 exam_session = ?,
                 question_no = ?,
                 question_text = ?,
                 answer_raw = ?,
                 answer_normalized = ?,
                 answer_aliases_json = ?,
                 answer_slots_json = ?,
                 grading_policy = ?,
                 score = ?,
                 choice_img_stem = ?,
                 choice_img_file = ?,
                 choice_img_path = ?,
                 explanation_img_stem = ?,
                 explanation_img_file = ?,
                 explanation_img_path = ?,
                 explanation_text = ?,
                 is_active = ?
             WHERE question_id = ?`,
            [
                adminNumber(body.exam_year, null),
                adminNumber(body.exam_session, null),
                adminNumber(body.question_no, null),
                adminCleanText(body.question_text, 50000),
                adminCleanText(body.answer_raw, 50000),
                adminCleanText(body.answer_normalized, 50000),
                adminToJsonColumn(body.answer_aliases_json),
                adminToJsonColumn(body.answer_slots_json),
                gradingPolicy,
                adminNumber(body.score, 5),
                adminNullableText(body.choice_img_stem, 100),
                adminNullableText(body.choice_img_file, 255),
                adminNullableText(body.choice_img_path, 255),
                adminNullableText(body.explanation_img_stem, 100),
                adminNullableText(body.explanation_img_file, 255),
                adminNullableText(body.explanation_img_path, 255),
                adminCleanText(body.explanation_text, 50000),
                adminTinyInt(body.is_active, 1),
                questionId,
            ]
        );
    }

    async function handleAdminQuestionUpdate(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;

            const type = normalizeAdminQuestionType(req.params.type);
            const questionId = adminNumber(req.params.questionId, null);
            if (!questionId) return res.status(400).json({ success: false, msg: 'questionId가 필요합니다.' });

            if (type === 'written') {
                await updateWrittenAdminQuestion(questionId, req.body || {});
            } else {
                await updateIpepAdminQuestion(type, questionId, req.body || {});
            }

            const detail = await getAdminQuestionDetail(type, questionId);
            return res.json({
                success: true,
                msg: '문제/해설 정보가 저장되었습니다.',
                type,
                detail,
                updatedBy: adminCheck.user.id,
            });
        } catch (error) {
            console.error('[admin questions update error]', error);
            const statusCode = error.statusCode || (error.code === 'ER_DUP_ENTRY'? 409 : 500);
            const msg = error.code === 'ER_DUP_ENTRY'? '이미 같은 문제번호/회차/과목 번호가 존재합니다. 고유 번호를 확인해주세요.'
                : error.message || '문제/해설 저장 중 오류가 발생했습니다.';
            return res.status(statusCode).json({ success: false, msg });
        }
    }


    registerMealmapRoutes({
        app,
        pool,
        https,
        validateAdminSession,
        validateRealtimeSession,
        notifyMealMapPlaceDecisionV2515,
        notifyMealMapEditDecisionV2515,
    });

    // 운영자 쓰기 작업은 먼저 결재 대기 목록에 등록합니다.
    app.use('/api/admin', adminApprovalMiddleware);

    // 관리자 페이지는 현재 프론트에서 GET으로 회원 목록을 조회합니다.
    // 과거 테스트 버전 호환을 위해 POST도 함께 열어 둔다.
    app.post('/api/admin/notices/list', handleAdminNoticeList);
    app.post('/api/admin/notices/broadcast', handleAdminNoticeBroadcast);
    app.get('/api/admin/operation-logs', handleAdminOperationLogList);
    // 점검 모드 상태 조회/변경 라우터입니다.
    // 조회는 공개 API, 변경은 validateAdminSession이 걸린 관리자 API로 분리합니다.
    app.get('/api/maintenance/status', handleMaintenanceStatus);
    app.post('/api/admin/maintenance', handleAdminMaintenanceUpdate);
    app.post('/api/admin/notices/latest', handleLatestAdminNotices);

    app.get('/api/admin/questions/meta', handleAdminQuestionMeta);
    app.get('/api/admin/questions', handleAdminQuestionList);
    app.get('/api/admin/questions/:type/:questionId', handleAdminQuestionDetail);
    app.put('/api/admin/questions/:type/:questionId', handleAdminQuestionUpdate);

    app.get('/api/admin/users', handleAdminUsers);
    app.post('/api/admin/users', handleAdminUsers);

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

            const mailText = [`안녕하세요, ${target.name || target.id}님.`, '', text, '', '- SKN29th_우공실 -'].join('\n');
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
