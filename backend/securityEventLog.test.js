'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createSecurityEventLog } = require('./services/securityEventLog');
const { createRuntimeLogger } = require('./services/runtimeLog');

async function fixture(options = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wgs-security-log-'));
    const logger = createSecurityEventLog({ directory, secret: 'test-secret-'.repeat(4), ...options });
    const read = async () => (await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.jsonl')).sort()
        .map(name => fs.readFile(path.join(directory, name), 'utf8')))).join('');
    return { directory, logger, read, close: async () => { await logger.flush(); await fs.rm(directory, { recursive: true, force: true }); } };
}

test('security events persist only allowed fields and keyed actor/IP hashes', async () => {
    const f = await fixture();
    try {
        f.logger.record({ event: 'member.login', outcome: 'rejected', status: 401, method: 'POST', actorId: 'private-account', ip: '192.0.2.9',
            password: 'PasswordSecret', code: '111222', cookie: 'CookieSecret', body: { email: 'private@example.test' }, query: '?token=QuerySecret', error: new Error('SqlPasswordSecret') });
        await f.logger.flush();
        const text = await f.read(), row = JSON.parse(text.trim());
        for (const secret of ['private-account', '192.0.2.9', 'PasswordSecret', '111222', 'CookieSecret', 'private@example.test', 'QuerySecret', 'SqlPasswordSecret']) assert.ok(!text.includes(secret));
        assert.deepEqual(Object.keys(row).sort(), ['actorHash', 'event', 'ipHash', 'method', 'outcome', 'status', 'time']);
        assert.match(row.actorHash, /^[a-f0-9]{64}$/); assert.notEqual(row.actorHash, row.ipHash);
        assert.equal(f.logger.record({ event: 'raw secret', outcome: 'success' }), false);
    } finally { await f.close(); }
});

test('real HTTP login failures, OTP pending, CSRF denial and logout emit correct outcomes without payloads', async () => {
    const f = await fixture(), app = express();
    app.use(f.logger.middleware); app.use(express.json());
    app.post('/api/login', (_req, res) => res.json({ success: false, msg: 'secret from mail' }));
    app.post('/api/admin/auth/login', (_req, res) => res.status(202).json({ success: true, valid: false }));
    app.post('/api/admin/board/posts', (_req, res) => res.status(403).json({ reason: 'csrf', secret: 'csrf secret' }));
    app.post('/api/logout', (req, res) => { req.wgsMemberAuth = { user: { id: 'trusted-user' } }; res.json({ success: true }); });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
        for (const route of ['login', 'admin/auth/login', 'admin/board/posts', 'logout']) {
            await fetch(`http://127.0.0.1:${server.address().port}/api/${route}?password=querysecret`, { method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: 'token=cookiesecret', 'User-Agent': 'uasecret' }, body: JSON.stringify({ password: 'bodysecret', code: '555666' }) });
        }
        await f.logger.flush(); const text = await f.read(), rows = text.trim().split('\n').map(JSON.parse);
        assert.deepEqual(rows.map(row => [row.event, row.outcome]), [['member.login', 'rejected'], ['admin.login', 'pending'], ['admin.change', 'rejected'], ['member.logout', 'success']]);
        assert.match(rows[3].actorHash, /^[a-f0-9]{64}$/);
        for (const value of ['querysecret', 'cookiesecret', 'uasecret', 'bodysecret', '555666', 'secret from mail', 'csrf secret', 'trusted-user']) assert.ok(!text.includes(value));
    } finally { await new Promise(resolve => server.close(resolve)); await f.close(); }
});

test('rotation bounds total files and each file after a restart, retaining unrelated files', async () => {
    const f = await fixture({ maxBytes: 750, maxFiles: 3, perMinute: 1000 });
    try {
        await f.logger.ready(); await fs.writeFile(path.join(f.directory, 'operator-notes.txt'), 'keep');
        for (let index = 0; index < 40; index++) f.logger.record({ event: 'admin.change', outcome: 'success', actorId: String(index), ip: '192.0.2.1' });
        await f.logger.flush();
        const restarted = createSecurityEventLog({ directory: f.directory, secret: 'test-secret-'.repeat(4), maxBytes: 750, maxFiles: 3 });
        restarted.record({ event: 'member.login', outcome: 'success' }); await restarted.flush();
        const names = (await fs.readdir(f.directory)).filter(name => name.endsWith('.jsonl'));
        assert.equal(names.length, 3);
        for (const name of names) assert.ok((await fs.stat(path.join(f.directory, name))).size <= 750);
        assert.equal(await fs.readFile(path.join(f.directory, 'operator-notes.txt'), 'utf8'), 'keep');
    } finally { await f.close(); }
});

test('age retention removes only this logger historical files', async () => {
    let now = Date.UTC(2026, 8, 10, 12);
    const f = await fixture({ now: () => now, maxDays: 14 });
    try {
        f.logger.record({ event: 'member.login', outcome: 'success' }); await f.logger.flush();
        now += 15 * 86400000;
        f.logger.record({ event: 'member.logout', outcome: 'success' }); await f.logger.flush();
        const text = await f.read(); assert.ok(!text.includes('member.login')); assert.ok(text.includes('member.logout'));
    } finally { await f.close(); }
});

test('request flood is bounded by queue and rate with a later dropped-count record', async () => {
    let now = Date.UTC(2026, 8, 10, 12);
    const f = await fixture({ now: () => now, maxQueue: 4, perMinute: 3 });
    try {
        for (let index = 0; index < 10000; index++) f.logger.record({ event: 'request.denied', outcome: 'rejected', status: 429 });
        assert.ok(f.logger.health().queued <= 4); assert.equal(f.logger.health().dropped, 9997);
        await f.logger.flush(); now += 60000;
        f.logger.record({ event: 'member.login', outcome: 'success' }); await f.logger.flush();
        const rows = (await f.read()).trim().split('\n').map(JSON.parse);
        assert.equal(rows.length, 5); assert.equal(rows[3].event, 'log.limited'); assert.equal(rows[3].count, 9997);
    } finally { await f.close(); }
});

test('file failure is contained and reports unhealthy without leaking the exception', async () => {
    const f = await fixture();
    try {
        const invalid = path.join(f.directory, 'file'); await fs.writeFile(invalid, 'private');
        const logger = createSecurityEventLog({ directory: invalid });
        logger.record({ event: 'member.login', outcome: 'success' }); await logger.flush();
        assert.equal(logger.health().healthy, false);
    } finally { await f.close(); }
});

test('runtime diagnostics never serialize SQL, SMTP errors, nested secrets or template user content', () => {
    const lines = [], log = createRuntimeLogger({ write: line => lines.push(line), perMinute: 2 });
    const error = Object.assign(new Error('password SecretPassword private@example.test'), { code: 'ER_DUP_ENTRY', sql: 'INSERT secret', response: 'SMTP private' });
    log('error', 'routes/auth/authRoutes.js:1', 'user literalsecret', error, { password: 'NestedSecret' });
    log('warn', 'server.js:2', 'SMTP response raw', 'message ID secret');
    log('error', 'server.js:2', error);
    const text = lines.join(''); assert.equal(lines.length, 2); assert.ok(text.includes('ER_DUP_ENTRY'));
    for (const value of ['SecretPassword', 'private@example.test', 'INSERT secret', 'SMTP private', 'literalsecret', 'NestedSecret', 'response raw', 'message ID secret']) assert.ok(!text.includes(value));
});
