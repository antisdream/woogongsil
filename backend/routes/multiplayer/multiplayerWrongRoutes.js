// Multiplayer wrong-answer history routes.
'use strict';

function registerMultiplayerWrongRoutes(options = {}) {
    const router = options.router;
    const pool = options.pool;
    const requireSessionUser = options.requireSessionUser;
    const requireSessionUserForHandler = options.requireSessionUserForHandler;
    const normalizeInt = options.normalizeInt;
    const getRoomQuestionsWithAnswer = options.getRoomQuestionsWithAnswer;
    const cleanupRoomIfAllWrongAnswersHidden = options.cleanupRoomIfAllWrongAnswersHidden;
    const formatDateOnly = options.formatDateOnly;
    const formatTimeOnly = options.formatTimeOnly;

    const required = {
        router, pool, requireSessionUser, requireSessionUserForHandler, normalizeInt,
        getRoomQuestionsWithAnswer, cleanupRoomIfAllWrongAnswersHidden, formatDateOnly, formatTimeOnly,
    };
    const missing = Object.entries(required)
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length > 0) {
        throw new Error(`registerMultiplayerWrongRoutes missing dependencies: ${missing.join(', ')}`);
    }

    router.get('/my-wrongs/groups', requireSessionUser, async (req, res) => {
        try {
            // 현재 로그인 사용자의 멀티플레이 제출 기록을 날짜/시간 필터용으로 내려줍니다.
            const user = req.wgsUser;
            const [rows] = await pool.query(
                // 전체 오답 삭제 또는 마지막 오답 선택 삭제가 끝난 응시 기록은
                // 드롭다운 목록에 다시 보이지 않게, 아직 숨김 처리되지 않은 내 오답이 있는 방만 조회합니다.
                `SELECT r.id AS room_id, r.room_code, r.room_password, s.submitted_at, s.correct_count, s.total_count
                 FROM wgs_multiplayer_results s
                 INNER JOIN wgs_multiplayer_rooms r ON r.id = s.room_id
                 WHERE s.user_id = ?
                   AND EXISTS (
                       SELECT 1
                       FROM wgs_multiplayer_answers ma
                       WHERE ma.room_id = s.room_id
                         AND ma.user_id = s.user_id
                         AND COALESCE(ma.is_correct, 0) = 0
                         AND NOT EXISTS (
                             SELECT 1
                             FROM wgs_multiplayer_wrong_hides h
                             WHERE h.room_id = ma.room_id
                               AND h.user_id = ma.user_id
                               AND h.question_id = ma.question_id
                         )
                   )
                 ORDER BY s.submitted_at DESC`,
                [user.id]
            );
            const groups = rows.map((row) => ({
                roomId: row.room_id,
                roomCode: row.room_code,
                // 시험기록/오답 선택 목록에서 방 번호와 함께 비밀번호도 표시할 수 있도록 내려줍니다.
                roomPassword: row.room_password || '',
                submittedAt: row.submitted_at,
                date: formatDateOnly(row.submitted_at),
                time: formatTimeOnly(row.submitted_at),
                correctCount: Number(row.correct_count || 0),
                totalCount: Number(row.total_count || 0)
            }));
            return res.json({ success: true, groups });
        } catch (error) {
            console.error('[multiplayer] my wrong groups error:', error);
            return res.status(500).json({ success: false, msg: '멀티플레이 응시 기록을 불러오지 못했습니다.' });
        }
    });

    router.get('/my-wrongs/:roomId', requireSessionUser, async (req, res) => {
        try {
            // 선택한 응시 기록에서 현재 사용자가 틀린 문제만 반환합니다.
            const user = req.wgsUser;
            const roomId = normalizeInt(req.params.roomId, 0);
            const [resultRows] = await pool.query(`SELECT * FROM wgs_multiplayer_results WHERE room_id = ? AND user_id = ? LIMIT 1`, [roomId, user.id]);
            if (resultRows.length === 0) return res.status(404).json({ success: false, msg: '해당 응시 기록을 찾을 수 없습니다.' });
            const [answerRows] = await pool.query(
                `SELECT question_id, selected_answer, is_correct FROM wgs_multiplayer_answers WHERE room_id = ? AND user_id = ?`,
                [roomId, user.id]
            );
            const answerMap = new Map(answerRows.map((a) => [String(a.question_id), a]));
            const questions = await getRoomQuestionsWithAnswer(roomId, true);

            // 사용자가 이미 삭제한 멀티플레이 오답은 다시풀기 목록에서 숨긴다.
            const [hiddenRows] = await pool.query(
                `SELECT question_id FROM wgs_multiplayer_wrong_hides WHERE room_id = ? AND user_id = ?`,
                [roomId, user.id]
            );
            const hiddenQuestionIds = new Set(hiddenRows.map((row) => String(row.question_id)));

            const wrongs = questions.map((q) => {
                const ans = answerMap.get(String(q.question_id));
                return { ...q, selected_answer: ans?.selected_answer || null, is_correct: Boolean(ans?.is_correct) };
            }).filter((q) => !q.is_correct)
              .filter((q) => !hiddenQuestionIds.has(String(q.question_id)));
            return res.json({ success: true, roomId, submittedAt: resultRows[0].submitted_at, wrongs });
        } catch (error) {
            console.error('[multiplayer] my wrong practice error:', error);
            return res.status(500).json({ success: false, msg: '멀티플레이 오답문제를 불러오지 못했습니다.' });
        }
    });


    // 멀티플레이 오답 다시풀기 - 선택한 문제 1개를 내 오답 목록에서 삭제합니다.
    // 답안과 결과 원본 테이블은 보존하고 숨김 테이블만 기록해 시험 기록 화면의 기준 데이터를 유지합니다.
    router.delete('/my-wrongs/:roomId/:questionId', async (req, res) => {
        try {
            const user = await requireSessionUserForHandler(req);
            const roomId = normalizeInt(req.params.roomId, 0);
            const questionId = normalizeInt(req.params.questionId, 0);
            if (!roomId || !questionId) return res.status(400).json({ success: false, msg: '방 번호 또는 문제 번호가 올바르지 않습니다.' });

            await pool.query(
                `INSERT INTO wgs_multiplayer_wrong_hides (room_id, user_id, question_id)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP`,
                [roomId, user.id, questionId]
            );

            // 현재 사용자가 마지막 남은 오답을 삭제한 경우 방 기록까지 실제 삭제합니다.
            const cleanupResult = await cleanupRoomIfAllWrongAnswersHidden(roomId);
            return res.json({
                success: true,
                msg: cleanupResult.deleted
                    ? '모든 참여자의 오답이 삭제되어 시험 기록까지 정리했습니다.'
                    : '선택한 오답을 삭제했습니다.',
                roomDeleted: cleanupResult.deleted
            });
        } catch (error) {
            console.error('[multiplayer] delete wrong error:', error);
            return res.status(error.statusCode || 500).json({ success: false, msg: error.statusCode === 401 ? '로그인이 필요합니다.' : '오답 삭제 중 오류가 발생했습니다.' });
        }
    });

    // 멀티플레이 오답 다시풀기 - 선택한 응시 기록의 내 오답 전체를 삭제합니다.
    // 같은 방의 다른 사용자 결과와 방 기록은 그대로 유지됩니다.
    router.delete('/my-wrongs/:roomId', async (req, res) => {
        try {
            const user = await requireSessionUserForHandler(req);
            const roomId = normalizeInt(req.params.roomId, 0);
            if (!roomId) return res.status(400).json({ success: false, msg: '방 번호가 올바르지 않습니다.' });

            const [answerRows] = await pool.query(
                `SELECT DISTINCT ma.question_id
                   FROM wgs_multiplayer_answers ma
                  WHERE ma.room_id = ?
                    AND ma.user_id = ?
                    AND ma.is_correct = 0`,
                [roomId, user.id]
            );

            if (answerRows.length >0) {
                // 현재 DB 구조는 room_id/user_id/question_id/deleted_at만 사용합니다.
                // source, hidden_at 컬럼을 참조하지 않으며, bulk VALUES ? 대신
                // 명시적 플레이스홀더를 만들어 mysql2 환경 차이로 인한 전체 삭제 오류를 막는다.
                const placeholders = answerRows.map(() => '(?, ?, ?)').join(', ');
                const values = answerRows.flatMap((row) => [roomId, user.id, row.question_id]);
                await pool.query(
                    `INSERT INTO wgs_multiplayer_wrong_hides (room_id, user_id, question_id)
                     VALUES ${placeholders}
                     ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP`,
                    values
                );
            }

            // 다른 참여자의 오답이 아직 남아 있으면 방 기록은 유지하고,
            // 모든 참여자의 오답이 삭제된 경우에만 방 데이터를 실제 DB에서 정리합니다.
            const cleanupResult = await cleanupRoomIfAllWrongAnswersHidden(roomId);
            return res.json({
                success: true,
                msg: cleanupResult.deleted
                    ? '모든 참여자의 오답이 삭제되어 시험 기록까지 정리했습니다.'
                    : '선택한 응시 기록의 오답을 모두 삭제했습니다.',
                deletedCount: answerRows.length,
                roomDeleted: cleanupResult.deleted
            });
        } catch (error) {
            console.error('[multiplayer] delete all wrongs error:', error);
            return res.status(error.statusCode || 500).json({ success: false, msg: error.statusCode === 401 ? '로그인이 필요합니다.' : '오답 전체 삭제 중 오류가 발생했습니다.' });
        }
    });


}

module.exports = registerMultiplayerWrongRoutes;
