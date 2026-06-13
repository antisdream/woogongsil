// load_ipep_csv.js
// 역할:
// 1. 정보처리기사 실기 CSV 2개를 읽는다.
//  - backend/data/ipep/source/random_ipep.csv
//  - backend/data/ipep/source/past_ipep.csv
// 2. MySQL exam_bank DB에 실기 전용 테이블을 생성합니다.
//  - 기존 필기 테이블은 변경하지 않는다.
//  - 실기 기능에서 에러가 나도 기존 필기 사이트가 중단되지 않도록 분리합니다.
// 3. CSV 데이터를 MySQL에 저장합니다.
//  - 같은 스크립트를 여러 번 실행해도 중복 저장되지 않도록 처리합니다.
//  - 이미 있는 문제는 최신 CSV 내용으로 업데이트합니다.
// 4. 정답 채점에 필요한 보조 데이터를 함께 만든다.
//  - answer_raw: CSV 원본 정답
//  - answer_normalized: 기본 채점용 정규화 정답
//  - answer_aliases_json: | 로 나뉜 정답 후보
//  - answer_slots_json: 쉼표로 나뉜 여러 정답 묶음
//  - grading_policy: 채점 방식 분류
// 실행 위치:
// ExamAppProject/backend
// 실행 명령:
// node load_ipep_csv.js


// fs는 파일과 폴더가 실제로 존재하는지 확인하기 위한 Node.js 기본 모듈입니다.
const fs = require('fs');


// path는 Windows 경로를 안전하게 조립하기 위한 Node.js 기본 모듈입니다.
const path = require('path');


// dotenv는 .env 파일의 DB 접속 정보를 process.env로 읽어오는 라이브러리다.
const dotenv = require('dotenv');


// mysql2/promise는 async/await 방식으로 MySQL을 사용하기 위한 라이브러리다.
const mysql = require('mysql2/promise');


// csv-parse는 CSV 파일을 안전하게 읽기 위한 라이브러리다.
// CSV 안에 쉼표, 따옴표, 줄바꿈이 있어도 안전하게 처리합니다.
const { parse } = require('csv-parse/sync');


// 1. 기본 경로 설정


// 현재 파일이 있는 폴더다.
// 프로젝트 기준 경로: ExamAppProject/backend
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const IPEP_DATA_DIR = path.join(BACKEND_DIR, 'data', 'ipep', 'source');
const IPEP_IMAGE_DIR = path.join(BACKEND_DIR, 'public', 'ipep-img');
const BASE_DIR = BACKEND_DIR;


// .env 파일 경로다.
const ENV_PATH = path.join(BACKEND_DIR, '.env');


// 실기 문제은행 CSV 경로다.
const RANDOM_CSV_PATH = path.join(IPEP_DATA_DIR, 'random_ipep.csv');


// 실기 기출문제 CSV 경로다.
const PAST_CSV_PATH = path.join(IPEP_DATA_DIR, 'past_ipep.csv');


// 실기 문제은행 이미지 폴더다.
// 지금은 이미지가 부족해도 괜찮다.
// 이미지 자산이 추가되면 파일명 기준값으로 이미지 기록을 연결합니다.
const RANDOM_IMG_DIR = path.join(IPEP_IMAGE_DIR, 'random');


// 실기 기출문제 이미지 폴더다.
const PAST_IMG_DIR = path.join(IPEP_IMAGE_DIR, 'past');


// 웹에서 사용할 이미지 기본 경로다.
// Express는 이 접두어들을 정적 이미지 경로로 제공합니다.
const RANDOM_IMG_WEB_PREFIX = '/ipep-img/random';
const PAST_IMG_WEB_PREFIX = '/ipep-img/past';


// 2. .env 읽기


if (!fs.existsSync(ENV_PATH)) {
    console.error(' .env 파일을 찾지 못했습니다.');
    console.error('찾으려던 위치:', ENV_PATH);
    process.exit(1);
}


// 프로젝트 기준 경로: ExamAppProject/backend
dotenv.config({ path: ENV_PATH });


// 3. DB 연결 설정


const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'exam_bank',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10)
};


// DB 접속 정보가 없으면 바로 멈춘다.
if (!dbConfig.user || !dbConfig.password) {
    console.error('DB_USER 또는 DB_PASSWORD가 .env에 없습니다.');
    process.exit(1);
}


// 4. 실기 과목 코드


const IPEP_SUBJECTS = [
    { subject_code: '01', subject_name: '키워드 찾기', display_order: 1 },
    { subject_code: '02', subject_name: 'SQL', display_order: 2 },
    { subject_code: '03', subject_name: '코드-제어문', display_order: 3 },
    { subject_code: '04', subject_name: '코드-포인터', display_order: 4 },
    { subject_code: '05', subject_name: '코드-구조체', display_order: 5 },
    { subject_code: '06', subject_name: '코드-사용자정의함수', display_order: 6 },
    { subject_code: '07', subject_name: '코드-JAVA', display_order: 7 },
    { subject_code: '08', subject_name: '코드-Python', display_order: 8 }
];


// 5. 기본 문자열 정리 함수


function cleanText(value) {
    // null 또는 undefined는 빈 문자열로 바꾼다.
    if (value === null || value === undefined) {
        return '';
    }

    // 문자열로 변환한 뒤 앞뒤 공백을 제거합니다.
    return String(value).trim();
}


function cleanHeader(value) {
    // CSV 헤더에 들어간 따옴표와 공백을 정리합니다.
    return cleanText(value).replace(/^"+|"+$/g, '').trim();
}


// 6. 정답 정규화 함수
// 용어형 문제에서 사용자 답과 정답을 비교하기 위해 사용합니다.
// 주의:
// 모든 특수문자를 제거하지 않는다.
// SQL, 코드, 수식에서는 =, >, <, !, %, /, +, -, 괄호 등이 의미가 있기 때문입니다.


function normalizeFlexible(value) {
    let text = cleanText(value);

    // CSV에 문자 그대로 들어간 \n을 실제 줄바꿈처럼 취급합니다.
    text = text.replace(/\\n/g, '\n');

    // Windows 줄바꿈과 Mac 줄바꿈을 Linux 줄바꿈으로 통일합니다.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 유니코드 표현 차이를 줄인다.
    text = text.normalize('NFKC');

    // 영어 대소문자를 무시하기 위해 소문자로 바꾼다.
    text = text.toLowerCase();

    // 따옴표류는 채점에서 크게 중요하지 않으므로 제거합니다.
    text = text.replace(/[“”‘’"']/g, '');

    // 일반 문장부호 중 의미가 약한 것만 제거합니다.
    // 콤마는 여러 정답 구분자로 쓰일 수 있으므로 여기서는 제거합니다.
    text = text.replace(/[.,。·]/g, '');

    // 모든 공백과 줄바꿈을 제거합니다.
    // 예: "Data Link"와 "datalink"를 같게 보기 위한 처리입니다.
    text = text.replace(/\s+/g, '');

    return text.trim();
}


function normalizeExactOutput(value) {
    let text = cleanText(value);

    // 코드 출력 문제에서는 \n이 실제 줄바꿈 의미를 가진다.
    text = text.replace(/\\n/g, '\n');

    // 줄바꿈만 통일하고, 대소문자와 공백은 최대한 유지합니다.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 앞뒤 공백만 제거합니다.
    return text.trim();
}


// 7. 정답 후보와 정답 묶음 만들기


function buildAnswerAliases(answerRaw) {
    const raw = cleanText(answerRaw);

    if (!raw) {
        return [];
    }

    // | 는 대체 정답 후보로 해석합니다.
    // 예: 애자일|Agile 은 애자일, Agile 둘 다 정답 후보
    return [...new Set(
        raw
            .split('|')
            .map(item => normalizeFlexible(item))
            .filter(item => item !== '')
    )];
}


function shouldSplitByComma(answerRaw) {
    const raw = cleanText(answerRaw);
    const upper = raw.toUpperCase();

    // SQL문은 SELECT 학번, 이름처럼 콤마가 문법의 일부일 수 있으므로 분리하지 않습니다.
    if (
        upper.includes('SELECT ') ||
        upper.includes('INSERT ') ||
        upper.includes('UPDATE ') ||
        upper.includes('DELETE ') ||
        upper.includes('CREATE ') ||
        upper.includes(' FROM ') ||
        upper.includes(' WHERE ')
    ) {
        return false;
    }

    // 코드 출력형은 콤마가 출력 결과의 일부일 수 있으므로 나누지 않는다.
    if (raw.includes('\\n') || raw.includes('\n')) {
        return false;
    }

    // 콤마가 있으면 여러 개 답을 쓰는 용어형일 가능성이 있습니다.
    return raw.includes(',');
}


function buildAnswerSlots(answerRaw) {
    const raw = cleanText(answerRaw);

    if (!raw) {
        return [];
    }

    // 여러 답을 쓰는 용어형은 콤마 기준으로 슬롯을 나눈다.
    // 각 슬롯 안에서는 | 를 대체 정답으로 본다.
    if (shouldSplitByComma(raw)) {
        return raw
            .split(',')
            .map(part => {
                const aliases = part
                    .split('|')
                    .map(item => normalizeFlexible(item))
                    .filter(item => item !== '');

                return [...new Set(aliases)];
            })
            .filter(slot => slot.length >0);
    }

    // 콤마로 나누지 않는 문제는 전체 답을 하나의 슬롯으로 본다.
    return [buildAnswerAliases(raw).length >0 ? buildAnswerAliases(raw) : [normalizeFlexible(raw)]];
}


// 8. 채점 정책 추정


function inferGradingPolicy(rowType, questionText, answerRaw) {
    const question = cleanText(questionText);
    const raw = cleanText(answerRaw);
    const upper = raw.toUpperCase();

    if (!raw) {
        return 'EMPTY';
    }

    // \n이 들어간 정답은 출력 결과형일 가능성이 높다.
    if (raw.includes('\\n') || raw.includes('\n')) {
        return 'EXACT_OUTPUT';
    }

    // SQL문은 SQL 작성형으로 분리합니다.
    if (
        upper.includes('SELECT ') ||
        upper.includes('INSERT ') ||
        upper.includes('UPDATE ') ||
        upper.includes('DELETE ') ||
        upper.includes('CREATE ') ||
        upper.includes(' FROM ') ||
        upper.includes(' WHERE ')
    ) {
        return 'SQL_TEXT';
    }

    // 문제 질문이 코드 실행 결과를 묻는 경우는 출력형에 가깝다.
    if (
        question.includes('출력') ||
        question.includes('실행 결과') ||
        question.includes('실행결과')
    ) {
        return 'EXACT_OUTPUT';
    }

    // 콤마로 여러 답을 쓰는 문제는 여러 정답 묶음으로 관리합니다.
    if (shouldSplitByComma(raw)) {
        return 'MULTI_TERM';
    }

    // 긴 한글 서술형은 자동채점이 위험하므로 자기채점 권장으로 둔다.
    if (raw.length >= 45 && /[가-힣]/.test(raw)) {
        return 'SELF_CHECK';
    }

    // 나머지는 일반 용어형으로 둔다.
    return 'FLEX_TERM';
}


// 9. 이미지 파일 찾기
// 확장자가 png, jpg, jpeg 등 섞일 수 있으므로 stem 기준으로 찾는다.
// 예: 2020010107 은 2020010107.png, 2020010107.jpg 모두 허용합니다


function findImageFileByStem(imageDir, stem) {
    const cleanStem = cleanText(stem);

    if (!cleanStem) {
        return null;
    }

    if (!fs.existsSync(imageDir)) {
        return null;
    }

    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp'];

    const files = fs.readdirSync(imageDir);

    const found = files.find(file => {
        const ext = path.extname(file).toLowerCase();
        const fileStem = path.basename(file, ext);
        return allowedExts.includes(ext) && fileStem === cleanStem;
    });

    return found || null;
}


function buildWebImagePath(prefix, fileName) {
    if (!fileName) {
        return null;
    }

    return `${prefix}/${fileName}`;
}


// 10. CSV 읽기


function readCsv(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`CSV 파일을 찾을 수 없습니다: ${filePath}`);
    }

    const csvText = fs.readFileSync(filePath, 'utf8');

    return parse(csvText, {
        columns: header => header.map(cleanHeader),
        skip_empty_lines: true,
        trim: true,
        bom: true
    });
}


// 11. 테이블 생성


async function createTables(pool) {
    // 실기 과목 테이블
    await pool.query(`CREATE TABLE IF NOT EXISTS ipep_subjects (
            subject_code CHAR(2) NOT NULL COMMENT '실기 과목 코드',
            subject_name VARCHAR(100) NOT NULL COMMENT '실기 과목명',
            display_order INT NOT NULL DEFAULT 0 COMMENT '화면 표시 순서',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (subject_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 실기 문제은행 테이블
    await pool.query(`CREATE TABLE IF NOT EXISTS ipep_random_questions (
            question_id INT NOT NULL AUTO_INCREMENT COMMENT '실기 문제은행 PK',
            subject_code CHAR(2) NOT NULL COMMENT '과목 코드',
            subject_no INT NOT NULL COMMENT '과목별 문제 번호',
            question_text TEXT NOT NULL COMMENT '문제 질문',
            answer_raw TEXT COMMENT 'CSV 원본 정답',
            answer_normalized TEXT COMMENT '기본 정규화 정답',
            answer_aliases_json JSON COMMENT '| 기준 대체 정답 후보',
            answer_slots_json JSON COMMENT '여러 답안 묶음 후보',
            grading_policy VARCHAR(30) NOT NULL DEFAULT 'FLEX_TERM'COMMENT '채점 정책',
            score INT NOT NULL DEFAULT 5 COMMENT '기본 배점',
            choice_img_stem VARCHAR(100) DEFAULT NULL COMMENT '보기 이미지 stem',
            choice_img_file VARCHAR(255) DEFAULT NULL COMMENT '보기 이미지 실제 파일명',
            choice_img_path VARCHAR(255) DEFAULT NULL COMMENT '보기 이미지 웹 경로',
            explanation_img_stem VARCHAR(100) DEFAULT NULL COMMENT '해설 이미지 stem',
            explanation_img_file VARCHAR(255) DEFAULT NULL COMMENT '해설 이미지 실제 파일명',
            explanation_img_path VARCHAR(255) DEFAULT NULL COMMENT '해설 이미지 웹 경로',
            is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '사용 여부',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (question_id),
            UNIQUE KEY uq_ipep_random_subject_no (subject_code, subject_no),
            KEY idx_ipep_random_subject_code (subject_code),
            CONSTRAINT fk_ipep_random_subject
                FOREIGN KEY (subject_code)
                REFERENCES ipep_subjects(subject_code)
                ON UPDATE CASCADE
                ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 실기 기출문제 테이블
    await pool.query(`CREATE TABLE IF NOT EXISTS ipep_past_questions (
            question_id INT NOT NULL AUTO_INCREMENT COMMENT '실기 기출문제 PK',
            exam_year SMALLINT NOT NULL COMMENT '기출연도',
            exam_session TINYINT NOT NULL COMMENT '기출회차',
            question_no SMALLINT NOT NULL COMMENT '문제번호',
            question_text TEXT NOT NULL COMMENT '문제 질문',
            answer_raw TEXT COMMENT 'CSV 원본 정답',
            answer_normalized TEXT COMMENT '기본 정규화 정답',
            answer_aliases_json JSON COMMENT '| 기준 대체 정답 후보',
            answer_slots_json JSON COMMENT '여러 답안 묶음 후보',
            grading_policy VARCHAR(30) NOT NULL DEFAULT 'FLEX_TERM'COMMENT '채점 정책',
            score INT NOT NULL DEFAULT 5 COMMENT '문제 배점',
            choice_img_stem VARCHAR(100) DEFAULT NULL COMMENT '보기 이미지 stem',
            choice_img_file VARCHAR(255) DEFAULT NULL COMMENT '보기 이미지 실제 파일명',
            choice_img_path VARCHAR(255) DEFAULT NULL COMMENT '보기 이미지 웹 경로',
            explanation_img_stem VARCHAR(100) DEFAULT NULL COMMENT '해설 이미지 stem',
            explanation_img_file VARCHAR(255) DEFAULT NULL COMMENT '해설 이미지 실제 파일명',
            explanation_img_path VARCHAR(255) DEFAULT NULL COMMENT '해설 이미지 웹 경로',
            is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '사용 여부',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (question_id),
            UNIQUE KEY uq_ipep_past_exam_question (exam_year, exam_session, question_no),
            KEY idx_ipep_past_exam (exam_year, exam_session)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 실기 기출 회차 목록 테이블
    // 데이터가 없는 회차도 화면에서 보여주고, 오픈베타 안내를 띄우기 위해 사용합니다.
    await pool.query(`CREATE TABLE IF NOT EXISTS ipep_exam_catalog (
            exam_year SMALLINT NOT NULL COMMENT '기출연도',
            exam_session TINYINT NOT NULL COMMENT '기출회차',
            question_count INT NOT NULL DEFAULT 0 COMMENT '현재 등록된 문제 수',
            is_open TINYINT(1) NOT NULL DEFAULT 0 COMMENT '응시 가능 여부',
            notice_message VARCHAR(255) DEFAULT '현재 오픈베타테스트중으로, 빠른 시일내에 추가 할 예정입니다.'COMMENT '미오픈 안내 문구',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (exam_year, exam_session)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}


// 12. 과목 저장


async function upsertSubjects(pool) {
    for (const subject of IPEP_SUBJECTS) {
        await pool.query(
            `INSERT INTO ipep_subjects (
                subject_code,
                subject_name,
                display_order
            )
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                subject_name = VALUES(subject_name),
                display_order = VALUES(display_order)
            `,
            [subject.subject_code, subject.subject_name, subject.display_order]
        );
    }
}


// 13. 문제은행 적재


async function importRandomQuestions(pool) {
    const records = readCsv(RANDOM_CSV_PATH);
    const warnings = [];

    let count = 0;

    for (const row of records) {
        const subjectCode = cleanText(row['과목코드']).padStart(2, '0');
        const subjectNo = Number(cleanText(row['과목번호']));
        const questionText = cleanText(row['문제질문']);
        const answerRaw = cleanText(row['문제정답']);
        const choiceImgStem = cleanText(row['문제보기']);
        const explanationImgStem = cleanText(row['문제해설']);

        const answerNormalized = normalizeFlexible(answerRaw);
        const answerAliases = buildAnswerAliases(answerRaw);
        const answerSlots = buildAnswerSlots(answerRaw);
        const gradingPolicy = inferGradingPolicy('random', questionText, answerRaw);

        const choiceImgFile = findImageFileByStem(RANDOM_IMG_DIR, choiceImgStem);
        const explanationImgFile = findImageFileByStem(RANDOM_IMG_DIR, explanationImgStem);

        const choiceImgPath = buildWebImagePath(RANDOM_IMG_WEB_PREFIX, choiceImgFile);
        const explanationImgPath = buildWebImagePath(RANDOM_IMG_WEB_PREFIX, explanationImgFile);

        if (!answerRaw) {
            warnings.push(`문제은행 정답 비어 있음: 과목코드=${subjectCode}, 과목번호=${subjectNo}`);
        }

        if (choiceImgStem && !choiceImgFile) {
            warnings.push(`문제은행 보기 이미지 못 찾음: stem=${choiceImgStem}`);
        }

        if (explanationImgStem && !explanationImgFile) {
            warnings.push(`문제은행 해설 이미지 못 찾음: stem=${explanationImgStem}`);
        }

        await pool.query(
            `INSERT INTO ipep_random_questions (
                subject_code,
                subject_no,
                question_text,
                answer_raw,
                answer_normalized,
                answer_aliases_json,
                answer_slots_json,
                grading_policy,
                score,
                choice_img_stem,
                choice_img_file,
                choice_img_path,
                explanation_img_stem,
                explanation_img_file,
                explanation_img_path,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, 5, ?, ?, ?, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
                question_text = VALUES(question_text),
                answer_raw = VALUES(answer_raw),
                answer_normalized = VALUES(answer_normalized),
                answer_aliases_json = VALUES(answer_aliases_json),
                answer_slots_json = VALUES(answer_slots_json),
                grading_policy = VALUES(grading_policy),
                score = VALUES(score),
                choice_img_stem = VALUES(choice_img_stem),
                choice_img_file = VALUES(choice_img_file),
                choice_img_path = VALUES(choice_img_path),
                explanation_img_stem = VALUES(explanation_img_stem),
                explanation_img_file = VALUES(explanation_img_file),
                explanation_img_path = VALUES(explanation_img_path),
                is_active = VALUES(is_active)
            `,
            [
                subjectCode,
                subjectNo,
                questionText,
                answerRaw,
                answerNormalized,
                JSON.stringify(answerAliases),
                JSON.stringify(answerSlots),
                gradingPolicy,
                choiceImgStem || null,
                choiceImgFile,
                choiceImgPath,
                explanationImgStem || null,
                explanationImgFile,
                explanationImgPath
            ]
        );

        count += 1;
    }

    return {
        totalRows: records.length,
        savedRows: count,
        warnings
    };
}


// 14. 기출문제 적재


async function importPastQuestions(pool) {
    const records = readCsv(PAST_CSV_PATH);
    const warnings = [];

    let count = 0;

    for (const row of records) {
        const examYear = Number(cleanText(row['기출연도']));
        const examSession = Number(cleanText(row['기출회차']));
        const questionNo = Number(cleanText(row['문제번호']));
        const questionText = cleanText(row['문제질문']);
        const answerRaw = cleanText(row['문제정답']);
        const choiceImgStem = cleanText(row['문제보기']);
        const explanationImgStem = cleanText(row['문제해설']);

        const answerNormalized = normalizeFlexible(answerRaw);
        const answerAliases = buildAnswerAliases(answerRaw);
        const answerSlots = buildAnswerSlots(answerRaw);
        const gradingPolicy = inferGradingPolicy('past', questionText, answerRaw);

        const choiceImgFile = findImageFileByStem(PAST_IMG_DIR, choiceImgStem);
        const explanationImgFile = findImageFileByStem(PAST_IMG_DIR, explanationImgStem);

        const choiceImgPath = buildWebImagePath(PAST_IMG_WEB_PREFIX, choiceImgFile);
        const explanationImgPath = buildWebImagePath(PAST_IMG_WEB_PREFIX, explanationImgFile);

        if (!answerRaw) {
            warnings.push(`기출문제 정답 비어 있음: ${examYear}년 ${examSession}회 ${questionNo}번`);
        }

        if (choiceImgStem && !choiceImgFile) {
            warnings.push(`기출문제 보기 이미지 못 찾음: stem=${choiceImgStem}`);
        }

        if (explanationImgStem && !explanationImgFile) {
            warnings.push(`기출문제 해설 이미지 못 찾음: stem=${explanationImgStem}`);
        }

        await pool.query(
            `INSERT INTO ipep_past_questions (
                exam_year,
                exam_session,
                question_no,
                question_text,
                answer_raw,
                answer_normalized,
                answer_aliases_json,
                answer_slots_json,
                grading_policy,
                score,
                choice_img_stem,
                choice_img_file,
                choice_img_path,
                explanation_img_stem,
                explanation_img_file,
                explanation_img_path,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, 5, ?, ?, ?, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
                question_text = VALUES(question_text),
                answer_raw = VALUES(answer_raw),
                answer_normalized = VALUES(answer_normalized),
                answer_aliases_json = VALUES(answer_aliases_json),
                answer_slots_json = VALUES(answer_slots_json),
                grading_policy = VALUES(grading_policy),
                score = VALUES(score),
                choice_img_stem = VALUES(choice_img_stem),
                choice_img_file = VALUES(choice_img_file),
                choice_img_path = VALUES(choice_img_path),
                explanation_img_stem = VALUES(explanation_img_stem),
                explanation_img_file = VALUES(explanation_img_file),
                explanation_img_path = VALUES(explanation_img_path),
                is_active = VALUES(is_active)
            `,
            [
                examYear,
                examSession,
                questionNo,
                questionText,
                answerRaw,
                answerNormalized,
                JSON.stringify(answerAliases),
                JSON.stringify(answerSlots),
                gradingPolicy,
                choiceImgStem || null,
                choiceImgFile,
                choiceImgPath,
                explanationImgStem || null,
                explanationImgFile,
                explanationImgPath
            ]
        );

        count += 1;
    }

    return {
        totalRows: records.length,
        savedRows: count,
        warnings
    };
}


// 15. 기출 회차 카탈로그 생성
// 2020~2025년, 1~3회차를 기본으로 만들고,
// CSV에 있는 회차는 문제 수가 20문제 이상이면 오픈 처리합니다.
// CSV에 2020년 4회차처럼 추가 회차가 있으면 그것도 자동 등록합니다.


async function rebuildExamCatalog(pool) {
    const plannedYears = [2020, 2021, 2022, 2023, 2024, 2025];
    const plannedSessions = [1, 2, 3];

    // 기본 계획 회차를 먼저 등록합니다.
    for (const year of plannedYears) {
        for (const session of plannedSessions) {
            await pool.query(
                `INSERT INTO ipep_exam_catalog (
                    exam_year,
                    exam_session,
                    question_count,
                    is_open,
                    notice_message
                )
                VALUES (?, ?, 0, 0, '현재 오픈베타테스트중으로, 빠른 시일내에 추가 할 예정입니다.')
                ON DUPLICATE KEY UPDATE
                    notice_message = VALUES(notice_message)
                `,
                [year, session]
            );
        }
    }

    // 실제 CSV에 들어간 회차별 문제 수를 가져온다.
    const [examRows] = await pool.query(`SELECT
            exam_year,
            exam_session,
            COUNT(*) AS question_count
        FROM ipep_past_questions
        WHERE is_active = 1
        GROUP BY exam_year, exam_session
    `);

    // 실제 데이터가 있는 회차는 카탈로그에 반영합니다.
    for (const row of examRows) {
        const isOpen = Number(row.question_count) >= 20 ? 1 : 0;

        await pool.query(
            `INSERT INTO ipep_exam_catalog (
                exam_year,
                exam_session,
                question_count,
                is_open,
                notice_message
            )
            VALUES (?, ?, ?, ?, '현재 오픈베타테스트중으로, 빠른 시일내에 추가 할 예정입니다.')
            ON DUPLICATE KEY UPDATE
                question_count = VALUES(question_count),
                is_open = VALUES(is_open),
                notice_message = VALUES(notice_message)
            `,
            [row.exam_year, row.exam_session, row.question_count, isOpen]
        );
    }
}


// 16. 결과 출력합니다


async function printSummary(pool) {
    const [subjectRows] = await pool.query(`SELECT COUNT(*) AS count FROM ipep_subjects`);
    const [randomRows] = await pool.query(`SELECT COUNT(*) AS count FROM ipep_random_questions`);
    const [pastRows] = await pool.query(`SELECT COUNT(*) AS count FROM ipep_past_questions`);

    const [randomBySubject] = await pool.query(`SELECT
            r.subject_code,
            s.subject_name,
            COUNT(*) AS question_count
        FROM ipep_random_questions r
        LEFT JOIN ipep_subjects s
            ON r.subject_code = s.subject_code
        GROUP BY r.subject_code, s.subject_name
        ORDER BY r.subject_code
    `);

    const [pastByExam] = await pool.query(`SELECT
            exam_year,
            exam_session,
            COUNT(*) AS question_count
        FROM ipep_past_questions
        GROUP BY exam_year, exam_session
        ORDER BY exam_year, exam_session
    `);

    const [catalogRows] = await pool.query(`SELECT
            exam_year,
            exam_session,
            question_count,
            is_open
        FROM ipep_exam_catalog
        ORDER BY exam_year, exam_session
    `);

    console.log('\n==============================');
    console.log(' 실기 DB 적재 결과');
    console.log('==============================');
    console.log(`실기 과목 수: ${subjectRows[0].count}`);
    console.log(`실기 문제은행 수: ${randomRows[0].count}`);
    console.log(`실기 기출문제 수: ${pastRows[0].count}`);

    console.log('\n[문제은행 과목별 개수]');
    console.table(randomBySubject);

    console.log('\n[기출문제 연도/회차별 개수]');
    console.table(pastByExam);

    console.log('\n[기출 회차 오픈 상태]');
    console.table(catalogRows);
}


// 17. 메인 실행


async function main() {
    console.log(' 정보처리기사 실기 CSV 적재를 시작합니다.');

    console.log('\n[경로 확인]');
    console.log('BASE_DIR:', BASE_DIR);
    console.log('RANDOM_CSV_PATH:', RANDOM_CSV_PATH);
    console.log('PAST_CSV_PATH:', PAST_CSV_PATH);
    console.log('RANDOM_IMG_DIR:', RANDOM_IMG_DIR);
    console.log('PAST_IMG_DIR:', PAST_IMG_DIR);

    const pool = mysql.createPool(dbConfig);

    try {
        console.log('\n1단계: DB 연결 확인 중...');
        await pool.query('SELECT 1');
        console.log('DB 연결 성공');

        console.log('\n2단계: 실기 전용 테이블 생성 중...');
        await createTables(pool);
        console.log(' 실기 전용 테이블 생성/확인 완료');

        console.log('\n3단계: 실기 과목 저장 중...');
        await upsertSubjects(pool);
        console.log(' 실기 과목 저장 완료');

        console.log('\n4단계: 실기 문제은행 CSV 적재 중...');
        const randomResult = await importRandomQuestions(pool);
        console.log(` 문제은행 저장 완료: ${randomResult.savedRows}개`);

        console.log('\n5단계: 실기 기출문제 CSV 적재 중...');
        const pastResult = await importPastQuestions(pool);
        console.log(` 기출문제 저장 완료: ${pastResult.savedRows}개`);

        console.log('\n6단계: 기출 회차 카탈로그 갱신 중...');
        await rebuildExamCatalog(pool);
        console.log(' 기출 회차 카탈로그 갱신 완료');

        const allWarnings = [
            ...randomResult.warnings,
            ...pastResult.warnings
        ];

        if (allWarnings.length >0) {
            console.log('\n 확인이 필요한 항목');
            allWarnings.forEach((warning, index) => {
                console.log(`${index + 1}. ${warning}`);
            });
        } else {
            console.log('\n 확인이 필요한 경고 없음');
        }

        await printSummary(pool);

        console.log('\n 실기 CSV 적재가 완료되었습니다.');
        console.log('현재 운영 중인 필기 사이트 코드는 아직 건드리지 않았습니다.');
    } catch (error) {
        console.error('\n 실기 CSV 적재 중 오류가 발생했습니다.');
        console.error('기존 운영 사이트 코드는 수정하지 않았기 때문에 필기 사이트는 영향을 받지 않습니다.');
        console.error(error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}


main();
