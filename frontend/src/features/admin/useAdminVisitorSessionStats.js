import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildVisitorFilterParams,
  DEFAULT_SESSION_PAGE_SIZE,
  DEFAULT_VISITOR_TYPES,
  normalizeMemberIds,
  normalizeSessionFilterStatus,
  normalizeVisitorAnchor,
  normalizeVisitorMembersResponse,
  normalizeVisitorPeriod,
  normalizeVisitorSessionsResponse,
  normalizeVisitorStatsResponse,
  normalizeVisitorTypes,
} from './adminVisitorStatsUtils.js';

const STATS_ENDPOINT = '/api/admin/visitors/stats';
const SESSIONS_ENDPOINT = '/api/admin/visitors/sessions';
const MEMBERS_ENDPOINT = '/api/admin/visitors/members';

async function fetchAdminJson(url, { makeAdminHeaders, signal }) {
  const adminHeaders = typeof makeAdminHeaders === 'function'
    ? await makeAdminHeaders()
    : {};
  const headers = new Headers(adminHeaders || {});
  headers.set('Accept', 'application/json');
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
    signal,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.message || payload?.msg || `방문 통계를 불러오지 못했습니다. (${response.status})`,
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('방문 통계 응답 형식을 확인할 수 없습니다.');
  }
  if (payload.success === false) {
    throw new Error(payload.message || payload.msg || '방문 통계를 불러오지 못했습니다.');
  }
  return payload;
}

export default function useAdminVisitorSessionStats({
  enabled = false,
  detailsEnabled = enabled,
  makeAdminHeaders,
  initialPeriod = 'day',
  initialAnchor,
  initialVisitorTypes = DEFAULT_VISITOR_TYPES,
  pageSize = DEFAULT_SESSION_PAGE_SIZE,
} = {}) {
  const [period, setPeriodState] = useState(() => normalizeVisitorPeriod(initialPeriod));
  const [anchor, setAnchorState] = useState(() => normalizeVisitorAnchor(initialAnchor));
  const [visitorTypes, setVisitorTypesState] = useState(
    () => normalizeVisitorTypes(initialVisitorTypes),
  );
  const [memberIds, setMemberIdsState] = useState([]);
  const [sessionStatus, setSessionStatusState] = useState('');
  const [sessionPage, setSessionPageState] = useState(1);
  const [data, setData] = useState(null);
  const [sessionsData, setSessionsData] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionsError, setSessionsError] = useState('');
  const [membersError, setMembersError] = useState('');
  const statsRequestIdRef = useRef(0);
  const sessionsRequestIdRef = useRef(0);
  const membersRequestIdRef = useRef(0);
  const statsAbortRef = useRef(null);
  const sessionsAbortRef = useRef(null);
  const membersAbortRef = useRef(null);
  const makeAdminHeadersRef = useRef(makeAdminHeaders);

  makeAdminHeadersRef.current = makeAdminHeaders;

  const visitorTypesKey = visitorTypes.join(',');
  const memberIdsKey = memberIds.join(',');
  const normalizedPageSize = Math.max(1, Number(pageSize) || DEFAULT_SESSION_PAGE_SIZE);
  const shouldLoadDetails = Boolean(enabled && detailsEnabled);

  const setPeriod = useCallback((nextPeriod) => {
    setPeriodState((currentPeriod) => normalizeVisitorPeriod(
      typeof nextPeriod === 'function' ? nextPeriod(currentPeriod) : nextPeriod,
    ));
  }, []);

  const setAnchor = useCallback((nextAnchor) => {
    setAnchorState((currentAnchor) => normalizeVisitorAnchor(
      typeof nextAnchor === 'function' ? nextAnchor(currentAnchor) : nextAnchor,
    ));
  }, []);

  const setVisitorTypes = useCallback((nextTypes) => {
    setVisitorTypesState((currentTypes) => normalizeVisitorTypes(
      typeof nextTypes === 'function' ? nextTypes(currentTypes) : nextTypes,
    ));
  }, []);

  const toggleVisitorType = useCallback((type) => {
    setVisitorTypesState((currentTypes) => {
      const normalizedType = String(type || '').toLowerCase();
      if (!['anonymous', 'member'].includes(normalizedType)) return currentTypes;
      if (currentTypes.includes(normalizedType)) {
        return currentTypes.length === 1
          ? currentTypes
          : currentTypes.filter((item) => item !== normalizedType);
      }
      return normalizeVisitorTypes([...currentTypes, normalizedType]);
    });
  }, []);

  const setMemberIds = useCallback((nextMemberIds) => {
    setMemberIdsState((currentMemberIds) => normalizeMemberIds(
      typeof nextMemberIds === 'function' ? nextMemberIds(currentMemberIds) : nextMemberIds,
    ));
  }, []);

  const setSessionStatus = useCallback((nextStatus) => {
    setSessionStatusState((currentStatus) => normalizeSessionFilterStatus(
      typeof nextStatus === 'function' ? nextStatus(currentStatus) : nextStatus,
    ));
  }, []);

  const setSessionPage = useCallback((nextPage) => {
    setSessionPageState((currentPage) => {
      const resolved = typeof nextPage === 'function' ? nextPage(currentPage) : nextPage;
      return Math.max(1, Number(resolved) || 1);
    });
  }, []);

  const statsQuery = useMemo(() => buildVisitorFilterParams({
    period,
    anchor,
    visitorTypes,
    memberIds,
    status: sessionStatus,
  }).toString(), [anchor, memberIds, period, sessionStatus, visitorTypes]);

  const sessionsQuery = useMemo(() => buildVisitorFilterParams({
    period,
    anchor,
    visitorTypes,
    memberIds,
    status: sessionStatus,
    page: sessionPage,
    pageSize: normalizedPageSize,
  }).toString(), [
    anchor,
    memberIds,
    normalizedPageSize,
    period,
    sessionStatus,
    sessionPage,
    visitorTypes,
  ]);

  const reloadStats = useCallback(async () => {
    if (!enabled) return null;
    statsAbortRef.current?.abort();
    const controller = new AbortController();
    statsAbortRef.current = controller;
    const requestId = statsRequestIdRef.current + 1;
    statsRequestIdRef.current = requestId;
    setLoading(true);
    setError('');

    try {
      const payload = await fetchAdminJson(`${STATS_ENDPOINT}?${statsQuery}`, {
        makeAdminHeaders: makeAdminHeadersRef.current,
        signal: controller.signal,
      });
      const normalizedData = normalizeVisitorStatsResponse(payload, period, anchor);
      if (statsRequestIdRef.current === requestId) setData(normalizedData);
      return normalizedData;
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') return null;
      console.error('[admin] visitor stats fetch failed:', fetchError);
      if (statsRequestIdRef.current === requestId) {
        setError(fetchError?.message || '방문 통계를 불러오지 못했습니다.');
      }
      return null;
    } finally {
      if (statsRequestIdRef.current === requestId) setLoading(false);
      if (statsAbortRef.current === controller) statsAbortRef.current = null;
    }
  }, [anchor, enabled, period, statsQuery]);

  const reloadSessions = useCallback(async () => {
    if (!shouldLoadDetails) return null;
    sessionsAbortRef.current?.abort();
    const controller = new AbortController();
    sessionsAbortRef.current = controller;
    const requestId = sessionsRequestIdRef.current + 1;
    sessionsRequestIdRef.current = requestId;
    setSessionsLoading(true);
    setSessionsError('');

    try {
      const payload = await fetchAdminJson(`${SESSIONS_ENDPOINT}?${sessionsQuery}`, {
        makeAdminHeaders: makeAdminHeadersRef.current,
        signal: controller.signal,
      });
      const normalizedData = normalizeVisitorSessionsResponse(
        payload,
        sessionPage,
        normalizedPageSize,
      );
      if (sessionsRequestIdRef.current === requestId) setSessionsData(normalizedData);
      return normalizedData;
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') return null;
      console.error('[admin] visitor sessions fetch failed:', fetchError);
      if (sessionsRequestIdRef.current === requestId) {
        setSessionsError(fetchError?.message || '방문 세션 목록을 불러오지 못했습니다.');
      }
      return null;
    } finally {
      if (sessionsRequestIdRef.current === requestId) setSessionsLoading(false);
      if (sessionsAbortRef.current === controller) sessionsAbortRef.current = null;
    }
  }, [normalizedPageSize, sessionPage, sessionsQuery, shouldLoadDetails]);

  const reloadMembers = useCallback(async () => {
    if (!shouldLoadDetails) return null;
    membersAbortRef.current?.abort();
    const controller = new AbortController();
    membersAbortRef.current = controller;
    const requestId = membersRequestIdRef.current + 1;
    membersRequestIdRef.current = requestId;
    setMembersLoading(true);
    setMembersError('');

    try {
      const payload = await fetchAdminJson(`${MEMBERS_ENDPOINT}?limit=100`, {
        makeAdminHeaders: makeAdminHeadersRef.current,
        signal: controller.signal,
      });
      const normalizedMembers = normalizeVisitorMembersResponse(payload);
      if (membersRequestIdRef.current === requestId) setMembers(normalizedMembers);
      return normalizedMembers;
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') return null;
      console.error('[admin] visitor members fetch failed:', fetchError);
      if (membersRequestIdRef.current === requestId) {
        setMembersError(fetchError?.message || '회원 선택 목록을 불러오지 못했습니다.');
      }
      return null;
    } finally {
      if (membersRequestIdRef.current === requestId) setMembersLoading(false);
      if (membersAbortRef.current === controller) membersAbortRef.current = null;
    }
  }, [shouldLoadDetails]);

  const reload = useCallback(
    () => Promise.all([reloadStats(), reloadSessions()]),
    [reloadSessions, reloadStats],
  );

  useEffect(() => {
    setSessionPageState(1);
  }, [anchor, memberIdsKey, period, sessionStatus, visitorTypesKey]);

  useEffect(() => {
    if (!enabled) {
      statsAbortRef.current?.abort();
      statsRequestIdRef.current += 1;
      setLoading(false);
      return undefined;
    }
    reloadStats();
    return () => statsAbortRef.current?.abort();
  }, [enabled, reloadStats]);

  useEffect(() => {
    if (!shouldLoadDetails) {
      sessionsAbortRef.current?.abort();
      sessionsRequestIdRef.current += 1;
      setSessionsLoading(false);
      return undefined;
    }
    reloadSessions();
    return () => sessionsAbortRef.current?.abort();
  }, [reloadSessions, shouldLoadDetails]);

  useEffect(() => {
    if (!shouldLoadDetails) {
      membersAbortRef.current?.abort();
      membersRequestIdRef.current += 1;
      setMembersLoading(false);
      return undefined;
    }
    reloadMembers();
    return () => membersAbortRef.current?.abort();
  }, [reloadMembers, shouldLoadDetails]);

  return {
    period,
    setPeriod,
    anchor,
    setAnchor,
    visitorTypes,
    setVisitorTypes,
    toggleVisitorType,
    memberIds,
    setMemberIds,
    sessionStatus,
    setSessionStatus,
    sessionPage,
    setSessionPage,
    pageSize: normalizedPageSize,
    loading,
    sessionsLoading,
    membersLoading,
    error,
    sessionsError,
    membersError,
    reload,
    reloadStats,
    reloadSessions,
    reloadMembers,
    data,
    sessionsData,
    members,
  };
}
