'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registerLearningResultsRoutes = require('./routes/learningResultsRoutes');

function fixture(auth = { valid: true, user: { id: 'learner', name: 'Learner' } }) {
    const handlers = new Map();
    const queries = [];
    const stored = new Map();
    const practical = { random: [], past: [] };
    let saves = 0;
    registerLearningResultsRoutes({
        app: { post: (path, handler) => handlers.set(path, handler) },
        pool: { query: async (sql, params) => {
            queries.push({ sql, params });
            if (sql.includes('wgs_ranking_past')) {
                const key = params.slice(0, 4).join('|');
                const previous = stored.get(key) || [0, 0];
                const replacement = /solved_count = VALUES\(solved_count\)/.test(sql);
                stored.set(key, replacement ? params.slice(4) : params.slice(4).map((n, i) => Math.max(0, previous[i] + n)));
            }
            return [{ affectedRows: 1 }];
        } },
        validateRealtimeSession: async () => auth,
        getSeasonStatus: () => ({ rankingDate: '2026-9-7', season: 'daily' }),
        getUserById: async () => ({ id: 'learner', name: 'Learner' }),
        getIpepRankingStore: () => structuredClone(practical),
        saveIpepRankingStore: value => { Object.assign(practical, value); saves += 1; },
        safeNumber: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
        getKSTDateTime: () => '2026-09-07 20:00:00',
    });
    async function call(path, body) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
        await handlers.get(path)({ body }, res);
        return res;
    }
    return { call, queries, stored, practical, handlers, saves: () => saves };
}

test('written exam absolute submission replaces only the matching personal result and is repeatable', async () => {
    const f = fixture();
    const result = { userId: 'learner', examYear: 2026, examSession: 2, totalCount: 100, correctCount: 75, resultMode: 'replace' };
    for (let i = 0; i < 2; i += 1) assert.equal((await f.call('/api/exam-results', result)).statusCode, 200);
    assert.deepEqual([...f.stored.values()], [[100, 75]]);
    await f.call('/api/exam-results', { ...result, correctCount: 82 });
    assert.deepEqual([...f.stored.values()], [[100, 82]]);
    assert.deepEqual(f.queries[0].params.slice(0, 4), ['learner', '2026-9-7', 2026, 2]);
    assert.match(f.queries[0].sql, /correct_count = VALUES\(correct_count\)/);
});

test('written exam legacy delta mode accepts positive and negative corrections', async () => {
    const f = fixture();
    const base = { userId: 'learner', examYear: 2026, examSession: 2 };
    await f.call('/api/exam-results', { ...base, totalCount: 10, correctCount: 8 });
    await f.call('/api/exam-results', { ...base, totalCount: -2, correctCount: -1 });
    assert.deepEqual([...f.stored.values()], [[8, 7]]);
    assert.match(f.queries[0].sql, /GREATEST\(0, solved_count \+ VALUES\(solved_count\)\)/);
});

test('missing or invalid absolute result counts never reach the storage query', async () => {
    const f = fixture();
    const invalidCounts = [{ totalCount: -1 }, { totalCount: 2.5 }, { correctCount: -1 }, { correctCount: 11 }, { totalCount: 'NaN' }];
    for (const key of ['totalCount', 'correctCount']) {
        for (const value of [undefined, null, '', '  ', false, [], {}]) invalidCounts.push({ [key]: value });
    }
    for (const counts of invalidCounts) {
        const res = await f.call('/api/exam-results', { userId: 'learner', resultMode: 'replace', totalCount: 10, correctCount: 5, ...counts });
        assert.equal(res.statusCode, 400);
    }
    assert.equal(f.queries.length, 0);
});

test('all personal result endpoints reject expired sessions and another user id', async () => {
    for (const path of ['/api/practice-results', '/api/exam-results', '/api/practical-results']) {
        const expired = fixture({ valid: false, reason: 'session_expired' });
        assert.equal((await expired.call(path, { userId: 'learner' })).statusCode, 401);
        const other = fixture();
        assert.equal((await other.call(path, { userId: 'another' })).statusCode, 403);
        assert.equal(other.queries.length, 0);
        assert.equal(other.saves(), 0);
    }
});

test('practice result keeps the existing per-answer personal counter', async () => {
    const f = fixture();
    assert.equal((await f.call('/api/practice-results', { userId: 'learner', isCorrect: true })).body.success, true);
    assert.deepEqual(f.queries[0].params, ['learner', '2026-9-7', 1]);
    assert.match(f.queries[0].sql, /solved_count = solved_count \+ 1/);
});

test('practical result keeps random accumulation and latest past score including partial credit', async () => {
    const f = fixture();
    const random = { id: 'learner', mode: 'random', totalCount: 1, correctCount: 1, totalScore: 0.5, attemptedCount: 1 };
    await f.call('/api/practical-results', random);
    await f.call('/api/practical-results', random);
    assert.equal(f.practical.random[0].totalCount, 2);
    assert.equal(f.practical.random[0].totalScore, 1);
    const past = { id: 'learner', mode: 'past', year: 2026, session: 2, detailKey: '2026-2', totalCount: 20, correctCount: 13, totalScore: 62.5, maxScore: 100, attemptedCount: 20 };
    await f.call('/api/practical-results', past);
    await f.call('/api/practical-results', { ...past, totalScore: 71.5 });
    assert.equal(f.practical.past.length, 1);
    assert.equal(f.practical.past[0].totalScore, 71.5);
    assert.equal(f.practical.past[0].correctCount, 13);
    const before = f.saves();
    assert.equal((await f.call('/api/practical-results', { ...past, attemptedCount: 0 })).body.skipped, true);
    assert.equal(f.saves(), before);
    assert.equal(f.handlers.has('/api/ipep-ranking'), false);
});
