// 멀티플레이 시험방, 결과 기록, 오답 API를 제공합니다.
const express = require('express');

// multiplayerRoutes.js
// 역할:
// 1. 필기 기출문제 멀티플레이 방 만들기/입장/대기/시작/문제조회/제출/결과조회 API를 담당합니다.
// 2. 기존 /api/past-exam, /api/random-question, /api/rankings 등 기존 기능은 변경하지 않는다.
// 3. 멀티플레이는 /api/multiplayer 아래에서만 동작합니다.
// 4. 방장이 방을 만들 때는 연도/회차를 고르지 않고, 서버가 과목별 20문제씩 랜덤 추첨해서 100문제 CBT를 만든다.
// 5. 같은 방 참여자는 wgs_multiplayer_room_questions에 저장된 동일한 100문제를 본다.

const {
    ROOM_STATUSES,
    MEMBER_STATUSES,
    SUBJECT_NAMES,
    MP_EXAM_TYPES,
    SUBJECT_NO_SQL,
    normalizeMpExamType,
    getMpExamTypeLabel,
    isIpepExam,
    isIpepAnswerCorrect,
    buildWrittenDuplicateInfo,
    buildPracticalDuplicateInfo,
    isWrittenDuplicate,
    isPracticalDuplicate,
    pickUniqueMultiplayerRows,
    normalizeRoomCode,
    normalizePassword,
    normalizeInt,
    getSocketRoomName,
    isValidRoomCode,
    isValidRoomPassword,
    getSubjectNameByNo,
    sanitizeQuestionForClient
} = require('./services/multiplayerQuestionUtils');

const { ensureMultiplayerSchema } = require('./services/multiplayerSchema');
const { createMultiplayerRecordBoard } = require('./services/multiplayerRecordBoard');
const { createMultiplayerAuth } = require('./services/multiplayerAuth');
const { createMultiplayerRoomCleanup } = require('./services/multiplayerRoomCleanup');
const registerMultiplayerWrongRoutes = require('./routes/multiplayer/multiplayerWrongRoutes');

function createMultiplayerRouter({ pool, io = null } = {}) {
    const router = express.Router();

    if (!pool) throw new Error('multiplayerRoutes requires mysql pool');

    ensureMultiplayerSchema(pool)
        .then(() => console.log('OK: written multiplayer schema checked'))
        .catch((err) => console.warn('WARN: written multiplayer schema check failed:', err.message));

    const { requireSessionUser, requireSessionUserForHandler } = createMultiplayerAuth({ pool });
    const { cleanupRoomIfAllWrongAnswersHidden } = createMultiplayerRoomCleanup({ pool });

    async function getActiveRoomByCode(roomCode) {
        const [rows] = await pool.query(
            `SELECT *
             FROM wgs_multiplayer_rooms
             WHERE room_code = ?
               AND status IN ('WAITING', 'PLAYING')
             ORDER BY id DESC
             LIMIT 1`,
            [roomCode]
        );
        return rows[0] || null;
    }

    async function getRoomByCode(roomCode) {
        const [rows] = await pool.query(
            `SELECT *
             FROM wgs_multiplayer_rooms
             WHERE room_code = ?
             ORDER BY FIELD(status, 'WAITING', 'PLAYING', 'FINISHED', 'CANCELLED'), id DESC
             LIMIT 1`,
            [roomCode]
        );
        return rows[0] || null;
    }

    async function getRoomDetail(roomCode) {
        const room = await getRoomByCode(roomCode);
        if (!room) return null;

        const [members] = await pool.query(
            `SELECT user_id, user_name, role, status, joined_at, submitted_at
             FROM wgs_multiplayer_room_members
             WHERE room_id = ?
               AND status <> ' LEFT' ORDER BY role = 'HOST'DESC, joined_at ASC, id ASC`,
            [room.id]
        );

        const [resultRows] = await pool.query(
            `SELECT user_id, total_score, average_score, correct_count, total_count, is_pass, submitted_at
             FROM wgs_multiplayer_results
             WHERE room_id = ?
             ORDER BY total_score DESC, correct_count DESC, submitted_at ASC`,
            [room.id]
        );

        const activeMembers = members.filter((m) => m.status !== MEMBER_STATUSES.LEFT);
        const normalMembers = activeMembers.filter((m) => m.role !== 'HOST');
        const readyMembers = normalMembers.filter((m) => m.status === MEMBER_STATUSES.READY);
        const allMembersReady = normalMembers.length === 0 || readyMembers.length === normalMembers.length;

        return {
            id: room.id,
            roomCode: room.room_code,
            // 대기방과 결과 화면에서 방장과 참여자가 인증 비밀번호를 다시 확인할 수 있도록 제공합니다.
            roomPassword: room.room_password,
            examType: normalizeMpExamType(room.exam_type),
            examTypeLabel: getMpExamTypeLabel(room.exam_type),
            maxPlayers: Number(room.max_players || 1),
            status: room.status,
            hostUserId: room.host_user_id,
            hostUserName: room.host_user_name,
            createdAt: room.created_at,
            startedAt: room.started_at,
            finishedAt: room.finished_at,
            memberCount: activeMembers.length,
            readyCount: readyMembers.length,
            notReadyCount: normalMembers.length - readyMembers.length,
            allMembersReady,
            examMode: isIpepExam(room.exam_type) ? 'IPEP_PAST_20' : 'RANDOM_CBT_5_SUBJECTS_100',
            examRuleText: isIpepExam(room.exam_type) ? '정보처리기사 실기 기출 20문제 랜덤 CBT' : '과목별 20문제씩 총 100문제 랜덤 CBT',
            members: activeMembers.map((m) => ({
                userId: m.user_id,
                userName: m.user_name || m.user_id,
                role: m.role,
                status: m.status,
                joinedAt: m.joined_at,
                submittedAt: m.submitted_at
            })),
            scoreboard: resultRows.map((r, index) => ({
                rank: index + 1,
                userId: r.user_id,
                totalScore: Number(r.total_score || 0),
                averageScore: Number(r.average_score || 0),
                correctCount: Number(r.correct_count || 0),
                totalCount: Number(r.total_count || 0),
                isPass: Boolean(r.is_pass),
                submittedAt: r.submitted_at
            }))
        };
    }

    async function emitRoomUpdated(roomCode) {
        if (!io) return;
        try {
            const detail = await getRoomDetail(roomCode);
            if (!detail) return;
            io.to(getSocketRoomName(roomCode)).emit('multiplayer:room-updated', detail);
        } catch (error) {
            console.warn('[multiplayer] emit room update failed:', error.message);
        }
    }

    async function emitKicked(roomCode, targetUserId) {
        if (!io) return;
        io.to(getSocketRoomName(roomCode)).emit('multiplayer:kicked', {
            roomCode,
            targetUserId: String(targetUserId || '')
        });
    }


    async function generateUnusedRoomCode() {
        // 1~999 중 활성 방이 없는 번호를 랜덤으로 뽑는다.
        // 먼저 랜덤 150번 시도하고, 실패하면 1부터 순차 검색합니다.
        for (let i = 0; i < 150; i += 1) {
            const candidate = String(Math.floor(Math.random() * 999) + 1);
            const existing = await getActiveRoomByCode(candidate);
            if (!existing) return candidate;
        }

        for (let code = 1; code <= 999; code += 1) {
            const candidate = String(code);
            const existing = await getActiveRoomByCode(candidate);
            if (!existing) return candidate;
        }

        throw new Error('현재 사용 가능한 방 번호가 없습니다. 잠시 후 다시 시도해주세요.');
    }

    async function ensureRoomQuestions(room) {
        const [existing] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_questions WHERE room_id = ?`,
            [room.id]
        );
        const requiredCount = isIpepExam(room.exam_type) ? 20 : 100;
        if (Number(existing[0]?.cnt || 0) === requiredCount) return;
        if (Number(existing[0]?.cnt || 0) >0) {
            await pool.query(`DELETE FROM wgs_multiplayer_room_questions WHERE room_id = ?`, [room.id]);
        }

        if (isIpepExam(room.exam_type)) {
            // 실기 선택 시 필기 questions가 아니라 ipep_past_questions에서 출제합니다.
            // 기출연도/회차가 달라도 질문과 정답이 유사하면 먼저 뽑힌 1문제만 사용합니다.
            const [candidateRows] = await pool.query(
                `SELECT question_id, exam_year AS year, exam_session AS round, question_no,
                        question_text, answer_raw, choice_img_path AS image_path, explanation_img_path AS question_img
                 FROM ipep_past_questions
                 WHERE is_active = 1
                 ORDER BY RAND()`
            );
            const rows = pickUniqueMultiplayerRows(candidateRows, 20, buildPracticalDuplicateInfo, isPracticalDuplicate);
            if (rows.length < 20) throw new Error(`중복 문제를 제외하면 실기 기출문제가 부족합니다. 현재 ${rows.length}문제 / 필요 20문제`);

            const values = rows.map((q, index) => [room.id, q.question_id, MP_EXAM_TYPES.IPEP, index + 1, q.question_no || index + 1, 6, '정보처리기사 실기']);
            await pool.query(
                `INSERT INTO wgs_multiplayer_room_questions
                 (room_id, question_id, question_source, question_order, info_id, subject_no, subject_name)
                 VALUES ?`,
                [values]
            );
            return;
        }

        const values = [];
        let order = 1;
        for (let subjectNo = 1; subjectNo <= 5; subjectNo += 1) {
            const [candidateQuestions] = await pool.query(
                `SELECT picked.question_id, picked.info_id, picked.subject_no, picked.question, picked.question_img,
                        o.opt1, o.opt2, o.opt3, o.opt4
                 FROM (
                    SELECT q.question_id, q.info_id, q.question, q.question_img, ${SUBJECT_NO_SQL} AS subject_no
                    FROM questions q
                 ) picked
                 LEFT JOIN options o ON o.question_id = picked.question_id
                 WHERE picked.subject_no = ?
                 ORDER BY RAND()`,
                [subjectNo]
            );
            // 같은 과목 안에서 질문 또는 보기 구성이 거의 같은 문제는 먼저 뽑힌 1문제만 출제합니다.
            const questions = pickUniqueMultiplayerRows(candidateQuestions, 20, buildWrittenDuplicateInfo, isWrittenDuplicate);
            if (questions.length < 20) {
                throw new Error(`${subjectNo}과목은 중복 문제를 제외하면 20문제보다 적어서 랜덤 CBT를 만들 수 없습니다. 현재 ${questions.length}문제입니다.`);
            }
            for (const q of questions) {
                values.push([room.id, q.question_id, MP_EXAM_TYPES.WRITTEN, order, q.info_id || null, subjectNo, getSubjectNameByNo(subjectNo)]);
                order += 1;
            }
        }

        await pool.query(
            `INSERT INTO wgs_multiplayer_room_questions
             (room_id, question_id, question_source, question_order, info_id, subject_no, subject_name)
             VALUES ?`,
            [values]
        );
    }

    async function getRoomQuestionsWithAnswer(roomId, includeAnswer = false) {
        const [[room]] = await pool.query(`SELECT id, exam_type FROM wgs_multiplayer_rooms WHERE id = ? LIMIT 1`, [roomId]);

        if (isIpepExam(room?.exam_type)) {
            // 실기 채점 정책(FLEX_TERM, SELF_CHECK 등)은 해설이 아니므로 explanation으로 내려보내지 않습니다.
            // explanation_text / explanation_img_path가 비어 있으면 프론트에서 빈 해설 또는 안내문으로 처리합니다.
            const answerFields = includeAnswer
                ? ', p.answer_raw AS correct_label, p.answer_raw, p.answer_aliases_json, COALESCE(p.explanation_text, \'\') AS explanation, p.explanation_img_path'
                : ', p.explanation_img_path';
            const [rows] = await pool.query(
                `SELECT rq.question_id, rq.question_order, rq.question_source, rq.info_id, rq.subject_no, rq.subject_name,
                        p.exam_year AS year, p.exam_session AS session, p.question_no, p.question_text, NULL AS content_text, NULL AS code_text, p.choice_img_path AS image_path
                        ${answerFields}
                 FROM wgs_multiplayer_room_questions rq
                 JOIN ipep_past_questions p ON p.question_id = rq.question_id
                 WHERE rq.room_id = ? AND rq.question_source = ? AND p.is_active = 1
                 ORDER BY rq.question_order ASC`,
                [roomId, MP_EXAM_TYPES.IPEP]
            );
            return rows.map((row) => sanitizeQuestionForClient({
                ...row,
                question_source: MP_EXAM_TYPES.IPEP,
                source_label: `${row.year || ''}년 ${row.session || ''}회 실기 ${row.question_no || row.question_order}번`.trim(),
                question_text: [row.question_text, row.content_text, row.code_text].filter((v) => v && String(v).trim()).join('\n\n'),
                option_1: '', option_2: '', option_3: '', option_4: '',
                image_path: row.image_path || row.question_img || '',
                subject_no: 6,
                subject_name: '정보처리기사 실기'
            }, includeAnswer));
        }

        const answerColumn = includeAnswer ? 'COALESCE(a.correct_label, o.answer) AS correct_label,' : '';
        const [rows] = await pool.query(
            `SELECT rq.question_order, rq.question_source, rq.subject_no, rq.subject_name, q.question_id, q.year, q.session, q.info_id, q.subject AS subject_id, q.question AS question_text, q.question_img,
                    o.opt1 AS option_1, o.opt2 AS option_2, o.opt3 AS option_3, o.opt4 AS option_4,
                    ${answerColumn}
                    COALESCE(a.explanation_text, '') AS explanation
             FROM wgs_multiplayer_room_questions rq
             INNER JOIN questions q ON q.question_id = rq.question_id
             LEFT JOIN options o ON o.question_id = q.question_id
             LEFT JOIN answers a ON a.question_id = q.question_id
             WHERE rq.room_id = ? AND rq.question_source = ?
             ORDER BY rq.question_order ASC`,
            [roomId, MP_EXAM_TYPES.WRITTEN]
        );

        return rows.map((row) => sanitizeQuestionForClient({ ...row, question_source: MP_EXAM_TYPES.WRITTEN }, includeAnswer));
    }

    async function buildResultForUser(room, user, answersByQuestionId) {
        const questions = await getRoomQuestionsWithAnswer(room.id, true);
        const isIpep = isIpepExam(room.exam_type);
        const subjectScores = isIpep
            ? [{ subjectName: '정보처리기사 실기', correctCount: 0, totalCount: questions.length, score: 0, isPassSubject: false }]
            : SUBJECT_NAMES.map((name) => ({ subjectName: name, correctCount: 0, totalCount: 0, score: 0 }));
        let correctCount = 0;

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(`DELETE FROM wgs_multiplayer_answers WHERE room_id = ? AND user_id = ?`, [room.id, user.id]);

            for (const q of questions) {
                const rawSelected = answersByQuestionId[String(q.question_id)] ?? answersByQuestionId[Number(q.question_id)] ?? null;
                const selected = rawSelected === null || rawSelected === undefined || rawSelected === ''? null : String(rawSelected);
                const isCorrect = selected !== null && (isIpep ? isIpepAnswerCorrect(selected, q) : String(selected) === String(q.correct_label));
                const subjectIndex = isIpep ? 0 : Math.min(4, Math.max(0, Number(q.subject_no || Math.ceil(Number(q.question_order || 1) / 20)) - 1));

                if (!isIpep) subjectScores[subjectIndex].totalCount += 1;
                if (isCorrect) {
                    correctCount += 1;
                    subjectScores[subjectIndex].correctCount += 1;
                }

                await connection.query(
                    `INSERT INTO wgs_multiplayer_answers
                     (room_id, user_id, question_id, selected_answer, is_correct)
                     VALUES (?, ?, ?, ?, ?)`,
                    [room.id, user.id, q.question_id, selected || '', isCorrect ? 1 : 0]
                );
                q.selected_answer = selected || '';
                q.is_correct = isCorrect;
            }

            if (isIpep) {
                const total = questions.length || 20;
                subjectScores[0].totalCount = total;
                subjectScores[0].score = Math.round((correctCount / total) * 100);
                subjectScores[0].isPassSubject = subjectScores[0].score >= 60;
            } else {
                for (const subject of subjectScores) subject.score = subject.correctCount * 5;
            }

            const totalCount = questions.length;
            const totalScore = isIpep ? subjectScores[0].score : correctCount;
            const averageScore = isIpep ? subjectScores[0].score : (totalCount >0 ? Math.round((correctCount / totalCount) * 100) : 0);
            const isPass = isIpep ? averageScore >= 60 : averageScore >= 60 && subjectScores.every((subject) => subject.score >= 40);

            await connection.query(
                `INSERT INTO wgs_multiplayer_results
                    (room_id, user_id, user_name, correct_count, total_count, total_score, average_score, subject_scores_json, is_pass)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    user_name = VALUES(user_name),
                    correct_count = VALUES(correct_count),
                    total_count = VALUES(total_count),
                    total_score = VALUES(total_score),
                    average_score = VALUES(average_score),
                    subject_scores_json = VALUES(subject_scores_json),
                    is_pass = VALUES(is_pass),
                    submitted_at = NOW()`,
                [room.id, user.id, user.name, correctCount, totalCount, totalScore, averageScore, JSON.stringify(subjectScores), isPass ? 1 : 0]
            );

            await connection.query(
                `UPDATE wgs_multiplayer_room_members SET status = 'SUBMITTED', submitted_at = NOW() WHERE room_id = ? AND user_id = ?`,
                [room.id, user.id]
            );

            const [notSubmitted] = await connection.query(
                `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_members WHERE room_id = ? AND status <> ' LEFT' AND status <> 'SUBMITTED'`,
                [room.id]
            );
            if (Number(notSubmitted[0]?.cnt || 0) === 0) {
                await connection.query(`UPDATE wgs_multiplayer_rooms SET status = 'FINISHED', finished_at = NOW() WHERE id = ?`, [room.id]);
            }
            await connection.commit();

            return {
                examType: normalizeMpExamType(room.exam_type),
                examTypeLabel: getMpExamTypeLabel(room.exam_type),
                correctCount,
                totalCount,
                totalScore,
                averageScore,
                subjectScores,
                isPass,
                roomCode: room.room_code,
                roomPassword: room.room_password,
                questions: questions.map((q) => ({ ...q, selected_answer: q.selected_answer, is_correct: Boolean(q.is_correct) }))
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function getSavedResult(room, userId) {
        const [rows] = await pool.query(
            `SELECT * FROM wgs_multiplayer_results WHERE room_id = ? AND user_id = ? LIMIT 1`,
            [room.id, userId]
        );
        if (rows.length === 0) return null;

        const result = rows[0];
        const [answers] = await pool.query(
            `SELECT question_id, selected_answer, is_correct
             FROM wgs_multiplayer_answers
             WHERE room_id = ? AND user_id = ?`,
            [room.id, userId]
        );
        const answerMap = new Map(answers.map((a) => [String(a.question_id), a]));
        const questions = await getRoomQuestionsWithAnswer(room.id, true);

        let subjectScores = [];
        try {
            subjectScores = typeof result.subject_scores_json === 'string'? JSON.parse(result.subject_scores_json || '[]')
                : result.subject_scores_json || [];
        } catch (e) {
            subjectScores = [];
        }

        return {
            examType: normalizeMpExamType(room.exam_type),
            examTypeLabel: getMpExamTypeLabel(room.exam_type),
            correctCount: Number(result.correct_count || 0),
            totalCount: Number(result.total_count || 0),
            totalScore: Number(result.total_score || 0),
            averageScore: Number(result.average_score || 0),
            subjectScores,
            isPass: Boolean(result.is_pass),
            submittedAt: result.submitted_at,
            // 결과 화면에서 방 번호와 비밀번호를 다시 확인할 수 있도록 방 정보를 함께 내려줍니다.
            roomCode: room.room_code,
            roomPassword: room.room_password,
            questions: questions.map((q) => {
                const ans = answerMap.get(String(q.question_id));
                return {
                    ...q,
                    selected_answer: ans ? ans.selected_answer : null,
                    is_correct: ans ? Boolean(ans.is_correct) : false
                };
            })
        };
    }


    const { buildRoomRecordBoard, formatDateOnly, formatTimeOnly } = createMultiplayerRecordBoard({
        pool,
        getRoomQuestionsWithAnswer
    });

    router.get('/meta/question-pool', requireSessionUser, async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT subject_no, COUNT(*) AS count
                 FROM (
                    SELECT ${SUBJECT_NO_SQL} AS subject_no
                    FROM questions q
                 ) picked
                 WHERE subject_no BETWEEN 1 AND 5
                 GROUP BY subject_no
                 ORDER BY subject_no ASC`
            );

            const counts = SUBJECT_NAMES.map((name, index) => {
                const found = rows.find((row) => Number(row.subject_no) === index + 1);
                return { subjectNo: index + 1, subjectName: name, count: Number(found?.count || 0) };
            });

            return res.json({ success: true, counts, totalRule: '각 과목 20문제씩 총 100문제 랜덤 추첨' });
        } catch (error) {
            console.error('[multiplayer] question pool meta error:', error);
            return res.status(500).json({ success: false, msg: '문제 풀 정보를 불러오지 못했습니다.' });
        }
    });

    router.post('/rooms', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const password = normalizePassword(req.body.password);
            const maxPlayers = Math.min(10, Math.max(1, normalizeInt(req.body.maxPlayers, 5)));
            // 방 만들기 셀렉트에서 넘어온 필기/실기 기출 유형을 저장합니다.
            const examType = normalizeMpExamType(req.body.examType || req.body.exam_type || 'written');

            if (!isValidRoomPassword(password)) {
                return res.status(400).json({ success: false, msg: '인증 비밀번호는 1부터 999999까지 숫자로 입력해주세요.' });
            }

            const roomCode = await generateUnusedRoomCode();

            const [insertResult] = await pool.query(
                `INSERT INTO wgs_multiplayer_rooms
                 (room_code, room_password, host_user_id, host_user_name, exam_type, year, session, max_players, status)
                 VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'WAITING')`,
                [roomCode, password, user.id, user.name, examType, maxPlayers]
            );

            await pool.query(
                `INSERT INTO wgs_multiplayer_room_members
                 (room_id, user_id, user_name, role, status)
                 VALUES (?, ?, ?, 'HOST', 'JOINED')`,
                [insertResult.insertId, user.id, user.name]
            );

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] create room error:', error);
            return res.status(500).json({ success: false, msg: error.message || '방 생성 중 오류가 발생했습니다.' });
        }
    });

    router.get('/rooms/:roomCode', requireSessionUser, async (req, res) => {
        try {
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const detail = await getRoomDetail(roomCode);
            if (!detail) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] get room error:', error);
            return res.status(500).json({ success: false, msg: '방 정보를 불러오지 못했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/join', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode || req.body.roomCode);
            const password = normalizePassword(req.body.password);
            const room = await getActiveRoomByCode(roomCode);

            if (!isValidRoomCode(roomCode)) return res.status(400).json({ success: false, msg: '방 번호는 1부터 999까지 입력해주세요.' });
            if (!room) return res.status(404).json({ success: false, msg: '입장 가능한 방을 찾을 수 없습니다.' });
            if (room.room_password !== password) return res.status(403).json({ success: false, msg: '인증 비밀번호가 일치하지 않습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '시험이 이미 시작되어 새로 입장할 수 없습니다.' });

            const [memberRows] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? LIMIT 1`,
                [room.id, user.id]
            );

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_members WHERE room_id = ? AND status <> ' LEFT'`,
                [room.id]
            );
            const activeCount = Number(countRows[0]?.cnt || 0);
            const isAlreadyActive = memberRows.length >0 && memberRows[0].status !== MEMBER_STATUSES.LEFT;

            if (!isAlreadyActive && activeCount >= Number(room.max_players || 1)) {
                return res.status(400).json({ success: false, msg: '방 참여 인원이 가득 찼습니다.' });
            }

            if (memberRows.length === 0) {
                await pool.query(
                    `INSERT INTO wgs_multiplayer_room_members
                     (room_id, user_id, user_name, role, status)
                     VALUES (?, ?, ?, 'MEMBER', 'JOINED')`,
                    [room.id, user.id, user.name]
                );
            } else if (memberRows[0].status === MEMBER_STATUSES.LEFT) {
                await pool.query(
                    `UPDATE wgs_multiplayer_room_members
                     SET status = 'JOINED', user_name = ?, joined_at = NOW(), submitted_at = NULL
                     WHERE room_id = ? AND user_id = ?`,
                    [user.name, room.id, user.id]
                );
            }

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] join room error:', error);
            return res.status(500).json({ success: false, msg: '방 입장 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/ready', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const ready = Boolean(req.body.ready);
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '대기 중인 방에서만 준비 상태를 바꿀 수 있습니다.' });
            if (String(room.host_user_id) === String(user.id)) return res.status(400).json({ success: false, msg: '방장은 준비완료 버튼 없이 시작 권한을 가집니다.' });

            const [memberRows] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? AND status <> ' LEFT' LIMIT 1`,
                [room.id, user.id]
            );
            if (memberRows.length === 0) return res.status(403).json({ success: false, msg: '이 방의 참여자가 아닙니다.' });

            await pool.query(
                `UPDATE wgs_multiplayer_room_members
                 SET status = ?
                 WHERE room_id = ? AND user_id = ? AND role <> 'HOST' AND status <> ' LEFT'`,
                [ready ? MEMBER_STATUSES.READY : MEMBER_STATUSES.JOINED, room.id, user.id]
            );

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] ready status error:', error);
            return res.status(500).json({ success: false, msg: '준비 상태 변경 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/password', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const password = normalizePassword(req.body.password);
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.host_user_id) !== String(user.id)) return res.status(403).json({ success: false, msg: '방장만 비밀번호를 변경할 수 있습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '대기 중인 방에서만 비밀번호를 변경할 수 있습니다.' });
            if (!isValidRoomPassword(password)) return res.status(400).json({ success: false, msg: '새 비밀번호는 1부터 999999까지 숫자로 입력해주세요.' });

            await pool.query(`UPDATE wgs_multiplayer_rooms SET room_password = ? WHERE id = ?`, [password, room.id]);
            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] change password error:', error);
            return res.status(500).json({ success: false, msg: '비밀번호 변경 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/kick', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const targetUserId = String(req.body.targetUserId || '').trim();
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.host_user_id) !== String(user.id)) return res.status(403).json({ success: false, msg: '방장만 참여자를 내보낼 수 있습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '대기 중인 방에서만 참여자를 내보낼 수 있습니다.' });
            if (!targetUserId) return res.status(400).json({ success: false, msg: '내보낼 참여자를 선택해주세요.' });
            if (String(targetUserId) === String(room.host_user_id)) return res.status(400).json({ success: false, msg: '방장은 내보낼 수 없습니다.' });

            await pool.query(
                `UPDATE wgs_multiplayer_room_members
                 SET status = ' LEFT' WHERE room_id = ? AND user_id = ? AND role <> 'HOST'`,
                [room.id, targetUserId]
            );

            const detail = await getRoomDetail(roomCode);
            await emitKicked(roomCode, targetUserId);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] kick member error:', error);
            return res.status(500).json({ success: false, msg: '참여자 내보내기 처리 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/start', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getActiveRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.host_user_id) !== String(user.id)) return res.status(403).json({ success: false, msg: '방장만 시험을 시작할 수 있습니다.' });
            if (room.status !== ROOM_STATUSES.WAITING) return res.status(400).json({ success: false, msg: '이미 시작되었거나 종료된 방입니다.' });

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM wgs_multiplayer_room_members WHERE room_id = ? AND status <> ' LEFT'`,
                [room.id]
            );
            const memberCount = Number(countRows[0]?.cnt || 0);
            if (memberCount < 1) return res.status(400).json({ success: false, msg: '참여자가 없어 시험을 시작할 수 없습니다.' });

            const [notReadyRows] = await pool.query(
                `SELECT user_name, user_id
                 FROM wgs_multiplayer_room_members
                 WHERE room_id = ?
                   AND role <> 'HOST' AND status <> ' LEFT' AND status <> 'READY'`,
                [room.id]
            );
            if (notReadyRows.length >0) {
                const names = notReadyRows.map((m) => m.user_name || m.user_id).join(', ');
                return res.status(400).json({
                    success: false,
                    msg: `아직 준비완료를 누르지 않은 참여자가 있습니다: ${names}`
                });
            }

            // 시작 요청 시점에 시험 종류를 다시 확정해 방 상태와 브라우저 캐시가 섞이지 않도록 합니다.
            // 브라우저 캐시/기존 방 데이터가 섞여도 실기 선택 시 필기 문제가 생성되지 않도록 방어합니다.
            const requestedExamType = normalizeMpExamType(req.body?.examType || room.exam_type || room.examType);
            if (requestedExamType !== normalizeMpExamType(room.exam_type || room.examType)) {
                await pool.query(`UPDATE wgs_multiplayer_rooms SET exam_type = ? WHERE id = ?`, [requestedExamType, room.id]);
                room.exam_type = requestedExamType;
                room.examType = requestedExamType;
            }

            await ensureRoomQuestions(room);

            await pool.query(`UPDATE wgs_multiplayer_rooms SET status = 'PLAYING', started_at = NOW() WHERE id = ?`, [room.id]);
            await pool.query(`UPDATE wgs_multiplayer_room_members SET status = 'PLAYING' WHERE room_id = ? AND status <> ' LEFT'`, [room.id]);

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] start room error:', error);
            return res.status(500).json({ success: false, msg: error.message || '시험 시작 중 오류가 발생했습니다.' });
        }
    });

    router.get('/rooms/:roomCode/questions', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });

            const [members] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? AND status <> ' LEFT' LIMIT 1`,
                [room.id, user.id]
            );
            if (members.length === 0) return res.status(403).json({ success: false, msg: '이 방의 참여자가 아닙니다.' });
            if (![ROOM_STATUSES.PLAYING, ROOM_STATUSES.FINISHED].includes(room.status)) return res.status(400).json({ success: false, msg: '아직 시험이 시작되지 않았습니다.' });

            const questions = await getRoomQuestionsWithAnswer(room.id, false);
            return res.json({ success: true, questions, room: await getRoomDetail(roomCode) });
        } catch (error) {
            console.error('[multiplayer] get questions error:', error);
            return res.status(500).json({ success: false, msg: '문제 목록을 불러오지 못했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/submit', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const answers = req.body.answers || {};
            const room = await getRoomByCode(roomCode);

            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (![ROOM_STATUSES.PLAYING, ROOM_STATUSES.FINISHED].includes(room.status)) return res.status(400).json({ success: false, msg: '제출 가능한 시험 상태가 아닙니다.' });

            const [members] = await pool.query(
                `SELECT * FROM wgs_multiplayer_room_members WHERE room_id = ? AND user_id = ? AND status <> ' LEFT' LIMIT 1`,
                [room.id, user.id]
            );
            if (members.length === 0) return res.status(403).json({ success: false, msg: '이 방의 참여자가 아닙니다.' });

            const result = await buildResultForUser(room, user, answers);
            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, result, room: detail });
        } catch (error) {
            console.error('[multiplayer] submit error:', error);
            return res.status(500).json({ success: false, msg: '답안 제출 중 오류가 발생했습니다.' });
        }
    });

    router.get('/rooms/:roomCode/result', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });

            const result = await getSavedResult(room, user.id);
            if (!result) return res.status(404).json({ success: false, msg: '아직 제출 결과가 없습니다.' });
            return res.json({ success: true, result, room: await getRoomDetail(roomCode) });
        } catch (error) {
            console.error('[multiplayer] result error:', error);
            return res.status(500).json({ success: false, msg: '결과 조회 중 오류가 발생했습니다.' });
        }
    });

    router.post('/rooms/:roomCode/leave', requireSessionUser, async (req, res) => {
        try {
            const user = req.wgsUser;
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const room = await getActiveRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });

            // 평상시 대기방 나가기 정책은 유지합니다.
            // 단, 제출하지 않고 시험 화면을 벗어난 사용자는 결과표에서 제외해야 하므로 LEFT 처리만 허용합니다.
            const isUnsubmittedExit = req.body?.reason === 'unsubmitted-exit';
            if (String(room.host_user_id) === String(user.id) && !isUnsubmittedExit) {
                return res.status(400).json({ success: false, msg: '방장은 대기방을 나갈 수 없습니다. 필요하면 새 방을 다시 만들어주세요.' });
            }
            if (room.status !== ROOM_STATUSES.WAITING && !isUnsubmittedExit) {
                return res.status(400).json({ success: false, msg: '시험 시작 후에는 나갈 수 없습니다.' });
            }

            await pool.query(
                `UPDATE wgs_multiplayer_room_members SET status = ' LEFT' WHERE room_id = ? AND user_id = ?`,
                [room.id, user.id]
            );

            const detail = await getRoomDetail(roomCode);
            await emitRoomUpdated(roomCode);
            return res.json({ success: true, room: detail });
        } catch (error) {
            console.error('[multiplayer] leave error:', error);
            return res.status(500).json({ success: false, msg: '방 나가기 중 오류가 발생했습니다.' });
        }
    });


    router.post('/rooms/:roomCode/record', requireSessionUser, async (req, res) => {
        try {
            // 시험 기록 확인: 방 번호와 인증 비밀번호가 맞고 전원이 제출한 경우에만 전체 채점표를 반환합니다.
            const roomCode = normalizeRoomCode(req.params.roomCode);
            const password = normalizePassword(req.body.password);
            const room = await getRoomByCode(roomCode);
            if (!room) return res.status(404).json({ success: false, msg: '방을 찾을 수 없습니다.' });
            if (String(room.room_password) !== String(password)) return res.status(403).json({ success: false, msg: '인증 비밀번호가 일치하지 않습니다.' });

            // 모든 참여자가 오답을 삭제한 방은 시험 기록 확인 시점에 한 번 더 정리합니다.
            // 삭제된 채점표가 화면에 남지 않도록 숨김 상태를 반영합니다.
            const cleanupResult = await cleanupRoomIfAllWrongAnswersHidden(room.id);
            if (cleanupResult.deleted) {
                return res.status(404).json({
                    success: false,
                    roomDeleted: true,
                    msg: '모든 오답이 삭제되어 해당 시험 기록이 정리되었습니다.'
                });
            }

            const board = await buildRoomRecordBoard(room);
            if (!board.ready) return res.status(409).json({ success: false, notReady: true, ...board });
            return res.json({ success: true, board });
        } catch (error) {
            console.error('[multiplayer] room record error:', error);
            return res.status(500).json({ success: false, msg: '방 전체 시험 기록을 불러오지 못했습니다.' });
        }
    });

    registerMultiplayerWrongRoutes({
        router,
        pool,
        requireSessionUser,
        requireSessionUserForHandler,
        normalizeInt,
        getRoomQuestionsWithAnswer,
        cleanupRoomIfAllWrongAnswersHidden,
        formatDateOnly,
        formatTimeOnly,
    });

    router._wgsEmitRoomUpdated = emitRoomUpdated;
    return router;
}

module.exports = createMultiplayerRouter;
module.exports.ensureMultiplayerSchema = ensureMultiplayerSchema;
module.exports.getSocketRoomName = getSocketRoomName;
