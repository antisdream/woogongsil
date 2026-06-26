export const normalizeQuickLinkUrl = (value, fallback) => {
    const trimmed = String(value || '').trim();
    return trimmed && trimmed !== '#' ? trimmed : fallback;
};

export const buildMobileAccessUrl = ({ protocol, hostValue, fallbackHost, port }) => {
    const rawValue = String(hostValue || fallbackHost || '').trim();
    if (!rawValue) return `${protocol}//${fallbackHost}${port}`;

    if (/^https?:\/\//i.test(rawValue)) {
        try {
            return new URL(rawValue).origin;
        } catch {
            // Fall through and treat it as host text.
        }
    }

    const hostOnly = rawValue
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .trim();
    const hasExplicitPort = /:\d+$/.test(hostOnly);
    return `${protocol}//${hostOnly}${hasExplicitPort ? '' : port}`;
};

export const buildQrImageUrls = (targetUrl, apiBase = '') => {
    const encodedUrl = encodeURIComponent(targetUrl);
    return [
        `${apiBase}/api/mobile-qr?data=${encodedUrl}`,
        `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodedUrl}`,
        `https://quickchart.io/qr?size=200&text=${encodedUrl}`,
    ];
};
