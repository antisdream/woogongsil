// 홈 라우트 페이지 컴포넌트입니다.
import React, { useCallback, useState, useEffect } from 'react';
import axios from 'axios';
import useScreenSettings, { resolveWgsAssetUrl } from '../useScreenSettings';
import HomeHero from '../features/home/HomeHero.jsx';
import HomeRealtimePanel from '../features/home/HomeRealtimePanel.jsx';

const API_BASE = "";


// App.jsx와 동일한 세션/toast 키를 사용합니다.
// Home.jsx에서는 ToastContainer를 직접 갖고 있지 않으므로,
// 필요한 안내 문구를 localStorage에 저장하고 App.jsx가 새로고침 후 표시합니다.
const PENDING_LOGOUT_TOAST_KEY = 'wgsPendingLogoutToast';
const SERVER_INSTANCE_ID_KEY = 'wgsServerInstanceId';
const LOGOUT_NOTICE_MESSAGES = {
    duplicate_login: '다른 기기에서 로그인하여 현재 기기에서는 로그아웃이 되었습니다.',
    session_expired: '세션시간이 만료되어 로그아웃되었습니다, 다시 로그인해주세요.',
    server_updated: '서버가 업데이트되었습니다, 다시 로그인해주세요.'
};

const savePendingLogoutToast = (reason) => {
    const message = LOGOUT_NOTICE_MESSAGES[reason] || LOGOUT_NOTICE_MESSAGES.session_expired;
    localStorage.setItem(PENDING_LOGOUT_TOAST_KEY, JSON.stringify({
        reason,
        message,
        createdAt: Date.now()
    }));
};

const Home = () => {

    // 관리자페이지 > 화면 설정 관리에서 저장한 홈 화면 문구/배너 값을 실제 홈 화면에 반영합니다.
    const { getSetting: getHomeScreenSetting } = useScreenSettings('home');
    // 관리자 화면 설정값을 홈 접속자 영역 문구에만 연결합니다.
    const homeHeroTitle = getHomeScreenSetting('hero.hero_title', '정보처리기사 필기 · 실기');
    const homeHeroDesc = getHomeScreenSetting('hero.hero_desc', '무엇부터 풀지 막막한 날에도, 한 문제부터 시작해 보세요. 문제 풀이와 해설 확인, 오답 복습을 한곳에서 이어갈 수 있어요.');
    const homeHeroLayout = {
        titleAlign: getHomeScreenSetting('hero.title_align', 'left'),
        descAlign: getHomeScreenSetting('hero.desc_align', 'left'),
        titleOffsetX: getHomeScreenSetting('hero.title_offset_x', '0'),
        titleOffsetY: getHomeScreenSetting('hero.title_offset_y', '0'),
        descOffsetX: getHomeScreenSetting('hero.desc_offset_x', '0'),
        descOffsetY: getHomeScreenSetting('hero.desc_offset_y', '0'),
        contentWidth: getHomeScreenSetting('hero.content_width', '100%'),
    };
    const onlineSectionTitle = getHomeScreenSetting('online_users.section_title', '함께 공부하는 사람들');
    const onlineSectionDesc = getHomeScreenSetting('online_users.section_desc', '새로고침을 눌러 지금 함께 공부하는 접속자를 확인해 보세요.');
    const onlineVisitorsTitle = getHomeScreenSetting('online_users.visitors_title', '접속자 목록');
    const onlineRefreshButtonLabel = getHomeScreenSetting('online_users.refresh_button_label', '새로고침');
    const onlineVisitorsRequestEmpty = getHomeScreenSetting('online_users.visitors_request_empty', '요청 시간: 아직 없음');
    const onlineVisitorsRecentDesc = getHomeScreenSetting('online_users.visitors_recent_desc', '최근 1분 이내 접속이 확인된 사용자만 표시됩니다.');
    const onlineVisitorsEmptyBox = getHomeScreenSetting('online_users.visitors_empty_box', '새로고침 버튼을 누르면 현재 접속자를 확인할 수 있습니다.');

    const homeWelcomePrefix = getHomeScreenSetting('hero.welcome_prefix', '');
    const homeWelcomeSuffix = getHomeScreenSetting('hero.welcome_suffix', '님, 환영합니다!');
    const homeDdayPrefix = getHomeScreenSetting('hero.dday_prefix', '시험일까지');
    const homeDdaySuffix = getHomeScreenSetting('hero.dday_suffix', '!');
    const onlineCurrentVisitorPrefix = getHomeScreenSetting('online_users.current_visitor_prefix', '현재');
    const onlineCurrentVisitorSuffix = getHomeScreenSetting('online_users.current_visitor_suffix', '명');
    const onlineRefreshLoadingLabel = getHomeScreenSetting('online_users.refresh_loading_label', '새로고침 중...');
    const onlineRequestTimeLabel = getHomeScreenSetting('online_users.request_time_label', '요청 시간:');
    const onlineMeLabel = getHomeScreenSetting('online_users.me_label', '(나)');
    const onlineRecentActivityLabel = getHomeScreenSetting('online_users.recent_activity_label', '최근 활동');
    const onlineJustNowLabel = getHomeScreenSetting('online_users.just_now_label', '방금 전');
    const homeDefaultBanner = resolveWgsAssetUrl(getHomeScreenSetting('image.default_banner', ''));

    const loggedInUser = sessionStorage.getItem('userName');
    const dDay = sessionStorage.getItem('dDay');

    // 홈 화면에 표시할 실시간 접속자 목록입니다.
    // 기존에는 10초마다 자동으로 새로고침했지만,
    // 이제는 사용자가 [새로고침] 버튼을 눌렀을 때만 서버에 현재 접속자 정보를 요청합니다.
    // 이렇게 하면 화면이 갑자기 바뀌지 않아 가독성이 좋아지고, 서버 요청도 줄일 수 있습니다.
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [isOnlineUsersLoading, setIsOnlineUsersLoading] = useState(false);
    const [onlineUsersLastRefreshedAt, setOnlineUsersLastRefreshedAt] = useState('');
    const [onlineUsersError, setOnlineUsersError] = useState('');

    useEffect(() => {
        const checkSession = async () => {
            const userId = sessionStorage.getItem('userId');
            const token = sessionStorage.getItem('sessionToken');
            const serverInstanceId = sessionStorage.getItem(SERVER_INSTANCE_ID_KEY) || localStorage.getItem(SERVER_INSTANCE_ID_KEY) || '';

            if (userId && token) {
                try {
                    const res = await axios.post(`${API_BASE}/api/check-session`, {
                        id: userId,
                        sessionToken: token,
                        serverInstanceId
                    });

                    if (res.data.serverInstanceId) {
                        sessionStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
                        localStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
                    }

                    if (!res.data.valid) {
                        // 기존에는 조용히 sessionStorage만 지우고 새로고침해서 사용자가 이유를 몰랐다.
                        // 이제는 사유를 저장해 App.jsx가 새로고침 후 toast로 안내합니다.
                        savePendingLogoutToast(res.data.reason || 'session_expired');
                        sessionStorage.clear();
                        window.location.reload();
                    }
                } catch (e) {
                    console.error("세션 체크 실패");
                }
            }
        };

        checkSession();
    }, []);

    // 새로고침 버튼 옆에 보여줄 현재 시간 문자열입니다.
    // 사용자가 언제 접속자 목록을 갱신했는지 한눈에 확인할 수 있도록
    // YYYY-MM-DD HH:mm:ss 형식으로 직접 조합합니다.
    const formatLocalDateTime = useCallback((date = new Date()) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');

        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }, []);

    // 실시간 접속자 수동 새로고침 함수입니다.
    // 이전 세션/로그인 검증 방식은 그대로 사용하고,
    // 자동 주기 호출만 제거해서 사용자가 버튼을 눌렀을 때만 서버에 요청합니다.
    const refreshOnlineUsers = async () => {
        const userId = sessionStorage.getItem('userId');
        const token = sessionStorage.getItem('sessionToken');
        const serverInstanceId = sessionStorage.getItem(SERVER_INSTANCE_ID_KEY) || localStorage.getItem(SERVER_INSTANCE_ID_KEY) || '';

        if (!loggedInUser || !userId || !token) {
            setOnlineUsers([]);
            setOnlineUsersLastRefreshedAt('');
            setOnlineUsersError('로그인 후 실시간 접속자를 확인할 수 있습니다.');
            return;
        }

        setIsOnlineUsersLoading(true);
        setOnlineUsersError('');

        try {
            const res = await axios.post(`${API_BASE}/api/online-users`, {
                id: userId,
                sessionToken: token,
                serverInstanceId
            });

            if (res.data.serverInstanceId) {
                sessionStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
                localStorage.setItem(SERVER_INSTANCE_ID_KEY, res.data.serverInstanceId);
            }

            if (res.data.valid === false) {
                savePendingLogoutToast(res.data.reason || 'session_expired');
                sessionStorage.clear();
                window.location.reload();
                return;
            }

            if (res.data.success) {
                setOnlineUsers(Array.isArray(res.data.users) ? res.data.users : []);
                setOnlineUsersLastRefreshedAt(formatLocalDateTime());
            } else {
                setOnlineUsers([]);
                setOnlineUsersLastRefreshedAt(formatLocalDateTime());
                setOnlineUsersError(res.data.msg || '실시간 접속자 정보를 불러오지 못했습니다.');
            }
        } catch (err) {
            // 실시간 접속자 패널은 부가 기능입니다.
            // 그래서 이 요청이 실패해도 홈 화면과 로그인 등 기존 기능은 절대 막지 않습니다.
            setOnlineUsers([]);
            setOnlineUsersLastRefreshedAt(formatLocalDateTime());
            setOnlineUsersError('서버 연결 문제로 접속자 정보를 불러오지 못했습니다.');
        } finally {
            setIsOnlineUsersLoading(false);
        }
    };

    const calcDday = () => {
        if (!dDay) return null;
        const diff = new Date(dDay).getTime() - new Date().getTime();
        const days = Math.ceil(diff / (1000 * 3600 * 24));
        return days >0 ? `D-${days}` : days === 0 ? "D-Day" : `D+${Math.abs(days)}`;
    };

    const formatOnlineTime = (value) => {
        if (!value) return onlineJustNowLabel;

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return onlineJustNowLabel;

        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    };

    return (
        <div
            className="home-page wgs-typography-scope ui-home-page" style={{ width: '100%', maxWidth: '1280px', margin: '0 auto', boxSizing: 'border-box' }}
        >
            <HomeHero
                homeDefaultBanner={homeDefaultBanner}
                homeHeroTitle={homeHeroTitle}
                homeHeroDesc={homeHeroDesc}
                loggedInUser={loggedInUser}
                dDay={dDay}
                calcDday={calcDday}
                homeWelcomePrefix={homeWelcomePrefix}
                homeWelcomeSuffix={homeWelcomeSuffix}
                homeDdayPrefix={homeDdayPrefix}
                homeDdaySuffix={homeDdaySuffix}
                homeHeroLayout={homeHeroLayout}
            />

            <div className="ui-home-community" style={{ display: 'flex', flexDirection: 'column', gap: '30px', marginBottom: '30px' }}>
                <HomeRealtimePanel
                    loggedInUser={loggedInUser}
                    onlineSectionTitle={onlineSectionTitle}
                    onlineSectionDesc={onlineSectionDesc}
                    onlineCurrentVisitorPrefix={onlineCurrentVisitorPrefix}
                    onlineCurrentVisitorSuffix={onlineCurrentVisitorSuffix}
                    onlineUsers={onlineUsers}
                    onlineVisitorsTitle={onlineVisitorsTitle}
                    isOnlineUsersLoading={isOnlineUsersLoading}
                    refreshOnlineUsers={refreshOnlineUsers}
                    onlineRefreshLoadingLabel={onlineRefreshLoadingLabel}
                    onlineRefreshButtonLabel={onlineRefreshButtonLabel}
                    onlineUsersLastRefreshedAt={onlineUsersLastRefreshedAt}
                    onlineRequestTimeLabel={onlineRequestTimeLabel}
                    onlineVisitorsRequestEmpty={onlineVisitorsRequestEmpty}
                    onlineVisitorsRecentDesc={onlineVisitorsRecentDesc}
                    onlineUsersError={onlineUsersError}
                    onlineVisitorsEmptyBox={onlineVisitorsEmptyBox}
                    onlineMeLabel={onlineMeLabel}
                    onlineRecentActivityLabel={onlineRecentActivityLabel}
                    formatOnlineTime={formatOnlineTime}
                />
            </div>
        </div>
    );
};

export default Home;
