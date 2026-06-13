// hCaptcha 미완료 반복 클릭 제한 유틸
// 목적: 보안 확인 없이 같은 버튼을 반복 클릭하는 경우 프론트 단계에서 먼저 안내하고 짧게 제한합니다.
// 주의: 서버 요청 제한은 backend/서버 진입점에서 별도로 처리합니다. 이 파일은 사용자 안내와 사용자 경험 보호용입니다.

const DEFAULT_LIMIT = 3;
const DEFAULT_LOCK_SECONDS = 30;
const PREFIX = 'wgs_hcaptcha_missing_guard';

function nowMs() {
  return Date.now();
}

function keyFor(action) {
  return `${PREFIX}:${action || 'default'}`;
}

function safeRead(action) {
  try {
    const raw = localStorage.getItem(keyFor(action));
    if (!raw) return { count: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed.count || 0),
      lockedUntil: Number(parsed.lockedUntil || 0),
    };
  } catch (_) {
    return { count: 0, lockedUntil: 0 };
  }
}

function safeWrite(action, state) {
  try {
    localStorage.setItem(keyFor(action), JSON.stringify(state));
  } catch (_) {
    // localStorage 접근이 제한된 환경에서도 사이트 기능은 계속 동작해야 합니다.
  }
}

export function resetHcaptchaGuard(action = 'default') {
  try {
    localStorage.removeItem(keyFor(action));
  } catch (_) {}
}

export function guardMissingHcaptcha(action, enabled, token, notify = window.alert, options = {}) {
  if (!enabled) return true;

  if (token) {
    resetHcaptchaGuard(action);
    return true;
  }

  const limit = Number(options.limit || DEFAULT_LIMIT);
  const lockSeconds = Number(options.lockSeconds || DEFAULT_LOCK_SECONDS);
  const state = safeRead(action);
  const current = nowMs();

  if (state.lockedUntil && state.lockedUntil >current) {
    const remain = Math.ceil((state.lockedUntil - current) / 1000);
    notify(`보안 확인(hCaptcha)을 먼저 완료해주세요. 반복 시도로 인해 ${remain}초 후 다시 시도할 수 있습니다.`);
    return false;
  }

  const nextCount = state.lockedUntil && state.lockedUntil <= current ? 1 : state.count + 1;

  if (nextCount >= limit) {
    const lockedUntil = current + lockSeconds * 1000;
    safeWrite(action, { count: 0, lockedUntil });
    notify(`보안 확인(hCaptcha)을 완료하지 않은 요청이 반복되었습니다. ${lockSeconds}초 후 다시 시도해주세요.`);
    return false;
  }

  safeWrite(action, { count: nextCount, lockedUntil: 0 });
  notify(`보안 확인(hCaptcha)을 완료해주세요. (${nextCount}/${limit})`);
  return false;
}
