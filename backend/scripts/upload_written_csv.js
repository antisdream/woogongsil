// 필기 CSV 행을 데이터베이스에 가져옵니다.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const csv = require('csv-parser');
const { loadEnvFile } = require('../config/env');
const { createDatabasePool } = require('../config/database');

// 정보처리기사 필기 문제 + 해설 CSV ->MySQL 적재 스크립트
// - exam_bank_final.csv를 읽어서 questions/options 테이블에 필기 문제와 보기를 적재합니다.
// - 기존 subject 텍스트를 우공실 과목 코드(10~14)로 변환하는 방식은 유지합니다.
// - explan_checked_final.csv를 함께 읽어서 answers.correct_label, answers.explanation_text에 적재합니다.
// - 해설은 questions.question_id와 연결되므로, 문제를 먼저 넣은 뒤 answers에 넣습니다.
// - 실기 테이블(ipep_random_questions, ipep_past_questions)은 변경하지 않습니다.
// - 이 스크립트는 필기 마스터 테이블 questions/options/answers를 재생성합니다.
// - 기존 upload_csv.js도 questions/options를 DROP 후 재생성하는 구조였으므로, 그 흐름을 유지합니다.

// 1. DB 접속 설정
// DB 접속 정보는 환경 변수 파일에서 읽습니다. 저장소에는 비밀번호를 남기지 않습니다.
loadEnvFile();
const pool = createDatabasePool();

// 2. 파일 경로 설정
// upload_csv.js와 같은 backend 폴더 안에 아래 두 CSV가 있어야 합니다.
const BACKEND_DIR = path.resolve(__dirname, '..');
const WRITTEN_IMPORT_DIR = path.join(BACKEND_DIR, 'data', 'written-import');
const QUESTION_CSV_PATH = path.join(WRITTEN_IMPORT_DIR, 'exam_bank_final.csv');
const EXPLANATION_CSV_PATH = path.join(WRITTEN_IMPORT_DIR, 'explan_checked_final.csv');

// 3. 공통 유틸 함수

/**
 * 값 앞뒤 공백을 정리하고, 빈 문자열은 null로 바꿉니다.
 * DB에 빈 문자열이 불필요하게 들어가지 않도록 하기 위한 함수입니다.
 */
function cleanValue(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return value;

    const trimmed = value.trim();
    return trimmed === ''? null : trimmed;
}

/**
 * CSV 헤더 앞에 붙는 BOM 문자를 제거합니다.
 * 엑셀에서 저장한 CSV는 첫 번째 컬럼명이 \uFEFFyear처럼 깨질 수 있습니다.
 */
function cleanHeader(header) {
    return String(header || '')
        .trim()
        .replace(/^[\uFEFF\xEF\xBB\xBF]+/, '');
}

/**
 * CSV 원문을 읽기 전에 구분자 주변 형식을 정리합니다.
 *
 * 왜 필요한가?
 * - CSV에 , "내용, 쉼표 포함"처럼 쉼표 뒤 공백이 있고 그 뒤에 따옴표가 있으면,
 *  일부 파서가 따옴표를 문자열 시작으로 인식하지 못해 컬럼 밀림이 발생할 수 있습니다.
 * - 그래서 쉼표 뒤 공백 다음 따옴표를 쉼표 바로 뒤 따옴표로 정리합니다.
 *
 * 처리 범위:
 * - 실제 문제 텍스트, 보기 텍스트, 해설 내용 자체는 변경하지 않습니다.
 * - CSV 구분자 주변의 위험한 공백만 정리합니다.
 */
function normalizeCsvText(rawText) {
    return rawText
        .replace(/^\uFEFF/, '')
        .replace(/,\s+"/g, ',"');
}

/**
 * CSV 파일을 읽어서 배열로 반환합니다.
 * csv-parser를 Promise로 감싸서 async/await 흐름에서 사용할 수 있게 만들었습니다.
 */
function parseCsvFile(filePath, label) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            reject(new Error(`${label} 파일이 없습니다: ${filePath}`));
            return;
        }

        const rows = [];
        const rawText = fs.readFileSync(filePath, 'utf8');
        const normalizedText = normalizeCsvText(rawText);

        Readable.from([normalizedText])
            .pipe(csv({
                mapHeaders: ({ header }) => cleanHeader(header),
                mapValues: ({ value }) => cleanValue(value),
                strict: false
            }))
            .on('data', (row) => {
                // 닫히지 않은 큰따옴표 때문에 한 칸에 여러 줄이 흡수되는 치명적 오류를 방지합니다.
                for (const key of Object.keys(row)) {
                    const value = row[key];
                    if (typeof value === 'string' && value.includes('\n') && value.length >500) {
                        reject(new Error(
                            `${label}에서 닫히지 않은 큰따옴표 의심 값이 발견되었습니다. ` +
                            `컬럼: ${key}, 시작 내용: ${value.substring(0, 120)}`
                        ));
                        return;
                    }
                }
                rows.push(row);
            })
            .on('error', (err) => reject(err))
            .on('end', () => resolve(rows));
    });
}

/**
 * year + session + info_id 조합으로 문제를 고유하게 찾기 위한 키를 만듭니다.
 * 예: 2025|1|1
 */
function makeQuestionKey(row) {
    return `${cleanValue(row.year)}|${cleanValue(row.session)}|${cleanValue(row.info_id)}`;
}

/**
 * 객관식 정답 번호가 1~4인지 확인하고 숫자로 변환합니다.
 * answers.correct_label은 TINYINT이므로 반드시 숫자 1~4만 들어가야 안전합니다.
 */
function parseAnswerNumber(value, context) {
    const cleaned = cleanValue(value);
    const answerNumber = Number(cleaned);

    if (!Number.isInteger(answerNumber) || answerNumber < 1 || answerNumber >4) {
        throw new Error(`${context}의 정답 값이 1~4가 아닙니다. 현재 값: ${value}`);
    }

    return answerNumber;
}

/**
 * 이미지 파일명인지 확인합니다.
 * exam_bank_final.csv 일부 행은 question_img 값이 question_img 컬럼이 아니라 _3 컬럼에 밀려 있습니다.
 * 이 경우 이미지 파일명만 안전하게 구출하기 위해 사용합니다.
 */
function looksLikeImageFile(value) {
    if (!value) return false;
    return /^[A-Za-z0-9_\-.]+\.(png|jpg|jpeg|gif|webp)$/i.test(String(value).trim());
}

/**
 * question_img 값을 안전하게 찾습니다.
 *
 * 현재 exam_bank_final.csv에는 Column1, _1, _2, _3 같은 빈 보조 컬럼이 있습니다.
 * 일부 이미지 문제는 마지막 빈 컬럼 수가 부족해서 question_img가 _3에 들어간 경우가 있습니다.
 * 예: 20250176.png, 20250373.png, 20230345.png
 *
 * 이 함수는 정상 question_img를 우선 사용하고,
 * 없으면 _3, _2, _1, Column1 중 이미지 파일명처럼 보이는 값만 가져옵니다.
 */
function getQuestionImage(row) {
    const directImage = cleanValue(row.question_img);
    if (looksLikeImageFile(directImage)) return directImage;

    const fallbackColumns = ['_3', '_2', '_1', 'Column1'];
    for (const columnName of fallbackColumns) {
        const candidate = cleanValue(row[columnName]);
        if (looksLikeImageFile(candidate)) return candidate;
    }

    return null;
}

/**
 * Column1, _1, _2, _3 보조 컬럼에 위험한 값이 들어갔는지 확인합니다.
 *
 * 허용하는 값:
 * - 빈 값: 원래 비어 있는 보조 컬럼이므로 정상
 * - 이미지 파일명: question_img가 한 칸 앞에 들어간 경우라서 getQuestionImage()로 복구 가능
 * - 0: 기존 CSV에 남아 있는 의미 없는 더미 값으로 판단하여 경고만 하고 무시
 *
 * 그 외 긴 문장이나 보기 텍스트가 들어가 있으면  컬럼 밀림일 수 있으므로 중단합니다.
 */
function findDangerousDummyValues(row) {
    const dummyColumns = ['Column1', '_1', '_2', '_3'];
    const dangerousValues = [];

    for (const columnName of dummyColumns) {
        const value = cleanValue(row[columnName]);
        if (!value) continue;
        if (looksLikeImageFile(value)) continue;
        if (String(value) === '0') continue;

        dangerousValues.push(`${columnName}=${String(value).substring(0, 80)}`);
    }

    return dangerousValues;
}

/**
 * 과목명을 기존 우공실 subject 코드로 변환합니다.
 * 기존 upload_csv.js의 과목 매핑 로직을 유지합니다.
 */
function getSubjectCode(subjectName) {
    if (!subjectName) return null;

    if (subjectName.includes('설계')) return 10;
    if (subjectName.includes('개발')) return 11;
    if (subjectName.includes('데이터베이스')) return 12;
    if (subjectName.includes('프로그래밍')) return 13;
    if (subjectName.includes('정보시스템')) return 14;

    return null;
}

// 4. CSV 사전 검증 함수

/**
 * 문제 CSV와 해설 CSV를 DB에 넣기 전에 먼저 검증합니다.
 * DB에 반쯤 들어간 뒤 에러가 나는 일을 막기 위한 안전장치입니다.
 */
function validateCsvData(questionRows, explanationRows) {
    console.log('\n CSV 사전 검증을 시작합니다...');

    if (questionRows.length !== 1500) {
        throw new Error(`exam_bank_final.csv 행 수가 1500개가 아닙니다. 현재: ${questionRows.length}개`);
    }

    if (explanationRows.length !== 1500) {
        throw new Error(`explan_checked_final.csv 행 수가 1500개가 아닙니다. 현재: ${explanationRows.length}개`);
    }

    const explanationMap = new Map();

    for (const row of explanationRows) {
        const key = makeQuestionKey(row);

        if (explanationMap.has(key)) {
            throw new Error(`해설 CSV에 중복 키가 있습니다: ${key}`);
        }

        const explanation = cleanValue(row.explanation);
        if (!explanation) {
            throw new Error(`해설 CSV에 빈 해설이 있습니다: ${key}`);
        }

        parseAnswerNumber(row.answer, `해설 CSV ${key}`);
        explanationMap.set(key, row);
    }

    const questionKeySet = new Set();
    const warningRows = [];

    for (const row of questionRows) {
        const key = makeQuestionKey(row);

        if (questionKeySet.has(key)) {
            throw new Error(`문제 CSV에 중복 키가 있습니다: ${key}`);
        }
        questionKeySet.add(key);

        if (!cleanValue(row.year) || !cleanValue(row.session) || !cleanValue(row.info_id)) {
            throw new Error(`문제 CSV에 year/session/info_id 누락 행이 있습니다: ${JSON.stringify(row)}`);
        }

        if (!cleanValue(row.question)) {
            throw new Error(`문제 CSV에 question 누락 행이 있습니다: ${key}`);
        }

        const questionAnswer = parseAnswerNumber(row.answer, `문제 CSV ${key}`);
        const explanationRow = explanationMap.get(key);

        if (!explanationRow) {
            throw new Error(`문제 ${key}에 해당하는 해설이 explan_checked_final.csv에 없습니다.`);
        }

        const explanationAnswer = parseAnswerNumber(explanationRow.answer, `해설 CSV ${key}`);
        if (questionAnswer !== explanationAnswer) {
            throw new Error(
                `문제 CSV와 해설 CSV의 정답이 다릅니다. ` +
                `키: ${key}, 문제 정답: ${questionAnswer}, 해설 정답: ${explanationAnswer}`
            );
        }

        const dangerousValues = findDangerousDummyValues(row);
        if (dangerousValues.length >0) {
            throw new Error(
                `exam_bank_final.csv에서 실제 컬럼 밀림으로 의심되는 값이 있습니다. ` +
                `키: ${key}, 값: ${dangerousValues.join(', ')}`
            );
        }

        const rescuedImage = getQuestionImage(row);
        const directImage = cleanValue(row.question_img);
        if (!directImage && rescuedImage) {
            warningRows.push(`${key} -> ${rescuedImage}`);
        }
    }

    if (warningRows.length >0) {
        console.log('question_img가 _3/_2/_1/Column1 쪽에 들어간 행을 자동 보정했습니다.');
        console.log(` 보정 개수: ${warningRows.length}개`);
        console.log(` 예시: ${warningRows.slice(0, 5).join(' / ')}`);
    }

    console.log('CSV 사전 검증 완료: 문제와 해설 매칭이 정상입니다.');
    return explanationMap;
}

// 5. DB 테이블 재생성 함수

/**
 * 필기 문제 마스터 테이블을 재생성합니다.
 *
 * 재생성 대상:
 * - options
 * - answers
 * - questions
 *
 * 왜 answers도 재생성하나?
 * - 이번 작업의 목표가 answers.explanation_text에 필기 해설을 넣는 것이기 때문입니다.
 * - answers.question_id는 questions.question_id를 참조하므로 questions를 다시 만들면 answers도 다시 맞춰 넣는 게 안전합니다.
 */
async function recreateWrittenExamTables(connection) {
    console.log('\n 필기 문제 테이블을 재생성합니다...');

    await connection.query(' SET FOREIGN_KEY_CHECKS = 0');

    // 외래키 관계 때문에 자식 테이블부터 삭제합니다.
    await connection.query('DROP TABLE IF EXISTS options');
    await connection.query('DROP TABLE IF EXISTS answers');
    await connection.query('DROP TABLE IF EXISTS questions');

    // questions: 문제 본문과 문제 이미지 경로를 저장합니다.
    await connection.query(`CREATE TABLE questions (
            question_id INT NOT NULL AUTO_INCREMENT,
            year INT NULL DEFAULT NULL,
            session INT NULL DEFAULT NULL,
            info_id INT NULL DEFAULT NULL,
            subject INT NULL DEFAULT NULL,
            question TEXT NULL DEFAULT NULL,
            question_img VARCHAR(255) NULL DEFAULT NULL,
            PRIMARY KEY (question_id),
            INDEX idx_questions_year_session_info (year, session, info_id),
            INDEX idx_questions_subject (subject)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // answers: 정답 번호와 해설 텍스트를 저장합니다.
    // 이번 해설 CSV의 핵심 적재 대상은 explanation_text입니다.
    await connection.query(`CREATE TABLE answers (
            question_id INT NOT NULL,
            correct_label TINYINT NOT NULL,
            explanation_text TEXT NULL DEFAULT NULL,
            explanation_img VARCHAR(255) NULL DEFAULT NULL,
            PRIMARY KEY (question_id),
            CONSTRAINT answers_ibfk_1
                FOREIGN KEY (question_id)
                REFERENCES questions(question_id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // options: 사지선다형 보기와 기존 answer 텍스트를 저장합니다.
    // 기존 프론트/백엔드가 options.answer를 참조할 가능성이 있으므로 answer 컬럼은 유지합니다.
    await connection.query(`CREATE TABLE options (
            option_id INT NOT NULL AUTO_INCREMENT,
            question_id INT NULL DEFAULT NULL,
            opt1 TEXT NULL DEFAULT NULL,
            opt2 TEXT NULL DEFAULT NULL,
            opt3 TEXT NULL DEFAULT NULL,
            opt4 TEXT NULL DEFAULT NULL,
            answer TEXT NULL DEFAULT NULL,
            PRIMARY KEY (option_id),
            INDEX question_id (question_id),
            CONSTRAINT options_ibfk_1
                FOREIGN KEY (question_id)
                REFERENCES questions(question_id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await connection.query(' SET FOREIGN_KEY_CHECKS = 1');
    console.log('questions/options/answers 테이블 재생성 완료');
}

// 6. DB 적재 함수

/**
 * 문제, 보기, 정답, 해설을 하나의 트랜잭션으로 적재합니다.
 * 중간에 하나라도 실패하면 rollback되어 반쪽짜리 데이터가 남지 않습니다.
 */
async function insertWrittenExamData(connection, questionRows, explanationMap) {
    console.log('\n 문제/보기/정답/해설을 DB에 적재합니다...');

    await connection.beginTransaction();

    try {
        for (let i = 0; i < questionRows.length; i++) {
            const row = questionRows[i];
            const key = makeQuestionKey(row);
            const explanationRow = explanationMap.get(key);

            const subjectCode = getSubjectCode(cleanValue(row.subject));
            const questionImage = getQuestionImage(row);
            const answerNumber = parseAnswerNumber(row.answer, `문제 CSV ${key}`);
            const explanationText = cleanValue(explanationRow.explanation);

            // 1) questions 테이블에 문제 본문을 저장합니다.
            const [questionResult] = await connection.query(`INSERT INTO questions
                    (year, session, info_id, subject, question, question_img)
                VALUES
                    (?, ?, ?, ?, ?, ?)
            `, [
                Number(row.year),
                Number(row.session),
                Number(row.info_id),
                subjectCode,
                cleanValue(row.question),
                questionImage
            ]);

            const insertedQuestionId = questionResult.insertId;

            // 2) options 테이블에 보기 1~4와 기존 answer 값을 저장합니다.
            // 기존 코드/화면에서 options.answer를 참조할 수 있으므로 answer도 그대로 유지합니다.
            await connection.query(`INSERT INTO options
                    (question_id, opt1, opt2, opt3, opt4, answer)
                VALUES
                    (?, ?, ?, ?, ?, ?)
            `, [
                insertedQuestionId,
                cleanValue(row.opt1),
                cleanValue(row.opt2),
                cleanValue(row.opt3),
                cleanValue(row.opt4),
                String(answerNumber)
            ]);

            // 3) answers 테이블에 정답 번호와 해설을 저장합니다.
            // 이번 작업의 핵심: explanation_text에 해설이 들어갑니다.
            await connection.query(`INSERT INTO answers
                    (question_id, correct_label, explanation_text, explanation_img)
                VALUES
                    (?, ?, ?, ?)
            `, [
                insertedQuestionId,
                answerNumber,
                explanationText,
                null
            ]);
        }

        await connection.commit();
        console.log(` 성공: ${questionRows.length}개의 필기 문제와 해설을 적재했습니다.`);
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

// 7. 적재 결과 검증 함수

/**
 * 적재가 끝난 뒤 DB 안의 개수와 해설 누락 여부를 확인합니다.
 */
async function verifyInsertedData(connection) {
    console.log('\n 적재 결과 검증');

    const [[questionCountRow]] = await connection.query('SELECT COUNT(*) AS cnt FROM questions');
    const [[optionCountRow]] = await connection.query('SELECT COUNT(*) AS cnt FROM options');
    const [[answerCountRow]] = await connection.query('SELECT COUNT(*) AS cnt FROM answers');

    const [[missingExplanationRow]] = await connection.query(`SELECT COUNT(*) AS cnt
        FROM answers
        WHERE explanation_text IS NULL OR TRIM(explanation_text) = ''
    `);

    const [[mismatchRow]] = await connection.query(`SELECT COUNT(*) AS cnt
        FROM options o
        JOIN answers a
            ON a.question_id = o.question_id
        WHERE TRIM(o.answer) REGEXP '^[1-4]$' AND CAST(TRIM(o.answer) AS UNSIGNED) <>a.correct_label
    `);

    console.log(`- questions: ${questionCountRow.cnt}개`);
    console.log(`- options: ${optionCountRow.cnt}개`);
    console.log(`- answers: ${answerCountRow.cnt}개`);
    console.log(`- 해설 누락: ${missingExplanationRow.cnt}개`);
    console.log(`- options.answer와 answers.correct_label 불일치: ${mismatchRow.cnt}개`);

    if (
        questionCountRow.cnt !== 1500 ||
        optionCountRow.cnt !== 1500 ||
        answerCountRow.cnt !== 1500 ||
        missingExplanationRow.cnt !== 0 ||
        mismatchRow.cnt !== 0
    ) {
        throw new Error('적재 후 검증에서 이상 값이 발견되었습니다. 위 검증 결과를 확인해주세요.');
    }

    console.log(' 검증 완료: 필기 문제와 해설이 정상 적재되었습니다.');
}

// 8. 메인 실행 함수
async function uploadData() {
    let connection;

    try {
        console.log('CSV 파일을 읽는 중입니다...');
        console.log(`- 문제 CSV: ${QUESTION_CSV_PATH}`);
        console.log(`- 해설 CSV: ${EXPLANATION_CSV_PATH}`);

        const questionRows = await parseCsvFile(QUESTION_CSV_PATH, 'exam_bank_final.csv');
        const explanationRows = await parseCsvFile(EXPLANATION_CSV_PATH, 'explan_checked_final.csv');

        console.log(` 문제 CSV 파싱 완료: ${questionRows.length}개`);
        console.log(` 해설 CSV 파싱 완료: ${explanationRows.length}개`);

        const explanationMap = validateCsvData(questionRows, explanationRows);

        connection = await pool.getConnection();

        await recreateWrittenExamTables(connection);
        await insertWrittenExamData(connection, questionRows, explanationMap);
        await verifyInsertedData(connection);

    } catch (error) {
        console.error('\n 처리 중 에러 발생');
        console.error(error.message);

        if (connection) {
            try {
                await connection.query(' SET FOREIGN_KEY_CHECKS = 1');
            } catch (fkError) {
                console.error(' 외래키 검사 복구 중 추가 오류:', fkError.message);
            }
        }

        process.exitCode = 1;
    } finally {
        if (connection) connection.release();
        await pool.end();
    }
}

uploadData();

// 실행 명령어:
// node scripts/upload_written_csv.js
