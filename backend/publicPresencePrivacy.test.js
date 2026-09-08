'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const registerVisitorRoutes = require('./routes/visitorRoutes');
const registerRetiredFeatureRoutes = require('./routes/retiredFeatureRoutes');
const { createAdminRuntimeState } = require('./services/adminRuntimeState');

async function fixture(t, { clock, getSummary = async () => ({
    todayCount: 41, totalCount: 701, users: [{ id: 'private-member' }], session: { id: 'private-session' },
}) } = {}) {
    const app = express();
    const calls = { visits: 0, summaries: 0, adminReads: 0, authentication: 0 };
    const visitService = {
        async recordVisit({ request }) {
            calls.visits += 1;
            const ignored = request.headers['user-agent'] === 'QA-Bot';
            return {
                counted: !ignored, ignored, reason: ignored ? 'automated_request' : null,
                todayCount: 41, totalCount: 701, summary: { total: 701 },
                users: [{ id: 'other-member', ip: '192.0.2.5' }],
                session: { visitorType: 'member', startedAt: '2026-09-08 09:00:00' },
            };
        },
        async getPublicSummary(options) { calls.summaries += 1; return getSummary(options); },
        async getAdminStats() { calls.adminReads += 1; return { summary: { today: 41, total: 701 }, series: [] }; },
        async getAdminSessions() { calls.adminReads += 1; return { sessions: [{ id: 'session-1' }] }; },
        async getAdminMembers() { calls.adminReads += 1; return { members: [{ id: 'member-1' }] }; },
        verifyAdminExclusionToken: token => token === 'excluded-browser',
        createAdminExclusionCookie: () => 'wgs_visitor_admin_exclusion=excluded-browser; HttpOnly',
        adminExclusionCookieName: 'wgs_visitor_admin_exclusion',
    };
    app.use(express.json());
    registerRetiredFeatureRoutes({ app });
    registerVisitorRoutes({
        app,
        clock,
        visitorService: visitService,
        visitSessionService: visitService,
        memberLoginActivityService: { async getStats() { calls.adminReads += 1; return { totalCount: 12 }; } },
        ensureVisitorAnalyticsSchema: async () => {},
        validateAdminSession: async req => {
            calls.authentication += 1;
            return req.headers['x-qa-role'] === 'administrator'
                ? { valid: true, isAdmin: true }
                : { valid: false, reason: 'not_admin' };
        },
    });
    app.use((_req, res) => res.status(404).json({ code: 'not_found' }));
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    return { calls, origin: `http://127.0.0.1:${server.address().port}` };
}

test('public visit collection acknowledges a write without exposing any returned aggregate or identity fields', async t => {
    const { origin, calls } = await fixture(t);
    const response = await fetch(`${origin}/api/visitors/visit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WGS-Client-Id': 'wgs-qa-public-client' },
        body: JSON.stringify({ entryPath: '/' }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await response.json(), { success: true, counted: true, ignored: false, reason: null });
    assert.deepEqual(calls, { visits: 1, summaries: 0, adminReads: 0, authentication: 0 });
});

test('automated and administrator-excluded visit responses reveal no counts and exclusion performs no visit', async t => {
    const { origin, calls } = await fixture(t);
    const automated = await fetch(`${origin}/api/visitors/visit`, {
        method: 'POST', headers: { 'User-Agent': 'QA-Bot' },
    });
    assert.deepEqual(await automated.json(), {
        success: true, counted: false, ignored: true, reason: 'automated_request',
    });
    const excluded = await fetch(`${origin}/api/visitors/visit`, {
        method: 'POST', headers: { Cookie: 'wgs_visitor_admin_exclusion=excluded-browser' },
    });
    assert.deepEqual(await excluded.json(), {
        success: true, counted: false, ignored: true, reason: 'admin_excluded',
    });
    assert.deepEqual(calls, { visits: 1, summaries: 0, adminReads: 0, authentication: 0 });
});

test('visitor reads are rejected and retired member presence URLs stay closed for every method', async t => {
    const { origin, calls } = await fixture(t);
    for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${origin}/api/visitors/visit?summary=true`, { method });
        assert.equal(response.status, 405);
        assert.equal(response.headers.get('allow'), 'POST');
    }
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(`${origin}/api/online-users`, {
            method, headers: { 'X-User-Id': 'member', 'X-Session-Token': 'member-session' },
        });
        assert.equal(response.status, 404);
        if (method !== 'HEAD') assert.equal((await response.json()).code, 'feature_removed');
    }
    assert.deepEqual(calls, { visits: 0, summaries: 0, adminReads: 0, authentication: 0 });
});

test('administrator visitor and login metrics remain gated and available through administrator routes', async t => {
    const { origin, calls } = await fixture(t);
    const paths = ['/api/admin/visitors/stats', '/api/admin/visitors/sessions',
        '/api/admin/visitors/members', '/api/admin/member-login-activity/stats'];
    for (const path of paths) {
        const response = await fetch(`${origin}${path}`);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).success, false);
    }
    assert.equal(calls.adminReads, 0);
    for (const path of paths) {
        const response = await fetch(`${origin}${path}`, { headers: { 'X-QA-Role': 'administrator' } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.success, true);
        if (path === paths[0]) assert.deepEqual(body.summary, { today: 41, total: 701 });
    }
    assert.equal(calls.adminReads, 4);
});

test('public footer reads expose only two counts without collecting visits or applying private filters', async t => {
    const { origin, calls } = await fixture(t);
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(
        `${origin}/api/visitors/summary?memberIds=private-member&period=year`,
    )));
    for (const response of responses) {
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /no-store/);
        assert.deepEqual(await response.json(), { success: true, todayCount: 41, totalCount: 701 });
    }
    assert.deepEqual(calls, { visits: 0, summaries: 1, adminReads: 0, authentication: 0 });
});

test('summary cache expires after 30 seconds and immediately on the Korean date boundary', async t => {
    let now = new Date('2026-09-08T14:59:59Z');
    const { origin, calls } = await fixture(t, {
        clock: () => now,
        getSummary: async ({ now: current }) => ({
            todayCount: current < new Date('2026-09-08T15:00:00Z') ? 41 : 0, totalCount: 701,
        }),
    });
    const read = async () => (await fetch(`${origin}/api/visitors/summary`)).json();
    assert.equal((await read()).todayCount, 41);
    now = new Date('2026-09-08T15:00:01Z');
    assert.equal((await read()).todayCount, 0);
    assert.equal(calls.summaries, 2);
    await read();
    assert.equal(calls.summaries, 2);
    now = new Date('2026-09-08T15:00:31Z');
    await read();
    assert.equal(calls.summaries, 3);
});

test('summary failures and invalid counts are unavailable, never fabricated zeroes or cached errors', async t => {
    t.mock.method(console, 'error', () => {});
    let attempt = 0;
    const { origin, calls } = await fixture(t, { getSummary: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('database unavailable');
        if (attempt === 2) return { todayCount: -1, totalCount: 701 };
        return { todayCount: 0, totalCount: 701 };
    } });
    for (let index = 0; index < 2; index += 1) {
        const response = await fetch(`${origin}/api/visitors/summary`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { success: false, reason: 'visitor_summary_unavailable' });
    }
    const recovered = await fetch(`${origin}/api/visitors/summary`);
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), { success: true, todayCount: 0, totalCount: 701 });
    assert.equal(calls.summaries, 3);
    assert.equal(calls.visits, 0);
});

test('member notice delivery preserves the message and cursor while audience counts remain in administrator history', () => {
    const state = createAdminRuntimeState({
        activeUsers: new Map([['member', { loginAt: Date.now() - 1000 }]]),
    });
    const notice = state.createAdminBroadcastNotice({
        title: 'Service notice', message: 'Study can continue.', level: 'info',
        authorId: 'admin', authorName: 'Administrator', deliveredTo: 7,
    });
    const memberNotices = state.getAdminBroadcastsForUser('member', 0);
    assert.equal(memberNotices.length, 1);
    assert.equal(memberNotices[0].message, notice.message);
    assert.equal(memberNotices[0].createdAtMs, notice.createdAtMs);
    assert.equal(Object.hasOwn(memberNotices[0], 'deliveredTo'), false);
    assert.deepEqual(state.getAdminBroadcastsForUser('member', notice.createdAtMs), []);
    memberNotices[0].title = 'A client-local edit';
    assert.equal(state.getAdminBroadcastHistory()[0].deliveredTo, 7);
    assert.equal(state.getAdminBroadcastHistory()[0].title, 'Service notice');
});
