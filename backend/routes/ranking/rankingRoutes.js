// 시험 유형별 랭킹 조회와 저장 API를 제공합니다.
'use strict';

function registerRankingRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const getSeasonStatus = options.getSeasonStatus;
    const getIpepRankingStore = options.getIpepRankingStore;
    const safeNumber = options.safeNumber;

    if (!app || !pool || !getSeasonStatus || !getIpepRankingStore || !safeNumber) {
        throw new Error('registerRankingRoutes requires app, pool, getSeasonStatus, getIpepRankingStore, and safeNumber.');
    }

    // 10. 랭킹 API
    app.post('/api/practice-results', async (req, res) => {
        const userId = String(req.body.userId || '').trim();
        const isCorrect = Boolean(req.body.isCorrect);

        if (!userId) return res.status(400).json({ success: false, msg: '로그인 필요' });

        try {
            const { rankingDate } = getSeasonStatus();

            // 필기 문제은행 랭킹은 프리시즌 없이 서버 기준 날짜로 24시간 내내 기록합니다.
            await pool.query(
                `INSERT INTO wgs_ranking_random (userId, date, solved_count, correct_count)
                 VALUES (?, ?, 1, ?)
                 ON DUPLICATE KEY UPDATE
                    solved_count = solved_count + 1,
                    correct_count = correct_count + VALUES(correct_count)`,
                [userId, rankingDate, isCorrect ? 1 : 0]
            );

            return res.json({ success: true });
        } catch (error) {
            console.error('문제은행 결과 저장 오류:', error);
            return res.status(500).json({ success: false, msg: '결과 저장 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/exam-results', async (req, res) => {
        const userId = String(req.body.userId || '').trim();
        const examYear = Number(req.body.examYear || 0);
        const examSession = Number(req.body.examSession || 0);
        const correctCount = Number(req.body.correctCount || 0);
        const totalCount = Number(req.body.totalCount || 0);

        if (!userId) return res.status(400).json({ success: false, msg: '로그인 필요' });

        try {
            const { rankingDate } = getSeasonStatus();

            // 필기 기출문제 랭킹은 프리시즌 없이 서버 기준 날짜로 24시간 내내 기록합니다.
            await pool.query(
                `INSERT INTO wgs_ranking_past (userId, date, year, session, solved_count, correct_count)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    solved_count = GREATEST(0, solved_count + VALUES(solved_count)),
                    correct_count = GREATEST(0, correct_count + VALUES(correct_count))`,
                [userId, rankingDate, examYear, examSession, totalCount, correctCount]
            );

            return res.json({ success: true });
        } catch (error) {
            console.error('기출 결과 저장 오류:', error);
            return res.status(500).json({ success: false, msg: '결과 저장 중 오류가 발생했습니다.' });
        }
    });

    app.get('/api/rankings', async (req, res) => {
        const type = req.query.type || 'random';
        const year = req.query.year;
        const session = req.query.session;
        const { isRegular, rankingDate } = getSeasonStatus();

        try {
            // 실기 랭킹은 기존 필기 랭킹 DB 로직을 변경하지 않고 별도 JSON 저장소에서 읽습니다.
            if (type === 'ipep_random' || type === 'ipep_past') {
                const store = getIpepRankingStore();
                const sourceList = type === 'ipep_past'? store.past : store.random;

                const rankings = sourceList
                    .filter((row) => {
                        // 실기 랭킹도 필기와 동일하게 오늘 24시간 랭킹 데이터만 노출합니다.
                        if (String(row.rankingDate || '') !== String(rankingDate)) return false;
                        if (type !== 'ipep_past') return true;
                        if (year && String(row.year || '') !== String(year)) return false;
                        if (session && String(row.session || '') !== String(session)) return false;
                        return true;
                    })
                    .map((row) => {
                        const totalScore = safeNumber(row.totalScore);
                        const maxScore = Math.max(1, safeNumber(row.maxScore, type === 'ipep_past'? 100 : 1));
                        const total = type === 'ipep_past'? 20 : Math.max(1, safeNumber(row.totalCount, 1));
                        const correct = Math.min(total, safeNumber(row.correctCount));
                        const accuracy = Number(((correct / total) * 100).toFixed(1));

                        return {
                            userId: row.userId,
                            id: row.userId,
                            name: row.userName || row.userId,
                            userName: row.userName || row.userId,
                            total,
                            correct,
                            solved_count: total,
                            correct_count: correct,
                            totalScore,
                            maxScore,
                            // score/points는 점수 기준 정렬 및 화면 표시용입니다.
                            // 정답률은 correct/total로 계산하게 별도 accuracy를 내려줍니다.
                            score: totalScore,
                            points: totalScore,
                            accuracy,
                            updatedAt: row.updatedAt || row.createdAt || ''
                        };
                    })
                    .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy || b.correct - a.correct)
                    .slice(0, 20);

                // 실기 랭킹도 필기 랭킹과 같은 응답 키를 내려 기존 프론트와 호환합니다.
                // 프리시즌은 폐지되었으므로 isRegularSeason은 항상 true입니다.
                return res.json({
                    success: true,
                    rankings,
                    isRegularSeason: isRegular,
                    rankingDate,
                    seasonStatus: {
                        isRegular,
                        isRegularSeason: isRegular, // 프론트 방어 코드와 신규 응답 형식 모두 지원
                        rankingDate,
                        season: 'daily'
                    }
                });
            }

            let rows = [];

            if (type === 'random') {
                const [result] = await pool.query(
                    `SELECT r.userId, r.date, r.solved_count, r.correct_count, u.name
                     FROM wgs_ranking_random r
                     LEFT JOIN wgs_users u ON r.userId = u.id
                     WHERE r.date = ?`,
                    [rankingDate]
                );
                rows = result;
            } else {
                const [result] = await pool.query(
                    `SELECT r.userId, r.date, r.year, r.session, r.solved_count, r.correct_count, u.name
                     FROM wgs_ranking_past r
                     LEFT JOIN wgs_users u ON r.userId = u.id
                     WHERE r.date = ? AND r.year = ? AND r.session = ?`,
                    [rankingDate, year, session]
                );
                rows = result;
            }

            const rankings = rows
                .filter(row => row.name)
                .map(row => ({
                    userId: row.userId,
                    id: row.userId,
                    name: row.name,
                    total: Number(row.solved_count || 0),
                    correct: Number(row.correct_count || 0),
                    solved_count: Number(row.solved_count || 0),
                    correct_count: Number(row.correct_count || 0),
                    points: Number(row.correct_count || 0) * 10
                }))
                .sort((a, b) => b.points - a.points || b.correct - a.correct || b.total - a.total)
                .slice(0, 10)
                .map((row, index) => ({ ...row, rank: index + 1 }));

            return res.json({ isRegularSeason: isRegular, rankingDate, rankings });
        } catch (error) {
            console.error('랭킹 조회 오류:', error);
            return res.status(500).json({ success: false, msg: '랭킹 조회 중 오류가 발생했습니다.' });
        }
    });
}

module.exports = registerRankingRoutes;
