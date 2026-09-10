// The native WebView already appends this app token. Screen width and a generic
// Android user agent must not turn the mobile website into the app preview.
// This is a presentation choice only, never an authentication boundary.
export function getHomeHeroMotionVariant(userAgent) {
    return typeof userAgent === 'string'
        && /(?:^|\s)WoogongsilAndroid\/\d+(?:\.\d+)*(?:\s|$)/.test(userAgent)
        ? 'story'
        : 'book';
}
