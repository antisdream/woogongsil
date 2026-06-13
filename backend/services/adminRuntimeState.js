const fs = require('fs');

const DEFAULT_NOTICE_MAX_HISTORY = 30;
const DEFAULT_NOTICE_TTL_MS = 1000 * 60 * 60 * 24;

function createAdminRuntimeState(options = {}) {
    const maintenanceFile = options.maintenanceFile;
    const defaultMaintenanceMessage = String(options.defaultMaintenanceMessage || '').trim();
    const adminOnlyUserId = String(options.adminOnlyUserId || '').trim();
    const activeUsers = options.activeUsers;
    const noticeMaxHistory = Number(options.noticeMaxHistory || DEFAULT_NOTICE_MAX_HISTORY);
    const noticeTtlMs = Number(options.noticeTtlMs || DEFAULT_NOTICE_TTL_MS);
    const adminBroadcastNotices = [];

    let adminMaintenanceState = {
        enabled: false,
        message: defaultMaintenanceMessage,
        updatedAt: null,
        updatedBy: null,
    };

    function normalizeMaintenanceState(rawState = {}) {
        return {
            enabled: Boolean(rawState.enabled),
            message: String(rawState.message || defaultMaintenanceMessage).trim() || defaultMaintenanceMessage,
            updatedAt: rawState.updatedAt || null,
            updatedBy: rawState.updatedBy || null,
        };
    }

    function loadAdminMaintenanceState() {
        try {
            if (!maintenanceFile || !fs.existsSync(maintenanceFile)) {
                adminMaintenanceState = normalizeMaintenanceState();
                return;
            }

            const rawText = fs.readFileSync(maintenanceFile, 'utf8');
            adminMaintenanceState = normalizeMaintenanceState(JSON.parse(rawText || '{}'));
        } catch (error) {
            console.warn('[admin maintenance warning] Failed to read maintenance state file. Using defaults:', error.message);
            adminMaintenanceState = normalizeMaintenanceState();
        }
    }

    function saveAdminMaintenanceState() {
        if (!maintenanceFile) return;
        fs.writeFileSync(maintenanceFile, JSON.stringify(adminMaintenanceState, null, 2), 'utf8');
    }

    function getAdminMaintenanceState() {
        return normalizeMaintenanceState(adminMaintenanceState);
    }

    function updateAdminMaintenanceState({ enabled, message, updatedBy }) {
        adminMaintenanceState = normalizeMaintenanceState({
            enabled,
            message,
            updatedAt: new Date().toISOString(),
            updatedBy,
        });
        saveAdminMaintenanceState();
        return getAdminMaintenanceState();
    }

    function isMaintenanceBlockedUser(userId) {
        const normalizedUserId = String(userId || '').trim();
        return getAdminMaintenanceState().enabled && normalizedUserId !== adminOnlyUserId;
    }

    function sanitizeAdminNoticeText(value, maxLength) {
        return String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim()
            .slice(0, maxLength);
    }

    function pruneAdminBroadcastNotices() {
        const cutoff = Date.now() - noticeTtlMs;

        for (let i = adminBroadcastNotices.length - 1; i >= 0; i -= 1) {
            if (adminBroadcastNotices[i].createdAtMs < cutoff) {
                adminBroadcastNotices.splice(i, 1);
            }
        }

        while (adminBroadcastNotices.length > noticeMaxHistory) {
            adminBroadcastNotices.shift();
        }
    }

    function getAdminBroadcastHistory() {
        pruneAdminBroadcastNotices();
        return adminBroadcastNotices.slice().reverse();
    }

    function getAdminBroadcastsForUser(userId, sinceMs = 0) {
        pruneAdminBroadcastNotices();

        const normalizedUserId = String(userId || '').trim();
        const activeInfo = activeUsers?.get(normalizedUserId);
        const connectedSinceMs = activeInfo?.loginAt ? new Date(activeInfo.loginAt).getTime() : Date.now();
        const safeSinceMs = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : 0;
        const minCreatedAtMs = Math.max(safeSinceMs, connectedSinceMs || 0);

        return adminBroadcastNotices.filter((notice) => notice.createdAtMs > minCreatedAtMs);
    }

    function createAdminBroadcastNotice({ title, message, level, authorId, authorName, deliveredTo }) {
        const now = new Date();
        const notice = {
            id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
            title,
            message,
            level,
            authorId,
            authorName,
            deliveredTo,
            createdAt: now.toISOString(),
            createdAtMs: now.getTime(),
        };

        adminBroadcastNotices.push(notice);
        pruneAdminBroadcastNotices();
        return notice;
    }

    loadAdminMaintenanceState();

    return {
        sanitizeAdminNoticeText,
        getAdminBroadcastHistory,
        getAdminBroadcastsForUser,
        createAdminBroadcastNotice,
        getAdminMaintenanceState,
        updateAdminMaintenanceState,
        isMaintenanceBlockedUser,
    };
}

module.exports = {
    createAdminRuntimeState,
};
