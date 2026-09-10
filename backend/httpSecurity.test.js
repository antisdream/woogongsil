'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { wgsAllowedCorsOrigin, createWgsCorsOptions, createWgsSocketOptions, createWgsSecurityHeaders } = require('./services/httpSecurity');

test('production accepts exact HTTPS origins and excludes development exceptions', () => {
    const env = { NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'http://localhost:5000,https://127.0.0.1,https://*.example.test,https://api.example.test' };
    for (const origin of ['https://woogongsil.site', 'https://www.woogongsil.site', 'https://api.example.test']) assert.equal(wgsAllowedCorsOrigin(origin, env), true, origin);
    for (const origin of ['null', 'http://woogongsil.site', 'https://woogongsil.site:8443', 'https://woogongsil.site.evil.test', 'https://evil.woogongsil.site', 'http://localhost:5000', 'https://127.0.0.1', 'http://192.168.0.1:3000', 'https://*.example.test', 'https://woogongsil.site/path']) assert.equal(wgsAllowedCorsOrigin(origin, env), false, origin);
    assert.equal(wgsAllowedCorsOrigin(undefined, env), true);
});

test('development LAN exception stays outside production and can be disabled', () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5000', 'http://192.168.0.5:3000', 'http://[::1]:5173']) {
        assert.equal(wgsAllowedCorsOrigin(origin, { NODE_ENV: 'development' }), true);
        assert.equal(wgsAllowedCorsOrigin(origin, { NODE_ENV: 'development', WGS_ALLOW_PRIVATE_DEV_ORIGINS: 'false' }), false);
        assert.equal(wgsAllowedCorsOrigin(origin, { NODE_ENV: 'production' }), false);
    }
});

test('actual HTTP CORS preflight and Socket.IO polling reject unrelated origins', async t => {
    const env = { NODE_ENV: 'production' }, app = express();
    app.use(createWgsSecurityHeaders(env)); app.use(cors(createWgsCorsOptions(env))); app.get('/ping', (_req, res) => res.json({ ok: true }));
    const server = http.createServer(app), io = new Server(server, createWgsSocketOptions(env));
    t.after(() => new Promise(resolve => io.close(resolve)));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const origin of ['https://woogongsil.site', 'https://www.woogongsil.site', 'http://localhost:5000', 'https://evil.test', 'null']) {
        const allowed = origin.startsWith('https://') && origin.endsWith('woogongsil.site');
        const response = await fetch(base + '/ping', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Wgs-Member-Csrf' } });
        assert.equal(response.headers.get('access-control-allow-origin'), allowed ? origin : null);
        if (allowed) assert.match(response.headers.get('access-control-allow-headers'), /X-Wgs-Member-Csrf/);
        const socket = await fetch(base + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: origin } });
        assert.equal(socket.status, allowed ? 200 : 403);
    }
    const response = await fetch(base + '/ping');
    assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'; script-src-attr 'none'/);
    assert.ok(!/connect-src[^;]*\s(?:ws:|wss:)(?:\s|;)/.test(csp));
    assert.match(csp, /wss:\/\/woogongsil\.site/);
});
