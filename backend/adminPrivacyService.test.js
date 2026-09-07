'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    normalizeListQuery,
    normalizeRevealReason,
    maskName,
    maskEmail,
    createAdminPrivacyService,
} = require('./services/adminPrivacyService');

test('name and email masking never returns the original personal values', () => {
    assert.equal(maskName('홍길동'), '홍*동');
    assert.equal(maskName('김철'), '김*');
    assert.equal(maskName('A'), '*');
    assert.equal(maskName(''), '');

    assert.equal(maskEmail('jiyong8074@gmail.com'), 'j***4@gmail.com');
    assert.equal(maskEmail('ab@naver.com'), 'a*@naver.com');
    assert.equal(maskEmail('a@example.com'), '*@example.com');
    assert.equal(maskEmail(''), '');
    assert.equal(maskEmail('not-an-email'), '***');
});

test('list query enforces bounded server pagination and safe sort values', () => {
    assert.deepEqual(normalizeListQuery({}), {
        keyword: '',
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        sortKey: 'id',
        sortDirection: 'asc',
    });
    assert.equal(normalizeListQuery({ page: 3, pageSize: 999 }).pageSize, MAX_PAGE_SIZE);
    assert.equal(normalizeListQuery({ sortKey: 'password', sortDirection: 'DROP TABLE' }).sortKey, 'id');
    assert.equal(normalizeListQuery({ sortDirection: 'DROP TABLE' }).sortDirection, 'asc');
    assert.throws(() => normalizeListQuery({ search: 'a' }), /2자 이상/);
    assert.throws(() => normalizeListQuery({ search: 'x'.repeat(101) }), /100자 이하/);
});

test('reveal reason is normalized and bounded', () => {
    assert.equal(normalizeRevealReason(' 회원 문의   본인 확인 '), '회원 문의 본인 확인');
    assert.throws(() => normalizeRevealReason('짧음'), /5자 이상/);
    assert.throws(() => normalizeRevealReason('x'.repeat(501)), /500자 이하/);
});

test('privacy audit hashes search, network address, and user agent before insertion', async () => {
    const queries = [];
    const pool = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            return [{ affectedRows: 1 }];
        },
    };
    const service = createAdminPrivacyService({
        pool,
        env: { ADMIN_PRIVACY_AUDIT_SECRET: 'unit-test-secret' },
    });

    await service.writeAccessLog({
        actorId: 'skn29',
        actorRole: 'primary_admin',
        action: 'list_masked',
        outcome: 'success',
        resultCount: 2,
        page: 1,
        pageSize: 20,
        keyword: 'member@example.com',
        req: {
            headers: {
                'x-forwarded-for': '203.0.113.10',
                'user-agent': 'privacy-test-browser',
            },
        },
    });

    assert.match(queries[0].sql, /CREATE TABLE IF NOT EXISTS wgs_admin_privacy_access_logs/);
    assert.match(queries[1].sql, /INSERT INTO wgs_admin_privacy_access_logs/);
    const serializedParams = JSON.stringify(queries[1].params);
    assert.doesNotMatch(serializedParams, /member@example\.com/);
    assert.doesNotMatch(serializedParams, /203\.0\.113\.10/);
    assert.doesNotMatch(serializedParams, /privacy-test-browser/);
    assert.equal(queries[1].params[10].length, 64);
    assert.equal(queries[1].params[11].length, 64);
    assert.equal(queries[1].params[12].length, 64);
});
