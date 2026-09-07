import { useCallback, useEffect, useRef, useState } from 'react';
import useAdminVisitorSessionStats from './useAdminVisitorSessionStats.js';

const PERIOD_VALUES = new Set(['day', 'week', 'month', 'year']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getKstDateText() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizePeriod(value) {
  const normalized = String(value || '').toLowerCase();
  return PERIOD_VALUES.has(normalized) ? normalized : 'day';
}

function normalizeAnchor(value) {
  const normalized = String(value || '').trim();
  return DATE_PATTERN.test(normalized) ? normalized : getKstDateText();
}

function toCount(value) {
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
    : payload?.counts && typeof payload.counts === 'object'
      ? payload.counts
      : {};

  return {
    today: toCount(firstDefined(summary.today, summary.todayCount, payload?.todayCount)),
    thisWeek: toCount(firstDefined(
      summary.thisWeek,
      summary.week,
      summary.weekCount,
      payload?.thisWeek,
      payload?.weekCount,
    )),
    thisMonth: toCount(firstDefined(
      summary.thisMonth,
      summary.month,
      summary.monthCount,
      payload?.thisMonth,
      payload?.monthCount,
    )),
    thisYear: toCount(firstDefined(
      summary.thisYear,
      summary.year,
      summary.yearCount,
      payload?.thisYear,
      payload?.yearCount,
    )),
    total: toCount(firstDefined(summary.total, summary.totalCount, payload?.totalCount)),
  };
}

function normalizeSeries(payload) {
  const source = firstDefined(payload?.series, payload?.points, payload?.timeline, []);

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
      count: toCount(firstDefined(
        safePoint.count,
        safePoint.visitors,
        safePoint.visitorCount,
        safePoint.value,
        safePoint.total,
      )),
    };
  });
}

function normalizeResponse(payload, requestedPeriod, requestedAnchor) {
  const range = payload?.range && typeof payload.range === 'object'
    ? payload.range
    : {};

  return {
    ...payload,
    success: payload?.success !== false,
    period: normalizePeriod(payload?.period || requestedPeriod),
    anchor: normalizeAnchor(payload?.anchor || requestedAnchor),
    timezone: payload?.timezone || 'Asia/Seoul',
    startedAt: firstDefined(
      payload?.startedAt,
      payload?.started_at,
      payload?.summary?.startedAt,
      payload?.summary?.started_at,
      null,
    ),
    range: {
      start: firstDefined(range.start, range.from, payload?.rangeStart, payload?.startDate, null),
      end: firstDefined(range.end, range.to, payload?.rangeEnd, payload?.endDate, null),
    },
    summary: normalizeSummary(payload),
    series: normalizeSeries(payload),
  };
}

export function useLegacyAdminVisitorStats({
  enabled = false,
  makeAdminHeaders,
  initialPeriod = 'day',
  initialAnchor,
} = {}) {
  const [period, setPeriodState] = useState(() => normalizePeriod(initialPeriod));
  const [anchor, setAnchorState] = useState(() => normalizeAnchor(initialAnchor));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const makeAdminHeadersRef = useRef(makeAdminHeaders);

  makeAdminHeadersRef.current = makeAdminHeaders;

  const setPeriod = useCallback((nextPeriod) => {
    setPeriodState((currentPeriod) => normalizePeriod(
      typeof nextPeriod === 'function' ? nextPeriod(currentPeriod) : nextPeriod,
    ));
  }, []);

  const setAnchor = useCallback((nextAnchor) => {
    setAnchorState((currentAnchor) => normalizeAnchor(
      typeof nextAnchor === 'function' ? nextAnchor(currentAnchor) : nextAnchor,
    ));
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) return null;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError('');

    try {
      const adminHeaders = typeof makeAdminHeadersRef.current === 'function'
        ? await makeAdminHeadersRef.current()
        : {};
      const headers = new Headers(adminHeaders || {});
      headers.set('Accept', 'application/json');

      const query = new URLSearchParams({ period, anchor });
      const response = await fetch(`/api/admin/visitors/stats?${query.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.message
          || payload?.msg
          || `방문 통계를 불러오지 못했습니다. (${response.status})`,
        );
      }

      if (!payload || typeof payload !== 'object') {
        throw new Error('방문 통계 응답 형식을 확인할 수 없습니다.');
      }

      if (payload.success === false) {
        throw new Error(payload.message || payload.msg || '방문 통계를 불러오지 못했습니다.');
      }

      const normalizedData = normalizeResponse(payload, period, anchor);

      if (requestIdRef.current === requestId) {
        setData(normalizedData);
      }
      return normalizedData;
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') return null;

      console.error('[admin] visitor stats fetch failed:', fetchError);
      if (requestIdRef.current === requestId) {
        setError(fetchError?.message || '방문 통계를 불러오지 못했습니다.');
      }
      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [anchor, enabled, period]);

  useEffect(() => {
    if (!enabled) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestIdRef.current += 1;
      setLoading(false);
      return undefined;
    }

    reload();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [enabled, reload]);

  return {
    period,
    setPeriod,
    anchor,
    setAnchor,
    loading,
    error,
    reload,
    data,
  };
}

export default function useAdminVisitorStats(options) {
  return useAdminVisitorSessionStats(options);
}
