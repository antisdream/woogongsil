'use strict';

// Transactional test storage; disposable MySQL separately verifies SQL and InnoDB concurrency.
class MemberVerificationPool {
    constructor(users = []) { this.states = {}; this.users = structuredClone(users); this.tail = Promise.resolve(); this.writes = 0; }
    async query(sql) {
        if (/^CREATE TABLE|^DELETE FROM wgs_member_email_verifications/.test(sql)) return [{ affectedRows: 0 }];
        throw new Error('Unexpected verification pool SQL');
    }
    async getConnection() {
        const pool = this;
        let states, users, unlock;
        return {
            async beginTransaction() {
                const previous = pool.tail;
                pool.tail = new Promise(resolve => { unlock = resolve; });
                await previous;
                states = structuredClone(pool.states);
                users = structuredClone(pool.users);
            },
            async query(sql, params) {
                if (sql.startsWith('INSERT INTO wgs_member_email_verifications')) { states[params[0]] ||= {}; return [{ affectedRows: 0 }]; }
                if (sql.startsWith('SELECT state FROM wgs_member_email_verifications')) return [states[params[0]] ? [{ state: states[params[0]] }] : []];
                if (sql.startsWith('UPDATE wgs_member_email_verifications')) { states[params[1]] = JSON.parse(params[0]); return [{ affectedRows: 1 }]; }
                if (sql.startsWith('SELECT id, name, email, password, sessionToken FROM wgs_users')) return [users.filter(user => user.id === params[0])];
                if (sql.startsWith('UPDATE wgs_users SET password')) {
                    Object.assign(users.find(user => user.id === params[1]), { password: params[0], sessionToken: null });
                    return [{ affectedRows: 1 }];
                }
                throw new Error('Unexpected verification transaction SQL');
            },
            async commit() { pool.states = states; pool.users = users; pool.writes++; },
            async rollback() {},
            release() { unlock?.(); },
        };
    }
}
module.exports = { MemberVerificationPool };
