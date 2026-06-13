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
// npm install socket.io를 아직 하지 않았더라도 기존 사이트가 바로 죽지 않도록
// try/catch로 감싸둔다. 단, 멀티플레이 실시간 기능을 쓰려면 반드시 설치해야 한다.
let SocketIOServer = null;
try {
    SocketIOServer = require('socket.io').Server;
} catch (socketIoError) {
    console.warn('WARN: socket.io package is not installed. Multiplayer realtime will be disabled until npm install socket.io is executed.');
}


// process.env를 읽는 모듈보다 먼저 backend/.env를 불러옵니다.
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

const app = express();

// HTTP 서버 + Socket.IO 서버 준비
// ------------------------------------------------------------
// 기존 app.listen 대신 server.listen을 사용해야 같은 포트에서
// Express API와 Socket.IO가 함께 동작한다.
const server = http.createServer(app);
const io = SocketIOServer ? new SocketIOServer(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
}) : null;

const createMultiplayerRouter = require('./multiplayerRoutes');
const { attachMultiplayerSocket } = require('./multiplayerSocket');

// 프론트에서 API 요청을 보낼 수 있도록 CORS 허용
app.use(cors());

// JSON body를 Express가 읽을 수 있게 함
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

//  user decision notice helpers BEGIN =====
async function ensureMealMapUserNoticesSchemaV2515() {
  await pool.promise().query(
    `CREATE TABLE IF NOT EXISTS mealmap_user_notices (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'info',
      source_type VARCHAR(80) NULL,
      source_id VARCHAR(80) NULL,
      payload LONGTEXT NULL,
      delivered_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_mealmap_user_notices_user_delivered (user_id, delivered_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

function normalizeMealMapNoticeUserIdV2515(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

async function createMealMapUserNoticeV2515(userId, title, message, options = {}) {
  const targetUserId = normalizeMealMapNoticeUserIdV2515(userId);
  if (!targetUserId) return false;
  try {
    await ensureMealMapUserNoticesSchemaV2515();
    await pool.promise().query(
      `INSERT INTO mealmap_user_notices
       (user_id, title, message, status, source_type, source_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        targetUserId,
        String(title || '회식맵 처리 결과'),
        String(message || '회식맵 요청 처리 결과가 업데이트되었습니다.'),
        String(options.status || 'info'),
        options.sourceType || null,
        options.sourceId === undefined || options.sourceId === null ? null : String(options.sourceId),
        options.payload ? JSON.stringify(options.payload) : null,
      ]
    );
    return true;
  } catch (err) {
    console.warn('[mealmap user notice create warning]', err.message);
    return false;
  }
}

async function getUndeliveredMealMapUserNoticesV2515(userId) {
  const targetUserId = normalizeMealMapNoticeUserIdV2515(userId);
  if (!targetUserId) return [];
  try {
    await ensureMealMapUserNoticesSchemaV2515();
    const [rows] = await pool.promise().query(
      `SELECT id, title, message, status, source_type, source_id, created_at
       FROM mealmap_user_notices
       WHERE user_id = ? AND delivered_at IS NULL
       ORDER BY id ASC
       LIMIT 10`,
      [targetUserId]
    );
    const ids = rows.map((row) => row.id);
    if (ids.length >0) {
      await pool.promise().query(`UPDATE mealmap_user_notices SET delivered_at = NOW() WHERE id IN (?)`, [ids]);
    }
    return rows.map((row) => ({
      id: `mealmap_user_notice_${row.id}`,
      title: row.title,
      message: row.message,
      status: row.status || 'info',
      level: row.status || 'info',
      source: 'mealmap',
      sourceType: row.source_type,
      sourceId: row.source_id,
      createdAt: row.created_at,
      createdAtMs: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      authorName: '회식맵 관리자',
    }));
  } catch (err) {
    console.warn('[mealmap user notices fetch warning]', err.message);
    return [];
  }
}

async function notifyMealMapPlaceDecisionV2515(placeId, decision) {
  try {
    const [rows] = await pool.promise().query(
      `SELECT id, name, reporter_id
       FROM mealmap_places
       WHERE id = ?
       LIMIT 1`,
      [placeId]
    );
    const place = rows[0];
    if (!place || !place.reporter_id) return false;
    const approved = decision === 'approved';
    // 사용자 팝업에는 식당명/개발용 변수를 노출하지 않고 승인·반려 결과만 간단히 보여준다.
    const title = '회식맵 알림';
    const message = approved ? '회식맵 제보가 승인되었습니다.' : '회식맵 제보가 반려되었습니다.';
    return createMealMapUserNoticeV2515(place.reporter_id, title, message, {
      status: approved ? 'success' : 'warning',
      sourceType: 'mealmap_place',
      sourceId: place.id,
      payload: { decision, placeId: place.id, name: place.name },
    });
  } catch (err) {
    console.warn('[mealmap place decision notice warning]', err.message);
    return false;
  }
}

async function notifyMealMapEditDecisionV2515(editId, decision) {
  try {
    const [rows] = await pool.promise().query(
      `SELECT e.id, e.user_id, e.proposed_name, p.name AS current_name
       FROM mealmap_place_edits e
       LEFT JOIN mealmap_places p ON p.id = e.place_id
       WHERE e.id = ?
       LIMIT 1`,
      [editId]
    );
    const edit = rows[0];
    if (!edit || !edit.user_id) return false;
    const placeName = edit.proposed_name || edit.current_name || '수정 제안한 장소';
    const approved = decision === 'approved';
    // 사용자 팝업에는 식당명/개발용 변수를 노출하지 않고 승인·반려 결과만 간단히 보여준다.
    const title = '회식맵 알림';
    const message = approved ? '회식맵 수정 제안이 승인되었습니다.' : '회식맵 수정 제안이 반려되었습니다.';
    return createMealMapUserNoticeV2515(edit.user_id, title, message, {
      status: approved ? 'success' : 'warning',
      sourceType: 'mealmap_edit',
      sourceId: edit.id,
      payload: { decision, editId: edit.id, name: placeName },
    });
  } catch (err) {
    console.warn('[mealmap edit decision notice warning]', err.message);
    return false;
  }
}
//  user decision notice helpers END =====


// 필기 기출문제 멀티플레이 API + Socket.IO 연결
// ------------------------------------------------------------
// 기존 필기/실기/게시판/FAQ API보다 독립된 /api/multiplayer 경로로만 추가한다.
// 기존 API 경로를 수정하지 않기 때문에 기존 기능과 충돌하지 않는다.
try {
    const multiplayerRouter = createMultiplayerRouter({ pool, io });
    app.use('/api/multiplayer', multiplayerRouter);

    if (io) {
        attachMultiplayerSocket({ io, pool });
    }

    console.log('OK: written multiplayer API mounted at /api/multiplayer');
} catch (multiplayerError) {
    console.error('WARN: written multiplayer API mount failed:', multiplayerError.message);
    console.error('WARN: Existing site will continue running without multiplayer API.');
}




// 실기 오답노트 SQL 테이블 안전 점검
// ----------------------------------------------------------
// 기존 DB를 삭제하거나 초기화하지 않고, 필요한 컬럼만 없을 때 추가함.
// 기존 wgs_wrong_notes 테이블에 subject 컬럼만 없는 경우에도
// 서버 실행 시 자동으로 보완되도록 만들었다.
async function ensureWrongNotesSchema() {
    try {
        // 테이블이 아예 없는 경우를 대비한 안전 생성 코드.
        // 이미 존재하는 테이블은 건드리지 않는다.
        await pool.promise().query(`CREATE TABLE IF NOT EXISTS wgs_wrong_notes (
                id INT NOT NULL AUTO_INCREMENT,
                userId VARCHAR(50) NOT NULL,
                question_id INT NOT NULL,
                source VARCHAR(20) NOT NULL,
                year INT NULL,
                session INT NULL,
                subject VARCHAR(255) NULL,
                savedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            )
        `);

        const [columns] = await pool.promise().query(`SHOW COLUMNS FROM wgs_wrong_notes`);
        const columnNames = new Set(columns.map((col) => col.Field));

        // 예전 스키마에는 source/year/session/subject/savedAt 중 일부가 없을 수 있어서 하나씩 확인 후 추가한다.
        // ALTER는 없는 컬럼에만 실행되므로 기존 데이터는 유지된다.
        if (!columnNames.has('source')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'random'AFTER question_id`);
        }
        if (!columnNames.has('year')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN year INT NULL AFTER source`);
        }
        if (!columnNames.has('session')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN session INT NULL AFTER year`);
        }
        if (!columnNames.has('subject')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN subject VARCHAR(255) NULL AFTER session`);
        }
        if (!columnNames.has('savedAt')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN savedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP`);
        }

        // Duplicate-prevention indexes are optional compatibility helpers.
        // 이미 같은 이름의 인덱스가 있으면 MySQL에서 에러가 나므로 무시한다.
        try {
            await pool.promise().query(`CREATE INDEX idx_wgs_wrong_notes_user_source_qid ON wgs_wrong_notes (userId, source, question_id)`);
        } catch (indexErr) {
            // ER_DUP_KEYNAME: 이미 인덱스가 있는 정상 상황
            if (indexErr.code !== 'ER_DUP_KEYNAME') {
                console.warn('wgs_wrong_notes 인덱스 확인 경고:', indexErr.message);
            }
        }

        console.log('OK: wgs_wrong_notes schema checked');
    } catch (err) {
        // 스키마 보정 실패가 있어도 서버 전체가 죽지 않게 경고만 출력한다.
        // 실제 저장 시 다시 에러가 보이면 터미널 로그를 보고 수정하면 된다.
        console.warn('wgs_wrong_notes schema check warning:', err.message);
    }
}

ensureWrongNotesSchema();

// React 빌드 결과물을 Express가 정적 파일로 제공하도록 함.

// 정보처리기사 실기 API 연결 블록
// ----------------------------------------------------------
// 이 블록은 실기 API만 추가합니다.
// 기존 필기 API는 수정하지 않습니다.
// 이 블록에서 오류가 나도 기본 필기 사이트는 계속 동작합니다.
try {
    const createIpepRouter = require('./ipepRoutes');

    // 관리자 페이지가 사용하는 공개 URL 규칙은 유지하면서 자산은
    // backend/public 안에 보관해 백엔드 묶음으로 배포할 수 있게 합니다.
    const IPEP_IMAGE_DIR = path.join(__dirname, 'public', 'ipep-img');

    // 실기 문제은행 이미지 정적 경로입니다.
    app.use('/ipep-img/random', express.static(path.join(IPEP_IMAGE_DIR, 'random')));

    // 실기 문제은행 이미지 정적 경로입니다.
    app.use('/ipep-img/past', express.static(path.join(IPEP_IMAGE_DIR, 'past')));

    // 실기 API 라우트를 연결합니다.
    app.use('/api/ipep', createIpepRouter(pool));

    console.log('OK: IPEP API mounted at /api/ipep');
} catch (ipepRouteError) {
    console.error('WARN: IPEP API mount failed:', ipepRouteError.message);
    console.error('WARN: Main written-exam site will continue running.');
}

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
    removeActiveUser,
    getActiveUserList,
    sanitizeChatText,
    getValidChatSince,
    getRealtimeChatMessagesAfter,
} = createRealtimeState({ adminUserId: ADMIN_USER_ID });

async function validateRealtimeSession(req) {
    // 일부 관리자 조회 API는 GET(query) 또는 body 없는 요청으로 들어올 수 있다.
    // 기존처럼 req.body.id를 바로 읽으면 body가 undefined인 순간 서버 전체가 종료된다.
    // 그래서 body/query/header를 모두 안전하게 읽는 방식으로 통일한다.
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
//  실제 관리자 API는 서버에서 세션토큰과 관리자 아이디를 다시 검사한다.
// 3) 이 함수는 다음 Step의 사용자 관리/점검모드/전체공지 API에서도 그대로 재사용한다.
async function validateAdminSession(req) {
    // 결재 승인 시 서버 내부에서 실제 CRUD API를 다시 호출한다.
    // 이 내부 호출은 브라우저 세션 토큰이 없으므로, 별도 내부 승인 토큰이 있을 때만 최고관리자 요청으로 인정한다.
    // 일반 브라우저 요청은 아래 validateRealtimeSession 로직을 그대로 통과해야 하므로 기존 로그인/중복로그인/세션만료 기능은 유지된다.
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

    // 로그인 세션 자체가 유효하지 않으면 관리자 여부를 볼 필요 없이 차단한다.
    if (!auth.valid) {
        return { ...auth, ok: false, statusCode: 401, message: '관리자 인증이 필요합니다.', isAdmin: false, isPrimaryAdmin: false, isOperator: false };
    }

    const normalizedUserId = String(auth.user?.id || auth.id || '').trim().toLowerCase();
    const userControl = await getAdminUserControl(normalizedUserId);
    const isPrimaryAdmin = isPrimaryAdminUser(userControl);
    const isOperator = isAdminAccessUser({ ...userControl, id: normalizedUserId });
    const isSuspended = normalizeAdminBool(userControl?.is_suspended);

    // 최고관리자 또는 운영자 권한을 받은 사용자만 관리자 페이지/API를 사용할 수 있다.
    if (!isOperator || isSuspended) {
        return { ...auth, ok: false, statusCode: 403, message: isSuspended ? '임시정지된 계정입니다.' : '관리자 권한이 필요합니다.', valid: false, isAdmin: false, isPrimaryAdmin, isOperator: false, reason: isSuspended ? 'suspended' : 'not_admin' };
    }

    return { ...auth, ok: true, statusCode: 200, message: '관리자 인증 완료', valid: true, isAdmin: true, isPrimaryAdmin, isOperator, reason: null };
}

// 관리자 화면 날짜 포맷 보조 함수
// ------------------------------------------------------------
//  사용자 관리 API에서 최근 로그인/로그아웃 시간을 표시할 때 사용한다.
// 이전 병합 과정에서 이 함수 호출부만 남고 함수 정의가 빠져
// /api/admin/users 호출 시 formatAdminDateTime is not defined 오류가 발생했다.
// 여기서는 기존 DB/로그인 로직은 건드리지 않고, 표시용 문자열 변환만 담당한다.
function formatAdminDateTime(value) {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);

    // MySQL DATETIME 문자열이나 Date 객체가 예상 밖 값이면 화면이 깨지지 않도록 원문 문자열을 반환한다.
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

// 2. 시간/날짜 헬퍼 함수

// 오답노트, 로그인 기록처럼 SQL DATETIME에 넣을 때 쓰는 KST 시간.
function getKSTDateTime() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().replace('T', ' ').slice(0, 19);
}

// 게시판 날짜는 기존 JSON의 문자열 모양을 깨뜨리면 안 돼.
// 예: 2026. 4. 29. AM 9:26:22
function getBoardDateString() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]));
    const dayPeriod = String(parts.dayPeriod || 'AM').toUpperCase();

    return `${parts.year}. ${Number(parts.month)}. ${Number(parts.day)}. ${dayPeriod} ${Number(parts.hour)}:${parts.minute}:${parts.second}`;
}


// 2-1. 공지게시판 새 글 이메일 알림 헬퍼
// - 목적: 최고관리자가 공지게시판에 새 글을 작성하면 가입 회원에게 안내 메일을 보냅니다.
// - 주의: 기존 게시글 저장 로직을 막지 않기 위해 메일 발송은 백그라운드에서 실행합니다.
// - 주의: 공지게시판 판별은 프론트가 보내는 boardType을 우선 사용하고,
//  혹시 구버전 프론트가 접속해도 동작하도록 content의 숨김 마커도 함께 확인합니다.
const BOARD_TYPE_NOTICE = 'notice';
const BOARD_MARKER_NOTICE_FOR_MAIL = '[[UGONGSIL_BOARD:NOTICE]]';
const NOTICE_MAIL_SUBJECT = '우공실 사이트 공지';

// .env에 PUBLIC_SITE_URL을 넣으면 운영/로컬 주소를 쉽게 바꿀 수 있습니다.
// 예: PUBLIC_SITE_URL=http://www.woogongsil.kro.kr/
function getPublicSiteUrl() {
    return process.env.PUBLIC_SITE_URL || 'https://www.woogongsil.co.kr/';
}

// 프론트의 boardType 또는 content 숨김 마커를 이용해 공지게시판 작성글인지 확인합니다.
function isNoticeBoardCreateRequest(boardType, content) {
    const normalizedBoardType = String(boardType || '').trim().toLowerCase();
    const contentText = String(content || '');

    if (normalizedBoardType === BOARD_TYPE_NOTICE) return true;
    return contentText.includes(BOARD_MARKER_NOTICE_FOR_MAIL);
}

// 메일 본문을 사용자 이름별로 만듭니다.
// 요청사항: 문장마다 빈 줄을 두어 줄간격 없이 붙어 보이지 않도록 구성합니다.
function buildNoticePostMailText(userName) {
    const safeName = String(userName || '').trim() || '회원';

    return [
        `안녕하세요, ${safeName}님!`,
        '',
        '정보처리기사 스터디 [ SKN29th_우공실]에 새로운 공지글이 작성되었습니다.',
        '',
        '확인해주시면 감사합니다!',
        '',
        `홈페이지 바로가기 : ${getPublicSiteUrl()}`
    ].join('\n');
}

// 가입 회원 중 이메일이 있는 사용자만 가져옵니다.
// - 관리자 본인에게 다시 보내지 않도록 authorId는 제외합니다.
// - 같은 이메일이 여러 계정에 중복 저장되어 있으면 1번만 발송합니다.
async function getNoticeMailRecipients(authorId) {
    const [rows] = await pool.query(
        `SELECT id, name, email
         FROM wgs_users
         WHERE email IS NOT NULL
           AND TRIM(email) <> '' AND id <>?
         ORDER BY created_at ASC, id ASC`,
        [authorId]
    );

    const uniqueRecipients = [];
    const seenEmails = new Set();

    for (const row of rows) {
        const email = String(row.email || '').trim().toLowerCase();

        // 매우 기본적인 이메일 형식만 통과시켜 SMTP 오류 가능성을 줄입니다.
        if (!email || !email.includes('@')) continue;
        if (seenEmails.has(email)) continue;

        seenEmails.add(email);
        uniqueRecipients.push({
            id: row.id,
            name: row.name || row.id || '회원',
            email
        });
    }

    return uniqueRecipients;
}

// 실제 공지 메일을 순차 발송합니다.
// - Gmail SMTP는 짧은 시간에 너무 많은 메일을 보내면 제한될 수 있어 0.2초 간격을 둡니다.
// - 일부 사용자에게 실패해도 나머지 사용자 발송은 계속 진행합니다.
async function sendNoticePostEmailsInBackground({ authorId, postId, title }) {
    const recipients = await getNoticeMailRecipients(authorId);

    if (recipients.length === 0) {
        console.log(`[공지메일] 수신 대상 없음: postId=${postId}, title=${title}`);
        return;
    }

    let successCount = 0;
    let failCount = 0;

    console.log(`[공지메일] 발송 시작: postId=${postId}, 대상=${recipients.length}명`);

    for (const recipient of recipients) {
        const result = await sendEmail(
            recipient.email,
            NOTICE_MAIL_SUBJECT,
            buildNoticePostMailText(recipient.name)
        );

        if (result.success) successCount += 1;
        else failCount += 1;

        // SMTP 발송 제한을 피하기 위한 짧은 대기입니다.
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[공지메일] 발송 완료: postId=${postId}, 성공=${successCount}명, 실패=${failCount}명`);
}

// MySQL DATE 타입을 프론트가 쓰기 쉬운 YYYY-MM-DD 문자열로 변환해.
function formatDateOnly(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        if (value.includes('T')) return value.slice(0, 10);
        return value.slice(0, 10);
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return String(value).slice(0, 10);
}

// JSON에 저장된 ISO 시간, MySQL 시간, 기존 한국식 문자열을 SQL DATETIME 문자열로 최대한 안전하게 바꿔.
function normalizeToMysqlDateTime(value) {
    if (!value) return getKSTDateTime();

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
        return kst.toISOString().replace('T', ' ').slice(0, 19);
    }

    const text = String(value).trim();

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;

    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
        const date = new Date(text);
        if (!Number.isNaN(date.getTime())) {
            const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
            return kst.toISOString().replace('T', ' ').slice(0, 19);
        }
    }

    const legacyMatch = text.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(AM|PM|오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})$/i);
    if (legacyMatch) {
        let [, year, month, day, period, hour, minute, second] = legacyMatch;
        let h = Number(hour);
        const upperPeriod = period.toUpperCase();

        if ((upperPeriod === 'PM' || period === '오후') && h < 12) h += 12;
        if ((upperPeriod === 'AM' || period === '오전') && h === 12) h = 0;

        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(h).padStart(2, '0')}:${minute}:${second}`;
    }

    return getKSTDateTime();
}

// 랭킹 24시간 날짜 계산 유틸
// - 기준: 서버 로컬 시간
// - 운영 시간: 00:00:00 ~ 23:59:59, 프리시즌 없이 항상 랭킹 반영
// - 날짜 포맷은 기존 DB/JSON 파일과 호환되도록 2026-5-10 형태를 유지합니다.
// - 함수명(getSeasonStatus)은 기존 호출부 호환을 위해 유지하지만,
//  이제 season 개념은 쓰지 않고 하루 단위 daily 랭킹으로만 동작합니다.
function getLocalTimeParts() {
    const now = new Date();
    return {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds()
    };
}

function getSeasonStatus() {
    const local = getLocalTimeParts();

    return {
        isRegular: true,
        rankingDate: `${local.year}-${local.month}-${local.day}`,
        season: 'daily'
    };
}
// 3. DB 스키마 호환성 보정
// - 핵심: 게시판 날짜는 DATETIME이 아니라 VARCHAR여야 기존 문자열이 안 깨져.
// - 핵심: noticeOrder 컬럼은 이미 있으면 ALTER ADD를 실행하지 않아
//  Duplicate column name 경고가 터미널에 반복 출력되지 않게 한다.
async function ensureSchemaCompatibility() {
    // 컬럼 존재 여부 확인 함수
    // - INFORMATION_SCHEMA를 조회해서 현재 접속 DB 안에 특정 컬럼이 있는지 확인합니다.
    // - 이렇게 확인한 뒤 ALTER ADD를 실행하면 Duplicate column name 경고를 없앨 수 있습니다.
    const columnExists = async (tableName, columnName) => {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
            `,
            [tableName, columnName]
        );

        return Number(rows?.[0]?.cnt || 0) >0;
    };

    // 기존 문자열 날짜 데이터 보호
    // - 기존 게시판/댓글/대댓글 날짜가 문자열 포맷으로 들어가 있으므로 VARCHAR로 유지합니다.
    // - 이미 VARCHAR인 경우에도 MODIFY는 안전하게 통과합니다.
    const modifyQueries = [
        'ALTER TABLE wgs_posts MODIFY COLUMN date VARCHAR(50) DEFAULT NULL',
        'ALTER TABLE wgs_comments MODIFY COLUMN date VARCHAR(50) DEFAULT NULL',
        'ALTER TABLE wgs_replies MODIFY COLUMN date VARCHAR(50) DEFAULT NULL'
    ];

    for (const query of modifyQueries) {
        try {
            await pool.query(query);
        } catch (error) {
            console.warn('스키마 보정 건너뜀:', error.message);
        }
    }

    // 공지 수동 정렬용 컬럼 보정
    // - 이미 noticeOrder가 있으면 아무 작업도 하지 않습니다.
    // - 없을 때만 ALTER TABLE ADD COLUMN을 실행합니다.
    try {
        const hasNoticeOrder = await columnExists('wgs_posts', 'noticeOrder');

        if (!hasNoticeOrder) {
            await pool.query('ALTER TABLE wgs_posts ADD COLUMN noticeOrder INT DEFAULT NULL');
            console.log('OK: wgs_posts.noticeOrder column added');
        } else {
            console.log('OK: wgs_posts.noticeOrder column exists');
        }
    } catch (error) {
        console.warn('noticeOrder 컬럼 보정 건너뜀:', error.message);
    }

    // 기존 공지 중 noticeOrder가 비어 있는 데이터에 기본 순서를 채웁니다.
    // - 관리자가 직접 공지 순서를 저장하기 전까지는 기존처럼 최신 공지가 위에 오도록 id 기준으로 부여합니다.
    // - 이미 순서가 저장된 공지는 건드리지 않으므로 관리자 정렬값이 덮어써지지 않습니다.
    try {
        const [noticeRows] = await pool.query(
            'SELECT id FROM wgs_posts WHERE isNotice = 1 AND noticeOrder IS NULL ORDER BY CAST(id AS UNSIGNED) DESC, id DESC'
        );

        for (let i = 0; i < noticeRows.length; i += 1) {
            await pool.query('UPDATE wgs_posts SET noticeOrder = ? WHERE id = ?', [i + 1, noticeRows[i].id]);
        }

        console.log('OK: wgs_posts.noticeOrder default order checked');
    } catch (error) {
        console.warn('공지 순서 기본값 보정 건너뜀:', error.message);
    }

    //  화면 설정 관리 테이블 보정
    // - 기존 기능 DB 구조를 건드리지 않고 관리자 화면 설정 CRUD 전용 테이블만 추가합니다.
    // - CREATE TABLE IF NOT EXISTS 방식이라 로컬/AWS 어디서 실행해도 반복 실행이 안전합니다.
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS wgs_screen_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                page_key VARCHAR(50) NOT NULL,
                section_key VARCHAR(80) NOT NULL DEFAULT 'common',
                setting_type VARCHAR(30) NOT NULL DEFAULT 'text',
                setting_key VARCHAR(100) NOT NULL,
                setting_label VARCHAR(150) NOT NULL,
                setting_value TEXT NULL,
                description TEXT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by VARCHAR(50) NULL,
                updated_by VARCHAR(50) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_wgs_screen_page (page_key),
                INDEX idx_wgs_screen_type (setting_type),
                INDEX idx_wgs_screen_active (is_active),
                UNIQUE KEY uk_wgs_screen_setting (page_key, section_key, setting_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query(`INSERT IGNORE INTO wgs_screen_settings
                (page_key, section_key, setting_type, setting_key, setting_label, setting_value, description, sort_order, created_by, updated_by)
            VALUES
                ('all', 'global', 'text', 'site_title', '전체 사이트명', 'SKN29th_우공실', '헤더와 공통 영역에서 사용할 수 있는 사이트명입니다.', 1, 'system', 'system'),
                ('home', 'hero', 'text', 'hero_title', '홈 메인 제목', 'SKN29th_우공실', '홈 화면 메인 영역에 사용할 제목 문구입니다.', 10, 'system', 'system'),
                ('home', 'hero', 'text', 'hero_desc', '홈 메인 설명 문구', '정보처리기사 필기·실기 학습과 오답 관리를 한 화면에서 이용할 수 있습니다.', '홈 상단 메인 배너에 표시되는 설명 문구입니다. 관리자 페이지에서 수정하면 홈 화면에 반영됩니다.', 20, 'system', 'system'),
                ('exam', 'layout', 'layout', 'question_card_width', '문제 카드 너비', '100%', '시험/연습 화면 문제 카드의 기본 너비 값입니다.', 30, 'system', 'system'),
                ('admin', 'theme', 'color', 'accent_color', '관리자 강조 색상', '#38bdf8', '관리자 화면에서 참고할 강조 색상 값입니다.', 40, 'system', 'system'),
                ('all', 'image', 'image', 'default_banner', '공통 배너 이미지 경로', '', '각 페이지에서 공통으로 사용할 수 있는 배너 이미지 URL 또는 public 기준 경로입니다.', 50, 'system', 'system')
        `);

        // 홈 상단 설명 문구는 관리자 > 화면 설정 관리에서 관리합니다.
        // 예전 기본 문장만 자동 갱신하고, 관리자가 직접 수정한 문구는 유지합니다.
        await pool.query(
            `UPDATE wgs_screen_settings
                SET setting_value = ?,
                    setting_label = ?,
                    description = ?,
                    updated_by = 'system' WHERE page_key = 'home' AND section_key = 'hero' AND setting_key = 'hero_desc' AND setting_value IN (?, ?, ?, ?)`,
            [
                '정보처리기사 필기·실기 학습과 오답 관리를 한 화면에서 이용할 수 있습니다.',
                '홈 메인 설명 문구',
                '홈 상단 메인 배너에 표시되는 설명 문구입니다. 관리자 페이지에서 수정하면 홈 화면에 반영됩니다.',
                '정보처리기사 필기/실기 문제를 연습하고 오답을 관리합니다.',
                '정보처리기사 필기/실기 문제를 연습하고 모험을 떠나보세요.',
                '정보처리기사 필기/실기 문제를 연습하고 오답 관리를 할 수 있습니다.',
                '정보처리기사 필기/실기 문제를 연습하고 오답을 관리합니다'
            ]
        );

        // 값이 이미 수정되었더라도 관리자 라벨과 도움말 문구는 일관되게 유지합니다.
        await pool.query(
            `UPDATE wgs_screen_settings
                SET setting_label = ?,
                    description = ?
              WHERE page_key = 'home' AND section_key = 'hero' AND setting_key = 'hero_desc'`,
            ['홈 메인 설명 문구', '홈 상단 메인 배너에 표시되는 설명 문구입니다. 관리자 페이지에서 수정하면 홈 화면에 반영됩니다.']
        );


        // 홈 화면에 보이는 문구/링크 기본값을 관리자 화면 설정 DB에 안전하게 등록합니다.
        // - page_key='home', section_key + setting_key 조합으로 저장해 useScreenSettings('home')의 getSetting('section.key')와 맞춥니다.
        // - INSERT IGNORE를 사용해 기존 관리자가 수정한 setting_value는 덮어쓰지 않습니다.
        // - 이후 UPDATE는 관리자 목록에서 보이는 이름/설명/정렬만 보정하고 실제 문구값은 유지합니다.
        const homeScreenDefaultRowsFix18V9 = [
            ['home', 'hero', 'text', 'hero_title', '홈 메인 제목', '정보 처리 기사', '홈 상단 배너의 큰 제목입니다.', 100],
            ['home', 'hero', 'text', 'hero_desc', '홈 메인 안내문', '정보처리기사 필기·실기 학습과 오답 관리를 한 화면에서 이용할 수 있습니다.', '홈 상단 배너 제목 아래 안내문입니다.', 110],
            ['home', 'image', 'image', 'default_banner', '홈 기본 배너 이미지', '', '홈 배너 배경 이미지 경로입니다. 예: /images/home-banner.png', 120],
            ['home', 'quick_links', 'text', 'exam_button_label', '시험 접수 버튼 문구', '시험 접수', '홈 배너 하단 시험 접수 버튼에 표시됩니다.', 200],
            ['home', 'quick_links', 'link', 'exam_button_url', '시험 접수 버튼 링크', 'https://www.q-net.or.kr', '시험 접수 버튼을 눌렀을 때 이동할 주소입니다.', 201],
            ['home', 'quick_links', 'text', 'notion_button_label', 'Notion 버튼 문구', 'Notion', '홈 배너 하단 Notion 버튼에 표시됩니다.', 210],
            ['home', 'quick_links', 'link', 'notion_button_url', 'Notion 버튼 링크', '#', 'Notion 버튼을 눌렀을 때 이동할 주소입니다.', 211],
            ['home', 'quick_links', 'text', 'developer_button_label', '개발자 버튼 문구', '개발자', '홈 배너 하단 개발자 버튼에 표시됩니다.', 220],
            ['home', 'quick_links', 'link', 'developer_button_url', '개발자 버튼 링크', '#', '개발자 버튼을 눌렀을 때 이동할 주소입니다.', 221],
            ['home', 'quick_links', 'text', 'mobile_button_label', '모바일 버튼 문구', '모바일', '홈 배너 하단 모바일 접속 버튼에 표시됩니다.', 230],
            ['home', 'hero', 'text', 'welcome_prefix', '환영 문구 앞부분', '', '로그인 사용자의 이름 앞에 붙는 문구입니다.', 300],
            ['home', 'hero', 'text', 'welcome_suffix', '환영 문구 뒷부분', '님, 환영합니다!', '로그인 사용자 이름 뒤에 붙는 문구입니다.', 301],
            ['home', 'hero', 'text', 'dday_prefix', 'D-Day 문구 앞부분', '시험일까지', 'D-Day 값 앞에 붙는 문구입니다.', 310],
            ['home', 'hero', 'text', 'dday_suffix', 'D-Day 문구 뒷부분', '!', 'D-Day 값 뒤에 붙는 문구입니다.', 311],
            ['home', 'hero', 'text', 'today_class_prefix', '오늘 수업 문구 앞부분', '오늘은', '오늘 수업명 앞에 붙는 문구입니다.', 320],
            ['home', 'hero', 'text', 'today_class_suffix', '오늘 수업 문구 뒷부분', '수업입니다!', '오늘 수업명 뒤에 붙는 문구입니다.', 321],
            ['home', 'live_chat', 'text', 'current_visitor_prefix', '현재 접속자 앞부분', '현재', '실시간 접속자 수 앞에 붙는 문구입니다.', 430],
            ['home', 'live_chat', 'text', 'current_visitor_suffix', '현재 접속자 뒷부분', '명', '실시간 접속자 수 뒤에 붙는 문구입니다.', 431],
            ['home', 'live_chat', 'text', 'refresh_loading_label', '새로고침 진행 문구', '새로고침 중...', '접속자 목록을 새로고침하는 동안 보이는 문구입니다.', 432],
            ['home', 'live_chat', 'text', 'request_time_label', '요청 시간 문구', '요청 시간:', '접속자 목록 요청 시간 앞에 붙는 문구입니다.', 433],
            ['home', 'live_chat', 'text', 'me_label', '내 계정 표시 문구', '(나)', '접속자/채팅 목록에서 내 계정 옆에 보이는 문구입니다.', 434],
            ['home', 'live_chat', 'text', 'recent_activity_label', '최근 활동 문구', '최근 활동', '접속자 목록 최근 활동 시간 앞에 붙는 문구입니다.', 435],
            ['home', 'live_chat', 'text', 'just_now_label', '방금 전 문구', '방금 전', '최근 활동 시간을 해석할 수 없거나 비어 있을 때 보이는 문구입니다.', 436],
            ['home', 'score_ranking', 'text', 'accuracy_label', '정답률 문구', '정답률', '랭킹 카드 정답률 앞에 붙는 문구입니다.', 850],
            ['home', 'score_ranking', 'text', 'rank_suffix', '순위 단위 문구', '등', '랭킹 순위 숫자 뒤에 붙는 문구입니다.', 851],
            ['home', 'score_ranking', 'text', 'score_suffix', '점수 단위 문구', '점', '랭킹 점수 숫자 뒤에 붙는 문구입니다.', 852],
            ['home', 'score_ranking', 'text', 'no_personal_ranking_message', '개인 랭킹 없음 문구', '아직 응시 기록이 없습니다. 문제를 풀고 랭킹에 도전해보세요!', '나의 실시간 랭킹 데이터가 없을 때 보이는 문구입니다.', 853],
            ['home', 'live_chat', 'text', 'section_title', '실시간 영역 제목', '실시간 접속자 & 채팅', '홈 실시간 접속자/채팅 영역 제목입니다.', 400],
            ['home', 'live_chat', 'text', 'section_desc', '실시간 영역 설명', '접속자 목록은 새로고침 버튼을 눌렀을 때 갱신되고, 채팅은 실시간으로 로그인 중인 사용자들끼리 채팅 할 수 있습니다.', '홈 실시간 접속자/채팅 영역 설명입니다.', 401],
            ['home', 'live_chat', 'text', 'visitors_title', '접속자 목록 제목', '접속자 목록', '실시간 접속자 목록 카드 제목입니다.', 410],
            ['home', 'live_chat', 'text', 'refresh_button_label', '새로고침 버튼 문구', '새로고침', '접속자 목록 새로고침 버튼 문구입니다.', 411],
            ['home', 'live_chat', 'text', 'visitors_request_empty', '요청 시간 없음 문구', '요청 시간: 아직 없음', '접속자 목록을 아직 새로고침하지 않았을 때 보이는 문구입니다.', 412],
            ['home', 'live_chat', 'text', 'visitors_recent_desc', '최근 접속 설명', '최근 1분 이내 접속이 확인된 사용자만 표시됩니다.', '접속자 목록 아래 설명 문구입니다.', 413],
            ['home', 'live_chat', 'text', 'visitors_empty_box', '접속자 없음 안내', '새로고침 버튼을 누르면 현재 접속자를 확인할 수 있습니다.', '접속자 목록이 비어 있을 때 보이는 문구입니다.', 414],
            ['home', 'live_chat', 'text', 'chat_title', '채팅 카드 제목', '실시간 채팅', '홈 채팅 카드 제목입니다.', 420],
            ['home', 'live_chat', 'text', 'popup_button_label', '채팅 팝업 버튼 문구', '팝업창', '채팅 팝업 버튼 문구입니다.', 421],
            ['home', 'live_chat', 'text', 'chat_auto_label', '채팅 자동 갱신 문구', '자동 갱신 시간:', '채팅 자동 갱신 시간 앞에 붙는 문구입니다.', 422],
            ['home', 'live_chat', 'text', 'chat_reset_notice', '채팅 초기화 안내', '로그아웃 후 다시 로그인하면 내 화면의 채팅창만 빈 상태로 시작됩니다.', '채팅 카드 하단 안내 문구입니다.', 423],
            ['home', 'live_chat', 'text', 'chat_empty_message', '채팅 없음 문구', '아직 표시할 채팅이 없습니다.', '채팅 메시지가 없을 때 보이는 문구입니다.', 424],
            ['home', 'live_chat', 'text', 'chat_input_placeholder', '채팅 입력창 안내', '채팅 내용을 입력하세요.', '채팅 입력창 placeholder입니다.', 425],
            ['home', 'live_chat', 'text', 'chat_send_button_label', '채팅 전송 버튼 문구', '전송', '채팅 전송 버튼 문구입니다.', 426],
            ['home', 'chat_popup', 'text', 'window_title', '채팅 팝업 브라우저 제목', '우공실 실시간 채팅', '채팅 팝업창의 브라우저 제목입니다.', 500],
            ['home', 'chat_popup', 'text', 'heading_title', '채팅 팝업 화면 제목', '우공실 실시간 채팅', '채팅 팝업창 상단 제목입니다.', 501],
            ['home', 'chat_popup', 'text', 'close_button_label', '닫기 버튼 문구', '닫기', '채팅 팝업창 닫기 버튼 문구입니다.', 502],
            ['home', 'chat_popup', 'text', 'not_refreshed_label', '아직 없음 문구', '아직 없음', '채팅 팝업 자동 갱신 시간이 아직 없을 때 보이는 문구입니다.', 503],
            ['home', 'chat_popup', 'text', 'keep_notice', '팝업 유지 안내', '이 팝업창은 사이트의 다른 페이지로 이동해도 유지됩니다. 브라우저 창처럼 위치와 크기를 조절할 수 있습니다.', '채팅 팝업 안내 문구입니다.', 504],
            ['home', 'chat_popup', 'text', 'loading_message', '채팅 로딩 문구', '채팅을 불러오는 중입니다.', '채팅 팝업 메시지 로딩 문구입니다.', 505],
            ['home', 'chat_popup', 'text', 'tool_title', '채팅 도구 버튼 설명', '이모지/스티커/GIF 열기', '채팅 팝업 도구 버튼 title 문구입니다.', 506],
            ['home', 'mobile_qr', 'text', 'title', '모바일 접속 팝업 제목', '모바일에서 접속하기', '모바일 QR 팝업 제목입니다.', 600],
            ['home', 'mobile_qr', 'text', 'desc', '모바일 접속 팝업 설명', 'PC와 동일한 네트워크 환경에 연결되어 있어야 합니다.', '모바일 QR 팝업 설명입니다.', 601],
            ['home', 'mobile_qr', 'text', 'url_label', '접속 주소 문구', '접속 주소:', '모바일 QR 팝업 접속 주소 앞 문구입니다.', 602],
            ['home', 'mobile_qr', 'text', 'detected_ip_label', '자동 감지 IP 문구', '자동 감지 IP:', '모바일 QR 팝업 자동 감지 IP 앞 문구입니다.', 603],
            ['home', 'mobile_qr', 'text', 'detecting_label', '확인 중 문구', '확인 중', '자동 감지 IP 확인 중일 때 보이는 문구입니다.', 604],
            ['home', 'mobile_qr', 'text', 'wifi_hint', '같은 와이파이 안내', '같은 와이파이에 연결된 휴대폰에서만 접속할 수 있습니다.', '모바일 QR 팝업 와이파이 안내 문구입니다.', 605],
            ['home', 'mobile_qr', 'text', 'change_label', '주소 변경 문구', '주소 변경:', '모바일 QR 팝업 주소 변경 입력창 앞 문구입니다.', 606],
            ['home', 'mobile_qr', 'text', 'placeholder', '주소 입력 안내', '자동 감지 중', '모바일 QR 팝업 주소 입력창 placeholder입니다.', 607],
            ['home', 'calendar', 'text', 'year_suffix', '달력 연도 단위', '년', '홈 달력 제목의 연도 뒤에 붙는 문구입니다.', 700],
            ['home', 'calendar', 'text', 'month_suffix', '달력 월 단위', '월', '홈 달력 제목의 월 뒤에 붙는 문구입니다.', 701],
            ['home', 'calendar', 'text', 'today_label', '오늘 버튼 문구', 'Today', '홈 달력 오늘 버튼 문구입니다.', 702],
            ['home', 'calendar', 'text', 'weekday_sun', '일요일 표시', '일', '홈 달력 일요일 헤더 문구입니다.', 710],
            ['home', 'calendar', 'text', 'weekday_mon', '월요일 표시', '월', '홈 달력 월요일 헤더 문구입니다.', 711],
            ['home', 'calendar', 'text', 'weekday_tue', '화요일 표시', '화', '홈 달력 화요일 헤더 문구입니다.', 712],
            ['home', 'calendar', 'text', 'weekday_wed', '수요일 표시', '수', '홈 달력 수요일 헤더 문구입니다.', 713],
            ['home', 'calendar', 'text', 'weekday_thu', '목요일 표시', '목', '홈 달력 목요일 헤더 문구입니다.', 714],
            ['home', 'calendar', 'text', 'weekday_fri', '금요일 표시', '금', '홈 달력 금요일 헤더 문구입니다.', 715],
            ['home', 'calendar', 'text', 'weekday_sat', '토요일 표시', '토', '홈 달력 토요일 헤더 문구입니다.', 716],
            ['home', 'score_ranking', 'text', 'section_title', '랭킹 영역 제목', '나의 점수는?', '홈 랭킹 영역 제목입니다.', 800],
            ['home', 'score_ranking', 'text', 'always_open_label', '랭킹 항상 펼침 문구', '항상 펼침', '홈 랭킹 영역 오른쪽 상태 문구입니다.', 801],
            ['home', 'score_ranking', 'text', 'tab_random_label', '필기 문제은행 탭 문구', '필기 문제은행', '홈 랭킹 필기 문제은행 탭 문구입니다.', 810],
            ['home', 'score_ranking', 'text', 'tab_past_label', '필기 기출문제 탭 문구', '필기 기출문제', '홈 랭킹 필기 기출문제 탭 문구입니다.', 811],
            ['home', 'score_ranking', 'text', 'tab_ipep_random_label', '실기 문제은행 탭 문구', '실기 문제은행', '홈 랭킹 실기 문제은행 탭 문구입니다.', 812],
            ['home', 'score_ranking', 'text', 'tab_ipep_past_label', '실기 기출문제 탭 문구', '실기 기출문제', '홈 랭킹 실기 기출문제 탭 문구입니다.', 813],
            ['home', 'score_ranking', 'text', 'year_select_title', '연도 선택 제목', '연도 선택', '기출 랭킹 연도 선택 제목입니다.', 820],
            ['home', 'score_ranking', 'text', 'session_select_title', '회차 선택 제목', '회차 선택', '기출 랭킹 회차 선택 제목입니다.', 821],
            ['home', 'score_ranking', 'text', 'need_select_message', '연도/회차 선택 안내', '연도와 회차를 선택해 주세요.', '기출 랭킹에서 연도/회차 선택 전 보이는 문구입니다.', 822],
            ['home', 'score_ranking', 'text', 'top_title_prefix', 'Top3 제목 앞부분', '오늘의', '랭킹 Top3 제목 앞부분입니다.', 830],
            ['home', 'score_ranking', 'text', 'top_title_suffix', 'Top3 제목 뒷부분', 'Top 3', '랭킹 Top3 제목 뒷부분입니다.', 831],
            ['home', 'score_ranking', 'text', 'season_text', '랭킹 기간 문구', '24시간 랭킹 (00:00 ~ 23:59)', '랭킹 기간 안내 문구입니다.', 832],
            ['home', 'score_ranking', 'text', 'no_data_message', '랭킹 데이터 없음 문구', '등록된 랭킹 데이터가 없습니다. 순위권에 도전해보세요!', '랭킹 데이터가 없을 때 보이는 문구입니다.', 840],
            ['home', 'score_ranking', 'text', 'my_ranking_title', '나의 실시간 랭킹 제목', '나의 실시간 랭킹', '나의 실시간 랭킹 카드 제목입니다.', 841],
            ['home', 'ranking_history', 'text', 'title_prefix', '개인 히스토리 제목 앞부분', '개인', '랭킹 히스토리 제목의 기본 앞부분입니다.', 900],
            ['home', 'ranking_history', 'text', 'title_suffix', '히스토리 제목 뒷부분', '랭킹 히스토리', '랭킹 히스토리 제목 뒷부분입니다.', 901],
            ['home', 'ranking_history', 'text', 'desc_my', '내 히스토리 설명', '날짜와 문제 유형을 선택하면 내 점수와 정답률 변화를 확인할 수 있습니다.', '내 랭킹 히스토리 설명 문구입니다.', 902],
            ['home', 'ranking_history', 'text', 'desc_target', '사용자 히스토리 설명', '날짜와 문제 유형을 선택하면 해당 사용자의 점수와 정답률 변화를 확인할 수 있습니다.', '관리자/조회 대상 히스토리 설명 문구입니다.', 903],
            ['home', 'ranking_history', 'text', 'start_date_label', '시작일 문구', '시작일', '랭킹 히스토리 시작일 라벨입니다.', 910],
            ['home', 'ranking_history', 'text', 'end_date_label', '종료일 문구', '종료일', '랭킹 히스토리 종료일 라벨입니다.', 911],
            ['home', 'ranking_history', 'text', 'type_label', '문제 유형 문구', '문제 유형', '랭킹 히스토리 문제 유형 라벨입니다.', 912],
            ['home', 'ranking_history', 'text', 'query_button_label', '조회 버튼 문구', '조회하기', '랭킹 히스토리 조회 버튼 문구입니다.', 913],
            ['home', 'ranking_history', 'text', 'query_loading_label', '조회중 문구', '조회중...', '랭킹 히스토리 조회 중 버튼 문구입니다.', 914],
            ['home', 'ranking_history', 'text', 'score_label', '점수 문구', '점수', '랭킹 히스토리 점수 요약 라벨입니다.', 920],
            ['home', 'ranking_history', 'text', 'accuracy_label', '정답률 문구', '정답률', '랭킹 히스토리 정답률 요약 라벨입니다.', 921],
            ['home', 'ranking_history', 'text', 'record_days_label', '기록일 문구', '기록일', '랭킹 히스토리 기록일 요약 라벨입니다.', 922],
            ['home', 'ranking_history', 'text', 'day_suffix', '일 단위 문구', '일', '랭킹 히스토리 기록일 숫자 뒤에 붙는 문구입니다.', 923],
            ['home', 'ranking_history', 'text', 'score_unit', '점수 단위 문구', '점', '랭킹 히스토리 점수 숫자 뒤에 붙는 문구입니다.', 924],
            ['home', 'ranking_history', 'text', 'type_random_label', '히스토리 필기 문제은행 옵션', '필기 문제은행', '랭킹 히스토리 문제 유형 필기 문제은행 옵션 문구입니다.', 925],
            ['home', 'ranking_history', 'text', 'type_past_label', '히스토리 필기 기출문제 옵션', '필기 기출문제', '랭킹 히스토리 문제 유형 필기 기출문제 옵션 문구입니다.', 926],
            ['home', 'ranking_history', 'text', 'type_ipep_random_label', '히스토리 실기 문제은행 옵션', '실기 문제은행', '랭킹 히스토리 문제 유형 실기 문제은행 옵션 문구입니다.', 927],
            ['home', 'ranking_history', 'text', 'type_ipep_past_label', '히스토리 실기 기출문제 옵션', '실기 기출문제', '랭킹 히스토리 문제 유형 실기 기출문제 옵션 문구입니다.', 928],
            ['home', 'ranking_history', 'text', 'metric_score_label', '히스토리 점수 탭 문구', '점수', '랭킹 히스토리 점수 탭 문구입니다.', 929],
            ['home', 'ranking_history', 'text', 'metric_accuracy_label', '히스토리 정답률 탭 문구', '정답률', '랭킹 히스토리 정답률 탭 문구입니다.', 930],
            ['home', 'ranking_history', 'text', 'period_daily_label', '히스토리 일별 탭 문구', '일별', '랭킹 히스토리 일별 탭 문구입니다.', 931],
            ['home', 'ranking_history', 'text', 'period_weekly_label', '히스토리 주별 탭 문구', '주별', '랭킹 히스토리 주별 탭 문구입니다.', 932],
            ['home', 'ranking_history', 'text', 'period_monthly_label', '히스토리 월별 탭 문구', '월별', '랭킹 히스토리 월별 탭 문구입니다.', 933],
            ['home', 'ranking_history', 'text', 'date_invalid_message', '날짜 오류 문구', '날짜 형식이 올바르지 않습니다.', '랭킹 히스토리 날짜 형식 오류 문구입니다.', 930],
            ['home', 'ranking_history', 'text', 'date_range_message', '날짜 범위 오류 문구', '시작일은 종료일보다 늦을 수 없습니다.', '랭킹 히스토리 날짜 범위 오류 문구입니다.', 931],
            ['home', 'ranking_history', 'text', 'load_failed_message', '히스토리 불러오기 실패 문구', '랭킹 기록을 불러오지 못했습니다. 로그인 정보를 다시 확인해주세요.', '랭킹 히스토리 불러오기 실패 문구입니다.', 932],
        ];

        for (const [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder] of homeScreenDefaultRowsFix18V9) {
            await pool.query(
                `INSERT IGNORE INTO wgs_screen_settings
                    (page_key, section_key, setting_type, setting_key, setting_label, setting_value,
                     description, sort_order, is_active, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'system', 'system')`,
                [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder]
            );

            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_type = ?, setting_label = ?, description = ?, sort_order = ?, is_active = 1, updated_by = 'system' WHERE page_key = ? AND section_key = ? AND setting_key = ?`,
                [settingType, settingLabel, description, sortOrder, pageKey, sectionKey, settingKey]
            );
        }

        // Public-facing home defaults no longer use decorative emoji.
        // Existing admin-edited values are preserved; only the previous built-in defaults are cleaned.
        const homeScreenEmojiCleanupRows = [
            ['quick_links', 'exam_button_label', '\u{1F4DD} 시험 접수', '시험 접수'],
            ['quick_links', 'notion_button_label', '\u{1F4D3} Notion', 'Notion'],
            ['quick_links', 'developer_button_label', '\u{1F9D1}\u200D\u{1F4BB} 개발자', '개발자'],
            ['quick_links', 'mobile_button_label', '\u{1F4F1} 모바일', '모바일'],
            ['hero', 'welcome_prefix', '\u{1F389}', ''],
            ['hero', 'dday_prefix', '\u{1F525} 시험일까지', '시험일까지'],
            ['hero', 'today_class_prefix', '\u{1F4C5} 오늘은', '오늘은'],
            ['mobile_qr', 'title', '\u{1F4F1} 모바일에서 접속하기', '모바일에서 접속하기'],
            ['score_ranking', 'section_title', '\u{1F3C6} 나의 점수는?', '나의 점수는?'],
            ['score_ranking', 'year_select_title', '\u{1F4C5} 연도 선택', '연도 선택'],
            ['score_ranking', 'session_select_title', '\u{1F4DD} 회차 선택', '회차 선택'],
            ['score_ranking', 'top_title_prefix', '\u{1F525} 오늘의', '오늘의'],
            ['score_ranking', 'season_text', '\u{1F4C5} 24시간 랭킹 (00:00 ~ 23:59)', '24시간 랭킹 (00:00 ~ 23:59)'],
            ['score_ranking', 'my_ranking_title', '\u{1F464} 나의 실시간 랭킹', '나의 실시간 랭킹'],
            ['ranking_history', 'metric_score_label', '\u25A0 점수', '점수'],
            ['ranking_history', 'metric_accuracy_label', '\u25CF 정답률', '정답률'],
        ];

        for (const [sectionKey, settingKey, oldValue, newValue] of homeScreenEmojiCleanupRows) {
            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_value = ?,
                        updated_by = 'system' WHERE page_key = 'home' AND section_key = ?
                    AND setting_key = ?
                    AND setting_value = ?`,
                [newValue, sectionKey, settingKey, oldValue]
            );
        }


        // 이전 v8 패치에서 page_key='home' / section_key='copy'로 등록했던 세부 문구는
        // 실제 화면에서는 hero/live_chat/score_ranking 섹션으로 이관했습니다.
        // 기존 DB 값은 삭제하지 않고 비활성화만 하여 관리자 목록이 헷갈리지 않도록 정리합니다.
        const legacyHomeCopyKeysFix18Cleanup = [
            'welcome_prefix', 'welcome_suffix', 'dday_prefix', 'dday_suffix',
            'today_class_prefix', 'today_class_suffix',
            'current_visitor_prefix', 'current_visitor_suffix', 'refresh_loading_label',
            'request_time_label', 'me_label', 'recent_activity_label', 'just_now_label',
            'accuracy_label', 'rank_suffix', 'score_suffix', 'no_personal_ranking_message'
        ];

        if (legacyHomeCopyKeysFix18Cleanup.length >0) {
            const legacyPlaceholders = legacyHomeCopyKeysFix18Cleanup.map(() => '?').join(', ');
            await pool.query(
                `UPDATE wgs_screen_settings
                    SET is_active = 0,
                        description = 'Legacy home copy setting hidden because the Home page now uses section-based screen settings.',
                        updated_by = 'system' WHERE page_key = 'home' AND section_key = 'copy' AND setting_key IN (${legacyPlaceholders})`,
                legacyHomeCopyKeysFix18Cleanup
            );
        }


        // 일부 이전 행은 home.copy.* 형태의 setting_key로 저장되어 있었습니다.
        // 현재 홈 화면은 섹션 기반 키를 사용하므로 이 행들은 이전 중복 데이터입니다.
        // 예: hero.*, live_chat.*, score_ranking.*, ranking_history.*, calendar.*
        // 행은 백업 데이터로 보존하되 기본 활성 관리자 목록에서는 숨깁니다.
        await pool.query(
            `UPDATE wgs_screen_settings
                SET is_active = 0,
                    description = 'Legacy home.copy.* setting preserved as an inactive backup row.',
                    updated_by = 'system' WHERE page_key = 'home' AND section_key = 'copy' AND setting_key LIKE 'home.copy.%'`
        );

        console.log('OK: wgs_screen_settings table checked');
    } catch (error) {
        console.warn('Screen settings schema check skipped:', error.message);
    }
}

// 4. JSON ->SQL 자동 복구
// - SQL 테이블이 비어 있거나 초기 상태일 때만 기존 JSON 데이터를 가져옵니다.
// - 사용자 이메일은 인증 기능과 직결되므로, SQL에 누락되어 있으면 보정합니다.
async function importUsersFromJSON() {
    if (!fs.existsSync(USER_FILE)) return;

    const usersData = readJSON(USER_FILE, {});
    const entries = Object.entries(usersData);
    if (entries.length === 0) return;

    const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_users');
    const shouldImportAll = Number(countRows[0].cnt) <= 1;

    if (shouldImportAll) console.log('users_data.json ->wgs_users 복구 시작');

    for (const [id, user] of entries) {
        if (!id || !user) continue;

        let password = user.password || '';
        if (password && !String(password).startsWith('$2')) {
            password = await bcrypt.hash(String(password), SALT_ROUNDS);
        }

        if (!password) continue;

        const name = user.name || id;
        const email = user.email ? String(user.email).trim().toLowerCase() : null;
        const dDay = user.dDay || null;

        if (shouldImportAll) {
            await pool.query(
                `INSERT INTO wgs_users (id, password, name, email, dDay, sessionToken)
                 VALUES (?, ?, ?, ?, ?, NULL)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    email = VALUES(email),
                    dDay = COALESCE(VALUES(dDay), dDay)`,
                [id, password, name, email, dDay]
            );
        } else if (email) {
            await pool.query(
                `UPDATE wgs_users
                 SET email = ?, name = COALESCE(NULLIF(name, ''), ?)
                 WHERE id = ? AND (email IS NULL OR email = '' OR email <>?)`,
                [email, name, id, email]
            );
        }

        if (Array.isArray(user.loginHistory) && user.loginHistory.length >0) {
            const [historyCount] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_login_history WHERE userId = ?', [id]);

            if (Number(historyCount[0].cnt) === 0) {
                for (const item of user.loginHistory.slice(0, 50)) {
                    const time = normalizeToMysqlDateTime(item.time || item);
                    const action = item.action || (String(item).includes('로그아웃') ? '로그아웃' : '로그인');
                    await pool.query('INSERT INTO wgs_login_history (userId, time, action) VALUES (?, ?, ?)', [id, time, action]);
                }
            }
        }

        if (Array.isArray(user.fortuneHistory) && user.fortuneHistory.length >0) {
            const [fortuneCount] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_fortune_history WHERE userId = ?', [id]);

            if (Number(fortuneCount[0].cnt) === 0) {
                for (const item of user.fortuneHistory.slice(0, 10)) {
                    await pool.query(
                        'INSERT INTO wgs_fortune_history (userId, time, type, data) VALUES (?, ?, ?, ?)',
                        [id, normalizeToMysqlDateTime(item.time), item.type || 'unknown', JSON.stringify(item.data || {})]
                    );
                }
            }
        }

        if (Array.isArray(user.wrongNotes) && user.wrongNotes.length >0) {
            for (const note of user.wrongNotes) {
                if (!note.question_id) continue;

                const [exists] = await pool.query(
                    'SELECT id FROM wgs_wrong_notes WHERE userId = ? AND question_id = ? LIMIT 1',
                    [id, note.question_id]
                );

                if (exists.length === 0) {
                    await pool.query(
                        `INSERT INTO wgs_wrong_notes (userId, question_id, source, year, session, savedAt)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            id,
                            note.question_id,
                            note.source || 'random',
                            note.year || null,
                            note.session || null,
                            normalizeToMysqlDateTime(note.savedAt)
                        ]
                    );
                }
            }
        }
    }

    if (shouldImportAll) console.log(' 유저 데이터 복구 완료');
}

async function importPostsFromJSON() {
    if (!fs.existsSync(POSTS_FILE)) return;

    const [postRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_posts');
    if (Number(postRows[0].cnt) >0) return;

    const posts = readJSON(POSTS_FILE, []);
    if (!Array.isArray(posts) || posts.length === 0) return;

    console.log('posts_data.json -> 게시판 테이블 복구 시작');

    for (const post of posts) {
        if (!post.id) continue;

        const [authorRows] = await pool.query('SELECT id FROM wgs_users WHERE id = ? LIMIT 1', [post.authorId]);
        const safeAuthorId = authorRows.length >0 ? post.authorId : null;

        await pool.query(
            `INSERT IGNORE INTO wgs_posts (id, title, content, authorId, authorName, date, views, likes, isNotice)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(post.id),
                post.title || '',
                post.content || '',
                safeAuthorId,
                post.authorName || '알 수 없음',
                post.date || getBoardDateString(),
                Number(post.views || 0),
                Number(post.likes || 0),
                post.isNotice ? 1 : 0
            ]
        );

        if (Array.isArray(post.comments)) {
            for (const comment of post.comments) {
                if (!comment.id) continue;

                await pool.query(
                    `INSERT IGNORE INTO wgs_comments (id, postId, text, authorId, authorName, date)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        String(comment.id),
                        String(post.id),
                        comment.text || '',
                        comment.authorId || null,
                        comment.authorName || '알 수 없음',
                        comment.date || getBoardDateString()
                    ]
                );

                if (Array.isArray(comment.replies)) {
                    for (const reply of comment.replies) {
                        if (!reply.id) continue;

                        await pool.query(
                            `INSERT IGNORE INTO wgs_replies (id, commentId, text, authorId, authorName, date)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                String(reply.id),
                                String(comment.id),
                                reply.text || '',
                                reply.authorId || null,
                                reply.authorName || '알 수 없음',
                                reply.date || getBoardDateString()
                            ]
                        );
                    }
                }
            }
        }

        if (Array.isArray(post.likedUsers)) {
            for (const likedUserId of post.likedUsers) {
                await pool.query(
                    'INSERT IGNORE INTO wgs_post_likes (postId, userId) VALUES (?, ?)',
                    [String(post.id), String(likedUserId)]
                );
            }
        }
    }

    console.log(' 게시판 데이터 복구 완료');
}

async function importRankingsFromJSON() {
    const randomSources = [RANKING_RANDOM_FILE, RANKING_DATA_FILE];

    const [randomCountRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_ranking_random');
    if (Number(randomCountRows[0].cnt) === 0) {
        for (const filePath of randomSources) {
            const rows = readJSON(filePath, []);
            if (!Array.isArray(rows)) continue;

            for (const item of rows) {
                if (!item.userId || !item.date) continue;

                await pool.query(
                    `INSERT INTO wgs_ranking_random (userId, date, solved_count, correct_count)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        solved_count = VALUES(solved_count),
                        correct_count = VALUES(correct_count)`,
                    [item.userId, item.date, Number(item.solved_count || 0), Number(item.correct_count || 0)]
                );
            }
        }
    }

    const [pastCountRows] = await pool.query('SELECT COUNT(*) AS cnt FROM wgs_ranking_past');
    if (Number(pastCountRows[0].cnt) === 0) {
        const rows = readJSON(RANKING_PAST_FILE, []);

        if (Array.isArray(rows)) {
            for (const item of rows) {
                if (!item.userId || !item.date) continue;

                await pool.query(
                    `INSERT INTO wgs_ranking_past (userId, date, year, session, solved_count, correct_count)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        solved_count = VALUES(solved_count),
                        correct_count = VALUES(correct_count)`,
                    [
                        item.userId,
                        item.date,
                        Number(item.year || 0),
                        Number(item.session || 0),
                        Number(item.solved_count || 0),
                        Number(item.correct_count || 0)
                    ]
                );
            }
        }
    }
}

async function importDataFromJSON() {
    try {
        await importUsersFromJSON();
        await importPostsFromJSON();
        await importRankingsFromJSON();
    } catch (error) {
        console.error('JSON ->SQL 자동 복구 중 오류:', error.message);
    }
}

// 5. 공통 DB 조회 헬퍼
async function getUserById(id) {
    //  로그인 핫픽스
    // - 사용자 관리 패치 컬럼이 아직 DB에 없을 때 SELECT에서 Unknown column으로 로그인 자체가 막히는 문제를 방지한다.
    // - 서버 시작 보정 + 사용자 조회 직전 보정을 같이 둬서 로컬/AWS Lightsail 반영 순서가 달라도 안전하게 처리한다.
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
// 1) 관리자 권한 사용자만 전체 회원 목록과 최근 로그인/로그아웃 기록을 확인할 수 있게 한다.
// 2) 회원 정보는 조회 전용으로만 제공해서 기존 회원가입/로그인/마이페이지 로직을 건드리지 않는다.
// 3) 게시글/댓글/오답 수는 관리자 화면 참고용 통계이며, 관련 테이블이 없거나 비어 있어도
//  관리자 화면 전체가 깨지지 않도록 안전하게 0으로 처리한다.
// 4) 이번 단계는 DB 구조 변경 없이 조회 API만 추가한다.
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


let adminUserControlSchemaReady = false; // 사용자 제어 DB 구조를 1회 보정했는지 기억한다.
let adminUserControlSchemaPromise = null; // 동시에 여러 요청이 들어와도 ALTER가 중복 실행되지 않도록 잠금 역할을 한다.

async function ensureAdminUserControlSchema() {
    // 사용자 임시정지/운영자/결재 기능용 컬럼과 테이블을 로컬·AWS에서 안전하게 보정한다.
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

    // 전체 공지 발송과 점검 모드 변경은 운영자가 바로 적용하므로 별도의 공통 이력 테이블에 저장한다.
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

    // 같은 결재 DB 행을 공유하면서 최고관리자 목록과 운영자 본인 목록은 각각 숨김 처리한다.
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
// 서버에서도 "요청자(requester)"와 "대상(target)"을 나눠 위험 작업을 방어한다.
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

// 승인 반영용 내부 토큰이다. .env에 ADMIN_APPROVAL_BYPASS_TOKEN이 있으면 그 값을 쓰고, 없으면 서버 시작마다 난수로 만든다.
// 기존처럼 예측 가능한 기본 문자열을 쓰면 외부 요청자가 헤더를 흉내 낼 수 있으므로 런타임 난수로 보호한다.
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
    getKSTDateTime,
});

registerBoardRoutes({
    app,
    pool,
    getPostWithChildren,
    refreshPostLikeCount,
    getBoardDateString,
    isNoticeBoardCreateRequest,
    sendNoticePostEmailsInBackground,
    getUserById,
    sendEmail,
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

// 14. React SPA 새로고침 방어
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
        //  로그인 핫픽스
        // - 사용자 관리 패치에서 추가한 컬럼/결재 테이블이 DB에 없으면 로그인 SELECT 단계에서 Unknown column 에러가 발생할 수 있어.
        // - 서버 시작 직후 1회 자동 보정해서 로컬과 AWS Lightsail DB 구조 차이를 줄인다.
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
