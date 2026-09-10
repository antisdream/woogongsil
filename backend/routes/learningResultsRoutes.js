'use strict';
const { toPublicWrittenQuestion } = require('../services/learningAttemptService');
const ipepTables = { ipep_random:'ipep_random_questions', ipep_past:'ipep_past_questions', ipep_three_week:'ipep_three_week_questions' };
function registerLearningResultsRoutes({ app, pool, buildQuestionSelect, learningAttemptService: attempts }) {
    for (const route of ['/api/practice-results','/api/exam-results','/api/practical-results']) {
        app.post(route, (_req,res) => res.status(410).json({ success:false, reason:'server_grading_required', msg:'문제를 다시 불러온 뒤 답안을 제출해주세요.' }));
    }
    app.post('/api/learning-attempts/:id/submit', async (req,res) => {
        try {
            const unexpected = ['isCorrect','correctCount','totalCount','score','totalScore','maxScore','resultMode'].some(key => Object.hasOwn(req.body,key));
            if (unexpected) return res.status(400).json({success:false,reason:'answers_only',msg:'점수 대신 실제 답안을 제출해주세요.'});
            res.json(await attempts.submit(req,res,req.params.id,req.body.answers));
        } catch (error) { attempts.respondError(res,error); }
    });
    // Review attempts never contribute to the saved exam/practice score.
    app.post('/api/learning-attempts/review', async (req,res) => {
        try {
            attempts.assertOrigin(req);
            const who = await attempts.principal(req,res);
            if (!who.userId) return res.status(401).json({success:false,msg:'로그인 후 오답을 다시 풀 수 있습니다.'});
            const questionId = Number(req.body.questionId);
            if (!Number.isSafeInteger(questionId) || questionId <= 0) return res.status(400).json({success:false});
            const source = String(req.body.source || '');
            let rows;
            if (['written','random','past'].includes(source)) {
                rows = await buildQuestionSelect(' WHERE q.question_id = ?', [questionId], ' LIMIT 1');
            } else if (Object.hasOwn(ipepTables,source)) {
                [rows] = await pool.query('SELECT * FROM '+ipepTables[source]+' WHERE question_id=? AND is_active=1 LIMIT 1',[questionId]);
            } else return res.status(400).json({success:false});
            if (!rows.length) return res.status(404).json({success:false,msg:'문제를 찾을 수 없습니다.'});
            const attemptId = await attempts.issue(req,res,source.startsWith('ipep_')?'ipep_review':'written_review',rows.map(row => ({...row,source})));
            res.json({success:true,attemptId,question:source.startsWith('ipep_')?{questionId}:toPublicWrittenQuestion(rows[0])});
        } catch(error) { attempts.respondError(res,error); }
    });
}
module.exports = registerLearningResultsRoutes;
