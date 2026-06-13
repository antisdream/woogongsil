// update_ipep_image_paths_db.js
// 목적:
// 1. CSV 파일을 절대 수정하지 않고, SQL의 이미지 경로 컬럼만 업데이트합니다.
// 2. 문제질문/문제정답/문제번호 같은 핵심 데이터는 변경하지 않습니다.
// 3. 이미지 폴더에 있는 파일명을 기준으로 DB의 보기/해설 이미지 경로만 채웁니다.
// 4. 기존 필기 사이트 기능과 기존 실기 문제 데이터에는 영향을 주지 않습니다.
// 실행 위치:
// ExamAppProject/backend
// 실행 명령:
// node update_ipep_image_paths_db.js
// 지원 이미지 확장자:
// png, jpg, jpeg, webp, gif


// Node.js 기본 path 모듈입니다. Windows 경로를 안전하게 조합할 때 사용합니다.
const path = require('path');


// Node.js 기본 fs 모듈입니다. 이미지 폴더의 파일 목록을 읽을 때 사용합니다.
const fs = require('fs');


// .env 파일의 DB 접속 정보를 읽기 위해 dotenv를 사용합니다.
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });


// MySQL 접속을 위해 mysql2/promise를 사용합니다.
const mysql = require('mysql2/promise');


// 현재 스크립트가 있는 폴더입니다.
// 프로젝트 기준 경로: ExamAppProject/backend
const IPEP_IMAGE_DIR = path.join(BACKEND_DIR, 'public', 'ipep-img');
const BASE_DIR = BACKEND_DIR;


// 실기 문제은행 이미지 폴더입니다.
const RANDOM_IMG_DIR = path.join(IPEP_IMAGE_DIR, 'random');


// 실기 기출문제 이미지 폴더입니다.
const PAST_IMG_DIR = path.join(IPEP_IMAGE_DIR, 'past');


// 웹에서 접근할 이미지 URL prefix입니다.
// 서버 진입점에서 이미 app.use('/ipep-img/random', express.static(...)) 로 연결해둔 경로입니다.
const RANDOM_WEB_PREFIX = '/ipep-img/random';


// 웹에서 접근할 이미지 URL prefix입니다.
// 서버 진입점에서 이미 app.use('/ipep-img/past', express.static(...)) 로 연결해둔 경로입니다.
const PAST_WEB_PREFIX = '/ipep-img/past';


// 허용할 이미지 확장자 목록입니다.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);


// 1. 공통 유틸 함수


// 값을 문자열로 바꾸고 앞뒤 공백을 제거합니다.
function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}


// 숫자를 지정한 자리수만큼 0으로 채웁니다.
// 예: padNumber(1, 2) -> "01"
function padNumber(value, length) {
    return cleanText(value).padStart(length, '0');
}


// 파일명에서 확장자를 제거한 stem을 가져옵니다.
// 예: 2020010107.png ->2020010107
function getStem(fileName) {
    return path.parse(fileName).name;
}


// stem에서 숫자만 추출합니다.
// 예: 2020_01_01_07 ->2020010107
function digitsOnly(value) {
    return cleanText(value).replace(/\D/g, '');
}


// 웹 URL로 사용할 때 문제가 될 수 있는 문자를 인코딩합니다.
// 한글 파일명이나 공백이 들어가도 브라우저가 접근할 수 있게 하기 위함입니다.
function makeWebPath(prefix, fileName) {
    return `${prefix}/${encodeURIComponent(fileName).replace(/%2F/g, '/')}`;
}


// 폴더가 없으면 빈 Map을 반환합니다.
// 폴더가 있으면 이미지 파일들을 stem 기준으로 저장합니다.
function scanImageFolder(dirPath) {
    const byStem = new Map();
    const byLowerStem = new Map();
    const byDigits = new Map();
    const files = [];

    if (!fs.existsSync(dirPath)) {
        console.log(` 이미지 폴더가 없습니다: ${dirPath}`);
        return { files, byStem, byLowerStem, byDigits };
    }

    const dirItems = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of dirItems) {
        if (!item.isFile()) continue;

        const fileName = item.name;
        const ext = path.extname(fileName).toLowerCase();

        if (!IMAGE_EXTS.has(ext)) continue;

        const stem = getStem(fileName);
        const lowerStem = stem.toLowerCase();
        const digits = digitsOnly(stem);

        files.push(fileName);
        byStem.set(stem, fileName);
        byLowerStem.set(lowerStem, fileName);

        if (digits) {
            byDigits.set(digits, fileName);
        }
    }

    return { files, byStem, byLowerStem, byDigits };
}


// 여러 후보 stem 중 실제 이미지 파일이 있는 첫 번째 파일을 찾습니다.
function findFileByCandidates(imageIndex, candidates) {
    for (const candidate of candidates) {
        const stem = cleanText(candidate);
        if (!stem) continue;

        if (imageIndex.byStem.has(stem)) {
            return {
                stem,
                fileName: imageIndex.byStem.get(stem)
            };
        }

        const lowerStem = stem.toLowerCase();
        if (imageIndex.byLowerStem.has(lowerStem)) {
            return {
                stem,
                fileName: imageIndex.byLowerStem.get(lowerStem)
            };
        }

        const digits = digitsOnly(stem);
        if (digits && imageIndex.byDigits.has(digits)) {
            return {
                stem,
                fileName: imageIndex.byDigits.get(digits)
            };
        }
    }

    return null;
}


// DB 컬럼이 실제로 존재하는지 확인합니다.
// 혹시 예전 스키마와 다르면 무리해서 UPDATE하지 않고 중단하기 위한 안전장치입니다.
async function assertColumnsExist(pool, tableName, requiredColumns) {
    const [rows] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
    const existing = new Set(rows.map(row => row.Field));

    const missing = requiredColumns.filter(col => !existing.has(col));

    if (missing.length >0) {
        throw new Error(`${tableName} 테이블에 필요한 컬럼이 없습니다: ${missing.join(', ')}`);
    }
}


// 2. 문제은행 이미지 경로 업데이트


async function updateRandomQuestionImages(pool) {
    const imageIndex = scanImageFolder(RANDOM_IMG_DIR);

    console.log('\n[실기 문제은행 이미지 확인]');
    console.log(`이미지 폴더: ${RANDOM_IMG_DIR}`);
    console.log(`발견한 이미지 수: ${imageIndex.files.length}`);

    if (imageIndex.files.length >0) {
        console.log('이미지 파일 예시:', imageIndex.files.slice(0, 10));
    }

    const [rows] = await pool.query(`SELECT
            question_id,
            subject_code,
            subject_no
        FROM ipep_random_questions
        WHERE is_active = 1
        ORDER BY subject_code ASC, subject_no ASC
    `);

    let choiceUpdated = 0;
    let explanationUpdated = 0;
    let choiceCleared = 0;
    let explanationCleared = 0;
    let matchedQuestions = 0;
    let unmatchedQuestions = 0;

    for (const row of rows) {
        const subjectCode = padNumber(row.subject_code, 2);

        // 실기 문제은행 이미지 파일명 규칙
        // - public/ipep-img/random 파일은 "r + 과목 코드 + 과목 내 번호 + 컬럼 위치" 규칙을 사용합니다.
        // - 과목코드: 01 ~ 08
        // - 과목번호: 01처럼 2자리부터 시작하지만, 101번처럼 3자리 이상은 원래 자리수를 유지합니다.
        //  예) 1과목 1번 보기: r010105 = r + 01 + 01 + 05
        //  예) 1과목 101번 해설: r0110106 = r + 01 + 101 + 06
        // - 컬럼위치: 05는 문제 보기 이미지, 06은 문제 해설 이미지입니다.
        const subjectNoFlex = padNumber(Number(row.subject_no), 2);

        // 안전 후보
        // - 새 규칙을 최우선으로 찾습니다.
        // - 예전 테스트 중 만들어졌을 수 있는 3자리/접두사 없는 stem도 후보로만 남겨둡니다.
        // - public/ipep-img/past 처리는 아래 updatePastQuestionImages 함수에서 유지합니다.
        const subjectNo3 = padNumber(Number(row.subject_no), 3);

        const choiceCandidates = [
            `r${subjectCode}${subjectNoFlex}05`,
            `R${subjectCode}${subjectNoFlex}05`,
            `r${subjectCode}${subjectNo3}05`,
            `R${subjectCode}${subjectNo3}05`,
            `${subjectCode}${subjectNoFlex}05`,
            `${subjectCode}${subjectNo3}05`
        ];

        const explanationCandidates = [
            `r${subjectCode}${subjectNoFlex}06`,
            `R${subjectCode}${subjectNoFlex}06`,
            `r${subjectCode}${subjectNo3}06`,
            `R${subjectCode}${subjectNo3}06`,
            `${subjectCode}${subjectNoFlex}06`,
            `${subjectCode}${subjectNo3}06`
        ];

        const choice = findFileByCandidates(imageIndex, choiceCandidates);
        const explanation = findFileByCandidates(imageIndex, explanationCandidates);

        if (choice || explanation) {
            matchedQuestions += 1;
        } else {
            unmatchedQuestions += 1;
        }

        if (choice) {
            await pool.query(`UPDATE ipep_random_questions
                SET
                    choice_img_stem = ?,
                    choice_img_file = ?,
                    choice_img_path = ?
                WHERE question_id = ?
            `, [
                choice.stem,
                choice.fileName,
                makeWebPath(RANDOM_WEB_PREFIX, choice.fileName),
                row.question_id
            ]);

            choiceUpdated += 1;
        } else {
            // 이미지 파일이 없는 문제는 기존에 잘못 들어가 있던 보기 이미지 경로를 비웁니다.
            // 이렇게 해야 보기 이미지가 없는 문항에서 깨진 이미지가 노출되지 않습니다.
            await pool.query(`UPDATE ipep_random_questions
                SET
                    choice_img_stem = NULL,
                    choice_img_file = NULL,
                    choice_img_path = NULL
                WHERE question_id = ?
            `, [row.question_id]);
            choiceCleared += 1;
        }

        if (explanation) {
            await pool.query(`UPDATE ipep_random_questions
                SET
                    explanation_img_stem = ?,
                    explanation_img_file = ?,
                    explanation_img_path = ?
                WHERE question_id = ?
            `, [
                explanation.stem,
                explanation.fileName,
                makeWebPath(RANDOM_WEB_PREFIX, explanation.fileName),
                row.question_id
            ]);

            explanationUpdated += 1;
        } else {
            // 해설 이미지가 없는 문제는 해설 이미지 컬럼을 비워서 이전 경로가 남지 않도록 합니다.
            await pool.query(`UPDATE ipep_random_questions
                SET
                    explanation_img_stem = NULL,
                    explanation_img_file = NULL,
                    explanation_img_path = NULL
                WHERE question_id = ?
            `, [row.question_id]);
            explanationCleared += 1;
        }
    }

    console.log(`매칭된 문제 수: ${matchedQuestions}`);
    console.log(`이미지가 없는 문제 수: ${unmatchedQuestions}`);
    console.log(`보기 이미지 경로 업데이트: ${choiceUpdated}`);
    console.log(`해설 이미지 경로 업데이트: ${explanationUpdated}`);
    console.log(`보기 이미지 경로 비움: ${choiceCleared}`);
    console.log(`해설 이미지 경로 비움: ${explanationCleared}`);
}


// 3. 기출문제 이미지 경로 업데이트


async function updatePastQuestionImages(pool) {
    const imageIndex = scanImageFolder(PAST_IMG_DIR);

    console.log('\n[실기 기출문제 이미지 확인]');
    console.log(`이미지 폴더: ${PAST_IMG_DIR}`);
    console.log(`발견한 이미지 수: ${imageIndex.files.length}`);

    if (imageIndex.files.length >0) {
        console.log('이미지 파일 예시:', imageIndex.files.slice(0, 10));
    }

    const [rows] = await pool.query(`SELECT
            question_id,
            exam_year,
            exam_session,
            question_no
        FROM ipep_past_questions
        WHERE is_active = 1
        ORDER BY exam_year ASC, exam_session ASC, question_no ASC
    `);

    let choiceUpdated = 0;
    let explanationUpdated = 0;
    let matchedQuestions = 0;

    for (const row of rows) {
        const year = cleanText(row.exam_year);
        const session2 = padNumber(row.exam_session, 2);
        const question2 = padNumber(row.question_no, 2);

        // project operator이 정한 규칙:
        // 기출연도4자리 + 기출회차2자리 + 문제번호2자리 + 06/07
        // 예: 2020010106, 2020010107
        const choiceStem = `${year}${session2}${question2}06`;
        const explanationStem = `${year}${session2}${question2}07`;

        const choice = findFileByCandidates(imageIndex, [choiceStem]);
        const explanation = findFileByCandidates(imageIndex, [explanationStem]);

        if (!choice && !explanation) {
            continue;
        }

        matchedQuestions += 1;

        if (choice) {
            await pool.query(`UPDATE ipep_past_questions
                SET
                    choice_img_stem = ?,
                    choice_img_file = ?,
                    choice_img_path = ?
                WHERE question_id = ?
            `, [
                choice.stem,
                choice.fileName,
                makeWebPath(PAST_WEB_PREFIX, choice.fileName),
                row.question_id
            ]);

            choiceUpdated += 1;
        } else {
            // 이미지 파일이 없는 문제는 기존에 잘못 들어가 있던 보기 이미지 경로를 비웁니다.
            // 이렇게 해야 보기 이미지가 없는 문항에서 깨진 이미지가 노출되지 않습니다.
            await pool.query(`UPDATE ipep_random_questions
                SET
                    choice_img_stem = NULL,
                    choice_img_file = NULL,
                    choice_img_path = NULL
                WHERE question_id = ?
            `, [row.question_id]);
            choiceCleared += 1;
        }

        if (explanation) {
            await pool.query(`UPDATE ipep_past_questions
                SET
                    explanation_img_stem = ?,
                    explanation_img_file = ?,
                    explanation_img_path = ?
                WHERE question_id = ?
            `, [
                explanation.stem,
                explanation.fileName,
                makeWebPath(PAST_WEB_PREFIX, explanation.fileName),
                row.question_id
            ]);

            explanationUpdated += 1;
        } else {
            // 해설 이미지가 없는 문제는 해설 이미지 컬럼을 비워서 이전 경로가 남지 않도록 합니다.
            await pool.query(`UPDATE ipep_random_questions
                SET
                    explanation_img_stem = NULL,
                    explanation_img_file = NULL,
                    explanation_img_path = NULL
                WHERE question_id = ?
            `, [row.question_id]);
            explanationCleared += 1;
        }
    }

    console.log(`매칭된 문제 수: ${matchedQuestions}`);
    console.log(`보기 이미지 경로 업데이트: ${choiceUpdated}`);
    console.log(`해설 이미지 경로 업데이트: ${explanationUpdated}`);
    console.log(`보기 이미지 경로 비움: ${choiceCleared}`);
    console.log(`해설 이미지 경로 비움: ${explanationCleared}`);
}


// 4. 업데이트 결과 확인


async function printResultSummary(pool) {
    const [randomRows] = await pool.query(`SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN choice_img_path IS NOT NULL AND choice_img_path <> ''THEN 1 ELSE 0 END) AS choice_count,
            SUM(CASE WHEN explanation_img_path IS NOT NULL AND explanation_img_path <> ''THEN 1 ELSE 0 END) AS explanation_count
        FROM ipep_random_questions
        WHERE is_active = 1
    `);

    const [pastRows] = await pool.query(`SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN choice_img_path IS NOT NULL AND choice_img_path <> ''THEN 1 ELSE 0 END) AS choice_count,
            SUM(CASE WHEN explanation_img_path IS NOT NULL AND explanation_img_path <> ''THEN 1 ELSE 0 END) AS explanation_count
        FROM ipep_past_questions
        WHERE is_active = 1
    `);

    console.log('\n[DB 이미지 경로 업데이트 결과]');
    console.table([
        {
            구분: '실기 문제은행',
            전체문제수: randomRows[0].total_count,
            보기이미지수: randomRows[0].choice_count || 0,
            해설이미지수: randomRows[0].explanation_count || 0
        },
        {
            구분: '실기 기출문제',
            전체문제수: pastRows[0].total_count,
            보기이미지수: pastRows[0].choice_count || 0,
            해설이미지수: pastRows[0].explanation_count || 0
        }
    ]);
}


// 5. 메인 실행 함수


async function main() {
    console.log(' 실기 이미지 경로 DB 업데이트를 시작합니다.');
    console.log(' 이 스크립트는 CSV 파일을 수정하지 않습니다.');
    console.log(' 문제질문/문제정답 데이터도 수정하지 않습니다.');
    console.log(`BASE_DIR: ${BASE_DIR}`);

    const pool = await mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
        charset: 'utf8mb4'
    });

    try {
        await pool.query('SELECT 1');
        console.log('DB 연결 성공');

        await assertColumnsExist(pool, 'ipep_random_questions', [
            'question_id',
            'subject_code',
            'subject_no',
            'choice_img_stem',
            'choice_img_file',
            'choice_img_path',
            'explanation_img_stem',
            'explanation_img_file',
            'explanation_img_path'
        ]);

        await assertColumnsExist(pool, 'ipep_past_questions', [
            'question_id',
            'exam_year',
            'exam_session',
            'question_no',
            'choice_img_stem',
            'choice_img_file',
            'choice_img_path',
            'explanation_img_stem',
            'explanation_img_file',
            'explanation_img_path'
        ]);

        await updateRandomQuestionImages(pool);
        await updatePastQuestionImages(pool);
        await printResultSummary(pool);

        console.log('\n 실기 이미지 경로 DB 업데이트가 완료되었습니다.');
        console.log('다음 단계: backend에서 node server.js 실행 후 브라우저에서 이미지 노출을 확인하세요.');
    } catch (error) {
        console.error('\n 실기 이미지 경로 DB 업데이트 중 오류가 발생했습니다.');
        console.error(error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}


// main 함수를 실행합니다.
main();
