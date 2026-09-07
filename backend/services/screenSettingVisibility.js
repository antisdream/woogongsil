'use strict';

// Keep stored legacy rows for rollback; exclude only the retired feature keys.
const RETIRED_SECTION_KEYS = Object.freeze(['live_chat', 'chat_popup', 'score_ranking', 'ranking_history', 'ranking']);
const RETIRED_HOME_COPY_KEYS = Object.freeze([
    'current_visitor_prefix', 'current_visitor_suffix', 'refresh_loading_label',
    'request_time_label', 'me_label', 'recent_activity_label', 'just_now_label',
    'accuracy_label', 'rank_suffix', 'score_suffix', 'no_personal_ranking_message',
]);
const retiredCopyKeys = new Set(RETIRED_HOME_COPY_KEYS.flatMap(key => [key, `home.copy.${key}`]));
const normalize = value => String(value ?? '').trim().toLowerCase();

function isRetiredScreenSetting(row = {}) {
    const section = normalize(row.section_key ?? row.sectionKey);
    if (RETIRED_SECTION_KEYS.includes(section)) return true;
    return ['home', 'all'].includes(normalize(row.page_key ?? row.pageKey))
        && section === 'copy'
        && retiredCopyKeys.has(normalize(row.setting_key ?? row.settingKey));
}

// Values are fixed source constants, never request input.
const literals = values => values.map(value => `'${value}'`).join(', ');
const SCREEN_SETTING_VISIBLE_SQL = `NOT (
    LOWER(TRIM(COALESCE(section_key, ''))) IN (${literals(RETIRED_SECTION_KEYS)})
    OR (LOWER(TRIM(COALESCE(page_key, ''))) IN ('home', 'all')
        AND LOWER(TRIM(COALESCE(section_key, ''))) = 'copy'
        AND LOWER(TRIM(COALESCE(setting_key, ''))) IN (${literals([...retiredCopyKeys])}))
)`;

module.exports = { RETIRED_SECTION_KEYS, RETIRED_HOME_COPY_KEYS, isRetiredScreenSetting, SCREEN_SETTING_VISIBLE_SQL };
