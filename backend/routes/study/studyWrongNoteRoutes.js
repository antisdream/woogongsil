'use strict';
const { runtimeLog: wgsRuntimeLog } = require("../../services/runtimeLog");


const IPEP_WRONG_SOURCES = new Set(['ipep_random', 'ipep_past', 'ipep_three_week']);

function registerStudyWrongNoteRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const requireSessionUser = options.requireSessionUser;
    const authUserId = options.authUserId;

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerStudyWrongNoteRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerStudyWrongNoteRoutes requires a MySQL pool.');
    }
    if (typeof requireSessionUser !== 'function') {
        throw new Error('registerStudyWrongNoteRoutes requires requireSessionUser.');
    }
    if (typeof authUserId !== 'function') {
        throw new Error('registerStudyWrongNoteRoutes requires authUserId.');
    }

    function buildOptionList(row) {
        return [row.option_1, row.option_2, row.option_3, row.option_4]
            .map((value, index) => ({ label: String(index + 1), text: value || '' }))
            .filter((option) => option.text);
    }

    function normalizeWrittenWrong(row) {
        const source = row.source || 'written';
        const sourceTitle = buildWrittenSourceTitle(row);
        const sourceLabel = buildWrittenSourceLabel(row);
        return {
            sourceType: 'written',
            source,
            sourceLabel,
            sourceTitle,
            sourceDetail: sourceLabel,
            wrongNoteId: row.wrongNoteId,
            questionId: row.question_id,
            sourceId: `written:${row.wrongNoteId || row.question_id}`,
            year: row.year,
            session: row.session,
            subject: row.subject,
            infoId: row.info_id,
            questionNo: row.info_id,
            questionText: row.question || '',
            options: buildOptionList(row),
            userAnswer: row.user_answer || '',
            correctAnswer: row.correct_label || '',
            explanation: row.explanation_text || '',
            questionImage: row.question_img || '',
            explanationImage: row.explanation_img || '',
            savedAt: row.savedAt,
        };
    }

    function buildIpepImageUrl(row, kind, source) {
        const pathValue = row?.[`${kind}_img_path`];
        const fileValue = row?.[`${kind}_img_file`];
        const folder = source === 'ipep_past'
            ? 'past'
            : source === 'ipep_three_week'
                ? 'three-week'
                : 'random';

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

    function buildWrittenSourceTitle(row) {
        return row.source === 'past' ? '필기 기출문제 오답' : '필기 문제은행 오답';
    }

    function buildWrittenSourceLabel(row) {
        const questionNo = row.info_id || row.question_id;
        const subject = row.subject || '과목 정보 없음';
        if (row.source === 'past' && row.year && row.session) {
            return `필기 ${row.year}년 ${row.session}회차 ${subject} ${questionNo}번문제`;
        }
        return `필기 문제은행 ${subject} ${questionNo}번문제`;
    }

    function buildIpepSourceTitle(source) {
        if (source === 'ipep_past') return '실기 기출문제 오답';
        if (source === 'ipep_three_week') return '실기 3주 공략 오답';
        return '실기 문제은행 오답';
    }

    function buildIpepSourceLabel(row, source) {
        if (source === 'ipep_past') {
            const year = row.exam_year || '연도미상';
            const session = row.exam_session || '회차미상';
            const questionNo = row.question_no || row.question_id;
            return `실기 ${year}년 ${session}회차 ${questionNo}번문제`;
        }

        if (source === 'ipep_three_week') {
            const weekNo = row.week_no ? `${row.week_no}주차 ` : '';
            const sectionNo = row.section_no ? `Section ${row.section_no} ` : '';
            const questionKey = row.section_question_key || (row.question_no ? `${row.section_no || ''}-${row.question_no}` : row.question_id);
            return `실기 3주 공략 ${weekNo}${sectionNo}${questionKey}`.trim();
        }

        const subjectCode = row.subject_code ? String(row.subject_code).padStart(2, '0') : '';
        const subjectName = row.subject_name || row.subject_no || '';
        const subjectLabel = subjectCode && subjectName
            ? `${subjectCode}. ${subjectName}`
            : (subjectName || (subjectCode ? `${subjectCode}. 실기 과목` : '실기 과목 정보 없음'));
        const questionNo = row.subject_no || row.question_no || row.question_id;
        return `실기 문제은행 ${subjectLabel} ${questionNo}번문제`;
    }

    function normalizeIpepWrong(row, source) {
        const sourceTitle = buildIpepSourceTitle(source);
        const sourceLabel = buildIpepSourceLabel(row, source);
        const correctAnswer = row.answer_normalized || row.answer_raw || '';
        return {
            sourceType: source,
            source,
            sourceLabel,
            sourceTitle,
            sourceDetail: sourceLabel,
            wrongNoteId: row.wrongNoteId,
            questionId: row.question_id,
            sourceId: `${source}:${row.wrongNoteId || row.question_id}`,
            year: row.exam_year || null,
            session: row.exam_session || null,
            subject: row.subject_name || row.subject_no || row.subject_code || '',
            subjectCode: row.subject_code || '',
            subjectNo: row.subject_no || null,
            weekNo: row.week_no || null,
            sectionNo: row.section_no || null,
            sectionQuestionKey: row.section_question_key || '',
            questionOrder: row.question_order || null,
            questionNo: row.question_no || null,
            questionText: row.question_text || '',
            options: [],
            userAnswer: row.user_answer || '',
            correctAnswer,
            explanation: row.explanation_text || '',
            questionImage: buildIpepImageUrl(row, 'choice', source),
            explanationImage: buildIpepImageUrl(row, 'explanation', source),
            score: row.score || null,
            gradingPolicy: row.grading_policy || '',
            savedAt: row.savedAt,
        };
    }

    function normalizeMultiplayerWrong(row) {
        const isIpep = String(row.exam_type || '').toLowerCase() === 'ipep';
        const ipepSource = row.past_question_text ? 'ipep_past' : 'ipep_random';
        const questionText = isIpep
            ? (row.random_question_text || row.past_question_text || '')
            : (row.written_question || '');
        const correctAnswer = isIpep
            ? (row.random_answer_normalized || row.random_answer_raw || row.past_answer_normalized || row.past_answer_raw || '')
            : (row.written_correct_label || '');
        const sourceTitle = `멀티플레이 ${isIpep ? '실기' : '필기'} 오답`;
        const sourceLabel = `멀티플레이 ${isIpep ? '실기' : '필기'} ${row.room_code || row.room_id || ''}`.trim();
        const sourceDetail = `${sourceLabel} ${row.year ? `${row.year}년` : ''} ${row.session ? `${row.session}회차` : ''} ${row.question_order ? `${row.question_order}번문제` : ''}`.replace(/\s+/g, ' ').trim();

        return {
            sourceType: 'multiplayer',
            source: isIpep ? 'multiplayer_ipep' : 'multiplayer_written',
            sourceLabel,
            sourceTitle,
            sourceDetail,
            wrongNoteId: null,
            questionId: row.question_id,
            sourceId: `multiplayer:${row.room_id}:${row.question_id}`,
            roomId: row.room_id,
            roomCode: row.room_code || '',
            year: row.year || null,
            session: row.session || null,
            subject: row.subject_name || row.subject_no || '',
            questionNo: row.question_order || row.info_id || null,
            questionText,
            options: isIpep ? [] : buildOptionList(row),
            userAnswer: row.selected_answer || '',
            correctAnswer,
            explanation: isIpep
                ? (row.random_explanation_text || row.past_explanation_text || '')
                : (row.written_explanation_text || ''),
            questionImage: isIpep
                ? buildIpepImageUrl({
                    choice_img_path: row.random_choice_img_path || row.past_choice_img_path,
                    choice_img_file: row.random_choice_img_file || row.past_choice_img_file,
                }, 'choice', ipepSource)
                : (row.written_question_img || ''),
            explanationImage: isIpep
                ? buildIpepImageUrl({
                    explanation_img_path: row.random_explanation_img_path || row.past_explanation_img_path,
                    explanation_img_file: row.random_explanation_img_file || row.past_explanation_img_file,
                }, 'explanation', ipepSource)
                : (row.written_explanation_img || ''),
            savedAt: row.answeredAt,
        };
    }

    async function loadWrittenWrongNotes(userId) {
        const [rows] = await pool.query(
            `SELECT
                wn.id AS wrongNoteId,
                wn.userId,
                wn.question_id,
                wn.source,
                wn.year,
                wn.session,
                wn.user_answer,
                DATE_FORMAT(wn.savedAt, '%Y-%m-%d %H:%i:%s') AS savedAt,
                q.info_id,
                q.subject,
                q.question,
                q.question_img,
                o.opt1 AS option_1,
                o.opt2 AS option_2,
                o.opt3 AS option_3,
                o.opt4 AS option_4,
                COALESCE(a.correct_label, o.answer) AS correct_label,
                a.explanation_text,
                a.explanation_img
             FROM wgs_wrong_notes wn
             LEFT JOIN questions q ON wn.question_id = q.question_id
             LEFT JOIN options o ON wn.question_id = o.question_id
             LEFT JOIN answers a ON wn.question_id = a.question_id
             WHERE wn.userId = ?
               AND (wn.source IS NULL OR wn.source NOT IN ('ipep_random', 'ipep_past'))
             ORDER BY wn.savedAt DESC, wn.id DESC
             LIMIT 300`,
            [userId]
        );
        return rows.map(normalizeWrittenWrong);
    }

    async function loadIpepWrongNotes(userId, source) {
        const result = [];
        if (!source || source === 'ipep_random') {
            const [randomRows] = await pool.query(
                `SELECT
                    wn.id AS wrongNoteId,
                    DATE_FORMAT(wn.savedAt, '%Y-%m-%d %H:%i:%s') AS savedAt,
                    wn.user_answer,
                    q.question_id,
                    NULL AS exam_year,
                    NULL AS exam_session,
                    NULL AS question_no,
                    q.subject_code,
                    q.subject_no,
                    s.subject_name,
                    NULL AS week_no,
                    NULL AS section_no,
                    NULL AS section_question_key,
                    NULL AS question_order,
                    q.question_text,
                    q.answer_raw,
                    q.answer_normalized,
                    q.grading_policy,
                    q.score,
                    q.choice_img_file,
                    q.choice_img_path,
                    q.explanation_img_file,
                    q.explanation_img_path,
                    q.explanation_text
                 FROM wgs_wrong_notes wn
                 INNER JOIN ipep_random_questions q ON q.question_id = wn.question_id
                 LEFT JOIN ipep_subjects s ON s.subject_code = q.subject_code
                 WHERE wn.userId = ? AND wn.source = 'ipep_random'
                 ORDER BY wn.savedAt DESC, wn.id DESC
                 LIMIT 300`,
                [userId]
            );
            result.push(...randomRows.map((row) => normalizeIpepWrong(row, 'ipep_random')));
        }

        if (!source || source === 'ipep_past') {
            const [pastRows] = await pool.query(
                `SELECT
                    wn.id AS wrongNoteId,
                    DATE_FORMAT(wn.savedAt, '%Y-%m-%d %H:%i:%s') AS savedAt,
                    wn.user_answer,
                    q.question_id,
                    q.exam_year,
                    q.exam_session,
                    q.question_no,
                    NULL AS subject_code,
                    NULL AS subject_no,
                    NULL AS subject_name,
                    NULL AS week_no,
                    NULL AS section_no,
                    NULL AS section_question_key,
                    NULL AS question_order,
                    q.question_text,
                    q.answer_raw,
                    q.answer_normalized,
                    q.grading_policy,
                    q.score,
                    q.choice_img_file,
                    q.choice_img_path,
                    q.explanation_img_file,
                    q.explanation_img_path,
                    q.explanation_text
                 FROM wgs_wrong_notes wn
                 INNER JOIN ipep_past_questions q ON q.question_id = wn.question_id
                 WHERE wn.userId = ? AND wn.source = 'ipep_past'
                 ORDER BY wn.savedAt DESC, wn.id DESC
                 LIMIT 300`,
                [userId]
            );
            result.push(...pastRows.map((row) => normalizeIpepWrong(row, 'ipep_past')));
        }

        if (!source || source === 'ipep_three_week') {
            const [threeWeekRows] = await pool.query(
                `SELECT
                    wn.id AS wrongNoteId,
                    DATE_FORMAT(wn.savedAt, '%Y-%m-%d %H:%i:%s') AS savedAt,
                    wn.user_answer,
                    q.question_id,
                    NULL AS exam_year,
                    NULL AS exam_session,
                    q.question_no,
                    NULL AS subject_code,
                    NULL AS subject_no,
                    NULL AS subject_name,
                    s.week_no,
                    q.section_no,
                    q.section_question_key,
                    q.question_order,
                    q.question_text,
                    q.answer_raw,
                    q.answer_normalized,
                    q.grading_policy,
                    q.score,
                    NULL AS choice_img_file,
                    q.choice_img_path,
                    NULL AS explanation_img_file,
                    NULL AS explanation_img_path,
                    q.explanation_text
                 FROM wgs_wrong_notes wn
                 INNER JOIN ipep_three_week_questions q ON q.question_id = wn.question_id
                 INNER JOIN ipep_three_week_sections s ON s.section_no = q.section_no
                 WHERE wn.userId = ? AND wn.source = 'ipep_three_week'
                 ORDER BY wn.savedAt DESC, wn.id DESC
                 LIMIT 300`,
                [userId]
            );
            result.push(...threeWeekRows.map((row) => normalizeIpepWrong(row, 'ipep_three_week')));
        }

        return result;
    }

    async function loadMultiplayerWrongNotes(userId) {
        const [rows] = await pool.query(
            `SELECT
                ma.room_id,
                ma.question_id,
                ma.selected_answer,
                DATE_FORMAT(ma.answered_at, '%Y-%m-%d %H:%i:%s') AS answeredAt,
                r.room_code,
                r.year,
                r.session,
                r.exam_type,
                rq.question_order,
                rq.question_source,
                rq.info_id,
                rq.subject_no,
                rq.subject_name,
                q.question AS written_question,
                q.question_img AS written_question_img,
                o.opt1 AS option_1,
                o.opt2 AS option_2,
                o.opt3 AS option_3,
                o.opt4 AS option_4,
                COALESCE(a.correct_label, o.answer) AS written_correct_label,
                a.explanation_text AS written_explanation_text,
                a.explanation_img AS written_explanation_img,
                random_q.question_text AS random_question_text,
                random_q.answer_raw AS random_answer_raw,
                random_q.answer_normalized AS random_answer_normalized,
                random_q.choice_img_file AS random_choice_img_file,
                random_q.choice_img_path AS random_choice_img_path,
                random_q.explanation_img_file AS random_explanation_img_file,
                random_q.explanation_img_path AS random_explanation_img_path,
                random_q.explanation_text AS random_explanation_text,
                past_q.question_text AS past_question_text,
                past_q.answer_raw AS past_answer_raw,
                past_q.answer_normalized AS past_answer_normalized,
                past_q.choice_img_file AS past_choice_img_file,
                past_q.choice_img_path AS past_choice_img_path,
                past_q.explanation_img_file AS past_explanation_img_file,
                past_q.explanation_img_path AS past_explanation_img_path,
                past_q.explanation_text AS past_explanation_text
             FROM wgs_multiplayer_answers ma
             INNER JOIN wgs_multiplayer_rooms r ON r.id = ma.room_id
             LEFT JOIN wgs_multiplayer_room_questions rq
                    ON rq.room_id = ma.room_id AND rq.question_id = ma.question_id
             LEFT JOIN questions q
                    ON r.exam_type = 'written' AND q.question_id = ma.question_id
             LEFT JOIN options o
                    ON r.exam_type = 'written' AND o.question_id = ma.question_id
             LEFT JOIN answers a
                    ON r.exam_type = 'written' AND a.question_id = ma.question_id
             LEFT JOIN ipep_random_questions random_q
                    ON r.exam_type = 'ipep' AND random_q.question_id = ma.question_id
             LEFT JOIN ipep_past_questions past_q
                    ON r.exam_type = 'ipep' AND past_q.question_id = ma.question_id
             WHERE ma.user_id = ?
               AND COALESCE(ma.is_correct, 0) = 0
               AND NOT EXISTS (
                   SELECT 1
                   FROM wgs_multiplayer_wrong_hides h
                   WHERE h.room_id = ma.room_id
                     AND h.user_id = ma.user_id
                     AND h.question_id = ma.question_id
               )
             ORDER BY ma.answered_at DESC, ma.room_id DESC, rq.question_order ASC
             LIMIT 300`,
            [userId]
        );
        return rows.map(normalizeMultiplayerWrong);
    }

    app.get('/api/study/wrong-notes', async (req, res) => {
        try {
            const auth = await requireSessionUser(req, res, req.query.userId || req.query.id);
            if (!auth) return;

            const userId = authUserId(auth);
            const kind = String(req.query.kind || 'all').trim().toLowerCase();
            const wrongNotes = [];

            if (kind === 'all' || kind === 'written') {
                wrongNotes.push(...await loadWrittenWrongNotes(userId));
            }

            if (kind === 'all' || kind === 'ipep' || IPEP_WRONG_SOURCES.has(kind)) {
                const source = IPEP_WRONG_SOURCES.has(kind) ? kind : null;
                wrongNotes.push(...await loadIpepWrongNotes(userId, source));
            }

            if (kind === 'all' || kind === 'multiplayer') {
                wrongNotes.push(...await loadMultiplayerWrongNotes(userId));
            }

            wrongNotes.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
            return res.json({ success: true, wrongNotes });
        } catch (error) {
            wgsRuntimeLog("error", "routes/study/studyWrongNoteRoutes.js:463", '[학습노트] 오답 조회 오류:', error);
            return res.status(500).json({ success: false, msg: '오답노트를 불러오지 못했습니다.' });
        }
    });
}

module.exports = registerStudyWrongNoteRoutes;
