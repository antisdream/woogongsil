// Mealmap admin moderation and delete-request routes.
'use strict';

function registerMealmapModerationRoutes(options = {}) {
  const app = options.app;
  const pool = options.pool;
  const ensureMealMapSchema = options.ensureMealMapSchema;
  const validateAdminSession = options.validateAdminSession;
  const validateMealMapUserSession = options.validateMealMapUserSession;
  const mealmapStatus = options.mealmapStatus;
  const mealmapCleanText = options.mealmapCleanText;
  const mealmapNumber = options.mealmapNumber;
  const mealmapNullableText = options.mealmapNullableText;
  const mealmapPublicPlaceSelect = options.mealmapPublicPlaceSelect;
  const getMealMapPlaceById = options.getMealMapPlaceById;
  const createMealMapDeleteApproval = options.createMealMapDeleteApproval;
  const notifyMealMapPlaceDecisionV2515 = options.notifyMealMapPlaceDecisionV2515;

  const required = { app, pool, ensureMealMapSchema, validateAdminSession, validateMealMapUserSession, mealmapStatus, mealmapCleanText, mealmapNumber, mealmapNullableText, mealmapPublicPlaceSelect, getMealMapPlaceById, createMealMapDeleteApproval, notifyMealMapPlaceDecisionV2515 };
  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === null)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`registerMealmapModerationRoutes missing dependencies: ${missing.join(', ')}`);
  }

app.get('/api/admin/mealmap/places', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateAdminSession(req);
        if (!auth.valid || !auth.isAdmin) return res.status(403).json({ success: false, message: '관리자 권한이 없습니다.' });

        const status = mealmapStatus(req.query.status, 'approved');
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
        const place = await getMealMapPlaceById(placeId);
        if (!place) return res.status(404).json({ success: false, message: '회식맵 식당을 찾을 수 없습니다.' });

        const adminNote = mealmapNullableText(req.body?.adminNote ?? req.body?.admin_note, 3000);
        if (!auth.isPrimaryAdmin) {
            const approvalId = await createMealMapDeleteApproval(place, auth, adminNote);
            return res.json({
                success: true,
                pendingApproval: true,
                approvalId,
                message: '회식맵 식당 삭제 요청이 결재 대기 목록에 등록되었습니다. 최고관리자 승인 후 숨김 처리됩니다.',
            });
        }

        await pool.query(
            `UPDATE mealmap_places
             SET status = 'hidden', admin_note = ?, updated_at = NOW()
             WHERE id = ?`,
            [adminNote, placeId]
        );
        return res.json({ success: true, message: '회식맵 식당이 숨김 처리되었습니다.' });
    } catch (error) {
        console.error('[admin mealmap delete error]', error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || '삭제 처리에 실패했습니다.' });
    }
});

app.post('/api/mealmap/places/:placeId/delete-request', async (req, res) => {
    try {
        await ensureMealMapSchema();
        const auth = await validateMealMapUserSession(req);
        const placeId = mealmapNumber(req.params.placeId, 0);
        if (!placeId) return res.status(400).json({ success: false, message: 'placeId가 필요합니다.' });

        const place = await getMealMapPlaceById(placeId);
        if (!place || place.status !== 'approved') {
            return res.status(404).json({ success: false, message: '삭제 요청 가능한 공개 식당을 찾을 수 없습니다.' });
        }

        const body = req.body || {};
        const reason = mealmapNullableText(body.reason || body.adminNote || body.admin_note, 2000) || '사용자 삭제 요청';
        const approvalId = await createMealMapDeleteApproval(place, auth, reason);
        return res.json({
            success: true,
            pendingApproval: true,
            approvalId,
            message: '회식맵 식당 삭제 요청이 접수되었습니다. 관리자 승인 후 숨김 처리됩니다.',
        });
    } catch (error) {
        console.error('[mealmap delete request error]', error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || '삭제 요청을 접수하지 못했습니다.' });
    }
});





//  routes BEGIN =====

}

module.exports = registerMealmapModerationRoutes;
