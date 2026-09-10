'use strict';

// Runtime diagnostics never serialize exception messages, SQL, mail responses,
// user content or arbitrary objects. Source identifiers are constants in code.
function safeErrorCode(value) {
    const code = value && typeof value === 'object' ? value.code : value;
    return typeof code === 'string' && /^(?:ER_[A-Z_]{2,60}|EACCES|EPERM|ENOENT|ENOSPC|EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|WGS_[A-Z_]{2,60})$/.test(code) ? code : undefined;
}

function createRuntimeLogger({ now = Date.now, write = line => process.stderr.write(line), perMinute = 120 } = {}) {
    let minute = -1, used = 0, dropped = 0;
    return function runtimeLog(level, source, ...values) {
        const current = Math.floor(now() / 60000);
        if (current !== minute) {
            minute = current; used = 0;
            if (dropped) {
                write(JSON.stringify({ time: new Date(now()).toISOString(), event: 'runtime.log_limited', dropped }) + '\n');
                dropped = 0;
            }
        }
        if (++used > perMinute) { dropped++; return; }
        const safeSource = /^[a-zA-Z0-9_./:-]{1,140}$/.test(source) ? source : 'runtime';
        const code = values.map(safeErrorCode).find(Boolean);
        write(JSON.stringify({ time: new Date(now()).toISOString(), event: 'runtime',
            level: ['info', 'warn', 'error'].includes(level) ? level : 'info', source: safeSource, ...(code ? { code } : {}) }) + '\n');
    };
}

const runtimeLog = createRuntimeLogger();
module.exports = { runtimeLog, createRuntimeLogger, safeErrorCode };
