// 홈 라우트 페이지 컴포넌트입니다.
import React, { useEffect } from 'react';
import axios from 'axios';
import useScreenSettings, { resolveWgsAssetUrl } from '../useScreenSettings';
import HomeHero from '../features/home/HomeHero.jsx';

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

    const homeWelcomePrefix = getHomeScreenSetting('hero.welcome_prefix', '');
    const homeWelcomeSuffix = getHomeScreenSetting('hero.welcome_suffix', '님, 환영합니다!');
    const homeDdayPrefix = getHomeScreenSetting('hero.dday_prefix', '시험일까지');
    const homeDdaySuffix = getHomeScreenSetting('hero.dday_suffix', '!');
    const homeDefaultBanner = resolveWgsAssetUrl(getHomeScreenSetting('image.default_banner', ''));

    const loggedInUser = sessionStorage.getItem('userName');
    const dDay = sessionStorage.getItem('dDay');

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

    const calcDday = () => {
        if (!dDay) return null;
        const diff = new Date(dDay).getTime() - new Date().getTime();
        const days = Math.ceil(diff / (1000 * 3600 * 24));
        return days >0 ? `D-${days}` : days === 0 ? "D-Day" : `D+${Math.abs(days)}`;
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

        </div>
    );
};

export default Home;
