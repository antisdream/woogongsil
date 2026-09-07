'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const { createDatabasePool } = require('../config/database');
const { createLegalConsentService } = require('../services/legalConsentService');
const { sanitizeFortuneResult } = require('../services/fortunePrivacyService');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
    const pool = createDatabasePool();
    const service = createLegalConsentService({ pool });
    const connection = await pool.getConnection();
    try {
        const [serverRows] = await pool.query(
            'SELECT @@hostname AS hostname, @@port AS port, @@read_only AS readOnly, DATABASE() AS databaseName'
        );
        const server = serverRows[0];
        assert.equal(String(process.env.DB_HOST || '').toLowerCase(), '127.0.0.1', 'DB_HOST must be local');
        assert.equal(Number(server.readOnly), 0, 'local DB must be writable');

        await service.ensureSchema();
        const signupDocuments = await service.getActiveDocuments('signup');
        const fortuneDocuments = await service.getActiveDocuments('fortune');
        assert.deepEqual(signupDocuments.map((item) => item.documentCode), ['TERMS', 'SIGNUP_PRIVACY']);
        assert.deepEqual(fortuneDocuments.map((item) => item.documentCode), ['FORTUNE_PROCESSING', 'FORTUNE_RESULT_STORAGE']);

        const signupBundle = {
            age14Confirmed: true,
            acceptances: signupDocuments.map((document) => ({
                documentCode: document.documentCode,
                version: document.version,
                sha256: document.sha256,
                accepted: true,
            })),
        };
        const validation = await service.validateAcceptanceBundle(signupBundle, 'signup', { requireAge14: true });
        assert.equal(validation.acceptedDocuments.length, 2);

        await assert.rejects(
            () => service.validateAcceptanceBundle({ age14Confirmed: true, acceptances: [] }, 'signup', { requireAge14: true }),
            (error) => error?.code === 'LEGAL_REQUIRED_NOT_ACCEPTED'
        );
        const outdatedBundle = JSON.parse(JSON.stringify(signupBundle));
        outdatedBundle.acceptances[0].version = 'outdated-version';
        await assert.rejects(
            () => service.validateAcceptanceBundle(outdatedBundle, 'signup', { requireAge14: true }),
            (error) => error?.code === 'LEGAL_DOCUMENT_VERSION_MISMATCH'
        );

        const [beforeRows] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM wgs_signup_requests) AS signupCount,
                (SELECT COUNT(*) FROM wgs_legal_acceptance_events) AS eventCount`
        );

        await connection.beginTransaction();
        const smokeId = `smoke${crypto.randomBytes(6).toString('hex')}`;
        const [insertResult] = await connection.query(
            `INSERT INTO wgs_signup_requests
             (login_id, password_hash, name, email, status)
             VALUES (?, ?, ?, ?, 'PENDING')`,
            [smokeId, 'smoke-only-not-a-real-password-hash', '로컬검증', `${smokeId}@invalid.local`]
        );
        await service.insertAcceptanceEvents(connection, {
            signupRequestId: insertResult.insertId,
            age14Confirmed: true,
            acceptedDocuments: validation.acceptedDocuments,
        });
        await service.markSignupEvidenceForRetention(connection, insertResult.insertId);
        const [retentionRows] = await connection.query(
            `SELECT COUNT(*) AS retained
             FROM wgs_legal_acceptance_events
             WHERE signup_request_id = ? AND retention_until IS NOT NULL`,
            [insertResult.insertId]
        );
        assert.equal(Number(retentionRows[0].retained), 2);
        const evidence = await service.getSignupEvidenceStatus(connection, insertResult.insertId);
        assert.equal(evidence.complete, true);
        await connection.rollback();

        const [afterRows] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM wgs_signup_requests) AS signupCount,
                (SELECT COUNT(*) FROM wgs_legal_acceptance_events) AS eventCount`
        );
        assert.deepEqual(afterRows[0], beforeRows[0], 'rollback must leave no smoke rows');

        const [fortuneCounts] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(storage_version IS NULL) AS legacyPreserved,
                    SUM(storage_version = 'RESULT_ONLY_V1') AS resultOnly
             FROM wgs_fortune_history`
        );
        const safeResult = sanitizeFortuneResult('individual', {
            name: '검증이름',
            birthdate: '1990-01-02',
            birthtime: '10:00',
            nameHash: 123,
            dayHash: 456,
            saju: {},
            elementCount: {},
            score: 80,
            totalLuck: '오늘은 검증이름님에게 좋은 결과입니다.',
        }, {
            name: '검증이름',
            birthdate: '1990-01-02',
            birthtime: '10:00',
        });
        const serialized = JSON.stringify(safeResult);
        assert.equal(serialized.includes('검증이름'), false);
        assert.equal(serialized.includes('1990-01-02'), false);
        assert.equal(serialized.includes('10:00'), false);

        console.log(JSON.stringify({
            success: true,
            localDatabase: {
                hostname: server.hostname,
                port: Number(server.port),
                databaseName: server.databaseName,
                readOnly: Number(server.readOnly),
            },
            documents: { signup: signupDocuments.length, fortune: fortuneDocuments.length },
            transactionRollback: 'PASS',
            evidenceRetentionUpdate: 'PASS',
            currentRows: {
                signupRequests: Number(beforeRows[0].signupCount || 0),
                legalAcceptanceEvents: Number(beforeRows[0].eventCount || 0),
            },
            missingConsentBlocked: 'PASS',
            outdatedVersionBlocked: 'PASS',
            fortuneRawSanitizer: 'PASS',
            existingFortuneRows: {
                total: Number(fortuneCounts[0].total || 0),
                legacyPreserved: Number(fortuneCounts[0].legacyPreserved || 0),
                resultOnly: Number(fortuneCounts[0].resultOnly || 0),
            },
        }, null, 2));
    } finally {
        try { await connection.rollback(); } catch {}
        connection.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
