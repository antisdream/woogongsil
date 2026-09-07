const PERIOD_VALUES = new Set(['day', 'week', 'month', 'year']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getKstDateText(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeMemberLoginPeriod(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PERIOD_VALUES.has(normalized) ? normalized : 'day';
}

export function normalizeMemberLoginAnchor(value) {
  const normalized = String(value || '').trim();
  return DATE_PATTERN.test(normalized) ? normalized : getKstDateText();
}

export function toMemberLoginCount(value) {
  const numericValue = Number(String(value ?? 0).replaceAll(',', ''));
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return Math.round(numericValue);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeSummary(payload) {
  const summary = payload?.summary && typeof payload.summary === 'object'
    ? payload.summary
    : {};

  const startedAt = firstDefined(
    summary.startedAt,
    summary.started_at,
    summary.firstRecordedAt,
    payload?.firstRecordedAt,
    payload?.startedAt,
    null,
  );

  return {
    today: toMemberLoginCount(firstDefined(summary.today, summary.todayCount)),
    thisWeek: toMemberLoginCount(firstDefined(summary.thisWeek, summary.week, summary.weekCount)),
    thisMonth: toMemberLoginCount(firstDefined(summary.thisMonth, summary.month, summary.monthCount)),
    thisYear: toMemberLoginCount(firstDefined(summary.thisYear, summary.year, summary.yearCount)),
    total: toMemberLoginCount(firstDefined(summary.total, summary.totalCount)),
    uniqueMembers: toMemberLoginCount(firstDefined(
      summary.uniqueMembers,
      summary.uniqueMemberCount,
    )),
    rangeUniqueMembers: toMemberLoginCount(firstDefined(
      summary.rangeUniqueMembers,
      summary.rangeUniqueMemberCount,
    )),
    startedAt: startedAt ? String(startedAt) : null,
  };
}

function normalizeSeries(payload) {
  if (!Array.isArray(payload?.series)) return [];

  return payload.series.map((point, index) => {
    const safePoint = point && typeof point === 'object' ? point : {};
    const key = String(firstDefined(safePoint.key, safePoint.date, safePoint.period, index));
    return {
      ...safePoint,
      key,
      label: String(firstDefined(safePoint.label, safePoint.date, safePoint.period, key)),
      count: toMemberLoginCount(firstDefined(safePoint.count, safePoint.value, safePoint.total)),
    };
  });
}

export function normalizeMemberLoginResponse(payload, requestedPeriod, requestedAnchor) {
  const range = payload?.range && typeof payload.range === 'object' ? payload.range : {};

  return {
    ...payload,
    success: payload?.success !== false,
    available: payload?.available !== false,
    reason: payload?.reason || null,
    metric: payload?.metric || 'daily_unique_member_logins',
    scope: payload?.scope || 'authenticated_members_only',
    period: normalizeMemberLoginPeriod(payload?.period || requestedPeriod),
    anchor: normalizeMemberLoginAnchor(payload?.anchor || requestedAnchor),
    timezone: payload?.timezone || 'Asia/Seoul',
    range: {
      start: firstDefined(range.start, range.from, null),
      end: firstDefined(range.end, range.to, null),
    },
    summary: normalizeSummary(payload),
    series: normalizeSeries(payload),
    metadata: payload?.metadata && typeof payload.metadata === 'object'
      ? payload.metadata
      : {},
  };
}
