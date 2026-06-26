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
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
}

function wgsAllowedCorsOrigin(origin) {
    if (!origin) return true;

    const defaults = [
        'https://woogongsil.site',
        'https://www.woogongsil.site',
        'http://localhost:5000',
        'http://127.0.0.1:5000',
    ];
    const allowedOrigins = new Set([
        ...defaults,
        ...wgsCsvEnv(process.env.PUBLIC_SITE_URL),
        ...wgsCsvEnv(process.env.CORS_ALLOWED_ORIGINS),
        ...wgsCsvEnv(process.env.WGS_ALLOWED_ORIGINS),
    ].filter(Boolean));

    if (allowedOrigins.has(origin)) return true;

    try {
        const parsed = new URL(origin);
        if (wgsIsPrivateDevHost(parsed.hostname)) return true;
    } catch (error) {
        return false;
    }

    return false;
}

function createWgsCorsOptions() {
    return {
        origin(origin, callback) {
            callback(null, wgsAllowedCorsOrigin(origin));
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
            'X-Admin-Approval-Bypass',
        ],
        maxAge: 600,
    };
}

function createWgsSecurityHeaders() {
    return function wgsSecurityHeaders(req, res, next) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()');
        res.setHeader(
            'Content-Security-Policy',
            [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' https://js.hcaptcha.com https://*.hcaptcha.com https://dapi.kakao.com https://t1.daumcdn.net https://*.daumcdn.net http://t1.daumcdn.net http://*.daumcdn.net",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob: https://*.kakao.com https://*.kakaocdn.net https://*.daumcdn.net https://map.daumcdn.net https://t1.daumcdn.net https://map.kakao.com http://*.daumcdn.net http://map.daumcdn.net http://t1.daumcdn.net",
                "font-src 'self' data:",
                "connect-src 'self' ws: wss: https://hcaptcha.com https://*.hcaptcha.com https://dapi.kakao.com",
                "frame-src 'self' https://js.hcaptcha.com https://*.hcaptcha.com",
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
    createWgsSecurityHeaders,
    registerRobotsTxt,
};
