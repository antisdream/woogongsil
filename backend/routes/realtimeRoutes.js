// 실시간 접속자와 채팅 상태 API를 제공합니다.
'use strict';

function registerRealtimeRoutes(options = {}) {
    const app = options.app;
    const validateRealtimeSession = options.validateRealtimeSession;
    const touchActiveUser = options.touchActiveUser;
    const getActiveUserList = options.getActiveUserList;
    const getValidChatSince = options.getValidChatSince;
    const getRealtimeChatMessagesAfter = options.getRealtimeChatMessagesAfter;
    const isRealtimeAdminUser = options.isRealtimeAdminUser;
    const sanitizeChatText = options.sanitizeChatText;
    const realtimeChatMessages = options.realtimeChatMessages;
    const REALTIME_CHAT_MAX_MESSAGES = options.realtimeChatMaxMessages;
    const SERVER_INSTANCE_ID = options.serverInstanceId;

    const required = { app, validateRealtimeSession, touchActiveUser, getActiveUserList, getValidChatSince, getRealtimeChatMessagesAfter, isRealtimeAdminUser, sanitizeChatText, realtimeChatMessages, REALTIME_CHAT_MAX_MESSAGES, SERVER_INSTANCE_ID };
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

    // 실시간 채팅 API
    // ------------------------------------------------------------
    // 두 API 모두 로그인 세션 검증을 통과한 사용자에게만 응답합니다.
    // 프론트는 sessionStorage에 저장된 "현재 로그인 시작 시각"을 sinceMs로 보내고,
    // 서버는 그 시각 이후의 메시지만 내려줍니다.
    // 그래서 로그아웃 후 다시 로그인한 사용자는 자신의 화면에서만 채팅창이 비어 보이고,
    // 이미 접속 중인 다른 사용자의 채팅 목록은 그대로 유지됩니다.
    app.post('/api/realtime-chat/list', async (req, res) => {
        try {
            const session = await validateRealtimeSession(req);

            if (!session.valid) {
                return res.json({
                    success: false,
                    valid: false,
                    reason: session.reason,
                    serverInstanceId: SERVER_INSTANCE_ID,
                    messages: []
                });
            }

            const sinceMs = getValidChatSince(req.body.sinceMs);
            return res.json({
                success: true,
                valid: true,
                serverInstanceId: SERVER_INSTANCE_ID,
                messages: getRealtimeChatMessagesAfter(sinceMs)
            });
        } catch (error) {
            console.error('실시간 채팅 목록 조회 오류:', error);
            return res.status(500).json({ success: false, valid: false, msg: '실시간 채팅 목록 조회 중 오류가 발생했습니다.', messages: [] });
        }
    });

    app.post('/api/realtime-chat/send', async (req, res) => {
        try {
            const session = await validateRealtimeSession(req);

            if (!session.valid) {
                return res.json({
                    success: false,
                    valid: false,
                    reason: session.reason,
                    serverInstanceId: SERVER_INSTANCE_ID,
                    messages: []
                });
            }

            const text = sanitizeChatText(req.body.text);

            if (!text) {
                return res.json({
                    success: false,
                    valid: true,
                    serverInstanceId: SERVER_INSTANCE_ID,
                    msg: '채팅 내용을 입력해주세요.'
                });
            }

            const now = Date.now();
            const isAdminMessage = isRealtimeAdminUser(session.user);
            const message = {
                id: `${now}_${Math.random().toString(36).slice(2, 10)}`,
                userId: session.user.id,
                userName: session.user.name || session.user.id,
                role: isAdminMessage ? 'admin' : 'user',
                isAdmin: isAdminMessage,
                text,
                createdAtMs: now
            };

            realtimeChatMessages.push(message);

            // 채팅 버퍼는 실시간 화면 표시용이므로 최근 300개만 보관합니다.
            // DB를 변경하지 않기 때문에 기존 게시판/랭킹/문제 풀이 기능에는 영향이 없습니다.
            while (realtimeChatMessages.length >REALTIME_CHAT_MAX_MESSAGES) {
                realtimeChatMessages.shift();
            }

            const sinceMs = getValidChatSince(req.body.sinceMs);
            return res.json({
                success: true,
                valid: true,
                serverInstanceId: SERVER_INSTANCE_ID,
                message: {
                    id: message.id,
                    userId: message.userId,
                    userName: message.userName,
                    role: message.role,
                    isAdmin: message.isAdmin,
                    text: message.text,
                    createdAt: new Date(message.createdAtMs).toISOString()
                },
                messages: getRealtimeChatMessagesAfter(sinceMs)
            });
        } catch (error) {
            console.error('실시간 채팅 전송 오류:', error);
            return res.status(500).json({ success: false, valid: false, msg: '실시간 채팅 전송 중 오류가 발생했습니다.' });
        }
    });

}

module.exports = registerRealtimeRoutes;
