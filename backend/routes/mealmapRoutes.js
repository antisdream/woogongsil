// 회식맵 장소, 댓글, 좋아요, 수정 요청 API를 제공합니다.
'use strict';

const registerMealmapTextRoutes = require('./mealmap/mealmapTextRoutes');
const registerMealmapModerationRoutes = require('./mealmap/mealmapModerationRoutes');
const registerMealmapInteractionRoutes = require('./mealmap/mealmapInteractionRoutes');

function registerMealmapRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const https = options.https || require('https');
    const validateAdminSession = options.validateAdminSession;
    const validateRealtimeSession = options.validateRealtimeSession;
    const notifyMealMapPlaceDecisionV2515 = options.notifyMealMapPlaceDecisionV2515 || (async () => {});
    const notifyMealMapEditDecisionV2515 = options.notifyMealMapEditDecisionV2515 || (async () => {});
    const createAdminApprovalRequest = options.createAdminApprovalRequest;

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerMealmapRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerMealmapRoutes requires a MySQL pool.');
    }
    if (typeof validateAdminSession !== 'function' || typeof validateRealtimeSession !== 'function') {
        throw new Error('registerMealmapRoutes requires session validators.');
    }
// 회식맵 API + DB 스키마
// ------------------------------------------------------------
// 필기, 실기, 관리자, 달력 기능과 분리된 /api/mealmap 전용 경로를 제공합니다.
// - 공개 조회: 승인된 식당만 반환합니다
// - 사용자 제보/댓글/좋아요/신고: 로그인 세션 필요
// - 관리자 승인/반려/삭제: validateAdminSession으로 관리자 권한을 확인합니다
// - 네이버 지도/검색 API 키가 없어도 DB에 저장된 장소 데이터를 우선 사용합니다
const MEALMAP_CATEGORIES = [
    '한식', '한식부페', '떡볶이', '중식', '국밥/해장국', '국수/칼국수', '쌀국수', '우동',
    '찌개/탕', '덮밥', '비빔밥', '돈까스', '치킨/통닭', '피자', '버거', '토스트', '커피/카페'
];

function mealmapCleanText(value, maxLength = 1000) {
    return String(value ?? '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function mealmapNullableText(value, maxLength = 1000) {
    const text = mealmapCleanText(value, maxLength);
    return text || null;
}

function mealmapNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function mealmapPrice(value, fallback = 0) {
    const n = Math.round(mealmapNumber(value, fallback) / 1000) * 1000;
    if (n < 0) return 0;
    if (n >1000000) return 1000000;
    return n;
}

function mealmapCategory(value) {
    const raw = mealmapCleanText(value, 50);
    return raw || '한식';
}

function mealmapStatus(value, fallback = 'pending') {
    const raw = String(value || '').trim().toLowerCase();
    return ['pending', 'approved', 'rejected', 'hidden', 'all'].includes(raw) ? raw : fallback;
}

function mealmapStripNaverHtml(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}


//  BEGIN =====
// 카카오 지도 JavaScript 키는 브라우저에서 쓰이는 공개 키이고,
// 카카오 Local REST API 키는 서버에서만 사용합니다.
function mealmapKakaoMapJsKey() {
    return String(
        process.env.KAKAO_MAP_JS_KEY ||
        process.env.KAKAO_MAP_JAVASCRIPT_KEY ||
        process.env.KAKAO_JAVASCRIPT_KEY ||
        process.env.VITE_KAKAO_MAP_JS_KEY ||
        ''
    ).trim();
}

function mealmapKakaoRestKey() {
    return String(
        process.env.KAKAO_REST_API_KEY ||
        process.env.KAKAO_LOCAL_REST_API_KEY ||
        ''
    ).trim();
}

function mealmapHttpsJson(hostname, requestPath, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname,
            path: requestPath,
            method: 'GET',
            headers,
            timeout: 6000,
        }, (apiRes) => {
            let raw = '';
            apiRes.on('data', (chunk) => { raw += chunk; });
            apiRes.on('end', () => {
                let parsed = {};
                try {
                    parsed = raw ? JSON.parse(raw) : {};
                } catch (parseError) {
                    return reject(parseError);
                }
                resolve({ statusCode: apiRes.statusCode || 0, data: parsed });
            });
        });
        request.on('timeout', () => {
            request.destroy(new Error('외부 지도 API 응답 시간이 초과되었습니다.'));
        });
        request.on('error', reject);
        request.end();
    });
}
//  END =====

function mealmapAuthBody(req) {
    const body = req.body && typeof req.body === 'object'? req.body : {};
    return {
        id: body.id || body.userId || req.headers['x-user-id'] || '',
        sessionToken: body.sessionToken || req.headers['x-session-token'] || '',
        serverInstanceId: body.serverInstanceId || req.headers['x-server-instance-id'] || '',
    };
}

async function validateMealMapUserSession(req) {
    const auth = await validateRealtimeSession(req);
    if (!auth.valid) {
        const error = new Error('로그인이 필요한 회식맵 기능입니다.');
        error.statusCode = 401;
        error.reason = auth.reason || 'session_expired';
        throw error;
    }
    return auth;
}

function mealmapActorId(auth) {
    return String(auth?.user?.id || auth?.id || auth?.user_id || '').trim();
}

function mealmapActorName(auth) {
    return auth?.user?.name || auth?.user?.nickname || auth?.name || auth?.nickname || mealmapActorId(auth);
}

async function getMealMapPlaceById(placeId) {
    const [rows] = await pool.query(
        `SELECT id, name, address, road_address, category, status, reporter_id, reporter_name
         FROM mealmap_places
         WHERE id = ?
         LIMIT 1`,
        [placeId]
    );
    return rows?.[0] || null;
}

async function createMealMapDeleteApproval(place, auth, adminNote = '') {
    if (typeof createAdminApprovalRequest !== 'function') {
        const error = new Error('회식맵 삭제 결재 요청 기능이 아직 연결되지 않았습니다.');
        error.statusCode = 500;
        throw error;
    }

    const requesterId = mealmapActorId(auth);
    const requesterName = mealmapActorName(auth);
    const safeNote = mealmapNullableText(adminNote, 2000) || '';
    const body = {
        adminNote: safeNote,
        requestedBy: requesterId,
        requestType: 'mealmap_place_delete',
    };
    const preview = JSON.stringify(
        {
            action: 'mealmap_place_delete',
            place: {
                id: place.id,
                name: place.name,
                address: place.address,
                status: place.status,
                reporterId: place.reporter_id,
                reporterName: place.reporter_name,
            },
            requester: { id: requesterId, name: requesterName },
            adminNote: safeNote,
        },
        null,
        2
    ).slice(0, 12000);

    return createAdminApprovalRequest({
        requesterId,
        requesterName,
        method: 'DELETE',
        path: `/api/admin/mealmap/places/${place.id}`,
        body,
        actionTitle: `[회식맵] 식당 삭제 요청 - ${place.name || place.id}`,
        actionPreview: preview,
    });
}

async function ensureMealMapSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_places (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(160) NOT NULL,
            address VARCHAR(255) NOT NULL,
            road_address VARCHAR(255) NULL,
            lat DECIMAL(10,7) NULL,
            lng DECIMAL(10,7) NULL,
            category VARCHAR(50) NOT NULL DEFAULT '한식',
            min_price INT NOT NULL DEFAULT 0,
            max_price INT NOT NULL DEFAULT 0,
            main_menu VARCHAR(255) NULL,
            opening_hours VARCHAR(255) NULL,
            source_type VARCHAR(30) NOT NULL DEFAULT 'user',
            external_place_id VARCHAR(120) NULL,
            naver_url VARCHAR(500) NULL,
            kakao_url VARCHAR(500) NULL,
            reporter_id VARCHAR(80) NULL,
            reporter_name VARCHAR(100) NULL,
            report_note TEXT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'approved',
            admin_note TEXT NULL,
            approved_by VARCHAR(80) NULL,
            approved_at DATETIME NULL,
            like_count INT NOT NULL DEFAULT 0,
            report_count INT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_mealmap_places_status (status),
            KEY idx_mealmap_places_category (category),
            KEY idx_mealmap_places_price (min_price, max_price),
            KEY idx_mealmap_places_reporter (reporter_id),
            KEY idx_mealmap_places_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 회식맵 제보는 승인 대기 없이 즉시 공개하는 정책입니다.
    // 기존 스키마/이전 서버 코드가 남긴 pending 제보도 같은 정책으로 자동 보정합니다.
    await pool.query(`ALTER TABLE mealmap_places MODIFY status VARCHAR(20) NOT NULL DEFAULT 'approved'`);
    await pool.query(
        `UPDATE mealmap_places
         SET status = 'approved',
             approved_by = COALESCE(approved_by, 'auto_report_migration'),
             approved_at = COALESCE(approved_at, NOW()),
             updated_at = updated_at
         WHERE status = 'pending'`
    );

    await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_comments (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            place_id BIGINT UNSIGNED NOT NULL,
            user_id VARCHAR(80) NOT NULL,
            user_name VARCHAR(100) NULL,
            comment_text TEXT NOT NULL,
            is_hidden TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_mealmap_comments_place (place_id),
            KEY idx_mealmap_comments_user (user_id),
            CONSTRAINT fk_mealmap_comments_place FOREIGN KEY (place_id) REFERENCES mealmap_places(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_likes (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            place_id BIGINT UNSIGNED NOT NULL,
            user_id VARCHAR(80) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_mealmap_like (place_id, user_id),
            KEY idx_mealmap_likes_user (user_id),
            CONSTRAINT fk_mealmap_likes_place FOREIGN KEY (place_id) REFERENCES mealmap_places(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_reports (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            place_id BIGINT UNSIGNED NOT NULL,
            user_id VARCHAR(80) NOT NULL,
            user_name VARCHAR(100) NULL,
            reason TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_mealmap_reports_place (place_id),
            KEY idx_mealmap_reports_status (status),
            CONSTRAINT fk_mealmap_reports_place FOREIGN KEY (place_id) REFERENCES mealmap_places(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

  //  schema BEGIN =====
  await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_place_edits (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      place_id BIGINT UNSIGNED NOT NULL,
      user_id VARCHAR(80) NULL,
      user_name VARCHAR(100) NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      reason TEXT NULL,
      proposed_name VARCHAR(200) NOT NULL,
      proposed_address VARCHAR(255) NOT NULL,
      proposed_road_address VARCHAR(255) NULL,
      proposed_lat DECIMAL(10,7) NULL,
      proposed_lng DECIMAL(10,7) NULL,
      proposed_category VARCHAR(50) NOT NULL,
      proposed_min_price INT NOT NULL DEFAULT 0,
      proposed_max_price INT NOT NULL DEFAULT 0,
      proposed_main_menu VARCHAR(255) NULL,
      proposed_opening_hours VARCHAR(100) NULL,
      proposed_naver_url VARCHAR(500) NULL,
      proposed_kakao_url VARCHAR(500) NULL,
      admin_note TEXT NULL,
      reviewed_by VARCHAR(80) NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_mealmap_place_edits_place (place_id),
      INDEX idx_mealmap_place_edits_status (status),
      CONSTRAINT fk_mealmap_place_edits_place
        FOREIGN KEY (place_id) REFERENCES mealmap_places(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  //  schema END =====

}

function mealmapPublicPlaceSelect(extraSelect = '') {
    return `SELECT p.*,
               (SELECT COUNT(*) FROM mealmap_comments c WHERE c.place_id = p.id AND c.is_hidden = 0) AS comment_count
               ${extraSelect}
        FROM mealmap_places p
    `;
}


registerMealmapTextRoutes({
  app,
  pool,
  validateAdminSession,
});

app.get('/api/mealmap/config', (req, res) => {
    const kakaoMapJsKey = mealmapKakaoMapJsKey();
    const kakaoRestKey = mealmapKakaoRestKey();

    return res.json({
        success: true,
        map: {
            enabled: Boolean(kakaoMapJsKey),
            provider: kakaoMapJsKey ? 'kakao' : 'mock',
            clientId: kakaoMapJsKey,
            appKey: kakaoMapJsKey,
        },
        search: {
            enabled: Boolean(kakaoRestKey),
            provider: kakaoRestKey ? 'kakao' : 'local',
        },
        geocode: {
            enabled: Boolean(kakaoRestKey),
            provider: kakaoRestKey ? 'kakao' : 'local',
        },
        categories: MEALMAP_CATEGORIES,
    });
});

app.get('/api/mealmap/categories', (req, res) => {
    return res.json({ success: true, categories: ['전체', ...MEALMAP_CATEGORIES] });
});


//  ROUTE BEGIN =====
app.get('/api/mealmap/geocode', async (req, res) => {
    try {
        const address = mealmapCleanText(req.query.address || req.query.query, 255);
        if (!address) {
            return res.status(400).json({ success: false, message: '좌표를 찾을 주소를 입력해주세요.' });
        }

        const kakaoRestKey = mealmapKakaoRestKey();
        if (!kakaoRestKey) {
            return res.status(501).json({
                success: false,
                configured: false,
                message: '카카오 Local REST API 키가 설정되지 않았습니다. backend/.env에 KAKAO_REST_API_KEY를 추가해주세요.',
            });
        }

        const query = new URLSearchParams({ query: address }).toString();
        const kakao = await mealmapHttpsJson(
            'dapi.kakao.com',
            `/v2/local/search/address.json?${query}`,
            { Authorization: `KakaoAK ${kakaoRestKey}` }
        );

        if (kakao.statusCode >= 400) {
            return res.status(502).json({
                success: false,
                configured: true,
                message: '카카오 주소 검색 API 호출에 실패했습니다. REST API 키와 플랫폼 설정을 확인해주세요.',
                kakaoStatus: kakao.statusCode,
            });
        }

        const documents = Array.isArray(kakao.data?.documents) ? kakao.data.documents : [];
        if (!documents.length) {
            return res.status(404).json({ success: false, configured: true, message: '입력한 주소의 좌표를 찾지 못했습니다.' });
        }

        const first = documents[0];
        const road = first.road_address || {};
        const jibun = first.address || {};
        const lat = Number(first.y);
        const lng = Number(first.x);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(404).json({ success: false, configured: true, message: '카카오 주소 검색 결과에 좌표가 없습니다.' });
        }

        return res.json({
            success: true,
            configured: true,
            result: {
                address: first.address_name || address,
                roadAddress: road.address_name || '',
                jibunAddress: jibun.address_name || '',
                lat,
                lng,
                x: first.x,
                y: first.y,
                zoneNo: road.zone_no || '',
                buildingName: road.building_name || '',
            },
            totalCount: documents.length,
        });
    } catch (error) {
        console.error('[mealmap kakao geocode error]', error);
        return res.status(500).json({ success: false, message: error.message || '주소 좌표 변환 중 오류가 발생했습니다.' });
    }
});
//  ROUTE END =====

app.get('/api/mealmap/places', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const minPrice = mealmapPrice(req.query.minPrice, 0);
        const maxPrice = mealmapPrice(req.query.maxPrice, 1000000) || 1000000;
        const keyword = mealmapCleanText(req.query.keyword, 80);
        const categories = String(req.query.categories || '')
            .split(',')
            .map((item) => mealmapCleanText(item, 50))
            .filter((item) => MEALMAP_CATEGORIES.includes(item));

        const where = ['p.status = ?'];
        const params = ['approved'];

        if (maxPrice >0) {
            where.push('(p.min_price <= ? OR p.min_price = 0)');
            params.push(maxPrice);
        }
        if (minPrice >0) {
            where.push('(p.max_price >= ? OR p.max_price = 0)');
            params.push(minPrice);
        }
        if (categories.length >0) {
            where.push(`p.category IN (${categories.map(() => '?').join(',')})`);
            params.push(...categories);
        }
        if (keyword) {
            where.push('(p.name LIKE ? OR p.address LIKE ? OR p.road_address LIKE ? OR p.main_menu LIKE ?)');
            const like = `%${keyword}%`;
            params.push(like, like, like, like);
        }

        const [places] = await pool.query(
            `${mealmapPublicPlaceSelect()} WHERE ${where.join(' AND ')} ORDER BY p.like_count DESC, p.updated_at DESC LIMIT 300`,
            params
        );

        return res.json({ success: true, places });
    } catch (error) {
        console.error('[mealmap places list error]', error);
        return res.status(500).json({ success: false, message: '회식맵 장소 목록을 불러오지 못했습니다.' });
    }
});

app.post('/api/mealmap/places', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateMealMapUserSession(req);
        const body = req.body || {};

        const name = mealmapCleanText(body.name, 160);
        const address = mealmapCleanText(body.address, 255);
        if (!name || !address) {
            return res.status(400).json({ success: false, message: '식당명과 주소는 필수입니다.' });
        }

        const minPrice = mealmapPrice(body.minPrice ?? body.min_price, 0);
        const maxPrice = mealmapPrice(body.maxPrice ?? body.max_price, minPrice);
        const latRaw = body.lat === '' || body.lat === null || body.lat === undefined ? null : Number(body.lat);
        const lngRaw = body.lng === '' || body.lng === null || body.lng === undefined ? null : Number(body.lng);
        const lat = Number.isFinite(latRaw) ? latRaw : null;
        const lng = Number.isFinite(lngRaw) ? lngRaw : null;

        const [result] = await pool.query(
            `INSERT INTO mealmap_places
             (name, address, road_address, lat, lng, category, min_price, max_price, main_menu, opening_hours,
              source_type, external_place_id, naver_url, kakao_url, reporter_id, reporter_name, report_note,
              status, approved_by, approved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'auto_report', NOW())`,
            [
                name,
                address,
                mealmapNullableText(body.roadAddress ?? body.road_address, 255),
                lat,
                lng,
                mealmapCategory(body.category),
                minPrice,
                Math.max(maxPrice, minPrice),
                mealmapNullableText(body.mainMenu ?? body.main_menu, 255),
                mealmapNullableText(body.openingHours ?? body.opening_hours, 255),
                mealmapNullableText(body.sourceType ?? body.source_type, 30) || 'user',
                mealmapNullableText(body.externalPlaceId ?? body.external_place_id, 120),
                mealmapNullableText(body.naverUrl ?? body.naver_url, 500),
                mealmapNullableText(body.kakaoUrl ?? body.kakao_url, 500),
                auth.user?.id || auth.id,
                auth.user?.name || body.reporterName || auth.user?.id || auth.id,
                mealmapNullableText(body.reportNote ?? body.report_note, 5000),
            ]
        );

        return res.json({
            success: true,
            id: result.insertId,
            status: 'approved',
            message: '식당 제보가 등록되어 회식맵에 바로 공개되었습니다.',
        });
    } catch (error) {
        console.error('[mealmap place create error]', error);
        return res.status(error.statusCode || 500).json({ success: false, reason: error.reason, message: error.message || '식당 제보를 저장하지 못했습니다.' });
    }
});


registerMealmapModerationRoutes({
  app,
  pool,
  ensureMealMapSchema,
  validateAdminSession,
  validateMealMapUserSession,
  mealmapStatus,
  mealmapCleanText,
  mealmapNumber,
  mealmapNullableText,
  mealmapPublicPlaceSelect,
  getMealMapPlaceById,
  createMealMapDeleteApproval,
  notifyMealMapPlaceDecisionV2515,
});

registerMealmapInteractionRoutes({
  app,
  pool,
  ensureMealMapSchema,
  validateAdminSession,
  validateMealMapUserSession,
  mealmapCleanText,
  mealmapNullableText,
  mealmapNumber,
  notifyMealMapEditDecisionV2515,
});

}

module.exports = registerMealmapRoutes;
