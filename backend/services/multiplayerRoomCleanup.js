const {
    ROOM_STATUSES,
    normalizeInt,
} = require('./multiplayerQuestionUtils');

function createMultiplayerRoomCleanup({ pool }) {
    async function cleanupRoomIfAllWrongAnswersHidden(roomId) {
        // 4번 '오답문제 풀러가기'에서 모든 참여자의 모든 오답이 삭제 처리되면
        // 해당 멀티플레이 방의 채점/답안/문제/참여자/방 데이터를 실제 DB에서 정리합니다.
        // 삭제 조건:
        // 1) 방 상태가 FINISHED인 완료 시험일 것
        // 2) 방 안에 실제 오답 답안이 1개 이상 있을 것
        // 3) 숨김 테이블(wgs_multiplayer_wrong_hides)에 모든 오답이 기록되어
        //  더 이상 확인 가능한 오답이 0개일 것
        // 이렇게 해야 한 명이라도 오답을 삭제하지 않은 경우에는 방 기록이 유지되고,
        // 모든 사용자가 오답을 정리한 경우에만 3번 시험 기록과 HTML/PDF용 데이터까지 사라진다.
        const targetRoomId = normalizeInt(roomId, 0);
        if (!targetRoomId) return { deleted: false, reason: 'invalid_room' };

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 같은 방을 동시에 정리하는 상황을 막기 위해 방 행을 잠근 뒤 다시 조건을 검사합니다.
            const [roomRows] = await connection.query(
                `SELECT id, room_code, status
                 FROM wgs_multiplayer_rooms
                 WHERE id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [targetRoomId]
            );

            if (roomRows.length === 0) {
                await connection.rollback();
                return { deleted: false, reason: 'room_not_found' };
            }

            const room = roomRows[0];
            if (room.status !== ROOM_STATUSES.FINISHED) {
                await connection.rollback();
                return { deleted: false, reason: 'room_not_finished', roomCode: room.room_code };
            }

            const [statRows] = await connection.query(
                `SELECT
                     COUNT(*) AS total_wrong_count,
                     SUM(CASE WHEN h.id IS NULL THEN 1 ELSE 0 END) AS visible_wrong_count
                 FROM wgs_multiplayer_answers ma
                 LEFT JOIN wgs_multiplayer_wrong_hides h
                   ON h.room_id = ma.room_id
                  AND h.user_id = ma.user_id
                  AND h.question_id = ma.question_id
                 WHERE ma.room_id = ?
                   AND COALESCE(ma.is_correct, 0) = 0`,
                [targetRoomId]
            );

            const totalWrongCount = Number(statRows?.[0]?.total_wrong_count || 0);
            const visibleWrongCount = Number(statRows?.[0]?.visible_wrong_count || 0);

            if (totalWrongCount <= 0 || visibleWrongCount >0) {
                await connection.rollback();
                return {
                    deleted: false,
                    reason: 'visible_wrongs_remain',
                    roomCode: room.room_code,
                    totalWrongCount,
                    visibleWrongCount
                };
            }

            // FK ON DELETE CASCADE가 있는 환경이라면 rooms 삭제만으로도 충분하지만,
            // DB 스키마 차이에 대비해 자식 테이블을 명시적으로 먼저 정리합니다.
            await connection.query(`DELETE FROM wgs_multiplayer_wrong_hides WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_answers WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_results WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_room_questions WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_room_members WHERE room_id = ?`, [targetRoomId]);
            const [deleteResult] = await connection.query(`DELETE FROM wgs_multiplayer_rooms WHERE id = ?`, [targetRoomId]);

            await connection.commit();
            return {
                deleted: Number(deleteResult?.affectedRows || 0) >0,
                roomCode: room.room_code,
                totalWrongCount,
                visibleWrongCount: 0
            };
        } catch (error) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.warn('[multiplayer] room cleanup rollback failed:', rollbackError.message);
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    return { cleanupRoomIfAllWrongAnswersHidden };
}

module.exports = { createMultiplayerRoomCleanup };
