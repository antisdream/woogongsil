import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { saveIpepWrongNotesRecord } from './ipepPracticePersistence.js';
import { mergeClientIpepGrade } from './ipepPracticeUtils.js';

test('wrong-note storage retains authentication and guests never write', async t => {
    const post = t.mock.method(axios, 'post', async () => ({ data: { success: true } }));
    const input = { apiBase:'', getSessionAuth: () => ({id:'learner',sessionToken:'fixture'}), userId:'learner',
        source:'ipep_past', wrongQuestions:[{question_id:23,user_answer:'draft'}], year:2026, session:2 };
    await saveIpepWrongNotesRecord(input);
    assert.deepEqual(post.mock.calls[0].arguments[1], { id:'learner',sessionToken:'fixture',source:'ipep_past',year:2026,session:2,wrongQuestions:input.wrongQuestions });
    await saveIpepWrongNotesRecord({...input,userId:''});
    assert.equal(post.mock.callCount(), 1);
});

test('display helper cannot overwrite server score from question text or aliases', () => {
    const displayed = mergeClientIpepGrade({answer_raw:'Class|클래스',score:5},{isCorrect:false,score:0,maxScore:5,correctAnswer:'Class'},'class');
    assert.equal(displayed.score,0);
    assert.equal(displayed.isCorrect,false);
    const self = mergeClientIpepGrade({}, {requiresSelfCheck:true,isCorrect:null,score:0,maxScore:5},'yes');
    assert.equal(self.isCorrect,null);
    assert.equal(self.score,0);
});
