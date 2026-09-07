const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = '/home/ubuntu/wgs_deploy/ExamAppProject';
const HOME_PATH = path.join(PROJECT_ROOT, 'frontend/src/pages/Home.jsx');

function requireMysql2Promise() {
  const candidates = [
    path.join(PROJECT_ROOT, 'backend/node_modules/mysql2/promise'),
    path.join(PROJECT_ROOT, 'node_modules/mysql2/promise'),
    'mysql2/promise'
  ];

  for (const target of candidates) {
    try {
      return require(target);
    } catch (error) {
      // 다음 후보 확인
    }
  }

  throw new Error('mysql2/promise 모듈을 찾지 못했습니다. backend 폴더에서 npm install 상태를 확인해야 합니다.');
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

function normalizeDate(raw) {
  if (!raw) return '';

  const text = String(raw).trim();

  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  m = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;

  return '';
}

function getKoreanWeekday(dateStr) {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  const labels = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  if (Number.isNaN(date.getTime())) return '';
  return labels[date.getDay()];
}

function classifyEvent(title, context = '') {
  const text = `${title} ${context}`;

  if (/원서|접수|Application|q-net|큐넷/i.test(text)) return 'application';
  if (/결과|발표|합격|점수/i.test(text)) return 'result';
  if (/시험|필기|실기|검정/i.test(text)) return 'exam';
  if (/공휴|휴일|대체|설날|추석|삼일절|어린이날|현충일|광복절|개천절|한글날|성탄|크리스마스|부처|석가|신정/i.test(text)) return 'holiday';

  return 'special';
}

function categoryLabel(type) {
  if (type === 'holiday') return '공휴일';
  if (type === 'application') return '원서접수';
  if (type === 'exam') return '시험일';
  if (type === 'result') return '결과발표';
  return '특수일';
}

function compactKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function removeRawCsvData(source) {
  return source.replace(/const\s+RAW_CSV_DATA\s*=\s*`[\s\S]*?`;/m, ' ');
}

function getProp(block, names) {
  for (const name of names) {
    const re = new RegExp(`${name}\\s*:\\s*['"\`]([^'"\`]{1,300})['"\`]`, 'i');
    const match = block.match(re);
    if (match) return match[1].trim();
  }

  return '';
}

function extractTitleFromContext(context) {
  const quoted = [...String(context || '').matchAll(/['"`]([^'"`]{1,100})['"`]/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .filter((v) => /[가-힣A-Za-z]/.test(v))
    .filter((v) => /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/.test(v) === false)
    .filter((v) => /^(date|title|label|type|holiday|event|special|exam|application|result|class)$/i.test(v) === false);

  const keywordTitle = quoted.find((v) =>
    /공휴|휴일|대체|설날|추석|삼일절|어린이|현충|광복|개천|한글|성탄|크리스마스|부처|석가|신정|시험|필기|실기|원서|접수|결과|발표|합격/i.test(v)
  );

  return keywordTitle || quoted[0] || '';
}

function extractSpecialEventsFromHome() {
  const raw = fs.readFileSync(HOME_PATH, 'utf8');
  const source = removeRawCsvData(raw);

  const keywordRegex = /공휴|휴일|대체|설날|추석|삼일절|어린이날|현충일|광복절|개천절|한글날|성탄|크리스마스|부처|석가|신정|시험|필기|실기|원서|접수|결과|발표|합격|q-net|Q-net|큐넷|holiday|special|exam|application|result/i;

  const candidates = new Map();

  const addEvent = ({ date, title, detail, context, sourceKind }) => {
    const scheduleDate = normalizeDate(date);
    if (!scheduleDate) return;

    const eventTitle = String(title || '').replace(/\s+/g, ' ').trim();
    if (!eventTitle) return;

    const type = classifyEvent(eventTitle, context);
    const eventCategory = categoryLabel(type);
    const eventSubtitle = String(detail || '').replace(/\s+/g, ' ').trim();

    const key = `${scheduleDate}|${type}|${eventTitle}`;
    if (candidates.has(key)) return;

    candidates.set(key, {
      schedule_date: scheduleDate,
      weekday_label: getKoreanWeekday(scheduleDate),
      schedule_type: type,
      event_category: eventCategory,
      event_title: eventTitle,
      event_subtitle: eventSubtitle,
      course_title: eventCategory,
      topic_title: eventSubtitle ? `${eventTitle} - ${eventSubtitle}` : eventTitle,
      original_date_label: `${scheduleDate} ${eventCategory} ${eventTitle}`,
      memo: `[자동 이관:${sourceKind}] Home.jsx 하드코딩 특수일에서 이관`,
      source_key: `home-${type}-${scheduleDate}-${compactKey(eventTitle)}`,
      sort_order: 9000 + candidates.size
    });
  };

  const objectRegex = /\{[^{}]{0,1600}?\}/g;
  for (const match of source.matchAll(objectRegex)) {
    const block = match[0];
    const date =
      getProp(block, ['schedule_date', 'date', 'day', 'startDate', 'targetDate']) ||
      (block.match(/['"`](\d{4}[-/.]\d{1,2}[-/.]\d{1,2})['"`]/) || [])[1];

    if (!date) continue;

    const title =
      getProp(block, ['event_title', 'title', 'label', 'name', 'holidayName', 'text']) ||
      extractTitleFromContext(block);

    const detail = getProp(block, ['event_subtitle', 'subtitle', 'description', 'desc', 'memo', 'content']);

    if (!keywordRegex.test(block) && !keywordRegex.test(title) && !keywordRegex.test(detail)) continue;

    addEvent({
      date,
      title,
      detail,
      context: block,
      sourceKind: 'object'
    });
  }

  const mapRegex = /['"`](\d{4}[-/.]\d{1,2}[-/.]\d{1,2})['"`]\s*:\s*['"`]([^'"`]{1,180})['"`]/g;
  for (const match of source.matchAll(mapRegex)) {
    const full = match[0];
    const date = match[1];
    const title = match[2];

    if (!keywordRegex.test(full) && !keywordRegex.test(title)) continue;

    addEvent({
      date,
      title,
      detail: '',
      context: full,
      sourceKind: 'map'
    });
  }

  const arrayRegex = /\[\s*['"`](\d{4}[-/.]\d{1,2}[-/.]\d{1,2})['"`]\s*,\s*['"`]([^'"`]{1,180})['"`][^\]]{0,400}\]/g;
  for (const match of source.matchAll(arrayRegex)) {
    const full = match[0];
    const date = match[1];
    const title = match[2];

    if (!keywordRegex.test(full) && !keywordRegex.test(title)) continue;

    addEvent({
      date,
      title,
      detail: '',
      context: full,
      sourceKind: 'array'
    });
  }

  return [...candidates.values()].sort((a, b) => {
    if (a.schedule_date !== b.schedule_date) return a.schedule_date.localeCompare(b.schedule_date);
    return a.event_title.localeCompare(b.event_title);
  });
}

async function ensureColumn(conn, tableName, columnName, ddl) {
  const [rows] = await conn.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  if (rows.length === 0) {
    await conn.query(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
    console.log(`[컬럼 추가] ${columnName}`);
  } else {
    console.log(`[컬럼 유지] ${columnName}`);
  }
}

async function ensureIndex(conn, tableName, indexName, ddl) {
  const [rows] = await conn.query(
    `
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1
    `,
    [tableName, indexName]
  );

  if (rows.length === 0) {
    await conn.query(ddl);
    console.log(`[인덱스 추가] ${indexName}`);
  } else {
    console.log(`[인덱스 유지] ${indexName}`);
  }
}

async function dropOldUniqueDateDayIndexes(conn) {
  const [rows] = await conn.query(`
    SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wgs_class_schedules'
      AND NON_UNIQUE = 0
      AND INDEX_NAME <> 'PRIMARY'
    ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `);

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.INDEX_NAME)) grouped.set(row.INDEX_NAME, []);
    grouped.get(row.INDEX_NAME).push(row.COLUMN_NAME);
  }

  for (const [indexName, columns] of grouped.entries()) {
    const key = columns.join(',');
    if (key === 'schedule_date' || key === 'schedule_date,day_no') {
      await conn.query(`ALTER TABLE wgs_class_schedules DROP INDEX \`${indexName}\``);
      console.log(`[기존 고유 인덱스 제거] ${indexName} / ${key}`);
    }
  }
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
    password: dbConfig.password ? '***숨김***' : '(비어있음)'
  });

  const events = extractSpecialEventsFromHome();

  console.log('');
  console.log('[Home.jsx 특수일 추출 결과]');
  console.log(`추출된 특수일 후보: ${events.length}개`);
  console.table(events.slice(0, 30).map((event) => ({
    date: event.schedule_date,
    type: event.schedule_type,
    category: event.event_category,
    title: event.event_title,
    subtitle: event.event_subtitle
  })));

  const conn = await mysql.createConnection(dbConfig);

  try {
    await ensureColumn(conn, 'wgs_class_schedules', 'schedule_type', "schedule_type VARCHAR(30) NOT NULL DEFAULT 'class' COMMENT 'class/holiday/exam/application/result/special' AFTER id");
    await ensureColumn(conn, 'wgs_class_schedules', 'event_category', "event_category VARCHAR(50) NULL COMMENT '공휴일/시험일/원서접수/결과발표/특수일' AFTER schedule_type");
    await ensureColumn(conn, 'wgs_class_schedules', 'event_title', "event_title VARCHAR(255) NULL COMMENT '특수일 제목' AFTER topic_title");
    await ensureColumn(conn, 'wgs_class_schedules', 'event_subtitle', "event_subtitle TEXT NULL COMMENT '특수일 설명' AFTER event_title");
    await ensureColumn(conn, 'wgs_class_schedules', 'source_key', "source_key VARCHAR(191) NULL COMMENT '자동 이관 중복 방지 키' AFTER memo");

    await conn.query(`
      UPDATE wgs_class_schedules
      SET schedule_type = 'class',
          event_category = COALESCE(event_category, '수업'),
          event_title = COALESCE(event_title, course_title),
          event_subtitle = COALESCE(event_subtitle, topic_title)
      WHERE schedule_type IS NULL
         OR schedule_type = ''
         OR schedule_type = 'class'
    `);

    await dropOldUniqueDateDayIndexes(conn);

    await ensureIndex(
      conn,
      'wgs_class_schedules',
      'idx_wgs_class_schedules_date',
      'CREATE INDEX idx_wgs_class_schedules_date ON wgs_class_schedules(schedule_date)'
    );

    await ensureIndex(
      conn,
      'wgs_class_schedules',
      'idx_wgs_class_schedules_type_date',
      'CREATE INDEX idx_wgs_class_schedules_type_date ON wgs_class_schedules(schedule_type, schedule_date)'
    );

    await ensureIndex(
      conn,
      'wgs_class_schedules',
      'uq_wgs_class_schedules_type_date_day',
      'CREATE UNIQUE INDEX uq_wgs_class_schedules_type_date_day ON wgs_class_schedules(schedule_type, schedule_date, day_no)'
    );

    await ensureIndex(
      conn,
      'wgs_class_schedules',
      'uq_wgs_class_schedules_source_key',
      'CREATE UNIQUE INDEX uq_wgs_class_schedules_source_key ON wgs_class_schedules(source_key)'
    );

    let inserted = 0;
    let updated = 0;

    for (const event of events) {
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
          event.schedule_type,
          event.event_category,
          event.schedule_date,
          event.weekday_label,
          event.course_title,
          event.topic_title,
          event.event_title,
          event.event_subtitle,
          event.original_date_label,
          event.memo,
          event.source_key,
          event.sort_order
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
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
        MIN(schedule_date) AS first_date,
        MAX(schedule_date) AS last_date
      FROM wgs_class_schedules
    `);

    const [sampleRows] = await conn.query(`
      SELECT
        id,
        schedule_type,
        event_category,
        DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
        weekday_label,
        day_no,
        course_title,
        topic_title,
        event_title,
        is_active
      FROM wgs_class_schedules
      ORDER BY schedule_date ASC, sort_order ASC, id ASC
      LIMIT 40
    `);

    console.log('');
    console.log('[DB 저장 결과]');
    console.log({
      extracted_events: events.length,
      inserted,
      updated,
      summary: summaryRows[0]
    });

    console.log('');
    console.log('[목록 샘플 40개]');
    console.table(sampleRows);

    if (events.length === 0) {
      console.log('');
      console.log('[주의] Home.jsx에서 특수일 후보를 찾지 못했습니다.');
      console.log('아래 grep 결과를 확인해서 실제 상수명을 기준으로 한 번 더 추출해야 합니다.');
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('');
  console.error('[STEP17-6B ERROR]');
  console.error(error);
  process.exitCode = 1;
});
