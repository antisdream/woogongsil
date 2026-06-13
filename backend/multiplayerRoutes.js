// 멀티플레이 시험방, 결과 기록, 오답 API를 제공합니다.
const express = require('express');

// multiplayerRoutes.js
// 역할:
// 1. 필기 기출문제 멀티플레이 방 만들기/입장/대기/시작/문제조회/제출/결과조회 API를 담당합니다.
// 2. 기존 /api/past-exam, /api/random-question, /api/rankings 등 기존 기능은 변경하지 않는다.
// 3. 멀티플레이는 /api/multiplayer 아래에서만 동작합니다.
// 4. 방장이 방을 만들 때는 연도/회차를 고르지 않고, 서버가 과목별 20문제씩 랜덤 추첨해서 100문제 CBT를 만든다.
// 5. 같은 방 참여자는 wgs_multiplayer_room_questions에 저장된 동일한 100문제를 본다.

const ROOM_STATUSES = {
    WAITING: 'WAITING',
    PLAYING: 'PLAYING',
    FINISHED: 'FINISHED',
    CANCELLED: 'CANCELLED'
};

const MEMBER_STATUSES = {
    JOINED: 'JOINED',       // 대기방에 입장했지만 아직 준비완료를 누르지 않은 상태
    READY: 'READY',         // 일반 참여자가 준비완료 버튼을 누른 상태
    PLAYING: 'PLAYING',     // 시험 진행 중
    SUBMITTED: 'SUBMITTED', // 답안 제출 완료
    LEFT: ' LEFT'            // 대기방 나가기 또는 내보내기 처리된 상태
};

const SUBJECT_NAMES = [
    '1과목 : 소프트웨어 설계',
    '2과목 : 소프트웨어 개발',
    '3과목 : 데이터베이스 구축',
    '4과목 : 프로그래밍 언어 활용',
    '5과목 : 정보시스템 구축 관리'
];

// 방 생성 시 필기/실기를 명확히 분리하기 위한 공통 상수다.
const MP_EXAM_TYPES = Object.freeze({ WRITTEN: 'written', IPEP: 'ipep' });
function normalizeMpExamType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (['ipep', 'practical', '실기', '실기문제', '정보처리기사실기'].includes(raw)) return MP_EXAM_TYPES.IPEP;
    return MP_EXAM_TYPES.WRITTEN;
}
function getMpExamTypeLabel(value) { return normalizeMpExamType(value) === MP_EXAM_TYPES.IPEP ? '실기 기출문제' : '필기 기출문제'; }
function isIpepExam(value) { return normalizeMpExamType(value) === MP_EXAM_TYPES.IPEP; }
function normalizeMpAnswer(value) { return String(value ?? '').replace(/\s+/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase(); }
function parseMpAliasList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
    } catch (error) {
        // answer_aliases_json이 JSON이 아닌 쉼표 문자열이어도 채점 가능하게 처리합니다.
    }
    return String(value).split(/[|,]/).map((item) => item.trim()).filter(Boolean);
}
function isIpepAnswerCorrect(selectedAnswer, question) {
    const userAnswer = normalizeMpAnswer(selectedAnswer);
    if (!userAnswer) return false;
    const candidates = [question.answer, question.correct_label, question.answer_raw, question.correct_answer, ...parseMpAliasList(question.answer_aliases_json), ...parseMpAliasList(question.answer_keywords)].map(normalizeMpAnswer).filter(Boolean);
    return candidates.some((answer) => answer === userAnswer);
}


// 멀티플레이 랜덤 출제 시 같은 내용의 문제가 반복 노출되지 않도록
// 질문/보기/정답을 정규화한 뒤, 먼저 뽑힌 문제를 살리고 뒤에 나온 유사 문제는 건너뜁니다.
function normalizeMultiplayerText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, ' ')
        .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, '');
}

function makeNgramSet(value, size = 3) {
    const text = normalizeMultiplayerText(value);
    const result = new Set();
    if (!text) return result;
    if (text.length <= size) {
        result.add(text);
        return result;
    }
    for (let i = 0; i <= text.length - size; i += 1) {
        result.add(text.slice(i, i + size));
    }
    return result;
}

function ngramSimilarity(left, right) {
    const a = makeNgramSet(left);
    const b = makeNgramSet(right);
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const item of a) {
        if (b.has(item)) intersection += 1;
    }
    return (intersection * 2) / (a.size + b.size);
}

function buildWrittenDuplicateInfo(row) {
    const question = normalizeMultiplayerText(row.question);
    const combined = normalizeMultiplayerText([
        row.question,
        row.opt1,
        row.opt2,
        row.opt3,
        row.opt4,
        row.question_img,
    ].filter(Boolean).join(' '));
    return { question, combined };
}

function buildPracticalDuplicateInfo(row) {
    const question = normalizeMultiplayerText(row.question_text);
    const answer = normalizeMultiplayerText(row.answer_raw);
    const combined = normalizeMultiplayerText([
        row.question_text,
        row.answer_raw,
        row.question_img,
        row.image_path,
    ].filter(Boolean).join(' '));
    return { question, answer, combined };
}

function isWrittenDuplicate(current, selectedInfos) {
    for (const previous of selectedInfos) {
        if (current.combined && previous.combined && current.combined === previous.combined) return true;
        if (current.question && previous.question && current.question === previous.question) return true;

        // 너무 짧은 문장은 우연히 비슷해질 수 있어 충분한 길이의 문장만 유사도 예외처리를 적용합니다.
        if (current.combined.length >= 35 && previous.combined.length >= 35 && ngramSimilarity(current.combined, previous.combined) >= 0.94) return true;
        if (current.question.length >= 28 && previous.question.length >= 28 && ngramSimilarity(current.question, previous.question) >= 0.94) return true;
    }
    return false;
}

function isPracticalDuplicate(current, selectedInfos) {
    for (const previous of selectedInfos) {
        if (current.combined && previous.combined && current.combined === previous.combined) return true;
        if (current.question && previous.question && current.answer && previous.answer && current.question === previous.question && current.answer === previous.answer) return true;

        const sameAnswer = current.answer && previous.answer && (current.answer === previous.answer || ngramSimilarity(current.answer, previous.answer) >= 0.96);
        const similarQuestion = current.question.length >= 20 && previous.question.length >= 20 && ngramSimilarity(current.question, previous.question) >= 0.92;
        if (sameAnswer && similarQuestion) return true;
    }
    return false;
}

function pickUniqueMultiplayerRows(rows, targetCount, buildInfo, isDuplicate) {
    const selectedRows = [];
    const selectedInfos = [];

    for (const row of rows) {
        const info = buildInfo(row);
        const hasText = Object.values(info).some((value) => value && value.length >0);
        if (!hasText) continue;
        if (isDuplicate(info, selectedInfos)) continue;

        selectedRows.push(row);
        selectedInfos.push(info);
        if (selectedRows.length >= targetCount) break;
    }

    return selectedRows;
}


// questions.subject 값이 숫자(1~5)일 수도 있고, 과목명 문자열일 수도 있어서
// SQL에서 안전하게 1~5 과목 번호로 변환하기 위한 CASE 문입니다.
const SUBJECT_NO_SQL = `CASE
        /*
         * 프로젝트 DB의 필기 questions.subject 매핑
         *  10 : 1과목 소프트웨어 설계
         *  11 : 2과목 소프트웨어 개발
         *  12 : 3과목 데이터베이스 구축
         *  13 : 4과목 프로그래밍 언어 활용
         *  14 : 5과목 정보시스템 구축 관리합니다
         *
         * 이전 v3 오류 원인:
         *  q.subject LIKE '1%' 조건 때문에 10, 11, 12, 13, 14가 전부 1과목으로 계산되었다.
         *  그래서 화면에는 1과목 1500개, 2~5과목 0개처럼 표시되고 시험 시작 시 2과목 0문제 오류가 났다.
         *
         * 현재 동작:
         *  10~14를 가장 먼저 정확히 1~5과목으로 변환합니다.
         *  그 다음 혹시 다른 환경에서 1~5 또는 과목명 문자열로 들어온 경우만 보정합니다.
         *  마지막 안전장치로 info_id 1~100 범위를 20문제 단위로 나눠 과목을 추정합니다.
         */
        WHEN CAST(q.subject AS UNSIGNED) BETWEEN 10 AND 14 THEN CAST(q.subject AS UNSIGNED) - 9
        WHEN CAST(q.subject AS UNSIGNED) BETWEEN 1 AND 5 THEN CAST(q.subject AS UNSIGNED)
        WHEN CAST(q.subject AS CHAR) LIKE '%소프트웨어 설계%'THEN 1
        WHEN CAST(q.subject AS CHAR) LIKE '%소프트웨어 개발%'THEN 2
        WHEN CAST(q.subject AS CHAR) LIKE '%데이터베이스%'THEN 3
        WHEN CAST(q.subject AS CHAR) LIKE '%프로그래밍%'THEN 4
        WHEN CAST(q.subject AS CHAR) LIKE '%정보시스템%'THEN 5
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 1 AND 20 THEN 1
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 21 AND 40 THEN 2
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 41 AND 60 THEN 3
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 61 AND 80 THEN 4
        WHEN CAST(q.info_id AS UNSIGNED) BETWEEN 81 AND 100 THEN 5
        ELSE NULL
    END
`;

function normalizeRoomCode(value) {
    return String(value || '').trim().replace(/[^0-9]/g, '').slice(0, 3);
}

function normalizePassword(value) {
    return String(value || '').trim().replace(/[^0-9]/g, '').slice(0, 6);
}

function normalizeInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function getSocketRoomName(roomCode) {
    return `wgs-written-multiplayer-room-${roomCode}`;
}

function isValidRoomCode(roomCode) {
    const n = Number(roomCode);
    return /^\d{1,3}$/.test(String(roomCode || '')) && n >= 1 && n <= 999;
}

function isValidRoomPassword(password) {
    const n = Number(password);
    return /^\d{1,6}$/.test(String(password || '')) && n >= 1 && n <= 999999;
}

function getSubjectNameByNo(subjectNo) {
    return SUBJECT_NAMES[Math.min(4, Math.max(0, Number(subjectNo || 1) - 1))];
}

function makeQuestionImageWebPath(imageName) {
    // 필기 보기 이미지 경로 보정
    // ------------------------------------------------------------
    // 필기 문제의 <보기> 이미지는 questions.question_img에 저장되어 있고,
    // 기존 기출/문제은행 화면은 public/question_image 폴더에서 렌더링합니다.
    // HTML/PDF용 오답 정리도 같은 경로를 쓰도록 웹 경로를 함께 내려줍니다.
    const value = String(imageName || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
    return `/question_image/${value}`;
}

function buildWrittenQuestionImageFields(row) {
    // 보기 이미지 필드 호환 처리합니다
    // ------------------------------------------------------------
    // 현재 필기 DB는 question_img만 가지고 있지만, 프론트 HTML 생성부가
    // choice_img_stem / choice_img_file / choice_img_path 계열도 같이 받을 수
    // 있게 별칭을 만들어줍니다. 실기 테이블은 변경하지 않는다.
    const fileName = String(row.question_img || row.choice_img_file || '').trim();
    const webPath = makeQuestionImageWebPath(row.choice_img_path || fileName);
    const stem = String(row.choice_img_stem || fileName.replace(/\.[^/.]+$/, '') || '').trim();

    return {
        question_img: fileName,
        questionImg: fileName,
        choice_img_stem: stem,
        choice_img_file: fileName,
        choice_img_path: webPath,
        choiceImgPath: webPath,
        questionImgPath: webPath,
        imagePath: webPath,
        image: webPath
    };
}

function sanitizeQuestionForClient(row, includeAnswer = false) {
    // 시험 중에는 정답/해설을 숨기고, 제출 후에만 포함합니다.
    const questionSource = row.question_source || row.question_kind || MP_EXAM_TYPES.WRITTEN;
    const item = {
        question_id: row.question_id,
        question_order: Number(row.question_order || 0),
        cbtNo: Number(row.question_order || 0),
        questionSource,
        questionKind: questionSource,
        question_text: row.question_text || '',
        ...(questionSource === MP_EXAM_TYPES.IPEP ? {} : buildWrittenQuestionImageFields(row)),
        option_1: row.option_1 || '',
        option_2: row.option_2 || '',
        option_3: row.option_3 || '',
        option_4: row.option_4 || '',
        options: [row.option_1, row.option_2, row.option_3, row.option_4].map((v) => v || ''),
        sourceLabel: includeAnswer
            ? (row.source_label || (questionSource === MP_EXAM_TYPES.IPEP
                ? `${row.year || ''}년 ${row.session || row.round || ''}회 실기 ${row.info_id || row.question_no || ''}번`
                : `${row.year || ''}년 ${row.session || ''}회 ${row.subject_name || ''} ${row.info_id || ''}번`))
            : '랜덤 CBT 문제',
        // 오류신고 메일에는 랜덤 출제 문제의 실제 출처가 필요하므로 정답과 무관한 식별 메타데이터만 항상 내려줍니다.
        report_source_label: (row.source_label || (questionSource === MP_EXAM_TYPES.IPEP
            ? `${row.year || ''}년 ${row.session || row.round || ''}회 실기 ${row.info_id || row.question_no || ''}번`
            : `${row.year || ''}년 ${row.session || ''}회 ${row.subject_name || ''} ${row.info_id || ''}번`)).trim(),
        exam_year: row.year || row.exam_year || row.source_year || null,
        exam_session: row.session || row.round || row.exam_session || row.source_session || null,
        source_year: row.year || row.exam_year || row.source_year || null,
        source_session: row.session || row.round || row.exam_session || row.source_session || null,
        subject_no: Number(row.subject_no || (questionSource === MP_EXAM_TYPES.IPEP ? 6 : Math.ceil(Number(row.question_order || 1) / 20))),
        subject_name: row.subject_name || (questionSource === MP_EXAM_TYPES.IPEP ? '정보처리기사 실기' : getSubjectNameByNo(Math.ceil(Number(row.question_order || 1) / 20))),
        question_no: row.question_no || row.info_id || null,
        info_id: row.info_id || null,
        imagePath: questionSource === MP_EXAM_TYPES.IPEP ? (row.image_path || '') : (row.imagePath || row.image_path || '')
    };

    if (includeAnswer) {
        item.info_id = row.info_id;
        item.subject_id = row.subject_id;
        item.subject_no = Number(row.subject_no || (questionSource === MP_EXAM_TYPES.IPEP ? 6 : Math.ceil(Number(row.question_order || 1) / 20)));
        item.subject_name = row.subject_name || (questionSource === MP_EXAM_TYPES.IPEP ? '정보처리기사 실기' : getSubjectNameByNo(Math.ceil(Number(row.question_order || 1) / 20)));
        item.year = row.year;
        item.session = row.session || row.round;
        item.correct_label = row.correct_label;
        item.correct_answer = row.correct_label;
        item.answer = row.correct_label;
        item.explanation = row.explanation || '';
        item.explanation_text = row.explanation || '';
        item.explanation_img_path = row.explanation_img_path || row.explanation_image || '';
        item.explanationImgPath = row.explanation_img_path || row.explanation_image || '';
        item.answer_aliases_json = row.answer_aliases_json || null;
    }

    return item;
}

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

function createMultiplayerRouter({ pool, io = null } = {}) {
    const router = express.Router();

    if (!pool) throw new Error('multiplayerRoutes requires mysql pool');

    ensureMultiplayerSchema(pool)
        .then(() => console.log('OK: written multiplayer schema checked'))
        .catch((err) => console.warn('WARN: written multiplayer schema check failed:', err.message));

    async function getSessionUserForRequest(req) {
        // Express 미들웨어/일반 라우터 함수가 함께 쓰는 세션 조회 헬퍼
        // req.query, req.body, 헤더 모두 기존 방식 그대로 허용합니다.
        const source = req.method === 'GET'? req.query : req.body;
        const id = String(source.id || source.userId || req.headers['x-user-id'] || '').trim();
        const sessionToken = String(source.sessionToken || req.headers['x-session-token'] || '').trim();

        if (!id || !sessionToken) return null;

        const [rows] = await pool.query(
            `SELECT id, name, sessionToken FROM wgs_users WHERE id = ? LIMIT 1`,
            [id]
        );
        const user = rows[0];

        if (!user || !user.sessionToken || user.sessionToken !== sessionToken) return null;

        return { id: String(user.id), name: user.name || String(user.id), sessionToken };
    }

    async function requireSessionUser(req, res, next) {
        try {
            const sessionUser = await getSessionUserForRequest(req);

            if (!sessionUser) {
                return res.status(401).json({ success: false, reason: 'session_expired', msg: '로그인이 필요합니다.' });
            }

            req.wgsUser = sessionUser;
            return next();
        } catch (error) {
            console.error('[multiplayer] session check error:', error);
            return res.status(500).json({ success: false, msg: '세션 확인 중 오류가 발생했습니다.' });
        }
    }

    async function requireSessionUserForHandler(req) {
        // 삭제 API처럼 미들웨어 체인 밖에서 인증이 필요한 곳 전용
        // 기존 requireSessionUser(req) 직접 호출 때문에 next is not a function 오류가 발생했으므로 분리합니다.
        const sessionUser = await getSessionUserForRequest(req);
        if (!sessionUser) {
            const authError = new Error('로그인이 필요합니다.');
            authError.statusCode = 401;
            throw authError;
        }
        return sessionUser;
    }

    async function getActiveRoomByCode(roomCode) {
        const [rows] = await pool.query(
            `SELECT *
             FROM wgs_multiplayer_rooms
             WHERE room_code = ?
               AND status IN ('WAITING', 'PLAYING')
             ORDER BY id DESC
             LIMIT 1`,
            [roomCode]
        );
        return rows[0] || null;
    }

    async function getRoomByCode(roomCode) {
        const [rows] = await pool.query(
            `SELECT *
             FROM wgs_multiplayer_rooms
             WHERE room_code = ?
             ORDER BY FIELD(status, 'WAITING', 'PLAYING', 'FINISHED', 'CANCELLED'), id DESC
             LIMIT 1`,
            [roomCode]
        );
        return rows[0] || null;
    }

    async function getRoomDetail(roomCode) {
        const room = await getRoomByCode(roomCode);
        if (!room) return null;

        const [members] = await pool.query(
            `SELECT user_id, user_name, role, status, joined_at, submitted_at
             FROM wgs_multiplayer_room_members
             WHERE room_id = ?
               AND status <> ' LEFT' ORDER BY role = 'HOST'DESC, joined_at ASC, id ASC`,
            [room.id]
        );

        const [resultRows] = await pool.query(
            `SELECT user_id, total_score, average_score, correct_count, total_count, is_pass, submitted_at
             FROM wgs_multiplayer_results
             WHERE room_id = ?
             ORDER BY total_score DESC, correct_count DESC, submitted_at ASC`,
            [room.id]
        );

        const activeMembers = members.filter((m) => m.status !== MEMBER_STATUSES.LEFT);
        const normalMembers = activeMembers.filter((m) => m.role !== 'HOST');
        const readyMembers = normalMembers.filter((m) => m.status === MEMBER_STATUSES.READY);
        const allMembersReady = normalMembers.length === 0 || readyMembers.length === normalMembers.length;

        return {
            id: room.id,
            roomCode: room.room_code,
            // 대기방과 결과 화면에서 방장과 참여자가 인증 비밀번호를 다시 확인할 수 있도록 제공합니다.
            roomPassword: room.room_password,
            examType: normalizeMpExamType(room.exam_type),
            examTypeLabel: getMpExamTypeLabel(room.exam_type),
            maxPlayers: Number(room.max_players || 1),
            status: room.status,
            hostUserId: room.host_user_id,
            hostUserName: room.host_user_name,
            createdAt: room.created_at,
            startedAt: room.started_at,
            finishedAt: room.finished_at,
            memberCount: activeMembers.length,
            readyCount: readyMembers.length,
            notReadyCount: normalMembers.length - readyMembers.length,
            allMembersReady,
            examMode: isIpepExam(room.exam_type) ? 'IPEP_PAST_20' : 'RANDOM_CBT_5_SUBJECTS_100',
            examRuleText: isIpepExam(room.exam_type) ? '정보처리기사 실기 기출 20문제 랜덤 CBT' : '과목별 20문제씩 총 100문제 랜덤 CBT',
            members: activeMembers.map((m) => ({
                userId: m.user_id,
                userName: m.user_name || m.user_id,
                role: m.role,
                status: m.status,
                joinedAt: m.joined_at,
                submittedAt: m.submitted_at
            })),
            scoreboard: resultRows.map((r, index) => ({
                rank: index + 1,
                userId: r.user_id,
                totalScore: Number(r.total_score || 0),
                averageScore: Number(r.average_score || 0),
                correctCount: Number(r.correct_count || 0),
                totalCount: Number(r.total_count || 0),
                isPass: Boolean(r.is_pass),
                submittedAt: r.submitted_at
            }))
        };
    }

    async function emitRoomUpdated(roomCode) {
        if (!io) return;
        try {
            const detail = await getRoomDetail(roomCode);
            if (!detail) return;
            io.to(getSocketRoomName(roomCode)).emit('multiplayer:room-updated', detail);
        } catch (error) {
            console.warn('[multiplayer] emit room update failed:', error.message);
        }
    }

    async function emitKicked(roomCode, targetUserId) {
        if (!io) return;
        io.to(getSocketRoomName(roomCode)).emit('multiplayer:kicked', {
            roomCode,
            targetUserId: String(targetUserId || '')
        });
    }


    async function cleanupRoomIfAllWrongAnswersHidden(roomId) {
        // 4번 '오답문제 풀러가기'에서 모든 참여자의 모든 오답이 삭제 처리되면
        // 해당 멀티플레이 방의 채점/답안/문제/참여자/방 데이터를 실제 DB에서 정리합니다.
        // 삭제 조건:
        // 1) 방 상태가 FINISHED인 완료 시험일 것
        // 2) 방 안에 실제 오답 답안이 1개 이상 있을 것
        // 3) 숨김 테이블(wgs_multiplayer_wrong_hides)에 모든 오답이 기록되어
        //  더 이상 확인 가능한 오답이 0개일 것
        // 이렇게 해야 한 명이라도 오답을 삭제하지 않은 경우에는 방 기록이 유지되고,
        // 모든 사용자가 오답을 정리한 경우에만 3번 시험 기록과 HTML/PDF용 데이터까지 사라진다.
        const targetRoomId = normalizeInt(roomId, 0);
        if (!targetRoomId) return { deleted: false, reason: 'invalid_room' };

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 같은 방을 동시에 정리하는 상황을 막기 위해 방 행을 잠근 뒤 다시 조건을 검사합니다.
            const [roomRows] = await connection.query(
                `SELECT id, room_code, status
                 FROM wgs_multiplayer_rooms
                 WHERE id = ?
                 LIMIT 1
                 FOR UPDATE`,
                [targetRoomId]
            );

            if (roomRows.length === 0) {
                await connection.rollback();
                return { deleted: false, reason: 'room_not_found' };
            }

            const room = roomRows[0];
            if (room.status !== ROOM_STATUSES.FINISHED) {
                await connection.rollback();
                return { deleted: false, reason: 'room_not_finished', roomCode: room.room_code };
            }

            const [statRows] = await connection.query(
                `SELECT
                     COUNT(*) AS total_wrong_count,
                     SUM(CASE WHEN h.id IS NULL THEN 1 ELSE 0 END) AS visible_wrong_count
                 FROM wgs_multiplayer_answers ma
                 LEFT JOIN wgs_multiplayer_wrong_hides h
                   ON h.room_id = ma.room_id
                  AND h.user_id = ma.user_id
                  AND h.question_id = ma.question_id
                 WHERE ma.room_id = ?
                   AND COALESCE(ma.is_correct, 0) = 0`,
                [targetRoomId]
            );

            const totalWrongCount = Number(statRows?.[0]?.total_wrong_count || 0);
            const visibleWrongCount = Number(statRows?.[0]?.visible_wrong_count || 0);

            if (totalWrongCount <= 0 || visibleWrongCount >0) {
                await connection.rollback();
                return {
                    deleted: false,
                    reason: 'visible_wrongs_remain',
                    roomCode: room.room_code,
                    totalWrongCount,
                    visibleWrongCount
                };
            }

            // FK ON DELETE CASCADE가 있는 환경이라면 rooms 삭제만으로도 충분하지만,
            // DB 스키마 차이에 대비해 자식 테이블을 명시적으로 먼저 정리합니다.
            await connection.query(`DELETE FROM wgs_multiplayer_wrong_hides WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_answers WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_results WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_room_questions WHERE room_id = ?`, [targetRoomId]);
            await connection.query(`DELETE FROM wgs_multiplayer_room_members WHERE room_id = ?`, [targetRoomId]);
            const [deleteResult] = await connection.query(`DELETE FROM wgs_multiplayer_rooms WHERE id = ?`, [targetRoomId]);

            await connection.commit();
            return {
                deleted: Number(deleteResult?.affectedRows || 0) >0,
                roomCode: room.room_code,
                totalWrongCount,
                visibleWrongCount: 0
            };
        } catch (error) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.warn('[multiplayer] room cleanup rollback failed:', rollbackError.message);
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    async function generateUnusedRoomCode() {
        // 1~999 중 활성 방이 없는 번호를 랜덤으로 뽑는다.
        // 먼저 랜덤 150번 시도하고, 실패하면 1부터 순차 검색합니다.
        for (let i = 0; i < 150; i += 1) {
            const candidate = String(Math.floor(Math.random() * 999) + 1);
            const existing = await getActiveRoomByCode(candidate);
            if (!existing) return candidate;
        }

        for (let code = 1; code <= 999; code += 1) {
            const candidate = String(code);
            const existing = await getActiveRoomByCode(candidate);
            if (!existing) return candidate;
        }

        throw new Error('현재 사용 가능한 방 번호가 없습니다. 잠시 후 다시 시도해주세요.');
    }

    async function ensureRoomQuestions(room) {
        const [existing] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_questions WHERE room_id = ?`,
            [room.id]
        );
        const requiredCount = isIpepExam(room.exam_type) ? 20 : 100;
        if (Number(existing[0]?.cnt || 0) === requiredCount) return;
        if (Number(existing[0]?.cnt || 0) >0) {
            await pool.query(`DELETE FROM wgs_multiplayer_room_questions WHERE room_id = ?`, [room.id]);
        }

        if (isIpepExam(room.exam_type)) {
            // 실기 선택 시 필기 questions가 아니라 ipep_past_questions에서 출제합니다.
            // 기출연도/회차가 달라도 질문과 정답이 유사하면 먼저 뽑힌 1문제만 사용합니다.
            const [candidateRows] = await pool.query(
                `SELECT question_id, exam_year AS year, exam_session AS round, question_no,
                        question_text, answer_raw, choice_img_path AS image_path, explanation_img_path AS question_img
                 FROM ipep_past_questions
                 WHERE is_active = 1
                 ORDER BY RAND()`
            );
            const rows = pickUniqueMultiplayerRows(candidateRows, 20, buildPracticalDuplicateInfo, isPracticalDuplicate);
            if (rows.length < 20) throw new Error(`중복 문제를 제외하면 실기 기출문제가 부족합니다. 현재 ${rows.length}문제 / 필요 20문제`);

            const values = rows.map((q, index) => [room.id, q.question_id, MP_EXAM_TYPES.IPEP, index + 1, q.question_no || index + 1, 6, '정보처리기사 실기']);
            await pool.query(
                `INSERT INTO wgs_multiplayer_room_questions
                 (room_id, question_id, question_source, question_order, info_id, subject_no, subject_name)
                 VALUES ?`,
                [values]
            );
            return;
        }

        const values = [];
        let order = 1;
        for (let subjectNo = 1; subjectNo <= 5; subjectNo += 1) {
            const [candidateQuestions] = await pool.query(
                `SELECT picked.question_id, picked.info_id, picked.subject_no, picked.question, picked.question_img,
                        o.opt1, o.opt2, o.opt3, o.opt4
                 FROM (
                    SELECT q.question_id, q.info_id, q.question, q.question_img, ${SUBJECT_NO_SQL} AS subject_no
                    FROM questions q
                 ) picked
                 LEFT JOIN options o ON o.question_id = picked.question_id
                 WHERE picked.subject_no = ?
                 ORDER BY RAND()`,
                [subjectNo]
            );
            // 같은 과목 안에서 질문 또는 보기 구성이 거의 같은 문제는 먼저 뽑힌 1문제만 출제합니다.
            const questions = pickUniqueMultiplayerRows(candidateQuestions, 20, buildWrittenDuplicateInfo, isWrittenDuplicate);
            if (questions.length < 20) {
                throw new Error(`${subjectNo}과목은 중복 문제를 제외하면 20문제보다 적어서 랜덤 CBT를 만들 수 없습니다. 현재 ${questions.length}문제입니다.`);
            }
            for (const q of questions) {
                values.push([room.id, q.question_id, MP_EXAM_TYPES.WRITTEN, order, q.info_id || null, subjectNo, getSubjectNameByNo(subjectNo)]);
                order += 1;
            }
        }

        await pool.query(
            `INSERT INTO wgs_multiplayer_room_questions
             (room_id, question_id, question_source, question_order, info_id, subject_no, subject_name)
             VALUES ?`,
            [values]
        );
    }

    async function getRoomQuestionsWithAnswer(roomId, includeAnswer = false) {
        const [[room]] = await pool.query(`SELECT id, exam_type FROM wgs_multiplayer_rooms WHERE id = ? LIMIT 1`, [roomId]);

        if (isIpepExam(room?.exam_type)) {
            // 실기 채점 정책(FLEX_TERM, SELF_CHECK 등)은 해설이 아니므로 explanation으로 내려보내지 않습니다.
            // explanation_text / explanation_img_path가 비어 있으면 프론트에서 빈 해설 또는 안내문으로 처리합니다.
            const answerFields = includeAnswer
                ? ', p.answer_raw AS correct_label, p.answer_raw, p.answer_aliases_json, COALESCE(p.explanation_text, \'\') AS explanation, p.explanation_img_path'
                : ', p.explanation_img_path';
            const [rows] = await pool.query(
                `SELECT rq.question_id, rq.question_order, rq.question_source, rq.info_id, rq.subject_no, rq.subject_name,
                        p.exam_year AS year, p.exam_session AS session, p.question_no, p.question_text, NULL AS content_text, NULL AS code_text, p.choice_img_path AS image_path
                        ${answerFields}
                 FROM wgs_multiplayer_room_questions rq
                 JOIN ipep_past_questions p ON p.question_id = rq.question_id
                 WHERE rq.room_id = ? AND rq.question_source = ? AND p.is_active = 1
                 ORDER BY rq.question_order ASC`,
                [roomId, MP_EXAM_TYPES.IPEP]
            );
            return rows.map((row) => sanitizeQuestionForClient({
                ...row,
                question_source: MP_EXAM_TYPES.IPEP,
                source_label: `${row.year || ''}년 ${row.session || ''}회 실기 ${row.question_no || row.question_order}번`.trim(),
                question_text: [row.question_text, row.content_text, row.code_text].filter((v) => v && String(v).trim()).join('\n\n'),
                option_1: '', option_2: '', option_3: '', option_4: '',
                image_path: row.image_path || row.question_img || '',
                subject_no: 6,
                subject_name: '정보처리기사 실기'
            }, includeAnswer));
        }

        const answerColumn = includeAnswer ? 'COALESCE(a.correct_label, o.answer) AS correct_label,' : '';
        const [rows] = await pool.query(
            `SELECT rq.question_order, rq.question_source, rq.subject_no, rq.subject_name, q.question_id, q.year, q.session, q.info_id, q.subject AS subject_id, q.question AS question_text, q.question_img,
                    o.opt1 AS option_1, o.opt2 AS option_2, o.opt3 AS option_3, o.opt4 AS option_4,
                    ${answerColumn}
                    COALESCE(a.explanation_text, '') AS explanation
             FROM wgs_multiplayer_room_questions rq
             INNER JOIN questions q ON q.question_id = rq.question_id
             LEFT JOIN options o ON o.question_id = q.question_id
             LEFT JOIN answers a ON a.question_id = q.question_id
             WHERE rq.room_id = ? AND rq.question_source = ?
             ORDER BY rq.question_order ASC`,
            [roomId, MP_EXAM_TYPES.WRITTEN]
        );

        return rows.map((row) => sanitizeQuestionForClient({ ...row, question_source: MP_EXAM_TYPES.WRITTEN }, includeAnswer));
    }

    async function buildResultForUser(room, user, answersByQuestionId) {
        const questions = await getRoomQuestionsWithAnswer(room.id, true);
        const isIpep = isIpepExam(room.exam_type);
        const subjectScores = isIpep
            ? [{ subjectName: '정보처리기사 실기', correctCount: 0, totalCount: questions.length, score: 0, isPassSubject: false }]
            : SUBJECT_NAMES.map((name) => ({ subjectName: name, correctCount: 0, totalCount: 0, score: 0 }));
        let correctCount = 0;

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(`DELETE FROM wgs_multiplayer_answers WHERE room_id = ? AND user_id = ?`, [room.id, user.id]);

            for (const q of questions) {
                const rawSelected = answersByQuestionId[String(q.question_id)] ?? answersByQuestionId[Number(q.question_id)] ?? null;
                const selected = rawSelected === null || rawSelected === undefined || rawSelected === ''? null : String(rawSelected);
                const isCorrect = selected !== null && (isIpep ? isIpepAnswerCorrect(selected, q) : String(selected) === String(q.correct_label));
                const subjectIndex = isIpep ? 0 : Math.min(4, Math.max(0, Number(q.subject_no || Math.ceil(Number(q.question_order || 1) / 20)) - 1));

                if (!isIpep) subjectScores[subjectIndex].totalCount += 1;
                if (isCorrect) {
                    correctCount += 1;
                    subjectScores[subjectIndex].correctCount += 1;
                }

                await connection.query(
                    `INSERT INTO wgs_multiplayer_answers
                     (room_id, user_id, question_id, selected_answer, is_correct)
                     VALUES (?, ?, ?, ?, ?)`,
                    [room.id, user.id, q.question_id, selected || '', isCorrect ? 1 : 0]
                );
                q.selected_answer = selected || '';
                q.is_correct = isCorrect;
            }

            if (isIpep) {
                const total = questions.length || 20;
                subjectScores[0].totalCount = total;
                subjectScores[0].score = Math.round((correctCount / total) * 100);
                subjectScores[0].isPassSubject = subjectScores[0].score >= 60;
            } else {
                for (const subject of subjectScores) subject.score = subject.correctCount * 5;
            }

            const totalCount = questions.length;
            const totalScore = isIpep ? subjectScores[0].score : correctCount;
            const averageScore = isIpep ? subjectScores[0].score : (totalCount >0 ? Math.round((correctCount / totalCount) * 100) : 0);
            const isPass = isIpep ? averageScore >= 60 : averageScore >= 60 && subjectScores.every((subject) => subject.score >= 40);

            await connection.query(
                `INSERT INTO wgs_multiplayer_results
                    (room_id, user_id, user_name, correct_count, total_count, total_score, average_score, subject_scores_json, is_pass)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    user_name = VALUES(user_name),
                    correct_count = VALUES(correct_count),
                    total_count = VALUES(total_count),
                    total_score = VALUES(total_score),
                    average_score = VALUES(average_score),
                    subject_scores_json = VALUES(subject_scores_json),
                    is_pass = VALUES(is_pass),
                    submitted_at = NOW()`,
                [room.id, user.id, user.name, correctCount, totalCount, totalScore, averageScore, JSON.stringify(subjectScores), isPass ? 1 : 0]
            );

            await connection.query(
                `UPDATE wgs_multiplayer_room_members SET status = 'SUBMITTED', submitted_at = NOW() WHERE room_id = ? AND user_id = ?`,
                [room.id, user.id]
            );

            const [notSubmitted] = await connection.query(
                `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_members WHERE room_id = ? AND status <> ' LEFT' AND status <> 'SUBMITTED'`,
                [room.id]
            );
            if (Number(notSubmitted[0]?.cnt || 0) === 0) {
                await connection.query(`UPDATE wgs_multiplayer_rooms SET status = 'FINISHED', finished_at = NOW() WHERE id = ?`, [room.id]);
            }
            await connection.commit();

            return {
                examType: normalizeMpExamType(room.exam_type),
                examTypeLabel: getMpExamTypeLabel(room.exam_type),
                correctCount,
                totalCount,
                totalScore,
                averageScore,
                subjectScores,
                isPass,
                roomCode: room.room_code,
                roomPassword: room.room_password,
                questions: questions.map((q) => ({ ...q, selected_answer: q.selected_answer, is_correct: Boolean(q.is_correct) }))
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function getSavedResult(room, userId) {
        const [rows] = await pool.query(
            `SELECT * FROM wgs_multiplayer_results WHERE room_id = ? AND user_id = ? LIMIT 1`,
            [room.id, userId]
        );
        if (rows.length === 0) return null;

        const result = rows[0];
        const [answers] = await pool.query(
            `SELECT question_id, selected_answer, is_correct
             FROM wgs_multiplayer_answers
             WHERE room_id = ? AND user_id = ?`,
            [room.id, userId]
        );
        const answerMap = new Map(answers.map((a) => [String(a.question_id), a]));
        const questions = await getRoomQuestionsWithAnswer(room.id, true);

        let subjectScores = [];
        try {
            subjectScores = typeof result.subject_scores_json === 'string'? JSON.parse(result.subject_scores_json || '[]')
                : result.subject_scores_json || [];
        } catch (e) {
            subjectScores = [];
        }

        return {
            examType: normalizeMpExamType(room.exam_type),
            examTypeLabel: getMpExamTypeLabel(room.exam_type),
            correctCount: Number(result.correct_count || 0),
            totalCount: Number(result.total_count || 0),
            totalScore: Number(result.total_score || 0),
            averageScore: Number(result.average_score || 0),
            subjectScores,
            isPass: Boolean(result.is_pass),
            submittedAt: result.submitted_at,
            // 결과 화면에서 방 번호와 비밀번호를 다시 확인할 수 있도록 방 정보를 함께 내려줍니다.
            roomCode: room.room_code,
            roomPassword: room.room_password,
            questions: questions.map((q) => {
                const ans = answerMap.get(String(q.question_id));
                return {
                    ...q,
                    selected_answer: ans ? ans.selected_answer : null,
                    is_correct: ans ? Boolean(ans.is_correct) : false
                };
            })
        };
    }


    function formatDateOnly(value) {
        // MySQL DATETIME/Date 객체를 응시 날짜 필터용 YYYY-MM-DD 문자열로 변환합니다.
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatTimeOnly(value) {
        // MySQL DATETIME/Date 객체를 응시 시간 필터용 HH:mm:ss 문자열로 변환합니다.
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    }

    function buildFailReason(subjectScores, averageScore) {
        // 필기 합격 기준: 과목별 40점 이상 + 전체 평균 60점 이상을 문장으로 정리합니다.
        const weakSubjects = subjectScores.filter((s) => Number(s.score || 0) < 40).map((s) => s.subjectName);
        const reasons = [];
        if (weakSubjects.length >0) reasons.push(`${weakSubjects.join(', ')}이 합격 조건에 맞지 않습니다`);
        if (Number(averageScore || 0) < 60) reasons.push('평균점수가 합격 조건에 맞지 않습니다');
        return reasons.length >0 ? `${reasons.join(', ')}. 아쉽게도 불합격 하셨습니다.` : '';
    }

    function buildSubjectSummaryFromQuestionResults(questionResults = []) {
        // 저장된 응답 목록을 기준으로 사용자별 과목 점수와 합격/불합격 사유를 다시 계산합니다.
        const subjectScores = SUBJECT_NAMES.map((name) => ({ subjectName: name, correctCount: 0, totalCount: 0, score: 0, pass: false }));
        let correctCount = 0;

        for (const item of questionResults) {
            const subjectIndex = Math.min(4, Math.max(0, Number(item.subject_no || Math.ceil(Number(item.cbtNo || item.question_order || 1) / 20)) - 1));
            subjectScores[subjectIndex].totalCount += 1;
            if (item.is_correct || item.isCorrect) {
                correctCount += 1;
                subjectScores[subjectIndex].correctCount += 1;
            }
        }

        for (const subject of subjectScores) {
            subject.score = subject.correctCount * 5;
            subject.pass = subject.score >= 40;
        }

        const totalCount = questionResults.length || 100;
        const averageScore = totalCount >0 ? Math.round((correctCount / totalCount) * 100) : 0;
        const isPass = averageScore >= 60 && subjectScores.every((s) => s.pass);

        return {
            correctCount,
            totalCount,
            averageScore,
            subjectScores,
            isPass,
            reason: buildFailReason(subjectScores, averageScore)
        };
    }

    async function buildRoomRecordBoard(room) {
        // 방 번호/비밀번호로 전체 제출 현황, 사용자별 PASS/NP, 문제별 정답자/오답자를 만든다.
        const [members] = await pool.query(
            `SELECT user_id, user_name, role, status, submitted_at
             FROM wgs_multiplayer_room_members
             WHERE room_id = ? AND status <> ' LEFT' ORDER BY joined_at ASC, id ASC`,
            [room.id]
        );

        const [results] = await pool.query(
            `SELECT * FROM wgs_multiplayer_results WHERE room_id = ?`,
            [room.id]
        );

        const submittedCount = results.length;
        const totalMembers = members.length;
        if (totalMembers >0 && submittedCount < totalMembers) {
            return {
                ready: false,
                submittedCount,
                totalMembers,
                msg: '현재 모든 사용자가 시험을 마치지 않았습니다, 잠시 후 시도해주시기 바랍니다.'
            };
        }

        const questions = await getRoomQuestionsWithAnswer(room.id, true);

        // 오답 다시풀기 삭제 연동
        // ------------------------------------------------------------
        // 4. 오답문제 풀러가기에서 선택 삭제/전체 삭제한 오답은
        // wgs_multiplayer_wrong_hides에 기록됩니다.
        // 시험 기록 확인하기 화면과 HTML/PDF용 오답 정리에서도 같은 숨김 기준을
        // 적용해야 삭제한 오답이 다시 보이지 않는다.
        // 원본 결과/참여자 데이터는 보존하고, 문제별 정답자/오답자 표에서만
        // 삭제 처리된 개인 오답은 채점표 응답에서 제외합니다.
        const [hiddenWrongRows] = await pool.query(
            `SELECT user_id, question_id
               FROM wgs_multiplayer_wrong_hides
              WHERE room_id = ?`,
            [room.id]
        );
        const hiddenWrongKeys = new Set(
            hiddenWrongRows.map((row) => `${String(row.user_id)}:${String(row.question_id)}`)
        );

        const resultMap = new Map(results.map((r) => [String(r.user_id), r]));
        const participants = [];
        const answerByUser = new Map();

        for (const member of members) {
            const [answers] = await pool.query(
                `SELECT question_id, selected_answer, is_correct
                 FROM wgs_multiplayer_answers
                 WHERE room_id = ? AND user_id = ?`,
                [room.id, member.user_id]
            );
            const ansMap = new Map(answers.map((a) => [String(a.question_id), a]));
            answerByUser.set(String(member.user_id), ansMap);

            let storedSubjectScores = [];
            const stored = resultMap.get(String(member.user_id));
            try {
                storedSubjectScores = stored && typeof stored.subject_scores_json === 'string'? JSON.parse(stored.subject_scores_json || '[]')
                    : stored?.subject_scores_json || [];
            } catch (e) {
                storedSubjectScores = [];
            }

            const questionResults = questions.map((q) => {
                const answer = ansMap.get(String(q.question_id));
                return {
                    ...q,
                    selected_answer: answer ? answer.selected_answer : null,
                    is_correct: answer ? Boolean(answer.is_correct) : false
                };
            });
            const calculated = buildSubjectSummaryFromQuestionResults(questionResults);
            const subjectScores = storedSubjectScores.length >0
                ? storedSubjectScores.map((s, idx) => ({ ...s, pass: Number(s.score || 0) >= 40, subjectName: s.subjectName || SUBJECT_NAMES[idx] }))
                : calculated.subjectScores;
            const averageScore = stored ? Number(stored.average_score || 0) : calculated.averageScore;
            const isPass = stored ? Boolean(stored.is_pass) : calculated.isPass;

            participants.push({
                userId: member.user_id,
                name: member.user_name,
                role: member.role,
                correctCount: stored ? Number(stored.correct_count || 0) : calculated.correctCount,
                totalCount: stored ? Number(stored.total_count || questions.length || 100) : calculated.totalCount,
                averageScore,
                subjectScores,
                isPass,
                reason: isPass ? '' : buildFailReason(subjectScores, averageScore),
                submittedAt: member.submitted_at
            });
        }

        const rows = questions.map((q) => {
            const correctNames = [];
            const wrongNames = [];
            for (const member of members) {
                const ans = answerByUser.get(String(member.user_id))?.get(String(q.question_id));
                const hiddenWrongKey = `${String(member.user_id)}:${String(q.question_id)}`;

                // 4번 화면에서 삭제한 오답은 3번 시험 기록/HTML/PDF용 오답표에서도 제외합니다.
                // 정답자는 그대로 유지하고, 삭제 처리된 오답자 이름만 표에서 제거합니다.
                if (hiddenWrongKeys.has(hiddenWrongKey)) continue;

                if (ans && Boolean(ans.is_correct)) correctNames.push(member.user_name);
                else wrongNames.push(member.user_name);
            }
            return {
                no: q.cbtNo,
                question_id: q.question_id,
                sourceLabel: q.sourceLabel,
                actualNo: q.info_id,
                correctLabel: q.correct_label,
                questionText: q.question_text,
                // HTML/PDF용 오답 정리 페이지에서도 필기 <보기> 이미지를 렌더링할 수 있도록 이미지 별칭을 같이 내려줍니다.
                question_img: q.question_img,
                questionImg: q.questionImg,
                choice_img_stem: q.choice_img_stem,
                choice_img_file: q.choice_img_file,
                choice_img_path: q.choice_img_path,
                choiceImgPath: q.choiceImgPath,
                questionImgPath: q.questionImgPath,
                imagePath: q.imagePath,
                image: q.image,
                options: q.options,
                // 필기 문제 해설은 SELECT 별칭과 원본 필드 중 사용 가능한 값을 우선 적용합니다.
                // 결과 화면과 전체 채점표에서 같은 해설 데이터를 표시하기 위한 처리입니다.
                explanation: q.explanation || q.explanation_text || '',
                explanation_text: q.explanation_text || q.explanation || '',
                explanation_img_path: q.explanation_img_path || q.explanationImgPath || '',
                explanationImgPath: q.explanationImgPath || q.explanation_img_path || '',
                questionSource: q.questionSource || q.question_source,
                question_source: q.question_source || q.questionSource,
                correctNames,
                wrongNames
            };
        });

        // 4번 '오답 문제 풀러가기'에서 선택 삭제/전체 삭제한 오답은
        // 3번 '시험 기록 확인하기'의 문제별 오답표와 HTML/PDF용 데이터에서도 제외합니다.
        // 주의:
        // - wgs_multiplayer_results의 점수/제출 기록은 채점 원본이므로 유지합니다.
        // - 삭제하지 않은 다른 참여자의 오답은 계속 확인할 수 있어야 하므로,
        //  question_id 기준이 아니라 '남아있는 오답자(wrongNames)' 기준으로만 필터링합니다.
        const visibleWrongRows = rows.filter((row) => (row.wrongNames || []).length >0);

        return {
            ready: true,
            examType: normalizeMpExamType(room.exam_type),
            exam_type: normalizeMpExamType(room.exam_type),
            examTypeLabel: getMpExamTypeLabel(room.exam_type),
            roomCode: room.room_code,
            roomPassword: room.room_password,
            submittedCount,
            totalMembers,
            participants,
            rows: visibleWrongRows,
            wrongItems: visibleWrongRows
        };
    }

    router.get('/meta/question-pool', requireSessionUser, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT subject_no, COUNT(*) AS count
                 FROM (
                    SELECT ${SUBJECT_NO_SQL} AS subject_no
                    FROM questions q
                 ) picked
                 WHERE subject_no BETWEEN 1 AND 5
                 GROUP BY subject_no
                 ORDER BY subject_no ASC`
            );

            const counts = SUBJECT_NAMES.map((name, index) => {
                const found = rows.find((row) => Number(row.subject_no) === index + 1);
                return { subjectNo: index + 1, subjectName: name, count: Number(found?.count || 0) };
            });

            return res.json({ success: true, counts, totalRule: '각 과목 20문제씩 총 100문제 랜덤 추첨' });
        } catch (error) {
            console.error('[multiplayer] question pool meta error:', error);
            return res.status(500).json({ success: false, msg: '문제 풀 정보를 불러오지 못했습니다.' });
        }
    });

    router.post('/rooms', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const password = normalizePassword(req.body.password);
            const maxPlayers = Math.min(10, Math.max(1, normalizeInt(req.body.maxPlayers, 5)));
            // 방 만들기 셀렉트에서 넘어온 필기/실기 기출 유형을 저장합니다.
            const examType = normalizeMpExamType(req.body.examType || req.body.exam_type || 'written');

            if (!isValidRoomPassword(password)) {
                return res.status(400).json({ success: false, msg: '인증 비밀번호는 1부터 999999까지 숫자로 입력해주세요.' });
            }

            const roomCode = await generateUnusedRoomCode();

            const [insertResult] = await pool.query(
                `INSERT INTO wgs_multiplayer_rooms
                 (room_code, room_password, host_user_id, host_user_name, exam_type, year, session, max_players, status)
                 VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'WAITING')`,
                [roomCode, password, user.id, user.name, examType, maxPlayers]
            );

            await pool.query(
                `INSERT INTO wgs_multiplayer_room_members
                 (room_id, user_id, user_name, role, status)
                 VALUES (?, ?, ?, 'HOST', 'JOINED')`,
                [insertResult.insertId, user.id, user.name]
            );

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] create room error:', error);
            return res.status(500).json({ success: false, msg: error.message || '방 생성 중 오류가 발생했습니다.' });
        }
    });

    router.get('/rooms/:roomCode', requireSessionUser, async (req, res) => {
        try {
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const detail = await getRoomDetail(roomCode);
            if (!detail) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] get room error:', error);
            return res.status(500).json({ success: false, msg: '방 정보를 불러오지 못했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/join', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode || req.body.roomCode);
            const password = normalizePassword(req.body.password);
            const room = await getActiveRoomByCode(roomCode);

            if (!isValidRoomCode(roomCode)) return res.status(400).json({ success: false, msg: '방 번호는 1부터 999까지 입력해주세요.' });
            if (!room) return res.status(404).json({ success: false, msg: '입장 가능한 방을 찾을 수 없습니다.' });
            if (room.room_password !== password) return res.status(403).json({ success: false, msg: '인증 비밀번호가 일치하지 않습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '시험이 이미 시작되어 새로 입장할 수 없습니다.' });

            const [memberRows] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? LIMIT 1`,
                [room.id, user.id]
            );

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_members WHERE room_id = ? AND status <> ' LEFT'`,
                [room.id]
            );
            const activeCount = Number(countRows[0]?.cnt || 0);
            const isAlreadyActive = memberRows.length >0 && memberRows[0].status !== MEMBER_STATUSES.LEFT;

            if (!isAlreadyActive && activeCount >= Number(room.max_players || 1)) {
                return res.status(400).json({ success: false, msg: '방 참여 인원이 가득 찼습니다.' });
            }

            if (memberRows.length === 0) {
                await pool.query(
                    `INSERT INTO wgs_multiplayer_room_members
                     (room_id, user_id, user_name, role, status)
                     VALUES (?, ?, ?, 'MEMBER', 'JOINED')`,
                    [room.id, user.id, user.name]
                );
            } else if (memberRows[0].status === MEMBER_STATUSES.LEFT) {
                await pool.query(
                    `UPDATE wgs_multiplayer_room_members
                     SET status = 'JOINED', user_name = ?, joined_at = NOW(), submitted_at = NULL
                     WHERE room_id = ? AND user_id = ?`,
                    [user.name, room.id, user.id]
                );
            }

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] join room error:', error);
            return res.status(500).json({ success: false, msg: '방 입장 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/ready', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const ready = Boolean(req.body.ready);
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '대기 중인 방에서만 준비 상태를 바꿀 수 있습니다.' });
            if (String(room.host_user_id) === String(user.id)) return res.status(400).json({ success: false, msg: '방장은 준비완료 버튼 없이 시작 권한을 가집니다.' });

            const [memberRows] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? AND status <> ' LEFT' LIMIT 1`,
                [room.id, user.id]
            );
            if (memberRows.length === 0) return res.status(403).json({ success: false, msg: '이 방의 참여자가 아닙니다.' });

            await pool.query(
                `UPDATE wgs_multiplayer_room_members
                 SET status = ?
                 WHERE room_id = ? AND user_id = ? AND role <> 'HOST' AND status <> ' LEFT'`,
                [ready ? MEMBER_STATUSES.READY : MEMBER_STATUSES.JOINED, room.id, user.id]
            );

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] ready status error:', error);
            return res.status(500).json({ success: false, msg: '준비 상태 변경 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/password', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const password = normalizePassword(req.body.password);
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.host_user_id) !== String(user.id)) return res.status(403).json({ success: false, msg: '방장만 비밀번호를 변경할 수 있습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '대기 중인 방에서만 비밀번호를 변경할 수 있습니다.' });
            if (!isValidRoomPassword(password)) return res.status(400).json({ success: false, msg: '새 비밀번호는 1부터 999999까지 숫자로 입력해주세요.' });

            await pool.query(`UPDATE wgs_multiplayer_rooms SET room_password = ? WHERE id = ?`, [password, room.id]);
            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] change password error:', error);
            return res.status(500).json({ success: false, msg: '비밀번호 변경 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/kick', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const targetUserId = String(req.body.targetUserId || '').trim();
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.host_user_id) !== String(user.id)) return res.status(403).json({ success: false, msg: '방장만 참여자를 내보낼 수 있습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '대기 중인 방에서만 참여자를 내보낼 수 있습니다.' });
            if (!targetUserId) return res.status(400).json({ success: false, msg: '내보낼 참여자를 선택해주세요.' });
            if (String(targetUserId) === String(room.host_user_id)) return res.status(400).json({ success: false, msg: '방장은 내보낼 수 없습니다.' });

            await pool.query(
                `UPDATE wgs_multiplayer_room_members
                 SET status = ' LEFT' WHERE room_id = ? AND user_id = ? AND role <> 'HOST'`,
                [room.id, targetUserId]
            );

            const detail = await getRoomDetail(roomCode);
            await emitKicked(roomCode, targetUserId);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] kick member error:', error);
            return res.status(500).json({ success: false, msg: '참여자 내보내기 처리 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/start', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.host_user_id) !== String(user.id)) return res.status(403).json({ success: false, msg: '방장만 시험을 시작할 수 있습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '이미 시작되었거나 종료된 방입니다.' });

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_members WHERE room_id = ? AND status <> ' LEFT'`,
                [room.id]
            );
            const memberCount = Number(countRows[0]?.cnt || 0);
            if (memberCount < 1) return res.status(400).json({ success: false, msg: '참여자가 없어 시험을 시작할 수 없습니다.' });

            const [notReadyRows] = await pool.query(
                `SELECT user_name, user_id
                 FROM wgs_multiplayer_room_members
                 WHERE room_id = ?
                   AND role <> 'HOST' AND status <> ' LEFT' AND status <> 'READY'`,
                [room.id]
            );
            if (notReadyRows.length >0) {
                const names = notReadyRows.map((m) => m.user_name || m.user_id).join(', ');
                return res.status(400).json({
                    success: false,
                    msg: `아직 준비완료를 누르지 않은 참여자가 있습니다: ${names}`
                });
            }

            // 시작 요청 시점에 시험 종류를 다시 확정해 방 상태와 브라우저 캐시가 섞이지 않도록 합니다.
            // 브라우저 캐시/기존 방 데이터가 섞여도 실기 선택 시 필기 문제가 생성되지 않도록 방어합니다.
            const requestedExamType = normalizeMpExamType(req.body?.examType || room.exam_type || room.examType);
            if (requestedExamType !== normalizeMpExamType(room.exam_type || room.examType)) {
                await pool.query(`UPDATE wgs_multiplayer_rooms SET exam_type = ? WHERE id = ?`, [requestedExamType, room.id]);
                room.exam_type = requestedExamType;
                room.examType = requestedExamType;
            }

            await ensureRoomQuestions(room);

            await pool.query(`UPDATE wgs_multiplayer_rooms SET status = 'PLAYING', started_at = NOW() WHERE id = ?`, [room.id]);
            await pool.query(`UPDATE wgs_multiplayer_room_members SET status = 'PLAYING' WHERE room_id = ? AND status <> ' LEFT'`, [room.id]);

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] start room error:', error);
            return res.status(500).json({ success: false, msg: error.message || '시험 시작 중 오류가 발생했습니다.' });
        }
    });

    router.get('/rooms/:roomCode/questions', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });

            const [members] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? AND status <> ' LEFT' LIMIT 1`,
                [room.id, user.id]
            );
            if (members.length === 0) return res.status(403).json({ success: false, msg: '이 방의 참여자가 아닙니다.' });
            if (![ROOM_STATUSES.PLAYING, ROOM_STATUSES.FINISHED].includes(room.status)) return res.status(400).json({ success: false, msg: '아직 시험이 시작되지 않았습니다.' });

            const questions = await getRoomQuestionsWithAnswer(room.id, false);
            return res.json({ success: true, questions, room: await getRoomDetail(roomCode) });
        } catch (error) {
            console.error('[multiplayer] get questions error:', error);
            return res.status(500).json({ success: false, msg: '문제 목록을 불러오지 못했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/submit', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const answers = req.body.answers || {};
            const room = await getRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (![ROOM_STATUSES.PLAYING, ROOM_STATUSES.FINISHED].includes(room.status)) return res.status(400).json({ success: false, msg: '제출 가능한 시험 상태가 아닙니다.' });

            const [members] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? AND status <> ' LEFT' LIMIT 1`,
                [room.id, user.id]
            );
            if (members.length === 0) return res.status(403).json({ success: false, msg: '이 방의 참여자가 아닙니다.' });

            const result = await buildResultForUser(room, user, answers);
            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, result, room: detail });
        } catch (error) {
            console.error('[multiplayer] submit error:', error);
            return res.status(500).json({ success: false, msg: '답안 제출 중 오류가 발생했습니다.' });
        }
    });

    router.get('/rooms/:roomCode/result', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });

            const result = await getSavedResult(room, user.id);
            if (!result) return res.status(404).json({ success: false, msg: '아직 제출 결과가 없습니다.' });
            return res.json({ success: true, result, room: await getRoomDetail(roomCode) });
        } catch (error) {
            console.error('[multiplayer] result error:', error);
            return res.status(500).json({ success: false, msg: '결과 조회 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/leave', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getActiveRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });

            // 평상시 대기방 나가기 정책은 유지합니다.
            // 단, 제출하지 않고 시험 화면을 벗어난 사용자는 결과표에서 제외해야 하므로 LEFT 처리만 허용합니다.
            const isUnsubmittedExit = req.body?.reason === 'unsubmitted-exit';
            if (String(room.host_user_id) === String(user.id) && !isUnsubmittedExit) {
                return res.status(400).json({ success: false, msg: '방장은 대기방을 나갈 수 없습니다. 필요하면 새 방을 다시 만들어주세요.' });
            }
            if (room.status !== ROOM_STATUSES.WAITING && !isUnsubmittedExit) {
                return res.status(400).json({ success: false, msg: '시험 시작 후에는 나갈 수 없습니다.' });
            }

            await pool.query(
                `UPDATE wgs_multiplayer_room_members SET status = ' LEFT' WHERE room_id = ? AND user_id = ?`,
                [room.id, user.id]
            );

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] leave error:', error);
            return res.status(500).json({ success: false, msg: '방 나가기 중 오류가 발생했습니다.' });
        }
    });


    router.post('/rooms/:roomCode/record', requireSessionUser, async (req, res) => {
        try {
            // 시험 기록 확인: 방 번호와 인증 비밀번호가 맞고 전원이 제출한 경우에만 전체 채점표를 반환합니다.
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const password = normalizePassword(req.body.password);
            const room = await getRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.room_password) !== String(password)) return res.status(403).json({ success: false, msg: '인증 비밀번호가 일치하지 않습니다.' });

            // 모든 참여자가 오답을 삭제한 방은 시험 기록 확인 시점에 한 번 더 정리합니다.
            // 삭제된 채점표가 화면에 남지 않도록 숨김 상태를 반영합니다.
            const cleanupResult = await cleanupRoomIfAllWrongAnswersHidden(room.id);
            if (cleanupResult.deleted) {
                return res.status(404).json({
                    success: false,
                    roomDeleted: true,
                    msg: '모든 오답이 삭제되어 해당 시험 기록이 정리되었습니다.'
                });
            }

            const board = await buildRoomRecordBoard(room);
            if (!board.ready) return res.status(409).json({ success: false, notReady: true, ...board });
            return res.json({ success: true, board });
        } catch (error) {
            console.error('[multiplayer] room record error:', error);
            return res.status(500).json({ success: false, msg: '방 전체 시험 기록을 불러오지 못했습니다.' });
        }
    });

    router.get('/my-wrongs/groups', requireSessionUser, async (req, res) => {
        try {
            // 현재 로그인 사용자의 멀티플레이 제출 기록을 날짜/시간 필터용으로 내려줍니다.
            const user = req.wgsUser;
            const [rows] = await pool.query(
                // 전체 오답 삭제 또는 마지막 오답 선택 삭제가 끝난 응시 기록은
                // 드롭다운 목록에 다시 보이지 않게, 아직 숨김 처리되지 않은 내 오답이 있는 방만 조회합니다.
                `SELECT r.id AS room_id, r.room_code, r.room_password, s.submitted_at, s.correct_count, s.total_count
                 FROM wgs_multiplayer_results s
                 INNER JOIN wgs_multiplayer_rooms r ON r.id = s.room_id
                 WHERE s.user_id = ?
                   AND EXISTS (
                       SELECT 1
                       FROM wgs_multiplayer_answers ma
                       WHERE ma.room_id = s.room_id
                         AND ma.user_id = s.user_id
                         AND COALESCE(ma.is_correct, 0) = 0
                         AND NOT EXISTS (
                             SELECT 1
                             FROM wgs_multiplayer_wrong_hides h
                             WHERE h.room_id = ma.room_id
                               AND h.user_id = ma.user_id
                               AND h.question_id = ma.question_id
                         )
                   )
                 ORDER BY s.submitted_at DESC`,
                [user.id]
            );
            const groups = rows.map((row) => ({
                roomId: row.room_id,
                roomCode: row.room_code,
                // 시험기록/오답 선택 목록에서 방 번호와 함께 비밀번호도 표시할 수 있도록 내려줍니다.
                roomPassword: row.room_password || '',
                submittedAt: row.submitted_at,
                date: formatDateOnly(row.submitted_at),
                time: formatTimeOnly(row.submitted_at),
                correctCount: Number(row.correct_count || 0),
                totalCount: Number(row.total_count || 0)
            }));
            return res.json({ success: true, groups });
        } catch (error) {
            console.error('[multiplayer] my wrong groups error:', error);
            return res.status(500).json({ success: false, msg: '멀티플레이 응시 기록을 불러오지 못했습니다.' });
        }
    });

    router.get('/my-wrongs/:roomId', requireSessionUser, async (req, res) => {
        try {
            // 선택한 응시 기록에서 현재 사용자가 틀린 문제만 반환합니다.
            const user = req.wgsUser;
            const roomId = normalizeInt(req.params.roomId, 0);
            const [resultRows] = await pool.query(`SELECT * FROM wgs_multiplayer_results WHERE room_id = ? AND user_id = ? LIMIT 1`, [roomId, user.id]);
            if (resultRows.length === 0) return res.status(404).json({ success: false, msg: '해당 응시 기록을 찾을 수 없습니다.' });
            const [answerRows] = await pool.query(
                `SELECT question_id, selected_answer, is_correct FROM wgs_multiplayer_answers WHERE room_id = ? AND user_id = ?`,
                [roomId, user.id]
            );
            const answerMap = new Map(answerRows.map((a) => [String(a.question_id), a]));
            const questions = await getRoomQuestionsWithAnswer(roomId, true);

            // 사용자가 이미 삭제한 멀티플레이 오답은 다시풀기 목록에서 숨긴다.
            const [hiddenRows] = await pool.query(
                `SELECT question_id FROM wgs_multiplayer_wrong_hides WHERE room_id = ? AND user_id = ?`,
                [roomId, user.id]
            );
            const hiddenQuestionIds = new Set(hiddenRows.map((row) => String(row.question_id)));

            const wrongs = questions.map((q) => {
                const ans = answerMap.get(String(q.question_id));
                return { ...q, selected_answer: ans?.selected_answer || null, is_correct: Boolean(ans?.is_correct) };
            }).filter((q) => !q.is_correct)
              .filter((q) => !hiddenQuestionIds.has(String(q.question_id)));
            return res.json({ success: true, roomId, submittedAt: resultRows[0].submitted_at, wrongs });
        } catch (error) {
            console.error('[multiplayer] my wrong practice error:', error);
            return res.status(500).json({ success: false, msg: '멀티플레이 오답문제를 불러오지 못했습니다.' });
        }
    });


    // 멀티플레이 오답 다시풀기 - 선택한 문제 1개를 내 오답 목록에서 삭제합니다.
    // 답안과 결과 원본 테이블은 보존하고 숨김 테이블만 기록해 시험 기록 화면의 기준 데이터를 유지합니다.
    router.delete('/my-wrongs/:roomId/:questionId', async (req, res) => {
        try {
            const user = await requireSessionUserForHandler(req);
            const roomId = normalizeInt(req.params.roomId, 0);
            const questionId = normalizeInt(req.params.questionId, 0);
            if (!roomId || !questionId) return res.status(400).json({ success: false, msg: '방 번호 또는 문제 번호가 올바르지 않습니다.' });

            await pool.query(
                `INSERT INTO wgs_multiplayer_wrong_hides (room_id, user_id, question_id)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP`,
                [roomId, user.id, questionId]
            );

            // 현재 사용자가 마지막 남은 오답을 삭제한 경우 방 기록까지 실제 삭제합니다.
            const cleanupResult = await cleanupRoomIfAllWrongAnswersHidden(roomId);
            return res.json({
                success: true,
                msg: cleanupResult.deleted
                    ? '모든 참여자의 오답이 삭제되어 시험 기록까지 정리했습니다.'
                    : '선택한 오답을 삭제했습니다.',
                roomDeleted: cleanupResult.deleted
            });
        } catch (error) {
            console.error('[multiplayer] delete wrong error:', error);
            return res.status(error.statusCode || 500).json({ success: false, msg: error.statusCode === 401 ? '로그인이 필요합니다.' : '오답 삭제 중 오류가 발생했습니다.' });
        }
    });

    // 멀티플레이 오답 다시풀기 - 선택한 응시 기록의 내 오답 전체를 삭제합니다.
    // 같은 방의 다른 사용자 결과와 방 기록은 그대로 유지됩니다.
    router.delete('/my-wrongs/:roomId', async (req, res) => {
        try {
            const user = await requireSessionUserForHandler(req);
            const roomId = normalizeInt(req.params.roomId, 0);
            if (!roomId) return res.status(400).json({ success: false, msg: '방 번호가 올바르지 않습니다.' });

            const [answerRows] = await pool.query(
                `SELECT DISTINCT ma.question_id
                   FROM wgs_multiplayer_answers ma
                  WHERE ma.room_id = ?
                    AND ma.user_id = ?
                    AND ma.is_correct = 0`,
                [roomId, user.id]
            );

            if (answerRows.length >0) {
                // 현재 DB 구조는 room_id/user_id/question_id/deleted_at만 사용합니다.
                // source, hidden_at 컬럼을 참조하지 않으며, bulk VALUES ? 대신
                // 명시적 플레이스홀더를 만들어 mysql2 환경 차이로 인한 전체 삭제 오류를 막는다.
                const placeholders = answerRows.map(() => '(?, ?, ?)').join(', ');
                const values = answerRows.flatMap((row) => [roomId, user.id, row.question_id]);
                await pool.query(
                    `INSERT INTO wgs_multiplayer_wrong_hides (room_id, user_id, question_id)
                     VALUES ${placeholders}
                     ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP`,
                    values
                );
            }

            // 다른 참여자의 오답이 아직 남아 있으면 방 기록은 유지하고,
            // 모든 참여자의 오답이 삭제된 경우에만 방 데이터를 실제 DB에서 정리합니다.
            const cleanupResult = await cleanupRoomIfAllWrongAnswersHidden(roomId);
            return res.json({
                success: true,
                msg: cleanupResult.deleted
                    ? '모든 참여자의 오답이 삭제되어 시험 기록까지 정리했습니다.'
                    : '선택한 응시 기록의 오답을 모두 삭제했습니다.',
                deletedCount: answerRows.length,
                roomDeleted: cleanupResult.deleted
            });
        } catch (error) {
            console.error('[multiplayer] delete all wrongs error:', error);
            return res.status(error.statusCode || 500).json({ success: false, msg: error.statusCode === 401 ? '로그인이 필요합니다.' : '오답 전체 삭제 중 오류가 발생했습니다.' });
        }
    });

    router._wgsEmitRoomUpdated = emitRoomUpdated;
    return router;
}

module.exports = createMultiplayerRouter;
module.exports.ensureMultiplayerSchema = ensureMultiplayerSchema;
module.exports.getSocketRoomName = getSocketRoomName;
