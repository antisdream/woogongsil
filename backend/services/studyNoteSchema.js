'use strict';
const { runtimeSchemaGate } = require('./schemaRuntime');

function createStudyNoteSchemaChecker(options = {}) {
    const pool = options.pool;

    if (!pool || typeof pool.query !== 'function') {
        throw new Error('createStudyNoteSchemaChecker requires a MySQL pool.');
    }

    async function columnExists(tableName, columnName) {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt
               FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND COLUMN_NAME = ?`,
            [tableName, columnName]
        );
        return Number(rows?.[0]?.cnt || 0) > 0;
    }

    async function ensureStudyNoteSchema() {
        const runtime = runtimeSchemaGate(pool); if (runtime) return runtime;
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS wgs_study_folders (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    ownerId VARCHAR(50) NOT NULL,
                    parentId BIGINT UNSIGNED NULL,
                    name VARCHAR(120) NOT NULL,
                    sortOrder INT NOT NULL DEFAULT 0,
                    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    INDEX idx_wgs_study_folders_owner (ownerId),
                    INDEX idx_wgs_study_folders_parent (parentId)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS wgs_study_documents (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    ownerId VARCHAR(50) NOT NULL,
                    folderId BIGINT UNSIGNED NULL,
                    title VARCHAR(255) NOT NULL,
                    content LONGTEXT NULL,
                    contentJson LONGTEXT NULL,
                    visibility VARCHAR(20) NOT NULL DEFAULT 'private',
                    docType VARCHAR(40) NOT NULL DEFAULT 'note',
                    sortOrder INT NOT NULL DEFAULT 0,
                    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    INDEX idx_wgs_study_documents_owner (ownerId),
                    INDEX idx_wgs_study_documents_folder (folderId),
                    INDEX idx_wgs_study_documents_visibility (visibility),
                    INDEX idx_wgs_study_documents_doc_type (docType)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            if (!(await columnExists('wgs_study_documents', 'sortOrder'))) {
                await pool.query(`ALTER TABLE wgs_study_documents ADD COLUMN sortOrder INT NOT NULL DEFAULT 0 AFTER docType`);
            }

            await pool.query(`
                CREATE TABLE IF NOT EXISTS wgs_study_document_wrong_refs (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    documentId BIGINT UNSIGNED NOT NULL,
                    ownerId VARCHAR(50) NOT NULL,
                    sourceType VARCHAR(40) NOT NULL,
                    sourceId VARCHAR(80) NOT NULL,
                    sourcePayload LONGTEXT NULL,
                    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    INDEX idx_wgs_study_wrong_refs_document (documentId),
                    INDEX idx_wgs_study_wrong_refs_owner (ownerId),
                    INDEX idx_wgs_study_wrong_refs_source (sourceType, sourceId)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS wgs_study_document_drafts (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    ownerId VARCHAR(50) NOT NULL,
                    documentId BIGINT UNSIGNED NULL,
                    folderId BIGINT UNSIGNED NULL,
                    title VARCHAR(255) NOT NULL,
                    content LONGTEXT NULL,
                    contentJson LONGTEXT NULL,
                    visibility VARCHAR(20) NOT NULL DEFAULT 'private',
                    docType VARCHAR(40) NOT NULL DEFAULT 'note',
                    wrongRefsJson LONGTEXT NULL,
                    summary VARCHAR(500) NULL,
                    saveReason VARCHAR(20) NOT NULL DEFAULT 'manual',
                    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    INDEX idx_wgs_study_drafts_owner_updated (ownerId, updatedAt),
                    INDEX idx_wgs_study_drafts_document (documentId)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (error) {
            console.error('[학습노트] 스키마 점검 오류:', error.message);
        }
    }

    return { ensureStudyNoteSchema };
}

module.exports = {
    createStudyNoteSchemaChecker,
};
