'use strict';
const { createSchemaScreenSettingDefaultRows } = require('../services/schemaScreenSettingsDefaults');

async function migrateLegacyCompatibility(pool) {
    for (const table of ['wgs_users','wgs_posts','wgs_comments','wgs_replies','questions','options','answers']) {
        const [rows] = await pool.query('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [table]);
        if (!rows.length) throw Object.assign(new Error('An existing application database is required.'), { code: 'WGS_BASE_SCHEMA_MISSING' });
    }
    const column = async (table, name) => {
        const [rows] = await pool.query('SELECT DATA_TYPE AS type,CHARACTER_MAXIMUM_LENGTH AS size FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?', [table,name]);
        return rows[0];
    };
    for (const table of ['wgs_posts','wgs_comments','wgs_replies']) {
        const date = await column(table,'date');
        if (!date) throw new Error('Board date column is missing.');
        if (date.type !== 'varchar' || Number(date.size) < 50) await pool.query(`ALTER TABLE ${table} MODIFY COLUMN date VARCHAR(50) DEFAULT NULL`);
    }
    if (!await column('wgs_posts','noticeOrder')) await pool.query('ALTER TABLE wgs_posts ADD COLUMN noticeOrder INT DEFAULT NULL');
    if (!await column('wgs_posts','contentJson')) await pool.query('ALTER TABLE wgs_posts ADD COLUMN contentJson LONGTEXT NULL');
    await pool.query(`CREATE TABLE IF NOT EXISTS wgs_screen_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                page_key VARCHAR(50) NOT NULL,
                section_key VARCHAR(80) NOT NULL DEFAULT 'common',
                setting_type VARCHAR(30) NOT NULL DEFAULT 'text',
                setting_key VARCHAR(100) NOT NULL,
                setting_label VARCHAR(150) NOT NULL,
                setting_value TEXT NULL,
                description TEXT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by VARCHAR(50) NULL,
                updated_by VARCHAR(50) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_wgs_screen_page (page_key),
                INDEX idx_wgs_screen_type (setting_type),
                INDEX idx_wgs_screen_active (is_active),
                UNIQUE KEY uk_wgs_screen_setting (page_key, section_key, setting_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    const defaults = createSchemaScreenSettingDefaultRows();
    // Existing operator copy, visibility, ordering and descriptions are retained.
    // Legacy JSON synchronization is a separate explicitly selected operation.
    for (const row of [...defaults.homeScreenDefaultRowsFix18V9,...defaults.screenSettingDefaultsNoHardcodeV1]) {
        await pool.query(`INSERT IGNORE INTO wgs_screen_settings
            (page_key,section_key,setting_type,setting_key,setting_label,setting_value,description,sort_order,is_active,created_by,updated_by)
            VALUES(?,?,?,?,?,?,?,?,1,'system','system')`, row.slice(0, 8));
    }
    for (const table of ['ipep_random_questions','ipep_past_questions']) {
        const [rows] = await pool.query('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [table]);
        if (rows.length && !await column(table,'explanation_text')) await pool.query(`ALTER TABLE ${table} ADD COLUMN explanation_text TEXT NULL`);
    }
}
module.exports = { migrateLegacyCompatibility };
