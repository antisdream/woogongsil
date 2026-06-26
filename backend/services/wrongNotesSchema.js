'use strict';

function createWrongNotesSchemaChecker({ pool } = {}) {
    if (!pool) throw new Error('createWrongNotesSchemaChecker requires mysql pool');

async function ensureWrongNotesSchema() {
    try {
        // 테이블이 아예 없는 경우를 대비한 안전 생성 코드.
        // 이미 존재하는 테이블은 변경하지 않는다.
        await pool.promise().query(`CREATE TABLE IF NOT EXISTS wgs_wrong_notes (
                id INT NOT NULL AUTO_INCREMENT,
                userId VARCHAR(50) NOT NULL,
                question_id INT NOT NULL,
                source VARCHAR(40) NOT NULL,
                year INT NULL,
                session INT NULL,
                subject VARCHAR(255) NULL,
                user_answer TEXT NULL,
                savedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            )
        `);

        const [columns] = await pool.promise().query(`SHOW COLUMNS FROM wgs_wrong_notes`);
        const columnNames = new Set(columns.map((col) => col.Field));

        // 예전 스키마에는 source/year/session/subject/savedAt 중 일부가 없을 수 있어서 하나씩 확인 후 추가합니다.
        // ALTER는 없는 컬럼에만 실행되므로 기존 데이터는 유지됩니다.
        if (!columnNames.has('source')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'random' AFTER question_id`);
        }
        if (!columnNames.has('year')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN year INT NULL AFTER source`);
        }
        if (!columnNames.has('session')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN session INT NULL AFTER year`);
        }
        if (!columnNames.has('subject')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN subject VARCHAR(255) NULL AFTER session`);
        }
        if (!columnNames.has('user_answer')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN user_answer TEXT NULL AFTER subject`);
        }
        if (!columnNames.has('savedAt')) {
            await pool.promise().query(`ALTER TABLE wgs_wrong_notes ADD COLUMN savedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP`);
        }

        // Duplicate-prevention indexes are optional compatibility helpers.
        // 이미 같은 이름의 인덱스가 있으면 MySQL에서 에러가 나므로 무시합니다.
        try {
            await pool.promise().query(`CREATE INDEX idx_wgs_wrong_notes_user_source_qid ON wgs_wrong_notes (userId, source, question_id)`);
        } catch (indexErr) {
            // ER_DUP_KEYNAME: 이미 인덱스가 있는 정상 상황
            if (indexErr.code !== 'ER_DUP_KEYNAME') {
                console.warn('wgs_wrong_notes 인덱스 확인 경고:', indexErr.message);
            }
        }

        console.log('OK: wgs_wrong_notes schema checked');
    } catch (err) {
        // 스키마 보정 실패가 있어도 서버 전체가 중단되지 않도록 경고만 출력합니다.
        // 저장 과정에서 오류가 발생하면 터미널 로그를 기준으로 스키마를 확인합니다.
        console.warn('wgs_wrong_notes schema check warning:', err.message);
    }
}


    return {
        ensureWrongNotesSchema
    };
}

module.exports = {
    createWrongNotesSchemaChecker
};
