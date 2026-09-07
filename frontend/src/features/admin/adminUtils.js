// 관리자 기능 모듈입니다: adminUtils
import {
  fetchAdminSession,
  getCurrentAdmin,
  makeAdminHeaders,
} from '../../admin/adminSession.js';
export const API_BASE = '';


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
  { id: 'visitors', label: '방문 통계', description: '일간·주간·월간·연간 방문 세션' },
  { id: 'signupRequests', label: '회원가입 승인', description: '신규 가입 승인/거절' },
  { id: 'approvals', label: '결재 사항', description: '운영자 요청 승인/반려' },
  { id: 'notice', label: '공지·점검 관리', description: '전체 공지와 점검 모드' },
  { id: 'questions', label: '문제·해설 관리', description: '필기/실기 문제 데이터' },
  { id: 'display', label: '화면 설정 관리', description: '문구·디자인·이미지 CRUD' },
];

// 관리자 내부 탭을 /manage/dashboard, /manage/users처럼 URL에 반영하기 위한 경로 매핑입니다.
// 기존 탭 렌더링 조건과 데이터 CRUD 로직은 그대로 두고, 탭 상태와 주소만 연결합니다.
export const ADMIN_TAB_ROUTE_MAP = ADMIN_TABS.reduce((acc, tab) => {
  acc[tab.id] = `/manage/${tab.id}`;
  return acc;
}, {});

export function getAdminTabFromPath(pathname = '') {
  const tabId = String(pathname).split('/').filter(Boolean)[1] || 'dashboard';
  return ADMIN_TABS.some((tab) => tab.id === tabId) ? tabId : 'dashboard';
}


//  화면 설정 관리용 페이지/타입 옵션

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

// 관리자 사용자 정보는 현재 관리자 번들의 메모리에서만 읽습니다.
export function getStoredUser() {
  return getCurrentAdmin();
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

// 관리자 세션은 서버의 유휴/절대 만료를 사용하므로 일반 회원 서버 인스턴스 ID를 요구하지 않습니다.
export function getStoredServerInstanceId(user) {
  return user?.serverInstanceId || user?.server_instance_id || '';
}

// 관리자 원문 세션 토큰은 HttpOnly 쿠키이므로 JavaScript에 노출하지 않습니다.
export function getStoredSessionToken(_user) {
  return '';
}

export function makeAdminHeadersFromStorage() {
  return makeAdminHeaders();
}

export function makeAdminAuthBodyFromStorage() {
  return {};
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

// 관리자 화면 진입 직전에 서버의 전용 관리자 쿠키와 최신 DB 권한을 다시 확인합니다.
export async function verifyAdminAccessWithServer() {
  try {
    const verifiedUser = await fetchAdminSession();
    return verifiedUser && isAdminAccessUser(verifiedUser) ? verifiedUser : null;
  } catch (error) {
    console.error('[Admin] 관리자/운영자 권한 재검증 실패:', error);
    return null;
  }
}

// 날짜/시간 값을 화면에 보기 좋게 바꾸는 공용 함수입니다.
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
// 필기는 백엔드 정적 경로 /question_image, 실기는 /ipep-img/random 또는 /ipep-img/past를 사용합니다.
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
