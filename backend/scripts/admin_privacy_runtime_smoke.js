// 실제 MySQL 스키마와 마스킹·감사 INSERT 호환성을 확인하고 테스트 행은 롤백합니다.
'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const { loadEnvFile } = require('../config/env');
const { createDatabasePool } = require('../config/database');
const {
    DEFAULT_PAGE_SIZE,
    maskName,
    maskEmail,
    createAdminPrivacyService,
} = require('../services/adminPrivacyService');

async function main() {
    loadEnvFile(path.join(__dirname, '..', '.env'));
    const pool = createDatabasePool(process.env);
    const service = createAdminPrivacyService({ pool, env: process.env });
    let connection;

    try {
        await service.ensureSchema();

        const [[schemaRow]] = await pool.query(
            `SELECT COUNT(*) AS cnt
               FROM information_schema.tables
              WHERE table_schema = DATABASE()
                AND table_name = 'wgs_admin_privacy_access_logs'`
        );
        assert.equal(Number(schemaRow?.cnt || 0), 1, 'privacy audit table must exist');

        const [[totalRow]] = await pool.query('SELECT COUNT(*) AS total FROM wgs_users');
        const [rows] = await pool.query(
            'SELECT id, name, email FROM wgs_users ORDER BY id ASC LIMIT ? OFFSET ?',
            [DEFAULT_PAGE_SIZE, 0]
        );
        assert.ok(Number(totalRow?.total || 0) >= rows.length, 'pagination count must cover returned rows');
        assert.ok(rows.length <= DEFAULT_PAGE_SIZE, 'runtime query must stay within the server page size');

        const maskedRows = rows.map((row) => ({
            id: row.id,
            name: maskName(row.name || row.id),
            email: maskEmail(row.email || ''),
        }));
        rows.forEach((row, index) => {
            if (row.name) assert.notEqual(maskedRows[index].name, String(row.name).trim());
            if (row.email) assert.notEqual(maskedRows[index].email, String(row.email).trim());
        });

        connection = await pool.getConnection();
        await connection.beginTransaction();
        const transactionService = createAdminPrivacyService({
            pool: {
                query(sql, params) {
                    if (/^CREATE TABLE IF NOT EXISTS/i.test(String(sql).trim())) return Promise.resolve([[], []]);
                    return connection.query(sql, params);
                },
            },
            env: process.env,
        });
        const actorId = `runtime_smoke_${Date.now()}`;
        await transactionService.writeAccessLog({
            actorId,
            actorRole: 'runtime_test',
            action: 'list_masked',
            outcome: 'success',
            resultCount: maskedRows.length,
            page: 1,
            pageSize: DEFAULT_PAGE_SIZE,
            keyword: 'runtime-check',
            req: { headers: { 'x-forwarded-for': '127.0.0.1', 'user-agent': 'admin-privacy-runtime-smoke' } },
        });
        const [[auditRow]] = await connection.query(
            'SELECT COUNT(*) AS cnt FROM wgs_admin_privacy_access_logs WHERE actor_id = ?',
            [actorId]
        );
        assert.equal(Number(auditRow?.cnt || 0), 1, 'privacy audit insert must succeed');
        await connection.rollback();
        connection.release();
        connection = null;
        const [[rollbackRow]] = await pool.query(
            'SELECT COUNT(*) AS cnt FROM wgs_admin_privacy_access_logs WHERE actor_id = ?',
            [actorId]
        );
        assert.equal(Number(rollbackRow?.cnt || 0), 0, 'runtime audit test row must be rolled back');

        console.log(JSON.stringify({
            success: true,
            schemaReady: true,
            totalUsers: Number(totalRow?.total || 0),
            checkedRows: rows.length,
            pageSize: DEFAULT_PAGE_SIZE,
            maskingVerified: true,
            auditInsertVerifiedWithRollback: true,
        }));
    } finally {
        if (connection) {
            try { await connection.rollback(); } catch (_) { /* best effort */ }
            connection.release();
        }
        await pool.end();
    }
}

main().catch((error) => {
    console.error('[admin privacy runtime smoke] failed:', error.message);
    process.exitCode = 1;
});
