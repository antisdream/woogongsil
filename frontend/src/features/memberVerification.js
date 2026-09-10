// The cookie proof is HttpOnly. Keep its CSRF companion only in the current page's memory.
export const verificationConfig = csrfToken => ({
    withCredentials: true,
    timeout: 45000,
    headers: { 'X-Wgs-Verification-Csrf': csrfToken || '' },
});

export const memberVerificationIdentity = () => ({
    id: sessionStorage.getItem('userId') || '',

});
