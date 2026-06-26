'use strict';

function createMultiplayerAuth({ pool } = {}) {
    if (!pool) throw new Error('createMultiplayerAuth requires mysql pool');

    async function getSessionUserForRequest(req) {
        // Express 미들웨어/일반 라우터 함수가 함께 쓰는 세션 조회 헬퍼
        // req.query, req.body, 헤더 모두 기존 방식 그대로 허용합니다.
        const source = req.method === 'GET'? req.query : req.body;
        const id = String(source.id || source.userId || req.headers['x-user-id'] || '').trim();
        const sessionToken = String(source.sessionToken || req.headers['x-session-token'] || '').trim();

        if (!id || !sessionToken) return null;

        const [rows] = await pool.query(
            `SELECT id, name, sessionToken FROM wgs_users WHERE id = ? LIMIT 1`,
            [id]
        );
        const user = rows[0];

        if (!user || !user.sessionToken || user.sessionToken !== sessionToken) return null;

        return { id: String(user.id), name: user.name || String(user.id), sessionToken };
    }

    async function requireSessionUser(req, res, next) {
        try {
            const sessionUser = await getSessionUserForRequest(req);

            if (!sessionUser) {
                return res.status(401).json({ success: false, reason: 'session_expired', msg: '로그인이 필요합니다.' });
            }

            req.wgsUser = sessionUser;
            return next();
        } catch (error) {
            console.error('[multiplayer] session check error:', error);
            return res.status(500).json({ success: false, msg: '세션 확인 중 오류가 발생했습니다.' });
        }
    }

    async function requireSessionUserForHandler(req) {
        // 삭제 API처럼 미들웨어 체인 밖에서 인증이 필요한 곳 전용
        // 기존 requireSessionUser(req) 직접 호출 때문에 next is not a function 오류가 발생했으므로 분리합니다.
        const sessionUser = await getSessionUserForRequest(req);
        if (!sessionUser) {
            const authError = new Error('로그인이 필요합니다.');
            authError.statusCode = 401;
            throw authError;
        }
        return sessionUser;
    }


    return {
        getSessionUserForRequest,
        requireSessionUser,
        requireSessionUserForHandler
    };
}

module.exports = {
    createMultiplayerAuth
};
