'use strict';
// Secrets travel only through protected files, environment variables or stdin.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const APP = '/home/ubuntu/wgs_deploy/ExamAppProject';
const DB_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_CHARSET', 'DB_CONNECTION_LIMIT'];

function checkedFile(file) {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Redirected private file');
    return file;
}

function privateWrite(file, value) {
    checkedFile(file);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.realpathSync(path.dirname(file)) !== path.resolve(path.dirname(file))) throw new Error('Redirected private directory');
    const temporary = file + '.tmp'; checkedFile(temporary);
    fs.writeFileSync(temporary, value, { mode: 0o600 }); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, file);
}

function createSecurityRuntime({ app, before, privateDirectory = path.join(path.dirname(app), 'private'), dependencies,
    spawn = spawnSync } = {}) {
    const backend = path.join(app, 'backend');
    const dotenv = dependencies?.dotenv || require(path.join(backend, 'node_modules/dotenv'));
    const envFile = path.join(backend, '.env'), saved = path.join(before, 'backend.env');
    const migrationFile = path.join(privateDirectory, 'db-migration.env'), runtimeFile = path.join(privateDirectory, 'runtime-db.json');
    const readEnv = file => dotenv.parse(fs.readFileSync(checkedFile(file)));
    const serialize = values => Object.entries(values).map(([key, value]) => {
        if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Unexpected environment key');
        const text = String(value), quote = ["'", '"', '`'].find(mark => !text.includes(mark));
        if (!quote) throw new Error('Environment value requires manual encoding');
        return key + '=' + quote + text + quote;
    }).join('\n') + '\n';

    function prepare() {
        fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
        if (fs.realpathSync(privateDirectory) !== path.resolve(privateDirectory)) throw new Error('Redirected private directory');
        fs.chmodSync(privateDirectory, 0o700);
        const current = readEnv(envFile);
        if (!['127.0.0.1', 'localhost', '::1'].includes(current.DB_HOST || '127.0.0.1')) throw new Error('Expected a local database');
        if (!/^[a-zA-Z0-9_]+$/.test(current.DB_NAME || '')) throw new Error('Unexpected database name');
        if (!fs.existsSync(saved)) privateWrite(saved, fs.readFileSync(envFile));
        if (!fs.existsSync(migrationFile)) {
            if (/^wgs_(?:app|runtime)_/.test(current.DB_USER || '')) throw new Error('Privileged migration credentials must exist before using the runtime account');
            privateWrite(migrationFile, serialize(Object.fromEntries(DB_KEYS.filter(key => current[key] !== undefined).map(key => [key, current[key]]))));
        }
        if (!fs.existsSync(runtimeFile)) privateWrite(runtimeFile, JSON.stringify({ user: 'wgs_app_security_v1',
            password: crypto.randomBytes(36).toString('base64url'), logSecret: crypto.randomBytes(36).toString('base64url') }) + '\n');
        const data = JSON.parse(fs.readFileSync(checkedFile(runtimeFile)));
        if (data.user !== 'wgs_app_security_v1' || !/^[A-Za-z0-9_-]{48}$/.test(data.password || '') || !/^[A-Za-z0-9_-]{48}$/.test(data.logSecret || '')) throw new Error('Invalid protected runtime settings');
        return { prepared: true };
    }

    function rootBridge(database, mysql) {
        return { query: async (sql, parameters = []) => {
            // mysql formats strings before the complete statement goes to stdin;
            // neither SQL containing passwords nor connection secrets are args.
            const result = spawn('sudo', ['-n', 'mysql', '--batch', '--raw', '--default-character-set=utf8mb4', '--database=' + database],
                { input: mysql.format(sql, parameters) + ';\n', encoding: 'utf8', timeout: 45000, windowsHide: true });
            if (result.status !== 0) throw Object.assign(new Error('Local database administration failed'), { code: 'WGS_DB_ADMIN_FAILED' });
            const lines = String(result.stdout || '').trim().split(/\r?\n/);
            if (!lines[0]) return [[], []];
            const columns = lines.shift().split('\t');
            return [lines.map(line => Object.fromEntries(line.split('\t').map((value, index) => [columns[index], value]))), []];
        } };
    }

    async function activate() {
        const environment = { ...readEnv(envFile), ...readEnv(migrationFile) };
        const database = environment.DB_NAME;
        if (!/^[a-zA-Z0-9_]+$/.test(database || '')) throw new Error('Unexpected database name');
        const mysql = dependencies?.mysql || require(path.join(backend, 'node_modules/mysql2'));
        const { createDatabasePool } = dependencies?.database || require(path.join(backend, 'config/database'));
        const { runMigrations } = dependencies?.migrations || require(path.join(backend, 'migrations/run'));
        const { provisionRuntimeAccount } = dependencies?.runtimeAccount || require(path.join(backend, 'migrations/runtimeAccount'));
        const privileged = createDatabasePool(environment, { migration: true });
        let migration;
        try { migration = await runMigrations({ pool: privileged, env: environment, backendDir: backend, importLegacyJson: false }); }
        finally { await privileged.end(); }
        const runtime = JSON.parse(fs.readFileSync(checkedFile(runtimeFile)));
        const account = await provisionRuntimeAccount({ pool: rootBridge(database, mysql), databaseConfig: {
            host: '127.0.0.1', port: Number(environment.DB_PORT || 3306), database, charset: environment.DB_CHARSET || 'utf8mb4' },
            user: runtime.user, password: runtime.password, host: '127.0.0.1' });
        const next = { ...readEnv(envFile), DB_HOST: '127.0.0.1', DB_USER: runtime.user, DB_PASSWORD: runtime.password,
            WGS_SECURITY_LOG_DIR: path.join(path.dirname(app), 'security-logs'), WGS_SECURITY_LOG_SECRET: runtime.logSecret,
            WGS_HSTS_MAX_AGE_SECONDS: '300', WGS_ALLOW_PRIVATE_DEV_ORIGINS: 'false' };
        const text = serialize(next), parsed = dotenv.parse(text);
        if (Object.keys(next).some(key => parsed[key] !== String(next[key]))) throw new Error('Environment roundtrip failed');
        privateWrite(envFile, text);
        return { activated: true, migration, account };
    }

    function restart() {
        const environment = readEnv(envFile);
        const result = spawn('pm2', ['restart', 'wgs-backend', '--update-env'], { env: { ...process.env, ...environment },
            encoding: 'utf8', timeout: 90000, windowsHide: true });
        if (result.status !== 0) throw Object.assign(new Error('Application restart failed'), { code: 'WGS_RESTART_FAILED' });
        return { restarted: true };
    }

    function rollback() {
        if (fs.existsSync(saved)) privateWrite(envFile, fs.readFileSync(checkedFile(saved)));
        return { environmentRestored: true };
    }
    return { prepare, activate, restart, rollback, rootBridge };
}

async function main() {
    const [operation, ...args] = process.argv.slice(2), options = {};
    if (!['prepare', 'activate', 'restart', 'rollback'].includes(operation)) throw new Error('Invalid operation');
    for (let index = 0; index < args.length; index += 2) {
        if (!['--app-root', '--backup-dir'].includes(args[index]) || !args[index + 1]) throw new Error('Invalid arguments');
        options[args[index]] = path.resolve(args[index + 1]);
    }
    if (options['--app-root'] !== APP || !options['--backup-dir']?.startsWith('/home/ubuntu/wgs_deploy/github-releases/') || path.basename(options['--backup-dir']) !== 'before') throw new Error('Invalid deployment path');
    const runtime = createSecurityRuntime({ app: APP, before: options['--backup-dir'] });
    process.stdout.write(JSON.stringify(await runtime[operation]()) + '\n');
}

module.exports = { createSecurityRuntime };
if (require.main === module) main().catch(error => {
    process.stderr.write(JSON.stringify({ success: false, code: /^WGS_[A-Z_]+$/.test(error.code || '') ? error.code : 'WGS_SECURITY_RELEASE_FAILED' }) + '\n');
    process.exitCode = 1;
});
