'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { safeEqual } = require('./adminSessionService');

const DEFAULT_POLICY_FILE = '/home/ubuntu/wgs_deploy/admin-access/policy.json';

function protectedAdminPath(rawPath) {
    let decoded = String(rawPath || '').split('?')[0];
    try {
        // Express static serving decodes escaped paths; protect those aliases too.
        for (let i = 0; i < 3; i += 1) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        }
    } catch (_) {
        return true;
    }
    const normalized = path.posix.normalize('/' + decoded.replace(/\\/g, '/')).toLowerCase();
    return normalized === '/manage' || normalized.startsWith('/manage/')
        || normalized === '/api/admin' || normalized.startsWith('/api/admin/');
}

function parsePolicy(value) {
    if (value?.version !== 1 || !/^[a-f0-9]{64}$/.test(value.gatewaySecret || '')
        || !Array.isArray(value.devices) || value.devices.length !== 2) {
        throw new Error('Invalid administrator device policy');
    }
    const fingerprints = new Set(value.devices.map((device) => device.sha256));
    if (fingerprints.size !== 2 || [...fingerprints].some((value) => !/^[a-f0-9]{64}$/.test(value || ''))) {
        throw new Error('Two distinct administrator device certificates are required');
    }
    return { gatewaySecret: value.gatewaySecret, fingerprints };
}

function isLoopback(address) {
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(address || ''));
}

function createAdminDeviceAccess(options = {}) {
    const env = options.env || process.env;
    const policyFile = env.WGS_ADMIN_DEVICE_POLICY_FILE || DEFAULT_POLICY_FILE;
    const readPolicy = options.readPolicy || (() => JSON.parse(fs.readFileSync(policyFile, 'utf8')));
    const now = options.now || Date.now;

    function authenticate(req) {
        try {
            // Read each time so removing/replacing an approval takes effect immediately.
            // Missing or malformed configuration always denies access.
            const policy = parsePolicy(readPolicy());
            if (!isLoopback(req?.socket?.remoteAddress)
                || !safeEqual(req?.headers?.['x-wgs-admin-gateway'], policy.gatewaySecret)
                || req?.headers?.['x-wgs-admin-verify'] !== 'SUCCESS') return null;
            const encoded = req?.headers?.['x-wgs-admin-certificate'];
            if (typeof encoded !== 'string' || encoded.length > 12000) return null;
            const cert = new X509Certificate(decodeURIComponent(encoded));
            const fingerprint = cert.fingerprint256.replace(/:/g, '').toLowerCase();
            const time = now();
            if (!policy.fingerprints.has(fingerprint)
                || time < Date.parse(cert.validFrom) || time >= Date.parse(cert.validTo)
                || cert.ca || !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.2')) return null;
            return { fingerprint };
        } catch (_) {
            return null;
        }
    }

    function protect(req, res, next) {
        const required = protectedAdminPath(req.originalUrl || req.url || req.path);
        const device = required || req.headers?.['x-wgs-admin-certificate'] ? authenticate(req) : null;
        // Do not expose gateway credentials to public handlers or request logging.
        const privateHeaders = new Set(['x-wgs-admin-gateway', 'x-wgs-admin-verify', 'x-wgs-admin-certificate']);
        for (const name of privateHeaders) {
            if (req.headers) delete req.headers[name];
        }
        if (Array.isArray(req.rawHeaders)) {
            req.rawHeaders = req.rawHeaders.filter((_value, index, values) =>
                !privateHeaders.has(String(values[index - (index % 2)]).toLowerCase()));
        }
        if (device) req.adminDevice = device;
        if (!required) return next();
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        if (!device) return res.status(404).type('text/plain').send('Not Found');
        return next();
    }

    return { authenticate, protect };
}

module.exports = { createAdminDeviceAccess, protectedAdminPath, parsePolicy, DEFAULT_POLICY_FILE };
