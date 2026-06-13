// 현재 서버 프로세스에서 사용하는 실시간 접속자와 채팅 상태를 메모리에 보관합니다.
// 이 값들은 Node.js 프로세스가 재시작되면 의도적으로 초기화됩니다.
function createRealtimeState(options = {}) {
    const activeUserTtlMs = Number(options.activeUserTtlMs || 45 * 1000);
    const realtimeChatMaxMessages = Number(options.realtimeChatMaxMessages || 300);
    const adminUserId = String(options.adminUserId || '').trim().toLowerCase();

    const activeUsers = new Map();
    const realtimeChatMessages = [];

    function getRequestIp(req) {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) return String(forwarded).split(',')[0].trim();
        return req.socket?.remoteAddress || 'unknown';
    }

    function pruneActiveUsers() {
        const now = Date.now();

        for (const [userId, info] of activeUsers.entries()) {
            if (!info || now - Number(info.lastSeenAt || 0) > activeUserTtlMs) {
                activeUsers.delete(userId);
            }
        }
    }

    function touchActiveUser(user, req, sessionToken) {
        if (!user || !user.id || !sessionToken) return;

        pruneActiveUsers();

        const oldInfo = activeUsers.get(String(user.id)) || {};
        const now = Date.now();
        const userRole = String(user.role || user.user_role || '').trim().toLowerCase();
        const hasTruthyAdminFlag = [
            user.isPrimaryAdmin,
            user.is_primary_admin,
            user.isOperator,
            user.is_operator,
        ].some((value) => value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true');
        const hasAdminFlag = (
            userRole === 'admin' ||
            userRole === 'operator' ||
            hasTruthyAdminFlag
        );

        activeUsers.set(String(user.id), {
            id: user.id,
            name: user.name || user.id,
            role: hasAdminFlag ? 'admin' : oldInfo.role || 'user',
            sessionToken,
            ip: getRequestIp(req),
            loginAt: oldInfo.loginAt || now,
            lastSeenAt: now,
        });
    }

    function removeActiveUser(userId, sessionToken = null) {
        const key = String(userId || '').trim();
        if (!key) return;

        const oldInfo = activeUsers.get(key);

        // Ignore stale logout requests from a browser tab that no longer owns the latest session token.
        if (sessionToken && oldInfo?.sessionToken && oldInfo.sessionToken !== sessionToken) return;

        activeUsers.delete(key);
    }

    function getActiveUserList() {
        pruneActiveUsers();

        return Array.from(activeUsers.values())
            .sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
            .map((user) => {
                const connectedDate = user.loginAt ? new Date(user.loginAt).toISOString() : null;
                const lastSeenDate = user.lastSeenAt ? new Date(user.lastSeenAt).toISOString() : null;
                const normalizedUserId = String(user.id || '').trim().toLowerCase();

                return {
                    id: user.id,
                    userId: user.id,
                    name: user.name,
                    userName: user.name,
                    role: normalizedUserId === adminUserId ? 'admin' : 'user',
                    ip: user.ip,
                    loginAt: connectedDate,
                    connectedAt: connectedDate,
                    lastSeenAt: lastSeenDate,
                    lastSeen: lastSeenDate,
                };
            });
    }

    function sanitizeChatText(value) {
        return String(value || '')
            .replace(/[\x00-\x1F\x7F]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500);
    }

    function getValidChatSince(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function getRealtimeChatMessagesAfter(sinceMs) {
        const safeSinceMs = getValidChatSince(sinceMs);

        return realtimeChatMessages
            .filter((message) => Number(message.createdAtMs || 0) >= safeSinceMs)
            .map((message) => ({
                id: message.id,
                userId: message.userId,
                userName: message.userName,
                text: message.text,
                createdAt: new Date(message.createdAtMs).toISOString(),
            }));
    }

    return {
        activeUsers,
        realtimeChatMessages,
        realtimeChatMaxMessages,
        getRequestIp,
        pruneActiveUsers,
        touchActiveUser,
        removeActiveUser,
        getActiveUserList,
        sanitizeChatText,
        getValidChatSince,
        getRealtimeChatMessagesAfter,
    };
}

module.exports = {
    createRealtimeState,
};
