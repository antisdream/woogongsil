const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = '/home/ubuntu/wgs_deploy/ExamAppProject';
const HOME_PATH = path.join(PROJECT_ROOT, 'frontend/src/pages/Home.jsx');

function requireMysql2Promise() {
  const candidates = [
    path.join(PROJECT_ROOT, 'backend/node_modules/mysql2/promise'),
    path.join(PROJECT_ROOT, 'node_modules/mysql2/promise'),
    'mysql2/promise',
  ];

  for (const target of candidates) {
    try {
      return require(target);
    } catch (error) {}
  }

  throw new Error('mysql2/promise 모듈을 찾지 못했습니다.');
}

const mysql = requireMysql2Promise();

function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  });

  return env;
}

function getKoreanWeekday(dateStr) {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  const labels = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  if (Number.isNaN(date.getTime())) return '';
  return labels[date.getDay()];
}

function compactKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function readConstObjectBlock(source, constName) {
  const startRegex = new RegExp(`const\\s+${constName}\\s*=\\s*\\{`, 'm');
  const match = startRegex.exec(source);

  if (!match) return '';

  let start = match.index;
  let braceStart = source.indexOf('{', match.index);
  let depth = 0;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }

  return '';
}

function extractHolidays() {
  const source = fs.readFileSync(HOME_PATH, 'utf8');
  const block = readConstObjectBlock(source, 'HOLIDAYS');

  if (!block) {
    return {
      blockFound: false,
      holidays: [],
      blockPreview: '',
    };
  }

  const holidays = [];
  const seen = new Set();

  const objectEntryRegex = /['"`](\d{4}-\d{2}-\d{2})['"`]\s*:\s*\{([^{}]*)\}/g;

  for (const match of block.matchAll(objectEntryRegex)) {
    const date = match[1];
    const body = match[2];

    const nameMatch =
      body.match(/name\s*:\s*['"`]([^'"`]+)['"`]/) ||
      body.match(/title\s*:\s*['"`]([^'"`]+)['"`]/) ||
      body.match(/label\s*:\s*['"`]([^'"`]+)['"`]/);

    const isGraduation = /isGraduation\s*:\s*true/.test(body);

    const name = nameMatch?.[1]?.trim() || (isGraduation ? '수료일' : '공휴일');
    const category = isGraduation ? '특별한날' : '공휴일';
    const scheduleType = isGraduation ? 'special' : 'holiday';

    const key = `${date}|${scheduleType}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    holidays.push({
      schedule_date: date,
      weekday_label: getKoreanWeekday(date),
      schedule_type: scheduleType,
      event_category: category,
      event_title: name,
      event_subtitle: isGraduation ? '수료/기념일' : '',
      course_title: category,
      topic_title: name,
      original_date_label: `${date} ${category} ${name}`,
      memo: `[자동 이관:HOLIDAYS] Home.jsx HOLIDAYS에서 이관`,
      source_key: `home-${scheduleType}-${date}-${compactKey(name)}`,
      sort_order: scheduleType === 'holiday' ? 8000 + holidays.length : 8500 + holidays.length,
    });
  }

  return {
    blockFound: true,
    holidays,
    blockPreview: block.slice(0, 1200),
  };
}

async function main() {
  const rootEnv = loadEnvFile(path.join(PROJECT_ROOT, '.env'));
  const backendEnv = loadEnvFile(path.join(PROJECT_ROOT, 'backend/.env'));
  const env = { ...rootEnv, ...backendEnv, ...process.env };

  const dbConfig = {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'exambank',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || env.DB_DATABASE || 'exam_bank',
  };

  console.log('[DB 연결 정보 확인]');
  console.log({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
    password: dbConfig.password ? '***숨김***' : '(비어있음)',
  });

  const { blockFound, holidays, blockPreview } = extractHolidays();

  console.log('');
  console.log('[HOLIDAYS 추출 결과]');
  console.log({
    blockFound,
    count: holidays.length,
  });

  if (!blockFound) {
    console.log('HOLIDAYS 블록을 찾지 못했습니다.');
  } else {
    console.log('[HOLIDAYS 블록 미리보기]');
    console.log(blockPreview);
  }

  console.table(holidays.map((holiday) => ({
    date: holiday.schedule_date,
    type: holiday.schedule_type,
    category: holiday.event_category,
    title: holiday.event_title,
  })));

  const conn = await mysql.createConnection(dbConfig);

  try {
    let inserted = 0;
    let updated = 0;

    for (const holiday of holidays) {
      const [result] = await conn.execute(
        `
          INSERT INTO wgs_class_schedules
            (
              schedule_type,
              event_category,
              schedule_date,
              weekday_label,
              day_no,
              course_title,
              topic_title,
              event_title,
              event_subtitle,
              original_date_label,
              memo,
              source_key,
              sort_order,
              is_active
            )
          VALUES
            (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON DUPLICATE KEY UPDATE
            schedule_type = VALUES(schedule_type),
            event_category = VALUES(event_category),
            weekday_label = VALUES(weekday_label),
            course_title = VALUES(course_title),
            topic_title = VALUES(topic_title),
            event_title = VALUES(event_title),
            event_subtitle = VALUES(event_subtitle),
            original_date_label = VALUES(original_date_label),
            memo = VALUES(memo),
            sort_order = VALUES(sort_order),
            is_active = VALUES(is_active),
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          holiday.schedule_type,
          holiday.event_category,
          holiday.schedule_date,
          holiday.weekday_label,
          holiday.course_title,
          holiday.topic_title,
          holiday.event_title,
          holiday.event_subtitle,
          holiday.original_date_label,
          holiday.memo,
          holiday.source_key,
          holiday.sort_order,
        ]
      );

      if (result.affectedRows === 1) inserted += 1;
      else updated += 1;
    }

    const [summaryRows] = await conn.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN schedule_type = 'class' THEN 1 ELSE 0 END) AS class_count,
        SUM(CASE WHEN schedule_type <> 'class' THEN 1 ELSE 0 END) AS special_count,
        SUM(CASE WHEN schedule_type = 'holiday' THEN 1 ELSE 0 END) AS holiday_count,
        SUM(CASE WHEN schedule_type = 'application' THEN 1 ELSE 0 END) AS application_count,
        SUM(CASE WHEN schedule_type = 'exam' THEN 1 ELSE 0 END) AS exam_count,
        SUM(CASE WHEN schedule_type = 'result' THEN 1 ELSE 0 END) AS result_count,
        SUM(CASE WHEN schedule_type = 'special' THEN 1 ELSE 0 END) AS special_day_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
        DATE_FORMAT(MIN(schedule_date), '%Y-%m-%d') AS first_date,
        DATE_FORMAT(MAX(schedule_date), '%Y-%m-%d') AS last_date
      FROM wgs_class_schedules
    `);

    const [holidayRows] = await conn.query(`
      SELECT
        id,
        schedule_type,
        event_category,
        DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
        weekday_label,
        course_title,
        topic_title,
        event_title,
        is_active
      FROM wgs_class_schedules
      WHERE schedule_type IN ('holiday', 'special')
      ORDER BY schedule_date ASC, sort_order ASC, id ASC
    `);

    console.log('');
    console.log('[DB 저장 결과]');
    console.log({
      extracted_holidays: holidays.length,
      inserted,
      updated,
      summary: summaryRows[0],
    });

    console.log('');
    console.log('[공휴일/특별한날 목록]');
    console.table(holidayRows);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('');
  console.error('[STEP17-6C ERROR]');
  console.error(error);
  process.exitCode = 1;
});
