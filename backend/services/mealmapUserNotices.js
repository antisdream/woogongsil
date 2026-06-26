function createMealMapUserNotices({ pool }) {
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
            if (ids.length > 0) {
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

    return {
        notifyMealMapPlaceDecisionV2515,
        notifyMealMapEditDecisionV2515,
        getUndeliveredMealMapUserNoticesV2515,
    };
}

module.exports = {
    createMealMapUserNotices,
};
