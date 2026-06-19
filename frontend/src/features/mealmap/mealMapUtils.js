// 회식맵 기능 모듈입니다: mealMapUtils
export const MEALMAP_LAYOUT_DEFAULTS_V253 = {
    contentMaxWidth: '1480px',
    heroTitleSize: '42px',
    mapMinHeight: '760px',
    detailPanelWidth: '360px',
    cardRadius: '24px',
    sectionGap: '24px',
};

export function applyMealMapLayoutVarsV253(layouts = {}) {
    if (typeof document === 'undefined') return;
    const merged = { ...MEALMAP_LAYOUT_DEFAULTS_V253, ...(layouts || {}) };
    const root = document.documentElement;
    root.style.setProperty('--mealmap-content-max-width', merged.contentMaxWidth);
    root.style.setProperty('--mealmap-hero-title-size', merged.heroTitleSize);
    root.style.setProperty('--mealmap-map-min-height', merged.mapMinHeight);
    root.style.setProperty('--mealmap-detail-panel-width', merged.detailPanelWidth);
    root.style.setProperty('--mealmap-card-radius', merged.cardRadius);
    root.style.setProperty('--mealmap-section-gap', merged.sectionGap);
}

export const API_BASE = '';
export const KAKAO_MAP_JS_KEY_FROM_BUILD = import.meta.env?.VITE_KAKAO_MAP_JS_KEY || '';

export const DEFAULT_MEALMAP_TEXTS = {
    heroEyebrow: '회식 장소 추천',
    heroTitle: '회식맵',
    heroSubtitle: '제보한 장소는 바로 공개되고, 수정·삭제 요청은 관리자 검토 후 반영됩니다.',
    submitButton: '장소 제보',
    searchPlaceholder: '식당명, 주소, 메뉴 검색',
    searchButton: '검색',
    filterButton: '필터',
    mapTitle: '지도 API 미설정 목업 모드',
    mapCountPrefix: '공개 장소',
    mapCountText: '공개 장소 {count}개',
    mapGuideTitle: '안내: 가격과 식당명을 표시합니다.',
    mapGuideBody: '카카오 지도 API 키를 연결하기 전까지 목업 지도에서 기능 흐름을 확인할 수 있습니다.',
    emptyTitle: '등록된 식당이 없습니다.',
    emptyBody: '첫 회식 장소를 제보하면 이 영역에 바로 표시됩니다.',
    selectMarkerTitle: '마커를 선택하면 상세 정보가 표시됩니다.',
    selectMarkerBody: '식당 정보, 가격, 댓글, 지도 링크가 표시됩니다.',
    naverButton: '카카오지도/후기 보기',
    likeButton: '좋아요',
    editSuggestButton: '수정 제안',
    deleteSuggestButton: '삭제 요청',
    commentTitle: '댓글',
    commentPlaceholder: '댓글 입력...',
    commentSubmitButton: '등록',
    editModalEyebrow: '사용자 수정 제안',
    editModalSubtext: '관리자 승인 후 회식맵에 반영됩니다.',
    editReasonLabel: '수정 이유',
    editReasonPlaceholder: '예: 가격 변경, 영업시간 변경, 주소 오기입 등',
    editSubmitButton: '수정 제안 보내기',
    editCancelButton: '취소',
    editSuccessMessage: '수정 제안이 접수되었습니다. 관리자 승인 후 반영됩니다.',
    kakaoMapModeTitle: '카카오 지도 모드',
    loadingText: '불러오는 중...',
    kakaoMapAriaLabel: '카카오 지도',
    kakaoMapLoadingTitle: '카카오 지도를 불러오는 중입니다.',
    kakaoMapLoadingBody: '잠시 후에도 보이지 않으면 카카오 JavaScript 키와 Web 플랫폼 도메인을 확인해주세요.',
    kakaoMapErrorTitle: '카카오 지도를 불러오지 못했습니다.',
    kakaoMapErrorBody: '카카오 Developers의 Web 플랫폼 도메인에 현재 주소가 등록되어 있는지, JavaScript 키가 맞는지 확인해주세요.',
    kakaoMapDebugHint: '점검 주소: /api/mealmap/kakao/js-test',
    clusterZoomOutTitle: '줌아웃: 등록 개수 표시',
    clusterZoomInTitle: '줌인: 가격/식당명 표시',
    detailCloseAria: '상세 닫기',
    detailUnknownCategory: '식당',
    detailEmptyValue: '-',
    closeButton: '닫기',
    priceLabel: '가격',
    openingHoursLabel: '영업시간',
    mainMenuLabel: '대표메뉴',
    reporterLabel: '제보자',
    activityHistoryButton: '활동 이력',
    commentLoadingText: '댓글 불러오는 중...',
    commentEmptyText: '아직 등록된 댓글이 없습니다.',
    placeLoadFailMessage: '회식맵 장소를 불러오지 못했습니다.',
    commentLoadFailMessage: '댓글을 불러오지 못했습니다.',
    geocodeAddressRequiredMessage: '주소를 먼저 입력해주세요.',
    geocodeFailMessage: '주소 좌표를 찾지 못했습니다.',
    geocodeFormSuccessMessage: '주소 기준 좌표를 찾았습니다. 내용을 확인한 뒤 바로 등록해주세요.',
    geocodeEditSuccessMessage: '주소 기준 좌표를 찾았습니다. 수정 내용을 확인한 뒤 제안해주세요.',
    keywordRequiredMessage: '카카오 장소 검색어를 입력해주세요.',
    keywordEmptyMessage: '카카오 장소 검색 결과가 없습니다. 주소 검색을 함께 사용해주세요.',
    keywordErrorMessage: '카카오 장소 검색 중 오류가 발생했습니다.',
    keywordAppliedMessage: '카카오 장소 검색 결과가 입력되었습니다. 필요하면 내용을 확인 후 수정해주세요.',
    reportLoginRequiredMessage: '로그인 후 장소를 제보할 수 있습니다.',
    reportRequiredFieldsMessage: '식당명과 주소는 필수입니다.',
    reportSubmitFailMessage: '장소 제보에 실패했습니다.',
    reportSubmitSuccessMessage: '장소 제보가 등록되어 회식맵에 바로 공개되었습니다.',
    commentLoginRequiredMessage: '로그인 후 댓글을 남길 수 있습니다.',
    commentSubmitFailMessage: '댓글 등록에 실패했습니다.',
    commentSubmitSuccessMessage: '댓글이 등록되었습니다.',
    likeLoginRequiredMessage: '로그인 후 좋아요를 누를 수 있습니다.',
    likeFailMessage: '좋아요 처리에 실패했습니다.',
    likeSuccessMessage: '좋아요가 반영되었습니다.',
    likeCancelMessage: '좋아요가 취소되었습니다.',
    editRequiredFieldsMessage: '식당명과 주소를 입력해주세요.',
    editPriceRangeMessage: '최대 가격은 최소 가격보다 작을 수 없습니다.',
    editDefaultReason: '사용자가 식당 정보 수정을 제안했습니다.',
    editSubmitFailShortMessage: '수정 제안 접수 실패',
    editSubmitSuccessMessage: '수정 제안이 접수되었습니다.',
    editSubmitFailMessage: '수정 제안 접수에 실패했습니다.',
    deleteRequestPrompt: '삭제 요청 사유를 입력해주세요. 관리자 승인 후 숨김 처리됩니다.',
    deleteRequestConfirm: '이 식당의 삭제 요청을 관리자 결재 대기 목록에 등록할까요?',
    deleteRequestSuccessMessage: '삭제 요청이 접수되었습니다. 관리자 승인 후 숨김 처리됩니다.',
    deleteRequestFailMessage: '삭제 요청 접수에 실패했습니다.',
    activityLoginRequiredMessage: '로그인 후 활동 이력을 확인할 수 있습니다.',
    activityModalEyebrow: '회식맵 활동 이력',
    activityModalTitle: '제보/수정 제안 처리 내역',
    activityModalSubtext: '승인 대기, 승인 완료, 반려 상태를 확인하고 반려된 요청은 이전 입력 내용으로 다시 제출할 수 있습니다.',
    activityLoadingText: '활동 이력을 불러오는 중입니다.',
    activityEmptyText: '아직 등록된 회식맵 제보/수정 제안 이력이 없습니다.',
    activityColumnNo: 'No',
    activityColumnType: '유형',
    activityColumnStatus: '상태',
    activityColumnPlaceName: '식당명',
    activityColumnAddress: '주소',
    activityColumnPrice: '가격',
    activityColumnOpeningHours: '운영시간',
    activityColumnMainMenu: '대표메뉴',
    activityColumnRequestedAt: '요청일시',
    activityColumnProcessedAt: '처리일시',
    activityColumnResult: '처리 결과',
    activityColumnAction: '상세/다시 요청',
    activityTypeReport: '장소 제보',
    activityTypeEdit: '수정 제안',
    activityStatusPending: '승인 대기',
    activityStatusApproved: '승인 완료',
    activityStatusRejected: '반려',
    activityStatusHidden: '숨김',
    activityResubmitEditButton: '다시 수정 제안',
    activityResubmitReportButton: '다시 제보하기',
    activityDetailText: '상세 확인',
    activityTotalText: '전체 {count}건',
    activityPrevButton: '이전',
    activityNextButton: '다음',
    filterModalTitle: '상세 필터 설정',
    filterMinBudgetLabel: '최소 예산',
    filterMaxBudgetLabel: '최대 예산',
    filterResetButton: '초기화',
    filterApplyButton: '적용',
    addModalTitle: '장소 제보하기',
    loginRequiredText: '로그인 후 제보할 수 있습니다.',
    formNameLabel: '식당명 *',
    formCategoryLabel: '카테고리',
    formAddressLabel: '주소 *',
    formKeywordSearchLabel: '카카오 장소 키워드 검색',
    formKeywordPlaceholder: '예: 동남집 독산점, 가산디지털단지역 국밥',
    formGeocodingText: '좌표 찾는 중...',
    formGeocodeButton: '주소로 좌표 찾기',
    formLookupSearchingText: '검색 중...',
    formLookupButton: '키워드로 좌표 찾기',
    formLookupEmptyName: '이름 없음',
    formLookupEmptyAddress: '주소 정보 없음',
    formMinPriceLabel: '최소가격',
    formMaxPriceLabel: '최대가격',
    formMainMenuLabel: '대표메뉴',
    formOpeningHoursLabel: '영업시간',
    formOpeningHoursPlaceholder: '예: 09:00 - 22:00',
    formLatitudeLabel: '위도',
    formLongitudeLabel: '경도',
    formCoordinatePlaceholder: '선택',
    formMapUrlLabel: '카카오맵/후기 링크',
    formReportNoteLabel: '제보 메모',
    formSubmitLoadingText: '접수 중...',
    addSubmitButton: '바로 등록하기',
    editModalTitle: '{name} 정보 수정 요청',
    editNameLabel: '식당명',
    editCategoryLabel: '카테고리',
    editMinPriceLabel: '최소 가격',
    editMaxPriceLabel: '최대 가격',
    editAddressLabel: '주소',
    editKeywordSearchLabel: '카카오 장소 키워드 검색',
    editKeywordPlaceholder: '예: 동남집 독산점, 가산디지털단지역 국밥',
    editLatitudeLabel: '위도',
    editLongitudeLabel: '경도',
    editMainMenuLabel: '대표 메뉴',
    editOpeningHoursLabel: '영업시간',
    editMapUrlLabel: '카카오맵/후기 링크',
    editSubmitLoadingText: '접수 중...',
};

export const PRICE_MIN = 1000;
export const PRICE_MAX = 1000000;
export const KAKAO_MAP_DEFAULT_CENTER = { lat: 37.5665, lng: 126.9780 };
export const KAKAO_MAP_DEFAULT_LEVEL = 7;
export const KAKAO_MAP_SINGLE_PLACE_LEVEL = 5;
export const KAKAO_MAP_MAX_AUTO_LEVEL = 8;
export const PRICE_STEP = 1000;

export const MEAL_CATEGORIES = [
    '전체', '한식', '한식부페', '떡볶이', '중식', '국밥/해장국', '국수/칼국수', '쌀국수', '우동',
    '찌개/탕', '덮밥', '비빔밥', '돈까스', '치킨/통닭', '피자', '버거', '토스트', '커피/카페',
];

export const EMPTY_FORM = {
    name: '',
    address: '',
    roadAddress: '',
    category: '한식',
    minPrice: 7000,
    maxPrice: 12000,
    mainMenu: '',
    openingHours: '',
    lat: '',
    lng: '',
    naverUrl: '',
    kakaoUrl: '',
    sourceType: '',
    externalPlaceId: '',
    reportNote: '',
};

export function getStoredAuth() {
    return {
        userId: sessionStorage.getItem('userId') || '',
        userName: sessionStorage.getItem('userName') || '',
        sessionToken: sessionStorage.getItem('sessionToken') || '',
        serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
    };
}

export function authHeaders() {
    const auth = getStoredAuth();
    return {
        'Content-Type': 'application/json',
        'x-user-id': auth.userId,
        'x-session-token': auth.sessionToken,
        'x-server-instance-id': auth.serverInstanceId,
    };
}

export function formatPrice(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '-';
    return `${n.toLocaleString('ko-KR')}원`;
}

export function formatMealMapDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

export function getMealMapActivityTypeLabel(type) {
    return type === 'edit'? '수정 제안' : '장소 제보';
}

export function getMealMapActivityStatusLabel(status) {
    if (status === 'approved') return '승인 완료';
    if (status === 'rejected') return '반려';
    if (status === 'hidden') return '숨김';
    return '승인 대기';
}

export function getPlaceMarkerText(place) {
    const min = Number(place.min_price ?? place.minPrice ?? 0);
    if (min >0) return formatPrice(min);
    return place.name || '식당';
}

export function getMarkerPosition(index, total) {
    const safeTotal = Math.max(total || 1, 1);
    const angle = (index / safeTotal) * Math.PI * 2;
    const ring = 22 + (index % 4) * 9;
    const x = 50 + Math.cos(angle) * ring;
    const y = 50 + Math.sin(angle) * ring;
    return {
        left: `${Math.max(8, Math.min(88, x))}%`,
        top: `${Math.max(10, Math.min(86, y))}%`,
    };
}

export function normalizeCategorySelection(nextCategories) {
    const unique = Array.from(new Set(nextCategories.filter(Boolean)));
    if (unique.length === 0 || unique.includes('전체')) return ['전체'];
    return unique;
}
