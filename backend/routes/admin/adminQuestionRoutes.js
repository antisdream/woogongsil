'use strict';

function registerAdminQuestionRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;
    const validateAdminSession = options.validateAdminSession;
    const adminTableExists = options.adminTableExists;
    const adminColumnExists = options.adminColumnExists;
    const SERVER_INSTANCE_ID = options.serverInstanceId;

    const missing = Object.entries({ app, pool, validateAdminSession, adminTableExists, adminColumnExists, SERVER_INSTANCE_ID })
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);
    if (missing.length >0) {
        throw new Error(`registerAdminQuestionRoutes missing dependencies: ${missing.join(', ')}`);
    }

    const ADMIN_QUESTION_TYPES = new Set(['written', 'ipep_random', 'ipep_past']);
    const IPEP_GRADING_POLICIES = new Set(['FLEX_TERM', 'MULTI_TERM', 'EXACT_OUTPUT', 'SQL_TEXT', 'SELF_CHECK']);

    function normalizeAdminQuestionType(value) {
        const type = String(value || 'written').trim();
        return ADMIN_QUESTION_TYPES.has(type) ? type : 'written';
    }

    function adminCleanText(value, maxLength = 20000) {
        const text = value === null || value === undefined ? '' : String(value);
        return text.length >maxLength ? text.slice(0, maxLength) : text;
    }

    function adminNullableText(value, maxLength = 20000) {
        const text = adminCleanText(value, maxLength).trim();
        return text === ''? null : text;
    }

    function adminNumber(value, fallback = null) {
        if (value === null || value === undefined || value === '') return fallback;
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function adminTinyInt(value, fallback = 1) {
        const num = adminNumber(value, fallback);
        return num ? 1 : 0;
    }

    function adminLimit(value) {
        const num = Number(value || 20);
        if (!Number.isFinite(num)) return 20;
        return Math.min(Math.max(Math.floor(num), 5), 100);
    }

    function adminPage(value) {
        const num = Number(value || 1);
        if (!Number.isFinite(num)) return 1;
        return Math.max(Math.floor(num), 1);
    }

    function adminToJsonColumn(value) {
        if (value === null || value === undefined || value === '') return null;

        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
            return JSON.stringify(value);
        }

        const textValue = String(value).trim();
        if (!textValue) return null;

        try {
            JSON.parse(textValue);
            return textValue;
        } catch (error) {
            const err = new Error('JSON 입력값 형식이 올바르지 않습니다. 예: ["정답1", "정답2"]');
            err.statusCode = 400;
            throw err;
        }
    }

    async function requireAdminQuestionAccess(req, res) {
        const adminCheck = await validateAdminSession(req);
        if (!adminCheck.valid || !adminCheck.isAdmin) {
            const statusCode = adminCheck.reason === 'not_admin'? 403 : 401;
            res.status(statusCode).json({
                success: false,
                msg: adminCheck.message || '관리자 인증이 필요합니다.',
                reason: adminCheck.reason || 'not_admin',
                serverInstanceId: SERVER_INSTANCE_ID,
            });
            return null;
        }
        return adminCheck;
    }

    async function ensureIpepAdminExplanationColumns() {
        const targets = ['ipep_random_questions', 'ipep_past_questions'];

        for (const tableName of targets) {
            const tableOk = await adminTableExists(tableName);
            if (!tableOk) continue;

            const hasExplanationText = await adminColumnExists(tableName, 'explanation_text');
            if (!hasExplanationText) {
                // 실기 데이터에 해설 텍스트를 추가로 적어둘 수 있도록 NULL 허용 컬럼만 더합니다.
                // 기존 문제 풀이/채점 로직은 이 컬럼을 필수로 사용하지 않으므로 안전하다.
                await pool.query(`ALTER TABLE ${tableName} ADD COLUMN explanation_text TEXT NULL`);
            }
        }
    }

    function buildWrittenQuestionWhere(query) {
        const whereParts = [];
        const params = [];

        const keyword = String(query.search || query.keyword || '').trim();
        if (keyword) {
            whereParts.push(`(
                CAST(q.question_id AS CHAR) LIKE ?
                OR q.question LIKE ?
                OR COALESCE(a.explanation_text, '') LIKE ?
                OR COALESCE(o.opt1, '') LIKE ?
                OR COALESCE(o.opt2, '') LIKE ?
                OR COALESCE(o.opt3, '') LIKE ?
                OR COALESCE(o.opt4, '') LIKE ?
            )`);
            const like = `%${keyword}%`;
            params.push(like, like, like, like, like, like, like);
        }

        const year = adminNumber(query.year, null);
        if (year !== null) {
            whereParts.push('q.year = ?');
            params.push(year);
        }

        const session = adminNumber(query.session, null);
        if (session !== null) {
            whereParts.push('q.session = ?');
            params.push(session);
        }

        const subject = adminNumber(query.subject, null);
        if (subject !== null) {
            whereParts.push('q.subject = ?');
            params.push(subject);
        }

        return {
            whereSql: whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '',
            params,
        };
    }

    function buildIpepQuestionWhere(type, query) {
        const whereParts = [];
        const params = [];
        const keyword = String(query.search || query.keyword || '').trim();

        if (keyword) {
            whereParts.push(`(
                CAST(q.question_id AS CHAR) LIKE ?
                OR q.question_text LIKE ?
                OR COALESCE(q.answer_raw, '') LIKE ?
                OR COALESCE(q.answer_normalized, '') LIKE ?
                OR COALESCE(q.explanation_text, '') LIKE ?
                OR COALESCE(q.choice_img_file, '') LIKE ?
                OR COALESCE(q.explanation_img_file, '') LIKE ?
            )`);
            const like = `%${keyword}%`;
            params.push(like, like, like, like, like, like, like);
        }

        const active = String(query.active || '').trim();
        if (active === '1' || active === '0') {
            whereParts.push('q.is_active = ?');
            params.push(Number(active));
        }

        if (type === 'ipep_random') {
            const subjectCode = String(query.subjectCode || query.subject_code || '').trim();
            if (subjectCode) {
                whereParts.push('q.subject_code = ?');
                params.push(subjectCode.padStart(2, '0'));
            }
        }

        if (type === 'ipep_past') {
            const year = adminNumber(query.year, null);
            if (year !== null) {
                whereParts.push('q.exam_year = ?');
                params.push(year);
            }

            const session = adminNumber(query.session, null);
            if (session !== null) {
                whereParts.push('q.exam_session = ?');
                params.push(session);
            }
        }

        return {
            whereSql: whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '',
            params,
        };
    }

    function normalizeWrittenAdminRow(row) {
        return {
            type: 'written',
            id: row.question_id,
            question_id: row.question_id,
            year: row.year,
            session: row.session,
            info_id: row.info_id,
            subject: row.subject,
            subjectName: row.subject_name || '',
            question: row.question || '',
            question_text: row.question || '',
            question_img: row.question_img || '',
            opt1: row.opt1 || '',
            opt2: row.opt2 || '',
            opt3: row.opt3 || '',
            opt4: row.opt4 || '',
            option_1: row.opt1 || '',
            option_2: row.opt2 || '',
            option_3: row.opt3 || '',
            option_4: row.opt4 || '',
            answer: row.answer || '',
            correct_label: row.correct_label === null || row.correct_label === undefined ? '' : row.correct_label,
            explanation_text: row.explanation_text || '',
            explanation_img: row.explanation_img || '',
            updated_at: row.updated_at || null,
        };
    }

    function normalizeIpepAdminRow(row, type) {
        return {
            type,
            id: row.question_id,
            question_id: row.question_id,
            subject_code: row.subject_code || '',
            subject_name: row.subject_name || '',
            subject_no: row.subject_no || '',
            exam_year: row.exam_year || '',
            exam_session: row.exam_session || '',
            question_no: row.question_no || '',
            question_text: row.question_text || '',
            answer_raw: row.answer_raw || '',
            answer_normalized: row.answer_normalized || '',
            answer_aliases_json: row.answer_aliases_json || null,
            answer_slots_json: row.answer_slots_json || null,
            grading_policy: row.grading_policy || 'FLEX_TERM',
            score: row.score || 5,
            choice_img_stem: row.choice_img_stem || '',
            choice_img_file: row.choice_img_file || '',
            choice_img_path: row.choice_img_path || '',
            explanation_img_stem: row.explanation_img_stem || '',
            explanation_img_file: row.explanation_img_file || '',
            explanation_img_path: row.explanation_img_path || '',
            explanation_text: row.explanation_text || '',
            is_active: Number(row.is_active || 0),
            created_at: row.created_at || null,
            updated_at: row.updated_at || null,
        };
    }

    async function getAdminQuestionDetail(type, questionId) {
        if (type === 'written') {
            const [rows] = await pool.query(
                `SELECT
                    q.question_id,
                    q.year,
                    q.session,
                    q.info_id,
                    q.subject,
                    s.name AS subject_name,
                    q.question,
                    q.question_img,
                    o.option_id,
                    o.opt1,
                    o.opt2,
                    o.opt3,
                    o.opt4,
                    o.answer,
                    a.correct_label,
                    a.explanation_text,
                    a.explanation_img
                 FROM questions q
                 LEFT JOIN subjects s ON q.subject = s.subject_id
                 LEFT JOIN options o ON q.question_id = o.question_id
                 LEFT JOIN answers a ON q.question_id = a.question_id
                 WHERE q.question_id = ?
                 LIMIT 1`,
                [questionId]
            );
            return rows[0] ? normalizeWrittenAdminRow(rows[0]) : null;
        }

        await ensureIpepAdminExplanationColumns();
        const tableName = type === 'ipep_past'? 'ipep_past_questions' : 'ipep_random_questions';

        if (type === 'ipep_random') {
            const [rows] = await pool.query(
                `SELECT q.*, s.subject_name
                 FROM ${tableName} q
                 LEFT JOIN ipep_subjects s ON q.subject_code = s.subject_code
                 WHERE q.question_id = ?
                 LIMIT 1`,
                [questionId]
            );
            return rows[0] ? normalizeIpepAdminRow(rows[0], type) : null;
        }

        const [rows] = await pool.query(
            `SELECT q.*
             FROM ${tableName} q
             WHERE q.question_id = ?
             LIMIT 1`,
            [questionId]
        );
        return rows[0] ? normalizeIpepAdminRow(rows[0], type) : null;
    }

    async function handleAdminQuestionMeta(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;
            await ensureIpepAdminExplanationColumns();

            const [[writtenCountRows], [ipepRandomCountRows], [ipepPastCountRows], [subjectRows], [ipepSubjectRows], [catalogRows]] = await Promise.all([
                pool.query('SELECT COUNT(*) AS total FROM questions'),
                pool.query('SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM ipep_random_questions'),
                pool.query('SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM ipep_past_questions'),
                pool.query('SELECT subject_id, name FROM subjects ORDER BY subject_id ASC'),
                pool.query('SELECT subject_code, subject_name, display_order FROM ipep_subjects ORDER BY display_order ASC'),
                pool.query('SELECT exam_year, exam_session, question_count, is_open FROM ipep_exam_catalog ORDER BY exam_year DESC, exam_session ASC'),
            ]);

            return res.json({
                success: true,
                summary: {
                    written: Number(writtenCountRows?.[0]?.total || 0),
                    ipepRandom: Number(ipepRandomCountRows?.[0]?.total || 0),
                    ipepRandomActive: Number(ipepRandomCountRows?.[0]?.active || 0),
                    ipepPast: Number(ipepPastCountRows?.[0]?.total || 0),
                    ipepPastActive: Number(ipepPastCountRows?.[0]?.active || 0),
                },
                subjects: subjectRows,
                ipepSubjects: ipepSubjectRows,
                ipepExamCatalog: catalogRows,
            });
        } catch (error) {
            console.error('[admin questions meta error]', error);
            return res.status(500).json({ success: false, msg: '문제/해설 관리 기본 정보를 불러오는 중 오류가 발생했습니다.' });
        }
    }

    async function handleAdminQuestionList(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;

            const type = normalizeAdminQuestionType(req.query.type);
            const limit = adminLimit(req.query.limit);
            const page = adminPage(req.query.page);
            const offset = (page - 1) * limit;

            if (type === 'written') {
                const { whereSql, params } = buildWrittenQuestionWhere(req.query);
                const [countRows] = await pool.query(
                    `SELECT COUNT(DISTINCT q.question_id) AS total
                     FROM questions q
                     LEFT JOIN options o ON q.question_id = o.question_id
                     LEFT JOIN answers a ON q.question_id = a.question_id
                     ${whereSql}`,
                    params
                );
                const [rows] = await pool.query(
                    `SELECT
                        q.question_id,
                        q.year,
                        q.session,
                        q.info_id,
                        q.subject,
                        s.name AS subject_name,
                        q.question,
                        q.question_img,
                        o.opt1,
                        o.opt2,
                        o.opt3,
                        o.opt4,
                        o.answer,
                        a.correct_label,
                        a.explanation_text,
                        a.explanation_img
                     FROM questions q
                     LEFT JOIN subjects s ON q.subject = s.subject_id
                     LEFT JOIN options o ON q.question_id = o.question_id
                     LEFT JOIN answers a ON q.question_id = a.question_id
                     ${whereSql}
                     ORDER BY q.year DESC, q.session ASC, q.info_id ASC, q.question_id ASC
                     LIMIT ? OFFSET ?`,
                    [...params, limit, offset]
                );

                const total = Number(countRows?.[0]?.total || 0);
                return res.json({ success: true, type, page, limit, total, rows: rows.map(normalizeWrittenAdminRow) });
            }

            await ensureIpepAdminExplanationColumns();
            const tableName = type === 'ipep_past'? 'ipep_past_questions' : 'ipep_random_questions';
            const { whereSql, params } = buildIpepQuestionWhere(type, req.query);
            const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM ${tableName} q ${whereSql}`, params);

            if (type === 'ipep_random') {
                const [rows] = await pool.query(
                    `SELECT q.*, s.subject_name
                     FROM ${tableName} q
                     LEFT JOIN ipep_subjects s ON q.subject_code = s.subject_code
                     ${whereSql}
                     ORDER BY q.subject_code ASC, q.subject_no ASC, q.question_id ASC
                     LIMIT ? OFFSET ?`,
                    [...params, limit, offset]
                );
                const total = Number(countRows?.[0]?.total || 0);
                return res.json({ success: true, type, page, limit, total, rows: rows.map((row) => normalizeIpepAdminRow(row, type)) });
            }

            const [rows] = await pool.query(
                `SELECT q.*
                 FROM ${tableName} q
                 ${whereSql}
                 ORDER BY q.exam_year DESC, q.exam_session ASC, q.question_no ASC, q.question_id ASC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            const total = Number(countRows?.[0]?.total || 0);
            return res.json({ success: true, type, page, limit, total, rows: rows.map((row) => normalizeIpepAdminRow(row, type)) });
        } catch (error) {
            console.error('[admin questions list error]', error);
            return res.status(500).json({ success: false, msg: '문제 목록을 불러오는 중 오류가 발생했습니다.' });
        }
    }

    async function handleAdminQuestionDetail(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;

            const type = normalizeAdminQuestionType(req.params.type);
            const questionId = adminNumber(req.params.questionId, null);
            if (!questionId) return res.status(400).json({ success: false, msg: 'questionId가 필요합니다.' });

            const detail = await getAdminQuestionDetail(type, questionId);
            if (!detail) return res.status(404).json({ success: false, msg: '문제를 찾을 수 없습니다.' });

            return res.json({ success: true, type, detail });
        } catch (error) {
            console.error('[admin questions detail error]', error);
            return res.status(500).json({ success: false, msg: '문제 상세 정보를 불러오는 중 오류가 발생했습니다.' });
        }
    }

    async function updateWrittenAdminQuestion(questionId, body) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await connection.query(
                `UPDATE questions
                 SET year = ?, session = ?, info_id = ?, subject = ?, question = ?, question_img = ?
                 WHERE question_id = ?`,
                [
                    adminNumber(body.year, null),
                    adminNumber(body.session, null),
                    adminNumber(body.info_id, null),
                    adminNumber(body.subject, null),
                    adminCleanText(body.question || body.question_text, 50000),
                    adminNullableText(body.question_img, 255),
                    questionId,
                ]
            );

            const [optionRows] = await connection.query('SELECT option_id FROM options WHERE question_id = ? LIMIT 1', [questionId]);
            const optionValues = [
                adminCleanText(body.opt1 || body.option_1, 20000),
                adminCleanText(body.opt2 || body.option_2, 20000),
                adminCleanText(body.opt3 || body.option_3, 20000),
                adminCleanText(body.opt4 || body.option_4, 20000),
                adminCleanText(body.answer, 5000),
            ];

            if (optionRows.length >0) {
                await connection.query(
                    `UPDATE options SET opt1 = ?, opt2 = ?, opt3 = ?, opt4 = ?, answer = ? WHERE question_id = ?`,
                    [...optionValues, questionId]
                );
            } else {
                await connection.query(
                    `INSERT INTO options (question_id, opt1, opt2, opt3, opt4, answer) VALUES (?, ?, ?, ?, ?, ?)`,
                    [questionId, ...optionValues]
                );
            }

            await connection.query(
                `INSERT INTO answers (question_id, correct_label, explanation_text, explanation_img)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    correct_label = VALUES(correct_label),
                    explanation_text = VALUES(explanation_text),
                    explanation_img = VALUES(explanation_img)`,
                [
                    questionId,
                    adminNumber(body.correct_label, 1),
                    adminCleanText(body.explanation_text, 50000),
                    adminNullableText(body.explanation_img, 255),
                ]
            );

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function updateIpepAdminQuestion(type, questionId, body) {
        await ensureIpepAdminExplanationColumns();
        const tableName = type === 'ipep_past'? 'ipep_past_questions' : 'ipep_random_questions';
        const gradingPolicy = IPEP_GRADING_POLICIES.has(String(body.grading_policy || '').trim())
            ? String(body.grading_policy).trim()
            : 'FLEX_TERM';

        if (type === 'ipep_random') {
            await pool.query(
                `UPDATE ${tableName}
                 SET subject_code = ?,
                     subject_no = ?,
                     question_text = ?,
                     answer_raw = ?,
                     answer_normalized = ?,
                     answer_aliases_json = ?,
                     answer_slots_json = ?,
                     grading_policy = ?,
                     score = ?,
                     choice_img_stem = ?,
                     choice_img_file = ?,
                     choice_img_path = ?,
                     explanation_img_stem = ?,
                     explanation_img_file = ?,
                     explanation_img_path = ?,
                     explanation_text = ?,
                     is_active = ?
                 WHERE question_id = ?`,
                [
                    String(body.subject_code || '').trim().padStart(2, '0'),
                    adminNumber(body.subject_no, null),
                    adminCleanText(body.question_text, 50000),
                    adminCleanText(body.answer_raw, 50000),
                    adminCleanText(body.answer_normalized, 50000),
                    adminToJsonColumn(body.answer_aliases_json),
                    adminToJsonColumn(body.answer_slots_json),
                    gradingPolicy,
                    adminNumber(body.score, 5),
                    adminNullableText(body.choice_img_stem, 100),
                    adminNullableText(body.choice_img_file, 255),
                    adminNullableText(body.choice_img_path, 255),
                    adminNullableText(body.explanation_img_stem, 100),
                    adminNullableText(body.explanation_img_file, 255),
                    adminNullableText(body.explanation_img_path, 255),
                    adminCleanText(body.explanation_text, 50000),
                    adminTinyInt(body.is_active, 1),
                    questionId,
                ]
            );
            return;
        }

        await pool.query(
            `UPDATE ${tableName}
             SET exam_year = ?,
                 exam_session = ?,
                 question_no = ?,
                 question_text = ?,
                 answer_raw = ?,
                 answer_normalized = ?,
                 answer_aliases_json = ?,
                 answer_slots_json = ?,
                 grading_policy = ?,
                 score = ?,
                 choice_img_stem = ?,
                 choice_img_file = ?,
                 choice_img_path = ?,
                 explanation_img_stem = ?,
                 explanation_img_file = ?,
                 explanation_img_path = ?,
                 explanation_text = ?,
                 is_active = ?
             WHERE question_id = ?`,
            [
                adminNumber(body.exam_year, null),
                adminNumber(body.exam_session, null),
                adminNumber(body.question_no, null),
                adminCleanText(body.question_text, 50000),
                adminCleanText(body.answer_raw, 50000),
                adminCleanText(body.answer_normalized, 50000),
                adminToJsonColumn(body.answer_aliases_json),
                adminToJsonColumn(body.answer_slots_json),
                gradingPolicy,
                adminNumber(body.score, 5),
                adminNullableText(body.choice_img_stem, 100),
                adminNullableText(body.choice_img_file, 255),
                adminNullableText(body.choice_img_path, 255),
                adminNullableText(body.explanation_img_stem, 100),
                adminNullableText(body.explanation_img_file, 255),
                adminNullableText(body.explanation_img_path, 255),
                adminCleanText(body.explanation_text, 50000),
                adminTinyInt(body.is_active, 1),
                questionId,
            ]
        );
    }

    async function handleAdminQuestionUpdate(req, res) {
        try {
            const adminCheck = await requireAdminQuestionAccess(req, res);
            if (!adminCheck) return;

            const type = normalizeAdminQuestionType(req.params.type);
            const questionId = adminNumber(req.params.questionId, null);
            if (!questionId) return res.status(400).json({ success: false, msg: 'questionId가 필요합니다.' });

            if (type === 'written') {
                await updateWrittenAdminQuestion(questionId, req.body || {});
            } else {
                await updateIpepAdminQuestion(type, questionId, req.body || {});
            }

            const detail = await getAdminQuestionDetail(type, questionId);
            return res.json({
                success: true,
                msg: '문제/해설 정보가 저장되었습니다.',
                type,
                detail,
                updatedBy: adminCheck.user.id,
            });
        } catch (error) {
            console.error('[admin questions update error]', error);
            const statusCode = error.statusCode || (error.code === 'ER_DUP_ENTRY'? 409 : 500);
            const msg = error.code === 'ER_DUP_ENTRY'? '이미 같은 문제번호/회차/과목 번호가 존재합니다. 고유 번호를 확인해주세요.'
                : error.message || '문제/해설 저장 중 오류가 발생했습니다.';
            return res.status(statusCode).json({ success: false, msg });
        }
    }

    app.get('/api/admin/questions/meta', handleAdminQuestionMeta);
    app.get('/api/admin/questions', handleAdminQuestionList);
    app.get('/api/admin/questions/:type/:questionId', handleAdminQuestionDetail);
    app.put('/api/admin/questions/:type/:questionId', handleAdminQuestionUpdate);
}

module.exports = registerAdminQuestionRoutes;
