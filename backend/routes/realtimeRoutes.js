// 실시간 접속자 상태 API를 제공합니다.
'use strict';

function registerRealtimeRoutes(options = {}) {
    const app = options.app;
    const validateRealtimeSession = options.validateRealtimeSession;
    const touchActiveUser = options.touchActiveUser;
    const getActiveUserList = options.getActiveUserList;
    const SERVER_INSTANCE_ID = options.serverInstanceId;

    const required = { app, validateRealtimeSession, touchActiveUser, getActiveUserList, SERVER_INSTANCE_ID };
    const missing = Object.entries(required).filter(([, value]) => value === undefined || value === null).map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerRealtimeRoutes missing dependencies: ${missing.join(', ')}`);
    }

    app.post('/api/online-users', async (req, res) => {
        try {
            // 홈/관리자 화면의 현재 접속자 조회도 같은 세션 검증 함수를 사용합니다.
            // req.body가 비어 들어와도 validateRealtimeSession 내부에서 안전하게 처리합니다.
            const session = await validateRealtimeSession(req);

            if (!session.valid) {
                return res.json({
                    success: false,
                    valid: false,
                    reason: session.reason,
                    serverInstanceId: SERVER_INSTANCE_ID,
                    users: []
                });
            }

            touchActiveUser(session.user, req, session.sessionToken);

            const users = getActiveUserList();
            return res.json({
                success: true,
                valid: true,
                count: users.length,
                users,
                serverInstanceId: SERVER_INSTANCE_ID
            });
        } catch (error) {
            console.error('실시간 접속자 조회 오류:', error);
            return res.status(500).json({ success: false, valid: false, msg: '실시간 접속자 조회 중 오류가 발생했습니다.' });
        }
    });

}

module.exports = registerRealtimeRoutes;
