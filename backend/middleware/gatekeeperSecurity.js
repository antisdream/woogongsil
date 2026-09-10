// 공개 서비스의 요청 제한과 구형 클라이언트 호환 응답을 처리합니다.
'use strict';


function registerGatekeeperSecurity(options = {}) {
    const app = options.app;
    const crypto = options.crypto || require('crypto');

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
const MAX_RATE_BUCKETS = 10000;
let nextFullPruneAt = 0;

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
  // Express calculates req.ip from the configured trust-proxy hop count.
  // Prefer it so a client-supplied left-most X-Forwarded-For value cannot
  // rotate the IP bucket behind the trusted nginx proxy.
  if (req.ip) return req.ip;
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
    if (!current && wgsRateLimitStore.size >= MAX_RATE_BUCKETS) {
      if (now >= nextFullPruneAt) {
        for (const [oldKey, bucket] of wgsRateLimitStore) {
          if (bucket.resetAt <= now) wgsRateLimitStore.delete(oldKey);
        }
        nextFullPruneAt = now + 5000;
      }
      if (wgsRateLimitStore.size >= MAX_RATE_BUCKETS) return { allowed: false, remaining: 0, retryAfter: 60 };
    }
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
  if (['GET', 'HEAD'].includes(method) && path.startsWith('/api/')) {
    if (/^\/api\/(?:random-question|past-exam|ipep\/(?:random-question|past-exam|three-week\/questions))\/?$/i.test(path)) return 'question_read';
    return 'api_read';
  }
  if (path === '/api/gatekeeper/verify') return 'gatekeeper';
  if (path === '/api/admin/auth/login') return 'admin_login';
  if (method === 'POST' && /^\/api\/admin\/auth\/otp\/(status|resend|verify)\/?$/i.test(path)) return 'admin_otp';
  if (path === '/api/login') return 'login';
  if (method === 'POST' && /^\/api\/error-report(?:\/send)?\/?$/i.test(path)) return 'error_report';
  if (method === 'POST' && path === '/api/visitors/visit') return 'visitor_visit';

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
    if (path.startsWith('/api/multiplayer/')) return 'multiplayer_write';
    if (path.startsWith('/api/posts')) return 'content_write';
    if (
      path === '/api/practice-results' ||
      path === '/api/exam-results' ||
      path === '/api/practical-results' ||
      path.startsWith('/api/learning-attempts/') ||
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

  if (group === 'question_read' || group === 'api_read') {
    // The IP bucket is always enforced; rotating user-supplied headers cannot bypass it.
    add('read:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_API_READ_PER_MIN, 1200), 60);
    if (group === 'question_read') {
      add('question_read:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_QUESTION_READ_PER_MIN, 600), 60);
      if (sessionToken) add('question_read:session', sessionToken, wgsRateNumber(process.env.WGS_LIMIT_SESSION_QUESTION_READ_PER_MIN, 60), 60);
    }
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

  if (group === 'error_report') {
    if (clientId !== 'missing-client-id') {
      add('error_report:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_ERROR_REPORT_PER_10MIN, 8), 600);
    }
    add('error_report:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_ERROR_REPORT_PER_10MIN, 30), 600);
  }

  if (group === 'visitor_visit') {
    add('visitor_visit:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_VISITOR_VISIT_PER_MIN, 12), 60);
    add('visitor_visit:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_VISITOR_VISIT_PER_MIN, 600), 60);
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

  if (group === 'admin_login') {
    if (clientId !== 'missing-client-id') {
      add('admin_login:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_ADMIN_LOGIN_PER_10MIN, 6), 600);
    }
    add('admin_login:account', username, wgsRateNumber(process.env.WGS_LIMIT_ACCOUNT_ADMIN_LOGIN_PER_15MIN, 8), 900);
    add('admin_login:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_ADMIN_LOGIN_PER_10MIN, 20), 600);
  }

  if (group === 'admin_otp') {
    // DB-backed per-account send/attempt limits are enforced by the OTP service as well.
    if (clientId !== 'missing-client-id') add('admin_otp:client', clientId, 30, 600);
    add('admin_otp:ip', ip, 60, 600);
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

  if (group === 'content_write' || group === 'learning_write' || group === 'account_write' || group === 'multiplayer_write') {
    const groupKey = group.replace(/[^a-z0-9_:-]/g, '_');
    add(`${groupKey}:client`, clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_API_WRITE_PER_MIN, 120), 60);
    add(`${groupKey}:user`, username, wgsRateNumber(process.env.WGS_LIMIT_USER_API_WRITE_PER_MIN, 180), 60);
    add(`${groupKey}:session`, sessionToken, wgsRateNumber(process.env.WGS_LIMIT_SESSION_API_WRITE_PER_MIN, 180), 60);
    add(`${groupKey}:ip`, ip, wgsRateNumber(process.env.WGS_LIMIT_IP_API_WRITE_PER_MIN, 600), 60);
  }

  if (group === 'admin_write') {
    if (clientId !== 'missing-client-id') {
      add('admin_write:client', clientId, wgsRateNumber(process.env.WGS_LIMIT_CLIENT_ADMIN_WRITE_PER_MIN, 90), 60);
    }
    add('admin_write:user', username, wgsRateNumber(process.env.WGS_LIMIT_USER_ADMIN_WRITE_PER_MIN, 60), 60);
    add('admin_write:session', sessionToken, wgsRateNumber(process.env.WGS_LIMIT_SESSION_ADMIN_WRITE_PER_MIN, 90), 60);
    add('admin_write:ip', ip, wgsRateNumber(process.env.WGS_LIMIT_IP_ADMIN_WRITE_PER_MIN, 240), 60);
  }

  return specs;
}

app.use((req, res, next) => {
  if (!WGS_RATE_LIMIT_ENABLED || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) return next();

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

// 구형 웹/APK의 시작 확인 요청은 유지하되 입장코드와 CAPTCHA는 요구하지 않습니다.
// 회원 비밀번호, 회원 세션, 관리자 쿠키/CSRF 검증은 각 인증 경로가 계속 담당합니다.
function hcaptchaPublicConfig() {
    return { enabled: false, siteKey: '' };
}

app.get('/api/gatekeeper/hcaptcha-config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, ...hcaptchaPublicConfig(), trustedGatekeeper: false });
});

app.get('/api/gatekeeper/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, allowed: true });
});

app.post('/api/gatekeeper/verify', (req, res) => {
    return res.json({ success: true, allowed: true, msg: '별도 입장코드 없이 이용할 수 있습니다.' });
});

app.post('/api/gatekeeper/logout', (req, res) => {
    return res.json({ success: true, allowed: true });
});

// 이전 서버 조립부와의 호환용입니다. 현재 인증 라우트는 이 함수들을 사용하지 않습니다.
return {
    requireHcaptcha: async () => true,
    hcaptchaPublicConfig,
    wgsHasValidGatekeeper: () => true,
};
}

module.exports = registerGatekeeperSecurity;
