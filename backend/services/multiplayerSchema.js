'use strict';

async function safeQuery(pool, sql) {
    try {
        await pool.query(sql);
    } catch (error) {
        // 운영 중인 서버에서 이미 인덱스가 없거나 컬럼 구조가 조금 달라도
        // 멀티플레이 외 기존 기능이 중단되지 않도록 경고만 남긴다.
        console.warn('[multiplayer schema warning]', error.message);
    }
}

async function multiplayerColumnExists(pool, tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );

    return Number(rows?.[0]?.cnt || 0) >0;
}

async function multiplayerIndexExists(pool, tableName, indexName) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt
           FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND INDEX_NAME = ?`,
        [tableName, indexName]
    );

    return Number(rows?.[0]?.cnt || 0) >0;
}

async function ensureMultiplayerIndex(pool, tableName, indexName, createSql) {
    if (await multiplayerIndexExists(pool, tableName, indexName)) {
        return;
    }

    await safeQuery(pool, createSql);
}

async function ensureMultiplayerSchema(pool) {
    // DB 테이블 자동 생성/보정
    // ------------------------------------------------------------
    // 기존 DB를 삭제하지 않고 멀티플레이 테이블만 생성합니다.
    // 이전 버전 패치에서 room_code UNIQUE가 들어갔을 수 있는데,
    // 방 번호는 1~999 범위에서 관리하며 종료된 방 번호를 다시 사용할 수 있어야 합니다.
    // 따라서 활성 방 중복은 코드에서 검사하고, DB UNIQUE는 제거합니다.
    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_multiplayer_rooms (
            id BIGINT NOT NULL AUTO_INCREMENT,
            room_code VARCHAR(10) NOT NULL,
            room_password VARCHAR(30) NOT NULL,
            host_user_id VARCHAR(50) NOT NULL,
            host_user_name VARCHAR(100) NULL,
            exam_type VARCHAR(20) NOT NULL DEFAULT 'written',
            year INT NOT NULL DEFAULT 0,
            session INT NOT NULL DEFAULT 0,
            max_players INT NOT NULL DEFAULT 5,
            status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME NULL,
            finished_at DATETIME NULL,
            PRIMARY KEY (id),
            KEY idx_wgs_mp_rooms_code_status (room_code, status),
            KEY idx_wgs_mp_rooms_status (status),
            KEY idx_wgs_mp_rooms_host (host_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    if (await multiplayerIndexExists(pool, 'wgs_multiplayer_rooms', 'uq_wgs_mp_rooms_code')) {
        await safeQuery(pool, `ALTER TABLE wgs_multiplayer_rooms DROP INDEX uq_wgs_mp_rooms_code`);
    }
    await safeQuery(pool, `ALTER TABLE wgs_multiplayer_rooms MODIFY COLUMN year INT NOT NULL DEFAULT 0`);
    await safeQuery(pool, `ALTER TABLE wgs_multiplayer_rooms MODIFY COLUMN session INT NOT NULL DEFAULT 0`);
    await ensureMultiplayerIndex(
        pool,
        'wgs_multiplayer_rooms',
        'idx_wgs_mp_rooms_code_status',
        `ALTER TABLE wgs_multiplayer_rooms ADD INDEX idx_wgs_mp_rooms_code_status (room_code, status)`
    );

    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_multiplayer_room_members (
            id BIGINT NOT NULL AUTO_INCREMENT,
            room_id BIGINT NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            user_name VARCHAR(100) NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
            status VARCHAR(20) NOT NULL DEFAULT 'JOINED',
            joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            submitted_at DATETIME NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wgs_mp_member_room_user (room_id, user_id),
            KEY idx_wgs_mp_member_room (room_id),
            CONSTRAINT fk_wgs_mp_member_room
                FOREIGN KEY (room_id) REFERENCES wgs_multiplayer_rooms(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    if (!(await multiplayerColumnExists(pool, 'wgs_multiplayer_rooms', 'exam_type'))) {
        await safeQuery(pool, `ALTER TABLE wgs_multiplayer_rooms ADD COLUMN exam_type VARCHAR(20) NOT NULL DEFAULT 'written' AFTER host_user_name`);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_multiplayer_room_questions (
            id BIGINT NOT NULL AUTO_INCREMENT,
            room_id BIGINT NOT NULL,
            question_id INT NOT NULL,
            question_source VARCHAR(30) NOT NULL DEFAULT 'written',
            question_order INT NOT NULL,
            info_id VARCHAR(50) NULL,
            subject_no INT NULL,
            subject_name VARCHAR(255) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wgs_mp_room_question (room_id, question_id),
            KEY idx_wgs_mp_room_question_order (room_id, question_order),
            CONSTRAINT fk_wgs_mp_question_room
                FOREIGN KEY (room_id) REFERENCES wgs_multiplayer_rooms(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    if (!(await multiplayerColumnExists(pool, 'wgs_multiplayer_room_questions', 'subject_no'))) {
        await safeQuery(pool, `ALTER TABLE wgs_multiplayer_room_questions ADD COLUMN subject_no INT NULL AFTER info_id`);
    }

    if (!(await multiplayerColumnExists(pool, 'wgs_multiplayer_room_questions', 'question_source'))) {
        await safeQuery(pool, `ALTER TABLE wgs_multiplayer_room_questions ADD COLUMN question_source VARCHAR(30) NOT NULL DEFAULT 'written' AFTER question_id`);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_multiplayer_answers (
            id BIGINT NOT NULL AUTO_INCREMENT,
            room_id BIGINT NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            question_id INT NOT NULL,
            selected_answer TEXT NULL,
            is_correct TINYINT(1) NOT NULL DEFAULT 0,
            answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wgs_mp_answer (room_id, user_id, question_id),
            KEY idx_wgs_mp_answer_room_user (room_id, user_id),
            CONSTRAINT fk_wgs_mp_answer_room
                FOREIGN KEY (room_id) REFERENCES wgs_multiplayer_rooms(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await safeQuery(pool, `ALTER TABLE wgs_multiplayer_answers MODIFY COLUMN selected_answer TEXT NULL`);

    // 멀티플레이 오답 다시풀기에서 사용자가 삭제한 오답을 숨기기 위한 별도 테이블입니다.
    // 시험 결과와 답안 원본은 보존하고, 오답 풀이 목록에서만 제외하기 위해 사용합니다.
    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_multiplayer_wrong_hides (
            id BIGINT NOT NULL AUTO_INCREMENT,
            room_id BIGINT NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            question_id INT NOT NULL,
            deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wgs_mp_wrong_hide (room_id, user_id, question_id),
            KEY idx_wgs_mp_wrong_hide_user_room (user_id, room_id),
            CONSTRAINT fk_wgs_mp_wrong_hide_room
                FOREIGN KEY (room_id) REFERENCES wgs_multiplayer_rooms(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_multiplayer_results (
            id BIGINT NOT NULL AUTO_INCREMENT,
            room_id BIGINT NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            user_name VARCHAR(100) NULL,
            correct_count INT NOT NULL DEFAULT 0,
            total_count INT NOT NULL DEFAULT 0,
            total_score INT NOT NULL DEFAULT 0,
            average_score DECIMAL(5,2) NOT NULL DEFAULT 0,
            subject_scores_json JSON NULL,
            is_pass TINYINT(1) NOT NULL DEFAULT 0,
            submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wgs_mp_result (room_id, user_id),
            KEY idx_wgs_mp_result_room_score (room_id, total_score),
            CONSTRAINT fk_wgs_mp_result_room
                FOREIGN KEY (room_id) REFERENCES wgs_multiplayer_rooms(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}


module.exports = {
    ensureMultiplayerSchema
};
