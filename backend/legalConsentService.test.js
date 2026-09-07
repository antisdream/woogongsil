'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LEGAL_DOCUMENTS } = require('./services/legalDocuments');
const { hashDocumentContent, normalizeAcceptanceList } = require('./services/legalConsentService');
const { RESULT_STORAGE_VERSION, sanitizeFortuneResult } = require('./services/fortunePrivacyService');

test('법률 문서는 코드/버전/본문 해시를 가진다', () => {
    assert.deepEqual(
        LEGAL_DOCUMENTS.map((document) => document.code).sort(),
        ['FORTUNE_PROCESSING', 'FORTUNE_RESULT_STORAGE', 'SIGNUP_PRIVACY', 'TERMS']
    );
    for (const document of LEGAL_DOCUMENTS) {
        assert.match(document.version, /^\d{4}-\d{2}-\d{2}-v\d+$/);
        assert.match(hashDocumentContent(document.content), /^[a-f0-9]{64}$/);
        assert.ok(document.content.length > 100);
    }
});

test('클라이언트 동의 목록은 코드별 한 건으로 정규화한다', () => {
    const normalized = normalizeAcceptanceList({
        acceptances: [
            { documentCode: 'terms', version: 'v1', sha256: 'ABC', accepted: true },
            { documentCode: 'TERMS', version: 'tampered', sha256: 'DEF', accepted: true },
        ],
    });
    assert.deepEqual(normalized, [
        { documentCode: 'TERMS', version: 'v1', sha256: 'abc', accepted: true },
    ]);
});

test('개인 운세 저장값에는 입력 원본과 내부 해시가 포함되지 않는다', () => {
    const safe = sanitizeFortuneResult('individual', {
        name: '홍길동',
        birthdate: '1990-01-02',
        birthtime: '10:00',
        gender: 'male',
        nameHash: 123,
        dayHash: 456,
        saju: { year: '갑자', month: '을축', day: '병인', hour: '정묘' },
        elementCount: { wood: 2 },
        yongsin: '목',
        mostElement: '화',
        gyeokguk: '정관격',
        todaySinsal: '문창귀인',
        score: 88,
        totalLuck: '오늘은 홍길동님에게 좋은 결과입니다.',
        examLuck: '학업 결과',
        loveLuck: '관계 결과',
    }, { name: '홍길동', birthdate: '1990-01-02', birthtime: '10:00', gender: 'male' });
    const serialized = JSON.stringify(safe);
    assert.equal(safe.schemaVersion, RESULT_STORAGE_VERSION);
    for (const forbidden of ['홍길동', '1990-01-02', '10:00', 'birthdate', 'birthtime', 'gender', 'nameHash', 'dayHash']) {
        assert.equal(serialized.includes(forbidden), false, `금지 원본 포함: ${forbidden}`);
    }
    assert.equal(safe.result.score, 88);
});

test('궁합 저장값에는 두 사람 이름과 입력 날짜가 포함되지 않는다', () => {
    const safe = sanitizeFortuneResult('couple', {
        p1: { name: '첫사람', birthdate: '1991-02-03', saju: { year: '갑자' }, elementCount: {}, yongsin: '수' },
        p2: { name: '둘사람', birthdate: '1992-03-04', saju: { year: '을축' }, elementCount: {}, yongsin: '목' },
        score: 77,
        details: { out: '첫사람과 둘사람의 결과 문구' },
    }, {
        p1: { name: '첫사람', birthdate: '1991-02-03' },
        p2: { name: '둘사람', birthdate: '1992-03-04' },
    });
    const serialized = JSON.stringify(safe);
    for (const forbidden of ['첫사람', '둘사람', '1991-02-03', '1992-03-04', 'name', 'birthdate']) {
        assert.equal(serialized.includes(forbidden), false, `금지 원본 포함: ${forbidden}`);
    }
    assert.equal(safe.result.score, 77);
});
