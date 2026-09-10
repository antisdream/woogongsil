const { runtimeLog: wgsRuntimeLog } = require("./services/runtimeLog");
// Express 애플리케이션을 설정하고 도메인별 라우트 모듈을 연결합니다.
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const bcrypt = require('bcrypt');
const http = require('http');
const { loadEnvFile } = require('./config/env');
const { createDatabasePool } = require('./config/database');
const { createSecurityEventLog } = require('./services/securityEventLog');
const { runtimeLog } = require('./services/runtimeLog');
const { assertMigratedSchema, assertRuntimePrivileges } = require('./services/schemaRuntime');
const { createAdminUserControlSchema } = require('./services/adminUserControlSchema');

// Socket.IO 선택 로딩
// ------------------------------------------------------------
// npm install socket.io를 아직 하지 않았더라도 기존 사이트가 바로 중단되지 않도록
// try/catch로 감싸둡니다. 단, 멀티플레이 실시간 기능을 사용하려면 반드시 설치해야 합니다.
let SocketIOServer = null;
try {
    SocketIOServer = require('socket.io').Server;
} catch (socketIoError) {
    wgsRuntimeLog("warn", "server.js:25", 'WARN: socket.io package is not installed. Multiplayer realtime will be disabled until npm install socket.io is executed.');
}


// process.env를 읽는 모듈보다 먼저 환경 변수 파일를 불러옵니다.
loadEnvFile();

// 기존 이메일 인증 기능용 mailer.
// 회원가입/아이디 찾기 인증메일에서 사용 중이므로 유지합니다.
const { sendEmail } = require('./mailer');

// 문제 오류신고 라우터 연결용.
// 실제 메일 발송 로직은 backend/routes/errorReportRoutes.js에서 처리합니다.
const errorReportRoutes = require('./routes/errorReportRoutes');
const registerSiteManagementRoutes = require('./routes/siteManagementRoutes');
const registerLearningResultsRoutes = require('./routes/learningResultsRoutes');
const registerRetiredFeatureRoutes = require('./routes/retiredFeatureRoutes');
const registerAdminRoutes = require('./routes/adminRoutes');
const registerBoardRoutes = require('./routes/boardRoutes');
const registerStudyRoutes = require('./routes/studyRoutes');
const registerFortuneRoutes = require('./routes/fortuneRoutes');
const registerGatekeeperSecurity = require('./middleware/gatekeeperSecurity');
const registerPracticalUserRoutes = require('./routes/practicalUserRoutes');
const registerUserRoutes = require('./routes/userRoutes');
const registerExamRoutes = require('./routes/examRoutes');
const { createLearningAttemptService } = require('./services/learningAttemptService');
const { createMemberSessionService } = require('./services/memberSessionService');
const registerAuthRoutes = require('./routes/auth/authRoutes');
const registerAdminAuthRoutes = require('./routes/auth/adminAuthRoutes');
const { createAdminEmailOtpService } = require('./services/adminEmailOtpService');
const { createMemberEmailVerificationService } = require('./services/memberEmailVerificationService');
const { createUploadAccessService } = require('./services/uploadAccessService');
const { createBoardPolicyService } = require('./services/boardPolicyService');
const registerAccountRecoveryRoutes = require('./routes/auth/accountRecoveryRoutes');
const registerVisitorRoutes = require('./routes/visitorRoutes');
const registerLegalRoutes = require('./routes/legalRoutes');
const { createRealtimeState } = require('./services/realtimeState');
const { createAdminRuntimeState } = require('./services/adminRuntimeState');
const {
    createAdminSessionService,
    isInternalApprovalBypassRequest,
} = require('./services/adminSessionService');
const { createJsonFileStores } = require('./services/jsonFileStores');
const { createNoticeMailService } = require('./services/noticeMailService');
const { createVisitorAnalyticsSchema } = require('./services/visitorAnalyticsSchema');
const { createVisitorAnalyticsService } = require('./services/visitorAnalyticsService');
const { createVisitSessionService } = require('./services/visitSessionService');
const { createLegalConsentService } = require('./services/legalConsentService');
const { createWgsCorsOptions, createWgsSocketOptions, createWgsSecurityHeaders, registerRobotsTxt } = require('./services/httpSecurity');
const { registerMultiplayerFeature } = require('./services/multiplayerFeatureMount');
const { registerIpepFeature } = require('./services/ipepFeatureMount');

const app = express();
app.disable('x-powered-by');
const securityEventLog = createSecurityEventLog();
app.use(securityEventLog.middleware);
process.on('uncaughtException', error => { runtimeLog('error', 'server.uncaughtException', error); process.exit(1); });
process.on('unhandledRejection', error => { runtimeLog('error', 'server.unhandledRejection', error); process.exit(1); });

const wgsCorsOptions = createWgsCorsOptions();
app.use(createWgsSecurityHeaders());

// HTTP 서버 + Socket.IO 서버 준비합니다
// ------------------------------------------------------------
// 기존 app.listen 대신 server.listen을 사용해야 같은 포트에서
// Express API와 Socket.IO가 함께 동작합니다.
const server = http.createServer(app);
// Share the HTTP policy with polling and WebSocket handshakes.
const io = SocketIOServer ? new SocketIOServer(server, createWgsSocketOptions()) : null;

// 프론트에서 API 요청을 보낼 수 있도록 CORS 허용합니다
app.use(cors(wgsCorsOptions));

registerRobotsTxt(app);

// JSON body를 Express가 읽을 수 있도록 설정합니다.
app.use(express.json({ limit: '10mb' }));

registerRetiredFeatureRoutes({ app });

registerGatekeeperSecurity({
    app,
    crypto,
});
app.use('/api/error-report', errorReportRoutes);

// 1. MySQL 연결 풀
// - 매 요청마다 DB 연결을 새로 만들지 않고 pool에서 빌려 쓰는 방식입니다.
// - 기존 프로젝트 기본값은 유지하되, .env가 있으면 .env 값을 우선 사용해.
const pool = createDatabasePool();
const memberSessionService = createMemberSessionService({ pool });
// A surrounding DB transaction may still roll back, so this is a request event.
memberSessionService.events.on('revoked', ({ userId }) => securityEventLog.record({ event: 'session.revocation', outcome: 'pending', actorId: userId }));
app.use(memberSessionService.middleware);
const learningAttemptService = createLearningAttemptService({ pool, validateRealtimeSession });
const legalConsentService = createLegalConsentService({ pool });
registerLegalRoutes({ app, pool, legalConsentService, validateRealtimeSession });
const visitorAnalyticsSchema = createVisitorAnalyticsSchema({ pool });
const ensureVisitorAnalyticsSchema = visitorAnalyticsSchema.ensureVisitorAnalyticsSchema;
const visitorAnalyticsService = createVisitorAnalyticsService({ pool, crypto });
const visitSessionService = createVisitSessionService({
    pool,
    crypto,
    schema: visitorAnalyticsSchema,
    ensureSchema: ensureVisitorAnalyticsSchema,
});

registerMultiplayerFeature({ app, pool, io, memberSessionService });

// Database structures are migrated before this runtime starts.

// React 빌드 결과물을 Express가 정적 파일로 제공합니다.

registerIpepFeature({ app, pool, learningAttemptService, backendDir: __dirname });


// 예전 관리자 화면 정적 파일이 운영 dist에 남아 있어도 /admin은 항상 먼저 차단합니다.
app.use((req, res, next) => {
    if (req.path === '/admin' || req.path.startsWith('/admin/')) {
        return res.status(404).send('Not Found');
    }
    return next();
});

// 이메일 인증은 DB의 계정·용도·기한과 HttpOnly 브라우저 증명으로 검증합니다.
const memberVerificationService = createMemberEmailVerificationService({ pool, sendEmail });
const boardPolicyService = createBoardPolicyService({ pool });
const uploadAccessService = createUploadAccessService({ pool, backendDir: __dirname });
app.use('/uploads', uploadAccessService.serve(validateRealtimeSession));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// 기존 저장 비밀번호 해시와 맞도록 bcrypt 비용 값을 유지합니다.
const SALT_ROUNDS = 10;

// 기본 관리자 계정 식별자입니다.
// 운영자 권한은 계속 DB 기반 관리자 설정으로 확인합니다.
const ADMIN_USER_ID = String(process.env.WGS_ADMIN_USER_ID || process.env.ADMIN_USER_ID || 'skn29').trim().toLowerCase();
const { ensureAdminUserControlSchema, adminTableExists, adminColumnExists } = createAdminUserControlSchema({ pool, adminUserId: ADMIN_USER_ID });

// 실시간 세션과 접속자 상태 도우미입니다.
// 인스턴스 ID는 열린 브라우저 탭이 서버 재시작을 감지하고 다시 인증하도록 돕습니다.
// 접속자와 채팅 버퍼는 메모리 런타임 상태이며 SQL 기반 인증은 그대로 유지합니다.
const SERVER_INSTANCE_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
let adminSessionService = null;
const {
    activeUsers,
    touchActiveUser,
    pruneActiveUsers,
    removeActiveUser,
    getActiveUserList,
} = createRealtimeState({ adminUserId: ADMIN_USER_ID });

async function validateRealtimeSession(req) {
    const isBackgroundCheck = ['/api/check-session', '/api/notices/latest', '/api/online-users', '/api/legal/user-status'].includes(req.path);
    const auth = await memberSessionService.validateRequest(req, { touch: !isBackgroundCheck });
    if (auth.valid) touchActiveUser(auth.user, req, auth.sessionHash);
    return auth;
}

// 2-3. 관리자 권한검사 보조 로직
// ------------------------------------------------------------
// 목적:
// 1) 프론트에서 관리자 버튼을 숨기는 것만으로는 보안이 부족하다.
// 2) 사용자가 주소창에 /admin을 직접 입력하거나 브라우저 값을 조작해도
//  실제 관리자 API는 서버에서 세션토큰과 관리자 아이디를 다시 검사합니다.
// 3) 이 함수는 다음 Step의 사용자 관리/점검모드/전체공지 API에서도 그대로 재사용합니다.
async function validateAdminSession(req) {
    // 결재 승인 시 서버 내부에서 실제 CRUD API를 다시 호출합니다.
    // 이 내부 호출은 브라우저 세션 토큰이 없으므로, 별도 내부 승인 토큰이 있을 때만 최고관리자 요청으로 인정합니다.
    // 일반 브라우저 요청은 아래 validateRealtimeSession 로직을 그대로 통과해야 하므로 기존 로그인/중복로그인/세션만료 기능은 유지됩니다.
    if (isApprovalBypassRequest(req)) {
        return {
            ok: true,
            statusCode: 200,
            message: '관리자 인증 완료',
            valid: true,
            reason: null,
            id: ADMIN_USER_ID,
            sessionToken: 'admin-approval-internal',
            user: { id: ADMIN_USER_ID, name: '결재 승인 시스템' },
            isAdmin: true,
            isPrimaryAdmin: true,
            isOperator: true,
        };
    }

    if (!adminSessionService) {
        return {
            valid: false,
            ok: false,
            statusCode: 503,
            reason: 'admin_session_unavailable',
            message: '관리자 세션 서비스가 준비되지 않았습니다.',
            user: null,
            isAdmin: false,
            isPrimaryAdmin: false,
            isOperator: false,
        };
    }

    // /api/admin 공통 보호 미들웨어가 검증한 결과를 우선 재사용합니다.
    // 다른 내부 호출 경로에서는 관리자 쿠키를 직접 다시 검증하되 일반 회원 세션은 대체 수단으로 허용하지 않습니다.
    return req.adminAuth || adminSessionService.authenticateRequest(req);
}

// 관리자 화면 날짜 포맷 보조 함수
// ------------------------------------------------------------
//  사용자 관리 API에서 최근 로그인/로그아웃 시간을 표시할 때 사용합니다.
// 이전 병합 과정에서 이 함수 호출부만 남고 함수 정의가 빠져
// 관리자 회원 목록 API에서 날짜 포맷 함수를 안정적으로 사용할 수 있도록 제공합니다.
// 여기서는 기존 DB/로그인 로직은 변경하지 않고, 표시용 문자열 변환만 담당합니다.
function formatAdminDateTime(value) {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);

    // MySQL DATETIME 문자열이나 Date 객체가 예상 밖 값이면 화면이 영향을 받지 않도록 원문 문자열을 반환합니다.
    if (Number.isNaN(date.getTime())) {
        const fallback = String(value || '').trim();
        return fallback || null;
    }

    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
// 관리자 런타임 상태는 SQL 기반 CRUD 데이터와 의도적으로 분리합니다.
// 점검 모드는 JSON에 저장하고, 방송 공지는 접속 중인 사용자용 메모리에 유지합니다.
const DEFAULT_MAINTENANCE_MESSAGE = '현재 우공실 사이트 점검 중입니다. 잠시 후 다시 접속해주세요.';
const ADMIN_ONLY_USER_ID = ADMIN_USER_ID;

const {
    sanitizeAdminNoticeText,
    getAdminBroadcastHistory,
    getAdminBroadcastsForUser,
    createAdminBroadcastNotice,
    getAdminMaintenanceState,
    updateAdminMaintenanceState,
    isMaintenanceBlockedUser,
} = createAdminRuntimeState({
    maintenanceFile: path.join(__dirname, 'admin_maintenance_mode.json'),
    defaultMaintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
    adminOnlyUserId: ADMIN_ONLY_USER_ID,
    activeUsers,
});
// 기존 JSON 대체 저장소는 services/jsonFileStores.js에 모아 관리합니다.
const {
    USER_FILE,
    POSTS_FILE,
    RANKING_RANDOM_FILE,
    RANKING_PAST_FILE,
    RANKING_DATA_FILE,
    readJSON,
} = createJsonFileStores(__dirname);

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

const {
    getKSTDateTime,
    getBoardDateString,
    formatDateOnly,
    normalizeToMysqlDateTime,
} = require('./services/dateTimeHelpers');

const {
    isNoticeBoardCreateRequest,
    sendNoticePostEmailsInBackground,
} = createNoticeMailService({ pool, sendEmail });

// 5. 공통 DB 조회 헬퍼
async function getUserById(id) {
    //  로그인 핫픽스
    // - 사용자 관리 패치 컬럼이 아직 DB에 없을 때 SELECT에서 Unknown column으로 로그인 자체가 막히는 문제를 방지합니다.
    // - 서버 시작 보정 + 사용자 조회 직전 보정을 같이 둬서 환경별 Lightsail 반영 순서가 달라도 안전하게 처리합니다.
    await ensureAdminUserControlSchema();

    const [rows] = await pool.query(
        `SELECT id, password, name, email, DATE_FORMAT(dDay, '%Y-%m-%d') AS dDay, sessionToken, created_at,
                is_suspended, suspension_reason, is_primary_admin, is_operator
         FROM wgs_users
         WHERE id = ?`,
        [id]
    );

    return rows[0] || null;
}

async function getUserByEmail(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    const [rows] = await pool.query(
        `SELECT id, password, name, email, DATE_FORMAT(dDay, '%Y-%m-%d') AS dDay, sessionToken, created_at
         FROM wgs_users
         WHERE LOWER(email) = ?`,
        [normalizedEmail]
    );

    return rows[0] || null;
}

async function buildQuestionSelect(whereClause = '', params = [], orderClause = '') {
    const [rows] = await pool.query(
        `SELECT
            q.question_id AS id,
            q.question_id,
            q.year,
            q.session,
            q.info_id,
            q.subject,
            q.subject AS subject_id,
            q.question,
            q.question AS question_text,
            q.question_img,
            o.opt1,
            o.opt1 AS option_1,
            o.opt2,
            o.opt2 AS option_2,
            o.opt3,
            o.opt3 AS option_3,
            o.opt4,
            o.opt4 AS option_4,
            COALESCE(a.correct_label, o.answer) AS correct_label,
            o.answer AS answer,
            a.explanation_text,
            a.explanation_img
         FROM questions q
         LEFT JOIN options o ON q.question_id = o.question_id
         LEFT JOIN answers a ON q.question_id = a.question_id
         ${whereClause}
         ${orderClause}`,
        params
    );

    return rows;
}

async function refreshPostLikeCount(postId) {
    const [likeRows] = await pool.query('SELECT userId FROM wgs_post_likes WHERE postId = ?', [postId]);
    const likes = likeRows.length;

    await pool.query('UPDATE wgs_posts SET likes = ? WHERE id = ?', [likes, postId]);

    return {
        likes,
        likedUsers: likeRows.map(row => row.userId)
    };
}

async function getPostWithChildren(postId, viewerId = '') {
    const [postRows] = await pool.query('SELECT * FROM wgs_posts WHERE id = ?', [postId]);
    if (postRows.length === 0) return null;

    const post = postRows[0];
    const [[likeInfo]] = await pool.query('SELECT COUNT(*) AS likes FROM wgs_post_likes WHERE postId = ?', [post.id]);
    const [ownLike] = viewerId ? await pool.query('SELECT 1 FROM wgs_post_likes WHERE postId = ? AND userId = ?', [post.id, viewerId]) : [[]];
    post.likes = likeInfo.likes;
    post.likedUsers = ownLike.length ? [viewerId] : [];
    post.isNotice = Boolean(post.isNotice);
    // 프론트에서 공지 순서를 안정적으로 정렬할 수 있도록 숫자값으로 내려줍니다.
    post.noticeOrder = post.noticeOrder === null || post.noticeOrder === undefined ? null : Number(post.noticeOrder);

    const [comments] = await pool.query(
        'SELECT * FROM wgs_comments WHERE postId = ? ORDER BY CAST(id AS UNSIGNED) ASC, id ASC',
        [post.id]
    );

    for (const comment of comments) {
        const [replies] = await pool.query(
            'SELECT * FROM wgs_replies WHERE commentId = ? ORDER BY CAST(id AS UNSIGNED) ASC, id ASC',
            [comment.id]
        );

        comment.replies = replies;
    }

    post.comments = comments;

    return post;
}

registerAuthRoutes({
    app,
    pool,
    bcrypt,
    sendEmail,
    memberVerificationService,
    memberSessionService,
    validateRealtimeSession,
    getUserByEmail,
    getUserById,
    getKSTDateTime,
    ensureAdminUserControlSchema,
    normalizeAdminBool,
    getAdminMaintenanceState,
    isAdminAccessUser,
    isPrimaryAdminUser,
    adminColumnExists,
    touchActiveUser,
    removeActiveUser,
    formatDateOnly,
    validatePrimaryAdmin,
    validateAdminSession,
    saltRounds: SALT_ROUNDS,
    adminUserId: ADMIN_USER_ID,
    serverInstanceId: SERVER_INSTANCE_ID,
    defaultMaintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
    visitSessionService,
    visitorAnalyticsService,
    legalConsentService,
});



// 관리자 -1. 사용자 목록/접속 기록 조회 API
// ------------------------------------------------------------
// 목적:
// 1) 관리자 권한 사용자만 전체 회원 목록과 최근 로그인/로그아웃 기록을 확인할 수 있도록 합니다.
// 2) 회원 정보는 조회 전용으로만 제공해서 기존 회원가입/로그인/마이페이지 로직을 변경하지 않는다.
// 3) 게시글/댓글/오답 수는 관리자 화면 참고용 통계이며, 관련 테이블이 없거나 비어 있어도
//  관리자 화면 전체가 영향을 받지 않도록 안전하게 0으로 처리합니다.
// 4) 이번 단계는 DB 구조 변경 없이 조회 API만 추가합니다.
function normalizeAdminBool(value) {
    if (value === true || value === 1 || value === "1") return true;
    if (typeof value === "number") return value >0;
    if (typeof value === "bigint") return value >0n;
    if (Buffer.isBuffer(value)) return normalizeAdminBool(value.toString("utf8"));
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return ["true", "y", "yes", "on", "admin", "operator"].includes(normalized);
    }
    return false;
}

function isPrimaryAdminUser(user = {}) {
    return normalizeAdminBool(user?.is_primary_admin) || normalizeAdminBool(user?.isPrimaryAdmin);
}

function isAdminAccessUser(user = {}) {
    if (!user) return false;
    const role = String(user.role || user.user_role || "").trim().toLowerCase();
    return (
        isPrimaryAdminUser(user) ||
        normalizeAdminBool(user.is_operator) ||
        normalizeAdminBool(user.isOperator) ||
        normalizeAdminBool(user.is_admin) ||
        normalizeAdminBool(user.isAdmin) ||
        normalizeAdminBool(user.admin) ||
        normalizeAdminBool(user.operator) ||
        role === "admin" ||
        role === "operator"
    );
}

async function getAdminUserControl(userId) {
    if (!userId || !(await adminTableExists("wgs_users"))) return null;
    await ensureAdminUserControlSchema();

    // 최신 DB에서는 wgs_users.account 컬럼을 쓰지 않고 id가 로그인 계정입니다.
    // 그래서 id를 account 별칭으로 내려줘서 기존 프론트 로직과 호환시킵니다.
    const [rows] = await pool.query(
        `SELECT id, id AS account, name, email, created_at, is_suspended, suspension_reason,
                suspended_at, is_primary_admin, is_operator, operator_reason, operator_updated_at, operator_updated_by
         FROM wgs_users
         WHERE id = ?
         LIMIT 1`,
        [userId]
    );

    return rows?.[0] || null;
}

async function validatePrimaryAdmin(userId) {
    const user = await getAdminUserControl(userId);
    return Boolean(user && !normalizeAdminBool(user.is_suspended) && isPrimaryAdminUser(user));
}

async function validateOperatorAdmin(userId) {
    if (await validatePrimaryAdmin(userId)) return true;
    const user = await getAdminUserControl(userId);
    return Boolean(user && !normalizeAdminBool(user.is_suspended) && normalizeAdminBool(user.is_operator));
}

// 프론트에서 버튼을 숨겨도 주소/요청을 직접 조작할 수 있으므로
// 서버에서도 "요청자(requester)"와 "대상(target)"을 나눠 위험 작업을 방어합니다.
// - 최고관리자: 최고관리자 본인만 보호하고 운영자/일반 사용자는 관리 가능
// - 운영자 권한 사용자: 최고관리자, 다른 운영자, 자기 자신은 보호
async function isUserManagementTargetProtected(requesterId, targetUserId) {
    const requester = String(requesterId || '').trim();
    const targetId = String(targetUserId || '').trim();

    if (!targetId) return true;
    if (await validatePrimaryAdmin(targetId)) return true;
    if (await validatePrimaryAdmin(requester)) return false;
    if (requester && requester === targetId) return true;

    const targetUser = await getAdminUserControl(targetId);
    return Boolean(targetUser && normalizeAdminBool(targetUser.is_operator));
}

// 승인 반영용 내부 토큰입니다. .env에 ADMIN_APPROVAL_BYPASS_TOKEN이 있으면 그 값을 쓰고, 없으면 서버 시작마다 난수로 만든다.
// 예측 가능한 기본 문자열은 외부 요청자가 헤더를 흉내 낼 수 있으므로 런타임 난수로 보호합니다.
const ADMIN_APPROVAL_INTERNAL_TOKEN = process.env.ADMIN_APPROVAL_BYPASS_TOKEN || crypto.randomBytes(32).toString('hex');

function getApprovalBypassToken() {
    return ADMIN_APPROVAL_INTERNAL_TOKEN;
}

function isApprovalBypassRequest(req) {
    return isInternalApprovalBypassRequest(req, getApprovalBypassToken());
}

adminSessionService = createAdminSessionService({
    pool,
    crypto,
    getAdminUserControl,
    normalizeAdminBool,
    isAdminAccessUser,
    isPrimaryAdminUser,
});
const adminEmailOtpService = createAdminEmailOtpService({ pool, sendEmail });

// 모든 관리자 업무 API를 일반 회원 세션과 분리된 관리자 쿠키로 먼저 보호합니다.
// 결재 승인 서버 내부 재호출만 런타임 비밀 헤더로 통과시키며 브라우저 CORS에는 이 헤더를 공개하지 않습니다.
app.use('/api/admin', (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    if (isApprovalBypassRequest(req)) return next();
    return adminSessionService.protect(req, res, next);
});

registerAdminAuthRoutes({
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
    visitSessionService,
    visitorAnalyticsService,
    adminEmailOtpService,
});

registerVisitorRoutes({
    app,
    pool,
    crypto,
    validateAdminSession,
    visitorSchema: visitorAnalyticsSchema,
    visitorService: visitorAnalyticsService,
    visitSessionService,
    ensureVisitorAnalyticsSchema,
});

registerAdminRoutes({
    app,
    pool,
    bcrypt,
    validateAdminSession,
    validateRealtimeSession,
    getUserById,
    ensureAdminUserControlSchema,
    adminTableExists,
    adminColumnExists,
    normalizeAdminBool,
    isPrimaryAdminUser,
    validatePrimaryAdmin,
    isAdminAccessUser,
    getAdminUserControl,
    isUserManagementTargetProtected,
    revokeAdminSessionsForUser: (userId, reason) => adminSessionService.revokeAllForUser(userId, reason),
    revokeMemberSessionsForUser: (userId, reason) => memberSessionService.revokeAllForUser(userId, reason),
    getApprovalBypassToken,
    isApprovalBypassRequest,
    touchActiveUser,
    pruneActiveUsers,
    getActiveUserList,
    sanitizeAdminNoticeText,
    getAdminBroadcastHistory,
    createAdminBroadcastNotice,
    getAdminBroadcastsForUser,
    getAdminMaintenanceState,
    updateAdminMaintenanceState,
    formatAdminDateTime,
    sendEmail,
    adminUserId: ADMIN_USER_ID,
    serverInstanceId: SERVER_INSTANCE_ID,
    adminOnlyUserId: ADMIN_ONLY_USER_ID,
    defaultMaintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
    legalConsentService,
});



registerAccountRecoveryRoutes({
    app,
    pool,
    bcrypt,
    getUserById,
    getUserByEmail,
    memberVerificationService,
    memberSessionService,
    validateRealtimeSession,
    sendEmail,
    revokeAdminSessionsForUser: (userId, reason, db) => adminSessionService.revokeAllForUser(userId, reason, db),
    saltRounds: SALT_ROUNDS,
});

registerPracticalUserRoutes({
    app,
    pool,
    validateRealtimeSession,
});

registerUserRoutes({
    app,
    pool,
    bcrypt,
    getUserById,
    validateRealtimeSession,
    formatDateOnly,
    getKSTDateTime,
    legalConsentService,
});

registerExamRoutes({
    app,
    pool,
    buildQuestionSelect,
    learningAttemptService,
});

registerLearningResultsRoutes({ app, pool, buildQuestionSelect, learningAttemptService });

registerFortuneRoutes({
    app,
    pool,
    getUserById,
    validateRealtimeSession,
    getKSTDateTime,
    legalConsentService,
});

registerBoardRoutes({
    uploadAccessService,
    app,
    pool,
    backendDir: __dirname,
    getPostWithChildren,
    refreshPostLikeCount,
    getBoardDateString,
    isNoticeBoardCreateRequest,
    sendNoticePostEmailsInBackground,
    getUserById,
    validateRealtimeSession,
    sendEmail,
});

registerStudyRoutes({
    uploadAccessService,
    app,
    pool,
    backendDir: __dirname,
    validateRealtimeSession,
});

// 13. 기타 API
app.get('/api/ip', (req, res) => {
    const interfaces = os.networkInterfaces();
    let ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';

    for (const values of Object.values(interfaces)) {
        for (const info of values || []) {
            if (info.family === 'IPv4' && !info.internal) {
                ip = info.address;
                break;
            }
        }
    }

    return res.json({ ip });
});

app.get('/api/mobile-qr', async (req, res) => {
    const data = String(req.query.data || '').trim();
    if (!data || data.length > 2048) {
        return res.status(400).send('Invalid QR data');
    }

    const encodedData = encodeURIComponent(data);
    const providerUrls = [
        `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodedData}`,
        `https://quickchart.io/qr?size=200&text=${encodedData}`,
    ];

    for (const providerUrl of providerUrls) {
        try {
            const response = await fetch(providerUrl, {
                signal: AbortSignal.timeout(5000),
                headers: { 'User-Agent': 'wgs-mobile-qr/1.0' },
            });
            const contentType = response.headers.get('content-type') || 'image/png';
            if (!response.ok || !contentType.toLowerCase().startsWith('image/')) {
                continue;
            }

            const imageBuffer = Buffer.from(await response.arrayBuffer());
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.send(imageBuffer);
        } catch (error) {
            wgsRuntimeLog("warn", "server.js:740", '[mobile qr] provider failed:', providerUrl, error.message);
        }
    }

    return res.status(502).send('QR image unavailable');
});

//  화면 설정 관리 API
registerSiteManagementRoutes({
    app,
    pool,
    validateAdminSession,
    io,
    adminUserId: ADMIN_USER_ID,
});

// 관리자 화면은 일반 회원 SPA와 다른 Vite 엔트리를 사용합니다.
// /manage 하위 새로고침은 일반 회원 SPA와 분리된 관리자 HTML로 보냅니다.
app.use((req, res, next) => {
    if (req.path === '/manage' || req.path.startsWith('/manage/')) {
        const adminIndexPath = path.resolve(__dirname, '..', 'frontend', 'dist', 'manage', 'index.html');
        return res.sendFile(adminIndexPath, (error) => {
            if (error && !res.headersSent) res.status(500).send('관리자 화면 없음');
        });
    }
    return next();
});

// 14. React SPA 새로고침 방지합니다.
// - /api로 시작하지 않는 요청은 React의 index.html로 보내서 F5 새로고침 404를 방지해.
// - 반드시 모든 API 라우터보다 아래에 있어야 해.
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();

    const indexPath = path.resolve(__dirname, '..', 'frontend', 'dist', 'index.html');

    res.sendFile(indexPath, (error) => {
        if (error) res.status(500).send('화면 없음');
    });
});

// 존재하지 않는 API 경로에 대한 응답.
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, msg: '존재하지 않는 API입니다.' });
    }

    return res.status(404).send('Not Found');
});

app.use((error, _req, res, _next) => {
    runtimeLog('error', 'server.request', error);
    if (res.headersSent) { res.destroy(); return; }
    const status = Number(error.status);
    res.status(Number.isInteger(status) && status >= 400 && status < 500 ? status : 500)
        .json({ success: false, msg: '요청을 처리하지 못했습니다. 입력 내용을 확인하고 다시 시도해주세요.' });
});

// 15. 서버 시작
// - 배포 마이그레이션 완료와 제한된 실행 계정 권한을 확인한 뒤 요청을 받습니다.
async function startServer() {
    try {
        await securityEventLog.ready();
        await assertMigratedSchema(pool);
        await assertRuntimePrivileges(pool);
        // Existing privacy retention is a data operation, separate from DDL.
        await legalConsentService.purgeExpiredRecords();

        const port = Number(process.env.PORT || 5000);
        const bindHost = String(
            process.env.WGS_BIND_HOST
            || (String(process.env.NODE_ENV || '').toLowerCase() === 'production'
                ? '127.0.0.1'
                : '0.0.0.0')
        ).trim();

        server.listen(port, bindHost, () => {
            wgsRuntimeLog("info", "server.js:817", ` 우공실 서버 정상 작동 중 (Express + Socket.IO, http://${bindHost}:${port}/)`);
            wgsRuntimeLog("info", "server.js:818", ` 서버 인스턴스 ID: ${SERVER_INSTANCE_ID}`);
        });
    } catch (error) {
        wgsRuntimeLog("error", "server.js:821", '서버 시작 실패:', error);
        process.exit(1);
    }
}

startServer();
