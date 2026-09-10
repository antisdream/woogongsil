'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createSecurityRuntime } = require('./security-runtime.cjs');
const dotenv = require('../../backend/node_modules/dotenv'), mysql = require('../../backend/node_modules/mysql2');

function fixture(extra = {}) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wgs-runtime-release-')), app = path.join(folder, 'app'), before = path.join(folder, 'before');
    fs.mkdirSync(path.join(app, 'backend'), { recursive: true }); fs.mkdirSync(before);
    const original = 'DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_USER=existing_migration_user\nDB_PASSWORD="OriginalPrivatePassword"\nDB_NAME=exam_bank\nMAIL_USER="private@example.test"\nMAIL_APP_PASSWORD="mail # private"\nPUBLIC_SITE_URL=https://woogongsil.site\n';
    fs.writeFileSync(path.join(app, 'backend/.env'), original);
    const calls = [], migrations = [];
    const deps = { dotenv, mysql, database: { createDatabasePool: env => ({ end: async () => {}, env }) },
        migrations: { runMigrations: async options => { migrations.push(options); return { skipped: false }; } },
        runtimeAccount: { provisionRuntimeAccount: async options => { calls.push({ provision: options }); return { tableGrantCount: 59 }; } }, ...extra.dependencies };
    const runtime = createSecurityRuntime({ app, before, dependencies: deps,
        spawn: extra.spawn || ((command, args, options) => { calls.push({ command, args, options }); return { status: 0, stdout: '' }; }) });
    return { folder, app, before, original, runtime, calls, migrations, close: () => fs.rmSync(folder, { recursive: true, force: true }) };
}

test('prepare preserves the original env and persists stable independent runtime secrets', () => {
    const f = fixture(); try {
        f.runtime.prepare(); const first = fs.readFileSync(path.join(f.folder, 'private/runtime-db.json'));
        f.runtime.prepare(); assert.deepEqual(fs.readFileSync(path.join(f.folder, 'private/runtime-db.json')), first);
        const data = JSON.parse(first); assert.equal(data.user, 'wgs_app_security_v1'); assert.equal(data.password.length, 48); assert.notEqual(data.password, data.logSecret);
        const migration = dotenv.parse(fs.readFileSync(path.join(f.folder, 'private/db-migration.env')));
        assert.equal(migration.DB_USER, 'existing_migration_user'); assert.ok(!('MAIL_APP_PASSWORD' in migration));
        assert.equal(fs.readFileSync(path.join(f.before, 'backend.env'), 'utf8'), f.original);
        assert.equal(fs.readFileSync(path.join(f.app, 'backend/.env'), 'utf8'), f.original);
    } finally { f.close(); }
});

test('activation migrates first, provisions table privileges and preserves mail settings', async () => {
    const f = fixture(); try {
        f.runtime.prepare(); await f.runtime.activate();
        const env = dotenv.parse(fs.readFileSync(path.join(f.app, 'backend/.env')));
        assert.equal(f.migrations.length, 1); assert.equal(f.migrations[0].importLegacyJson, false);
        assert.equal(f.migrations[0].pool.env.DB_USER, 'existing_migration_user');
        assert.equal(env.DB_USER, 'wgs_app_security_v1'); assert.equal(env.MAIL_APP_PASSWORD, 'mail # private');
        assert.equal(env.WGS_HSTS_MAX_AGE_SECONDS, '300'); assert.equal(env.WGS_ALLOW_PRIVATE_DEV_ORIGINS, 'false');
        f.runtime.restart(); const call = f.calls.find(item => item.command === 'pm2');
        assert.deepEqual(call.args, ['restart', 'wgs-backend', '--update-env']);
        assert.equal(call.options.env.DB_USER, env.DB_USER); assert.equal(call.options.env.DB_PASSWORD, env.DB_PASSWORD);
        assert.ok(!JSON.stringify(call.args).includes(env.DB_PASSWORD));
    } finally { f.close(); }
});

test('rollback restores exact original environment and restarts with the original DB identity', async () => {
    const f = fixture(); try {
        f.runtime.prepare(); await f.runtime.activate(); f.runtime.rollback(); f.runtime.restart();
        assert.equal(fs.readFileSync(path.join(f.app, 'backend/.env'), 'utf8'), f.original);
        assert.equal(f.calls.find(item => item.command === 'pm2').options.env.DB_USER, 'existing_migration_user');
        assert.ok(fs.existsSync(path.join(f.folder, 'private/runtime-db.json')));
    } finally { f.close(); }
});

test('failed migration cannot replace application credentials or provision an account', async () => {
    const f = fixture({ dependencies: { migrations: { runMigrations: async () => { throw new Error('migration failure'); } } } });
    try { f.runtime.prepare(); await assert.rejects(f.runtime.activate(), /migration failure/);
        assert.equal(fs.readFileSync(path.join(f.app, 'backend/.env'), 'utf8'), f.original); assert.equal(f.calls.length, 0);
    } finally { f.close(); }
});

test('root bridge sends escaped secrets only in stdin and returns typed query rows', async () => {
    const calls = [], f = fixture({ spawn: (command, args, options) => { calls.push({ command, args, options }); return { status: 0, stdout: 'count\n0\n' }; } });
    try {
        const db = f.runtime.rootBridge('exam_bank', mysql);
        assert.deepEqual(await db.query('SELECT COUNT(*) AS count FROM mysql.user WHERE User=?', ['wgs_app_security_v1']), [[{ count: '0' }], []]);
        await db.query('CREATE USER ?@? IDENTIFIED BY ?', ['wgs_app_security_v1', '127.0.0.1', "Private'Password"]);
        assert.ok(!JSON.stringify(calls[1].args).includes('Private'));
        assert.equal(calls[1].options.input, mysql.format('CREATE USER ?@? IDENTIFIED BY ?', ['wgs_app_security_v1', '127.0.0.1', "Private'Password"]) + ';\n');
    } finally { f.close(); }
});

test('Android bundled HTML uses the same CSP as the production HTTP server', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../android/app/src/main/java/site/woogongsil/app/web/BundledWebAssets.kt'), 'utf8');
    const block = source.split('"Content-Security-Policy" to listOf(')[1].split(').joinToString')[0];
    const nativePolicy = [...block.matchAll(/"([^"\r\n]+)"/g)].map(match => match[1]).join('; ');
    const headers = {};
    require('../../backend/services/httpSecurity').createWgsSecurityHeaders({ NODE_ENV: 'production' })({ secure: true }, { setHeader: (key, value) => { headers[key] = value; } }, () => {});
    assert.equal(nativePolicy, headers['Content-Security-Policy']);
});
