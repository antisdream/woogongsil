// 계정, 오답노트, 마이페이지 API를 제공합니다.
'use strict';

const {
    buildInsert,
    buildUpdate,
    ensureUserCalendarEventsSchema,
    normalizeDateOnly,
    normalizeUserCalendarEventRow,
    normalizeUserCalendarPayload,
} = require('../userCalendarEvents');

function registerUserRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const bcrypt = options.bcrypt || require('bcrypt');
    const getUserById = options.getUserById;
    const formatDateOnly = options.formatDateOnly;
    const getKSTDateTime = options.getKSTDateTime;
    const validateRealtimeSession = options.validateRealtimeSession;

    if (!app || !pool || !getUserById || !formatDateOnly || !getKSTDateTime || typeof validateRealtimeSession !== 'function') {
        throw new Error('registerUserRoutes requires app, pool, getUserById, formatDateOnly, getKSTDateTime, and validateRealtimeSession.');
    }

    function authUserId(auth) {
        return String(auth?.user?.id || auth?.id || '').trim();
    }

    async function requireSessionUser(req, res, expectedId = '') {
        const auth = await validateRealtimeSession(req);
        if (!auth.valid) {
            res.status(401).json({
                success: false,
                valid: false,
                reason: auth.reason || 'session_expired',
                msg: '로그인 세션이 만료되었습니다. 다시 로그인해주세요.',
            });
            return null;
        }

        const requesterId = authUserId(auth);
        const targetId = String(expectedId || requesterId || '').trim();
        if (!requesterId || !targetId || requesterId !== targetId) {
            res.status(403).json({
                success: false,
                valid: false,
                reason: 'forbidden_user_mismatch',
                msg: '본인 계정으로만 처리할 수 있습니다.',
            });
            return null;
        }

        return auth;
    }

    // 8. 마이페이지 / 회원탈퇴 / 오답노트
    async function readUserCalendarEventById(eventId, userId) {
        await ensureUserCalendarEventsSchema(pool);
        const [rows] = await pool.query(
            `SELECT id, user_id, source_type, assigned_group_id, created_by_admin_id,
                    DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
                    weekday_label, day_no, schedule_type, event_category, course_title,
                    topic_title, event_title, event_subtitle, memo, background_color,
                    text_color, border_color, highlight_type, sort_order, is_active,
                    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                    DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
               FROM wgs_user_calendar_events
              WHERE id = ? AND user_id = ?
              LIMIT 1`,
            [eventId, userId]
        );

        return rows[0] || null;
    }

    app.get('/api/user/calendar-events', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.id || '');
            if (!auth) return;

            const userId = authUserId(auth);
            await ensureUserCalendarEventsSchema(pool);

            const active = String(req.query.active || '').trim();
            const keyword = String(req.query.keyword || req.query.q || '').trim();
            const type = String(req.query.type || req.query.schedule_type || '').trim();
            const where = ['user_id = ?'];
            const params = [userId];

            if (active === '1' || active === '0') {
                where.push('is_active = ?');
                params.push(Number(active));
            }

            if (type) {
                where.push('schedule_type = ?');
                params.push(type);
            }

            if (keyword) {
                where.push('(course_title LIKE ? OR topic_title LIKE ? OR event_title LIKE ? OR event_subtitle LIKE ? OR memo LIKE ?)');
                const like = `%${keyword}%`;
                params.push(like, like, like, like, like);
            }

            const [rows] = await pool.query(
                `SELECT id, user_id, source_type, assigned_group_id, created_by_admin_id,
                        DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
                        weekday_label, day_no, schedule_type, event_category, course_title,
                        topic_title, event_title, event_subtitle, memo, background_color,
                        text_color, border_color, highlight_type, sort_order, is_active,
                        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
                   FROM wgs_user_calendar_events
                  WHERE ${where.join(' AND ')}
                  ORDER BY schedule_date ASC, sort_order ASC, id ASC`,
                params
            );

            const [[summary]] = await pool.query(
                `SELECT COUNT(*) AS total,
                        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
                        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_count,
                        MIN(schedule_date) AS first_date,
                        MAX(schedule_date) AS last_date
                   FROM wgs_user_calendar_events
                  WHERE user_id = ?`,
                [userId]
            );

            return res.json({
                success: true,
                schedules: rows.map(normalizeUserCalendarEventRow),
                summary: {
                    total: Number(summary?.total || 0),
                    active_count: Number(summary?.active_count || 0),
                    inactive_count: Number(summary?.inactive_count || 0),
                    first_date: normalizeDateOnly(summary?.first_date),
                    last_date: normalizeDateOnly(summary?.last_date),
                },
            });
        } catch (error) {
            console.error('[user calendar] list failed:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                msg: error.message || '일정 목록을 불러오지 못했습니다.',
            });
        }
    });

    app.post('/api/user/calendar-events', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.id || '');
            if (!auth) return;

            const userId = authUserId(auth);
            await ensureUserCalendarEventsSchema(pool);

            const payload = normalizeUserCalendarPayload(req.body || {}, {
                userId,
                sourceType: 'user_created',
            });
            const built = buildInsert(payload);
            const placeholders = built.columns.map(() => '?').join(', ');
            const [result] = await pool.query(
                `INSERT INTO wgs_user_calendar_events (${built.columns.join(', ')}) VALUES (${placeholders})`,
                built.values
            );
            const row = await readUserCalendarEventById(result.insertId, userId);

            return res.json({
                success: true,
                message: '일정이 추가되었습니다.',
                schedule: normalizeUserCalendarEventRow(row),
            });
        } catch (error) {
            console.error('[user calendar] create failed:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                msg: error.message || '일정 추가에 실패했습니다.',
            });
        }
    });

    app.put('/api/user/calendar-events/:eventId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.id || '');
            if (!auth) return;

            const userId = authUserId(auth);
            const eventId = Number(req.params.eventId);
            if (!Number.isFinite(eventId) || eventId <= 0) {
                return res.status(400).json({ success: false, msg: '수정할 일정 ID가 올바르지 않습니다.' });
            }

            await ensureUserCalendarEventsSchema(pool);
            const payload = normalizeUserCalendarPayload(req.body || {}, { userId });
            const built = buildUpdate(payload);
            const setSql = built.columns.map((column) => `${column} = ?`).join(', ');

            const [result] = await pool.query(
                `UPDATE wgs_user_calendar_events
                    SET ${setSql}, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND user_id = ?`,
                [...built.values, eventId, userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, msg: '수정할 일정을 찾지 못했습니다.' });
            }

            const row = await readUserCalendarEventById(eventId, userId);
            return res.json({
                success: true,
                message: '일정이 수정되었습니다.',
                schedule: normalizeUserCalendarEventRow(row),
            });
        } catch (error) {
            console.error('[user calendar] update failed:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                msg: error.message || '일정 수정에 실패했습니다.',
            });
        }
    });

    app.patch('/api/user/calendar-events/:eventId/toggle', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.id || '');
            if (!auth) return;

            const userId = authUserId(auth);
            const eventId = Number(req.params.eventId);
            if (!Number.isFinite(eventId) || eventId <= 0) {
                return res.status(400).json({ success: false, msg: '상태를 바꿀 일정 ID가 올바르지 않습니다.' });
            }

            await ensureUserCalendarEventsSchema(pool);
            const [result] = await pool.query(
                `UPDATE wgs_user_calendar_events
                    SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND user_id = ?`,
                [eventId, userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, msg: '상태를 바꿀 일정을 찾지 못했습니다.' });
            }

            const row = await readUserCalendarEventById(eventId, userId);
            return res.json({
                success: true,
                message: Number(row?.is_active) ? '일정이 켜졌습니다.' : '일정이 꺼졌습니다.',
                schedule: normalizeUserCalendarEventRow(row),
            });
        } catch (error) {
            console.error('[user calendar] toggle failed:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                msg: error.message || '일정 상태 변경에 실패했습니다.',
            });
        }
    });

    app.delete('/api/user/calendar-events/:eventId', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.body.id || req.query.id || '');
            if (!auth) return;

            const userId = authUserId(auth);
            const eventId = Number(req.params.eventId);
            if (!Number.isFinite(eventId) || eventId <= 0) {
                return res.status(400).json({ success: false, msg: '삭제할 일정 ID가 올바르지 않습니다.' });
            }

            await ensureUserCalendarEventsSchema(pool);
            const [result] = await pool.query(
                'DELETE FROM wgs_user_calendar_events WHERE id = ? AND user_id = ?',
                [eventId, userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, msg: '삭제할 일정을 찾지 못했습니다.' });
            }

            return res.json({
                success: true,
                message: '일정이 삭제되었습니다.',
                id: eventId,
            });
        } catch (error) {
            console.error('[user calendar] delete failed:', error);
            return res.status(error.statusCode || 500).json({
                success: false,
                msg: error.message || '일정 삭제에 실패했습니다.',
            });
        }
    });

    app.get('/api/user/:id', async (req, res) => {
        const id = String(req.params.id || '').trim();

        try {
            const auth = await requireSessionUser(req, res, id);
            if (!auth) return;

            const user = await getUserById(id);
            if (!user) return res.status(404).json({ msg: '유저 정보 없음' });

            const [wrongNotes] = await pool.query(
                `SELECT
                    wn.id AS wrongNoteId,
                    wn.userId,
                    wn.question_id,
                    wn.source,
                    wn.year,
                    wn.session,
                    DATE_FORMAT(wn.savedAt, '%Y-%m-%d %H:%i:%s') AS savedAt,
                    q.info_id,
                    q.subject,
                    q.subject AS subject_id,
                    q.question,
                    q.question AS question_text,
                    q.question_img,
                    o.opt1 AS option_1,
                    o.opt2 AS option_2,
                    o.opt3 AS option_3,
                    o.opt4 AS option_4,
                    COALESCE(a.correct_label, o.answer) AS correct_label,
                    a.explanation_text,
                    a.explanation_img
                 FROM wgs_wrong_notes wn
                 LEFT JOIN questions q ON wn.question_id = q.question_id
                 LEFT JOIN options o ON wn.question_id = o.question_id
                 LEFT JOIN answers a ON wn.question_id = a.question_id
                 WHERE wn.userId = ?
                 ORDER BY wn.savedAt DESC, wn.id DESC`,
                [id]
            );

            const [loginHistory] = await pool.query(
                `SELECT DATE_FORMAT(time, '%Y-%m-%d %H:%i:%s') AS time, action
                 FROM wgs_login_history
                 WHERE userId = ?
                 ORDER BY time DESC
                 LIMIT 50`,
                [id]
            );

            const [fortuneHistory] = await pool.query(
                `SELECT DATE_FORMAT(time, '%Y-%m-%d %H:%i:%s') AS time, type, data
                 FROM wgs_fortune_history
                 WHERE userId = ?
                 ORDER BY time DESC
                 LIMIT 10`,
                [id]
            );

            const safeUser = {
                id: user.id,
                name: user.name,
                email: user.email,
                dDay: formatDateOnly(user.dDay),
                wrongNotes,
                loginHistory,
                fortuneHistory
            };

            return res.json(safeUser);
        } catch (error) {
            console.error('유저 정보 조회 오류:', error);
            return res.status(500).json({ msg: '데이터 조회 오류' });
        }
    });

    app.post('/api/user/update', async (req, res) => {
        const auth = await requireSessionUser(req, res, req.body.id);
        if (!auth) return;

        const id = authUserId(auth);
        const dDay = req.body.dDay || null;

        try {
            const [result] = await pool.query('UPDATE wgs_users SET dDay = ? WHERE id = ?', [dDay, id]);

            if (result.affectedRows === 0) return res.status(400).json({ success: false, msg: '사용자 없음' });

            return res.json({ success: true, msg: '업데이트 완료' });
        } catch (error) {
            console.error('D-Day 업데이트 오류:', error);
            return res.status(500).json({ success: false, msg: '업데이트 실패' });
        }
    });

    app.post('/api/user/delete', async (req, res) => {
        const auth = await requireSessionUser(req, res, req.body.id);
        if (!auth) return;

        const id = authUserId(auth);
        const password = String(req.body.password || '');

        const connection = await pool.getConnection();

        try {
            const user = await getUserById(id);

            if (!user) return res.status(400).json({ success: false, msg: '사용자를 찾을 수 없습니다.' });

            const isPasswordMatched = await bcrypt.compare(password, user.password);
            if (!isPasswordMatched) return res.status(400).json({ success: false, msg: '비밀번호가 일치하지 않습니다.' });

            await connection.beginTransaction();

            await connection.query('UPDATE wgs_posts SET authorName = ? WHERE authorId = ?', ['탈퇴회원', id]);
            await connection.query('UPDATE wgs_comments SET authorName = ? WHERE authorId = ?', ['탈퇴회원', id]);
            await connection.query('UPDATE wgs_replies SET authorName = ? WHERE authorId = ?', ['탈퇴회원', id]);
            await connection.query('DELETE FROM wgs_ranking_random WHERE userId = ?', [id]);
            await connection.query('DELETE FROM wgs_ranking_past WHERE userId = ?', [id]);
            await connection.query('DELETE FROM wgs_post_likes WHERE userId = ?', [id]);
            await connection.query('DELETE FROM wgs_login_history WHERE userId = ?', [id]);
            await connection.query('DELETE FROM wgs_fortune_history WHERE userId = ?', [id]);
            await ensureUserCalendarEventsSchema(pool);
            await connection.query('DELETE FROM wgs_user_calendar_events WHERE user_id = ?', [id]);
            await connection.query('DELETE FROM wgs_users WHERE id = ?', [id]);

            await connection.commit();

            return res.json({ success: true, msg: '회원 탈퇴가 완료되었습니다. 관련 기록이 정리되었습니다.' });
        } catch (error) {
            await connection.rollback();
            console.error('회원탈퇴 오류:', error);
            return res.status(500).json({ success: false, msg: '회원탈퇴 처리 중 오류가 발생했습니다.' });
        } finally {
            connection.release();
        }
    });

    app.post('/api/save-wrong', async (req, res) => {
        const auth = await requireSessionUser(req, res, req.body.id);
        if (!auth) return;

        const id = authUserId(auth);
        const wrongQuestions = Array.isArray(req.body.wrongQuestions) ? req.body.wrongQuestions : [];
        const source = req.body.source || 'random';
        const year = req.body.year || null;
        const session = req.body.session || null;

        if (!id) return res.status(400).json({ success: false, msg: '로그인이 필요합니다.' });

        try {
            for (const question of wrongQuestions) {
                const questionId = question.question_id || question.id;
                if (!questionId) continue;

                const [exists] = await pool.query(
                    'SELECT id FROM wgs_wrong_notes WHERE userId = ? AND question_id = ? LIMIT 1',
                    [id, questionId]
                );

                if (exists.length === 0) {
                    await pool.query(
                        `INSERT INTO wgs_wrong_notes (userId, question_id, source, year, session, savedAt)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            id,
                            questionId,
                            source,
                            question.year || year,
                            question.session || session,
                            getKSTDateTime()
                        ]
                    );
                }
            }

            return res.json({ success: true, msg: '오답 저장 완료' });
        } catch (error) {
            console.error('오답 저장 오류:', error);
            return res.status(500).json({ success: false, msg: '오답 저장 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/remove-wrong', async (req, res) => {
        const auth = await requireSessionUser(req, res, req.body.id);
        if (!auth) return;

        const id = authUserId(auth);
        const questionId = req.body.question_id;

        try {
            await pool.query('DELETE FROM wgs_wrong_notes WHERE userId = ? AND question_id = ?', [id, questionId]);
            return res.json({ success: true, msg: '삭제됨' });
        } catch (error) {
            console.error('오답 삭제 오류:', error);
            return res.status(500).json({ success: false, msg: '오답 삭제 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/remove-all-wrong', async (req, res) => {
        const auth = await requireSessionUser(req, res, req.body.id);
        if (!auth) return;

        const id = authUserId(auth);
        const source = req.body.source || null;

        try {
            if (source) {
                await pool.query('DELETE FROM wgs_wrong_notes WHERE userId = ? AND source = ?', [id, source]);
            } else {
                await pool.query('DELETE FROM wgs_wrong_notes WHERE userId = ?', [id]);
            }

            return res.json({ success: true, msg: '전체 삭제됨' });
        } catch (error) {
            console.error('오답 전체 삭제 오류:', error);
            return res.status(500).json({ success: false, msg: '오답 전체 삭제 중 오류가 발생했습니다.' });
        }
    });

}

module.exports = registerUserRoutes;
