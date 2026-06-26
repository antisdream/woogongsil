// Class schedule admin CRUD routes.
'use strict';

function registerClassScheduleCrudRoutes(options = {}) {
  const app = options.app;
  const pool = options.pool;
  const normalizeClassScheduleRow = options.normalizeClassScheduleRow;
  const toNullableInt = options.toNullableInt;
  const getWeekdayLabelFromDate = options.getWeekdayLabelFromDate;

  const required = { app, pool, normalizeClassScheduleRow, toNullableInt, getWeekdayLabelFromDate };
  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === null)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`registerClassScheduleCrudRoutes missing dependencies: ${missing.join(', ')}`);
  }

// 달력 일정 색상/테두리/강조 타입까지 저장하는 관리자 CRUD 우선 라우트
// - 기존 라우트보다 앞에 배치하여 먼저 응답합니다.
// - 기존 홈/관리자 GET API와 충돌하지 않도록 POST/PUT//DELETE만 처리합니다.

const classScheduleColumnCache = { value: null };

// mysql2/promise pool.query()는 [rowsOrResult, fields] 형태로 반환됩니다.
// SELECT는 rows 배열, INSERT/UPDATE/DELETE는 ResultSetHeader 객체를 꺼내야 insertId/affectedRows를 읽을 수 있습니다.
async function queryClassScheduleCrudDb(sql, params = []) {
  if (typeof pool !== 'undefined' && pool && typeof pool.query === 'function') {
    const result = await pool.query(sql, params);
    return Array.isArray(result) ? result[0] : result;
  }

  if (typeof db !== 'undefined' && db && typeof db.query === 'function') {
    return await new Promise((resolve, reject) => {
      db.query(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  if (typeof connection !== 'undefined' && connection && typeof connection.query === 'function') {
    return await new Promise((resolve, reject) => {
      connection.query(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  throw new Error('DB 연결 객체(pool/db/connection)를 찾지 못했습니다.');
}

async function getClassScheduleColumns() {
  if (classScheduleColumnCache.value) return classScheduleColumnCache.value;

  const rows = await queryClassScheduleCrudDb('SHOW COLUMNS FROM wgs_class_schedules');
  const columns = new Set(rows.map((row) => row.Field));
  classScheduleColumnCache.value = columns;
  return columns;
}

function toClassScheduleDateText(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return String(value).slice(0, 10);
}

function getClassScheduleWeekday(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return '';
  const labels = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const date = new Date(dateText + 'T00:00:00+09:00');
  return labels[date.getDay()] || '';
}

function safeClassScheduleColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text : fallback;
}

function getDefaultClassScheduleStyle(type) {
  const scheduleType = String(type || 'class');

  if (scheduleType === 'holiday') {
      return { background_color: '#020617', text_color: '#ef4444', border_color: '#020617', highlight_type: 'none' };
    }

  if (scheduleType === 'application') {
    return { background_color: '#10b981', text_color: '#ffffff', border_color: '#10b981', highlight_type: 'none' };
  }

  if (scheduleType === 'exam') {
    return { background_color: '#7c3aed', text_color: '#ffffff', border_color: '#7c3aed', highlight_type: 'none' };
  }

  if (scheduleType === 'result') {
    return { background_color: '#f97316', text_color: '#ffffff', border_color: '#f97316', highlight_type: 'none' };
  }

  if (scheduleType === 'special') {
    return { background_color: '#7c2d12', text_color: '#facc15', border_color: '#facc15', highlight_type: 'glow' };
  }

  return { background_color: '#1e40af', text_color: '#ffffff', border_color: '#1e40af', highlight_type: 'none' };
}

function normalizeClassScheduleWritePayload(body = {}) {
  const scheduleDate = toClassScheduleDateText(body.schedule_date || body.date);
  const scheduleType = String(body.schedule_type || body.type || 'class').trim() || 'class';
  const defaults = getDefaultClassScheduleStyle(scheduleType);

  const dayNoRaw = body.day_no ?? body.day ?? '';
  const sortOrderRaw = body.sort_order ?? 0;

  const eventTitle = String(body.event_title || body.title || body.course_title || '').trim();
  const eventSubtitle = String(body.event_subtitle || body.subtitle || body.topic_title || '').trim();

  const courseTitle = String(body.course_title || (scheduleType === 'class'? eventTitle : eventTitle) || '').trim();
  const topicTitle = String(body.topic_title || eventSubtitle || '').trim();

  const eventCategory = String(body.event_category || body.category || (
    scheduleType === 'holiday'? '공휴일' :
    scheduleType === 'application'? '원서접수' :
    scheduleType === 'exam'? '시험일' :
    scheduleType === 'result'? '결과발표' :
    scheduleType === 'special'? '특별한날' : '수업일정'
  )).trim();

  const adminNote = String(body.admin_note || body.memo || '').trim();

  const sourceKey = String(body.source_key || [
    'admin',
    scheduleDate,
    scheduleType,
    eventCategory,
    eventTitle || courseTitle,
    dayNoRaw === '' || dayNoRaw === null || dayNoRaw === undefined ? '' : dayNoRaw,
  ].join('-')).slice(0, 180);

  return {
    schedule_date: scheduleDate,
    weekday_label: getClassScheduleWeekday(scheduleDate),
    day_no: dayNoRaw === '' || dayNoRaw === null || dayNoRaw === undefined ? null : Number(dayNoRaw),
    course_title: courseTitle,
    topic_title: topicTitle,
    original_date_label: `${scheduleDate} ${eventTitle || courseTitle}`.trim(),
    sort_order: Number(sortOrderRaw || 0),
    is_active: Number(body.is_active) === 0 ? 0 : 1,
    schedule_type: scheduleType,
    event_category: eventCategory,
    event_title: eventTitle || courseTitle,
    event_subtitle: eventSubtitle || topicTitle,
    source_key: sourceKey,
    background_color: safeClassScheduleColor(body.background_color, defaults.background_color),
    text_color: safeClassScheduleColor(body.text_color, defaults.text_color),
    border_color: safeClassScheduleColor(body.border_color, defaults.border_color),
    highlight_type: ['none', 'important', 'outline', 'glow'].includes(String(body.highlight_type || '').trim())
      ? String(body.highlight_type).trim()
      : defaults.highlight_type,
    admin_note: adminNote,
    memo: adminNote,
  };
}

async function buildClassScheduleInsert(payload) {
  const columns = await getClassScheduleColumns();

  const candidates = [
    'schedule_date',
    'weekday_label',
    'day_no',
    'course_title',
    'topic_title',
    'original_date_label',
    'sort_order',
    'is_active',
    'schedule_type',
    'event_category',
    'event_title',
    'event_subtitle',
    'source_key',
    'background_color',
    'text_color',
    'border_color',
    'highlight_type',
    'admin_note',
    'memo',
  ];

  const insertColumns = candidates.filter((column) => columns.has(column));
  const values = insertColumns.map((column) => payload[column]);

  return { insertColumns, values };
}

async function readClassScheduleById(id) {
  const rows = await queryClassScheduleCrudDb(
    'SELECT * FROM wgs_class_schedules WHERE id = ? LIMIT 1',
    [id]
  );

  return Array.isArray(rows) ? rows[0] : null;
}

app.post('/api/admin/class-schedules', async (req, res) => {
  try {
    const payload = normalizeClassScheduleWritePayload(req.body || {});

    if (!payload.schedule_date) {
      return res.status(400).json({ success: false, message: '일정 날짜를 입력해주세요.' });
    }

    if (!payload.course_title && !payload.event_title) {
      return res.status(400).json({ success: false, message: '과정명 또는 이벤트명을 입력해주세요.' });
    }

    const built = await buildClassScheduleInsert(payload);

    const placeholders = built.insertColumns.map(() => '?').join(', ');
    const sql = `INSERT INTO wgs_class_schedules
        (${built.insertColumns.join(', ')})
      VALUES
        (${placeholders})
    `;

    const result = await queryClassScheduleCrudDb(sql, built.values);
    const insertId = result && result.insertId ? result.insertId : null;
    const row = insertId ? await readClassScheduleById(insertId) : null;

    return res.json({
      success: true,
      message: '달력 일정이 추가되었습니다.',
      id: insertId,
      schedule: row,
    });
  } catch (err) {
    console.error('[admin/class-schedules] create failed:', err);

    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: '이미 같은 일정으로 저장된 데이터가 있습니다. 기존 항목을 수정해주세요.',
      });
    }

    return res.status(500).json({
      success: false,
      message: '달력 일정 추가 중 오류가 발생했습니다.',
      detail: err.message,
    });
  }
});

app.put('/api/admin/class-schedules/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ success: false, message: '수정할 일정 ID가 올바르지 않습니다.' });
    }

    const payload = normalizeClassScheduleWritePayload(req.body || {});

    if (!payload.schedule_date) {
      return res.status(400).json({ success: false, message: '일정 날짜를 입력해주세요.' });
    }

    if (!payload.course_title && !payload.event_title) {
      return res.status(400).json({ success: false, message: '과정명 또는 이벤트명을 입력해주세요.' });
    }

    const columns = await getClassScheduleColumns();

    const candidates = [
      'schedule_date',
      'weekday_label',
      'day_no',
      'course_title',
      'topic_title',
      'original_date_label',
      'sort_order',
      'is_active',
      'schedule_type',
      'event_category',
      'event_title',
      'event_subtitle',
      'source_key',
      'background_color',
      'text_color',
      'border_color',
      'highlight_type',
      'admin_note',
      'memo',
    ];

    const updateColumns = candidates.filter((column) => columns.has(column));
    const setSql = updateColumns.map((column) => `${column} = ?`).join(', ');
    const values = updateColumns.map((column) => payload[column]);

    values.push(id);

    await queryClassScheduleCrudDb(
      `UPDATE wgs_class_schedules SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

    const row = await readClassScheduleById(id);

    return res.json({
      success: true,
      message: '달력 일정이 수정되었습니다.',
      schedule: row,
    });
  } catch (err) {
    console.error('[admin/class-schedules] update failed:', err);

    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: '이미 같은 일정으로 저장된 데이터가 있습니다. 다른 값으로 수정해주세요.',
      });
    }

    return res.status(500).json({
      success: false,
      message: '달력 일정 수정 중 오류가 발생했습니다.',
      detail: err.message,
    });
  }
});

app.patch('/api/admin/class-schedules/:id/toggle', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ success: false, message: '상태 변경할 일정 ID가 올바르지 않습니다.' });
    }

    await queryClassScheduleCrudDb(
      'UPDATE wgs_class_schedules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );

    const row = await readClassScheduleById(id);

    return res.json({
      success: true,
      message: '달력 일정 상태가 변경되었습니다.',
      schedule: row,
    });
  } catch (err) {
    console.error('[admin/class-schedules] toggle failed:', err);
    return res.status(500).json({
      success: false,
      message: '달력 일정 상태 변경 중 오류가 발생했습니다.',
      detail: err.message,
    });
  }
});

app.delete('/api/admin/class-schedules/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ success: false, message: '삭제할 일정 ID가 올바르지 않습니다.' });
    }

    await queryClassScheduleCrudDb('DELETE FROM wgs_class_schedules WHERE id = ?', [id]);

    return res.json({
      success: true,
      message: '달력 일정이 삭제되었습니다.',
      id,
    });
  } catch (err) {
    console.error('[admin/class-schedules] delete failed:', err);
    return res.status(500).json({
      success: false,
      message: '달력 일정 삭제 중 오류가 발생했습니다.',
      detail: err.message,
    });
  }
});

app.post('/api/admin/class-schedules', async (req, res) => {
    try {
        const {
            schedule_date,
            weekday_label,
            day_no,
            course_title,
            topic_title,
            memo,
            sort_order,
            is_active
        } = req.body || {};

        const scheduleDate = String(schedule_date || '').trim();
        const courseTitle = String(course_title || '').trim();
        const topicTitle = String(topic_title || '').trim();
        const memoText = String(memo || '').trim();
        const dayNo = toNullableInt(day_no);
        const sortOrder = toNullableInt(sort_order) ?? 0;
        const activeValue = Number(is_active) ? 1 : 0;
        const weekdayLabel = String(weekday_label || getWeekdayLabelFromDate(scheduleDate)).trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
            return res.status(400).json({ success: false, message: '일정 날짜는 YYYY-MM-DD 형식으로 입력해주세요.' });
        }

        if (!courseTitle) {
            return res.status(400).json({ success: false, message: '과정명을 입력해주세요.' });
        }

        const [result] = await pool.query(
            `INSERT INTO wgs_class_schedules
                    (schedule_date, weekday_label, day_no, course_title, topic_title, original_date_label, memo, sort_order, is_active)
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                scheduleDate,
                weekdayLabel,
                dayNo,
                courseTitle,
                topicTitle,
                scheduleDate,
                memoText,
                sortOrder,
                activeValue
            ]
        );

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
                WHERE id = ?
            `,
            [result.insertId]
        );

        res.json({
            success: true,
            message: '달력 일정이 추가되었습니다.',
            schedule: normalizeClassScheduleRow(rows[0])
        });
    } catch (error) {
        console.error('[admin/class-schedules] create failed:', error);

        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: '같은 날짜와 같은 일차의 일정이 이미 있습니다.'
            });
        }

        res.status(500).json({
            success: false,
            message: '달력 일정 추가에 실패했습니다.'
        });
    }
});

app.put('/api/admin/class-schedules/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isFinite(id)) {
            return res.status(400).json({ success: false, message: '올바르지 않은 일정 ID입니다.' });
        }

        const {
            schedule_date,
            weekday_label,
            day_no,
            course_title,
            topic_title,
            memo,
            sort_order,
            is_active
        } = req.body || {};

        const scheduleDate = String(schedule_date || '').trim();
        const courseTitle = String(course_title || '').trim();
        const topicTitle = String(topic_title || '').trim();
        const memoText = String(memo || '').trim();
        const dayNo = toNullableInt(day_no);
        const sortOrder = toNullableInt(sort_order) ?? 0;
        const activeValue = Number(is_active) ? 1 : 0;
        const weekdayLabel = String(weekday_label || getWeekdayLabelFromDate(scheduleDate)).trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
            return res.status(400).json({ success: false, message: '일정 날짜는 YYYY-MM-DD 형식으로 입력해주세요.' });
        }

        if (!courseTitle) {
            return res.status(400).json({ success: false, message: '과정명을 입력해주세요.' });
        }

        const [result] = await pool.query(
            `UPDATE wgs_class_schedules
                SET
                    schedule_date = ?,
                    weekday_label = ?,
                    day_no = ?,
                    course_title = ?,
                    topic_title = ?,
                    memo = ?,
                    sort_order = ?,
                    is_active = ?
                WHERE id = ?
            `,
            [
                scheduleDate,
                weekdayLabel,
                dayNo,
                courseTitle,
                topicTitle,
                memoText,
                sortOrder,
                activeValue,
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '수정할 달력 일정을 찾지 못했습니다.' });
        }

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
                WHERE id = ?
            `,
            [id]
        );

        res.json({
            success: true,
            message: '달력 일정이 수정되었습니다.',
            schedule: normalizeClassScheduleRow(rows[0])
        });
    } catch (error) {
        console.error('[admin/class-schedules] update failed:', error);

        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: '같은 날짜와 같은 일차의 일정이 이미 있습니다.'
            });
        }

        res.status(500).json({
            success: false,
            message: '달력 일정 수정에 실패했습니다.'
        });
    }
});

app.patch('/api/admin/class-schedules/:id/toggle', async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isFinite(id)) {
            return res.status(400).json({ success: false, message: '올바르지 않은 일정 ID입니다.' });
        }

        const [result] = await pool.query(
            `UPDATE wgs_class_schedules
                SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
                WHERE id = ?
            `,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '전환할 달력 일정을 찾지 못했습니다.' });
        }

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
                WHERE id = ?
            `,
            [id]
        );

        res.json({
            success: true,
            message: Number(rows[0]?.is_active) ? '달력 일정이 활성화되었습니다.' : '달력 일정이 비활성화되었습니다.',
            schedule: normalizeClassScheduleRow(rows[0])
        });
    } catch (error) {
        console.error('[admin/class-schedules] toggle failed:', error);
        res.status(500).json({
            success: false,
            message: '달력 일정 활성 상태 변경에 실패했습니다.'
        });
    }
});

app.delete('/api/admin/class-schedules/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isFinite(id)) {
            return res.status(400).json({ success: false, message: '올바르지 않은 일정 ID입니다.' });
        }

        const [result] = await pool.query('DELETE FROM wgs_class_schedules WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: '삭제할 달력 일정을 찾지 못했습니다.' });
        }

        res.json({
            success: true,
            message: '달력 일정이 삭제되었습니다.'
        });
    } catch (error) {
        console.error('[admin/class-schedules] delete failed:', error);
        res.status(500).json({
            success: false,
            message: '달력 일정 삭제에 실패했습니다.'
        });
    }
});



}

module.exports = registerClassScheduleCrudRoutes;
