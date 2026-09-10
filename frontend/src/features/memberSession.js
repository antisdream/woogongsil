import axios from 'axios';

let current = null;
let csrfToken = '';
let bootstrapPromise = null;
const publicKeys = ['userId', 'userName', 'isOperator', 'isPrimaryAdmin', 'wgsMemberAuthenticated', 'wgsLegalConsentRequired', 'dDay'];

export const hasMemberSession = () => Boolean(current?.id);
export const memberCsrfToken = () => csrfToken;

export function clearMemberSession() {
    current = null;
    csrfToken = '';
    publicKeys.forEach(key => sessionStorage.removeItem(key));
    sessionStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionToken');
}

export function setMemberSession(payload) {
    if (!payload || payload.valid === false || payload.success === false) { clearMemberSession(); return null; }
    const user = payload.user || payload;
    const id = String(user.id || user.userId || '');
    if (!id || !payload.csrfToken) { clearMemberSession(); return null; }
    current = { id, name: String(user.name || id) };
    csrfToken = String(payload.csrfToken);
    // These values drive display only. Cookie validation is the server authority.
    sessionStorage.setItem('userId', current.id);
    sessionStorage.setItem('userName', current.name);
    sessionStorage.setItem('wgsMemberAuthenticated', 'true');
    sessionStorage.setItem('isOperator', user.isOperator ? 'true' : 'false');
    sessionStorage.setItem('isPrimaryAdmin', user.isPrimaryAdmin ? 'true' : 'false');
    if (user.dDay) sessionStorage.setItem('dDay', user.dDay);
    sessionStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionToken');
    return current;
}

export function memberHeaders(additional = {}) {
    return { ...(current ? { 'X-User-Id': current.id, 'X-Wgs-Member-Csrf': csrfToken } : {}), ...additional };
}

export async function bootstrapMemberSession() {
    if (bootstrapPromise) return bootstrapPromise;
    const legacyId = sessionStorage.getItem('userId') || '';
    const legacyToken = sessionStorage.getItem('sessionToken') || '';
    bootstrapPromise = (async () => {
        const response = await fetch('/api/member/session', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('로그인 상태를 확인하지 못했습니다.');
        let data = await response.json();
        if (!data.valid && legacyId && legacyToken) {
            const exchanged = await fetch('/api/member/session/exchange', { method: 'POST', credentials: 'include', cache: 'no-store',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: legacyId, sessionToken: legacyToken }), signal: AbortSignal.timeout(8000) });
            data = await exchanged.json();
        }
        setMemberSession(data);
        return data;
    })().catch(() => { clearMemberSession(); return { valid: false, unavailable: true }; }).finally(() => { bootstrapPromise = null; });
    return bootstrapPromise;
}

axios.interceptors.request.use(config => {
    const url = new URL(config.url || '', window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/admin/')) {
        config.withCredentials = true;
        if (csrfToken) config.headers.set('X-Wgs-Member-Csrf', csrfToken);
    }
    return config;
});

axios.interceptors.response.use(value => value, async error => {
    const config = error.config;
    if (error.response?.data?.reason === 'member_csrf' && config && !config.memberCsrfRetried) {
        const previousId = current?.id;
        const refreshed = await bootstrapMemberSession();
        if (refreshed.valid && previousId === current?.id) {
            config.memberCsrfRetried = true;
            return axios(config);
        }
    }
    throw error;
});
