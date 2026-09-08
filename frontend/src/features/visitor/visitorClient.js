import axios from 'axios';

const CLIENT_ID_STORAGE_KEY = 'wgs_client_id';
const VISIT_ENDPOINT = '/api/visitors/visit';
const SUMMARY_ENDPOINT = '/api/visitors/summary';
const VISIT_TIMEOUT_MS = 5000;
export const VISIT_TOUCH_THROTTLE_MS = 45 * 1000;

let volatileClientId = '';
let visitRequestPromise = null;
let lastVisitRequestStartedAt = 0;
let lastVisitReceipt = null;
let summaryRequestPromise = null;
let lastSummary = null;
let lastSummaryRequestedAt = 0;

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

export function normalizeVisitReceipt(payload) {
  if (!payload || payload.success !== true
      || typeof payload.counted !== 'boolean' || typeof payload.ignored !== 'boolean') {
    return null;
  }
  return {
    success: true,
    counted: payload.counted,
    ignored: payload.ignored,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
  };
}

export function normalizeVisitorSummary(payload) {
  if (payload?.success !== true
      || !Number.isSafeInteger(payload.todayCount) || payload.todayCount < 0
      || !Number.isSafeInteger(payload.totalCount) || payload.totalCount < payload.todayCount) {
    return null;
  }
  return { todayCount: payload.todayCount, totalCount: payload.totalCount };
}

export function fetchVisitorSummary({ now = Date.now() } = {}) {
  if (summaryRequestPromise) return summaryRequestPromise;
  const kstDay = (timestamp) => Math.floor((timestamp + 9 * 60 * 60 * 1000) / 86_400_000);
  if (lastSummary && now >= lastSummaryRequestedAt
      && kstDay(now) === kstDay(lastSummaryRequestedAt)
      && now - lastSummaryRequestedAt < 15_000) return Promise.resolve(lastSummary);

  lastSummaryRequestedAt = now;
  const nextPromise = axios.get(SUMMARY_ENDPOINT, { timeout: VISIT_TIMEOUT_MS })
    .then((response) => normalizeVisitorSummary(response.data))
    .catch(() => null)
    .then((summary) => {
      lastSummary = summary;
      return summary;
    })
    .finally(() => {
      if (summaryRequestPromise === nextPromise) summaryRequestPromise = null;
    });
  summaryRequestPromise = nextPromise;
  return nextPromise;
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

    return normalizeVisitReceipt(response.data);
  } catch (error) {
    if (import.meta.env?.DEV) {
      console.warn('[WGS] visitor tracking request failed:', error?.message || error);
    }
    return null;
  }
}

export function touchVisitorSession({ force = false, now = Date.now() } = {}) {
  if (visitRequestPromise) return visitRequestPromise;

  if (!force && lastVisitRequestStartedAt > 0
      && now - lastVisitRequestStartedAt < VISIT_TOUCH_THROTTLE_MS) {
    return Promise.resolve(lastVisitReceipt);
  }

  lastVisitRequestStartedAt = now;
  const nextPromise = recordVisit().then((receipt) => {
    if (receipt) {
      lastVisitReceipt = receipt;
    } else {
      // 일시적인 실패 후 재시도까지 45초를 기다리지 않도록 요청 시각을 초기화합니다.
      lastVisitRequestStartedAt = 0;
    }
    return receipt;
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
