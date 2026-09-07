// 관리자 화면에서 개인정보를 최소 노출하고 열람 이력을 별도로 남깁니다.
'use strict';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;
const MIN_SEARCH_LENGTH = 2;
const MIN_REVEAL_REASON_LENGTH = 5;
const MAX_REVEAL_REASON_LENGTH = 500;
const REVEAL_TTL_SECONDS = 60;

function clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeListQuery(query = {}) {
    const keyword = String(query.q || query.keyword || query.search || '').trim();
    if (keyword.length > 0 && keyword.length < MIN_SEARCH_LENGTH) {
        const error = new Error(`검색어는 ${MIN_SEARCH_LENGTH}자 이상 입력해주세요.`);
        error.statusCode = 400;
        error.reason = 'search_too_short';
        throw error;
    }
    if (keyword.length > MAX_SEARCH_LENGTH) {
        const error = new Error(`검색어는 ${MAX_SEARCH_LENGTH}자 이하로 입력해주세요.`);
        error.statusCode = 400;
        error.reason = 'search_too_long';
        throw error;
    }

    const sortKey = ['id', 'name', 'email'].includes(String(query.sortKey || 'id'))
        ? String(query.sortKey || 'id')
        : 'id';
    const sortDirection = String(query.sortDirection || '').toLowerCase() === 'desc' ? 'desc' : 'asc';

    return {
        keyword,
        page: clampInteger(query.page, 1, 1, 1_000_000),
        pageSize: clampInteger(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
        sortKey,
        sortDirection,
    };
}

function maskName(value) {
    const name = String(value || '').trim();
    const characters = Array.from(name);
    if (!characters.length) return '';
    if (characters.length === 1) return '*';
    if (characters.length === 2) return `${characters[0]}*`;
    return `${characters[0]}*${characters[characters.length - 1]}`;
}

function maskEmail(value) {
    const email = String(value || '').trim();
    if (!email) return '';

    const separator = email.lastIndexOf('@');
    if (separator <= 0 || separator === email.length - 1) return '***';

    const local = Array.from(email.slice(0, separator));
    const domain = email.slice(separator + 1);
    let maskedLocal = '*';
    if (local.length === 2) maskedLocal = `${local[0]}*`;
    if (local.length >= 3) maskedLocal = `${local[0]}***${local[local.length - 1]}`;
    return `${maskedLocal}@${domain}`;
}

function normalizeRevealReason(value) {
    const reason = String(value || '').replace(/\s+/g, ' ').trim();
    if (reason.length < MIN_REVEAL_REASON_LENGTH) {
        const error = new Error(`열람 사유는 ${MIN_REVEAL_REASON_LENGTH}자 이상 입력해주세요.`);
        error.statusCode = 400;
        error.reason = 'reveal_reason_too_short';
        throw error;
    }
    if (reason.length > MAX_REVEAL_REASON_LENGTH) {
        const error = new Error(`열람 사유는 ${MAX_REVEAL_REASON_LENGTH}자 이하로 입력해주세요.`);
        error.statusCode = 400;
        error.reason = 'reveal_reason_too_long';
        throw error;
    }
    return reason;
}

function createAdminPrivacyService(options = {}) {
    const pool = options.pool;
    const crypto = options.crypto || require('crypto');
    const env = options.env || process.env;

    if (!pool || typeof pool.query !== 'function') {
        throw new Error('createAdminPrivacyService requires a MySQL pool.');
    }

    const auditSecret = String(
        env.ADMIN_PRIVACY_AUDIT_SECRET
        || env.ADMIN_CSRF_SECRET
        || env.ADMIN_APPROVAL_BYPASS_SECRET
        || ''
    ).trim();
    let schemaPromise = null;

    function hashAuditValue(value) {
        const normalized = String(value || '').trim();
        if (!normalized || !auditSecret) return null;
        return crypto.createHmac('sha256', auditSecret).update(normalized, 'utf8').digest('hex');
    }

    function getClientIp(req) {
        const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
        return forwarded || String(req?.headers?.['x-real-ip'] || req?.ip || req?.socket?.remoteAddress || '').trim();
    }

    async function ensureSchema() {
        if (!schemaPromise) {
            schemaPromise = pool.query(`CREATE TABLE IF NOT EXISTS wgs_admin_privacy_access_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                actor_id VARCHAR(80) NOT NULL,
                actor_role VARCHAR(30) NOT NULL,
                action VARCHAR(40) NOT NULL,
                target_user_id VARCHAR(80) NULL,
                fields VARCHAR(120) NULL,
                purpose VARCHAR(500) NULL,
                outcome VARCHAR(30) NOT NULL,
                result_count INT NULL,
                page_no INT NULL,
                page_size INT NULL,
                search_hash CHAR(64) NULL,
                request_ip_hash CHAR(64) NULL,
                user_agent_hash CHAR(64) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_admin_privacy_actor_created (actor_id, created_at),
                INDEX idx_admin_privacy_target_created (target_user_id, created_at),
                INDEX idx_admin_privacy_action_created (action, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
                .catch((error) => {
                    schemaPromise = null;
                    throw error;
                });
        }
        await schemaPromise;
    }

    async function writeAccessLog(entry = {}) {
        await ensureSchema();
        const actorId = String(entry.actorId || '').trim();
        if (!actorId) throw new Error('Privacy access audit requires an actor id.');

        const req = entry.req || {};
        await pool.query(
            `INSERT INTO wgs_admin_privacy_access_logs
             (actor_id, actor_role, action, target_user_id, fields, purpose, outcome,
              result_count, page_no, page_size, search_hash, request_ip_hash, user_agent_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                actorId.slice(0, 80),
                String(entry.actorRole || 'operator').slice(0, 30),
                String(entry.action || 'unknown').slice(0, 40),
                entry.targetUserId ? String(entry.targetUserId).slice(0, 80) : null,
                entry.fields ? String(entry.fields).slice(0, 120) : null,
                entry.purpose ? String(entry.purpose).slice(0, MAX_REVEAL_REASON_LENGTH) : null,
                String(entry.outcome || 'success').slice(0, 30),
                Number.isFinite(Number(entry.resultCount)) ? Number(entry.resultCount) : null,
                Number.isFinite(Number(entry.page)) ? Number(entry.page) : null,
                Number.isFinite(Number(entry.pageSize)) ? Number(entry.pageSize) : null,
                entry.keyword ? hashAuditValue(entry.keyword) : null,
                hashAuditValue(getClientIp(req)),
                hashAuditValue(req?.headers?.['user-agent']),
            ]
        );
    }

    return {
        ensureSchema,
        hashAuditValue,
        writeAccessLog,
    };
}

module.exports = {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    MIN_SEARCH_LENGTH,
    MAX_SEARCH_LENGTH,
    MIN_REVEAL_REASON_LENGTH,
    MAX_REVEAL_REASON_LENGTH,
    REVEAL_TTL_SECONDS,
    normalizeListQuery,
    normalizeRevealReason,
    maskName,
    maskEmail,
    createAdminPrivacyService,
};
