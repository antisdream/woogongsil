import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeMemberLoginAnchor,
  normalizeMemberLoginPeriod,
  normalizeMemberLoginResponse,
} from './memberLoginStatsUtils.js';

export default function useAdminMemberLoginStats({
  enabled = false,
  makeAdminHeaders,
  period = 'day',
  anchor,
} = {}) {
  const normalizedPeriod = normalizeMemberLoginPeriod(period);
  const normalizedAnchor = normalizeMemberLoginAnchor(anchor);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const makeAdminHeadersRef = useRef(makeAdminHeaders);

  makeAdminHeadersRef.current = makeAdminHeaders;

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

      const query = new URLSearchParams({
        period: normalizedPeriod,
        anchor: normalizedAnchor,
      });
      const response = await fetch(`/api/admin/member-login-activity/stats?${query.toString()}`, {
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
          || `회원 로그인 통계를 불러오지 못했습니다. (${response.status})`,
        );
      }
      if (!payload || typeof payload !== 'object') {
        throw new Error('회원 로그인 통계 응답 형식을 확인할 수 없습니다.');
      }
      if (payload.success === false) {
        throw new Error(payload.message || payload.msg || '회원 로그인 통계를 불러오지 못했습니다.');
      }

      const normalizedData = normalizeMemberLoginResponse(
        payload,
        normalizedPeriod,
        normalizedAnchor,
      );
      if (requestIdRef.current === requestId) setData(normalizedData);
      return normalizedData;
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') return null;

      console.error('[admin] member login stats fetch failed:', fetchError);
      if (requestIdRef.current === requestId) {
        setError(fetchError?.message || '회원 로그인 통계를 불러오지 못했습니다.');
      }
      return null;
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [enabled, normalizedAnchor, normalizedPeriod]);

  useEffect(() => {
    if (!enabled) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestIdRef.current += 1;
      setLoading(false);
      return undefined;
    }

    reload();
    return () => abortControllerRef.current?.abort();
  }, [enabled, reload]);

  return { data, loading, error, reload };
}
