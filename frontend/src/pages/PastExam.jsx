// 필기 기출문제 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import DrawingBoard from './DrawingBoard';
import ErrorReportButton from "../components/ErrorReportButton";

const API_BASE = "";

// 필기 기출 연도/회차 카탈로그 정규화 유틸
// ------------------------------------------------------------
// 화면에서 2021~2025, 1~3회차 같은 값을 하드코딩하지 않고,
// 서버 DB에 실제 존재하는 연도/회차만 선택창에 표시하기 위한 함수입니다.
const normalizeWrittenExamCatalog = (rawCatalog = []) => {
    const map = new Map();

    (Array.isArray(rawCatalog) ? rawCatalog : []).forEach((item) => {
        const year = Number(item?.year);
        const rawSessions = Array.isArray(item?.sessions) ? item.sessions : [item?.session];

        if (!Number.isFinite(year)) return;

        if (!map.has(year)) {
            map.set(year, { year, sessions: [] });
        }

        const entry = map.get(year);
        rawSessions
            .map((session) => Number(session))
            .filter((session) => Number.isFinite(session))
            .forEach((session) => {
                if (!entry.sessions.includes(session)) {
                    entry.sessions.push(session);
                }
            });
    });

    return Array.from(map.values())
        .map((entry) => ({
            ...entry,
            sessions: entry.sessions.sort((a, b) => a - b),
        }))
        .filter((entry) => entry.sessions.length >0)
        .sort((a, b) => b.year - a.year);
};

const getSubjectName = (id) => {
    try {
        if (id === undefined || id === null || id === '') return "과목 정보 없음";
        const strId = String(id).trim();
        const lastChar = strId.charAt(strId.length - 1);

        switch (lastChar) {
            case "0": return "1과목 : 소프트웨어 설계";
            case "1": return "2과목 : 소프트웨어 개발";
            case "2": return "3과목 : 데이터베이스 구축";
            case "3": return "4과목 : 프로그래밍 언어 활용";
            case "4": return "5과목 : 정보시스템 구축 관리";
            default: return `과목 : ${strId}`; 
        }
    } catch (e) {
        return "과목 정보 없음";
    }
};

//  날짜 포맷팅 함수 추가 (YYYY년 MM월 DD일 HH:mm:ss)
const formatDateTime = (date) => {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}년 ${m}월 ${d}일 ${h}:${min}:${s}`;
};


// 필기 해설 텍스트 추출 유틸
// ------------------------------------------------------------
// 문제은행/기출/오답노트 API 응답에서 해설 컬럼명이 조금씩 달라도
// 화면과 PDF 출력부가 같은 방식으로 해설을 찾을 수 있도록 통일합니다.
// 기존 채점 로직은 바꾸지 않고, 출력에 필요한 값만 안전하게 읽습니다.
const getWrittenExplanation = (item) => {
    const raw = item?.explanation_text
        || item?.explanationText
        || item?.explanation
        || item?.answer_explanation
        || item?.answerExplanation
        || '';

    return String(raw || '').trim();
};

// PDF 출력 HTML 문자 이스케이프 유틸
// ------------------------------------------------------------
// 새 창에 문자열을 직접 document.write 할 때 <, >, &, 따옴표 등이
// HTML 태그처럼 해석되는 것을 막아 PDF 출력 깨짐을 방지합니다.
const escapeHtml = (value) => {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// 시험 시작 버튼 클릭 직후 전체화면을 요청합니다.
// 브라우저 정책상 전체화면은 사용자 클릭 이벤트 안에서만 허용되므로 App.jsx가 아니라 시험 시작 함수에서 호출합니다.
const requestExamFullscreen = () => {
    try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    } catch (error) {
        // 전체화면 요청 실패는 브라우저 정책 차이일 수 있으므로 시험 시작 자체를 막지 않습니다.
        console.warn('필기 기출 전체화면 요청 실패:', error);
    }
};

const PastExam = ({ isExamActive, setIsExamActive }) => {
    // 필기 기출문제에서 필기 로비(/cert/ipe/written)로 돌아가기 위해 사용합니다.
    const navigate = useNavigate();
    const [step, setStep] = useState(1); 
    const [selectedYear, setSelectedYear] = useState('');
    const [selectedSession, setSelectedSession] = useState('');
    const [questions, setQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [userAnswers, setUserAnswers] = useState({});
    const [isSubmitted, setIsSubmitted] = useState(false);
    
    const [myRankData, setMyRankData] = useState(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [subjectScores, setSubjectScores] = useState([0, 0, 0, 0, 0]);
    const [examResult, setExamResult] = useState({ isPass: false, average: 0, failReason: '' });

    const [timeLeft, setTimeLeft] = useState(9000);
    
    const [showDrawing, setShowDrawing] = useState(false); 

    //  시작 시간과 종료 시간을 저장하는 상태를 추가합니다.
    const [startTime, setStartTime] = useState(null);
    const [endTime, setEndTime] = useState(null);

    const userId = sessionStorage.getItem('userId');
    const userName = sessionStorage.getItem('userName');

    // - 2026년 1회차처럼 새 데이터가 추가되면 프론트 코드를 다시 수정하지 않아도 자동으로 표시됩니다.
    // - API 실패 시에는 선택창을 비워서 유효하지 않은 기본값으로 시험을 시작하지 않게 합니다.
    const [writtenExamCatalog, setWrittenExamCatalog] = useState([]);

    const YEARS = writtenExamCatalog.map((item) => item.year);
    const selectedYearCatalog = writtenExamCatalog.find((item) => String(item.year) === String(selectedYear));
    const SESSIONS = selectedYearCatalog?.sessions || [];

    useEffect(() => {
        let isMounted = true;

        const fetchWrittenExamCatalog = async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/exam-catalogs`);
                const catalog = normalizeWrittenExamCatalog(res.data?.data?.written || res.data?.written || []);

                if (!isMounted) return;

                setWrittenExamCatalog(catalog);

                const latestYear = catalog[0]?.year || '';
                const latestSession = catalog[0]?.sessions?.[0] || '';

                setSelectedYear(latestYear);
                setSelectedSession(latestSession);
            } catch (error) {
                console.error('필기 기출 연도/회차 카탈로그 불러오기 실패:', error);
                if (!isMounted) return;
                setWrittenExamCatalog([]);
                setSelectedYear('');
                setSelectedSession('');
            }
        };

        fetchWrittenExamCatalog();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        const currentCatalog = writtenExamCatalog.find((item) => String(item.year) === String(selectedYear));
        if (!currentCatalog) return;

        const exists = currentCatalog.sessions.some((session) => String(session) === String(selectedSession));
        if (!exists) {
            setSelectedSession(currentCatalog.sessions[0] || '');
        }
    }, [selectedYear, selectedSession, writtenExamCatalog]);


    const handleGoWrittenLobby = () => {
        // 필기 기출 시험 중에는 제출 전까지 로비 버튼으로 빠져나가지 못하게 막습니다.
        // 상단 네비게이션/브라우저 뒤로가기/새로고침은 App.jsx의 공통 시험 보호 로직이 한 번 더 막습니다.
        if (isExamActive && !isSubmitted && step === 2) {
            alert('필기 기출 시험 응시 중입니다. 제출 및 채점하기 전에는 필기 로비로 이동할 수 없습니다.');
            return;
        }
        navigate('/cert/ipe/written');
    };

    const handleStartExam = async () => {
        if (!selectedYear || !selectedSession) {
            alert("연도와 회차를 선택해 주세요.");
            return;
        }

        try {
            const res = await axios.get(`${API_BASE}/api/past-exam?year=${selectedYear}&session=${selectedSession}`);
            
            let fetchedQuestions = [];
            if (Array.isArray(res.data)) {
                fetchedQuestions = res.data;
            } else if (res.data && Array.isArray(res.data.data)) {
                fetchedQuestions = res.data.data;
            }

            if (fetchedQuestions.length >0) {
                setQuestions(fetchedQuestions);
                setUserAnswers({});
                setIsSubmitted(false);
                setCurrentIndex(0);
                setMyRankData(null); 
                setSubjectScores([0, 0, 0, 0, 0]);
                setTimeLeft(9000);
                setShowDrawing(false);
                
                //  시험 시작 시점 기록
                setStartTime(new Date());
                setEndTime(null);

                setStep(2);
                if (typeof setIsExamActive === 'function') setIsExamActive(true);

                // 실제 시험 느낌을 위해 전체화면을 요청하고,
                // 새로고침/뒤로가기/메뉴 이동/탭 이탈 감지는 App.jsx의 공통 보호 로직이 담당합니다.
                requestExamFullscreen();
            } else { 
                alert("해당 기출문제 데이터가 없습니다."); 
            }
        } catch (e) { 
            alert("서버 오류가 발생했습니다."); 
        }
    };

    const handleAnswer = (val) => {
        if (isSubmitted) return;
        setUserAnswers({ ...userAnswers, [questions[currentIndex]?.question_id]: val });
    };

    const handleGradeExam = () => {
        setShowConfirmModal(true);
    };

    useEffect(() => {
        if (step !== 2 || isSubmitted) return;
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
    }, [step, isSubmitted]);

    useEffect(() => {
        if (step === 2 && timeLeft === 0 && !isSubmitted) {
            alert("150분의 시험 시간이 종료되었습니다. 자동으로 답안이 제출됩니다.");
            executeGradeExam();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, step, isSubmitted]);

    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}시간 ${m < 10 ? '0' : ''}${m}분 ${s < 10 ? '0' : ''}${s}초`;
    };

    async function executeGradeExam() {
        setShowConfirmModal(false);
        if (typeof setIsExamActive === 'function') setIsExamActive(false);
        
        //  시험 제출 시점 기록
        setEndTime(new Date());

        let cCount = 0;
        const wrongQs = []; 
        const subScores = [0, 0, 0, 0, 0];

        questions.forEach((q, idx) => {
            const uAns = userAnswers[q.question_id];
            const subjectIdx = Math.floor(idx / 20); 

            if (uAns !== undefined) { 
                if (String(uAns) === String(q.correct_label)) {
                    cCount++;
                    if (subjectIdx >= 0 && subjectIdx < 5) subScores[subjectIdx] += 5; 
                } else {
                    wrongQs.push(q);
                }
            }
        });

        const totalQ = questions.length; 
        const avgScore = cCount; 
        const localAccuracy = totalQ >0 ? Math.round((cCount / totalQ) * 100) : 0;
        
        let isPass = true;
        let failReason = '';
        const failedSubjects = [];

        subScores.forEach((score, i) => {
            if (score < 40) failedSubjects.push(i + 1);
        });

        if (failedSubjects.length >0) {
            isPass = false;
            failReason = `${failedSubjects.join(', ')}과목 과락`;
        } else if (avgScore < 60) {
            isPass = false;
            failReason = `평균 점수 미달`;
        }

        setSubjectScores(subScores);
        setExamResult({ isPass, average: avgScore, failReason });
        setIsSubmitted(true);
        setStep(3); 
        setMyRankData({ rank: '집계중...', score: avgScore, accuracy: localAccuracy });
        
        if (userId) {
            try {
                if (wrongQs.length >0) {
                    await axios.post(`${API_BASE}/api/save-wrong`, {
                        id: userId, wrongQuestions: wrongQs, source: 'past', year: selectedYear, session: selectedSession
                    }).catch(e => console.error("오답노트 저장 실패", e));
                }

                let prevTotal = 0, prevCorrect = 0, prevScore = 0;
                try {
                    const preRankRes = await axios.get(`${API_BASE}/api/rankings?type=past&year=${selectedYear}&session=${selectedSession}`);
                    if (preRankRes.data && Array.isArray(preRankRes.data.rankings)) {
                        const me = preRankRes.data.rankings.find(u => String(u.userId || u.id) === String(userId) || String(u.name) === String(userName));
                        if (me) {
                            prevTotal = Number(me.total || me.solved_count || me.total_count || 0);
                            prevCorrect = Number(me.correct || me.correct_count || 0);
                            prevScore = Number(me.score || me.points || me.total_score || 0);
                        }
                    }
                } catch (e) { console.error("이전 랭킹 조회 실패", e); }

                const deltaTotal = totalQ - prevTotal;
                const deltaCorrect = cCount - prevCorrect;
                const deltaScore = avgScore - prevScore;

                const resultData = {
                    userId, userName, examYear: selectedYear, examSession: selectedSession,
                    score: deltaScore, correctCount: deltaCorrect, totalCount: deltaTotal, answers: userAnswers
                };
                
                await axios.post(`${API_BASE}/api/exam-results`, resultData);
                
                const rankRes = await axios.get(`${API_BASE}/api/rankings?type=past&year=${selectedYear}&session=${selectedSession}`);
                if (rankRes.data && Array.isArray(rankRes.data.rankings)) {
                    const rawRankings = rankRes.data.rankings;
                    
                    const processed = rawRankings.map(user => {
                        const c = Number(user.correct || user.correct_count || 0);
                        const t = Number(user.total || user.solved_count || user.total_count || 0);
                        return { ...user, score: c, accuracy: t >0 ? Math.round((c / t) * 100) : 0, correct: c };
                    });
                    
                    processed.sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || b.correct - a.correct);
                    
                    const meIndex = processed.findIndex(u => String(u.userId || u.id) === String(userId) || String(u.name) === String(userName));
                    
                    if (meIndex !== -1) {
                        setMyRankData({ rank: `${meIndex + 1}등`, score: processed[meIndex].score, accuracy: processed[meIndex].accuracy });
                    } else {
                        setMyRankData({ rank: '순위권 밖', score: avgScore, accuracy: localAccuracy });
                    }
                }
            } catch (e) { 
                console.error("랭킹 집계 오류:", e);
                setMyRankData({ rank: '갱신 지연', score: avgScore, accuracy: localAccuracy });
            }
        }
    }

    const handleExportPDF = () => {
        if (Object.keys(userAnswers).length === 0) {
            alert("제출한 답안이 없어 결과를 추출할 수 없습니다.");
            return;
        }

        const wrongQs = questions.filter(q => {
            const myAns = userAnswers[q.question_id];
            return myAns !== undefined && String(myAns) !== String(q.correct_label);
        });

        //  PDF 결과표에도 동일하게 사용자 이름과 시간 반영
        const passFailMessage = examResult.isPass 
            ? `${userName || '사용자'}님, 합격을 축하합니다!` 
            : `${userName || '사용자'}님은 불합격입니다. (${examResult.failReason})`;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <title>${selectedYear}년 ${selectedSession}회차 시험 결과 및 오답 노트</title>
                <style>body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; color: #333; line-height: 1.6; padding: 30px; max-width: 800px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #222; }
                    .header h1 { margin: 0 0 10px 0; color: #1e3a8a; }
                    
                    /* 결과표 스타일 */
                    .result-box { border: 2px solid ${examResult.isPass ? '#10b981' : '#ef4444'}; background-color: ${examResult.isPass ? '#f0fdf4' : '#fef2f2'}; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px; }
                    .result-box h2 { margin: 0 0 10px 0; color: ${examResult.isPass ? '#10b981' : '#ef4444'}; font-size: 28px; }
                    .result-box p { margin: 5px 0; font-size: 16px; font-weight: bold; }
                    
                    /* 시간 정보 스타일 */
                    .time-info { background: #fff; border: 1px solid #ccc; padding: 15px; border-radius: 8px; text-align: left; margin: 15px auto 0 auto; display: inline-block; font-size: 14px; color: #555; }
                    .time-info div { margin-bottom: 5px; }

                    /* 과목 점수 스타일 */
                    .subject-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 30px; }
                    .subject-box { border: 1px solid #ccc; padding: 15px 5px; text-align: center; border-radius: 8px; background: #fff; }
                    .subject-box.pass { border-color: #3b82f6; }
                    .subject-box.fail { border-color: #ef4444; }
                    .subject-name { font-size: 13px; color: #666; margin-bottom: 5px; }
                    .subject-score { font-size: 20px; font-weight: bold; }
                    .score-pass { color: #10b981; }
                    .score-fail { color: #ef4444; }
                    .badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-top: 5px; }
                    .badge.pass { background: #dbeafe; color: #1d4ed8; }
                    .badge.fail { background: #fee2e2; color: #b91c1c; }
                    
                    /* 채점표 테이블 스타일 */
                    table { width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 14px; text-align: center; }
                    th, td { border: 1px solid #ddd; padding: 8px; }
                    th { background-color: #f8f9fa; font-weight: bold; }
                    .correct-text { color: #10b981; font-weight: bold; }
                    .wrong-text { color: #ef4444; font-weight: bold; }

                    /* 문제 출력 스타일 */
                    .section-title { border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 20px; color: #1e3a8a; }
                    .question-box { page-break-inside: avoid; margin-bottom: 35px; padding-bottom: 25px; border-bottom: 1px dashed #ccc; }
                    .info-row { font-size: 13px; color: #666; margin-bottom: 5px; font-weight: bold; }
                    .subject { font-weight: bold; color: #2563eb; font-size: 15px; margin-bottom: 10px; }
                    .q-text { font-size: 18px; font-weight: bold; margin-bottom: 15px; color: #111; }
                    .q-img { max-width: 100%; max-height: 300px; margin: 15px 0; display: block; border: 1px solid #ddd; padding: 5px; }
                    .options { margin-left: 10px; }
                    .option { margin-bottom: 8px; font-size: 16px; padding: 5px; border-radius: 4px; }
                    .correct { color: #16a34a; font-weight: bold; background: #dcfce7; border: 1px solid #bbf7d0; }
                    .wrong { color: #dc2626; font-weight: bold; text-decoration: line-through; }
                    .normal { color: #444; }
                    .explanation-box { margin-top: 14px; padding: 12px 14px; border: 1px solid #93c5fd; background: #eff6ff; border-radius: 6px; color: #1f2937; }
                    .explanation-title { font-weight: bold; color: #1d4ed8; margin-bottom: 6px; }
                    .explanation-text { white-space: pre-wrap; font-size: 14px; line-height: 1.7; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>[시험 결과] ${selectedYear}년 ${selectedSession}회차 기출문제</h1>
                </div>

                <div class="section-title">
                    <h2>최종 결과표</h2>
                </div>
                
                <div class="result-box">
                    <h2>총 평균 ${examResult.average}점</h2>
                    <p>${passFailMessage}</p>
                    <div class="time-info">
                        <div>응시 시작: <strong>${formatDateTime(startTime)}</strong></div>
                        <div>응시 종료: <strong>${formatDateTime(endTime)}</strong></div>
                        <div style="margin-top: 8px; border-top: 1px dashed #ccc; padding-top: 8px;">
                            실제 소요 시간: <strong>${formatTime(9000 - timeLeft)}</strong>
                        </div>
                    </div>
                </div>

                <div class="subject-grid">
                    ${subjectScores.map((score, i) => {
                        const isPass = score >= 40;
                        return `
                            <div class="subject-box ${isPass ? 'pass' : 'fail'}">
                                <div class="subject-name">${i + 1}과목</div>
                                <div class="subject-score ${isPass ? 'score-pass' : 'score-fail'}">${score}점</div>
                                <div class="badge ${isPass ? 'pass' : 'fail'}">${isPass ? 'PASS' : '과락'}</div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="section-title">
                    <h2> 제출한 문제 상세 채점표</h2>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>문제 번호</th>
                            <th>내 정답</th>
                            <th>실제 정답</th>
                            <th>결과</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${questions.map((q, idx) => {
                            const ans = userAnswers[q.question_id];
                            if (ans === undefined) return ''; 
                            const isCorrect = String(ans) === String(q.correct_label);
                            return `
                                <tr>
                                    <td>${idx + 1}번</td>
                                    <td class="${isCorrect ? 'correct-text' : 'wrong-text'}">${ans}번</td>
                                    <td class="correct-text">${q.correct_label}번</td>
                                    <td class="${isCorrect ? 'correct-text' : 'wrong-text'}">${isCorrect ? 'O' : 'X'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                ${wrongQs.length >0 ? `
                <div class="section-title" style="page-break-before: always;">
                    <h2> 오답 노트 </h2>
                </div>
                ${wrongQs.map((q) => {
                    const myAns = userAnswers[q.question_id];

                    // 필기 기출 PDF 오답노트 해설 준비합니다
                    // ------------------------------------------------------------
                    // handleExportPDF는 새 about:blank 창에 현재 questions 상태를 HTML로
                    // 직접 써 넣는 방식입니다. 따라서 여기서 해설을 직접 넣어야
                    // PDF로 출력되는 웹페이지에도 해설이 보입니다.
                    const explanation = getWrittenExplanation(q);

                    return `
                    <div class="question-box">
                        <div class="info-row">실제 기출 번호: ${q.info_id || '정보 없음'}번</div>
                        <div class="subject">${getSubjectName(q.subject_id)}</div>
                        <div class="q-text">Q. ${q.question_text || ""}</div>
                        ${q.question_img ? `<img class="q-img" src="${window.location.origin}/question_image/${q.question_img}" onerror=" this.style.display='none'" />` : ''}
                        <div class="options">
                            ${[1, 2, 3, 4].map(num => {
                                const optText = q[`option_${num}`] || q[`option${num}`];
                                if (!optText) return '';
                                
                                const isUserAns = String(myAns) === String(num);
                                const isCorrectAns = String(q.correct_label) === String(num);
                                
                                let optClass = "option normal";
                                let mark = "";
                                
                                if (isCorrectAns) { 
                                    optClass = "option correct"; 
                                    mark = " (정답) "; 
                                } else if (isUserAns) { 
                                    optClass = "option wrong"; 
                                    mark = " (내 오답) "; 
                                }
                                
                                return `<div class="${optClass}">${num}. ${mark}${optText}</div>`;
                            }).join('')}
                        </div>

                        <div class="explanation-box">
                            <div class="explanation-title"> 해설</div>
                            <div class="explanation-text">${explanation ? escapeHtml(explanation) : '해설이 아직 등록되어 있지 않습니다. DB에는 해설이 있어도 이 문구가 보이면 /api/past-exam 응답에 explanation_text가 포함되는지 확인해야 합니다.'}</div>
                        </div>
                    </div>
                    `;
                }).join('')}
                ` : `
                <div class="section-title" style="page-break-before: always;">
                    <h2> 오답 노트</h2>
                </div>
                <div style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 8px;">
                    <h3 style="color: #10b981;"> 틀린 문제가 없습니다! 완벽합니다.</h3>
                </div>
                `}
                
                <script>window.onload = function() {
                        setTimeout(() => {
                            window.print();
                        }, 500);
                    };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    };

    if (step === 1) {
        return (
            <div
                className="past-exam-selector" style={{ width: '100%', maxWidth: '600px', margin: '0 auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', boxSizing: 'border-box' }}
            >
                {/* 실기 페이지와 구조를 맞추기 위해 필기 기출문제에도 필기 로비 이동 버튼을 추가했습니다. */}
                <button
                    onClick={handleGoWrittenLobby}
                    style={{ marginBottom: '16px', padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    필기 로비
                </button>

                {/* 기출 응시 제목은 공통 페이지 제목 클래스로 통일합니다. */}
                <h2 className="wgs-page-title" style={{ textAlign: 'center', color: 'var(--wgs-title)', marginBottom: '20px' }}>기출문제 응시</h2>
                <div className="past-exam-selector-controls" style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
                    <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'var(--wgs-input-bg)', color: 'white', border: '1px solid var(--wgs-border)' }}>
                        {YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
                    </select>
                    <select value={selectedSession} onChange={(e) => setSelectedSession(Number(e.target.value))} style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'var(--wgs-input-bg)', color: 'white', border: '1px solid var(--wgs-border)' }}>
                        {SESSIONS.map(s => <option key={s} value={s}>{s}회차</option>)}
                    </select>
                </div>
                <button onClick={handleStartExam} style={{ width: '100%', padding: '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>
                    응시 시작
                </button>
            </div>
        );
    }

    if (step === 3) {
        return (
            <div
                className="past-exam-result" style={{ width: '100%', maxWidth: '900px', margin: '0 auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', textAlign: 'center', boxSizing: 'border-box' }}
            >
                {/* 결과표에서도 바로 필기 로비로 돌아갈 수 있게 했습니다. */}
                <div style={{ textAlign: 'left', marginBottom: '16px' }}>
                    <button
                        onClick={handleGoWrittenLobby}
                        style={{ padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                        필기 로비
                    </button>
                </div>

                <h2 style={{ color: '#fcd34d', fontSize: '24px', margin: '0 0 20px 0' }}>최종 결과표</h2>
                
                <div style={{ background: examResult.isPass ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: `2px solid ${examResult.isPass ? '#10b981' : '#ef4444'}`, padding: '30px', borderRadius: '12px', marginBottom: '25px' }}>
                    <h1 style={{ margin: '0 0 10px 0', fontSize: '40px', color: examResult.isPass ? '#10b981' : '#ef4444' }}>총 평균 {examResult.average}점</h1>
                    
                    {/*  합격/불합격 메시지에 이름 적용 */}
                    <h3 style={{ margin: 0, color: 'white', fontSize: '20px' }}>
                        {examResult.isPass 
                            ? `${userName || '사용자'}님, 합격을 축하합니다!` 
                            : `${userName || '사용자'}님은 불합격입니다. (${examResult.failReason})`
                        }
                    </h3>
                    
                    {/*  시간 정보 표시 (웹 버전) */}
                    <div style={{ marginTop: '20px', padding: '15px 20px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', display: 'inline-block', textAlign: 'left' }}>
                        <div style={{ color: 'var(--wgs-muted)', fontSize: '14px', marginBottom: '10px', borderBottom: '1px dashed var(--wgs-border)', paddingBottom: '10px' }}>
                            <div style={{ marginBottom: '5px' }}>시작 일시 : <strong style={{ color: 'white' }}>{formatDateTime(startTime)}</strong></div>
                            <div>종료 일시 : <strong style={{ color: 'white' }}>{formatDateTime(endTime)}</strong></div>
                        </div>
                        <div className="past-exam-result-time-row" style={{ display: 'flex', gap: '20px' }}>
                            <span style={{ color: 'var(--wgs-muted)', fontSize: '15px' }}>
                                실제 소요 시간 : <strong style={{ color: 'white' }}>{formatTime(9000 - timeLeft)}</strong>
                            </span>
                            <span style={{ color: 'var(--wgs-muted)', fontSize: '15px' }}>
                                남은 시간 : <strong style={{ color: 'white' }}>{formatTime(timeLeft)}</strong>
                            </span>
                        </div>
                    </div>
                </div>

                <div
                    className="past-exam-result-scores" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '25px' }}
                >
                    {subjectScores.map((score, i) => {
                        const isSubjectPass = score >= 40;
                        return (
                            <div key={i} style={{ background: '#1e2433', padding: '15px', borderRadius: '8px', border: `1px solid ${isSubjectPass ? '#3b82f6' : '#ef4444'}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{ fontSize: '14px', color: 'var(--wgs-muted)', marginBottom: '8px' }}>{i + 1}과목</div>
                                <div style={{ fontSize: '22px', fontWeight: 'bold', color: isSubjectPass ? '#10b981' : '#ef4444' }}>{score}점</div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: isSubjectPass ? '#3b82f6' : '#ef4444', marginTop: '5px', background: isSubjectPass ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)', padding: '4px 10px', borderRadius: '12px' }}>
                                    {isSubjectPass ? 'PASS' : '과락 (FAIL)'}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {myRankData && (
                    <div className="past-exam-my-ranking-row" style={{ background: 'var(--wgs-practice-toggle-bg)', border: '1px solid #3b82f6', padding: '15px', borderRadius: '8px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: 'var(--wgs-title)', fontWeight: 'bold' }}> 현재 나의 랭킹 ({selectedYear}년 {selectedSession}회차)</span>
                        <span style={{ color: 'white', fontSize: '16px' }}>
                            <strong style={{ color: '#fcd34d' }}>{myRankData.rank || '순위권 밖'}</strong> ({myRankData.score ?? 0}점, 정답률 {myRankData.accuracy ?? 0}%)
                        </span>
                    </div>
                )}

                <div className="past-exam-result-table-wrap" style={{ background: '#1e2433', padding: '20px', borderRadius: '8px', border: '1px solid var(--wgs-border)', marginBottom: '20px', maxHeight: '400px', overflowY: 'auto', overflowX: 'auto' }}>
                    <h4 style={{ color: 'var(--wgs-muted)', marginTop: 0, marginBottom: '15px', textAlign: 'left', borderBottom: '1px solid var(--wgs-border)', paddingBottom: '10px' }}> 제출한 문제 상세 채점표</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', color: 'white', fontSize: '15px' }}>
                        <thead>
                            <tr style={{ background: 'var(--wgs-border)' }}>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>문제 번호</th>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>내 정답</th>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>실제 정답</th>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>결과</th>
                            </tr>
                        </thead>
                        <tbody>
                            {questions.map((q, idx) => {
                                const ans = userAnswers[q.question_id];
                                if (ans === undefined) return null; 

                                const isCorrect = String(ans) === String(q.correct_label);
                                return (
                                    <tr key={q.question_id} style={{ background: idx % 2 === 0 ? '#1e2433' : 'var(--wgs-button-muted)', textAlign: 'center' }}>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>{idx + 1}번</td>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)', color: isCorrect ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>
                                            {`${ans}번`}
                                        </td>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)', color: '#10b981', fontWeight: 'bold' }}>{q.correct_label}번</td>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)', color: isCorrect ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>
                                            {isCorrect ? 'O' : 'X'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="past-exam-action-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={handleExportPDF} style={{ flex: 1, minWidth: '150px', padding: '15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>PDF로 추출 
                    </button>
                    <button onClick={() => setStep(2)} style={{ flex: 1, minWidth: '150px', padding: '15px', background: 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>
                        응시한 OMR 이동
                    </button>
                    <button onClick={() => setStep(1)} style={{ flex: 1, minWidth: '150px', padding: '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>
                        다른 기출문제 풀기
                    </button>
                </div>
            </div>
        );
    }

    const currentQ = questions[currentIndex];
    
    if (!currentQ) return <div style={{ textAlign: 'center', padding: '50px', color: 'white' }}>문제를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</div>;

    return (
        <div className="exam-page written-exam-page past-exam-page wgs-typography-scope">
            {showConfirmModal && (
                <>
                    {/* 제출 확인 모달: 기존 채점 함수는 그대로 사용하고, 안내문 색상만 테마와 무관하게 선명하게 고정합니다. */}
                    <div className="past-exam-confirm-overlay">
                    <div className="past-exam-confirm-modal-card">
                        <div className="past-exam-confirm-icon"></div>
                        <div className="past-exam-confirm-message">
                            <strong>{userName || '사용자'}</strong>님이 응시하신 시험을<br />
                            정말 종료하고 답을 제출하시겠습니까?
                        </div>
                        <div className="past-exam-confirm-actions">
                            <button className="past-exam-confirm-submit" onClick={executeGradeExam}>Yes (제출)</button>
                            <button className="past-exam-confirm-cancel" onClick={() => setShowConfirmModal(false)}>No (계속 풀기)</button>
                        </div>
                    </div>
                    </div>
                </>
            )}

            <div className="past-exam-toolbar" style={{ width: '100%', maxWidth: '1200px', margin: '0 auto 15px auto', boxSizing: 'border-box' }}>
                <button
                    onClick={handleGoWrittenLobby}
                    style={{ padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    필기 로비
                </button>
            </div>

            <div
                className="past-exam-workspace" style={{ display: 'flex', gap: '20px', width: '100%', maxWidth: '1200px', margin: '0 auto', alignItems: 'flex-start', boxSizing: 'border-box' }}
            >
                <div className="past-exam-question-panel" style={{ flex: '1 1 700px', minWidth: 0, background: '#1e2433', padding: '30px', borderRadius: '12px', border: '1px solid var(--wgs-border)', boxSizing: 'border-box' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid var(--wgs-border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--wgs-title)', fontWeight: 'bold', fontSize: '18px' }}>{selectedYear}년 {selectedSession}회차</span>
                        <span style={{ color: 'var(--wgs-muted)', fontSize: '16px' }}>{currentIndex + 1} / {questions.length}</span>
                    </div>
                    
                    <div style={{ color: '#fcd34d', fontWeight: 'bold', marginBottom: '10px', fontSize: '14px' }}>
                        {getSubjectName(currentQ.subject_id)}
                    </div>

                    <div className="exam-question-title-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                        <h3 style={{ margin: 0, lineHeight: '1.5', color: 'white', fontSize: '20px' }}>{currentIndex + 1}. {currentQ.question_text || "문제 내용이 없습니다."}</h3>
                        {/* 필기 기출문제 응시 중 현재 문항을 바로 신고하는 버튼입니다. */}
                        <ErrorReportButton
                            examType="필기" mode="기출문제" questionInfo={{
                                year: selectedYear,
                                round: selectedSession,
                                number: currentIndex + 1,
                                subject: getSubjectName(currentQ.subject_id),
                                title: currentQ.question_text,
                            }}
                        />
                    </div>
                    
                    {currentQ.question_img && (
                        <div style={{ textAlign: 'center', margin: '20px 0', width: '100%' }}>
                            <img 
                                src={`/question_image/${currentQ.question_img}`} 
                                alt="문제 첨부 이미지" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '4px' }} 
                                onError={(e) => { e.target.style.display = 'none'; }}
                            />
                        </div>
                    )}
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {[1, 2, 3, 4].map(num => {
                            const isSelected = userAnswers[currentQ.question_id] === num;
                            let bg = 'var(--wgs-button-muted)'; let border = '1px solid var(--wgs-border)';
                            
                            if (isSubmitted) {
                                if (String(num) === String(currentQ.correct_label)) { bg = 'rgba(16, 185, 129, 0.2)'; border = '1px solid #10b981'; }
                                else if (isSelected) { bg = 'rgba(239, 68, 68, 0.2)'; border = '1px solid #ef4444'; }
                            } else if (isSelected) {
                                bg = 'rgba(59, 130, 246, 0.2)'; border = '1px solid #3b82f6';
                            }

                            return (
                                <button key={num} onClick={() => handleAnswer(num)} disabled={isSubmitted}
                                    style={{ textAlign: 'left', padding: '15px', borderRadius: '8px', background: bg, border: border, color: 'white', fontSize: '16px', cursor: isSubmitted ? 'default' : 'pointer', transition: 'all 0.2s' }}>
                                    {num}번. {currentQ[`option_${num}`] || ""}
                                </button>
                            );
                        })}
                    </div>

                    {/* ============================================================
                        필기 기출 응시 화면의 해설 출력 영역
                        ------------------------------------------------------------
                        제출 후 문제를 다시 확인하는 경우에도 정답/오답과 관계없이
                        현재 문항의 해설을 볼 수 있도록 합니다.
                        PDF 추출 화면의 해설은 handleExportPDF 내부에서 별도로 처리합니다.
                        ============================================================ */}
                    {isSubmitted && (
                        <div
                            className="written-past-explanation-box" style={{
                                marginTop: '20px',
                                padding: '18px 20px',
                                background: 'rgba(59, 130, 246, 0.08)',
                                border: '1px solid rgba(59, 130, 246, 0.45)',
                                borderRadius: '10px',
                                color: 'var(--wgs-title)',
                                lineHeight: 1.7,
                                boxSizing: 'border-box'
                            }}
                        >
                            <div style={{ fontWeight: '900', color: '#60a5fa', marginBottom: '8px', fontSize: '16px' }}>
                                해설
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: '15px' }}>
                                {getWrittenExplanation(currentQ) || '해설이 아직 등록되어 있지 않습니다. DB에는 해설이 있어도 이 문구가 보이면 /api/past-exam 응답에 explanation_text가 포함되는지 확인해야 합니다.'}
                            </div>
                        </div>
                    )}

                    <div className="past-exam-action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '30px', gap: '15px' }}>
                        <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} style={{ padding: '12px 25px', background: currentIndex === 0 ? 'var(--wgs-border)' : 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '6px', cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>이전</button>
                        
                        {!isSubmitted ? (
                            <button onClick={handleGradeExam} style={{ padding: '12px 30px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', flex: 1 }}>
                                제출 및 채점하기
                            </button>
                        ) : (
                            <div className="past-exam-action-row" style={{ display: 'flex', gap: '10px', flex: 1 }}>
                                <button onClick={() => setStep(3)} style={{ padding: '12px 10px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', flex: 1 }}>
                                    최종결과표로 이동
                                </button>
                                <button onClick={() => { setStep(1); }} style={{ padding: '12px 10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', flex: 1 }}>
                                    종료 및 홈으로
                                </button>
                            </div>
                        )}

                        <button onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))} disabled={currentIndex === questions.length - 1} style={{ padding: '12px 25px', background: currentIndex === questions.length - 1 ? 'var(--wgs-border)' : '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: currentIndex === questions.length - 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>다음</button>
                    </div>

                    <div style={{ marginTop: '20px' }}>
                        <button onClick={() => setShowDrawing(!showDrawing)} style={{ width: '100%', padding: '12px', background: 'var(--wgs-button-muted)', color: 'var(--wgs-title)', border: '1px solid #3b82f6', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', transition: '0.2s' }}>
                            {showDrawing ? '연습장 닫기' : '연습장 열기'}
                        </button>
                    </div>
                    {showDrawing && <DrawingBoard />}
                    
                </div>

                <div className="past-exam-omr-panel" style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
                    <div style={{ background: '#1e2433', padding: '15px', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', borderBottom: '2px solid var(--wgs-border)', textAlign: 'center', zIndex: 10 }}>
                        <div style={{ fontSize: '14px', color: 'var(--wgs-title)', marginBottom: '5px', fontWeight: 'bold' }}>남은 시간</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: timeLeft <= 600 ? '#ef4444' : '#10b981' }}>
                            {isSubmitted ? '--시간 --분 --초' : formatTime(timeLeft)}
                        </div>
                    </div>
                    
                    <div style={{ background: 'var(--wgs-button-muted)', padding: '20px', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', overflowY: 'auto', flex: 1 }}>
                        <h4 style={{ textAlign: 'center', marginTop: 0, borderBottom: '1px solid var(--wgs-border)', paddingBottom: '10px', color: 'white' }}>진행 현황 (OMR)</h4>
                        <div className="past-exam-omr-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                            {questions.map((q, idx) => {
                                const isAnswered = !!userAnswers[q.question_id];
                                const isCurrent = currentIndex === idx;
                                let bg = isAnswered ? '#10b981' : 'var(--wgs-input-bg)';
                                
                                if (isSubmitted) {
                                     if (!isAnswered) bg = 'var(--wgs-border)'; 
                                     else if (String(userAnswers[q.question_id]) === String(q.correct_label)) bg = '#10b981'; 
                                     else bg = '#ef4444'; 
                                }

                                return (
                                    <button key={q.question_id} onClick={() => setCurrentIndex(idx)}
                                        style={{ padding: '15px 0', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px', border: isCurrent ? '2px solid #fcd34d' : '1px solid var(--wgs-border)', background: bg, color: 'white' }}>
                                        {idx + 1}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PastExam;
