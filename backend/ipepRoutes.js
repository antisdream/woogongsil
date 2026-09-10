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
const { cleanText, parseRandomCsv, parseRandomIdCsv } = require('./services/ipepAnswerGrading');

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
        weekNo: row.week_no || null,
        sectionNo: row.section_no || null,
        sectionQuestionKey: row.section_question_key || null,
        questionOrder: row.question_order || null,
        questionText: row.question_text,
        choiceText: row.choice_text || '',
        gradingPolicy: row.grading_policy,
        score: row.score || 5,
        choiceImgPath: row.choice_img_path || null,
        explanationImgPath: null
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
            res.status(error.status || 500).json({
                success: false,
                msg: '실기 API 처리 중 오류가 발생했습니다.',
                reason: error.reason || 'ipep_failed'
            });
        }
    };
}


// 8. 라우터 생성 함수
// 서버 진입점에서 createIpepRouter(pool) 형태로 호출합니다.


function createIpepRouter(pool, learningAttempts) {
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

        const attemptId = await learningAttempts.issue(req, res, 'ipep_random', rows);
        res.json({
            success: true,
            attemptId,
            data: { ...toPublicQuestion(rows[0], 'ipep_random'), attemptId },
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

        const attemptId = rows.length ? await learningAttempts.issue(req, res, 'ipep_past', rows) : null;
        res.json({
            success: true,
            attemptId,
            isOpen: true,
            examYear: year,
            examSession: session,
            totalCount: rows.length,
            passScore: 60,
            scorePerQuestion: 5,
            data: rows.map(row => ({ ...toPublicQuestion(row, 'ipep_past'), attemptId }))
        });
    }));


    // ------------------------------------------------------
    // GET /api/ipep/three-week/overview
    // ------------------------------------------------------
    // 3주 공략 주차/Section별 문제 수를 조회합니다.
    // ------------------------------------------------------
    router.get('/three-week/overview', asyncHandler(async (req, res) => {
        const [sectionRows] = await pool.query(`SELECT
                s.week_no AS weekNo,
                s.section_no AS sectionNo,
                s.display_order AS displayOrder,
                COUNT(q.question_id) AS questionCount
            FROM ipep_three_week_sections s
            LEFT JOIN ipep_three_week_questions q
                ON q.section_no = s.section_no
                AND q.is_active = 1
            WHERE s.is_active = 1
            GROUP BY s.week_no, s.section_no, s.display_order
            ORDER BY s.display_order ASC
        `);

        const weekRows = [1, 2, 3].map((weekNo) => {
            const sections = sectionRows.filter(row => Number(row.weekNo) === weekNo);
            return {
                weekNo,
                sectionCount: sections.length,
                questionCount: sections.reduce((sum, row) => sum + Number(row.questionCount || 0), 0),
                isOpen: sections.some(row => Number(row.questionCount || 0) > 0) ? 1 : 0,
            };
        });

        res.json({
            success: true,
            data: {
                weeks: weekRows,
                sections: sectionRows,
            }
        });
    }));


    // ------------------------------------------------------
    // GET /api/ipep/three-week/questions?weekNo=1&sectionNo=ALL&order=section
    // ------------------------------------------------------
    // order=section 이면 Section/문제번호 오름차순, order=random 이면 섞어서 내려줍니다.
    // ------------------------------------------------------
    router.get('/three-week/questions', asyncHandler(async (req, res) => {
        const weekNo = Math.min(3, Math.max(1, Number(req.query.weekNo || 1)));
        const sectionNo = cleanText(req.query.sectionNo || 'ALL').toUpperCase();
        const order = cleanText(req.query.order || 'section').toLowerCase() === 'random' ? 'random' : 'section';

        const clauses = ['q.is_active = 1', 's.is_active = 1', 's.week_no = ?'];
        const params = [weekNo];

        if (sectionNo !== 'ALL') {
            clauses.push('q.section_no = ?');
            params.push(sectionNo.padStart(3, '0'));
        }

        const orderSql = order === 'random'
            ? 'RAND()'
            : 's.display_order ASC, q.question_no ASC, q.question_order ASC';

        const [rows] = await pool.query(`SELECT
                q.*,
                s.week_no,
                s.display_order AS section_display_order
            FROM ipep_three_week_questions q
            INNER JOIN ipep_three_week_sections s
                ON s.section_no = q.section_no
            WHERE ${clauses.join(' AND ')}
            ORDER BY ${orderSql}
        `, params);

        const attemptId = rows.length ? await learningAttempts.issue(req, res, 'ipep_three_week', rows) : null;
        res.json({
            success: true,
            attemptId,
            weekNo,
            sectionNo,
            order,
            totalCount: rows.length,
            data: rows.map(row => ({ ...toPublicQuestion(row, 'ipep_three_week'), attemptId }))
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
    router.post('/check-answer', (_req, res) => res.status(410).json({ success: false, msg: '문제를 다시 불러온 뒤 답안을 제출해주세요.' }));

    // 완성된 router를 server.js로 돌려줍니다.
    return router;
}


// 이 파일을 require('./ipepRoutes') 했을 때 createIpepRouter 함수가 반환되도록 합니다.
module.exports = createIpepRouter;
