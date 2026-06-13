// 실기 오답노트와 사용자 학습 데이터를 관리합니다.
'use strict';

function registerPracticalUserRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const getSeasonStatus = options.getSeasonStatus;
    const getUserById = options.getUserById;
    const getIpepRankingStore = options.getIpepRankingStore;
    const saveIpepRankingStore = options.saveIpepRankingStore;
    const safeNumber = options.safeNumber;
    const getKSTDateTime = options.getKSTDateTime;

    if (!app || typeof app.post !== 'function') {
        throw new Error('registerPracticalUserRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerPracticalUserRoutes requires a MySQL pool.');
    }
// 7-1. 실기 랭킹 / 실기 오답노트 API
app.post('/api/ipep-ranking', async (req, res) => {
    const id = String(req.body.id || req.body.userId || '').trim();
    const mode = req.body.mode === 'past'? 'past' : 'random';

    if (!id) return res.status(400).json({ success: false, msg: '로그인이 필요합니다.' });

    try {
        const { rankingDate, season } = getSeasonStatus();

        // 실기 랭킹은 프리시즌 없이 서버 기준 날짜로 24시간 내내 기록합니다.
        const user = await getUserById(id);
        const userName = req.body.userName || (user && user.name) || id;
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

        // 실기 기출은 아무 답도 입력하지 않은 제출은 랭킹에 남기지 않습니다.
        // 사용자가 실제로 1문제 이상 입력했을 때만 최신 응시 기록으로 반영합니다.
        if (mode === 'past' && attemptedCount <= 0) {
            return res.json({ success: true, skipped: true, msg: '입력한 답안이 없어 실기 기출 랭킹을 기록하지 않았습니다.' });
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
        return res.json({ success: true, msg: mode === 'past'? '실기 기출 최신 랭킹 저장 완료' : '실기 문제은행 누적 랭킹 저장 완료' });
    } catch (error) {
        console.error('실기 랭킹 저장 오류:', error);
        return res.status(500).json({ success: false, msg: '실기 랭킹 저장 중 오류가 발생했습니다.' });
    }
});

// 7-2. 실기 오답노트 - SQL 저장/조회 방식
// 기존 JSON 저장 방식은 실기 보기 이미지(choice_img_path)를 안정적으로 복원하기 어려웠습니다.
// 그래서 wgs_wrong_notes에는 사용자ID + 문제ID + 출처만 저장하고,
// 조회할 때 ipep_random_questions / ipep_past_questions 원본 테이블과 JOIN해서 이미지까지 가져옵니다.
function normalizeIpepWrongSource(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('past') || raw.includes('기출')) return 'ipep_past';
    return 'ipep_random';
}

function buildIpepImageUrl(row, kind, source) {
    // kind: choice 또는 explanation
    const pathValue = row?.[`${kind}_img_path`];
    const fileValue = row?.[`${kind}_img_file`];
    const folder = source === 'ipep_past'? 'past' : 'random';

    if (pathValue && typeof pathValue === 'string') {
        const normalizedPath = pathValue.replace(/\\/g, '/').trim();
        if (/^(https?:)?\/\//i.test(normalizedPath) || normalizedPath.startsWith('/')) {
            return normalizedPath;
        }
        const fileNameFromPath = normalizedPath.split('/').filter(Boolean).pop();
        if (fileNameFromPath) return `/ipep-img/${folder}/${encodeURIComponent(fileNameFromPath)}`;
    }

    if (fileValue && typeof fileValue === 'string') {
        return `/ipep-img/${folder}/${encodeURIComponent(fileValue.trim())}`;
    }

    return '';
}

function normalizeIpepWrongRow(row, source) {
    const choiceImgUrl = buildIpepImageUrl(row, 'choice', source);
    const explanationImgUrl = buildIpepImageUrl(row, 'explanation', source);
    const correctAnswer = row.answer_normalized || row.answer_raw || '';

    return {
        // 삭제용 오답노트 ID
        wrongNoteId: row.wrongNoteId,
        wrong_note_id: row.wrongNoteId,
        wrongId: row.wrongNoteId,

        // 원본 문제 ID
        id: row.question_id,
        question_id: row.question_id,
        questionId: row.question_id,
        source,
        type: source,
        category: source,

        // 실기 문제 메타 정보
        year: row.exam_year ?? row.year ?? null,
        session: row.exam_session ?? row.session ?? null,
        exam_year: row.exam_year ?? null,
        exam_session: row.exam_session ?? null,
        question_no: row.question_no ?? null,
        subject_code: row.subject_code ?? null,
        subject_no: row.subject_no ?? null,
        score: row.score ?? null,
        grading_policy: row.grading_policy || '',

        // 문제/정답 정보
        question_text: row.question_text || '',
        questionText: row.question_text || '',
        question: row.question_text || '',
        answer_raw: row.answer_raw || '',
        answer_normalized: row.answer_normalized || '',
        correct_answer: correctAnswer,
        correctAnswer,
        answer: correctAnswer,

        // 보기 이미지와 해설 이미지: 프론트 호환성을 위해 여러 별칭을 같이 내려줍니다.
        choice_img_stem: row.choice_img_stem || '',
        choice_img_file: row.choice_img_file || '',
        choice_img_path: row.choice_img_path || '',
        choiceImgPath: choiceImgUrl,
        choiceImage: choiceImgUrl,
        image: choiceImgUrl,
        imagePath: choiceImgUrl,
        question_img: choiceImgUrl,
        questionImg: choiceImgUrl,
        questionImgPath: choiceImgUrl,

        explanation_img_stem: row.explanation_img_stem || '',
        explanation_img_file: row.explanation_img_file || '',
        explanation_img_path: row.explanation_img_path || '',
        explanationImgPath: explanationImgUrl,
        explanationImage: explanationImgUrl,

        savedAt: row.savedAt
    };
}

app.post('/api/save-ipep-wrong', async (req, res) => {
    try {
        // 기존 프론트 요청 형식(id + wrongQuestions 배열)을 그대로 받으면서 내부 저장소만 SQL로 바꿉니다.
        const id = String(req.body.id || req.body.userId || '').trim();
        const source = normalizeIpepWrongSource(req.body.source);
        const wrongQuestions = Array.isArray(req.body.wrongQuestions)
            ? req.body.wrongQuestions
            : (req.body.question ? [req.body.question] : []);

        if (!id) return res.status(400).json({ success: false, msg: '로그인이 필요합니다.' });
        if (wrongQuestions.length === 0) return res.json({ success: true, msg: '저장할 실기 오답이 없습니다.' });

        for (const question of wrongQuestions) {
            const questionId = Number(question.question_id || question.questionId || question.id);
            if (!Number.isInteger(questionId) || questionId <= 0) continue;

            // 중복 방지: 같은 사용자 + 같은 실기 출처 + 같은 문제는 하나만 유지합니다.
            await pool.query(
                'DELETE FROM wgs_wrong_notes WHERE userId = ? AND source = ? AND question_id = ?',
                [id, source, questionId]
            );

            // 실기 오답은 SQL Workbench의 wgs_wrong_notes 테이블에 저장합니다.
            // 중요: 일부 PC에는 subject 컬럼이 없는 예전 테이블이 남아 있을 수 있으므로,
            // 저장에 반드시 필요한 userId/question_id/source/year/session/savedAt 컬럼만 사용합니다.
            // 문제의 보기 이미지와 지문은 아래 조회 API에서 ipep_random_questions 또는 ipep_past_questions와 JOIN해서 가져온다.
            await pool.query(
                `INSERT INTO wgs_wrong_notes (userId, question_id, source, year, session, savedAt)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    id,
                    questionId,
                    source,
                    question.exam_year || question.year || req.body.year || null,
                    question.exam_session || question.session || req.body.session || null
                ]
            );
        }

        return res.json({ success: true, msg: '실기 오답 저장 완료' });
    } catch (error) {
        console.error('실기 오답 SQL 저장 오류:', error);
        return res.status(500).json({ success: false, msg: '실기 오답 저장 중 오류가 발생했습니다.' });
    }
});

app.get('/api/user/:id/ipep-wrongnotes', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const sourceFilter = req.query.source ? normalizeIpepWrongSource(req.query.source) : null;

        if (!id) return res.status(400).json({ success: false, msg: '사용자 정보가 없습니다.' });

        const result = { random: [], past: [] };

        if (!sourceFilter || sourceFilter === 'ipep_random') {
            const [randomRows] = await pool.query(
                `SELECT
                    wn.id AS wrongNoteId,
                    DATE_FORMAT(wn.savedAt, '%Y-%m-%d %H:%i:%s') AS savedAt,
                    q.question_id,
                    NULL AS exam_year,
                    NULL AS exam_session,
                    NULL AS question_no,
                    q.subject_code,
                    q.subject_no,
                    q.question_text,
                    q.answer_raw,
                    q.answer_normalized,
                    q.grading_policy,
                    q.score,
                    q.choice_img_stem,
                    q.choice_img_file,
                    q.choice_img_path,
                    q.explanation_img_stem,
                    q.explanation_img_file,
                    q.explanation_img_path
                 FROM wgs_wrong_notes wn
                 INNER JOIN ipep_random_questions q ON q.question_id = wn.question_id
                 WHERE wn.userId = ? AND wn.source = 'ipep_random' ORDER BY wn.savedAt DESC, wn.id DESC`,
                [id]
            );
            result.random = randomRows.map(row => normalizeIpepWrongRow(row, 'ipep_random'));
        }

        if (!sourceFilter || sourceFilter === 'ipep_past') {
            const [pastRows] = await pool.query(
                `SELECT
                    wn.id AS wrongNoteId,
                    DATE_FORMAT(wn.savedAt, '%Y-%m-%d %H:%i:%s') AS savedAt,
                    q.question_id,
                    q.exam_year,
                    q.exam_session,
                    q.question_no,
                    NULL AS subject_code,
                    NULL AS subject_no,
                    q.question_text,
                    q.answer_raw,
                    q.answer_normalized,
                    q.grading_policy,
                    q.score,
                    q.choice_img_stem,
                    q.choice_img_file,
                    q.choice_img_path,
                    q.explanation_img_stem,
                    q.explanation_img_file,
                    q.explanation_img_path
                 FROM wgs_wrong_notes wn
                 INNER JOIN ipep_past_questions q ON q.question_id = wn.question_id
                 WHERE wn.userId = ? AND wn.source = 'ipep_past' ORDER BY wn.savedAt DESC, wn.id DESC`,
                [id]
            );
            result.past = pastRows.map(row => normalizeIpepWrongRow(row, 'ipep_past'));
        }

        // 기존 프론트가 wrongNotes 배열만 읽는 경우도 영향을 받지 않도록 같이 반환합니다.
        const wrongNotes = sourceFilter === 'ipep_past'? result.past
            : sourceFilter === 'ipep_random'? result.random
                : [...result.random, ...result.past];

        return res.json({ success: true, ok: true, wrongNotes, random: result.random, past: result.past });
    } catch (error) {
        console.error('실기 오답 SQL 조회 오류:', error);
        return res.status(500).json({ success: false, msg: '실기 오답 조회 중 오류가 발생했습니다.' });
    }
});

app.post('/api/remove-ipep-wrong', async (req, res) => {
    try {
        const id = String(req.body.id || req.body.userId || '').trim();
        const source = normalizeIpepWrongSource(req.body.source);
        const wrongNoteId = Number(req.body.wrongNoteId || req.body.wrong_note_id || req.body.wrongId);
        const questionId = Number(req.body.question_id || req.body.questionId || req.body.idToDelete);

        if (!id) return res.status(400).json({ success: false, msg: '로그인이 필요합니다.' });

        if (Number.isInteger(wrongNoteId) && wrongNoteId >0) {
            await pool.query('DELETE FROM wgs_wrong_notes WHERE id = ? AND userId = ?', [wrongNoteId, id]);
        } else if (Number.isInteger(questionId) && questionId >0) {
            await pool.query(
                'DELETE FROM wgs_wrong_notes WHERE userId = ? AND source = ? AND question_id = ?',
                [id, source, questionId]
            );
        } else {
            return res.status(400).json({ success: false, msg: '삭제 정보가 부족합니다.' });
        }

        return res.json({ success: true, msg: '실기 오답 삭제 완료' });
    } catch (error) {
        console.error('실기 오답 SQL 삭제 오류:', error);
        return res.status(500).json({ success: false, msg: '실기 오답 삭제 중 오류가 발생했습니다.' });
    }
});

app.post('/api/remove-all-ipep-wrong', async (req, res) => {
    try {
        const id = String(req.body.id || req.body.userId || '').trim();
        const source = req.body.source ? normalizeIpepWrongSource(req.body.source) : null;

        if (!id) return res.status(400).json({ success: false, msg: '로그인이 필요합니다.' });

        if (source) {
            await pool.query('DELETE FROM wgs_wrong_notes WHERE userId = ? AND source = ?', [id, source]);
        } else {
            await pool.query("DELETE FROM wgs_wrong_notes WHERE userId = ? AND source IN ('ipep_random', 'ipep_past')", [id]);
        }

        return res.json({ success: true, msg: '실기 오답 전체 삭제 완료' });
    } catch (error) {
        console.error('실기 오답 SQL 전체 삭제 오류:', error);
        return res.status(500).json({ success: false, msg: '실기 오답 전체 삭제 중 오류가 발생했습니다.' });
    }
});
}

module.exports = registerPracticalUserRoutes;
