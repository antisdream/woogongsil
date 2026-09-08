'use strict';

// This release stores only target IDs, content hashes and new public wording in Git.
// Original database rows are written to a private 0600 backup before any DML.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const MIGRATION_ID = 'notice-v2.4.0';
const BACKUP_NAME = `${MIGRATION_ID}-before.json`;
const MANIFEST_PATH = path.join(__dirname, 'notice-patch-v2.4.0.json');
const POST_COLUMNS = Object.freeze([
    'id', 'title', 'content', 'authorId', 'authorName', 'date',
    'views', 'likes', 'isNotice', 'noticeOrder', 'contentJson',
]);
const SCOPE_COLUMNS = Object.freeze(POST_COLUMNS.filter(key => !['views', 'likes'].includes(key)));
const DELETED_RELATIONS = Object.freeze(['wgs_comments', 'wgs_post_likes']);

class MigrationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'MigrationError';
        this.code = code;
        this.safeMessage = message;
    }
}

function ensure(condition, code, message) {
    if (!condition) throw new MigrationError(code, message);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function scopedRow(row) {
    ensure(row && typeof row === 'object', 'INVALID_ROW', 'A required notice row is missing.');
    const result = {};
    for (const key of SCOPE_COLUMNS) {
        ensure(Object.hasOwn(row, key), 'INVALID_ROW', 'A notice row is missing a required field.');
        const value = row[key];
        if (key === 'isNotice') {
            ensure([0, 1, '0', '1', false, true].includes(value), 'INVALID_ROW', 'A notice flag is invalid.');
            result[key] = [1, '1', true].includes(value) ? 1 : 0;
        } else if (key === 'noticeOrder') {
            ensure(value === null || (Number.isSafeInteger(Number(value)) && String(value).trim() !== ''), 'INVALID_ROW', 'A notice order is invalid.');
            result[key] = value === null ? null : Number(value);
        } else {
            ensure(value === null || typeof value === 'string', 'INVALID_ROW', 'A notice text field has an unexpected type.');
            result[key] = value;
        }
    }
    ensure(typeof result.id === 'string' && /^\d{13}$/.test(result.id), 'INVALID_ROW', 'A notice ID is invalid.');
    return result;
}

function scopeHash(row) {
    return sha256(stableJson(scopedRow(row)));
}

function validateManifest(manifest) {
    ensure(manifest?.schemaVersion === 1 && manifest.migrationId === MIGRATION_ID, 'INVALID_MANIFEST', 'The notice manifest has an unsupported identity.');
    ensure(Array.isArray(manifest.operations) && manifest.operations.length === 7, 'INVALID_MANIFEST', 'The notice manifest must contain the seven reviewed targets.');
    const counts = { remove: 0, rename: 0, append: 0 };
    const ids = new Set();
    for (const op of manifest.operations) {
        ensure(op && /^\d{13}$/.test(op.id) && !ids.has(op.id), 'INVALID_MANIFEST', 'The notice manifest contains an invalid or duplicate ID.');
        ids.add(op.id);
        ensure(Object.hasOwn(counts, op.kind), 'INVALID_MANIFEST', 'The notice manifest contains an unsupported operation.');
        counts[op.kind] += 1;
        ensure(/^[a-f0-9]{64}$/.test(op.beforeSha256), 'INVALID_MANIFEST', 'A notice precondition hash is invalid.');
        if (op.kind !== 'remove') {
            ensure(/^[a-f0-9]{64}$/.test(op.afterSha256) && op.afterSha256 !== op.beforeSha256, 'INVALID_MANIFEST', 'A notice result hash is invalid.');
        }
        if (op.kind === 'rename') {
            ensure(typeof op.title === 'string' && op.title.startsWith('[업데이트] v2.4.0 ') && op.title.length <= 255, 'INVALID_MANIFEST', 'A release notice title is invalid.');
        }
        if (op.kind === 'append') {
            ensure(typeof op.paragraph === 'string' && op.paragraph.length > 0 && op.paragraph.length <= 250, 'INVALID_MANIFEST', 'A notice status paragraph is invalid.');
            ensure(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(op.blockId), 'INVALID_MANIFEST', 'A notice block ID is invalid.');
        }
    }
    ensure(counts.remove === 2 && counts.rename === 2 && counts.append === 3, 'INVALID_MANIFEST', 'The notice operation counts differ from the reviewed release.');
    return manifest;
}

function buildPatchedRow(row, operation) {
    const next = { ...row };
    if (operation.kind === 'rename') {
        next.title = operation.title;
    } else if (operation.kind === 'append') {
        ensure(typeof row.content === 'string', 'INVALID_CONTENT', 'The historical notice body is missing.');
        const marker = row.content.match(/(?:\r?\n)?\[\[UGONGSIL_BOARD:NOTICE\]\]\s*$/);
        const body = marker ? row.content.slice(0, marker.index) : row.content;
        next.content = `${body}\n\n${operation.paragraph}${marker ? marker[0] : ''}`;
        if (row.contentJson !== null) {
            let blocks;
            try { blocks = JSON.parse(row.contentJson); } catch { throw new MigrationError('INVALID_CONTENT', 'The historical block document is invalid.'); }
            ensure(Array.isArray(blocks) && blocks.length > 0 && blocks.every(block => block && typeof block === 'object' && !Array.isArray(block)), 'INVALID_CONTENT', 'The historical block document is unsupported.');
            ensure(!blocks.some(block => block.id === operation.blockId), 'INVALID_CONTENT', 'The status paragraph is already present in an unexpected state.');
            next.contentJson = JSON.stringify([...blocks, {
                id: operation.blockId,
                type: 'paragraph',
                props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
                content: [{ type: 'text', text: operation.paragraph, styles: {} }],
                children: [],
            }]);
        }
    } else {
        throw new MigrationError('INVALID_OPERATION', 'A removal cannot be converted into a content update.');
    }
    return next;
}

function classifyState(rows, manifest) {
    const targetIds = new Set(manifest.operations.map(op => op.id));
    const byId = new Map();
    for (const row of rows) {
        ensure(targetIds.has(row.id) && !byId.has(row.id), 'INVALID_ROWS', 'The locked notice rows do not match the target set.');
        byId.set(row.id, row);
    }
    const before = manifest.operations.every(op => byId.has(op.id) && scopeHash(byId.get(op.id)) === op.beforeSha256);
    const after = manifest.operations.every(op => op.kind === 'remove'
        ? !byId.has(op.id)
        : byId.has(op.id) && scopeHash(byId.get(op.id)) === op.afterSha256);
    ensure(before || after, 'NOTICE_STATE_CHANGED', 'Notice content or ownership differs from the reviewed before/after state. No partial migration is permitted.');
    return before ? 'before' : 'after';
}

function requireNoDeletionRelations(rows, relationships, removeIds) {
    ensure(Array.isArray(relationships.comments) && Array.isArray(relationships.likes), 'INVALID_RELATIONS', 'Deletion relationship checks are incomplete.');
    ensure(relationships.comments.length === 0 && relationships.likes.length === 0, 'NOTICE_HAS_INTERACTIONS', 'A notice selected for removal now has comments or likes.');
    for (const row of rows.filter(item => removeIds.includes(item.id))) {
        ensure(row.likes !== null && Number(row.likes) === 0, 'NOTICE_HAS_INTERACTIONS', 'A notice selected for removal has a nonzero cached like count.');
    }
}

function mutableFields(row, operation) {
    return operation.kind === 'rename'
        ? { title: row.title }
        : { content: row.content, contentJson: row.contentJson };
}

function manifestHash(manifest) {
    return sha256(stableJson(manifest));
}

function validateBackup(backup, manifest, databaseFingerprint) {
    ensure(backup?.schemaVersion === 1 && backup.migrationId === MIGRATION_ID, 'INVALID_BACKUP', 'The private notice backup has an unsupported identity.');
    const { payloadSha256, ...payload } = backup;
    ensure(payloadSha256 === sha256(stableJson(payload)), 'INVALID_BACKUP', 'The private notice backup checksum does not match.');
    ensure(backup.manifestSha256 === manifestHash(manifest) && backup.databaseFingerprint === databaseFingerprint, 'BACKUP_SCOPE_MISMATCH', 'The private backup belongs to a different manifest or database.');
    ensure(['before', 'after'].includes(backup.stateBefore) && Array.isArray(backup.rows), 'INVALID_BACKUP', 'The private backup state is invalid.');
    for (const row of backup.rows) {
        ensure(Object.keys(row).sort().join('|') === [...POST_COLUMNS].sort().join('|'), 'INVALID_BACKUP', 'The private backup row schema has changed.');
        ensure(Object.values(row).every(value => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))), 'INVALID_BACKUP', 'The private backup contains an unsupported database value.');
    }
    ensure(classifyState(backup.rows, manifest) === backup.stateBefore, 'INVALID_BACKUP', 'The private backup rows do not match the reviewed state.');
    return backup;
}

function makeBackup(rows, stateBefore, manifest, databaseFingerprint) {
    const payload = {
        schemaVersion: 1,
        migrationId: MIGRATION_ID,
        manifestSha256: manifestHash(manifest),
        databaseFingerprint,
        createdAt: new Date().toISOString(),
        stateBefore,
        rows: rows.map(row => Object.fromEntries(POST_COLUMNS.map(key => [key, row[key]]))),
    };
    return { ...payload, payloadSha256: sha256(stableJson(payload)) };
}

function createPrivateBackupStore(directory) {
    ensure(path.isAbsolute(directory), 'INVALID_BACKUP_DIR', 'The private backup directory must be absolute.');
    const resolved = path.resolve(directory);
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
    ensure(fs.lstatSync(resolved).isDirectory() && !fs.lstatSync(resolved).isSymbolicLink(), 'INVALID_BACKUP_DIR', 'The private backup directory must be a regular directory.');
    const file = path.join(resolved, BACKUP_NAME);
    function read() {
        if (!fs.existsSync(file)) return null;
        const stat = fs.lstatSync(file);
        ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size < 2 * 1024 * 1024, 'INVALID_BACKUP', 'The private notice backup is not a supported regular file.');
        ensure(process.platform === 'win32' || (stat.mode & 0o077) === 0, 'BACKUP_PERMISSIONS', 'The private notice backup must not be readable by other users.');
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new MigrationError('INVALID_BACKUP', 'The private notice backup cannot be parsed.'); }
    }
    function write(backup) {
        ensure(!fs.existsSync(file), 'BACKUP_EXISTS', 'The private notice backup already exists and will not be overwritten.');
        const temporary = path.join(resolved, `.${BACKUP_NAME}.${crypto.randomUUID()}.tmp`);
        let fd;
        try {
            fd = fs.openSync(temporary, 'wx', 0o600);
            fs.fchmodSync(fd, 0o600);
            fs.writeFileSync(fd, `${JSON.stringify(backup)}\n`, 'utf8');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = undefined;
            // link is atomic and refuses to replace an existing backup.
            fs.linkSync(temporary, file);
            if (process.platform !== 'win32') {
                const directoryFd = fs.openSync(resolved, 'r');
                try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
            }
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        return read();
    }
    return {
        directory: fs.realpathSync(resolved),
        read,
        write,
        summary() { return { backupFile: BACKUP_NAME, backupSha256: sha256(fs.readFileSync(file)) }; },
    };
}

async function runMigration({ direction, repository, backupStore, manifest }) {
    validateManifest(manifest);
    ensure(['apply', 'rollback'].includes(direction), 'INVALID_COMMAND', 'Choose apply or rollback.');
    const ids = manifest.operations.map(op => op.id).sort();
    const removeIds = manifest.operations.filter(op => op.kind === 'remove').map(op => op.id).sort();
    let transactionOpen = false;
    let commitAttempted = false;
    let locked = false;
    try {
        await repository.acquireLock();
        locked = true;
        await repository.begin();
        transactionOpen = true;
        const rows = await repository.readRows(ids);
        const databaseFingerprint = await repository.inspectSchema();
        const state = classifyState(rows, manifest);
        let backup = backupStore.read();
        if (backup) validateBackup(backup, manifest, databaseFingerprint);
        let status;
        let updated = 0;
        let removed = 0;
        let restored = 0;
        if (direction === 'apply') {
            if (state === 'before') {
                await repository.readDeletionRelations(removeIds).then(relations => requireNoDeletionRelations(rows, relations, removeIds));
                const nextRows = rows.filter(row => !removeIds.includes(row.id)).map(row => {
                    const op = manifest.operations.find(item => item.id === row.id);
                    const next = buildPatchedRow(row, op);
                    ensure(scopeHash(next) === op.afterSha256, 'PATCH_HASH_MISMATCH', 'The generated notice update does not match the reviewed result.');
                    return next;
                });
                if (backup) {
                    const fullCurrentRows = rows.map(row => Object.fromEntries(POST_COLUMNS.map(key => [key, row[key]])));
                    ensure(backup.stateBefore === 'before' && stableJson(backup.rows) === stableJson(fullCurrentRows), 'BACKUP_STALE', 'Existing private backup rows differ from the current rows. Use a fresh backup directory.');
                } else {
                    backup = backupStore.write(makeBackup(rows, 'before', manifest, databaseFingerprint));
                    validateBackup(backup, manifest, databaseFingerprint);
                }
                for (const row of nextRows) {
                    const op = manifest.operations.find(item => item.id === row.id);
                    await repository.updateRow(row.id, mutableFields(row, op));
                    updated += 1;
                }
                for (const id of removeIds) {
                    await repository.deleteRow(id);
                    removed += 1;
                }
                ensure(classifyState(await repository.readRows(ids), manifest) === 'after', 'POSTCONDITION_FAILED', 'The notice migration result does not match the reviewed state.');
                status = 'applied';
            } else {
                if (!backup) backup = backupStore.write(makeBackup(rows, 'after', manifest, databaseFingerprint));
                validateBackup(backup, manifest, databaseFingerprint);
                status = 'already_applied';
            }
        } else {
            ensure(backup, 'BACKUP_REQUIRED', 'Rollback requires the private backup created by apply.');
            if (backup.stateBefore === 'after') {
                ensure(state === 'after', 'NOTICE_STATE_CHANGED', 'The notice state changed after a no-op apply.');
                status = 'not_changed_by_this_backup';
            } else if (state === 'before') {
                status = 'already_rolled_back';
            } else {
                await repository.readDeletionRelations(removeIds).then(relations => requireNoDeletionRelations([], relations, removeIds));
                for (const op of manifest.operations) {
                    const original = backup.rows.find(row => row.id === op.id);
                    if (op.kind === 'remove') {
                        await repository.insertRow(original);
                        restored += 1;
                    } else {
                        // Keep current views, likes and every unrelated column.
                        await repository.updateRow(op.id, mutableFields(original, op));
                        updated += 1;
                    }
                }
                ensure(classifyState(await repository.readRows(ids), manifest) === 'before', 'POSTCONDITION_FAILED', 'The notice rollback result does not match the original scoped content.');
                status = 'rolled_back';
            }
        }
        commitAttempted = true;
        await repository.commit();
        transactionOpen = false;
        return { status, migrationId: MIGRATION_ID, updated, removed, restored, ...backupStore.summary() };
    } catch (error) {
        if (transactionOpen) {
            try { await repository.rollback(); } catch { /* The next guarded run resolves uncertain connection state. */ }
        }
        if (commitAttempted) throw new MigrationError('COMMIT_OUTCOME_UNKNOWN', 'The commit outcome is uncertain. Use the private backup with a guarded rollback before retrying deployment.');
        throw error;
    } finally {
        if (locked) {
            try { await repository.releaseLock(); } catch { /* Connection close also releases this advisory lock. */ }
        }
    }
}

class SqlNoticeRepository {
    constructor(connection) { this.connection = connection; }
    async acquireLock() {
        const [rows] = await this.connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [`wgs:${MIGRATION_ID}`]);
        ensure(Number(rows[0]?.acquired) === 1, 'MIGRATION_BUSY', 'Another notice migration holds the release lock.');
    }
    async releaseLock() { await this.connection.execute('SELECT RELEASE_LOCK(?)', [`wgs:${MIGRATION_ID}`]); }
    async begin() {
        await this.connection.query('SET SESSION innodb_lock_wait_timeout = 15');
        await this.connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        await this.connection.beginTransaction();
    }
    async commit() { await this.connection.commit(); }
    async rollback() { await this.connection.rollback(); }
    async readRows(ids) {
        const [rows] = await this.connection.execute(`SELECT * FROM wgs_posts WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, ids);
        for (const row of rows) ensure(Object.keys(row).sort().join('|') === [...POST_COLUMNS].sort().join('|'), 'SCHEMA_CHANGED', 'The notice row schema differs from the reviewed release.');
        return rows.map(row => ({ ...row }));
    }
    async inspectSchema() {
        const [tables] = await this.connection.execute("SELECT TABLE_NAME AS tableName, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('wgs_posts','wgs_comments','wgs_post_likes')");
        ensure(tables.length === 3 && tables.every(table => table.engine === 'InnoDB'), 'UNSAFE_TABLE_ENGINE', 'Notice tables must support atomic InnoDB transactions.');
        const [triggers] = await this.connection.execute("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'wgs_posts'");
        ensure(triggers.length === 0, 'UNEXPECTED_TRIGGER', 'The notice table has a trigger outside this scoped migration.');
        const [references] = await this.connection.execute("SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'wgs_posts'");
        ensure(references.every(reference => DELETED_RELATIONS.includes(reference.tableName) && reference.columnName === 'postId' && reference.referencedColumn === 'id'), 'UNEXPECTED_RELATION', 'An unreviewed foreign key references the notice table.');
        const [identity] = await this.connection.query('SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid');
        ensure(identity[0]?.databaseName && identity[0]?.serverUuid, 'DATABASE_IDENTITY_MISSING', 'The database identity could not be verified.');
        return sha256(stableJson(identity[0]));
    }
    async readDeletionRelations(ids) {
        const placeholders = ids.map(() => '?').join(',');
        const [comments] = await this.connection.execute(`SELECT postId FROM wgs_comments WHERE postId IN (${placeholders}) FOR UPDATE`, ids);
        const [likes] = await this.connection.execute(`SELECT postId FROM wgs_post_likes WHERE postId IN (${placeholders}) FOR UPDATE`, ids);
        return { comments, likes };
    }
    async updateRow(id, fields) {
        const keys = Object.keys(fields);
        ensure(keys.length > 0 && keys.every(key => ['title', 'content', 'contentJson'].includes(key)), 'INVALID_UPDATE', 'The migration attempted to update an unrelated column.');
        const [result] = await this.connection.execute(`UPDATE wgs_posts SET ${keys.map(key => `\`${key}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map(key => fields[key]), id]);
        ensure(result.affectedRows === 1, 'WRITE_COUNT_MISMATCH', 'A scoped notice update did not affect exactly one row.');
    }
    async deleteRow(id) {
        const [result] = await this.connection.execute('DELETE FROM wgs_posts WHERE id = ?', [id]);
        ensure(result.affectedRows === 1, 'WRITE_COUNT_MISMATCH', 'A scoped notice removal did not affect exactly one row.');
    }
    async insertRow(row) {
        const [result] = await this.connection.execute(`INSERT INTO wgs_posts (${POST_COLUMNS.map(key => `\`${key}\``).join(',')}) VALUES (${POST_COLUMNS.map(() => '?').join(',')})`, POST_COLUMNS.map(key => row[key]));
        ensure(result.affectedRows === 1, 'WRITE_COUNT_MISMATCH', 'A scoped notice restoration did not affect exactly one row.');
    }
}

function parseArguments(argv) {
    if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { command: 'help' };
    if (argv.length === 1 && argv[0] === 'verify') return { command: 'verify' };
    ensure(['apply', 'rollback'].includes(argv[0]), 'INVALID_ARGUMENTS', 'Usage: migrate-notices.cjs apply|rollback --app-root ABSOLUTE_PATH --backup-dir ABSOLUTE_PATH');
    const result = { command: argv[0] };
    for (let i = 1; i < argv.length; i += 2) {
        ensure(['--app-root', '--backup-dir'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_ARGUMENTS', 'The migration arguments are incomplete or unsupported.');
        const key = argv[i] === '--app-root' ? 'appRoot' : 'backupDir';
        ensure(!Object.hasOwn(result, key) && path.isAbsolute(argv[i + 1]), 'INVALID_ARGUMENTS', 'Migration paths must be absolute and specified once.');
        result[key] = path.resolve(argv[i + 1]);
    }
    ensure(result.appRoot && result.backupDir, 'INVALID_ARGUMENTS', 'Both app-root and backup-dir are required.');
    return result;
}

function readDatabaseEnvironment(appRoot, inherited = process.env) {
    const env = { ...inherited };
    const envFile = path.join(appRoot, 'backend', '.env');
    if (fs.existsSync(envFile)) {
        for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const index = line.indexOf('=');
            if (index < 1) continue;
            const key = line.slice(0, index).trim();
            let value = line.slice(index + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
            if (!env[key]) env[key] = value;
        }
    }
    const port = Number(env.DB_PORT || 3306);
    ensure(env.DB_USER && env.DB_NAME && Number.isInteger(port) && port > 0 && port <= 65535, 'DATABASE_CONFIG_MISSING', 'Explicit database user and name, and a valid port, are required.');
    return {
        host: env.DB_HOST || '127.0.0.1', port, user: env.DB_USER,
        password: env.DB_PASSWORD || '', database: env.DB_NAME,
        charset: env.DB_CHARSET || 'utf8mb4',
        dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
        multipleStatements: false, connectTimeout: 10000,
    };
}

function safeFailure(error) {
    return error instanceof MigrationError
        ? { status: 'failed', code: error.code, message: error.safeMessage }
        : { status: 'failed', code: 'MIGRATION_FAILED', message: 'The notice migration failed. No SQL, credentials or private row data is printed.' };
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArguments(argv);
    if (args.command === 'help') {
        return { status: 'help', usage: 'node migrate-notices.cjs apply|rollback --app-root ABSOLUTE_PATH --backup-dir ABSOLUTE_PRIVATE_PATH', offlineValidation: 'node migrate-notices.cjs verify' };
    }
    const manifest = validateManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')));
    if (args.command === 'verify') return { status: 'manifest_valid', migrationId: MIGRATION_ID, targets: 7, manifestSha256: manifestHash(manifest) };
    const appRoot = fs.realpathSync(args.appRoot);
    const relativeBackup = path.relative(appRoot, args.backupDir);
    ensure(relativeBackup.startsWith(`..${path.sep}`) || relativeBackup === '..' || path.isAbsolute(relativeBackup), 'INVALID_BACKUP_DIR', 'Store private notice backups outside the application directory.');
    const databaseOptions = readDatabaseEnvironment(appRoot);
    const requireBackend = createRequire(path.join(appRoot, 'backend', 'package.json'));
    const mysql = requireBackend('mysql2/promise');
    const backupStore = createPrivateBackupStore(args.backupDir);
    // An ancestor symlink must not redirect the private backup into the app.
    const canonicalRelativeBackup = path.relative(appRoot, backupStore.directory);
    ensure(canonicalRelativeBackup.startsWith(`..${path.sep}`) || canonicalRelativeBackup === '..' || path.isAbsolute(canonicalRelativeBackup), 'INVALID_BACKUP_DIR', 'The resolved private backup directory must be outside the application directory.');
    const connection = await mysql.createConnection(databaseOptions);
    try {
        return await runMigration({ direction: args.command, repository: new SqlNoticeRepository(connection), backupStore, manifest });
    } finally {
        try { await connection.end(); } catch { /* Do not print driver details during cleanup. */ }
    }
}

module.exports = {
    MIGRATION_ID, BACKUP_NAME, POST_COLUMNS, MigrationError,
    sha256, stableJson, scopeHash, validateManifest, buildPatchedRow,
    classifyState, requireNoDeletionRelations, manifestHash, validateBackup,
    makeBackup, createPrivateBackupStore, runMigration, SqlNoticeRepository,
    parseArguments, readDatabaseEnvironment, safeFailure, main,
};

if (require.main === module) {
    main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
        process.stdout.write(`${JSON.stringify(safeFailure(error))}\n`);
        process.exitCode = 1;
    });
}
