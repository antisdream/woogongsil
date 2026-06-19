// 관리자 기능 모듈입니다: useAdminMealMap
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, mealMapLayoutDefaultsV253 } from './adminUtils.js';

export default function useAdminMealMap({
  activeAdminTab,
  canOpenAdmin,
  makeAdminHeaders,
}) {
  const [mealMapPlaces, setMealMapPlaces] = useState([]);
  const [mealMapStats, setMealMapStats] = useState({});
  const [mealMapStatusFilter, setMealMapStatusFilter] = useState('approved');
  const [mealMapKeyword, setMealMapKeyword] = useState('');
  const [mealMapLoading, setMealMapLoading] = useState(false);
  const [mealMapSavingId, setMealMapSavingId] = useState(null);
  const [mealMapError, setMealMapError] = useState('');

  const [mealMapEditRequests, setMealMapEditRequests] = useState([]);
  const [mealMapEditStats, setMealMapEditStats] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [mealMapEditStatusFilter, setMealMapEditStatusFilter] = useState('pending');
  const [mealMapEditKeyword, setMealMapEditKeyword] = useState('');
  const [mealMapEditLoading, setMealMapEditLoading] = useState(false);
  const [mealMapEditError, setMealMapEditError] = useState('');
  const [mealMapSuccess, setMealMapSuccess] = useState('');
  const [mealMapTextSettings, setMealMapTextSettings] = useState({});

  const [mealMapLayoutsV253, setMealMapLayoutsV253] = useState(mealMapLayoutDefaultsV253);
  const [mealMapTextLoading, setMealMapTextLoading] = useState(false);
  const [mealMapTextSaving, setMealMapTextSaving] = useState(false);

  const loadMealMapLayoutsV253 = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/mealmap/layouts`, {
        method: 'GET',
        headers: makeAdminHeaders(),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || '회식맵 레이아웃 설정을 불러오지 못했습니다.');
      }
      const settings = data?.settings || data?.layouts || {};
      setMealMapLayoutsV253((prev) => ({ ...prev, ...settings }));
    } catch (err) {
      console.warn('[mealmap layout load]', err);
    }
  }, [makeAdminHeaders]);

  const saveMealMapLayoutSettingsV253 = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/mealmap/layouts`, {
        method: 'PUT',
        headers: makeAdminHeaders(),
        credentials: 'include',
        body: JSON.stringify({ settings: mealMapLayoutsV253 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || '회식맵 레이아웃 설정 저장에 실패했습니다.');
      }
      setMealMapSuccess('회식맵 레이아웃 설정을 저장했습니다.');
      await loadMealMapLayoutsV253();
    } catch (err) {
      setMealMapError(err?.message || '회식맵 레이아웃 설정 저장에 실패했습니다.');
    }
  }, [makeAdminHeaders, mealMapLayoutsV253, loadMealMapLayoutsV253]);

  const fetchMealMapAdminPlaces = useCallback(async () => {
    setMealMapLoading(true);
    setMealMapError('');
    try {
      const params = new URLSearchParams();
      params.set('status', mealMapStatusFilter);
      if (mealMapKeyword.trim()) params.set('keyword', mealMapKeyword.trim());
      const response = await fetch(`/api/admin/mealmap/places?${params.toString()}`, {
        method: 'GET',
        headers: makeAdminHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || data.msg || '회식맵 제보 목록을 불러오지 못했습니다.');
      setMealMapPlaces(Array.isArray(data.places) ? data.places : []);
      setMealMapStats(data.stats || {});
    } catch (error) {
      console.error('[admin mealmap] list failed:', error);
      setMealMapError(error.message || '회식맵 제보 목록을 불러오지 못했습니다.');
    } finally {
      setMealMapLoading(false);
    }
  }, [makeAdminHeaders, mealMapStatusFilter, mealMapKeyword]);

  const runMealMapAdminAction = useCallback(async (place, action) => {
    if (!place?.id) return;
    const label = action === 'approve'? '승인' : action === 'reject'? '반려' : '삭제 요청';
    const ok = window.confirm(`'${place.name}' 회식맵 식당을 ${label}할까요?`);
    if (!ok) return;

    setMealMapSavingId(place.id);
    setMealMapError('');
    setMealMapSuccess('');
    try {
      const method = action === 'delete'? 'DELETE' : 'POST';
      const url = action === 'delete'? `/api/admin/mealmap/places/${place.id}`
        : `/api/admin/mealmap/places/${place.id}/${action}`;
      const response = await fetch(url, {
        method,
        headers: makeAdminHeaders(),
        body: method === 'DELETE'? undefined : JSON.stringify({ adminNote: '' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || data.msg || `${label} 처리에 실패했습니다.`);
      setMealMapSuccess(data.message || `${label} 처리되었습니다.`);
      await fetchMealMapAdminPlaces();
    } catch (error) {
      console.error('[admin mealmap] action failed:', error);
      setMealMapError(error.message || `${label} 처리에 실패했습니다.`);
    } finally {
      setMealMapSavingId(null);
    }
  }, [fetchMealMapAdminPlaces, makeAdminHeaders]);

  useEffect(() => {
    if (!canOpenAdmin || activeAdminTab !== 'mealmap') return;
    fetchMealMapAdminPlaces();
  }, [canOpenAdmin, activeAdminTab, fetchMealMapAdminPlaces]);

  const loadMealMapTextSettings = useCallback(async () => {
    try {
      setMealMapTextLoading(true);
      const res = await fetch(`${API_BASE}/api/admin/mealmap/texts`, {
        method: 'GET',
        headers: makeAdminHeaders(),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.msg || '회식맵 문구 설정을 불러오지 못했습니다.');
      setMealMapTextSettings(data.texts || {});
    } catch (err) {
      setMealMapError(err.message || '회식맵 문구 설정을 불러오지 못했습니다.');
    } finally {
      setMealMapTextLoading(false);
    }
  }, [makeAdminHeaders]);

  const updateMealMapTextSetting = useCallback((key, value) => {
    setMealMapTextSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveMealMapTextSettings = useCallback(async () => {
    try {
      setMealMapTextSaving(true);
      setMealMapError('');
      setMealMapSuccess('');
      const res = await fetch(`${API_BASE}/api/admin/mealmap/texts`, {
        method: 'PUT',
        headers: makeAdminHeaders(),
        credentials: 'include',
        body: JSON.stringify({ texts: mealMapTextSettings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.msg || '회식맵 문구 설정을 저장하지 못했습니다.');
      setMealMapTextSettings(data.texts || mealMapTextSettings);
      setMealMapSuccess(data.msg || '회식맵 문구 설정이 저장되었습니다.');
    } catch (err) {
      setMealMapError(err.message || '회식맵 문구 설정을 저장하지 못했습니다.');
    } finally {
      setMealMapTextSaving(false);
    }
  }, [makeAdminHeaders, mealMapTextSettings]);

  const fetchMealMapEditRequests = useCallback(async () => {
    try {
      setMealMapEditLoading(true);
      setMealMapEditError('');

      const params = new URLSearchParams();
      if (mealMapEditStatusFilter && mealMapEditStatusFilter !== 'all') {
        params.set('status', mealMapEditStatusFilter);
      }
      if (mealMapEditKeyword.trim()) {
        params.set('keyword', mealMapEditKeyword.trim());
      }

      const query = params.toString();
      const response = await fetch(`/api/admin/mealmap/edits${query ? `?${query}` : ''}`, {
        headers: makeAdminHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.msg || '회식맵 수정 제안 목록을 불러오지 못했어.');
      }

      setMealMapEditRequests(data.edits || []);
      setMealMapEditStats(data.stats || { pending: 0, approved: 0, rejected: 0 });
    } catch (error) {
      setMealMapEditError(error.message || '회식맵 수정 제안 목록을 불러오지 못했습니다.');
    } finally {
      setMealMapEditLoading(false);
    }
  }, [makeAdminHeaders, mealMapEditStatusFilter, mealMapEditKeyword]);

  const runMealMapEditAction = useCallback(async (request, action) => {
    const isApprove = action === 'approve';
    const label = isApprove ? '승인' : '반려';
    if (!window.confirm(`'${request.place_name || request.current_name || '회식맵 장소'}' 수정 제안을 ${label}할까요?`)) return;

    const body = {};
    if (!isApprove) {
      const reason = window.prompt('반려 사유를 입력해 주세요. 비워두면 기본 문구로 저장됩니다.', '운영 기준에 맞지 않아 반려되었습니다.');
      if (reason === null) return;
      body.reason = reason.trim() || '운영 기준에 맞지 않아 반려되었습니다.';
    }

    try {
      const response = await fetch(`/api/admin/mealmap/edits/${request.id}/${action}`, {
        method: 'POST',
        headers: makeAdminHeaders(),
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.msg || `수정 제안 ${label} 처리에 실패했습니다.`);
      }

      setMealMapSuccess(data.msg || `수정 제안을 ${label} 처리했습니다.`);
      await fetchMealMapEditRequests();
      await fetchMealMapAdminPlaces();
    } catch (error) {
      setMealMapError(error.message || `수정 제안 ${label} 처리에 실패했습니다.`);
    }
  }, [makeAdminHeaders, fetchMealMapEditRequests, fetchMealMapAdminPlaces]);

  useEffect(() => {
    if (!canOpenAdmin || activeAdminTab !== 'mealmap') return;
    fetchMealMapEditRequests();
    loadMealMapTextSettings();
    loadMealMapLayoutsV253();
  }, [canOpenAdmin, activeAdminTab, fetchMealMapEditRequests, loadMealMapTextSettings, loadMealMapLayoutsV253]);

  return {
    mealMapPlaces,
    mealMapStats,
    mealMapStatusFilter,
    setMealMapStatusFilter,
    mealMapKeyword,
    setMealMapKeyword,
    mealMapLoading,
    mealMapSavingId,
    mealMapError,
    mealMapSuccess,
    mealMapEditRequests,
    mealMapEditStats,
    mealMapEditStatusFilter,
    setMealMapEditStatusFilter,
    mealMapEditKeyword,
    setMealMapEditKeyword,
    mealMapEditLoading,
    mealMapEditError,
    mealMapTextSettings,
    mealMapLayoutsV253,
    setMealMapLayoutsV253,
    mealMapTextLoading,
    mealMapTextSaving,
    loadMealMapLayoutsV253,
    saveMealMapLayoutSettingsV253,
    fetchMealMapAdminPlaces,
    runMealMapAdminAction,
    loadMealMapTextSettings,
    updateMealMapTextSetting,
    saveMealMapTextSettings,
    fetchMealMapEditRequests,
    runMealMapEditAction,
  };
}
