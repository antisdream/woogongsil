'use strict';
const { runtimeSchemaGate } = require('./schemaRuntime');

const crypto = require('node:crypto');
const { gradeIpepQuestion } = require('./ipepQuestionGrader');


const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const cookie = (req, name) => String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) || '';
const sources = new Set(['written_random', 'written_past', 'ipep_random', 'ipep_past', 'ipep_three_week', 'written_review', 'ipep_review']);

function toPublicWrittenQuestion(row) {
    const keys = ['id', 'question_id', 'year', 'session', 'info_id', 'subject', 'subject_id', 'question', 'question_text', 'question_img',
        'opt1', 'option_1', 'opt2', 'option_2', 'opt3', 'option_3', 'opt4', 'option_4'];
    return Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
}

function createLearningAttemptService({ pool, validateRealtimeSession, env = process.env, now = Date.now }) {
    const secure = env.NODE_ENV === 'production' || String(env.PUBLIC_SITE_URL || '').startsWith('https://');
    const guestCookie = secure ? '__Host-wgs_learning_guest' : 'wgs_learning_guest';
    const allowedOrigins = new Set(['https://woogongsil.site', 'https://www.woogongsil.site', env.PUBLIC_SITE_URL].filter(Boolean));
    let ready;

    function assertOrigin(req) {
        const origin = String(req.headers.origin || '');
        let allowed = allowedOrigins.has(origin);
        if (!secure) {
            try { allowed ||= ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { /* Missing origins are rejected. */ }
        }
        if (!allowed || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'learning_origin', '허용되지 않은 학습 요청입니다.');
    }

    function ensureSchema() {
        const runtime = runtimeSchemaGate(pool); if (runtime) return runtime;
        if (!ready) ready = (async () => {
            await pool.query(`CREATE TABLE IF NOT EXISTS wgs_learning_attempts (
                id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
                owner_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                user_id VARCHAR(100) NULL,
                source VARCHAR(24) NOT NULL,
                questions JSON NOT NULL,
                results JSON NOT NULL,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                INDEX idx_learning_owner (owner_hash, created_at),
                INDEX idx_learning_expiry (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
            await pool.query(`CREATE TABLE IF NOT EXISTS wgs_learning_results (
                attempt_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                result_key VARCHAR(32) NOT NULL,
                user_id VARCHAR(100) NOT NULL,
                source VARCHAR(24) NOT NULL,
                ranking_date DATE NOT NULL,
                exam_year INT NULL,
                exam_session INT NULL,
                total_count INT NOT NULL,
                attempted_count INT NOT NULL,
                correct_count INT NOT NULL,
                total_score DECIMAL(10,2) NOT NULL,
                max_score DECIMAL(10,2) NOT NULL,
                self_check_count INT NOT NULL DEFAULT 0,
                grading_version VARCHAR(24) NOT NULL DEFAULT 'server-v1',
                created_at BIGINT NOT NULL,
                PRIMARY KEY (attempt_id, result_key),
                INDEX idx_learning_user (user_id, ranking_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        })().catch(error => { ready = null; throw error; });
        return ready;
    }

    async function principal(req, res, createGuest = false) {
        const auth = await validateRealtimeSession(req);
        if (auth.valid) {
            const userId = String(auth.user?.id || auth.id || '');
            const sessionKey = auth.sessionHash || auth.sessionId || auth.sessionToken || auth.user?.sessionToken;
            if (!userId || !sessionKey) throw fail(401, 'learning_session', '로그인 상태를 다시 확인해주세요.');
            return { userId, ownerHash: digest('member|' + userId + '|' + sessionKey) };
        }
        if (req.headers['x-user-id'] || req.headers['x-session-token'] || req.body?.sessionToken || cookie(req, secure ? '__Host-wgs_member' : 'wgs_member')) {
            throw fail(401, 'learning_session', '로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
        }
        let secret = cookie(req, guestCookie);
        if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
            if (!createGuest) throw fail(401, 'learning_session', '문제를 불러온 브라우저에서 다시 제출해주세요.');
            secret = crypto.randomBytes(32).toString('base64url');
            res.append('Set-Cookie', `${guestCookie}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure ? '; Secure' : ''}`);
        }
        return { userId: null, ownerHash: digest('guest|' + secret) };
    }

    async function issue(req, res, source, rows) {
        if (!sources.has(source) || !rows.length || rows.length > 200) throw fail(400, 'learning_question_count', '한 번에 최대 200문제까지 불러올 수 있습니다. 범위를 줄여주세요.');
        await ensureSchema();
        const who = await principal(req, res, true);
        const currentTime = now();
        const id = crypto.randomBytes(32).toString('hex');
        const questions = rows.map(row => ({ ...row, question_id: Number(row.question_id || row.questionId) }));
        if (questions.some(row => !Number.isSafeInteger(row.question_id) || row.question_id <= 0) || new Set(questions.map(row => row.question_id)).size !== rows.length) {
            throw fail(500, 'learning_question_data', '문제 구성을 확인하지 못했습니다.');
        }
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            // Each owner is serialized without relying on a process-local counter.
            const lockName = 'wgs_learning_' + who.ownerHash.slice(0, 48);
            const [[lock]] = await connection.query('SELECT GET_LOCK(?, 3) AS acquired', [lockName]);
            if (!lock.acquired) throw fail(429, 'learning_busy', '잠시 후 문제를 다시 불러와주세요.');
            try {
                const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM wgs_learning_attempts WHERE owner_hash=? AND created_at>?', [who.ownerHash, currentTime - 60000]);
                if (count.total >= 30) throw fail(429, 'learning_issue_limit', '문제를 너무 빠르게 불러왔습니다. 잠시 후 다시 시도해주세요.');
                await connection.query('INSERT INTO wgs_learning_attempts (id,owner_hash,user_id,source,questions,results,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
                    [id, who.ownerHash, who.userId, source, JSON.stringify(questions), '{}', currentTime, currentTime + 4 * 3600000]);
                await connection.commit();
            } finally { await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); }
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
        res.set('Cache-Control', 'no-store');
        return id;
    }

    function grade(question, source, answer) {
        const isBlank = !answer.trim();
        if (source.startsWith('written')) {
            const correctAnswer = String(question.correct_label ?? question.answer ?? '');
            const isCorrect = !isBlank && /^[1-4]$/.test(correctAnswer) && answer === correctAnswer;
            return { questionId: question.question_id, userAnswer: answer, isBlank, isCorrect, score: isCorrect ? 1 : 0, maxScore: 1,
                correctAnswer, correct_label: correctAnswer, explanation_text: question.explanation_text || '', explanation_img: question.explanation_img || '', requiresSelfCheck: false };
        }
        return { ...gradeIpepQuestion(question, answer, question.source || source), questionId: question.question_id,
            userAnswer: answer, isBlank, explanationImgPath: question.explanation_img_path || '',
            ...(isBlank ? { isCorrect: false, score: 0 } : {}) };
    }

    async function record(connection, attempt, resultKey, grades, questions) {
        if (!attempt.user_id || attempt.source.endsWith('_review') || attempt.source === 'ipep_three_week') return false;
        const attempted = grades.filter(row => !row.isBlank).length;
        if (!attempted) return false;
        const [yearPart, monthPart, dayPart] = new Date(now() + 9 * 3600000).toISOString().slice(0, 10).split('-');
        // Existing daily aggregate keys use unpadded KST dates (2026-9-10).
        const rankingDate = `${yearPart}-${Number(monthPart)}-${Number(dayPart)}`;
        const correct = grades.filter(row => row.score > 0 && !row.requiresSelfCheck).length;
        const score = grades.reduce((sum, row) => sum + Number(row.score || 0), 0);
        const maxScore = grades.reduce((sum, row) => sum + row.maxScore, 0);
        const first = questions[0];
        const year = Number(first.year || first.exam_year) || null;
        const session = Number(first.session || first.exam_session) || null;
        await connection.query(`INSERT INTO wgs_learning_results
            (attempt_id,result_key,user_id,source,ranking_date,exam_year,exam_session,total_count,attempted_count,correct_count,total_score,max_score,self_check_count,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [attempt.id, resultKey, attempt.user_id, attempt.source, rankingDate, year, session,
            grades.length, attempted, correct, score, maxScore, grades.filter(row => row.requiresSelfCheck).length, now()]);
        if (attempt.source === 'written_random') {
            await connection.query(`INSERT INTO wgs_ranking_random (userId,date,solved_count,correct_count) VALUES (?,?,?,?)
                ON DUPLICATE KEY UPDATE solved_count=solved_count+VALUES(solved_count), correct_count=correct_count+VALUES(correct_count)`,
            [attempt.user_id, rankingDate, grades.length, correct]);
        } else if (attempt.source === 'written_past') {
            await connection.query(`INSERT INTO wgs_ranking_past (userId,date,year,session,solved_count,correct_count) VALUES (?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE solved_count=VALUES(solved_count), correct_count=VALUES(correct_count)`,
            [attempt.user_id, rankingDate, year, session, grades.length, correct]);
        }
        return true;
    }

    async function submit(req, res, attemptId, input) {
        assertOrigin(req);
        if (!/^[a-f0-9]{64}$/.test(String(attemptId))) throw fail(400, 'learning_attempt', '응시 정보가 없습니다. 문제를 다시 불러와주세요.');
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 200) throw fail(400, 'learning_answers', '답안 형식을 확인해주세요.');
        const who = await principal(req, res);
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [[attempt]] = await connection.query('SELECT * FROM wgs_learning_attempts WHERE id=? FOR UPDATE', [attemptId]);
            if (!attempt || attempt.owner_hash !== who.ownerHash) throw fail(403, 'learning_owner', '본인이 시작한 응시만 제출할 수 있습니다.');
            if (Number(attempt.expires_at) <= now()) throw fail(410, 'learning_expired', '응시 시간이 만료되었습니다. 문제를 다시 불러와주세요.');
            const allQuestions = parse(attempt.questions);
            const allIds = new Set(allQuestions.map(row => String(row.question_id)));
            const answers = Object.create(null);
            for (const [key, value] of Object.entries(input)) {
                if (!allIds.has(key) || !['string', 'number'].includes(typeof value) || String(value).length > 10000) throw fail(400, 'learning_answers', '응시 문항과 답안 형식을 확인해주세요.');
                const answer = String(value).trim();
                if (attempt.source.startsWith('written') && answer && !/^[1-4]$/.test(answer)) throw fail(400, 'learning_answers', '1~4번 중 답안을 선택해주세요.');
                answers[key] = answer;
            }
            const isExam = ['written_past', 'ipep_past'].includes(attempt.source);
            if (!isExam && Object.keys(answers).length !== 1) throw fail(400, 'learning_answers', '한 문항의 답안을 제출해주세요.');
            const questions = isExam ? allQuestions : allQuestions.filter(row => Object.hasOwn(answers, row.question_id));
            const submittedAnswers = Object.fromEntries(questions.map(row => [String(row.question_id), answers[row.question_id] || '']));
            const resultKey = isExam ? 'exam' : String(questions[0].question_id);
            const answerHash = digest(JSON.stringify(submittedAnswers));
            const stored = parse(attempt.results);
            if (stored[resultKey]) {
                if (stored[resultKey].answerHash !== answerHash) throw fail(409, 'learning_finalized', '이미 제출한 답안입니다. 다시 풀려면 새 응시를 시작해주세요.');
                await connection.commit();
                res.set('Cache-Control', 'no-store');
                return { ...stored[resultKey].response, replayed: true };
            }
            const grades = questions.map(row => grade(row, attempt.source, submittedAnswers[row.question_id]));
            const recorded = await record(connection, attempt, resultKey, grades, questions);
            const response = { success: true, attemptId, grades, recorded, replayed: false, gradingVersion: 'server-v1',
                summary: { totalCount: grades.length, attemptedCount: grades.filter(row => !row.isBlank).length,
                    correctCount: grades.filter(row => row.score > 0 && !row.requiresSelfCheck).length,
                    totalScore: grades.reduce((sum, row) => sum + Number(row.score || 0), 0),
                    maxScore: grades.reduce((sum, row) => sum + row.maxScore, 0),
                    selfCheckCount: grades.filter(row => row.requiresSelfCheck).length } };
            stored[resultKey] = { answerHash, response };
            await connection.query('UPDATE wgs_learning_attempts SET results=? WHERE id=?', [JSON.stringify(stored), attemptId]);
            await connection.commit();
            res.set('Cache-Control', 'no-store');
            return response;
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }

    function respondError(res, error) {
        if (!error.status) console.error('[learning] request failed:', error.code || 'internal');
        return res.status(error.status || 500).json({ success: false, reason: error.reason || 'learning_failed', msg: error.status ? error.message : '채점 결과를 저장하지 못했습니다. 답안을 유지하고 다시 제출해주세요.' });
    }
    return { ensureSchema, issue, submit, principal, respondError, assertOrigin };
}

module.exports = { createLearningAttemptService, toPublicWrittenQuestion };
