// Class schedule public and admin routes.
'use strict';

const registerClassScheduleCrudRoutes = require('./classScheduleCrudRoutes');

function registerClassScheduleRoutes(options = {}) {
    const app = options.app;
    const pool = options.pool;

    if (!app || typeof app.get !== 'function') {
        throw new Error('registerClassScheduleRoutes requires an Express app.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('registerClassScheduleRoutes requires a MySQL pool.');
    }

// 관리자 달력 색상/강조 필드를 API 응답에 포함합니다.
// 홈 달력/수업 일정 DB 관리 API
// - 기존 Home.jsx RAW_CSV_DATA는 아직 제거하지 않습니다.
// - 홈 화면은 /api/class-schedules를 사용합니다.
// - 관리자 화면은 /api/admin/class-schedules CRUD API를 사용합니다.

const normalizeClassScheduleDate = (value) => {
    if (!value) return '';

    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return String(value).slice(0, 10);
};

const normalizeClassScheduleRow = (row) => {
    const scheduleType = row.schedule_type || 'class';
    const eventCategory = row.event_category || (scheduleType === 'class'? '수업' : '특수일');
    const eventTitle = row.event_title || row.course_title || '';
    const eventSubtitle = row.event_subtitle || row.topic_title || '';
    const courseTitle = row.course_title || eventCategory || '';
    const topicTitle = row.topic_title || eventTitle || '';

    return {
        id: row.id,
        date: normalizeClassScheduleDate(row.schedule_date),
        schedule_date: normalizeClassScheduleDate(row.schedule_date),
        weekday: row.weekday_label || '',
        weekday_label: row.weekday_label || '',
        day: row.day_no === null || row.day_no === undefined ? null : Number(row.day_no),
        day_no: row.day_no === null || row.day_no === undefined ? null : Number(row.day_no),

        schedule_type: scheduleType,
        event_type: scheduleType,
        event_category: eventCategory,
        event_title: eventTitle,
        event_subtitle: eventSubtitle,
        source_key: row.source_key || '',
        background_color: row.background_color || '',
        text_color: row.text_color || '',
        border_color: row.border_color || '',
        highlight_type: row.highlight_type || 'none',
        admin_note: row.admin_note || '',

        title: scheduleType === 'class'? courseTitle : eventCategory,
        course_title: courseTitle,
        subject: scheduleType === 'class'? topicTitle : eventTitle,
        topic_title: topicTitle,
        memo: row.memo || '',
        sort_order: Number(row.sort_order || 0),
        is_active: Number(row.is_active) ? 1 : 0,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
    };
};

const toNullableInt = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const getWeekdayLabelFromDate = (dateText) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) return '';
    const labels = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const date = new Date(`${dateText}T00:00:00+09:00`);
    return labels[date.getDay()] || '';
};



// 달력 GET API 우선 처리 블록
// - 기존 API보다 위에서 먼저 응답합니다.
// - 홈 공개 API도 class/holiday/exam/application/result/special 전체 활성 일정을 내려줍니다.
// - 관리자 API는 색상/테두리/강조 필드를 확실히 포함합니다.

const classScheduleFs = require('fs');
const classSchedulePath = require('path');
const classScheduleMysql = require('mysql2/promise');

function loadClassScheduleEnvFile(filePath) {
  const env = {};
  if (!classScheduleFs.existsSync(filePath)) return env;

  classScheduleFs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
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

function getClassScheduleDbConfig() {
  const projectRoot = '/home/ubuntu/wgs_deploy/ExamAppProject';

  const env = {
    ...loadClassScheduleEnvFile(classSchedulePath.join(projectRoot, '.env')),
    ...loadClassScheduleEnvFile(classSchedulePath.join(projectRoot, 'backend/.env')),
    ...process.env,
  };

  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || env.MYSQL_USER || '',
    password: env.DB_PASSWORD || env.MYSQL_PASSWORD || '',
    database: env.DB_NAME || env.MYSQL_DATABASE || 'exam_bank',
    dateStrings: true,
  };
}

async function queryClassScheduleDb(sql, params = []) {
  const conn = await classScheduleMysql.createConnection(getClassScheduleDbConfig());

  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    await conn.end();
  }
}

function normalizePublicClassScheduleDate(value) {
  if (!value) return '';

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return String(year) + '-' + month + '-' + day;
  }

  return String(value).slice(0, 10);
}

function normalizePublicClassSchedule(row) {
  const clean = (value) => String(value || '').trim();
  const date = normalizePublicClassScheduleDate(row.schedule_date);
  const scheduleType = clean(row.schedule_type || 'class') || 'class';
  const eventCategory = clean(row.event_category || '');
  const categoryWords = ['공휴일', '시험일', '원서접수', '결과발표', '특별한날', '특수일', '수업일정'];
  const isCategoryWord = (value) => {
    const text = clean(value);
    return Boolean(text) && (text === eventCategory || categoryWords.includes(text));
  };
  const stripCategoryPrefix = (value) => {
    let text = clean(value);
    [eventCategory, ...categoryWords].filter(Boolean).forEach((category) => {
      [' - ', '-', ' : ', ':', '：'].forEach((separator) => {
        const prefix = `${category}${separator}`;
        if (text.startsWith(prefix)) {
          text = text.slice(prefix.length).trim();
        }
      });
    });
    return text;
  };

  const rawCourseTitle = clean(row.course_title || '');
  const rawTopicTitle = clean(row.topic_title || '');
  const rawEventTitle = clean(row.event_title || '');
  const rawEventSubtitle = clean(row.event_subtitle || '');

  const classTitle = rawCourseTitle;
  const classTopic = rawTopicTitle;

  const specialTitle = [rawEventTitle, rawTopicTitle, rawCourseTitle]
    .map(stripCategoryPrefix)
    .find((value) => value && !isCategoryWord(value)) || '';
  const specialSubtitle = [rawEventSubtitle, rawTopicTitle]
    .map(stripCategoryPrefix)
    .find((value) => value && value !== specialTitle && !isCategoryWord(value)) || '';

  const publicTitle = scheduleType === 'class'? classTitle : specialTitle;
  const publicTopic = scheduleType === 'class'? classTopic : specialSubtitle;

  let backgroundColor = row.background_color || (
    scheduleType === 'class'? '#24479f' :
    scheduleType === 'holiday'? '#020617' :
    scheduleType === 'application'? '#10b981' :
    scheduleType === 'exam'? '#7c3aed' :
    scheduleType === 'result'? '#f97316' :
    scheduleType === 'special'? '#facc15' :
    '#24479f'
  );

  let textColor = row.text_color || (
    scheduleType === 'holiday'? '#ef4444' :
    scheduleType === 'special'? '#111827' : '#ffffff'
  );

  let borderColor = row.border_color || backgroundColor;
  let highlightType = row.highlight_type || 'none';

  // 공휴일은 화면에서 빨간 글자 전용으로 처리하고, 카테고리명은 별도 필드에만 보관합니다.
  if (scheduleType === 'holiday') {
    textColor = '#ef4444';
    highlightType = 'none';
  }

  return {
    id: row.id,

    date,
    schedule_date: date,

    weekday: row.weekday_label || '',
    weekday_label: row.weekday_label || '',

    dayNo: row.day_no,
    day_no: row.day_no,

    course: publicTitle,
    courseTitle: publicTitle,
    course_title: publicTitle,

    topic: publicTopic,
    topicTitle: publicTopic,
    topic_title: publicTopic,

    title: publicTitle,
    eventTitle: publicTitle,
    event_title: publicTitle,

    subtitle: publicTopic,
    eventSubtitle: publicTopic,
    event_subtitle: publicTopic,

    eventCategory,
    event_category: eventCategory,

    scheduleType,
    schedule_type: scheduleType,
    eventType: scheduleType,
    event_type: scheduleType,

    originalDateLabel: row.original_date_label || '',
    original_date_label: row.original_date_label || '',

    sortOrder: row.sort_order || 0,
    sort_order: row.sort_order || 0,

    sourceKey: row.source_key || '',
    source_key: row.source_key || '',

    backgroundColor,
    background_color: backgroundColor,

    textColor,
    text_color: textColor,

    borderColor,
    border_color: borderColor,

    highlightType,
    highlight_type: highlightType,

    memo: row.memo || '',
    adminNote: row.admin_note || '',
    admin_note: row.admin_note || '',

    isActive: Number(row.is_active) === 1,
    is_active: Number(row.is_active) === 1 ? 1 : 0,

    updatedAt: row.updated_at || '',
    updated_at: row.updated_at || '',
  };
}

function summarizeClassSchedules(rows) {
  const summary = {
    total: rows.length,
    active_count: rows.filter((row) => Number(row.is_active) === 1).length,
    inactive_count: rows.filter((row) => Number(row.is_active) !== 1).length,
    class_count: rows.filter((row) => (row.schedule_type || 'class') === 'class').length,
    special_count: rows.filter((row) => (row.schedule_type || 'class') !== 'class').length,
    holiday_count: rows.filter((row) => row.schedule_type === 'holiday').length,
    application_count: rows.filter((row) => row.schedule_type === 'application').length,
    exam_count: rows.filter((row) => row.schedule_type === 'exam').length,
    result_count: rows.filter((row) => row.schedule_type === 'result').length,
    special_day_count: rows.filter((row) => row.schedule_type === 'special').length,
    first_date: rows[0] ? normalizePublicClassScheduleDate(rows[0].schedule_date) : null,
    last_date: rows.length ? normalizePublicClassScheduleDate(rows[rows.length - 1].schedule_date) : null,
  };

  return summary;
}

async function fetchClassSchedules(options = {}) {
  const where = [];
  const params = [];

  if (options.onlyActive) {
    where.push('is_active = 1');
  }

  if (options.type && options.type !== 'all') {
    where.push('schedule_type = ?');
    params.push(options.type);
  }

  if (options.status === 'active') {
    where.push('is_active = 1');
  }

  if (options.status === 'inactive') {
    where.push('is_active = 0');
  }

  if (options.keyword) {
    where.push(`
      (
        course_title LIKE ?
        OR topic_title LIKE ?
        OR event_title LIKE ?
        OR event_subtitle LIKE ?
        OR event_category LIKE ?
        OR source_key LIKE ?
        OR admin_note LIKE ?
        OR memo LIKE ?
      )
    `);

    const like = '%' + options.keyword + '%';
    params.push(like, like, like, like, like, like, like, like);
  }

  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  return await queryClassScheduleDb(
    `SELECT
        id,
        DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
        weekday_label,
        day_no,
        course_title,
        topic_title,
        original_date_label,
        sort_order,
        is_active,
        COALESCE(schedule_type, 'class') AS schedule_type,
        COALESCE(event_category, '') AS event_category,
        COALESCE(event_title, '') AS event_title,
        COALESCE(event_subtitle, '') AS event_subtitle,
        COALESCE(source_key, '') AS source_key,
        COALESCE(background_color, '') AS background_color,
        COALESCE(text_color, '') AS text_color,
        COALESCE(border_color, '') AS border_color,
        COALESCE(highlight_type, 'none') AS highlight_type,
        COALESCE(admin_note, '') AS admin_note,
        COALESCE(memo, '') AS memo,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM wgs_class_schedules
      ${whereSql}
      ORDER BY schedule_date ASC, sort_order ASC, id ASC
    `,
    params
  );
}

app.get('/api/class-schedules', async (req, res) => {
  try {
    const rows = await fetchClassSchedules({
      onlyActive: true,
    });

    const schedules = rows.map(normalizePublicClassSchedule);

    res.json({
      success: true,
      source: 'db-class-schedules',
      fallbackAvailable: true,
      count: schedules.length,
      summary: summarizeClassSchedules(rows),
      schedules,
    });
  } catch (error) {
    console.error('[class-schedules] public calendar API failed', error);

    res.status(500).json({
      success: false,
      message: '달력 일정 DB API 조회 중 오류가 발생했습니다. Home.jsx RAW_CSV_DATA fallback을 사용하세요.',
      error: error.message,
      schedules: [],
    });
  }
});

app.get('/api/admin/class-schedules', async (req, res) => {
  try {
    const includeInactive =
      String(req.query.includeInactive || '').toLowerCase() === '1' ||
      String(req.query.includeInactive || '').toLowerCase() === 'true';

    const active = String(req.query.active || '').trim();
    const status = active === '1'? 'active' : active === '0'? 'inactive' : String(req.query.status || '').trim();
    const type = String(req.query.type || req.query.schedule_type || 'all').trim();
    const keyword = String(req.query.keyword || req.query.q || req.query.search || '').trim();

    const rows = await fetchClassSchedules({
      onlyActive: includeInactive ? false : false,
      status,
      type,
      keyword,
    });

    const schedules = rows.map(normalizePublicClassSchedule);

    res.json({
      success: true,
      source: 'db-class-schedules-admin',
      count: schedules.length,
      summary: summarizeClassSchedules(rows),
      schedules,
    });
  } catch (error) {
    console.error('[admin/class-schedules] calendar API failed', error);

    res.status(500).json({
      success: false,
      message: '관리자 달력 일정 조회 중 오류가 발생했습니다.',
      error: error.message,
      schedules: [],
    });
  }
});

app.get('/api/class-schedules', async (req, res) => {
    try {
        const includeInactive = String(req.query.includeInactive || '') === '1';
        const whereSql = includeInactive
            ? "WHERE COALESCE(schedule_type, 'class') = 'class'"
            : "WHERE is_active = 1 AND COALESCE(schedule_type, 'class') = 'class'";

        const [rows] = await pool.query(
            `SELECT
                    id,
                    schedule_type,
                    event_category,
                    DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
                    weekday_label,
                    day_no,
                    course_title,
                    topic_title,
                    event_title,
                    event_subtitle,
                    source_key,
                    background_color,
                    text_color,
                    border_color,
                    highlight_type,
                    admin_note,
                    memo,
                    sort_order,
                    is_active,
                    created_at,
                    updated_at
                FROM wgs_class_schedules
                ${whereSql}
                ORDER BY schedule_date ASC, sort_order ASC, id ASC
            `
        );

        res.json({
            success: true,
            schedules: rows.map(normalizeClassScheduleRow)
        });
    } catch (error) {
        console.error('[class-schedules] public list failed:', error);
        res.status(500).json({
            success: false,
            message: '달력 일정 목록을 불러오지 못했습니다.'
        });
    }
});

app.get('/api/admin/class-schedules', async (req, res) => {
    try {
        const keyword = String(req.query.keyword || '').trim();
        const active = String(req.query.active || '').trim();

        const where = [];
        const params = [];

        if (keyword) {
            where.push('(course_title LIKE ? OR topic_title LIKE ? OR memo LIKE ? OR original_date_label LIKE ?)');
            const like = `%${keyword}%`;
            params.push(like, like, like, like);
        }

        if (active === '1' || active === '0') {
            where.push('is_active = ?');
            params.push(Number(active));
        }

        const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

        const [rows] = await pool.query(
            `SELECT
                    id,
                    schedule_type,
                    event_category,
                    DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
                    weekday_label,
                    day_no,
                    course_title,
                    topic_title,
                    event_title,
                    event_subtitle,
                    source_key,
                    original_date_label,
                    memo,
                    sort_order,
                    is_active,
                    created_at,
                    updated_at
                FROM wgs_class_schedules
                ${whereSql}
                ORDER BY schedule_date ASC, sort_order ASC, id ASC
            `,
            params
        );

        const [[summary]] = await pool.query(
            `SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
                    SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_count,
                    SUM(CASE WHEN schedule_type = 'class'THEN 1 ELSE 0 END) AS class_count,
                    SUM(CASE WHEN schedule_type <> 'class'THEN 1 ELSE 0 END) AS special_count,
                    SUM(CASE WHEN schedule_type = 'holiday'THEN 1 ELSE 0 END) AS holiday_count,
                    SUM(CASE WHEN schedule_type = 'application'THEN 1 ELSE 0 END) AS application_count,
                    SUM(CASE WHEN schedule_type = 'exam'THEN 1 ELSE 0 END) AS exam_count,
                    SUM(CASE WHEN schedule_type = 'result'THEN 1 ELSE 0 END) AS result_count,
                    SUM(CASE WHEN schedule_type = 'special'THEN 1 ELSE 0 END) AS special_day_count,
                    MIN(schedule_date) AS first_date,
                    MAX(schedule_date) AS last_date
                FROM wgs_class_schedules
            `
        );

        res.json({
            success: true,
            schedules: rows.map(normalizeClassScheduleRow),
            summary: {
                total: Number(summary.total || 0),
                active_count: Number(summary.active_count || 0),
                inactive_count: Number(summary.inactive_count || 0),
                class_count: Number(summary.class_count || 0),
                special_count: Number(summary.special_count || 0),
                holiday_count: Number(summary.holiday_count || 0),
                application_count: Number(summary.application_count || 0),
                exam_count: Number(summary.exam_count || 0),
                result_count: Number(summary.result_count || 0),
                special_day_count: Number(summary.special_day_count || 0),
                first_date: normalizeClassScheduleDate(summary.first_date),
                last_date: normalizeClassScheduleDate(summary.last_date)
            }
        });
    } catch (error) {
        console.error('[admin/class-schedules] list failed:', error);
        res.status(500).json({
            success: false,
            message: '관리자 달력 일정 목록을 불러오지 못했습니다.'
        });
    }
});



registerClassScheduleCrudRoutes({
  app,
  pool,
  normalizeClassScheduleRow,
  toNullableInt,
  getWeekdayLabelFromDate,
});

}

module.exports = registerClassScheduleRoutes;
