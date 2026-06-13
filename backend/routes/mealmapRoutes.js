// 회식맵 장소, 댓글, 좋아요, 수정 요청 API를 제공합니다.
'use strict';

function registerMealmapRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const https = options.https || require('https');
    const validateAdminSession = options.validateAdminSession;
    const validateRealtimeSession = options.validateRealtimeSession;
    const notifyMealMapPlaceDecisionV2515 = options.notifyMealMapPlaceDecisionV2515 || (async () => {});
    const notifyMealMapEditDecisionV2515 = options.notifyMealMapEditDecisionV2515 || (async () => {});

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
    return MEALMAP_CATEGORIES.includes(raw) ? raw : '한식';
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
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
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


// ============================== //
// 회식맵 페이지 문구를 관리자 페이지에서 관리하기 위한 안전한 키-값 설정입니다.
// 기존 회식맵 장소/댓글/좋아요/수정제안 로직과 분리되어 작동합니다.
const MEALMAP_DEFAULT_TEXTS = {
  "heroEyebrow": "회식 장소 추천 지도",
  "heroTitle": "회식 장소를 지도에서 확인하고, 제보하고, 평가할 수 있습니다.",
  "heroSubtitle": "가격·카테고리·검색으로 후보를 좁히고, 제보된 장소는 관리자 승인 후 공개됩니다.",
  "submitButton": "+ 장소 제보하기",
  "searchPlaceholder": "식당명, 주소, 메뉴 검색",
  "searchButton": "검색",
  "filterButton": "필터",
  "mapTitle": "지도 API 미설정 목업 모드",
  "mapCountPrefix": "공개 장소",
  "mapGuideTitle": "안내: 가격과 식당명을 표시합니다.",
  "mapGuideBody": "네이버 API 키를 연결하기 전까지 목업 지도에서 기능 흐름을 확인할 수 있습니다.",
  "emptyTitle": "승인된 식당이 없습니다.",
  "emptyBody": "식당을 제보하고 관리자 승인 후 이 영역에 표시됩니다.",
  "selectMarkerTitle": "마커를 선택하면 상세 정보가 표시됩니다.",
  "selectMarkerBody": "식당 정보, 가격, 댓글, 지도 링크가 표시됩니다.",
  "naverButton": "카카오맵/후기 보기",
  "likeButton": "좋아요",
  "editSuggestButton": "수정 제안",
  "commentTitle": "댓글",
  "commentPlaceholder": "댓글 입력...",
  "commentSubmitButton": "등록",
  "editModalEyebrow": "사용자 수정 제안",
  "editModalSubtext": "관리자 승인 후 회식맵에 반영됩니다.",
  "editReasonLabel": "수정 이유",
  "editReasonPlaceholder": "예: 가격 변경, 영업시간 변경, 주소 오기입 등",
  "editSubmitButton": "수정 제안 보내기",
  "editCancelButton": "취소",
  "editSuccessMessage": "수정 제안이 접수되었습니다. 관리자 승인 후 반영됩니다."
};

async function ensureMealMapTextSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_page_texts (
      text_key VARCHAR(80) PRIMARY KEY,
      text_value TEXT NOT NULL,
      updated_by VARCHAR(80) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const [key, value] of Object.entries(MEALMAP_DEFAULT_TEXTS)) {
    await pool.query(
      'INSERT IGNORE INTO mealmap_page_texts (text_key, text_value, updated_by) VALUES (?, ?, ?)',
      [key, value, 'system']
    );
  }
}

async function getMealMapTextMap() {
  await ensureMealMapTextSchema();
  const [rows] = await pool.query('SELECT text_key, text_value FROM mealmap_page_texts');
  const merged = { ...MEALMAP_DEFAULT_TEXTS };
  for (const row of rows || []) {
    const key = row.text_key || row.TEXT_KEY;
    const value = row.text_value || row.TEXT_VALUE;
    if (key && value !== undefined && value !== null) merged[key] = String(value);
  }
  return merged;
}

app.get('/api/mealmap/texts', async (req, res) => {
  try {
    const texts = await getMealMapTextMap();
    res.json({ success: true, texts });
  } catch (err) {
    console.error('[mealmap/texts] fail', err);
    res.status(500).json({ success: false, msg: '회식맵 문구 설정을 불러오지 못했습니다.' });
  }
});

app.get('/api/admin/mealmap/texts', async (req, res) => {
  try {
    const admin = await validateAdminSession(req);
    if (!(admin.ok || admin.valid)) return res.status(403).json({ success: false, msg: '관리자 권한이 필요합니다.' });

    const texts = await getMealMapTextMap();
    res.json({ success: true, texts, fields: Object.keys(MEALMAP_DEFAULT_TEXTS) });
  } catch (err) {
    console.error('[admin/mealmap/texts:get] fail', err);
    res.status(500).json({ success: false, msg: '회식맵 문구 설정을 불러오지 못했습니다.' });
  }
});

app.put('/api/admin/mealmap/texts', async (req, res) => {
  try {
    const admin = await validateAdminSession(req);
    if (!(admin.ok || admin.valid)) return res.status(403).json({ success: false, msg: '관리자 권한이 필요합니다.' });

    const bodyTexts = req.body?.texts || {};
    await ensureMealMapTextSchema();

    for (const key of Object.keys(MEALMAP_DEFAULT_TEXTS)) {
      const raw = bodyTexts[key];
      const value = String(raw === undefined || raw === null || String(raw).trim() === ''? MEALMAP_DEFAULT_TEXTS[key] : raw).trim();
      await pool.query(
        `INSERT INTO mealmap_page_texts (text_key, text_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE text_value = VALUES(text_value), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
        [key, value, admin.user?.username || admin.user?.user_id || admin.user?.id || 'admin']
      );
    }

    const texts = await getMealMapTextMap();
    res.json({ success: true, msg: '회식맵 문구 설정이 저장되었습니다.', texts });
  } catch (err) {
    console.error('[admin/mealmap/texts:put] fail', err);
    res.status(500).json({ success: false, msg: '회식맵 문구 설정을 저장하지 못했습니다.' });
  }
});
// ============================== //

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
              source_type, external_place_id, naver_url, kakao_url, reporter_id, reporter_name, report_note, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
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
            status: 'pending',
            message: '식당 제보가 접수되었습니다. 관리자 승인 후 회식맵에 공개됩니다.',
        });
    } catch (error) {
        console.error('[mealmap place create error]', error);
        return res.status(error.statusCode || 500).json({ success: false, reason: error.reason, message: error.message || '식당 제보를 저장하지 못했습니다.' });
    }
});


//  BEGIN =====
// 로그인한 사용자가 본인의 회식맵 제보/수정 제안 이력을 확인하고,
// 반려된 요청은 기존 입력값을 다시 불러와 새 요청으로 제출할 수 있게 필요한 데이터를 제공합니다.
app.get('/api/mealmap/my-activity', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateMealMapUserSession(req);
        const userId = String(auth.user?.id || auth.user_id || auth.id || '').trim();
        if (!userId) {
            return res.status(401).json({ success: false, message: '로그인이 필요한 기능입니다.' });
        }

        const page = Math.max(1, mealmapNumber(req.query.page, 1));
        const pageSize = Math.min(50, Math.max(1, mealmapNumber(req.query.pageSize, 20)));
        const offset = (page - 1) * pageSize;

        const [[placeCountRow]] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM mealmap_places WHERE reporter_id = ?`,
            [userId]
        );
        const [[editCountRow]] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM mealmap_place_edits WHERE user_id = ?`,
            [userId]
        );
        const total = Number(placeCountRow?.cnt || 0) + Number(editCountRow?.cnt || 0);

        const [rows] = await pool.query(
            `SELECT * FROM (
                SELECT
                    'place'AS activity_type,
                    p.id AS request_id,
                    NULL AS place_id,
                    p.status AS status,
                    p.name AS place_name,
                    p.address AS address,
                    p.road_address AS road_address,
                    p.category AS category,
                    p.min_price AS min_price,
                    p.max_price AS max_price,
                    p.main_menu AS main_menu,
                    p.opening_hours AS opening_hours,
                    p.lat AS lat,
                    p.lng AS lng,
                    p.naver_url AS naver_url,
                    p.kakao_url AS kakao_url,
                    p.report_note AS request_note,
                    p.admin_note AS admin_note,
                    p.created_at AS requested_at,
                    CASE
                        WHEN p.status = 'approved'THEN p.approved_at
                        WHEN p.status IN ('rejected', 'hidden') THEN p.updated_at
                        ELSE NULL
                    END AS processed_at,
                    NULL AS current_name,
                    NULL AS current_address
                FROM mealmap_places p
                WHERE p.reporter_id = ?

                UNION ALL

                SELECT
                    'edit'AS activity_type,
                    e.id AS request_id,
                    e.place_id AS place_id,
                    e.status AS status,
                    e.proposed_name AS place_name,
                    e.proposed_address AS address,
                    e.proposed_road_address AS road_address,
                    e.proposed_category AS category,
                    e.proposed_min_price AS min_price,
                    e.proposed_max_price AS max_price,
                    e.proposed_main_menu AS main_menu,
                    e.proposed_opening_hours AS opening_hours,
                    e.proposed_lat AS lat,
                    e.proposed_lng AS lng,
                    e.proposed_naver_url AS naver_url,
                    e.proposed_kakao_url AS kakao_url,
                    e.reason AS request_note,
                    e.admin_note AS admin_note,
                    e.created_at AS requested_at,
                    e.reviewed_at AS processed_at,
                    p.name AS current_name,
                    p.address AS current_address
                FROM mealmap_place_edits e
                LEFT JOIN mealmap_places p ON p.id = e.place_id
                WHERE e.user_id = ?
            ) activity
            ORDER BY requested_at DESC, request_id DESC
            LIMIT ? OFFSET ?`,
            [userId, userId, pageSize, offset]
        );

        const items = rows.map((row) => ({
            id: `${row.activity_type}_${row.request_id}`,
            type: row.activity_type,
            requestId: row.request_id,
            placeId: row.place_id,
            status: row.status,
            placeName: row.place_name,
            address: row.address,
            roadAddress: row.road_address,
            category: row.category,
            minPrice: row.min_price,
            maxPrice: row.max_price,
            mainMenu: row.main_menu,
            openingHours: row.opening_hours,
            requestedAt: row.requested_at,
            processedAt: row.processed_at,
            adminNote: row.admin_note,
            requestNote: row.request_note,
            currentName: row.current_name,
            currentAddress: row.current_address,
            canResubmit: row.status === 'rejected',
            payload: {
                placeId: row.place_id,
                name: row.place_name || '',
                address: row.address || '',
                roadAddress: row.road_address || '',
                category: row.category || '한식',
                minPrice: Number(row.min_price || 0),
                maxPrice: Number(row.max_price || 0),
                mainMenu: row.main_menu || '',
                openingHours: row.opening_hours || '',
                lat: row.lat == null ? '' : String(row.lat),
                lng: row.lng == null ? '' : String(row.lng),
                naverUrl: row.naver_url || '',
                kakaoUrl: row.kakao_url || '',
                reportNote: row.activity_type === 'place'? (row.request_note || '') : '',
                reason: row.activity_type === 'edit'? (row.request_note || '') : '',
                currentName: row.current_name || '',
                currentAddress: row.current_address || '',
            },
        }));

        return res.json({
            success: true,
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            items,
        });
    } catch (error) {
        console.error('[mealmap activity history error]', error);
        return res.status(error.statusCode || 500).json({
            success: false,
            reason: error.reason,
            message: error.message || '회식맵 활동 이력을 불러오지 못했습니다.',
        });
    }
});
//  END =====

app.get('/api/mealmap/places/:placeId/comments', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const placeId = mealmapNumber(req.params.placeId, 0);
        if (!placeId) return res.status(400).json({ success: false, message: 'placeId가 필요합니다.' });

        const [comments] = await pool.query(
            `SELECT id, place_id, user_id, user_name, comment_text, created_at
             FROM mealmap_comments
             WHERE place_id = ? AND is_hidden = 0
             ORDER BY created_at DESC
             LIMIT 100`,
            [placeId]
        );
        return res.json({ success: true, comments });
    } catch (error) {
        console.error('[mealmap comments list error]', error);
        return res.status(500).json({ success: false, message: '댓글을 불러오지 못했습니다.' });
    }
});

app.post('/api/mealmap/places/:placeId/comments', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateMealMapUserSession(req);
        const placeId = mealmapNumber(req.params.placeId, 0);
        const text = mealmapCleanText(req.body?.text || req.body?.commentText, 1000);
        if (!placeId || !text) return res.status(400).json({ success: false, message: '장소와 댓글 내용이 필요합니다.' });

        await pool.query(
            `INSERT INTO mealmap_comments (place_id, user_id, user_name, comment_text) VALUES (?, ?, ?, ?)`,
            [placeId, auth.user?.id || auth.id, auth.user?.name || auth.user?.id || auth.id, text]
        );
        return res.json({ success: true, message: '댓글이 등록되었습니다.' });
    } catch (error) {
        console.error('[mealmap comment create error]', error);
        return res.status(error.statusCode || 500).json({ success: false, reason: error.reason, message: error.message || '댓글을 등록하지 못했습니다.' });
    }
});

app.post('/api/mealmap/places/:placeId/like', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateMealMapUserSession(req);
        const placeId = mealmapNumber(req.params.placeId, 0);
        if (!placeId) return res.status(400).json({ success: false, message: 'placeId가 필요합니다.' });

        const userId = auth.user?.id || auth.id;
        const [existing] = await pool.query('SELECT id FROM mealmap_likes WHERE place_id = ? AND user_id = ? LIMIT 1', [placeId, userId]);
        if (existing.length >0) {
            await pool.query('DELETE FROM mealmap_likes WHERE place_id = ? AND user_id = ?', [placeId, userId]);
        } else {
            await pool.query('INSERT IGNORE INTO mealmap_likes (place_id, user_id) VALUES (?, ?)', [placeId, userId]);
        }
        const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM mealmap_likes WHERE place_id = ?', [placeId]);
        const likeCount = Number(countRows[0]?.cnt || 0);
        await pool.query('UPDATE mealmap_places SET like_count = ? WHERE id = ?', [likeCount, placeId]);
        return res.json({ success: true, liked: existing.length === 0, like_count: likeCount });
    } catch (error) {
        console.error('[mealmap like error]', error);
        return res.status(error.statusCode || 500).json({ success: false, reason: error.reason, message: error.message || '좋아요를 처리하지 못했습니다.' });
    }
});

app.post('/api/mealmap/places/:placeId/report', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateMealMapUserSession(req);
        const placeId = mealmapNumber(req.params.placeId, 0);
        const reason = mealmapCleanText(req.body?.reason, 2000);
        if (!placeId || !reason) return res.status(400).json({ success: false, message: '신고 사유가 필요합니다.' });

        await pool.query(
            `INSERT INTO mealmap_reports (place_id, user_id, user_name, reason) VALUES (?, ?, ?, ?)`,
            [placeId, auth.user?.id || auth.id, auth.user?.name || auth.user?.id || auth.id, reason]
        );
        const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM mealmap_reports WHERE place_id = ?', [placeId]);
        const reportCount = Number(countRows[0]?.cnt || 0);
        await pool.query('UPDATE mealmap_places SET report_count = ? WHERE id = ?', [reportCount, placeId]);
        return res.json({ success: true, report_count: reportCount, message: '신고가 접수되었습니다.' });
    } catch (error) {
        console.error('[mealmap report error]', error);
        return res.status(error.statusCode || 500).json({ success: false, reason: error.reason, message: error.message || '신고를 처리하지 못했습니다.' });
    }
});

app.get('/api/mealmap/search', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const keyword = mealmapCleanText(req.query.keyword, 80);
        if (!keyword) return res.json({ success: true, results: [] });

        const [localRows] = await pool.query(
            `SELECT id, name, address, road_address AS roadAddress, category, naver_url AS naverUrl, kakao_url AS kakaoUrl, COALESCE(kakao_url, naver_url) AS link, 'local'AS source
             FROM mealmap_places
             WHERE status = 'approved' AND (name LIKE ? OR address LIKE ? OR road_address LIKE ? OR main_menu LIKE ?)
             ORDER BY like_count DESC, updated_at DESC
             LIMIT 20`,
            [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
        );

        //  BEGIN =====
        const kakaoRestKey = mealmapKakaoRestKey();
        if (!kakaoRestKey) {
            return res.json({
                success: true,
                configured: false,
                provider: 'local',
                message: '카카오 Local REST API 키가 아직 없어 우공실 DB 안에서만 검색했습니다.',
                results: localRows,
            });
        }

        const query = new URLSearchParams({ query: keyword, size: '10' }).toString();
        let kakaoRows = [];
        try {
            const kakao = await mealmapHttpsJson(
                'dapi.kakao.com',
                `/v2/local/search/keyword.json?${query}`,
                { Authorization: `KakaoAK ${kakaoRestKey}` }
            );
            const documents = Array.isArray(kakao.data?.documents) ? kakao.data.documents : [];
            kakaoRows = documents.map((item) => ({
                name: item.place_name || '',
                title: item.place_name || '',
                category: String(item.category_name || '').split('>').pop().trim() || '식당',
                address: item.address_name || '',
                roadAddress: item.road_address_name || '',
                lat: item.y ? Number(item.y) : '',
                lng: item.x ? Number(item.x) : '',
                link: item.place_url || '',
                kakaoUrl: item.place_url || '',
                phone: item.phone || '',
                externalPlaceId: item.id || '',
                source: 'kakao',
            }));
        } catch (kakaoError) {
            console.warn('[mealmap kakao search skipped]', kakaoError.message || kakaoError);
        }

        return res.json({ success: true, configured: true, provider: 'kakao', results: [...localRows, ...kakaoRows] });
        //  END =====
    } catch (error) {
        console.error('[mealmap search error]', error);
        return res.status(500).json({ success: false, message: '식당 검색에 실패했습니다.' });
    }
});

app.get('/api/admin/mealmap/places', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateAdminSession(req);
        if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });

        const status = mealmapStatus(req.query.status, 'pending');
        const keyword = mealmapCleanText(req.query.keyword, 80);
        const where = [];
        const params = [];
        if (status !== 'all') {
            where.push('p.status = ?');
            params.push(status);
        }
        if (keyword) {
            where.push('(p.name LIKE ? OR p.address LIKE ? OR p.reporter_id LIKE ? OR p.reporter_name LIKE ?)');
            const like = `%${keyword}%`;
            params.push(like, like, like, like);
        }

        const [places] = await pool.query(
            `${mealmapPublicPlaceSelect()}
             ${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
             ORDER BY FIELD(p.status, 'pending', 'approved', 'rejected', 'hidden'), p.created_at DESC
             LIMIT 500`,
            params
        );
        const [statsRows] = await pool.query(`SELECT status, COUNT(*) AS cnt FROM mealmap_places GROUP BY status`);
        const stats = statsRows.reduce((acc, row) => ({ ...acc, [row.status]: Number(row.cnt || 0) }), {});
        return res.json({ success: true, places, stats });
    } catch (error) {
        console.error('[admin mealmap list error]', error);
        return res.status(500).json({ success: false, message: '회식맵 관리자 목록을 불러오지 못했습니다.' });
    }
});

app.post('/api/admin/mealmap/places/:placeId/approve', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateAdminSession(req);
        if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
        const placeId = mealmapNumber(req.params.placeId, 0);
        if (!placeId) return res.status(400).json({ success: false, message: 'placeId가 필요합니다.' });
        await pool.query(
            `UPDATE mealmap_places SET status = 'approved', approved_by = ?, approved_at = NOW(), admin_note = ? WHERE id = ?`,
            [auth.user?.id || auth.id, mealmapNullableText(req.body?.adminNote ?? req.body?.admin_note, 3000), placeId]
        );
        await notifyMealMapPlaceDecisionV2515(placeId, 'approved');
        return res.json({ success: true, message: '회식맵 식당이 승인되어 공개되었습니다.' });
    } catch (error) {
        console.error('[admin mealmap approve error]', error);
        return res.status(500).json({ success: false, message: '승인 처리에 실패했습니다.' });
    }
});

app.post('/api/admin/mealmap/places/:placeId/reject', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateAdminSession(req);
        if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
        const placeId = mealmapNumber(req.params.placeId, 0);
        if (!placeId) return res.status(400).json({ success: false, message: 'placeId가 필요합니다.' });
        await pool.query(
            `UPDATE mealmap_places SET status = 'rejected', admin_note = ? WHERE id = ?`,
            [mealmapNullableText(req.body?.adminNote ?? req.body?.admin_note, 3000), placeId]
        );
        await notifyMealMapPlaceDecisionV2515(placeId, 'rejected');
        return res.json({ success: true, message: '회식맵 식당 제보가 반려되었습니다.' });
    } catch (error) {
        console.error('[admin mealmap reject error]', error);
        return res.status(500).json({ success: false, message: '반려 처리에 실패했습니다.' });
    }
});

app.delete('/api/admin/mealmap/places/:placeId', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateAdminSession(req);
        if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });
        const placeId = mealmapNumber(req.params.placeId, 0);
        if (!placeId) return res.status(400).json({ success: false, message: 'placeId가 필요합니다.' });
        await pool.query('DELETE FROM mealmap_places WHERE id = ?', [placeId]);
        return res.json({ success: true, message: '회식맵 식당이 삭제되었습니다.' });
    } catch (error) {
        console.error('[admin mealmap delete error]', error);
        return res.status(500).json({ success: false, message: '삭제 처리에 실패했습니다.' });
    }
});





//  routes BEGIN =====
app.post('/api/mealmap/places/:placeId/edit-request', async (req, res) => {
  try {
    await ensureMealMapSchema();
    const auth = await validateMealMapUserSession(req);
    if (!auth.valid) {
      return res.status(401).json({ success: false, msg: '로그인이 필요합니다.', message: '로그인이 필요합니다.' });
    }
    const user = auth.user || auth;
    const placeId = Number(req.params.placeId || 0);
    if (!placeId) {
      return res.status(400).json({ success: false, msg: '수정 제안 대상 식당이 올바르지 않습니다.' });
    }

    const [places] = await pool.query(
      `SELECT id, status FROM mealmap_places WHERE id = ? LIMIT 1`,
      [placeId]
    );
    if (!places.length) {
      return res.status(404).json({ success: false, msg: '수정 제안 대상 식당을 찾을 수 없습니다.' });
    }
    if (places[0].status !== 'approved') {
      return res.status(400).json({ success: false, msg: '승인 완료된 식당만 수정 제안할 수 있습니다.' });
    }

    const body = req.body || {};
    const name = mealmapCleanText(body.name, 200);
    const address = mealmapCleanText(body.address, 255);
    const roadAddress = mealmapNullableText(body.roadAddress || body.road_address, 255);
    const category = mealmapCleanText(body.category, 50) || '기타';
    const minPrice = mealmapNumber(body.minPrice ?? body.min_price, 0);
    const maxPrice = mealmapNumber(body.maxPrice ?? body.max_price, minPrice);
    const lat = body.lat === '' || body.lat === null || body.lat === undefined ? null : Number(body.lat);
    const lng = body.lng === '' || body.lng === null || body.lng === undefined ? null : Number(body.lng);
    const mainMenu = mealmapNullableText(body.mainMenu || body.main_menu, 255);
    const openingHours = mealmapNullableText(body.openingHours || body.opening_hours, 100);
    const naverUrl = mealmapNullableText(body.naverUrl || body.naver_url, 500);
    const kakaoUrl = mealmapNullableText(body.kakaoUrl || body.kakao_url, 500);
    const reason = mealmapNullableText(body.reason, 2000);

    if (!name || !address) {
      return res.status(400).json({ success: false, msg: '식당명과 주소는 필수입니다.' });
    }
    if (maxPrice < minPrice) {
      return res.status(400).json({ success: false, msg: '최대 가격은 최소 가격보다 작을 수 없습니다.' });
    }
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
      return res.status(400).json({ success: false, msg: '좌표 값이 올바르지 않습니다.' });
    }

    await pool.query(
      `INSERT INTO mealmap_place_edits
        (place_id, user_id, user_name, reason, proposed_name, proposed_address, proposed_road_address,
         proposed_lat, proposed_lng, proposed_category, proposed_min_price, proposed_max_price,
         proposed_main_menu, proposed_opening_hours, proposed_naver_url, proposed_kakao_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        placeId,
        user.id || user.user_id || null,
        user.nickname || user.name || user.username || user.user_name || '사용자',
        reason,
        name,
        address,
        roadAddress,
        lat,
        lng,
        category,
        minPrice,
        maxPrice,
        mainMenu,
        openingHours,
        naverUrl,
        kakaoUrl,
      ]
    );

    return res.json({ success: true, msg: '수정 제안이 접수되었습니다. 관리자 승인 후 반영됩니다.' });
  } catch (err) {
    console.error('[mealmap edit request error]', err);
    return res.status(err.statusCode || 500).json({ success: false, msg: err.message || '수정 제안 접수에 실패했습니다.', message: err.message || '수정 제안 접수에 실패했습니다.' });
  }
});

app.get('/api/admin/mealmap/edits', async (req, res) => {
  try {
    await ensureMealMapSchema();
    const auth = await validateAdminSession(req);
    if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, msg: '관리자 권한이 없습니다.', message: '관리자 권한이 없습니다.' });

    const allowedStatuses = ['pending', 'approved', 'rejected', 'all'];
    const status = allowedStatuses.includes(String(req.query.status || 'pending')) ? String(req.query.status || 'pending') : 'pending';
    const keyword = mealmapCleanText(req.query.keyword, 100);

    const where = [];
    const params = [];
    if (status !== 'all') {
      where.push('e.status = ?');
      params.push(status);
    }
    if (keyword) {
      where.push(`(e.proposed_name LIKE ? OR e.proposed_address LIKE ? OR e.user_name LIKE ? OR p.name LIKE ?)`);
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const [statsRows] = await pool.query(`SELECT status, COUNT(*) AS cnt
      FROM mealmap_place_edits
      GROUP BY status
    `);
    const stats = { pending: 0, approved: 0, rejected: 0, all: 0 };
    statsRows.forEach((row) => {
      const key = row.status;
      const cnt = Number(row.cnt || 0);
      stats[key] = cnt;
      stats.all += cnt;
    });

    const [edits] = await pool.query(
      `SELECT
          e.*,
          p.name AS current_name,
          p.address AS current_address,
          p.road_address AS current_road_address,
          p.lat AS current_lat,
          p.lng AS current_lng,
          p.category AS current_category,
          p.min_price AS current_min_price,
          p.max_price AS current_max_price,
          p.main_menu AS current_main_menu,
          p.opening_hours AS current_opening_hours,
          p.naver_url AS current_naver_url,
          p.kakao_url AS current_kakao_url
       FROM mealmap_place_edits e
       JOIN mealmap_places p ON p.id = e.place_id
       ${whereSql}
       ORDER BY e.id DESC
       LIMIT 200`,
      params
    );

    return res.json({ success: true, stats, edits });
  } catch (err) {
    console.error('[admin mealmap edit list error]', err);
    return res.status(500).json({ success: false, msg: '회식맵 수정 요청 목록 조회에 실패했습니다.', message: '회식맵 수정 요청 목록 조회에 실패했습니다.' });
  }
});

app.post('/api/admin/mealmap/edits/:id/approve', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureMealMapSchema();
    const auth = await validateAdminSession(req);
    if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, msg: '관리자 권한이 없습니다.', message: '관리자 권한이 없습니다.' });
    const admin = auth.user || auth;
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({ success: false, msg: '수정 요청 ID가 올바르지 않습니다.' });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT * FROM mealmap_place_edits WHERE id = ? FOR UPDATE`, [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, msg: '수정 요청을 찾을 수 없습니다.' });
    }
    const edit = rows[0];
    if (edit.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ success: false, msg: '이미 처리된 수정 요청입니다.' });
    }

    await conn.query(
      `UPDATE mealmap_places
       SET name = ?, address = ?, road_address = ?, lat = ?, lng = ?, category = ?,
           min_price = ?, max_price = ?, main_menu = ?, opening_hours = ?,
           naver_url = ?, kakao_url = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        edit.proposed_name,
        edit.proposed_address,
        edit.proposed_road_address,
        edit.proposed_lat,
        edit.proposed_lng,
        edit.proposed_category,
        edit.proposed_min_price,
        edit.proposed_max_price,
        edit.proposed_main_menu,
        edit.proposed_opening_hours,
        edit.proposed_naver_url,
        edit.proposed_kakao_url,
        edit.place_id,
      ]
    );

    await conn.query(
      `UPDATE mealmap_place_edits
       SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ?`,
      [mealmapNullableText((req.body || {}).adminNote, 2000), admin.id || admin.user_id || null, id]
    );
    await conn.commit();
    await notifyMealMapEditDecisionV2515(id, 'approved');
    return res.json({ success: true, msg: '수정 요청을 승인하고 식당 정보에 반영했습니다.' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[admin mealmap edit approve error]', err);
    return res.status(500).json({ success: false, msg: '수정 요청 승인에 실패했습니다.', message: '수정 요청 승인에 실패했습니다.' });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/mealmap/edits/:id/reject', async (req, res) => {
  try {
    await ensureMealMapSchema();
    const auth = await validateAdminSession(req);
    if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, msg: '관리자 권한이 없습니다.', message: '관리자 권한이 없습니다.' });
    const admin = auth.user || auth;
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({ success: false, msg: '수정 요청 ID가 올바르지 않습니다.' });
    }
    const [result] = await pool.query(
      `UPDATE mealmap_place_edits
       SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [mealmapNullableText((req.body || {}).adminNote, 2000), admin.id || admin.user_id || null, id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, msg: '처리 가능한 수정 요청을 찾지 못했습니다.' });
    }
    await notifyMealMapEditDecisionV2515(id, 'rejected');
    return res.json({ success: true, msg: '수정 요청을 반려했습니다.' });
  } catch (err) {
    console.error('[admin mealmap edit reject error]', err);
    return res.status(500).json({ success: false, msg: '수정 요청 반려에 실패했습니다.', message: '수정 요청 반려에 실패했습니다.' });
  }
});
//  routes END =====



//  routes BEGIN =====
app.post('/api/mealmap/places/:placeId/edit-request', async (req, res) => {
  try {
    await ensureMealMapSchema();
    const auth = await validateMealMapUserSession(req);
    if (!auth.valid) {
      return res.status(401).json({ success: false, msg: '로그인이 필요합니다.', message: '로그인이 필요합니다.' });
    }
    const user = auth.user || auth;
    const placeId = Number(req.params.placeId || 0);
    if (!placeId) {
      return res.status(400).json({ success: false, msg: '수정 제안 대상 식당이 올바르지 않습니다.' });
    }

    const [places] = await pool.query(
      `SELECT id, status FROM mealmap_places WHERE id = ? LIMIT 1`,
      [placeId]
    );
    if (!places.length) {
      return res.status(404).json({ success: false, msg: '수정 제안 대상 식당을 찾을 수 없습니다.' });
    }
    if (places[0].status !== 'approved') {
      return res.status(400).json({ success: false, msg: '승인 완료된 식당만 수정 제안할 수 있습니다.' });
    }

    const body = req.body || {};
    const name = mealmapCleanText(body.name, 200);
    const address = mealmapCleanText(body.address, 255);
    const roadAddress = mealmapNullableText(body.roadAddress || body.road_address, 255);
    const category = mealmapCleanText(body.category, 50) || '기타';
    const minPrice = mealmapNumber(body.minPrice ?? body.min_price, 0);
    const maxPrice = mealmapNumber(body.maxPrice ?? body.max_price, minPrice);
    const lat = body.lat === '' || body.lat === null || body.lat === undefined ? null : Number(body.lat);
    const lng = body.lng === '' || body.lng === null || body.lng === undefined ? null : Number(body.lng);
    const mainMenu = mealmapNullableText(body.mainMenu || body.main_menu, 255);
    const openingHours = mealmapNullableText(body.openingHours || body.opening_hours, 100);
    const naverUrl = mealmapNullableText(body.naverUrl || body.naver_url, 500);
    const kakaoUrl = mealmapNullableText(body.kakaoUrl || body.kakao_url, 500);
    const reason = mealmapNullableText(body.reason, 2000);

    if (!name || !address) {
      return res.status(400).json({ success: false, msg: '식당명과 주소는 필수입니다.' });
    }
    if (maxPrice < minPrice) {
      return res.status(400).json({ success: false, msg: '최대 가격은 최소 가격보다 작을 수 없습니다.' });
    }
    if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng))) {
      return res.status(400).json({ success: false, msg: '좌표 값이 올바르지 않습니다.' });
    }

    await pool.query(
      `INSERT INTO mealmap_place_edits
        (place_id, user_id, user_name, reason, proposed_name, proposed_address, proposed_road_address,
         proposed_lat, proposed_lng, proposed_category, proposed_min_price, proposed_max_price,
         proposed_main_menu, proposed_opening_hours, proposed_naver_url, proposed_kakao_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        placeId,
        user.id || user.user_id || null,
        user.nickname || user.name || user.username || user.user_name || '사용자',
        reason,
        name,
        address,
        roadAddress,
        lat,
        lng,
        category,
        minPrice,
        maxPrice,
        mainMenu,
        openingHours,
        naverUrl,
        kakaoUrl,
      ]
    );

    return res.json({ success: true, msg: '수정 제안이 접수되었습니다. 관리자 승인 후 반영됩니다.' });
  } catch (err) {
    console.error('[mealmap edit request error]', err);
    return res.status(err.statusCode || 500).json({ success: false, msg: err.message || '수정 제안 접수에 실패했습니다.', message: err.message || '수정 제안 접수에 실패했습니다.' });
  }
});

app.get('/api/admin/mealmap/edits', async (req, res) => {
  try {
    await ensureMealMapSchema();
    const auth = await validateAdminSession(req);
    if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, msg: '관리자 권한이 없습니다.', message: '관리자 권한이 없습니다.' });

    const allowedStatuses = ['pending', 'approved', 'rejected', 'all'];
    const status = allowedStatuses.includes(String(req.query.status || 'pending')) ? String(req.query.status || 'pending') : 'pending';
    const keyword = mealmapCleanText(req.query.keyword, 100);

    const where = [];
    const params = [];
    if (status !== 'all') {
      where.push('e.status = ?');
      params.push(status);
    }
    if (keyword) {
      where.push(`(e.proposed_name LIKE ? OR e.proposed_address LIKE ? OR e.user_name LIKE ? OR p.name LIKE ?)`);
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const [statsRows] = await pool.query(`SELECT status, COUNT(*) AS cnt
      FROM mealmap_place_edits
      GROUP BY status
    `);
    const stats = { pending: 0, approved: 0, rejected: 0, all: 0 };
    statsRows.forEach((row) => {
      const key = row.status;
      const cnt = Number(row.cnt || 0);
      stats[key] = cnt;
      stats.all += cnt;
    });

    const [edits] = await pool.query(
      `SELECT
          e.*,
          p.name AS current_name,
          p.address AS current_address,
          p.road_address AS current_road_address,
          p.lat AS current_lat,
          p.lng AS current_lng,
          p.category AS current_category,
          p.min_price AS current_min_price,
          p.max_price AS current_max_price,
          p.main_menu AS current_main_menu,
          p.opening_hours AS current_opening_hours,
          p.naver_url AS current_naver_url,
          p.kakao_url AS current_kakao_url
       FROM mealmap_place_edits e
       JOIN mealmap_places p ON p.id = e.place_id
       ${whereSql}
       ORDER BY e.id DESC
       LIMIT 200`,
      params
    );

    return res.json({ success: true, stats, edits });
  } catch (err) {
    console.error('[admin mealmap edit list error]', err);
    return res.status(500).json({ success: false, msg: '회식맵 수정 요청 목록 조회에 실패했습니다.', message: '회식맵 수정 요청 목록 조회에 실패했습니다.' });
  }
});

app.post('/api/admin/mealmap/edits/:id/approve', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureMealMapSchema();
    const auth = await validateAdminSession(req);
    if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, msg: '관리자 권한이 없습니다.', message: '관리자 권한이 없습니다.' });
    const admin = auth.user || auth;
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({ success: false, msg: '수정 요청 ID가 올바르지 않습니다.' });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query(`SELECT * FROM mealmap_place_edits WHERE id = ? FOR UPDATE`, [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, msg: '수정 요청을 찾을 수 없습니다.' });
    }
    const edit = rows[0];
    if (edit.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ success: false, msg: '이미 처리된 수정 요청입니다.' });
    }

    await conn.query(
      `UPDATE mealmap_places
       SET name = ?, address = ?, road_address = ?, lat = ?, lng = ?, category = ?,
           min_price = ?, max_price = ?, main_menu = ?, opening_hours = ?,
           naver_url = ?, kakao_url = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        edit.proposed_name,
        edit.proposed_address,
        edit.proposed_road_address,
        edit.proposed_lat,
        edit.proposed_lng,
        edit.proposed_category,
        edit.proposed_min_price,
        edit.proposed_max_price,
        edit.proposed_main_menu,
        edit.proposed_opening_hours,
        edit.proposed_naver_url,
        edit.proposed_kakao_url,
        edit.place_id,
      ]
    );

    await conn.query(
      `UPDATE mealmap_place_edits
       SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ?`,
      [mealmapNullableText((req.body || {}).adminNote, 2000), admin.id || admin.user_id || null, id]
    );
    await conn.commit();
    await notifyMealMapEditDecisionV2515(id, 'approved');
    return res.json({ success: true, msg: '수정 요청을 승인하고 식당 정보에 반영했습니다.' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[admin mealmap edit approve error]', err);
    return res.status(500).json({ success: false, msg: '수정 요청 승인에 실패했습니다.', message: '수정 요청 승인에 실패했습니다.' });
  } finally {
    conn.release();
  }
});

app.post('/api/admin/mealmap/edits/:id/reject', async (req, res) => {
  try {
    await ensureMealMapSchema();
    const auth = await validateAdminSession(req);
    if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, msg: '관리자 권한이 없습니다.', message: '관리자 권한이 없습니다.' });
    const admin = auth.user || auth;
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({ success: false, msg: '수정 요청 ID가 올바르지 않습니다.' });
    }
    const [result] = await pool.query(
      `UPDATE mealmap_place_edits
       SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [mealmapNullableText((req.body || {}).adminNote, 2000), admin.id || admin.user_id || null, id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, msg: '처리 가능한 수정 요청을 찾지 못했습니다.' });
    }
    await notifyMealMapEditDecisionV2515(id, 'rejected');
    return res.json({ success: true, msg: '수정 요청을 반려했습니다.' });
  } catch (err) {
    console.error('[admin mealmap edit reject error]', err);
    return res.status(500).json({ success: false, msg: '수정 요청 반려에 실패했습니다.', message: '수정 요청 반려에 실패했습니다.' });
  }
});
//  routes END =====
}

module.exports = registerMealmapRoutes;
