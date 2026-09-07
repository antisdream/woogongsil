const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex < 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function main() {
  const project = process.argv[2] || path.join(process.cwd(), '..');
  const backendDir = path.join(project, 'backend');
  const env = { ...process.env, ...loadEnv(path.join(backendDir, '.env')) };
  const dbConfig = {
    host: env.DB_HOST || 'localhost',
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || env.DB_PASS || '',
    database: env.DB_NAME || env.DB_DATABASE || 'exam_bank_aws',
    port: Number(env.DB_PORT || 3306),
  };

  const conn = await mysql.createConnection(dbConfig);

  const [summary] = await conn.query(`
    SELECT
      page_key,
      section_key,
      COUNT(*) AS total_count,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_count
    FROM wgs_screen_settings
    WHERE page_key = 'home'
    GROUP BY page_key, section_key
    ORDER BY section_key
  `);

  const [legacyActive] = await conn.query(`
    SELECT id, page_key, section_key, setting_key, setting_label, is_active
    FROM wgs_screen_settings
    WHERE page_key = 'home'
      AND section_key = 'copy'
      AND setting_key LIKE 'home.copy.%'
      AND is_active = 1
    ORDER BY id
  `);

  const [activeNonCopy] = await conn.query(`
    SELECT section_key, COUNT(*) AS active_count
    FROM wgs_screen_settings
    WHERE page_key = 'home'
      AND section_key <> 'copy'
      AND is_active = 1
    GROUP BY section_key
    ORDER BY section_key
  `);

  console.log('');
  console.log('=== HOME SETTINGS SUMMARY ===');
  console.table(summary);

  console.log('');
  console.log('=== ACTIVE LEGACY home.copy.* ROWS SHOULD BE 0 ===');
  console.table(legacyActive);

  console.log('');
  console.log('=== ACTIVE HOME SETTINGS BY CURRENT SECTIONS ===');
  console.table(activeNonCopy);

  await conn.end();

  if (legacyActive.length > 0) {
    console.error('CHECK_FAILED: active legacy home.copy.* rows remain: ' + legacyActive.length);
    process.exit(2);
  }

  console.log('CHECK_DONE: legacy home.copy.* rows are inactive.');
}

main().catch((err) => {
  console.error('DB_CHECK_FAILED');
  console.error(err.message);
  process.exit(1);
});
