'use strict';

const VALID_SCHEDULE_TYPES = new Set(['class', 'holiday', 'application', 'exam', 'result', 'special', 'personal']);
const VALID_HIGHLIGHT_TYPES = new Set(['none', 'outline', 'glow', 'important']);

let schemaReady = false;
let schemaPromise = null;

function cleanText(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value).trim();
}

function normalizeDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
}

function toNullableInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizeColor(value, fallback = '') {
    const text = cleanText(value);
    if (!text) return fallback;
    if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
    if (text === 'transparent') return text;
    if (/^rgb\(\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(25[0-5]|2[0-4]\d|1?\d?\d)\s*\)$/i.test(text)) {
        return text.replace(/\s+/g, '');
    }
    return fallback;
}

function normalizeScheduleType(value) {
    const text = cleanText(value, 'personal');
    return VALID_SCHEDULE_TYPES.has(text) ? text : 'personal';
}

function normalizeHighlightType(value) {
    const text = cleanText(value, 'none');
    return VALID_HIGHLIGHT_TYPES.has(text) ? text : 'none';
}

function getWeekdayLabelFromDate(dateText) {
    const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const labels = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    return labels[date.getUTCDay()] || '';
}

async function ensureUserCalendarEventsSchema(pool) {
    if (schemaReady) return;
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wgs_user_calendar_events (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                user_id VARCHAR(50) NOT NULL,
                source_type VARCHAR(30) NOT NULL DEFAULT 'user_created',
                assigned_group_id VARCHAR(64) NULL,
                created_by_admin_id VARCHAR(50) NULL,
                schedule_date DATE NOT NULL,
                weekday_label VARCHAR(50) NULL,
                day_no INT NULL,
                schedule_type VARCHAR(30) NOT NULL DEFAULT 'personal',
                event_category VARCHAR(50) NULL,
                course_title VARCHAR(255) NULL,
                topic_title VARCHAR(255) NULL,
                event_title VARCHAR(255) NOT NULL,
                event_subtitle TEXT NULL,
                memo TEXT NULL,
                background_color VARCHAR(30) NULL,
                text_color VARCHAR(30) NULL,
                border_color VARCHAR(30) NULL,
                highlight_type VARCHAR(30) NULL,
                sort_order INT NOT NULL DEFAULT 0,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_wgs_user_calendar_user_date (user_id, schedule_date),
                INDEX idx_wgs_user_calendar_user_active (user_id, is_active),
                INDEX idx_wgs_user_calendar_source (source_type, assigned_group_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        schemaReady = true;
    })();

    try {
        await schemaPromise;
    } finally {
        schemaPromise = null;
    }
}

function normalizeUserCalendarPayload(body = {}, options = {}) {
    const scheduleDate = normalizeDateOnly(body.schedule_date || body.date || body.event_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
        const error = new Error('일정 날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
        error.statusCode = 400;
        throw error;
    }

    const scheduleType = normalizeScheduleType(body.schedule_type || body.scheduleType || options.scheduleType || 'personal');
    const isClassSchedule = scheduleType === 'class';
    const rawEventTitle = cleanText(body.event_title || body.eventTitle || body.title || body.course_title || body.courseTitle);
    const rawCourseTitle = cleanText(body.course_title || body.courseTitle || rawEventTitle);
    const rawEventSubtitle = cleanText(body.event_subtitle || body.eventSubtitle || body.subtitle || body.topic_title || body.topicTitle);
    const rawTopicTitle = cleanText(body.topic_title || body.topicTitle || rawEventSubtitle);

    const eventTitle = rawEventTitle || rawCourseTitle;
    const courseTitle = rawCourseTitle || eventTitle;
    if (!eventTitle) {
        const error = new Error('일정 표시명을 입력해주세요.');
        error.statusCode = 400;
        throw error;
    }

    return {
        user_id: cleanText(options.userId || body.user_id || body.userId),
        source_type: cleanText(options.sourceType || body.source_type || body.sourceType, 'user_created') === 'admin_assigned'
            ? 'admin_assigned'
            : 'user_created',
        assigned_group_id: cleanText(options.assignedGroupId || body.assigned_group_id || body.assignedGroupId) || null,
        created_by_admin_id: cleanText(options.adminId || body.created_by_admin_id || body.createdByAdminId) || null,
        schedule_date: scheduleDate,
        weekday_label: cleanText(body.weekday_label || body.weekdayLabel || getWeekdayLabelFromDate(scheduleDate)),
        day_no: toNullableInt(body.day_no ?? body.dayNo ?? body.day),
        schedule_type: scheduleType,
        event_category: cleanText(body.event_category || body.eventCategory || (scheduleType === 'personal' ? '개인일정' : '')) || null,
        course_title: isClassSchedule ? courseTitle : courseTitle,
        topic_title: isClassSchedule ? rawTopicTitle : rawTopicTitle,
        event_title: eventTitle,
        event_subtitle: rawEventSubtitle || rawTopicTitle || null,
        memo: cleanText(body.memo || body.admin_note || body.adminNote) || null,
        background_color: normalizeColor(body.background_color || body.backgroundColor, '#1e40af'),
        text_color: normalizeColor(body.text_color || body.textColor, '#ffffff'),
        border_color: normalizeColor(body.border_color || body.borderColor, '#1e40af'),
        highlight_type: normalizeHighlightType(body.highlight_type || body.highlightType),
        sort_order: toNullableInt(body.sort_order ?? body.sortOrder) ?? 0,
        is_active: Number(body.is_active ?? body.isActive ?? 1) ? 1 : 0,
    };
}

function normalizeUserCalendarEventRow(row = {}) {
    return {
        id: row.id,
        user_id: row.user_id,
        userId: row.user_id,
        source_type: row.source_type || 'user_created',
        sourceType: row.source_type || 'user_created',
        assigned_group_id: row.assigned_group_id || '',
        assignedGroupId: row.assigned_group_id || '',
        created_by_admin_id: row.created_by_admin_id || '',
        createdByAdminId: row.created_by_admin_id || '',
        date: normalizeDateOnly(row.schedule_date),
        schedule_date: normalizeDateOnly(row.schedule_date),
        weekday: row.weekday_label || '',
        weekday_label: row.weekday_label || '',
        day: row.day_no === null || row.day_no === undefined ? null : Number(row.day_no),
        day_no: row.day_no === null || row.day_no === undefined ? null : Number(row.day_no),
        schedule_type: row.schedule_type || 'personal',
        scheduleType: row.schedule_type || 'personal',
        event_category: row.event_category || '',
        eventCategory: row.event_category || '',
        course_title: row.course_title || '',
        courseTitle: row.course_title || '',
        topic_title: row.topic_title || '',
        topicTitle: row.topic_title || '',
        event_title: row.event_title || '',
        eventTitle: row.event_title || '',
        event_subtitle: row.event_subtitle || '',
        eventSubtitle: row.event_subtitle || '',
        title: row.event_title || row.course_title || '',
        subtitle: row.event_subtitle || row.topic_title || '',
        memo: row.memo || '',
        background_color: row.background_color || '',
        backgroundColor: row.background_color || '',
        text_color: row.text_color || '',
        textColor: row.text_color || '',
        border_color: row.border_color || '',
        borderColor: row.border_color || '',
        highlight_type: row.highlight_type || 'none',
        highlightType: row.highlight_type || 'none',
        sort_order: Number(row.sort_order || 0),
        sortOrder: Number(row.sort_order || 0),
        is_active: Number(row.is_active) ? 1 : 0,
        isActive: Number(row.is_active) ? 1 : 0,
        created_at: row.created_at || '',
        createdAt: row.created_at || '',
        updated_at: row.updated_at || '',
        updatedAt: row.updated_at || '',
    };
}

const USER_CALENDAR_COLUMNS = [
    'user_id',
    'source_type',
    'assigned_group_id',
    'created_by_admin_id',
    'schedule_date',
    'weekday_label',
    'day_no',
    'schedule_type',
    'event_category',
    'course_title',
    'topic_title',
    'event_title',
    'event_subtitle',
    'memo',
    'background_color',
    'text_color',
    'border_color',
    'highlight_type',
    'sort_order',
    'is_active',
];

function buildInsert(payload) {
    return {
        columns: USER_CALENDAR_COLUMNS,
        values: USER_CALENDAR_COLUMNS.map((column) => payload[column]),
    };
}

function buildUpdate(payload) {
    const columns = USER_CALENDAR_COLUMNS.filter((column) => !['user_id', 'source_type', 'assigned_group_id', 'created_by_admin_id'].includes(column));
    return {
        columns,
        values: columns.map((column) => payload[column]),
    };
}

module.exports = {
    buildInsert,
    buildUpdate,
    cleanText,
    ensureUserCalendarEventsSchema,
    getWeekdayLabelFromDate,
    normalizeColor,
    normalizeDateOnly,
    normalizeUserCalendarEventRow,
    normalizeUserCalendarPayload,
};
