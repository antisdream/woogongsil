// 관리자 기능 모듈입니다: adminUtils
export const API_BASE = '';



export const mealMapLayoutFieldsV253 = [
  { key: 'contentMaxWidth', label: '전체 콘텐츠 최대 폭', hint: '예: 1480px' },
  { key: 'heroTitleSize', label: '상단 제목 크기', hint: '예: 42px' },
  { key: 'mapMinHeight', label: '지도 최소 높이', hint: '예: 760px' },
  { key: 'detailPanelWidth', label: '오른쪽 상세 패널 폭', hint: '예: 360px' },
  { key: 'cardRadius', label: '카드 둥근 모서리', hint: '예: 24px' },
  { key: 'sectionGap', label: '섹션 간격', hint: '예: 24px' },
];

export const mealMapLayoutDefaultsV253 = {
  contentMaxWidth: '1480px',
  heroTitleSize: '42px',
  mapMinHeight: '760px',
  detailPanelWidth: '360px',
  cardRadius: '24px',
  sectionGap: '24px',
};
export const MEALMAP_TEXT_FIELD_META = [
  { key: "heroEyebrow", label: "상단 작은 제목" },
  { key: "heroTitle", label: "대표 제목" },
  { key: "heroSubtitle", label: "대표 설명" },
  { key: "submitButton", label: "제보 버튼" },
  { key: "searchPlaceholder", label: "검색창 안내문" },
  { key: "searchButton", label: "검색 버튼" },
  { key: "filterButton", label: "필터 버튼" },
  { key: "mapTitle", label: "지도 제목" },
  { key: "mapGuideTitle", label: "지도 안내 제목" },
  { key: "mapGuideBody", label: "지도 안내 설명" },
  { key: "emptyTitle", label: "빈 목록 제목" },
  { key: "emptyBody", label: "빈 목록 설명" },
  { key: "selectMarkerTitle", label: "미선택 안내 제목" },
  { key: "selectMarkerBody", label: "미선택 안내 설명" },
  { key: "naverButton", label: "카카오지도/후기 버튼" },
  { key: "likeButton", label: "좋아요 버튼" },
  { key: "editSuggestButton", label: "수정 제안 버튼" },
  { key: "deleteSuggestButton", label: "삭제 요청 버튼" },
  { key: "deleteRequestPrompt", label: "삭제 요청 사유 입력 안내" },
  { key: "deleteRequestConfirm", label: "삭제 요청 확인 문구" },
  { key: "deleteRequestSuccessMessage", label: "삭제 요청 성공 메시지" },
  { key: "deleteRequestFailMessage", label: "삭제 요청 실패 메시지" },
  { key: "commentTitle", label: "댓글 제목" },
  { key: "commentPlaceholder", label: "댓글 입력 안내문" },
  { key: "commentSubmitButton", label: "댓글 등록 버튼" },
  { key: "editModalEyebrow", label: "수정 제안 모달 작은 제목" },
  { key: "editModalSubtext", label: "수정 제안 모달 설명" },
  { key: "editReasonLabel", label: "수정 이유 라벨" },
  { key: "editReasonPlaceholder", label: "수정 이유 안내문" },
  { key: "editSubmitButton", label: "수정 제안 제출 버튼" },
  { key: "editCancelButton", label: "수정 제안 취소 버튼" },
  { key: "editSuccessMessage", label: "수정 제안 성공 메시지" }
];


// 관리자 API 호출 시 세션 만료 안내를 구분하기 위한 기본 에러 문구입니다.
export const DEFAULT_ADMIN_ERROR = '관리자 정보를 불러오지 못했습니다. 다시 로그인한 뒤 시도해주세요.';
export const APPROVAL_PAGE_SIZE = 50; // 결재 사항은 한 페이지당 50개씩 보여줍니다.
export const RECENT_LOG_PAGE_SIZE = 50; // 최근 접속 기록 탭은 한 페이지당 50개씩 표 형태로 보여줍니다.

//  문제/해설 관리에서 사용하는 문제 종류 목록입니다.
// value는 백엔드 API의 type 값과 1:1로 맞춘다.
export const QUESTION_TYPE_OPTIONS = [
  { value: 'written', label: '필기 문제', hint: 'questions / options / answers' },
  { value: 'ipep_random', label: '실기 랜덤', hint: 'ipep_random_questions' },
  { value: 'ipep_past', label: '실기 기출', hint: 'ipep_past_questions' },
];

// 실기 자동채점 방식은 DB의 grading_policy 값과 일치해야 합니다.
export const IPEP_GRADING_POLICY_OPTIONS = [
  { value: 'FLEX_TERM', label: 'FLEX_TERM · 용어형 완화 채점' },
  { value: 'MULTI_TERM', label: 'MULTI_TERM · 여러 용어 포함 채점' },
  { value: 'EXACT_OUTPUT', label: 'EXACT_OUTPUT · 출력 결과 정확 비교' },
  { value: 'SQL_TEXT', label: 'SQL_TEXT · SQL 문장 비교' },
  { value: 'SELF_CHECK', label: 'SELF_CHECK · 자기채점' },
];

// 관리자 페이지 상단 탭 목록입니다.
// 화면만 탭으로 나누며 기존 API 호출, 저장 함수, 검색 함수는 그대로 사용합니다.
export const ADMIN_TABS = [
  { id: 'dashboard', label: '대시보드', description: '관리 현황 요약' },
  { id: 'users', label: '사용자·접속 관리', description: '회원 목록과 실시간 접속자' },
  { id: 'approvals', label: '결재 사항', description: '운영자 요청 승인/반려' },
  { id: 'notice', label: '공지·점검 관리', description: '전체 공지와 점검 모드' },
  { id: 'questions', label: '문제·해설 관리', description: '필기/실기 문제 데이터' },
  { id: 'display', label: '화면 설정 관리', description: '문구·디자인·이미지 CRUD' },
  { id: 'calendar', label: '달력·일정 관리', description: '홈 달력 수업 일정 CRUD' },
  { id: 'mealmap', label: '회식맵 관리', description: '공개 식당·수정/삭제 요청 관리' },
];

// 관리자 내부 탭을 /admin/dashboard, /admin/users처럼 URL에 반영하기 위한 경로 매핑입니다.
// 기존 탭 렌더링 조건과 데이터 CRUD 로직은 그대로 두고, 탭 상태와 주소만 연결합니다.
export const ADMIN_TAB_ROUTE_MAP = ADMIN_TABS.reduce((acc, tab) => {
  acc[tab.id] = `/admin/${tab.id}`;
  return acc;
}, {});

export function getAdminTabFromPath(pathname = '') {
  const tabId = String(pathname).split('/').filter(Boolean)[1] || 'dashboard';
  return ADMIN_TABS.some((tab) => tab.id === tabId) ? tabId : 'dashboard';
}


//  화면 설정 관리용 페이지/타입 옵션

// 홈 달력 일정 종류와 색상 옵션입니다.
// schedule_type은 DB의 wgs_class_schedules.schedule_type 값과 1:1로 맞춥니다.
export const CLASS_SCHEDULE_TYPE_OPTIONS = [
  { value: 'class', label: '수업' },
  { value: 'holiday', label: '공휴일' },
  { value: 'application', label: '원서접수' },
  { value: 'exam', label: '시험일' },
  { value: 'result', label: '결과발표' },
  { value: 'special', label: '특별한날' },
];

export const CLASS_SCHEDULE_HIGHLIGHT_OPTIONS = [
  { value: 'none', label: '강조 없음' },
  { value: 'outline', label: '테두리 강조' },
  { value: 'glow', label: '빛나는 강조' },
  { value: 'important', label: '중요 표시' },
];

export const CLASS_SCHEDULE_DEFAULT_STYLE = {
  class: { background_color: '#1e40af', text_color: '#ffffff', border_color: '#1e40af', event_category: '수업' },
  holiday: { background_color: '#020617', text_color: '#ef4444', border_color: '#020617', event_category: '공휴일' },
  application: { background_color: '#10b981', text_color: '#ffffff', border_color: '#10b981', event_category: '원서접수' },
  exam: { background_color: '#7c3aed', text_color: '#ffffff', border_color: '#7c3aed', event_category: '시험일' },
  result: { background_color: '#f97316', text_color: '#ffffff', border_color: '#f97316', event_category: '결과발표' },
  special: { background_color: '#facc15', text_color: '#111827', border_color: '#facc15', event_category: '특별한날' },
};

// 홈 달력 일정 관리자 폼 기본값입니다.
// 기존 화면 설정 관리와 분리해서 운영하므로 다른 관리자 기능은 유지합니다.
export const EMPTY_CLASS_SCHEDULE_FORM = {
  schedule_date: '',
  day_no: '',
  schedule_type: 'class',
  event_category: '수업',
  course_title: '',
  topic_title: '',
  event_title: '',
  event_subtitle: '',
  background_color: '#1e40af',
  text_color: '#ffffff',
  border_color: '#1e40af',
  highlight_type: 'none',
  memo: '',
  admin_note: '',
  sort_order: 0,
  is_active: 1
};

// 기존 관리자 탭 구조는 유지하고, display 탭에서만 사용하는 상수다.
export const SCREEN_SETTING_PAGE_OPTIONS = [
  { value: 'all', label: '전체 페이지 공통' },
  { value: 'home', label: '홈' },
  { value: 'cert_ipe', label: '정보처리기사 입구' },
  { value: 'written', label: '필기 로비' },
  { value: 'past', label: '필기 기출문제' },
  { value: 'random', label: '필기 문제은행' },
  { value: 'ipep', label: '실기문제' },
  { value: 'wrong', label: '오답/마이문제' },
  { value: 'multiplayer', label: '멀티플레이' },
  { value: 'mealmap', label: '회식맵' },
  { value: 'mypage', label: '마이페이지' },
  { value: 'board', label: '게시판' },
  { value: 'faq', label: 'FAQ' },
  { value: 'fortune', label: '운세' },
  { value: 'login', label: '로그인' },
  { value: 'signup', label: '회원가입' },
  { value: 'find_auth', label: '계정 찾기' },
  { value: 'change_pw', label: '비밀번호 변경' },
  { value: 'exam', label: '시험 화면 공통' },
  { value: 'admin', label: '관리자 페이지' },
];

export const SCREEN_SETTING_TYPE_OPTIONS = [
  { value: 'text', label: '문구/버튼명' },
  { value: 'layout', label: '레이아웃/크기' },
  { value: 'color', label: '색상/디자인' },
  { value: 'image', label: '이미지 경로' },
    { value: 'link', label: '링크/주소' },
];

export const EMPTY_SCREEN_SETTING_FORM = {
  page_key: 'all',
  section_key: 'common',
  setting_type: 'text',
  setting_key: '',
  setting_label: '',
  setting_value: '',
  description: '',
  sort_order: 0,
  is_active: 1,
};

// sessionStorage에 저장된 로그인 사용자 정보를 안전하게 꺼내는 함수입니다.
// JSON 파싱 실패가 나더라도 페이지 전체가 영향을 받지 않도록 null을 반환합니다.
export function getStoredUser() {
  // 이 프로젝트의 로그인 정보는 sessionStorage.user JSON이 아니라
  // userId / userName / sessionToken / serverInstanceId 개별 키로 저장됩니다.
  // 그래서 user JSON만 읽으면 최고관리자도 관리자 아님으로 오판되어 /admin에서 홈으로 튕긴다.
  let parsedUser = null;

  try {
    const rawUser = sessionStorage.getItem('user');
    parsedUser = rawUser ? JSON.parse(rawUser) : null;
  } catch (error) {
    console.warn('[admin] sessionStorage user parse failed:', error);
    parsedUser = null;
  }

  const normalized = parsedUser && typeof parsedUser === 'object'? parsedUser : {};

  return {
    ...normalized,
    id: String(
      normalized.id ||
      normalized.user_id ||
      normalized.userId ||
      normalized.username ||
      sessionStorage.getItem('userId') ||
      sessionStorage.getItem('id') ||
      ''
    ).trim(),
    name: String(
      normalized.name ||
      normalized.user_name ||
      normalized.userName ||
      sessionStorage.getItem('userName') ||
      sessionStorage.getItem('name') ||
      sessionStorage.getItem('userId') ||
      ''
    ).trim(),
    sessionToken:
      normalized.sessionToken ||
      normalized.session_token ||
      sessionStorage.getItem('sessionToken') ||
      '',
    serverInstanceId:
      normalized.serverInstanceId ||
      normalized.server_instance_id ||
      sessionStorage.getItem('wgsServerInstanceId') ||
      sessionStorage.getItem('serverInstanceId') ||
      '',
    email: String(normalized.email || sessionStorage.getItem('email') || '').trim(),
    // 로그인 성공 시 App/Login은 권한값을 개별 sessionStorage 키에 저장합니다.
    // Admin.jsx가 이 키를 읽지 못하면 운영자 계정이 /admin 진입 직후 홈으로 튕긴다.
    isOperator: normalized.isOperator ?? normalized.is_operator ?? sessionStorage.getItem('isOperator') ?? sessionStorage.getItem('is_operator'),
    is_operator: normalized.is_operator ?? normalized.isOperator ?? sessionStorage.getItem('is_operator') ?? sessionStorage.getItem('isOperator'),
    isPrimaryAdmin: normalized.isPrimaryAdmin ?? normalized.is_primary_admin ?? sessionStorage.getItem('isPrimaryAdmin'),
    is_primary_admin: normalized.is_primary_admin ?? normalized.isPrimaryAdmin ?? sessionStorage.getItem('isPrimaryAdmin'),
    isAdmin: normalized.isAdmin ?? normalized.is_admin ?? sessionStorage.getItem('isAdmin'),
    is_admin: normalized.is_admin ?? normalized.isAdmin ?? sessionStorage.getItem('isAdmin')
  };
}

// 로그인 사용자 객체에서 실제 계정 아이디를 안전하게 꺼내는 함수입니다.
// 현재 프로젝트는 화면/기능에 따라 id, user_id, userId처럼 다른 이름을 섞어 쓸 수 있어 여기서 한 번에 정규화합니다.
export function getStoredUserId(user) {
  return String(user?.id || user?.user_id || user?.userId || user?.username || '').trim();
}

// 로그인 사용자 이름도 프로젝트 저장 방식 차이를 고려해 안전하게 정규화합니다.
// 이름이 없으면 아이디를 대신 사용해 실시간 접속자 API 요청값이 비지 않도록 합니다.
export function getStoredUserName(user) {
  return String(user?.name || user?.user_name || user?.userName || getStoredUserId(user) || '').trim();
}

// 백엔드 재시작 감지에 사용하는 서버 인스턴스 ID를 읽습니다.
// user 객체와 sessionStorage 양쪽을 모두 확인해 기존 로그인 유지 로직을 변경하지 않는다.
export function getStoredServerInstanceId(user) {
  return user?.serverInstanceId || user?.server_instance_id || sessionStorage.getItem('serverInstanceId') || '';
}

// 로그인 시 저장된 세션 토큰을 꺼내는 함수입니다.
// 프로젝트에 따라 user 객체 안 또는 별도 sessionToken 키에 저장될 수 있어 둘 다 확인합니다.
export function getStoredSessionToken(user) {
  return user?.sessionToken || user?.session_token || sessionStorage.getItem('sessionToken') || '';
}

// 결재 상태 한글 표기와 정렬 기준을 한 곳에서 관리합니다.
export const APPROVAL_STATUS_LABELS = {
  APPROVED: '승인',
  REJECTED: '반려',
  PENDING: '대기',
};
export const APPROVAL_STATUS_SORT_MODES = ['default', 'APPROVED', 'REJECTED', 'PENDING'];
export const APPROVAL_STATUS_SORT_LABELS = {
  default: '기본',
  APPROVED: '승인',
  REJECTED: '반려',
  PENDING: '대기',
};

export function normalizeApprovalStatus(status) {
  return String(status || 'PENDING').toUpperCase();
}

export function getApprovalStatusLabel(status) {
  return APPROVAL_STATUS_LABELS[normalizeApprovalStatus(status)] || '대기';
}

export function parseApprovalTime(value) {
  if (!value) return 0;
  const time = new Date(String(value).replace(' ', 'T')).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function compareKoreanText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ko-KR', { numeric: true, sensitivity: 'base' });
}

export function sortApprovalList(list, sortConfig) {
  const safeList = Array.isArray(list) ? [...list] : [];
  if (!sortConfig || sortConfig.field === 'default') return safeList;

  safeList.sort((a, b) => {
    if (sortConfig.field === 'status') {
      const mode = sortConfig.mode || 'default';
      if (mode === 'default') return 0;
      const aStatus = normalizeApprovalStatus(a.status);
      const bStatus = normalizeApprovalStatus(b.status);
      const aPriority = aStatus === mode ? 0 : 1;
      const bPriority = bStatus === mode ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return parseApprovalTime(b.requestedAt) - parseApprovalTime(a.requestedAt);
    }

    if (sortConfig.field === 'requester') {
      const result = compareKoreanText(a.requesterName || a.requesterId || '', b.requesterName || b.requesterId || '');
      return sortConfig.direction === 'desc'? -result : result;
    }

    if (sortConfig.field === 'requestedAt' || sortConfig.field === 'reviewedAt') {
      const result = parseApprovalTime(a[sortConfig.field]) - parseApprovalTime(b[sortConfig.field]);
      return sortConfig.direction === 'desc'? -result : result;
    }

    return 0;
  });
  return safeList;
}

// DB에서 최고관리자로 지정된 계정인지 판단하는 함수입니다.
// 최고관리자는 사용자 삭제와 권한 부여처럼 민감한 작업을 직접 승인할 수 있습니다.
export function isPrimaryAdminUser(user) {
  return isTruthyFlag(user?.isPrimaryAdmin) || isTruthyFlag(user?.is_primary_admin);
}

// DB에서 0/1, true/false, "1"/"true"처럼 섞여 내려오는 운영자 값을 안전하게 판별합니다.
export function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

export const USER_PAGE_SIZE = 20;

export function getUserIdText(item) {
  return String(item?.id || '').trim();
}

export function getUserNameText(item) {
  return String(item?.name || '').trim();
}

export function getUserEmailText(item) {
  return String(item?.email || '').trim();
}

export function isPrimaryAdminRow(item) {
  return isTruthyFlag(item?.isPrimaryAdmin) || isTruthyFlag(item?.is_primary_admin);
}

export function isOperatorRow(item) {
  return isTruthyFlag(item?.isOperator) || isTruthyFlag(item?.is_operator);
}

export function compareUserText(left, right) {
  return compareKoreanText(left, right);
}

export function getUserSortMark(userSort, key) {
  if (userSort.key !== key) return '';
  return userSort.direction === 'asc'? '오름차순' : '내림차순';
}

export function sortUsersByAdminRole(users, userSort) {
  const primaryAdmins = [];
  const operators = [];
  const normalUsers = [];

  (users || []).forEach((item) => {
    if (isPrimaryAdminRow(item)) {
      primaryAdmins.push(item);
    } else if (isOperatorRow(item)) {
      operators.push(item);
    } else {
      normalUsers.push(item);
    }
  });

  const pickerMap = {
    id: getUserIdText,
    name: getUserNameText,
    email: getUserEmailText,
  };
  const picker = pickerMap[userSort?.key] || getUserIdText;
  const direction = userSort?.direction === 'desc'? 'desc' : 'asc';

  normalUsers.sort((a, b) => {
    const result = compareUserText(picker(a), picker(b));
    return direction === 'asc'? result : -result;
  });
  primaryAdmins.sort((a, b) => compareUserText(getUserIdText(a), getUserIdText(b)));
  operators.sort((a, b) => compareUserText(getUserIdText(a), getUserIdText(b)));

  return { primaryAdmins, operators, normalUsers };
}

// 관리자 페이지 접근은 원 관리자 또는 원 관리자가 활성화한 운영자에게 허용합니다.
export function isAdminAccessUser(user) {
  return isPrimaryAdminUser(user) || isTruthyFlag(user?.isOperator) || isTruthyFlag(user?.is_operator) || isTruthyFlag(user?.isAdmin) || isTruthyFlag(user?.is_admin);
}

// 운영자 권한은 로그인 이후 최고관리자가 부여할 수 있으므로
// 관리자 화면 진입 시 sessionStorage보다 최신 DB 권한을 우선 확인합니다.
// 그래서 관리자 페이지 진입 직전에 백엔드의 현재 세션 검증 API를 다시 호출해 최신 권한을 확인합니다.
export async function verifyAdminAccessWithServer(storedUser) {
  const fallbackUser = storedUser || getStoredUser();
  const userId = getStoredUserId(fallbackUser);
  const sessionToken = getStoredSessionToken(fallbackUser);

  if (!userId || !sessionToken) {
    return null;
  }

  try {
    // /api/check-session은 일반 세션 확인용이라 과거 응답에는 운영자 권한값이 없었다.
    // /api/admin/check-auth는 validateAdminSession을 통해 DB의 최신 is_operator 값을 직접 확인하므로
    // 권한을 받은 일반 사용자도 /admin 진입 여부를 정확히 판정할 수 있습니다.
    const response = await fetch('/api/admin/check-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: userId,
        userId,
        sessionToken,
        serverInstanceId: getStoredServerInstanceId(fallbackUser),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.valid || !data?.isAdmin) {
      return null;
    }

    const adminInfo = data.admin || {};
    const verifiedUser = {
      ...fallbackUser,
      id: adminInfo.id || data.userId || fallbackUser?.id || userId,
      userId: adminInfo.id || data.userId || fallbackUser?.userId || userId,
      name: adminInfo.name || data.name || fallbackUser?.name || sessionStorage.getItem('userName') || '',
      email: adminInfo.email || data.email || fallbackUser?.email || sessionStorage.getItem('email') || '',
      sessionToken,
      serverInstanceId: data.serverInstanceId || getStoredServerInstanceId(fallbackUser),
      isAdmin: data.isAdmin ?? adminInfo.isAdmin ?? true,
      is_admin: data.is_admin ?? data.isAdmin ?? adminInfo.isAdmin ?? true,
      isOperator: data.isOperator ?? data.is_operator ?? adminInfo.isOperator ?? adminInfo.is_operator,
      is_operator: data.is_operator ?? data.isOperator ?? adminInfo.is_operator ?? adminInfo.isOperator,
      isPrimaryAdmin: data.isPrimaryAdmin ?? data.is_primary_admin ?? adminInfo.isPrimaryAdmin ?? adminInfo.is_primary_admin,
      is_primary_admin: data.is_primary_admin ?? data.isPrimaryAdmin ?? adminInfo.is_primary_admin ?? adminInfo.isPrimaryAdmin,
    };

    if (!isAdminAccessUser(verifiedUser)) {
      return null;
    }

    // 다음 진입 때도 바로 통과할 수 있도록 최신 권한을 sessionStorage에 동기화합니다.
    sessionStorage.setItem('user', JSON.stringify(verifiedUser));
    sessionStorage.setItem('userId', verifiedUser.userId || verifiedUser.id || userId);
    sessionStorage.setItem('sessionToken', sessionToken);
    sessionStorage.setItem('userName', verifiedUser.name || '');
    sessionStorage.setItem('email', verifiedUser.email || '');
    if (verifiedUser.serverInstanceId) sessionStorage.setItem('wgsServerInstanceId', verifiedUser.serverInstanceId);
    sessionStorage.setItem('isOperator', isTruthyFlag(verifiedUser.isOperator) || isTruthyFlag(verifiedUser.is_operator) ? 'true' : 'false');
    sessionStorage.setItem('isPrimaryAdmin', isTruthyFlag(verifiedUser.isPrimaryAdmin) || isTruthyFlag(verifiedUser.is_primary_admin) ? 'true' : 'false');
    sessionStorage.setItem('isAdmin', isTruthyFlag(verifiedUser.isAdmin) || isTruthyFlag(verifiedUser.is_admin) ? 'true' : 'false');

    return verifiedUser;
  } catch (error) {
    console.error('[Admin] 관리자/운영자 권한 재검증 실패:', error);
    return null;
  }
}

// 날짜/시간 값을 화면에 보기 좋게 바꾸는 함수입니다.
// 값이 없거나 변환할 수 없으면 '-'로 표시해 테이블 깨짐을 방지합니다.
export function formatDateTime(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// 결재 상세 payload를 팝업에서 크게 확인할 수 있도록 JSON을 안전하게 정리합니다.
export function formatApprovalPayload(payload) {
  if (!payload) return '상세 데이터가 없습니다.';
  if (typeof payload === 'string') {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function pickFirstDateValue(item, keys = []) {
  if (!item) return null;
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== '' && value !== '-') return value;
  }
  return null;
}

// 접속자 마지막 활동 시간을 "방금 전", "3분 전"처럼 보여주는 함수입니다.
export function formatAgo(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 10) return '방금 전';
  if (diffSeconds < 60) return `${diffSeconds}초 전`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}분 전`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}시간 전`;
  return `${Math.floor(diffSeconds / 86400)}일 전`;
}

// JSON 컬럼은 MySQL에서 문자열 또는 객체로 내려올 수 있어 textarea에 넣기 좋게 통일합니다.
export function formatJsonForTextarea(value) {
  if (value === null || value === undefined || value === '') return '';

  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch (_) {
      return value;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

// 목록 테이블의 문제 본문은 너무 길어질 수 있어 미리보기 길이를 제한합니다.
export function shortText(value, maxLength = 90) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text || '-';
  return `${text.slice(0, maxLength)}...`;
}

export function getQuestionTypeLabel(type) {
  return QUESTION_TYPE_OPTIONS.find((item) => item.value === type)?.label || '문제';
}

// 문제 위치 정보를 사람이 알아보기 쉽게 만든다.
// 필기: 연도/회차/과목/문항, 실기랜덤: 과목코드/과목번호, 실기기출: 연도/회차/문항번호.
export function getQuestionLocation(item) {
  if (!item) return '-';
  if (item.type === 'written') {
    return `${item.year || '-'}년 ${item.session || '-'}회 · 과목 ${item.subject || '-'} · ${item.info_id || item.question_id || '-'}번`;
  }
  if (item.type === 'ipep_random') {
    return `${item.subject_name || item.subject_code || '-'} · 과목번호 ${item.subject_no || '-'}번`;
  }
  return `${item.exam_year || '-'}년 ${item.exam_session || '-'}회 · ${item.question_no || '-'}번`;
}

// 이미지 경로는 필기/실기 저장 방식이 다르다.
// 필기는 public/question_image, 실기는 Express 정적 경로 /ipep-img/random 또는 /ipep-img/past를 사용합니다.
export function buildImagePreviewSrc(type, rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw;

  if (type === 'written') {
    return `/question_image/${raw}`;
  }

  const folder = type === 'ipep_past'? 'past' : 'random';
  const fileName = raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  return `/ipep-img/${folder}/${encodeURIComponent(fileName)}`;
}

// 서버에서 받은 상세 데이터를 폼 상태로 복사합니다.
// 원본 객체를 직접 수정하지 않고 복사본을 만들어 입력 중인 값만 안전하게 변경합니다.
export function toQuestionForm(detail, type) {
  if (!detail) return null;

  if (type === 'written') {
    return {
      question_id: detail.question_id || detail.id || '',
      year: detail.year || '',
      session: detail.session || '',
      info_id: detail.info_id || '',
      subject: detail.subject || '',
      question: detail.question || detail.question_text || '',
      question_img: detail.question_img || '',
      opt1: detail.opt1 || detail.option_1 || '',
      opt2: detail.opt2 || detail.option_2 || '',
      opt3: detail.opt3 || detail.option_3 || '',
      opt4: detail.opt4 || detail.option_4 || '',
      answer: detail.answer || '',
      correct_label: detail.correct_label || '',
      explanation_text: detail.explanation_text || '',
      explanation_img: detail.explanation_img || '',
    };
  }

  return {
    question_id: detail.question_id || detail.id || '',
    subject_code: detail.subject_code || '',
    subject_no: detail.subject_no || '',
    exam_year: detail.exam_year || '',
    exam_session: detail.exam_session || '',
    question_no: detail.question_no || '',
    question_text: detail.question_text || '',
    answer_raw: detail.answer_raw || '',
    answer_normalized: detail.answer_normalized || '',
    answer_aliases_json: formatJsonForTextarea(detail.answer_aliases_json),
    answer_slots_json: formatJsonForTextarea(detail.answer_slots_json),
    grading_policy: detail.grading_policy || 'FLEX_TERM',
    score: detail.score || 5,
    choice_img_stem: detail.choice_img_stem || '',
    choice_img_file: detail.choice_img_file || '',
    choice_img_path: detail.choice_img_path || '',
    explanation_img_stem: detail.explanation_img_stem || '',
    explanation_img_file: detail.explanation_img_file || '',
    explanation_img_path: detail.explanation_img_path || '',
    explanation_text: detail.explanation_text || '',
    is_active: String(detail.is_active ?? 1),
  };
}

// 점검 모드 기본 폼 값입니다.
// 서버 응답이 늦거나 비어도 관리자 화면이 영향을 받지 않도록 프론트 기본값을 둡니다.
export const DEFAULT_MAINTENANCE_FORM = {
  enabled: false,
  message: '현재 우공실 사이트 점검 중입니다. 잠시 후 다시 접속해주세요.',
  updatedAtText: '',
  updatedBy: '',
};

  // 수정 제안 카드에서 실제 변경된 항목을 확실히 보여주기 위한 표시 전용 유틸입니다.
  // 서버가 old_data/new_data 형태를 주는 경우와 current_/proposed_ 컬럼 형태를 주는 경우를 모두 처리합니다.
export const formatMealMapAdminPlainValue = (value) => {
    if (value === null || value === undefined) return '-';
    const textValue = String(value).trim();
    return textValue ? textValue : '-';
  };

  // 가격은 min/max 두 컬럼을 하나의 사람이 읽기 쉬운 문장으로 합쳐 비교합니다.
export const formatMealMapAdminPriceValue = (minValue, maxValue) => {
    const minNumber = Number(minValue || 0);
    const maxNumber = Number(maxValue || 0);
    if (!minNumber && !maxNumber) return '-';
    if (minNumber && maxNumber) return `${minNumber.toLocaleString('ko-KR')}원 ~ ${maxNumber.toLocaleString('ko-KR')}원`;
    if (minNumber) return `${minNumber.toLocaleString('ko-KR')}원 ~`;
    return `~ ${maxNumber.toLocaleString('ko-KR')}원`;
  };

  // 주소는 지번/도로명 중 있는 값을 모두 보여줘 승인자가 수정 내용을 놓치지 않게 합니다.
export const formatMealMapAdminAddressValue = (address, roadAddress) => {
    const first = String(address || '').trim();
    const second = String(roadAddress || '').trim();
    if (first && second && first !== second) return `${first}
${second}`;
    return first || second || '-';
  };

  // 좌표는 위도와 경도를 한 줄로 묶어 비교합니다.
export const formatMealMapAdminCoordValue = (lat, lng) => {
    const latText = String(lat ?? '').trim();
    const lngText = String(lng ?? '').trim();
    if (!latText && !lngText) return '-';
    return `${latText || '-'}, ${lngText || '-'}`;
  };

  // 실제 수정 제안 항목을 current_/proposed_ 데이터 기준으로 재구성합니다.
  // 기존 Admin 화면은 old_data/new_data만 비교해서 현재 DB가 주는 proposed_* 컬럼을 제대로 표시하지 못했습니다.
export const buildMealMapEditDiffRows = (request = {}) => {
    const oldData = request.old_data || {};
    const newData = request.new_data || {};
    const pick = (source, keys) => {
      for (const key of keys) {
        const value = source?.[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
      }
      return '';
    };

    const rows = [
      {
        label: '식당명',
        before: formatMealMapAdminPlainValue(pick(request, ['current_name', 'place_name']) || pick(oldData, ['name', 'place_name'])),
        after: formatMealMapAdminPlainValue(pick(request, ['proposed_name']) || pick(newData, ['name', 'place_name'])),
      },
      {
        label: '카테고리',
        before: formatMealMapAdminPlainValue(pick(request, ['current_category']) || pick(oldData, ['category'])),
        after: formatMealMapAdminPlainValue(pick(request, ['proposed_category']) || pick(newData, ['category'])),
      },
      {
        label: '가격',
        before: formatMealMapAdminPriceValue(pick(request, ['current_min_price']) || pick(oldData, ['min_price']), pick(request, ['current_max_price']) || pick(oldData, ['max_price'])),
        after: formatMealMapAdminPriceValue(pick(request, ['proposed_min_price']) || pick(newData, ['min_price']), pick(request, ['proposed_max_price']) || pick(newData, ['max_price'])),
      },
      {
        label: '주소',
        before: formatMealMapAdminAddressValue(pick(request, ['current_address']) || pick(oldData, ['address']), pick(request, ['current_road_address']) || pick(oldData, ['road_address'])),
        after: formatMealMapAdminAddressValue(pick(request, ['proposed_address']) || pick(newData, ['address']), pick(request, ['proposed_road_address']) || pick(newData, ['road_address'])),
      },
      {
        label: '운영시간',
        before: formatMealMapAdminPlainValue(pick(request, ['current_opening_hours']) || pick(oldData, ['opening_hours', 'open_hours'])),
        after: formatMealMapAdminPlainValue(pick(request, ['proposed_opening_hours']) || pick(newData, ['opening_hours', 'open_hours'])),
      },
      {
        label: '대표메뉴',
        before: formatMealMapAdminPlainValue(pick(request, ['current_main_menu']) || pick(oldData, ['main_menu', 'menu'])),
        after: formatMealMapAdminPlainValue(pick(request, ['proposed_main_menu']) || pick(newData, ['main_menu', 'menu'])),
      },
      {
        label: '카카오 지도 링크',
        before: formatMealMapAdminPlainValue(pick(request, ['current_kakao_url']) || pick(oldData, ['kakao_url'])),
        after: formatMealMapAdminPlainValue(pick(request, ['proposed_kakao_url']) || pick(newData, ['kakao_url'])),
      },
      {
        label: '지도 보조 링크',
        before: formatMealMapAdminPlainValue(pick(request, ['current_naver_url']) || pick(oldData, ['naver_url'])),
        after: formatMealMapAdminPlainValue(pick(request, ['proposed_naver_url']) || pick(newData, ['naver_url'])),
      },
      {
        label: '좌표',
        before: formatMealMapAdminCoordValue(pick(request, ['current_lat']) || pick(oldData, ['lat', 'x']), pick(request, ['current_lng']) || pick(oldData, ['lng', 'y'])),
        after: formatMealMapAdminCoordValue(pick(request, ['proposed_lat']) || pick(newData, ['lat', 'x']), pick(request, ['proposed_lng']) || pick(newData, ['lng', 'y'])),
      },
    ];

    const changedRows = rows.filter((row) => row.before !== row.after && row.after !== '-');
    if (changedRows.length) return changedRows;

    return rows.filter((row) => row.before !== '-' || row.after !== '-');
  };
