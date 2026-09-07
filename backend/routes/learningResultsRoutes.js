// 시험 유형별 개인 학습 결과 저장 API를 제공합니다.
'use strict';

function registerLearningResultsRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const getSeasonStatus = options.getSeasonStatus;
    const getIpepRankingStore = options.getIpepRankingStore;
    const safeNumber = options.safeNumber;
    const getUserById = options.getUserById;
    const saveIpepRankingStore = options.saveIpepRankingStore;
    const getKSTDateTime = options.getKSTDateTime;
    const validateRealtimeSession = options.validateRealtimeSession;

    if (!app || !pool || !getSeasonStatus || !getIpepRankingStore || !saveIpepRankingStore || !getUserById || !getKSTDateTime || !safeNumber || typeof validateRealtimeSession !== 'function') {
        throw new Error('registerLearningResultsRoutes requires app, pool, date helpers, personal result store helpers, getUserById, safeNumber, and validateRealtimeSession.');
    }

    function authUserId(auth) {
        return String(auth?.user?.id || auth?.id || '').trim();
    }

    async function requireSessionUser(req, res, expectedId = '') {
        const auth = await validateRealtimeSession(req);
        if (!auth.valid) {
            res.status(401).json({
                success: false,
                valid: false,
                reason: auth.reason || 'session_expired',
                msg: '로그인 세션이 만료되었습니다. 다시 로그인해주세요.',
            });
            return null;
        }

        const requesterId = authUserId(auth);
        const targetId = String(expectedId || requesterId || '').trim();
        if (!requesterId || !targetId || requesterId !== targetId) {
            res.status(403).json({
                success: false,
                valid: false,
                reason: 'forbidden_user_mismatch',
                msg: '본인 계정으로만 처리할 수 있습니다.',
            });
            return null;
        }

        return auth;
    }

    // 개인 학습 결과 저장
    app.post('/api/practice-results', async (req, res) => {
        const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
        if (!auth) return;

        const userId = authUserId(auth);
        const isCorrect = Boolean(req.body.isCorrect);

        if (!userId) return res.status(400).json({ success: false, msg: '로그인 필요' });

        try {
            const { rankingDate } = getSeasonStatus();

            // 필기 문제은행 학습 결과는 서버 기준 날짜로 24시간 내내 기록합니다.
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
        const auth = await requireSessionUser(req, res, req.body.userId || req.body.id);
        if (!auth) return;

        const userId = authUserId(auth);
        const examYear = Number(req.body.examYear || 0);
        const examSession = Number(req.body.examSession || 0);
        const correctCount = Number(req.body.correctCount || 0);
        const totalCount = Number(req.body.totalCount || 0);
        const replaceResult = req.body.resultMode === 'replace';
        if (req.body.resultMode !== undefined && !replaceResult) {
            return res.status(400).json({ success: false, msg: '지원하지 않는 결과 저장 방식입니다.' });
        }
        const hasExplicitCounts = [req.body.totalCount, req.body.correctCount].every(value =>
            typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''));
        if ((replaceResult && !hasExplicitCounts)
            || ![examYear, examSession, totalCount, correctCount].every(Number.isInteger)
            || (replaceResult && (totalCount < 0 || correctCount < 0 || correctCount > totalCount))) {
            return res.status(400).json({ success: false, msg: '올바른 문제 수와 정답 수를 입력해주세요.' });
        }


        if (!userId) return res.status(400).json({ success: false, msg: '로그인 필요' });

        try {
            const { rankingDate } = getSeasonStatus();

            // 새 제출은 같은 날짜/연도/회차의 최신 결과로 교체합니다.
            // resultMode가 없는 구버전 클라이언트의 증감값도 계속 처리합니다.
            await pool.query(
                `INSERT INTO wgs_ranking_past (userId, date, year, session, solved_count, correct_count)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    solved_count = ${replaceResult ? "VALUES(solved_count)" : "GREATEST(0, solved_count + VALUES(solved_count))"},
                    correct_count = ${replaceResult ? "VALUES(correct_count)" : "GREATEST(0, correct_count + VALUES(correct_count))"}`,
                [userId, rankingDate, examYear, examSession, totalCount, correctCount]
            );

            return res.json({ success: true });
        } catch (error) {
            console.error('기출 결과 저장 오류:', error);
            return res.status(500).json({ success: false, msg: '결과 저장 중 오류가 발생했습니다.' });
        }
    });

// 실기 개인 학습 결과: 문제은행은 누적하고 기출은 최신 제출본을 저장합니다.
app.post('/api/practical-results', async (req, res) => {
    const auth = await requireSessionUser(req, res, req.body.id || req.body.userId);
    if (!auth) return;

    const id = authUserId(auth);
    const mode = req.body.mode === 'past'? 'past' : 'random';

    if (!id) return res.status(400).json({ success: false, msg: '로그인이 필요합니다.' });

    try {
        const { rankingDate, season } = getSeasonStatus();

        // 실기 학습 결과는 프리시즌 없이 서버 기준 날짜로 24시간 내내 기록합니다.
        const user = await getUserById(id);
        const userName = auth.user?.name || (user && user.name) || id;
        const store = getIpepRankingStore();
        const list = mode === 'past'? store.past : store.random;

        const now = getKSTDateTime();
        const year = req.body.year || null;
        const session = req.body.session || null;
        const detailKey = req.body.detailKey || `${year || ''}-${session || ''}`;

        const totalCount = Math.max(1, safeNumber(req.body.totalCount, 1));
        const correctCount = Math.max(0, safeNumber(req.body.correctCount, 0));
        const attemptedCount = Math.max(0, safeNumber(req.body.attemptedCount, totalCount));
        const totalScore = Math.max(0, safeNumber(req.body.totalScore, req.body.score || 0));

        // 실기 기출은 아무 답도 입력하지 않은 제출은 학습 결과에 남기지 않습니다.
        // 사용자가 실제로 1문제 이상 입력했을 때만 최신 응시 기록으로 반영합니다.
        if (mode === 'past' && attemptedCount <= 0) {
            return res.json({ success: true, skipped: true, msg: '입력한 답안이 없어 실기 기출 학습 결과를 기록하지 않았습니다.' });
        }

        // 문제은행은 사용자가 푼 문제 수가 계속 달라질 수 있으므로 누적형입니다.
        // 기출문제는 같은 연도/회차를 재응시할 수 있으므로 최신 제출본으로 갱신하는 방식입니다.
        const existing = list.find((row) => {
            if (String(row.userId) !== id) return false;
            if (String(row.rankingDate || '') !== String(rankingDate)) return false;
            if (mode === 'past') {
                return String(row.year || '') === String(year || '')
                    && String(row.session || '') === String(session || '')
                    && String(row.detailKey || `${row.year || ''}-${row.session || ''}`) === String(detailKey);
            }
            return true;
        });

        if (existing && mode === 'random') {
            // 실기 문제은행: 1문제씩 또는 여러 문제씩 풀 때마다 누적합니다.
            existing.userName = userName;
            existing.totalCount = safeNumber(existing.totalCount) + totalCount;
            existing.correctCount = safeNumber(existing.correctCount) + correctCount;
            existing.totalScore = safeNumber(existing.totalScore) + totalScore;
            existing.maxScore = safeNumber(existing.maxScore) + totalCount;
            existing.attemptedCount = safeNumber(existing.attemptedCount) + attemptedCount;
            existing.rankingDate = rankingDate;
            existing.season = season;
            existing.updatedAt = now;
        } else if (existing && mode === 'past') {
            // 실기 기출문제: 같은 연도/회차 재응시는 누적하지 않고 최신 제출본으로 교체합니다.
            existing.userName = userName;
            existing.year = year;
            existing.session = session;
            existing.detailKey = detailKey;
            existing.totalCount = totalCount;          // 보통 20문제
            existing.correctCount = correctCount;      // 부분점수라도 있으면 맞은 문제로 인정
            existing.totalScore = totalScore;          // 부분점수를 합산한 실제 점수
            existing.maxScore = Math.max(1, safeNumber(req.body.maxScore, 100));
            existing.attemptedCount = attemptedCount;
            existing.rankingDate = rankingDate;
            existing.season = season;
            existing.updatedAt = now;
        } else {
            list.push({
                userId: id,
                userName,
                mode,
                year,
                session,
                detailKey,
                totalCount,
                correctCount,
                totalScore,
                maxScore: mode === 'past'? Math.max(1, safeNumber(req.body.maxScore, 100)) : totalCount,
                attemptedCount,
                rankingDate,
                season,
                createdAt: now,
                updatedAt: now
            });
        }

        saveIpepRankingStore(store);
        return res.json({ success: true, msg: mode === 'past'? '실기 기출 최신 학습 결과 저장 완료' : '실기 문제은행 누적 학습 결과 저장 완료' });
    } catch (error) {
        console.error('실기 학습 결과 저장 오류:', error);
        return res.status(500).json({ success: false, msg: '실기 학습 결과 저장 중 오류가 발생했습니다.' });
    }
});


}

module.exports = registerLearningResultsRoutes;
