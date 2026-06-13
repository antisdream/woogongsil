// 회식맵 기능 모듈입니다: useMealMapActivity
import { useCallback, useState } from 'react';
import { API_BASE, EMPTY_FORM, MEAL_CATEGORIES, authHeaders } from './mealMapUtils.js';

export default function useMealMapActivity({
  isLoggedIn,
  setError,
  setMessage,
  setForm,
  setAddOpen,
  setEditPlace,
  setEditForm,
  setEditOpen,
  goMealMapRoute,
}) {
  // 로그인 사용자가 본인의 제보/수정 제안 처리 이력을 확인하는 팝업 상태다.
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityItems, setActivityItems] = useState([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotalPages, setActivityTotalPages] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);

  // 회식맵 활동 이력을 20개씩 불러온다.
  const fetchActivityHistory = useCallback(async (nextPage = 1) => {
    if (!isLoggedIn) {
      setError('로그인 후 활동 이력을 확인할 수 있습니다.');
      return;
    }

    setActivityLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: '20' });
      const response = await fetch(`${API_BASE}/api/mealmap/my-activity?${params.toString()}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || data.msg || '활동 이력을 불러오지 못했습니다.');
      setActivityItems(Array.isArray(data.items) ? data.items : []);
      setActivityPage(Number(data.page || nextPage));
      setActivityTotalPages(Math.max(1, Number(data.totalPages || 1)));
      setActivityTotal(Number(data.total || 0));
    } catch (err) {
      setActivityItems([]);
      setError(err.message || '활동 이력을 불러오지 못했습니다.');
    } finally {
      setActivityLoading(false);
    }
  }, [isLoggedIn, setError]);

  const openActivityHistory = () => {
    if (!isLoggedIn) {
      setError('로그인 후 활동 이력을 확인할 수 있습니다.');
      return;
    }
    setActivityOpen(true);
    goMealMapRoute('activity');
    fetchActivityHistory(1);
  };

  // 반려된 장소 제보의 이전 입력 내용을 제보 모달에 다시 채운다.
  const reopenRejectedPlaceReport = (activity) => {
    const payload = activity?.payload || {};
    setForm({
      ...EMPTY_FORM,
      name: payload.name || activity?.placeName || '',
      address: payload.address || activity?.address || '',
      roadAddress: payload.roadAddress || activity?.roadAddress || '',
      category: MEAL_CATEGORIES.includes(payload.category) ? payload.category : '한식',
      minPrice: payload.minPrice || activity?.minPrice || EMPTY_FORM.minPrice,
      maxPrice: payload.maxPrice || activity?.maxPrice || EMPTY_FORM.maxPrice,
      mainMenu: payload.mainMenu || activity?.mainMenu || '',
      openingHours: payload.openingHours || activity?.openingHours || '',
      lat: payload.lat || '',
      lng: payload.lng || '',
      naverUrl: payload.naverUrl || '',
      kakaoUrl: payload.kakaoUrl || '',
      reportNote: payload.reportNote || activity?.requestNote || '',
    });
    setActivityOpen(false);
    setAddOpen(true);
    goMealMapRoute('report');
    setMessage('반려된 장소 제보 내용을 다시 불러왔습니다. 필요한 부분만 수정한 뒤 새로 제출해주세요.');
  };

  // 반려된 수정 제안의 이전 입력 내용을 수정 제안 모달에 다시 채운다.
  const reopenRejectedEditRequest = (activity) => {
    const payload = activity?.payload || {};
    const placeId = payload.placeId || activity?.placeId;
    setEditPlace({
      id: placeId,
      name: payload.currentName || activity?.currentName || payload.name || activity?.placeName || '수정 대상 식당',
      address: payload.currentAddress || activity?.currentAddress || payload.address || activity?.address || '',
      category: payload.category || activity?.category || '한식',
      min_price: payload.minPrice || activity?.minPrice || 1000,
      max_price: payload.maxPrice || activity?.maxPrice || 10000,
      main_menu: payload.mainMenu || activity?.mainMenu || '',
      opening_hours: payload.openingHours || activity?.openingHours || '',
      naver_url: payload.naverUrl || '',
      kakao_url: payload.kakaoUrl || '',
      lat: payload.lat || '',
      lng: payload.lng || '',
    });
    setEditForm({
      reason: payload.reason || activity?.requestNote || '',
      name: payload.name || activity?.placeName || '',
      category: MEAL_CATEGORIES.includes(payload.category) ? payload.category : '한식',
      minPrice: payload.minPrice || activity?.minPrice || 1000,
      maxPrice: payload.maxPrice || activity?.maxPrice || 10000,
      address: payload.address || activity?.address || '',
      roadAddress: payload.roadAddress || activity?.roadAddress || '',
      lat: payload.lat || '',
      lng: payload.lng || '',
      mainMenu: payload.mainMenu || activity?.mainMenu || '',
      openingHours: payload.openingHours || activity?.openingHours || '',
      naverUrl: payload.naverUrl || '',
      kakaoUrl: payload.kakaoUrl || '',
    });
    setActivityOpen(false);
    setEditOpen(true);
    goMealMapRoute('edit-suggestion');
    setMessage('반려된 수정 제안 내용을 다시 불러왔습니다. 필요한 부분만 수정한 뒤 새로 제출해주세요.');
  };

  const handleActivityResubmit = (activity) => {
    if (!activity || activity.status !== 'rejected') return;
    if (activity.type === 'edit') {
      reopenRejectedEditRequest(activity);
      return;
    }
    reopenRejectedPlaceReport(activity);
  };


  return {
    activityOpen,
    setActivityOpen,
    activityLoading,
    activityItems,
    activityPage,
    activityTotalPages,
    activityTotal,
    fetchActivityHistory,
    openActivityHistory,
    handleActivityResubmit,
  };
}
