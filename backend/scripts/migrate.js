'use strict';
const path = require('node:path');
const { loadEnvFile } = require('../config/env');
const { createDatabasePool } = require('../config/database');
const { runMigrations } = require('../migrations/run');

async function main() {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index++) {
        const key = args[index];
        if (key === '--import-legacy-json') { options.importLegacyJson = true; continue; }
        if (!['--env', '--data-dir'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--') || options[key]) throw new Error('Unknown or incomplete migration argument.');
        options[key] = path.resolve(args[++index]);
    }
    loadEnvFile(options['--env'] || path.resolve(__dirname, '../.env'));
    const pool = createDatabasePool(process.env, { migration: true });
    try { console.log(JSON.stringify(await runMigrations({ pool, importLegacyJson: Boolean(options.importLegacyJson), ...(options['--data-dir'] ? { backendDir: options['--data-dir'] } : {}) }))); }
    finally { await pool.end(); }
}

main().catch(error => { console.error(JSON.stringify({ success: false, code: error.code || 'WGS_MIGRATION_FAILED', message: 'Migration failed; this release must not start. Check the protected migration log.' })); process.exitCode = 1; });
