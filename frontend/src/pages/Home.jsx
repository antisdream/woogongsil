// 홈 라우트 페이지 컴포넌트입니다.
import React, { useCallback, useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import useScreenSettings, { resolveWgsAssetUrl } from '../useScreenSettings';
import RealCalendar from '../features/home/RealCalendar.jsx';
import HomeChatPanel from '../features/home/HomeChatPanel.jsx';
import HomeHero from '../features/home/HomeHero.jsx';
import HomeQrModal from '../features/home/HomeQrModal.jsx';
import HomeRankingSection from '../features/home/HomeRankingSection.jsx';
import HomeRealtimePanel from '../features/home/HomeRealtimePanel.jsx';
import { getKstTodayString, normalizeScheduleToCalendarEvent } from '../features/home/calendarUtils.js';
import { buildMobileAccessUrl, buildQrImageUrls, normalizeQuickLinkUrl } from '../features/home/homeLinks.js';
import { getHomeRankingLabel, normalizeExamCatalogList } from '../features/home/homeRankingUtils.js';
import { openChatPopupWindow as openHomeChatPopupWindow } from '../features/home/openChatPopupWindow.js';
import '../styles/global/home-realtime.css';

const API_BASE = "";
const DEFAULT_NOTION_URL = 'https://app.notion.com/p/SKN-29th-328031734e3e805ba1a8d60026dcaf94?source=copy_link';
const DEFAULT_DEVELOPER_URL = 'https://blog.naver.com/andisdream';


// App.jsx와 동일한 세션/toast 키를 사용합니다.
// Home.jsx에서는 ToastContainer를 직접 갖고 있지 않으므로,
// 필요한 안내 문구를 localStorage에 저장하고 App.jsx가 새로고침 후 표시합니다.
const PENDING_LOGOUT_TOAST_KEY = 'wgsPendingLogoutToast';
const REMEMBERED_LOGIN_KEY = 'wgsRememberedLoggedIn';
const SERVER_INSTANCE_ID_KEY = 'wgsServerInstanceId';
// 현재 로그인에서 채팅을 보여주기 시작할 기준 시각입니다.
// 로그아웃하면 App.jsx의 sessionStorage.clear()로 같이 지워져서,
// 다음 로그인 때 내 화면의 채팅창만 빈 상태로 시작됩니다.
const CHAT_VISIBLE_SINCE_KEY = 'wgsChatVisibleSince';


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
    // 관리자 화면 설정값을 홈 실시간 영역 문구에만 연결합니다.
    const homeHeroTitle = getHomeScreenSetting('hero.hero_title', '정보 처리 기사');
    const homeHeroDesc = getHomeScreenSetting('hero.hero_desc', '정보처리기사 필기·실기 학습과 오답 관리를 한 화면에서 이용할 수 있습니다.');
    const homeHeroLayout = {
        titleAlign: getHomeScreenSetting('hero.title_align', 'center'),
        descAlign: getHomeScreenSetting('hero.desc_align', 'center'),
        titleOffsetX: getHomeScreenSetting('hero.title_offset_x', '0'),
        titleOffsetY: getHomeScreenSetting('hero.title_offset_y', '0'),
        descOffsetX: getHomeScreenSetting('hero.desc_offset_x', '0'),
        descOffsetY: getHomeScreenSetting('hero.desc_offset_y', '0'),
        contentWidth: getHomeScreenSetting('hero.content_width', '100%'),
    };
    const homeExamButtonLabel = getHomeScreenSetting('quick_links.exam_button_label', '시험 접수');
    const homeNotionButtonLabel = getHomeScreenSetting('quick_links.notion_button_label', 'Notion');
    const homeDeveloperButtonLabel = getHomeScreenSetting('quick_links.developer_button_label', '개발자');
    const homeMobileButtonLabel = getHomeScreenSetting('quick_links.mobile_button_label', '모바일');
    const homeExamButtonUrl = getHomeScreenSetting('quick_links.exam_button_url', 'https://www.q-net.or.kr');
    const homeNotionButtonUrl = normalizeQuickLinkUrl(
        getHomeScreenSetting('quick_links.notion_button_url', DEFAULT_NOTION_URL),
        DEFAULT_NOTION_URL
    );
    const homeDeveloperButtonUrl = normalizeQuickLinkUrl(
        getHomeScreenSetting('quick_links.developer_button_url', DEFAULT_DEVELOPER_URL),
        DEFAULT_DEVELOPER_URL
    );
    const liveChatSectionTitle = getHomeScreenSetting('live_chat.section_title', '실시간 접속자 & 채팅');
    const liveChatSectionDesc = getHomeScreenSetting('live_chat.section_desc', '접속자 목록은 새로고침 버튼을 눌렀을 때 갱신되고, 채팅은 실시간으로 로그인 중인 사용자들끼리 채팅 할 수 있습니다.');
    const liveChatVisitorsTitle = getHomeScreenSetting('live_chat.visitors_title', '접속자 목록');
    const liveChatRefreshButtonLabel = getHomeScreenSetting('live_chat.refresh_button_label', '새로고침');
    const liveChatVisitorsRequestEmpty = getHomeScreenSetting('live_chat.visitors_request_empty', '요청 시간: 아직 없음');
    const liveChatVisitorsRecentDesc = getHomeScreenSetting('live_chat.visitors_recent_desc', '최근 1분 이내 접속이 확인된 사용자만 표시됩니다.');
    const liveChatVisitorsEmptyBox = getHomeScreenSetting('live_chat.visitors_empty_box', '새로고침 버튼을 누르면 현재 접속자를 확인할 수 있습니다.');
    const liveChatChatTitle = getHomeScreenSetting('live_chat.chat_title', '실시간 채팅');
    const liveChatPopupButtonLabel = getHomeScreenSetting('live_chat.popup_button_label', '팝업창');
    const liveChatAutoLabel = getHomeScreenSetting('live_chat.chat_auto_label', '자동 갱신 시간:');
    const liveChatResetNotice = getHomeScreenSetting('live_chat.chat_reset_notice', '로그아웃 후 다시 로그인하면 내 화면의 채팅창만 빈 상태로 시작됩니다.');
    const liveChatEmptyMessage = getHomeScreenSetting('live_chat.chat_empty_message', '아직 표시할 채팅이 없습니다.');
    const liveChatInputPlaceholder = getHomeScreenSetting('live_chat.chat_input_placeholder', '채팅 내용을 입력하세요.');
    const liveChatSendButtonLabel = getHomeScreenSetting('live_chat.chat_send_button_label', '전송');

    // 홈 화면 점수/랭킹 영역 문구를 관리자페이지 화면 설정 관리에서 수정할 수 있도록 DB 설정값으로 연결합니다.
    const scoreRankingTitle = getHomeScreenSetting('score_ranking.section_title', '나의 점수는?');
    const scoreRankingAlwaysOpenLabel = getHomeScreenSetting('score_ranking.always_open_label', '항상 펼침');
    const rankingRandomTabLabel = getHomeScreenSetting('score_ranking.tab_random_label', '필기 문제은행');
    const rankingPastTabLabel = getHomeScreenSetting('score_ranking.tab_past_label', '필기 기출문제');
    const rankingIpepRandomTabLabel = getHomeScreenSetting('score_ranking.tab_ipep_random_label', '실기 문제은행');
    const rankingIpepPastTabLabel = getHomeScreenSetting('score_ranking.tab_ipep_past_label', '실기 기출문제');
    const scoreRankingYearSelectTitle = getHomeScreenSetting('score_ranking.year_select_title', '연도 선택');
    const scoreRankingSessionSelectTitle = getHomeScreenSetting('score_ranking.session_select_title', '회차 선택');
    const scoreRankingNeedSelectMessage = getHomeScreenSetting('score_ranking.need_select_message', '연도와 회차를 선택해 주세요.');
    const scoreRankingTopPrefix = getHomeScreenSetting('score_ranking.top_title_prefix', '오늘의');
    const scoreRankingTopSuffix = getHomeScreenSetting('score_ranking.top_title_suffix', 'Top 3');
    const scoreRankingSeasonText = getHomeScreenSetting('score_ranking.season_text', '24시간 랭킹 (00:00 ~ 23:59)');
    const scoreRankingNoDataMessage = getHomeScreenSetting('score_ranking.no_data_message', '등록된 랭킹 데이터가 없습니다. 순위권에 도전해보세요!');
    const scoreRankingMyRankTitle = getHomeScreenSetting('score_ranking.my_ranking_title', '나의 실시간 랭킹');
    const homeWelcomePrefix = getHomeScreenSetting('hero.welcome_prefix', '');
    const homeWelcomeSuffix = getHomeScreenSetting('hero.welcome_suffix', '님, 환영합니다!');
    const homeDdayPrefix = getHomeScreenSetting('hero.dday_prefix', '시험일까지');
    const homeDdaySuffix = getHomeScreenSetting('hero.dday_suffix', '!');
    const homeTodayClassPrefix = getHomeScreenSetting('hero.today_class_prefix', '오늘은');
    const homeTodayClassSuffix = getHomeScreenSetting('hero.today_class_suffix', '수업입니다!');
    const liveChatCurrentVisitorPrefix = getHomeScreenSetting('live_chat.current_visitor_prefix', '현재');
    const liveChatCurrentVisitorSuffix = getHomeScreenSetting('live_chat.current_visitor_suffix', '명');
    const liveChatRefreshLoadingLabel = getHomeScreenSetting('live_chat.refresh_loading_label', '새로고침 중...');
    const liveChatRequestTimeLabel = getHomeScreenSetting('live_chat.request_time_label', '요청 시간:');
    const liveChatMeLabel = getHomeScreenSetting('live_chat.me_label', '(나)');
    const liveChatRecentActivityLabel = getHomeScreenSetting('live_chat.recent_activity_label', '최근 활동');
    const liveChatJustNowLabel = getHomeScreenSetting('live_chat.just_now_label', '방금 전');
    const scoreRankingAccuracyLabel = getHomeScreenSetting('score_ranking.accuracy_label', '정답률');
    const scoreRankingRankSuffix = getHomeScreenSetting('score_ranking.rank_suffix', '등');
    const scoreRankingScoreSuffix = getHomeScreenSetting('score_ranking.score_suffix', '점');
    const scoreRankingNoPersonalMessage = getHomeScreenSetting('score_ranking.no_personal_ranking_message', '아직 응시 기록이 없습니다. 문제를 풀고 랭킹에 도전해보세요!');
    const chatPopupWindowTitle = getHomeScreenSetting('chat_popup.window_title', '우공실 실시간 채팅');
    const chatPopupHeadingTitle = getHomeScreenSetting('chat_popup.heading_title', '우공실 실시간 채팅');
    const chatPopupCloseButtonLabel = getHomeScreenSetting('chat_popup.close_button_label', '닫기');
    const chatPopupNotRefreshedLabel = getHomeScreenSetting('chat_popup.not_refreshed_label', '아직 없음');
    const chatPopupKeepNotice = getHomeScreenSetting('chat_popup.keep_notice', '이 팝업창은 사이트의 다른 페이지로 이동해도 유지됩니다. 브라우저 창처럼 위치와 크기를 조절할 수 있습니다.');
    const chatPopupLoadingMessage = getHomeScreenSetting('chat_popup.loading_message', '채팅을 불러오는 중입니다.');
    const chatPopupToolTitle = getHomeScreenSetting('chat_popup.tool_title', '이모지/스티커/GIF 열기');
    const mobileQrTitle = getHomeScreenSetting('mobile_qr.title', '모바일에서 접속하기');
    const mobileQrDesc = getHomeScreenSetting('mobile_qr.desc', 'PC와 동일한 네트워크 환경에 연결되어 있어야 합니다.');
    const mobileQrUrlLabel = getHomeScreenSetting('mobile_qr.url_label', '접속 주소:');
    const mobileQrDetectedIpLabel = getHomeScreenSetting('mobile_qr.detected_ip_label', '자동 감지 IP:');
    const mobileQrDetectingLabel = getHomeScreenSetting('mobile_qr.detecting_label', '확인 중');
    const mobileQrWifiHint = getHomeScreenSetting('mobile_qr.wifi_hint', '같은 와이파이에 연결된 휴대폰에서만 접속할 수 있습니다.');
    const mobileQrChangeLabel = getHomeScreenSetting('mobile_qr.change_label', '주소 변경:');
    const mobileQrPlaceholder = getHomeScreenSetting('mobile_qr.placeholder', '자동 감지 중');
    const calendarCopy = {
        yearSuffix: getHomeScreenSetting('calendar.year_suffix', '년'),
        monthSuffix: getHomeScreenSetting('calendar.month_suffix', '월'),
        todayLabel: getHomeScreenSetting('calendar.today_label', 'Today'),
        weekdaySun: getHomeScreenSetting('calendar.weekday_sun', '일'),
        weekdayMon: getHomeScreenSetting('calendar.weekday_mon', '월'),
        weekdayTue: getHomeScreenSetting('calendar.weekday_tue', '화'),
        weekdayWed: getHomeScreenSetting('calendar.weekday_wed', '수'),
        weekdayThu: getHomeScreenSetting('calendar.weekday_thu', '목'),
        weekdayFri: getHomeScreenSetting('calendar.weekday_fri', '금'),
        weekdaySat: getHomeScreenSetting('calendar.weekday_sat', '토'),
    };


    // 팝업창은 React JSX가 아니라 문자열 HTML이므로,
    // DB에서 가져온 문구를 HTML에 안전하게 넣기 위해 이스케이프 처리합니다.

    const homeDefaultBanner = resolveWgsAssetUrl(getHomeScreenSetting('image.default_banner', ''));

    const loggedInUser = sessionStorage.getItem('userName');
    const dDay = sessionStorage.getItem('dDay');

    const [showQR, setShowQR] = useState(false);

    // 홈 달력 일정은 DB API 응답만 사용합니다.
    const [classSchedules, setClassSchedules] = useState([]); // 달력은 DB 일정만 사용합니다.

    // 모바일 QR 접속 주소에 사용할 IP/도메인 상태값입니다.
    // 기존에는 192.168.0.4처럼 IP가 고정되어 있었기 때문에 네트워크가 바뀌면 직접 수정해야 했습니다.
    // 이제는 서버의 /api/ip 응답값을 받아서 현재 서버 컴퓨터의 LAN IP를 자동으로 넣습니다.
    const [customIp, setCustomIp] = useState(() => {
        // 이미 www.ugongsil.kro.kr 같은 도메인으로 접속했다면 그 도메인을 그대로 사용합니다.
        // 도메인 접속 중인데 굳이 내부 IP로 바꾸면 외부 접속자가 끊길 수 있기 때문입니다.
        const host = window.location.hostname;

        // localhost 또는 127.0.0.1은 휴대폰에서 접속할 수 없는 자기 자신 주소입니다.
        // 그래서 초기값을 비워두고, 아래 useEffect에서 서버 LAN IP를 받아 채웁니다.
        if (host === 'localhost' || host === '127.0.0.1') return '';

        // IP 또는 도메인으로 이미 접속한 경우에는 현재 접속 주소를 기본값으로 사용합니다.
        return host;
    });

    // 서버에서 자동 감지한 LAN IP를 표시용으로 보관합니다.
    const [detectedServerIp, setDetectedServerIp] = useState('');

    // 홈 로그인 박스를 /login 페이지로 이사했기 때문에 랭킹 영역은 항상 펼쳐 둡니다.
    // 접기/펼치기 버튼 상태값은 더 이상 필요하지 않지만, 아래 렌더링 구조는 기존 랭킹 로직을 그대로 사용합니다.
    const isRankingOpen = true;
    const [rankingTab, setRankingTab] = useState('random'); 
    const [pastYear, setPastYear] = useState(null);
    const [pastSession, setPastSession] = useState(null);
    const [rankingData, setRankingData] = useState([]);

    const [examCatalogs, setExamCatalogs] = useState({
        written: [],
        ipep_past: [],
    });

    useEffect(() => {
        let isMounted = true;

        const fetchExamCatalogs = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/exam-catalogs`);

                if (!isMounted) return;

                setExamCatalogs({
                    written: normalizeExamCatalogList(res.data?.data?.written || res.data?.written || []),
                    ipep_past: normalizeExamCatalogList(res.data?.data?.ipep_past || res.data?.ipep_past || []),
                });
            } catch (error) {
                console.error('홈 랭킹 기출 연도/회차 카탈로그 불러오기 실패:', error);
                if (!isMounted) return;
                setExamCatalogs({ written: [], ipep_past: [] });
            }
        };

        fetchExamCatalogs();

        return () => {
            isMounted = false;
        };
    }, []);

    
    const [myRankingData, setMyRankingData] = useState(null);
    // 랭킹 시즌제가 폐지되어 홈 랭킹은 서버 기준 날짜로 24시간 항상 표시합니다.

    // 홈 화면에 표시할 실시간 접속자 목록입니다.
    // 기존에는 10초마다 자동으로 새로고침했지만,
    // 이제는 사용자가 [새로고침] 버튼을 눌렀을 때만 서버에 현재 접속자 정보를 요청합니다.
    // 이렇게 하면 화면이 갑자기 바뀌지 않아 가독성이 좋아지고, 서버 요청도 줄일 수 있습니다.
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [isOnlineUsersLoading, setIsOnlineUsersLoading] = useState(false);
    const [onlineUsersLastRefreshedAt, setOnlineUsersLastRefreshedAt] = useState('');
    const [onlineUsersError, setOnlineUsersError] = useState('');

    // 실시간 채팅 화면 상태입니다.
    // 채팅은 로그인한 사용자에게만 보이며, 서버에는 메모리 기반 채팅으로 저장됩니다.
    // 내 로그아웃/재로그인 시 채팅창이 비어 보이도록 CHAT_VISIBLE_SINCE_KEY 기준 이후 메시지만 요청합니다.
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [chatError, setChatError] = useState('');
    const [chatLastRefreshedAt, setChatLastRefreshedAt] = useState('');
    // 이모지/스티커/GIF 문구 선택창 상태입니다.
    // 외부 API 없이도 채팅 입력창에 빠르게 넣을 수 있는 보조 도구입니다.
    const [chatPickerOpen, setChatPickerOpen] = useState(false);
    const [chatPickerTab, setChatPickerTab] = useState('emoji');

    useEffect(() => {
        let isMounted = true;

        const fetchClassSchedules = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/class-schedules`, {
                    headers: { 'Cache-Control': 'no-cache' },
                });
                const commonSchedules = Array.isArray(res.data?.schedules)
                    ? res.data.schedules.map(normalizeScheduleToCalendarEvent).filter(Boolean)
                    : [];
                let userSchedules = [];
                const calendarUserId = sessionStorage.getItem('userId') || '';
                const calendarSessionToken = sessionStorage.getItem('sessionToken') || '';
                const calendarServerInstanceId = sessionStorage.getItem(SERVER_INSTANCE_ID_KEY) || localStorage.getItem(SERVER_INSTANCE_ID_KEY) || '';

                if (calendarUserId && calendarSessionToken) {
                    try {
                        const userCalendarRes = await axios.get(`${API_BASE}/api/user/calendar-events`, {
                            params: {
                                id: calendarUserId,
                                sessionToken: calendarSessionToken,
                                serverInstanceId: calendarServerInstanceId,
                                active: '1',
                            },
                            headers: { 'Cache-Control': 'no-cache' },
                        });
                        userSchedules = Array.isArray(userCalendarRes.data?.schedules)
                            ? userCalendarRes.data.schedules.map(normalizeScheduleToCalendarEvent).filter(Boolean)
                            : [];
                    } catch (userCalendarError) {
                        console.warn('[home calendar] user schedules fetch failed:', userCalendarError);
                        userSchedules = [];
                    }
                }
                const nextSchedules = [...commonSchedules, ...userSchedules];

                if (isMounted) {
                    setClassSchedules(nextSchedules);
                }
            } catch (error) {
                console.error('[home calendar] DB 일정 불러오기 실패:', error);
                if (isMounted) {
                    setClassSchedules([]);
                }
            }
        };

        fetchClassSchedules();

        return () => {
            isMounted = false;
        };
    }, []);

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

    useEffect(() => {
        // 모바일 QR 주소 자동화 로직입니다.
        // 백엔드 server.js에 이미 있는 /api/ip API를 호출해서 서버 컴퓨터의 현재 LAN IP를 가져옵니다.
        // 이 코드는 실패해도 사이트 전체가 멈추지 않도록 catch에서 조용히 처리합니다.
        const fetchServerIpForMobileQr = async () => {
            try {
                const host = window.location.hostname;

                // 사용자가 도메인 또는 실제 IP로 접속 중이면 현재 주소가 가장 정확합니다.
                // 예: www.ugongsil.kro.kr, 192.168.0.15 등
                if (host !== 'localhost' && host !== '127.0.0.1') {
                    setDetectedServerIp(host);
                    setCustomIp((prev) => prev || host);
                    return;
                }

                // localhost로 개발 중일 때만 백엔드에게 LAN IP를 물어봅니다.
                const res = await axios.get(`${API_BASE}/api/ip`);
                const serverIp = String(res.data?.ip || '').trim();

                if (serverIp) {
                    setDetectedServerIp(serverIp);
                    setCustomIp((prev) => prev || serverIp);
                }
            } catch (err) {
                // QR 자동 IP 조회 실패는 핵심 기능 장애가 아니므로 홈 화면은 그대로 유지합니다.
                console.warn('모바일 QR용 서버 IP 자동 조회 실패:', err.message);
            }
        };

        fetchServerIpForMobileQr();
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
            // 그래서 이 요청이 실패해도 홈 화면, 랭킹, 로그인 등 기존 기능은 절대 막지 않습니다.
            setOnlineUsers([]);
            setOnlineUsersLastRefreshedAt(formatLocalDateTime());
            setOnlineUsersError('서버 연결 문제로 접속자 정보를 불러오지 못했습니다.');
        } finally {
            setIsOnlineUsersLoading(false);
        }
    };

    // 현재 로그인에서 채팅을 보여주기 시작할 기준 시각을 가져옵니다.
    // 값이 없으면 지금 시각으로 새로 만들기 때문에, 새 로그인 직후에는 이전 채팅이 보이지 않습니다.
    const getChatVisibleSinceMs = useCallback(() => {
        const saved = Number(sessionStorage.getItem(CHAT_VISIBLE_SINCE_KEY));

        if (Number.isFinite(saved) && saved >0) {
            return saved;
        }

        const nowMs = Date.now();
        sessionStorage.setItem(CHAT_VISIBLE_SINCE_KEY, String(nowMs));
        return nowMs;
    }, []);

    // ISO 문자열을 사용자의 브라우저 기준 시간으로 바꿉니다.
    // 채팅 출력 형식은 [연도-월-일 시:분:초 이름 : 내용]이 되도록 Home.jsx에서 조합합니다.
    const formatChatDateTime = (value) => {
        const date = value ? new Date(value) : new Date();
        return formatLocalDateTime(Number.isNaN(date.getTime()) ? new Date() : date);
    };

    // 실시간 채팅 목록을 서버에서 다시 불러옵니다.
    // 접속자 목록은 사용자가 버튼을 눌렀을 때만 갱신하지만,
    // 채팅은 실제 대화에 가깝게 보이도록 3초 간격의 짧은 폴링으로 자동 갱신합니다.
    // 그래서 화면에는 별도의 '채팅 새로고침' 버튼을 두지 않습니다.
    const refreshChatMessages = useCallback(async ({ silent = false } = {}) => {
        const userId = sessionStorage.getItem('userId');
        const token = sessionStorage.getItem('sessionToken');
        const serverInstanceId = sessionStorage.getItem(SERVER_INSTANCE_ID_KEY) || localStorage.getItem(SERVER_INSTANCE_ID_KEY) || '';

        if (!loggedInUser || !userId || !token) {
            setChatMessages([]);
            setChatLastRefreshedAt('');
            setChatError('로그인 후 실시간 채팅을 이용할 수 있습니다.');
            return;
        }

        if (!silent) setIsChatLoading(true);
        setChatError('');

        try {
            const res = await axios.post(`${API_BASE}/api/realtime-chat/list`, {
                id: userId,
                sessionToken: token,
                serverInstanceId,
                sinceMs: getChatVisibleSinceMs()
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
                setChatMessages(Array.isArray(res.data.messages) ? res.data.messages : []);
                setChatLastRefreshedAt(formatLocalDateTime());
            } else if (!silent) {
                setChatError(res.data.msg || '실시간 채팅을 불러오지 못했습니다.');
            }
        } catch (err) {
            if (!silent) setChatError('서버 연결 문제로 채팅을 불러오지 못했습니다.');
        } finally {
            if (!silent) setIsChatLoading(false);
        }
    }, [formatLocalDateTime, getChatVisibleSinceMs, loggedInUser]);

    // 채팅 전송 함수입니다.
    // 전송 성공 후 서버가 돌려준 목록으로 화면을 갱신하므로, 보낸 사람 화면에도 즉시 반영됩니다.
    const sendChatMessage = async (presetText = '') => {
        // presetText가 있으면 이모지/스티커/GIF 프리셋에서 바로 전송된 문구입니다.
        // 없으면 사용자가 직접 입력한 chatInput 값을 전송합니다.
        const text = String(presetText || chatInput).trim();
        const userId = sessionStorage.getItem('userId');
        const token = sessionStorage.getItem('sessionToken');
        const serverInstanceId = sessionStorage.getItem(SERVER_INSTANCE_ID_KEY) || localStorage.getItem(SERVER_INSTANCE_ID_KEY) || '';

        if (!text) {
            setChatError('채팅 내용을 입력해주세요.');
            return;
        }

        if (!loggedInUser || !userId || !token) {
            setChatError('로그인 후 실시간 채팅을 이용할 수 있습니다.');
            return;
        }

        setIsChatLoading(true);
        setChatError('');

        try {
            const res = await axios.post(`${API_BASE}/api/realtime-chat/send`, {
                id: userId,
                sessionToken: token,
                serverInstanceId,
                text,
                sinceMs: getChatVisibleSinceMs()
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
                setChatInput('');
                setChatPickerOpen(false);
                setChatMessages(Array.isArray(res.data.messages) ? res.data.messages : []);
                setChatLastRefreshedAt(formatLocalDateTime());
            } else {
                setChatError(res.data.msg || '채팅 전송에 실패했습니다.');
            }
        } catch (err) {
            setChatError('서버 연결 문제로 채팅을 전송하지 못했습니다.');
        } finally {
            setIsChatLoading(false);
        }
    };

    useEffect(() => {
        if (!loggedInUser) {
            // 로그아웃 상태가 되면 이전 접속자/채팅 화면 정보를 모두 지웁니다.
            // 실제 전체 채팅방 서버 기록은 삭제하지 않고, 현재 브라우저 화면만 비웁니다.
            setOnlineUsers([]);
            setOnlineUsersLastRefreshedAt('');
            setOnlineUsersError('');
            setIsOnlineUsersLoading(false);
            setChatMessages([]);
            setChatInput('');
            setChatError('');
            setChatLastRefreshedAt('');
            setIsChatLoading(false);
            return;
        }

        getChatVisibleSinceMs();
        refreshChatMessages({ silent: true });

        // 채팅만 3초마다 가볍게 갱신합니다.
        // 접속자 목록은 이전 요청대로 자동 새로고침하지 않고 버튼을 누를 때만 갱신합니다.
        const chatTimer = setInterval(() => {
            refreshChatMessages({ silent: true });
        }, 3000);

        return () => clearInterval(chatTimer);
    }, [getChatVisibleSinceMs, loggedInUser, refreshChatMessages]);

    useEffect(() => {
        if (!isRankingOpen) return;

        const fetchRankingData = async () => {
            try {
                if ((rankingTab === 'past' || rankingTab === 'ipep_past') && (!pastYear || !pastSession)) {
                    setRankingData([]);
                    setMyRankingData(null); 
                    return;
                }

                const params = new URLSearchParams({ type: rankingTab });
                if (rankingTab === 'past' || rankingTab === 'ipep_past') {
                    // 실기 기출 랭킹도 필기 기출 랭킹처럼 연도/회차로 구분합니다.
                    if (pastYear) params.append('year', pastYear);
                    if (pastSession) params.append('session', pastSession);
                }

                const res = await axios.get(`${API_BASE}/api/rankings?${params.toString()}`);
                // 랭킹 시즌제가 폐지되어 서버 기준 날짜로 24시간 랭킹이 동작합니다.
                const rawRankings = res.data.rankings || [];
                
                // - 필기 랭킹은 기존 solved_count/total_count 기반 흐름을 유지합니다.
                // - 실기 문제은행/실기 기출문제는 score(점수)와 correct/total(정답률 표기용)을 분리합니다.
                // - 이전처럼 실기 분모를 100점으로 강제하지 않고, 백엔드가 내려주는 correctCount/totalCount를 우선 사용합니다.
                const processedData = rawRankings.map(user => {
                    const isIpepRanking = rankingTab === 'ipep_random' || rankingTab === 'ipep_past';
                    const rawScore = Number(user.score ?? user.points ?? user.point ?? 0);

                    const ipepTotal = Number(
                        user.totalCount ??
                        user.total_count ??
                        user.questionCount ??
                        user.question_count ??
                        user.solvedCount ??
                        user.solved_count ??
                        user.problemCount ??
                        user.problem_count ??
                        0
                    );
                    const ipepCorrect = Number(
                        user.correctCount ??
                        user.correct_count ??
                        user.correctAnswers ??
                        user.correct_answers ??
                        user.correct ??
                        0
                    );

                    const writtenTotal = Number(user.total ?? user.totalCount ?? user.total_count ?? user.solved_count ?? 0);
                    const writtenCorrect = Number(user.correct ?? user.correct_count ?? user.correctCount ?? 0);

                    const total = isIpepRanking ? ipepTotal : writtenTotal;
                    const correct = isIpepRanking ? ipepCorrect : writtenCorrect;
                    const score = isIpepRanking ? rawScore : (rankingTab === 'random'? (correct * 5) : correct);
                    const accuracy = total >0 ? Math.round((correct / total) * 100) : Number(user.accuracy ?? 0);

                    return {
                        ...user,
                        id: user.id || user.userId,
                        name: user.name || user.userName,
                        score,
                        accuracy: Number.isFinite(accuracy) ? accuracy : 0,
                        total: Number.isFinite(total) ? total : 0,
                        correct: Number.isFinite(correct) ? correct : 0,
                    };
                });

                //  프론트엔드에서 계산된 정확한 점수로 신뢰도 100% 재정렬 보장
                processedData.sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || b.correct - a.correct);
                
                // 재정렬 후 1, 2, 3등 랭크 다시 부여
                processedData.forEach((u, index) => u.rank = index + 1);

                setRankingData(processedData.slice(0, 3)); 

                const currentUserId = sessionStorage.getItem('userId');
                const meIndex = processedData.findIndex(u => String(u.id || u.userId) === String(currentUserId));
                if (meIndex !== -1) {
                    setMyRankingData(processedData[meIndex]); 
                } else {
                    setMyRankingData(null);
                }

            } catch (err) {
                console.error("랭킹 데이터 불러오기 실패:", err);
                setRankingData([]); 
                setMyRankingData(null);
            }
        };

        fetchRankingData();
        const timer = setInterval(fetchRankingData, 10000); 
        return () => clearInterval(timer);
    }, [isRankingOpen, rankingTab, pastYear, pastSession]);

    const isPastRankingTab = rankingTab === 'past' || rankingTab === 'ipep_past';
    const canShowChart = rankingTab === 'random' || rankingTab === 'ipep_random' || (isPastRankingTab && pastYear && pastSession);
    // 랭킹 탭 표시명을 한 곳에서 관리해서 필기/실기 구분 문구가 흔들리지 않게 합니다.
    const rankingLabel = getHomeRankingLabel(rankingTab, {
        random: rankingRandomTabLabel,
        past: rankingPastTabLabel,
        ipepRandom: rankingIpepRandomTabLabel,
        ipepPast: rankingIpepPastTabLabel,
    });
    // - 필기/실기 기출 랭킹 필터는 더 이상 2021~2025, 1~3회차를 하드코딩하지 않습니다.
    // - 서버 DB 카탈로그에 존재하는 연도/회차만 체크박스로 표시합니다.
    const activePastCatalog = rankingTab === 'ipep_past'? examCatalogs.ipep_past : examCatalogs.written;
    const pastYearOptions = activePastCatalog.map((item) => item.year);
    const selectedPastYearCatalog = activePastCatalog.find((item) => String(item.year) === String(pastYear));
    const pastSessionOptions = selectedPastYearCatalog?.sessions || [];
    const seasonText = scoreRankingSeasonText;
    
    const todayStr = getKstTodayString();
    // 홈 상단의 '오늘 수업' 안내는 종류가 '수업'인 일정만 표시합니다.
    // 공휴일/시험일/개인 일정이 수업 문구로 잘못 노출되는 것을 방지합니다.
    const todayClass = classSchedules.find(s => {
        const type = String(s.scheduleType || s.type || s.category || '').trim();
        return s.date === todayStr && type === 'class';
    });

    // 로그인 기능은 Home.jsx에서 제거하고 /login 전용 페이지(Login.jsx)로 이동했습니다.
    // 홈 화면은 배너, 실시간 패널, 랭킹, 캘린더만 담당합니다.

    const calcDday = () => {
        if (!dDay) return null;
        const diff = new Date(dDay).getTime() - new Date().getTime();
        const days = Math.ceil(diff / (1000 * 3600 * 24));
        return days >0 ? `D-${days}` : days === 0 ? "D-Day" : `D+${Math.abs(days)}`;
    };

    const protocol = window.location.protocol;
    const port = window.location.port ? `:${window.location.port}` : '';

    // QR 주소를 만들 때 사용할 최종 host입니다.
    // 1순위: 사용자가 직접 입력한 customIp
    // 2순위: 서버에서 자동 감지한 LAN IP
    // 3순위: 현재 브라우저의 hostname
    const mobileHost = customIp || detectedServerIp || window.location.hostname;

    // 모바일에서 접속할 주소입니다.
    // 개발 PC가 localhost로 접속 중이어도 QR에는 localhost가 아니라 LAN IP가 들어가도록 처리했습니다.
    const currentUrl = buildMobileAccessUrl({
        protocol,
        hostValue: mobileHost,
        fallbackHost: window.location.hostname,
        port,
    });
    const qrUrl = useMemo(() => buildQrImageUrls(currentUrl, API_BASE), [currentUrl]);


    // 정답률 표기 유틸
    // - total이 있으면 정답률 60% (3/5)처럼 보여주고,
    // - 과거 데이터처럼 total이 비어 있으면 화면 깨짐을 막기 위해 퍼센트만 보여줍니다.
    const formatAccuracyText = (item) => {
        const total = Number(item?.total ?? 0);
        const correct = Number(item?.correct ?? 0);
        const accuracy = Number(item?.accuracy ?? 0);
        return total >0 ? `${scoreRankingAccuracyLabel} ${accuracy}% (${correct}/${total})` : `${scoreRankingAccuracyLabel} ${accuracy}%`;
    };

    const formatOnlineTime = (value) => {
        if (!value) return liveChatJustNowLabel;

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return liveChatJustNowLabel;

        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    };

    // 이모지/스티커/GIF 프리셋을 채팅 입력창 뒤에 붙입니다.
    // 프리셋을 누르는 즉시 전송하지 않고 입력창에 넣어두면,
    // 사용자가 문구를 수정하거나 일반 텍스트와 섞어서 보낼 수 있습니다.
    // 또한 브라우저 창 자체가 이동/크기 조절을 지원하므로 별도 드래그 라이브러리를 추가하지 않아도 됩니다.
    const openChatPopupWindow = () => openHomeChatPopupWindow({
        loggedInUser,
        setChatError,
        getChatVisibleSinceMs,
        apiBase: API_BASE,
        serverInstanceIdKey: SERVER_INSTANCE_ID_KEY,
        chatCopy: {
            liveChatAutoLabel,
            liveChatInputPlaceholder,
            liveChatSendButtonLabel,
            liveChatEmptyMessage,
            chatPopupWindowTitle,
            chatPopupHeadingTitle,
            chatPopupCloseButtonLabel,
            chatPopupNotRefreshedLabel,
            chatPopupKeepNotice,
            chatPopupLoadingMessage,
            chatPopupToolTitle,
        },
    });

    // 실시간 채팅 카드입니다.
    // 채팅은 3초마다 자동 갱신되므로 별도 새로고침 버튼을 제거했습니다.
    return (
        <div
            className="home-page wgs-typography-scope" style={{ width: '100%', maxWidth: '1000px', margin: '0 auto', boxSizing: 'border-box' }}
        >
            <HomeQrModal
                open={showQR}
                onClose={() => setShowQR(false)}
                qrUrl={qrUrl}
                currentUrl={currentUrl}
                detectedServerIp={detectedServerIp}
                customIp={customIp}
                setCustomIp={setCustomIp}
                mobileQrTitle={mobileQrTitle}
                mobileQrDesc={mobileQrDesc}
                mobileQrUrlLabel={mobileQrUrlLabel}
                mobileQrDetectedIpLabel={mobileQrDetectedIpLabel}
                mobileQrDetectingLabel={mobileQrDetectingLabel}
                mobileQrWifiHint={mobileQrWifiHint}
                mobileQrChangeLabel={mobileQrChangeLabel}
                mobileQrPlaceholder={mobileQrPlaceholder}
            />

            <HomeHero
                homeDefaultBanner={homeDefaultBanner}
                homeHeroTitle={homeHeroTitle}
                homeHeroDesc={homeHeroDesc}
                loggedInUser={loggedInUser}
                dDay={dDay}
                todayClass={todayClass}
                calcDday={calcDday}
                homeWelcomePrefix={homeWelcomePrefix}
                homeWelcomeSuffix={homeWelcomeSuffix}
                homeDdayPrefix={homeDdayPrefix}
                homeDdaySuffix={homeDdaySuffix}
                homeTodayClassPrefix={homeTodayClassPrefix}
                homeTodayClassSuffix={homeTodayClassSuffix}
                homeExamButtonUrl={homeExamButtonUrl}
                homeExamButtonLabel={homeExamButtonLabel}
                homeNotionButtonUrl={homeNotionButtonUrl}
                homeNotionButtonLabel={homeNotionButtonLabel}
                homeDeveloperButtonUrl={homeDeveloperButtonUrl}
                homeDeveloperButtonLabel={homeDeveloperButtonLabel}
                homeMobileButtonLabel={homeMobileButtonLabel}
                homeHeroLayout={homeHeroLayout}
                onShowQr={() => setShowQR(true)}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', marginBottom: '30px' }}>
                <HomeRealtimePanel
                    loggedInUser={loggedInUser}
                    liveChatSectionTitle={liveChatSectionTitle}
                    liveChatSectionDesc={liveChatSectionDesc}
                    liveChatCurrentVisitorPrefix={liveChatCurrentVisitorPrefix}
                    liveChatCurrentVisitorSuffix={liveChatCurrentVisitorSuffix}
                    onlineUsers={onlineUsers}
                    liveChatVisitorsTitle={liveChatVisitorsTitle}
                    isOnlineUsersLoading={isOnlineUsersLoading}
                    refreshOnlineUsers={refreshOnlineUsers}
                    liveChatRefreshLoadingLabel={liveChatRefreshLoadingLabel}
                    liveChatRefreshButtonLabel={liveChatRefreshButtonLabel}
                    onlineUsersLastRefreshedAt={onlineUsersLastRefreshedAt}
                    liveChatRequestTimeLabel={liveChatRequestTimeLabel}
                    liveChatVisitorsRequestEmpty={liveChatVisitorsRequestEmpty}
                    liveChatVisitorsRecentDesc={liveChatVisitorsRecentDesc}
                    onlineUsersError={onlineUsersError}
                    liveChatVisitorsEmptyBox={liveChatVisitorsEmptyBox}
                    liveChatMeLabel={liveChatMeLabel}
                    liveChatRecentActivityLabel={liveChatRecentActivityLabel}
                    formatOnlineTime={formatOnlineTime}
                    renderChatPanel={() => (
                        <HomeChatPanel
                            chatMessages={chatMessages}
                            chatError={chatError}
                            chatInput={chatInput}
                            setChatInput={setChatInput}
                            isChatLoading={isChatLoading}
                            chatPickerOpen={chatPickerOpen}
                            setChatPickerOpen={setChatPickerOpen}
                            chatPickerTab={chatPickerTab}
                            setChatPickerTab={setChatPickerTab}
                            chatLastRefreshedAt={chatLastRefreshedAt}
                            sendChatMessage={sendChatMessage}
                            formatChatDateTime={formatChatDateTime}
                            openChatPopupWindow={openChatPopupWindow}
                            liveChatChatTitle={liveChatChatTitle}
                            liveChatPopupButtonLabel={liveChatPopupButtonLabel}
                            liveChatAutoLabel={liveChatAutoLabel}
                            liveChatResetNotice={liveChatResetNotice}
                            liveChatEmptyMessage={liveChatEmptyMessage}
                            liveChatInputPlaceholder={liveChatInputPlaceholder}
                            liveChatSendButtonLabel={liveChatSendButtonLabel}
                            liveChatMeLabel={liveChatMeLabel}
                            chatPopupNotRefreshedLabel={chatPopupNotRefreshedLabel}
                        />
                    )}
                />

                <HomeRankingSection
                    scoreRankingTitle={scoreRankingTitle}
                    scoreRankingAlwaysOpenLabel={scoreRankingAlwaysOpenLabel}
                    rankingTab={rankingTab}
                    setRankingTab={setRankingTab}
                    rankingRandomTabLabel={rankingRandomTabLabel}
                    rankingPastTabLabel={rankingPastTabLabel}
                    rankingIpepRandomTabLabel={rankingIpepRandomTabLabel}
                    rankingIpepPastTabLabel={rankingIpepPastTabLabel}
                    isPastRankingTab={isPastRankingTab}
                    pastYearOptions={pastYearOptions}
                    pastYear={pastYear}
                    setPastYear={setPastYear}
                    pastSessionOptions={pastSessionOptions}
                    pastSession={pastSession}
                    setPastSession={setPastSession}
                    scoreRankingYearSelectTitle={scoreRankingYearSelectTitle}
                    scoreRankingSessionSelectTitle={scoreRankingSessionSelectTitle}
                    canShowChart={canShowChart}
                    scoreRankingNeedSelectMessage={scoreRankingNeedSelectMessage}
                    scoreRankingTopPrefix={scoreRankingTopPrefix}
                    rankingLabel={rankingLabel}
                    scoreRankingTopSuffix={scoreRankingTopSuffix}
                    seasonText={seasonText}
                    rankingData={rankingData}
                    scoreRankingNoDataMessage={scoreRankingNoDataMessage}
                    scoreRankingRankSuffix={scoreRankingRankSuffix}
                    scoreRankingScoreSuffix={scoreRankingScoreSuffix}
                    formatAccuracyText={formatAccuracyText}
                    scoreRankingMyRankTitle={scoreRankingMyRankTitle}
                    myRankingData={myRankingData}
                    scoreRankingNoPersonalMessage={scoreRankingNoPersonalMessage}
                    getHomeScreenSetting={getHomeScreenSetting}
                />
            </div>

            <RealCalendar classSchedules={classSchedules} calendarCopy={calendarCopy} />
        </div>
    );
};

export default Home;
