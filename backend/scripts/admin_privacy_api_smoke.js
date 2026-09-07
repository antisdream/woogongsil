// 로컬/운영 서버의 실제 관리자 목록 API가 인증 후 마스킹 응답만 반환하는지 확인합니다.
'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const { loadEnvFile } = require('../config/env');
const { createDatabasePool } = require('../config/database');
const { createAdminSessionService } = require('../services/adminSessionService');

async function main() {
    loadEnvFile(path.join(__dirname, '..', '.env'));
    const pool = createDatabasePool(process.env);
    const baseUrl = String(process.env.ADMIN_PRIVACY_SMOKE_BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
    const adminId = String(process.env.ADMIN_USER_ID || 'skn29').trim();
    const startedAt = new Date(Date.now() - 2000);
    let createdSession = null;

    const adminSessionService = createAdminSessionService({
        pool,
        env: process.env,
        getAdminUserControl: async () => ({ id: adminId, is_primary_admin: 1, is_operator: 1 }),
        normalizeAdminBool: (value) => value === true || Number(value) === 1,
        isAdminAccessUser: () => true,
        isPrimaryAdminUser: () => true,
    });

    try {
        createdSession = await adminSessionService.createSession(adminId, {
            headers: { 'user-agent': 'admin-privacy-api-smoke' },
            socket: { remoteAddress: '127.0.0.1' },
        });

        const response = await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=20&sortKey=id&sortDirection=asc`, {
            headers: {
                Cookie: `${adminSessionService.cookieName}=${encodeURIComponent(createdSession.rawToken)}`,
                'User-Agent': 'admin-privacy-api-smoke',
            },
        });
        const data = await response.json().catch(() => ({}));

        assert.equal(response.status, 200, data.message || data.msg || 'admin users API must return 200');
        assert.match(String(response.headers.get('cache-control') || ''), /no-store/i);
        assert.equal(data?.privacy?.masked, true);
        assert.ok(Array.isArray(data.users));
        assert.ok(data.users.length <= 20);
        assert.ok(Number(data?.pagination?.pageSize || 0) <= 20);

        const ids = data.users.map((user) => String(user.id || '')).filter(Boolean);
        const rawById = new Map();
        if (ids.length) {
            const [rawRows] = await pool.query('SELECT id, name, email FROM wgs_users WHERE id IN (?)', [ids]);
            rawRows.forEach((row) => rawById.set(String(row.id), row));
        }
        data.users.forEach((user) => {
            assert.equal(user.privacyMasked, true);
            assert.equal(Object.hasOwn(user, 'password'), false);
            assert.equal(Object.hasOwn(user, 'sessionToken'), false);
            const raw = rawById.get(String(user.id));
            if (raw?.name) assert.notEqual(user.name, String(raw.name).trim());
            if (raw?.email) assert.notEqual(user.email, String(raw.email).trim());
        });

        const [[auditRow]] = await pool.query(
            `SELECT COUNT(*) AS cnt
               FROM wgs_admin_privacy_access_logs
              WHERE actor_id = ? AND action = 'list_masked' AND created_at >= ?`,
            [adminId, startedAt]
        );
        assert.ok(Number(auditRow?.cnt || 0) >= 1, 'masked list access must create an audit row');

        console.log(JSON.stringify({
            success: true,
            status: response.status,
            noStore: true,
            pageSize: Number(data.pagination.pageSize || 0),
            returnedUsers: data.users.length,
            totalUsers: Number(data.pagination.total || 0),
            maskedOnly: true,
            auditRecorded: true,
        }));
    } finally {
        if (createdSession?.sessionHash) {
            await adminSessionService.revokeSessionHash(createdSession.sessionHash, 'privacy_api_smoke_complete');
        }
        await pool.end();
    }
}

main().catch((error) => {
    console.error('[admin privacy API smoke] failed:', error.message);
    process.exitCode = 1;
});
