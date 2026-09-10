'use strict';

const SCHEMA_VERSION = '20260910_security_v1';
const runtimePools = new WeakSet();
const ready = new WeakMap();
const READ_ONLY_TABLES = new Set(['wgs_schema_migrations', 'wgs_board_type_migrations', 'wgs_member_session_rollout', 'wgs_legal_documents']);

function markRuntimePool(pool) { runtimePools.add(pool); return pool; }

function assertMigratedSchema(pool) {
    if (!ready.has(pool)) {
        const check = (async () => {
            const [rows] = await pool.query('SELECT version FROM wgs_schema_migrations WHERE version = ? LIMIT 1', [SCHEMA_VERSION]);
            if (!rows.length) throw new Error('migration_missing');
        })().catch(() => {
            ready.delete(pool);
            throw Object.assign(new Error('DB migration is required before starting this release.'), { code: 'WGS_SCHEMA_NOT_READY' });
        });
        ready.set(pool, check);
    }
    return ready.get(pool);
}

// Services retain reusable migration definitions. Runtime calls only check the
// migration version; privileged DDL runs through the separate migration CLI.
function runtimeSchemaGate(pool) { return runtimePools.has(pool) ? assertMigratedSchema(pool) : null; }

async function assertRuntimePrivileges(pool, { allowEmpty = false } = {}) {
    const [[{ db_name: database }]] = await pool.query('SELECT DATABASE() AS db_name');
    const [grants] = await pool.query('SHOW GRANTS');
    let tables = 0;
    const reject = () => { throw Object.assign(new Error('The application requires a dedicated database account with table-scoped data privileges.'), { code: 'WGS_DB_PRIVILEGES_TOO_BROAD' }); };
    for (const row of grants) {
        const value = String(Object.values(row)[0] || '');
        const grant = value.match(/^GRANT ([A-Z_, ]+) ON (.+?) TO /);
        if (!grant || /WITH GRANT OPTION/.test(value)) reject();
        const privileges = grant[1].split(',').map(part => part.trim());
        const scope = grant[2].replace(/`/g, '');
        if (scope === '*.*' && privileges.length === 1 && privileges[0] === 'USAGE') continue;
        const [schema, table, extra] = scope.split('.');
        if (schema !== database || extra || !/^[a-zA-Z0-9_]+$/.test(table || '')) reject();
        const allowed = READ_ONLY_TABLES.has(table) ? ['SELECT'] : ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
        if (privileges.some(privilege => !allowed.includes(privilege))) reject();
        tables++;
    }
    if (!tables && !allowEmpty) reject();
    return { tableGrantCount: tables, ddlAllowed: false, crossDatabaseAllowed: false };
}

module.exports = { SCHEMA_VERSION, READ_ONLY_TABLES, markRuntimePool, runtimeSchemaGate, assertMigratedSchema, assertRuntimePrivileges };
