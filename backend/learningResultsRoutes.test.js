'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const register = require('./routes/learningResultsRoutes');
const { gradeIpepQuestion } = require('./services/ipepQuestionGrader');

test('legacy client score endpoints cannot store results even with a valid member identity', async () => {
    const routes = new Map();
    let writes = 0;
    register({ app: { post: (path, handler) => routes.set(path, handler) }, pool: { query: () => { writes++; } } });
    for (const path of ['/api/practice-results', '/api/exam-results', '/api/practical-results']) {
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await routes.get(path)({ body: { id: 'member', sessionToken: 'valid-fixture-token', isCorrect: true, correctCount: 100 } }, res);
        assert.equal(res.code, 410);
        assert.equal(res.body.success, false);
    }
    assert.equal(writes, 0);
});

test('server grading accepts established aliases and preserves strict output and SQL policies', () => {
    const grade = (answer, input, policy = 'FLEX_TERM', score = 5) => gradeIpepQuestion({ answer_raw: answer, grading_policy: policy, score }, input, 'ipep_random');
    assert.equal(grade('클래스|Class', 'CLASS').score, 5);
    assert.equal(grade('원자성|Atomicity, 독립성|Isolation', '원자성, isolation').score, 5);
    assert.equal(grade('÷', '/').score, 5);
    assert.equal(grade('㉡, ㉢, ㉠', 'ㄴ, ㄷ, ㄱ').score, 5);
    assert.equal(grade('Class', 'class', 'EXACT_OUTPUT').score, 0);
    assert.equal(grade('SELECT x FROM t', 'select x from t;', 'SQL_TEXT').score, 5);
    assert.equal(grade('SELECT x FROM t', 'select x from t where 1=0', 'SQL_TEXT').score, 0);
    assert.equal(grade('Class', 'Class', 'EXACT_OUTPUT', 10).score, 10);
    assert.equal(grade('Class', '', 'FLEX_TERM').score, 0);
});

test('partial credit and self-check cannot produce a browser-selected verified score', () => {
    const partial = gradeIpepQuestion({ answer_raw:'원자성, 독립성', grading_policy:'MULTI_TERM', answer_slots_json:[['원자성'],['독립성']], score:5 }, '원자성', 'ipep_past');
    assert.equal(partial.score, 3);
    const self = gradeIpepQuestion({ answer_raw:'긴 서술형 정답', grading_policy:'SELF_CHECK', score:5 }, '긴 서술형 정답', 'ipep_past');
    assert.equal(self.requiresSelfCheck, true);
    assert.equal(self.isCorrect, null);
    assert.equal(self.score, 0);
    assert.equal(self.verified, false);
});
