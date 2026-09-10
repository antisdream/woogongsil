// HTTP CORS, security header, and robots helpers.
'use strict';

function wgsBoolEnv(value, fallback = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

function wgsCsvEnv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function wgsIsPrivateDevHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
}

function configuredOrigins(env) {
    const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
    return new Set([
        'https://woogongsil.site', 'https://www.woogongsil.site',
        ...wgsCsvEnv(env.PUBLIC_SITE_URL), ...wgsCsvEnv(env.CORS_ALLOWED_ORIGINS), ...wgsCsvEnv(env.WGS_ALLOWED_ORIGINS),
    ].filter(value => {
        try {
            const parsed = new URL(value);
            return value === parsed.origin && !parsed.hostname.includes('*') && ['http:', 'https:'].includes(parsed.protocol)
                && (!production || (parsed.protocol === 'https:' && !wgsIsPrivateDevHost(parsed.hostname)));
        } catch { return false; }
    }));
}

function wgsAllowedCorsOrigin(origin, env = process.env) {
    // Requests without Origin (health probes/native clients) still use normal
    // route authentication. A browser's opaque "null" origin is not trusted.
    if (origin === undefined || origin === '') return true;
    try {
        const parsed = new URL(origin);
        if (origin !== parsed.origin || !['http:', 'https:'].includes(parsed.protocol)) return false;
        if (configuredOrigins(env).has(origin)) return true;
        return String(env.NODE_ENV || '').toLowerCase() !== 'production'
            && wgsBoolEnv(env.WGS_ALLOW_PRIVATE_DEV_ORIGINS, true) && wgsIsPrivateDevHost(parsed.hostname);
    } catch { return false; }
}

function createWgsCorsOptions(env = process.env) {
    return {
        origin(origin, callback) {
            callback(null, wgsAllowedCorsOrigin(origin, env));
        },
        credentials: true,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'X-WGS-Client-Id',
            'X-Client-Id',
            'X-User-Id',
            'X-Session-Token',
            'X-Server-Instance-Id',
            'X-CSRF-Token',
            'X-Wgs-Verification-Csrf',
            'X-Wgs-Member-Csrf',
        ],
        maxAge: 600,
    };
}

function createWgsSocketOptions(env = process.env) {
    return {
        allowRequest(req, callback) { callback(null, wgsAllowedCorsOrigin(req.headers.origin, env)); },
        cors: { origin(origin, callback) { callback(null, wgsAllowedCorsOrigin(origin, env)); }, methods: ['GET', 'POST'], credentials: true },
    };
}

function createWgsSecurityHeaders(env = process.env) {
    return function wgsSecurityHeaders(req, res, next) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()');
        // Begin with five minutes. Extending browser retention is an explicit
        // operator decision after HTTPS and certificate renewal are verified.
        const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
        const configuredAge = env.WGS_HSTS_MAX_AGE_SECONDS;
        const seconds = configuredAge === undefined || configuredAge === '' ? 300 : Number(configuredAge);
        const maxAge = Number.isInteger(seconds) && seconds >= 0 ? Math.min(seconds, 31536000) : 300;
        if (production && req.secure) res.setHeader('Strict-Transport-Security', `max-age=${maxAge}`);
        res.setHeader(
            'Content-Security-Policy',
            [
                "default-src 'self'",
                "script-src 'self'",
                "script-src-attr 'none'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "font-src 'self' data:",
                "media-src 'self' blob:",
                production
                    ? `connect-src 'self' ${[...configuredOrigins(env)].flatMap(origin => [origin, origin.replace(/^https:/, 'wss:')]).join(' ')}`
                    : "connect-src 'self' ws: wss:",
                "frame-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "frame-ancestors 'none'",
            ].join('; ')
        );
        if (wgsBoolEnv(process.env.WGS_ROBOTS_NOINDEX, true)) {
            res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        }
        next();
    };
}

function registerRobotsTxt(app) {
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain').send([
            'User-agent: *',
            'Disallow: /',
            '',
        ].join('\n'));
    });
}

module.exports = {
    wgsAllowedCorsOrigin,
    createWgsCorsOptions,
    createWgsSocketOptions,
    createWgsSecurityHeaders,
    registerRobotsTxt,
};
