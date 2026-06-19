// ipepRoutes.js
// 역할:
// 1. 정보처리기사 실기 문제 API만 따로 모아둔 라우터 파일입니다.
// 2. 기존 필기 API, 게시판 API, 로그인 API와 분리해 관리합니다.
// 3. 이 파일에서 에러가 나도 server.js 쪽 try/catch에서 잡히도록 설계합니다.
// 4. 모든 API 경로는 서버 진입점에서 /api/ipep 아래로 연결됩니다.
// 실제 API 예시:
// GET /api/ipep/health
// GET /api/ipep/subjects
// GET /api/ipep/random-question?subjectCode=ALL
// GET /api/ipep/random-question?subjectCode=01
// GET /api/ipep/exam-catalog
// GET /api/ipep/past-exam?year=2020&session=1
// POST /api/ipep/check-answer
// 주의:
// - 이 파일은 DB pool을 직접 만들지 않는다.
// - 기존 서버 진입점에서 이미 만든 pool을 전달받아 사용합니다.
// - 그래서 DB 연결 설정이 중복되지 않는다.


// Express 라우터를 만들기 위해 express를 불러온다.
const express = require('express');


// 1. 공통 문자열 정리 함수


function cleanText(value) {
    // 값이 없으면 빈 문자열로 처리합니다.
    if (value === null || value === undefined) {
        return '';
    }

    // 문자열로 바꾼 뒤 앞뒤 공백을 제거합니다.
    return String(value).trim();
}

function parseRandomCsv(value, maxItems = 80) {
    const raw = Array.isArray(value) ? value.join(',') : String(value || '');
    const seen = new Set();
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
            if (seen.has(item)) return false;
            seen.add(item);
            return true;
        })
        .slice(0, maxItems);
}

function parseRandomIdCsv(value, maxItems = 80) {
    return parseRandomCsv(value, maxItems)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >0);
}


// 2. 채점용 정규화 함수
// 실기 문제는 용어형, SQL형, 코드 출력형이 섞여 있습니다.
// 그래서 정답 비교 함수를 여러 개로 나눈다.


function normalizeFlexible(value) {
    // 일반 용어형 정답 채점에 사용합니다.
    // 예: Agile, agile, AGILE을 같은 답으로 보기 위한 처리입니다.
    // 현재 규칙:
    // 기존에는 쉼표(,) 같은 구분자를 너무 엄격하게 봐서
    // "Authentication, authorization Accounting"처럼 쉼표 하나가 빠진 답안이
    // 실제 용어가 포함되어도 낮은 점수를 받는 문제를 보완합니다.
    // 그래서 용어형 채점에서는 공백/쉼표/하이픈/대부분의 문장부호를 완화합니다.
    // 단, SQL_TEXT와 EXACT_OUTPUT은 별도 함수로 채점하므로 이 완화 규칙의 영향을 받지 않습니다.
    let text = cleanText(value);

    // CSV에 문자 그대로 들어간 \n을 실제 줄바꿈처럼 통일합니다.
    text = text.replace(/\\n/g, '\n');

    // 줄바꿈 형식을 통일합니다.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 유니코드 표현 차이를 줄입니다.
    text = text.normalize('NFKC');

    // 영어 대소문자를 무시하기 위해 소문자로 변환합니다.
    text = text.toLowerCase();

    // 따옴표류는 용어형 채점에서 큰 의미가 없으므로 제거합니다.
    text = text.replace(/[“”‘’\"']/g, '');

    // 용어형에서는 대부분의 문장부호를 제거합니다.
    // 예: Cause-Effect Graph, Cause Effect Graph, Cause.effect graph를 같은 답으로 보기 위한 처리입니다.
    // 주의: 이 함수는 SQL이나 코드 출력 채점에는 사용하지 않습니다.
    text = text.replace(/[.,。·!?:;，、_\-—–\/\\()[\]{}<>|]/g, '');

    // 공백과 줄바꿈을 제거합니다.
    text = text.replace(/\s+/g, '');

    return text.trim();
}



function normalizeExactOutput(value) {
    // 코드 출력 문제에 사용합니다.
    // 출력 문제는 대소문자, 공백, 줄바꿈이 중요하므로 최대한 보존합니다.
    let text = cleanText(value);

    // 문자 그대로의 \n을 실제 줄바꿈으로 변환합니다.
    text = text.replace(/\\n/g, '\n');

    // 줄바꿈 형식만 통일합니다.
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 앞뒤 공백만 제거합니다.
    return text.trim();
}


function normalizeSql(value) {
    // SQL 문제에 사용합니다.
    // SQL은 대소문자와 여러 칸 공백은 크게 중요하지 않게 보되,
    // SELECT, WHERE, 괄호, 비교연산자 같은 문법 기호는 보존합니다.
    let text = cleanText(value);

    // 줄바꿈을 공백으로 변환합니다.
    text = text.replace(/\\n/g, ' ');
    text = text.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');

    // 유니코드 표현 차이를 줄입니다.
    text = text.normalize('NFKC');

    // 영어 대소문자를 무시합니다.
    text = text.toLowerCase();

    // SQL 마지막 세미콜론은 써도 되고 안 써도 되게 처리합니다.
    text = text.replace(/;$/g, '');

    // 쉼표와 괄호 주변 공백 차이를 줄입니다.
    text = text.replace(/\s*,\s*/g, ',');
    text = text.replace(/\s*\(\s*/g, '(');
    text = text.replace(/\s*\)\s*/g, ')');

    // 여러 공백을 하나로 줄입니다.
    text = text.replace(/\s+/g, ' ');

    return text.trim();
}


// 3. JSON 안전 파싱 함수


function safeJsonParse(value, fallback) {
    try {
        if (Array.isArray(value) || typeof value === 'object') {
            return value || fallback;
        }

        if (!value) {
            return fallback;
        }

        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}


// 4. 정답 슬롯 분리 함수
// MULTI_TERM 문제에서 사용자 답안을 쉼표 또는 줄바꿈 기준으로 나눈다.
// 예: "원자성, 독립성" 또는 "원자성\n독립성"
function splitUserSlots(userAnswer) {
    // 사용자가 쉼표나 줄바꿈으로 답을 나누어 입력한 경우를 위한 보조 함수입니다.
    // 다만 현재 동작 기준으로는 쉼표가 빠진 답안도 최대한 인정하기 위해
    // calculateMultiTermScore에서 "전체 답안에 용어가 포함되어 있는지"도 함께 확인합니다.
    const raw = cleanText(userAnswer);

    if (!raw) {
        return [];
    }

    return raw
        .replace(/\\n/g, '\n')
        .split(/,|\n|\/|;|\|/)
        .map(item => normalizeFlexible(item))
        .filter(item => item !== '');
}


function isAliasMatchedByUser(alias, userSlots, normalizedWholeUserAnswer) {
    // 정답 별칭 하나가 사용자의 답안에 들어있는지 확인합니다.
    const normalizedAlias = normalizeFlexible(alias);

    if (!normalizedAlias) {
        return false;
    }

    // 1글자짜리 별칭은 전체 문자열 포함으로 보면 오탐 가능성이 높습니다.
    // 예: C, O 같은 답은 반드시 분리된 슬롯과 정확히 일치할 때만 인정합니다.
    if (normalizedAlias.length <= 1) {
        return userSlots.includes(normalizedAlias);
    }

    // 1순위: 쉼표/줄바꿈 등으로 나뉜 슬롯 중 정확히 일치하는지 확인합니다.
    if (userSlots.includes(normalizedAlias)) {
        return true;
    }

    // 2순위: 사용자가 쉼표를 빼먹었더라도 전체 답안 안에 해당 용어가 들어있으면 인정합니다.
    // 예: "Authentication, authorization Accounting" 안에는
    // authentication / authorization / accounting이 모두 들어있으므로 3개 모두 인정합니다.
    return normalizedWholeUserAnswer.includes(normalizedAlias);
}


// 5. 부분점수 계산 함수
// 정보처리기사 실기 부분점수 기준을 초기 운영 기준에 맞춰 보수적으로 적용합니다.
// - 코드 출력형(EXACT_OUTPUT): 부분점수를 적용하지 않습니다.
// - SQL형(SQL_TEXT): 부분점수를 적용하지 않습니다.
// - 일반 용어형(FLEX_TERM): 부분점수를 적용하지 않습니다.
// - 여러 용어 답안형(MULTI_TERM):
//  2개 답안: 0 / 3 / 5
//  3개 답안: 0 / 1 / 3 / 5
//  그 외: 맞힌 비율 기반 단순 환산
// 현재 규칙:
// MULTI_TERM은 쉼표가 없어도 정답 용어가 답안 전체에 들어있으면 인정합니다.
// 그래서 "A, B C"처럼 구분자가 하나 빠진 경우에도 A/B/C를 각각 찾아낼 수 있습니다.


function calculateMultiTermScore(answerSlots, userAnswer) {
    const userSlots = splitUserSlots(userAnswer);
    const normalizedWholeUserAnswer = normalizeFlexible(userAnswer);

    if (!Array.isArray(answerSlots) || answerSlots.length === 0) {
        return {
            isCorrect: false,
            score: 0,
            correctSlotCount: 0,
            totalSlotCount: 0,
            matchedSlots: []
        };
    }

    let correctSlotCount = 0;
    const matchedSlots = [];

    // 각 정답 슬롯마다 사용자의 답 중 하나라도 일치하거나,
    // 사용자의 전체 답안 안에 해당 용어가 포함되어 있으면 맞힌 것으로 본다.
    for (const slotAliases of answerSlots) {
        const aliases = Array.isArray(slotAliases) ? slotAliases : [slotAliases];

        const matchedAlias = aliases.find(alias => (
            isAliasMatchedByUser(alias, userSlots, normalizedWholeUserAnswer)
        ));

        if (matchedAlias) {
            correctSlotCount += 1;
            matchedSlots.push(cleanText(matchedAlias));
        }
    }

    const totalSlotCount = answerSlots.length;
    let score = 0;

    if (correctSlotCount === totalSlotCount) {
        score = 5;
    } else if (totalSlotCount === 2) {
        // 2개 중 1개 맞으면 3점
        score = correctSlotCount === 1 ? 3 : 0;
    } else if (totalSlotCount === 3) {
        // 3개 중 1개 맞으면 1점, 2개 맞으면 3점
        if (correctSlotCount === 1) score = 1;
        else if (correctSlotCount === 2) score = 3;
        else score = 0;
    } else {
        // 그 외 개수는 비율 기반으로 보수적으로 계산합니다.
        score = Math.floor((correctSlotCount / totalSlotCount) * 5);
    }

    return {
        isCorrect: score === 5,
        score,
        correctSlotCount,
        totalSlotCount,
        matchedSlots
    };
}


// 6. 문제 응답 정리 함수
// DB 컬럼명을 프론트에서 쓰기 편한 형태로 정리합니다.
// 정답 원문은 문제 풀이 중에는 보여주면 안 되므로 기본적으로 제외합니다.


function toPublicQuestion(row, source) {
    return {
        source,
        questionId: row.question_id,
        subjectCode: row.subject_code || null,
        subjectName: row.subject_name || null,
        subjectNo: row.subject_no || null,
        examYear: row.exam_year || null,
        examSession: row.exam_session || null,
        questionNo: row.question_no || null,
        questionText: row.question_text,
        gradingPolicy: row.grading_policy,
        score: row.score || 5,
        choiceImgPath: row.choice_img_path || null,
        explanationImgPath: row.explanation_img_path || null
    };
}


// 7. async 라우터 에러 처리 함수
    // 각 API에서 에러가 나도 서버 전체가 중단되지 않고 JSON 에러만 반환합니다.


function asyncHandler(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            console.error(' /api/ipep 처리 중 오류:', error);
            res.status(500).json({
                success: false,
                msg: '실기 API 처리 중 오류가 발생했습니다.',
                error: error.message
            });
        }
    };
}


// 8. 라우터 생성 함수
// 서버 진입점에서 createIpepRouter(pool) 형태로 호출합니다.


function createIpepRouter(pool) {
    const router = express.Router();

    // ------------------------------------------------------
    // GET /api/ipep/health
    // ------------------------------------------------------
    // 실기 API 연결 상태 확인용입니다.
    // 브라우저에서 http://localhost:5000/api/ipep/health 로 확인 가능하다.
    // ------------------------------------------------------
    router.get('/health', asyncHandler(async (req, res) => {
        await pool.query('SELECT 1');

        res.json({
            success: true,
            msg: '정보처리기사 실기 API 정상 작동 중'
        });
    }));


    // ------------------------------------------------------
    // GET /api/ipep/subjects
    // ------------------------------------------------------
    // 실기 문제은행 과목 8개와 각 과목별 문제 수를 조회합니다.
    // ------------------------------------------------------
    router.get('/subjects', asyncHandler(async (req, res) => {
        const [rows] = await pool.query(`SELECT
                s.subject_code AS subjectCode,
                s.subject_name AS subjectName,
                s.display_order AS displayOrder,
                COUNT(q.question_id) AS questionCount
            FROM ipep_subjects s
            LEFT JOIN ipep_random_questions q
                ON s.subject_code = q.subject_code
                AND q.is_active = 1
            GROUP BY s.subject_code, s.subject_name, s.display_order
            ORDER BY s.display_order ASC
        `);

        res.json({
            success: true,
            data: rows
        });
    }));


    // ------------------------------------------------------
    // GET /api/ipep/random-question?subjectCode=ALL
    // GET /api/ipep/random-question?subjectCode=01
    // ------------------------------------------------------
    // subjectCode=ALL이면 8과목 전체에서 랜덤 1문제
    // subjectCode=01~08이면 해당 과목에서 랜덤 1문제
    // ------------------------------------------------------
    router.get('/random-question', asyncHandler(async (req, res) => {
        const subjectCode = cleanText(req.query.subjectCode || 'ALL').toUpperCase();
        const normalizedSubjectCode = subjectCode === 'ALL' ? 'ALL' : subjectCode.padStart(2, '0');
        const excludeIds = parseRandomIdCsv(req.query.excludeIds, 120);
        const excludeSubjects = normalizedSubjectCode === 'ALL'
            ? parseRandomCsv(req.query.excludeSubjects, 8).map((item) => item.padStart(2, '0'))
            : [];

        const buildRandomQuery = ({ useIds = true, useSubjects = true } = {}) => {
            const clauses = ['q.is_active = 1'];
            const params = [];

            if (normalizedSubjectCode !== 'ALL') {
                clauses.push('q.subject_code = ?');
                params.push(normalizedSubjectCode);
            }

            if (useIds && excludeIds.length >0) {
                clauses.push(`q.question_id NOT IN (${excludeIds.map(() => '?').join(',')})`);
                params.push(...excludeIds);
            }

            if (useSubjects && excludeSubjects.length >0) {
                clauses.push(`q.subject_code NOT IN (${excludeSubjects.map(() => '?').join(',')})`);
                params.push(...excludeSubjects);
            }

            return {
                sql: `SELECT
                    q.*,
                    s.subject_name
                FROM ipep_random_questions q
                LEFT JOIN ipep_subjects s
                    ON q.subject_code = s.subject_code
                WHERE ${clauses.join(' AND ')}
                ORDER BY RAND()
                LIMIT 1
            `,
                params,
            };
        };

        const attempts = [
            { useIds: true, useSubjects: true, mode: 'avoid-question-and-subject' },
            { useIds: true, useSubjects: false, mode: 'avoid-question' },
            { useIds: false, useSubjects: false, mode: 'full-random' },
        ];

        let rows = [];
        let selectionMode = 'full-random';

        for (const attempt of attempts) {
            const query = buildRandomQuery(attempt);
            [rows] = await pool.query(query.sql, query.params);
            selectionMode = attempt.mode;
            if (rows.length >0) break;
        }

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                msg: '해당 조건의 실기 문제가 없습니다.'
            });
        }

        res.json({
            success: true,
            data: toPublicQuestion(rows[0], 'ipep_random'),
            randomMeta: {
                selectionMode,
                excludedQuestionCount: excludeIds.length,
                excludedSubjectCount: excludeSubjects.length,
            }
        });
    }));


    // ------------------------------------------------------
    // GET /api/ipep/exam-catalog
    // ------------------------------------------------------
    // 실기 기출문제 연도/회차 오픈 상태를 조회합니다.
    // 데이터가 없는 회차도 준비중 상태로 내려줍니다.
    // ------------------------------------------------------
    router.get('/exam-catalog', asyncHandler(async (req, res) => {
        const [rows] = await pool.query(`SELECT
                exam_year AS examYear,
                exam_session AS examSession,
                question_count AS questionCount,
                is_open AS isOpen,
                notice_message AS noticeMessage
            FROM ipep_exam_catalog
            ORDER BY exam_year ASC, exam_session ASC
        `);

        res.json({
            success: true,
            data: rows
        });
    }));


    // ------------------------------------------------------
    // GET /api/ipep/past-exam?year=2020&session=1
    // ------------------------------------------------------
    // 실기 기출문제 한 회차를 조회합니다.
    // is_open=0이면 문제를 주지 않고 오픈베타 안내 메시지만 반환합니다.
    // ------------------------------------------------------
    router.get('/past-exam', asyncHandler(async (req, res) => {
        const year = Number(req.query.year);
        const session = Number(req.query.session);

        if (!year || !session) {
            return res.status(400).json({
                success: false,
                msg: 'year와 session이 필요합니다.'
            });
        }

        const [catalogRows] = await pool.query(`SELECT
                exam_year,
                exam_session,
                question_count,
                is_open,
                notice_message
            FROM ipep_exam_catalog
            WHERE exam_year = ?
              AND exam_session = ?
            LIMIT 1
        `, [year, session]);

        if (catalogRows.length === 0 || Number(catalogRows[0].is_open) !== 1) {
            return res.json({
                success: false,
                isOpen: false,
                msg: catalogRows[0]?.notice_message || '현재 오픈베타테스트중으로, 빠른 시일내에 추가 할 예정입니다.',
                data: []
            });
        }

        const [rows] = await pool.query(`SELECT
                *
            FROM ipep_past_questions
            WHERE is_active = 1
              AND exam_year = ?
              AND exam_session = ?
            ORDER BY question_no ASC
        `, [year, session]);

        res.json({
            success: true,
            isOpen: true,
            examYear: year,
            examSession: session,
            totalCount: rows.length,
            passScore: 60,
            scorePerQuestion: 5,
            data: rows.map(row => toPublicQuestion(row, 'ipep_past'))
        });
    }));


    // ------------------------------------------------------
    // POST /api/ipep/check-answer
    // ------------------------------------------------------
    // 사용자가 입력한 주관식 답안을 채점합니다.
    // 요청 body 예시:
    // {
    //  "source": "ipep_random",
    //  "questionId": 1,
    //  "userAnswer": "Agile"
    // }
    // source:
    // - ipep_random
    // - ipep_past
    // ------------------------------------------------------
    router.post('/check-answer', asyncHandler(async (req, res) => {
        const source = cleanText(req.body.source);
        const questionId = Number(req.body.questionId);
        const userAnswer = cleanText(req.body.userAnswer);

        if (!source || !questionId) {
            return res.status(400).json({
                success: false,
                msg: 'source와 questionId가 필요합니다.'
            });
        }

        const tableName = source === 'ipep_past'? 'ipep_past_questions'
            : 'ipep_random_questions';

        const [rows] = await pool.query(`SELECT
                question_id,
                question_text,
                answer_raw,
                answer_normalized,
                answer_aliases_json,
                answer_slots_json,
                grading_policy,
                score
            FROM ${tableName}
            WHERE question_id = ?
              AND is_active = 1
            LIMIT 1
        `, [questionId]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                msg: '문제를 찾을 수 없습니다.'
            });
        }

        const question = rows[0];
        const gradingPolicy = question.grading_policy || 'FLEX_TERM';
        const answerRaw = cleanText(question.answer_raw);
        const answerAliases = safeJsonParse(question.answer_aliases_json, []);
        const answerSlots = safeJsonParse(question.answer_slots_json, []);

        let isCorrect = false;
        let score = 0;
        let normalizedUserAnswer = '';
        let normalizedCorrectAnswer = '';
        let detail = {};

        if (gradingPolicy === 'SELF_CHECK') {
            // 긴 서술형은 자동채점이 위험하므로 자기채점 안내를 반환합니다.
            return res.json({
                success: true,
                gradingPolicy,
                requiresSelfCheck: true,
                isCorrect: null,
                score: null,
                maxScore: question.score || 5,
                correctAnswer: answerRaw,
                msg: '이 문제는 서술형 성격이 강해 정답 예시와 비교하는 자기채점 방식으로 확인해 주세요.'
            });
        }

        if (gradingPolicy === 'EXACT_OUTPUT') {
            normalizedUserAnswer = normalizeExactOutput(userAnswer);
            normalizedCorrectAnswer = normalizeExactOutput(answerRaw);
            isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;
            score = isCorrect ? 5 : 0;

            detail = {
                compareMode: '대소문자, 공백, 줄바꿈을 최대한 정확히 비교'
            };
        } else if (gradingPolicy === 'SQL_TEXT') {
            normalizedUserAnswer = normalizeSql(userAnswer);
            normalizedCorrectAnswer = normalizeSql(answerRaw);
            isCorrect = normalizedUserAnswer === normalizedCorrectAnswer;
            score = isCorrect ? 5 : 0;

            detail = {
                compareMode: 'SQL 대소문자와 공백 차이는 완화, SQL 문법 기호는 보존'
            };
        } else if (gradingPolicy === 'MULTI_TERM') {
            const result = calculateMultiTermScore(answerSlots, userAnswer);

            isCorrect = result.isCorrect;
            score = result.score;

            detail = {
                compareMode: '여러 용어 답안: 쉼표/줄바꿈이 빠져도 정답 용어 포함 여부까지 확인',
                correctSlotCount: result.correctSlotCount,
                totalSlotCount: result.totalSlotCount,
                matchedSlots: result.matchedSlots || []
            };
        } else {
            // FLEX_TERM 기본 처리합니다
            normalizedUserAnswer = normalizeFlexible(userAnswer);

            const normalizedAliases = Array.isArray(answerAliases) && answerAliases.length >0
                ? answerAliases.map(alias => normalizeFlexible(alias))
                : [normalizeFlexible(answerRaw)];

            isCorrect = normalizedAliases.includes(normalizedUserAnswer);
            score = isCorrect ? 5 : 0;

            detail = {
                compareMode: '일반 용어형: 대소문자, 공백, 쉼표, 하이픈 등 문장부호 완화'
            };
        }

        res.json({
            success: true,
            gradingPolicy,
            requiresSelfCheck: false,
            isCorrect,
            score,
            maxScore: question.score || 5,
            correctAnswer: answerRaw,
            normalizedUserAnswer,
            normalizedCorrectAnswer,
            detail
        });
    }));


    // 완성된 router를 server.js로 돌려줍니다.
    return router;
}


// 이 파일을 require('./ipepRoutes') 했을 때 createIpepRouter 함수가 반환되도록 합니다.
module.exports = createIpepRouter;
