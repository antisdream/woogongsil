// 유지보수용으로 필기 문제 데이터를 다시 적재합니다.
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { loadEnvFile } = require('../config/env');
const { createDatabasePool } = require('../config/database');

// 정보처리기사 필기 CSV ->MySQL 적재 스크립트
// - 기존 기능: exam_bank_final.csv를 읽어서 questions/options 테이블 재생성 후 적재
// - 추가 기능: CSV 재적재 후 기존 answers.correct_label을 최신 options.answer 기준으로 자동 동기화
// - 주의: 실기 테이블(ipep_random_questions, ipep_past_questions)은 변경하지 않습니다.

loadEnvFile();

if (process.env.WGS_ALLOW_DANGEROUS_DATA_RELOAD !== 'YES_I_UNDERSTAND') {
    console.error('Refusing to run: this legacy script drops/recreates written exam tables.');
    console.error('Set WGS_ALLOW_DANGEROUS_DATA_RELOAD=YES_I_UNDERSTAND only when you intentionally want to reload production-like data.');
    process.exit(1);
}

const DATA_DIR = path.resolve(__dirname, '..', 'data', 'written-explanations');
const pool = createDatabasePool();

/**
 * answers 테이블이 존재하는지 확인합니다.
 *
 * 왜 필요한가?
 * - 개발 초기/새 PC에서는 answers 테이블이 아직 없을 수 있습니다.
 * - 이 경우 CSV 적재 자체가 실패하면 안 되므로, 없으면 정답 동기화만 건너뜁니다.
 */
async function hasAnswersTable(connection) {
    const [rows] = await connection.query(`SHOW TABLES LIKE 'answers'`);
    return rows.length >0;
}

/**
 * answers.correct_label 컬럼이 존재하는지 확인합니다.
 *
 * 왜 필요한가?
 * - 예전 DB 구조와 최신 DB 구조가 다를 수 있습니다.
 * - correct_label 컬럼이 없으면 업데이트 쿼리를 실행하지 않아야 안전합니다.
 */
async function hasCorrectLabelColumn(connection) {
    const [rows] = await connection.query(`SHOW COLUMNS FROM answers LIKE 'correct_label'`);
    return rows.length >0;
}

/**
 * CSV 재적재 이후 기존 응시 기록의 정답 기준을 최신 options.answer 기준으로 맞춥니다.
 *
 * 이 함수가 해결하는 문제:
 * - 페이지에서는 정답 표시 시 COALESCE(answers.correct_label, options.answer) 흐름을 사용할 수 있습니다.
 * - 기존 answers.correct_label에 예전 정답이 남아 있으면,
 *  CSV를 최신으로 다시 적재해도 화면에서는 예전 정답이 우선 표시될 수 있습니다.
 * - 그래서 CSV 적재가 끝난 뒤 answers.correct_label을 최신 options.answer로 자동 동기화합니다.
 *
 * 안전장치:
 * - 필기문제 정답은 1, 2, 3, 4 같은 객관식 번호여야 합니다.
 * - answers.correct_label 컬럼이 INT 타입일 수 있으므로,
 *  '카디널리티 : 6' 같은 문자열 정답은 절대 넣지 않도록 숫자 1~4만 업데이트합니다.
 * - 실기문제 테이블은 이 함수에서 전혀 접근하지 않습니다.
 */
async function syncWrittenAnswerLabels(connection) {
    console.log('\n 기존 필기 응시 기록의 정답 기준을 최신 CSV 기준으로 동기화합니다...');

    const answersTableExists = await hasAnswersTable(connection);
    if (!answersTableExists) {
        console.log('answers 테이블이 없어 정답 동기화를 건너뜁니다. CSV 적재는 정상 완료되었습니다.');
        return;
    }

    const correctLabelExists = await hasCorrectLabelColumn(connection);
    if (!correctLabelExists) {
        console.log('answers.correct_label 컬럼이 없어 정답 동기화를 건너뜁니다. CSV 적재는 정상 완료되었습니다.');
        return;
    }

    // 1) options.answer 중 숫자 1~4가 아닌 값이 있는지 먼저 확인합니다.
    //  correct_label이 INT 타입인 경우 문자열을 넣으면 MySQL 1366 에러가 발생하기 때문입니다.
    const [invalidAnswerRows] = await connection.query(`SELECT COUNT(*) AS invalid_count
        FROM options
        WHERE answer IS NOT NULL
          AND TRIM(answer) <> '' AND TRIM(answer) NOT REGEXP '^[1-4]$'
    `);

    const invalidCount = invalidAnswerRows[0]?.invalid_count || 0;
    if (invalidCount >0) {
        console.log(`options.answer 중 객관식 번호(1~4)가 아닌 값이 ${invalidCount}개 있습니다.`);
        console.log(' 해당 값들은 answers.correct_label에 넣지 않고 건너뜁니다.');
        console.log(' 필기 CSV의 answer 컬럼은 가능하면 1, 2, 3, 4 형태로 관리해주세요.');
    }

    // 2) 최신 CSV에서 다시 들어간 options.answer를 기준으로 answers.correct_label을 업데이트합니다.
    //  - TRIM(o.answer) REGEXP '^[1-4]$' 조건으로 숫자형 정답만 반영합니다.
    //  - CAST(... AS UNSIGNED)를 사용해서 INT 컬럼에도 안전하게 들어가도록 합니다.
    const [syncResult] = await connection.query(`UPDATE answers a
        JOIN options o
            ON o.question_id = a.question_id
        SET
            a.correct_label = CAST(TRIM(o.answer) AS UNSIGNED)
        WHERE
            o.answer IS NOT NULL
            AND TRIM(o.answer) REGEXP '^[1-4]$' AND (
                a.correct_label IS NULL
                OR a.correct_label <>CAST(TRIM(o.answer) AS UNSIGNED)
            )
    `);

    console.log(` 정답 동기화 완료: ${syncResult.affectedRows}개의 기존 응시 기록을 최신 정답으로 갱신했습니다.`);

    // 3) 동기화 후에도 화면 표시 기준과 CSV 정답이 다른 데이터가 있는지 검증합니다.
    //  화면에서 COALESCE(answers.correct_label, options.answer)를 사용하더라도,
    //  이제 correct_label이 최신 정답과 맞아야 합니다.
    const [mismatchRows] = await connection.query(`SELECT COUNT(*) AS mismatch_count
        FROM answers a
        JOIN options o
            ON o.question_id = a.question_id
        WHERE
            o.answer IS NOT NULL
            AND TRIM(o.answer) REGEXP '^[1-4]$' AND a.correct_label <>CAST(TRIM(o.answer) AS UNSIGNED)
    `);

    const mismatchCount = mismatchRows[0]?.mismatch_count || 0;
    if (mismatchCount === 0) {
        console.log(' 검증 완료: 기존 answers.correct_label과 최신 options.answer가 일치합니다.');
    } else {
        console.log(` 검증 필요: 아직 ${mismatchCount}개의 정답 기준이 일치하지 않습니다.`);
        console.log(' 이 경우 answers 테이블 구조나 question_id 매칭 상태를 추가 확인해야 합니다.');
    }
}

async function uploadData() {
    const results = [];
    const CSV_FILE_PATH = path.join(DATA_DIR, 'exam_bank_final.csv');

    if (!fs.existsSync(CSV_FILE_PATH)) {
        console.error(` 에러: ${CSV_FILE_PATH} 파일이 없습니다.`);
        process.exit(1);
    }

    console.log('CSV 파일을 읽고 분석하는 중입니다...');

    fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv({
            // CSV 헤더 앞에 숨어 들어오는 BOM 문자를 제거합니다.
            mapHeaders: ({ header }) => header.trim().replace(/^[\uFEFF\xEF\xBB\xBF]+/, ''),

            // 빈 문자열은 DB에 빈 값으로 넣지 않고 null로 정리합니다.
            mapValues: ({ value }) => {
                if (typeof value === 'string') {
                    const trimmed = value.trim();
                    return trimmed === ''? null : trimmed;
                }
                return value;
            }
        }))
        .on('error', (err) => {
            console.error('CSV 파싱 에러:', err);
            process.exit(1);
        })
        .on('data', (data) => {
            //  [기존 핵심 기능 유지] 블랙홀(따옴표 미수렴) 탐지기
            // CSV 안에서 큰따옴표(")가 닫히지 않으면 여러 문제가 한 칸에 흡수될 수 있습니다.
            // 이런 경우 DB에 잘못 적재되기 전에 즉시 중단합니다.
            for (const key in data) {
                if (data[key] && typeof data[key] === 'string' && data[key].includes('\n') && data[key].length >500) {
                    console.error(`\n [치명적 오류 발견!] 닫히지 않은 큰따옴표(\") 때문에 아래 내용이 통째로 흡수되었습니다.`);
                    console.error(` 따옴표가 열리고 안 닫힌 문제의 시작 부분:\n\n"${data[key].substring(0, 150)} ... (이하 생략)"\n`);
                    console.error(` 해결 방법: VS Code나 엑셀에서 원본 CSV 파일을 열고, 위 문장을 검색(Ctrl+F)하여 그 근처에 있는 큰따옴표(\")의 짝을 맞춰주거나 지워주세요!\n`);
                    process.exit(1);
                }
            }
            results.push(data);
        })
        .on('end', async () => {
            console.log(`CSV 파싱 완료! 총 [ ${results.length} ] 개의 문제가 발견되었습니다.`);

            // 문제가 비정상적으로 적게 읽혔다면 CSV 구조가 깨진 것이므로 적재하지 않습니다.
            if (results.length < 1000) {
                console.log(` 주의: 문제가 여전히 ${results.length}개밖에 없습니다. 데이터를 적재하지 않고 중단합니다.`);
                process.exit(1);
            }

            const connection = await pool.getConnection();
            try {
                console.log('DB 테이블 구조를 초기화합니다...');

                // 기존 필기 문제/보기 테이블을 재생성하기 위해 외래키 검사를 잠시 끕니다.
                await connection.query(' SET FOREIGN_KEY_CHECKS = 0');
                await connection.query('DROP TABLE IF EXISTS options');
                await connection.query('DROP TABLE IF EXISTS questions');

                await connection.query(`CREATE TABLE questions (
                        question_id INT AUTO_INCREMENT PRIMARY KEY,
                        year INT,
                        session INT,
                        info_id INT,
                        subject INT,
                        question TEXT,
                        question_img VARCHAR(255)
                    )
                `);

                await connection.query(`CREATE TABLE options (
                        option_id INT AUTO_INCREMENT PRIMARY KEY,
                        question_id INT,
                        opt1 TEXT,
                        opt2 TEXT,
                        opt3 TEXT,
                        opt4 TEXT,
                        answer TEXT,
                        FOREIGN KEY (question_id) REFERENCES questions(question_id) ON DELETE CASCADE
                    )
                `);

                // 테이블 재생성이 끝났으므로 외래키 검사를 다시 켭니다.
                await connection.query(' SET FOREIGN_KEY_CHECKS = 1');
                console.log(' 테이블 초기화 완료!');

                await connection.beginTransaction();
                console.log(' 데이터를 DB에 안전하게 적재하는 중입니다...');

                for (let i = 0; i < results.length; i++) {
                    const row = results[i];
                    const imgValue = row.question_img || null;

                    // CSV의 subject 텍스트를 기존 우공실 필기 과목 코드로 변환합니다.
                    // 과목명 포함 여부를 기준으로 subjectCode를 결정합니다.
                    let subjectCode = null;
                    if (row.subject) {
                        if (row.subject.includes('설계')) subjectCode = 10;
                        else if (row.subject.includes('개발')) subjectCode = 11;
                        else if (row.subject.includes('데이터베이스')) subjectCode = 12;
                        else if (row.subject.includes('프로그래밍')) subjectCode = 13;
                        else if (row.subject.includes('정보시스템')) subjectCode = 14;
                    }

                    const questionQuery = `INSERT INTO questions
                            (year, session, info_id, subject, question, question_img)
                        VALUES
                            (?, ?, ?, ?, ?, ?)
                    `;
                    const [qResult] = await connection.query(questionQuery, [
                        row.year,
                        row.session,
                        row.info_id,
                        subjectCode,
                        row.question,
                        imgValue
                    ]);

                    const insertedQuestionId = qResult.insertId;

                    const optionQuery = `INSERT INTO options
                            (question_id, opt1, opt2, opt3, opt4, answer)
                        VALUES
                            (?, ?, ?, ?, ?, ?)
                    `;
                    await connection.query(optionQuery, [
                        insertedQuestionId,
                        row.opt1,
                        row.opt2,
                        row.opt3,
                        row.opt4,
                        row.answer
                    ]);
                }

                await connection.commit();
                console.log(` 성공: ${results.length}개의 모든 문제가 성공적으로 적재되었습니다!`);

                // 1) 최신 CSV가 questions/options에 정상 적재되는지 확인합니다.
                // 2) 기존 answers 테이블 존재 여부를 확인합니다.
                // 3) 기존 answers.correct_label을 최신 options.answer 기준으로 동기화합니다.
                // 4) 동기화 후 화면 표시 정답과 최신 CSV 정답이 일치하는지 검증합니다.
                await syncWrittenAnswerLabels(connection);

            } catch (error) {
                // 트랜잭션 중 오류가 발생하면 변경 내용을 롤백합니다.
                // beginTransaction 이전 오류에서는 rollback이 실패할 수 있으므로 try/catch로 감쌉니다.
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    // rollback 실패는 원래 오류를 가리지 않도록 로그만 남깁니다.
                    console.error(' 롤백 중 추가 오류가 발생했습니다:', rollbackError.message);
                }

                // 외래키 검사가 꺼진 상태로 남지 않도록 복구합니다.
                try {
                    await connection.query(' SET FOREIGN_KEY_CHECKS = 1');
                } catch (fkError) {
                    console.error(' 외래키 검사 복구 중 오류가 발생했습니다:', fkError.message);
                }

                console.error(` 처리 중 에러 발생:`, error);
            } finally {
                connection.release();
                await pool.end();
                process.exit();
            }
        });
}

uploadData();

// 실행 명령어:
// WGS_ALLOW_DANGEROUS_DATA_RELOAD=YES_I_UNDERSTAND node scripts/이전 구조_reload_written_questions.js
