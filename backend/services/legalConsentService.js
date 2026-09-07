'use strict';

const crypto = require('crypto');
const { LEGAL_DOCUMENTS } = require('./legalDocuments');

const SIGNUP_REQUIRED_CODES = ['TERMS', 'SIGNUP_PRIVACY'];
const FORTUNE_REQUIRED_CODES = ['FORTUNE_PROCESSING'];
const FORTUNE_STORAGE_CODE = 'FORTUNE_RESULT_STORAGE';
const DEFAULT_SIGNUP_STAGING_RETENTION_DAYS = 30;
const DEFAULT_EVIDENCE_RETENTION_YEARS = 3;

class LegalConsentError extends Error {
    constructor(message, code = 'LEGAL_CONSENT_INVALID', status = 400) {
        super(message);
        this.name = 'LegalConsentError';
        this.code = code;
        this.status = status;
    }
}

function hashDocumentContent(content) {
    return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function positiveInteger(value, fallback, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, max);
}

function normalizeContext(value) {
    const context = String(value || '').trim().toLowerCase();
    if (!['signup', 'fortune'].includes(context)) {
        throw new LegalConsentError('지원하지 않는 동의 문서 범위입니다.', 'LEGAL_CONTEXT_INVALID');
    }
    return context;
}

function normalizeAcceptanceList(bundle) {
    const source = Array.isArray(bundle) ? bundle : bundle?.acceptances;
    if (!Array.isArray(source)) return [];
    const seen = new Set();
    return source.reduce((list, item) => {
        const documentCode = String(item?.documentCode || item?.code || '').trim().toUpperCase();
        if (!documentCode || seen.has(documentCode)) return list;
        seen.add(documentCode);
        list.push({
            documentCode,
            version: String(item?.version || '').trim(),
            sha256: String(item?.sha256 || item?.contentSha256 || '').trim().toLowerCase(),
            accepted: item?.accepted === true,
        });
        return list;
    }, []);
}

function publicDocument(row) {
    return {
        id: Number(row.id),
        documentCode: row.document_code,
        context: row.context,
        version: row.version,
        title: row.title,
        content: row.content,
        sha256: row.content_sha256,
        legalBasis: row.legal_basis || '',
        required: Boolean(Number(row.consent_required)),
        effectiveAt: row.effective_at,
    };
}

function createLegalConsentService(options = {}) {
    const pool = options.pool;
    const env = options.env || process.env;
    if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') {
        throw new Error('createLegalConsentService requires a MySQL pool.');
    }

    const signupRetentionDays = positiveInteger(
        env.WGS_SIGNUP_STAGING_RETENTION_DAYS,
        DEFAULT_SIGNUP_STAGING_RETENTION_DAYS,
        365
    );
    const evidenceRetentionYears = positiveInteger(
        env.WGS_LEGAL_EVIDENCE_RETENTION_YEARS,
        DEFAULT_EVIDENCE_RETENTION_YEARS,
        10
    );
    let schemaReady = false;
    let schemaPromise = null;

    async function tableColumnExists(tableName, columnName) {
        const [rows] = await pool.query(
            `SELECT 1
             FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
             LIMIT 1`,
            [tableName, columnName]
        );
        return rows.length > 0;
    }

    async function tableIndexExists(tableName, indexName) {
        const [rows] = await pool.query(
            `SELECT 1
             FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
             LIMIT 1`,
            [tableName, indexName]
        );
        return rows.length > 0;
    }

    async function addColumnIfMissing(tableName, columnName, definition) {
        if (await tableColumnExists(tableName, columnName)) return;
        await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
    }

    async function ensureSignupRequestSchema() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wgs_signup_requests (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                login_id VARCHAR(100) NULL,
                password_hash VARCHAR(255) NULL,
                name VARCHAR(100) NULL,
                email VARCHAR(255) NULL,
                status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
                requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_by VARCHAR(100) NULL,
                reviewed_at DATETIME NULL,
                review_note TEXT NULL,
                request_ip VARCHAR(64) NULL,
                user_agent TEXT NULL,
                approved_user_id VARCHAR(100) NULL,
                retention_until DATETIME NULL,
                personal_data_purged_at DATETIME NULL,
                PRIMARY KEY (id),
                INDEX idx_wgs_signup_status_requested (status, requested_at),
                INDEX idx_wgs_signup_login_status (login_id, status),
                INDEX idx_wgs_signup_email_status (email, status),
                INDEX idx_wgs_signup_retention (retention_until)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query('ALTER TABLE wgs_signup_requests MODIFY COLUMN login_id VARCHAR(100) NULL');
        await pool.query('ALTER TABLE wgs_signup_requests MODIFY COLUMN password_hash VARCHAR(255) NULL');
        await pool.query('ALTER TABLE wgs_signup_requests MODIFY COLUMN name VARCHAR(100) NULL');
        await pool.query('ALTER TABLE wgs_signup_requests MODIFY COLUMN email VARCHAR(255) NULL');
        await addColumnIfMissing('wgs_signup_requests', 'approved_user_id', 'VARCHAR(100) NULL AFTER user_agent');
        await addColumnIfMissing('wgs_signup_requests', 'retention_until', 'DATETIME NULL AFTER approved_user_id');
        await addColumnIfMissing('wgs_signup_requests', 'personal_data_purged_at', 'DATETIME NULL AFTER retention_until');
        if (!(await tableIndexExists('wgs_signup_requests', 'idx_wgs_signup_retention'))) {
            await pool.query('ALTER TABLE wgs_signup_requests ADD INDEX idx_wgs_signup_retention (retention_until)');
        }
    }

    async function ensureLegalTables() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wgs_legal_documents (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                document_code VARCHAR(64) NOT NULL,
                context VARCHAR(32) NOT NULL,
                version VARCHAR(64) NOT NULL,
                title VARCHAR(255) NOT NULL,
                content LONGTEXT NOT NULL,
                content_sha256 CHAR(64) NOT NULL,
                legal_basis VARCHAR(500) NULL,
                consent_required TINYINT(1) NOT NULL DEFAULT 1,
                effective_at DATETIME NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_wgs_legal_document_version (document_code, version),
                INDEX idx_wgs_legal_active_context (context, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS wgs_legal_acceptance_events (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                document_id BIGINT UNSIGNED NOT NULL,
                signup_request_id BIGINT UNSIGNED NULL,
                user_id VARCHAR(100) NULL,
                event_type VARCHAR(32) NOT NULL DEFAULT 'ACCEPTED',
                context VARCHAR(32) NOT NULL,
                document_version VARCHAR(64) NOT NULL,
                document_sha256 CHAR(64) NOT NULL,
                age_14_confirmed TINYINT(1) NULL,
                accepted_via VARCHAR(32) NOT NULL DEFAULT 'web',
                request_id CHAR(36) NOT NULL,
                occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                retention_until DATETIME NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_wgs_legal_event_request (request_id),
                INDEX idx_wgs_legal_event_signup (signup_request_id, occurred_at),
                INDEX idx_wgs_legal_event_user (user_id, occurred_at),
                INDEX idx_wgs_legal_event_document (document_id, event_type),
                INDEX idx_wgs_legal_event_retention (retention_until)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    async function ensureFortuneHistorySchema() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wgs_fortune_history (
                id INT NOT NULL AUTO_INCREMENT,
                userId VARCHAR(50) NULL,
                time DATETIME NULL,
                type VARCHAR(50) NULL,
                data JSON NULL,
                storage_version VARCHAR(32) NULL,
                legal_document_version VARCHAR(64) NULL,
                legal_document_sha256 CHAR(64) NULL,
                PRIMARY KEY (id),
                INDEX idx_wgs_fortune_user_time (userId, time)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await addColumnIfMissing('wgs_fortune_history', 'storage_version', 'VARCHAR(32) NULL AFTER data');
        await addColumnIfMissing('wgs_fortune_history', 'legal_document_version', 'VARCHAR(64) NULL AFTER storage_version');
        await addColumnIfMissing('wgs_fortune_history', 'legal_document_sha256', 'CHAR(64) NULL AFTER legal_document_version');
        if (!(await tableIndexExists('wgs_fortune_history', 'idx_wgs_fortune_user_time'))) {
            await pool.query('ALTER TABLE wgs_fortune_history ADD INDEX idx_wgs_fortune_user_time (userId, time)');
        }

        // 기존 행은 과거 정책에 따라 저장된 사용자 데이터일 수 있으므로 자동 삭제·덮어쓰지 않습니다.
        // 조회 API는 RESULT_ONLY_V1 행만 반환하고, 기존 행의 파기는 별도 승인 후 수행합니다.
    }

    async function seedLegalDocuments() {
        for (const document of LEGAL_DOCUMENTS) {
            const contentSha256 = hashDocumentContent(document.content);
            await pool.query(
                `INSERT IGNORE INTO wgs_legal_documents
                 (document_code, context, version, title, content, content_sha256, legal_basis,
                  consent_required, effective_at, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [
                    document.code,
                    document.context,
                    document.version,
                    document.title,
                    document.content,
                    contentSha256,
                    document.legalBasis,
                    document.required ? 1 : 0,
                    document.effectiveAt,
                ]
            );
            const [rows] = await pool.query(
                `SELECT id, content_sha256
                 FROM wgs_legal_documents
                 WHERE document_code = ? AND version = ?
                 LIMIT 1`,
                [document.code, document.version]
            );
            if (!rows[0] || rows[0].content_sha256 !== contentSha256) {
                throw new Error(`법률 문서 ${document.code} ${document.version}의 본문 해시가 기존 DB와 다릅니다. 문서 버전을 올려야 합니다.`);
            }
            await pool.query(
                `UPDATE wgs_legal_documents
                 SET is_active = CASE WHEN version = ? THEN 1 ELSE 0 END
                 WHERE document_code = ?`,
                [document.version, document.code]
            );
        }
    }

    async function purgeExpiredRecords() {
        await pool.query(`
            UPDATE wgs_signup_requests
            SET login_id = NULL,
                name = NULL,
                email = NULL,
                password_hash = NULL,
                request_ip = NULL,
                user_agent = NULL,
                personal_data_purged_at = COALESCE(personal_data_purged_at, NOW())
            WHERE status IN ('APPROVED', 'REJECTED')
              AND retention_until IS NOT NULL
              AND retention_until <= NOW()
              AND personal_data_purged_at IS NULL
        `);
        await pool.query(`
            DELETE FROM wgs_legal_acceptance_events
            WHERE retention_until IS NOT NULL AND retention_until <= NOW()
        `);
    }

    async function ensureSchema() {
        if (schemaReady) return;
        if (schemaPromise) return schemaPromise;
        schemaPromise = (async () => {
            await ensureSignupRequestSchema();
            await ensureLegalTables();
            await ensureFortuneHistorySchema();
            await seedLegalDocuments();
            await purgeExpiredRecords();
            schemaReady = true;
        })();
        try {
            await schemaPromise;
        } finally {
            schemaPromise = null;
        }
    }

    async function getActiveDocuments(context, runner = pool) {
        await ensureSchema();
        const normalizedContext = normalizeContext(context);
        const [rows] = await runner.query(
            `SELECT id, document_code, context, version, title, content, content_sha256,
                    legal_basis, consent_required,
                    DATE_FORMAT(effective_at, '%Y-%m-%d %H:%i:%s') AS effective_at
             FROM wgs_legal_documents
             WHERE context = ? AND is_active = 1 AND effective_at <= NOW()
             ORDER BY consent_required DESC, id ASC`,
            [normalizedContext]
        );
        return rows.map(publicDocument);
    }

    async function validateAcceptanceBundle(bundle, context, options = {}) {
        const normalizedContext = normalizeContext(context);
        const documents = await getActiveDocuments(normalizedContext);
        const acceptanceList = normalizeAcceptanceList(bundle);
        const requiredCodes = normalizedContext === 'signup' ? SIGNUP_REQUIRED_CODES : FORTUNE_REQUIRED_CODES;
        const additionalRequiredCodes = Array.isArray(options.requireDocumentCodes)
            ? options.requireDocumentCodes.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean)
            : [];
        const mustAccept = new Set([...requiredCodes, ...additionalRequiredCodes]);
        const documentMap = new Map(documents.map((document) => [document.documentCode, document]));
        const acceptedDocuments = [];

        for (const code of mustAccept) {
            const document = documentMap.get(code);
            if (!document) {
                throw new LegalConsentError('현재 적용 중인 동의 문서를 확인할 수 없습니다.', 'LEGAL_DOCUMENT_NOT_ACTIVE', 503);
            }
            const acceptance = acceptanceList.find((item) => item.documentCode === code);
            if (!acceptance?.accepted) {
                throw new LegalConsentError(`${document.title}에 동의해야 진행할 수 있습니다.`, 'LEGAL_REQUIRED_NOT_ACCEPTED');
            }
            if (acceptance.version !== document.version || acceptance.sha256 !== document.sha256) {
                throw new LegalConsentError('동의 문서가 변경되었습니다. 최신 내용을 다시 확인하고 동의해주세요.', 'LEGAL_DOCUMENT_VERSION_MISMATCH', 409);
            }
            acceptedDocuments.push(document);
        }

        for (const acceptance of acceptanceList.filter((item) => item.accepted)) {
            const document = documentMap.get(acceptance.documentCode);
            if (!document || mustAccept.has(acceptance.documentCode)) continue;
            if (acceptance.version !== document.version || acceptance.sha256 !== document.sha256) {
                throw new LegalConsentError('선택 동의 문서가 변경되었습니다. 최신 내용을 다시 확인해주세요.', 'LEGAL_DOCUMENT_VERSION_MISMATCH', 409);
            }
            acceptedDocuments.push(document);
        }

        const age14Confirmed = bundle?.age14Confirmed === true;
        if (options.requireAge14 && !age14Confirmed) {
            throw new LegalConsentError('만 14세 이상임을 확인해야 회원가입을 신청할 수 있습니다.', 'AGE_14_CONFIRMATION_REQUIRED');
        }

        return {
            context: normalizedContext,
            age14Confirmed,
            acceptedDocuments,
        };
    }

    async function insertAcceptanceEvents(runner, options = {}) {
        const documents = Array.isArray(options.acceptedDocuments) ? options.acceptedDocuments : [];
        if (!runner || typeof runner.query !== 'function') throw new Error('동의 증적 저장용 DB 연결이 필요합니다.');
        if (!documents.length) throw new LegalConsentError('저장할 동의 문서가 없습니다.', 'LEGAL_ACCEPTANCE_EMPTY');

        for (const document of documents) {
            await runner.query(
                `INSERT INTO wgs_legal_acceptance_events
                 (document_id, signup_request_id, user_id, event_type, context,
                  document_version, document_sha256, age_14_confirmed, accepted_via,
                  request_id, occurred_at, retention_until)
                 VALUES (?, ?, ?, 'ACCEPTED', ?, ?, ?, ?, 'web', ?, NOW(), ?)`,
                [
                    document.id,
                    options.signupRequestId || null,
                    options.userId || null,
                    document.context,
                    document.version,
                    document.sha256,
                    options.age14Confirmed ? 1 : null,
                    crypto.randomUUID(),
                    options.retentionUntil || null,
                ]
            );
        }
    }

    async function getSignupEvidenceStatus(runner, signupRequestId) {
        const documents = await getActiveDocuments('signup', runner);
        const requiredDocuments = documents.filter((document) => SIGNUP_REQUIRED_CODES.includes(document.documentCode));
        if (requiredDocuments.length !== SIGNUP_REQUIRED_CODES.length) {
            return { complete: false, acceptedCount: 0, requiredCount: SIGNUP_REQUIRED_CODES.length };
        }
        const [rows] = await runner.query(
            `SELECT COUNT(DISTINCT d.document_code) AS accepted_count,
                    MAX(CASE WHEN e.age_14_confirmed = 1 THEN 1 ELSE 0 END) AS age_confirmed
             FROM wgs_legal_acceptance_events e
             INNER JOIN wgs_legal_documents d ON d.id = e.document_id
             WHERE e.signup_request_id = ?
               AND e.event_type = 'ACCEPTED'
               AND d.is_active = 1
               AND d.context = 'signup'
               AND d.document_code IN ('TERMS', 'SIGNUP_PRIVACY')
               AND e.document_version = d.version
               AND e.document_sha256 = d.content_sha256`,
            [signupRequestId]
        );
        const acceptedCount = Number(rows[0]?.accepted_count || 0);
        const ageConfirmed = Number(rows[0]?.age_confirmed || 0) === 1;
        return {
            complete: acceptedCount === requiredDocuments.length && ageConfirmed,
            acceptedCount,
            requiredCount: requiredDocuments.length,
            ageConfirmed,
        };
    }

    async function getUserEvidenceStatus(userId, runner = pool) {
        await ensureSchema();
        const normalizedUserId = String(userId || '').trim();
        if (!normalizedUserId) {
            return {
                complete: false,
                acceptedCount: 0,
                requiredCount: SIGNUP_REQUIRED_CODES.length,
                ageConfirmed: false,
                missingDocumentCodes: [...SIGNUP_REQUIRED_CODES],
            };
        }

        const documents = await getActiveDocuments('signup', runner);
        const requiredDocuments = documents.filter((document) => SIGNUP_REQUIRED_CODES.includes(document.documentCode));
        if (requiredDocuments.length !== SIGNUP_REQUIRED_CODES.length) {
            return {
                complete: false,
                acceptedCount: 0,
                requiredCount: SIGNUP_REQUIRED_CODES.length,
                ageConfirmed: false,
                missingDocumentCodes: [...SIGNUP_REQUIRED_CODES],
            };
        }

        const [rows] = await runner.query(
            `SELECT DISTINCT d.document_code, e.age_14_confirmed
             FROM wgs_legal_acceptance_events e
             INNER JOIN wgs_legal_documents d ON d.id = e.document_id
             WHERE e.user_id = ?
               AND e.event_type = 'ACCEPTED'
               AND d.is_active = 1
               AND d.context = 'signup'
               AND d.document_code IN ('TERMS', 'SIGNUP_PRIVACY')
               AND e.document_version = d.version
               AND e.document_sha256 = d.content_sha256`,
            [normalizedUserId]
        );
        const acceptedCodes = new Set(rows.map((row) => row.document_code));
        const ageConfirmed = rows.some((row) => Number(row.age_14_confirmed || 0) === 1);
        const missingDocumentCodes = requiredDocuments
            .map((document) => document.documentCode)
            .filter((code) => !acceptedCodes.has(code));

        return {
            complete: missingDocumentCodes.length === 0 && ageConfirmed,
            acceptedCount: acceptedCodes.size,
            requiredCount: requiredDocuments.length,
            ageConfirmed,
            missingDocumentCodes,
        };
    }

    async function linkSignupAcceptancesToUser(runner, signupRequestId, userId) {
        await runner.query(
            `UPDATE wgs_legal_acceptance_events
             SET user_id = ?, retention_until = NULL
             WHERE signup_request_id = ? AND event_type = 'ACCEPTED'`,
            [userId, signupRequestId]
        );
    }

    async function markSignupEvidenceForRetention(runner, signupRequestId) {
        await runner.query(
            `UPDATE wgs_legal_acceptance_events
             SET retention_until = DATE_ADD(NOW(), INTERVAL ? YEAR)
             WHERE signup_request_id = ? AND retention_until IS NULL`,
            [evidenceRetentionYears, signupRequestId]
        );
    }

    async function markUserEvidenceForRetention(runner, userId) {
        await runner.query(
            `UPDATE wgs_legal_acceptance_events
             SET retention_until = DATE_ADD(NOW(), INTERVAL ? YEAR)
             WHERE user_id = ? AND retention_until IS NULL`,
            [evidenceRetentionYears, userId]
        );
    }

    function signupRetentionSql() {
        return `DATE_ADD(NOW(), INTERVAL ${signupRetentionDays} DAY)`;
    }

    return {
        ensureSchema,
        getActiveDocuments,
        validateAcceptanceBundle,
        insertAcceptanceEvents,
        getSignupEvidenceStatus,
        getUserEvidenceStatus,
        linkSignupAcceptancesToUser,
        markSignupEvidenceForRetention,
        markUserEvidenceForRetention,
        purgeExpiredRecords,
        signupRetentionDays,
        signupRetentionSql,
        evidenceRetentionYears,
    };
}

module.exports = {
    DEFAULT_EVIDENCE_RETENTION_YEARS,
    DEFAULT_SIGNUP_STAGING_RETENTION_DAYS,
    FORTUNE_STORAGE_CODE,
    LegalConsentError,
    createLegalConsentService,
    hashDocumentContent,
    normalizeAcceptanceList,
};
