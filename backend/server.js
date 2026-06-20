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
app.disable('x-powered-by');

function wgsBoolEnv(value, fallback = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

function wgsCsvEnv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function wgsIsPrivateDevHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
}

function wgsAllowedCorsOrigin(origin) {
    if (!origin) return true;

    const defaults = [
        'https://woogongsil.site',
        'https://www.woogongsil.site',
        'http://localhost:5000',
        'http://127.0.0.1:5000',
    ];
    const allowedOrigins = new Set([
        ...defaults,
        ...wgsCsvEnv(process.env.PUBLIC_SITE_URL),
        ...wgsCsvEnv(process.env.CORS_ALLOWED_ORIGINS),
        ...wgsCsvEnv(process.env.WGS_ALLOWED_ORIGINS),
    ].filter(Boolean));

    if (allowedOrigins.has(origin)) return true;

    try {
        const parsed = new URL(origin);
        if (wgsIsPrivateDevHost(parsed.hostname)) return true;
    } catch (error) {
        return false;
    }

    return false;
}

const wgsCorsOptions = {
    origin(origin, callback) {
        callback(null, wgsAllowedCorsOrigin(origin));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-WGS-Client-Id',
        'X-Client-Id',
        'X-User-Id',
        'X-Session-Token',
        'X-Server-Instance-Id',
        'X-Admin-Approval-Bypass',
    ],
    maxAge: 600,
};

function wgsSecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://js.hcaptcha.com https://*.hcaptcha.com https://dapi.kakao.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://*.kakao.com https://*.kakaocdn.net https://*.daumcdn.net https://map.daumcdn.net https://t1.daumcdn.net https://map.kakao.com",
            "font-src 'self' data:",
            "connect-src 'self' ws: wss: https://hcaptcha.com https://*.hcaptcha.com https://dapi.kakao.com",
            "frame-src 'self' https://js.hcaptcha.com https://*.hcaptcha.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ].join('; ')
    );
    if (wgsBoolEnv(process.env.WGS_ROBOTS_NOINDEX, true)) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    next();
}

app.use(wgsSecurityHeaders);

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

const createMultiplayerRouter = require('./multiplayerRoutes');
const { attachMultiplayerSocket } = require('./multiplayerSocket');

// 프론트에서 API 요청을 보낼 수 있도록 CORS 허용합니다
app.use(cors(wgsCorsOptions));

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
        'User-agent: *',
        'Disallow: /',
        '',
    ].join('\n'));
});

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
    // 사용자 팝업에는 식당명/개발용 변수를 노출하지 않고 승인·반려 결과만 간단히 보여줍니다.
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
    // 사용자 팝업에는 식당명/개발용 변수를 노출하지 않고 승인·반려 결과만 간단히 보여줍니다.
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
// 기존 필기/실기/게시판/FAQ API보다 독립된 /api/multiplayer 경로로만 추가합니다.
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
// 기존 DB를 삭제하거나 초기화하지 않고, 필요한 컬럼만 없을 때 추가합니다.
// 기존 wgs_wrong_notes 테이블에 subject 컬럼만 없는 경우에도
// 서버 실행 시 자동으로 보완되도록 만들었다.
async function ensureWrongNotesSchema() {
    try {
        // 테이블이 아예 없는 경우를 대비한 안전 생성 코드.
        // 이미 존재하는 테이블은 변경하지 않는다.
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

        // 예전 스키마에는 source/year/session/subject/savedAt 중 일부가 없을 수 있어서 하나씩 확인 후 추가합니다.
        // ALTER는 없는 컬럼에만 실행되므로 기존 데이터는 유지됩니다.
        if (!columnNames.has('source')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'random' AFTER question_id`);
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
        // 이미 같은 이름의 인덱스가 있으면 MySQL에서 에러가 나므로 무시합니다.
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
        // 스키마 보정 실패가 있어도 서버 전체가 중단되지 않도록 경고만 출력합니다.
        // 저장 과정에서 오류가 발생하면 터미널 로그를 기준으로 스키마를 확인합니다.
        console.warn('wgs_wrong_notes schema check warning:', err.message);
    }
}

ensureWrongNotesSchema();

// React 빌드 결과물을 Express가 정적 파일로 제공합니다.

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
const ADMIN_USER_ID = String(process.env.WGS_ADMIN_USER_ID || process.env.ADMIN_USER_ID || '').trim().toLowerCase();

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

// .env의 PUBLIC_SITE_URL 값으로 배포 주소와 개발 주소를 쉽게 전환할 수 있습니다.
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
// - 기준: 서버 기준 시간
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
//  Duplicate column name 경고가 터미널에 반복 출력되지 않도록 처리합니다.
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
    // - 관리자가 직접 공지 순서를 저장하기 전까지는 최신 공지가 위에 오도록 id 기준으로 부여합니다.
    // - 이미 순서가 저장된 공지는 변경하지 않으므로 관리자 정렬값이 갱신되지 않습니다.
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
    // - 기존 기능 DB 구조를 변경하지 않고 관리자 화면 설정 CRUD 전용 테이블만 추가합니다.
    // - CREATE TABLE IF NOT EXISTS 방식이라 환경별 어디서 실행해도 반복 실행이 안전합니다.
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
        // - INSERT IGNORE를 사용해 기존 관리자가 수정한 setting_value는 갱신하지 않습니다.
        // - 이후 UPDATE는 관리자 목록에서 보이는 이름/설명/정렬만 보정하고 실제 문구값은 유지합니다.
        const homeScreenDefaultRowsFix18V9 = [
            ['home', 'hero', 'text', 'hero_title', '홈 메인 제목', '정보 처리 기사', '홈 상단 배너의 큰 제목입니다.', 100],
            ['home', 'hero', 'text', 'hero_desc', '홈 메인 안내문', '정보처리기사 필기·실기 학습과 오답 관리를 한 화면에서 이용할 수 있습니다.', '홈 상단 배너 제목 아래 안내문입니다.', 110],
            ['home', 'hero', 'layout', 'title_align', '홈 메인 제목 정렬', 'center', '홈 상단 배너 제목 정렬입니다. left, center, right 중 하나를 사용합니다.', 112],
            ['home', 'hero', 'layout', 'desc_align', '홈 메인 설명 정렬', 'center', '홈 상단 배너 설명 정렬입니다. left, center, right 중 하나를 사용합니다.', 113],
            ['home', 'hero', 'layout', 'title_offset_x', '홈 메인 제목 가로 위치', '0', '홈 상단 배너 제목을 좌우로 이동합니다. -200부터 200까지 10 단위 px 값을 사용합니다.', 114],
            ['home', 'hero', 'layout', 'title_offset_y', '홈 메인 제목 세로 위치', '0', '홈 상단 배너 제목을 위아래로 이동합니다. -200부터 200까지 10 단위 px 값을 사용합니다.', 115],
            ['home', 'hero', 'layout', 'desc_offset_x', '홈 메인 설명 가로 위치', '0', '홈 상단 배너 설명을 좌우로 이동합니다. -200부터 200까지 10 단위 px 값을 사용합니다.', 116],
            ['home', 'hero', 'layout', 'desc_offset_y', '홈 메인 설명 세로 위치', '0', '홈 상단 배너 설명을 위아래로 이동합니다. -200부터 200까지 10 단위 px 값을 사용합니다.', 117],
            ['home', 'hero', 'layout', 'content_width', '홈 메인 문구 너비', '100%', '홈 상단 배너 제목/설명의 최대 너비입니다. 60%부터 100%까지 10% 단위 값을 사용합니다.', 118],
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

        // 화면 하드코딩 제거용 기본 설정입니다.
        // 기존 테이블과 키 연결을 유지하고 INSERT IGNORE로 관리자 수정값은 덮어쓰지 않습니다.
        const screenSettingDefaultsNoHardcodeV1 = [
            ['all', 'nav', 'text', 'home_label', '상단 메뉴 - 홈', '홈', '상단 네비게이션 홈 메뉴명입니다.', 1100],
            ['all', 'nav', 'text', 'cert_ipe_label', '상단 메뉴 - 정보처리기사', '정보처리기사', '상단 네비게이션 정보처리기사 메뉴명입니다.', 1110],
            ['all', 'nav', 'text', 'multiplayer_label', '상단 메뉴 - 멀티플레이', '멀티플레이', '상단 네비게이션 멀티플레이 메뉴명입니다.', 1120],
            ['all', 'nav', 'text', 'mealmap_label', '상단 메뉴 - 회식맵', '회식맵', '상단 네비게이션 회식맵 메뉴명입니다.', 1130],
            ['all', 'nav', 'text', 'mypage_label', '상단 메뉴 - 마이페이지', '마이페이지', '상단 네비게이션 마이페이지 메뉴명입니다.', 1140],
            ['all', 'nav', 'text', 'board_label', '상단 메뉴 - 게시판', '게시판', '상단 네비게이션 게시판 메뉴명입니다.', 1150],
            ['all', 'nav', 'text', 'faq_label', '상단 메뉴 - FAQ', 'FAQ', '상단 네비게이션 FAQ 메뉴명입니다.', 1160],
            ['all', 'nav', 'text', 'fortune_label', '상단 메뉴 - 운세', '운세', '상단 네비게이션 운세 메뉴명입니다.', 1170],
            ['all', 'nav', 'text', 'admin_label', '상단 메뉴 - 관리자', '관리자', '상단 네비게이션 관리자 메뉴명입니다.', 1180],
            ['all', 'nav', 'text', 'login_label', '상단 메뉴 - 로그인', '로그인', '상단 네비게이션 로그인 메뉴명입니다.', 1190],
            ['all', 'nav', 'text', 'logout_label', '상단 메뉴 - 로그아웃', '로그아웃', '상단 네비게이션 로그아웃 버튼명입니다.', 1200],
            ['cert_ipe', 'hero', 'text', 'eyebrow', '정보처리기사 입구 - 상단 보조문구', '국가기술자격 학습관', '정보처리기사 입구 화면의 보조 문구입니다.', 100],
            ['cert_ipe', 'hero', 'text', 'page_title', '정보처리기사 입구 - 제목', '정보처리기사', '정보처리기사 입구 화면의 제목입니다.', 110],
            ['cert_ipe', 'hero', 'text', 'page_desc', '정보처리기사 입구 - 설명', '필기와 실기 학습 메뉴를 하나의 정보처리기사 페이지에서 선택합니다.\n각 버튼을 누르면 필기 학습 로비와 실기 학습 로비로 이동합니다.', '정보처리기사 입구 화면의 설명입니다.', 120],
            ['cert_ipe', 'cards', 'text', 'written_title', '정보처리기사 입구 - 필기 카드 제목', '필기 학습', '필기 학습 카드 제목입니다.', 200],
            ['cert_ipe', 'cards', 'text', 'written_desc', '정보처리기사 입구 - 필기 카드 설명', '필기 학습 로비로 이동합니다.\n필기 문제은행과 필기 기출문제를 한 화면에서 선택할 수 있습니다.', '필기 학습 카드 설명입니다.', 210],
            ['cert_ipe', 'cards', 'text', 'written_button_label', '정보처리기사 입구 - 필기 버튼', '필기 로비로 이동', '필기 학습 카드 버튼명입니다.', 220],
            ['cert_ipe', 'cards', 'text', 'practical_title', '정보처리기사 입구 - 실기 카드 제목', '실기 학습', '실기 학습 카드 제목입니다.', 230],
            ['cert_ipe', 'cards', 'text', 'practical_desc', '정보처리기사 입구 - 실기 카드 설명', '실기 학습 로비로 이동합니다.\n실기 문제은행과 실기 기출문제를 한 화면에서 선택할 수 있습니다.', '실기 학습 카드 설명입니다.', 240],
            ['cert_ipe', 'cards', 'text', 'practical_button_label', '정보처리기사 입구 - 실기 버튼', '실기 로비로 이동', '실기 학습 카드 버튼명입니다.', 250],
            ['cert_ipe', 'notice', 'text', 'bottom_notice', '정보처리기사 입구 - 하단 안내', '정보처리기사 메뉴에서 필기와 실기 학습을 한 번에 선택할 수 있으며,\n실제 문제풀이·기출응시·채점·오답 저장 기능은 동일하게 이용할 수 있습니다.', '정보처리기사 입구 화면 하단 안내문입니다.', 300],
            ['written', 'cards', 'text', 'random_desc', '필기 문제은행 카드 설명', '과목별 랜덤 문제를 풀면서 개념을 빠르게 확인하는 학습모드입니다.\n답안을 제출하면 즉시 채점 결과와 정답을 확인할 수 있습니다.', '필기 로비 문제은행 카드 설명입니다.', 300],
            ['written', 'cards', 'text', 'random_button_label', '필기 문제은행 버튼명', '문제은행 입장하기', '필기 로비 문제은행 카드 버튼명입니다.', 310],
            ['written', 'cards', 'text', 'past_desc', '필기 기출문제 카드 설명', '연도와 회차를 선택해 실제 시험처럼 풀 수 있는 모드입니다.\n제한시간, OMR 이동, 최종 결과표, PDF 출력 기능을 제공합니다.', '필기 로비 기출문제 카드 설명입니다.', 320],
            ['written', 'cards', 'text', 'past_button_label', '필기 기출문제 버튼명', '기출문제 입장하기', '필기 로비 기출문제 카드 버튼명입니다.', 330],
            ['written', 'notice', 'text', 'menu_notice', '필기 로비 - 메뉴 안내', '멀티플레이는 상단의 “멀티플레이” 메뉴에서 별도로 이용할 수 있습니다.', '필기 로비 상단 설명 아래 메뉴 안내입니다.', 400],
            ['written', 'notice', 'text', 'bottom_notice', '필기 로비 - 하단 안내', '랜덤 CBT 멀티플레이는 상단 ‘멀티플레이’ 메뉴에서 이용할 수 있습니다.\n필기 문제은행과 필기 기출문제 기능은 동일하게 이용할 수 있습니다.', '필기 로비 하단 안내문입니다.', 410],
            ['ipep', 'mode_buttons', 'text', 'lobby_label', '실기 모드 버튼 - 로비', '실기 로비', '실기 화면 모드 전환 로비 버튼명입니다.', 600],
            ['ipep', 'mode_buttons', 'text', 'random_label', '실기 모드 버튼 - 문제은행', '실기 문제은행', '실기 화면 모드 전환 문제은행 버튼명입니다.', 610],
            ['ipep', 'mode_buttons', 'text', 'past_label', '실기 모드 버튼 - 기출문제', '실기 기출문제', '실기 화면 모드 전환 기출문제 버튼명입니다.', 620],
            ['login', 'tabs', 'text', 'login_label', '로그인 탭명', '로그인', '로그인 센터 로그인 탭명입니다.', 100],
            ['login', 'tabs', 'text', 'signup_label', '회원가입 탭명', '회원가입', '로그인 센터 회원가입 탭명입니다.', 110],
            ['login', 'tabs', 'text', 'find_label', '계정 찾기 탭명', 'ID/PW 찾기', '로그인 센터 계정 찾기 탭명입니다.', 120],
            ['login', 'hero', 'text', 'eyebrow', '로그인 센터 상단 보조문구', 'SKN29th_우공실 계정', '로그인 센터 상단 보조문구입니다.', 200],
            ['login', 'hero', 'text', 'title', '로그인 센터 제목', '로그인 센터', '로그인 센터 제목입니다.', 210],
            ['login', 'hero', 'text', 'desc', '로그인 센터 설명', '로그인, 회원가입, 아이디/비밀번호 찾기를 한 페이지에서 처리합니다.', '로그인 센터 설명문입니다.', 220],
            ['login', 'form', 'text', 'title', '로그인 폼 제목', '로그인', '로그인 폼 제목입니다.', 300],
            ['login', 'form', 'text', 'desc', '로그인 폼 설명', '우공실 학습 기능을 이용하려면 로그인해주세요.', '로그인 폼 설명입니다.', 310],
            ['login', 'form', 'text', 'id_placeholder', '로그인 아이디 입력 안내', '아이디', '로그인 아이디 입력 placeholder입니다.', 320],
            ['login', 'form', 'text', 'password_placeholder', '로그인 비밀번호 입력 안내', '비밀번호', '로그인 비밀번호 입력 placeholder입니다.', 330],
            ['login', 'form', 'text', 'show_password_label', '비밀번호 보기 버튼명', '보기', '비밀번호 보기 버튼명입니다.', 340],
            ['login', 'form', 'text', 'hide_password_label', '비밀번호 숨김 버튼명', '숨김', '비밀번호 숨김 버튼명입니다.', 350],
            ['login', 'form', 'text', 'show_password_title', '비밀번호 보기 설명', '비밀번호 표시', '비밀번호 보기 버튼 title입니다.', 360],
            ['login', 'form', 'text', 'hide_password_title', '비밀번호 숨김 설명', '비밀번호 숨기기', '비밀번호 숨김 버튼 title입니다.', 370],
            ['login', 'form', 'text', 'hcaptcha_label', '로그인 보안 확인 문구', '로그인 보안 확인', '로그인 보안 확인 문구입니다.', 380],
            ['login', 'form', 'text', 'submit_label', '로그인 버튼명', '로그인', '로그인 제출 버튼명입니다.', 390],
            ['login', 'form', 'text', 'submit_loading_label', '로그인 진행 버튼명', '로그인 중...', '로그인 진행 중 버튼명입니다.', 400],
            ['login', 'messages', 'text', 'need_id', '로그인 아이디 미입력 알림', '아이디를 입력해주세요.', '로그인 아이디 미입력 알림입니다.', 500],
            ['login', 'messages', 'text', 'need_password', '로그인 비밀번호 미입력 알림', '비밀번호를 입력해주세요.', '로그인 비밀번호 미입력 알림입니다.', 510],
            ['login', 'messages', 'text', 'locked', '로그인 차단 알림', '해당 아이디({id})는 차단되었습니다. {seconds}초 후 시도하세요.', '로그인 차단 알림입니다. {id}, {seconds}를 사용할 수 있습니다.', 520],
            ['login', 'messages', 'text', 'lockout_started', '로그인 잠금 시작 알림', '5회 실패로 2분간 차단됩니다.', '로그인 잠금 시작 알림입니다.', 530],
            ['login', 'messages', 'text', 'login_failed_count', '로그인 실패 횟수 알림', '로그인 실패 [{count}/5]', '로그인 실패 횟수 알림입니다. {count}를 사용할 수 있습니다.', 540],
            ['login', 'messages', 'text', 'server_failed', '로그인 서버 실패 알림', '서버 연결 실패', '로그인 서버 실패 알림입니다.', 550],
            ['signup', 'form', 'text', 'title', '회원가입 제목', '회원가입', '회원가입 화면 제목입니다.', 100],
            ['signup', 'form', 'text', 'id_label', '회원가입 아이디 라벨', '아이디 (영문+숫자 5~10자)', '회원가입 아이디 라벨입니다.', 110],
            ['signup', 'form', 'text', 'id_placeholder', '회원가입 아이디 입력 안내', '영문, 숫자 혼합 5~10자', '회원가입 아이디 placeholder입니다.', 120],
            ['signup', 'form', 'text', 'id_check_button', '회원가입 아이디 중복확인 버튼', '중복확인', '회원가입 아이디 중복확인 버튼명입니다.', 130],
            ['signup', 'form', 'text', 'id_checked_label', '회원가입 아이디 확인 완료 문구', '확인완료', '회원가입 아이디 확인 완료 문구입니다.', 140],
            ['signup', 'form', 'text', 'id_need_check_label', '회원가입 아이디 확인 필요 문구', '*중복확인 필요', '회원가입 아이디 확인 필요 문구입니다.', 150],
            ['signup', 'form', 'text', 'email_label', '회원가입 이메일 라벨', '이메일 주소', '회원가입 이메일 라벨입니다.', 160],
            ['signup', 'form', 'text', 'email_verified_label', '회원가입 이메일 인증완료 문구', '인증완료', '회원가입 이메일 인증완료 문구입니다.', 170],
            ['signup', 'form', 'text', 'send_code_button', '회원가입 인증요청 버튼', '인증요청', '회원가입 인증요청 버튼명입니다.', 180],
            ['signup', 'form', 'text', 'resend_button', '회원가입 인증 재전송 버튼', '재전송', '회원가입 인증 재전송 버튼명입니다.', 190],
            ['signup', 'form', 'text', 'resend_count_label', '회원가입 재전송 대기 버튼', '{seconds}초', '회원가입 재전송 대기 버튼명입니다. {seconds}를 사용할 수 있습니다.', 200],
            ['signup', 'form', 'text', 'hcaptcha_label', '회원가입 보안 확인 문구', '회원가입/인증메일 보안 확인', '회원가입 보안 확인 문구입니다.', 210],
            ['signup', 'form', 'text', 'code_label', '회원가입 인증번호 라벨', '인증번호 입력', '회원가입 인증번호 라벨입니다.', 220],
            ['signup', 'form', 'text', 'remaining_time_label', '회원가입 인증 남은시간 라벨', '남은시간', '회원가입 인증 남은시간 라벨입니다.', 230],
            ['signup', 'form', 'text', 'code_placeholder', '회원가입 인증번호 입력 안내', '숫자 6자리 입력', '회원가입 인증번호 placeholder입니다.', 240],
            ['signup', 'form', 'text', 'confirm_button', '회원가입 확인 버튼', '확인', '회원가입 확인 버튼명입니다.', 250],
            ['signup', 'form', 'text', 'password_label', '회원가입 비밀번호 라벨', '비밀번호 (영문+숫자+기호 8~15자)', '회원가입 비밀번호 라벨입니다.', 260],
            ['signup', 'form', 'text', 'password_placeholder', '회원가입 비밀번호 입력 안내', '영문, 숫자, 기호(@!.,-_) 포함 8~15자', '회원가입 비밀번호 placeholder입니다.', 270],
            ['signup', 'form', 'text', 'password_confirm_label', '회원가입 비밀번호 확인 라벨', '비밀번호 확인', '회원가입 비밀번호 확인 라벨입니다.', 280],
            ['signup', 'form', 'text', 'password_confirm_placeholder', '회원가입 비밀번호 확인 입력 안내', '비밀번호를 한번 더 입력해주세요', '회원가입 비밀번호 확인 placeholder입니다.', 290],
            ['signup', 'form', 'text', 'password_match_label', '회원가입 비밀번호 일치 문구', '일치합니다', '회원가입 비밀번호 일치 문구입니다.', 300],
            ['signup', 'form', 'text', 'password_mismatch_label', '회원가입 비밀번호 불일치 문구', '일치하지 않습니다', '회원가입 비밀번호 불일치 문구입니다.', 310],
            ['signup', 'form', 'text', 'show_password_label', '회원가입 비밀번호 보기 버튼명', '보기', '회원가입 비밀번호 보기 버튼명입니다.', 320],
            ['signup', 'form', 'text', 'hide_password_label', '회원가입 비밀번호 숨김 버튼명', '숨김', '회원가입 비밀번호 숨김 버튼명입니다.', 330],
            ['signup', 'form', 'text', 'show_password_title', '회원가입 비밀번호 보기 설명', '표시', '회원가입 비밀번호 보기 title입니다.', 340],
            ['signup', 'form', 'text', 'hide_password_title', '회원가입 비밀번호 숨김 설명', '숨기기', '회원가입 비밀번호 숨김 title입니다.', 350],
            ['signup', 'form', 'text', 'name_label', '회원가입 이름 라벨', '이름', '회원가입 이름 라벨입니다.', 360],
            ['signup', 'form', 'text', 'name_placeholder', '회원가입 이름 입력 안내', '홍길동', '회원가입 이름 placeholder입니다.', 370],
            ['signup', 'form', 'text', 'cancel_button', '회원가입 취소 버튼', '취소', '회원가입 취소 버튼명입니다.', 380],
            ['signup', 'form', 'text', 'submit_button', '회원가입 완료 버튼', '가입완료', '회원가입 완료 버튼명입니다.', 390],
            ['signup', 'form', 'text', 'submit_loading_label', '회원가입 처리중 버튼', '처리 중...', '회원가입 처리중 버튼명입니다.', 400],
            ['signup', 'messages', 'text', 'need_id', '회원가입 아이디 미입력 알림', '확인할 아이디를 입력해주세요.', '회원가입 아이디 미입력 알림입니다.', 500],
            ['signup', 'messages', 'text', 'invalid_id', '회원가입 아이디 형식 알림', '아이디는 영문자와 숫자가 각각 1개 이상 포함된 5~10자리여야 합니다.', '회원가입 아이디 형식 알림입니다.', 510],
            ['signup', 'messages', 'text', 'id_available', '회원가입 아이디 사용 가능 알림', '사용 가능한 아이디입니다.', '회원가입 아이디 사용 가능 알림입니다.', 520],
            ['signup', 'messages', 'text', 'id_check_failed', '회원가입 아이디 확인 실패 알림', '이미 사용 중인 아이디이거나 확인에 실패했습니다.', '회원가입 아이디 확인 실패 알림입니다.', 530],
            ['signup', 'messages', 'text', 'invalid_email', '회원가입 이메일 형식 알림', '올바른 이메일 형식을 입력해주세요.', '회원가입 이메일 형식 알림입니다.', 540],
            ['signup', 'messages', 'text', 'resend_wait', '회원가입 재전송 대기 알림', '{seconds}초 후에 다시 전송할 수 있습니다.', '회원가입 재전송 대기 알림입니다. {seconds}를 사용할 수 있습니다.', 550],
            ['signup', 'messages', 'text', 'code_sent', '회원가입 인증번호 발송 알림', '인증번호가 전송되었습니다. (유효시간 2분)', '회원가입 인증번호 발송 알림입니다.', 560],
            ['signup', 'messages', 'text', 'code_resent', '회원가입 인증번호 재발송 알림', '인증번호가 재전송되었습니다. 메일함을 확인해주세요.', '회원가입 인증번호 재발송 알림입니다.', 570],
            ['signup', 'messages', 'text', 'code_send_failed', '회원가입 인증번호 발송 실패 알림', '인증번호 전송에 실패했습니다.', '회원가입 인증번호 발송 실패 알림입니다.', 580],
            ['signup', 'messages', 'text', 'code_expired', '회원가입 인증 만료 알림', '인증 시간이 만료되었습니다. 인증번호를 재전송 해주세요.', '회원가입 인증 만료 알림입니다.', 590],
            ['signup', 'messages', 'text', 'need_code', '회원가입 인증번호 미입력 알림', '인증번호를 입력해주세요.', '회원가입 인증번호 미입력 알림입니다.', 600],
            ['signup', 'messages', 'text', 'email_verified', '회원가입 이메일 인증 완료 알림', '이메일 인증이 완료되었습니다.', '회원가입 이메일 인증 완료 알림입니다.', 610],
            ['signup', 'messages', 'text', 'code_mismatch', '회원가입 인증번호 불일치 알림', '인증번호가 일치하지 않습니다.', '회원가입 인증번호 불일치 알림입니다.', 620],
            ['signup', 'messages', 'text', 'need_id_check', '회원가입 아이디 중복확인 필요 알림', '아이디 중복 확인을 해주세요.', '회원가입 아이디 중복확인 필요 알림입니다.', 630],
            ['signup', 'messages', 'text', 'need_email_verify', '회원가입 이메일 인증 필요 알림', '이메일 인증을 완료해주세요.', '회원가입 이메일 인증 필요 알림입니다.', 640],
            ['signup', 'messages', 'text', 'invalid_password', '회원가입 비밀번호 형식 알림', '비밀번호는 영문, 숫자, 지정된 특수문자(@, !, ,, ., -, _)가 모두 포함된 8~15자리여야 합니다.', '회원가입 비밀번호 형식 알림입니다.', 650],
            ['signup', 'messages', 'text', 'password_mismatch', '회원가입 비밀번호 불일치 알림', '비밀번호가 일치하지 않습니다. 다시 확인해주세요.', '회원가입 비밀번호 불일치 알림입니다.', 660],
            ['signup', 'messages', 'text', 'signup_success', '회원가입 완료 알림', '회원가입이 완료되었습니다!\n가입하신 이메일로 가입 환영 메일이 발송되었습니다.', '회원가입 완료 알림입니다.', 670],
            ['signup', 'messages', 'text', 'signup_failed', '회원가입 실패 알림', '회원가입에 실패했습니다.', '회원가입 실패 알림입니다.', 680],
            ['find_auth', 'tabs', 'text', 'id_label', '계정 찾기 탭 - 아이디', '아이디 찾기', '계정 찾기 화면의 아이디 찾기 탭명입니다.', 100],
            ['find_auth', 'tabs', 'text', 'pw_label', '계정 찾기 탭 - 비밀번호', '비밀번호 찾기', '계정 찾기 화면의 비밀번호 찾기 탭명입니다.', 110],
            ['find_auth', 'id_step', 'text', 'desc', '아이디 찾기 안내문', '가입할 때 등록한 이름과 이메일로 인증합니다.', '아이디 찾기 첫 단계 안내문입니다.', 200],
            ['find_auth', 'id_step', 'text', 'name_placeholder', '아이디 찾기 이름 입력 안내', '가입자 이름', '아이디 찾기 이름 입력 placeholder입니다.', 210],
            ['find_auth', 'id_step', 'text', 'hcaptcha_label', '아이디 찾기 보안 확인 문구', '아이디 찾기 보안 확인', '아이디 찾기 hCaptcha 안내문입니다.', 220],
            ['find_auth', 'pw_step', 'text', 'desc', '비밀번호 찾기 안내문', '아이디와 이메일로 본인 인증 후 재설정합니다.', '비밀번호 찾기 첫 단계 안내문입니다.', 300],
            ['find_auth', 'pw_step', 'text', 'id_placeholder', '비밀번호 찾기 아이디 입력 안내', '아이디', '비밀번호 찾기 아이디 입력 placeholder입니다.', 310],
            ['find_auth', 'pw_step', 'text', 'hcaptcha_label', '비밀번호 찾기 보안 확인 문구', '비밀번호 찾기 보안 확인', '비밀번호 찾기 hCaptcha 안내문입니다.', 320],
            ['find_auth', 'common', 'text', 'email_placeholder', '계정 찾기 이메일 입력 안내', '가입 이메일', '계정 찾기 공통 이메일 입력 placeholder입니다.', 400],
            ['find_auth', 'common', 'text', 'request_button', '계정 찾기 인증요청 버튼', '인증요청', '계정 찾기 인증번호 요청 버튼명입니다.', 410],
            ['find_auth', 'common', 'text', 'sent_label', '계정 찾기 인증 전송 완료 버튼', '전송완료', '계정 찾기 인증번호 전송 완료 상태 버튼명입니다.', 420],
            ['find_auth', 'common', 'text', 'code_label', '계정 찾기 인증번호 라벨', '인증번호 6자리', '계정 찾기 인증번호 입력 영역 라벨입니다.', 430],
            ['find_auth', 'common', 'text', 'code_placeholder', '계정 찾기 인증번호 입력 안내', '000000', '계정 찾기 인증번호 placeholder입니다.', 440],
            ['find_auth', 'common', 'text', 'confirm_button', '계정 찾기 인증 확인 버튼', '확인', '계정 찾기 인증번호 확인 버튼명입니다.', 450],
            ['find_auth', 'result', 'text', 'title', '아이디 찾기 결과 제목', '아이디를 찾았습니다', '아이디 찾기 결과 화면 제목입니다.', 500],
            ['find_auth', 'result', 'text', 'login_button', '아이디 찾기 로그인 이동 버튼', '로그인 화면으로 이동', '아이디 찾기 결과 화면 로그인 이동 버튼명입니다.', 510],
            ['find_auth', 'reset', 'text', 'verified_notice', '비밀번호 재설정 인증 완료 안내', '이메일 본인 인증이 완료되었습니다.', '비밀번호 재설정 단계의 인증 완료 안내문입니다.', 600],
            ['find_auth', 'reset', 'text', 'new_password_label', '비밀번호 재설정 새 비밀번호 라벨', '새 비밀번호', '비밀번호 재설정 새 비밀번호 입력 라벨입니다.', 610],
            ['find_auth', 'reset', 'text', 'new_password_placeholder', '비밀번호 재설정 새 비밀번호 입력 안내', '영문, 숫자, 기호 포함 8~15자', '비밀번호 재설정 새 비밀번호 placeholder입니다.', 620],
            ['find_auth', 'reset', 'text', 'confirm_password_label', '비밀번호 재설정 확인 라벨', '비밀번호 확인', '비밀번호 재설정 확인 입력 라벨입니다.', 630],
            ['find_auth', 'reset', 'text', 'confirm_password_placeholder', '비밀번호 재설정 확인 입력 안내', '새 비밀번호 재입력', '비밀번호 재설정 확인 placeholder입니다.', 640],
            ['find_auth', 'reset', 'text', 'hcaptcha_label', '비밀번호 재설정 보안 확인 문구', '비밀번호 재설정 보안 확인', '비밀번호 재설정 hCaptcha 안내문입니다.', 650],
            ['find_auth', 'reset', 'text', 'submit_button', '비밀번호 재설정 제출 버튼', '비밀번호 변경하기', '비밀번호 재설정 제출 버튼명입니다.', 660],
            ['find_auth', 'messages', 'text', 'id_missing_inputs', '아이디 찾기 필수 입력 알림', '이름과 이메일을 모두 입력해주세요.', '아이디 찾기 필수 입력 누락 알림입니다.', 700],
            ['find_auth', 'messages', 'text', 'pw_missing_inputs', '비밀번호 찾기 필수 입력 알림', '아이디와 이메일을 모두 입력해주세요.', '비밀번호 찾기 필수 입력 누락 알림입니다.', 710],
            ['find_auth', 'messages', 'text', 'code_sent', '계정 찾기 인증번호 발송 알림', '인증번호가 발송되었습니다. 2분 안에 입력해주세요.', '계정 찾기 인증번호 발송 성공 알림입니다.', 720],
            ['find_auth', 'messages', 'text', 'send_failed', '계정 찾기 인증번호 발송 실패 알림', '일치하는 회원 정보가 없거나 메일 발송에 실패했습니다.', '계정 찾기 인증번호 발송 실패 알림입니다.', 730],
            ['find_auth', 'messages', 'text', 'code_expired', '계정 찾기 인증 만료 알림', '인증 시간이 만료되었습니다.', '계정 찾기 인증 시간 만료 알림입니다.', 740],
            ['find_auth', 'messages', 'text', 'need_code', '계정 찾기 인증번호 미입력 알림', '인증번호를 입력해주세요.', '계정 찾기 인증번호 미입력 알림입니다.', 750],
            ['find_auth', 'messages', 'text', 'pw_verified', '비밀번호 찾기 인증 성공 알림', '인증 성공! 새로운 비밀번호를 설정해주세요.', '비밀번호 찾기 인증 성공 알림입니다.', 760],
            ['find_auth', 'messages', 'text', 'code_mismatch', '계정 찾기 인증번호 불일치 알림', '인증번호가 일치하지 않습니다.', '계정 찾기 인증번호 불일치 알림입니다.', 770],
            ['find_auth', 'messages', 'text', 'id_fetch_failed', '아이디 찾기 실패 알림', '계정을 찾을 수 없습니다.', '아이디 찾기 결과 조회 실패 알림입니다.', 780],
            ['find_auth', 'messages', 'text', 'invalid_password', '비밀번호 재설정 형식 알림', '비밀번호는 영문, 숫자, 기호(@!.,-_) 포함 8~15자여야 합니다.', '비밀번호 재설정 형식 오류 알림입니다.', 790],
            ['find_auth', 'messages', 'text', 'password_mismatch', '비밀번호 재설정 불일치 알림', '비밀번호가 일치하지 않습니다.', '비밀번호 재설정 확인 불일치 알림입니다.', 800],
            ['find_auth', 'messages', 'text', 'reset_success', '비밀번호 재설정 성공 알림', '비밀번호가 성공적으로 변경되었습니다. 새로운 비밀번호로 로그인해주세요.', '비밀번호 재설정 성공 알림입니다.', 810],
            ['find_auth', 'messages', 'text', 'reset_failed', '비밀번호 재설정 실패 알림', '비밀번호 변경에 실패했습니다.', '비밀번호 재설정 실패 알림입니다.', 820],
            ['change_pw', 'page', 'text', 'title', '비밀번호 변경 제목', '비밀번호 변경(본인 인증)', '비밀번호 변경 화면 제목입니다.', 100],
            ['change_pw', 'email', 'text', 'label', '비밀번호 변경 이메일 라벨', '가입된 이메일 주소', '비밀번호 변경 이메일 입력 라벨입니다.', 200],
            ['change_pw', 'email', 'text', 'verified_label', '비밀번호 변경 이메일 인증 완료 표시', '인증완료', '비밀번호 변경 이메일 인증 완료 상태 문구입니다.', 210],
            ['change_pw', 'email', 'text', 'placeholder', '비밀번호 변경 이메일 입력 안내', '계정에 등록한 이메일 입력', '비밀번호 변경 이메일 placeholder입니다.', 220],
            ['change_pw', 'email', 'text', 'send_code_button', '비밀번호 변경 인증요청 버튼', '인증요청', '비밀번호 변경 인증번호 요청 버튼명입니다.', 230],
            ['change_pw', 'email', 'text', 'resend_button', '비밀번호 변경 재전송 버튼', '재전송', '비밀번호 변경 인증번호 재전송 버튼명입니다.', 240],
            ['change_pw', 'email', 'text', 'code_label', '비밀번호 변경 인증번호 라벨', '인증번호 입력', '비밀번호 변경 인증번호 입력 라벨입니다.', 250],
            ['change_pw', 'email', 'text', 'remaining_time_label', '비밀번호 변경 남은 시간 라벨', '남은시간', '비밀번호 변경 인증 남은 시간 라벨입니다.', 260],
            ['change_pw', 'email', 'text', 'code_placeholder', '비밀번호 변경 인증번호 입력 안내', '숫자 6자리', '비밀번호 변경 인증번호 placeholder입니다.', 270],
            ['change_pw', 'email', 'text', 'confirm_button', '비밀번호 변경 인증 확인 버튼', '확인', '비밀번호 변경 인증번호 확인 버튼명입니다.', 280],
            ['change_pw', 'email', 'text', 'hcaptcha_label', '비밀번호 변경 보안 확인 문구', '비밀번호 변경 인증메일 보안 확인', '비밀번호 변경 hCaptcha 안내문입니다.', 290],
            ['change_pw', 'password', 'text', 'new_label', '비밀번호 변경 새 비밀번호 라벨', '새 비밀번호 (영문+숫자+기호 8~15자)', '비밀번호 변경 새 비밀번호 라벨입니다.', 300],
            ['change_pw', 'password', 'text', 'new_placeholder', '비밀번호 변경 새 비밀번호 입력 안내', '새 비밀번호 입력', '비밀번호 변경 새 비밀번호 placeholder입니다.', 310],
            ['change_pw', 'password', 'text', 'confirm_label', '비밀번호 변경 확인 라벨', '새 비밀번호 확인', '비밀번호 변경 확인 입력 라벨입니다.', 320],
            ['change_pw', 'password', 'text', 'confirm_placeholder', '비밀번호 변경 확인 입력 안내', '비밀번호 재입력', '비밀번호 변경 확인 placeholder입니다.', 330],
            ['change_pw', 'password', 'text', 'show_label', '비밀번호 변경 보기 버튼', '보기', '비밀번호 변경 비밀번호 보기 버튼명입니다.', 340],
            ['change_pw', 'password', 'text', 'hide_label', '비밀번호 변경 숨김 버튼', '숨김', '비밀번호 변경 비밀번호 숨김 버튼명입니다.', 350],
            ['change_pw', 'password', 'text', 'show_title', '비밀번호 변경 보기 설명', '비밀번호 표시', '비밀번호 변경 비밀번호 보기 버튼 title입니다.', 360],
            ['change_pw', 'password', 'text', 'hide_title', '비밀번호 변경 숨김 설명', '비밀번호 숨기기', '비밀번호 변경 비밀번호 숨김 버튼 title입니다.', 370],
            ['change_pw', 'buttons', 'text', 'cancel', '비밀번호 변경 취소 버튼', '취소', '비밀번호 변경 취소 버튼명입니다.', 400],
            ['change_pw', 'buttons', 'text', 'submit', '비밀번호 변경 제출 버튼', '변경 완료', '비밀번호 변경 제출 버튼명입니다.', 410],
            ['change_pw', 'messages', 'text', 'auth_required', '비밀번호 변경 로그인 필요 알림', '로그인이 필요한 서비스입니다.', '비밀번호 변경 미로그인 접근 알림입니다.', 500],
            ['change_pw', 'messages', 'text', 'need_email', '비밀번호 변경 이메일 미입력 알림', '가입할 때 등록한 이메일을 입력해주세요.', '비밀번호 변경 이메일 미입력 알림입니다.', 510],
            ['change_pw', 'messages', 'text', 'code_sent', '비밀번호 변경 인증번호 발송 알림', '인증번호가 발송되었습니다. 유효시간 2분 안에 입력해주세요.', '비밀번호 변경 인증번호 발송 성공 알림입니다.', 520],
            ['change_pw', 'messages', 'text', 'code_send_failed', '비밀번호 변경 인증번호 발송 실패 알림', '메일 전송에 실패했습니다. 이메일을 다시 확인해주세요.', '비밀번호 변경 인증번호 발송 실패 알림입니다.', 530],
            ['change_pw', 'messages', 'text', 'code_expired', '비밀번호 변경 인증 만료 알림', '인증 시간이 만료되었습니다.', '비밀번호 변경 인증 시간 만료 알림입니다.', 540],
            ['change_pw', 'messages', 'text', 'need_code', '비밀번호 변경 인증번호 미입력 알림', '인증번호를 입력해주세요.', '비밀번호 변경 인증번호 미입력 알림입니다.', 550],
            ['change_pw', 'messages', 'text', 'email_verified', '비밀번호 변경 이메일 인증 완료 알림', '본인 인증이 완료되었습니다. 새 비밀번호를 설정해주세요.', '비밀번호 변경 이메일 인증 완료 알림입니다.', 560],
            ['change_pw', 'messages', 'text', 'code_mismatch', '비밀번호 변경 인증번호 불일치 알림', '인증번호가 일치하지 않습니다.', '비밀번호 변경 인증번호 불일치 알림입니다.', 570],
            ['change_pw', 'messages', 'text', 'need_email_verify', '비밀번호 변경 이메일 인증 필요 알림', '이메일 본인 인증을 먼저 완료해주세요.', '비밀번호 변경 이메일 인증 필요 알림입니다.', 580],
            ['change_pw', 'messages', 'text', 'invalid_password', '비밀번호 변경 형식 알림', '비밀번호는 영문, 숫자, 기호(@, !, ,, ., -, _)가 모두 포함된 8~15자리여야 합니다.', '비밀번호 변경 비밀번호 형식 오류 알림입니다.', 590],
            ['change_pw', 'messages', 'text', 'password_mismatch', '비밀번호 변경 불일치 알림', '새 비밀번호가 일치하지 않습니다.', '비밀번호 변경 확인 불일치 알림입니다.', 600],
            ['change_pw', 'messages', 'text', 'update_success', '비밀번호 변경 성공 알림', '비밀번호가 안전하게 변경되었습니다. 새로운 비밀번호로 다시 로그인해주세요.', '비밀번호 변경 성공 알림입니다.', 610],
            ['change_pw', 'messages', 'text', 'update_failed', '비밀번호 변경 실패 알림', '비밀번호 변경에 실패했습니다.', '비밀번호 변경 실패 알림입니다.', 620],
            ['mypage', 'page', 'text', 'title', '마이페이지 제목', '마이페이지', '마이페이지 화면 제목입니다.', 100],
            ['mypage', 'page', 'text', 'greeting', '마이페이지 환영 문구', '반갑습니다, {name} 님!', '마이페이지 사용자 환영 문구입니다. {name}을 사용할 수 있습니다.', 110],
            ['mypage', 'page', 'text', 'default_user_name', '마이페이지 기본 사용자명', '회원', '사용자명이 없을 때 표시할 기본 이름입니다.', 120],
            ['mypage', 'page', 'text', 'change_pw_button', '마이페이지 비밀번호 변경 버튼', '비밀번호 변경', '마이페이지 비밀번호 변경 이동 버튼명입니다.', 130],
            ['mypage', 'loading', 'text', 'user_data', '마이페이지 로딩 문구', '사용자 데이터를 불러오는 중입니다...', '마이페이지 사용자 정보 로딩 문구입니다.', 200],
            ['mypage', 'error', 'text', 'title', '마이페이지 오류 제목', '오류 발생', '마이페이지 오류 박스 제목입니다.', 300],
            ['mypage', 'error', 'text', 'empty_user', '마이페이지 사용자 정보 없음 문구', '유저 정보를 표시할 수 없습니다.', '마이페이지 사용자 정보 없음 안내문입니다.', 310],
            ['mypage', 'error', 'text', 'home_button', '마이페이지 홈 이동 버튼', '메인 화면으로 돌아가기', '마이페이지 오류 화면 홈 이동 버튼명입니다.', 320],
            ['mypage', 'dday', 'text', 'title', '마이페이지 D-Day 제목', '목표 시험일 설정', '마이페이지 D-Day 영역 제목입니다.', 400],
            ['mypage', 'dday', 'text', 'empty_text', '마이페이지 D-Day 미설정 문구', '설정된 D-Day가 없습니다.', '마이페이지 D-Day 미설정 안내문입니다.', 410],
            ['mypage', 'dday', 'text', 'today_text', '마이페이지 D-Day 당일 문구', 'D-Day (오늘입니다!)', '마이페이지 D-Day 당일 표시 문구입니다.', 420],
            ['mypage', 'dday', 'text', 'year_placeholder', '마이페이지 D-Day 연도 선택 안내', '연도', '마이페이지 D-Day 연도 선택 placeholder입니다.', 430],
            ['mypage', 'dday', 'text', 'month_placeholder', '마이페이지 D-Day 월 선택 안내', '월', '마이페이지 D-Day 월 선택 placeholder입니다.', 440],
            ['mypage', 'dday', 'text', 'day_placeholder', '마이페이지 D-Day 일 선택 안내', '일', '마이페이지 D-Day 일 선택 placeholder입니다.', 450],
            ['mypage', 'dday', 'text', 'year_option', '마이페이지 D-Day 연도 옵션 형식', '{value}년', '마이페이지 D-Day 연도 옵션 표시 형식입니다. {value}를 사용할 수 있습니다.', 460],
            ['mypage', 'dday', 'text', 'month_option', '마이페이지 D-Day 월 옵션 형식', '{value}월', '마이페이지 D-Day 월 옵션 표시 형식입니다. {value}를 사용할 수 있습니다.', 470],
            ['mypage', 'dday', 'text', 'day_option', '마이페이지 D-Day 일 옵션 형식', '{value}일', '마이페이지 D-Day 일 옵션 표시 형식입니다. {value}를 사용할 수 있습니다.', 480],
            ['mypage', 'dday', 'text', 'save_button', '마이페이지 D-Day 저장 버튼', 'D-Day 저장하기', '마이페이지 D-Day 저장 버튼명입니다.', 490],
            ['mypage', 'wrong_notes', 'text', 'title', '마이페이지 오답노트 제목', '오답노트 관리', '마이페이지 오답노트 영역 제목입니다.', 500],
            ['mypage', 'wrong_notes', 'text', 'desc', '마이페이지 오답노트 설명', '필기/실기와 문제은행/기출문제를 구분해서 원하는 오답만 복습할 수 있습니다.', '마이페이지 오답노트 영역 설명입니다.', 510],
            ['mypage', 'wrong_notes', 'text', 'written_random_title', '마이페이지 필기 문제은행 오답 카드 제목', '필기 문제은행 오답', '마이페이지 필기 문제은행 오답 카드 제목입니다.', 520],
            ['mypage', 'wrong_notes', 'text', 'written_past_title', '마이페이지 필기 기출문제 오답 카드 제목', '필기 기출문제 오답', '마이페이지 필기 기출문제 오답 카드 제목입니다.', 530],
            ['mypage', 'wrong_notes', 'text', 'ipep_random_title', '마이페이지 실기 문제은행 오답 카드 제목', '실기 문제은행 오답', '마이페이지 실기 문제은행 오답 카드 제목입니다.', 540],
            ['mypage', 'wrong_notes', 'text', 'ipep_past_title', '마이페이지 실기 기출문제 오답 카드 제목', '실기 기출문제 오답', '마이페이지 실기 기출문제 오답 카드 제목입니다.', 550],
            ['mypage', 'wrong_notes', 'text', 'count_label', '마이페이지 오답 개수 표시 형식', '{count}개', '마이페이지 오답 개수 표시 형식입니다. {count}를 사용할 수 있습니다.', 560],
            ['mypage', 'wrong_notes', 'text', 'review_button', '마이페이지 오답 복습 버튼', '복습하기', '마이페이지 오답노트 복습 버튼명입니다.', 570],
            ['mypage', 'history', 'text', 'title', '마이페이지 접속 기록 제목', '최근 접속 기록', '마이페이지 접속 기록 영역 제목입니다.', 600],
            ['mypage', 'history', 'text', 'login_action', '마이페이지 로그인 기록 라벨', '로그인', '마이페이지 접속 기록 로그인 라벨입니다.', 610],
            ['mypage', 'history', 'text', 'logout_action', '마이페이지 로그아웃 기록 라벨', '로그아웃', '마이페이지 접속 기록 로그아웃 라벨입니다.', 620],
            ['mypage', 'history', 'text', 'default_action', '마이페이지 기본 기록 라벨', '기록', '마이페이지 접속 기록 기본 라벨입니다.', 630],
            ['mypage', 'history', 'text', 'empty_text', '마이페이지 접속 기록 없음 문구', '기록이 없습니다.', '마이페이지 접속 기록 없음 안내문입니다.', 640],
            ['mypage', 'delete', 'text', 'button', '마이페이지 회원 탈퇴 버튼', '회원 탈퇴', '마이페이지 회원 탈퇴 버튼명입니다.', 700],
            ['mypage', 'delete', 'text', 'first_confirm', '마이페이지 회원 탈퇴 1차 확인', '탈퇴를 하게되면 활동정보를 복구하실 수 없습니다. 탈퇴를 진행하시겠습니까?', '마이페이지 회원 탈퇴 1차 확인 문구입니다.', 710],
            ['mypage', 'delete', 'text', 'password_prompt', '마이페이지 회원 탈퇴 비밀번호 입력 안내', '본인 확인을 위해 비밀번호를 입력해주세요.', '마이페이지 회원 탈퇴 비밀번호 입력 prompt 문구입니다.', 720],
            ['mypage', 'delete', 'text', 'second_confirm', '마이페이지 회원 탈퇴 2차 확인', '비밀번호가 일치합니다. 탈퇴를 계속 진행하시겠습니까?', '마이페이지 회원 탈퇴 2차 확인 문구입니다.', 730],
            ['mypage', 'delete', 'text', 'thanks_message', '마이페이지 회원 탈퇴 완료 감사 문구', '그동안 이용해주셔서 감사합니다.', '마이페이지 회원 탈퇴 완료 알림입니다.', 740],
            ['mypage', 'delete', 'text', 'password_failed', '마이페이지 회원 탈퇴 비밀번호 실패 알림', '비밀번호가 일치하지 않습니다. 확인 후 다시 진행해주세요.', '마이페이지 회원 탈퇴 비밀번호 실패 알림입니다.', 750],
            ['mypage', 'messages', 'text', 'login_required', '마이페이지 로그인 필요 알림', '로그인이 필요합니다.', '마이페이지 미로그인 접근 알림입니다.', 800],
            ['mypage', 'messages', 'text', 'user_not_found', '마이페이지 사용자 정보 없음 알림', '유저 정보를 찾을 수 없습니다.', '마이페이지 사용자 정보 없음 내부 알림입니다.', 810],
            ['mypage', 'messages', 'text', 'session_expired', '마이페이지 세션 만료 알림', '서버와 연결할 수 없거나, 세션이 만료되었습니다.', '마이페이지 사용자 정보 로딩 실패 문구입니다.', 820],
            ['mypage', 'messages', 'text', 'need_dday', '마이페이지 D-Day 선택 누락 알림', '연도, 월, 일을 모두 선택해주세요.', '마이페이지 D-Day 선택 누락 알림입니다.', 830],
            ['mypage', 'messages', 'text', 'dday_saved', '마이페이지 D-Day 저장 성공 알림', 'D-Day가 저장되었습니다.', '마이페이지 D-Day 저장 성공 알림입니다.', 840],
            ['mypage', 'messages', 'text', 'save_failed', '마이페이지 저장 실패 알림', '저장 실패', '마이페이지 저장 실패 알림입니다.', 850],
        ];

        const faqDefaultItemsNoHardcodeV1 = [
            ['서비스 이용', '우공실은 어떤 서비스인가요?', '우공실은 정보처리기사 필기와 실기 학습을 한 화면에서 관리할 수 있는 시험 대비 서비스입니다.\n필기 문제은행, 필기 기출문제, 실기 문제은행, 실기 기출문제, 오답노트, 게시판, FAQ를 제공합니다.'],
            ['계정/로그인', '회원가입과 로그인이 필요한 이유는 무엇인가요?', '문제 풀이 기록, 오답노트, 랭킹, 게시판 이용 기록을 개인별로 저장하기 위해 로그인이 필요합니다.\n로그인하면 PC를 새로고침하거나 다시 접속해도 본인의 학습 흐름을 이어갈 수 있습니다.'],
            ['계정/로그인', '비밀번호를 잊어버렸을 때는 어떻게 해야 하나요?', '로그인 화면의 비밀번호 찾기 기능을 이용해 주세요.\n가입 시 사용한 이메일 인증을 통해 비밀번호 재설정 절차를 진행할 수 있습니다.'],
            ['계정/로그인', '로그인 유지 시간은 얼마나 되나요?', '상단 상태 영역에서 남은 로그인 유지 시간을 확인할 수 있습니다.\n시간이 만료되면 자동으로 로그아웃될 수 있으니, 시험 응시 중에는 남은 시간을 확인해 주세요.'],
            ['계정/로그인', '다른 기기에서도 중복 로그인이 가능한가요?', '계정 보안을 위해 같은 계정으로 여러 환경에서 접속할 경우 이전 세션이 만료될 수 있습니다.\n시험 응시 중에는 한 기기에서만 안정적으로 접속하는 것을 권장합니다.'],
            ['필기문제', '필기 문제은행과 필기 기출문제는 어떤 차이가 있나요?', '필기 문제은행은 과목별 랜덤 문제를 풀며 개념을 반복 학습하는 기능입니다.\n필기 기출문제는 연도와 회차를 선택해 실제 시험처럼 응시하는 기능입니다.'],
            ['필기문제', '필기 기출문제 응시 중 페이지를 벗어날 수 있나요?', '기출문제 응시 중에는 시험 흐름 유지를 위해 이탈 경고가 표시될 수 있습니다.\n실수로 페이지를 닫거나 뒤로 가기를 누르지 않도록 주의해 주세요.'],
            ['필기문제', '필기 문제에서 오류를 발견하면 어떻게 하나요?', '문제 풀이 화면의 오류신고 버튼을 이용하거나 게시판에 내용을 남겨 주세요.\n문제 번호, 보기, 정답, 의심되는 이유를 함께 적어주시면 확인이 빠릅니다.'],
            ['필기문제', '필기 기출문제를 다시 풀면 기록은 어떻게 반영되나요?', '같은 연도와 같은 회차를 다시 응시하면 최신 제출 결과가 기준으로 반영됩니다.\n랭킹과 점수 확인은 마지막으로 제출한 결과를 기준으로 보는 것이 가장 정확합니다.'],
            ['실기문제', '실기 문제은행과 실기 기출문제는 어떤 차이가 있나요?', '실기 문제은행은 과목별 랜덤 문제 또는 전체 과목 섞기 방식으로 단답형 문제를 빠르게 연습하는 기능입니다.\n실기 기출문제는 연도와 회차를 선택해 실제 시험처럼 20문제를 풀고 최종 결과를 확인하는 기능입니다.'],
            ['실기문제', '실기 답안은 어떤 방식으로 입력해야 하나요?', '문제에서 요구하는 답안을 입력칸에 작성하면 됩니다.\n여러 답을 요구하는 문제는 쉼표(,) 또는 줄바꿈으로 구분해 입력하는 것이 좋습니다.\n코드 출력형이나 SQL형 문제는 채점유형에 따라 공백, 줄바꿈, 문법 기호가 중요할 수 있습니다.'],
            ['실기문제', '실기 문제는 모두 자동 채점되나요?', '대부분의 단답형, 용어형, SQL형, 코드 출력형 문제는 자동 채점됩니다.\n다만 긴 서술형처럼 자동 판정이 어려운 문제는 SELF_CHECK 방식으로 제공될 수 있으며, 이 경우 정답 예시를 보고 직접 확인해야 합니다.'],
            ['실기문제', '실기 기출문제는 실제 시험처럼 점수가 계산되나요?', '실기 기출문제는 회차별 20문제 기준으로 응시하며, 문제별 배점과 채점 결과를 바탕으로 점수가 계산됩니다.\n부분점수가 있는 문제는 채점 결과에 따라 일부 점수만 반영될 수 있습니다.'],
            ['실기문제', '실기 기출문제를 다시 풀면 기록은 어떻게 반영되나요?', '같은 연도와 같은 회차를 다시 응시하면 최신 제출 결과가 기준으로 반영됩니다.\n랭킹과 점수 확인은 마지막으로 제출한 결과를 기준으로 보는 것이 가장 정확합니다.'],
            ['실기 채점유형', '실기 채점유형은 무엇인가요?', '실기 문제는 문제 성격에 따라 채점 기준이 다르게 적용됩니다.\n현재 사용되는 채점유형은 FLEX_TERM, MULTI_TERM, EXACT_OUTPUT, SQL_TEXT, SELF_CHECK입니다.\n문제 화면의 채점유형 표시는 답안을 어떤 기준으로 입력해야 하는지 알려주는 안내 역할을 합니다.'],
            ['실기 채점유형', 'FLEX_TERM 채점유형은 무엇인가요?', 'FLEX_TERM은 일반 용어형 단답 문제에 사용하는 유연 채점 방식입니다.\n영어 대소문자, 공백, 쉼표, 하이픈, 일부 문장부호 차이를 완화해서 비교합니다.\n예를 들어 용어의 핵심 철자와 의미가 맞으면 표기 방식이 조금 달라도 정답으로 인정될 수 있습니다.\n단, 아예 다른 용어이거나 핵심 단어가 빠진 경우에는 오답 처리될 수 있습니다.'],
            ['실기 채점유형', 'MULTI_TERM 채점유형은 무엇인가요?', 'MULTI_TERM은 정답이 여러 개인 문제에 사용하는 복수 용어 채점 방식입니다.\n여러 답안을 쉼표(,) 또는 줄바꿈으로 구분해 입력하면 각 항목을 나누어 채점합니다.\n정답 중 일부만 맞힌 경우에는 문제 설정에 따라 부분점수가 반영될 수 있습니다.\n답안 순서가 중요하지 않은 문제라면 핵심 항목이 포함되어 있는지가 더 중요합니다.'],
            ['실기 채점유형', 'EXACT_OUTPUT 채점유형은 무엇인가요?', 'EXACT_OUTPUT은 코드 실행 결과처럼 출력값이 정확해야 하는 문제에 사용하는 채점 방식입니다.\n대소문자, 공백, 줄바꿈, 기호가 결과에 영향을 줄 수 있으므로 문제에서 요구한 출력 형태를 최대한 그대로 입력해야 합니다.\n앞뒤 불필요한 공백 정도는 정리되지만, 중간 출력 형식이 다르면 오답 처리될 수 있습니다.'],
            ['실기 채점유형', 'SQL_TEXT 채점유형은 무엇인가요?', 'SQL_TEXT는 SQL 작성 문제에 사용하는 채점 방식입니다.\nSQL 키워드의 대소문자 차이, 여러 칸 공백, 마지막 세미콜론 유무는 비교 시 완화될 수 있습니다.\n하지만 SELECT, FROM, WHERE, JOIN, 괄호, 쉼표, 비교연산자 같은 문법 구조는 중요합니다.\n정답과 같은 의미의 SQL이라도 현재 채점 기준과 문법 구조가 크게 다르면 오답 처리될 수 있습니다.'],
            ['실기 채점유형', 'SELF_CHECK 채점유형은 무엇인가요?', 'SELF_CHECK는 자동 채점이 어려운 서술형 문제에 사용하는 자기 확인 방식입니다.\n답안을 작성한 뒤 정답 예시와 해설을 보고 본인이 맞음, 틀림, 부분 인정 여부를 확인하는 흐름입니다.\n긴 설명형 문제는 표현이 다양할 수 있으므로 핵심 키워드와 논리가 들어갔는지 확인해 주세요.'],
            ['실기 채점유형', '실기 답안 작성 시 가장 안전한 방법은 무엇인가요?', '용어형은 핵심 용어를 정확히 쓰고, 여러 답은 쉼표 또는 줄바꿈으로 구분해 주세요.\n코드 출력형은 출력 결과를 그대로 작성하고, SQL형은 문법 기호와 조건식을 정확히 작성하는 것이 좋습니다.\n서술형은 정답 예시와 비교할 수 있도록 핵심 키워드와 이유를 빠뜨리지 않는 것이 좋습니다.'],
            ['오답노트', '오답노트에는 어떤 문제가 저장되나요?', '틀린 문제 또는 복습이 필요한 문제를 오답노트에서 다시 확인할 수 있습니다.\n오답노트는 필기 문제은행, 필기 기출문제, 실기 문제은행, 실기 기출문제로 구분해 관리됩니다.'],
            ['오답노트', '기출문제 오답은 어떻게 복습하나요?', '마이페이지의 오답노트에서 기출문제 탭을 선택한 뒤 연도와 회차를 필터링하면 됩니다.\n필기와 실기 기출 오답은 각각 따로 복습할 수 있습니다.'],
            ['오답노트', '오답노트를 삭제할 수 있나요?', '오답노트 화면에서 현재 오답을 삭제하거나, 탭별 전체 삭제 기능을 사용할 수 있습니다.\n삭제한 기록은 복구가 어려울 수 있으니 필요한 오답인지 먼저 확인해 주세요.'],
            ['랭킹', '랭킹은 언제 운영되나요?', '랭킹은 서버 로컬 시간 기준으로 매일 00시 00분 00초부터 23시 59분 59초까지 24시간 운영됩니다.\n프리시즌 없이 하루 단위로 계속 갱신되며, 날짜가 바뀌면 해당 날짜 랭킹으로 새로 집계됩니다.'],
            ['랭킹', '프리시즌에는 랭킹이 어떻게 보이나요?', '프리시즌은 폐지되었습니다.\n필기 문제은행, 필기 기출문제, 실기 문제은행, 실기 기출문제 모두 24시간 랭킹에 바로 반영됩니다.'],
            ['랭킹', '실기 문제은행 랭킹은 어떻게 계산되나요?', '실기 문제은행은 사용자가 푼 문제 수와 맞힌 문제 수가 누적되어 정답률이 계산됩니다.\n예를 들어 총 5문제를 풀고 3문제를 맞히면 정답률은 60%이며, 화면에는 60% (3/5) 형태로 표시될 수 있습니다.'],
            ['랭킹', '실기 기출문제 랭킹은 어떻게 계산되나요?', '실기 기출문제는 회차별 20문제 응시 결과를 기준으로 반영됩니다.\n부분점수가 있는 문제는 점수에는 부분점수가 반영되고, 정답률 계산에서는 채점된 문제 기준으로 맞힌 개수를 반영합니다.\n같은 회차를 다시 제출하면 최신 제출 결과가 랭킹에 반영됩니다.'],
            ['게시판', '게시판에는 어떤 글을 남기면 되나요?', '오류 신고, 문제 정정 요청, 기능 개선 의견, 공지 확인과 관련된 글을 남길 수 있습니다.\n문제 오류를 제보할 때는 문제 페이지의 오류신고 버튼을 이용하시거나 게시판에 메뉴, 연도, 회차, 문제 번호를 함께 적어주시면 좋습니다.'],
            ['게시판', '공지사항은 꼭 확인해야 하나요?', '기출문제 응시, 실기 기능 업데이트, 데이터 수정, 시험 운영 방식 변경은 공지사항으로 안내될 수 있습니다.\n특히 기출문제 응시 전에는 공지사항을 한 번 확인하는 것을 권장합니다.'],
            ['화면/테마', '다크모드와 라이트모드는 어떻게 바꾸나요?', '화면 상단의 다크/라이트 토글 버튼을 눌러 테마를 바꿀 수 있습니다.\n선택한 테마는 여러 페이지에서 동일하게 적용되도록 구성되어 있습니다.'],
            ['화면/테마', '모바일에서도 사용할 수 있나요?', '모바일에서도 접속할 수 있지만, 기출문제 응시와 결과 확인은 화면이 넓은 PC 환경에서 더 편하게 사용할 수 있습니다.\n장문 답안을 작성해야 하는 실기 문제는 화면모드를 가로모드로 변경하시거나 키보드가 있는 환경을 권장합니다.'],
            ['화면/테마', '글씨가 잘 보이지 않을 때는 어떻게 하나요?', '먼저 다크모드와 라이트모드를 전환해 보고, 브라우저 확대 비율을 100%로 맞춰 주세요.\n특정 페이지에서만 글씨가 흐리거나 보이지 않는다면 그 부분을 게시판에 알려 주세요.'],
            ['계정/로그인', '회원가입 후 바로 로그인할 수 있나요?', '신규 회원가입은 관리자 승인 후 이용할 수 있습니다.\n승인되면 가입한 이메일로 승인 안내가 발송되고, 거절된 경우에는 거절 사유가 함께 안내됩니다.\n기존 회원은 별도 승인 절차 없이 이전처럼 계속 이용할 수 있습니다.'],
            ['필기/실기 문제은행', '문제은행 랜덤 문제는 같은 문제가 바로 반복되나요?', '문제은행은 최근에 푼 문제와 과목을 우선 피해서 다음 문제를 가져오도록 개선되었습니다.\n다만 문제 수가 부족한 경우에는 조건을 자동으로 완화해 학습이 막히지 않도록 처리됩니다.'],
            ['회식맵', '회식맵 장소를 제보하면 바로 공개되나요?', '신규 장소 제보는 관리자 승인 없이 바로 회식맵에 공개됩니다.\n이미 등록된 장소의 수정 요청이나 삭제 요청은 관리자 또는 최고관리자 검토 후 반영됩니다.'],
            ['회식맵', '회식맵 장소 등록 시 카테고리는 어떻게 입력하나요?', '카카오 지도 검색으로 장소를 선택하면 가져올 수 있는 카테고리 정보를 우선 사용합니다.\n직접 입력할 때는 한 글자나 초성을 입력하면 한식, 한정식처럼 관련 카테고리 추천을 확인할 수 있습니다.'],
            ['회식맵', '대표메뉴, 영업시간, 가격도 자동으로 채워지나요?', '카카오 지도 API에서 기본으로 제공되는 장소명, 주소, 좌표, 전화번호, 카테고리 같은 정보는 자동 입력에 활용할 수 있습니다.\n대표메뉴, 영업시간, 최소가격, 최대가격처럼 API 응답에 없는 정보는 사용자가 직접 입력해야 합니다.'],
            ['화면/테마', '화면 밝기는 어떻게 조절하나요?', '상단의 밝기 슬라이더로 10%부터 100%까지 10% 단위로 조절할 수 있습니다.\n처음 기본값은 50%이며, 사이트를 닫기 전까지 같은 브라우저 화면에서 설정이 유지됩니다.'],
        ];

        const faqScreenSettingDefaultsNoHardcodeV1 = [
            ['faq', 'page', 'text', 'title', 'FAQ 제목', '자주 묻는 질문 (FAQ)', 'FAQ 화면 제목입니다.', 100],
            ['faq', 'page', 'text', 'desc', 'FAQ 설명', '직접 정보를 찾아보거나 하단의 검색창에 분류 또는 키워드를 입력하여 원하는 정보를 찾을 수 있습니다.', 'FAQ 화면 설명문입니다.', 110],
            ['faq', 'table', 'text', 'no_header', 'FAQ 번호 헤더', 'No', 'FAQ 표 번호 헤더입니다.', 200],
            ['faq', 'table', 'text', 'category_header', 'FAQ 분류 헤더', '분류', 'FAQ 표 분류 헤더입니다.', 210],
            ['faq', 'table', 'text', 'question_header', 'FAQ 질문 헤더', '질문', 'FAQ 표 질문 헤더입니다.', 220],
            ['faq', 'table', 'text', 'action_header', 'FAQ 보기 헤더', '보기', 'FAQ 표 보기 헤더입니다.', 230],
            ['faq', 'table', 'text', 'question_prefix', 'FAQ 질문 접두어', 'Q.', 'FAQ 질문 앞에 붙는 접두어입니다.', 240],
            ['faq', 'table', 'text', 'answer_prefix', 'FAQ 답변 접두어', 'A.', 'FAQ 답변 앞에 붙는 접두어입니다.', 250],
            ['faq', 'table', 'text', 'open_button', 'FAQ 열기 버튼', '열기', 'FAQ 답변 열기 버튼명입니다.', 260],
            ['faq', 'table', 'text', 'close_button', 'FAQ 닫기 버튼', '닫기', 'FAQ 답변 닫기 버튼명입니다.', 270],
            ['faq', 'pagination', 'text', 'aria_label', 'FAQ 페이지 이동 접근성 라벨', 'FAQ 페이지 이동', 'FAQ 페이지네이션 접근성 라벨입니다.', 300],
            ['faq', 'search', 'text', 'placeholder', 'FAQ 검색 입력 안내', '검색어를 입력하세요. 예: 오답노트, 기출문제, 로그인, 게시판', 'FAQ 검색 입력 placeholder입니다.', 400],
            ['faq', 'search', 'text', 'submit_button', 'FAQ 검색 버튼', '검색', 'FAQ 검색 버튼명입니다.', 410],
            ['faq', 'search', 'text', 'reset_button', 'FAQ 검색 초기화 버튼', '초기화', 'FAQ 검색 초기화 버튼명입니다.', 420],
            ['faq', 'search', 'text', 'empty_result', 'FAQ 검색 결과 없음 문구', '검색 결과가 없습니다. 다른 검색어로 다시 시도해 주세요.', 'FAQ 검색 결과가 없을 때 표시하는 문구입니다.', 430],
            ['faq', 'search', 'text', 'result_text', 'FAQ 검색 결과 표시 형식', '“{keyword}” 검색 결과: {count}건', 'FAQ 검색 결과 표시 형식입니다. {keyword}, {count}를 사용할 수 있습니다.', 440],
            ...faqDefaultItemsNoHardcodeV1.flatMap(([category, question, answer], index) => {
                const itemNo = String(index + 1).padStart(3, '0');
                const sectionKey = `item_${itemNo}`;
                const sortOrder = 1000 + (index * 10);

                return [
                    ['faq', sectionKey, 'text', 'category', `FAQ ${itemNo} 분류`, category, `FAQ ${itemNo} 항목의 분류입니다.`, sortOrder],
                    ['faq', sectionKey, 'text', 'question', `FAQ ${itemNo} 질문`, question, `FAQ ${itemNo} 항목의 질문입니다.`, sortOrder + 1],
                    ['faq', sectionKey, 'text', 'answer', `FAQ ${itemNo} 답변`, answer, `FAQ ${itemNo} 항목의 답변입니다.`, sortOrder + 2],
                ];
            }),
        ];

        screenSettingDefaultsNoHardcodeV1.push(...faqScreenSettingDefaultsNoHardcodeV1);

        const boardScreenSettingDefaultsNoHardcodeV1 = [
            ['board', 'tabs', 'text', 'notice_label', '게시판 탭 - 공지게시판', '공지게시판', '게시판 공지 탭 표시명입니다.', 100],
            ['board', 'tabs', 'text', 'free_label', '게시판 탭 - 자유게시판', '자유게시판', '게시판 자유 탭 표시명입니다.', 110],
            ['board', 'guide', 'text', 'notice', '공지게시판 안내문', '공지게시판은 우공실 공식 안내를 확인하는 공간입니다.', '공지게시판 목록 안내문입니다.', 200],
            ['board', 'guide', 'text', 'free', '자유게시판 안내문', '자유게시판은 질문, 오류 제보, 학습 정보 공유, 개선 의견을 자유롭게 남길 수 있습니다.', '자유게시판 목록 안내문입니다.', 210],
            ['board', 'common', 'text', 'cancel', '공통 취소 버튼', '취소', '게시판 공통 취소 버튼명입니다.', 300],
            ['board', 'common', 'text', 'delete', '공통 삭제 버튼', '삭제', '게시판 공통 삭제 버튼명입니다.', 310],
            ['board', 'common', 'text', 'edit', '공통 수정 버튼', '수정', '게시판 공통 수정 버튼명입니다.', 320],
            ['board', 'common', 'text', 'submit', '공통 등록 버튼', '등록', '게시판 공통 등록 버튼명입니다.', 330],
            ['board', 'common', 'text', 'back_to_list', '목록 이동 버튼', ' 목록으로', '게시판 목록으로 돌아가기 버튼명입니다.', 340],
            ['board', 'list', 'text', 'page_title', '게시판 목록 제목 형식', ' {board}', '게시판 목록 제목 형식입니다. {board}를 사용할 수 있습니다.', 400],
            ['board', 'list', 'text', 'my_activity_button', '내 활동 버튼', '내가 작성한 글/댓글', '게시판 목록의 내 활동 버튼명입니다.', 410],
            ['board', 'list', 'text', 'write_button', '게시글 작성 버튼', '게시글 등록', '게시판 목록의 게시글 작성 버튼명입니다.', 420],
            ['board', 'table', 'text', 'no_header', '게시판 표 번호 헤더', 'No', '게시판 목록 번호 헤더입니다.', 500],
            ['board', 'table', 'text', 'title_header', '게시판 표 제목 헤더', '제목', '게시판 목록 제목 헤더입니다.', 510],
            ['board', 'table', 'text', 'author_header', '게시판 표 작성자 헤더', '작성자', '게시판 목록 작성자 헤더입니다.', 520],
            ['board', 'table', 'text', 'views_likes_header', '게시판 표 조회 추천 헤더', '조회/추천', '게시판 목록 조회/추천 헤더입니다.', 530],
            ['board', 'table', 'text', 'date_header', '게시판 표 작성일 헤더', '작성일', '게시판 목록 작성일 헤더입니다.', 540],
            ['board', 'table', 'text', 'notice_cell', '게시판 공지 셀 문구', ' 공지', '공지 게시글 번호 칸에 표시하는 문구입니다.', 550],
            ['board', 'table', 'text', 'notice_badge', '게시판 공지 배지', '[공지]', '공지 게시글 제목 앞 배지입니다.', 560],
            ['board', 'table', 'text', 'views_likes_value', '게시판 조회 추천 값 형식', ' {views} /  {likes}', '게시판 조회/추천 값 형식입니다. {views}, {likes}를 사용할 수 있습니다.', 570],
            ['board', 'table', 'text', 'empty_posts', '게시판 빈 목록 문구', '게시글이 없습니다.', '게시판 목록이 비어 있을 때 표시하는 문구입니다.', 580],
            ['board', 'sort', 'text', 'desc_label', '게시판 최신순 정렬 옵션', '최근 작성일 내림차순 정렬', '게시판 최신순 정렬 옵션명입니다.', 600],
            ['board', 'sort', 'text', 'asc_label', '게시판 오래된순 정렬 옵션', '최근 작성일 오름차순 정렬', '게시판 오래된순 정렬 옵션명입니다.', 610],
            ['board', 'search', 'text', 'placeholder', '게시판 검색 입력 안내', '제목 또는 내용 검색', '게시판 검색 입력 placeholder입니다.', 620],
            ['board', 'pagination', 'text', 'prev_button', '게시판 이전 버튼', '이전', '게시판 페이지 이전 버튼명입니다.', 700],
            ['board', 'pagination', 'text', 'next_button', '게시판 다음 버튼', '다음', '게시판 페이지 다음 버튼명입니다.', 710],
            ['board', 'draft', 'text', 'manual_saved', '임시저장 수동 저장 알림', '수동으로 임시저장되었습니다.', '게시글 수동 임시저장 성공 알림입니다.', 800],
            ['board', 'draft', 'text', 'auto_saved', '임시저장 자동 저장 알림', '자동 임시저장되었습니다.', '게시글 자동 임시저장 알림입니다.', 810],
            ['board', 'draft', 'text', 'resume_confirm', '임시저장 이어쓰기 확인', '가장 최근에 작성 중이던 임시저장 글이 있습니다. 이어서 작성하시겠습니까?\n(목록에서 다른 저장본도 불러올 수 있습니다)', '최근 임시저장 글 이어쓰기 confirm 문구입니다.', 820],
            ['board', 'draft', 'text', 'empty_save_alert', '임시저장 빈 내용 알림', '저장할 내용이 없습니다.', '임시저장할 내용이 없을 때 표시하는 알림입니다.', 830],
            ['board', 'draft', 'text', 'load_confirm', '임시저장 불러오기 확인', '현재 작성 중인 내용이 덮어씌워집니다. 불러오시겠습니까?', '임시저장 글 불러오기 confirm 문구입니다.', 840],
            ['board', 'draft', 'text', 'delete_confirm', '임시저장 삭제 확인', '정말 이 임시저장 글을 삭제하시겠습니까?', '임시저장 글 삭제 confirm 문구입니다.', 850],
            ['board', 'draft', 'text', 'delete_success', '임시저장 삭제 성공 알림', '임시저장한 글이 삭제되었습니다.', '임시저장 글 삭제 성공 알림입니다.', 860],
            ['board', 'draft', 'text', 'modal_title', '임시저장 목록 제목', ' 임시저장 목록', '임시저장 목록 모달 제목입니다.', 870],
            ['board', 'draft', 'text', 'close_button', '임시저장 닫기 버튼', '닫기', '임시저장 목록 닫기 버튼명입니다.', 880],
            ['board', 'draft', 'text', 'no_title', '임시저장 제목 없음 문구', '제목 없음', '임시저장 글 제목이 없을 때 표시하는 문구입니다.', 890],
            ['board', 'messages', 'text', 'login_required', '게시판 로그인 필요 알림', '로그인이 필요한 서비스입니다.', '로그인이 필요한 게시판 기능을 사용할 때 표시하는 알림입니다.', 900],
            ['board', 'messages', 'text', 'content_limit_exceeded', '게시글 본문 글자수 초과 알림', '작성 가능한 내용이 1000자가 초과되었습니다.', '게시글 본문 제한 글자수 초과 알림입니다.', 910],
            ['board', 'messages', 'text', 'comment_limit_exceeded', '댓글 글자수 초과 알림', '작성 가능한 댓글 내용이 100자가 초과되었습니다.', '댓글/답글 제한 글자수 초과 알림입니다.', 920],
            ['board', 'messages', 'text', 'notice_write_admin_only', '공지게시판 작성 권한 알림', '공지게시판 글 등록은 관리자만 가능합니다.', '공지게시판 작성 권한 알림입니다.', 930],
            ['board', 'messages', 'text', 'need_title_content', '게시글 제목 내용 미입력 알림', '제목과 내용을 모두 입력해주세요.', '게시글 제목 또는 내용 미입력 알림입니다.', 940],
            ['board', 'messages', 'text', 'post_created', '게시글 등록 성공 알림', '게시글이 등록되었습니다.', '게시글 등록 성공 알림입니다.', 950],
            ['board', 'messages', 'text', 'create_failed', '게시글 등록 실패 알림', '등록 실패: 서버 에러', '게시글 등록 실패 알림입니다.', 960],
            ['board', 'messages', 'text', 'post_updated', '게시글 수정 성공 알림', '게시글이 수정되었습니다.', '게시글 수정 성공 알림입니다.', 970],
            ['board', 'messages', 'text', 'update_failed', '게시글 수정 실패 알림', '수정 실패', '게시글 수정 실패 알림입니다.', 980],
            ['board', 'messages', 'text', 'post_delete_confirm', '게시글 삭제 확인', '정말 삭제를 진행하시겠습니까? 게시글을 삭제하면 복구를 할 수 없습니다.', '게시글 삭제 confirm 문구입니다.', 990],
            ['board', 'messages', 'text', 'delete_success', '삭제 성공 알림', '삭제가 되었습니다.', '게시판 삭제 성공 알림입니다.', 1000],
            ['board', 'messages', 'text', 'delete_forbidden', '삭제 권한 없음 알림', '삭제 권한이 없습니다.', '게시판 삭제 권한 없음 알림입니다.', 1010],
            ['board', 'messages', 'text', 'need_comment', '댓글 미입력 알림', '댓글을 입력해주세요.', '댓글 미입력 알림입니다.', 1020],
            ['board', 'messages', 'text', 'comment_create_failed', '댓글 등록 실패 알림', '댓글 등록 실패', '댓글 등록 실패 알림입니다.', 1030],
            ['board', 'messages', 'text', 'need_reply', '답글 미입력 알림', '답글을 입력해주세요.', '답글 미입력 알림입니다.', 1040],
            ['board', 'messages', 'text', 'reply_create_failed', '답글 등록 실패 알림', '답글 등록 실패', '답글 등록 실패 알림입니다.', 1050],
            ['board', 'messages', 'text', 'comment_with_reply_delete_blocked', '대댓글 댓글 삭제 제한 알림', '대댓글이 달린 경우 삭제 할 수 없습니다.', '대댓글이 있는 댓글 삭제 제한 알림입니다.', 1060],
            ['board', 'messages', 'text', 'comment_delete_confirm', '댓글 삭제 확인', '정말 삭제를 진행하시겠습니까? 댓글을 삭제 하면 복구를 할 수 없습니다.', '댓글 삭제 confirm 문구입니다.', 1070],
            ['board', 'messages', 'text', 'like_failed', '추천 실패 알림', '추천 처리 실패', '추천 실패 알림입니다.', 1080],
            ['board', 'messages', 'text', 'no_selected_posts', '게시글 미선택 알림', '선택된 게시글이 없습니다.', '공지 관리에서 게시글을 선택하지 않았을 때 표시하는 알림입니다.', 1090],
            ['board', 'admin', 'text', 'notice_register_button', '공지 등록 버튼', ' 공지 등록', '공지 등록 모드 진입 버튼명입니다.', 1200],
            ['board', 'admin', 'text', 'notice_register_confirm_button', '공지 등록 확인 버튼', ' 등록 확인', '공지 등록 확정 버튼명입니다.', 1210],
            ['board', 'admin', 'text', 'notice_unregister_button', '공지 해제 버튼', ' 공지 해제', '공지 해제 모드 진입 버튼명입니다.', 1220],
            ['board', 'admin', 'text', 'notice_unregister_confirm_button', '공지 해제 확인 버튼', ' 해제 확인', '공지 해제 확정 버튼명입니다.', 1230],
            ['board', 'admin', 'text', 'notice_order_button', '공지 순서 버튼', ' 공지 순서', '공지 순서 편집 버튼명입니다.', 1240],
            ['board', 'admin', 'text', 'notice_order_save_button', '공지 순서 저장 버튼', ' 순서 저장', '공지 순서 저장 버튼명입니다.', 1250],
            ['board', 'admin', 'text', 'move_button', '게시판 이동 버튼 형식', '{target}으로 이동', '게시판 이동 버튼 형식입니다. {target}을 사용할 수 있습니다.', 1260],
            ['board', 'admin', 'text', 'move_up_button', '공지 순서 위 버튼', '위', '공지 순서 위 이동 버튼명입니다.', 1270],
            ['board', 'admin', 'text', 'move_up_title', '공지 순서 위 버튼 설명', '위로 이동', '공지 순서 위 이동 버튼 title입니다.', 1280],
            ['board', 'admin', 'text', 'move_down_button', '공지 순서 아래 버튼', '아래', '공지 순서 아래 이동 버튼명입니다.', 1290],
            ['board', 'admin', 'text', 'move_down_title', '공지 순서 아래 버튼 설명', '아래로 이동', '공지 순서 아래 이동 버튼 title입니다.', 1300],
            ['board', 'admin', 'text', 'notice_register_confirm', '공지 등록 확인 문구', '체크한 게시글을 공지사항으로 등록하시겠습니까?', '공지 등록 confirm 문구입니다.', 1310],
            ['board', 'admin', 'text', 'notice_register_success', '공지 등록 성공 알림', '공지사항을 등록하였습니다.', '공지 등록 성공 알림입니다.', 1320],
            ['board', 'admin', 'text', 'notice_register_failed', '공지 등록 실패 알림', '공지사항 등록 오류', '공지 등록 실패 알림입니다.', 1330],
            ['board', 'admin', 'text', 'notice_register_instruction', '공지 등록 안내', "공지로 등록할 게시물을 체크한 뒤 '공지 등록' 버튼을 다시 눌러주세요.", '공지 등록 모드 안내문입니다.', 1340],
            ['board', 'admin', 'text', 'notice_unregister_confirm', '공지 해제 확인 문구', '체크한 게시글의 공지를 해제하시겠습니까?', '공지 해제 confirm 문구입니다.', 1350],
            ['board', 'admin', 'text', 'notice_unregister_success', '공지 해제 성공 알림', '공지사항이 해제 되었습니다.', '공지 해제 성공 알림입니다.', 1360],
            ['board', 'admin', 'text', 'notice_unregister_failed', '공지 해제 실패 알림', '공지 해제 오류', '공지 해제 실패 알림입니다.', 1370],
            ['board', 'admin', 'text', 'notice_unregister_instruction', '공지 해제 안내', "공지를 해제할 게시물을 체크한 뒤 '공지 해제' 버튼을 다시 눌러주세요.", '공지 해제 모드 안내문입니다.', 1380],
            ['board', 'admin', 'text', 'notice_order_empty', '공지 순서 빈 목록 알림', '순서를 정리할 공지글이 없습니다.', '공지 순서 편집 대상이 없을 때 표시하는 알림입니다.', 1390],
            ['board', 'admin', 'text', 'notice_order_instruction', '공지 순서 편집 안내', '위/아래 버튼으로 공지 순서를 정리한 뒤 순서 저장을 눌러주세요.', '공지 순서 편집 안내문입니다.', 1400],
            ['board', 'admin', 'text', 'notice_order_save_confirm', '공지 순서 저장 확인', '현재 공지 노출 순서를 저장하시겠습니까?', '공지 순서 저장 confirm 문구입니다.', 1410],
            ['board', 'admin', 'text', 'notice_order_save_success', '공지 순서 저장 성공 알림', '공지 순서가 저장되었습니다.', '공지 순서 저장 성공 알림입니다.', 1420],
            ['board', 'admin', 'text', 'notice_order_save_failed', '공지 순서 저장 실패 알림', '공지 순서 저장 중 오류가 발생했습니다.', '공지 순서 저장 실패 알림입니다.', 1430],
            ['board', 'admin', 'text', 'move_no_selected', '게시판 이동 미선택 알림', '이동할 게시글을 선택해주세요.', '게시판 이동 대상 미선택 알림입니다.', 1440],
            ['board', 'admin', 'text', 'move_confirm', '게시판 이동 확인 문구', '선택한 게시글을 {target}으로 이동하시겠습니까?', '게시판 이동 confirm 문구입니다. {target}을 사용할 수 있습니다.', 1450],
            ['board', 'admin', 'text', 'move_success', '게시판 이동 성공 알림', '{target}으로 이동했습니다.', '게시판 이동 성공 알림입니다. {target}을 사용할 수 있습니다.', 1460],
            ['board', 'admin', 'text', 'move_failed', '게시판 이동 실패 알림', '게시판 이동 중 오류가 발생했습니다.', '게시판 이동 실패 알림입니다.', 1470],
            ['board', 'admin', 'text', 'move_instruction', '게시판 이동 안내', "이동할 게시글을 체크한 뒤 '{target}으로 이동' 버튼을 다시 눌러주세요.", '게시판 이동 모드 안내문입니다. {target}을 사용할 수 있습니다.', 1480],
            ['board', 'activity', 'text', 'title', '내 활동 제목', ' 내가 작성한 활동', '게시판 내 활동 화면 제목입니다.', 1600],
            ['board', 'activity', 'text', 'posts_tab', '내 활동 글 탭', '내가 작성한 글 ({count})', '내 활동 글 탭명입니다. {count}를 사용할 수 있습니다.', 1610],
            ['board', 'activity', 'text', 'comments_tab', '내 활동 댓글 탭', '내가 작성한 댓글 ({count})', '내 활동 댓글 탭명입니다. {count}를 사용할 수 있습니다.', 1620],
            ['board', 'activity', 'text', 'select_all_button', '내 활동 전체선택 버튼', '전체선택', '내 활동 전체선택 버튼명입니다.', 1630],
            ['board', 'activity', 'text', 'delete_selected_button', '내 활동 선택 삭제 버튼', '선택 삭제', '내 활동 선택 삭제 버튼명입니다.', 1640],
            ['board', 'activity', 'text', 'comment_table_header', '내 활동 댓글 표 헤더', '댓글 내용 / 원문 제목', '내 활동 댓글 표 헤더입니다.', 1650],
            ['board', 'activity', 'text', 'original_title_label', '내 활동 원본 제목 형식', '원본: {title}', '내 활동 댓글 원본 제목 형식입니다. {title}을 사용할 수 있습니다.', 1660],
            ['board', 'activity', 'text', 'delete_empty_alert', '내 활동 삭제 미선택 알림', '삭제할 항목을 선택해주세요.', '내 활동 삭제 대상 미선택 알림입니다.', 1670],
            ['board', 'activity', 'text', 'delete_confirm', '내 활동 삭제 확인', '정말 삭제를 진행하시겠습니까?', '내 활동 삭제 confirm 문구입니다.', 1680],
            ['board', 'activity', 'text', 'delete_posts_failed', '내 활동 게시글 삭제 실패 알림', '일부 게시글 삭제 실패', '내 활동 게시글 삭제 실패 알림입니다.', 1690],
            ['board', 'activity', 'text', 'delete_comments_failed', '내 활동 댓글 삭제 실패 알림', '일부 댓글 삭제 실패', '내 활동 댓글 삭제 실패 알림입니다.', 1700],
            ['board', 'write', 'text', 'edit_title', '게시글 수정 제목', '게시글 수정', '게시글 수정 화면 제목입니다.', 1800],
            ['board', 'write', 'text', 'create_title', '게시글 작성 제목 형식', '{board} 글 작성', '게시글 작성 화면 제목입니다. {board}를 사용할 수 있습니다.', 1810],
            ['board', 'write', 'text', 'load_button', '임시저장 불러오기 버튼', ' 불러오기', '게시글 작성 화면 임시저장 불러오기 버튼명입니다.', 1820],
            ['board', 'write', 'text', 'temp_save_button', '임시저장 버튼', ' 임시저장', '게시글 작성 화면 임시저장 버튼명입니다.', 1830],
            ['board', 'write', 'text', 'title_placeholder', '게시글 제목 입력 안내', '제목을 입력하세요', '게시글 제목 입력 placeholder입니다.', 1840],
            ['board', 'write', 'text', 'content_placeholder', '게시글 내용 입력 안내', '내용을 입력하세요', '게시글 내용 입력 placeholder입니다.', 1850],
            ['board', 'write', 'text', 'update_submit_button', '게시글 수정 완료 버튼', '수정완료', '게시글 수정 제출 버튼명입니다.', 1860],
            ['board', 'write', 'text', 'create_submit_button', '게시글 등록 제출 버튼', '등록', '게시글 작성 제출 버튼명입니다.', 1870],
            ['board', 'detail', 'text', 'notice_prefix', '게시글 상세 공지 접두어', '[공지] ', '게시글 상세 제목 공지 접두어입니다.', 2000],
            ['board', 'detail', 'text', 'meta_line', '게시글 상세 메타 정보 형식', '작성자: {author} | 조회: {views} | 일시: {date}', '게시글 상세 메타 정보 형식입니다. {author}, {views}, {date}를 사용할 수 있습니다.', 2010],
            ['board', 'detail', 'text', 'like_button', '게시글 추천 버튼 형식', ' 추천 {count}', '게시글 추천 버튼 형식입니다. {count}를 사용할 수 있습니다.', 2020],
            ['board', 'comments', 'text', 'title', '댓글 목록 제목 형식', ' 댓글 ({count})', '댓글 목록 제목 형식입니다. {count}를 사용할 수 있습니다.', 2100],
            ['board', 'comments', 'text', 'reply_button', '답글 버튼', '답글', '답글 열기 버튼명입니다.', 2110],
            ['board', 'comments', 'text', 'reply_placeholder', '답글 입력 안내', '답글을 입력하세요', '답글 입력 placeholder입니다.', 2120],
            ['board', 'comments', 'text', 'comment_placeholder', '댓글 입력 안내', '댓글을 입력하세요', '댓글 입력 placeholder입니다.', 2130],
        ];

        screenSettingDefaultsNoHardcodeV1.push(...boardScreenSettingDefaultsNoHardcodeV1);

        const fortuneScreenSettingDefaultsNoHardcodeV1 = [
            ['fortune', 'tabs', 'text', 'individual_label', '운세 탭 - 오늘의 운세', ' 오늘의 운세?', '운세 화면 개인 운세 탭 버튼명입니다.', 100],
            ['fortune', 'tabs', 'text', 'couple_label', '운세 탭 - 오늘의 궁합', ' 오늘의 궁합?', '운세 화면 궁합 탭 버튼명입니다.', 110],
            ['fortune', 'individual', 'text', 'title', '개인 운세 입력 제목', ' 오늘의 운세 정보 입력', '개인 운세 입력 영역 제목입니다.', 200],
            ['fortune', 'individual', 'text', 'submit_button', '개인 운세 제출 버튼', '결과 확인하기', '개인 운세 결과 확인 버튼명입니다.', 210],
            ['fortune', 'couple', 'text', 'title', '궁합 입력 제목', ' 오늘의 궁합 정보 입력', '궁합 입력 영역 제목입니다.', 300],
            ['fortune', 'couple', 'text', 'my_info_label', '궁합 나의 정보 제목', '나의 정보', '궁합 입력 나의 정보 블록 제목입니다.', 310],
            ['fortune', 'couple', 'text', 'partner_info_label', '궁합 상대방 정보 제목', '상대방 정보', '궁합 입력 상대방 정보 블록 제목입니다.', 320],
            ['fortune', 'couple', 'text', 'submit_button', '궁합 제출 버튼', '궁합 확인하기', '궁합 결과 확인 버튼명입니다.', 330],
            ['fortune', 'form', 'text', 'name_label', '운세 이름 라벨', '이름', '운세 입력 이름 라벨입니다.', 400],
            ['fortune', 'form', 'text', 'name_placeholder', '운세 이름 입력 안내', '이름 입력', '운세 이름 입력 placeholder입니다.', 410],
            ['fortune', 'form', 'text', 'gender_label', '운세 성별 라벨', '성별', '운세 성별 라벨입니다.', 420],
            ['fortune', 'form', 'text', 'male_short_label', '운세 남성 짧은 버튼', '남', '개인 운세 남성 버튼명입니다.', 430],
            ['fortune', 'form', 'text', 'female_short_label', '운세 여성 짧은 버튼', '여', '개인 운세 여성 버튼명입니다.', 440],
            ['fortune', 'form', 'text', 'male_label', '운세 남성 옵션', '남성', '궁합 성별 남성 옵션명입니다.', 450],
            ['fortune', 'form', 'text', 'female_label', '운세 여성 옵션', '여성', '궁합 성별 여성 옵션명입니다.', 460],
            ['fortune', 'form', 'text', 'birthdate_label', '운세 생년월일 라벨', '생년월일 (양력)', '운세 생년월일 라벨입니다.', 470],
            ['fortune', 'form', 'text', 'birthtime_optional_label', '개인 운세 출생시간 라벨', '태어난 시간 (선택)', '개인 운세 출생시간 라벨입니다.', 480],
            ['fortune', 'form', 'text', 'birthtime_label', '궁합 출생시간 라벨', '태어난 시간', '궁합 출생시간 라벨입니다.', 490],
            ['fortune', 'date', 'text', 'year_placeholder', '운세 연도 선택 안내', '연도', '운세 연도 선택 placeholder입니다.', 500],
            ['fortune', 'date', 'text', 'month_placeholder', '운세 월 선택 안내', '월', '운세 월 선택 placeholder입니다.', 510],
            ['fortune', 'date', 'text', 'day_placeholder', '운세 일 선택 안내', '일', '운세 일 선택 placeholder입니다.', 520],
            ['fortune', 'date', 'text', 'year_option', '운세 연도 옵션 형식', '{value}년', '운세 연도 옵션 형식입니다. {value}를 사용할 수 있습니다.', 530],
            ['fortune', 'date', 'text', 'month_option', '운세 월 옵션 형식', '{value}월', '운세 월 옵션 형식입니다. {value}를 사용할 수 있습니다.', 540],
            ['fortune', 'date', 'text', 'day_option', '운세 일 옵션 형식', '{value}일', '운세 일 옵션 형식입니다. {value}를 사용할 수 있습니다.', 550],
            ['fortune', 'time_options', 'text', 'unknown', '운세 출생시간 모름 옵션', '선택 (시간을 모름)', '운세 출생시간 모름 옵션명입니다.', 600],
            ['fortune', 'time_options', 'text', 'ja', '운세 자시 옵션', '자시 (23:30 ~ 01:29)', '운세 자시 옵션명입니다.', 610],
            ['fortune', 'time_options', 'text', 'chuk', '운세 축시 옵션', '축시 (01:30 ~ 03:29)', '운세 축시 옵션명입니다.', 620],
            ['fortune', 'time_options', 'text', 'in', '운세 인시 옵션', '인시 (03:30 ~ 05:29)', '운세 인시 옵션명입니다.', 630],
            ['fortune', 'time_options', 'text', 'myo', '운세 묘시 옵션', '묘시 (05:30 ~ 07:29)', '운세 묘시 옵션명입니다.', 640],
            ['fortune', 'time_options', 'text', 'jin', '운세 진시 옵션', '진시 (07:30 ~ 09:29)', '운세 진시 옵션명입니다.', 650],
            ['fortune', 'time_options', 'text', 'sa', '운세 사시 옵션', '사시 (09:30 ~ 11:29)', '운세 사시 옵션명입니다.', 660],
            ['fortune', 'time_options', 'text', 'oh', '운세 오시 옵션', '오시 (11:30 ~ 13:29)', '운세 오시 옵션명입니다.', 670],
            ['fortune', 'time_options', 'text', 'mi', '운세 미시 옵션', '미시 (13:30 ~ 15:29)', '운세 미시 옵션명입니다.', 680],
            ['fortune', 'time_options', 'text', 'sin', '운세 신시 옵션', '신시 (15:30 ~ 17:29)', '운세 신시 옵션명입니다.', 690],
            ['fortune', 'time_options', 'text', 'yu', '운세 유시 옵션', '유시 (17:30 ~ 19:29)', '운세 유시 옵션명입니다.', 700],
            ['fortune', 'time_options', 'text', 'sul', '운세 술시 옵션', '술시 (19:30 ~ 21:29)', '운세 술시 옵션명입니다.', 710],
            ['fortune', 'time_options', 'text', 'hae', '운세 해시 옵션', '해시 (21:30 ~ 23:29)', '운세 해시 옵션명입니다.', 720],
            ['fortune', 'loading', 'text', 'text', '운세 로딩 문구', '만세력을 세우는 중입니다...', '운세 결과 로딩 문구입니다.', 800],
            ['fortune', 'messages', 'text', 'login_required', '운세 로그인 필요 알림', '로그인 후 이용하실 수 있습니다.', '운세 화면 미로그인 접근 알림입니다.', 900],
            ['fortune', 'messages', 'text', 'invalid_name', '운세 이름 검증 알림', '이름이 정확하지 않습니다, 올바른 이름을 입력해주세요!', '운세 이름 형식 검증 알림입니다.', 910],
            ['fortune', 'messages', 'text', 'need_birthdate', '운세 생년월일 누락 알림', '생년월일을 모두 선택해주세요!', '운세 생년월일 누락 알림입니다.', 920],
            ['fortune', 'messages', 'text', 'invalid_partner', '운세 상대방 정보 검증 알림', '올바른 상대방 정보를 입력 및 선택해주세요.', '궁합 상대방 정보 검증 알림입니다.', 930],
            ['fortune', 'messages', 'text', 'server_error', '운세 서버 오류 알림', '서버 에러', '운세 API 오류 알림입니다.', 940],
            ['fortune', 'result', 'text', 'saju_box_title', '운세 사주 박스 제목 형식', '{name} 사주', '사주 박스 제목 형식입니다. {name}을 사용할 수 있습니다.', 1000],
            ['fortune', 'result', 'text', 'hour_pillar', '운세 시주 라벨', '시', '사주 박스 시주 라벨입니다.', 1010],
            ['fortune', 'result', 'text', 'day_pillar', '운세 일주 라벨', '일', '사주 박스 일주 라벨입니다.', 1020],
            ['fortune', 'result', 'text', 'month_pillar', '운세 월주 라벨', '월', '사주 박스 월주 라벨입니다.', 1030],
            ['fortune', 'result', 'text', 'year_pillar', '운세 년주 라벨', '년', '사주 박스 년주 라벨입니다.', 1040],
            ['fortune', 'result', 'text', 'individual_saju_title', '개인 운세 사주 명식 제목', ' {name}님의 사주 명식', '개인 운세 결과 제목입니다. {name}을 사용할 수 있습니다.', 1050],
            ['fortune', 'result', 'text', 'gyeokguk_label', '개인 운세 격국 라벨', '격국: ', '개인 운세 격국 라벨입니다.', 1060],
            ['fortune', 'result', 'text', 'yongsin_label', '개인 운세 용신 라벨', '용신: ', '개인 운세 용신 라벨입니다.', 1070],
            ['fortune', 'result', 'text', 'exam_luck_title', '개인 운세 학업운 제목', ' 학업운 (오늘의 신살: {sinsal})', '개인 운세 학업운 제목입니다. {sinsal}을 사용할 수 있습니다.', 1080],
            ['fortune', 'result', 'text', 'total_luck_title', '개인 운세 종합 조언 제목', ' 종합 조언', '개인 운세 종합 조언 제목입니다.', 1090],
            ['fortune', 'result', 'text', 'retry_individual_button', '개인 운세 다시하기 버튼', '다시 하기', '개인 운세 다시하기 버튼명입니다.', 1100],
            ['fortune', 'result', 'text', 'couple_score_title', '궁합 지수 제목 형식', ' {name1} & {name2} 궁합 지수', '궁합 결과 제목입니다. {name1}, {name2}를 사용할 수 있습니다.', 1110],
            ['fortune', 'result', 'text', 'score_value', '궁합 점수 형식', '{score}점', '궁합 점수 형식입니다. {score}를 사용할 수 있습니다.', 1120],
            ['fortune', 'result', 'text', 'couple_out_title', '궁합 겉궁합 제목', '1. 겉궁합 (띠와 연주)', '궁합 결과 겉궁합 제목입니다.', 1130],
            ['fortune', 'result', 'text', 'couple_in_title', '궁합 속궁합 제목', '2. 속궁합 (일간과 일지)', '궁합 결과 속궁합 제목입니다.', 1140],
            ['fortune', 'result', 'text', 'couple_balance_title', '궁합 오행 밸런스 제목', '3. 조후와 억부 (오행 밸런스)', '궁합 결과 오행 밸런스 제목입니다.', 1150],
            ['fortune', 'result', 'text', 'couple_flow_title', '궁합 운의 흐름 제목', '4. 운의 흐름 (대운 일치)', '궁합 결과 운의 흐름 제목입니다.', 1160],
            ['fortune', 'result', 'text', 'retry_couple_button', '궁합 다시보기 버튼', '다른 궁합 보기', '궁합 결과 다시보기 버튼명입니다.', 1170],
        ];

        screenSettingDefaultsNoHardcodeV1.push(...fortuneScreenSettingDefaultsNoHardcodeV1);

        const randomScreenSettingDefaultsNoHardcodeV1 = [
            ['random', 'page', 'text', 'title', '필기 문제은행 제목', '오늘의 문제은행', '필기 문제은행 화면 제목입니다.', 100],
            ['random', 'buttons', 'text', 'written_lobby', '필기 문제은행 로비 버튼', '필기 로비', '필기 로비 이동 버튼명입니다.', 200],
            ['random', 'buttons', 'text', 'check_answer', '필기 문제은행 정답 확인 버튼', '정답 확인하기', '정답 제출 버튼명입니다.', 210],
            ['random', 'buttons', 'text', 'open_drawing', '필기 문제은행 연습장 열기 버튼', '연습장 열기', '연습장 열기 버튼명입니다.', 220],
            ['random', 'buttons', 'text', 'close_drawing', '필기 문제은행 연습장 닫기 버튼', '연습장 닫기', '연습장 닫기 버튼명입니다.', 230],
            ['random', 'buttons', 'text', 'next_question', '필기 문제은행 다음 문제 버튼', '다음 문제 풀기', '다음 문제 버튼명입니다.', 240],
            ['random', 'messages', 'text', 'need_answer', '필기 문제은행 정답 미선택 알림', '정답을 선택해주세요!', '정답 미선택 알림입니다.', 300],
            ['random', 'messages', 'text', 'load_failed', '필기 문제은행 로딩 실패 문구', '문제를 불러오는데 실패했습니다. 서버를 확인해주세요.', '문제 로딩 실패 화면 문구입니다.', 310],
            ['random', 'messages', 'text', 'loading', '필기 문제은행 로딩 문구', '문제를 불러오는 중입니다...', '문제 로딩 중 화면 문구입니다.', 320],
            ['random', 'meta', 'text', 'question_badge', '필기 문제은행 문제 정보 배지 형식', '[{year}년 {session}회차 {number}번] {subject}', '문제 정보 배지 형식입니다. {year}, {session}, {number}, {subject}를 사용할 수 있습니다.', 400],
            ['random', 'question', 'text', 'prefix', '필기 문제은행 문제 접두어', 'Q.', '문제 본문 앞 접두어입니다.', 410],
            ['random', 'image', 'text', 'question_alt', '필기 문제 이미지 대체문구', '문제 첨부 이미지', '문제 이미지 alt 문구입니다.', 420],
            ['random', 'subjects', 'text', 'unknown', '필기 문제은행 과목 정보 없음', '과목 정보 없음', '과목 정보를 알 수 없을 때 표시하는 문구입니다.', 500],
            ['random', 'subjects', 'text', 'subject_0', '필기 문제은행 1과목명', '1과목 : 소프트웨어 설계', '필기 문제은행 1과목 표시명입니다.', 510],
            ['random', 'subjects', 'text', 'subject_1', '필기 문제은행 2과목명', '2과목 : 소프트웨어 개발', '필기 문제은행 2과목 표시명입니다.', 520],
            ['random', 'subjects', 'text', 'subject_2', '필기 문제은행 3과목명', '3과목 : 데이터베이스 구축', '필기 문제은행 3과목 표시명입니다.', 530],
            ['random', 'subjects', 'text', 'subject_3', '필기 문제은행 4과목명', '4과목 : 프로그래밍 언어 활용', '필기 문제은행 4과목 표시명입니다.', 540],
            ['random', 'subjects', 'text', 'subject_4', '필기 문제은행 5과목명', '5과목 : 정보시스템 구축 관리', '필기 문제은행 5과목 표시명입니다.', 550],
            ['random', 'subjects', 'text', 'default', '필기 문제은행 기타 과목명 형식', '과목 : {id}', '기타 과목 표시 형식입니다. {id}를 사용할 수 있습니다.', 560],
            ['random', 'report', 'text', 'exam_type', '필기 문제은행 오류신고 시험구분', '필기', '오류신고에 전달하는 시험 구분 표시명입니다.', 600],
            ['random', 'report', 'text', 'mode', '필기 문제은행 오류신고 모드', '문제은행', '오류신고에 전달하는 모드 표시명입니다.', 610],
            ['random', 'result', 'text', 'correct_title', '필기 문제은행 정답 결과 제목', '정답입니다!', '정답 제출 결과 제목입니다.', 700],
            ['random', 'result', 'text', 'wrong_title', '필기 문제은행 오답 결과 제목', '아쉽습니다, 다시 도전해보세요!', '오답 제출 결과 제목입니다.', 710],
            ['random', 'result', 'text', 'correct_answer_prefix', '필기 문제은행 정답 안내 앞문구', '정답은 ', '정답 번호 안내 앞문구입니다.', 720],
            ['random', 'result', 'text', 'correct_answer_value', '필기 문제은행 정답 번호 형식', '{label}번', '정답 번호 형식입니다. {label}을 사용할 수 있습니다.', 730],
            ['random', 'result', 'text', 'correct_answer_suffix', '필기 문제은행 정답 안내 뒷문구', ' 입니다.', '정답 번호 안내 뒷문구입니다.', 740],
            ['random', 'result', 'text', 'wrong_saved_notice', '필기 문제은행 오답 저장 안내', '※ 틀린 문제는 마이페이지의 오답노트에 자동 저장되었습니다.', '오답 자동 저장 안내문입니다.', 750],
            ['random', 'explanation', 'text', 'title', '필기 문제은행 해설 제목', '해설', '해설 영역 제목입니다.', 800],
            ['random', 'explanation', 'text', 'empty', '필기 문제은행 해설 없음 문구', '해설이 아직 등록되어 있지 않습니다. DB에는 해설이 있어도 이 문구가 보이면 /api/random-question 응답에 explanation_text가 포함되는지 확인해야 합니다.', '해설이 없을 때 표시하는 문구입니다.', 810],
            ['random', 'ranking', 'text', 'update_title', '필기 문제은행 랭킹 업데이트 제목', '내 랭킹 업데이트!', '랭킹 업데이트 박스 제목입니다.', 900],
            ['random', 'ranking', 'text', 'out_of_rank', '필기 문제은행 순위권 밖 문구', '순위권 밖', '랭킹 순위가 없을 때 표시하는 문구입니다.', 910],
            ['random', 'ranking', 'text', 'rank_value', '필기 문제은행 순위 형식', '{rank}등', '랭킹 순위 형식입니다. {rank}를 사용할 수 있습니다.', 920],
            ['random', 'ranking', 'text', 'summary', '필기 문제은행 랭킹 요약 형식', '({score}점, 정답률 {accuracy}%)', '랭킹 점수/정답률 요약 형식입니다. {score}, {accuracy}를 사용할 수 있습니다.', 930],
        ];

        screenSettingDefaultsNoHardcodeV1.push(...randomScreenSettingDefaultsNoHardcodeV1);

        const pastScreenSettingDefaultsNoHardcodeV1 = [
            ['past', 'user', 'text', 'default_name', '필기 기출 기본 사용자명', '사용자', '로그인 이름이 없을 때 표시하는 기본 사용자명입니다.', 100],
            ['past', 'subjects', 'text', 'unknown', '필기 기출 과목 정보 없음', '과목 정보 없음', '과목 정보를 알 수 없을 때 표시하는 문구입니다.', 200],
            ['past', 'subjects', 'text', 'subject_0', '필기 기출 1과목명', '1과목 : 소프트웨어 설계', '필기 기출 1과목 표시명입니다.', 210],
            ['past', 'subjects', 'text', 'subject_1', '필기 기출 2과목명', '2과목 : 소프트웨어 개발', '필기 기출 2과목 표시명입니다.', 220],
            ['past', 'subjects', 'text', 'subject_2', '필기 기출 3과목명', '3과목 : 데이터베이스 구축', '필기 기출 3과목 표시명입니다.', 230],
            ['past', 'subjects', 'text', 'subject_3', '필기 기출 4과목명', '4과목 : 프로그래밍 언어 활용', '필기 기출 4과목 표시명입니다.', 240],
            ['past', 'subjects', 'text', 'subject_4', '필기 기출 5과목명', '5과목 : 정보시스템 구축 관리', '필기 기출 5과목 표시명입니다.', 250],
            ['past', 'subjects', 'text', 'default', '필기 기출 기타 과목명 형식', '과목 : {id}', '기타 과목 표시 형식입니다. {id}를 사용할 수 있습니다.', 260],
            ['past', 'time', 'text', 'datetime', '필기 기출 날짜 시간 형식', '{year}년 {month}월 {day}일 {hour}:{minute}:{second}', '시험 시작/종료 일시 형식입니다.', 300],
            ['past', 'time', 'text', 'duration', '필기 기출 시간 길이 형식', '{hours}시간 {minutes}분 {seconds}초', '시험 소요/남은 시간 형식입니다.', 310],
            ['past', 'time', 'text', 'start_label', '필기 기출 시작 일시 라벨', '시작 일시 : ', '결과표 시작 일시 라벨입니다.', 320],
            ['past', 'time', 'text', 'end_label', '필기 기출 종료 일시 라벨', '종료 일시 : ', '결과표 종료 일시 라벨입니다.', 330],
            ['past', 'time', 'text', 'elapsed_label', '필기 기출 소요 시간 라벨', '실제 소요 시간 : ', '결과표 실제 소요 시간 라벨입니다.', 340],
            ['past', 'time', 'text', 'remaining_label', '필기 기출 남은 시간 라벨', '남은 시간 : ', '결과표 남은 시간 라벨입니다.', 350],
            ['past', 'time', 'text', 'submitted_placeholder', '필기 기출 제출 후 시간 표시', '--시간 --분 --초', '제출 후 OMR 시간 영역에 표시하는 문구입니다.', 360],
            ['past', 'messages', 'text', 'block_lobby_during_exam', '필기 기출 시험 중 이동 차단 알림', '필기 기출 시험 응시 중입니다. 제출 및 채점하기 전에는 필기 로비로 이동할 수 없습니다.', '시험 중 로비 이동을 막을 때 표시하는 알림입니다.', 400],
            ['past', 'messages', 'text', 'need_year_session', '필기 기출 연도 회차 선택 알림', '연도와 회차를 선택해 주세요.', '연도/회차 미선택 시 표시하는 알림입니다.', 410],
            ['past', 'messages', 'text', 'no_exam_data', '필기 기출 데이터 없음 알림', '해당 기출문제 데이터가 없습니다.', '선택한 연도/회차에 문제가 없을 때 표시하는 알림입니다.', 420],
            ['past', 'messages', 'text', 'server_error', '필기 기출 서버 오류 알림', '서버 오류가 발생했습니다.', '시험 문제 로딩 실패 알림입니다.', 430],
            ['past', 'messages', 'text', 'time_over', '필기 기출 시간 종료 알림', '150분의 시험 시간이 종료되었습니다. 자동으로 답안이 제출됩니다.', '시험 시간이 끝났을 때 표시하는 알림입니다.', 440],
            ['past', 'messages', 'text', 'no_submitted_answer_pdf', '필기 기출 PDF 답안 없음 알림', '제출한 답안이 없어 결과를 추출할 수 없습니다.', 'PDF 추출 시 답안이 없을 때 표시하는 알림입니다.', 450],
            ['past', 'messages', 'text', 'current_question_missing', '필기 기출 현재 문항 없음 문구', '문제를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', '현재 문항을 찾지 못했을 때 화면에 표시하는 문구입니다.', 460],
            ['past', 'selector', 'text', 'title', '필기 기출 선택 화면 제목', '기출문제 응시', '필기 기출 선택 화면 제목입니다.', 500],
            ['past', 'selector', 'text', 'year_option', '필기 기출 연도 옵션 형식', '{year}년', '연도 선택 옵션 형식입니다. {year}를 사용할 수 있습니다.', 510],
            ['past', 'selector', 'text', 'session_option', '필기 기출 회차 옵션 형식', '{session}회차', '회차 선택 옵션 형식입니다. {session}을 사용할 수 있습니다.', 520],
            ['past', 'buttons', 'text', 'written_lobby', '필기 기출 로비 버튼', '필기 로비', '필기 로비 이동 버튼명입니다.', 600],
            ['past', 'buttons', 'text', 'start_exam', '필기 기출 응시 시작 버튼', '응시 시작', '시험 시작 버튼명입니다.', 610],
            ['past', 'buttons', 'text', 'export_pdf', '필기 기출 PDF 추출 버튼', 'PDF로 추출', '결과표 PDF 추출 버튼명입니다.', 620],
            ['past', 'buttons', 'text', 'go_omr', '필기 기출 OMR 이동 버튼', '응시한 OMR 이동', '결과표에서 OMR로 이동하는 버튼명입니다.', 630],
            ['past', 'buttons', 'text', 'retry_other_exam', '필기 기출 다른 시험 버튼', '다른 기출문제 풀기', '다른 기출문제로 돌아가는 버튼명입니다.', 640],
            ['past', 'buttons', 'text', 'prev', '필기 기출 이전 버튼', '이전', '이전 문항 버튼명입니다.', 650],
            ['past', 'buttons', 'text', 'submit_grade', '필기 기출 제출 채점 버튼', '제출 및 채점하기', '시험 답안 제출/채점 버튼명입니다.', 660],
            ['past', 'buttons', 'text', 'go_result', '필기 기출 최종결과표 이동 버튼', '최종결과표로 이동', '제출 후 결과표 이동 버튼명입니다.', 670],
            ['past', 'buttons', 'text', 'exit_home', '필기 기출 홈 종료 버튼', '종료 및 홈으로', '제출 후 홈 이동 버튼명입니다.', 680],
            ['past', 'buttons', 'text', 'next', '필기 기출 다음 버튼', '다음', '다음 문항 버튼명입니다.', 690],
            ['past', 'buttons', 'text', 'open_drawing', '필기 기출 연습장 열기 버튼', '연습장 열기', '연습장 열기 버튼명입니다.', 700],
            ['past', 'buttons', 'text', 'close_drawing', '필기 기출 연습장 닫기 버튼', '연습장 닫기', '연습장 닫기 버튼명입니다.', 710],
            ['past', 'result', 'text', 'fail_reason_subject', '필기 기출 과락 사유 형식', '{subjects}과목 과락', '과락 불합격 사유 형식입니다. {subjects}를 사용할 수 있습니다.', 800],
            ['past', 'result', 'text', 'fail_reason_average', '필기 기출 평균 미달 사유', '평균 점수 미달', '평균 점수 미달 불합격 사유입니다.', 810],
            ['past', 'result', 'text', 'title', '필기 기출 결과표 제목', '최종 결과표', '결과표 제목입니다.', 820],
            ['past', 'result', 'text', 'average_title', '필기 기출 평균 점수 제목 형식', '총 평균 {score}점', '평균 점수 제목 형식입니다. {score}를 사용할 수 있습니다.', 830],
            ['past', 'result', 'text', 'pass_message', '필기 기출 합격 메시지', '{name}님, 합격을 축하합니다!', '합격 결과 메시지입니다. {name}을 사용할 수 있습니다.', 840],
            ['past', 'result', 'text', 'fail_message', '필기 기출 불합격 메시지', '{name}님은 불합격입니다. ({reason})', '불합격 결과 메시지입니다. {name}, {reason}을 사용할 수 있습니다.', 850],
            ['past', 'result', 'text', 'subject_label', '필기 기출 과목 점수 라벨 형식', '{number}과목', '과목 점수 라벨 형식입니다. {number}를 사용할 수 있습니다.', 860],
            ['past', 'result', 'text', 'score_value', '필기 기출 점수 형식', '{score}점', '점수 표시 형식입니다. {score}를 사용할 수 있습니다.', 870],
            ['past', 'result', 'text', 'subject_pass_badge', '필기 기출 과목 통과 배지', 'PASS', '과목 통과 배지 문구입니다.', 880],
            ['past', 'result', 'text', 'subject_fail_badge', '필기 기출 과목 과락 배지', '과락 (FAIL)', '과목 과락 배지 문구입니다.', 890],
            ['past', 'result', 'text', 'detail_table_title', '필기 기출 상세 채점표 제목', ' 제출한 문제 상세 채점표', '상세 채점표 제목입니다.', 900],
            ['past', 'result', 'text', 'table_no_header', '필기 기출 문제 번호 헤더', '문제 번호', '상세 채점표 문제 번호 헤더입니다.', 910],
            ['past', 'result', 'text', 'table_my_answer_header', '필기 기출 내 정답 헤더', '내 정답', '상세 채점표 내 정답 헤더입니다.', 920],
            ['past', 'result', 'text', 'table_correct_answer_header', '필기 기출 실제 정답 헤더', '실제 정답', '상세 채점표 실제 정답 헤더입니다.', 930],
            ['past', 'result', 'text', 'table_result_header', '필기 기출 결과 헤더', '결과', '상세 채점표 결과 헤더입니다.', 940],
            ['past', 'result', 'text', 'question_no_value', '필기 기출 문제 번호 형식', '{number}번', '상세 채점표 문제 번호 형식입니다. {number}를 사용할 수 있습니다.', 950],
            ['past', 'result', 'text', 'answer_value', '필기 기출 답안 번호 형식', '{answer}번', '답안 번호 형식입니다. {answer}를 사용할 수 있습니다.', 960],
            ['past', 'result', 'text', 'correct_symbol', '필기 기출 정답 결과 기호', 'O', '상세 채점표 정답 결과 표시입니다.', 970],
            ['past', 'result', 'text', 'wrong_symbol', '필기 기출 오답 결과 기호', 'X', '상세 채점표 오답 결과 표시입니다.', 980],
            ['past', 'ranking', 'text', 'loading', '필기 기출 랭킹 집계중 문구', '집계중...', '랭킹 저장 중 표시 문구입니다.', 1000],
            ['past', 'ranking', 'text', 'rank_value', '필기 기출 순위 형식', '{rank}등', '랭킹 순위 형식입니다. {rank}를 사용할 수 있습니다.', 1010],
            ['past', 'ranking', 'text', 'out_of_rank', '필기 기출 순위권 밖 문구', '순위권 밖', '랭킹 순위가 없을 때 표시하는 문구입니다.', 1020],
            ['past', 'ranking', 'text', 'delayed', '필기 기출 랭킹 지연 문구', '갱신 지연', '랭킹 집계 실패/지연 시 표시하는 문구입니다.', 1030],
            ['past', 'ranking', 'text', 'current_title', '필기 기출 현재 랭킹 제목 형식', ' 현재 나의 랭킹 ({year}년 {session}회차)', '현재 랭킹 제목 형식입니다. {year}, {session}을 사용할 수 있습니다.', 1040],
            ['past', 'ranking', 'text', 'summary', '필기 기출 랭킹 요약 형식', '({score}점, 정답률 {accuracy}%)', '랭킹 점수/정답률 요약 형식입니다. {score}, {accuracy}를 사용할 수 있습니다.', 1050],
            ['past', 'confirm', 'text', 'message_after_name', '필기 기출 제출 확인 이름 뒤 문구', '님이 응시하신 시험을', '제출 확인 모달에서 이름 뒤에 붙는 문구입니다.', 1100],
            ['past', 'confirm', 'text', 'message_question', '필기 기출 제출 확인 질문', '정말 종료하고 답을 제출하시겠습니까?', '제출 확인 모달 질문입니다.', 1110],
            ['past', 'confirm', 'text', 'submit_button', '필기 기출 제출 확인 버튼', 'Yes (제출)', '제출 확인 모달 제출 버튼명입니다.', 1120],
            ['past', 'confirm', 'text', 'cancel_button', '필기 기출 제출 취소 버튼', 'No (계속 풀기)', '제출 확인 모달 취소 버튼명입니다.', 1130],
            ['past', 'exam', 'text', 'exam_badge', '필기 기출 시험 배지 형식', '{year}년 {session}회차', '시험 화면 상단 배지 형식입니다. {year}, {session}을 사용할 수 있습니다.', 1200],
            ['past', 'exam', 'text', 'question_title', '필기 기출 문제 제목 형식', '{number}. {text}', '문제 제목 형식입니다. {number}, {text}를 사용할 수 있습니다.', 1210],
            ['past', 'exam', 'text', 'question_prefix', '필기 기출 PDF 문제 접두어', 'Q. ', 'PDF 오답노트 문제 본문 앞 접두어입니다.', 1220],
            ['past', 'exam', 'text', 'empty_question_text', '필기 기출 문제 없음 문구', '문제 내용이 없습니다.', '문제 본문이 비어 있을 때 표시하는 문구입니다.', 1230],
            ['past', 'exam', 'text', 'option_prefix', '필기 기출 보기 번호 형식', '{number}번. ', '보기 번호 형식입니다. {number}를 사용할 수 있습니다.', 1240],
            ['past', 'report', 'text', 'exam_type', '필기 기출 오류신고 시험구분', '필기', '오류신고에 전달하는 시험 구분 표시명입니다.', 1300],
            ['past', 'report', 'text', 'mode', '필기 기출 오류신고 모드', '기출문제', '오류신고에 전달하는 모드 표시명입니다.', 1310],
            ['past', 'image', 'text', 'question_alt', '필기 기출 문제 이미지 대체문구', '문제 첨부 이미지', '문제 이미지 alt 문구입니다.', 1320],
            ['past', 'explanation', 'text', 'title', '필기 기출 해설 제목', '해설', '해설 영역 제목입니다.', 1400],
            ['past', 'explanation', 'text', 'empty', '필기 기출 해설 없음 문구', '해설이 아직 등록되어 있지 않습니다. DB에는 해설이 있어도 이 문구가 보이면 /api/past-exam 응답에 explanation_text가 포함되는지 확인해야 합니다.', '해설이 없을 때 표시하는 문구입니다.', 1410],
            ['past', 'omr', 'text', 'remaining_time_title', '필기 기출 OMR 남은 시간 제목', '남은 시간', 'OMR 남은 시간 제목입니다.', 1500],
            ['past', 'omr', 'text', 'title', '필기 기출 OMR 제목', '진행 현황 (OMR)', 'OMR 진행 현황 제목입니다.', 1510],
            ['past', 'pdf', 'text', 'title', '필기 기출 PDF 제목 형식', '{year}년 {session}회차 시험 결과 및 오답 노트', 'PDF 문서 제목 형식입니다. {year}, {session}을 사용할 수 있습니다.', 1600],
            ['past', 'pdf', 'text', 'header_title', '필기 기출 PDF 헤더 제목 형식', '[시험 결과] {year}년 {session}회차 기출문제', 'PDF 헤더 제목 형식입니다. {year}, {session}을 사용할 수 있습니다.', 1610],
            ['past', 'pdf', 'text', 'wrong_note_title', '필기 기출 PDF 오답노트 제목', ' 오답 노트 ', 'PDF 오답노트 섹션 제목입니다.', 1620],
            ['past', 'pdf', 'text', 'no_wrong_title', '필기 기출 PDF 오답 없음 제목', ' 틀린 문제가 없습니다! 완벽합니다.', 'PDF 오답이 없을 때 표시하는 문구입니다.', 1630],
            ['past', 'pdf', 'text', 'detail_table_title', '필기 기출 PDF 상세 채점표 제목', ' 제출한 문제 상세 채점표', 'PDF 상세 채점표 제목입니다.', 1640],
            ['past', 'pdf', 'text', 'start_time_label', '필기 기출 PDF 시작 시간 라벨', '응시 시작: ', 'PDF 시작 시간 라벨입니다.', 1650],
            ['past', 'pdf', 'text', 'end_time_label', '필기 기출 PDF 종료 시간 라벨', '응시 종료: ', 'PDF 종료 시간 라벨입니다.', 1660],
            ['past', 'pdf', 'text', 'elapsed_time_label', '필기 기출 PDF 소요 시간 라벨', '실제 소요 시간: ', 'PDF 소요 시간 라벨입니다.', 1670],
            ['past', 'pdf', 'text', 'subject_fail_badge_short', '필기 기출 PDF 과락 배지', '과락', 'PDF 과목 과락 배지 문구입니다.', 1680],
            ['past', 'pdf', 'text', 'actual_question_no', '필기 기출 PDF 실제 기출 번호 형식', '실제 기출 번호: {number}번', 'PDF 실제 기출 번호 형식입니다. {number}를 사용할 수 있습니다.', 1690],
            ['past', 'pdf', 'text', 'no_info', '필기 기출 PDF 정보 없음 문구', '정보 없음', 'PDF 기출 번호 정보가 없을 때 표시하는 문구입니다.', 1700],
            ['past', 'pdf', 'text', 'correct_mark', '필기 기출 PDF 정답 표시', ' (정답) ', 'PDF 보기에서 정답에 붙는 표시입니다.', 1710],
            ['past', 'pdf', 'text', 'my_wrong_mark', '필기 기출 PDF 내 오답 표시', ' (내 오답) ', 'PDF 보기에서 사용자 오답에 붙는 표시입니다.', 1720],
            ['past', 'pdf', 'text', 'option_prefix', '필기 기출 PDF 보기 번호 형식', '{number}. ', 'PDF 보기 번호 형식입니다. {number}를 사용할 수 있습니다.', 1730],
        ];

        screenSettingDefaultsNoHardcodeV1.push(...pastScreenSettingDefaultsNoHardcodeV1);

        const wrongScreenSettingDefaultsNoHardcodeV1 = [
            ['wrong', 'page', 'text', 'title', '오답노트 화면 제목', ' 오답노트 응시', '오답노트 화면 제목입니다.', 100],
            ['wrong', 'page', 'text', 'description', '오답노트 화면 설명', '필기/실기, 문제은행/기출문제를 나눠서 복습합니다.', '오답노트 화면 설명 문구입니다.', 110],
            ['wrong', 'tabs', 'text', 'random', '오답노트 필기 문제은행 탭', '필기 문제은행', '필기 문제은행 오답 탭명입니다.', 200],
            ['wrong', 'tabs', 'text', 'past', '오답노트 필기 기출문제 탭', '필기 기출문제', '필기 기출문제 오답 탭명입니다.', 210],
            ['wrong', 'tabs', 'text', 'ipep_random', '오답노트 실기 문제은행 탭', '실기 문제은행', '실기 문제은행 오답 탭명입니다.', 220],
            ['wrong', 'tabs', 'text', 'ipep_past', '오답노트 실기 기출문제 탭', '실기 기출문제', '실기 기출문제 오답 탭명입니다.', 230],
            ['wrong', 'buttons', 'text', 'mypage', '오답노트 마이페이지 버튼', '마이페이지', '마이페이지 이동 버튼명입니다.', 300],
            ['wrong', 'buttons', 'text', 'delete_all_tab', '오답노트 현재 탭 전체 삭제 버튼', '현재 탭 전체 삭제', '현재 탭 오답 전체 삭제 버튼명입니다.', 310],
            ['wrong', 'buttons', 'text', 'check_answer', '오답노트 정답 확인 버튼', '정답 확인하기', '정답 확인 버튼명입니다.', 320],
            ['wrong', 'buttons', 'text', 'checking', '오답노트 채점 중 버튼', '채점 중...', '실기 오답 채점 중 표시 문구입니다.', 330],
            ['wrong', 'buttons', 'text', 'reset_filter', '오답노트 필터 초기화 버튼', '필터 초기화', '회차 필터 초기화 버튼명입니다.', 340],
            ['wrong', 'buttons', 'text', 'prev', '오답노트 이전 버튼', '이전', '이전 문제 버튼명입니다.', 350],
            ['wrong', 'buttons', 'text', 'next', '오답노트 다음 버튼', '다음', '다음 문제 버튼명입니다.', 360],
            ['wrong', 'buttons', 'text', 'delete_current', '오답노트 현재 오답 삭제 버튼', '현재 오답 삭제', '현재 오답 삭제 버튼명입니다.', 370],
            ['wrong', 'messages', 'text', 'login_required', '오답노트 로그인 필요 알림', '로그인이 필요합니다.', '비로그인 접근 시 표시하는 알림입니다.', 400],
            ['wrong', 'messages', 'text', 'load_failed', '오답노트 로딩 실패 알림', '오답노트를 불러오지 못했습니다. 서버 상태를 확인해 주세요.', '오답노트 조회 실패 알림입니다.', 410],
            ['wrong', 'messages', 'text', 'loading', '오답노트 로딩 문구', '오답노트를 불러오는 중입니다...', '오답노트 로딩 중 문구입니다.', 420],
            ['wrong', 'messages', 'text', 'empty_title', '오답노트 비어 있음 제목', '현재 조건에 해당하는 오답이 없습니다.', '오답이 없을 때 표시하는 제목입니다.', 430],
            ['wrong', 'messages', 'text', 'empty_desc', '오답노트 비어 있음 설명', '문제를 풀고 틀린 문제를 저장하면 이곳에서 복습할 수 있습니다.', '오답이 없을 때 표시하는 설명입니다.', 440],
            ['wrong', 'messages', 'text', 'confirm_delete_current', '오답노트 현재 오답 삭제 확인', '현재 오답 1개를 삭제할까요?', '현재 오답 삭제 확인창 문구입니다.', 450],
            ['wrong', 'messages', 'text', 'delete_failed', '오답노트 삭제 실패 알림', '오답 삭제 중 오류가 발생했습니다.', '현재 오답 삭제 실패 알림입니다.', 460],
            ['wrong', 'messages', 'text', 'confirm_delete_all', '오답노트 전체 삭제 확인 형식', '{target} 오답 {count}개를 삭제할까요?', '현재 탭 전체 삭제 확인창 문구입니다. {target}, {count}를 사용할 수 있습니다.', 470],
            ['wrong', 'messages', 'text', 'delete_all_failed', '오답노트 전체 삭제 실패 알림', '전체 삭제 중 오류가 발생했습니다.', '현재 탭 전체 삭제 실패 알림입니다.', 480],
            ['wrong', 'messages', 'text', 'need_written_answer', '오답노트 필기 답안 미선택 알림', '정답을 선택해 주세요.', '필기 오답 답안 미선택 알림입니다.', 490],
            ['wrong', 'messages', 'text', 'need_ipep_answer', '오답노트 실기 답안 미입력 알림', '실기 답안을 입력해 주세요.', '실기 오답 답안 미입력 알림입니다.', 500],
            ['wrong', 'messages', 'text', 'self_check_confirm', '오답노트 자기채점 확인 형식', '[자기채점 필요]\n\n내 답안:\n{userAnswer}\n\n정답 예시:\n{correctAnswer}\n\n정답으로 처리할까요?', '실기 자기채점 확인창 문구입니다. {userAnswer}, {correctAnswer}를 사용할 수 있습니다.', 510],
            ['wrong', 'messages', 'text', 'ipep_check_failed', '오답노트 실기 채점 실패 알림', '실기 오답 채점 중 오류가 발생했습니다.', '실기 오답 채점 실패 알림입니다.', 520],
            ['wrong', 'filter', 'text', 'written_past_title', '오답노트 필기 기출 필터 제목', '필기 기출 회차 필터', '필기 기출 회차 필터 제목입니다.', 600],
            ['wrong', 'filter', 'text', 'ipep_past_title', '오답노트 실기 기출 필터 제목', '실기 기출 회차 필터', '실기 기출 회차 필터 제목입니다.', 610],
            ['wrong', 'filter', 'text', 'all_year', '오답노트 전체 연도 옵션', '전체 연도', '전체 연도 선택 옵션 문구입니다.', 620],
            ['wrong', 'filter', 'text', 'all_session', '오답노트 전체 회차 옵션', '전체 회차', '전체 회차 선택 옵션 문구입니다.', 630],
            ['wrong', 'filter', 'text', 'all_year_compact', '오답노트 전체 연도 삭제 확인 문구', '전체연도', '전체 삭제 확인 문구에서 쓰는 전체 연도 표현입니다.', 640],
            ['wrong', 'filter', 'text', 'all_session_compact', '오답노트 전체 회차 삭제 확인 문구', '전체회차', '전체 삭제 확인 문구에서 쓰는 전체 회차 표현입니다.', 650],
            ['wrong', 'filter', 'text', 'year_value', '오답노트 연도 표시 형식', '{year}년', '연도 표시 형식입니다. {year}를 사용할 수 있습니다.', 660],
            ['wrong', 'filter', 'text', 'session_value', '오답노트 회차 표시 형식', '{session}회차', '회차 표시 형식입니다. {session}을 사용할 수 있습니다.', 670],
            ['wrong', 'question', 'text', 'option_number', '오답노트 객관식 보기 기본 표시 형식', '{number}번', '보기 텍스트가 없을 때 표시하는 형식입니다. {number}를 사용할 수 있습니다.', 700],
            ['wrong', 'form', 'text', 'ipep_answer_placeholder', '오답노트 실기 답안 placeholder', '실기 답안을 입력해 주세요.', '실기 답안 입력창 placeholder입니다.', 710],
            ['wrong', 'image', 'text', 'written_alt', '오답노트 필기 이미지 대체문구', '필기 문제 이미지', '필기 문제 이미지 alt 문구입니다.', 720],
            ['wrong', 'image', 'text', 'ipep_alt', '오답노트 실기 이미지 대체문구', '실기 문제 이미지', '실기 문제 이미지 alt 문구입니다.', 730],
            ['wrong', 'subjects', 'text', 'written_0', '오답노트 필기 1과목명', '소프트웨어 설계', '필기 1과목 표시명입니다.', 800],
            ['wrong', 'subjects', 'text', 'written_1', '오답노트 필기 2과목명', '소프트웨어 개발', '필기 2과목 표시명입니다.', 810],
            ['wrong', 'subjects', 'text', 'written_2', '오답노트 필기 3과목명', '데이터베이스구축', '필기 3과목 표시명입니다.', 820],
            ['wrong', 'subjects', 'text', 'written_3', '오답노트 필기 4과목명', '프로그래밍 언어 활용', '필기 4과목 표시명입니다.', 830],
            ['wrong', 'subjects', 'text', 'written_4', '오답노트 필기 5과목명', '정보시스템 구축 관리', '필기 5과목 표시명입니다.', 840],
            ['wrong', 'subjects', 'text', 'written_unknown', '오답노트 필기 과목 정보 없음', '과목 정보 없음', '필기 과목 정보를 알 수 없을 때 표시하는 문구입니다.', 850],
            ['wrong', 'source', 'text', 'unknown_year', '오답노트 연도 미상 문구', '연도미상', '문제 출처 연도가 없을 때 표시하는 문구입니다.', 900],
            ['wrong', 'source', 'text', 'unknown_session', '오답노트 회차 미상 문구', '회차미상', '문제 출처 회차가 없을 때 표시하는 문구입니다.', 910],
            ['wrong', 'source', 'text', 'written', '오답노트 필기 출처 형식', '{year}년 {session}회차 {subjectNo}과목 {subjectName} {questionNo}번문제', '필기 오답 출처 표시 형식입니다.', 920],
            ['wrong', 'source', 'text', 'ipep_random', '오답노트 실기 문제은행 출처 형식', '{subject} {questionNo}번문제', '실기 문제은행 오답 출처 표시 형식입니다.', 930],
            ['wrong', 'source', 'text', 'ipep_past', '오답노트 실기 기출 출처 형식', '{year}년 {session}회차 {questionNo}번문제', '실기 기출 오답 출처 표시 형식입니다.', 940],
            ['wrong', 'source', 'text', 'ipep_subject_with_code', '오답노트 실기 과목 코드명 형식', '{code}. {name}', '실기 과목 코드와 과목명 표시 형식입니다.', 950],
            ['wrong', 'source', 'text', 'ipep_subject_code_only', '오답노트 실기 과목 코드만 있을 때 형식', '{code}. 실기 과목', '실기 과목 코드만 있을 때 표시 형식입니다.', 960],
            ['wrong', 'source', 'text', 'ipep_subject_unknown', '오답노트 실기 과목 정보 없음', '실기 과목 정보 없음', '실기 과목 정보를 알 수 없을 때 표시하는 문구입니다.', 970],
            ['wrong', 'result', 'text', 'correct_title', '오답노트 정답 결과 제목', '정답입니다.', '정답 확인 결과 제목입니다.', 1000],
            ['wrong', 'result', 'text', 'wrong_title', '오답노트 오답 결과 제목', '다시 확인해볼 문제입니다.', '오답 확인 결과 제목입니다.', 1010],
            ['wrong', 'result', 'text', 'correct_answer_label', '오답노트 정답 라벨', '정답:', '정답 표시 라벨입니다.', 1020],
            ['wrong', 'result', 'text', 'score_label', '오답노트 점수 라벨', '점수:', '실기 점수 표시 라벨입니다.', 1030],
        ];

        screenSettingDefaultsNoHardcodeV1.push(...wrongScreenSettingDefaultsNoHardcodeV1);

        const ipepScreenSettingDefaultsNoHardcodeV2 = [
            ['ipep', 'page', 'text', 'title', '실기 페이지 제목', ' 정보처리기사 실기문제', '실기 학습 화면 상단 제목입니다.', 100],
            ['ipep', 'page', 'text', 'description', '실기 페이지 설명', '실기 문제은행은 즉시 채점 방식으로 연습할 수 있으며,\n실기 기출문제는 실제 시험처럼 최종 제출 후 결과를 확인하는 방식으로 제공됩니다.', '실기 학습 화면 상단 설명입니다.', 110],
            ['ipep', 'user', 'text', 'default_name', '실기 기본 사용자명', '사용자', '로그인 이름이 없을 때 표시하는 기본 사용자명입니다.', 120],
            ['ipep', 'lobby', 'text', 'random_card_title', '실기 로비 문제은행 카드 제목', ' 실기 문제은행', '실기 로비 문제은행 카드 제목입니다.', 200],
            ['ipep', 'lobby', 'text', 'random_card_desc', '실기 로비 문제은행 카드 설명', '과목별 랜덤 문제를 통해 실기문제를 빠르게 연습할 수 있습니다.\n답안을 제출하면 즉시 채점 결과와 정답을 확인할 수 있습니다.', '실기 로비 문제은행 카드 설명입니다.', 210],
            ['ipep', 'lobby', 'text', 'random_button_label', '실기 로비 문제은행 버튼', '문제은행 입장하기', '실기 로비 문제은행 입장 버튼명입니다.', 220],
            ['ipep', 'lobby', 'text', 'past_card_title', '실기 로비 기출문제 카드 제목', ' 실기 기출문제', '실기 로비 기출문제 카드 제목입니다.', 230],
            ['ipep', 'lobby', 'text', 'past_card_desc', '실기 로비 기출문제 카드 설명', '연도와 회차를 선택해 실제 시험처럼 풀 수 있는 모드입니다.\n제한시간, OMR 이동, 최종 결과표, PDF 출력 기능을 제공합니다.', '실기 로비 기출문제 카드 설명입니다.', 240],
            ['ipep', 'lobby', 'text', 'past_button_label', '실기 로비 기출문제 버튼', '기출문제 입장하기', '실기 로비 기출문제 입장 버튼명입니다.', 250],
            ['ipep', 'lobby', 'text', 'guide_text', '실기 로비 안내문', ' 실기 문제는 주관식 답안 특성상 문항 유형에 따라 채점 기준이 다릅니다.\n시험을 시작하기 전에 답안 작성 가이드를 확인해 주세요.\n기출문제를 응시할 경우 게시판의 공지사항을 확인 후 시험을 시작해주시기 바랍니다.', '실기 로비 하단 안내문입니다.', 260],
            ['ipep', 'guide', 'text', 'title', '실기 답안 작성 가이드 제목', '답안 작성 가이드', '실기 답안 작성 가이드 제목입니다.', 300],
            ['ipep', 'guide', 'text', 'items', '실기 답안 작성 가이드 항목', '용어형: 영어 대소문자, 앞뒤 공백, 일부 문장부호는 완화하여 채점합니다.\n여러 답안형: 쉼표(,) 또는 줄바꿈으로 구분하여 입력합니다. 예: 원자성, 독립성\nSQL형: 대소문자와 불필요한 공백은 완화하지만 SQL 문법 기호는 정확히 작성해야 합니다.\n코드 출력형: 대소문자, 공백, 줄바꿈이 중요하므로 출력 결과를 최대한 정확히 입력해야 합니다.\n긴 서술형: 자동채점이 어려운 문항은 최종 제출 시 정답 예시를 보고 직접 맞음/틀림을 선택합니다.', '실기 답안 작성 가이드 항목입니다. 줄바꿈으로 항목을 구분합니다.', 310],
            ['ipep', 'messages', 'text', 'block_lobby_during_exam', '실기 기출 시험 중 이동 차단 알림', '실기 기출 시험 응시 중입니다. 제출 및 채점하기 전에는 실기 로비로 이동할 수 없습니다.', '실기 기출 시험 중 로비 이동 차단 알림입니다.', 400],
            ['ipep', 'messages', 'text', 'time_over', '실기 기출 시간 종료 알림', '2시간 30분의 실기 시험 시간이 종료되었습니다. 자동으로 제출합니다.', '실기 기출 시간이 끝났을 때 표시하는 알림입니다.', 410],
            ['ipep', 'messages', 'text', 'random_load_failed', '실기 문제은행 로딩 실패 알림', '실기 문제은행 문제를 불러오지 못했습니다. 서버 또는 데이터 적재 상태를 확인해 주세요.', '실기 문제은행 문제 로딩 실패 알림입니다.', 420],
            ['ipep', 'messages', 'text', 'no_question_to_grade', '실기 채점 문제 없음 알림', '채점할 문제가 없습니다.', '채점 대상 문제가 없을 때 표시하는 알림입니다.', 430],
            ['ipep', 'messages', 'text', 'need_answer', '실기 답안 미입력 알림', '답안을 먼저 입력해 주세요.', '답안 입력 전 채점 시 표시하는 알림입니다.', 440],
            ['ipep', 'messages', 'text', 'random_check_failed', '실기 문제은행 채점 실패 알림', '채점 중 오류가 발생했습니다.', '실기 문제은행 채점 실패 알림입니다.', 450],
            ['ipep', 'messages', 'text', 'not_open_notice', '실기 기출 미오픈 안내', '현재 오픈베타 테스트 중으로, 빠른 시일 내에 추가할 예정입니다.', '실기 기출 미오픈 회차 안내입니다.', 460],
            ['ipep', 'messages', 'text', 'past_empty', '실기 기출 문제 없음 알림', '해당 회차의 실기 문제가 아직 준비되지 않았습니다.', '실기 기출 회차에 문제가 없을 때 표시하는 알림입니다.', 470],
            ['ipep', 'messages', 'text', 'past_start_failed', '실기 기출 시작 실패 알림', '실기 기출문제를 불러오는 중 오류가 발생했습니다.', '실기 기출 시작 실패 알림입니다.', 480],
            ['ipep', 'messages', 'text', 'self_check_confirm', '실기 자기채점 확인 형식', '[자기채점 필요]\n\n문제: {question}\n\n내 답안:\n{userAnswer}\n\n정답 예시:\n{correctAnswer}\n\n정답으로 처리할까요?', '실기 자기채점 확인창 문구입니다. {question}, {userAnswer}, {correctAnswer}를 사용할 수 있습니다.', 490],
            ['ipep', 'messages', 'text', 'submit_confirm', '실기 기출 최종 제출 확인 형식', '현재 {total}문제 중 {answered}문제 답안이 입력되었습니다.\n최종 제출 후에는 답안을 수정할 수 없습니다. 제출하시겠습니까?', '실기 기출 최종 제출 확인창 문구입니다. {total}, {answered}를 사용할 수 있습니다.', 500],
            ['ipep', 'messages', 'text', 'past_submit_failed', '실기 기출 최종 채점 실패 알림', '최종 채점 중 오류가 발생했습니다. 답안은 브라우저 화면에 남아 있으니 다시 시도해 주세요.', '실기 기출 최종 채점 실패 알림입니다.', 510],
            ['ipep', 'messages', 'text', 'no_pdf_result', '실기 결과 PDF 없음 알림', '출력할 실기 결과가 없습니다.', 'PDF 출력 대상 결과가 없을 때 표시하는 알림입니다.', 520],
            ['ipep', 'random', 'text', 'title', '실기 문제은행 제목', ' 실기 문제은행', '실기 문제은행 화면 제목입니다.', 600],
            ['ipep', 'random', 'text', 'description', '실기 문제은행 설명', '과목별 랜덤 문제를 풀거나, 전체 과목 섞기를 선택하여 실제 시험처럼 범위를 넓혀 연습할 수 있습니다.', '실기 문제은행 화면 설명입니다.', 610],
            ['ipep', 'random', 'text', 'all_subject_label', '실기 전체 과목 선택 버튼', '전체 과목 섞기', '실기 전체 과목 선택 버튼명입니다.', 620],
            ['ipep', 'random', 'text', 'loading', '실기 문제은행 로딩 문구', '문제를 불러오는 중입니다...', '실기 문제은행 로딩 문구입니다.', 630],
            ['ipep', 'random', 'text', 'badge', '실기 문제은행 배지', '문제은행', '실기 문제은행 문제 배지입니다.', 640],
            ['ipep', 'random', 'text', 'grading_policy_badge', '실기 문제은행 채점유형 배지 형식', '채점유형 {policy}', '채점유형 배지 형식입니다. {policy}를 사용할 수 있습니다.', 650],
            ['ipep', 'random', 'text', 'empty', '실기 문제은행 문제 없음 문구', '표시할 문제가 없습니다.', '실기 문제은행 표시 문제가 없을 때 문구입니다.', 660],
            ['ipep', 'form', 'text', 'answer_placeholder', '실기 답안 입력 placeholder', '여기에 실기 답안을 입력해 주세요. 여러 답안은 쉼표 또는 줄바꿈으로 구분하면 됩니다.', '실기 답안 입력창 placeholder입니다.', 700],
            ['ipep', 'buttons', 'text', 'open_drawing', '실기 연습장 열기 버튼', '연습장 열기', '실기 연습장 열기 버튼명입니다.', 800],
            ['ipep', 'buttons', 'text', 'close_drawing', '실기 연습장 닫기 버튼', '연습장 닫기', '실기 연습장 닫기 버튼명입니다.', 810],
            ['ipep', 'buttons', 'text', 'submit_answer', '실기 문제은행 정답 제출 버튼', ' 정답 제출', '실기 문제은행 정답 제출 버튼명입니다.', 820],
            ['ipep', 'buttons', 'text', 'next_random', '실기 문제은행 다른 문제 버튼', ' 다른 문제', '실기 문제은행 다음 문제 버튼명입니다.', 830],
            ['ipep', 'buttons', 'text', 'prev', '실기 기출 이전 버튼', '이전', '실기 기출 이전 버튼명입니다.', 840],
            ['ipep', 'buttons', 'text', 'next', '실기 기출 다음 버튼', '다음', '실기 기출 다음 버튼명입니다.', 850],
            ['ipep', 'buttons', 'text', 'checking', '실기 채점 중 버튼', '채점 중...', '실기 채점 중 표시 버튼명입니다.', 860],
            ['ipep', 'buttons', 'text', 'submit_grade', '실기 기출 제출 채점 버튼', '제출 및 채점하기', '실기 기출 제출/채점 버튼명입니다.', 870],
            ['ipep', 'buttons', 'text', 'export_pdf', '실기 결과 PDF 추출 버튼', 'PDF로 추출', '실기 결과 PDF 추출 버튼명입니다.', 880],
            ['ipep', 'buttons', 'text', 'back_lobby', '실기 로비 이동 버튼', '실기 로비로 이동', '실기 로비 이동 버튼명입니다.', 890],
            ['ipep', 'buttons', 'text', 'retry_past', '실기 기출 다시 풀기 버튼', '다시 풀기', '실기 기출 다시 풀기 버튼명입니다.', 900],
            ['ipep', 'past', 'text', 'exam_badge', '실기 기출 회차 배지 형식', '{year}년 {session}회차', '실기 기출 회차 배지 형식입니다. {year}, {session}을 사용할 수 있습니다.', 1000],
            ['ipep', 'past', 'text', 'badge', '실기 기출 문제 배지', '기출문제', '실기 기출 문제 배지입니다.', 1010],
            ['ipep', 'past', 'text', 'question_no', '실기 기출 문제 번호 형식', '{number}번', '실기 기출 문제 번호 형식입니다. {number}를 사용할 수 있습니다.', 1020],
            ['ipep', 'past', 'text', 'grading_policy_badge', '실기 기출 채점유형 배지 형식', '채점유형 {policy}', '실기 기출 채점유형 배지 형식입니다. {policy}를 사용할 수 있습니다.', 1030],
            ['ipep', 'past', 'text', 'answered_count', '실기 기출 입력 완료 형식', '현재 입력 완료: {answered} / {total}문제', '실기 기출 입력 완료 표시 형식입니다. {answered}, {total}을 사용할 수 있습니다.', 1040],
            ['ipep', 'past', 'text', 'remaining_time_title', '실기 기출 남은 시간 제목', '남은 시간', '실기 기출 OMR 남은 시간 제목입니다.', 1050],
            ['ipep', 'past', 'text', 'omr_title', '실기 기출 OMR 제목', '진행 현황 (OMR)', '실기 기출 OMR 제목입니다.', 1060],
            ['ipep', 'past_lobby', 'text', 'title', '실기 기출 로비 제목', ' 실기 기출문제', '실기 기출 로비 제목입니다.', 1100],
            ['ipep', 'past_lobby', 'text', 'description', '실기 기출 로비 설명', '정보처리기사 실기는 한 회차 20문제, 문제당 5점으로 구성됩니다. 총점 60점 이상이면 합격 기준으로 볼 수 있습니다.\n아직 데이터가 준비되지 않은 회차는 오픈베타 안내 메시지가 표시됩니다.', '실기 기출 로비 설명입니다.', 1110],
            ['ipep', 'past_lobby', 'text', 'status_selected', '실기 기출 선택됨 상태', '선택됨', '실기 기출 회차 선택됨 상태 문구입니다.', 1120],
            ['ipep', 'past_lobby', 'text', 'status_open', '실기 기출 응시 가능 상태', '응시 가능', '실기 기출 회차 응시 가능 상태 문구입니다.', 1130],
            ['ipep', 'past_lobby', 'text', 'status_locked', '실기 기출 잠김 상태', '잠김', '실기 기출 회차 잠김 상태 문구입니다.', 1140],
            ['ipep', 'past_lobby', 'text', 'exam_button', '실기 기출 회차 버튼 형식', '{status} {year}년 {session}회차 ({count}문제)', '실기 기출 회차 버튼 형식입니다.', 1150],
            ['ipep', 'past_lobby', 'text', 'current_selection', '실기 기출 현재 선택 형식', '현재 선택: {selection}', '실기 기출 현재 선택 표시 형식입니다.', 1160],
            ['ipep', 'past_lobby', 'text', 'no_selection', '실기 기출 선택 없음 문구', '선택 없음', '실기 기출 선택 없음 문구입니다.', 1170],
            ['ipep', 'past_lobby', 'text', 'start_notice', '실기 기출 시작 안내', '응시 시작 후에는 정답이 바로 공개되지 않으며, 최종 제출 후 결과표에서 확인할 수 있습니다.', '실기 기출 시작 전 안내문입니다.', 1180],
            ['ipep', 'past_lobby', 'text', 'start_button', '실기 기출 시작 버튼', '실기 기출 응시 시작', '실기 기출 응시 시작 버튼명입니다.', 1190],
            ['ipep', 'result', 'text', 'title', '실기 결과표 제목', '최종 결과표', '실기 기출 결과표 제목입니다.', 1200],
            ['ipep', 'result', 'text', 'total_score_value', '실기 결과 총점 형식', '{score}점', '실기 결과 총점 형식입니다. {score}를 사용할 수 있습니다.', 1210],
            ['ipep', 'result', 'text', 'score_value', '실기 PDF 점수 형식', '{score}점 / {maxScore}점', '실기 PDF 총점 형식입니다. {score}, {maxScore}를 사용할 수 있습니다.', 1220],
            ['ipep', 'result', 'text', 'pass_message', '실기 결과 합격 메시지', '{name}님, 합격 기준을 넘겼습니다.', '실기 결과 합격 메시지입니다. {name}을 사용할 수 있습니다.', 1230],
            ['ipep', 'result', 'text', 'fail_message', '실기 결과 불합격 메시지', '{name}님, 불합격 기준입니다.', '실기 결과 불합격 메시지입니다. {name}을 사용할 수 있습니다.', 1240],
            ['ipep', 'result', 'text', 'pdf_pass_title', '실기 PDF 합격 제목', ' 합격입니다.', '실기 PDF 합격 제목입니다.', 1250],
            ['ipep', 'result', 'text', 'pdf_fail_title', '실기 PDF 불합격 제목', ' 불합격입니다.', '실기 PDF 불합격 제목입니다.', 1260],
            ['ipep', 'result', 'text', 'pdf_summary', '실기 PDF 요약 형식', '{name}님 · 정답 처리 {count}문제', '실기 PDF 결과 요약 형식입니다.', 1270],
            ['ipep', 'result', 'text', 'correct_count_label', '실기 결과 정답 처리 형식', '정답 처리: {correct} / {total}문제', '실기 결과 정답 처리 형식입니다.', 1280],
            ['ipep', 'result', 'text', 'detail_table_title', '실기 상세 채점표 제목', '제출한 문제 상세 채점표', '실기 상세 채점표 제목입니다.', 1290],
            ['ipep', 'result', 'text', 'table_no_header', '실기 표 문제 번호 헤더', '문제 번호', '실기 채점표 문제 번호 헤더입니다.', 1300],
            ['ipep', 'result', 'text', 'table_my_answer_header', '실기 표 내 답안 헤더', '내 답안', '실기 채점표 내 답안 헤더입니다.', 1310],
            ['ipep', 'result', 'text', 'table_correct_answer_header', '실기 표 실제 정답 헤더', '실제 정답', '실기 채점표 실제 정답 헤더입니다.', 1320],
            ['ipep', 'result', 'text', 'table_score_header', '실기 표 점수 헤더', '점수', '실기 채점표 점수 헤더입니다.', 1330],
            ['ipep', 'result', 'text', 'table_result_header', '실기 표 결과 헤더', '결과', '실기 채점표 결과 헤더입니다.', 1340],
            ['ipep', 'result', 'text', 'blank_answer', '실기 미입력 답안 표시', '(미입력)', '미입력 답안 표시 문구입니다.', 1350],
            ['ipep', 'result', 'text', 'correct_symbol', '실기 정답 결과 기호', 'O', '실기 채점표 정답 결과 표시입니다.', 1360],
            ['ipep', 'result', 'text', 'wrong_symbol', '실기 오답 결과 기호', 'X', '실기 채점표 오답 결과 표시입니다.', 1370],
            ['ipep', 'result', 'text', 'self_check_needed', '실기 자기채점 필요 결과 제목', '정답 예시 확인이 필요합니다.', '실기 문제은행 자기채점 필요 결과 제목입니다.', 1380],
            ['ipep', 'result', 'text', 'random_correct', '실기 문제은행 정답 결과 형식', ' 정답입니다! 획득 점수: {score} / {maxScore}', '실기 문제은행 정답 결과 형식입니다.', 1390],
            ['ipep', 'result', 'text', 'random_wrong', '실기 문제은행 오답 결과 형식', ' 오답입니다. 획득 점수: {score} / {maxScore}', '실기 문제은행 오답 결과 형식입니다.', 1400],
            ['ipep', 'result', 'text', 'correct_answer_label', '실기 정답 라벨', '정답:', '실기 정답 라벨입니다.', 1410],
            ['ipep', 'result', 'text', 'grading_policy_label', '실기 채점 기준 라벨 형식', '채점 기준: {policy}', '실기 채점 기준 라벨 형식입니다. {policy}를 사용할 수 있습니다.', 1420],
            ['ipep', 'time', 'text', 'start_label', '실기 시작 일시 라벨', '시작 일시: ', '실기 결과 시작 일시 라벨입니다.', 1500],
            ['ipep', 'time', 'text', 'end_label', '실기 종료 일시 라벨', '종료 일시: ', '실기 결과 종료 일시 라벨입니다.', 1510],
            ['ipep', 'time', 'text', 'elapsed_label', '실기 소요 시간 라벨', '실제 소요 시간: ', '실기 결과 소요 시간 라벨입니다.', 1520],
            ['ipep', 'report', 'text', 'exam_type', '실기 오류신고 시험구분', '실기', '실기 오류신고 시험 구분 표시명입니다.', 1600],
            ['ipep', 'report', 'text', 'random_mode', '실기 오류신고 문제은행 모드', '문제은행', '실기 문제은행 오류신고 모드 표시명입니다.', 1610],
            ['ipep', 'report', 'text', 'past_mode', '실기 오류신고 기출문제 모드', '기출문제', '실기 기출문제 오류신고 모드 표시명입니다.', 1620],
            ['ipep', 'image', 'text', 'viewer_default_title', '실기 이미지 뷰어 기본 제목', '이미지', '실기 이미지 뷰어 기본 제목입니다.', 1700],
            ['ipep', 'image', 'text', 'zoom_out_button', '실기 이미지 축소 버튼', '축소', '실기 이미지 뷰어 축소 버튼명입니다.', 1710],
            ['ipep', 'image', 'text', 'zoom_in_button', '실기 이미지 확대 버튼', '확대', '실기 이미지 뷰어 확대 버튼명입니다.', 1720],
            ['ipep', 'image', 'text', 'open_new_window_button', '실기 이미지 새 창 버튼', '새 창', '실기 이미지 새 창 버튼명입니다.', 1730],
            ['ipep', 'image', 'text', 'close_button', '실기 이미지 닫기 버튼', '닫기', '실기 이미지 닫기 버튼명입니다.', 1740],
            ['ipep', 'image', 'text', 'choice_alt', '실기 보기 이미지 alt', '보기 이미지', '실기 보기 이미지 alt 문구입니다.', 1750],
            ['ipep', 'image', 'text', 'choice_viewer_title', '실기 보기 이미지 뷰어 제목', '보기 이미지 크게 보기', '실기 보기 이미지 뷰어 제목입니다.', 1760],
            ['ipep', 'image', 'text', 'choice_button', '실기 보기 이미지 확대 버튼', ' 보기 이미지 크게 보기', '실기 보기 이미지 확대 버튼명입니다.', 1770],
            ['ipep', 'image', 'text', 'explanation_title', '실기 해설 이미지 제목', ' 해설 이미지', '실기 해설 이미지 제목입니다.', 1780],
            ['ipep', 'image', 'text', 'explanation_alt', '실기 해설 이미지 alt', '해설 이미지', '실기 해설 이미지 alt 문구입니다.', 1790],
            ['ipep', 'image', 'text', 'explanation_viewer_title', '실기 해설 이미지 뷰어 제목', '해설 이미지 크게 보기', '실기 해설 이미지 뷰어 제목입니다.', 1800],
            ['ipep', 'image', 'text', 'explanation_button', '실기 해설 이미지 확대 버튼', ' 해설 이미지 확대해서 보기', '실기 해설 이미지 확대 버튼명입니다.', 1810],
            ['ipep', 'pdf', 'text', 'title', '실기 PDF 제목', '정보처리기사 실기 결과표', '실기 PDF 문서 제목입니다.', 1900],
            ['ipep', 'pdf', 'text', 'wrong_title', '실기 PDF 오답 섹션 제목', '오답 및 해설', '실기 PDF 오답/해설 섹션 제목입니다.', 1910],
            ['ipep', 'pdf', 'text', 'question_meta', '실기 PDF 문제 메타 형식', '{year}년 {session}회차 {number}번 · {policy}', '실기 PDF 문제 메타 형식입니다.', 1920],
            ['ipep', 'pdf', 'text', 'question_prefix', '실기 PDF 문제 접두어', 'Q. ', '실기 PDF 문제 접두어입니다.', 1930],
            ['ipep', 'pdf', 'text', 'my_answer_label', '실기 PDF 내 답안 라벨', '내 답안:', '실기 PDF 내 답안 라벨입니다.', 1940],
            ['ipep', 'pdf', 'text', 'correct_answer_label', '실기 PDF 정답 라벨', '정답:', '실기 PDF 정답 라벨입니다.', 1950],
            ['ipep', 'pdf', 'text', 'score_label', '실기 PDF 획득 점수 라벨', '획득 점수:', '실기 PDF 획득 점수 라벨입니다.', 1960],
            ['ipep', 'pdf', 'text', 'explanation_image_title', '실기 PDF 해설 이미지 제목', '해설 이미지', '실기 PDF 해설 이미지 제목입니다.', 1970],
            ['ipep', 'pdf', 'text', 'no_wrong', '실기 PDF 오답 없음 문구', ' 틀린 문제가 없습니다.', '실기 PDF 오답이 없을 때 표시하는 문구입니다.', 1980],
        ];

        screenSettingDefaultsNoHardcodeV1.push(...ipepScreenSettingDefaultsNoHardcodeV2);

        for (const [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder] of screenSettingDefaultsNoHardcodeV1) {
            await pool.query(
                `INSERT IGNORE INTO wgs_screen_settings
                    (page_key, section_key, setting_type, setting_key, setting_label, setting_value,
                     description, sort_order, is_active, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'system', 'system')`,
                [pageKey, sectionKey, settingType, settingKey, settingLabel, settingValue, description, sortOrder]
            );

            await pool.query(
                `UPDATE wgs_screen_settings
                    SET setting_type = ?, setting_label = ?, description = ?, sort_order = ?, is_active = 1, updated_by = 'system'
                  WHERE page_key = ? AND section_key = ? AND setting_key = ?`,
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
    getPostWithChildren,
    refreshPostLikeCount,
    getBoardDateString,
    isNoticeBoardCreateRequest,
    sendNoticePostEmailsInBackground,
    getUserById,
    validateRealtimeSession,
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
