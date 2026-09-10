'use strict';
const mysql = require('mysql2/promise');
const { READ_ONLY_TABLES, assertRuntimePrivileges } = require('../services/schemaRuntime');

async function provisionRuntimeAccount({ pool, databaseConfig, user, password, host = '127.0.0.1' }) {
    if (!/^wgs_(?:app|runtime)_[a-z0-9_]{1,20}$/.test(user || '') || String(user).length > 32) throw new Error('A dedicated wgs_app_ or wgs_runtime_ account name is required.');
    if (typeof password !== 'string' || password.length < 32 || !['127.0.0.1', 'localhost'].includes(host)) throw new Error('A strong password and loopback account host are required.');
    const [[{ db_name: database }]] = await pool.query('SELECT DATABASE() AS db_name');
    if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Unexpected database identifier.');
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM mysql.user WHERE User=? AND Host=?', [user, host]);
    const runtime = mysql.createPool({ ...databaseConfig, database, user, password, connectionLimit: 1 });
    try {
        // Existing credentials must work and their scope must already be narrow.
        // This never revokes or changes another account's grants/password.
        if (Number(count)) await assertRuntimePrivileges(runtime, { allowEmpty: true });
        else await pool.query('CREATE USER ?@? IDENTIFIED BY ? WITH MAX_USER_CONNECTIONS 24', [user, host, password]);
        const [tables] = await pool.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [database]);
        for (const { name } of tables) {
            if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Unexpected table identifier.');
            const privileges = READ_ONLY_TABLES.has(name) ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE';
            await pool.query(`GRANT ${privileges} ON \`${database}\`.\`${name}\` TO ?@?`, [user, host]);
        }
        return { created: !Number(count), ...(await assertRuntimePrivileges(runtime)) };
    } finally { await runtime.end(); }
}

module.exports = { provisionRuntimeAccount };
