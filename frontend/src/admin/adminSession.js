import { getOrCreateWgsClientId } from '../features/visitor/visitorClient.js';

// 관리자 인증 상태는 현재 관리자 탭의 메모리에만 보관합니다.
// HttpOnly 세션 쿠키는 브라우저가 자동 전송하며 sessionStorage/localStorage에는 저장하지 않습니다.
let currentAdmin = null;
let csrfToken = '';
let idleExpiresAt = '';
let expiresAt = '';

export function getAdminClientId() {
  // 공개 화면과 관리자 화면이 동일한 브라우저 방문 ID를 사용해야
  // 관리자 로그인 시 이미 생성된 공개 방문 세션까지 정확히 제외할 수 있습니다.
  return getOrCreateWgsClientId();
}

export function setAdminSession(payload = {}) {
  currentAdmin = payload.admin && typeof payload.admin === 'object' ? { ...payload.admin } : null;
  csrfToken = String(payload.csrfToken || '');
  idleExpiresAt = String(payload.idleExpiresAt || '');
  expiresAt = String(payload.expiresAt || '');
  return currentAdmin;
}

export function clearAdminSession() {
  currentAdmin = null;
  csrfToken = '';
  idleExpiresAt = '';
  expiresAt = '';
}

export function getAdminSession() {
  return { admin: currentAdmin, csrfToken, idleExpiresAt, expiresAt };
}

export function getCurrentAdmin() {
  return currentAdmin;
}

export function getAdminCsrfToken() {
  return csrfToken;
}

export function makeAdminHeaders(additionalHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-WGS-Client-Id': getAdminClientId(),
    ...additionalHeaders,
  };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

export async function fetchAdminSession() {
  const response = await fetch('/api/admin/auth/me', {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-WGS-Client-Id': getAdminClientId(),
    },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.valid || !data?.admin) {
    clearAdminSession();
    return null;
  }
  setAdminSession(data);
  return data.admin;
}

export async function logoutAdmin() {
  try {
    const response = await fetch('/api/admin/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: makeAdminHeaders(),
      body: JSON.stringify({}),
    });
    const data = await response.json().catch(() => ({}));
    clearAdminSession();
    return {
      reachedServer: true,
      ok: response.ok && data?.success !== false,
      message: data.message || data.msg || '',
    };
  } catch (error) {
    return {
      reachedServer: false,
      ok: false,
      message: error.message || '관리자 로그아웃 서버에 연결하지 못했습니다.',
    };
  }
}
