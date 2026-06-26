// 초대 코드, hCaptcha, 요청 제한 보안 검사를 처리합니다.
'use strict';

const path = require('path');

function registerGatekeeperSecurity(options = {}) {
    const app = options.app;
    const crypto = options.crypto || require('crypto');
    const https = options.https || require('https');
    const backendDir = options.backendDir || path.resolve(__dirname, '..', '..');
    const isApprovalBypassRequest = typeof options.isApprovalBypassRequest === 'function'? options.isApprovalBypassRequest
        : () => false;

    if (!app || typeof app.use !== 'function') {
        throw new Error('registerGatekeeperSecurity requires an Express app.');
    }
// 우공실 인증/로그인 계열 요청 제한
// 목적: 같은 네트워크 전체 차단을 피하면서, 장난/봇 요청은 기기·계정·IP 조합으로 완화합니다.
if (String(process.env.WGS_TRUST_PROXY || 'true').toLowerCase() !== 'false') {
  try {
    app.set('trust proxy', 1);
  } catch (err) {
    console.warn('[WGS RATE LIMIT] trust proxy 설정 실패:', err.message);
  }
}

const wgsRateLimitStore = new Map();

function wgsRateBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function wgsRateNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >0 ? n : fallback;
}

function wgsRateKeyPart(value, fallback = 'unknown') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._:-]/g, '_')
    .slice(0, 180) || fallback;
}

function wgsRateHashPart(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function wgsClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown-ip';
}

function wgsClientId(req) {
  return (
    req.headers['x-wgs-client-id'] ||
    req.headers['x-client-id'] ||
    req.body?.wgsClientId ||
    req.body?.clientId ||
    'missing-client-id'
  );
}

function wgsTakeRate(key, max, windowMs) {
  const now = Date.now();
  const current = wgsRateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    wgsRateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, max - 1), retryAfter: 0 };
  }
  current.count += 1;
  if (current.count >max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: Math.max(0, max - current.count), retryAfter: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of wgsRateLimitStore.entries()) {
    if (!bucket || bucket.resetAt <= now) wgsRateLimitStore.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

const WGS_RATE_LIMIT_ENABLED = wgsRateBool(process.env.WGS_RATE_LIMIT_ENABLED, true);

function wgsRouteGroup(req) {
  const path = req.path;
  const method = String(req.method || 'GET').toUpperCase();
  if (path === '/api/gatekeeper/verify') return 'gatekeeper';
  if (path === '/api/login') return 'login';

  // 회원가입: 아이디 중복확인, 인증메일 발송/확인, 최종 가입
  if (path === '/api/check-id' || path === '/api/send-verification' || path === '/api/verify-code' || path === '/api/signup') {
    return 'register';
  }

  // 아이디/비밀번호찾기: 아이디찾기, 비밀번호찾기 인증/재설정
  if (path === '/api/find-id' || path === '/api/find-pw/reset' || path === '/api/reset-pw') {
    return 'find_account';
  }

  // 로그인 후 비밀번호  인증메일 발송/확인, 최종 변경
  if (path === '/api/auth/send-code' || path === '/api/auth/verify-code' || path === '/api/user/change-pw') {
    return 'change_pw';
  }

  if (method === 'POST' && /^\/api\/posts\/[^/]+\/view$/.test(path)) return 'content_view';
  if (method === 'POST' && path === '/api/posts/notify-email') return 'notify_email';

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (path.startsWith('/api/admin/')) return 'admin_write';
    if (path.startsWith('/api/realtime-chat/')) return 'realtime_write';
    if (path.startsWith('/api/mealmap/')) return 'mealmap_write';
    if (path.startsWith('/api/multiplayer/')) return 'multiplayer_write';
    if (path.startsWith('/api/posts')) return 'content_write';
    if (
      path === '/api/practice-results' ||
      path === '/api/exam-results' ||
      path === '/api/ipep-ranking' ||
      path === '/api/save-wrong' ||
      path === '/api/save-ipep-wrong' ||
      path === '/api/remove-wrong' ||
      path === '/api/remove-ipep-wrong' ||
      path === '/api/remove-all-wrong' ||
      path === '/api/remove-all-ipep-wrong'
    ) {
      return 'learning_write';
    }
    if (path === '/api/user/update' || path === '/api/user/delete' || path === '/api/user/fortune-history') {
      return 'account_write';
    }
  }

  return null;
}

function wgsRateSpecs(req, group) {
  const body = req.body || {};
  const clientId = wgsRateKeyPart(wgsClientId(req), 'missing-client-id');
  const ip = wgsRateKeyPart(wgsClientIp(req), 'unknown-ip');
  const username = wgsRateKeyPart(body.username || body.id || body.userId || body.loginId || '', '');
  const email = wgsRateKeyPart(body.email || body.emailAddress || '', '');
  const sessionToken = wgsRateHashPart(body.sessionToken || req.headers['x-session-token'] || req.query?.sessionToken || '', '');
  const specs = [];

  function add(name, keyValue, max, sec) {
    if (!keyValue) return;
    specs.push({ key: `wgs:${name}:${keyValue}`, max, windowMs: sec * 1000 });
  }

  if (group === 'gatekeeper') {
    add('gatekeeper:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_GATEKEEPER_PER_MIN, 8), 60);
    add('gatekeeper:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_GATEKEEPER_PER_MIN, 80), 60);
  }

  if (group === 'login') {
    add('login:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_LOGIN_PER_MIN, 8), 60);
    add('login:account', username, wgsRateNumber(process.env.WGS_LIMIT_ACCOUNT_LOGIN_PER_10MIN, 10), 600);
    add('login:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_LOGIN_PER_MIN, 60), 60);
  }

  if (group === 'register') {
    add('register:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_REGISTER_PER_10MIN, 10), 600);
    add('register:email', email, wgsRateNumber(process.env.WGS_LIMIT_EMAIL_REGISTER_PER_10MIN, 8), 600);
    add('register:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_REGISTER_PER_10MIN, 30), 600);
  }

  if (group === 'find_account') {
    add('find:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_FIND_ACCOUNT_PER_10MIN, 8), 600);
    add('find:email', email, wgsRateNumber(process.env.WGS_LIMIT_EMAIL_FIND_ACCOUNT_PER_10MIN, 8), 600);
    add('find:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_FIND_ACCOUNT_PER_10MIN, 30), 600);
  }

  if (group === 'change_pw') {
    add('change_pw:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_CHANGE_PW_PER_10MIN, 8), 600);
    add('change_pw:email', email, wgsRateNumber(process.env.WGS_LIMIT_EMAIL_CHANGE_PW_PER_10MIN, 8), 600);
    add('change_pw:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_CHANGE_PW_PER_10MIN, 30), 600);
  }

  if (group === 'content_view') {
    add('content_view:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_CONTENT_VIEW_PER_MIN, 120), 60);
    add('content_view:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_CONTENT_VIEW_PER_MIN, 300), 60);
  }

  if (group === 'notify_email') {
    add('notify:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_NOTIFY_EMAIL_PER_10MIN, 10), 600);
    add('notify:user', username, wgsRateNumber(process.env.WGS_LIMIT_USER_NOTIFY_EMAIL_PER_10MIN, 10), 600);
    add('notify:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_NOTIFY_EMAIL_PER_10MIN, 40), 600);
  }

  if (group === 'content_write' || group === 'learning_write' || group === 'account_write' || group === 'mealmap_write' || group === 'multiplayer_write' || group === 'realtime_write') {
    const groupKey = group.replace(/[^a-z0-9_:-]/g, '_');
    add(`${groupKey}:client`, clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_API_WRITE_PER_MIN, 120), 60);
    add(`${groupKey}:user`, username, wgsRateNumber(process.env.WGS_LIMIT_USER_API_WRITE_PER_MIN, 180), 60);
    add(`${groupKey}:session`, sessionToken, wgsRateNumber(process.env.WGS_LIMIT_SESSION_API_WRITE_PER_MIN, 180), 60);
    add(`${groupKey}:ip`, ip, wgsRateNumber(process.env.WGS_LIMIT_IP_API_WRITE_PER_MIN, 600), 60);
  }

  if (group === 'admin_write') {
    add('admin_write:user', username, wgsRateNumber(process.env.WGS_LIMIT_USER_ADMIN_WRITE_PER_MIN, 60), 60);
    add('admin_write:session', sessionToken, wgsRateNumber(process.env.WGS_LIMIT_SESSION_ADMIN_WRITE_PER_MIN, 90), 60);
    add('admin_write:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_ADMIN_WRITE_PER_MIN, 240), 60);
  }

  return specs;
}

app.use((req, res, next) => {
  if (!WGS_RATE_LIMIT_ENABLED || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) return next();

  const group = wgsRouteGroup(req);
  if (!group) return next();

  const specs = wgsRateSpecs(req, group);
  for (const spec of specs) {
    const result = wgsTakeRate(spec.key, spec.max, spec.windowMs);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter));
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `요청이 너무 많습니다. ${result.retryAfter}초 후 다시 시도해주세요.`,
        retryAfter: result.retryAfter,
      });
    }
  }

  return next();
});



// 문제 오류신고 API 연결
// 프론트에서 POST /api/error-report로 요청하면
// backend/routes/errorReportRoutes.js의 router.post('/')가 실행됩니다.

// WGS 게이트키퍼 시스템
// ------------------------------------------------------------
// 목적:
// - 외부인이 우공실 사이트 API를 직접 이용하지 못하도록 1차 입장코드를 확인합니다.
// - 실제 로그인/회원가입 시스템과는 별개입니다.
// - 인증 성공 시 httpOnly 쿠키를 발급하고, 이후 /api 요청을 허용합니다.
// - INVITE_CODE, INVITE_TOKEN_SECRET, INVITE_TOKEN_MAX_AGE_DAYS는 환경 변수 파일 값을 사용합니다.
const WGS_GATEKEEPER_COOKIE_NAME = 'wgs_gatekeeper';

function wgsGatekeeperMaxAgeMs() {
    const days = Number(process.env.INVITE_TOKEN_MAX_AGE_DAYS || 30);
    const safeDays = Number.isFinite(days) && days >0 ? days : 30;
    return safeDays * 24 * 60 * 60 * 1000;
}

function wgsParseCookies(cookieHeader = '') {
    return String(cookieHeader || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
            const eqIndex = part.indexOf('=');
            if (eqIndex === -1) return acc;
            const key = decodeURIComponent(part.slice(0, eqIndex).trim());
            const value = decodeURIComponent(part.slice(eqIndex + 1).trim());
            acc[key] = value;
            return acc;
        }, {});
}

function wgsGatekeeperSecret() {
    return String(process.env.INVITE_TOKEN_SECRET || process.env.INVITE_CODE || 'wgs-gatekeeper-fallback-secret');
}

function wgsSignGatekeeperPayload(payload) {
    return crypto
        .createHmac('sha256', wgsGatekeeperSecret())
        .update(String(payload))
        .digest('hex');
}

function wgsCreateGatekeeperToken() {
    const issuedAt = Date.now();
    const signature = wgsSignGatekeeperPayload(issuedAt);
    return `${issuedAt}.${signature}`;
}

function wgsSafeEqual(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function wgsVerifyGatekeeperToken(token) {
    const raw = String(token || '').trim();
    const [issuedAtText, signature] = raw.split('.');

    if (!issuedAtText || !signature) return false;

    const issuedAt = Number(issuedAtText);
    if (!Number.isFinite(issuedAt)) return false;

    const now = Date.now();
    if (issuedAt >now + 60 * 1000) return false;
    if (now - issuedAt >wgsGatekeeperMaxAgeMs()) return false;

    const expectedSignature = wgsSignGatekeeperPayload(issuedAtText);
    return wgsSafeEqual(signature, expectedSignature);
}

function wgsHasValidGatekeeper(req) {
    const cookies = wgsParseCookies(req.headers.cookie || '');
    return wgsVerifyGatekeeperToken(cookies[WGS_GATEKEEPER_COOKIE_NAME]);
}

function wgsGatekeeperCookieSecureAttribute(req) {
    const override = String(process.env.WGS_GATEKEEPER_COOKIE_SECURE || '').trim().toLowerCase();
    if (override) {
        return ['1', 'true', 'yes', 'on'].includes(override) ? '; Secure' : '';
    }

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || '').trim().toLowerCase();
    const isHttpsRequest = Boolean(req.secure || forwardedProto.split(',').map((part) => part.trim()).includes('https'));
    const isHttpsSite = publicSiteUrl.startsWith('https://');

    return isHttpsRequest || isHttpsSite ? '; Secure' : '';
}

function wgsSetGatekeeperCookie(req, res, token) {
    const maxAgeSeconds = Math.floor(wgsGatekeeperMaxAgeMs() / 1000);
    const secureAttribute = wgsGatekeeperCookieSecureAttribute(req);

    // 배포 사이트는 HTTPS이므로 Secure 쿠키를 사용합니다.
    // 로컬 모바일 점검처럼 http://내부IP 로 접속할 때는 Secure 쿠키가 저장되지 않아 조건부로 제외합니다.
    // httpOnly라서 프론트 JS가 쿠키 값을 직접 읽을 수 없고, API 요청 때 브라우저가 자동 전송합니다.
    res.setHeader(
        'Set-Cookie',
        `${WGS_GATEKEEPER_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax`
    );
}

function wgsClearGatekeeperCookie(req, res) {
    const secureAttribute = wgsGatekeeperCookieSecureAttribute(req);

    res.setHeader(
        'Set-Cookie',
        `${WGS_GATEKEEPER_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly${secureAttribute}; SameSite=Lax`
    );
}


// WGS hCaptcha 보안 확인 시스템
// ------------------------------------------------------------
// 목적:
// - 입장코드, 로그인, 회원가입, 이메일 인증 발송, 비밀번호 변경 같은
//  서버 자원을 많이 쓰거나 악용 가능성이 있는 요청 앞단에서 봇을 차단합니다.
// - 별도 npm 패키지를 추가하지 않고 Node 기본 https 모듈로 hCaptcha siteverify를 호출합니다.
// - 환경 변수 파일 값만 바꾸면 환경별에서 켜고 끌 수 있습니다.
const HCAPTCHA_DEFAULT_ACTIONS = 'gatekeeper,login,auth_send_code,signup,find_reset,change_pw';

function wgsBoolEnv(value, defaultValue = false) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return defaultValue;
    return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

function hcaptchaBaseEnabled() {
    return wgsBoolEnv(process.env.HCAPTCHA_ENABLED, false)
        && Boolean(String(process.env.HCAPTCHA_SITE_KEY || '').trim())
        && Boolean(String(process.env.HCAPTCHA_SECRET_KEY || '').trim());
}

const HCAPTCHA_ACTION_ENV_MAP = {
  gatekeeper: 'HCAPTCHA_ON_ACCESS_CODE',
  login: 'HCAPTCHA_ON_LOGIN',
  auth_send_code: 'HCAPTCHA_ON_REGISTER',
  signup: 'HCAPTCHA_ON_REGISTER',
  find_reset: 'HCAPTCHA_ON_FIND_ACCOUNT',
  change_pw: 'HCAPTCHA_ON_CHANGE_PASSWORD',
};

function envFlagEnabled(name, defaultValue = true) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') return defaultValue;
  return !['0', 'false', 'off', 'no', 'n'].includes(String(value).trim().toLowerCase());
}


// hCaptcha 환경변수 안전 로더
try {
  const wgsFix1603aDotenv = require('dotenv');
  const wgsFix1603aPath = require('path');
  wgsFix1603aDotenv.config({ path: wgsFix1603aPath.join(backendDir, '.env') });
  wgsFix1603aDotenv.config({ path: wgsFix1603aPath.join(backendDir, 'backend.env') });
} catch (e) {}
// hCaptcha 상수 누락 시 기본값 보정
var HCAPTCHA_ENABLED = ['1','true','yes','on'].includes(String(process.env.HCAPTCHA_ENABLED || '').trim().toLowerCase());
var HCAPTCHA_SITE_KEY = String(process.env.HCAPTCHA_SITE_KEY || process.env.VITE_HCAPTCHA_SITE_KEY || '').trim();
var HCAPTCHA_SECRET_KEY = String(process.env.HCAPTCHA_SECRET_KEY || '').trim();
var HCAPTCHA_REQUIRED_ACTIONS = String(process.env.HCAPTCHA_REQUIRED_ACTIONS || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
HCAPTCHA_REQUIRED_ACTIONS.has = HCAPTCHA_REQUIRED_ACTIONS.has || function(v){ return this.includes(v); };

function hcaptchaActionEnabled(action) {
  if (!HCAPTCHA_ENABLED) return false;

  // 기존 HCAPTCHA_REQUIRED_ACTIONS도 계속 지원합니다.
  // 값이 비어 있으면 전체 액션을 대상으로 보고, 아래 위치별 ON/OFF만 따른다.
  const legacyRaw = String(process.env.HCAPTCHA_REQUIRED_ACTIONS || '').trim();
  if (legacyRaw) {
    const legacySet = new Set(
      legacyRaw.split(',').map((v) => v.trim()).filter(Boolean)
    );
    if (!legacySet.has(action)) return false;
  }

  const envKey = HCAPTCHA_ACTION_ENV_MAP[action];
  if (!envKey) return true;
  return envFlagEnabled(envKey, true);
}

function hcaptchaTrustsGatekeeper() {
  return envFlagEnabled('HCAPTCHA_TRUST_GATEKEEPER', true);
}

function hcaptchaCanSkipForTrustedGatekeeper(req, actionName) {
    if (actionName === 'gatekeeper') return false;
    return hcaptchaTrustsGatekeeper() && wgsHasValidGatekeeper(req);
}

function getClientIpForCaptcha(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || '';
}

function verifyHcaptchaTokenWithServer(token, remoteIp = '') {
    return new Promise((resolve) => {
        const postData = new URLSearchParams();
        postData.append('secret', String(process.env.HCAPTCHA_SECRET_KEY || '').trim());
        postData.append('response', token);
        if (remoteIp) postData.append('remoteip', remoteIp);

        const body = postData.toString();
        const request = https.request(
            {
                hostname: 'api.hcaptcha.com',
                path: '/siteverify',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(body),
                },
                timeout: 7000,
            },
            (response) => {
                let raw = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => { raw += chunk; });
                response.on('end', () => {
                    try {
                        resolve(JSON.parse(raw || '{}'));
                    } catch (parseError) {
                        resolve({ success: false, 'error-codes': ['invalid-json-from-hcaptcha'] });
                    }
                });
            }
        );

        request.on('timeout', () => {
            request.destroy(new Error('hCaptcha verification timeout'));
        });

        request.on('error', (error) => {
            console.error('[hCaptcha] verification request error:', error.message);
            resolve({ success: false, 'error-codes': ['siteverify-request-failed'] });
        });

        request.write(body);
        request.end();
    });
}

async function requireHcaptcha(req, res, actionName) {
    if (!hcaptchaActionEnabled(actionName)) return true;
    if (hcaptchaCanSkipForTrustedGatekeeper(req, actionName)) return true;

    const token = String(req.body?.hcaptchaToken || req.body?.hcaptcha || '').trim();
    if (!token) {
        res.status(400).json({
            success: false,
            captchaRequired: true,
            msg: '보안 확인(hCaptcha)을 완료한 뒤 다시 시도해주세요.',
        });
        return false;
    }

    const result = await verifyHcaptchaTokenWithServer(token, getClientIpForCaptcha(req));
    if (!result.success) {
        console.warn('[hCaptcha] verification failed:', actionName, result['error-codes'] || []);
        res.status(403).json({
            success: false,
            captchaRequired: true,
            msg: '보안 확인(hCaptcha)에 실패했습니다. 체크박스를 다시 완료해주세요.',
            errorCodes: result['error-codes'] || [],
        });
        return false;
    }

    return true;
}

function hcaptchaPublicConfig() {
    return {
        enabled: hcaptchaBaseEnabled(),
        siteKey: hcaptchaBaseEnabled() ? String(process.env.HCAPTCHA_SITE_KEY || '').trim() : '',
    };
}

app.get('/api/gatekeeper/hcaptcha-config', (req, res) => {
    const publicConfig = hcaptchaPublicConfig();
    const trustedGatekeeper = hcaptchaTrustsGatekeeper() && wgsHasValidGatekeeper(req);

    return res.json({
        success: true,
        ...publicConfig,
        enabled: publicConfig.enabled && !trustedGatekeeper,
        trustedGatekeeper,
    });
});

app.get('/api/gatekeeper/status', (req, res) => {
    return res.json({
        success: true,
        allowed: wgsHasValidGatekeeper(req),
    });
});

app.post('/api/gatekeeper/verify', async (req, res) => {
    if (!(await requireHcaptcha(req, res, 'gatekeeper'))) return;

    const inputCode = String((req.body && req.body.code) || '').trim();
    const inviteCode = String(process.env.INVITE_CODE || '').trim();

    if (!inviteCode) {
        return res.status(500).json({
            success: false,
            msg: '게이트키퍼 인증코드가 서버에 설정되어 있지 않습니다.',
        });
    }

    if (!inputCode || !wgsSafeEqual(inputCode, inviteCode)) {
        return res.status(401).json({
            success: false,
            msg: '인증코드가 올바르지 않습니다.',
        });
    }

    const token = wgsCreateGatekeeperToken();
    wgsSetGatekeeperCookie(req, res, token);

    return res.json({
        success: true,
        allowed: true,
        msg: '우공실 입장 인증이 완료되었습니다.',
    });
});

app.post('/api/gatekeeper/logout', (req, res) => {
    wgsClearGatekeeperCookie(req, res);
    return res.json({
        success: true,
        allowed: false,
    });
});

// ------------------------------------------------------------
// /api 보호 미들웨어
// ------------------------------------------------------------
// /api/gatekeeper/* 만 공개하고, 나머지 API는 게이트키퍼 쿠키가 있어야 접근 가능합니다.
// 프론트 화면 자체는 계속 열리지만, 인증 전에는 GatekeeperGuard가 사이트 내용을 보여주지 않습니다.
// ------------------------------------------------------------
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/gatekeeper/')) return next();
    if (req.method === 'OPTIONS') return next();
    if (req.method === 'GET' && (req.path === '/ipep/health' || req.path === '/ipep/health/')) return next();
    if (req.method === 'GET' && (req.path === '/mobile-qr' || req.path === '/mobile-qr/')) return next();

    // 최고관리자가 결재를 승인할 때 서버 내부에서 원래 변경 API를 다시 호출합니다.
    // 이 내부 호출은 브라우저 쿠키를 들고 있지 않기 때문에 Gatekeeper에서 401이 발생할 수 있습니다.
    // 일반 사용자가 임의로 우회하지 못하도록 서버 내부 전용 승인 토큰 검사를 통과한 요청만 예외 처리합니다.
    if (typeof isApprovalBypassRequest === 'function' && isApprovalBypassRequest(req)) return next();

    if (wgsHasValidGatekeeper(req)) return next();

    return res.status(401).json({
        success: false,
        gatekeeperRequired: true,
        msg: '우공실 입장 인증이 필요합니다.',
    });
});



    return {
        requireHcaptcha,
        hcaptchaPublicConfig,
        wgsHasValidGatekeeper,
    };
}

module.exports = registerGatekeeperSecurity;
