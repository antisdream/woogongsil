// 로그인 라우트 페이지 컴포넌트입니다.
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Signup from './Signup';
import FindAuth from './FindAuth';
import HCaptchaBox from '../components/HCaptchaBox';
import { guardMissingHcaptcha } from '../hcaptchaGuard';
import useScreenSettings from '../useScreenSettings';

const API_BASE = '';

// 로그인 화면 구성
// 역할:
// 1. 기존 Home.jsx 안에 있던 로그인 박스를 /login 전용 페이지로 분리합니다.
// 2. 기존 로그인 API, 중복 로그인 확인, 5회 실패 잠금, 세션 저장 로직은 그대로 사용합니다.
// 3. 회원가입과 ID/PW 찾기는 기존 컴포넌트를 탭 안에서 재사용해 기능 로직을 보존합니다.
// 4. 로그인 성공 후에는 홈(/)으로 이동해 기존 홈/랭킹/실시간 패널 흐름을 그대로 이어간다.

const REMEMBERED_LOGIN_KEY = 'wgsRememberedLoggedIn';
const SERVER_INSTANCE_ID_KEY = 'wgsServerInstanceId';
const CHAT_VISIBLE_SINCE_KEY = 'wgsChatVisibleSince';
const getNowMs = () => Date.now();

const LOGIN_TAB_KEYS = ['login', 'signup', 'find'];

const Login = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { getSetting } = useScreenSettings('login');
    const formatSetting = (key, fallback, values = {}) => {
        let text = getSetting(key, fallback);
        Object.entries(values).forEach(([name, value]) => {
            text = text.replaceAll(`{${name}}`, String(value));
        });
        return text;
    };

    const loginTabs = [
        { key: 'login', label: getSetting('tabs.login_label', '로그인') },
        { key: 'signup', label: getSetting('tabs.signup_label', '회원가입') },
        { key: 'find', label: getSetting('tabs.find_label', 'ID/PW 찾기') }
    ];

    // URL 쿼리값이 있으면 해당 탭으로 열고, 없으면 로그인 탭을 기본으로 연다.
    // 예: /login?tab=signup, /login?tab=find
    const initialTab = LOGIN_TAB_KEYS.includes(searchParams.get('tab'))
        ? searchParams.get('tab')
        : 'login';

    const [activeTab, setActiveTab] = useState(initialTab);
    const [id, setId] = useState('');
    const [password, setPassword] = useState('');
    const [showLoginPw, setShowLoginPw] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [hcaptchaToken, setHcaptchaToken] = useState('');
    const [hcaptchaEnabled, setHcaptchaEnabled] = useState(false);
    const [hcaptchaResetKey, setHcaptchaResetKey] = useState(0);

    useEffect(() => {
        const alreadyLoggedIn = Boolean(sessionStorage.getItem('userId') && sessionStorage.getItem('sessionToken'));
        if (alreadyLoggedIn) {
            navigate('/', { replace: true });
        }
    }, [navigate]);

    const changeTab = (nextTab) => {
        setActiveTab(nextTab);
        setSearchParams(nextTab === 'login'? {} : { tab: nextTab });
    };

    const handleLogin = async (force = false) => {
        const trimmedId = id.trim();

        if (!trimmedId) return alert(getSetting('messages.need_id', '아이디를 입력해주세요.'));
        if (!password) return alert(getSetting('messages.need_password', '비밀번호를 입력해주세요.'));
        if (!force && !guardMissingHcaptcha('login', hcaptchaEnabled, hcaptchaToken)) return;

        const loginStatus = JSON.parse(localStorage.getItem('loginStatus') || '{}');
        const idStatus = loginStatus[trimmedId] || { fails: 0, lockoutUntil: null };

        const nowMs = getNowMs();
        if (idStatus.lockoutUntil && nowMs < idStatus.lockoutUntil) {
            const remaining = Math.ceil((idStatus.lockoutUntil - nowMs) / 1000);
            return alert(formatSetting('messages.locked', '해당 아이디({id})는 차단되었습니다. {seconds}초 후 시도하세요.', { id: trimmedId, seconds: remaining }));
        }

        setIsLoggingIn(true);

        try {
            const clientSessionToken = sessionStorage.getItem('sessionToken');
            const res = await axios.post(`${API_BASE}/api/login`, {
                id: trimmedId,
                password,
                force,
                clientSessionToken,
                hcaptchaToken
            });

            if (res.data.success === false) {
                if (res.data.errorType === 'approval_pending' || res.data.errorType === 'signup_rejected') {
                    alert(res.data.msg || '회원가입 승인 상태를 확인해주세요.');
                    return;
                }

                if (res.data.requireConfirm) {
                    if (window.confirm(res.data.msg)) {
                        setIsLoggingIn(false);
                        return handleLogin(true);
                    }
                } else {
                    idStatus.fails += 1;
                    if (idStatus.fails >= 5) {
                        idStatus.lockoutUntil = getNowMs() + 120 * 1000;
                        idStatus.fails = 0;
                        loginStatus[trimmedId] = idStatus;
                        localStorage.setItem('loginStatus', JSON.stringify(loginStatus));
                        alert(getSetting('messages.lockout_started', '5회 실패로 2분간 차단됩니다.'));
                    } else {
                        loginStatus[trimmedId] = idStatus;
                        localStorage.setItem('loginStatus', JSON.stringify(loginStatus));
                        alert(formatSetting('messages.login_failed_count', '로그인 실패 [{count}/5]', { count: idStatus.fails }));
                    }
                }
                return;
            }

            // 로그인 성공 세션 저장 블록입니다.
            // 기존 Home.jsx 로그인 박스에서 사용하던 key 이름을 그대로 유지합니다.
            delete loginStatus[trimmedId];
            localStorage.setItem('loginStatus', JSON.stringify(loginStatus));
            sessionStorage.setItem('userName', res.data.user.name);
            sessionStorage.setItem('userId', res.data.user.id);
            sessionStorage.setItem('isOperator', res.data.user.isOperator ? 'true' : 'false');
            sessionStorage.setItem('isPrimaryAdmin', res.data.user.isPrimaryAdmin ? 'true' : 'false');
            sessionStorage.setItem('sessionToken', res.data.sessionToken);
            sessionStorage.setItem(CHAT_VISIBLE_SINCE_KEY, String(getNowMs()));
            localStorage.setItem(REMEMBERED_LOGIN_KEY, 'true');

            if (res.data.serverInstanceId) {
                sessionStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
                localStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
            }

            if (res.data.user.dDay) {
                sessionStorage.setItem('dDay', res.data.user.dDay);
            }

            navigate('/', { replace: true });
        } catch (err) {
            alert(err.response?.data?.msg || getSetting('messages.server_failed', '서버 연결 실패'));
        } finally {
            setIsLoggingIn(false);
            if (!force) setHcaptchaResetKey((value) => value + 1);
        }
    };

    const renderLoginForm = () => (
        <div className="wgs-login-panel-body">
            <h2 className="wgs-login-title">{getSetting('form.title', '로그인')}</h2>
            <p className="wgs-login-desc">{getSetting('form.desc', '우공실 학습 기능을 이용하려면 로그인해주세요.')}</p>

            <form
                className="wgs-login-form" onSubmit={(e) => {
                    e.preventDefault();
                    handleLogin(false);
                }}
            >
                <input
                    type="text" placeholder={getSetting('form.id_placeholder', '아이디')} value={id}
                    onChange={(e) => setId(e.target.value)}
                    autoComplete="username"required
                />

                <div className="wgs-login-password-wrap">
                    <input
                        type={showLoginPw ? 'text' : 'password'}
                        placeholder={getSetting('form.password_placeholder', '비밀번호')} value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"required
                    />
                    <button type="button" onClick={() => setShowLoginPw((prev) => !prev)} title={showLoginPw ? getSetting('form.hide_password_title', '비밀번호 숨기기') : getSetting('form.show_password_title', '비밀번호 표시')}>
                        {showLoginPw ? getSetting('form.hide_password_label', '숨김') : getSetting('form.show_password_label', '보기')}
                    </button>
                </div>

                <HCaptchaBox
                    actionLabel={getSetting('form.hcaptcha_label', '로그인 보안 확인')} onTokenChange={setHcaptchaToken}
                    onEnabledChange={setHcaptchaEnabled}
                    resetKey={hcaptchaResetKey}
                />

                <button type="submit" className="wgs-login-submit" disabled={isLoggingIn}>
                    {isLoggingIn ? getSetting('form.submit_loading_label', '로그인 중...') : getSetting('form.submit_label', '로그인')}
                </button>

                {/* 상단 3개 탭이 회원가입/ID/PW 찾기 이동을 담당하므로 기존 홈 로그인 박스의 하단 중복 링크는 제거합니다. */}
            </form>
        </div>
    );

    return (
        <div className="wgs-auth-page">
            <div className="wgs-auth-hero">
                <div>
                    <span className="wgs-auth-kicker">{getSetting('hero.eyebrow', 'SKN_우공실 계정')}</span>
                    <h1>{getSetting('hero.title', '로그인 센터')}</h1>
                    <p>{getSetting('hero.desc', '로그인, 회원가입, 아이디/비밀번호 찾기를 한 페이지에서 처리합니다.')}</p>
                </div>
                {/* 상단 공통 메뉴의 홈 버튼과 겹치지 않도록 로그인 센터 내부의 별도 홈 버튼은 렌더링하지 않습니다. */}
            </div>

            <section className="wgs-auth-shell" aria-label={getSetting('a11y.auth_shell_label', '로그인 회원 기능')}>
                <div className="wgs-auth-tabs" role="tablist" aria-label={getSetting('a11y.tabs_label', '로그인 페이지 탭')}>
                    {loginTabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button" role="tab" aria-selected={activeTab === tab.key}
                            className={activeTab === tab.key ? 'is-active' : ''}
                            onClick={() => changeTab(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* 선택된 탭별로 내부 정렬과 여백을 다르게 줄 수 있도록 상태별 클래스를 추가합니다. */}
                <div className={`wgs-auth-content wgs-auth-content--${activeTab}`}>
                    {activeTab === 'login' && renderLoginForm()}
                    {activeTab === 'signup' && <Signup embedded afterSignupPath="/login" />}
                    {activeTab === 'find' && <FindAuth embedded loginPath="/login" />}
                </div>
            </section>
        </div>
    );
};

export default Login;
