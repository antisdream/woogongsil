// 필기 문제와 채점 API를 제공합니다.
'use strict';

function registerExamRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const buildQuestionSelect = options.buildQuestionSelect;

    if (!app || !pool || !buildQuestionSelect) {
        throw new Error('registerExamRoutes requires app, pool, and buildQuestionSelect.');
    }

    // 9. 문제은행 / 기출문제 API
    app.get('/api/random-question', async (req, res) => {
        try {
            const rows = await buildQuestionSelect('', [], ' ORDER BY RAND() LIMIT 1');

            if (rows.length === 0) return res.status(404).json({ success: false, msg: '문제 없음' });

            return res.json(rows[0]);
        } catch (error) {
            console.error('랜덤 문제 조회 오류:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    });


    // 공개 시험 카탈로그 API
    // ------------------------------------------------------------
    // 목적:
    // - 프론트에서 2021~2025, 1~3회차 같은 값을 하드코딩하지 않도록 합니다.
    // - questions DB에 실제 적재된 필기 기출 연도/회차를 자동으로 내려줍니다.
    // - ipep_exam_catalog가 있으면 실기 기출 연도/회차도 함께 내려줍니다.
    // - 기존 문제 풀이 API(/api/past-exam), 랭킹 API, 관리자 CRUD는 그대로 둡니다.
    app.get('/api/exam-catalogs', async (req, res) => {
        const groupCatalog = (rows) => {
            const map = new Map();

            rows.forEach((row) => {
                const year = Number(row.year);
                const session = Number(row.session);
                const questionCount = Number(row.question_count || 0);

                if (!Number.isFinite(year) || !Number.isFinite(session)) return;

                if (!map.has(year)) {
                    map.set(year, {
                        year,
                        sessions: [],
                        sessionCounts: {},
                    });
                }

                const entry = map.get(year);
                if (!entry.sessions.includes(session)) {
                    entry.sessions.push(session);
                }
                entry.sessionCounts[String(session)] = questionCount;
            });

            return Array.from(map.values())
                .map((entry) => ({
                    ...entry,
                    sessions: entry.sessions.sort((a, b) => a - b),
                }))
                .sort((a, b) => b.year - a.year);
        };

        try {
            const [writtenRows] = await pool.query(
                `SELECT
                    q.year AS year,
                    q.session AS session,
                    COUNT(DISTINCT q.question_id) AS question_count
                 FROM questions q
                 WHERE q.year IS NOT NULL
                   AND q.session IS NOT NULL
                 GROUP BY q.year, q.session
                 HAVING COUNT(DISTINCT q.question_id) >0
                 ORDER BY q.year DESC, q.session ASC`
            );

            let ipepPastRows = [];
            try {
                const [rows] = await pool.query(
                    `SELECT
                        exam_year AS year,
                        exam_session AS session,
                        COALESCE(question_count, 0) AS question_count
                     FROM ipep_exam_catalog
                     WHERE exam_year IS NOT NULL
                       AND exam_session IS NOT NULL
                       AND COALESCE(is_open, 1) = 1
                     ORDER BY exam_year DESC, exam_session ASC`
                );
                ipepPastRows = rows;
            } catch (ipepError) {
                // 실기 카탈로그 테이블이 없거나 구조가 다를 때도 필기 선택창은 정상 동작해야 합니다.
                console.warn('[exam catalogs] ipep catalog skipped:', ipepError.message);
            }

            const data = {
                written: groupCatalog(writtenRows),
                ipep_past: groupCatalog(ipepPastRows),
            };

            return res.json({
                success: true,
                data,
                written: data.written,
                ipep_past: data.ipep_past,
            });
        } catch (error) {
            console.error('[exam catalogs error]', error);
            return res.status(500).json({
                success: false,
                msg: '시험 카탈로그를 불러오지 못했습니다.',
                error: error.message,
            });
        }
    });


    app.get('/api/past-exam', async (req, res) => {
        const year = req.query.year;
        const session = req.query.session;

        try {
            const rows = await buildQuestionSelect(
                ' WHERE q.year = ? AND q.session = ?',
                [year, session],
                ' ORDER BY q.info_id ASC, q.question_id ASC'
            );

            return res.json({ success: true, data: rows });
        } catch (error) {
            console.error('기출문제 조회 오류:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/questions', async (req, res) => {
        try {
            const rows = await buildQuestionSelect('', [], ' ORDER BY q.year DESC, q.session ASC, q.info_id ASC');
            return res.json(rows);
        } catch (error) {
            console.error('전체 문제 조회 오류:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    });

}

module.exports = registerExamRoutes;
