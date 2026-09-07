import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { saveIpepPracticeResultRecord, saveIpepWrongNotesRecord } from './ipepPracticePersistence.js';

const result = {
    apiBase: '',
    getSessionAuth: () => ({ id: 'learner', userId: 'learner', sessionToken: 'test-session', serverInstanceId: 'test-server' }),
    userId: 'learner',
    userName: 'Learner',
    mode: 'past',
    totalCount: 20,
    correctCount: 13,
    totalScore: 62.5,
    maxScore: 100,
    year: 2026,
    session: 2,
};

test('practical results retain authentication, partial score and exam fields on the personal endpoint', async (t) => {
    const requests = [];
    t.mock.method(axios, 'post', async (url, body) => {
        requests.push({ url, body });
        return { data: { success: true } };
    });
    assert.deepEqual(await saveIpepPracticeResultRecord(result), { success: true });
    assert.deepEqual(requests, [{
        url: '/api/practical-results',
        body: {
            id: 'learner', userId: 'learner', sessionToken: 'test-session', serverInstanceId: 'test-server',
            userName: 'Learner', mode: 'past', totalCount: 20, correctCount: 13,
            totalScore: 62.5, maxScore: 100, year: 2026, session: 2,
        },
    }]);
});

test('result failures propagate to the page and do not disable independent wrong-note persistence', async (t) => {
    const requests = [];
    t.mock.method(axios, 'post', async (url, body) => {
        requests.push({ url, body });
        if (url === '/api/practical-results') throw new Error('result storage unavailable');
        return { data: { success: true } };
    });
    await assert.rejects(saveIpepPracticeResultRecord(result), /result storage unavailable/);
    await saveIpepWrongNotesRecord({ ...result, source: 'ipep_past', wrongQuestions: [{ question_id: 23, user_answer: 'draft' }] });
    assert.equal(requests[1].url, '/api/save-ipep-wrong');
    assert.deepEqual(requests[1].body.wrongQuestions, [{ question_id: 23, user_answer: 'draft' }]);
});

test('unsuccessful result responses are surfaced and guests never write records', async (t) => {
    const post = t.mock.method(axios, 'post', async () => ({ data: { success: false, msg: 'save rejected' } }));
    await assert.rejects(saveIpepPracticeResultRecord(result), /save rejected/);
    await saveIpepPracticeResultRecord({ ...result, userId: '' });
    assert.equal(post.mock.callCount(), 1);
});
