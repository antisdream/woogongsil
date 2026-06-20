import { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_SIGNUP_REQUEST_STATS = {
  pending: 0,
  approved: 0,
  rejected: 0,
};

export default function useAdminSignupRequests({
  activeAdminTab,
  canOpenAdmin,
  makeAdminHeaders,
  refreshUsers,
}) {
  const [signupRequests, setSignupRequests] = useState([]);
  const [signupRequestStats, setSignupRequestStats] = useState(DEFAULT_SIGNUP_REQUEST_STATS);
  const [signupRequestStatusFilter, setSignupRequestStatusFilter] = useState('PENDING');
  const [signupRequestKeyword, setSignupRequestKeyword] = useState('');
  const [signupRequestLoading, setSignupRequestLoading] = useState(false);
  const [signupRequestError, setSignupRequestError] = useState('');
  const [signupRequestSuccess, setSignupRequestSuccess] = useState('');

  const fetchSignupRequests = useCallback(async (options = {}) => {
    setSignupRequestLoading(true);
    setSignupRequestError('');

    const status = options.status || signupRequestStatusFilter;
    const keyword = options.keyword ?? signupRequestKeyword;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (keyword.trim()) params.set('search', keyword.trim());

    try {
      const response = await fetch(`/api/admin/signup-requests?${params.toString()}`, {
        method: 'GET',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.message || '회원가입 승인 목록을 불러오지 못했습니다.');
      }

      setSignupRequests(Array.isArray(data.requests) ? data.requests : []);
      setSignupRequestStats({
        ...DEFAULT_SIGNUP_REQUEST_STATS,
        ...(data.stats || {}),
      });
    } catch (error) {
      console.error('[admin] signup requests fetch failed:', error);
      setSignupRequestError(error.message || '회원가입 승인 목록을 불러오지 못했습니다.');
    } finally {
      setSignupRequestLoading(false);
    }
  }, [makeAdminHeaders, signupRequestKeyword, signupRequestStatusFilter]);

  useEffect(() => {
    if (!canOpenAdmin || activeAdminTab !== 'signupRequests') return;
    fetchSignupRequests();
  }, [activeAdminTab, canOpenAdmin, fetchSignupRequests]);

  const handleSignupRequestSearch = useCallback((event) => {
    event.preventDefault();
    fetchSignupRequests({ keyword: signupRequestKeyword });
  }, [fetchSignupRequests, signupRequestKeyword]);

  const refreshSignupRequests = useCallback(() => {
    fetchSignupRequests();
    if (typeof refreshUsers === 'function') refreshUsers();
  }, [fetchSignupRequests, refreshUsers]);

  const approveSignupRequest = useCallback(async (request) => {
    if (!request?.id) return;
    const confirmed = window.confirm(`${request.name || request.loginId}님의 회원가입을 승인하시겠습니까?`);
    if (!confirmed) return;

    setSignupRequestError('');
    setSignupRequestSuccess('');
    try {
      const response = await fetch(`/api/admin/signup-requests/${encodeURIComponent(request.id)}/approve`, {
        method: 'POST',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || '회원가입 승인 처리에 실패했습니다.');
      }

      setSignupRequestSuccess(data.message || '회원가입을 승인했습니다.');
      refreshSignupRequests();
    } catch (error) {
      setSignupRequestError(error.message || '회원가입 승인 처리에 실패했습니다.');
    }
  }, [makeAdminHeaders, refreshSignupRequests]);

  const rejectSignupRequest = useCallback(async (request) => {
    if (!request?.id) return;
    const reason = window.prompt(`${request.name || request.loginId}님의 회원가입 거절 사유를 입력해주세요.`) || '';
    if (!reason.trim()) return;

    setSignupRequestError('');
    setSignupRequestSuccess('');
    try {
      const response = await fetch(`/api/admin/signup-requests/${encodeURIComponent(request.id)}/reject`, {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || '회원가입 거절 처리에 실패했습니다.');
      }

      setSignupRequestSuccess(data.message || '회원가입을 거절했습니다.');
      refreshSignupRequests();
    } catch (error) {
      setSignupRequestError(error.message || '회원가입 거절 처리에 실패했습니다.');
    }
  }, [makeAdminHeaders, refreshSignupRequests]);

  const pendingSignupRequestCount = useMemo(
    () => signupRequests.filter((request) => String(request.status || '').toUpperCase() === 'PENDING').length,
    [signupRequests]
  );

  return {
    signupRequests,
    signupRequestStats,
    signupRequestStatusFilter,
    setSignupRequestStatusFilter,
    signupRequestKeyword,
    setSignupRequestKeyword,
    signupRequestLoading,
    signupRequestError,
    signupRequestSuccess,
    pendingSignupRequestCount,
    fetchSignupRequests,
    handleSignupRequestSearch,
    approveSignupRequest,
    rejectSignupRequest,
  };
}
