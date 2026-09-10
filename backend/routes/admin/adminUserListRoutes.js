// Admin user list routes.
'use strict';

const {
    DEFAULT_PAGE_SIZE,
    REVEAL_TTL_SECONDS,
    normalizeListQuery,
    normalizeRevealReason,
    maskName,
    maskEmail,
    createAdminPrivacyService,
} = require('../../services/adminPrivacyService');

const DUMMY_BCRYPT_HASH = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
const REVEAL_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_REVEAL_ATTEMPTS = 5;

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
    const validateAdminSession = options.validateAdminSession;
    const getUserById = options.getUserById;
    const bcrypt = options.bcrypt;
    const writeAdminOperationLog = options.writeAdminOperationLog;
    const privacyService = options.privacyService || createAdminPrivacyService({ pool });
    const revealAttempts = new Map();

    const required = {
        app, pool, ensureAdminUserControlSchema, adminTableExists, adminColumnExists,
        adminGroupedCount, getActiveUserList, formatAdminDateTime, normalizeAdminBool,
        isPrimaryAdminUser, isAdminAccessUser, validateAdminSession, getUserById, bcrypt,
    };
    const missing = Object.entries(required)
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length > 0) {
        throw new Error(`registerAdminUserListRoutes missing dependencies: ${missing.join(', ')}`);
    }

    function setNoStore(res) {
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
    }

    function actorRole(auth) {
        return auth?.isPrimaryAdmin ? 'primary_admin' : 'operator';
    }

    function revealAttemptKey(auth) {
        return String(auth?.user?.id || auth?.id || '').trim();
    }

    function activeRevealAttempts(auth, now = Date.now()) {
        const key = revealAttemptKey(auth);
        const attempts = (revealAttempts.get(key) || []).filter((time) => now - time < REVEAL_ATTEMPT_WINDOW_MS);
        if (attempts.length) revealAttempts.set(key, attempts);
        else revealAttempts.delete(key);
        return attempts;
    }

    function recordFailedRevealAttempt(auth) {
        const key = revealAttemptKey(auth);
        const attempts = activeRevealAttempts(auth);
        attempts.push(Date.now());
        revealAttempts.set(key, attempts);
    }

    function clearRevealAttempts(auth) {
        revealAttempts.delete(revealAttemptKey(auth));
    }

    const handleAdminUsers = async (req, res) => {
        // 사용자접속 관리 탭 목록 조회 안정화.
        // 기존 DB에 신규 컬럼이 없거나, 일부 활동 테이블 구조가 달라도 목록 API가 전체 실패하지 않도록 분리 조회합니다.
        try {
            setNoStore(res);
            const auth = await validateAdminSession(req);
            if (!auth?.valid || !auth?.isAdmin) {
                const status = auth?.reason === 'not_admin' ? 403 : 401;
                return res.status(status).json({
                    success: false,
                    reason: auth?.reason || 'invalid_admin_session',
                    message: auth?.message || '관리자 권한이 필요합니다.',
                });
            }

            const listQuery = normalizeListQuery(req.query || {});
            if (!(await adminTableExists('wgs_users'))) {
                await privacyService.writeAccessLog({
                    actorId: auth.user.id,
                    actorRole: actorRole(auth),
                    action: 'list_masked',
                    outcome: 'success',
                    resultCount: 0,
                    page: 1,
                    pageSize: listQuery.pageSize,
                    keyword: listQuery.keyword,
                    req,
                });
                return res.json({
                    success: true,
                    summary: { totalUsers: 0, onlineUsers: 0, loginKeepUsers: 0, todayLoginCount: 0 },
                    users: [],
                    recentLoginLogs: [],
                    pagination: { page: 1, pageSize: listQuery.pageSize, total: 0, totalPages: 1 },
                    privacy: { masked: true, revealAllowed: Boolean(auth.isPrimaryAdmin) },
                });
            }

            try {
                // 신규 컬럼은 가능하면 자동 생성합니다. 실패해도 목록 조회 자체는 호환 모드로 계속 진행합니다.
                await ensureAdminUserControlSchema();
            } catch (schemaError) {
                console.warn('[admin/users] user-control schema check failed; list will use compatibility mode:', schemaError.message);
            }

            const keyword = listQuery.keyword;
            const hasEmail = await adminColumnExists('wgs_users', 'email');
            const hasDDay = await adminColumnExists('wgs_users', 'dDay');
            const hasMemberSessions = await adminTableExists('wgs_member_sessions');
            const activeSessionSql = 'EXISTS (SELECT 1 FROM wgs_member_sessions ms WHERE ms.active_user_id=u.id AND ms.revoked_at IS NULL AND ms.expires_at>UNIX_TIMESTAMP(NOW(3))*1000 AND ms.idle_expires_at>UNIX_TIMESTAMP(NOW(3))*1000)';
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
            const [[totalRow]] = await pool.query(
                `SELECT COUNT(*) AS total FROM wgs_users u${whereSql}`,
                params
            );
            const totalUsers = Number(totalRow?.total || 0);
            const totalPages = Math.max(1, Math.ceil(totalUsers / listQuery.pageSize));
            const safePage = Math.min(listQuery.page, totalPages);
            const offset = (safePage - 1) * listQuery.pageSize;

            const selectParts = [
                'u.id AS id',
                `${accountExpr} AS account`,
                `${accountExpr} AS userId`,
                'u.name AS name',
                hasEmail ? 'u.email AS email' : "''AS email",
                hasDDay ? 'u.dDay AS dDay' : 'NULL AS dDay',
                hasMemberSessions
                    ? `CASE WHEN ${activeSessionSql} THEN 1 ELSE 0 END AS has_active_session`
                    : '0 AS has_active_session',
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

            const sortColumnMap = {
                id: accountExpr,
                name: 'u.name',
                email: hasEmail ? 'u.email' : accountExpr,
            };
            const roleOrder = [
                hasIsPrimaryAdmin ? 'COALESCE(u.is_primary_admin, 0) DESC' : null,
                hasIsOperator ? 'COALESCE(u.is_operator, 0) DESC' : null,
            ].filter(Boolean);
            const selectedSortColumn = sortColumnMap[listQuery.sortKey] || accountExpr;
            const orderParts = [
                ...roleOrder,
                `${selectedSortColumn} ${listQuery.sortDirection.toUpperCase()}`,
                'u.id ASC',
            ];

            const [users] = await pool.query(
                `SELECT ${selectParts.join(',\n                   ')}
                   FROM wgs_users u
                   ${whereSql}
                  ORDER BY ${orderParts.join(', ')}
                  LIMIT ? OFFSET ?`,
                [...params, listQuery.pageSize, offset]
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

            const activeIds = new Set(
                getActiveUserList()
                    .map((user) => String(user?.id || user?.userId || '').trim())
                    .filter(Boolean)
            );
            const mappedUsers = users.map((user) => {
                const key = String(user.userId || user.account || '');
                const joinedAtValue = user.created_at || null;
                const lastLoginValue = user.last_login_at || loginLatestMap[key] || null;
                const lastLogoutValue = user.last_logout_at || logoutLatestMap[key] || null;
                const rawName = user.name || user.account || key;
                const rawEmail = user.email || '';
                return {
                    id: user.id,
                    account: user.account,
                    userId: key,
                    name: maskName(rawName),
                    email: maskEmail(rawEmail),
                    hasEmail: Boolean(rawEmail),
                    privacyMasked: true,
                    dDay: user.dDay || null,
                    isOnline: Boolean(Number(user.has_active_session || 0)),
                    activeInMemory: activeIds.has(key) || activeIds.has(String(user.id || '')),
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
                    postCount: Number(postCounts[key] || 0),
                    commentCount: Number(commentCounts[key] || 0),
                    wrongCount: Number(wrongCounts[key] || 0),
                };
            });

            async function getFilteredCount(extraCondition) {
                const conditions = [...where, extraCondition].filter(Boolean);
                const sql = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
                const [[row]] = await pool.query(`SELECT COUNT(*) AS cnt FROM wgs_users u${sql}`, params);
                return Number(row?.cnt || 0);
            }

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

            const onlineUsers = hasMemberSessions
                ? await getFilteredCount(activeSessionSql)
                : activeIds.size;
            const loginKeepUsers = hasIsSuspended
                ? await getFilteredCount('COALESCE(u.is_suspended, 0) = 0')
                : totalUsers;
            const todayLoginCount = await getTodayLoginCount();
            const recentLoginLogs = await getRecentLoginLogs();

            await privacyService.writeAccessLog({
                actorId: auth.user.id,
                actorRole: actorRole(auth),
                action: 'list_masked',
                outcome: 'success',
                resultCount: mappedUsers.length,
                page: safePage,
                pageSize: listQuery.pageSize,
                keyword,
                req,
            });

            res.json({
                success: true,
                summary: {
                    totalUsers,
                    onlineUsers,
                    loginKeepUsers,
                    todayLoginCount,
                },
                users: mappedUsers,
                recentLoginLogs,
                pagination: {
                    page: safePage,
                    pageSize: listQuery.pageSize,
                    total: totalUsers,
                    totalPages,
                },
                privacy: {
                    masked: true,
                    revealAllowed: Boolean(auth.isPrimaryAdmin),
                    revealTtlSeconds: REVEAL_TTL_SECONDS,
                },
            });
        } catch (error) {
            console.error('관리자 사용자 목록 조회 오류:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                reason: error.reason || 'admin_user_list_error',
                msg: error.statusCode ? error.message : '관리자 사용자 목록 조회 중 오류가 발생했습니다.',
                message: error.statusCode ? error.message : '관리자 사용자 목록 조회 중 오류가 발생했습니다.',
            });
        }
    };

    const handlePrivacyReveal = async (req, res) => {
        setNoStore(res);
        let auth = null;
        let targetUserId = '';
        let reason = '';

        try {
            auth = await validateAdminSession(req);
            if (!auth?.valid || !auth?.isAdmin) {
                const status = auth?.reason === 'not_admin' ? 403 : 401;
                return res.status(status).json({
                    success: false,
                    reason: auth?.reason || 'invalid_admin_session',
                    message: auth?.message || '관리자 권한이 필요합니다.',
                });
            }

            targetUserId = String(req.params?.userId || '').trim();
            if (!targetUserId || targetUserId.length > 80) {
                const error = new Error('열람할 회원을 다시 선택해주세요.');
                error.statusCode = 400;
                error.reason = 'invalid_target_user';
                throw error;
            }

            if (!auth.isPrimaryAdmin) {
                await privacyService.writeAccessLog({
                    actorId: auth.user.id,
                    actorRole: actorRole(auth),
                    action: 'reveal',
                    targetUserId,
                    fields: 'name,email',
                    outcome: 'denied_role',
                    req,
                });
                return res.status(403).json({
                    success: false,
                    reason: 'primary_admin_required',
                    message: '개인정보 원문 열람은 최고 관리자만 가능합니다.',
                });
            }

            if (activeRevealAttempts(auth).length >= MAX_REVEAL_ATTEMPTS) {
                await privacyService.writeAccessLog({
                    actorId: auth.user.id,
                    actorRole: actorRole(auth),
                    action: 'reveal',
                    targetUserId,
                    fields: 'name,email',
                    outcome: 'rate_limited',
                    req,
                });
                return res.status(429).json({
                    success: false,
                    reason: 'reveal_rate_limited',
                    message: '비밀번호 확인 실패가 반복되었습니다. 10분 후 다시 시도해주세요.',
                });
            }

            const password = String(req.body?.password || '');
            reason = normalizeRevealReason(req.body?.reason);
            if (!password) {
                const error = new Error('현재 관리자 비밀번호를 입력해주세요.');
                error.statusCode = 400;
                error.reason = 'password_required';
                throw error;
            }

            const actor = await getUserById(auth.user.id);
            const passwordMatches = await bcrypt.compare(password, actor?.password || DUMMY_BCRYPT_HASH);
            if (!actor || !passwordMatches) {
                recordFailedRevealAttempt(auth);
                await privacyService.writeAccessLog({
                    actorId: auth.user.id,
                    actorRole: actorRole(auth),
                    action: 'reveal',
                    targetUserId,
                    fields: 'name,email',
                    purpose: reason,
                    outcome: 'denied_password',
                    req,
                });
                return res.status(401).json({
                    success: false,
                    reason: 'invalid_admin_password',
                    message: '관리자 비밀번호가 일치하지 않습니다.',
                });
            }

            const [rows] = await pool.query(
                'SELECT id, name, email FROM wgs_users WHERE id = ? LIMIT 1',
                [targetUserId]
            );
            const target = rows?.[0];
            if (!target) {
                await privacyService.writeAccessLog({
                    actorId: auth.user.id,
                    actorRole: actorRole(auth),
                    action: 'reveal',
                    targetUserId,
                    fields: 'name,email',
                    purpose: reason,
                    outcome: 'not_found',
                    req,
                });
                return res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });
            }

            await privacyService.writeAccessLog({
                actorId: auth.user.id,
                actorRole: actorRole(auth),
                action: 'reveal',
                targetUserId,
                fields: 'name,email',
                purpose: reason,
                outcome: 'success',
                resultCount: 1,
                req,
            });
            clearRevealAttempts(auth);

            if (typeof writeAdminOperationLog === 'function') {
                await writeAdminOperationLog({
                    operationType: 'privacy_access',
                    action: 'reveal',
                    title: '회원 개인정보 원문 열람',
                    message: `회원 ${targetUserId}의 이름·이메일 원문을 열람했습니다.`,
                    actor: { id: auth.user.id, name: auth.user.name || auth.user.id },
                    payload: { targetUserId, fields: ['name', 'email'], reason },
                });
            }

            return res.json({
                success: true,
                target: {
                    id: target.id,
                    name: target.name || '',
                    email: target.email || '',
                },
                expiresInSeconds: REVEAL_TTL_SECONDS,
                expiresAt: new Date(Date.now() + REVEAL_TTL_SECONDS * 1000).toISOString(),
            });
        } catch (error) {
            if (auth?.valid && auth?.user?.id) {
                try {
                    await privacyService.writeAccessLog({
                        actorId: auth.user.id,
                        actorRole: actorRole(auth),
                        action: 'reveal',
                        targetUserId: targetUserId || null,
                        fields: 'name,email',
                        purpose: reason || null,
                        outcome: error.reason || 'error',
                        req,
                    });
                } catch (auditError) {
                    console.error('[admin privacy] reveal failure audit failed:', auditError.message);
                }
            }
            console.error('[admin privacy] reveal failed:', error.message);
            return res.status(error.statusCode || 500).json({
                success: false,
                reason: error.reason || 'privacy_reveal_error',
                message: error.statusCode ? error.message : '개인정보 원문 열람 중 오류가 발생했습니다.',
            });
        }
    };





    app.get('/api/admin/users', handleAdminUsers);
    app.post('/api/admin/users', handleAdminUsers);
    app.post('/api/admin/users/:userId/privacy-reveal', handlePrivacyReveal);
}

module.exports = registerAdminUserListRoutes;
