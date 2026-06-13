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
    heroEyebrow: '회식맵',
    heroTitle: '회식맵',
    heroSubtitle: '당신의 식당을 추천해주세요!',
    submitButton: '+ 장소 제보하기',
    searchPlaceholder: '식당명, 주소, 메뉴 검색',
    searchButton: '검색',
    filterButton: '필터',
    mapTitle: '지도 API 미설정 목업 모드',
    mapCountPrefix: '공개 장소',
    mapGuideTitle: '안내: 가격과 식당명을 표시합니다.',
    mapGuideBody: '카카오 지도 API 키를 연결하기 전까지 목업 지도에서 기능 흐름을 확인할 수 있습니다.',
    emptyTitle: '승인된 식당이 없습니다.',
    emptyBody: '식당을 제보하고 관리자 승인 후 이 영역에 표시됩니다.',
    selectMarkerTitle: '마커를 선택하면 상세 정보가 표시됩니다.',
    selectMarkerBody: '식당 정보, 가격, 댓글, 지도 링크가 표시됩니다.',
    naverButton: '카카오맵/후기 보기',
    likeButton: '좋아요',
    editSuggestButton: '수정 제안',
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
