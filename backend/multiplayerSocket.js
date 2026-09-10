const { runtimeLog: wgsRuntimeLog } = require("./services/runtimeLog");
// Socket.IO로 멀티플레이 대기방 상태를 동기화합니다.
const createMultiplayerRouter = require('./multiplayerRoutes');
const { createMemberSessionService } = require('./services/memberSessionService');

// multiplayerSocket.js
// 역할:
// 1. Socket.IO 연결을 통해 대기방 참여자 목록을 실시간으로 갱신합니다.
// 2. 실제 방 생성/입장/시작/제출은 REST API가 DB에 저장하고,
//  이 파일은 화면 갱신 이벤트를 전달하는 역할만 맡는다.
// 3. 기존 서버 기능을 깨뜨리지 않기 위해 socket.io가 설치되어 있고 io가 있을 때만 동작합니다.

const { getSocketRoomName } = createMultiplayerRouter;

function normalizeRoomCode(value) {
    return String(value || '').trim().replace(/[^0-9]/g, '');
}


async function getRoomDetail(pool, roomCode) {
    const [roomRows] = await pool.query(
        `SELECT *
         FROM wgs_multiplayer_rooms
         WHERE room_code = ?
         ORDER BY FIELD(status, 'WAITING', 'PLAYING', 'FINISHED', 'CANCELLED'), id DESC
         LIMIT 1`,
        [roomCode]
    );
    const room = roomRows[0];
    if (!room) return null;

    const [members] = await pool.query(
        `SELECT user_id, user_name, role, status, joined_at, submitted_at
         FROM wgs_multiplayer_room_members
         WHERE room_id = ?
           AND status <> ' LEFT' ORDER BY role = 'HOST'DESC, joined_at ASC, id ASC`,
        [room.id]
    );

    const [resultRows] = await pool.query(
        `SELECT user_id, total_score, average_score, correct_count, total_count, is_pass, submitted_at
         FROM wgs_multiplayer_results
         WHERE room_id = ?
         ORDER BY total_score DESC, correct_count DESC, submitted_at ASC`,
        [room.id]
    );

    return {
        id: room.id,
        roomCode: room.room_code,
        maxPlayers: room.max_players,
        status: room.status,
        hostUserId: room.host_user_id,
        hostUserName: room.host_user_name,
        createdAt: room.created_at,
        startedAt: room.started_at,
        finishedAt: room.finished_at,
        memberCount: members.length,
        examMode: 'RANDOM_CBT_5_SUBJECTS_100',
        examRuleText: '과목별 20문제씩 총 100문제 랜덤 CBT',
        members: members.map((m) => ({
            userId: m.user_id,
            userName: m.user_name || m.user_id,
            role: m.role,
            status: m.status,
            joinedAt: m.joined_at,
            submittedAt: m.submitted_at
        })),
        scoreboard: resultRows.map((r, index) => ({
            rank: index + 1,
            userId: r.user_id,
            totalScore: Number(r.total_score || 0),
            averageScore: Number(r.average_score || 0),
            correctCount: Number(r.correct_count || 0),
            totalCount: Number(r.total_count || 0),
            isPass: Boolean(r.is_pass),
            submittedAt: r.submitted_at
        }))
    };
}

function attachMultiplayerSocket({ io, pool, memberSessionService = createMemberSessionService({ pool }) }) {
    if (!io || !pool) {
        wgsRuntimeLog("warn", "multiplayerSocket.js:83", 'WARN: Socket.IO server is not ready. Multiplayer realtime update is disabled.');
        return;
    }

    const disconnectRevoked = ({ userId, sessionHash }) => {
        for (const socket of io.sockets.sockets.values()) {
            if ((userId && socket.data.memberUserId === userId) || (sessionHash && socket.data.memberHash === sessionHash)) socket.disconnect(true);
        }
    };
    memberSessionService.events.on('revoked', disconnectRevoked);
    io.on('connection', socket => {
        // Public screen-setting broadcasts do not carry member data. Multiplayer
        // packets require the cookie and memory-only CSRF proof on every event.
        const sendRoom = async (payload = {}, join = false) => {
            try {
                const auth = await memberSessionService.validateSocket(socket);
                if (!auth.valid) throw new Error('session_expired');
                const roomCode = normalizeRoomCode(payload.roomCode || socket.data.roomCode);
                if (!roomCode) return;
                const detail = await getRoomDetail(pool, roomCode);
                if (!detail || !detail.members.some(member => member.userId === String(auth.user.id) && member.status.trim() !== 'LEFT')) {
                    socket.emit('multiplayer:error', { msg: '참여 중인 방만 열 수 있습니다.' });
                    return;
                }
                const roomName = getSocketRoomName(roomCode);
                // Reconnection can first request the existing room. Bind every
                // authenticated connection so revocation also closes that socket.
                socket.data.memberHash = auth.sessionHash;
                socket.data.memberUserId = String(auth.user.id);
                if (join) { await socket.join(roomName); socket.data.roomCode = roomCode; }
                socket.emit('multiplayer:room-updated', detail);
            } catch (_) {
                if (socket.data.roomCode) await socket.leave(getSocketRoomName(socket.data.roomCode));
                socket.emit('multiplayer:error', { msg: '세션이 만료되었습니다. 다시 로그인해주세요.' });
                socket.disconnect(true);
            }
        };
        socket.on('multiplayer:join-room', payload => sendRoom(payload, true));
        socket.on('multiplayer:request-room', payload => sendRoom(payload));
        const timer = setInterval(async () => {
            if (!socket.data.memberHash) return;
            try { if ((await memberSessionService.validateSocket(socket)).valid) return; } catch { /* Expired or revoked. */ }
            socket.disconnect(true);
        }, 15000);
        timer.unref?.();
        socket.on('disconnect', () => clearInterval(timer));
    });

    wgsRuntimeLog("info", "multiplayerSocket.js:131", 'OK: Socket.IO multiplayer realtime handler attached');
}

module.exports = { attachMultiplayerSocket };
