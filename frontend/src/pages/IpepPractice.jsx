// 정보처리기사 실기 라우트 페이지 컴포넌트입니다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import ErrorReportButton from "../components/ErrorReportButton";
import useScreenSettings from '../useScreenSettings';
import IpepRandomMode from '../features/ipep/IpepRandomMode.jsx';
import { buildIpepRandomQuery, rememberIpepRandomQuestion } from '../features/ipep/ipepRandomHistory.js';
import {
    formatTime,
    formatDateTime,
    escapeHtml,
    getQuestionNo,
    getImgSrc,
    mergeClientIpepGrade,
    normalizeIpepCatalog,
    replaceSettingTokens,
    requestExamFullscreen,
} from '../features/ipep/ipepPracticeUtils.js';
import IpepImageViewer from '../features/ipep/IpepImageViewer.jsx';
import { IpepExplanationImage, IpepQuestionImages } from '../features/ipep/IpepQuestionImages.jsx';
import { IpepGuide, IpepLobby, IpepModeButtons } from '../features/ipep/IpepLobbyViews.jsx';
import { IpepPastLobby, IpepPastResult } from '../features/ipep/IpepPastViews.jsx';
import IpepSpecialSymbolPad from '../features/ipep/IpepSpecialSymbolPad.jsx';
import IpepThreeWeekPanel from '../features/ipep/IpepThreeWeekPanel.jsx';
import {
    buildIpepSessionAuth,
    normalizeIpepWrongQuestionForSave,
    saveIpepRankingRecord,
    saveIpepWrongNotesRecord,
} from '../features/ipep/ipepPracticePersistence.js';
import {
    IPEP_TOTAL_SECONDS,
    baseButtonStyle,
    pageBoxStyle,
    panelStyle,
} from '../features/ipep/ipepPracticeStyles.js';


import DrawingBoard from "./DrawingBoard"; // 필기 페이지와 같은 연습장 기능을 실기 페이지에도 재사용합니다.

// 실기 문제풀이 화면 구성
// 역할:
// 1. 정보처리기사 실기 문제은행과 실기 기출문제를 보여주는 화면입니다.
// 2. 문제은행은 현재 방식과 동일하게 한 문제씩 즉시 채점하는 연습 모드다.
// 3. 기출문제는 필기 기출문제처럼 시험 모드로 바꿨다.
//  - 2시간 30분 타이머
//  - 우측 OMR 문제번호 이동
//  - 이전/다음 이동
//  - 마지막 제출 후 결과표 확인
//  - PDF 출력합니다
// 4. 백엔드에 이미 붙어 있는 /api/ipep/check-answer API를 그대로 사용합니다.
// 5. 기존 필기 기능은 변경하지 않는다.

const API_BASE = '';

function IpepPractice({ setIsExamActive, initialMode = 'lobby' }) {
    const navigate = useNavigate();

    // 실기 로비의 눈에 보이는 문구만 관리자 화면 설정값과 연결합니다.
    // 문제 풀이, 채점, 타이머, 오답 저장, 필기 멀티플레이 파일은 유지합니다.
    const { getSetting: getIpepScreenSetting } = useScreenSettings('ipep');
    const formatIpepSetting = (key, fallback, values = {}) => (
        replaceSettingTokens(getIpepScreenSetting(key, fallback), values)
    );
    const ipepPageTitle = getIpepScreenSetting('page.title', ' 정보처리기사 실기문제');
    const ipepPageDesc = getIpepScreenSetting('page.description', '실기 문제은행은 즉시 채점 방식으로 연습할 수 있으며,\n실기 기출문제는 실제 시험처럼 최종 제출 후 결과를 확인하는 방식으로 제공됩니다.');
    const ipepRandomCardTitle = getIpepScreenSetting('lobby.random_card_title', ' 실기 문제은행');
    const ipepRandomCardDesc = getIpepScreenSetting('lobby.random_card_desc', '과목별 랜덤 문제를 통해 실기문제를 빠르게 연습할 수 있습니다.\n답안을 제출하면 즉시 채점 결과와 정답을 확인할 수 있습니다.');
    const ipepRandomButtonLabel = getIpepScreenSetting('lobby.random_button_label', '문제은행 입장하기');
    const ipepPastCardTitle = getIpepScreenSetting('lobby.past_card_title', ' 실기 기출문제');
    const ipepPastCardDesc = getIpepScreenSetting('lobby.past_card_desc', '연도와 회차를 선택해 실제 시험처럼 풀 수 있는 모드입니다.\n제한시간, OMR 이동, 최종 결과표, PDF 출력 기능을 제공합니다.');
    const ipepPastButtonLabel = getIpepScreenSetting('lobby.past_button_label', '기출문제 입장하기');
    const ipepThreeWeekCardTitle = getIpepScreenSetting('lobby.three_week_card_title', '3주 공략');
    const ipepThreeWeekCardDesc = getIpepScreenSetting('lobby.three_week_card_desc', '3주 커리큘럼에 맞춰 Section별 실기 문제를 섹션순 또는 랜덤 정렬로 풀 수 있습니다.');
    const ipepThreeWeekButtonLabel = getIpepScreenSetting('lobby.three_week_button_label', '3주 공략 입장하기');
    const ipepGuideText = getIpepScreenSetting('lobby.guide_text', ' 실기 문제는 주관식 답안 특성상 문항 유형에 따라 채점 기준이 다릅니다.\n시험을 시작하기 전에 답안 작성 가이드를 확인해 주세요.\n기출문제를 응시할 경우 게시판의 공지사항을 확인 후 시험을 시작해주시기 바랍니다.');
    const ipepModeLobbyLabel = getIpepScreenSetting('mode_buttons.lobby_label', '실기 로비');
    const ipepModeRandomLabel = getIpepScreenSetting('mode_buttons.random_label', '실기 문제은행');
    const ipepModePastLabel = getIpepScreenSetting('mode_buttons.past_label', '실기 기출문제');
    const ipepModeThreeWeekLabel = getIpepScreenSetting('mode_buttons.three_week_label', '3주 공략');
    // 정보처리기사 통합 페이지에서 들어온 탭에 맞춰 최초 화면을 선택합니다.
    // 기존 /ipep 단독 진입은 App.jsx에서 /cert/ipe/practical로 넘겨 실기 로비부터 보여줍니다.
    const [mode, setMode] = useState(() => ['lobby', 'random', 'past', 'threeWeek'].includes(initialMode) ? initialMode : 'lobby');
    const [subjects, setSubjects] = useState([]);
    const [catalog, setCatalog] = useState([]);

    const [selectedSubject, setSelectedSubject] = useState('ALL');
    const [randomQuestion, setRandomQuestion] = useState(null);
    const [randomAnswer, setRandomAnswer] = useState('');
    const [randomResult, setRandomResult] = useState(null);
    const randomAnswerRef = useRef(null);
    const pastAnswerRef = useRef(null);
    // 실기 문제은행/기출문제 공통 연습장 열림 상태입니다. 기존 채점 로직과 분리해서 화면 기능만 추가합니다.
    const [isDrawingOpen, setIsDrawingOpen] = useState(false);
    const [randomLoading, setRandomLoading] = useState(false);

    // 해설 이미지가 세로로 길거나 글자가 작을 때 크게 볼 수 있는 전용 이미지 뷰어 상태입니다.
    // 문제 풀이/채점 로직과 완전히 분리된 화면 편의 기능입니다.
    const [imageViewer, setImageViewer] = useState(null);
    const [imageZoom, setImageZoom] = useState(1);

    const [selectedExam, setSelectedExam] = useState(null);
    const [pastStep, setPastStep] = useState('lobby');
    const [pastQuestions, setPastQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [pastAnswers, setPastAnswers] = useState({});
    const [pastResults, setPastResults] = useState([]);
    const [timeLeft, setTimeLeft] = useState(IPEP_TOTAL_SECONDS);
    const [startTime, setStartTime] = useState(null);
    const [endTime, setEndTime] = useState(null);
    const [isSubmittingPast, setIsSubmittingPast] = useState(false);

    const userName = sessionStorage.getItem('userName') || getIpepScreenSetting('user.default_name', '사용자');
    const userId = sessionStorage.getItem('userId') || '';
    const getSessionAuth = useCallback(() => buildIpepSessionAuth(userId), [userId]);

    // 실기 채점 결과를 랭킹에 반영합니다. 실패해도 문제 풀이 흐름은 막지 않습니다.
    const saveIpepRanking = (payload) => saveIpepRankingRecord({
        apiBase: API_BASE,
        getSessionAuth,
        userId,
        userName,
        ...payload
    });

    // 실기 오답노트는 필기 오답노트와 충돌하지 않도록 별도 API에 저장합니다.
    const saveIpepWrongNotes = (payload) => saveIpepWrongNotesRecord({
        apiBase: API_BASE,
        getSessionAuth,
        userId,
        ...payload
    });

    // 실기 문제 객체의 원본 필드명을 유지하면서 오답노트에 필요한 공통 필드도 함께 채워줍니다.
    const normalizeIpepWrongQuestion = (question, userAnswer, source, result = {}) => (
        normalizeIpepWrongQuestionForSave({ question, userAnswer, source, result, selectedExam })
    );


    const pastSummary = useMemo(() => {
        const totalScore = pastResults.reduce((sum, row) => sum + Number(row.score || 0), 0);
        const maxScore = pastResults.reduce((sum, row) => sum + Number(row.maxScore || 5), 0);
        const fullCorrectCount = pastResults.filter(row => Number(row.score || 0) >= Number(row.maxScore || 5)).length;
        const isPass = totalScore >= 60 || fullCorrectCount >= 12;

        return {
            totalScore,
            maxScore,
            fullCorrectCount,
            isPass,
            passText: isPass ? '합격' : '불합격'
        };
    }, [pastResults]);

    useEffect(() => {
        fetchSubjects();
        fetchCatalog();
    }, []);

    useEffect(() => {
        if (pastStep === 'exam') return;
        if (['lobby', 'random', 'past', 'threeWeek'].includes(initialMode)) {
            setMode(initialMode);
        }
    }, [initialMode, pastStep]);

    // 실기 내부 버튼을 누를 때도 주소가 /cert/ipe/practical-* 형태로 따라가게 합니다.
    // 실제 문제 로딩, 채점, 결과 저장 로직은 기존 mode 상태를 그대로 사용합니다.
    const goIpepMode = (nextMode) => {
        if (pastStep === 'exam') {
            alert(getIpepScreenSetting('messages.block_lobby_during_exam', '실기 기출 시험 응시 중입니다. 제출 및 채점하기 전에는 실기 로비로 이동할 수 없습니다.'));
            return;
        }

        const safeMode = ['lobby', 'random', 'past', 'threeWeek'].includes(nextMode) ? nextMode : 'lobby';
        setMode(safeMode);

        if (safeMode === 'random') {
            navigate('/cert/ipe/practical-bank');
        } else if (safeMode === 'past') {
            navigate('/cert/ipe/practical-past');
        } else if (safeMode === 'threeWeek') {
            navigate('/cert/ipe/practical-three-week');
        } else {
            navigate('/cert/ipe/practical');
        }
    };

    useEffect(() => {
        if (pastStep !== 'exam') return;

        const timer = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [pastStep]);

    useEffect(() => {
        if (pastStep === 'exam' && timeLeft === 0 && !isSubmittingPast) {
            alert(getIpepScreenSetting('messages.time_over', '2시간 30분의 실기 시험 시간이 종료되었습니다. 자동으로 제출합니다.'));
            submitPastExam(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, pastStep]);

    async function fetchSubjects() {
        try {
            const res = await axios.get(`${API_BASE}/api/ipep/subjects`);
            setSubjects(Array.isArray(res.data?.data) ? res.data.data : []);
        } catch (error) {
            console.error('실기 과목 조회 실패:', error);
            setSubjects([]);
        }
    }

    async function fetchCatalog() {
        try {
            const res = await axios.get(`${API_BASE}/api/ipep/exam-catalog`);
            const rows = normalizeIpepCatalog(Array.isArray(res.data?.data) ? res.data.data : []);
            setCatalog(rows);
            setSelectedExam(rows.find(row => Number(row.isOpen) === 1) || rows[0] || null);
        } catch (error) {
            console.error('실기 기출 카탈로그 조회 실패:', error);
            setCatalog([]);
        }
    }

    const fetchRandomQuestion = useCallback(async (subjectCode = 'ALL') => {
        setRandomLoading(true);
        setRandomResult(null);
        setRandomAnswer('');

        try {
            const res = await axios.get(`${API_BASE}/api/ipep/random-question?${buildIpepRandomQuery(subjectCode)}`);
            const nextQuestion = res.data?.data || null;
            setRandomQuestion(nextQuestion);
            rememberIpepRandomQuestion(nextQuestion);
        } catch (error) {
            console.error('실기 문제은행 조회 실패:', error);
            setRandomQuestion(null);
            alert(getIpepScreenSetting('messages.random_load_failed', '실기 문제은행 문제를 불러오지 못했습니다. 서버 또는 데이터 적재 상태를 확인해 주세요.'));
        } finally {
            setRandomLoading(false);
        }
    }, [getIpepScreenSetting]);

    useEffect(() => {
        if (mode === 'random') {
            fetchRandomQuestion(selectedSubject);
        }
    }, [fetchRandomQuestion, mode, selectedSubject]);

    async function checkRandomAnswer() {
        if (!randomQuestion) {
            alert(getIpepScreenSetting('messages.no_question_to_grade', '채점할 문제가 없습니다.'));
            return;
        }

        if (!randomAnswer.trim()) {
            alert(getIpepScreenSetting('messages.need_answer', '답안을 먼저 입력해 주세요.'));
            return;
        }

        try {
            const res = await axios.post(`${API_BASE}/api/ipep/check-answer`, {
                source: randomQuestion.source,
                questionId: randomQuestion.questionId,
                userAnswer: randomAnswer
            });

            // 백엔드 채점 결과를 우선 받되, 사용자가 입력하기 어려운 주관식 예외는 프론트에서 한 번 더 보정합니다.
            // - Class/class/클래스, ㉡/ㄴ, ÷//, 원자성|Atomicity 조합 등을 처리합니다.
            // - 기존 API, 랭킹, 오답노트 저장 흐름은 그대로 유지합니다.
            const gradedResult = mergeClientIpepGrade(randomQuestion, res.data || {}, randomAnswer);
            setRandomResult(gradedResult);

            // 실기 문제은행 1문제 채점 결과를 랭킹/오답노트에 반영합니다.
            const maxScore = Number(gradedResult?.maxScore || randomQuestion?.score || 5);
            const earnedScore = Number(gradedResult?.score ?? (gradedResult?.isCorrect ? maxScore : 0));
            await saveIpepRanking({
                mode: 'random',
                totalCount: 1,
                // 부분점수라도 점수가 있으면 홈 랭킹 정답 수에 1문제로 반영합니다.
                correctCount: earnedScore >0 ? 1 : 0,
                totalScore: earnedScore,
                maxScore
            });

            if (!gradedResult?.isCorrect) {
                await saveIpepWrongNotes({
                    source: 'ipep_random',
                    wrongQuestions: [normalizeIpepWrongQuestion(randomQuestion, randomAnswer, 'ipep_random', gradedResult)]
                });
            }
        } catch (error) {
            console.error('실기 문제은행 채점 실패:', error);
            alert(getIpepScreenSetting('messages.random_check_failed', '채점 중 오류가 발생했습니다.'));
        }
    }

    async function saveThreeWeekWrongAnswer({ question, userAnswer, result }) {
        if (!question || result?.isCorrect) return;
        await saveIpepWrongNotes({
            source: 'ipep_three_week',
            wrongQuestions: [normalizeIpepWrongQuestion(question, userAnswer, 'ipep_three_week', result)]
        });
    }

    async function startPastExam(examRow) {
        if (!examRow) return;

        if (Number(examRow.isOpen) !== 1) {
            alert(examRow.noticeMessage || getIpepScreenSetting('messages.not_open_notice', '현재 오픈베타 테스트 중으로, 빠른 시일 내에 추가할 예정입니다.'));
            return;
        }

        try {
            const res = await axios.get(`${API_BASE}/api/ipep/past-exam?year=${examRow.examYear}&session=${examRow.examSession}`);

            if (!res.data?.success || !res.data?.isOpen) {
                alert(res.data?.msg || getIpepScreenSetting('messages.not_open_notice', '현재 오픈베타 테스트 중으로, 빠른 시일 내에 추가할 예정입니다.'));
                return;
            }

            const questions = Array.isArray(res.data?.data) ? res.data.data : [];
            if (questions.length === 0) {
                alert(getIpepScreenSetting('messages.past_empty', '해당 회차의 실기 문제가 아직 준비되지 않았습니다.'));
                return;
            }

            setSelectedExam(examRow);
            setPastQuestions(questions);
            setPastAnswers({});
            setPastResults([]);
            setCurrentIndex(0);
            setTimeLeft(IPEP_TOTAL_SECONDS);
            setStartTime(new Date());
            setEndTime(null);
            setPastStep('exam');

            if (typeof setIsExamActive === 'function') {
                setIsExamActive(true);
            }

            // 실제 시험 느낌을 위해 전체화면을 요청하고,
            // 새로고침/뒤로가기/메뉴 이동/탭 이탈 감지는 App.jsx의 공통 보호 로직이 담당합니다.
            requestExamFullscreen();
        } catch (error) {
            console.error('실기 기출문제 시작 실패:', error);
            alert(getIpepScreenSetting('messages.past_start_failed', '실기 기출문제를 불러오는 중 오류가 발생했습니다.'));
        }
    }

    function updatePastAnswer(questionId, value) {
        setPastAnswers(prev => ({ ...prev, [questionId]: value }));
    }

    async function gradeOnePastQuestion(question, userAnswer) {
        // 사용자가 아무것도 입력하지 않은 문항은 '틀림'이 아니라 '미응시/미입력'으로 처리합니다.
        // 따라서 채점 점수는 0점이지만 오답노트에는 저장하지 않습니다.
        const trimmedAnswer = String(userAnswer || '').trim();
        if (!trimmedAnswer) {
            return {
                question,
                userAnswer: '',
                correctAnswer: question.answerRaw || question.answerNormalized || '',
                gradingPolicy: question.gradingPolicy,
                requiresSelfCheck: false,
                isCorrect: false,
                isBlank: true,
                score: 0,
                maxScore: Number(question.score || 5)
            };
        }

        const res = await axios.post(`${API_BASE}/api/ipep/check-answer`, {
            source: 'ipep_past',
            questionId: question.questionId,
            userAnswer: trimmedAnswer
        });

        const data = res.data || {};
        const gradedData = mergeClientIpepGrade(question, data, trimmedAnswer);

        // 프론트 예외처리로 명백히 정답 처리된 경우에는 SELF_CHECK 확인창을 띄우지 않습니다.
        // 예: 사용자가 "ㄴ, ㄷ, ㄱ"처럼 입력했지만 DB 정답이 "㉡, ㉢, ㉠"인 경우
        if (gradedData.isCorrect && gradedData.detail?.clientExceptionApplied) {
            return {
                question,
                userAnswer: trimmedAnswer,
                correctAnswer: gradedData.correctAnswer || '',
                gradingPolicy: gradedData.gradingPolicy || data.gradingPolicy || question.gradingPolicy,
                requiresSelfCheck: false,
                isCorrect: true,
                isBlank: false,
                score: Number(gradedData.score || gradedData.maxScore || 5),
                maxScore: Number(gradedData.maxScore || 5)
            };
        }

        if (data.requiresSelfCheck) {
            // 긴 서술형은 자동채점보다 정답 예시와 직접 비교해 판정하도록 안내합니다.
            // 이 처리는 백엔드의 SELF_CHECK 정책을 존중하는 안전장치다.
            const ok = window.confirm(
                formatIpepSetting('messages.self_check_confirm', '[자기채점 필요]\n\n문제: {question}\n\n내 답안:\n{userAnswer}\n\n정답 예시:\n{correctAnswer}\n\n정답으로 처리할까요?', {
                    question: question.questionText,
                    userAnswer: trimmedAnswer || getIpepScreenSetting('result.blank_answer', '(미입력)'),
                    correctAnswer: gradedData.correctAnswer || data.correctAnswer || ''
                })
            );

            return {
                question,
                userAnswer: trimmedAnswer,
                correctAnswer: gradedData.correctAnswer || data.correctAnswer || '',
                gradingPolicy: data.gradingPolicy || question.gradingPolicy,
                requiresSelfCheck: true,
                isCorrect: ok,
                isBlank: false,
                score: ok ? Number(data.maxScore || gradedData.maxScore || 5) : 0,
                maxScore: Number(data.maxScore || gradedData.maxScore || 5)
            };
        }

        return {
            question,
            userAnswer: trimmedAnswer,
            correctAnswer: gradedData.correctAnswer || '',
            gradingPolicy: gradedData.gradingPolicy || data.gradingPolicy || question.gradingPolicy,
            requiresSelfCheck: false,
            isCorrect: Boolean(gradedData.isCorrect),
            isBlank: false,
            score: Number(gradedData.score || 0),
            maxScore: Number(gradedData.maxScore || 5)
        };
    }

    async function submitPastExam(autoSubmit = false) {
        if (isSubmittingPast) return;

        if (!autoSubmit) {
            const answeredCount = pastQuestions.filter(q => String(pastAnswers[q.questionId] || '').trim()).length;
            const confirmMessage = formatIpepSetting('messages.submit_confirm', '현재 {total}문제 중 {answered}문제 답안이 입력되었습니다.\n최종 제출 후에는 답안을 수정할 수 없습니다. 제출하시겠습니까?', {
                total: pastQuestions.length,
                answered: answeredCount
            });
            if (!window.confirm(confirmMessage)) return;
        }

        setIsSubmittingPast(true);

        try {
            const results = [];

            for (const question of pastQuestions) {
                const userAnswer = String(pastAnswers[question.questionId] || '').trim();
                const graded = await gradeOnePastQuestion(question, userAnswer);
                results.push(graded);
            }

            setPastResults(results);

            // 실기 기출문제 최종 채점 결과를 랭킹/오답노트에 반영합니다.
            // - 점수는 부분점수까지 누적합니다.
            // - 정답률 표기용 correctCount는 1점 이상 받은 문제 수로 계산합니다.
            // - 20문제를 전부 공백 제출한 경우에는 랭킹에 반영하지 않습니다.
            const totalScore = results.reduce((sum, row) => sum + Number(row.score || 0), 0);
            const maxScore = results.reduce((sum, row) => sum + Number(row.maxScore || 5), 0);
            const answeredCountForRanking = results.filter(row => !row.isBlank).length;
            const correctCount = results.filter(row => Number(row.score || 0) >0).length;
            if (answeredCountForRanking >0) {
                await saveIpepRanking({
                    mode: 'past',
                    totalCount: results.length,
                    correctCount,
                    totalScore,
                    maxScore,
                    year: selectedExam?.examYear,
                    session: selectedExam?.examSession
                });
            }

            const wrongQuestions = results
                // 빈 답안은 '미입력'으로 보고 오답노트 저장 대상에서 제외합니다.
                .filter(row => !row.isBlank && Number(row.score || 0) < Number(row.maxScore || 5))
                .map(row => normalizeIpepWrongQuestion(row.question, row.userAnswer, 'ipep_past', row));
            await saveIpepWrongNotes({
                source: 'ipep_past',
                wrongQuestions,
                year: selectedExam?.examYear,
                session: selectedExam?.examSession
            });

            setEndTime(new Date());
            setPastStep('result');

            if (typeof setIsExamActive === 'function') {
                setIsExamActive(false);
            }
        } catch (error) {
            console.error('실기 기출 최종 채점 실패:', error);
            alert(getIpepScreenSetting('messages.past_submit_failed', '최종 채점 중 오류가 발생했습니다. 답안은 브라우저 화면에 남아 있으니 다시 시도해 주세요.'));
        } finally {
            setIsSubmittingPast(false);
        }
    }

    function exportPastResultPDF() {
        if (pastResults.length === 0) {
            alert(getIpepScreenSetting('messages.no_pdf_result', '출력할 실기 결과가 없습니다.'));
            return;
        }

        const wrongRows = pastResults.filter(row => !row.isBlank && Number(row.score || 0) < Number(row.maxScore || 5));
        const printWindow = window.open('', '_blank');
        const blankAnswerText = getIpepScreenSetting('result.blank_answer', '(미입력)');
        const correctSymbol = getIpepScreenSetting('result.correct_symbol', 'O');
        const wrongSymbol = getIpepScreenSetting('result.wrong_symbol', 'X');
        const pdfTitle = getIpepScreenSetting('pdf.title', '정보처리기사 실기 결과표');
        const pdfWrongTitle = getIpepScreenSetting('pdf.wrong_title', '오답 및 해설');

        const rowsHtml = pastResults.map((row, index) => {
            const qNo = getQuestionNo(row.question, index);
            const isFullCorrect = Number(row.score || 0) >= Number(row.maxScore || 5);

            return `
                <tr>
                    <td>${escapeHtml(formatIpepSetting('past.question_no', '{number}번', { number: qNo }))}</td>
                    <td>${escapeHtml(row.userAnswer || blankAnswerText)}</td>
                    <td>${escapeHtml(row.correctAnswer || '')}</td>
                    <td>${row.score} / ${row.maxScore}</td>
                    <td class="${isFullCorrect ? 'correct' : 'wrong'}">${escapeHtml(isFullCorrect ? correctSymbol : wrongSymbol)}</td>
                </tr>
            `;
        }).join('');

        const wrongHtml = wrongRows.length >0
            ? wrongRows.map((row, index) => {
                const q = row.question;
                const qNo = getQuestionNo(q, index);
                const choiceImg = q.choiceImgPath ? `${window.location.origin}${getImgSrc(q.choiceImgPath)}` : '';
                const explanationImg = q.explanationImgPath ? `${window.location.origin}${getImgSrc(q.explanationImgPath)}` : '';

                return `
                    <div class="question-box">
                        <div class="q-meta">${escapeHtml(formatIpepSetting('pdf.question_meta', '{year}년 {session}회차 {number}번 · {policy}', { year: q.examYear || selectedExam?.examYear, session: q.examSession || selectedExam?.examSession, number: qNo, policy: q.gradingPolicy || '' }))}</div>
                        <h3>${escapeHtml(getIpepScreenSetting('pdf.question_prefix', 'Q. '))}${escapeHtml(q.questionText || '')}</h3>
                        ${choiceImg ? `<img src="${choiceImg}" class="q-img" onerror=" this.style.display='none'" />` : ''}
                        <p><strong>${escapeHtml(getIpepScreenSetting('pdf.my_answer_label', '내 답안:'))}</strong> ${escapeHtml(row.userAnswer || blankAnswerText)}</p>
                        <p><strong>${escapeHtml(getIpepScreenSetting('pdf.correct_answer_label', '정답:'))}</strong> ${escapeHtml(row.correctAnswer || '')}</p>
                        <p><strong>${escapeHtml(getIpepScreenSetting('pdf.score_label', '획득 점수:'))}</strong> ${row.score} / ${row.maxScore}</p>
                        ${explanationImg ? `<h4>${escapeHtml(getIpepScreenSetting('pdf.explanation_image_title', '해설 이미지'))}</h4><img src="${explanationImg}" class="q-img" onerror=" this.style.display='none'" />` : ''}
                    </div>
                `;
            }).join('')
            : `<div class="perfect">${escapeHtml(getIpepScreenSetting('pdf.no_wrong', ' 틀린 문제가 없습니다.'))}</div>`;

        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8" />
                <title>${escapeHtml(pdfTitle)}</title>
                <style>body { font-family: 'Malgun Gothic', Arial, sans-serif; color: #222; line-height: 1.6; padding: 28px; max-width: 900px; margin: 0 auto; }
                    h1, h2 { text-align: center; }
                    .result-box { border: 3px solid ${pastSummary.isPass ? '#10b981' : '#ef4444'}; border-radius: 12px; padding: 24px; text-align: center; margin: 22px 0; background: ${pastSummary.isPass ? '#ecfdf5' : '#fef2f2'}; }
                    .score { font-size: 42px; font-weight: 900; color: ${pastSummary.isPass ? '#10b981' : '#ef4444'}; }
                    .time-box { display: inline-block; text-align: left; background: white; border: 1px solid #ddd; border-radius: 8px; padding: 14px 18px; margin-top: 16px; }
                    table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px; }
                    th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; }
                    th { background: #f3f4f6; }
                    .correct { color: #059669; font-weight: 900; }
                    .wrong { color: #dc2626; font-weight: 900; }
                    .question-box { page-break-inside: avoid; border-bottom: 1px dashed #bbb; padding: 22px 0; }
                    .q-meta { color: #555; font-weight: 700; font-size: 13px; }
                    .q-img { max-width: 100%; max-height: 420px; border: 1px solid #ddd; padding: 6px; margin: 10px 0; }
                    .perfect { text-align: center; padding: 30px; background: #ecfdf5; border-radius: 10px; color: #059669; font-weight: 900; }
                    @media print { .question-box { page-break-inside: avoid; } }
                </style>
            </head>
            <body>
                <h1>${escapeHtml(pdfTitle)}</h1>
                <h2>${escapeHtml(formatIpepSetting('past.exam_badge', '{year}년 {session}회차', { year: selectedExam?.examYear || '', session: selectedExam?.examSession || '' }))}</h2>

                <div class="result-box">
                    <div class="score">${escapeHtml(formatIpepSetting('result.score_value', '{score}점 / {maxScore}점', { score: pastSummary.totalScore, maxScore: pastSummary.maxScore }))}</div>
                    <h2>${escapeHtml(pastSummary.isPass ? getIpepScreenSetting('result.pdf_pass_title', ' 합격입니다.') : getIpepScreenSetting('result.pdf_fail_title', ' 불합격입니다.'))}</h2>
                    <p>${escapeHtml(formatIpepSetting('result.pdf_summary', '{name}님 · 정답 처리 {count}문제', { name: userName, count: pastSummary.fullCorrectCount }))}</p>
                    <div class="time-box">
                        <div>${escapeHtml(getIpepScreenSetting('time.start_label', '시작 일시: '))}<strong>${escapeHtml(formatDateTime(startTime))}</strong></div>
                        <div>${escapeHtml(getIpepScreenSetting('time.end_label', '종료 일시: '))}<strong>${escapeHtml(formatDateTime(endTime))}</strong></div>
                        <div>${escapeHtml(getIpepScreenSetting('time.elapsed_label', '실제 소요 시간: '))}<strong>${escapeHtml(formatTime(IPEP_TOTAL_SECONDS - timeLeft))}</strong></div>
                    </div>
                </div>

                <h2>${escapeHtml(getIpepScreenSetting('result.detail_table_title', '상세 채점표'))}</h2>
                <table>
                    <thead>
                        <tr>
                            <th>${escapeHtml(getIpepScreenSetting('result.table_no_header', '문제 번호'))}</th>
                            <th>${escapeHtml(getIpepScreenSetting('result.table_my_answer_header', '내 답안'))}</th>
                            <th>${escapeHtml(getIpepScreenSetting('result.table_correct_answer_header', '실제 정답'))}</th>
                            <th>${escapeHtml(getIpepScreenSetting('result.table_score_header', '점수'))}</th>
                            <th>${escapeHtml(getIpepScreenSetting('result.table_result_header', '결과'))}</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>

                <h2 style="page-break-before: always;">${escapeHtml(pdfWrongTitle)}</h2>
                ${wrongHtml}

                <script>window.onload = function() {
                        setTimeout(function() { window.print(); }, 500);
                    };
                </script>
            </body>
            </html>
        `);

        printWindow.document.close();
    }

    function resetPastToLobby() {
        // 실기 기출 시험 중에는 제출 전까지 로비로 빠져나가지 못하게 막습니다.
        if (pastStep === 'exam') {
            alert(getIpepScreenSetting('messages.block_lobby_during_exam', '실기 기출 시험 응시 중입니다. 제출 및 채점하기 전에는 실기 로비로 이동할 수 없습니다.'));
            return;
        }

        setPastStep('lobby');
        setPastQuestions([]);
        setPastAnswers({});
        setPastResults([]);
        setCurrentIndex(0);
        setTimeLeft(IPEP_TOTAL_SECONDS);
        setStartTime(null);
        setEndTime(null);

        if (typeof setIsExamActive === 'function') {
            setIsExamActive(false);
        }
    }







    function openImageViewer(imgPath, title = getIpepScreenSetting('image.viewer_default_title', '이미지')) {
        const src = getImgSrc(imgPath);
        if (!src) return;

        // 이미지 뷰어를 열 때마다 확대 배율을 기본값으로 되돌려 사용자가 헷갈리지 않게 합니다.
        setImageZoom(1);
        setImageViewer({ src, title });
    }

    function closeImageViewer() {
        setImageViewer(null);
        setImageZoom(1);
    }








    function renderPastExam() {
        const currentQuestion = pastQuestions[currentIndex];
        if (!currentQuestion) return null;

        const answeredCount = pastQuestions.filter(q => String(pastAnswers[q.questionId] || '').trim()).length;

        return (
            <div
                className="ipep-past-exam-workspace" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}
            >
                <section style={{ ...panelStyle, flex: '1 1 680px', minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderBottom: '1px solid var(--wgs-border)', paddingBottom: '12px', marginBottom: '18px' }}>
                        <strong style={{ color: 'var(--wgs-blue-soft)', fontSize: '18px' }}>{formatIpepSetting('past.exam_badge', '{year}년 {session}회차', { year: selectedExam?.examYear, session: selectedExam?.examSession })}</strong>
                        <span style={{ color: 'var(--wgs-muted)' }}>{currentIndex + 1} / {pastQuestions.length}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                        <span style={{ border: '1px solid #3b82f6', color: 'var(--wgs-blue-soft)', borderRadius: '20px', padding: '5px 10px', fontSize: '12px', fontWeight: '900' }}>{getIpepScreenSetting('past.badge', '기출문제')}</span>
                        <span style={{ border: '1px solid #3b82f6', color: 'var(--wgs-blue-soft)', borderRadius: '20px', padding: '5px 10px', fontSize: '12px', fontWeight: '900' }}>{formatIpepSetting('past.exam_badge', '{year}년 {session}회차', { year: selectedExam?.examYear, session: selectedExam?.examSession })}</span>
                        <span style={{ border: '1px solid #3b82f6', color: 'var(--wgs-blue-soft)', borderRadius: '20px', padding: '5px 10px', fontSize: '12px', fontWeight: '900' }}>{formatIpepSetting('past.question_no', '{number}번', { number: getQuestionNo(currentQuestion, currentIndex) })}</span>
                        <span style={{ border: '1px solid #3b82f6', color: 'var(--wgs-blue-soft)', borderRadius: '20px', padding: '5px 10px', fontSize: '12px', fontWeight: '900' }}>{formatIpepSetting('past.grading_policy_badge', '채점유형 {policy}', { policy: currentQuestion.gradingPolicy })}</span>
                    </div>

                    <div className="exam-question-title-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                        <h3 style={{ color: 'var(--wgs-text)', lineHeight: 1.7, fontSize: '20px', margin: 0 }}>{currentQuestion.questionText}</h3>
                        {/* 실기 기출문제 응시 중 현재 문항을 관리자에게 즉시 신고하는 버튼입니다. */}
                        <ErrorReportButton
                            examType={getIpepScreenSetting('report.exam_type', '실기')} mode={getIpepScreenSetting('report.past_mode', '기출문제')} questionInfo={{
                                year: selectedExam?.examYear,
                                round: selectedExam?.examSession,
                                number: getQuestionNo(currentQuestion, currentIndex),
                                subject: currentQuestion?.subjectName || currentQuestion?.subjectCode,
                                title: currentQuestion?.questionText,
                            }}
                        />
                    </div>
                    <IpepQuestionImages
                        question={currentQuestion}
                        openImageViewer={openImageViewer}
                        choiceAlt={getIpepScreenSetting('image.choice_alt', '보기 이미지')}
                        choiceViewerTitle={getIpepScreenSetting('image.choice_viewer_title', '보기 이미지 크게 보기')}
                        choiceButtonLabel={getIpepScreenSetting('image.choice_button', ' 보기 이미지 크게 보기')}
                    />

                    <textarea
                        ref={pastAnswerRef}
                        value={pastAnswers[currentQuestion.questionId] || ''}
                        onChange={(e) => updatePastAnswer(currentQuestion.questionId, e.target.value)}
                        placeholder={getIpepScreenSetting('form.answer_placeholder', '여기에 실기 답안을 입력해 주세요. 대소문자, 띄어쓰기, 쉼표 유무 차이는 채점 시 최대한 허용됩니다.')} style={{ width: '100%', minHeight: '140px', boxSizing: 'border-box', background: 'var(--wgs-input-bg)', color: 'var(--wgs-text)', border: '1px solid var(--wgs-button-muted)', borderRadius: '10px', padding: '14px', lineHeight: 1.6, resize: 'vertical' }}
                    />

                    <IpepSpecialSymbolPad
                        textareaRef={pastAnswerRef}
                        value={pastAnswers[currentQuestion.questionId] || ''}
                        onChange={(nextValue) => updatePastAnswer(currentQuestion.questionId, nextValue)}
                    />

                    {/* 실기 기출문제 응시 중에도 풀이 과정을 적을 수 있도록 연습장을 추가합니다. */}
                    <button
                        type="button" onClick={() => setIsDrawingOpen(prev => !prev)}
                        style={{ ...baseButtonStyle, width: '100%', marginTop: '10px', background: 'var(--wgs-practice-toggle-bg)', border: '1px solid #3b82f6' }}
                    >
                         {isDrawingOpen ? getIpepScreenSetting('buttons.close_drawing', '연습장 닫기') : getIpepScreenSetting('buttons.open_drawing', '연습장 열기')}
                    </button>
                    {isDrawingOpen && <DrawingBoard />}

                    <div className="ipep-action-row" style={{ display: 'flex', gap: '12px', marginTop: '18px' }}>
                        <button
                            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                            disabled={currentIndex === 0 || isSubmittingPast}
                            style={{ ...baseButtonStyle, background: currentIndex === 0 ? 'var(--wgs-button-muted)' : 'var(--wgs-button-muted)', cursor: currentIndex === 0 ? 'not-allowed' : 'pointer' }}
                        >
                            {getIpepScreenSetting('buttons.prev', '이전')}
                        </button>
                        <button
                            onClick={() => submitPastExam(false)}
                            disabled={isSubmittingPast}
                            style={{ ...baseButtonStyle, background: '#ef4444', flex: 1, cursor: isSubmittingPast ? 'wait' : 'pointer' }}
                        >
                            {isSubmittingPast ? getIpepScreenSetting('buttons.checking', '채점 중...') : getIpepScreenSetting('buttons.submit_grade', '제출 및 채점하기')}
                        </button>
                        <button
                            onClick={() => setCurrentIndex(Math.min(pastQuestions.length - 1, currentIndex + 1))}
                            disabled={currentIndex === pastQuestions.length - 1 || isSubmittingPast}
                            style={{ ...baseButtonStyle, background: currentIndex === pastQuestions.length - 1 ? 'var(--wgs-button-muted)' : '#3b82f6', cursor: currentIndex === pastQuestions.length - 1 ? 'not-allowed' : 'pointer' }}
                        >
                            {getIpepScreenSetting('buttons.next', '다음')}
                        </button>
                    </div>

                    <div style={{ marginTop: '16px', color: 'var(--wgs-muted)', fontSize: '13px' }}>
                        {formatIpepSetting('past.answered_count', '현재 입력 완료: {answered} / {total}문제', { answered: answeredCount, total: pastQuestions.length })}
                    </div>
                </section>

                <aside className="ipep-past-exam-omr" style={{ flex: '0 0 260px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ background: 'var(--wgs-panel)', padding: '16px', border: '1px solid var(--wgs-border)', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', textAlign: 'center' }}>
                        <div style={{ color: 'var(--wgs-blue-soft)', fontWeight: '900', marginBottom: '6px' }}>{getIpepScreenSetting('past.remaining_time_title', '남은 시간')}</div>
                        <div style={{ color: timeLeft <= 600 ? '#ef4444' : '#10b981', fontSize: '24px', fontWeight: '900' }}>{formatTime(timeLeft)}</div>
                    </div>
                    <div style={{ background: 'var(--wgs-card)', border: '1px solid var(--wgs-border)', borderTop: 'none', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', padding: '16px', overflowY: 'auto' }}>
                        <h4 style={{ color: 'var(--wgs-text)', textAlign: 'center', margin: '0 0 14px 0' }}>{getIpepScreenSetting('past.omr_title', '진행 현황 (OMR)')}</h4>
                        <div className="ipep-omr-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                            {pastQuestions.map((question, index) => {
                                const answered = String(pastAnswers[question.questionId] || '').trim().length >0;
                                const active = index === currentIndex;

                                return (
                                    <button
                                        key={question.questionId}
                                        onClick={() => setCurrentIndex(index)}
                                        style={{
                                            height: '42px',
                                            borderRadius: '7px',
                                            border: active ? '2px solid #fcd34d' : '1px solid var(--wgs-border)',
                                            background: answered ? '#10b981' : 'var(--wgs-input-bg)',
                                            color: 'var(--wgs-text)',
                                            fontWeight: '900',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {getQuestionNo(question, index)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </aside>
            </div>
        );
    }



    return (
        <div className="ipep-page exam-page wgs-typography-scope" style={pageBoxStyle}>
            <IpepImageViewer
                imageViewer={imageViewer}
                imageZoom={imageZoom}
                setImageZoom={setImageZoom}
                closeImageViewer={closeImageViewer}
                zoomOutLabel={getIpepScreenSetting('image.zoom_out_button', '축소')}
                zoomInLabel={getIpepScreenSetting('image.zoom_in_button', '확대')}
                openNewWindowLabel={getIpepScreenSetting('image.open_new_window_button', '새 창')}
                closeLabel={getIpepScreenSetting('image.close_button', '닫기')}
            />
            {/* 필기 로비와 같은 제목 크기/색상 기준으로 통일하고, 제목 내용은 실기 페이지용으로 유지합니다. */}
            {/* 실기 페이지 제목은 필기 로비와 같은 공통 페이지 제목 클래스를 사용합니다. */}
            <h2 className="wgs-page-title" style={{ color: 'var(--wgs-title)', fontSize: '28px', fontWeight: '900', lineHeight: 1.35, margin: '0 0 12px 0' }}>{ipepPageTitle}</h2>
            {mode === 'lobby' && pastStep === 'lobby' && (
                <p style={{ color: 'var(--wgs-text)', fontSize: '16px', fontWeight: '500', lineHeight: 1.7, margin: '0 0 24px 0' }}>
                    {ipepPageDesc.split('\n').map((line, index) => (
                        <React.Fragment key={`${line}-${index}`}>{line}{index < ipepPageDesc.split('\n').length - 1 && <br />}</React.Fragment>
                    ))}
                </p>
            )}

            {pastStep === 'exam'? (
                renderPastExam()
            ) : pastStep === 'result'? (
                <IpepPastResult
                    pastSummary={pastSummary}
                    userName={userName}
                    startTime={startTime}
                    endTime={endTime}
                    timeLeft={timeLeft}
                    pastQuestions={pastQuestions}
                    pastResults={pastResults}
                    exportPastResultPDF={exportPastResultPDF}
                    resetPastToLobby={resetPastToLobby}
                    startPastExam={startPastExam}
                    selectedExam={selectedExam}
                    getText={getIpepScreenSetting}
                    formatText={formatIpepSetting}
                />
            ) : mode === 'lobby'? (
                <IpepLobby
                    goIpepMode={goIpepMode}
                    ipepRandomCardTitle={ipepRandomCardTitle}
                    ipepRandomCardDesc={ipepRandomCardDesc}
                    ipepRandomButtonLabel={ipepRandomButtonLabel}
                    ipepPastCardTitle={ipepPastCardTitle}
                    ipepPastCardDesc={ipepPastCardDesc}
                    ipepPastButtonLabel={ipepPastButtonLabel}
                    ipepThreeWeekCardTitle={ipepThreeWeekCardTitle}
                    ipepThreeWeekCardDesc={ipepThreeWeekCardDesc}
                    ipepThreeWeekButtonLabel={ipepThreeWeekButtonLabel}
                    ipepGuideText={ipepGuideText}
                />
            ) : (
                <>
                    <IpepModeButtons
                        mode={mode}
                        goIpepMode={goIpepMode}
                        lobbyButtonLabel={ipepModeLobbyLabel}
                        randomButtonLabel={ipepModeRandomLabel}
                        pastButtonLabel={ipepModePastLabel}
                        threeWeekButtonLabel={ipepModeThreeWeekLabel}
                    />
                    <IpepGuide
                        guideTitle={getIpepScreenSetting('guide.title', '답안 작성 가이드')}
                        guideText={getIpepScreenSetting('guide.items', '용어형: 영어 대소문자, 앞뒤 공백, 일부 문장부호는 완화하여 채점합니다.\n여러 답안형: 쉼표(,) 또는 줄바꿈으로 구분하여 입력합니다. 예: 원자성, 독립성\nSQL형: 대소문자와 불필요한 공백은 완화하지만 SQL 문법 기호는 정확히 작성해야 합니다.\n코드 출력형: 대소문자, 공백, 줄바꿈이 중요하므로 출력 결과를 최대한 정확히 입력해야 합니다.\n긴 서술형: 자동채점이 어려운 문항은 최종 제출 시 정답 예시를 보고 직접 맞음/틀림을 선택합니다.')}
                    />
                    {mode === 'random' ? (
                        <IpepRandomMode
                            subjects={subjects}
                            selectedSubject={selectedSubject}
                            setSelectedSubject={setSelectedSubject}
                            randomLoading={randomLoading}
                            randomQuestion={randomQuestion}
                            randomAnswer={randomAnswer}
                            setRandomAnswer={setRandomAnswer}
                            randomResult={randomResult}
                            randomAnswerRef={randomAnswerRef}
                            isDrawingOpen={isDrawingOpen}
                            setIsDrawingOpen={setIsDrawingOpen}
                            checkRandomAnswer={checkRandomAnswer}
                            fetchRandomQuestion={fetchRandomQuestion}
                            openImageViewer={openImageViewer}
                            getText={getIpepScreenSetting}
                            formatText={formatIpepSetting}
                        />
                    ) : mode === 'past' ? <IpepPastLobby
                            catalog={catalog}
                            selectedExam={selectedExam}
                            setSelectedExam={setSelectedExam}
                            startPastExam={startPastExam}
                            getText={getIpepScreenSetting}
                            formatText={formatIpepSetting}
                        /> : <IpepThreeWeekPanel
                            openImageViewer={openImageViewer}
                            getText={getIpepScreenSetting}
                            formatText={formatIpepSetting}
                            onWrongAnswer={saveThreeWeekWrongAnswer}
                        />}
                </>
            )}
        </div>
    );
}

export default IpepPractice;
