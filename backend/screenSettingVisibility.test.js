'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registerSiteManagementRoutes = require('./routes/siteManagementRoutes');
const { createSchemaScreenSettingDefaultRows } = require('./services/schemaScreenSettingsDefaults');
const { RETIRED_SECTION_KEYS, isRetiredScreenSetting, SCREEN_SETTING_VISIBLE_SQL } = require('./services/screenSettingVisibility');

function fixture() {
    const handlers = new Map();
    const queries = [];
    const events = [];
    const rows = [
        { id: 1, page_key: 'home', section_key: 'hero', setting_key: 'title', setting_value: 'Learning', is_active: 1 },
        { id: 2, page_key: 'home', section_key: 'online_users', setting_key: 'title', setting_value: 'Old presence', is_active: 1 },
        { id: 3, page_key: 'multiplayer', section_key: 'scoreboard', setting_key: 'rank_label', setting_value: 'Rank', is_active: 1 },
    ];
    const app = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method, (path, handler) => handlers.set(`${method} ${path}`, handler)]));
    registerSiteManagementRoutes({
        app,
        pool: { query: async (sql, params = []) => {
            queries.push({ sql, params });
            if (sql.includes('COUNT(*) AS total_count')) return [[{ total_count: 2, active_count: 2 }]];
            if (sql.trim().startsWith('SELECT')) return [rows];
            if (sql.trim().startsWith('INSERT')) return [{ affectedRows: 1, insertId: 4 }];
            const row = rows.find(value => value.id === params.at(-1));
            assert.ok(sql.includes(SCREEN_SETTING_VISIBLE_SQL), 'existing-row mutation must enforce visibility in SQL');
            return [{ affectedRows: row && !isRetiredScreenSetting(row) ? 1 : 0 }];
        } },
        validateAdminSession: async () => ({ valid: true, isAdmin: true, user: { id: 'admin' } }),
        io: { emit: (...args) => events.push(args) },
    });
    const call = async (method, path, { body = {}, params = {}, query = {} } = {}) => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
        await handlers.get(`${method} ${path}`)({ body, params, query }, res);
        return res;
    };
    return { call, queries, rows, events };
}

test('retired section filtering is exact and leaves multiplayer and unrelated copy settings available', () => {
    for (const section of RETIRED_SECTION_KEYS) assert.equal(isRetiredScreenSetting({ page_key: 'all', section_key: ` ${section.toUpperCase()} ` }), true);
    assert.equal(isRetiredScreenSetting({ page_key: 'home', section_key: 'copy', setting_key: 'no_personal_ranking_message' }), true);
    for (const row of [
        { page_key: 'multiplayer', section_key: 'scoreboard', setting_key: 'rank_label' },
        { page_key: 'home', section_key: 'hero', setting_key: 'title' },
        { page_key: 'home', section_key: 'copy', setting_key: 'welcome_prefix' },
        { page_key: 'exam', section_key: 'copy', setting_key: 'accuracy_label' },
    ]) assert.equal(isRetiredScreenSetting(row), false);
});

test('startup defaults cannot recreate the removed ranking or chat settings', () => {
    const defaults = createSchemaScreenSettingDefaultRows();
    for (const rows of Object.values(defaults)) {
        assert.ok(rows.length > 0);
        for (const row of rows) assert.equal(isRetiredScreenSetting({ page_key: row[0], section_key: row[1], setting_key: row[3] }), false, JSON.stringify(row.slice(0, 4)));
    }
});

test('public settings and map omit retired rows, while admin list and summary use the same SQL filter', async () => {
    const f = fixture();
    const publicResult = await f.call('get', '/api/screen-settings', { query: { page_key: 'home' } });
    assert.deepEqual(publicResult.body.settings.map(row => row.id), [1, 3]);
    assert.equal(publicResult.body.settingsMap['home.online_users.title'], undefined);
    const adminResult = await f.call('get', '/api/admin/screen-settings');
    assert.deepEqual(adminResult.body.settings.map(row => row.id), [1, 3]);
    assert.equal(adminResult.body.summary.total_count, 2);
    assert.equal(f.queries.length, 3);
    for (const query of f.queries) assert.ok(query.sql.includes(SCREEN_SETTING_VISIBLE_SQL));
    assert.equal(f.rows.length, 3, 'read filtering must retain stored legacy rows');
});

test('creating, updating and bulk upserting retired settings is rejected without a write', async () => {
    const f = fixture();
    for (const [method, path] of [['post', '/api/admin/screen-settings'], ['put', '/api/admin/screen-settings/:id'], ['post', '/api/admin/screen-settings/bulk']]) {
        const res = await f.call(method, path, { params: { id: '1' }, body: { page_key: 'home', section_key: 'online_users', setting_type: 'text', setting_key: 'title', setting_label: 'Old presence' } });
        assert.equal(res.statusCode, 400);
    }
    assert.equal(f.queries.length, 0);
    assert.equal(f.events.length, 0);
});

test('existing retired row cannot be rewritten, toggled or deleted by its known id', async () => {
    const f = fixture();
    const before = structuredClone(f.rows);
    for (const [method, path] of [['put', '/api/admin/screen-settings/:id'], ['patch', '/api/admin/screen-settings/:id/toggle'], ['delete', '/api/admin/screen-settings/:id']]) {
        const res = await f.call(method, path, { params: { id: '2' }, body: { page_key: 'home', section_key: 'hero', setting_type: 'text', setting_key: 'title', setting_label: 'Title' } });
        assert.equal(res.statusCode, 404);
    }
    assert.deepEqual(f.rows, before);
    assert.equal(f.events.length, 0);
});

test('unrelated settings remain editable and keep the screen-settings-updated broadcast', async () => {
    const f = fixture();
    const res = await f.call('patch', '/api/admin/screen-settings/:id/toggle', { params: { id: '1' } });
    assert.equal(res.statusCode, 200);
    assert.equal(f.events[0][0], 'screen-settings-updated');
});
