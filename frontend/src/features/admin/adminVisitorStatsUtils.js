const PERIOD_VALUES = new Set(['day', 'week', 'month', 'year']);
const VISITOR_TYPE_VALUES = new Set(['anonymous', 'member']);
const SESSION_STATUS_VALUES = new Set(['active', 'ended']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_VISITOR_TYPES = Object.freeze(['anonymous', 'member']);
export const DEFAULT_SESSION_PAGE_SIZE = 25;

export function getKstDateText(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeVisitorPeriod(value) {
  const normalized = String(value || '').toLowerCase();
  return PERIOD_VALUES.has(normalized) ? normalized : 'day';
}

export function normalizeVisitorAnchor(value) {
  const normalized = String(value || '').trim();
  return DATE_PATTERN.test(normalized) ? normalized : getKstDateText();
}

export function normalizeVisitorTypes(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(',');
  const normalized = source
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value, index, items) => VISITOR_TYPE_VALUES.has(value) && items.indexOf(value) === index);

  return normalized.length > 0 ? normalized : [...DEFAULT_VISITOR_TYPES];
}

export function normalizeMemberIds(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(',');
  return source
    .map((value) => String(value || '').trim())
    .filter((value, index, items) => value && items.indexOf(value) === index);
}

export function normalizeSessionFilterStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SESSION_STATUS_VALUES.has(normalized) ? normalized : '';
}

export function toVisitorCount(value) {
  const numericValue = Number(String(value ?? 0).replaceAll(',', ''));
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return Math.round(numericValue);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.data && typeof payload.data === 'object' ? payload.data : payload;
}

function normalizeSummary(root) {
  const summary = root?.summary && typeof root.summary === 'object'
    ? root.summary
    : root?.counts && typeof root.counts === 'object'
      ? root.counts
      : {};

  return {
    today: toVisitorCount(firstDefined(summary.today, summary.todayCount, root?.todayCount)),
    thisWeek: toVisitorCount(firstDefined(
      summary.thisWeek,
      summary.week,
      summary.weekCount,
      root?.thisWeek,
      root?.weekCount,
    )),
    thisMonth: toVisitorCount(firstDefined(
      summary.thisMonth,
      summary.month,
      summary.monthCount,
      root?.thisMonth,
      root?.monthCount,
    )),
    thisYear: toVisitorCount(firstDefined(
      summary.thisYear,
      summary.year,
      summary.yearCount,
      root?.thisYear,
      root?.yearCount,
    )),
    total: toVisitorCount(firstDefined(summary.total, summary.totalCount, root?.totalCount)),
  };
}

function normalizeSeries(root) {
  const source = firstDefined(root?.series, root?.points, root?.timeline, []);
  if (!Array.isArray(source)) return [];

  return source.map((point, index) => {
    const safePoint = point && typeof point === 'object' ? point : {};
    const key = String(firstDefined(
      safePoint.key,
      safePoint.date,
      safePoint.hour,
      safePoint.period,
      index,
    ));
    const label = String(firstDefined(
      safePoint.label,
      safePoint.dateLabel,
      safePoint.date,
      safePoint.hourLabel,
      safePoint.hour,
      safePoint.period,
      key,
    ));

    return {
      ...safePoint,
      key,
      label,
      count: toVisitorCount(firstDefined(
        safePoint.count,
        safePoint.sessions,
        safePoint.sessionCount,
        safePoint.visitors,
        safePoint.visitorCount,
        safePoint.value,
        safePoint.total,
      )),
    };
  });
}

export function normalizeVisitorStatsResponse(payload, requestedPeriod, requestedAnchor) {
  const root = unwrapPayload(payload);
  const range = root.range && typeof root.range === 'object' ? root.range : {};
  const metrics = root.metrics && typeof root.metrics === 'object' ? root.metrics : {};
  const breakdown = root.sessionBreakdown && typeof root.sessionBreakdown === 'object'
    ? root.sessionBreakdown
    : root.breakdown && typeof root.breakdown === 'object'
      ? root.breakdown
      : {};

  return {
    ...root,
    success: root.success !== false,
    period: normalizeVisitorPeriod(root.period || requestedPeriod),
    anchor: normalizeVisitorAnchor(root.anchor || requestedAnchor),
    timezone: root.timezone || 'Asia/Seoul',
    startedAt: firstDefined(
      root.startedAt,
      root.started_at,
      root.summary?.startedAt,
      root.summary?.started_at,
      null,
    ),
    range: {
      start: firstDefined(range.start, range.from, root.rangeStart, root.startDate, null),
      end: firstDefined(range.end, range.to, root.rangeEnd, root.endDate, null),
    },
    summary: normalizeSummary(root),
    metrics: {
      totalSessions: toVisitorCount(firstDefined(
        metrics.totalSessions,
        metrics.sessionCount,
        metrics.total,
        root.summary?.total,
      )),
      anonymousSessions: toVisitorCount(firstDefined(
        metrics.anonymousSessions,
        metrics.anonymousCount,
        breakdown.anonymous,
        breakdown.anonymousSessions,
      )),
      memberSessions: toVisitorCount(firstDefined(
        metrics.memberSessions,
        metrics.memberCount,
        breakdown.member,
        breakdown.memberSessions,
      )),
      uniqueMembers: toVisitorCount(firstDefined(metrics.uniqueMembers, breakdown.uniqueMembers)),
      activeSessions: toVisitorCount(firstDefined(metrics.activeSessions, breakdown.active)),
      loginCount: toVisitorCount(firstDefined(metrics.loginCount, metrics.logins, root.loginCount)),
    },
    inactivitySeconds: toVisitorCount(root.inactivitySeconds) || 300,
    series: normalizeSeries(root),
  };
}

function normalizeSessionStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (['active', 'online', 'open'].includes(normalized)) return 'active';
  return 'ended';
}

export function normalizeVisitorSessionsResponse(payload, requestedPage, requestedPageSize) {
  const root = unwrapPayload(payload);
  const source = Array.isArray(root.sessions) ? root.sessions : [];
  const pagination = root.pagination && typeof root.pagination === 'object'
    ? root.pagination
    : {};
  const pageSize = Math.max(1, toVisitorCount(pagination.pageSize || requestedPageSize) || DEFAULT_SESSION_PAGE_SIZE);
  const total = toVisitorCount(firstDefined(pagination.total, root.total, source.length));
  const page = Math.max(1, toVisitorCount(pagination.page || requestedPage) || 1);
  const totalPages = Math.max(1, toVisitorCount(pagination.totalPages) || Math.ceil(total / pageSize) || 1);

  return {
    success: root.success !== false,
    timezone: root.timezone || 'Asia/Seoul',
    range: root.range && typeof root.range === 'object' ? root.range : {},
    filters: root.filters && typeof root.filters === 'object' ? root.filters : {},
    pagination: { page, pageSize, total, totalPages },
    sessions: source.map((session, index) => {
      const member = session?.member && typeof session.member === 'object'
        ? {
          id: String(session.member.id ?? ''),
          name: String(session.member.name ?? session.member.id ?? ''),
        }
        : null;
      return {
        key: String(session?.id ?? `${session?.startedAt ?? 'session'}-${index}`),
        visitorType: String(session?.visitorType || '').toLowerCase() === 'member'
          ? 'member'
          : 'anonymous',
        member,
        startedAt: session?.startedAt || null,
        lastSeenAt: session?.lastSeenAt || null,
        endedAt: session?.endedAt || null,
        durationSeconds: toVisitorCount(session?.durationSeconds),
        status: normalizeSessionStatus(session?.status),
        entryPath: typeof session?.entryPath === 'string' ? session.entryPath : '',
        source: typeof session?.source === 'string' ? session.source : '',
        historical: Boolean(session?.historical),
        requestCount: toVisitorCount(session?.requestCount),
        loginEventCount: toVisitorCount(session?.loginEventCount),
      };
    }),
  };
}

export function normalizeVisitorMembersResponse(payload) {
  const root = unwrapPayload(payload);
  const source = Array.isArray(root.members) ? root.members : [];

  return source
    .map((member) => ({
      id: String(member?.id ?? '').trim(),
      name: String(member?.name ?? member?.id ?? '').trim(),
      sessionCount: toVisitorCount(member?.sessionCount),
      lastSeenAt: member?.lastSeenAt || null,
    }))
    .filter((member) => member.id);
}

export function buildVisitorFilterParams({
  period,
  anchor,
  visitorTypes,
  memberIds,
  status,
  page,
  pageSize,
} = {}) {
  const query = new URLSearchParams({
    period: normalizeVisitorPeriod(period),
    anchor: normalizeVisitorAnchor(anchor),
    types: normalizeVisitorTypes(visitorTypes).join(','),
  });
  const normalizedMemberIds = normalizeMemberIds(memberIds);

  if (normalizedMemberIds.length > 0) query.set('memberIds', normalizedMemberIds.join(','));
  const normalizedStatus = normalizeSessionFilterStatus(status);
  if (normalizedStatus) query.set('status', normalizedStatus);
  if (page !== undefined) query.set('page', String(Math.max(1, toVisitorCount(page) || 1)));
  if (pageSize !== undefined) {
    query.set('pageSize', String(Math.max(1, toVisitorCount(pageSize) || DEFAULT_SESSION_PAGE_SIZE)));
  }

  return query;
}

function parseDateText(value) {
  const normalized = normalizeVisitorAnchor(value);
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateText(value) {
  return value.toISOString().slice(0, 10);
}

export function getWeekRangeText(anchor) {
  const date = parseDateText(anchor);
  const dayOfWeek = date.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return `${toDateText(monday)} ~ ${toDateText(sunday)}`;
}
