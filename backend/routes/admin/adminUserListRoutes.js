// Admin user list routes.
'use strict';

function registerAdminUserListRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const ensureAdminUserControlSchema = options.ensureAdminUserControlSchema;
    const adminTableExists = options.adminTableExists;
    const adminColumnExists = options.adminColumnExists;
    const adminGroupedCount = options.adminGroupedCount;
    const getActiveUserList = options.getActiveUserList;
    const formatAdminDateTime = options.formatAdminDateTime;
    const normalizeAdminBool = options.normalizeAdminBool;
    const isPrimaryAdminUser = options.isPrimaryAdminUser;
    const isAdminAccessUser = options.isAdminAccessUser;

    const required = {
        app, pool, ensureAdminUserControlSchema, adminTableExists, adminColumnExists,
        adminGroupedCount, getActiveUserList, formatAdminDateTime, normalizeAdminBool,
        isPrimaryAdminUser, isAdminAccessUser,
    };
    const missing = Object.entries(required)
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length > 0) {
        throw new Error(`registerAdminUserListRoutes missing dependencies: ${missing.join(', ')}`);
    }

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





    app.get('/api/admin/users', handleAdminUsers);
    app.post('/api/admin/users', handleAdminUsers);
}

module.exports = registerAdminUserListRoutes;
