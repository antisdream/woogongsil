'use strict';
// Test-only transactional storage. Disposable MySQL separately checks the actual SQL.
class AdminOtpPool {
    constructor() { this.otpState = null; this.tail = Promise.resolve(); }
    async query(sql) {
        if (sql.startsWith('CREATE TABLE IF NOT EXISTS wgs_admin_email_otp')) return [{ affectedRows: 0 }];
        throw new Error('Unexpected OTP pool SQL');
    }
    async getConnection() {
        const pool = this;
        let state, unlock;
        return {
            async beginTransaction() {
                const previous = pool.tail;
                pool.tail = new Promise(resolve => { unlock = resolve; });
                await previous;
                state = structuredClone(pool.otpState || {});
            },
            async query(sql, params) {
                if (sql.startsWith('INSERT INTO wgs_admin_email_otp')) return [{ affectedRows: 0 }];
                if (sql.startsWith('SELECT state')) return [[{ state: structuredClone(state) }]];
                if (sql.startsWith('UPDATE wgs_admin_email_otp')) { state = JSON.parse(params[0]); return [{ affectedRows: 1 }]; }
                throw new Error('Unexpected OTP transaction SQL');
            },
            async commit() { pool.otpState = structuredClone(state); },
            async rollback() {},
            release() { unlock?.(); },
        };
    }
}
module.exports = { AdminOtpPool };
