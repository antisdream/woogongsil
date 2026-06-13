// 멀티플레이 라우트 페이지 컴포넌트입니다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io as createSocket } from 'socket.io-client';
import DrawingBoard from './DrawingBoard.jsx';
import ErrorReportButton from '../components/ErrorReportButton.jsx';
import {
    API_BASE,
    EXAM_DURATION_SECONDS,
    EXAM_TYPE_OPTIONS,
    escapeHtml,
    formatRemainTime,
    getAgreementLabelsByExamType,
    getMultiplayerScratchStorageKey,
    isPracticalQuestion,
    normalizeUiExamType,
    getExamMeta,
    apiJson,
    getOptionList,
    buildWrongHtml,
} from '../features/multiplayer/multiplayerExamUtils.js';
import QuestionImageButton from '../features/multiplayer/QuestionImageButton.jsx';
import {
    MultiplayerHomeTabs,
    MultiplayerPlayTab,
    MultiplayerRecordTab,
    MultiplayerWrongPracticeTab,
} from '../features/multiplayer/MultiplayerHomeTabs.jsx';
import { MultiplayerGuide, MultiplayerResultView, MultiplayerWaitingRoom } from '../features/multiplayer/MultiplayerRoomViews.jsx';
import MultiplayerErrorBoundary from '../features/multiplayer/MultiplayerErrorBoundary.jsx';
import {
    multiplayerThemeCss,
    pageStyle,
    headerStyle,
    titleStyle,
    descStyle,
    examGridStyle,
    cardStyle,
    sectionTitleStyle,
    primaryBtn,
    secondaryBtn,
    fieldStyle,
    smallBtnStyle,
    dangerBtn,
    timerStyle,
    buttonRowStyle,
    betweenStyle,
    headerRowStyle,
    questionPanelStyle,
    scratchPanelStyle,
    examQuestionTitleStyle,
    examOptionWrapStyle,
    textAnswerStyle,
    examOptionBtnStyle,
    selectedOptionStyle,
    omrPanelStyle,
    omrScrollStyle,
    omrGridStyle,
    omrBtnStyle,
    omrAnsweredStyle,
    omrCurrentStyle,
    noticeStyle,
    successNoticeStyle,
    errorNoticeStyle,
    modalOverlayStyle,
    modalBoxStyle,
    modalBackdropStyle,
    modalCardStyle,
} from '../features/multiplayer/multiplayerStyles.js';

function PastExamMultiplayerInner({ setIsExamActive, initialTab = 'play' }) {
    const socketRef = useRef(null);
    const currentUser = useMemo(() => ({
        id: sessionStorage.getItem('userId') || '',
        name: sessionStorage.getItem('userName') || sessionStorage.getItem('name') || ''
    }), []);

    // 화면 단계 상태는 홈, 대기방, 가이드, 시험, 결과 흐름을 관리합니다.
    const [screen, setScreen] = useState('home');

    // 멀티플레이 내부 탭을 /multiplayer/play, /multiplayer/records, /multiplayer/wrongs 주소와 동기화합니다.
    const navigate = useNavigate();
    const { mpTab } = useParams();
    const normalizeMultiplayerTab = useCallback((value) => ['play', 'records', 'wrongs'].includes(value) ? value : initialTab, [initialTab]);
    const [activeTab, setActiveTab] = useState(normalizeMultiplayerTab(mpTab));
    useEffect(() => {
        const nextTab = normalizeMultiplayerTab(mpTab);
        if (screen === 'home' && nextTab !== activeTab) {
            setActiveTab(nextTab);
        }
    }, [activeTab, mpTab, normalizeMultiplayerTab, screen]);

    const goMultiplayerTab = (nextTab) => {
        const safeTab = normalizeMultiplayerTab(nextTab);
        setActiveTab(safeTab);
        navigate(`/multiplayer/${safeTab}`);
    };

    const [notice, setNotice] = useState(null);
    const [room, setRoom] = useState(null);
    const [createForm, setCreateForm] = useState({ examType: 'written', password: '', maxPlayers: 5 });
    const [joinForm, setJoinForm] = useState({ roomCode: '', password: '' });
    const [agreements, setAgreements] = useState([false, false, false, false]);
    const [questions, setQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState({});
    /** 시험 화면에서 보여줄 남은 시간입니다. 가이드 동의 후 시험 시작 버튼을 누르면 2:30:00부터 감소합니다. */
    const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_SECONDS);
    const [result, setResult] = useState(null);
    const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
    const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    // 시험 기록 확인하기 탭 상태다.
    const [recordForm, setRecordForm] = useState({ roomCode: '', password: '' });
    const [roomRecord, setRoomRecord] = useState(null);
    const [recordLoading, setRecordLoading] = useState(false);

    // 오답문제 풀러가기 탭 상태다.
    const [wrongGroups, setWrongGroups] = useState([]);
    const [wrongDate, setWrongDate] = useState('');
    const [wrongRoomId, setWrongRoomId] = useState('');
    const [wrongQuestions, setWrongQuestions] = useState([]);
    const [wrongIndex, setWrongIndex] = useState(0);
    const [wrongAnswerMap, setWrongAnswerMap] = useState({});

    // 시험 화면 연습장 확대 팝업 상태입니다. 팝업과 기본 연습장은 같은 storageKey를 사용해 내용이 연동됩니다.
    const [scratchModalOpen, setScratchModalOpen] = useState(false);
    const [scratchVersion, setScratchVersion] = useState(0);

    // 오답 다시풀기 연습장도 문제별 저장 내용을 다시 불러오기 위한 렌더링 버전입니다.
    const [wrongScratchVersion, setWrongScratchVersion] = useState(0);

    // 보기/참고 이미지가 작게 보일 때 페이지 안에서 크게 띄우기 위한 미리보기 상태입니다.
    const [imagePreview, setImagePreview] = useState(null);

    const currentQuestion = questions[currentIndex] || null;
    const answeredCount = Object.keys(answers).length;
    const isHost = room && String(room.hostUserId) === String(currentUser?.id);
    const myMember = (room?.members || []).find((m) => String(m.userId) === String(currentUser?.id));
    // 방 정보 응답에 시험 유형이 아직 없으면 방 생성 폼의 선택값을 대신 사용합니다.
    const activeExamType = normalizeUiExamType(room?.examType || room?.exam_type || createForm.examType);
    const activeExamMeta = getExamMeta(activeExamType);

    // 멀티플레이 시험도 필기/실기 단독 시험처럼 시작 즉시 전체화면을 요청합니다.
    // requestFullscreen은 사용자 클릭 흐름 안에서 호출되어야 브라우저가 허용하므로
    // 시험 시작 버튼을 누른 직후 loadQuestions 안에서 먼저 실행하고, useEffect는 보조 복구용으로만 사용합니다.
    const enterMultiplayerExamFullscreen = async () => {
        try {
            if (!document.fullscreenElement && document.documentElement?.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            }
        } catch (error) {
            console.warn('멀티플레이 전체화면 전환이 브라우저 정책으로 제한되었습니다.', error);
        }
    };
    /**
     * 시험 제한시간 카운트다운입니다.
     * 시험 화면에서만 동작하고, 0초가 되면 제출 확인창을 띄워 사용자가 상태를 인지할 수 있게 합니다.
     */
    useEffect(() => {
        if (screen !== 'exam') return undefined;

        const timerId = window.setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    window.clearInterval(timerId);
                    setSubmitConfirmOpen(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => window.clearInterval(timerId);
    }, [screen]);

    /** 초 단위 시간을 2시간 30분 00초 형식으로 변환합니다. */


    const allAgreed = agreements.every(Boolean);
    const selectedWrongQuestion = wrongQuestions[wrongIndex] || null;

    // 방 전체 상세 채점표는 wrongItems가 일부 오답 상세만 담는 경우가 있어,
    // rows가 더 길면 rows를 우선 사용합니다. 시험 진행/제출/채점 API는 유지합니다.
    const roomRecordRowsForDisplay = useMemo(() => {
        const rows = Array.isArray(roomRecord?.rows) ? roomRecord.rows : [];
        const wrongItems = Array.isArray(roomRecord?.wrongItems) ? roomRecord.wrongItems : [];
        return rows.length >wrongItems.length ? rows : wrongItems;
    }, [roomRecord]);

    const roomRecordExamType = normalizeUiExamType(roomRecord?.examType || roomRecord?.exam_type || 'written');
    const roomRecordExamMeta = getExamMeta(roomRecordExamType);

    const uniqueWrongDates = useMemo(() => [...new Set(wrongGroups.map((g) => g.date).filter(Boolean))], [wrongGroups]);
    const filteredWrongTimes = useMemo(() => wrongGroups.filter((g) => !wrongDate || g.date === wrongDate), [wrongGroups, wrongDate]);

    const toast = useCallback((message, type = 'info') => setNotice({ message, type }), []);

    // 문제 이미지가 있는 경우에만 본문 아래에 출력합니다. 기존 기출문제와 같은 public/question_image 경로를 사용합니다.
    // 문제별 연습장 저장 키를 한 곳에서 만든다.
    // 보기 이미지 확대 팝업 안의 연습장과 원래 시험 화면의 연습장이 같은 키를 쓰므로,
    // 팝업에서 쓴 내용이 닫은 뒤에도 그대로 유지됩니다.
    const getScratchStorageKey = (question = currentQuestion, index = currentIndex) => getMultiplayerScratchStorageKey(room, question, index);

    // 확대 팝업을 닫을 때 메인 화면의 DrawingBoard를 강제로 다시 마운트합니다.
    // 같은 localStorage 키를 쓰더라도 이미 떠 있던 메인 연습장은 내부 상태가 남아 있을 수 있어서,
    // 창을 닫을 때 scratchVersion을 갱신해 최신 저장 내용을 다시 읽도록 합니다.
    const closeImagePreview = () => {
        setImagePreview(null);
        setScratchVersion((prev) => prev + 1);
    };



    // 실기 오답은 답안을 입력해도 바로 정답/해설을 보여주지 않고 확인 버튼을 누른 뒤에만 노출합니다.
    const shouldShowWrongFeedback = (question) => {
        if (!question?.question_id) return false;
        const qid = question.question_id;
        return isPracticalQuestion(question) ? Boolean(wrongAnswerMap[`checked_${qid}`]) : Boolean(wrongAnswerMap[qid]);
    };

    useEffect(() => {
        // 제출 전 응시 화면에서 상단 메뉴/페이지 이동을 막기 위해 App 공통 가드에 상태를 전달합니다.
        if (typeof setIsExamActive === 'function') setIsExamActive(screen === 'exam' && !result);
        return () => { if (typeof setIsExamActive === 'function') setIsExamActive(false); };
    }, [screen, result, setIsExamActive]);

    useEffect(() => {
        // 혹시 브라우저가 첫 요청을 놓쳤을 때 시험 화면 진입 시 한 번 더 전체화면을 요청합니다.
        // 기존 부정행위 감지/포커스 이탈 로직은 App.jsx의 공통 가드가 그대로 담당합니다.
        if (screen !== 'exam') return;
        enterMultiplayerExamFullscreen();
    }, [screen]);

    useEffect(() => {
        // 멀티플레이 응시 중 제출하지 않고 뒤로가기/새로고침/닫기를 시도하는 상황을 방지합니다.
        // 기존 제출/채점 로직은 변경하지 않고, 이전 의 roomQuestions 미정의 오류만 questions 기준으로 교정합니다.
        const isRunningExam = screen === 'exam' && !!room && questions.length >0 && !result;
        if (!isRunningExam) return undefined;

        const roomCode = String(room.roomCode || room.room_code || '').trim();
        const guardState = { wgsMultiplayerExamGuard: true, roomId: room.id || roomCode };
        let leaveNotified = false;

        const notifyUnsubmittedExit = () => {
            if (leaveNotified || !roomCode) return;
            leaveNotified = true;
            const leaveUrl = `${API_BASE}/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/leave`;
            try {
                const payload = new Blob([JSON.stringify({ reason: 'unsubmitted-exit' })], { type: 'application/json' });
                if (navigator?.sendBeacon) {
                    navigator.sendBeacon(leaveUrl, payload);
                    // 개발 환경처럼 프론트/백엔드 포트가 분리된 경우를 대비해 keepalive fetch도 이어서 시도합니다.
                }
            } catch {
                // 브라우저 종료 시점의 sendBeacon 실패는 keepalive fetch로 한 번 더 보정합니다.
            }
            try {
                fetch(leaveUrl, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason: 'unsubmitted-exit' }),
                    keepalive: true,
                }).catch(() => {});
            } catch {
                // 페이지 종료 시점의 네트워크 실패는 사용자 화면에 노출하지 않습니다.
            }
        };

        const onBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = '';
            return '';
        };
        const onPageHide = () => {
            notifyUnsubmittedExit();
        };
        const onPopState = () => {
            setLeaveConfirmOpen(true);
            window.history.pushState(guardState, '', window.location.href);
        };

        window.history.pushState(guardState, '', window.location.href);
        window.addEventListener('beforeunload', onBeforeUnload);
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('popstate', onPopState);

        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('popstate', onPopState);
        };
    }, [screen, room, questions.length, result]);

    useEffect(() => {
        // 방에 들어간 동안에는 socket으로 대기방 상태 변화를 실시간 반영합니다.
        if (!room?.roomCode || !currentUser?.id) return undefined;
        const socket = createSocket(API_BASE, { withCredentials: true, auth: { id: currentUser.id, sessionToken: sessionStorage.getItem('sessionToken') || '' } });
        socketRef.current = socket;
        socket.emit('multiplayer:join-room', { roomCode: room.roomCode });
        socket.on('multiplayer:room-updated', (updatedRoom) => {
            if (!updatedRoom || String(updatedRoom.roomCode) !== String(room.roomCode)) return;
            setRoom(updatedRoom);
            if (updatedRoom.status === 'PLAYING' && (screen === 'waiting' || screen === 'guide')) {
                setScreen('guide');
            }
        });
        socket.on('multiplayer:kicked', (payload = {}) => {
            // 서버는 같은 방 참여자에게 이벤트를 함께 전달하므로,
            // targetUserId가 현재 로그인 사용자와 일치할 때만 대기방에서 내보냅니다.
            // 방장이 다른 참여자를 내보냈을 때 방장 본인까지 나가는 문제를 방지합니다.
            if (String(payload.roomCode || '') !== String(room.roomCode)) return;
            if (String(payload.targetUserId || '') !== String(currentUser.id)) return;

            toast('방장 안내에 따라 대기방에서 퇴장 처리되었습니다.', 'error');
            resetToHome();
        });
        return () => socket.disconnect();
    }, [room?.roomCode, currentUser?.id, screen, toast]);

    function resetToHome() {
        // 멀티플레이 상태만 초기화하고 기존 필기 페이지 로직은 변경하지 않는다.
        setRoom(null);
        setQuestions([]);
        setAnswers({});
        setTimeLeft(EXAM_DURATION_SECONDS);
        setCurrentIndex(0);
        setAgreements([false, false, false, false]);
        setResult(null);
        setScreen('home');
    }

    const createRoom = async () => {
        // 방 생성: 방장만 비밀번호/정원을 지정하고 서버가 새 방 번호를 만든다.
        try {
            setLoading(true);
            const data = await apiJson('/api/multiplayer/rooms', {
                method: 'POST',
                body: JSON.stringify({ examType: createForm.examType, password: createForm.password, maxPlayers: createForm.maxPlayers })
            });
            setRoom({ ...(data.room || {}), examType: normalizeUiExamType(data.room?.examType || createForm.examType) });
            setScreen('waiting');
            toast(`대기방 #${data.room.roomCode}이 생성되었습니다. 참여자에게 방 번호와 인증 비밀번호를 안내해 주세요.`, 'success');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const joinRoom = async () => {
        // 방 입장: 입력한 방 번호/비밀번호가 맞을 때만 대기방에 들어간다.
        try {
            setLoading(true);
            const roomCode = String(joinForm.roomCode || '').trim();
            const data = await apiJson(`/api/multiplayer/rooms/${roomCode}/join`, {
                method: 'POST',
                body: JSON.stringify({ password: joinForm.password })
            });
            setRoom({ ...(data.room || {}), examType: normalizeUiExamType(data.room?.examType || data.room?.exam_type) });
            setScreen('waiting');
            toast(`대기방 #${data.room.roomCode}에 입장했습니다. 시험 시작 전 안내사항을 확인해 주세요.`, 'success');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleReady = async () => {
        // 일반 참여자 준비 상태를 서버에 저장합니다.
        try {
            const nextReady = myMember?.status !== 'READY';
            const data = await apiJson(`/api/multiplayer/rooms/${room.roomCode}/ready`, {
                method: 'POST',
                body: JSON.stringify({ ready: nextReady })
            });
            setRoom({ ...(data.room || {}), examType: normalizeUiExamType(data.room?.examType || createForm.examType) });
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const changePassword = async () => {
        // 방장 전용 비밀번호 변경 기능입니다.
        const next = window.prompt('새 인증 비밀번호를 입력해 주세요.');
        if (!next) return;
        try {
            const data = await apiJson(`/api/multiplayer/rooms/${room.roomCode}/password`, {
                method: 'POST',
                body: JSON.stringify({ password: next })
            });
            setRoom({ ...(data.room || {}), examType: normalizeUiExamType(data.room?.examType || data.room?.exam_type) });
            toast('방 비밀번호를 변경했습니다.', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const kickMember = async (targetUserId) => {
        // 방장 전용 내보내기 기능입니다.
        if (!window.confirm('해당 참여자를 대기방에서 퇴장 처리하시겠습니까?')) return;
        try {
            const data = await apiJson(`/api/multiplayer/rooms/${room.roomCode}/kick`, {
                method: 'POST',
                body: JSON.stringify({ targetUserId })
            });
            setRoom(data.room);
            toast('선택한 참여자를 대기방에서 퇴장 처리했습니다.', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const startRoom = async () => {
        // 방장이 시험 시작을 누르면 서버가 같은 100문제를 생성/고정합니다.
        try {
            // 대기방 생성 안내/입장 안내가 시험 가이드·진행 화면까지 남지 않도록 초기화합니다.
            setNotice(null);
            const data = await apiJson(`/api/multiplayer/rooms/${room.roomCode}/start`, {
                method: 'POST',
                // 서버가 방 문제 생성을 시작할 때 선택한 시험 유형을 한 번 더 전달합니다.
                body: JSON.stringify({ examType: activeExamType })
            });
            setRoom({ ...(data.room || room), examType: normalizeUiExamType(data.room?.examType || activeExamType) });
            setScreen('guide');
            // 시험 시작 안내 문구는 가이드/동의 화면 자체에서만 보여주고, 별도 toast는 띄우지 않습니다.
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const loadQuestions = async () => {
        // 가이드 동의 후 실제 시험 문제를 불러온다. 출처 정보는 서버가 시험 중 숨겨서 내려줍니다.
        if (!allAgreed) {
            toast('시험 가이드와 응시 동의를 모두 확인해 주세요.', 'error');
            return;
        }
        await enterMultiplayerExamFullscreen();
        try {
            // 실제 시험 화면에서는 방 만들기/대기방 안내문을 숨깁니다.
            setNotice(null);
            const data = await apiJson(`/api/multiplayer/rooms/${room.roomCode}/questions`);
            setQuestions(data.questions || []);
            setRoom({ ...(data.room || room), examType: normalizeUiExamType(data.room?.examType || room?.examType || activeExamType) });
            setCurrentIndex(0);
            setAnswers({});
            setScreen('exam');
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const selectAnswer = (questionId, label) => {
        // 같은 보기를 한 번 더 누르면 선택이 해제되고, 다른 보기를 누르면 선택이 변경됩니다.
        setAnswers((prev) => {
            if (Number(prev[questionId]) === Number(label)) {
                const next = { ...prev };
                delete next[questionId];
                return next;
            }
            return { ...prev, [questionId]: label };
        });
    };

    const updateTextAnswer = (questionId, value) => {
        // 주관식 답안은 문자열 그대로 저장하고, 빈칸이면 OMR 응답 표시를 해제합니다.
        setAnswers((prev) => {
            const next = { ...prev };
            if (!String(value || '').trim()) {
                delete next[questionId];
            } else {
                next[questionId] = value;
            }
            return next;
        });
    };

    const submitExam = async () => {
        // 답안을 제출하면 서버가 채점 결과와 과목별 점수를 저장합니다.
        try {
            setSubmitConfirmOpen(false);
            const data = await apiJson(`/api/multiplayer/rooms/${room.roomCode}/submit`, {
                method: 'POST',
                body: JSON.stringify({ answers })
            });
            setResult(data.result);
            setRoom({ ...(data.room || room), examType: normalizeUiExamType(data.room?.examType || room?.examType || activeExamType) });
            setScreen('result');
            toast('답안이 제출되었습니다.', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const leaveWaitingRoom = async () => {
        // 대기방 나가기: 일반 참여자만 서버에서 LEFT 처리하고, 모든 화면은 과목 페이지가 아닌 멀티플레이 로비로 돌아간다.
        if (!room) return resetToHome();
        if (screen === 'guide' || screen === 'exam') {
            setLeaveConfirmOpen(true);
            return;
        }
        if (screen !== 'waiting') return resetToHome();
        if (isHost) {
            resetToHome();
            return;
        }
        try {
            await apiJson(`/api/multiplayer/rooms/${room.roomCode}/leave`, { method: 'POST' });
            resetToHome();
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    const confirmMoveToWrittenLobby = async () => {
        // 제출 전 이탈을 최종 확인한 경우 서버에 LEFT로 기록한 뒤 멀티플레이 로비로 돌아갑니다.
        setLeaveConfirmOpen(false);
        if (room?.roomCode && screen === 'exam' && !result) {
            try {
                await apiJson(`/api/multiplayer/rooms/${room.roomCode}/leave`, {
                    method: 'POST',
                    body: JSON.stringify({ reason: 'unsubmitted-exit' }),
                });
            } catch {
                // 네트워크 오류가 있어도 사용자가 이미 이탈을 확정했으므로 화면 이동은 유지합니다.
            }
        }
        resetToHome();
    };

    const loadRoomRecord = async () => {
        // 방 번호/비밀번호로 모든 참여자의 제출 완료 후 전체 채점표를 조회합니다.
        if (!recordForm.roomCode || !recordForm.password) return toast('방 번호와 인증 비밀번호를 모두 입력해 주세요.', 'error');
        try {
            setRecordLoading(true);
            setRoomRecord(null);
            const data = await apiJson(`/api/multiplayer/rooms/${recordForm.roomCode}/record`, {
                method: 'POST',
                body: JSON.stringify({ password: recordForm.password })
            });
            setRoomRecord(data.board);
            toast('방 전체 상세 채점표를 불러왔습니다.', 'success');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setRecordLoading(false);
        }
    };

    const openRoomWrongHtml = () => {
        // 방 전체 기록을 HTML/PDF용 새 창으로 보여줍니다.
        // 기존 wrongItems 기준은 오답만 출력되어 100문제가 누락될 수 있어 rows 우선 기준으로 변경합니다.
        const printableCount = roomRecordRowsForDisplay.length;
        if (!printableCount) return toast('출력할 채점표 문제가 없습니다.', 'info');
        const win = window.open('', '_blank');
        if (!win) return toast('팝업이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.', 'error');
        win.document.open();
        win.document.write(buildWrongHtml({ roomRecord, escapeHtml }));
        win.document.close();
    };

    const loadWrongGroups = useCallback(async () => {
        // 내 멀티플레이 제출 기록 중 아직 남아 있는 오답이 있는 기록만 날짜/시간 필터용으로 불러온다.
        try {
            const data = await apiJson('/api/multiplayer/my-wrongs/groups');
            const nextGroups = data.groups || [];
            setWrongGroups(nextGroups);

            // 전체 삭제 또는 마지막 문제 삭제 뒤 목록 새로고침을 눌렀을 때,
            // 이미 사라진 방 선택값이 select에 남지 않도록 화면 상태도 같이 정리합니다.
            if (wrongRoomId && !nextGroups.some((group) => String(group.roomId) === String(wrongRoomId))) {
                setWrongRoomId('');
                setWrongQuestions([]);
                setWrongIndex(0);
                setWrongAnswerMap({});
            }
            if (wrongDate && !nextGroups.some((group) => String(group.date) === String(wrongDate))) {
                setWrongDate('');
            }
            return nextGroups;
        } catch (error) {
            toast(error.message, 'error');
            return [];
        }
    }, [toast, wrongDate, wrongRoomId]);

    useEffect(() => {
        // 오답 탭은 필요할 때만 내 응시 기록을 불러와 불필요한 DB 조회를 줄인다.
        if (activeTab === 'wrongs') loadWrongGroups();
    }, [activeTab, loadWrongGroups]);

    const loadMyWrongQuestions = async () => {
        // 선택한 응시 기록에서 현재 로그인 사용자가 틀린 문제만 불러온다.
        if (!wrongRoomId) return toast('응시 날짜와 응시 시간을 선택해 주세요.', 'error');
        try {
            const data = await apiJson(`/api/multiplayer/my-wrongs/${wrongRoomId}`);
            setWrongQuestions(data.wrongs || []);
            setWrongIndex(0);
            setWrongAnswerMap({});
            setWrongScratchVersion((value) => value + 1);
            toast(data.wrongs?.length ? `오답 ${data.wrongs.length}문제를 불러왔습니다.` : '선택한 시험에는 오답 문제가 없습니다.', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    // 오답 다시풀기에서 현재 문제만 내 목록에서 숨긴다. 시험 기록 원본은 삭제하지 않는다.
    const deleteCurrentWrongQuestion = async () => {
        if (!selectedWrongQuestion || !wrongRoomId) return;
        if (!window.confirm('현재 오답 문제를 목록에서 삭제하시겠습니까?')) return;
        try {
            await apiJson(`/api/multiplayer/my-wrongs/${wrongRoomId}/${selectedWrongQuestion.question_id}`, { method: 'DELETE' });
            const nextQuestions = wrongQuestions.filter((q) => String(q.question_id) !== String(selectedWrongQuestion.question_id));
            setWrongQuestions(nextQuestions);
            setWrongIndex((index) => Math.min(index, Math.max(0, nextQuestions.length - 1)));
            if (nextQuestions.length === 0) {
                // 현재 시험의 마지막 오답까지 지웠다면 날짜/시간 드롭다운에서도 해당 시험을 제거합니다.
                await loadWrongGroups();
            }
            toast('선택한 오답을 삭제했습니다.', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    };

    // 선택한 응시 기록의 내 오답 전체를 숨긴다. 결과표와 방 기록은 유지됩니다.
    const deleteAllWrongQuestions = async () => {
        if (!wrongRoomId || wrongQuestions.length === 0) return;
        if (!window.confirm('현재 선택한 응시 기록의 오답을 모두 삭제하시겠습니까?')) return;
        try {
            await apiJson(`/api/multiplayer/my-wrongs/${wrongRoomId}`, { method: 'DELETE' });
            setWrongQuestions([]);
            setWrongIndex(0);
            setWrongAnswerMap({});
            // 전체 삭제가 끝난 시험은 새로고침 없이도 날짜와 시간 목록에서 바로 사라지도록 합니다.
            await loadWrongGroups();
            toast('선택한 응시 기록의 오답을 모두 삭제했습니다.', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    };











    /** 시험 전 안내 화면입니다. 체크박스 대신 각 안내 행을 버튼처럼 눌러 동의하도록 변경했습니다. */


    /** 실제 시험 응시 화면입니다. 문제 영역을 크게 유지하고, OMR은 하단 스크롤 영역으로 분리했습니다. */
    const renderExam = () => {
        const currentQuestion = questions[currentIndex];
        if (!currentQuestion) {
      return (
        <div style={pageStyle}>
          <div style={headerRowStyle}>
            <h1 style={titleStyle}> {activeExamMeta.label} 랜덤 CBT 멀티플레이</h1>
            <button type="button" style={smallBtnStyle} onClick={() => { setScreen('lobby'); setNotice('문제 목록을 아직 불러오지 못했습니다. 대기방으로 이동했습니다.'); }}>{activeExamMeta.shortLabel} 로비</button>
          </div>
          <div style={{ ...noticeStyle, ...errorNoticeStyle }}>
            문제 목록이 비어 있어 시험 화면을 열 수 없습니다. 대기방으로 이동한 뒤 새로고침 후 다시 시작해 주세요.
          </div>
        </div>
      );
    }
        // 실제 시험 화면의 사지선다형 보기가 option_1~option_4, options 배열 어느 형태든 정상 표시되도록 수정했습니다.
        const opts = getOptionList(currentQuestion);
        return (
            <div style={examGridStyle}>
                {/* 왼쪽 상단: 문제, 보기, 이전/다음 버튼을 크게 보여주는 영역 */}
                <section style={{ ...cardStyle, ...questionPanelStyle }}>
                    <div style={{ ...betweenStyle, alignItems: 'flex-start', gap: 12 }}>
                        <h2 style={sectionTitleStyle}>{isPracticalQuestion(currentQuestion) ? '실기 기출문제' : '랜덤 CBT 문제'}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                            <strong style={timerStyle}>남은 시간: {formatRemainTime(timeLeft)}</strong>
                            {currentQuestion?.question_id && (
                                <ErrorReportButton
                                    examType={isPracticalQuestion(currentQuestion) ? '멀티플레이 실기시험' : '멀티플레이 필기시험'}
                                    mode="시험 진행" questionInfo={{
                                        cbtNumber: currentIndex + 1,
                                        actualNumber: currentQuestion.question_no || currentQuestion.actual_no || currentIndex + 1,
                                        questionNo: currentQuestion.question_no || currentQuestion.actual_no || currentIndex + 1,
                                        examYear: currentQuestion.exam_year || currentQuestion.source_year || currentQuestion.year,
                                        examSession: currentQuestion.exam_session || currentQuestion.source_session || currentQuestion.session,
                                        subjectNo: currentQuestion.subject_no,
                                        subjectName: currentQuestion.subject_name || currentQuestion.subject || (isPracticalQuestion(currentQuestion) ? '실기 기출문제' : '랜덤 CBT 문제'),
                                        subject: currentQuestion.subject_name || currentQuestion.subject || (isPracticalQuestion(currentQuestion) ? '실기 기출문제' : '랜덤 CBT 문제'),
                                        source: currentQuestion.report_source_label || currentQuestion.source_label || currentQuestion.question_source || activeExamType,
                                        sourceLabel: currentQuestion.report_source_label || currentQuestion.source_label || currentQuestion.question_source || activeExamType,
                                        reportSourceLabel: currentQuestion.report_source_label,
                                        questionId: currentQuestion.question_id,
                                        infoId: currentQuestion.info_id,
                                    }}
                                    size="small"
                                />
                            )}
                            <b>{currentIndex + 1} / {questions.length}</b>
                        </div>
                    </div>

                    <h3 style={examQuestionTitleStyle}>{currentIndex + 1}. {currentQuestion.question_text}</h3>
                    <QuestionImageButton question={currentQuestion} currentIndex={currentIndex} getScratchStorageKey={getScratchStorageKey} setImagePreview={setImagePreview} />

                    {isPracticalQuestion(currentQuestion) ? (
                        <div style={examOptionWrapStyle}>
                            <label style={{ ...fieldStyle, marginBottom: 0 }}>
                                실기 답안 입력
                                <textarea
                                    style={textAnswerStyle}
                                    value={answers[currentQuestion.question_id] || ''}
                                    onChange={(e) => updateTextAnswer(currentQuestion.question_id, e.target.value)}
                                    placeholder="정답을 직접 입력해 주세요. 예: 데이터베이스, SQL, 30"
                                />
                            </label>
                            <p style={{ ...descStyle, marginTop: 8 }}>띄어쓰기 차이는 서버에서 최대한 보정하여 채점합니다.</p>
                        </div>
                    ) : (
                        <div style={examOptionWrapStyle}>
                            {opts.map((opt, i) => {
                                const label = i + 1;
                                const selected = Number(answers[currentQuestion.question_id]) === label;
                                return (
                                    <button
                                        key={label}
                                        style={{ ...examOptionBtnStyle, ...(selected ? selectedOptionStyle : {}) }}
                                        onClick={() => selectAnswer(currentQuestion.question_id, label)}
                                    >
                                        {label}번. {opt}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div style={betweenStyle}>
                        <button style={secondaryBtn} disabled={currentIndex === 0} onClick={() => setCurrentIndex((v) => Math.max(0, v - 1))}>이전</button>
                        <button style={secondaryBtn} disabled={currentIndex >= questions.length - 1} onClick={() => setCurrentIndex((v) => Math.min(questions.length - 1, v + 1))}>다음</button>
                    </div>
                </section>

                {/* 오른쪽 상단: 기존 연습장 기능을 복원한 캔버스 영역 */}
                <aside style={{ ...cardStyle, ...scratchPanelStyle }}>
                    <div style={betweenStyle}>
                        <h2 style={sectionTitleStyle}>문제 풀이 연습장</h2>
                        <button
                            type="button" style={secondaryBtn}
                            onClick={() => setScratchModalOpen(true)}
                        >
                            크게 보기
                        </button>
                    </div>
                    <p style={descStyle}>펜, 지우개, 텍스트를 이용해 계산이나 C/Java 풀이 과정을 정리해 주세요. 작성 내용은 문제별로 따로 저장됩니다.</p>
                    <DrawingBoard
                        key={`inline_${scratchVersion}_${getScratchStorageKey(currentQuestion, currentIndex)}`}
                        storageKey={getScratchStorageKey(currentQuestion, currentIndex)}
                        height={520}
                    />
                </aside>

                {/* 하단: OMR 답안지는 20칸 x 5줄로 맞춰 기본 화면에서 스크롤 없이 확인하도록 분리 */}
                <section style={{ ...cardStyle, ...omrPanelStyle }}>
                    <div style={betweenStyle}>
                        <h2 style={sectionTitleStyle}>OMR 답안지</h2>
                        <span>응답 {answeredCount} / {questions.length}</span>
                    </div>
                    <p style={{ ...descStyle, marginTop: 0 }}>버튼을 누르면 해당 문제로 이동합니다. 필기는 보기를 선택하고, 실기는 답안을 입력하면 응답으로 표시됩니다.</p>
                    <div style={omrScrollStyle}>
                        <div style={omrGridStyle}>
                            {questions.map((q, idx) => (
                                <button
                                    key={q.question_id}
                                    style={{ ...omrBtnStyle, ...(answers[q.question_id] ? omrAnsweredStyle : {}), ...(idx === currentIndex ? omrCurrentStyle : {}) }}
                                    onClick={() => setCurrentIndex(idx)}
                                >
                                    {idx + 1}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button style={primaryBtn} onClick={() => setSubmitConfirmOpen(true)}>제출하기</button>
                </section>

                {/* 연습장 크게 보기 팝업: 같은 storageKey를 사용하므로 작성 내용이 기본 연습장과 연동됩니다. */}
                {scratchModalOpen && (
                    <div style={modalBackdropStyle}>
                        <section style={modalCardStyle}>
                            <div style={betweenStyle}>
                                <h2 style={sectionTitleStyle}>문제 풀이 연습장 크게 보기</h2>
                                <button
                                    type="button" style={secondaryBtn}
                                    onClick={() => {
                                        setScratchModalOpen(false);
                                        setScratchVersion((value) => value + 1);
                                    }}
                                >
                                    닫기
                                </button>
                            </div>
                            <DrawingBoard
                                key={`scratch_modal_${scratchVersion}_${getScratchStorageKey(currentQuestion, currentIndex)}`}
                                storageKey={getScratchStorageKey(currentQuestion, currentIndex)}
                                height={720}
                            />
                        </section>
                    </div>
                )}
            </div>
        );
    };



    return (
        <div id="wgs-multiplayer-page" style={pageStyle}>
            <style>{multiplayerThemeCss}</style>
            {imagePreview && (
                <div
                    className="mp-image-modal-backdrop" role="presentation"
                >
                    <div
                        className="mp-image-modal" role="dialog" aria-modal="true" aria-label="문제 보기 이미지 확대"
                    >
                        <div className="mp-image-modal-head">
                            <strong>문제 보기 이미지 확대 · {imagePreview.questionLabel || '현재 문제'}</strong>
                            <button type="button" onClick={closeImagePreview}>닫기</button>
                        </div>
                        <div className="mp-image-modal-body">
                            <div className="mp-image-modal-viewer">
                                <img src={imagePreview.src} alt={imagePreview.alt || '문제 보기 이미지 확대'} />
                            </div>
                            <aside className="mp-image-modal-scratch" aria-label="확대 보기용 문제 풀이 연습장">
                                <div className="mp-image-modal-scratch-title">
                                    <strong>문제 풀이 연습장</strong>
                                    <span>팝업에서 작성한 내용은 닫은 뒤에도 그대로 유지됩니다.</span>
                                </div>
                                <DrawingBoard
                                    key={`image_preview_${imagePreview.scratchKey}`}
                                    storageKey={imagePreview.scratchKey || getScratchStorageKey(currentQuestion, currentIndex)}
                                    height={640}
                                />
                            </aside>
                        </div>
                    </div>
                </div>
            )}
            {leaveConfirmOpen && <div style={modalOverlayStyle}><div style={modalBoxStyle}><h2>시험을 진행하지 않으시겠습니까?</h2><p style={descStyle}>네를 누르면 로비로 이동하고, 아니오를 누르면 현재 화면을 유지합니다.</p><div style={buttonRowStyle}><button style={dangerBtn} onClick={confirmMoveToWrittenLobby}>네</button><button style={secondaryBtn} onClick={() => setLeaveConfirmOpen(false)}>아니오</button></div></div></div>}
            {submitConfirmOpen && <div style={modalOverlayStyle}><div style={modalBoxStyle}><h2>답안을 제출하시겠습니까?</h2><p style={descStyle}>제출 후에는 답안을 수정할 수 없습니다.</p><div style={buttonRowStyle}><button style={primaryBtn} onClick={submitExam}>제출</button><button style={secondaryBtn} onClick={() => setSubmitConfirmOpen(false)}>취소</button></div></div></div>}
            <header style={headerStyle}>
                <div>
                    <h1 style={titleStyle}> {activeExamMeta.title}</h1>
                    {/* 방 생성 설명은 방 만들기/입장하기 탭에서만 보여주고, 대기방·가이드·시험 진행 화면에서는 숨깁니다. */}
                    {screen === 'home' && activeTab === 'play' && <p style={descStyle}>{activeExamMeta.desc}</p>}
                </div>
                {screen !== 'home' && screen !== 'guide' && screen !== 'exam' && <button style={secondaryBtn} onClick={leaveWaitingRoom}>{activeExamMeta.lobbyText}</button>}
            </header>
            {notice && screen !== 'exam' && <div style={{ ...noticeStyle, ...(notice.type === 'error'? errorNoticeStyle : successNoticeStyle) }}>{notice.message}</div>}
            {screen === 'home' && (
                <>
                    <MultiplayerHomeTabs activeTab={activeTab} goMultiplayerTab={goMultiplayerTab} />
                    {activeTab === 'play' && (
                        <MultiplayerPlayTab
                            createForm={createForm}
                            setCreateForm={setCreateForm}
                            createRoom={createRoom}
                            loading={loading}
                            joinForm={joinForm}
                            setJoinForm={setJoinForm}
                            joinRoom={joinRoom}
                        />
                    )}
                    {activeTab === 'records' && (
                        <MultiplayerRecordTab
                            recordForm={recordForm}
                            setRecordForm={setRecordForm}
                            loadRoomRecord={loadRoomRecord}
                            recordLoading={recordLoading}
                            roomRecord={roomRecord}
                            roomRecordExamMeta={roomRecordExamMeta}
                            roomRecordRowsForDisplay={roomRecordRowsForDisplay}
                            roomRecordExamType={roomRecordExamType}
                            openRoomWrongHtml={openRoomWrongHtml}
                        />
                    )}
                    {activeTab === 'wrongs' && (
                        <MultiplayerWrongPracticeTab
                            wrongDate={wrongDate}
                            setWrongDate={setWrongDate}
                            setWrongRoomId={setWrongRoomId}
                            wrongRoomId={wrongRoomId}
                            uniqueWrongDates={uniqueWrongDates}
                            filteredWrongTimes={filteredWrongTimes}
                            loadMyWrongQuestions={loadMyWrongQuestions}
                            loadWrongGroups={loadWrongGroups}
                            selectedWrongQuestion={selectedWrongQuestion}
                            wrongIndex={wrongIndex}
                            wrongQuestions={wrongQuestions}
                            currentIndex={currentIndex}
                            getScratchStorageKey={getScratchStorageKey}
                            setImagePreview={setImagePreview}
                            wrongAnswerMap={wrongAnswerMap}
                            setWrongAnswerMap={setWrongAnswerMap}
                            shouldShowWrongFeedback={shouldShowWrongFeedback}
                            wrongScratchVersion={wrongScratchVersion}
                            deleteCurrentWrongQuestion={deleteCurrentWrongQuestion}
                            deleteAllWrongQuestions={deleteAllWrongQuestions}
                            setWrongIndex={setWrongIndex}
                        />
                    )}
                </>
            )}
            {screen === 'waiting' && (
                <MultiplayerWaitingRoom room={room} activeExamMeta={activeExamMeta} leaveWaitingRoom={leaveWaitingRoom} isHost={isHost} kickMember={kickMember} changePassword={changePassword} startRoom={startRoom} toggleReady={toggleReady} myMember={myMember} />
            )}
            {screen === 'guide' && (
                <MultiplayerGuide agreementLabels={getAgreementLabelsByExamType(activeExamType)} agreements={agreements} setAgreements={setAgreements} allAgreed={allAgreed} loadQuestions={loadQuestions} />
            )}
            {screen === 'exam' && renderExam()}
            {screen === 'result' && <MultiplayerResultView result={result} room={room} resetToHome={resetToHome} />}
        </div>
    );
}

export default function PastExamMultiplayer(props) {
  return (
    <MultiplayerErrorBoundary>
      <PastExamMultiplayerInner {...props} />
    </MultiplayerErrorBoundary>
  );
}
