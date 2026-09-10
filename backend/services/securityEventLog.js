'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runtimeLog } = require('./runtimeLog');

const EVENTS = new Set(['member.login', 'member.logout', 'member.session', 'member.verification', 'member.password',
    'member.signup', 'admin.login', 'admin.otp', 'admin.logout', 'admin.change', 'attachment.access', 'learning.submit',
    'request.denied', 'request.error', 'session.revoked', 'log.limited']);
const OUTCOMES = new Set(['success', 'pending', 'rejected', 'error']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const FILE = /^events-(\d{4}-\d{2}-\d{2})-(\d{6})\.jsonl$/;

function createSecurityEventLog({ directory = process.env.WGS_SECURITY_LOG_DIR || path.join(__dirname, '..', 'logs', 'security'),
    secret = process.env.WGS_SECURITY_LOG_SECRET || crypto.randomBytes(32), now = Date.now,
    maxBytes = 2 * 1024 * 1024, maxFiles = 5, maxDays = 14, perMinute = 180, maxQueue = 256 } = {}) {
    let chain = Promise.resolve(), queued = 0, active, minute = -1, used = 0, dropped = 0, healthy = true, initialized;
    const hmac = (kind, value) => value ? crypto.createHmac('sha256', secret).update(kind + ':' + String(value).slice(0, 300)).digest('hex') : undefined;

    function ready() {
        if (!initialized) initialized = (async () => {
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            const stat = await fs.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid security log directory');
            await fs.chmod(directory, 0o700);
            await fs.access(directory, require('node:fs').constants.W_OK);
        })();
        return initialized;
    }

    async function append(row) {
        await ready();
        const day = new Date(now()).toISOString().slice(0, 10), line = JSON.stringify(row) + '\n';
        const names = (await fs.readdir(directory)).filter(name => FILE.test(name)).sort();
        for (const name of [...names]) {
            const fileDay = FILE.exec(name)[1];
            if (Date.parse(fileDay + 'T00:00:00Z') < now() - maxDays * 86400000) {
                await fs.unlink(path.join(directory, name)); names.splice(names.indexOf(name), 1);
            }
        }
        if (!active?.startsWith('events-' + day + '-')) active = names.filter(name => name.startsWith('events-' + day + '-')).at(-1);
        let size = 0;
        if (active) {
            try {
                const stat = await fs.lstat(path.join(directory, active));
                if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid security log file');
                size = stat.size;
            } catch (error) { if (error.code !== 'ENOENT') throw error; active = undefined; }
        }
        if (!active || size + Buffer.byteLength(line) > maxBytes) {
            const today = names.filter(name => name.startsWith('events-' + day + '-'));
            const index = today.length ? Number(FILE.exec(today.at(-1))[2]) + 1 : 0;
            if (index > 999999) throw new Error('Security log file count exceeded');
            active = 'events-' + day + '-' + String(index).padStart(6, '0') + '.jsonl';
            if (!names.includes(active)) names.push(active);
        }
        while (names.length > maxFiles) await fs.unlink(path.join(directory, names.shift()));
        await fs.appendFile(path.join(directory, active), line, { encoding: 'utf8', mode: 0o600 });
        await fs.chmod(path.join(directory, active), 0o600);
        healthy = true;
    }

    function enqueue(row) {
        queued++;
        chain = chain.then(() => append(row)).catch(error => {
            healthy = false;
            runtimeLog('error', 'securityEventLog.write', error);
        }).finally(() => { queued--; });
    }

    function record(entry = {}) {
        if (!EVENTS.has(entry.event) || !OUTCOMES.has(entry.outcome)) return false;
        const current = Math.floor(now() / 60000);
        if (current !== minute) { minute = current; used = 0; }
        if (queued >= maxQueue || used >= perMinute) { dropped++; return false; }
        used++;
        if (dropped && queued < maxQueue - 1) {
            enqueue({ time: new Date(now()).toISOString(), event: 'log.limited', outcome: 'pending', count: dropped });
            dropped = 0;
        }
        const status = Number(entry.status);
        enqueue({ time: new Date(now()).toISOString(), event: entry.event, outcome: entry.outcome,
            ...(METHODS.has(entry.method) ? { method: entry.method } : {}),
            ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
            ...(entry.actorId ? { actorHash: hmac('actor', entry.actorId) } : {}),
            ...(entry.ip ? { ipHash: hmac('ip', entry.ip) } : {}) });
        return true;
    }

    function middleware(req, res, next) {
        const target = req.path, write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        let event, applicationOutcome;
        if (target === '/api/login') event = 'member.login';
        else if (target === '/api/logout') event = 'member.logout';
        else if (target === '/api/signup') event = 'member.signup';
        else if (/^\/api\/(find-pw\/reset|user\/change-pw|reset-pw)/.test(target)) event = 'member.password';
        else if (/^\/api\/(auth\/(send-code|verify-code)|send-code|verify-code|send-verification|member-verification|find-id)/.test(target)) event = 'member.verification';
        else if (target.startsWith('/api/member/session') && write) event = 'member.session';
        else if (target === '/api/admin/auth/login') event = 'admin.login';
        else if (target.startsWith('/api/admin/auth/otp/')) event = 'admin.otp';
        else if (target.startsWith('/api/admin/auth/logout')) event = 'admin.logout';
        else if (target.startsWith('/api/admin/') && write) event = 'admin.change';
        else if (target.startsWith('/uploads/')) event = 'attachment.access';
        else if (target.startsWith('/api/learning-attempts/') && write) event = 'learning.submit';
        const json = res.json;
        res.json = function (body) {
            if (event && body && typeof body === 'object') {
                if (body.requiresOtp || (event === 'admin.login' && this.statusCode === 202)) applicationOutcome = 'pending';
                else if (body.success === false || body.valid === false) applicationOutcome = 'rejected';
                if (body.success === true && ['member.login', 'admin.otp'].includes(event)) {
                    req.wgsSecurityActorId = body.user?.id || (body.valid === true ? body.admin?.id : undefined);
                }
            }
            return json.call(this, body);
        };
        res.once('finish', () => {
            const status = res.statusCode;
            const denied = [401, 403, 413, 415, 429].includes(status);
            if (!event && status < 500 && !denied) return;
            if (event === 'attachment.access' && !denied && status < 400) return; // Avoid playback chunk logs.
            record({ event: status >= 500 ? 'request.error' : (event || 'request.denied'),
                outcome: status >= 500 ? 'error' : status >= 400 ? 'rejected' : applicationOutcome || 'success',
                method: req.method, status, ip: req.ip || req.socket?.remoteAddress,
                actorId: req.adminAuth?.user?.id || req.wgsMemberAuth?.user?.id || req.wgsSecurityActorId });
        });
        next();
    }

    return { ready, record, middleware, flush: () => chain, health: () => ({ healthy, queued, dropped }) };
}

module.exports = { createSecurityEventLog };
