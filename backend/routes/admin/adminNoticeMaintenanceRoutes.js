// Admin notice, maintenance, and operation-log routes.
'use strict';

function registerAdminNoticeMaintenanceRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const validateAdminSession = options.validateAdminSession;
    const validateRealtimeSession = options.validateRealtimeSession;
    const pruneActiveUsers = options.pruneActiveUsers;
    const getActiveUserList = options.getActiveUserList;
    const sanitizeAdminNoticeText = options.sanitizeAdminNoticeText;
    const getAdminBroadcastHistory = options.getAdminBroadcastHistory;
    const createAdminBroadcastNotice = options.createAdminBroadcastNotice;
    const getAdminBroadcastsForUser = options.getAdminBroadcastsForUser;
    const getAdminMaintenanceState = options.getAdminMaintenanceState;
    const updateAdminMaintenanceState = options.updateAdminMaintenanceState;
    const formatAdminDateTime = options.formatAdminDateTime;
    const writeAdminOperationLog = options.writeAdminOperationLog;
    const getUndeliveredMealMapUserNoticesV2515 = options.getUndeliveredMealMapUserNoticesV2515;
    const ADMIN_ONLY_USER_ID = options.adminOnlyUserId;
    const DEFAULT_MAINTENANCE_MESSAGE = options.defaultMaintenanceMessage;

    const required = {
        app, pool, validateAdminSession, validateRealtimeSession, pruneActiveUsers, getActiveUserList,
        sanitizeAdminNoticeText, getAdminBroadcastHistory, createAdminBroadcastNotice,
        getAdminBroadcastsForUser, getAdminMaintenanceState, updateAdminMaintenanceState,
        formatAdminDateTime, writeAdminOperationLog, getUndeliveredMealMapUserNoticesV2515,
        ADMIN_ONLY_USER_ID, DEFAULT_MAINTENANCE_MESSAGE,
    };
    const missing = Object.entries(required)
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length > 0) {
        throw new Error(`registerAdminNoticeMaintenanceRoutes missing dependencies: ${missing.join(', ')}`);
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


    app.post('/api/admin/notices/list', handleAdminNoticeList);
    app.post('/api/admin/notices/broadcast', handleAdminNoticeBroadcast);
    app.get('/api/admin/operation-logs', handleAdminOperationLogList);
    app.get('/api/maintenance/status', handleMaintenanceStatus);
    app.post('/api/admin/maintenance', handleAdminMaintenanceUpdate);
    app.post('/api/admin/notices/latest', handleLatestAdminNotices);
}

module.exports = registerAdminNoticeMaintenanceRoutes;
