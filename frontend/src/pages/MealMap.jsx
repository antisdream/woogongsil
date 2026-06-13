// 회식맵 라우트 페이지 컴포넌트입니다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MealMapActivityModal,
  MealMapAddModal,
  MealMapEditModal,
  MealMapFilterModal,
} from '../features/mealmap/MealMapModals.jsx';
import MealMapMapSection from '../features/mealmap/MealMapMapSection.jsx';
import useMealMapActivity from '../features/mealmap/useMealMapActivity.js';
import useMealMapKakaoMap from '../features/mealmap/useMealMapKakaoMap.js';
import {
  API_BASE,
  DEFAULT_MEALMAP_TEXTS,
  EMPTY_FORM,
  KAKAO_MAP_JS_KEY_FROM_BUILD,
  MEALMAP_LAYOUT_DEFAULTS_V253,
  MEAL_CATEGORIES,
  PRICE_MIN,
  applyMealMapLayoutVarsV253,
  authHeaders,
  getStoredAuth,
  normalizeCategorySelection,
} from '../features/mealmap/mealMapUtils.js';


function MealMap() {
  const location = useLocation();
  const navigate = useNavigate();
  const mealMapRouteMode = useMemo(() => String(location.pathname || '/mealmap').split('/').filter(Boolean)[1] || 'map', [location.pathname]);

  const [places, setPlaces] = useState([]);
  const [config, setConfig] = useState({
    mapEnabled: Boolean(KAKAO_MAP_JS_KEY_FROM_BUILD),
    mapClientId: KAKAO_MAP_JS_KEY_FROM_BUILD,
    mapProvider: KAKAO_MAP_JS_KEY_FROM_BUILD ? 'kakao' : 'mock',
    searchEnabled: false,
    geocodeEnabled: false,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [pageTexts, setPageTexts] = useState(DEFAULT_MEALMAP_TEXTS);
  
  const [, setPageLayoutsV253] = useState(MEALMAP_LAYOUT_DEFAULTS_V253);

  useEffect(() => {
    let alive = true;
    async function loadMealMapLayoutsV253() {
      try {
        const res = await fetch(`${API_BASE}/api/mealmap/layouts`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!alive || !data?.success) return;
        const layouts = { ...MEALMAP_LAYOUT_DEFAULTS_V253, ...(data.layouts || {}) };
        setPageLayoutsV253(layouts);
        applyMealMapLayoutVarsV253(layouts);
      } catch (err) {
        applyMealMapLayoutVarsV253(MEALMAP_LAYOUT_DEFAULTS_V253);
      }
    }
    applyMealMapLayoutVarsV253(MEALMAP_LAYOUT_DEFAULTS_V253);
    loadMealMapLayoutsV253();
    return () => {
      alive = false;
    };
  }, []);
const mt = (key) => pageTexts?.[key] || DEFAULT_MEALMAP_TEXTS[key] || '';
  const [error, setError] = useState('');
  const [zoomLevel, setZoomLevel] = useState(11);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const [draftFilters, setDraftFilters] = useState({ minPrice: PRICE_MIN, maxPrice: 100000, categories: ['전체'] });
  const [appliedFilters, setAppliedFilters] = useState({ minPrice: PRICE_MIN, maxPrice: 100000, categories: ['전체'] });
  const [keyword, setKeyword] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [editGeocoding, setEditGeocoding] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editPlace, setEditPlace] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [formLookupKeyword, setFormLookupKeyword] = useState('');
  const [formLookupResults, setFormLookupResults] = useState([]);
  const [formLookupSearching, setFormLookupSearching] = useState(false);
  const [editLookupKeyword, setEditLookupKeyword] = useState('');
  const [editLookupResults, setEditLookupResults] = useState([]);
  const [editLookupSearching, setEditLookupSearching] = useState(false);
  const [editForm, setEditForm] = useState({
      reason: '',
      name: '',
      category: '한식',
      minPrice: 1000,
      maxPrice: 10000,
      address: '',
      roadAddress: '',
      lat: 37.5702,
      lng: 126.982,
      mainMenu: '',
      openingHours: '',
      naverUrl: '',
      kakaoUrl: '',
  });
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const {
    mapRef,
    kakaoMapCanvasRef,
    mapStatus,
    mapDebug,
  } = useMealMapKakaoMap({
    config,
    places,
    selectedPlace,
    setSelectedPlace,
  });


  const isClusterMode = zoomLevel < 13;
  const auth = getStoredAuth();
  const isLoggedIn = Boolean(auth.userId && auth.sessionToken);

  // 회식맵의 주요 기능 모달을 /mealmap/report, /mealmap/filter, /mealmap/activity, /mealmap/edit-suggestion 주소와 연결합니다.
  // 장소 목록, 지도, 댓글, 승인 요청 API 로직은 그대로 두고 사용자가 기능 위치를 새로고침/공유할 수 있게 주소만 동기화합니다.
  const goMealMapRoute = useCallback((mode = '') => {
    navigate(mode ? `/mealmap/${mode}` : '/mealmap');
  }, [navigate]);

  const closeMealMapModal = useCallback(() => {
    goMealMapRoute('');
  }, [goMealMapRoute]);

  const openMealMapReport = useCallback(() => {
    setAddOpen(true);
    goMealMapRoute('report');
  }, [goMealMapRoute]);

  const openMealMapFilter = useCallback(() => {
    setFilterOpen(true);
    goMealMapRoute('filter');
  }, [goMealMapRoute]);

  const {
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
  } = useMealMapActivity({
    isLoggedIn,
    setError,
    setMessage,
    setForm,
    setAddOpen,
    setEditPlace,
    setEditForm,
    setEditOpen,
    goMealMapRoute,
  });

  const categoriesForQuery = useMemo(() => {
    if (!appliedFilters.categories || appliedFilters.categories.includes('전체')) return '';
    return appliedFilters.categories.join(',');
  }, [appliedFilters.categories]);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/mealmap/config`);
      const data = await response.json().catch(() => ({}));
      if (data.success) {
        const runtimeMapKey = data.map?.clientId || data.map?.appKey || '';
        const mapClientId = runtimeMapKey || KAKAO_MAP_JS_KEY_FROM_BUILD;
        setConfig({
          mapEnabled: Boolean(mapClientId),
          mapClientId,
          mapProvider: data.map?.provider || (mapClientId ? 'kakao' : 'mock'),
          searchEnabled: Boolean(data.search?.enabled),
          geocodeEnabled: Boolean(data.geocode?.enabled),
        });
      }
    } catch (err) {
      console.warn('[mealmap] config load skipped:', err);
    }
  }, []);

  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('minPrice', String(appliedFilters.minPrice));
      params.set('maxPrice', String(appliedFilters.maxPrice));
      if (categoriesForQuery) params.set('categories', categoriesForQuery);
      if (keyword.trim()) params.set('keyword', keyword.trim());

      const response = await fetch(`${API_BASE}/api/mealmap/places?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || data.msg || '회식맵 장소를 불러오지 못했습니다.');
      const nextPlaces = Array.isArray(data.places) ? data.places : [];
      setPlaces(nextPlaces);
      setSelectedPlace((prev) => prev || nextPlaces[0] || null);
    } catch (err) {
      setError(err.message || '회식맵 장소를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, categoriesForQuery, keyword]);

  const fetchComments = useCallback(async (placeId) => {
    if (!placeId) return;
    setCommentsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/mealmap/places/${placeId}/comments`, {
        headers: authHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || data.msg || '댓글을 불러오지 못했습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (err) {
      console.warn('[mealmap] comment load failed:', err);
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/mealmap/texts`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        if (data?.success && data?.texts) {
          setPageTexts({ ...DEFAULT_MEALMAP_TEXTS, ...data.texts });
        }
      })
      .catch(() => {
        // 문구 설정 API가 실패해도 기본 문구로 페이지를 계속 보여줍니다.
      });
    return () => { alive = false; };
  }, []);


  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    fetchPlaces();
  }, [fetchPlaces]);

  useEffect(() => {
    if (selectedPlace?.id) fetchComments(selectedPlace.id);
  }, [selectedPlace?.id, fetchComments]);


  const applyFilters = () => {
    setAppliedFilters({
      minPrice: Math.min(Number(draftFilters.minPrice), Number(draftFilters.maxPrice)),
      maxPrice: Math.max(Number(draftFilters.minPrice), Number(draftFilters.maxPrice)),
      categories: normalizeCategorySelection(draftFilters.categories),
    });
    setFilterOpen(false);
    closeMealMapModal();
  };

  const resetFilters = () => {
    const next = { minPrice: PRICE_MIN, maxPrice: 100000, categories: ['전체'] };
    setDraftFilters(next);
    setAppliedFilters(next);
  };

  const toggleDraftCategory = (category) => {
    setDraftFilters((prev) => {
      if (category === '전체') return { ...prev, categories: ['전체'] };
      const current = prev.categories.includes('전체') ? [] : prev.categories;
      const exists = current.includes(category);
      return { ...prev, categories: normalizeCategorySelection(exists ? current.filter((item) => item !== category) : [...current, category]) };
    });
  };

  const geocodeAddress = async (address) => {
    const trimmed = String(address || '').trim();
    if (!trimmed) throw new Error('주소를 먼저 입력해주세요.');

    const response = await fetch(`${API_BASE}/api/mealmap/geocode?address=${encodeURIComponent(trimmed)}`, {
      headers: authHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.message || data.msg || '주소 좌표를 찾지 못했습니다.');
    }
    return data.result || {};
  };

  const fillFormCoordinates = async () => {
    setGeocoding(true);
    setError('');
    setMessage('');
    try {
      const result = await geocodeAddress(form.address);
      setForm((prev) => ({
        ...prev,
        address: result.address || prev.address,
        roadAddress: result.roadAddress || prev.roadAddress,
        lat: result.lat ?? prev.lat,
        lng: result.lng ?? prev.lng,
      }));
      setMessage('주소 기준 좌표를 찾았습니다. 내용을 확인한 뒤 관리자 승인 요청을 보내주세요.');
    } catch (err) {
      setError(err.message || '주소 좌표를 찾지 못했습니다.');
    } finally {
      setGeocoding(false);
    }
  };

  const fillEditCoordinates = async () => {
    setEditGeocoding(true);
    setMessage('');
    try {
      const result = await geocodeAddress(editForm.address);
      setEditForm((prev) => ({
        ...prev,
        address: result.address || prev.address,
        roadAddress: result.roadAddress || prev.roadAddress,
        lat: result.lat ?? prev.lat,
        lng: result.lng ?? prev.lng,
      }));
      setMessage('주소 기준 좌표를 찾았습니다. 수정 내용을 확인한 뒤 제안해주세요.');
    } catch (err) {
      setMessage(err.message || '주소 좌표를 찾지 못했습니다.');
    } finally {
      setEditGeocoding(false);
    }
  };


  const getLookupState = (target) => {
    const isEdit = target === 'edit';
    return {
      isEdit,
      keyword: isEdit ? editLookupKeyword : formLookupKeyword,
      fallbackKeyword: isEdit
        ? [editForm.name, editForm.address].filter(Boolean).join(' ')
        : [form.name, form.address].filter(Boolean).join(' '),
      setSearching: isEdit ? setEditLookupSearching : setFormLookupSearching,
      setResults: isEdit ? setEditLookupResults : setFormLookupResults,
    };
  };

  const lookupPlaceKeyword = async (target) => {
    const state = getLookupState(target);
    const keyword = (state.keyword || state.fallbackKeyword || '').trim();
    if (!keyword) {
      setMessage('카카오 장소 검색어를 입력해주세요.');
      return;
    }

    state.setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/mealmap/search?keyword=${encodeURIComponent(keyword)}`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      const results = Array.isArray(data.results) ? data.results.slice(0, 7) : [];
      state.setResults(results);
      if (!results.length) {
        setMessage('카카오 장소 검색 결과가 없습니다. 주소 검색을 함께 사용해주세요.');
      }
    } catch (err) {
      console.error(err);
      setMessage('카카오 장소 검색 중 오류가 발생했습니다.');
    } finally {
      state.setSearching(false);
    }
  };

  const applyLookupResult = (target, item) => {
    if (!item) return;

    const nextName = String(item.name || item.title || '').trim();
    const nextAddress = String(item.roadAddress || item.address || '').trim();
    const nextRoadAddress = String(item.roadAddress || '').trim();
    const nextLat = item.lat != null ? String(item.lat) : '';
    const nextLng = item.lng != null ? String(item.lng) : '';
    const nextUrl = String(item.kakaoUrl || item.url || item.link || '').trim();

    const apply = (prev) => ({
      ...prev,
      name: nextName || prev.name,
      address: nextAddress || prev.address,
      roadAddress: nextRoadAddress || prev.roadAddress,
      lat: nextLat || prev.lat,
      lng: nextLng || prev.lng,
      kakaoUrl: nextUrl || prev.kakaoUrl,
      naverUrl: nextUrl || prev.naverUrl,
    });

    if (target === 'edit') {
      setEditForm(apply);
      setEditLookupResults([]);
      setEditLookupKeyword(nextName || nextAddress || '');
    } else {
      setForm(apply);
      setFormLookupResults([]);
      setFormLookupKeyword(nextName || nextAddress || '');
    }

    setMessage('카카오 장소 검색 결과가 입력되었습니다. 필요하면 내용을 확인 후 수정해주세요.');
  };

  const submitPlace = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (!isLoggedIn) {
      setError('로그인 후 장소를 제보할 수 있습니다.');
      return;
    }

    if (!form.name.trim() || !form.address.trim()) {
      setError('식당명과 주소는 필수입니다.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/mealmap/places`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          ...form,
          id: auth.userId,
          sessionToken: auth.sessionToken,
          reporterName: auth.userName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || data.msg || '장소 제보에 실패했습니다.');
      setMessage(data.message || '장소 제보가 접수되었습니다. 관리자 승인 후 공개됩니다.');
      setForm(EMPTY_FORM);
      setAddOpen(false);
      closeMealMapModal();
      fetchPlaces();
    } catch (err) {
      setError(err.message || '장소 제보에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitComment = async () => {
    if (!selectedPlace?.id) return;
    if (!isLoggedIn) {
      setError('로그인 후 댓글을 남길 수 있습니다.');
      return;
    }
    const text = commentText.trim();
    if (!text) return;

    try {
      const response = await fetch(`${API_BASE}/api/mealmap/places/${selectedPlace.id}/comments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id: auth.userId, sessionToken: auth.sessionToken, text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || '댓글 등록에 실패했습니다.');
      setCommentText('');
      setMessage('댓글이 등록되었습니다.');
      setSelectedPlace((prev) => (prev && prev.id === selectedPlace.id
        ? { ...prev, comment_count: Number(prev.comment_count || 0) + 1 }
        : prev));
      await fetchComments(selectedPlace.id);
    } catch (err) {
      setError(err.message || '댓글 등록에 실패했습니다.');
    }
  };

  const toggleLike = async (place) => {
    if (!place?.id) return;
    if (!isLoggedIn) {
      setError('로그인 후 좋아요를 누를 수 있습니다.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/mealmap/places/${place.id}/like`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id: auth.userId, sessionToken: auth.sessionToken }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || data.msg || '좋아요 처리에 실패했습니다.');
      }

      const nextLiked = typeof data.liked === 'boolean'? data.liked
        : (typeof data.liked_by_me === 'boolean'? data.liked_by_me : !place.liked_by_me);
      const nextLikeCount = Number.isFinite(Number(data.like_count))
        ? Number(data.like_count)
        : Math.max(0, Number(place.like_count || 0) + (nextLiked ? 1 : -1));

      const applyLikeState = (target) => {
        if (!target || Number(target.id) !== Number(place.id)) return target;
        return {
          ...target,
          liked_by_me: nextLiked,
          like_count: nextLikeCount,
        };
      };

      setPlaces((prev) => prev.map(applyLikeState));
      setSelectedPlace((prev) => applyLikeState(prev));
      setMessage(nextLiked ? '좋아요가 반영되었습니다.' : '좋아요가 취소되었습니다.');

      await fetchPlaces();
    } catch (err) {
      setError(err.message || '좋아요 처리에 실패했습니다.');
    }
  };
    const openEditRequest = useCallback((place) => {
        if (!place) return;
        setEditPlace(place);
        setEditForm({
            reason: '',
            name: place.name || '',
            category: place.category || '한식',
            minPrice: Number(place.min_price ?? place.minPrice ?? 1000),
            maxPrice: Number(place.max_price ?? place.maxPrice ?? 10000),
            address: place.address || '',
            roadAddress: place.road_address || place.roadAddress || '',
            lat: Number(place.lat || 37.5702),
            lng: Number(place.lng || 126.982),
            mainMenu: place.main_menu || place.mainMenu || '',
            openingHours: place.opening_hours || place.openingHours || '',
            naverUrl: place.naver_url || place.naverUrl || '',
            kakaoUrl: place.kakao_url || place.kakaoUrl || '',
        });
        setEditOpen(true);
        goMealMapRoute('edit-suggestion');
    }, [goMealMapRoute]);

    const submitEditRequest = async (e) => {
        e.preventDefault();
        if (!editPlace) return;
        if (!editForm.name.trim() || !editForm.address.trim()) {
            setMessage('식당명과 주소를 입력해주세요.');
            return;
        }
        if (Number(editForm.maxPrice) < Number(editForm.minPrice)) {
            setMessage('최대 가격은 최소 가격보다 작을 수 없어.');
            return;
        }

        setEditLoading(true);
        setMessage('');
        try {
            const res = await fetch(`/api/mealmap/places/${editPlace.id}/edit-request`, {
                method: 'POST',
                headers: authHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    ...getStoredAuth(),
                    reason: (editForm.reason || '사용자가 식당 정보 수정을 제안했습니다.').trim(),
                    name: editForm.name,
                    category: editForm.category,
                    minPrice: Number(editForm.minPrice),
                    maxPrice: Number(editForm.maxPrice),
                    address: editForm.address,
                    roadAddress: editForm.roadAddress,
                    lat: Number(editForm.lat),
                    lng: Number(editForm.lng),
                    mainMenu: editForm.mainMenu,
                    openingHours: editForm.openingHours,
                    naverUrl: editForm.naverUrl,
                    kakaoUrl: editForm.kakaoUrl,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.msg || '수정 제안 접수 실패');
            setMessage(data.msg || '수정 제안이 접수되었습니다.');
            setEditOpen(false);
            closeMealMapModal();
        } catch (err) {
            setMessage(err.message || '수정 제안 접수에 실패했습니다.');
        } finally {
            setEditLoading(false);
        }
    };

  const openExternalMap = (place) => {
    const target = place.kakao_url || place.kakaoUrl || place.naver_url || place.naverUrl || '';
    if (target) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    const q = encodeURIComponent(`${place.name || ''} ${place.address || ''}`.trim());
    window.open(`https://map.kakao.com/link/search/${q}`, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    if (mealMapRouteMode === 'report') {
      setFilterOpen(false);
      setActivityOpen(false);
      setEditOpen(false);
      setAddOpen(true);
      return;
    }

    if (mealMapRouteMode === 'filter') {
      setAddOpen(false);
      setActivityOpen(false);
      setEditOpen(false);
      setFilterOpen(true);
      return;
    }

    if (mealMapRouteMode === 'activity') {
      setAddOpen(false);
      setFilterOpen(false);
      setEditOpen(false);
      if (isLoggedIn) {
        setActivityOpen(true);
        fetchActivityHistory(1);
      } else {
        setActivityOpen(false);
        setError('로그인 후 활동 이력을 확인할 수 있습니다.');
      }
      return;
    }

    if (mealMapRouteMode === 'edit-suggestion') {
      setAddOpen(false);
      setFilterOpen(false);
      setActivityOpen(false);
      if (selectedPlace && !editOpen) {
        openEditRequest(selectedPlace);
      }
      return;
    }

    setAddOpen(false);
    setFilterOpen(false);
    setActivityOpen(false);
    setEditOpen(false);
  }, [editOpen, fetchActivityHistory, isLoggedIn, mealMapRouteMode, openEditRequest, selectedPlace, setActivityOpen]);

  const clusterGroups = useMemo(() => {
    const count = places.length;
    if (count <= 0) return [];
    if (count <= 8) return [{ label: String(count), count, left: '50%', top: '52%' }];
    const first = Math.ceil(count * 0.6);
    return [
      { label: String(first), count: first, left: '42%', top: '46%' },
      { label: String(count - first), count: count - first, left: '64%', top: '63%' },
    ];
  }, [places.length]);

  return (
    <div className="mealmap-page">
      <section className="mealmap-hero">
        <div>
          <p className="mealmap-kicker">{mt('heroEyebrow')}</p>
          <h1>회식맵</h1>
          <p>당신의 식당을 추천해주세요!</p>
        </div>
        <button type="button" className="mealmap-primary-btn" onClick={openMealMapReport}>{mt('submitButton')}</button>
      </section>

      {(message || error) && (
        <div className={`mealmap-alert ${error ? 'mealmap-alert-error' : 'mealmap-alert-success'}`}>
          {error || message}
        </div>
      )}

      <section className="mealmap-toolbar">
        <div className="mealmap-search-inline">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') fetchPlaces(); }}
            placeholder={mt('searchPlaceholder')}
          />
          <button type="button" onClick={fetchPlaces}>{mt('searchButton')}</button>
        </div>
        <div className="mealmap-icon-actions">
          <button type="button" onClick={openMealMapFilter} title="필터"> {mt('filterButton')}</button>
        </div>
      </section>

      <MealMapMapSection
        config={config}
        mt={mt}
        loading={loading}
        places={places}
        mapRef={mapRef}
        kakaoMapCanvasRef={kakaoMapCanvasRef}
        mapStatus={mapStatus}
        mapDebug={mapDebug}
        isClusterMode={isClusterMode}
        clusterGroups={clusterGroups}
        setZoomLevel={setZoomLevel}
        setSelectedPlace={setSelectedPlace}
        selectedPlace={selectedPlace}
        openExternalMap={openExternalMap}
        toggleLike={toggleLike}
        openEditRequest={openEditRequest}
        openActivityHistory={openActivityHistory}
        commentsLoading={commentsLoading}
        comments={comments}
        commentText={commentText}
        setCommentText={setCommentText}
        submitComment={submitComment}
      />

      <MealMapActivityModal
        open={activityOpen}
        closeMealMapModal={closeMealMapModal}
        activityLoading={activityLoading}
        activityItems={activityItems}
        activityPage={activityPage}
        activityTotal={activityTotal}
        activityTotalPages={activityTotalPages}
        fetchActivityHistory={fetchActivityHistory}
        handleActivityResubmit={handleActivityResubmit}
      />

      <MealMapFilterModal
        open={filterOpen}
        closeMealMapModal={closeMealMapModal}
        draftFilters={draftFilters}
        setDraftFilters={setDraftFilters}
        toggleDraftCategory={toggleDraftCategory}
        resetFilters={resetFilters}
        applyFilters={applyFilters}
      />

      <MealMapAddModal
        open={addOpen}
        submitPlace={submitPlace}
        closeMealMapModal={closeMealMapModal}
        isLoggedIn={isLoggedIn}
        form={form}
        setForm={setForm}
        fillFormCoordinates={fillFormCoordinates}
        geocoding={geocoding}
        formLookupKeyword={formLookupKeyword}
        setFormLookupKeyword={setFormLookupKeyword}
        lookupPlaceKeyword={lookupPlaceKeyword}
        formLookupSearching={formLookupSearching}
        formLookupResults={formLookupResults}
        applyLookupResult={applyLookupResult}
        submitting={submitting}
        mt={mt}
      />

      <MealMapEditModal
        open={editOpen}
        editPlace={editPlace}
        editForm={editForm}
        setEditForm={setEditForm}
        submitEditRequest={submitEditRequest}
        closeMealMapModal={closeMealMapModal}
        editLoading={editLoading}
        mt={mt}
        fillEditCoordinates={fillEditCoordinates}
        editGeocoding={editGeocoding}
        editLookupKeyword={editLookupKeyword}
        setEditLookupKeyword={setEditLookupKeyword}
        lookupPlaceKeyword={lookupPlaceKeyword}
        editLookupSearching={editLookupSearching}
        editLookupResults={editLookupResults}
        applyLookupResult={applyLookupResult}
      />

    </div>
  );
}

export default MealMap;
