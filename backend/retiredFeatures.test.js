'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const registerRetiredFeatureRoutes = require('./routes/retiredFeatureRoutes');
const registerRealtimeRoutes = require('./routes/realtimeRoutes');
const { createRealtimeState } = require('./services/realtimeState');

test('all retired ranking and chat URLs return JSON 404 before a downstream SPA fallback', async (t) => {
    const app = express();
    registerRetiredFeatureRoutes({ app });
    app.use((_req, res) => res.type('html').send('<html>SPA fallback</html>'));
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    for (const path of ['/api/rankings', '/api/my-ranking-history', '/api/my-ranking-history-v2', '/api/admin/users/learner/ranking-history', '/api/ipep-ranking', '/api/realtime-chat/list', '/api/realtime-chat/send']) {
        for (const method of ['GET', 'POST']) {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
            assert.equal(response.status, 404, `${method} ${path}`);
            assert.match(response.headers.get('content-type'), /application\/json/);
            assert.equal((await response.json()).code, 'feature_removed');
        }
    }
});

test('presence keeps session ownership, admin filtering and expiry after chat buffer removal', () => {
    const state = createRealtimeState({ activeUserTtlMs: 1000 });
    const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    state.touchActiveUser({ id: 'learner', name: 'Learner' }, request, 'new-token');
    state.touchActiveUser({ id: 'operator', role: 'admin' }, request, 'admin-token');
    state.removeActiveUser('learner', 'old-token');
    assert.equal(state.activeUsers.has('learner'), true);
    assert.deepEqual(state.getActiveUserList().map(user => user.id), ['learner']);
    assert.ok(state.getActiveUserList()[0].loginAt);
    state.activeUsers.get('learner').lastSeenAt = Date.now() - 2000;
    assert.deepEqual(state.getActiveUserList(), []);
    assert.equal('realtimeChatMessages' in state, false);
    assert.equal('getRealtimeChatMessagesAfter' in state, false);
});

test('online user endpoint still validates the session and refreshes presence', async () => {
    const handlers = new Map();
    const touched = [];
    registerRealtimeRoutes({
        app: { post: (path, handler) => handlers.set(path, handler) },
        validateRealtimeSession: async () => ({ valid: true, user: { id: 'learner' }, sessionToken: 'token' }),
        touchActiveUser: (...args) => touched.push(args),
        getActiveUserList: () => [{ id: 'learner' }],
        serverInstanceId: 'test-instance',
    });
    const res = { json(body) { this.body = body; return this; }, status(code) { this.statusCode = code; return this; } };
    await handlers.get('/api/online-users')({ body: {} }, res);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.count, 1);
    assert.equal(touched[0][2], 'token');
    assert.deepEqual([...handlers.keys()], ['/api/online-users']);
});
