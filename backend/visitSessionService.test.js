'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    createVisitSessionService,
    sanitizeEntryPath,
    normalizeFilters,
} = require('./services/visitSessionService');
const registerAuthRoutes = require('./routes/auth/authRoutes');
const registerAdminAuthRoutes = require('./routes/auth/adminAuthRoutes');
const registerVisitorRoutes = require('./routes/visitorRoutes');

function sqlText(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

test('server injects one shared visit-session service into every related route', () => {
    const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.equal(
        (source.match(/const visitSessionService = createVisitSessionService\(\{/g) || []).length,
        1,
        'server must create exactly one shared visit-session service',
    );
    assert.match(
        source,
        /registerAuthRoutes\(\{[\s\S]{0,1600}visitSessionService,[\s\S]{0,300}visitorAnalyticsService,[\s\S]{0,120}\}\);/,
    );
    assert.match(
        source,
        /registerAdminAuthRoutes\(\{[\s\S]{0,900}visitSessionService,[\s\S]{0,300}visitorAnalyticsService,[\s\S]{0,120}\}\);/,
    );
    assert.match(
        source,
        /registerVisitorRoutes\(\{[\s\S]{0,700}visitorSchema: visitorAnalyticsSchema,[\s\S]{0,300}visitorService: visitorAnalyticsService,[\s\S]{0,300}visitSessionService,[\s\S]{0,300}ensureVisitorAnalyticsSchema,[\s\S]{0,120}\}\);/,
    );
});

test('admin member joins tolerate the production user-id collation', () => {
    const source = fs.readFileSync(
        path.join(__dirname, 'services/visitSessionService.js'),
        'utf8',
    );
    assert.equal(
        (source.match(/LEFT JOIN wgs_users u\s+ON CAST\(u\.id AS BINARY\)\s+= CAST\(s\.member_user_id AS BINARY\)/g) || []).length,
        2,
        'both admin member joins must avoid cross-collation comparison failures',
    );
});

class FakeSessionPool {
    constructor() {
        this.sessions = [];
        this.events = [];
        this.nextSessionId = 1;
        this.nextEventId = 1;
        this.queries = [];
        this.injectConcurrentAnonymousOnNextMemberInsert = false;
        this.failNextLoginEventInsert = 0;
        this.beginCount = 0;
        this.commitCount = 0;
        this.rollbackCount = 0;
        this.transactionTail = Promise.resolve();
    }

    sessionByActiveKey(key) {
        return this.sessions.find((row) => row.active_key === key) || null;
    }

    async getConnection() {
        const owner = this;
        let unlock;
        let snapshot = null;
        return {
            async beginTransaction() {
                owner.beginCount += 1;
                const previous = owner.transactionTail;
                owner.transactionTail = new Promise((resolve) => { unlock = resolve; });
                await previous;
                snapshot = {
                    sessions: owner.sessions.map((row) => ({ ...row })),
                    events: owner.events.map((row) => ({ ...row })),
                    nextSessionId: owner.nextSessionId,
                    nextEventId: owner.nextEventId,
                };
            },
            query(sql, params) { return owner.query(sql, params); },
            async commit() {
                owner.commitCount += 1;
                snapshot = null;
                unlock?.();
                unlock = null;
            },
            async rollback() {
                owner.rollbackCount += 1;
                if (snapshot) {
                    owner.sessions = snapshot.sessions;
                    owner.events = snapshot.events;
                    owner.nextSessionId = snapshot.nextSessionId;
                    owner.nextEventId = snapshot.nextEventId;
                }
                snapshot = null;
                unlock?.();
                unlock = null;
            },
            release() { unlock?.(); unlock = null; },
        };
    }

    async query(sql, params = []) {
        const normalized = sqlText(sql);
        this.queries.push({ sql: normalized, params: [...params] });

        if (normalized.includes('visit-session:close-stale')) {
            assert.equal(params.length, 2, 'stale close must bind exactly two placeholders');
            const [key, threshold] = params;
            let affectedRows = 0;
            for (const row of this.sessions) {
                if (row.active_key === key && row.last_seen_at < threshold) {
                    row.active_key = null;
                    row.ended_at ||= row.last_seen_at;
                    affectedRows += 1;
                }
            }
            return [{ affectedRows }];
        }

        if (normalized.includes('visit-session:touch-active')) {
            const [seenAt, key, threshold] = params;
            const row = this.sessions.find((item) => (
                item.active_key === key && !item.is_excluded && item.last_seen_at >= threshold
            ));
            if (!row) return [{ affectedRows: 0 }];
            if (seenAt > row.last_seen_at) row.last_seen_at = seenAt;
            row.request_count += 1;
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visit-session:get-active')) {
            const row = this.sessionByActiveKey(params[0]);
            return [row ? [{ ...row }] : []];
        }

        if (normalized.includes('visit-session:insert')) {
            const [
                visitorHash, activeKey, visitorType, memberUserId,
                startedAt, lastSeenAt, endedAt, entryPath, source, sourceRef,
            ] = params;
            if (visitorType === 'member' && this.injectConcurrentAnonymousOnNextMemberInsert) {
                this.injectConcurrentAnonymousOnNextMemberInsert = false;
                this.sessions.push({
                    id: this.nextSessionId++,
                    visitor_hash: visitorHash,
                    active_key: activeKey,
                    visitor_type: 'anonymous',
                    member_user_id: null,
                    started_at: startedAt,
                    last_seen_at: lastSeenAt,
                    ended_at: null,
                    entry_path: '/',
                    request_count: 1,
                    source: 'live',
                    source_ref: null,
                    is_excluded: 0,
                });
                const error = new Error('concurrent anonymous heartbeat won');
                error.code = 'ER_DUP_ENTRY';
                throw error;
            }
            if (activeKey && this.sessionByActiveKey(activeKey)) {
                const error = new Error('duplicate active key');
                error.code = 'ER_DUP_ENTRY';
                throw error;
            }
            if (sourceRef && this.sessions.some((row) => row.source === source && row.source_ref === sourceRef)) {
                const error = new Error('duplicate source');
                error.code = 'ER_DUP_ENTRY';
                throw error;
            }
            const row = {
                id: this.nextSessionId++,
                visitor_hash: visitorHash,
                active_key: activeKey,
                visitor_type: visitorType,
                member_user_id: memberUserId,
                started_at: startedAt,
                last_seen_at: lastSeenAt,
                ended_at: endedAt,
                entry_path: entryPath,
                request_count: 1,
                source,
                source_ref: sourceRef,
                is_excluded: 0,
            };
            this.sessions.push(row);
            return [{ affectedRows: 1, insertId: row.id }];
        }

        if (normalized.includes('visit-session:public-summary')) {
            const today = params[0];
            const rows = this.sessions.filter((row) => !row.is_excluded);
            return [[{
                total_count: rows.length,
                today_count: rows.filter((row) => row.started_at.slice(0, 10) === today).length,
                started_at: rows.map((row) => row.started_at.slice(0, 10)).sort()[0] || null,
            }]];
        }

        if (normalized.includes('visit-session:get-login-event')) {
            const event = this.events.find((row) => (
                row.source === 'login_history' && row.source_ref === params[0]
            ));
            if (!event) return [[]];
            const session = this.sessions.find((row) => row.id === event.session_id);
            const sessionEventCount = this.events.filter((row) => (
                row.session_id === event.session_id && !row.is_excluded
            )).length;
            return [[{
                event_id: event.id,
                session_id: event.session_id,
                ...session,
                session_event_count: sessionEventCount,
            }]];
        }

        if (normalized.includes('visit-session:convert-anonymous')) {
            const [memberId, seenAt, id] = params;
            const row = this.sessions.find((item) => item.id === id && item.visitor_type === 'anonymous');
            if (!row) return [{ affectedRows: 0 }];
            row.visitor_type = 'member';
            row.member_user_id = memberId;
            row.last_seen_at = seenAt;
            row.request_count += 1;
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visit-session:close-active')) {
            const [endedAt, seenAt, key] = params;
            const row = this.sessionByActiveKey(key);
            if (!row) return [{ affectedRows: 0 }];
            row.active_key = null;
            row.ended_at ||= endedAt;
            if (seenAt > row.last_seen_at) row.last_seen_at = seenAt;
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visit-session:exclude-empty-merged-history-session')) {
            const row = this.sessions.find((item) => item.id === params[0]);
            const hasActiveEvent = row && this.events.some((event) => (
                event.session_id === row.id && !event.is_excluded
            ));
            if (row && !hasActiveEvent) {
                row.is_excluded = 1;
                row.active_key = null;
                row.ended_at ||= row.last_seen_at;
            }
            return [{ affectedRows: row && !hasActiveEvent ? 1 : 0 }];
        }

        if (normalized.includes('visit-session:adopt-backfilled')) {
            const [hash, activeKey, memberId, startedAt, lastSeenAt, entryPath, id] = params;
            const row = this.sessions.find((item) => item.id === id);
            Object.assign(row, {
                visitor_hash: hash,
                active_key: activeKey,
                visitor_type: 'member',
                member_user_id: memberId,
                started_at: startedAt,
                last_seen_at: lastSeenAt,
                ended_at: null,
                entry_path: row.entry_path || entryPath,
                is_excluded: 0,
            });
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visit-session:upsert-login-event')) {
            if (this.failNextLoginEventInsert > 0) {
                this.failNextLoginEventInsert -= 1;
                const error = new Error('injected login event write failure');
                error.code = 'ER_TEST_LOGIN_EVENT_WRITE';
                throw error;
            }
            const [sessionId, memberId, loginAt, sourceRef] = params;
            let event = this.events.find((row) => row.source === 'login_history' && row.source_ref === sourceRef);
            if (!event) {
                event = {
                    id: this.nextEventId++, session_id: sessionId, member_user_id: memberId,
                    login_at: loginAt, source: 'login_history', source_ref: sourceRef, is_excluded: 0,
                };
                this.events.push(event);
            } else {
                Object.assign(event, {
                    session_id: sessionId,
                    member_user_id: memberId,
                    login_at: loginAt,
                    is_excluded: 0,
                });
            }
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visit-session:insert-login-event')) {
            if (this.failNextLoginEventInsert > 0) {
                this.failNextLoginEventInsert -= 1;
                const error = new Error('injected login event write failure');
                error.code = 'ER_TEST_LOGIN_EVENT_WRITE';
                throw error;
            }
            const [sessionId, memberId, loginAt] = params;
            this.events.push({
                id: this.nextEventId++, session_id: sessionId, member_user_id: memberId,
                login_at: loginAt, source: 'live', source_ref: null, is_excluded: 0,
            });
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visit-session:exclude-login-client')
            || normalized.includes('visit-session:exclude-client')) {
            const [endedAt, seenAt, key] = params;
            const row = this.sessionByActiveKey(key);
            if (!row) return [{ affectedRows: 0 }];
            row.is_excluded = 1;
            row.active_key = null;
            row.ended_at ||= endedAt;
            row.last_seen_at = seenAt;
            for (const event of this.events) {
                if (event.session_id === row.id) event.is_excluded = 1;
            }
            return [{ affectedRows: 1 }];
        }

        if (normalized.includes('visit-session:exclude-login-source')) {
            const event = this.events.find((item) => (
                item.source === 'login_history' && item.source_ref === params[0]
            ));
            const row = event
                ? this.sessions.find((item) => item.id === event.session_id)
                : null;
            if (row) {
                row.is_excluded = 1;
                row.active_key = null;
                row.ended_at ||= row.last_seen_at;
            }
            if (event) event.is_excluded = 1;
            return [{ affectedRows: row ? 1 : 0 }];
        }

        if (normalized.includes('visit-session:end-member')) {
            const [endedAt, seenAt, key, memberId] = params;
            const row = this.sessions.find((item) => (
                item.active_key === key && item.member_user_id === memberId
            ));
            if (!row) return [{ affectedRows: 0 }];
            row.active_key = null;
            row.ended_at ||= endedAt;
            row.last_seen_at = seenAt;
            return [{ affectedRows: 1 }];
        }

        throw new Error(`Unexpected SQL in visit session test: ${normalized}`);
    }
}

function serviceFixture(pool = new FakeSessionPool()) {
    const ensureSchema = async () => {};
    return {
        pool,
        service: createVisitSessionService({
            pool,
            schema: { ensureVisitorAnalyticsSchema: ensureSchema },
            ensureSchema,
            env: {
                NODE_ENV: 'test',
                VISITOR_HASH_SECRET: 'visit-session-test-secret-with-at-least-32-characters',
                VISITOR_SESSION_INACTIVITY_SECONDS: '300',
            },
        }),
    };
}

function browserRequest(path = '/') {
    return {
        headers: { 'user-agent': 'Mozilla/5.0 visit session test' },
        body: { path },
    };
}

test('entry paths are reduced to safe route-only values and filters reject unsafe values', () => {
    assert.equal(sanitizeEntryPath('/questions?id=1#answer'), '/questions');
    assert.equal(sanitizeEntryPath('https://example.com/private'), null);
    assert.equal(sanitizeEntryPath('/safe\u0000path'), '/safepath');
    assert.deepEqual(normalizeFilters({ types: 'member,anonymous', status: 'active' }), {
        types: ['member', 'anonymous'],
        memberIds: [],
        status: 'active',
    });
    assert.throws(() => normalizeFilters({ types: 'ip' }), /anonymous and\/or member/);
});

test('a browser is counted once while active and again only after five minutes of inactivity', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-11111111-2222-3333-4444-555555555555';
    const first = await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date('2026-08-05T01:00:00.000Z'),
    });
    const heartbeat = await service.recordVisit({
        clientId,
        request: browserRequest('/questions'),
        now: new Date('2026-08-05T01:04:59.000Z'),
    });
    const afterIdle = await service.recordVisit({
        clientId,
        request: browserRequest('/questions'),
        now: new Date('2026-08-05T01:10:00.000Z'),
    });

    assert.equal(first.counted, true);
    assert.equal(heartbeat.counted, false);
    assert.equal(afterIdle.counted, true);
    assert.equal(pool.sessions.length, 2);
    assert.equal(Object.hasOwn(afterIdle, 'totalCount'), false);
    assert.equal(Object.hasOwn(afterIdle, 'todayCount'), false);
    assert.equal(pool.queries.some(({ sql }) => sql.includes('visit-session:public-summary')), false);
    assert.equal(pool.sessions[0].active_key, null);
    assert.equal(pool.sessions[1].entry_path, '/questions');
});

test('guest login converts one session, repeated same-member login only adds an event, and account switch starts a session', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date('2026-08-05T02:00:00.000Z'),
    });

    const converted = await service.recordSuccessfulLogin({
        clientId,
        memberUserId: 'member-a',
        historyId: 101,
        request: browserRequest('/login'),
        now: new Date('2026-08-05T02:01:00.000Z'),
    });
    const sameMember = await service.recordSuccessfulLogin({
        clientId,
        memberUserId: 'member-a',
        historyId: 102,
        request: browserRequest('/login'),
        now: new Date('2026-08-05T02:02:00.000Z'),
    });
    const switched = await service.recordSuccessfulLogin({
        clientId,
        memberUserId: 'member-b',
        historyId: 103,
        request: browserRequest('/login'),
        now: new Date('2026-08-05T02:03:00.000Z'),
    });

    assert.equal(converted.counted, false);
    assert.equal(converted.reason, 'anonymous_session_converted');
    assert.equal(sameMember.counted, false);
    assert.equal(sameMember.reason, 'same_member_session');
    assert.equal(switched.counted, true);
    assert.equal(pool.sessions.length, 2);
    assert.equal(pool.events.length, 3);
    assert.equal(pool.events[0].session_id, pool.events[1].session_id);
    assert.notEqual(pool.events[1].session_id, pool.events[2].session_id);
    assert.equal(pool.sessions[1].member_user_id, 'member-b');
});

test('a concurrent anonymous heartbeat cannot drop the successful login event', async () => {
    const { pool, service } = serviceFixture();
    pool.injectConcurrentAnonymousOnNextMemberInsert = true;
    const result = await service.recordSuccessfulLogin({
        clientId: 'wgs-99999999-aaaa-bbbb-cccc-999999999999',
        memberUserId: 'member-race',
        historyId: 301,
        request: browserRequest('/login'),
        now: new Date('2026-08-05T02:30:00.000Z'),
    });

    assert.equal(result.counted, false);
    assert.equal(result.reason, 'anonymous_session_converted');
    assert.equal(pool.sessions.length, 1);
    assert.equal(pool.sessions[0].visitor_type, 'member');
    assert.equal(pool.events.length, 1);
    assert.equal(pool.events[0].session_id, pool.sessions[0].id);
});

test('a login-event write failure rolls back the whole linkage and one retry commits cleanly', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-rollback-aaaa-bbbb-cccc-dddddddddddd';
    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date('2026-08-05T02:40:00.000Z'),
    });
    const originalSession = { ...pool.sessions[0] };
    pool.failNextLoginEventInsert = 1;

    await assert.rejects(
        service.recordSuccessfulLogin({
            clientId,
            memberUserId: 'member-rollback',
            historyId: 401,
            request: browserRequest('/login'),
            now: new Date('2026-08-05T02:41:00.000Z'),
        }),
        (error) => error?.code === 'ER_TEST_LOGIN_EVENT_WRITE',
    );

    assert.deepEqual(pool.sessions, [originalSession]);
    assert.equal(pool.events.length, 0);
    assert.equal(pool.rollbackCount, 1);
    assert.equal(pool.commitCount, 0);

    const retried = await service.recordSuccessfulLogin({
        clientId,
        memberUserId: 'member-rollback',
        historyId: 401,
        request: browserRequest('/login'),
        now: new Date('2026-08-05T02:41:03.000Z'),
    });

    assert.equal(retried.counted, false);
    assert.equal(retried.reason, 'anonymous_session_converted');
    assert.equal(pool.sessions.length, 1);
    assert.equal(pool.sessions[0].visitor_type, 'member');
    assert.equal(pool.sessions[0].member_user_id, 'member-rollback');
    assert.equal(pool.events.length, 1);
    assert.equal(pool.events[0].source_ref, '401');
    assert.equal(pool.events[0].session_id, pool.sessions[0].id);
    assert.equal(pool.beginCount, 2);
    assert.equal(pool.rollbackCount, 1);
    assert.equal(pool.commitCount, 1);
});

test('concurrent different-member logins on one client leave one coherent active owner', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-shared-client-aaaa-bbbb-cccccccccccc';
    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date('2026-08-05T02:50:00.000Z'),
    });

    const [memberA, memberB] = await Promise.all([
        service.recordSuccessfulLogin({
            clientId,
            memberUserId: 'member-a',
            historyId: 501,
            request: browserRequest('/login'),
            now: new Date('2026-08-05T02:51:00.000Z'),
        }),
        service.recordSuccessfulLogin({
            clientId,
            memberUserId: 'member-b',
            historyId: 502,
            request: browserRequest('/login'),
            now: new Date('2026-08-05T02:51:01.000Z'),
        }),
    ]);

    assert.equal(memberA.reason, 'anonymous_session_converted');
    assert.equal(memberB.counted, true);
    assert.equal(pool.beginCount, 2);
    assert.equal(pool.commitCount, 2);
    assert.equal(pool.rollbackCount, 0);
    assert.equal(pool.events.length, 2);
    assert.equal(new Set(pool.events.map((event) => event.source_ref)).size, 2);

    const activeSessions = pool.sessions.filter((session) => session.active_key !== null);
    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0].member_user_id, 'member-b');
    const eventA = pool.events.find((event) => event.source_ref === '501');
    const eventB = pool.events.find((event) => event.source_ref === '502');
    const sessionA = pool.sessions.find((session) => session.id === eventA.session_id);
    const sessionB = pool.sessions.find((session) => session.id === eventB.session_id);
    assert.equal(sessionA.member_user_id, 'member-a');
    assert.equal(sessionA.active_key, null);
    assert.equal(sessionB.member_user_id, 'member-b');
    assert.equal(sessionB.active_key, activeSessions[0].active_key);
});

test('3-second check-session polling reaches the database only once per 45-second link window', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-throttle-aaaa-bbbb-cccc-dddddddddddd';
    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date('2026-08-05T03:00:00.000Z'),
    });
    pool.queries = [];
    pool.beginCount = 0;
    pool.commitCount = 0;
    pool.rollbackCount = 0;

    const first = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-throttle',
        now: new Date('2026-08-05T03:00:00.000Z'),
    });
    assert.equal(first.linked, true);
    assert.equal(first.counted, false);

    const throttled = [];
    for (let index = 1; index <= 14; index += 1) {
        throttled.push(await service.linkAuthenticatedSession({
            clientId,
            memberUserId: 'member-throttle',
            now: new Date(Date.parse('2026-08-05T03:00:00.000Z') + (index * 3000)),
        }));
    }
    assert.equal(throttled.length, 14);
    assert.ok(throttled.every((result) => (
        result.reason === 'link_throttled' && result.throttled === true
    )));
    assert.equal(pool.beginCount, 1);
    assert.equal(pool.commitCount, 1);
    assert.equal(pool.queries.filter((item) => item.sql.includes('visit-session:get-active')).length, 1);

    const afterWindow = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-throttle',
        now: new Date('2026-08-05T03:00:45.000Z'),
    });
    assert.equal(afterWindow.reason, 'same_member_session');
    assert.equal(afterWindow.throttled, undefined);
    assert.equal(pool.beginCount, 2);
    assert.equal(pool.commitCount, 2);
    assert.equal(pool.queries.filter((item) => item.sql.includes('visit-session:get-active')).length, 2);
});

test('3-second excluded check-session polling runs the exclusion UPDATE once per 45-second window', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-admin-throttle-aaaa-bbbb-cccccccccccc';
    await service.recordVisit({
        clientId,
        request: browserRequest('/manage/login'),
        now: new Date('2026-08-05T03:10:00.000Z'),
    });
    pool.queries = [];

    const first = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'operator',
        isExcluded: true,
        now: new Date('2026-08-05T03:10:00.000Z'),
    });
    assert.equal(first.linked, false);
    assert.equal(first.reason, 'admin_excluded');
    assert.equal(first.throttled, undefined);

    const throttled = [];
    for (let index = 1; index <= 14; index += 1) {
        throttled.push(await service.linkAuthenticatedSession({
            clientId,
            memberUserId: 'operator',
            isExcluded: true,
            now: new Date(Date.parse('2026-08-05T03:10:00.000Z') + (index * 3000)),
        }));
    }
    assert.ok(throttled.every((result) => (
        result.linked === false
        && result.reason === 'admin_excluded'
        && result.throttled === true
    )));
    assert.equal(
        pool.queries.filter((item) => item.sql.includes('visit-session:exclude-client')).length,
        1,
    );

    const afterWindow = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'operator',
        isExcluded: true,
        now: new Date('2026-08-05T03:10:45.000Z'),
    });
    assert.equal(afterWindow.reason, 'admin_excluded');
    assert.equal(afterWindow.throttled, undefined);
    assert.equal(
        pool.queries.filter((item) => item.sql.includes('visit-session:exclude-client')).length,
        2,
    );
    assert.equal(pool.sessions.length, 1);
    assert.equal(pool.sessions[0].is_excluded, 1);
    assert.equal(pool.sessions[0].active_key, null);
});

test('alternating member check-session links never replace the active member across throttle windows', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-member-conflict-aaaa-bbbb-cccccccccccc';
    const baseTime = Date.parse('2026-08-05T03:20:00.000Z');
    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date(baseTime),
    });
    const initialA = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-a',
        now: new Date(baseTime),
    });
    const initialB = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-b',
        now: new Date(baseTime + 1000),
    });
    assert.equal(initialA.linked, true);
    assert.equal(initialB.linked, false);
    assert.equal(initialB.reason, 'active_member_conflict');
    const cachedConflict = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-b',
        now: new Date(baseTime + 2000),
    });
    assert.equal(cachedConflict.linked, false);
    assert.equal(cachedConflict.reason, 'active_member_conflict');
    assert.equal(cachedConflict.throttled, true);

    for (let window = 1; window <= 3; window += 1) {
        const memberA = await service.linkAuthenticatedSession({
            clientId,
            memberUserId: 'member-a',
            now: new Date(baseTime + (window * 45_000)),
        });
        const memberB = await service.linkAuthenticatedSession({
            clientId,
            memberUserId: 'member-b',
            now: new Date(baseTime + 1000 + (window * 45_000)),
        });
        assert.equal(memberA.linked, true);
        assert.equal(memberA.reason, 'same_member_session');
        assert.equal(memberA.counted, false);
        assert.equal(memberB.linked, false);
        assert.equal(memberB.reason, 'active_member_conflict');
        assert.equal(memberB.counted, false);
    }

    assert.equal(pool.sessions.length, 1);
    assert.equal(pool.events.length, 0);
    assert.equal(pool.sessions[0].visitor_type, 'member');
    assert.equal(pool.sessions[0].member_user_id, 'member-a');
    assert.notEqual(pool.sessions[0].active_key, null);
    assert.equal(
        pool.queries.filter((item) => item.sql.includes('visit-session:insert')).length,
        1,
        'only the initial anonymous visit may insert a session',
    );
    assert.equal(
        pool.queries.filter((item) => item.sql.includes('visit-session:close-active')).length,
        0,
        'check-session conflicts must not close the active member',
    );
});

test('session validation polling never creates visits after five-minute inactivity', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-hidden-poll-aaaa-bbbb-cccccccccccccc';
    const baseTime = Date.parse('2026-08-05T03:30:00.000Z');
    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date(baseTime),
    });
    await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-hidden',
        now: new Date(baseTime),
    });

    for (const elapsed of [315_000, 360_000, 405_000, 450_000]) {
        const result = await service.linkAuthenticatedSession({
            clientId,
            memberUserId: 'member-hidden',
            now: new Date(baseTime + elapsed),
        });
        assert.equal(result.linked, false);
        assert.equal(result.counted, false);
        assert.ok(['no_active_visit', 'link_throttled'].includes(result.reason));
    }

    assert.equal(pool.sessions.length, 1);
    assert.equal(pool.sessions[0].active_key, null);
    assert.equal(
        pool.queries.filter((item) => item.sql.includes('visit-session:insert')).length,
        1,
        'only the original public heartbeat may insert a visit',
    );
});

test('a heartbeat immediately after no-active validation can still link the member', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-check-before-heartbeat-aaaaaaaaaaaaaaaa';
    const baseTime = Date.parse('2026-08-05T03:45:00.000Z');

    const beforeHeartbeat = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-race',
        now: new Date(baseTime),
    });
    assert.equal(beforeHeartbeat.linked, false);
    assert.equal(beforeHeartbeat.reason, 'no_active_visit');

    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date(baseTime + 1000),
    });
    const afterHeartbeat = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-race',
        now: new Date(baseTime + 2000),
    });

    assert.equal(afterHeartbeat.linked, true);
    assert.equal(afterHeartbeat.counted, false);
    assert.equal(afterHeartbeat.throttled, undefined);
    assert.equal(pool.sessions.length, 1);
    assert.equal(pool.sessions[0].visitor_type, 'member');
    assert.equal(pool.sessions[0].member_user_id, 'member-race');
});

test('repeated no-active validation is throttled until a heartbeat invalidates the cache', async () => {
    const { pool, service } = serviceFixture();
    const clientId = 'wgs-no-active-throttle-aaaaaaaaaaaaaaaa';
    const baseTime = Date.parse('2026-08-05T04:00:00.000Z');

    const first = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-waiting',
        now: new Date(baseTime),
    });
    assert.equal(first.linked, false);
    assert.equal(first.reason, 'no_active_visit');

    const repeats = [];
    for (let index = 1; index <= 14; index += 1) {
        repeats.push(await service.linkAuthenticatedSession({
            clientId,
            memberUserId: 'member-waiting',
            now: new Date(baseTime + (index * 3000)),
        }));
    }
    assert.ok(repeats.every((result) => (
        result.linked === false
        && result.reason === 'no_active_visit'
        && result.throttled === true
    )));
    assert.equal(pool.beginCount, 1, 'no-active polling should open one transaction per cache window');

    await service.recordVisit({
        clientId,
        request: browserRequest('/'),
        now: new Date(baseTime + 43_000),
    });
    const afterHeartbeat = await service.linkAuthenticatedSession({
        clientId,
        memberUserId: 'member-waiting',
        now: new Date(baseTime + 44_000),
    });
    assert.equal(afterHeartbeat.linked, true);
    assert.equal(afterHeartbeat.throttled, undefined);
    assert.equal(pool.beginCount, 2, 'heartbeat should invalidate no-active cache immediately');
    assert.equal(pool.sessions.length, 1);
    assert.equal(pool.sessions[0].visitor_type, 'member');
});

test('valid session resume links a guest without a login event and admin login removes the guest count', async () => {
    const { pool, service } = serviceFixture();
    const memberClient = 'wgs-11111111-aaaa-bbbb-cccc-111111111111';
    await service.recordVisit({
        clientId: memberClient,
        request: browserRequest('/'),
        now: new Date('2026-08-05T03:00:00.000Z'),
    });
    const linked = await service.linkAuthenticatedSession({
        clientId: memberClient,
        memberUserId: 'member-a',
        now: new Date('2026-08-05T03:01:00.000Z'),
    });
    assert.equal(linked.linked, true);
    assert.equal(linked.counted, false);
    assert.equal(pool.events.length, 0);

    const adminClient = 'wgs-22222222-aaaa-bbbb-cccc-222222222222';
    await service.recordVisit({
        clientId: adminClient,
        request: browserRequest('/manage/login'),
        now: new Date('2026-08-05T03:02:00.000Z'),
    });
    await service.recordSuccessfulLogin({
        clientId: adminClient,
        memberUserId: 'operator',
        historyId: 201,
        isExcluded: true,
        now: new Date('2026-08-05T03:03:00.000Z'),
    });
    const summary = await service.getPublicSummary({ now: new Date('2026-08-05T03:03:00.000Z') });
    assert.equal(summary.totalCount, 1);
    assert.equal(pool.sessions.filter((row) => row.is_excluded).length, 1);
});

test('stats query applies status consistently and counts logins by login_at without constraining session start', async () => {
    const pool = {
        queries: [],
        async query(sql, params = []) {
            const normalized = sqlText(sql);
            this.queries.push({ sql: normalized, params: [...params] });
            if (normalized.includes('visit-session:admin-summary')) return [[{
                total_count: 1, today_count: 1, week_count: 1, month_count: 1,
                year_count: 1, started_at: '2026-08-05',
            }]];
            if (normalized.includes('visit-session:series')) return [[]];
            if (normalized.includes('visit-session:breakdown')) return [[{
                visitor_type: 'member', session_count: 1, unique_member_count: 1,
            }]];
            if (normalized.includes('visit-session:login-count')) return [[{ login_count: 2 }]];
            throw new Error(`Unexpected stats SQL: ${normalized}`);
        },
    };
    const { service } = serviceFixture(pool);
    const result = await service.getAdminStats({
        period: 'day',
        anchor: '2026-08-05',
        types: 'member',
        status: 'active',
        now: new Date('2026-08-05T04:00:00.000Z'),
    });
    const seriesQueries = pool.queries.filter((item) => item.sql.includes('visit-session:series'));
    const loginQuery = pool.queries.find((item) => item.sql.includes('visit-session:login-count'));
    assert.equal(seriesQueries.length, 2);
    assert.ok(seriesQueries.every((item) => item.sql.includes('s.active_key IS NOT NULL')));
    assert.match(loginQuery.sql, /e\.login_at >= \? AND e\.login_at < \?/);
    assert.doesNotMatch(loginQuery.sql, /s\.started_at >= \?/);
    assert.equal(result.metrics.loginCount, 2);
    assert.equal(result.metrics.uniqueMembers, 1);
});

function responseDouble() {
    return {
        statusCode: 200,
        body: null,
        headers: new Map(),
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
        setHeader(name, value) { this.headers.set(name, value); return this; },
        getHeader(name) { return this.headers.get(name); },
        append(name, value) {
            const current = this.headers.get(name);
            const values = current === undefined
                ? [value]
                : [...(Array.isArray(current) ? current : [current]), value];
            this.headers.set(name, values);
            return this;
        },
    };
}

function cookieResponseDouble() {
    return responseDouble();
}

test('analytics failure cannot turn a valid login or session check into an authentication failure', async () => {
    const handlers = new Map();
    const app = { post(path, handler) { handlers.set(path, handler); } };
    const user = {
        id: 'member-a', password: 'hash', name: 'Member A', email: 'a@example.com',
        sessionToken: null, is_suspended: 0, is_operator: 0, is_primary_admin: 0,
    };
    const pool = {
        async query(sql) {
            if (String(sql).includes('INSERT INTO wgs_login_history')) return [{ insertId: 501, affectedRows: 1 }];
            return [{ affectedRows: 1 }];
        },
    };
    const analytics = {
        endCalls: 0,
        async recordSuccessfulLogin() { throw new Error('analytics unavailable'); },
        async linkAuthenticatedSession() { throw new Error('analytics unavailable'); },
        async endAuthenticatedSession() { this.endCalls += 1; },
    };
    registerAuthRoutes({
        app,
        pool,
        bcrypt: { compare: async () => true, hash: async () => 'hash' },
        sendEmail: async () => {},
        requireHcaptcha: async () => true,
        verificationCodes: new Map(),
        getUserByEmail: async () => null,
        getUserById: async () => user,
        getKSTDateTime: () => '2026-08-05 13:00:00',
        ensureAdminUserControlSchema: async () => {},
        normalizeAdminBool: (value) => Boolean(Number(value)),
        getAdminMaintenanceState: () => ({ is_enabled: false }),
        isAdminAccessUser: () => false,
        adminColumnExists: async () => false,
        touchActiveUser: () => {},
        removeActiveUser: () => {},
        formatDateOnly: (value) => value || null,
        isPrimaryAdminUser: () => false,
        validateAdminSession: async () => ({ valid: false }),
        saltRounds: 10,
        adminUserId: 'admin',
        serverInstanceId: 'test-instance',
        defaultMaintenanceMessage: 'maintenance',
        visitSessionService: analytics,
        legalConsentService: {
            async getUserEvidenceStatus() { return { complete: true }; },
        },
    });

    const loginResponse = responseDouble();
    await handlers.get('/api/login')({
        body: { id: 'member-a', password: 'pw' },
        headers: { 'x-wgs-client-id': 'wgs-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    }, loginResponse);
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.body.success, true);

    user.sessionToken = loginResponse.body.sessionToken;
    const sessionResponse = responseDouble();
    await handlers.get('/api/check-session')({
        body: { id: 'member-a', sessionToken: user.sessionToken },
        headers: { 'x-wgs-client-id': 'wgs-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    }, sessionResponse);
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.body.valid, true);

    const logoutResponse = responseDouble();
    await handlers.get('/api/logout')({
        body: { id: 'member-a', sessionToken: user.sessionToken },
        headers: { 'x-wgs-client-id': 'wgs-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    }, logoutResponse);
    assert.equal(logoutResponse.statusCode, 200);
    assert.equal(logoutResponse.body.success, true);
    assert.equal(
        analytics.endCalls,
        0,
        'logout must leave the public visit session open until the 5-minute inactivity timeout',
    );
});

test('general login sets or clears the visitor exclusion cookie for the authenticated role', async (t) => {
    const roleCases = [
        {
            label: 'operator',
            user: { is_operator: 1, is_primary_admin: 0 },
            expectedExcluded: true,
        },
        {
            label: 'primary admin',
            user: { is_operator: 0, is_primary_admin: 1 },
            expectedExcluded: true,
        },
        {
            label: 'ordinary member after admin',
            user: { is_operator: 0, is_primary_admin: 0 },
            expectedExcluded: false,
        },
    ];

    for (const roleCase of roleCases) {
        await t.test(roleCase.label, async () => {
            const handlers = new Map();
            const app = { post(path, handler) { handlers.set(path, handler); } };
            const user = {
                id: `${roleCase.label.replace(/\s+/g, '-')}-account`,
                password: 'hash',
                name: roleCase.label,
                email: `${roleCase.label.replace(/\s+/g, '-')}@example.com`,
                sessionToken: null,
                is_suspended: 0,
                ...roleCase.user,
            };
            const analyticsCalls = [];
            let exclusionCookieCalls = 0;
            let exclusionClearCookieCalls = 0;
            registerAuthRoutes({
                app,
                pool: {
                    async query(sql) {
                        if (String(sql).includes('INSERT INTO wgs_login_history')) {
                            return [{ insertId: 601, affectedRows: 1 }];
                        }
                        return [{ affectedRows: 1 }];
                    },
                },
                bcrypt: { compare: async () => true, hash: async () => 'hash' },
                sendEmail: async () => {},
                requireHcaptcha: async () => true,
                verificationCodes: new Map(),
                getUserByEmail: async () => null,
                getUserById: async () => user,
                getKSTDateTime: () => '2026-08-05 13:30:00',
                ensureAdminUserControlSchema: async () => {},
                normalizeAdminBool: (value) => Boolean(Number(value)),
                getAdminMaintenanceState: () => ({ is_enabled: false }),
                isAdminAccessUser: (account) => Boolean(
                    Number(account?.is_operator) || Number(account?.is_primary_admin)
                ),
                adminColumnExists: async () => false,
                touchActiveUser: () => {},
                removeActiveUser: () => {},
                formatDateOnly: (value) => value || null,
                isPrimaryAdminUser: (account) => Boolean(Number(account?.is_primary_admin)),
                validateAdminSession: async () => ({ valid: false }),
                saltRounds: 10,
                adminUserId: 'admin',
                serverInstanceId: 'test-instance',
                defaultMaintenanceMessage: 'maintenance',
                visitSessionService: {
                    async recordSuccessfulLogin(input) { analyticsCalls.push(input); },
                    async linkAuthenticatedSession() {},
                    async endAuthenticatedSession() {},
                },
                visitorAnalyticsService: {
                    createAdminExclusionCookie() {
                        exclusionCookieCalls += 1;
                        return 'wgs_visitor_admin_exclusion=signed; Path=/api/visitors; HttpOnly';
                    },
                    createAdminExclusionClearCookie() {
                        exclusionClearCookieCalls += 1;
                        return 'wgs_visitor_admin_exclusion=; Max-Age=0; Path=/api/visitors; HttpOnly';
                    },
                },
                legalConsentService: {
                    async getUserEvidenceStatus() { return { complete: true }; },
                },
            });

            const response = responseDouble();
            await handlers.get('/api/login')({
                body: { id: user.id, password: 'pw' },
                headers: {
                    'x-wgs-client-id': 'wgs-admin-general-login-aaaaaaaaaaaaaaaa',
                },
            }, response);

            assert.equal(response.statusCode, 200);
            assert.equal(response.body.success, true);
            assert.equal(analyticsCalls.length, 1);
            assert.equal(analyticsCalls[0].isExcluded, roleCase.expectedExcluded);
            assert.equal(exclusionCookieCalls, roleCase.expectedExcluded ? 1 : 0);
            assert.equal(exclusionClearCookieCalls, roleCase.expectedExcluded ? 0 : 1);
            const setCookies = response.headers.get('Set-Cookie');
            assert.equal(setCookies.length, 1);
            assert.match(
                setCookies[0],
                roleCase.expectedExcluded
                    ? /^wgs_visitor_admin_exclusion=signed;/
                    : /^wgs_visitor_admin_exclusion=; Max-Age=0;/,
            );
            assert.match(setCookies[0], /Path=\/api\/visitors/);
            assert.match(setCookies[0], /HttpOnly/);
        });
    }
});

test('dedicated administrator login excludes the same browser visit and sets the durable exclusion cookie', async () => {
    const handlers = { get: new Map(), post: new Map() };
    const app = {
        get(path, handler) { handlers.get.set(path, handler); },
        post(path, handler) { handlers.post.set(path, handler); },
    };
    const excludedClientIds = [];
    const visitSessionService = {
        async excludeClientSession({ clientId }) { excludedClientIds.push(clientId); },
    };
    const visitorAnalyticsService = {
        createAdminExclusionCookie() {
            return 'wgs_visitor_admin_exclusion=signed; Path=/api/visitors; HttpOnly';
        },
    };
    const adminSessionService = {
        isAllowedOrigin: () => true,
        createSession: async () => ({
            rawToken: 'admin-session-token',
            csrfToken: 'csrf-token',
            idleExpiresAt: '2026-08-05 14:00:00',
            expiresAt: '2026-08-05 22:00:00',
        }),
        setSessionCookie(res) { res.append('Set-Cookie', 'wgs_admin_session=token; HttpOnly'); },
        clearSessionCookie() {},
        revokeSessionHash: async () => {},
        revokeAllForUser: async () => 0,
    };
    registerAdminAuthRoutes({
        app,
        pool: { query: async () => [{ affectedRows: 1 }] },
        bcrypt: { compare: async () => true },
        requireHcaptcha: async () => true,
        getUserById: async () => ({ id: 'skn29', password: 'hash', name: 'Administrator' }),
        getAdminUserControl: async () => ({
            id: 'skn29', name: 'Administrator', is_suspended: 0, is_operator: 1,
        }),
        ensureAdminUserControlSchema: async () => {},
        normalizeAdminBool: (value) => Boolean(Number(value)),
        isAdminAccessUser: () => true,
        isPrimaryAdminUser: () => false,
        adminSessionService,
        adminEmailOtpService: {
            begin: async () => ({ rawToken: 'pending', otpRequired: true }),
            tokenFromRequest: () => 'pending',
            verify: async () => ({ emailOtpVerified: true }),
            setCookie() {},
        },
        visitSessionService,
        visitorAnalyticsService,
    });

    const clientId = 'wgs-admin-shared-browser-aaaaaaaaaaaaaaaa';
    const loginResponse = cookieResponseDouble();
    await handlers.post.get('/api/admin/auth/login')({
        body: { id: 'skn29', password: 'pw' },
        headers: { 'x-wgs-client-id': clientId },
    }, loginResponse);
    assert.equal(loginResponse.statusCode, 202);
    assert.deepEqual(excludedClientIds, []);
    const verifiedResponse = cookieResponseDouble();
    await handlers.post.get('/api/admin/auth/otp/verify')({ body: { code: '123456' }, headers: { 'x-wgs-client-id': clientId } }, verifiedResponse);
    assert.equal(verifiedResponse.statusCode, 200);
    assert.equal(loginResponse.body.success, true);
    assert.deepEqual(excludedClientIds, [clientId]);
    assert.equal(verifiedResponse.headers.get('Set-Cookie').length, 2);

    const meResponse = cookieResponseDouble();
    await handlers.get.get('/api/admin/auth/me')({
        headers: { 'x-wgs-client-id': clientId },
        adminAuth: {
            user: { id: 'skn29', name: 'Administrator' },
            isOperator: true,
            isPrimaryAdmin: false,
            csrfToken: 'csrf-token',
            idleExpiresAt: '2026-08-05 14:00:00',
            expiresAt: '2026-08-05 22:00:00',
        },
    }, meResponse);
    assert.equal(meResponse.statusCode, 200);
    assert.deepEqual(excludedClientIds, [clientId, clientId]);
    assert.equal(meResponse.headers.get('Set-Cookie').length, 1);
});

test('admin session and member-filter routes require admin auth and forward pagination filters', async () => {
    const handlers = { get: new Map(), post: new Map() };
    const app = {
        get(path, handler) { handlers.get.set(path, handler); },
        post(path, handler) { handlers.post.set(path, handler); },
    };
    let admin = false;
    const calls = [];
    const visitSessionService = {
        async recordVisit() { return { counted: true, todayCount: 1, totalCount: 1 }; },
        async getPublicSummary() { return { todayCount: 1, totalCount: 1 }; },
        async getAdminStats() { return { period: 'day', series: [] }; },
        async getAdminSessions(input) {
            calls.push({ type: 'sessions', input });
            return {
                pagination: { page: 2, pageSize: 10, total: 1, totalPages: 1 },
                sessions: [{
                    id: '7', visitorType: 'member', member: { id: 'member-a', name: 'Member A' },
                    source: 'login_history', historical: true,
                }],
            };
        },
        async getAdminMembers(input) {
            calls.push({ type: 'members', input });
            return { members: [{ id: 'member-a', name: 'Member A' }] };
        },
    };
    const visitorService = {
        ...visitSessionService,
        verifyAdminExclusionToken: () => false,
        createAdminExclusionCookie: () => 'wgs_visitor_admin_exclusion=test; Path=/api/visitors; HttpOnly',
        adminExclusionCookieName: 'wgs_visitor_admin_exclusion',
    };
    registerVisitorRoutes({
        app,
        visitorService,
        visitSessionService,
        memberLoginActivityService: { getStats: async () => ({}) },
        ensureVisitorAnalyticsSchema: async () => {},
        validateAdminSession: async () => admin
            ? { valid: true, isOperator: true }
            : { valid: false, reason: 'not_admin' },
    });

    const denied = responseDouble();
    await handlers.get.get('/api/admin/visitors/sessions')({ query: {} }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(calls.length, 0);

    admin = true;
    const accepted = responseDouble();
    await handlers.get.get('/api/admin/visitors/sessions')({
        query: {
            period: 'month', anchor: '2026-08-01', types: 'member',
            memberIds: 'member-a', status: 'ended', page: '2', pageSize: '10',
        },
    }, accepted);
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.success, true);
    assert.deepEqual(calls[0], {
        type: 'sessions',
        input: {
            period: 'month', anchor: '2026-08-01', types: 'member',
            memberIds: 'member-a', status: 'ended', page: '2', pageSize: '10',
        },
    });
    assert.equal('visitorHash' in accepted.body.sessions[0], false);
    assert.equal('sessionToken' in accepted.body.sessions[0], false);
    assert.equal('ip' in accepted.body.sessions[0], false);

    const members = responseDouble();
    await handlers.get.get('/api/admin/visitors/members')({
        query: { query: 'member', limit: '50' },
    }, members);
    assert.equal(members.statusCode, 200);
    assert.deepEqual(calls[1], {
        type: 'members',
        input: { query: 'member', limit: '50' },
    });
});
