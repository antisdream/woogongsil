// Express 애플리케이션을 설정하고 도메인별 라우트 모듈을 연결합니다.
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const bcrypt = require('bcrypt');
const http = require('http');
const https = require('https');
const { loadEnvFile } = require('./config/env');
const { createDatabasePool } = require('./config/database');

// Socket.IO 선택 로딩
// ------------------------------------------------------------
// npm install socket.io를 아직 하지 않았더라도 기존 사이트가 바로 중단되지 않도록
// try/catch로 감싸둡니다. 단, 멀티플레이 실시간 기능을 사용하려면 반드시 설치해야 합니다.
let SocketIOServer = null;
try {
    SocketIOServer = require('socket.io').Server;
} catch (socketIoError) {
    console.warn('WARN: socket.io package is not installed. Multiplayer realtime will be disabled until npm install socket.io is executed.');
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
const registerRankingRoutes = require('./routes/ranking/rankingRoutes');
const registerRankingHistoryRoutes = require('./routes/ranking/rankingHistoryRoutes');
const registerAdminRoutes = require('./routes/adminRoutes');
const registerBoardRoutes = require('./routes/boardRoutes');
const registerStudyRoutes = require('./routes/studyRoutes');
const registerFortuneRoutes = require('./routes/fortuneRoutes');
const registerGatekeeperSecurity = require('./middleware/gatekeeperSecurity');
const registerPracticalUserRoutes = require('./routes/practicalUserRoutes');
const registerUserRoutes = require('./routes/userRoutes');
const registerExamRoutes = require('./routes/examRoutes');
const registerRealtimeRoutes = require('./routes/realtimeRoutes');
const registerAuthRoutes = require('./routes/auth/authRoutes');
const registerAccountRecoveryRoutes = require('./routes/auth/accountRecoveryRoutes');
const {
    mealmapKakaoMapJsKey,
    mealmapKakaoRestKey,
    mealmapHttpsJson,
} = require('./services/kakaoHelpers');
const { createRealtimeState } = require('./services/realtimeState');
const { createAdminRuntimeState } = require('./services/adminRuntimeState');
const { createJsonFileStores } = require('./services/jsonFileStores');
const { createMealMapUserNotices } = require('./services/mealmapUserNotices');
const { createWrongNotesSchemaChecker } = require('./services/wrongNotesSchema');
const { createStudyNoteSchemaChecker } = require('./services/studyNoteSchema');
const { createSchemaCompatibilityChecker } = require('./services/schemaCompatibility');
const { createJsonSqlImporter } = require('./services/jsonSqlImporter');
const { createNoticeMailService } = require('./services/noticeMailService');
const { wgsAllowedCorsOrigin, createWgsCorsOptions, createWgsSecurityHeaders, registerRobotsTxt } = require('./services/httpSecurity');
const { registerMultiplayerFeature } = require('./services/multiplayerFeatureMount');
const { registerIpepFeature } = require('./services/ipepFeatureMount');

const app = express();
app.disable('x-powered-by');

const wgsCorsOptions = createWgsCorsOptions();
app.use(createWgsSecurityHeaders());

// HTTP 서버 + Socket.IO 서버 준비합니다
// ------------------------------------------------------------
// 기존 app.listen 대신 server.listen을 사용해야 같은 포트에서
// Express API와 Socket.IO가 함께 동작합니다.
const server = http.createServer(app);
const io = SocketIOServer ? new SocketIOServer(server, {
    cors: {
        origin(origin, callback) {
            callback(null, wgsAllowedCorsOrigin(origin));
        },
        methods: ['GET', 'POST'],
        credentials: true
    }
}) : null;

// 프론트에서 API 요청을 보낼 수 있도록 CORS 허용합니다
app.use(cors(wgsCorsOptions));

registerRobotsTxt(app);

// JSON body를 Express가 읽을 수 있도록 설정합니다.
app.use(express.json({ limit: '10mb' }));

const { requireHcaptcha } = registerGatekeeperSecurity({
    app,
    crypto,
    https,
    backendDir: __dirname,
    isApprovalBypassRequest: (req) => isApprovalBypassRequest(req),
});
app.use('/api/error-report', errorReportRoutes);

// 1. MySQL 연결 풀
// - 매 요청마다 DB 연결을 새로 만들지 않고 pool에서 빌려 쓰는 방식입니다.
// - 기존 프로젝트 기본값은 유지하되, .env가 있으면 .env 값을 우선 사용해.
const pool = createDatabasePool();

const {
    notifyMealMapPlaceDecisionV2515,
    notifyMealMapEditDecisionV2515,
    getUndeliveredMealMapUserNoticesV2515,
} = createMealMapUserNotices({ pool });


registerMultiplayerFeature({ app, pool, io });

// 실기 오답노트 SQL 테이블 안전 점검
// ----------------------------------------------------------
// 기존 DB를 삭제하거나 초기화하지 않고, 필요한 컬럼만 없을 때 추가합니다.
// 기존 wgs_wrong_notes 테이블에 subject 컬럼만 없는 경우에도
// 서버 실행 시 자동으로 보완되도록 만들었다.
const { ensureWrongNotesSchema } = createWrongNotesSchemaChecker({ pool });
ensureWrongNotesSchema();

// 학습노트/오답정리용 SQL 테이블 안전 점검
// 기존 게시글/오답 원본 테이블은 건드리지 않고 학습문서 전용 테이블만 보완합니다.
const { ensureStudyNoteSchema } = createStudyNoteSchemaChecker({ pool });
ensureStudyNoteSchema();

// React 빌드 결과물을 Express가 정적 파일로 제공합니다.

registerIpepFeature({ app, pool, backendDir: __dirname });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// 이메일 인증번호는 메모리에 보관하며 서버 재시작 시 초기화됩니다.
const verificationCodes = {};

// 기존 저장 비밀번호 해시와 맞도록 bcrypt 비용 값을 유지합니다.
const SALT_ROUNDS = 10;

// 기본 관리자 계정 식별자입니다.
// 운영자 권한은 계속 DB 기반 관리자 설정으로 확인합니다.
const ADMIN_USER_ID = String(process.env.WGS_ADMIN_USER_ID || process.env.ADMIN_USER_ID || 'skn29').trim().toLowerCase();

// 실시간 세션과 접속자 상태 도우미입니다.
// 인스턴스 ID는 열린 브라우저 탭이 서버 재시작을 감지하고 다시 인증하도록 돕습니다.
// 접속자와 채팅 버퍼는 메모리 런타임 상태이며 SQL 기반 인증은 그대로 유지합니다.
const SERVER_INSTANCE_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const {
    activeUsers,
    realtimeChatMessages,
    realtimeChatMaxMessages: REALTIME_CHAT_MAX_MESSAGES,
    touchActiveUser,
    pruneActiveUsers,
    removeActiveUser,
    getActiveUserList,
    isRealtimeAdminUser,
    sanitizeChatText,
    getValidChatSince,
    getRealtimeChatMessagesAfter,
} = createRealtimeState({ adminUserId: ADMIN_USER_ID });

async function validateRealtimeSession(req) {
    // 일부 관리자 조회 API는 GET(query) 또는 body 없는 요청으로 들어올 수 있습니다.
    // req.body.id를 바로 읽으면 body가 undefined인 요청에서 서버 오류가 발생할 수 있습니다.
    // body, query, header를 모두 확인하는 방식으로 요청 값을 통일합니다.
    const body = req && req.body && typeof req.body === 'object'? req.body : {};
    const query = req && req.query && typeof req.query === 'object'? req.query : {};

    const id = String(body.id ?? body.userId ?? query.id ?? query.userId ?? req?.headers?.['x-user-id'] ?? '').trim();
    const sessionToken = String(body.sessionToken ?? query.sessionToken ?? req?.headers?.['x-session-token'] ?? '').trim();
    const clientServerInstanceId = String(body.serverInstanceId ?? query.serverInstanceId ?? req?.headers?.['x-server-instance-id'] ?? '').trim();

    if (!id || !sessionToken) {
        return { valid: false, reason: 'session_expired', user: null, id, sessionToken };
    }

    // 서버가 재시작/업데이트된 경우 기존 화면을 들고 있는 사용자를 다시 로그인하게 합니다.
    // check-session, online-users와 같은 기준을 사용해야 toast 문구가 흔들리지 않습니다.
    if (clientServerInstanceId && clientServerInstanceId !== SERVER_INSTANCE_ID) {
        removeActiveUser(id, sessionToken || null);
        return { valid: false, reason: 'server_updated', user: null, id, sessionToken };
    }

    const user = await getUserById(id);
    const isValid = Boolean(user && user.sessionToken && user.sessionToken === sessionToken);

    if (!isValid) {
        removeActiveUser(id, sessionToken || null);
        return {
            valid: false,
            reason: user && user.sessionToken ? 'duplicate_login' : 'session_expired',
            user: null,
            id,
            sessionToken
        };
    }

    touchActiveUser(user, req, sessionToken);
    return { valid: true, reason: null, user, id, sessionToken };
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

    const auth = await validateRealtimeSession(req);

    // 로그인 세션 자체가 유효하지 않으면 관리자 여부를 볼 필요 없이 차단합니다.
    if (!auth.valid) {
        return { ...auth, ok: false, statusCode: 401, message: '관리자 인증이 필요합니다.', isAdmin: false, isPrimaryAdmin: false, isOperator: false };
    }

    const normalizedUserId = String(auth.user?.id || auth.id || '').trim().toLowerCase();
    const userControl = await getAdminUserControl(normalizedUserId);
    const isPrimaryAdmin = isPrimaryAdminUser(userControl);
    const isOperator = isAdminAccessUser({ ...userControl, id: normalizedUserId });
    const isSuspended = normalizeAdminBool(userControl?.is_suspended);

    // 최고관리자 또는 운영자 권한을 받은 사용자만 관리자 페이지와 API를 사용할 수 있습니다.
    if (!isOperator || isSuspended) {
        return { ...auth, ok: false, statusCode: 403, message: isSuspended ? '임시정지된 계정입니다.' : '관리자 권한이 필요합니다.', valid: false, isAdmin: false, isPrimaryAdmin, isOperator: false, reason: isSuspended ? 'suspended' : 'not_admin' };
    }

    return { ...auth, ok: true, statusCode: 200, message: '관리자 인증 완료', valid: true, isAdmin: true, isPrimaryAdmin, isOperator, reason: null };
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
    IPEP_RANKING_FILE,
    readJSON,
    getIpepRankingStore,
    saveIpepRankingStore,
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
    getSeasonStatus,
} = require('./services/dateTimeHelpers');

const {
    isNoticeBoardCreateRequest,
    sendNoticePostEmailsInBackground,
} = createNoticeMailService({ pool, sendEmail });

const { ensureSchemaCompatibility } = createSchemaCompatibilityChecker({ pool });

const { importDataFromJSON } = createJsonSqlImporter({
    pool,
    bcrypt,
    saltRounds: SALT_ROUNDS,
    userFile: USER_FILE,
    postsFile: POSTS_FILE,
    rankingRandomFile: RANKING_RANDOM_FILE,
    rankingDataFile: RANKING_DATA_FILE,
    rankingPastFile: RANKING_PAST_FILE,
    readJSON,
    normalizeToMysqlDateTime,
    getBoardDateString
});

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

async function getPostWithChildren(postId) {
    const [postRows] = await pool.query('SELECT * FROM wgs_posts WHERE id = ?', [postId]);
    if (postRows.length === 0) return null;

    const post = postRows[0];
    const likeInfo = await refreshPostLikeCount(post.id);

    post.likes = likeInfo.likes;
    post.likedUsers = likeInfo.likedUsers;
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
    requireHcaptcha,
    verificationCodes,
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
});



// 관리자 -1. 사용자 목록/접속 기록 조회 API
// ------------------------------------------------------------
// 목적:
// 1) 관리자 권한 사용자만 전체 회원 목록과 최근 로그인/로그아웃 기록을 확인할 수 있도록 합니다.
// 2) 회원 정보는 조회 전용으로만 제공해서 기존 회원가입/로그인/마이페이지 로직을 변경하지 않는다.
// 3) 게시글/댓글/오답 수는 관리자 화면 참고용 통계이며, 관련 테이블이 없거나 비어 있어도
//  관리자 화면 전체가 영향을 받지 않도록 안전하게 0으로 처리합니다.
// 4) 이번 단계는 DB 구조 변경 없이 조회 API만 추가합니다.
async function adminTableExists(tableName) {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = ?`,
            [tableName]
        );
        return Number(rows?.[0]?.cnt || 0) >0;
    } catch (error) {
        console.warn(`관리자 테이블 존재 확인 실패(${tableName}):`, error.message);
        return false;
    }
}

async function adminColumnExists(tableName, columnName) {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
            [tableName, columnName]
        );
        return Number(rows?.[0]?.cnt || 0) >0;
    } catch (error) {
        console.warn(`관리자 컬럼 존재 확인 실패(${tableName}.${columnName}):`, error.message);
        return false;
    }
}


let adminUserControlSchemaReady = false; // 사용자 제어 DB 구조를 1회 보정했는지 기억합니다.
let adminUserControlSchemaPromise = null; // 동시에 여러 요청이 들어와도 ALTER가 중복 실행되지 않도록 잠금 역할을 합니다.

async function ensureAdminUserControlSchema() {
    // 사용자 접속 제한, 운영자, 결재 기능용 컬럼과 테이블을 개발·배포 환경에서 안전하게 보정합니다.
    if (adminUserControlSchemaReady) return;
    if (adminUserControlSchemaPromise) return adminUserControlSchemaPromise;

    adminUserControlSchemaPromise = (async () => {
    if (!(await adminTableExists("wgs_users"))) return;

    const userColumns = [
        ["created_at", "DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '회원가입 일시'"],
        ["is_suspended", "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '관리자 임시정지 여부'"],
        ["suspension_reason", "TEXT NULL COMMENT '임시정지 사유'"],
        ["suspended_at", "DATETIME NULL COMMENT '임시정지/해제 처리 일시'"],
        ["is_primary_admin", "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '최고관리자 여부'"],
        ["is_operator", "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '운영자 권한 여부'"],
        ["operator_reason", "TEXT NULL COMMENT '운영자 권한 변경 사유'"],
        ["operator_updated_at", "DATETIME NULL COMMENT '운영자 권한 변경 일시'"],
        ["operator_updated_by", "VARCHAR(100) NULL COMMENT '운영자 권한 변경 관리자'"],
        ["last_login_at", "DATETIME NULL COMMENT '최근 로그인 일시'"],
        ["last_logout_at", "DATETIME NULL COMMENT '최근 로그아웃 일시'"],
    ];

    for (const [columnName, definition] of userColumns) {
        if (!(await adminColumnExists("wgs_users", columnName))) {
            await pool.query(`ALTER TABLE wgs_users ADD COLUMN ${columnName} ${definition}`);
        }
    }

    const [primaryAdminRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_users WHERE COALESCE(is_primary_admin, 0) = 1');
    if (Number(primaryAdminRows?.[0]?.cnt || 0) === 0 && ADMIN_USER_ID) {
        await pool.query('UPDATE wgs_users SET is_primary_admin = 1 WHERE LOWER(id) = ?', [ADMIN_USER_ID]);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_admin_approvals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            requester_id VARCHAR(100) NOT NULL,
            requester_name VARCHAR(100) NULL,
            action_method VARCHAR(20) NOT NULL,
            action_path TEXT NOT NULL,
            action_title VARCHAR(255) NULL,
            action_body LONGTEXT NULL,
            action_preview LONGTEXT NULL,
            status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
            requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_by VARCHAR(100) NULL,
            reviewed_at DATETIME NULL,
            reject_reason TEXT NULL,
            apply_result LONGTEXT NULL,
            hidden_from_primary TINYINT(1) NOT NULL DEFAULT 0,
            hidden_from_requester TINYINT(1) NOT NULL DEFAULT 0,
            INDEX idx_status_requested (status, requested_at),
            INDEX idx_requester_requested (requester_id, requested_at),
            INDEX idx_primary_hidden_requested (hidden_from_primary, requested_at),
            INDEX idx_requester_hidden_requested (hidden_from_requester, requester_id, requested_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 전체 공지 발송과 점검 모드 변경은 운영자가 바로 적용하므로 별도의 공통 이력 테이블에 저장합니다.
    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_admin_operation_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            operation_type VARCHAR(40) NOT NULL,
            action VARCHAR(40) NOT NULL,
            title VARCHAR(200) NULL,
            message TEXT NULL,
            actor_id VARCHAR(80) NULL,
            actor_name VARCHAR(100) NULL,
            payload LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_admin_operation_type_created (operation_type, created_at),
            INDEX idx_admin_operation_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 같은 결재 DB 행을 공유하면서 최고관리자 목록과 운영자 본인 목록은 각각 숨김 처리합니다.
    // 실제 DELETE를 하지 않으므로 한쪽이 정리해도 다른 쪽의 확인/감사 목록에는 영향을 주지 않는다.
    const approvalVisibilityColumns = [
        ['hidden_from_primary', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '최고관리자 결재 목록 숨김 여부'"],
        ['hidden_from_requester', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '요청자 본인 결재 목록 숨김 여부'"],
    ];
    for (const [columnName, definition] of approvalVisibilityColumns) {
        if (!(await adminColumnExists('wgs_admin_approvals', columnName))) {
            await pool.query(`ALTER TABLE wgs_admin_approvals ADD COLUMN ${columnName} ${definition}`);
        }
    }

    adminUserControlSchemaReady = true;
    })();

    try {
        await adminUserControlSchemaPromise;
    } finally {
        adminUserControlSchemaPromise = null;
    }
}

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
    return req.headers["x-admin-approval-bypass"] === getApprovalBypassToken();
}

registerAdminRoutes({
    app,
    pool,
    https,
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
    notifyMealMapPlaceDecisionV2515,
    notifyMealMapEditDecisionV2515,
    getUndeliveredMealMapUserNoticesV2515,
    adminUserId: ADMIN_USER_ID,
    serverInstanceId: SERVER_INSTANCE_ID,
    adminOnlyUserId: ADMIN_ONLY_USER_ID,
    defaultMaintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
});


registerRealtimeRoutes({
    app,
    validateRealtimeSession,
    touchActiveUser,
    getActiveUserList,
    getValidChatSince,
    getRealtimeChatMessagesAfter,
    isRealtimeAdminUser,
    sanitizeChatText,
    realtimeChatMessages,
    realtimeChatMaxMessages: REALTIME_CHAT_MAX_MESSAGES,
    serverInstanceId: SERVER_INSTANCE_ID,
});

registerAccountRecoveryRoutes({
    app,
    pool,
    bcrypt,
    requireHcaptcha,
    getUserById,
    getUserByEmail,
    verificationCodes,
    saltRounds: SALT_ROUNDS,
});

registerPracticalUserRoutes({
    app,
    pool,
    getSeasonStatus,
    getUserById,
    validateRealtimeSession,
    getIpepRankingStore,
    saveIpepRankingStore,
    safeNumber,
    getKSTDateTime,
});

registerUserRoutes({
    app,
    pool,
    bcrypt,
    getUserById,
    validateRealtimeSession,
    formatDateOnly,
    getKSTDateTime,
});

registerExamRoutes({
    app,
    pool,
    buildQuestionSelect,
});

registerRankingRoutes({
    app,
    pool,
    getSeasonStatus,
    validateRealtimeSession,
    getIpepRankingStore,
    safeNumber,
});


// 개인 랭킹 히스토리 조회 API
// - 홈 화면의 실시간 Top 3는 기존 /api/rankings 그대로 유지합니다.
// - 이 API는 사용자의 과거 랭킹 기록을 날짜 범위로 조회하기 위한 전용 API입니다.
// - 연도/회차는 하드코딩하지 않고 DB 또는 실기 랭킹 JSON에 저장된 값을 기준으로만 집계합니다.

registerRankingHistoryRoutes({
    app,
    pool,
    fs,
    backendDir: __dirname,
    rankingDataFile: RANKING_DATA_FILE,
    ipepRankingFile: IPEP_RANKING_FILE,
    getSeasonStatus,
});

registerFortuneRoutes({
    app,
    pool,
    getUserById,
    validateRealtimeSession,
    getKSTDateTime,
});

registerBoardRoutes({
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
            console.warn('[mobile qr] provider failed:', providerUrl, error.message);
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
    mealmapKakaoMapJsKey,
    mealmapKakaoRestKey,
    mealmapHttpsJson,
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

// 15. 서버 시작
// - 서버 시작 전에 날짜 컬럼 보정과 JSON 자동 복구를 먼저 수행해.
async function startServer() {
    try {
        await ensureSchemaCompatibility();
        // 사용자 관리에 필요한 컬럼과 결재 테이블을 서버 시작 시 확인합니다.
        // DB 스키마 차이로 로그인 SELECT 단계에서 Unknown column 오류가 발생하지 않도록 보정합니다.
        await ensureAdminUserControlSchema();
        await importDataFromJSON();

        const port = Number(process.env.PORT || 5000);

// ===== MEALMAP_LAYOUT_SETTINGS_V253_BEGIN =====
// ===== MEALMAP_LAYOUT_SETTINGS_V253_END =====


        server.listen(port, () => {
            console.log(` 우공실 서버 정상 작동 중 (Express + Socket.IO, http://localhost:${port}/)`);
            console.log(` 서버 인스턴스 ID: ${SERVER_INSTANCE_ID}`);
        });
    } catch (error) {
        console.error('서버 시작 실패:', error);
        process.exit(1);
    }
}

startServer();
