import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Admin from '../pages/Admin.jsx';
import AdminUserRanking from '../pages/AdminUserRanking.jsx';
import AdminLogin from './AdminLogin.jsx';
import { clearAdminSession, fetchAdminSession, getCurrentAdmin, logoutAdmin } from './adminSession.js';

const ADMIN_THEME_STORAGE_KEY = 'wgsAdminThemeMode';

const getInitialAdminTheme = () => {
  try {
    return window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

function AdminThemeToggle({ themeMode, onChange }) {
  return (
    <div className="wgs-admin-theme-toggle" role="group" aria-label="관리자 화면 테마">
      <button
        type="button"
        className={themeMode === 'light' ? 'is-active' : ''}
        onClick={() => onChange('light')}
        aria-pressed={themeMode === 'light'}
      >
        <span aria-hidden="true">☀</span>
        라이트
      </button>
      <button
        type="button"
        className={themeMode === 'dark' ? 'is-active' : ''}
        onClick={() => onChange('dark')}
        aria-pressed={themeMode === 'dark'}
      >
        <span aria-hidden="true">☾</span>
        다크
      </button>
    </div>
  );
}

export default function AdminApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking');
  const [admin, setAdmin] = useState(() => getCurrentAdmin());
  const [logoutError, setLogoutError] = useState('');
  const [themeMode, setThemeMode] = useState(getInitialAdminTheme);

  useLayoutEffect(() => {
    const isDark = themeMode === 'dark';
    const targets = [document.documentElement, document.body];

    targets.forEach((target) => {
      target.classList.toggle('wgs-theme-light', !isDark);
      target.classList.toggle('wgs-theme-dark', isDark);
      target.setAttribute('data-wgs-theme', themeMode);
    });
    document.documentElement.style.colorScheme = themeMode;

    try {
      window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, themeMode);
    } catch {
      // Storage can be unavailable in hardened browser modes; the active session still keeps the theme.
    }
  }, [themeMode]);

  const refreshSession = useCallback(async () => {
    try {
      const verifiedAdmin = await fetchAdminSession();
      setAdmin(verifiedAdmin);
      setStatus(verifiedAdmin ? 'authenticated' : 'anonymous');
      return verifiedAdmin;
    } catch (error) {
      console.error('[admin] session check failed:', error);
      clearAdminSession();
      setAdmin(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    const timer = window.setInterval(refreshSession, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSession, status]);

  const handleAuthenticated = useCallback((nextAdmin) => {
    setAdmin(nextAdmin);
    setStatus('authenticated');
    navigate('/manage/dashboard', { replace: true });
  }, [navigate]);

  const handleLogout = useCallback(async () => {
    setLogoutError('');
    const result = await logoutAdmin();
    if (!result.reachedServer) {
      setLogoutError(result.message || '관리자 로그아웃 서버에 연결하지 못했습니다. 다시 시도해주세요.');
      return;
    }
    if (!result.ok) {
      console.warn('[admin] server-side session revocation may be incomplete:', result.message);
    }
    setAdmin(null);
    setStatus('anonymous');
    navigate('/manage/login', {
      replace: true,
      state: result.ok ? null : {
        logoutMessage: '브라우저의 관리자 쿠키는 삭제했지만 서버 세션 폐기 결과를 확인하지 못했습니다.',
      },
    });
  }, [navigate]);

  if (status === 'checking') {
    return (
      <div className="wgs-admin-session-loading">
        <div className="wgs-admin-theme-corner">
          <AdminThemeToggle themeMode={themeMode} onChange={setThemeMode} />
        </div>
        <p>관리자 세션을 확인하고 있습니다.</p>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return (
      <div className="wgs-admin-public-shell">
        <div className="wgs-admin-theme-corner">
          <AdminThemeToggle themeMode={themeMode} onChange={setThemeMode} />
        </div>
        <Routes>
          <Route
            path="/manage/login"
            element={(
              <AdminLogin
                onAuthenticated={handleAuthenticated}
                initialMessage={String(location.state?.logoutMessage || '')}
                themeMode={themeMode}
              />
            )}
          />
          <Route path="*" element={<Navigate to="/manage/login" replace state={{ from: location.pathname }} />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="wgs-admin-root">
      <div className="wgs-admin-session-bar">
        <span className="wgs-admin-session-identity">{admin?.name || admin?.id} 관리자 세션</span>
        <div className="wgs-admin-session-actions">
          <AdminThemeToggle themeMode={themeMode} onChange={setThemeMode} />
          <button className="wgs-admin-logout-button" type="button" onClick={handleLogout}>관리자 로그아웃</button>
        </div>
        {logoutError && <span role="alert">{logoutError}</span>}
      </div>
      <Routes>
        <Route path="/manage" element={<Navigate to="/manage/dashboard" replace />} />
        <Route path="/manage/login" element={<Navigate to="/manage/dashboard" replace />} />
        <Route path="/manage/user-ranking/:targetUserId" element={<AdminUserRanking />} />
        <Route path="/manage/:adminTab" element={<Admin />} />
        <Route path="*" element={<Navigate to="/manage/dashboard" replace />} />
      </Routes>
    </div>
  );
}
