import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetiredScreenSection, isRetiredScreenSettingPath } from './screenSettingsPolicy.js';

test('retired screen sections match the server policy after trimming and case normalization', () => {
    for (const section of ['online_users', 'live_chat', 'chat_popup', 'score_ranking', 'ranking_history', 'ranking']) {
        assert.equal(isRetiredScreenSection(` ${section.toUpperCase()} `), true);
        assert.equal(isRetiredScreenSettingPath(`${section}.title`), true);
        assert.equal(isRetiredScreenSettingPath(`home.${section}.title`), true);
    }
});

test('personal result labels and unrelated settings remain available', () => {
    for (const section of ['result', 'hero', 'ranking_help']) {
        assert.equal(isRetiredScreenSection(section), false);
        assert.equal(isRetiredScreenSettingPath(`${section}.title`), false);
        assert.equal(isRetiredScreenSettingPath(`home.${section}.title`), false);
    }
});
