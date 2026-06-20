// Root application shell, route table, and global guards.
import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';

import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';
import './styles/global/app-overrides.css';
import './styles/global/auth.css';
import './styles/admin/admin.css';
import './styles/admin/admin-dashboard.css';
import './styles/admin/admin-notice-maintenance.css';
import './styles/admin/admin-questions-tabs.css';
import './styles/admin/admin-display.css';
import './styles/admin/admin-calendar.css';
import './styles/admin/admin-user-approval.css';
import './styles/admin/admin-operation.css';
import './styles/admin/admin-user-overrides.css';
import './styles/admin/admin-approval-detail.css';
import './styles/global/hcaptcha.css';
import './styles/mealmap/mealmap.css';
import './styles/mealmap/mealmap-theme.css';
import './styles/mealmap/mealmap-admin.css';
import './styles/mealmap/mealmap-dark-ui.css';
import './styles/mealmap/mealmap-kakao.css';
import './styles/mealmap/mealmap-activity.css';
import './styles/mealmap/mealmap-tone-fixes.css';
import './styles/admin/admin-theme-fixes.css';

import useScreenSettings from './useScreenSettings';
import RealTimeClock from './components/app/RealTimeClock';
import ThemeModeToggle from './components/app/ThemeModeToggle';

const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const FindAuth = lazy(() => import('./pages/FindAuth'));
const PastExam = lazy(() => import('./pages/PastExam'));
const RandomPractice = lazy(() => import('./pages/RandomPractice'));
const MyPage = lazy(() => import('./pages/MyPage'));
const WrongPractice = lazy(() => import('./pages/WrongPractice'));
const Fortune = lazy(() => import('./pages/Fortune'));
const FAQ = lazy(() => import('./pages/FAQ'));
const ChangePW = lazy(() => import('./pages/ChangePW'));
const Board = lazy(() => import('./pages/Board'));
const IpepPractice = lazy(() => import('./pages/IpepPractice'));
const WrittenLobby = lazy(() => import('./pages/WrittenLobby'));
const CertificateIpeHome = lazy(() => import('./pages/CertificateIpeHome'));
const PastExamMultiplayer = lazy(() => import('./pages/PastExamMultiplayer'));
const MealMap = lazy(() => import('./pages/MealMap'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminUserRanking = lazy(() => import('./pages/AdminUserRanking'));

// App.jsx
// 역할:
// 1. 우공실 전체 화면의 최상위 컴포넌트다.
// 2. 상단 메뉴, 라우팅, 로그인 유지시간, 중복 로그인 체크를 담당합니다.
// 3. 기존 필기 문제은행(/practice), 필기 기출(/exam)은 삭제하지 않고 그대로 유지합니다.
// 4. 정보처리기사 기능은 /cert/ipe 하위 주소로 묶되, 기존 필기/실기 화면 디자인과 기능은 그대로 재사용합니다.
// 5. 기존 /written, /practice, /exam, /ipep 주소는 새 정보처리기사 주소로 넘겨 북마크 호환성을 유지합니다.
// 6. 관리자/회식맵은 내부 탭 주소만 연결하고, DB·API·채점·승인 로직은 변경하지 않는다.

const API_BASE = '';

// 브라우저/기기 단위 요청 제한용 client id
// localStorage를 지우면 초기화될 수 있지만, 같은 네트워크 전체 차단을 줄이는 1차 기준으로 사용합니다.
function wgsGetOrCreateClientId() {
  try {
    const storageKey = 'wgs_client_id';
    let value = window.localStorage.getItem(storageKey);
    if (!value) {
      const randomId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      value = `wgs-${randomId}`;
      window.localStorage.setItem(storageKey, value);
    }
    return value;
  } catch (err) {
    return `wgs-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

try {
  axios.defaults.headers.common['X-WGS-Client-Id'] = wgsGetOrCreateClientId();
} catch (err) {
  console.warn('[WGS] client id header setup failed:', err);
}




// 세션 만료/중복 로그인/서버 업데이트 toast 공통 관리합니다
// ----------------------------------------------------------
// handleLogout 이후 window.location.reload()가 실행되면 현재 화면의 toast는 사라진다.
// 그래서 로그아웃 사유를 localStorage에 잠깐 저장해두고,
// 새로고침 후 App이 다시 뜰 때 ToastContainer로 안내 문구를 보여줍니다.
const PENDING_LOGOUT_TOAST_KEY = 'wgsPendingLogoutToast';
const REMEMBERED_LOGIN_KEY = 'wgsRememberedLoggedIn';
const SERVER_INSTANCE_ID_KEY = 'wgsServerInstanceId';
const ADMIN_NOTICE_SEEN_KEY = 'wgsAdminNoticeLastSeenMs';

// 정보처리기사 메뉴가 필기/실기 기능을 묶는 상위 입구 역할을 하도록 새 주소를 정의합니다.
// 기존 기능 컴포넌트는 그대로 재사용하므로 DB/API/채점 로직은 변경하지 않는다.
const CERT_IPE_PATHS = [
    '/cert/ipe',
    '/cert/ipe/written',
    '/cert/ipe/written-bank',
    '/cert/ipe/written-past',
    '/cert/ipe/practical',
    '/cert/ipe/practical-bank',
    '/cert/ipe/practical-past'
];

const LOGOUT_NOTICE_MESSAGES = {
    duplicate_login: '다른 기기에서 로그인하여 현재 기기에서는 로그아웃이 되었습니다.',
    session_expired: '세션시간이 만료되어 로그아웃되었습니다, 다시 로그인해주세요.',
    server_updated: '서버가 업데이트되었습니다, 다시 로그인해주세요.'
};

const getToastTheme = () => (localStorage.getItem('wgsThemeMode') === 'light'? 'light' : 'dark');

const THEME_TONE_MIN = 10;
const THEME_TONE_MAX = 100;
const THEME_TONE_STEP = 10;
const THEME_TONE_DEFAULT = 50;
const THEME_TONE_STORAGE_KEYS = {
    light: 'wgsSessionThemeToneLight',
    dark: 'wgsSessionThemeToneDark',
};

// 밝기 조절은 전체 filter 대신 주요 배경/UI 토큰만 다시 계산합니다.
const THEME_TONE_BASE_TOKENS = {
    light: {
        '--wgs-page-bg': '#f7fbff',
        '--wgs-panel': '#ffffff',
        '--wgs-card': '#ffffff',
        '--wgs-card-soft': '#f8fafc',
        '--wgs-surface': '#ffffff',
        '--wgs-surface-2': '#f3f7ff',
        '--wgs-deep-bg': '#eaf3ff',
        '--wgs-neutral-bg': '#f8fafc',
        '--wgs-panel-soft': '#f0f7ff',
        '--wgs-panel-strong': '#ffffff',
        '--wgs-button-muted': '#ebf4ff',
        '--wgs-input-bg': '#ffffff',
        '--wgs-choice-bg': '#ffffff',
        '--wgs-question-bg': '#ffffff',
        '--wgs-exam-card': '#ffffff',
    },
    dark: {
        '--wgs-page-bg': '#061321',
        '--wgs-panel': '#0f1e31',
        '--wgs-card': '#0d1b2d',
        '--wgs-card-soft': '#122338',
        '--wgs-surface': '#0e1d31',
        '--wgs-surface-2': '#12243a',
        '--wgs-deep-bg': '#020817',
        '--wgs-neutral-bg': '#0b1727',
        '--wgs-panel-soft': '#0f1e31',
        '--wgs-panel-strong': '#0d1b2d',
        '--wgs-button-muted': '#111f33',
        '--wgs-input-bg': '#020a17',
        '--wgs-choice-bg': '#071426',
        '--wgs-question-bg': '#071426',
        '--wgs-exam-card': '#0b1727',
    },
};

const THEME_TONE_ALPHA_TOKENS = {
    light: {
        '--wgs-panel': 0.86,
        '--wgs-card': 0.92,
        '--wgs-card-soft': 0.92,
        '--wgs-panel-soft': 0.88,
        '--wgs-button-muted': 0.88,
        '--wgs-input-bg': 0.96,
    },
    dark: {
        '--wgs-panel': 0.88,
        '--wgs-card': 0.92,
        '--wgs-card-soft': 0.82,
        '--wgs-panel-soft': 0.72,
        '--wgs-button-muted': 0.92,
        '--wgs-input-bg': 0.92,
    },
};

const THEME_TONE_MIX_LIMITS = {
    light: { dim: 0.24, brighten: 0.10 },
    dark: { dim: 0.72, brighten: 0.36 },
};

const clampThemeTone = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return THEME_TONE_DEFAULT;

    const steppedValue = Math.round(numericValue / THEME_TONE_STEP) * THEME_TONE_STEP;
    return Math.min(THEME_TONE_MAX, Math.max(THEME_TONE_MIN, steppedValue));
};

const getThemeToneStorageKey = (mode) => THEME_TONE_STORAGE_KEYS[mode === 'dark'? 'dark' : 'light'];

const getStoredThemeTone = (mode) => {
    const savedValue = sessionStorage.getItem(getThemeToneStorageKey(mode));
    return clampThemeTone(savedValue ?? THEME_TONE_DEFAULT);
};

const hexToRgb = (hexColor) => {
    const cleanHex = String(hexColor || '').replace('#', '');
    const fullHex = cleanHex.length === 3
        ? cleanHex.split('').map((char) => `${char}${char}`).join('')
        : cleanHex;
    const parsedValue = Number.parseInt(fullHex, 16);

    if (!Number.isFinite(parsedValue)) return [0, 0, 0];
    return [
        (parsedValue >> 16) & 255,
        (parsedValue >> 8) & 255,
        parsedValue & 255,
    ];
};

const mixRgb = (baseRgb, targetRgb, ratio) => (
    baseRgb.map((channel, index) => Math.round(channel + (targetRgb[index] - channel) * ratio))
);

const toRgbText = ([red, green, blue], alpha) => (
    alpha === undefined
        ? `rgb(${red}, ${green}, ${blue})`
        : `rgba(${red}, ${green}, ${blue}, ${alpha})`
);

const adjustThemeRgb = (hexColor, tone, mode) => {
    const toneDelta = clampThemeTone(tone) - THEME_TONE_DEFAULT;
    const baseRgb = hexToRgb(hexColor);
    if (toneDelta === 0) return baseRgb;

    const normalizedMode = mode === 'dark' ? 'dark' : 'light';
    const limit = toneDelta > 0
        ? THEME_TONE_MIX_LIMITS[normalizedMode].brighten
        : THEME_TONE_MIX_LIMITS[normalizedMode].dim;
    const range = toneDelta > 0
        ? THEME_TONE_MAX - THEME_TONE_DEFAULT
        : THEME_TONE_DEFAULT - THEME_TONE_MIN;
    const targetRgb = toneDelta > 0 ? [255, 255, 255] : [0, 0, 0];
    const mixRatio = (Math.abs(toneDelta) / range) * limit;

    return mixRgb(baseRgb, targetRgb, mixRatio);
};

const buildThemeToneVariables = (mode, tone) => {
    const normalizedMode = mode === 'dark' ? 'dark' : 'light';
    const baseTokens = THEME_TONE_BASE_TOKENS[normalizedMode];
    const alphaTokens = THEME_TONE_ALPHA_TOKENS[normalizedMode];

    return Object.entries(baseTokens).reduce((nextTokens, [tokenName, tokenValue]) => {
        const adjustedRgb = adjustThemeRgb(tokenValue, tone, normalizedMode);
        const alpha = alphaTokens[tokenName];

        nextTokens[tokenName] = alpha === undefined
            ? toRgbText(adjustedRgb)
            : toRgbText(adjustedRgb, alpha);
        return nextTokens;
    }, {
        '--wgs-theme-tone': String(clampThemeTone(tone)),
    });
};

const showWgsToast = (message, type = 'info') => {
    const toastByType = toast[type] || toast.info;
    toastByType(message, {
        position: 'top-right',
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        theme: getToastTheme()
    });
};

function RouteLoadingFallback() {
    return (
        <div
            style={{
                width: '100%',
                minHeight: '220px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--wgs-muted)',
                fontWeight: 700,
            }}
        >
            화면을 불러오는 중입니다...
        </div>
    );
}


// 관리자와 운영자 권한 값은 서버와 브라우저 저장소에서 true/false, 1/0, 'true'/'1'처럼 섞여 들어올 수 있습니다.
// 상단 관리자 메뉴와 /admin 이동 가드가 같은 기준을 쓰도록 여기서 한 번에 정규화합니다.
const isTruthySessionFlag = (value) => (
    value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true'
);

// /api/check-session 응답에 최신 권한값이 포함되면 sessionStorage에 동기화합니다.
// 사용자가 새로 로그인하거나 새로고침하면 관리자 화면에서 변경한 최신 DB 권한을 반영합니다.
const syncSessionAdminFlags = (payload = {}) => {
    let changed = false;

    const setFlag = (key, value) => {
        if (value === undefined || value === null) return;
        const normalized = isTruthySessionFlag(value) ? 'true' : 'false';
        if (sessionStorage.getItem(key) !== normalized) {
            sessionStorage.setItem(key, normalized);
            changed = true;
        }
    };

    if ('isOperator'in payload || 'is_operator'in payload) {
        setFlag('isOperator', payload.isOperator ?? payload.is_operator);
    }
    if ('isPrimaryAdmin'in payload || 'is_primary_admin'in payload) {
        setFlag('isPrimaryAdmin', payload.isPrimaryAdmin ?? payload.is_primary_admin);
    }
    if ('isAdmin'in payload || 'is_admin'in payload) {
        setFlag('isAdmin', payload.isAdmin ?? payload.is_admin);
    }

    return changed;
};

const savePendingLogoutToast = (reason) => {
    const message = LOGOUT_NOTICE_MESSAGES[reason];
    if (!message) return;

    localStorage.setItem(PENDING_LOGOUT_TOAST_KEY, JSON.stringify({
        reason,
        message,
        createdAt: Date.now()
    }));
};

// 기존 window.alert를 토스트 알림으로 바꾸는 부분입니다.
// 기존 사이트 전반의 알림 사용자 경험을 유지하기 위해 남겨둡니다.
const originalAlert = window.alert;
window.alert = (message) => {
    showWgsToast(message, 'info');
};

function App() {
    // 관리자페이지 > 화면 설정 관리의 전체 사이트명 값을 실제 헤더에 연결합니다.
    const { getSetting: getGlobalScreenSetting } = useScreenSettings('all');
    const navHomeLabel = getGlobalScreenSetting('nav.home_label', '홈');
    const navCertIpeLabel = getGlobalScreenSetting('nav.cert_ipe_label', '정보처리기사');
    const navMultiplayerLabel = getGlobalScreenSetting('nav.multiplayer_label', '멀티플레이');
    const navMealMapLabel = getGlobalScreenSetting('nav.mealmap_label', '회식맵');
    const navMyPageLabel = getGlobalScreenSetting('nav.mypage_label', '마이페이지');
    const navBoardLabel = getGlobalScreenSetting('nav.board_label', '게시판');
    const navFaqLabel = getGlobalScreenSetting('nav.faq_label', 'FAQ');
    const navFortuneLabel = getGlobalScreenSetting('nav.fortune_label', '운세');
    const navAdminLabel = getGlobalScreenSetting('nav.admin_label', '관리자');
    const navLoginLabel = getGlobalScreenSetting('nav.login_label', '로그인');
    const navLogoutLabel = getGlobalScreenSetting('nav.logout_label', '로그아웃');

    const navigate = useNavigate();
    const location = useLocation();

    const loggedInUser = sessionStorage.getItem('userName');
    // 운영자 권한은 sessionStorage에 'true' 또는 '1'로 저장될 수 있으므로 문자열 하나만 비교하지 않는다.
    // authRevision은 /api/check-session 폴링이 최신 DB 권한을 동기화했을 때 상단 메뉴를 다시 렌더링하기 위한 값입니다.
    const [authRevision, setAuthRevision] = useState(0);
    const isAdminUser = Boolean(authRevision >= 0) && (
        isTruthySessionFlag(sessionStorage.getItem('isOperator')) ||
        isTruthySessionFlag(sessionStorage.getItem('is_operator')) ||
        isTruthySessionFlag(sessionStorage.getItem('isPrimaryAdmin')) ||
        isTruthySessionFlag(sessionStorage.getItem('is_primary_admin')) ||
        isTruthySessionFlag(sessionStorage.getItem('isAdmin'))
    );

    // 서버 점검 모드 상태입니다.
    // 관리자는 점검 모드에서도 사이트를 계속 사용할 수 있고, 일반 사용자는 안내 화면으로 막습니다.
    const [maintenanceStatus, setMaintenanceStatus] = useState({
        enabled: false,
        message: '현재 우공실 사이트 점검 중입니다. 잠시 후 다시 접속해주세요.',
        updatedAtText: '',
        updatedBy: '',
    });

    // 점검 모드 상태를 서버에서 가져옵니다.
    // 실패해도 기존 화면이 멈추지 않도록 조용히 무시합니다.
    const refreshMaintenanceStatus = async () => {
        try {
            const response = await fetch('/api/maintenance/status');
            const result = await response.json();
            if (result.success && result.maintenance) {
                setMaintenanceStatus(result.maintenance);
            }
        } catch (error) {
            console.warn('점검 모드 상태 확인 실패:', error);
        }
    };

    // 앱 진입 시와 이후 10초마다 점검 모드 상태를 확인합니다.
    // 관리자가 점검 모드를 켠 순간 일반 사용자가 새로고침하지 않아도 안내 화면으로 전환됩니다.
    useEffect(() => {
        refreshMaintenanceStatus();
        const timer = setInterval(refreshMaintenanceStatus, 10000);
        return () => clearInterval(timer);
    }, []);

    // 다크/라이트 모드 상태입니다.
    // localStorage에 저장해 사용자가 새로고침하거나 다시 접속해도 마지막 선택이 유지되도록 합니다.
    const [themeMode, setThemeMode] = useState(() => {
        // 저장된 선택값이 없으면 라이트모드로 시작합니다.
        // 사용자가 다크모드를 직접 선택한 경우에만 기존 선택을 유지합니다.
        const savedThemeMode = localStorage.getItem('wgsThemeMode');
        return savedThemeMode === 'dark'? 'dark' : 'light';
    });
    const [themeTone, setThemeTone] = useState(() => getStoredThemeTone(themeMode));

    useEffect(() => {
        const isLight = themeMode === 'light';
        const toneVariables = buildThemeToneVariables(themeMode, themeTone);

        document.body.classList.toggle('wgs-theme-light', isLight);
        document.body.classList.toggle('wgs-theme-dark', !isLight);
        document.documentElement.setAttribute('data-wgs-theme', themeMode);
        document.documentElement.setAttribute('data-wgs-theme-tone', String(themeTone));
        Object.entries(toneVariables).forEach(([tokenName, tokenValue]) => {
            document.body.style.setProperty(tokenName, tokenValue);
        });
        localStorage.setItem('wgsThemeMode', themeMode);
        sessionStorage.setItem(getThemeToneStorageKey(themeMode), String(themeTone));
    }, [themeMode, themeTone]);

    useEffect(() => {
        // reload 이후에도 로그아웃 사유 toast가 보이도록 복구하는 부분입니다.
        // 1순위: handleLogout에서 저장한 명확한 사유
        // 2순위: 브라우저를 닫았다가 다시 들어온 경우의 일반 세션 만료 안내
        const pendingRaw = localStorage.getItem(PENDING_LOGOUT_TOAST_KEY);
        const hasBrowserSession = Boolean(sessionStorage.getItem('userId') && sessionStorage.getItem('sessionToken'));

        if (pendingRaw) {
            try {
                const pending = JSON.parse(pendingRaw);
                if (pending?.message) showWgsToast(pending.message, pending.reason === 'server_updated'? 'warning' : 'info');
            } catch (error) {
                showWgsToast('세션정보가 만료되어 다시 로그인해주세요.', 'info');
            }

            localStorage.removeItem(PENDING_LOGOUT_TOAST_KEY);
            localStorage.removeItem(REMEMBERED_LOGIN_KEY);
            return;
        }

        if (!hasBrowserSession && localStorage.getItem(REMEMBERED_LOGIN_KEY) === 'true') {
            showWgsToast(LOGOUT_NOTICE_MESSAGES.session_expired, 'info');
            localStorage.removeItem(REMEMBERED_LOGIN_KEY);
        }
    }, []);

    const handleThemeChange = useCallback((nextMode) => {
        const normalizedMode = nextMode === 'light'? 'light' : 'dark';
        setThemeMode(normalizedMode);
        setThemeTone(getStoredThemeTone(normalizedMode));
    }, []);

    const handleThemeToneChange = useCallback((nextTone) => {
        setThemeTone(clampThemeTone(nextTone));
    }, []);

    // 필기 기출/실기 기출 시험 응시 중 이탈 방지 상태입니다.
    // 경고 횟수는 화면 상단에 표시하고 sessionStorage에도 남겨서 새로고침 직전까지 기록합니다.
    const [isExamActive, setIsExamActiveState] = useState(false);
    const [examWarningCount, setExamWarningCount] = useState(0);
    const examGuardActiveRef = useRef(false);
    const lastWarningAtRef = useRef(0);


    // 관리자가 전체 공지를 발송하면 로그인 사용자는 5초 폴링으로 새 공지를 받아 모달로 확인합니다.
    const [adminNoticePopup, setAdminNoticePopup] = useState(null);
    const [adminNoticeQueue, setAdminNoticeQueue] = useState([]);

    const EXAM_GUARD_MESSAGE = '시험 응시 중에는 결과 제출 전까지 다른 메뉴 이동, 뒤로가기, 새로고침, 탭 이탈이 제한됩니다.';

    const recordExamWarning = useCallback((reason, showBlockingAlert = false) => {
        const now = Date.now();

        // blur/visibilitychange는 짧은 시간에 여러 번 발생할 수 있으므로 중복 경고를 줄입니다.
        if (now - lastWarningAtRef.current < 1200) return;
        lastWarningAtRef.current = now;

        setExamWarningCount(prev => {
            const next = prev + 1;
            sessionStorage.setItem('wgsExamWarningCount', String(next));
            sessionStorage.setItem('wgsExamLastWarningReason', reason);
            return next;
        });

        toast.warn(`시험 이탈 감지: ${reason}`, {
            position: 'top-right',
            autoClose: 2500,
            // 현재 사용자가 선택한 테마와 토스트 테마를 맞춥니다.
        theme: localStorage.getItem('wgsThemeMode') === 'light'? 'light' : 'dark'
        });

        // 메뉴 이동/뒤로가기처럼 실제 이동을 막아야 하는 경우에는 원래 alert를 사용합니다.
        // Global alerts are mapped to toast notifications, so blocking guard messages use the native alert.
        if (showBlockingAlert) {
            originalAlert(`${EXAM_GUARD_MESSAGE}\n\n감지된 행동: ${reason}`);
        }
    }, []);

    const setIsExamActive = useCallback((active) => {
        const nextActive = Boolean(active);
        examGuardActiveRef.current = nextActive;
        setIsExamActiveState(nextActive);

        if (nextActive) {
            setExamWarningCount(0);
            sessionStorage.setItem('wgsExamGuardActive', 'true');
            sessionStorage.setItem('wgsExamWarningCount', '0');

            // 브라우저 뒤로가기 차단을 위해 현재 URL을 히스토리에 한 번 더 쌓습니다.
            // 사용자가 뒤로가기를 누르면 popstate에서 다시 현재 위치로 밀어 넣습니다.
            window.history.pushState({ wgsExamGuard: true }, '', window.location.href);
        } else {
            sessionStorage.removeItem('wgsExamGuardActive');
            sessionStorage.removeItem('wgsExamLastWarningReason');

            // 결과 제출 후에는 전체화면을 자동 해제합니다. 실패해도 기존 흐름은 막지 않습니다.
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
        }
    }, []);

    useEffect(() => {
        examGuardActiveRef.current = isExamActive;
    }, [isExamActive]);

    useEffect(() => {
        if (!isExamActive) return;

        const handleBeforeUnload = (event) => {
            recordExamWarning('새로고침 또는 창 닫기 시도', false);
            event.preventDefault();
            event.returnValue = '';
            return '';
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                recordExamWarning('다른 탭 또는 다른 프로그램으로 이탈', false);
            }
        };

        const handleWindowBlur = () => {
            recordExamWarning('브라우저 창 포커스 이탈', false);
        };

        const handlePopState = () => {
            if (!examGuardActiveRef.current) return;
            window.history.pushState({ wgsExamGuard: true }, '', window.location.href);
            recordExamWarning('브라우저 뒤로가기 시도', true);
        };

        const handleFullscreenChange = () => {
            if (!examGuardActiveRef.current) return;
            if (!document.fullscreenElement) {
                recordExamWarning('전체화면 해제 시도', false);
                // ESC 등으로 전체화면이 풀렸을 때 다시 요청합니다.
                // 브라우저 정책상 사용자 제스처가 없으면 재진입이 거부될 수 있지만, 가능한 경우 즉시 복구됩니다.
                setTimeout(() => {
                    if (examGuardActiveRef.current && !document.fullscreenElement && document.documentElement.requestFullscreen) {
                        document.documentElement.requestFullscreen().catch(() => {});
                    }
                }, 200);
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('popstate', handlePopState);
        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('popstate', handlePopState);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [isExamActive, recordExamWarning]);

    const handleLogout = useCallback(async (options = false) => {
        // 예전 코드 호환:
        // - handleLogout(false): 사용자가 직접 누른 일반 로그아웃
        // - handleLogout(true): 중복 로그인 등 강제 로그아웃
        // 신규 코드에서는 reason을 함께 넘겨 toast 문구를 구분합니다.
        const logoutOptions = typeof options === 'object' && options !== null
            ? options
            : {
                isForced: Boolean(options),
                reason: options ? 'duplicate_login' : 'manual',
                callLogoutApi: !options
            };

        const isForced = Boolean(logoutOptions.isForced);
        const reason = logoutOptions.reason || (isForced ? 'duplicate_login' : 'manual');
        const callLogoutApi = logoutOptions.callLogoutApi !== false;

        if (examGuardActiveRef.current && !isForced) {
            recordExamWarning('시험 중 로그아웃 시도', true);
            return;
        }

        const userId = sessionStorage.getItem('userId');
        const sessionToken = sessionStorage.getItem('sessionToken');

        if (reason !== 'manual') {
            savePendingLogoutToast(reason);
        } else {
            // 사용자가 직접 로그아웃한 경우에는 다음 접속 때 세션 만료 알림을 표시하지 않습니다.
            localStorage.removeItem(PENDING_LOGOUT_TOAST_KEY);
            localStorage.removeItem(REMEMBERED_LOGIN_KEY);
        }

        if (userId && callLogoutApi && !isForced) {
            try {
                await axios.post(`${API_BASE}/api/logout`, { id: userId, sessionToken });
            } catch (e) {
                // 로그아웃 API 실패가 있어도 브라우저 세션은 비워야 하므로 여기서 멈추지 않는다.
            }
        }

        sessionStorage.clear();
        navigate('/');
        window.location.reload();
    }, [navigate, recordExamWarning]);

    useEffect(() => {
        let pollTimer;
        const userId = sessionStorage.getItem('userId');
        const sessionToken = sessionStorage.getItem('sessionToken');
        const serverInstanceId = sessionStorage.getItem(SERVER_INSTANCE_ID_KEY) || localStorage.getItem(SERVER_INSTANCE_ID_KEY) || '';

        if (userId && sessionToken) {
            pollTimer = setInterval(async () => {
                try {
                    const res = await axios.post(`${API_BASE}/api/check-session`, {
                        id: userId,
                        sessionToken,
                        serverInstanceId
                    });

                    if (res.data.serverInstanceId) {
                        sessionStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
                        localStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
                    }

                    if (!res.data.valid) {
                        const reason = res.data.reason || 'session_expired';
                        handleLogout({ reason, isForced: true, callLogoutApi: false });
                    } else if (syncSessionAdminFlags(res.data)) {
                        // 세션은 유효하지만 DB 권한값이 바뀐 경우 상단 관리자 메뉴 노출 상태를 즉시 갱신합니다.
                        setAuthRevision((prev) => prev + 1);
                    }
                } catch (e) {
                    console.error(e);
                }
            }, 3000);
        }

        return () => clearInterval(pollTimer);
    }, [loggedInUser, handleLogout]);

    // 별도 소켓 클라이언트를 추가하지 않고 기존 axios 흐름에 맞춰 5초마다 새 공지만 확인합니다.
    // 최초 접속 시점 이후에 발송된 공지만 보여주기 위해 마지막 확인 시각을 localStorage에 저장합니다.
    useEffect(() => {
        const userId = sessionStorage.getItem('userId');
        const sessionToken = sessionStorage.getItem('sessionToken');

        if (!loggedInUser || !userId || !sessionToken) {
            setAdminNoticePopup(null);
            setAdminNoticeQueue([]);
            return undefined;
        }

        if (!localStorage.getItem(ADMIN_NOTICE_SEEN_KEY)) {
            localStorage.setItem(ADMIN_NOTICE_SEEN_KEY, String(Date.now()));
        }

        let isMounted = true;
        let pollTimer;

        const fetchLatestAdminNotices = async () => {
            try {
                const sinceMs = Number(localStorage.getItem(ADMIN_NOTICE_SEEN_KEY) || Date.now());
                const res = await axios.post(`${API_BASE}/api/admin/notices/latest`, {
                    id: userId,
                    sessionToken,
                    sinceMs
                });

                if (!isMounted || !res.data?.success) return;

                const notices = Array.isArray(res.data.notices) ? res.data.notices : [];
                if (notices.length === 0) return;

                // 새 공지는 큐에 쌓아 순서대로 보여줍니다.
                setAdminNoticeQueue(prev => {
                    const prevIds = new Set(prev.map(item => item.id));
                    const freshNotices = notices.filter(item => item?.id && !prevIds.has(item.id));
                    return [...prev, ...freshNotices];
                });

                const newestNotice = notices[notices.length - 1];
                if (newestNotice?.createdAtMs) {
                    localStorage.setItem(ADMIN_NOTICE_SEEN_KEY, String(newestNotice.createdAtMs));
                }
            } catch (error) {
                // 공지 수신 실패는 사이트 이용을 막을 정도의 오류가 아니므로 콘솔에만 남긴다.
                console.error('[admin notice poll error]', error);
            }
        };

        fetchLatestAdminNotices();
        pollTimer = setInterval(fetchLatestAdminNotices, 5000);

        return () => {
            isMounted = false;
            clearInterval(pollTimer);
        };
    }, [loggedInUser]);

    // 공지 큐에 쌓인 메시지를 하나씩 모달로 보여줍니다.
    useEffect(() => {
        if (adminNoticePopup || adminNoticeQueue.length === 0) return;

        const [nextNotice, ...restNotices] = adminNoticeQueue;
        setAdminNoticePopup(nextNotice);
        setAdminNoticeQueue(restNotices);
    }, [adminNoticePopup, adminNoticeQueue]);

    const closeAdminNoticePopup = useCallback(() => {
        setAdminNoticePopup(null);
    }, []);

    const handleNavigation = (e, path) => {
        e.preventDefault();

        // 로그인이 필요한 메뉴 목록입니다.
        // 학습 라우트는 하위 호환 경로와 신규 화면 경로를 함께 제공합니다.
        const loginRequiredPaths = ['/written', '/practice', '/exam', '/multiplayer', '/ipep', '/cert/ipe', '/mealmap', '/mypage', '/fortune', '/admin'];

        if (!loggedInUser && (loginRequiredPaths.includes(path) || CERT_IPE_PATHS.includes(path) || path.startsWith('/cert/ipe/'))) {
            alert('로그인이 필요한 서비스입니다.');
            navigate('/login');
            return;
        }

        // 관리자 메뉴는 DB에서 확인된 최고관리자 또는 운영자 권한 사용자만 이동할 수 있게 1차로 막는다.
        // 백엔드 API에서도 같은 관리자 권한 검사를 수행해 실제 데이터 접근까지 보호합니다.
        if ((path === '/admin' || path.startsWith('/admin/')) && !isAdminUser) {
            alert('관리자 계정만 접근할 수 있습니다.');
            navigate('/');
            return;
        }

        // 필기 기출 또는 실기 기출 응시 중에는 결과 제출 전까지 메뉴 이동을 막습니다.
        // 사용자가 실수로 상단 메뉴를 눌러 답안이 사라지는 상황을 막기 위한 보호 로직입니다.
        if (examGuardActiveRef.current && path !== location.pathname) {
            recordExamWarning(`메뉴 이동 시도: ${path}`, true);
            return;
        }

        navigate(path);
        window.scrollTo(0, 0);
    };

    const appMaxWidth = isExamActive ? '1500px' : '1480px';

    const NavItem = ({ path, color = 'white', activePaths = [], children }) => {
        // activePaths를 추가한 이유:
        // /written 메뉴는 /practice와 /exam으로 들어가도 같은 필기 영역으로 강조되게 하기 위한 처리입니다.
        const isActive = location.pathname === path || activePaths.includes(location.pathname) || activePaths.some((activePath) => activePath.endsWith('/*') && location.pathname.startsWith(activePath.slice(0, -2)));

        return (
            <a
                className="wgs-nav-item wgs-type-nav" href={path}
                onClick={(e) => handleNavigation(e, path)}
                style={{
                    color,
                    textDecoration: 'none',
                    fontWeight: 'bold',
                    padding: '10px 15px',
                    borderRadius: '8px',
                    background: isActive ? `linear-gradient(180deg, ${color}22, ${color}12)` : 'transparent',
                    border: isActive ? `1px solid ${color}66` : '1px solid transparent',
                    borderBottom: isActive ? `3px solid ${color}` : '3px solid transparent',
                    boxShadow: isActive ? `0 8px 20px ${color}22` : 'none',
                    transition: 'all 0.2s ease-in-out',
                    whiteSpace: 'nowrap',
                    fontSize: '15px'
                }}
            >
                {children}
            </a>
        );
    };


    // 점검 모드가 켜져 있고 현재 사용자가 관리자 권한 사용자가 아니면 사이트 이용을 막습니다.
    // 비로그인 상태는 관리자 로그인을 위해 막지 않고, 로그인 시 백엔드에서 일반 사용자만 차단합니다.
    if (maintenanceStatus.enabled && loggedInUser && !isAdminUser) {
        return (
            <div className="maintenance-lock-page">
                <div className="maintenance-lock-card">
                    <span className="maintenance-lock-badge">사이트 점검 중</span>
                    <h1>우공실 점검 모드가 실행 중입니다.</h1>
                    <p>{maintenanceStatus.message || '현재 우공실 사이트 점검 중입니다. 잠시 후 다시 접속해주세요.'}</p>
                    <div className="maintenance-lock-meta">
                        {maintenanceStatus.updatedAtText ? `최근 변경: ${maintenanceStatus.updatedAtText}` : '관리자가 점검을 종료하면 다시 이용할 수 있습니다.'}
                    </div>
                    <button type="button" onClick={handleLogout}>로그아웃</button>
                </div>
            </div>
        );
    }

    return (
        <div
            className="wgs-app-shell" style={{ minHeight: '100vh', padding: '20px 10px', width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}
        >
            <ToastContainer theme={themeMode} />

            {adminNoticePopup && (
                <div className="admin-notice-user-overlay" role="dialog" aria-modal="true">
                    <div className={`admin-notice-user-modal admin-notice-user-modal--${adminNoticePopup.level || adminNoticePopup.status || 'info'}`}>
                        <div className="admin-notice-user-badge">{adminNoticePopup.source === 'mealmap' ? '회식맵 알림' : '관리자 공지'}</div>
                        <h2>{adminNoticePopup.title || (adminNoticePopup.source === 'mealmap'? '회식맵 알림' : '관리자 공지')}</h2>
                        <p>{adminNoticePopup.message}</p>
                        <div className="admin-notice-user-meta">
                            {adminNoticePopup.source === 'mealmap'? (
                                <>
                                    <span>발송자: {adminNoticePopup.authorName || '회식맵 관리자'}</span>
                                    <span>발송일시: {adminNoticePopup.createdAt ? new Date(adminNoticePopup.createdAt).toLocaleString('ko-KR') : '방금 전'}</span>
                                </>
                            ) : (
                                <>발송자: {adminNoticePopup.authorName || '관리자'} · {adminNoticePopup.createdAt ? new Date(adminNoticePopup.createdAt).toLocaleString('ko-KR') : '방금 전'}</>
                            )}
                        </div>
                        <button type="button" onClick={closeAdminNoticePopup}>확인</button>
                    </div>
                </div>
            )}

            <div
                className="wgs-layout" style={{ width: '100%', maxWidth: appMaxWidth, margin: '0 auto', transition: 'max-width 0.2s ease', boxSizing: 'border-box' }}
            >
                <header className="wgs-header">
                    {/* 사이트 로고성 제목은 공통 로고 폰트 토큰을 사용하는 .wgs-site-logo 클래스로 통일합니다.
                        기존 제목 문구와 라우팅/로그인 로직은 유지합니다. */}
                    <h1 className="wgs-site-logo wgs-type-logo" style={{ color: 'var(--wgs-title)', padding: '10px 0', margin: '0 0 15px 0', fontSize: '26px', textAlign: 'center', fontWeight: '900', letterSpacing: '1px' }}>{getGlobalScreenSetting('global.site_title', 'SKN29th_우공실')}</h1>

                    <ThemeModeToggle
                        themeMode={themeMode}
                        themeTone={themeTone}
                        onChangeTheme={handleThemeChange}
                        onChangeThemeTone={handleThemeToneChange}
                    />

                    <RealTimeClock loggedInUser={loggedInUser} handleLogout={handleLogout} isExamActive={isExamActive} examWarningCount={examWarningCount} />

                    <nav className="wgs-main-nav" style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '10px',
                        background: 'var(--wgs-card-bg)',
                        borderRadius: '12px',
                        boxShadow: '0 4px 15px var(--wgs-shadow)',
                        flexWrap: 'nowrap',
                        overflowX: 'auto',
                        gap: '8px',
                        border: '1px solid var(--wgs-border)'
                    }}>
                        {/*  우공실의 핵심 흐름에 맞춰 메뉴 순서를 재정렬했습니다.
                            메뉴 순서는 홈, 필기, 실기, 마이페이지, 게시판, FAQ, 운세입니다.
                            학습 기능을 먼저 배치하고, 커뮤니티/안내/부가기능은 뒤로 배치했습니다. */}
                        <NavItem path="/" color="#2dd4bf">{navHomeLabel}</NavItem>
                        {/*  [멀티플레이 1단계 분리]
                        필기문제 메뉴는 이제 문제은행(/practice)과 기출문제(/exam)만 같은 영역으로 강조합니다.
                        멀티플레이(/multiplayer)는 별도 메뉴로 분리해 필기문제 페이지와 시각적으로 구분합니다. */}
                        <NavItem
                            path="/cert/ipe" color="#60a5fa" activePaths={['/cert/ipe/*', '/written', '/practice', '/exam', '/ipep']}
                        >
                            {navCertIpeLabel}
                        </NavItem>
                        {/*  [멀티플레이 1단계 분리]
                        기존 /multiplayer 라우트와 기능은 그대로 두고, 상단 메뉴에서 바로 들어갈 수 있는 독립 입구만 추가합니다.
                        백엔드 멀티플레이 로직은 유지합니다. */}
                        <NavItem path="/multiplayer" color="#8b5cf6">{navMultiplayerLabel}</NavItem>
                        <NavItem path="/mealmap" color="#fb7185">{navMealMapLabel}</NavItem>
                        {loggedInUser && <NavItem path="/mypage" color="#a78bfa">{navMyPageLabel}</NavItem>}
                        <NavItem path="/board" color="#f97316">{navBoardLabel}</NavItem>
                        <NavItem path="/faq" color="#facc15">{navFaqLabel}</NavItem>
                        <NavItem path="/fortune" color="#fb7185">{navFortuneLabel}</NavItem>
                        {/*  [관리자 Step1 메뉴]
                            DB에서 확인된 관리자 권한 사용자에게만 운세와 로그아웃 사이에 관리자 버튼을 노출한다.
                            일반 사용자는 버튼 자체가 보이지 않으며, /admin 직접 접근도 Admin.jsx에서 한 번 더 차단한다. */}
                        {isAdminUser && <NavItem path="/admin" color="#22c55e" activePaths={['/admin/*']}>{navAdminLabel}</NavItem>}
                        {!loggedInUser ? (
                            <NavItem path="/login" color="#f8fafc">{navLoginLabel}</NavItem>
                        ) : (
                            <button
                                className="wgs-nav-item wgs-type-nav wgs-logout-nav-item" onClick={() => handleLogout(false)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    fontSize: '15px',
                                    fontWeight: 'bold',
                                    padding: '10px 15px',
                                    whiteSpace: 'nowrap',
                                    borderBottom: '3px solid transparent'
                                }}
                            >
                                 {navLogoutLabel}
                            </button>
                        )}
                    </nav>
                </header>

                <main
                    className="wgs-main-content" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', marginTop: '30px', paddingBottom: '50px' }}
                >
                    <Suspense fallback={<RouteLoadingFallback />}>
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="/login" element={<Login />} />
                            {/* 예전 /signup, /find 주소는 외부 링크/북마크 호환을 위해 유지합니다. */}
                            <Route path="/signup" element={<Signup afterSignupPath="/login" />} />
                            <Route path="/find" element={<FindAuth loginPath="/login" />} />
                            {/* 기존 주소는 새 정보처리기사 주소로 넘기고, 실제 화면은 기존 컴포넌트를 그대로 사용합니다. */}
                            <Route path="/written" element={<Navigate to="/cert/ipe/written" replace />} />
                            <Route path="/practice" element={<Navigate to="/cert/ipe/written-bank" replace />} />
                            <Route path="/exam" element={<Navigate to="/cert/ipe/written-past" replace />} />
                            <Route path="/ipep" element={<Navigate to="/cert/ipe/practical" replace />} />
                            <Route path="/cert/ipe" element={<CertificateIpeHome />} />
                            <Route path="/cert/ipe/written" element={<WrittenLobby />} />
                            <Route path="/cert/ipe/written-bank" element={<RandomPractice />} />
                            <Route path="/cert/ipe/written-past" element={<PastExam isExamActive={isExamActive} setIsExamActive={setIsExamActive} />} />
                            <Route path="/cert/ipe/practical" element={<IpepPractice key="ipep-lobby" setIsExamActive={setIsExamActive} initialMode="lobby" />} />
                            <Route path="/cert/ipe/practical-bank" element={<IpepPractice key="ipep-random" setIsExamActive={setIsExamActive} initialMode="random" />} />
                            <Route path="/cert/ipe/practical-past" element={<IpepPractice key="ipep-past" setIsExamActive={setIsExamActive} initialMode="past" />} />
                            <Route path="/multiplayer" element={<PastExamMultiplayer setIsExamActive={setIsExamActive} />} />
                            <Route path="/multiplayer/:mpTab" element={<PastExamMultiplayer setIsExamActive={setIsExamActive} />} />
                            <Route path="/mealmap/*" element={<MealMap />} />
                            <Route path="/mypage" element={<MyPage />} />
                            <Route path="/wrong" element={<WrongPractice />} />
                            <Route path="/wrong/:wrongTab" element={<WrongPractice />} />
                            <Route path="/fortune" element={<Fortune />} />
                            <Route path="/faq" element={<FAQ />} />
                            <Route path="/change-pw" element={<ChangePW />} />
                            <Route path="/board/*" element={<Board />} />
                            {/*  [관리자 Step1 라우트]
                                관리자 본기능은 /admin 하위 라우트에서 탭 단위로 연결한다. */}
                            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/admin/user-ranking/:targetUserId" element={<AdminUserRanking />} />
                            <Route path="/admin/:adminTab" element={<Admin />} />
                        </Routes>
                    </Suspense>
                </main>
            </div>
        </div>
    );
}

export default App;
