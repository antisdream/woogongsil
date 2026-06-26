// Mealmap interaction and edit-request routes.
'use strict';

function registerMealmapInteractionRoutes(options = {}) {
  const app = options.app;
  const pool = options.pool;
  const ensureMealMapSchema = options.ensureMealMapSchema;
  const validateAdminSession = options.validateAdminSession;
  const validateMealMapUserSession = options.validateMealMapUserSession;
  const mealmapCleanText = options.mealmapCleanText;
  const mealmapNullableText = options.mealmapNullableText;
  const mealmapNumber = options.mealmapNumber;
  const notifyMealMapEditDecisionV2515 = options.notifyMealMapEditDecisionV2515;

  const required = { app, pool, ensureMealMapSchema, validateAdminSession, validateMealMapUserSession, mealmapCleanText, mealmapNullableText, mealmapNumber, notifyMealMapEditDecisionV2515 };
  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === null)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`registerMealmapInteractionRoutes missing dependencies: ${missing.join(', ')}`);
  }

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
            `SELECT id, name, address, road_address AS roadAddress, category,
                    min_price AS minPrice, max_price AS maxPrice,
                    main_menu AS mainMenu, opening_hours AS openingHours,
                    naver_url AS naverUrl, kakao_url AS kakaoUrl,
                    COALESCE(kakao_url, naver_url) AS link, 'local' AS source
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
                category: mealmapCleanText(item.category_name, 50) || '식당',
                address: item.address_name || '',
                roadAddress: item.road_address_name || '',
                lat: item.y ? Number(item.y) : '',
                lng: item.x ? Number(item.x) : '',
                mainMenu: '',
                openingHours: '',
                minPrice: '',
                maxPrice: '',
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

// The active edit-review route set ends above. Older duplicated route declarations
// remain below for history, but must not be registered a second time.
return;



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

module.exports = registerMealmapInteractionRoutes;
