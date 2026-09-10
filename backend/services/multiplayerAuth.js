'use strict';
const { createMemberSessionService } = require('./memberSessionService');

function createMultiplayerAuth({ pool, memberSessionService = createMemberSessionService({ pool }) } = {}) {
    if (!pool) throw new Error('createMultiplayerAuth requires mysql pool');

    async function getSessionUserForRequest(req) {
        const auth = await memberSessionService.validateRequest(req);
        return auth.valid ? { id: String(auth.user.id), name: auth.user.name || String(auth.user.id), sessionHash: auth.sessionHash } : null;
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
            return res.status(error.status || 500).json({ success: false, reason: error.reason || 'session_check_failed', msg: '세션 확인 중 오류가 발생했습니다.' });
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
