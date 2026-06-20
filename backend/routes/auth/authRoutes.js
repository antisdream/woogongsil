// 로그인, 회원가입, 세션 API를 제공합니다.
'use strict';

function registerAuthRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const bcrypt = options.bcrypt;
    const sendEmail = options.sendEmail;
    const requireHcaptcha = options.requireHcaptcha;
    const verificationCodes = options.verificationCodes;
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
    const SIGNUP_ADMIN_NOTIFY_EMAIL = String(
        options.signupAdminNotifyEmail || process.env.SIGNUP_ADMIN_NOTIFY_EMAIL || ''
    ).trim();

    const required = {
        app, pool, bcrypt, sendEmail, requireHcaptcha, verificationCodes, getUserByEmail,
        getUserById, getKSTDateTime, ensureAdminUserControlSchema, normalizeAdminBool,
        getAdminMaintenanceState, isAdminAccessUser, adminColumnExists, touchActiveUser,
        removeActiveUser, formatDateOnly, isPrimaryAdminUser, validateAdminSession,
        SALT_ROUNDS, ADMIN_USER_ID, SERVER_INSTANCE_ID, DEFAULT_MAINTENANCE_MESSAGE,
    };
    const missing = Object.entries(required).filter(([, value]) => value === undefined || value === null).map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerAuthRoutes missing dependencies: ${missing.join(', ')}`);
    }

    let signupApprovalSchemaReady = false;
    let signupApprovalSchemaPromise = null;

    async function ensureSignupApprovalSchema() {
        if (signupApprovalSchemaReady) return;
        if (signupApprovalSchemaPromise) return signupApprovalSchemaPromise;

        signupApprovalSchemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS wgs_signup_requests (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    login_id VARCHAR(100) NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
                    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    reviewed_by VARCHAR(100) NULL,
                    reviewed_at DATETIME NULL,
                    review_note TEXT NULL,
                    request_ip VARCHAR(64) NULL,
                    user_agent TEXT NULL,
                    PRIMARY KEY (id),
                    INDEX idx_wgs_signup_status_requested (status, requested_at),
                    INDEX idx_wgs_signup_login_status (login_id, status),
                    INDEX idx_wgs_signup_email_status (email, status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            signupApprovalSchemaReady = true;
        })();

        try {
            await signupApprovalSchemaPromise;
        } finally {
            signupApprovalSchemaPromise = null;
        }
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

    // 6. 이메일 인증 API
    app.post('/api/auth/send-code', async (req, res) => {
        if (!(await requireHcaptcha(req, res, 'auth_send_code'))) return;

        const email = String(req.body.email || '').trim().toLowerCase();
        const type = req.body.type;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, msg: '올바른 이메일을 입력해주세요.' });
        }

        try {
            const user = await getUserByEmail(email);

            if (type === 'signup' && user) {
                return res.status(400).json({ success: false, msg: '기존에 가입한 아이디에 사용한 이메일입니다.' });
            }

            if ((type === 'find' || type === 'change') && !user) {
                return res.status(400).json({ success: false, msg: '가입되지 않은 이메일입니다.' });
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = Date.now() + 120 * 1000;

            verificationCodes[email] = { code, expiresAt, verified: false };

            const result = await sendEmail(
                email,
                '[ SKN29th_우공실] 보안 인증번호 발송',
                `요청하신 인증번호는 [ ${code} ] 입니다. 2분 이내에 입력해주세요.`
            );

            if (!result.success) {
                return res.status(500).json({ success: false, msg: '메일 전송에 실패했습니다. 이메일 설정을 확인해주세요.' });
            }

            return res.json({ success: true });
        } catch (error) {
            console.error('인증번호 전송 오류:', error);
            return res.status(500).json({ success: false, msg: '인증번호 전송 중 서버 오류가 발생했습니다.' });
        }
    });

    app.post('/api/auth/verify-code', (req, res) => {
        const email = String(req.body.email || '').trim().toLowerCase();
        const inputCode = String(req.body.code || '').trim();
        const record = verificationCodes[email];

        if (!record) return res.status(400).json({ success: false, msg: '인증 요청 내역이 없습니다.' });

        if (Date.now() >record.expiresAt) {
            delete verificationCodes[email];
            return res.status(400).json({ success: false, msg: '만료된 인증번호입니다.' });
        }

        if (record.code !== inputCode) {
            return res.status(400).json({ success: false, msg: '인증번호가 일치하지 않습니다.' });
        }

        verificationCodes[email].verified = true;
        return res.json({ success: true });
    });

    // 예전 프론트/테스트 코드가 남아 있을 경우를 위한 호환 API.
    // 현재 프론트는 /api/auth/send-code를 쓰지만, 과거 코드가 /api/send-verification을 부를 수도 있어 남겨둡니다.
    app.post('/api/send-verification', async (req, res) => {
        if (!(await requireHcaptcha(req, res, 'auth_send_code'))) return;

        const email = String(req.body.email || '').trim().toLowerCase();
        const type = req.body.type || 'find';

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, msg: '올바른 이메일을 입력해주세요.' });
        }

        try {
            const user = await getUserByEmail(email);

            if (type === 'signup' && user) {
                return res.status(400).json({ success: false, msg: '기존에 가입한 아이디에 사용한 이메일입니다.' });
            }

            if ((type === 'find-id' || type === 'find-pw' || type === 'change-pw' || type === 'find' || type === 'change') && !user) {
                return res.status(400).json({ success: false, msg: '가입되지 않은 이메일입니다.' });
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = Date.now() + 120 * 1000;
            verificationCodes[email] = { code, expiresAt, verified: false };

            const result = await sendEmail(
                email,
                '[ SKN29th_우공실] 보안 인증번호 발송',
                `요청하신 인증번호는 [ ${code} ] 입니다. 2분 이내에 입력해주세요.`
            );

            if (!result.success) return res.status(500).json({ success: false, msg: '메일 전송에 실패했습니다.' });
            return res.json({ success: true });
        } catch (error) {
            console.error('구버전 인증번호 전송 오류:', error);
            return res.status(500).json({ success: false, msg: '인증번호 전송 중 서버 오류가 발생했습니다.' });
        }
    });

    app.post('/api/verify-code', (req, res) => {
        const email = String(req.body.email || '').trim().toLowerCase();
        const inputCode = String(req.body.code || '').trim();
        const record = verificationCodes[email];

        if (!record) return res.status(400).json({ success: false, msg: '인증 요청 내역이 없습니다.' });

        if (Date.now() >record.expiresAt) {
            delete verificationCodes[email];
            return res.status(400).json({ success: false, msg: '만료된 인증번호입니다.' });
        }

        if (record.code !== inputCode) return res.status(400).json({ success: false, msg: '인증번호가 일치하지 않습니다.' });

        verificationCodes[email].verified = true;
        return res.json({ success: true });
    });

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
            console.error('아이디 중복 확인 오류:', error);
            return res.status(500).json({ success: false, msg: '아이디 확인 중 서버 오류가 발생했습니다.' });
        }
    });

    app.post('/api/signup', async (req, res) => {
        if (!(await requireHcaptcha(req, res, 'signup'))) return;

        const id = String(req.body.id || '').trim();
        const password = String(req.body.password || '');
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();

        if (!id || !password || !name || !email) {
            return res.status(400).json({ success: false, msg: '회원가입 정보가 부족합니다.' });
        }

        const record = verificationCodes[email];
        if (!record || !record.verified) {
            return res.status(400).json({ success: false, msg: '이메일 인증이 완료되지 않았습니다.' });
        }

        try {
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

            await pool.query(
                `INSERT INTO wgs_signup_requests
                 (login_id, password_hash, name, email, status, request_ip, user_agent)
                 VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
                [id, hashedPassword, name, email, getSignupRequestIp(req), String(req.headers['user-agent'] || '').slice(0, 1000)]
            );

            delete verificationCodes[email];

            const adminNoticeResult = await sendEmail(
                SIGNUP_ADMIN_NOTIFY_EMAIL,
                '[SKN29th_우공실] 신규 회원가입 승인 요청',
                buildSignupAdminNoticeText({ id, name, email })
            );

            if (adminNoticeResult?.success === false) {
                console.warn('[signup approval] admin notice email failed:', adminNoticeResult.error?.message || adminNoticeResult.error);
            }

            return res.status(202).json({
                success: true,
                pendingApproval: true,
                msg: '회원가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.',
            });
        } catch (error) {
            console.error('회원가입 오류:', error);
            return res.status(500).json({ success: false, msg: '가입 처리 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/login', async (req, res) => {
        const id = String(req.body.id || '').trim();
        const password = String(req.body.password || '');
        const force = Boolean(req.body.force);
        const clientSessionToken = req.body.clientSessionToken || null;

        // 중복 로그인 확인창에서 '계속 로그인'을 누른 2차 요청은 기존 흐름을 보존하기 위해 hCaptcha를 다시 요구하지 않습니다.
        if (!force && !(await requireHcaptcha(req, res, 'login'))) return;

        // 점검 모드가 활성화된 경우 일반 사용자의 신규 로그인을 차단합니다.
        // 주 관리자와 운영자 권한 계정은 점검 중에도 로그인할 수 있도록 로그인 검증 이후 권한을 확인합니다.
        try {
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

            // 기존 로직 유지 + 유연한 예외 처리:
            // clientSessionToken이 있는 브라우저에서만 DB 토큰과 비교해 중복 로그인 알림을 표시합니다.
            // 토큰이 없는 첫 접속 브라우저는 차단하지 않아 사용자가 로그인 화면에 갇히는 문제를 방지합니다.
            if (user.sessionToken && !force && clientSessionToken && user.sessionToken !== clientSessionToken) {
                return res.json({
                    success: false,
                    requireConfirm: true,
                    msg: '현재 다른 환경(기기 또는 브라우저)에서 로그인중입니다, 로그아웃 후 계속하시겠습니까?'
                });
            }

            if (force && user.sessionToken && user.sessionToken !== clientSessionToken) {
                await pool.query(
                    'INSERT INTO wgs_login_history (userId, time, action) VALUES (?, ?, ?)',
                    [id, getKSTDateTime(), '다른 기기 강제 로그아웃']
                );
            }

            const newSessionToken = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

            await pool.query('UPDATE wgs_users SET sessionToken = ? WHERE id = ?', [newSessionToken, id]);
            await pool.query('INSERT INTO wgs_login_history (userId, time, action) VALUES (?, ?, ?)', [id, getKSTDateTime(), '로그인']);
            // 사용자 관리 표의 최근 로그인 표시가 누락되지 않도록 보조 컬럼을 함께 갱신합니다.
            if (await adminColumnExists('wgs_users', 'last_login_at')) {
                await pool.query('UPDATE wgs_users SET last_login_at = NOW() WHERE id = ?', [id]);
            }

            // 로그인 성공 시 현재 사용자를 실시간 접속자 목록에 등록합니다.
            // 기존 로그인/랭킹/게시판 로직은 변경하지 않고 메모리 상태만 추가로 기록합니다.
            touchActiveUser(user, req, newSessionToken);

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
                sessionToken: newSessionToken,
                serverInstanceId: SERVER_INSTANCE_ID
            });
        } catch (error) {
            console.error('로그인 오류:', error);
            return res.status(500).json({ success: false, msg: '로그인 시스템 오류' });
        }
    });

    app.post('/api/logout', async (req, res) => {
        const id = String(req.body.id || '').trim();
        const sessionToken = String(req.body.sessionToken || '').trim();

        try {
            const user = await getUserById(id);

            if (user) {
                // 다른 기기에서 이미 새로 로그인한 뒤,
                // 예전 브라우저가 뒤늦게 로그아웃 API를 호출해도 새 세션을 지우지 않도록 방어합니다.
                // - sessionToken이 넘어오지 않는 프론트엔드 요청도 로그아웃 처리합니다.
                // - sessionToken이 넘어왔고 DB 토큰과 다르면 이미 다른 세션이 주인이므로 DB 토큰은 유지합니다.
                const shouldClearDbSession = !sessionToken || user.sessionToken === sessionToken;

                try {
                    if (shouldClearDbSession) {
                        await pool.query('UPDATE wgs_users SET sessionToken = NULL, last_logout_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
                    } else {
                        await pool.query('UPDATE wgs_users SET last_logout_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
                    }
                } catch (auditError) {
                    if (shouldClearDbSession) {
                        await pool.query('UPDATE wgs_users SET sessionToken = NULL WHERE id = ?', [id]);
                    }
                }

                removeActiveUser(id, sessionToken || null);
                await pool.query('INSERT INTO wgs_login_history (userId, time, action) VALUES (?, ?, ?)', [id, getKSTDateTime(), '로그아웃']);
                // 사용자 관리 표의 최근 로그아웃 표시가 누락되지 않도록 보조 컬럼을 함께 갱신합니다.
                if (await adminColumnExists('wgs_users', 'last_logout_at')) {
                    await pool.query('UPDATE wgs_users SET last_logout_at = NOW() WHERE id = ?', [id]);
                }
            }

            return res.json({ success: true, msg: '로그아웃 완료', serverInstanceId: SERVER_INSTANCE_ID });
        } catch (error) {
            console.error('로그아웃 오류:', error);
            return res.status(500).json({ success: false, msg: '로그아웃 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/check-session', async (req, res) => {
        const id = String(req.body.id || '').trim();
        const sessionToken = String(req.body.sessionToken || '').trim();
        const clientServerInstanceId = String(req.body.serverInstanceId || '').trim();

        try {
            const user = await getUserById(id);

            // 서버가 재시작/업데이트되면 SERVER_INSTANCE_ID가 바뀐다.
            // 사용자가 예전 화면을 계속 들고 있으면 프론트가 이 차이를 감지해
            // “서버가 업데이트되었습니다, 다시 로그인해주세요.” toast를 보여줍니다.
            if (clientServerInstanceId && clientServerInstanceId !== SERVER_INSTANCE_ID) {
                removeActiveUser(id, sessionToken || null);
                return res.json({
                    valid: false,
                    reason: 'server_updated',
                    serverInstanceId: SERVER_INSTANCE_ID
                });
            }

            const isValid = Boolean(user && user.sessionToken && user.sessionToken === sessionToken);

            if (isValid) {
                touchActiveUser(user, req, sessionToken);

                // 세션 확인 과정에서 프론트엔드가 최신 DB 권한을 함께 받을 수 있도록 제공합니다.
                // 기존 valid/serverInstanceId 응답은 유지하고, 운영자/최고관리자 플래그만 추가로 내려줍니다.
                const isPrimaryAdmin = isPrimaryAdminUser(user);
                const isOperator = isAdminAccessUser(user);

                return res.json({
                    valid: true,
                    serverInstanceId: SERVER_INSTANCE_ID,
                    userId: user.id,
                    id: user.id,
                    name: user.name || user.id,
                    email: user.email || '',
                    dDay: formatDateOnly(user.dDay),
                    isAdmin: isOperator,
                    is_admin: isOperator ? 1 : 0,
                    isOperator,
                    is_operator: isOperator ? 1 : 0,
                    isPrimaryAdmin,
                    is_primary_admin: isPrimaryAdmin ? 1 : 0
                });
            }

            // invalid 사유를 프론트엔드에 전달해 알림 문구를 구분할 수 있도록 합니다.
            // - DB에 다른 토큰이 있으면 다른 기기/브라우저에서 로그인된 상황입니다.
            // - DB 토큰이 없거나 사용자 정보가 없으면 일반 세션 만료로 처리합니다.
            const reason = user && user.sessionToken ? 'duplicate_login' : 'session_expired';
            removeActiveUser(id, sessionToken || null);

            return res.json({ valid: false, reason, serverInstanceId: SERVER_INSTANCE_ID });
        } catch (error) {
            console.error('세션 확인 오류:', error);
            return res.json({ valid: false, reason: 'session_expired', serverInstanceId: SERVER_INSTANCE_ID });
        }
    });

    // 관리자 페이지 흐름: 관리자 권한 확인 API입니다.
    // ------------------------------------------------------------
    // 목적:
    // 1) /admin 화면을 열 때 브라우저의 sessionStorage 값만 믿지 않고
    //  서버가 DB의 sessionToken과 관리자 아이디를 다시 확인합니다.
    // 2) DB 최고관리자와 is_operator=1 운영자는 통과시키고 일반 계정은 403으로 차단합니다.
    // 3) 프론트가 오래된 sessionStorage 값을 들고 있어도 서버 DB 권한값을 기준으로 판단합니다.
    app.post('/api/admin/check-auth', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);

            // 세션 만료, 중복 로그인, 서버 재시작, 일반 사용자 접근을 모두 여기서 막는다.
            if (!auth.valid || !auth.isAdmin) {
                const statusCode = auth.reason === 'not_admin'? 403 : 401;

                return res.status(statusCode).json({
                    success: false,
                    valid: false,
                    isAdmin: false,
                    reason: auth.reason || 'not_admin',
                    serverInstanceId: SERVER_INSTANCE_ID
                });
            }

            return res.json({
                success: true,
                valid: true,
                isAdmin: true,
                is_admin: 1,
                isOperator: Boolean(auth.isOperator),
                is_operator: auth.isOperator ? 1 : 0,
                isPrimaryAdmin: Boolean(auth.isPrimaryAdmin),
                is_primary_admin: auth.isPrimaryAdmin ? 1 : 0,
                reason: null,
                serverInstanceId: SERVER_INSTANCE_ID,
                admin: {
                    id: auth.user.id,
                    name: auth.user.name || auth.user.id,
                    email: auth.user.email || '',
                    isAdmin: true,
                    isOperator: Boolean(auth.isOperator),
                    isPrimaryAdmin: Boolean(auth.isPrimaryAdmin)
                }
            });
        } catch (error) {
            console.error('관리자 권한 확인 오류:', error);
            return res.status(500).json({
                success: false,
                valid: false,
                isAdmin: false,
                reason: 'admin_auth_error',
                serverInstanceId: SERVER_INSTANCE_ID
            });
        }
    });
}

module.exports = registerAuthRoutes;
