'use strict';

const {
    buildInsert,
    buildUpdate,
    ensureUserCalendarEventsSchema,
    normalizeUserCalendarEventRow,
    normalizeUserCalendarPayload,
} = require('../../userCalendarEvents');

function registerAdminUserCalendarRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const validateAdminSession = options.validateAdminSession;

    const missing = Object.entries({ app, pool, validateAdminSession })
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerAdminUserCalendarRoutes missing dependencies: ${missing.join(', ')}`);
    }

    app.post('/api/admin/user-calendar-events', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
            }

            const targetUserIds = Array.isArray(req.body?.target_user_ids)
                ? req.body.target_user_ids
                : Array.isArray(req.body?.targetUserIds)
                    ? req.body.targetUserIds
                    : [];
            const normalizedTargetIds = [...new Set(targetUserIds.map((value) => String(value || '').trim()).filter(Boolean))];

            if (normalizedTargetIds.length === 0) {
                return res.status(400).json({ success: false, message: '일정을 배정할 사용자를 선택해주세요.' });
            }

            await ensureUserCalendarEventsSchema(pool);

            const [userRows] = await pool.query('SELECT id FROM wgs_users WHERE id IN (?)', [normalizedTargetIds]);
            const validUserIds = new Set((userRows || []).map((row) => String(row.id)));
            const finalTargetIds = normalizedTargetIds.filter((id) => validUserIds.has(id));

            if (finalTargetIds.length === 0) {
                return res.status(404).json({ success: false, message: '선택한 사용자를 찾지 못했습니다.' });
            }

            const adminId = String(auth.user?.id || auth.id || '').trim();
            const assignedGroupId = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const inserted = [];

            for (const targetUserId of finalTargetIds) {
                const payload = normalizeUserCalendarPayload(req.body || {}, {
                    userId: targetUserId,
                    sourceType: 'admin_assigned',
                    adminId,
                    assignedGroupId,
                });
                const built = buildInsert(payload);
                const placeholders = built.columns.map(() => '?').join(', ');
                const [result] = await pool.query(
                    `INSERT INTO wgs_user_calendar_events (${built.columns.join(', ')}) VALUES (${placeholders})`,
                    built.values
                );
                inserted.push(result.insertId);
            }

            const [rows] = inserted.length
                ? await pool.query(
                    `SELECT id, user_id, source_type, assigned_group_id, created_by_admin_id,
                            DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
                            weekday_label, day_no, schedule_type, event_category, course_title,
                            topic_title, event_title, event_subtitle, memo, background_color,
                            text_color, border_color, highlight_type, sort_order, is_active,
                            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
                       FROM wgs_user_calendar_events
                      WHERE id IN (?)
                      ORDER BY id ASC`,
                    [inserted]
                )
                : [[]];

            return res.json({
                success: true,
                message: `${finalTargetIds.length}명에게 일정이 배정되었습니다.`,
                assignedGroupId,
                insertedCount: finalTargetIds.length,
                schedules: rows.map(normalizeUserCalendarEventRow),
            });
        } catch (error) {
            console.error('[admin/user-calendar-events] create failed:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || '사용자 일정 배정에 실패했습니다.',
            });
        }
    });

    function parseAdminCalendarUserIds(query = {}) {
        const rawValue = query.userIds ?? query.user_ids ?? query.userId ?? query.user_id ?? '';
        const rawItems = Array.isArray(rawValue) ? rawValue : [rawValue];
        return [...new Set(
            rawItems
                .flatMap((item) => String(item || '').split(','))
                .map((item) => item.trim())
                .filter(Boolean)
        )].slice(0, 200);
    }

    function normalizeAdminUserCalendarRow(row = {}) {
        const normalized = normalizeUserCalendarEventRow(row);
        const userName = row.user_name || row.userName || '';
        const userEmail = row.user_email || row.userEmail || '';
        return {
            ...normalized,
            user_name: userName,
            userName,
            user_email: userEmail,
            userEmail,
            source_scope: 'user_calendar',
            sourceScope: 'user_calendar',
        };
    }

    async function readAdminUserCalendarEventById(eventId) {
        const [rows] = await pool.query(
            `SELECT e.id, e.user_id, e.source_type, e.assigned_group_id, e.created_by_admin_id,
                    DATE_FORMAT(e.schedule_date, '%Y-%m-%d') AS schedule_date,
                    e.weekday_label, e.day_no, e.schedule_type, e.event_category,
                    e.course_title, e.topic_title, e.event_title, e.event_subtitle, e.memo,
                    e.background_color, e.text_color, e.border_color, e.highlight_type,
                    e.sort_order, e.is_active,
                    DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                    DATE_FORMAT(e.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
                    u.name AS user_name,
                    u.email AS user_email
               FROM wgs_user_calendar_events e
               LEFT JOIN wgs_users u ON u.id COLLATE utf8mb4_unicode_ci = e.user_id
              WHERE e.id = ?
              LIMIT 1`,
            [eventId]
        );
        return rows?.[0] || null;
    }

    app.get('/api/admin/user-calendar-events', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
            }

            await ensureUserCalendarEventsSchema(pool);

            const selectedUserIds = parseAdminCalendarUserIds(req.query || {});
            if (selectedUserIds.length === 0) {
                return res.json({
                    success: true,
                    schedules: [],
                    summary: {
                        total: 0,
                        active_count: 0,
                        inactive_count: 0,
                        first_date: '',
                        last_date: '',
                        selected_user_count: 0,
                    },
                });
            }

            const keyword = String(req.query.keyword || '').trim();
            const active = String(req.query.active || '').trim();
            const type = String(req.query.type || '').trim();

            const where = ['e.user_id IN (?)'];
            const params = [selectedUserIds];

            if (active === '1' || active === '0') {
                where.push('e.is_active = ?');
                params.push(Number(active));
            }

            if (type) {
                where.push('e.schedule_type = ?');
                params.push(type);
            }

            if (keyword) {
                where.push(`(
                    e.event_title LIKE ? OR e.event_subtitle LIKE ? OR e.course_title LIKE ? OR
                    e.topic_title LIKE ? OR e.memo LIKE ? OR e.event_category LIKE ? OR
                    e.user_id LIKE ? OR u.name LIKE ? OR u.email LIKE ?
                )`);
                const like = `%${keyword}%`;
                params.push(like, like, like, like, like, like, like, like, like);
            }

            const whereSql = `WHERE ${where.join(' AND ')}`;
            const [rows] = await pool.query(
                `SELECT e.id, e.user_id, e.source_type, e.assigned_group_id, e.created_by_admin_id,
                        DATE_FORMAT(e.schedule_date, '%Y-%m-%d') AS schedule_date,
                        e.weekday_label, e.day_no, e.schedule_type, e.event_category,
                        e.course_title, e.topic_title, e.event_title, e.event_subtitle, e.memo,
                        e.background_color, e.text_color, e.border_color, e.highlight_type,
                        e.sort_order, e.is_active,
                        DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                        DATE_FORMAT(e.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
                        u.name AS user_name,
                        u.email AS user_email
                   FROM wgs_user_calendar_events e
                   LEFT JOIN wgs_users u ON u.id COLLATE utf8mb4_unicode_ci = e.user_id
                   ${whereSql}
                  ORDER BY e.schedule_date ASC, e.sort_order ASC, e.id ASC`,
                params
            );

            const [summaryRows] = await pool.query(
                `SELECT COUNT(*) AS total,
                        SUM(CASE WHEN e.is_active = 1 THEN 1 ELSE 0 END) AS active_count,
                        SUM(CASE WHEN e.is_active = 0 THEN 1 ELSE 0 END) AS inactive_count,
                        DATE_FORMAT(MIN(e.schedule_date), '%Y-%m-%d') AS first_date,
                        DATE_FORMAT(MAX(e.schedule_date), '%Y-%m-%d') AS last_date
                   FROM wgs_user_calendar_events e
                   LEFT JOIN wgs_users u ON u.id COLLATE utf8mb4_unicode_ci = e.user_id
                   ${whereSql}`,
                params
            );
            const summary = summaryRows?.[0] || {};

            return res.json({
                success: true,
                schedules: rows.map(normalizeAdminUserCalendarRow),
                summary: {
                    total: Number(summary.total || 0),
                    active_count: Number(summary.active_count || 0),
                    inactive_count: Number(summary.inactive_count || 0),
                    first_date: summary.first_date || '',
                    last_date: summary.last_date || '',
                    selected_user_count: selectedUserIds.length,
                },
            });
        } catch (error) {
            console.error('[admin/user-calendar-events] list failed:', error);
            return res.status(500).json({
                success: false,
                message: '사용자 개인 일정 목록을 불러오지 못했습니다.',
            });
        }
    });

    app.put('/api/admin/user-calendar-events/:eventId', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
            }

            const eventId = Number(req.params.eventId);
            if (!Number.isFinite(eventId) || eventId <= 0) {
                return res.status(400).json({ success: false, message: '수정할 일정 ID가 올바르지 않습니다.' });
            }

            await ensureUserCalendarEventsSchema(pool);
            const existing = await readAdminUserCalendarEventById(eventId);
            if (!existing) {
                return res.status(404).json({ success: false, message: '수정할 사용자 일정을 찾지 못했습니다.' });
            }

            const payload = normalizeUserCalendarPayload(req.body || {}, {
                userId: existing.user_id,
                sourceType: existing.source_type,
                adminId: existing.created_by_admin_id,
                assignedGroupId: existing.assigned_group_id,
            });
            const built = buildUpdate(payload);
            const setSql = built.columns.map((column) => `${column} = ?`).join(', ');
            const [result] = await pool.query(
                `UPDATE wgs_user_calendar_events SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [...built.values, eventId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: '수정할 사용자 일정을 찾지 못했습니다.' });
            }

            const row = await readAdminUserCalendarEventById(eventId);
            return res.json({
                success: true,
                message: '사용자 개인 일정이 수정되었습니다.',
                schedule: normalizeAdminUserCalendarRow(row),
            });
        } catch (error) {
            console.error('[admin/user-calendar-events] update failed:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || '사용자 개인 일정 수정에 실패했습니다.',
            });
        }
    });

    app.patch('/api/admin/user-calendar-events/:eventId/toggle', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
            }

            const eventId = Number(req.params.eventId);
            if (!Number.isFinite(eventId) || eventId <= 0) {
                return res.status(400).json({ success: false, message: '상태 변경할 일정 ID가 올바르지 않습니다.' });
            }

            await ensureUserCalendarEventsSchema(pool);
            const [result] = await pool.query(
                `UPDATE wgs_user_calendar_events
                    SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                [eventId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: '상태 변경할 사용자 일정을 찾지 못했습니다.' });
            }

            const row = await readAdminUserCalendarEventById(eventId);
            return res.json({
                success: true,
                message: Number(row?.is_active) ? '사용자 개인 일정이 활성화되었습니다.' : '사용자 개인 일정이 비활성화되었습니다.',
                schedule: normalizeAdminUserCalendarRow(row),
            });
        } catch (error) {
            console.error('[admin/user-calendar-events] toggle failed:', error);
            return res.status(500).json({
                success: false,
                message: '사용자 개인 일정 상태 변경에 실패했습니다.',
            });
        }
    });

    app.delete('/api/admin/user-calendar-events/:eventId', async (req, res) => {
        try {
            const auth = await validateAdminSession(req);
            if (!auth.valid) {
                return res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
            }

            const eventId = Number(req.params.eventId);
            if (!Number.isFinite(eventId) || eventId <= 0) {
                return res.status(400).json({ success: false, message: '삭제할 일정 ID가 올바르지 않습니다.' });
            }

            await ensureUserCalendarEventsSchema(pool);
            const [result] = await pool.query('DELETE FROM wgs_user_calendar_events WHERE id = ?', [eventId]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: '삭제할 사용자 일정을 찾지 못했습니다.' });
            }

            return res.json({
                success: true,
                message: '사용자 개인 일정이 삭제되었습니다.',
                id: eventId,
            });
        } catch (error) {
            console.error('[admin/user-calendar-events] delete failed:', error);
            return res.status(500).json({
                success: false,
                message: '사용자 개인 일정 삭제에 실패했습니다.',
            });
        }
    });

    // 관리자 페이지는 현재 프론트에서 GET으로 회원 목록을 조회합니다.
    // 과거 테스트 버전 호환을 위해 POST도 함께 열어 둔다.

}

module.exports = registerAdminUserCalendarRoutes;
