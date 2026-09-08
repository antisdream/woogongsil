'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const migration = require('../scripts/release/migrate-notices.cjs');

const clone = value => structuredClone(value);
const fingerprint = 'synthetic-database-only';
const marker = '[[UGONGSIL_BOARD:NOTICE]]';
const retiredParagraph = '※ v2.4.0 현재 실시간 접속자 표시는 제공하지 않습니다. 위 관련 내용은 당시 변경 이력입니다.';

function fixtures() {
    const operations = Array.from({ length: 7 }, (_, index) => ({
        id: String(7000000000000 + index),
        kind: index < 2 ? 'remove' : index < 4 ? 'rename' : 'append',
        ...(index >= 2 && index < 4 ? { title: `[업데이트] v2.4.0 합성 안내 ${index}` } : {}),
        ...(index >= 4 ? { paragraph: retiredParagraph, blockId: `00000000-0000-4000-8000-00000000000${index}` } : {}),
    }));
    const rows = operations.map((op, index) => ({
        id: op.id, title: `합성 공지 ${index}`, content: `원본 합성 본문 ${index}\n${marker}`,
        authorId: 'synthetic-admin', authorName: '합성 관리자', date: '2026-09-08T06:00:00.000Z',
        views: index * 3, likes: index < 2 ? 0 : index, isNotice: index % 2, noticeOrder: index < 2 ? null : index,
        contentJson: index === 4 ? null : JSON.stringify([{ id: `original-${index}`, type: 'paragraph', content: [{ type: 'text', text: `원본 합성 본문 ${index}`, styles: {} }], props: {}, children: [] }]),
    }));
    for (const op of operations) {
        const row = rows.find(row => row.id === op.id);
        op.beforeSha256 = migration.scopeHash(row);
        if (op.kind !== 'remove') op.afterSha256 = migration.scopeHash(migration.buildPatchedRow(row, op));
    }
    return { rows, manifest: { schemaVersion: 1, migrationId: migration.MIGRATION_ID, operations } };
}

function harness() {
    const { rows, manifest } = fixtures();
    const unrelated = { ...clone(rows[0]), id: '7000000000099', title: '변경 금지 합성 자유 글', views: 91 };
    const state = { rows: [...clone(rows), unrelated], backup: null, relations: { comments: [], likes: [] }, events: [], failUpdate: 0, updates: 0 };
    const repository = {
        async acquireLock() { state.events.push('lock'); },
        async releaseLock() { state.events.push('unlock'); },
        async begin() { state.events.push('begin'); state.snapshot = clone(state.rows); },
        async inspectSchema() { state.events.push('schema'); return fingerprint; },
        async readRows(ids) { state.events.push('read'); return clone(state.rows.filter(row => ids.includes(row.id)).sort((a, b) => a.id.localeCompare(b.id))); },
        async readDeletionRelations() { state.events.push('relations'); return clone(state.relations); },
        async updateRow(id, fields) {
            state.events.push('update');
            state.updates += 1;
            if (state.failUpdate === state.updates) throw new Error('synthetic SQL failure with private values');
            Object.assign(state.rows.find(row => row.id === id), fields);
        },
        async deleteRow(id) { state.events.push('delete'); state.rows = state.rows.filter(row => row.id !== id); },
        async insertRow(row) { state.events.push('insert'); assert.ok(!state.rows.some(item => item.id === row.id)); state.rows.push(clone(row)); },
        async commit() { state.events.push('commit'); state.snapshot = null; },
        async rollback() { state.events.push('rollback'); if (state.snapshot) state.rows = clone(state.snapshot); state.snapshot = null; },
    };
    const backupStore = {
        read() { return clone(state.backup); },
        write(value) { state.events.push('backup'); assert.equal(state.backup, null); state.backup = clone(value); return clone(value); },
        summary() { return { backupFile: migration.BACKUP_NAME, backupSha256: migration.sha256(JSON.stringify(state.backup)) }; },
    };
    const run = direction => migration.runMigration({ direction, repository, backupStore, manifest });
    return { state, repository, backupStore, rows, manifest, unrelated: clone(unrelated), run };
}

test('apply backs up all seven originals before DML and preserves unrelated rows and live counters', async () => {
    const h = harness();
    h.state.rows[2].views += 10;
    const before = clone(h.state.rows);
    const result = await h.run('apply');
    assert.deepEqual({ status: result.status, updated: result.updated, removed: result.removed }, { status: 'applied', updated: 5, removed: 2 });
    assert.equal(h.state.backup.rows.length, 7);
    assert.ok(h.state.events.indexOf('backup') < h.state.events.indexOf('update'));
    assert.ok(h.state.events.indexOf('backup') < h.state.events.indexOf('delete'));
    assert.deepEqual(h.state.rows.find(row => row.id === h.unrelated.id), h.unrelated);
    for (const row of h.state.rows.filter(row => row.id !== h.unrelated.id)) {
        const original = before.find(item => item.id === row.id);
        for (const key of ['views', 'likes', 'authorId', 'authorName', 'date', 'isNotice', 'noticeOrder']) assert.equal(row[key], original[key]);
    }
    assert.equal(h.state.events.at(-1), 'unlock');
});

test('second apply changes neither data nor immutable backup', async () => {
    const h = harness();
    await h.run('apply');
    const backup = clone(h.state.backup);
    h.state.rows.find(row => row.id === h.rows[2].id).views += 7;
    const after = clone(h.state.rows);
    const writes = h.state.events.filter(event => ['update', 'delete', 'insert', 'backup'].includes(event)).length;
    assert.equal((await h.run('apply')).status, 'already_applied');
    assert.deepEqual(h.state.rows, after);
    assert.deepEqual(h.state.backup, backup);
    assert.equal(h.state.events.filter(event => ['update', 'delete', 'insert', 'backup'].includes(event)).length, writes);
});

test('rollback restores two removed rows and original scoped fields while retaining later views and likes', async () => {
    const h = harness();
    await h.run('apply');
    const retained = h.state.rows.find(row => row.id === h.rows[2].id);
    retained.views = 345;
    retained.likes = 9;
    const result = await h.run('rollback');
    assert.equal(result.status, 'rolled_back');
    assert.equal(result.restored, 2);
    assert.equal(result.updated, 5);
    for (const original of h.rows) assert.equal(migration.scopeHash(h.state.rows.find(row => row.id === original.id)), migration.scopeHash(original));
    assert.equal(h.state.rows.find(row => row.id === retained.id).views, 345);
    assert.equal(h.state.rows.find(row => row.id === retained.id).likes, 9);
    assert.deepEqual(h.state.rows.find(row => row.id === h.rows[0].id), h.rows[0]);
    assert.deepEqual(h.state.rows.find(row => row.id === h.unrelated.id), h.unrelated);
    assert.equal((await h.run('rollback')).status, 'already_rolled_back');
});

test('historical notice marker remains last and rich document receives the same single paragraph', () => {
    const { rows, manifest } = fixtures();
    for (const operation of manifest.operations.filter(op => op.kind === 'append')) {
        const row = rows.find(row => row.id === operation.id);
        const next = migration.buildPatchedRow(row, operation);
        assert.equal(next.content, row.content.replace(`\n${marker}`, `\n\n${retiredParagraph}\n${marker}`));
        assert.equal(next.title, row.title);
        if (row.contentJson === null) assert.equal(next.contentJson, null);
        else {
            const before = JSON.parse(row.contentJson);
            const after = JSON.parse(next.contentJson);
            assert.deepEqual(after.slice(0, -1), before);
            assert.equal(after.at(-1).content[0].text, retiredParagraph);
            assert.equal(after.at(-1).id, operation.blockId);
        }
    }
});

for (const field of ['title', 'content', 'authorId', 'authorName', 'date', 'contentJson']) {
    test(`changed ${field} aborts before backup or any mutation`, async () => {
        const h = harness();
        h.state.rows[0][field] = `unexpected ${field}`;
        const before = clone(h.state.rows);
        await assert.rejects(h.run('apply'), { code: 'NOTICE_STATE_CHANGED' });
        assert.deepEqual(h.state.rows, before);
        assert.equal(h.state.backup, null);
        assert.ok(!h.state.events.includes('update'));
        assert.ok(h.state.events.includes('rollback'));
    });
}

for (const relationship of ['comments', 'likes', 'cachedLikes']) {
    test(`new ${relationship} blocks removal without touching any row`, async () => {
        const h = harness();
        if (relationship === 'cachedLikes') h.state.rows[0].likes = 1;
        else h.state.relations[relationship] = [{ postId: h.rows[0].id }];
        const before = clone(h.state.rows);
        await assert.rejects(h.run('apply'), { code: 'NOTICE_HAS_INTERACTIONS' });
        assert.deepEqual(h.state.rows, before);
        assert.equal(h.state.backup, null);
    });
}

test('mixed before/after targets are rejected instead of partially repaired', async () => {
    const h = harness();
    const op = h.manifest.operations[2];
    h.state.rows[2] = migration.buildPatchedRow(h.state.rows[2], op);
    await assert.rejects(h.run('apply'), { code: 'NOTICE_STATE_CHANGED' });
    assert.equal(h.state.backup, null);
});

test('backup failure prevents the first database mutation', async () => {
    const h = harness();
    const before = clone(h.state.rows);
    h.backupStore.write = () => { throw new Error('synthetic disk full'); };
    await assert.rejects(h.run('apply'), /synthetic disk full/);
    assert.deepEqual(h.state.rows, before);
    assert.ok(!h.state.events.includes('update'));
    assert.ok(h.state.events.includes('rollback'));
});

test('mid-update failure rolls back every changed target but retains private recovery backup', async () => {
    const h = harness();
    const before = clone(h.state.rows);
    h.state.failUpdate = 3;
    await assert.rejects(h.run('apply'), /synthetic SQL failure/);
    assert.deepEqual(h.state.rows, before);
    assert.equal(h.state.backup.stateBefore, 'before');
    assert.equal(h.state.backup.rows.length, 7);
    assert.equal((await h.run('apply')).status, 'applied');
});

test('rollback rejects a missing backup or content changed after apply', async () => {
    const h = harness();
    await assert.rejects(h.run('rollback'), { code: 'BACKUP_REQUIRED' });
    await h.run('apply');
    h.state.rows[0].title = 'later user edit';
    const before = clone(h.state.rows);
    await assert.rejects(h.run('rollback'), { code: 'NOTICE_STATE_CHANGED' });
    assert.deepEqual(h.state.rows, before);
});

test('new apply backup on an already-applied release cannot undo an earlier deployment', async () => {
    const h = harness();
    await h.run('apply');
    h.state.backup = null;
    const after = clone(h.state.rows);
    assert.equal((await h.run('apply')).status, 'already_applied');
    assert.equal(h.state.backup.stateBefore, 'after');
    assert.equal((await h.run('rollback')).status, 'not_changed_by_this_backup');
    assert.deepEqual(h.state.rows, after);
});

test('tampered, stale or wrong-database backup is rejected', async () => {
    const h = harness();
    await h.run('apply');
    const valid = clone(h.state.backup);
    h.state.backup.rows[0].views += 1;
    await assert.rejects(h.run('rollback'), { code: 'INVALID_BACKUP' });
    h.state.backup = valid;
    h.repository.inspectSchema = async () => 'different-synthetic-database';
    await assert.rejects(h.run('rollback'), { code: 'BACKUP_SCOPE_MISMATCH' });
    h.repository.inspectSchema = async () => fingerprint;
    await h.run('rollback');
    h.state.rows.find(row => row.id === h.rows[0].id).views += 1;
    await assert.rejects(h.run('apply'), { code: 'BACKUP_STALE' });
});

test('uncertain commit produces a guarded recovery error without SQL or private details', async () => {
    const h = harness();
    h.repository.commit = async () => { throw new Error('password=synthetic-secret SELECT private body'); };
    await assert.rejects(h.run('apply'), error => {
        assert.equal(error.code, 'COMMIT_OUTCOME_UNKNOWN');
        assert.ok(!JSON.stringify(migration.safeFailure(error)).includes('synthetic-secret'));
        return true;
    });
    assert.equal(h.state.backup.stateBefore, 'before');
    assert.ok(!JSON.stringify(migration.safeFailure(new Error('password=private'))).includes('password='));
});

test('private file backup is immutable, parseable and never includes real fixtures', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wgs-notice-synthetic-test-'));
    t.after(() => {
        const resolved = fs.realpathSync(directory);
        assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
        assert.ok(path.basename(resolved).startsWith('wgs-notice-synthetic-test-'));
        fs.rmSync(resolved, { recursive: true });
    });
    const { rows, manifest } = fixtures();
    const store = migration.createPrivateBackupStore(directory);
    assert.equal(store.read(), null);
    const backup = migration.makeBackup(rows, 'before', manifest, fingerprint);
    assert.deepEqual(store.write(backup), backup);
    assert.deepEqual(migration.validateBackup(store.read(), manifest, fingerprint), backup);
    assert.throws(() => store.write(backup), { code: 'BACKUP_EXISTS' });
    assert.deepEqual(fs.readdirSync(directory), [migration.BACKUP_NAME]);
    assert.match(store.summary().backupSha256, /^[a-f0-9]{64}$/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, migration.BACKUP_NAME)).mode & 0o077, 0);
});

test('SQL adapter restricts writes by ID, refuses unrelated fields, and verifies affected row counts', async () => {
    const calls = [];
    const connection = { async execute(sql, values) { calls.push({ sql, values }); return [{ affectedRows: 1 }]; } };
    const repository = new migration.SqlNoticeRepository(connection);
    await repository.updateRow('7000000000002', { title: 'safe title' });
    await repository.deleteRow('7000000000000');
    await repository.insertRow(fixtures().rows[0]);
    assert.match(calls[0].sql, /^UPDATE wgs_posts SET `title` = \? WHERE id = \?$/);
    assert.deepEqual(calls[0].values, ['safe title', '7000000000002']);
    assert.equal(calls[1].sql, 'DELETE FROM wgs_posts WHERE id = ?');
    assert.match(calls[2].sql, /^INSERT INTO wgs_posts /);
    await assert.rejects(repository.updateRow('7000000000002', { views: 0 }), { code: 'INVALID_UPDATE' });
    connection.execute = async () => [{ affectedRows: 0 }];
    await assert.rejects(repository.deleteRow('7000000000000'), { code: 'WRITE_COUNT_MISMATCH' });
});

test('SQL adapter locks target rows and deletion relation ranges inside an explicit serializable transaction', async () => {
    const calls = [];
    const repository = new migration.SqlNoticeRepository({
        async query(sql) { calls.push(sql); },
        async beginTransaction() { calls.push('BEGIN'); },
        async execute(sql, values) { calls.push(sql); assert.deepEqual(values, ['7000000000000', '7000000000001']); return [[]]; },
    });
    await repository.begin();
    await repository.readRows(['7000000000000', '7000000000001']);
    await repository.readDeletionRelations(['7000000000000', '7000000000001']);
    assert.equal(calls[1], 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    assert.equal(calls[2], 'BEGIN');
    for (const sql of calls.slice(3)) {
        assert.match(sql, /WHERE (id|postId) IN \(\?,\?\)/);
        assert.ok(sql.endsWith('FOR UPDATE'));
    }
});

test('release manifest offline validation needs neither database environment nor mysql dependency', () => {
    const script = path.join(__dirname, '..', 'scripts', 'release', 'migrate-notices.cjs');
    const result = spawnSync(process.execPath, [script, 'verify'], { encoding: 'utf8', env: { ...process.env, DB_USER: '', DB_NAME: '', DB_PASSWORD: '' } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'manifest_valid');
    assert.equal(summary.targets, 7);
    assert.ok(!result.stdout.includes('authorId'));
});

test('argument validation fails before connecting when paths or options are ambiguous', () => {
    assert.throws(() => migration.parseArguments(['apply', '--app-root', 'relative', '--backup-dir', 'relative']), { code: 'INVALID_ARGUMENTS' });
    assert.throws(() => migration.parseArguments(['apply', '--unknown', os.tmpdir()]), { code: 'INVALID_ARGUMENTS' });
    assert.throws(() => migration.parseArguments(['rollback', '--app-root', os.tmpdir(), '--app-root', os.tmpdir()]), { code: 'INVALID_ARGUMENTS' });
    assert.deepEqual(migration.parseArguments(['verify']), { command: 'verify' });
});
