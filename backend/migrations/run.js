'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { SCHEMA_VERSION } = require('../services/schemaRuntime');
const { migrateLegacyCompatibility } = require('./legacyCompatibility');

function tracedPool(pool, faults) {
    const cache = new WeakMap();
    const wrap = target => {
        if (cache.has(target)) return cache.get(target);
        const proxy = new Proxy(target, { get(object, key) {
            if (key === 'promise') return () => proxy;
            if (key === 'getConnection') return async () => wrap(await object.getConnection());
            const value = object[key];
            if (['query', 'execute'].includes(key)) return async (...args) => {
                try { return await value.apply(object, args); }
                catch (error) {
                    if (!['ER_DUP_KEYNAME', 'ER_DUP_FIELDNAME'].includes(error.code)) faults.push(error.code || 'DATABASE_ERROR');
                    throw error;
                }
            };
            return typeof value === 'function' ? value.bind(object) : value;
        } });
        cache.set(target, proxy); return proxy;
    };
    return wrap(pool);
}

async function runMigrations({ pool: sourcePool, env = process.env, backendDir = path.resolve(__dirname, '..'), importLegacyJson = false } = {}) {
    const faults = [], pool = tracedPool(sourcePool, faults), steps = [];
    const [[{ db_name: database }]] = await pool.query('SELECT DATABASE() AS db_name');
    const lockName = 'wgs:migrate:' + crypto.createHash('sha256').update(String(database)).digest('hex').slice(0, 32);
    const lock = await pool.getConnection();
    let acquired = false;
    try {
        const [[row]] = await lock.query('SELECT GET_LOCK(?,30) AS acquired', [lockName]);
        if (Number(row.acquired) !== 1) throw Object.assign(new Error('Another migration is running.'), { code: 'WGS_MIGRATION_LOCKED' });
        acquired = true;
        await pool.query(`CREATE TABLE IF NOT EXISTS wgs_schema_migrations (
            version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
            applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB`);
        const [existing] = await pool.query('SELECT version FROM wgs_schema_migrations WHERE version=?', [SCHEMA_VERSION]);
        if (existing.length) return { version: SCHEMA_VERSION, skipped: true, steps: [] };
        const step = async (name, action) => {
            await action();
            if (faults.length) throw Object.assign(new Error('Migration step failed: ' + name), { code: faults[0] });
            steps.push(name);
        };
        const unavailable = () => { throw new Error('Authentication and mail are unavailable in migrations.'); };
        await step('legacy_columns_and_missing_defaults', () => migrateLegacyCompatibility(pool));
        if (importLegacyJson) await step('explicit_legacy_json_import', async () => {
            const files = require('../services/jsonFileStores').createJsonFileStores(backendDir);
            await require('../services/jsonSqlImporter').createJsonSqlImporter({ pool, bcrypt: require('bcrypt'), saltRounds: 10,
                userFile: files.USER_FILE, postsFile: files.POSTS_FILE, rankingRandomFile: files.RANKING_RANDOM_FILE, rankingDataFile: files.RANKING_DATA_FILE,
                rankingPastFile: files.RANKING_PAST_FILE, readJSON: files.readJSON, ...require('../services/dateTimeHelpers') }).importDataFromJSON();
        });
        await step('admin_user_control', () => require('../services/adminUserControlSchema').createAdminUserControlSchema({ pool, adminUserId: env.WGS_ADMIN_USER_ID || env.ADMIN_USER_ID || 'skn29' }).ensureAdminUserControlSchema());
        await step('wrong_notes', () => require('../services/wrongNotesSchema').createWrongNotesSchemaChecker({ pool }).ensureWrongNotesSchema());
        await step('study_notes', () => require('../services/studyNoteSchema').createStudyNoteSchemaChecker({ pool }).ensureStudyNoteSchema());
        await step('multiplayer', () => require('../services/multiplayerSchema').ensureMultiplayerSchema(pool));
        await step('legal_documents', () => require('../services/legalConsentService').createLegalConsentService({ pool, env }).ensureSchema());
        await step('admin_sessions', () => require('../services/adminSessionService').createAdminSessionService({ pool, env,
            getAdminUserControl: unavailable, normalizeAdminBool: unavailable, isAdminAccessUser: unavailable, isPrimaryAdminUser: unavailable }).ensureSchema());
        await step('admin_otp', () => require('../services/adminEmailOtpService').createAdminEmailOtpService({ pool, env, sendEmail: unavailable }).ensureSchema());
        await step('member_email', () => require('../services/memberEmailVerificationService').createMemberEmailVerificationService({ pool, env, sendEmail: unavailable }).ensureSchema());
        await step('member_sessions', () => require('../services/memberSessionService').createMemberSessionService({ pool, env }).ensureSchema());
        await step('board_types', () => require('../services/boardPolicyService').createBoardPolicyService({ pool }).ensureSchema());
        await step('learning_attempts', () => require('../services/learningAttemptService').createLearningAttemptService({ pool, env, validateRealtimeSession: unavailable }).ensureSchema());
        await step('visitor_analytics', () => require('../services/visitorAnalyticsSchema').createVisitorAnalyticsSchema({ pool }).ensureVisitorAnalyticsSchema());
        await step('admin_privacy_audit', () => require('../services/adminPrivacyService').createAdminPrivacyService({ pool, env }).ensureSchema());
        let uploadMigration;
        await step('existing_upload_ownership', async () => {
            uploadMigration = await require('../services/uploadAccessService').createUploadAccessService({ pool, backendDir, env }).migrateLegacyFiles();
        });
        await pool.query('INSERT INTO wgs_schema_migrations(version) VALUES(?)', [SCHEMA_VERSION]);
        return { version: SCHEMA_VERSION, skipped: false, steps, uploads: uploadMigration };
    } finally {
        if (acquired) await lock.query('SELECT RELEASE_LOCK(?)', [lockName]);
        lock.release();
    }
}

module.exports = { runMigrations };
