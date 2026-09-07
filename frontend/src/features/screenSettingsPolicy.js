const RETIRED_SCREEN_SECTIONS = new Set([
    'live_chat', 'chat_popup', 'score_ranking', 'ranking_history', 'ranking',
]);

export const isRetiredScreenSection = (section) => (
    RETIRED_SCREEN_SECTIONS.has(String(section || '').trim().toLowerCase())
);

export const isRetiredScreenSettingPath = (path) => {
    const parts = String(path || '').split('.').filter(Boolean);
    return isRetiredScreenSection(parts.length >= 3 ? parts[1] : parts[0]);
};
