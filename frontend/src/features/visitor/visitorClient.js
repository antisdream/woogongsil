import axios from 'axios';

const CLIENT_ID_STORAGE_KEY = 'wgs_client_id';
const VISIT_ENDPOINT = '/api/visitors/visit';
const VISIT_TIMEOUT_MS = 5000;
export const VISIT_TOUCH_THROTTLE_MS = 45 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

let volatileClientId = '';
let visitRequestPromise = null;
let lastVisitRequestStartedAt = 0;
let lastVisitorSummary = null;

function createClientId() {
  const randomId = (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `wgs-${randomId}`;
}

export function getOrCreateWgsClientId() {
  try {
    const storedClientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (storedClientId) return storedClientId;

    const clientId = createClientId();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    return clientId;
  } catch {
    if (!volatileClientId) {
      volatileClientId = `wgs-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return volatileClientId;
  }
}

export function withWgsClientIdHeader(config = {}) {
  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      'X-WGS-Client-Id': getOrCreateWgsClientId(),
    },
  };
}

export function getKstDateKey(value = Date.now()) {
  const shifted = new Date(new Date(value).getTime() + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMillisecondsUntilNextKstDay(value = Date.now()) {
  const shifted = new Date(new Date(value).getTime() + KST_OFFSET_MS);
  const nextMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return Math.max(1000, nextMidnight - shifted.getTime() + 1000);
}

function toSafeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return null;
  return Math.floor(count);
}

function unwrapSummary(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const data = payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload;

  return data.summary && typeof data.summary === 'object'
    ? data.summary
    : data;
}

export function normalizeVisitorSummary(payload) {
  const summary = unwrapSummary(payload);
  if (!summary) return null;

  const todayCount = toSafeCount(summary.todayCount ?? summary.today_count);
  const totalCount = toSafeCount(summary.totalCount ?? summary.total_count);
  if (todayCount === null || totalCount === null) return null;

  const startedAt = summary.startedAt ?? summary.started_at ?? null;

  return {
    counted: Boolean(summary.counted),
    ignored: Boolean(summary.ignored),
    reason: typeof summary.reason === 'string' ? summary.reason : '',
    todayCount,
    totalCount,
    timezone: typeof summary.timezone === 'string' ? summary.timezone : 'Asia/Seoul',
    startedAt: typeof startedAt === 'string' && startedAt.trim() ? startedAt.trim() : null,
    session: summary.session && typeof summary.session === 'object'
      ? {
        visitorType: summary.session.visitorType === 'member' ? 'member' : 'anonymous',
        startedAt: summary.session.startedAt || null,
        lastSeenAt: summary.session.lastSeenAt || null,
        idleTimeoutSeconds: toSafeCount(summary.session.idleTimeoutSeconds) || 300,
      }
      : null,
  };
}

async function recordVisit() {
  try {
    const response = await axios.post(
      VISIT_ENDPOINT,
      {
        // 관리자 세션 목록에서 최초 진입 화면을 확인할 수 있도록
        // query/hash를 제외한 현재 경로만 서버에 전달합니다.
        entryPath: window.location.pathname,
      },
      withWgsClientIdHeader({ timeout: VISIT_TIMEOUT_MS }),
    );

    return normalizeVisitorSummary(response.data);
  } catch (error) {
    if (import.meta.env?.DEV) {
      console.warn('[WGS] visitor count request failed:', error?.message || error);
    }
    return null;
  }
}

export function touchVisitorSession({ force = false, now = Date.now() } = {}) {
  if (visitRequestPromise) return visitRequestPromise;

  if (!force && lastVisitRequestStartedAt > 0
      && now - lastVisitRequestStartedAt < VISIT_TOUCH_THROTTLE_MS) {
    return Promise.resolve(lastVisitorSummary);
  }

  lastVisitRequestStartedAt = now;
  const nextPromise = recordVisit().then((summary) => {
    if (summary) {
      lastVisitorSummary = summary;
    } else {
      // 일시적인 실패 후 재시도까지 45초를 기다리지 않도록 요청 시각을 초기화합니다.
      lastVisitRequestStartedAt = 0;
    }
    return summary;
  }).finally(() => {
    if (visitRequestPromise === nextPromise) visitRequestPromise = null;
  });
  visitRequestPromise = nextPromise;
  return nextPromise;
}

// 기존 호출부 호환을 유지하되 실제 동작은 하루 1회가 아닌 5분 세션 touch입니다.
export function trackVisitorOnce() {
  return touchVisitorSession();
}
