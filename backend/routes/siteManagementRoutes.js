// 화면 설정, 수업 달력, 회식맵 관리자 API를 제공합니다.
'use strict';

const registerClassScheduleRoutes = require('./site/classScheduleRoutes');

function registerSiteManagementRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const validateAdminSession = options.validateAdminSession;
    const io = options.io || { emit() {} };
    const mealmapKakaoMapJsKey = options.mealmapKakaoMapJsKey;
    const mealmapKakaoRestKey = options.mealmapKakaoRestKey;
    const mealmapHttpsJson = options.mealmapHttpsJson;
    const ADMIN_USER_ID = String(options.adminUserId || process.env.WGS_ADMIN_USER_ID || process.env.ADMIN_USER_ID || '').trim().toLowerCase();

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerSiteManagementRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerSiteManagementRoutes requires a MySQL pool.');
    }
    if (typeof validateAdminSession !== 'function') {
        throw new Error('registerSiteManagementRoutes requires validateAdminSession.');
    }
    if (typeof mealmapKakaoMapJsKey !== 'function' || typeof mealmapKakaoRestKey !== 'function' || typeof mealmapHttpsJson !== 'function') {
        throw new Error('registerSiteManagementRoutes requires MealMap Kakao helper functions.');
    }
// 관리자 화면의 "화면 설정 관리" 탭에서 페이지별/전체 공통 텍스트, 레이아웃,
// 색상, 이미지 경로를 CRUD로 관리하기 위한 API입니다.
// 기존 문제 풀이, 로그인, 게시판 로직과 분리된 wgs_screen_settings 테이블만 사용합니다.

const SCREEN_SETTING_PAGE_KEYS = ['all', 'home', 'cert_ipe', 'written', 'past', 'random', 'ipep', 'wrong', 'mypage', 'board', 'faq', 'fortune', 'exam', 'mealmap', 'multiplayer', 'login', 'signup', 'find_auth', 'change_pw', 'admin'];
const SCREEN_SETTING_TYPES = ['text', 'layout', 'color', 'image', 'link'];

function cleanScreenSettingText(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value).trim();
}

function normalizeScreenSettingPayload(body = {}) {
    const page_key = cleanScreenSettingText(body.page_key || body.pageKey, 'all');
    const section_key = cleanScreenSettingText(body.section_key || body.sectionKey, 'common');
    const setting_type = cleanScreenSettingText(body.setting_type || body.settingType, 'text');
    const setting_key = cleanScreenSettingText(body.setting_key || body.settingKey, '');
    const setting_label = cleanScreenSettingText(body.setting_label || body.settingLabel, '');
    const setting_value = body.setting_value !== undefined ? String(body.setting_value) : String(body.settingValue || '');
    const description = body.description !== undefined ? String(body.description || '') : '';
    const sort_order = Number.isFinite(Number(body.sort_order ?? body.sortOrder)) ? Number(body.sort_order ?? body.sortOrder) : 0;
    const is_active = Number(body.is_active ?? body.isActive ?? 1) ? 1 : 0;
    const admin_id = cleanScreenSettingText(body.admin_id || body.adminId || body.updated_by || body.updatedBy, 'admin');

    return {
        page_key,
        section_key: section_key || 'common',
        setting_type,
        setting_key,
        setting_label,
        setting_value,
        description,
        sort_order,
        is_active,
        admin_id,
    };
}

function validateScreenSetting(payload) {
    if (!SCREEN_SETTING_PAGE_KEYS.includes(payload.page_key)) {
        return `page_key는 ${SCREEN_SETTING_PAGE_KEYS.join(', ')} 중 하나여야 합니다.`;
    }
    if (!SCREEN_SETTING_TYPES.includes(payload.setting_type)) {
        return `setting_type은 ${SCREEN_SETTING_TYPES.join(', ')} 중 하나여야 합니다.`;
    }
    if (!payload.setting_key) return '설정 키(setting_key)를 입력해주세요.';
    if (!/^[a-zA-Z0-9_.\-]{2,100}$/.test(payload.setting_key)) {
        return '설정 키는 영문, 숫자, _, -, . 조합 2~100자로 입력해주세요.';
    }
    if (!payload.setting_label) return '관리자 화면에 표시될 설정 이름을 입력해주세요.';
    return null;
}

// 공개 조회 API: 실제 페이지에서 화면 설정을 읽어갈 때 사용합니다.
// - 일반 사용자 화면에서도 읽어야 하므로 공개 API로 유지합니다.
// - page_key를 넘기면 전체 공통(all) + 해당 페이지 설정을 함께 내려줍니다.
// - settings 배열은 관리자/디버깅용, settingsMap은 프론트 적용용입니다.

    registerClassScheduleRoutes({
        app,
        pool,
    });

app.get('/api/screen-settings', async (req, res) => {
    try {
        const pageKey = cleanScreenSettingText(req.query.page_key || req.query.pageKey, '');
        const params = [];
        let where = ' WHERE is_active = 1';

        if (pageKey) {
            where += ' AND page_key IN (?, ?)';
            params.push('all', pageKey);
        }

        const [rows] = await pool.query(
            `SELECT id, page_key, section_key, setting_type, setting_key, setting_label,
                    setting_value, description, sort_order, is_active, updated_at
               FROM wgs_screen_settings
               ${where}
              ORDER BY FIELD(page_key, 'all', ?), page_key, sort_order ASC, id ASC`,
            [...params, pageKey || 'all']
        );

        const settingsMap = buildScreenSettingsMap(rows);

        res.json({
            ok: true,
            settings: rows,
            settingsMap,
            version: rows.reduce((latest, row) => {
                const value = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                return value >latest ? value : latest;
            }, 0),
        });
    } catch (error) {
        console.error('GET /api/screen-settings error:', error);
        res.status(500).json({ ok: false, message: '화면 설정을 불러오지 못했습니다.' });
    }
});

//  화면 설정 관리자 API 공통 인증 함수
// - 관리자 API는 반드시 서버에서 세션과 관리자 권한 여부를 다시 확인합니다.
// - 프론트에서 admin_id를 보내도 그대로 믿지 않고, 서버가 검증한 사용자 ID를 사용합니다.
async function requireScreenSettingAdmin(req, res) {
    const adminCheck = await validateAdminSession(req);

    if (!adminCheck.valid || !adminCheck.isAdmin) {
        const isNotAdmin = adminCheck.reason === 'not_admin';
        const status = isNotAdmin ? 403 : 401;
        const message = isNotAdmin
            ? '관리자만 사용할 수 있는 기능입니다.'
            : '로그인 세션이 만료되었습니다. 다시 로그인해주세요.';

        res.status(status).json({
            ok: false,
            message,
            reason: adminCheck.reason || 'invalid_session',
        });
        return null;
    }

    return adminCheck;
}

//  화면 설정 공개 응답용 Map 생성 함수
// - 프론트에서 get('home.hero.title')처럼 빠르게 찾을 수 있게 하기 위한 구조입니다.
function buildScreenSettingsMap(rows = []) {
    const map = {};

    for (const row of rows || []) {
        const pageKey = String(row.page_key || '').trim();
        const sectionKey = String(row.section_key || '').trim();
        const settingKey = String(row.setting_key || '').trim();

        if (!pageKey || !sectionKey || !settingKey) continue;

        const value = row.setting_value ?? '';
        const fullKey = `${pageKey}.${sectionKey}.${settingKey}`;
        const sectionOnlyKey = `${sectionKey}.${settingKey}`;

        map[fullKey] = value;

        // page_key가 all이면 공통 키도 같이 제공합니다.
        if (pageKey === 'all') {
            map[`all.${sectionOnlyKey}`] = value;
        } else {
            map[sectionOnlyKey] = value;
        }
    }

    return map;
}

//  화면 설정 변경 이벤트 발송 함수
// - 지금은 백엔드 기반만 먼저 준비합니다.
// - 다음 단계에서 프론트 useScreenSettings가 이 이벤트를 받아 즉시 새 설정을 다시 불러오게 됩니다.
function emitScreenSettingsUpdated(payload = {}) {
    if (!io) return;

    io.emit('screen-settings-updated', {
        ok: true,
        ...payload,
        updated_at: new Date().toISOString(),
    });
}

// 관리자 목록 조회
app.get('/api/admin/screen-settings', async (req, res) => {
    try {
        const adminCheck = await requireScreenSettingAdmin(req, res);
        if (!adminCheck) return;

        const pageKey = cleanScreenSettingText(req.query.page_key || req.query.pageKey, '');
        const settingType = cleanScreenSettingText(req.query.setting_type || req.query.settingType, '');
        const keyword = cleanScreenSettingText(req.query.keyword, '');
        const activeOnly = cleanScreenSettingText(req.query.activeOnly, '') === '1';

        const where = [];
        const params = [];

        if (pageKey) {
            where.push('page_key = ?');
            params.push(pageKey);
        }

        if (settingType) {
            where.push('setting_type = ?');
            params.push(settingType);
        }

        if (activeOnly) {
            where.push('is_active = 1');
        }

        if (keyword) {
            where.push('(setting_key LIKE ? OR setting_label LIKE ? OR setting_value LIKE ? OR description LIKE ?)');
            const like = `%${keyword}%`;
            params.push(like, like, like, like);
        }

        const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')}` : '';

        const [rows] = await pool.query(
            `SELECT id, page_key, section_key, setting_type, setting_key, setting_label,
                    setting_value, description, sort_order, is_active,
                    created_by, updated_by, created_at, updated_at
               FROM wgs_screen_settings
               ${sqlWhere}
              ORDER BY page_key ASC, sort_order ASC, id ASC`,
            params
        );

        const [[summary]] = await pool.query(`SELECT
                COUNT(*) AS total_count,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
                SUM(CASE WHEN setting_type = 'text'THEN 1 ELSE 0 END) AS text_count,
                SUM(CASE WHEN setting_type = 'layout'THEN 1 ELSE 0 END) AS layout_count,
                SUM(CASE WHEN setting_type = 'color'THEN 1 ELSE 0 END) AS color_count,
                SUM(CASE WHEN setting_type = 'image'THEN 1 ELSE 0 END) AS image_count
              FROM wgs_screen_settings
        `);

        res.json({ ok: true, settings: rows, summary });
    } catch (error) {
        console.error('GET /api/admin/screen-settings error:', error);
        res.status(500).json({ ok: false, message: '화면 설정 목록을 불러오지 못했습니다.' });
    }
});

// 관리자 등록
app.post('/api/admin/screen-settings', async (req, res) => {
    try {
        const adminCheck = await requireScreenSettingAdmin(req, res);
        if (!adminCheck) return;

        const adminId = String(adminCheck.user?.id || adminCheck.id || ADMIN_USER_ID);
        const payload = normalizeScreenSettingPayload({
            ...req.body,
            admin_id: adminId,
            adminId,
            updated_by: adminId,
            updatedBy: adminId,
        });

        const validationMessage = validateScreenSetting(payload);
        if (validationMessage) return res.status(400).json({ ok: false, message: validationMessage });

        const [result] = await pool.query(
            `INSERT INTO wgs_screen_settings
                (page_key, section_key, setting_type, setting_key, setting_label, setting_value,
                 description, sort_order, is_active, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.page_key, payload.section_key, payload.setting_type, payload.setting_key, payload.setting_label,
             payload.setting_value, payload.description, payload.sort_order, payload.is_active, adminId, adminId]
        );

        emitScreenSettingsUpdated({
            action: 'create',
            id: result.insertId,
            page_key: payload.page_key,
            section_key: payload.section_key,
            setting_key: payload.setting_key,
        });

        res.json({ ok: true, id: result.insertId, message: '화면 설정이 추가되었습니다.' });
    } catch (error) {
        console.error('POST /api/admin/screen-settings error:', error);
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ ok: false, message: '같은 페이지/섹션/설정 키가 이미 존재합니다.' });
        }
        res.status(500).json({ ok: false, message: '화면 설정을 추가하지 못했습니다.' });
    }
});

// 관리자 수정
app.put('/api/admin/screen-settings/:id', async (req, res) => {
    try {
        const adminCheck = await requireScreenSettingAdmin(req, res);
        if (!adminCheck) return;

        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: '잘못된 설정 ID입니다.' });

        const adminId = String(adminCheck.user?.id || adminCheck.id || ADMIN_USER_ID);
        const payload = normalizeScreenSettingPayload({
            ...req.body,
            admin_id: adminId,
            adminId,
            updated_by: adminId,
            updatedBy: adminId,
        });

        const validationMessage = validateScreenSetting(payload);
        if (validationMessage) return res.status(400).json({ ok: false, message: validationMessage });

        const [result] = await pool.query(
            `UPDATE wgs_screen_settings
                SET page_key = ?, section_key = ?, setting_type = ?, setting_key = ?, setting_label = ?,
                    setting_value = ?, description = ?, sort_order = ?, is_active = ?, updated_by = ?
              WHERE id = ?`,
            [payload.page_key, payload.section_key, payload.setting_type, payload.setting_key, payload.setting_label,
             payload.setting_value, payload.description, payload.sort_order, payload.is_active, adminId, id]
        );

        if (result.affectedRows === 0) return res.status(404).json({ ok: false, message: '수정할 화면 설정을 찾지 못했습니다.' });

        emitScreenSettingsUpdated({
            action: 'update',
            id,
            page_key: payload.page_key,
            section_key: payload.section_key,
            setting_key: payload.setting_key,
        });

        res.json({ ok: true, message: '화면 설정이 수정되었습니다.' });
    } catch (error) {
        console.error('PUT /api/admin/screen-settings/:id error:', error);
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ ok: false, message: '같은 페이지/섹션/설정 키가 이미 존재합니다.' });
        }
        res.status(500).json({ ok: false, message: '화면 설정을 수정하지 못했습니다.' });
    }
});

// 관리자 활성/비활성 전환
app.patch('/api/admin/screen-settings/:id/toggle', async (req, res) => {
    try {
        const adminCheck = await requireScreenSettingAdmin(req, res);
        if (!adminCheck) return;

        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: '잘못된 설정 ID입니다.' });

        const adminId = String(adminCheck.user?.id || adminCheck.id || ADMIN_USER_ID);

        const [result] = await pool.query(
            `UPDATE wgs_screen_settings
                SET is_active = IF(is_active = 1, 0, 1), updated_by = ?
              WHERE id = ?`,
            [adminId, id]
        );

        if (result.affectedRows === 0) return res.status(404).json({ ok: false, message: '변경할 화면 설정을 찾지 못했습니다.' });

        emitScreenSettingsUpdated({
            action: 'toggle',
            id,
        });

        res.json({ ok: true, message: '활성 상태가 변경되었습니다.' });
    } catch (error) {
        console.error('PATCH /api/admin/screen-settings/:id/toggle error:', error);
        res.status(500).json({ ok: false, message: '활성 상태를 변경하지 못했습니다.' });
    }
});

// 관리자 삭제
app.delete('/api/admin/screen-settings/:id', async (req, res) => {
    try {
        const adminCheck = await requireScreenSettingAdmin(req, res);
        if (!adminCheck) return;

        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: '잘못된 설정 ID입니다.' });

        const [result] = await pool.query('DELETE FROM wgs_screen_settings WHERE id = ?', [id]);

        if (result.affectedRows === 0) return res.status(404).json({ ok: false, message: '삭제할 화면 설정을 찾지 못했습니다.' });

        emitScreenSettingsUpdated({
            action: 'delete',
            id,
        });

        res.json({ ok: true, message: '화면 설정이 삭제되었습니다.' });
    } catch (error) {
        console.error('DELETE /api/admin/screen-settings/:id error:', error);
        res.status(500).json({ ok: false, message: '화면 설정을 삭제하지 못했습니다.' });
    }
});

// 전체 페이지 일괄 등록/갱신
app.post('/api/admin/screen-settings/bulk', async (req, res) => {
    try {
        const adminCheck = await requireScreenSettingAdmin(req, res);
        if (!adminCheck) return;

        const adminId = String(adminCheck.user?.id || adminCheck.id || ADMIN_USER_ID);
        const payload = normalizeScreenSettingPayload({
            ...req.body,
            page_key: 'all',
            admin_id: adminId,
            adminId,
            updated_by: adminId,
            updatedBy: adminId,
        });

        const validationMessage = validateScreenSetting(payload);
        if (validationMessage) return res.status(400).json({ ok: false, message: validationMessage });

        await pool.query(
            `INSERT INTO wgs_screen_settings
                (page_key, section_key, setting_type, setting_key, setting_label, setting_value,
                 description, sort_order, is_active, created_by, updated_by)
             VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                setting_type = VALUES(setting_type),
                setting_label = VALUES(setting_label),
                setting_value = VALUES(setting_value),
                description = VALUES(description),
                sort_order = VALUES(sort_order),
                is_active = VALUES(is_active),
                updated_by = VALUES(updated_by)`,
            [payload.section_key, payload.setting_type, payload.setting_key, payload.setting_label,
             payload.setting_value, payload.description, payload.sort_order, payload.is_active, adminId, adminId]
        );

        emitScreenSettingsUpdated({
            action: 'bulk-upsert',
            page_key: 'all',
            section_key: payload.section_key,
            setting_key: payload.setting_key,
        });

        res.json({ ok: true, message: '전체 페이지 공통 설정이 저장되었습니다.' });
    } catch (error) {
        console.error('POST /api/admin/screen-settings/bulk error:', error);
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ ok: false, message: '같은 페이지/섹션/설정 키가 이미 존재합니다.' });
        }
        res.status(500).json({ ok: false, message: '전체 페이지 공통 설정을 저장하지 못했습니다.' });
    }
});



//  BEGIN =====
// 회식맵 레이아웃 공개/관리자 API는 React SPA 대체 라우팅과 API 404 미들웨어보다 위에 있어야 합니다.
const MEALMAP_DEFAULT_LAYOUTS_V253 = {
  contentMaxWidth: '1480px',
  heroTitleSize: '42px',
  mapMinHeight: '760px',
  detailPanelWidth: '360px',
  cardRadius: '24px',
  sectionGap: '24px',
};

async function ensureMealMapLayoutSettingsTableV253() {
  await pool.query(`CREATE TABLE IF NOT EXISTS mealmap_page_layouts (
      setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
      setting_value VARCHAR(120) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  for (const [settingKey, settingValue] of Object.entries(MEALMAP_DEFAULT_LAYOUTS_V253)) {
    await pool.query(
      `INSERT IGNORE INTO mealmap_page_layouts (setting_key, setting_value) VALUES (?, ?)`,
      [settingKey, String(settingValue)]
    );
  }
}

async function getMealMapLayoutSettingsV253() {
  await ensureMealMapLayoutSettingsTableV253();
  const [rows] = await pool.query(`SELECT setting_key, setting_value FROM mealmap_page_layouts`);
  const out = { ...MEALMAP_DEFAULT_LAYOUTS_V253 };
  for (const row of rows || []) {
    out[row.setting_key] = row.setting_value;
  }
  return out;
}

function sanitizeMealMapLayoutValueV253(key, value) {
  const allowed = new Set(Object.keys(MEALMAP_DEFAULT_LAYOUTS_V253));
  if (!allowed.has(key)) return null;
  const raw = String(value ?? '').trim();
  if (!raw) return MEALMAP_DEFAULT_LAYOUTS_V253[key];
  // CSS injection 방지: 숫자, px, rem, %, vw, vh, clamp(), calc()에 필요한 안전 문자만 허용합니다.
  const safe = raw.replace(/[^0-9a-zA-Z가-힣.%() +\-_,]/g, '').slice(0, 80);
  return safe || MEALMAP_DEFAULT_LAYOUTS_V253[key];
}

app.get('/api/mealmap/layouts', async (req, res) => {
  try {
    const layouts = await getMealMapLayoutSettingsV253();
    return res.json({ success: true, layouts });
  } catch (err) {
    console.error('[mealmap layouts public]', err);
    return res.status(500).json({ success: false, msg: '회식맵 레이아웃 설정을 불러오지 못했습니다.' });
  }
});

app.get('/api/admin/mealmap/layouts', async (req, res) => {
  try {
    const admin = await validateAdminSession(req);
    if (!(admin?.ok || admin?.valid)) return res.status(admin?.statusCode || 401).json({ success: false, msg: admin?.message || '관리자 권한 확인에 실패했습니다.' });
    const layouts = await getMealMapLayoutSettingsV253();
    return res.json({ success: true, layouts });
  } catch (err) {
    console.error('[mealmap layouts admin get]', err);
    return res.status(500).json({ success: false, msg: '회식맵 레이아웃 설정을 불러오지 못했습니다.' });
  }
});

app.put('/api/admin/mealmap/layouts', async (req, res) => {
  try {
    const admin = await validateAdminSession(req);
    if (!(admin?.ok || admin?.valid)) return res.status(admin?.statusCode || 401).json({ success: false, msg: admin?.message || '관리자 권한 확인에 실패했습니다.' });
    await ensureMealMapLayoutSettingsTableV253();
    const layouts = req.body?.layouts || {};
    const keys = Object.keys(MEALMAP_DEFAULT_LAYOUTS_V253);
    for (const key of keys) {
      const value = sanitizeMealMapLayoutValueV253(key, layouts[key]);
      await pool.query(
        `INSERT INTO mealmap_page_layouts (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
        [key, value]
      );
    }
    const saved = await getMealMapLayoutSettingsV253();
    return res.json({ success: true, layouts: saved, msg: '회식맵 레이아웃 설정이 저장되었습니다.' });
  } catch (err) {
    console.error('[mealmap layouts admin put]', err);
    return res.status(500).json({ success: false, msg: '회식맵 레이아웃 설정 저장에 실패했습니다.' });
  }
});
//  END =====


//  BEGIN =====
function wgsMaskMealmapKeyV2510(value) {
    const key = String(value || '').trim();
    if (!key) return { exists: false, masked: '(empty)', length: 0, hex32: false };
    if (key.length < 10) return { exists: true, masked: '(too short)', length: key.length, hex32: /^[0-9a-fA-F]{32}$/.test(key) };
    return {
        exists: true,
        masked: `${key.slice(0, 4)}...${key.slice(-4)}`,
        length: key.length,
        hex32: /^[0-9a-fA-F]{32}$/.test(key),
    };
}

app.get('/api/mealmap/kakao/key-check', (req, res) => {
    const jsKey = mealmapKakaoMapJsKey();
    const restKey = mealmapKakaoRestKey();
    return res.json({
        success: true,
        note: '키 전체값은 보안상 출력하지 않습니다. JavaScript 지도 키와 REST 키는 서로 다른 값이어야 합니다.',
        currentRequest: {
            host: req.headers.host || '',
            origin: req.headers.origin || '',
            referer: req.headers.referer || '',
        },
        keys: {
            javascriptKey: wgsMaskMealmapKeyV2510(jsKey),
            restApiKey: wgsMaskMealmapKeyV2510(restKey),
            same: Boolean(jsKey && restKey && jsKey === restKey),
        },
        kakaoDeveloperChecklist: [
            '카카오 Developers > 내 애플리케이션 > 앱 키에서 JavaScript 키를 KAKAO_MAP_JS_KEY에 넣었는지 확인',
            '카카오 Developers > 플랫폼 >Web 플랫폼에 http://localhost:5000 등록',
            'Vite 개발 주소로 직접 볼 경우 http://localhost:5173 등록',
            '배포 전 https://woogongsil.site 등록',
            '카카오맵 API 사용 설정/활성화 상태 확인',
        ],
        localTestUrls: {
            sdkIsolatedTest: 'http://localhost:5000/api/mealmap/kakao/js-test',
            restApiTest: 'http://localhost:5000/api/mealmap/kakao/rest-test?query=서울시청',
        },
    });
});

app.get('/api/mealmap/kakao/rest-test', async (req, res) => {
    const restKey = mealmapKakaoRestKey();
    if (!restKey) {
        return res.status(400).json({ success: false, message: 'KAKAO_REST_API_KEY가 backend/.env에 없습니다.' });
    }

    const query = String(req.query.query || '서울시청').trim().slice(0, 80) || '서울시청';
    try {
        const result = await mealmapHttpsJson(
            'dapi.kakao.com',
            `/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
            { Authorization: `KakaoAK ${restKey}` }
        );
        return res.status(result.statusCode >= 400 ? 502 : 200).json({
            success: result.statusCode >= 200 && result.statusCode < 300,
            upstreamStatusCode: result.statusCode,
            query,
            documentsCount: Array.isArray(result.data?.documents) ? result.data.documents.length : 0,
            sample: Array.isArray(result.data?.documents) && result.data.documents[0]
                ? {
                    address_name: result.data.documents[0].address_name,
                    x: result.data.documents[0].x,
                    y: result.data.documents[0].y,
                }
                : null,
            rawError: result.statusCode >= 400 ? result.data : undefined,
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err?.message || String(err) });
    }
});

app.get('/api/mealmap/kakao/js-test', (req, res) => {
    const jsKey = mealmapKakaoMapJsKey();
    const masked = wgsMaskMealmapKeyV2510(jsKey);
    const sdkUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(jsKey)}&libraries=services&autoload=false`;
    res.type('html').send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content=" width=device-width, initial-scale=1" />
  <title>우공실 카카오 지도 SDK 점검</title>
  <style>body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #eef6ff; color: #111827; }
    .wrap { max-width: 980px; margin: 0 auto; }
    .card { background: #fff; border: 1px solid #dbe5f2; border-radius: 18px; padding: 18px; box-shadow: 0 16px 45px rgba(15,23,42,.10); margin-bottom: 16px; }
    # map { width: 100%; height: 520px; border-radius: 16px; border: 1px solid #dbe5f2; overflow: hidden; background: #dbeafe; }
    code { display: block; white-space: pre-wrap; background: #0f172a; color: #e5edf7; padding: 12px; border-radius: 12px; line-height: 1.5; }
    .ok { color: #059669; font-weight: 900; }
    .bad { color: #e11d48; font-weight: 900; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>우공실 카카오 지도 SDK 점검</h1>
      <p>현재 접속 Origin: <strong>${String(req.protocol || 'http')}://${String(req.headers.host || '')}</strong></p>
      <p>JavaScript 키: <strong>${masked.masked}</strong> / length=${masked.length} / hex32=${masked.hex32}</p>
      <p id="status">SDK 로딩 대기 중...</p>
      <code id="log"></code>
    </div>
    <div id="map"></div>
  </div>
  <script>const logEl = document.getElementById('log');
    const statusEl = document.getElementById('status');
    function log(message) { logEl.textContent += String(message) + '\\n'; console.log('[kakao-js-test]', message); }
    window.addEventListener('error', function(event) { log('window error: ' + (event.message || 'unknown')); });
    log('sdk url preview: https://dapi.kakao.com/v2/maps/sdk.js?appkey=${String(jsKey).slice(0,4)}...${String(jsKey).slice(-4)}&libraries=services&autoload=false');
    log('origin: ' + window.location.origin);
  </script>
  ${jsKey ? `<script src="${sdkUrl}" onload="log('SDK script onload fired'); if (window.kakao && window.kakao.maps && window.kakao.maps.load) { kakao.maps.load(function(){ try { const map = new kakao.maps.Map(document.getElementById('map'), { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 }); new kakao.maps.Marker({ map: map, position: new kakao.maps.LatLng(37.5665, 126.9780) }); statusEl.innerHTML = '<span class=\\'ok\\'>성공: 카카오 지도 SDK가 정상 로드되었습니다.</span>'; log('kakao map created'); } catch (err) { statusEl.innerHTML = '<span class=\\'bad\\'>실패: 지도 생성 중 오류</span>'; log('map create error: ' + (err && err.message ? err.message : err)); } }); } else { statusEl.innerHTML = '<span class=\\'bad\\'>실패: SDK는 불러왔지만 window.kakao.maps.load가 없습니다.</span>'; log('window.kakao.maps.load is missing. Check Web platform domain / Kakao Maps activation / JavaScript key.'); }" onerror="statusEl.innerHTML = '<span class=\\'bad\\'>실패: SDK 스크립트 네트워크 로드 실패</span>'; log('SDK script network error');"></script>` : `<script>statusEl.innerHTML = '<span class="bad">실패: KAKAO_MAP_JS_KEY가 없습니다.</span>'; log('KAKAO_MAP_JS_KEY missing');</script>`}
</body>
</html>`);
});
//  END =====
}

module.exports = registerSiteManagementRoutes;
