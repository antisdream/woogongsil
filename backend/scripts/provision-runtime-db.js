'use strict';
const path = require('node:path');
const { loadEnvFile } = require('../config/env');
const { createDatabasePool } = require('../config/database');
const { provisionRuntimeAccount } = require('../migrations/runtimeAccount');

async function main() {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--env')) throw new Error('Use --env with a protected migration environment file.');
    loadEnvFile(args.length ? path.resolve(args[1]) : path.resolve(__dirname, '../.env'));
    const pool = createDatabasePool(process.env, { migration: true });
    try {
        const result = await provisionRuntimeAccount({ pool, databaseConfig: { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306) },
            user: process.env.WGS_RUNTIME_DB_USER, password: process.env.WGS_RUNTIME_DB_PASSWORD, host: process.env.WGS_RUNTIME_DB_HOST || '127.0.0.1' });
        console.log(JSON.stringify({ success: true, ...result }));
    } finally { await pool.end(); }
}
main().catch(error => { console.error(JSON.stringify({ success: false, code: error.code || 'WGS_RUNTIME_ACCOUNT_FAILED', message: 'Runtime account provisioning failed. Existing credentials were not replaced.' })); process.exitCode = 1; });
