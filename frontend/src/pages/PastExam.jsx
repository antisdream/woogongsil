import '../styles/app/learning-redesign.css';
// 필기 기출문제 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { learningRequestOptions, submitLearningAttempt } from '../features/learningAttempts.js';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import DrawingBoard from './DrawingBoard';
import ErrorReportButton from "../components/ErrorReportButton";
import useScreenSettings from '../useScreenSettings';
import {
    escapeHtml,
    getSubjectName,
    getWrittenExplanation,
    normalizeWrittenExamCatalog,
    replaceSettingTokens,
    requestExamFullscreen,
} from '../features/pastExam/pastExamUtils.js';

const API_BASE = "";

const PastExam = ({ isExamActive, setIsExamActive }) => {
    const { getSetting } = useScreenSettings('past');
    const t = useCallback((key, fallback) => getSetting(key, fallback), [getSetting]);
    const formatSetting = useCallback((key, fallback, values = {}) => (
        replaceSettingTokens(t(key, fallback), values)
    ), [t]);

    // 필기 기출문제에서 필기 로비(/cert/ipe/written)로 돌아가기 위해 사용합니다.
    const navigate = useNavigate();
    const [step, setStep] = useState(1); 
    const [selectedYear, setSelectedYear] = useState('');
    const [selectedSession, setSelectedSession] = useState('');
    const [questions, setQuestions] = useState([]);
    const submittingRef = useRef(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [userAnswers, setUserAnswers] = useState({});
    const [isSubmitted, setIsSubmitted] = useState(false);
    
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [subjectScores, setSubjectScores] = useState([0, 0, 0, 0, 0]);
    const [examResult, setExamResult] = useState({ isPass: false, average: 0, failReason: '', accuracy: 0, correctCount: 0, totalCount: 0 });

    const [timeLeft, setTimeLeft] = useState(9000);
    
    const [showDrawing, setShowDrawing] = useState(false); 

    //  시작 시간과 종료 시간을 저장하는 상태를 추가합니다.
    const [startTime, setStartTime] = useState(null);
    const [endTime, setEndTime] = useState(null);

    const userId = sessionStorage.getItem('userId');
    const userName = sessionStorage.getItem('userName');
    const getSessionAuth = useCallback(() => ({
        id: sessionStorage.getItem('userId') || userId || '',
        userId: sessionStorage.getItem('userId') || userId || '',

        serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
    }), [userId]);

    const displayUserName = userName || t('user.default_name', '사용자');

    const getSubjectNameLabel = useCallback((id) => {
        const fallback = getSubjectName(id);
        try {
            if (id === undefined || id === null || id === '') return t('subjects.unknown', fallback);
            const strId = String(id).trim();
            const lastChar = strId.charAt(strId.length - 1);
            if (['0', '1', '2', '3', '4'].includes(lastChar)) {
                return t(`subjects.subject_${lastChar}`, fallback);
            }
            return formatSetting('subjects.default', '과목 : {id}', { id: strId });
        } catch (error) {
            return t('subjects.unknown', fallback);
        }
    }, [formatSetting, t]);

    const formatDateTimeLabel = useCallback((date) => {
        if (!date) return '';
        return formatSetting('time.datetime', '{year}년 {month}월 {day}일 {hour}:{minute}:{second}', {
            year: date.getFullYear(),
            month: String(date.getMonth() + 1).padStart(2, '0'),
            day: String(date.getDate()).padStart(2, '0'),
            hour: String(date.getHours()).padStart(2, '0'),
            minute: String(date.getMinutes()).padStart(2, '0'),
            second: String(date.getSeconds()).padStart(2, '0')
        });
    }, [formatSetting]);

    const formatDurationLabel = useCallback((seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return formatSetting('time.duration', '{hours}시간 {minutes}분 {seconds}초', {
            hours: h,
            minutes: `${m < 10 ? '0' : ''}${m}`,
            seconds: `${s < 10 ? '0' : ''}${s}`
        });
    }, [formatSetting]);

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
            alert(t('messages.block_lobby_during_exam', '필기 기출 시험 응시 중입니다. 제출 및 채점하기 전에는 필기 로비로 이동할 수 없습니다.'));
            return;
        }
        navigate('/cert/ipe/written');
    };

    const handleStartExam = async () => {
        if (!selectedYear || !selectedSession) {
            alert(t('messages.need_year_session', '연도와 회차를 선택해 주세요.'));
            return;
        }

        try {
            const res = await axios.get(`${API_BASE}/api/past-exam?year=${selectedYear}&session=${selectedSession}`, learningRequestOptions());
            
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
                alert(t('messages.no_exam_data', '해당 기출문제 데이터가 없습니다.'));
            }
        } catch (e) { 
            alert(t('messages.server_error', '서버 오류가 발생했습니다.'));
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

    const formatTime = (seconds) => {
        return formatDurationLabel(seconds);
    };

    async function executeGradeExam() {
        if (submittingRef.current || isSubmitted) return;
        submittingRef.current = true;
        setShowConfirmModal(false);
        try {
            const data = await submitLearningAttempt(questions[0]?.attemptId, userAnswers);
            const grades = new Map(data.grades.map(row => [Number(row.questionId), row]));
            const gradedQuestions = questions.map(q => ({ ...q, ...grades.get(Number(q.question_id)) }));
            const subScores = [0, 0, 0, 0, 0];
            gradedQuestions.forEach((q, idx) => { if (q.isCorrect && Math.floor(idx / 20) < 5) subScores[Math.floor(idx / 20)] += 5; });
            const cCount = data.summary.correctCount;
            const totalQ = data.summary.totalCount;
            const failedSubjects = subScores.flatMap((score, index) => score < 40 ? [index + 1] : []);
            const failReason = failedSubjects.length
                ? formatSetting('result.fail_reason_subject', '{subjects}과목 과락', { subjects: failedSubjects.join(', ') })
                : cCount < 60 ? t('result.fail_reason_average', '평균 점수 미달') : '';
            setQuestions(gradedQuestions);
            setSubjectScores(subScores);
            setExamResult({ isPass: !failReason, average: cCount, failReason,
                accuracy: totalQ ? Math.round(cCount / totalQ * 100) : 0, correctCount: cCount, totalCount: totalQ });
            setEndTime(new Date());
            setIsSubmitted(true);
            setStep(3);
            if (typeof setIsExamActive === 'function') setIsExamActive(false);
            const wrongQs = gradedQuestions.filter(q => !q.isBlank && !q.isCorrect);
            if (userId && wrongQs.length) await axios.post(`${API_BASE}/api/save-wrong`, {
                ...getSessionAuth(), id: userId, wrongQuestions: wrongQs, source: 'past', year: selectedYear, session: selectedSession
            }).catch(() => toast.error('채점은 저장했지만 오답노트 저장에 실패했습니다.'));
        } catch (error) {
            toast.error(error.response?.data?.msg || '채점에 실패했습니다. 답안을 유지하고 다시 제출해주세요.');
        } finally { submittingRef.current = false; }
    }

    useEffect(() => {
        if (step === 2 && timeLeft === 0 && !isSubmitted) {
            alert(t('messages.time_over', '150분의 시험 시간이 종료되었습니다. 자동으로 답안이 제출됩니다.'));
            executeGradeExam();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, step, isSubmitted]);

    const handleExportPDF = () => {
        if (Object.keys(userAnswers).length === 0) {
            alert(t('messages.no_submitted_answer_pdf', '제출한 답안이 없어 결과를 추출할 수 없습니다.'));
            return;
        }

        const wrongQs = questions.filter(q => {
            const myAns = userAnswers[q.question_id];
            return myAns !== undefined && String(myAns) !== String(q.correct_label);
        });

        //  PDF 결과표에도 동일하게 사용자 이름과 시간 반영
        const passFailMessage = examResult.isPass 
            ? formatSetting('result.pass_message', '{name}님, 합격을 축하합니다!', { name: displayUserName })
            : formatSetting('result.fail_message', '{name}님은 불합격입니다. ({reason})', { name: displayUserName, reason: examResult.failReason });
        const pdfTitle = formatSetting('pdf.title', '{year}년 {session}회차 시험 결과 및 오답 노트', { year: selectedYear, session: selectedSession });
        const pdfHeaderTitle = formatSetting('pdf.header_title', '[시험 결과] {year}년 {session}회차 기출문제', { year: selectedYear, session: selectedSession });
        const pdfWrongNoteTitle = t('pdf.wrong_note_title', ' 오답 노트 ');
        const pdfNoWrongTitle = t('pdf.no_wrong_title', ' 틀린 문제가 없습니다! 완벽합니다.');
        const pdfDetailTableTitle = t('pdf.detail_table_title', ' 제출한 문제 상세 채점표');
        const pdfResultTitle = t('result.title', '최종 결과표');
        const pdfExplanationEmpty = t('explanation.empty', '해설이 아직 등록되어 있지 않습니다. DB에는 해설이 있어도 이 문구가 보이면 /api/past-exam 응답에 explanation_text가 포함되는지 확인해야 합니다.');

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <title>${escapeHtml(pdfTitle)}</title>
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
                    <h1>${escapeHtml(pdfHeaderTitle)}</h1>
                </div>

                <div class="section-title">
                    <h2>${escapeHtml(pdfResultTitle)}</h2>
                </div>
                
                <div class="result-box">
                    <h2>${escapeHtml(formatSetting('result.average_title', '총 평균 {score}점', { score: examResult.average }))}</h2>
                    <p>${escapeHtml(passFailMessage)}</p>
                    <div class="time-info">
                        <div>${escapeHtml(t('pdf.start_time_label', '응시 시작: '))}<strong>${escapeHtml(formatDateTimeLabel(startTime))}</strong></div>
                        <div>${escapeHtml(t('pdf.end_time_label', '응시 종료: '))}<strong>${escapeHtml(formatDateTimeLabel(endTime))}</strong></div>
                        <div style="margin-top: 8px; border-top: 1px dashed #ccc; padding-top: 8px;">
                            ${escapeHtml(t('pdf.elapsed_time_label', '실제 소요 시간: '))}<strong>${escapeHtml(formatTime(9000 - timeLeft))}</strong>
                        </div>
                    </div>
                </div>

                <div class="subject-grid">
                    ${subjectScores.map((score, i) => {
                        const isPass = score >= 40;
                        return `
                            <div class="subject-box ${isPass ? 'pass' : 'fail'}">
                                <div class="subject-name">${escapeHtml(formatSetting('result.subject_label', '{number}과목', { number: i + 1 }))}</div>
                                <div class="subject-score ${isPass ? 'score-pass' : 'score-fail'}">${escapeHtml(formatSetting('result.score_value', '{score}점', { score }))}</div>
                                <div class="badge ${isPass ? 'pass' : 'fail'}">${escapeHtml(isPass ? t('result.subject_pass_badge', 'PASS') : t('pdf.subject_fail_badge_short', '과락'))}</div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="section-title">
                    <h2>${escapeHtml(pdfDetailTableTitle)}</h2>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>${escapeHtml(t('result.table_no_header', '문제 번호'))}</th>
                            <th>${escapeHtml(t('result.table_my_answer_header', '내 정답'))}</th>
                            <th>${escapeHtml(t('result.table_correct_answer_header', '실제 정답'))}</th>
                            <th>${escapeHtml(t('result.table_result_header', '결과'))}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${questions.map((q, idx) => {
                            const ans = userAnswers[q.question_id];
                            if (ans === undefined) return ''; 
                            const isCorrect = String(ans) === String(q.correct_label);
                            return `
                                <tr>
                                    <td>${escapeHtml(formatSetting('result.question_no_value', '{number}번', { number: idx + 1 }))}</td>
                                    <td class="${isCorrect ? 'correct-text' : 'wrong-text'}">${escapeHtml(formatSetting('result.answer_value', '{answer}번', { answer: ans }))}</td>
                                    <td class="correct-text">${escapeHtml(formatSetting('result.answer_value', '{answer}번', { answer: q.correct_label }))}</td>
                                    <td class="${isCorrect ? 'correct-text' : 'wrong-text'}">${escapeHtml(isCorrect ? t('result.correct_symbol', 'O') : t('result.wrong_symbol', 'X'))}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                ${wrongQs.length >0 ? `
                <div class="section-title" style="page-break-before: always;">
                    <h2>${escapeHtml(pdfWrongNoteTitle)}</h2>
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
                        <div class="info-row">${escapeHtml(formatSetting('pdf.actual_question_no', '실제 기출 번호: {number}번', { number: q.info_id || t('pdf.no_info', '정보 없음') }))}</div>
                        <div class="subject">${escapeHtml(getSubjectNameLabel(q.subject_id))}</div>
                        <div class="q-text">${escapeHtml(formatSetting('exam.question_prefix', 'Q. ', {}))}${escapeHtml(q.question_text || "")}</div>
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
                                    mark = escapeHtml(t('pdf.correct_mark', ' (정답) '));
                                } else if (isUserAns) { 
                                    optClass = "option wrong"; 
                                    mark = escapeHtml(t('pdf.my_wrong_mark', ' (내 오답) '));
                                }
                                
                                return `<div class="${optClass}">${escapeHtml(formatSetting('pdf.option_prefix', '{number}. ', { number: num }))}${mark}${escapeHtml(optText)}</div>`;
                            }).join('')}
                        </div>

                        <div class="explanation-box">
                            <div class="explanation-title">${escapeHtml(t('explanation.title', '해설'))}</div>
                            <div class="explanation-text">${explanation ? escapeHtml(explanation) : escapeHtml(pdfExplanationEmpty)}</div>
                        </div>
                    </div>
                    `;
                }).join('')}
                ` : `
                <div class="section-title" style="page-break-before: always;">
                    <h2>${escapeHtml(pdfWrongNoteTitle)}</h2>
                </div>
                <div style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 8px;">
                    <h3 style="color: #10b981;">${escapeHtml(pdfNoWrongTitle)}</h3>
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
                className="past-exam-selector learning-page learning-selector" style={{ width: '100%', maxWidth: '600px', margin: '0 auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', boxSizing: 'border-box' }}
            >
                {/* 실기 페이지와 구조를 맞추기 위해 필기 기출문제에도 필기 로비 이동 버튼을 추가했습니다. */}
                <button
                    onClick={handleGoWrittenLobby}
                    style={{ marginBottom: '16px', padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    {t('buttons.written_lobby', '필기 로비')}
                </button>

                {/* 기출 응시 제목은 공통 페이지 제목 클래스로 통일합니다. */}
                <p className="learning-eyebrow">정보처리기사 · 필기 기출</p>
                <h1 className="wgs-page-title learning-page-title" style={{ textAlign: 'center', color: 'var(--wgs-title)', marginBottom: '20px' }}>{t('selector.title', '기출문제 응시')}</h1>
                <p className="learning-description">연도와 회차를 고른 뒤 시작하세요. 답안을 모두 제출하면 채점 결과와 해설을 확인할 수 있습니다.</p>
                <div className="past-exam-selector-controls" style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
                    <select aria-label="시험 연도" value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))} style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'var(--wgs-input-bg)', color: 'white', border: '1px solid var(--wgs-border)' }}>
                        {YEARS.map(y => <option key={y} value={y}>{formatSetting('selector.year_option', '{year}년', { year: y })}</option>)}
                    </select>
                    <select aria-label="시험 회차" value={selectedSession} onChange={(e) => setSelectedSession(Number(e.target.value))} style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'var(--wgs-input-bg)', color: 'white', border: '1px solid var(--wgs-border)' }}>
                        {SESSIONS.map(s => <option key={s} value={s}>{formatSetting('selector.session_option', '{session}회차', { session: s })}</option>)}
                    </select>
                </div>
                <button className="learning-primary" onClick={handleStartExam} style={{ width: '100%', padding: '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>
                    {t('buttons.start_exam', '응시 시작')}
                </button>
            </div>
        );
    }

    if (step === 3) {
        return (
            <div
                className="past-exam-result learning-page learning-results" style={{ width: '100%', maxWidth: '900px', margin: '0 auto', background: 'var(--wgs-button-muted)', padding: '30px', borderRadius: '12px', textAlign: 'center', boxSizing: 'border-box' }}
            >
                {/* 결과표에서도 바로 필기 로비로 돌아갈 수 있게 했습니다. */}
                <div style={{ textAlign: 'left', marginBottom: '16px' }}>
                    <button
                        onClick={handleGoWrittenLobby}
                        style={{ padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                        {t('buttons.written_lobby', '필기 로비')}
                    </button>
                </div>

                <h1 className="learning-page-title">{t('result.title', '최종 결과표')}</h1>
                
                <div style={{ background: examResult.isPass ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: `2px solid ${examResult.isPass ? '#10b981' : '#ef4444'}`, padding: '30px', borderRadius: '12px', marginBottom: '25px' }}>
                    <p className="learning-score" style={{ margin: '0 0 10px 0', fontSize: '40px', color: examResult.isPass ? '#10b981' : '#ef4444' }}>{formatSetting('result.average_title', '총 평균 {score}점', { score: examResult.average })}</p>
                    
                    {/*  합격/불합격 메시지에 이름 적용 */}
                    <h3 style={{ margin: 0, color: 'var(--wgs-text)', fontSize: '20px' }}>
                        {examResult.isPass 
                            ? formatSetting('result.pass_message', '{name}님, 합격을 축하합니다!', { name: displayUserName })
                            : formatSetting('result.fail_message', '{name}님은 불합격입니다. ({reason})', { name: displayUserName, reason: examResult.failReason })
                        }
                    </h3>
                    
                    {/*  시간 정보 표시 (웹 버전) */}
                    <div style={{ marginTop: '20px', padding: '15px 20px', background: 'var(--wgs-card)', borderRadius: '8px', display: 'inline-block', textAlign: 'left' }}>
                        <div style={{ color: 'var(--wgs-muted)', fontSize: '14px', marginBottom: '10px', borderBottom: '1px dashed var(--wgs-border)', paddingBottom: '10px' }}>
                            <div style={{ marginBottom: '5px' }}>{t('time.start_label', '시작 일시 : ')}<strong style={{ color: 'var(--wgs-text)' }}>{formatDateTimeLabel(startTime)}</strong></div>
                            <div>{t('time.end_label', '종료 일시 : ')}<strong style={{ color: 'var(--wgs-text)' }}>{formatDateTimeLabel(endTime)}</strong></div>
                        </div>
                        <div className="past-exam-result-time-row" style={{ display: 'flex', gap: '20px' }}>
                            <span style={{ color: 'var(--wgs-muted)', fontSize: '15px' }}>
                                {t('time.elapsed_label', '실제 소요 시간 : ')}<strong style={{ color: 'var(--wgs-text)' }}>{formatTime(9000 - timeLeft)}</strong>
                            </span>
                            <span style={{ color: 'var(--wgs-muted)', fontSize: '15px' }}>
                                {t('time.remaining_label', '남은 시간 : ')}<strong style={{ color: 'var(--wgs-text)' }}>{formatTime(timeLeft)}</strong>
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
                            <div key={i} style={{ background: 'var(--wgs-card)', padding: '15px', borderRadius: '8px', border: `1px solid ${isSubjectPass ? '#3b82f6' : '#ef4444'}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{ fontSize: '14px', color: 'var(--wgs-muted)', marginBottom: '8px' }}>{formatSetting('result.subject_label', '{number}과목', { number: i + 1 })}</div>
                                <div style={{ fontSize: '22px', fontWeight: 'bold', color: isSubjectPass ? '#10b981' : '#ef4444' }}>{formatSetting('result.score_value', '{score}점', { score })}</div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: isSubjectPass ? '#3b82f6' : '#ef4444', marginTop: '5px', background: isSubjectPass ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)', padding: '4px 10px', borderRadius: '12px' }}>
                                    {isSubjectPass ? t('result.subject_pass_badge', 'PASS') : t('result.subject_fail_badge', '과락 (FAIL)')}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <p className="past-exam-personal-result" style={{ color: 'var(--wgs-text)', textAlign: 'center', marginBottom: '20px' }}>
                    {formatSetting('result.accuracy_summary', '정답률 {accuracy}% ({correct}/{total})', { accuracy: examResult.accuracy, correct: examResult.correctCount, total: examResult.totalCount })}
                </p>

                <div className="past-exam-result-table-wrap" style={{ background: 'var(--wgs-card)', padding: '20px', borderRadius: '8px', border: '1px solid var(--wgs-border)', marginBottom: '20px', maxHeight: '400px', overflowY: 'auto', overflowX: 'auto' }}>
                    <h4 style={{ color: 'var(--wgs-muted)', marginTop: 0, marginBottom: '15px', textAlign: 'left', borderBottom: '1px solid var(--wgs-border)', paddingBottom: '10px' }}>{t('result.detail_table_title', ' 제출한 문제 상세 채점표')}</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--wgs-text)', fontSize: '15px' }}>
                        <thead>
                            <tr style={{ background: 'var(--wgs-border)' }}>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>{t('result.table_no_header', '문제 번호')}</th>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>{t('result.table_my_answer_header', '내 정답')}</th>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>{t('result.table_correct_answer_header', '실제 정답')}</th>
                                <th style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>{t('result.table_result_header', '결과')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {questions.map((q, idx) => {
                                const ans = userAnswers[q.question_id];
                                if (ans === undefined) return null; 

                                const isCorrect = String(ans) === String(q.correct_label);
                                return (
                                    <tr key={q.question_id} style={{ background: idx % 2 === 0 ? 'var(--wgs-card)' : 'var(--wgs-card-soft)', textAlign: 'center' }}>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)' }}>{formatSetting('result.question_no_value', '{number}번', { number: idx + 1 })}</td>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)', color: isCorrect ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>
                                            {formatSetting('result.answer_value', '{answer}번', { answer: ans })}
                                        </td>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)', color: '#10b981', fontWeight: 'bold' }}>{formatSetting('result.answer_value', '{answer}번', { answer: q.correct_label })}</td>
                                        <td style={{ padding: '10px', border: '1px solid var(--wgs-border)', color: isCorrect ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>
                                            {isCorrect ? t('result.correct_symbol', 'O') : t('result.wrong_symbol', 'X')}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="past-exam-action-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button className="learning-secondary" onClick={handleExportPDF} style={{ flex: 1, minWidth: '150px', padding: '15px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>{t('buttons.export_pdf', 'PDF로 추출')}
                    </button>
                    <button className="learning-secondary" onClick={() => setStep(2)} style={{ flex: 1, minWidth: '150px', padding: '15px', background: 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>
                        {t('buttons.go_omr', '응시한 OMR 이동')}
                    </button>
                    <button className="learning-primary" onClick={() => setStep(1)} style={{ flex: 1, minWidth: '150px', padding: '15px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px' }}>
                        {t('buttons.retry_other_exam', '다른 기출문제 풀기')}
                    </button>
                </div>
            </div>
        );
    }

    const currentQ = questions[currentIndex];
    
    if (!currentQ) return <div style={{ textAlign: 'center', padding: '50px', color: 'var(--wgs-text)' }}>{t('messages.current_question_missing', '문제를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')}</div>;

    return (
        <div className="exam-page written-exam-page past-exam-page wgs-typography-scope learning-page">
            {showConfirmModal && (
                <>
                    {/* 제출 확인 모달: 기존 채점 함수는 그대로 사용하고, 안내문 색상만 테마와 무관하게 선명하게 고정합니다. */}
                    <div className="past-exam-confirm-overlay">
                    <div className="past-exam-confirm-modal-card">
                        <div className="past-exam-confirm-icon"></div>
                        <div className="past-exam-confirm-message">
                            <strong>{displayUserName}</strong>{t('confirm.message_after_name', '님이 응시하신 시험을')}<br />
                            {t('confirm.message_question', '정말 종료하고 답을 제출하시겠습니까?')}
                        </div>
                        <div className="past-exam-confirm-actions">
                            <button className="past-exam-confirm-submit" onClick={executeGradeExam}>{t('confirm.submit_button', 'Yes (제출)')}</button>
                            <button className="past-exam-confirm-cancel" onClick={() => setShowConfirmModal(false)}>{t('confirm.cancel_button', 'No (계속 풀기)')}</button>
                        </div>
                    </div>
                    </div>
                </>
            )}

            <h1 className="learning-exam-heading">{t('selector.title', '기출문제 응시')}</h1>
            <div className="past-exam-toolbar" style={{ width: '100%', maxWidth: '1200px', margin: '0 auto 15px auto', boxSizing: 'border-box' }}>
                <button
                    onClick={handleGoWrittenLobby}
                    style={{ padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    {t('buttons.written_lobby', '필기 로비')}
                </button>
            </div>

            <div
                className="past-exam-workspace" style={{ display: 'flex', gap: '20px', width: '100%', maxWidth: '1200px', margin: '0 auto', alignItems: 'flex-start', boxSizing: 'border-box' }}
            >
                <div className="past-exam-question-panel" style={{ flex: '1 1 700px', minWidth: 0, background: 'var(--wgs-card)', padding: '30px', borderRadius: '12px', border: '1px solid var(--wgs-border)', boxSizing: 'border-box' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid var(--wgs-border)', paddingBottom: '10px' }}>
                        <span style={{ color: 'var(--wgs-title)', fontWeight: 'bold', fontSize: '18px' }}>{formatSetting('exam.exam_badge', '{year}년 {session}회차', { year: selectedYear, session: selectedSession })}</span>
                        <span style={{ color: 'var(--wgs-muted)', fontSize: '16px' }}>{currentIndex + 1} / {questions.length}</span>
                    </div>
                    
                    <div style={{ color: 'var(--wgs-blue)', fontWeight: 'bold', marginBottom: '10px', fontSize: '14px' }}>
                        {getSubjectNameLabel(currentQ.subject_id)}
                    </div>

                    <div className="exam-question-title-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                        <h3 style={{ margin: 0, lineHeight: '1.5', color: 'var(--wgs-text)', fontSize: '20px' }}>{formatSetting('exam.question_title', '{number}. {text}', { number: currentIndex + 1, text: currentQ.question_text || t('exam.empty_question_text', '문제 내용이 없습니다.') })}</h3>
                        {/* 필기 기출문제 응시 중 현재 문항을 바로 신고하는 버튼입니다. */}
                        <ErrorReportButton
                            examType={t('report.exam_type', '필기')} mode={t('report.mode', '기출문제')} questionInfo={{
                                year: selectedYear,
                                round: selectedSession,
                                number: currentIndex + 1,
                                subject: getSubjectNameLabel(currentQ.subject_id),
                                title: currentQ.question_text,
                            }}
                        />
                    </div>
                    
                    {currentQ.question_img && (
                        <div style={{ textAlign: 'center', margin: '20px 0', width: '100%' }}>
                            <img 
                                src={`/question_image/${currentQ.question_img}`} 
                                alt={t('image.question_alt', '문제 첨부 이미지')} style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '4px' }}
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
                                <button className="learning-choice" aria-pressed={isSelected} data-correct={isSubmitted && String(num) === String(currentQ.correct_label)} data-wrong={isSubmitted && isSelected && String(num) !== String(currentQ.correct_label)} key={num} onClick={() => handleAnswer(num)} disabled={isSubmitted}
                                    style={{ textAlign: 'left', padding: '15px', borderRadius: '8px', background: bg, border: border, color: 'white', fontSize: '16px', cursor: isSubmitted ? 'default' : 'pointer', transition: 'all 0.2s' }}>
                                    {formatSetting('exam.option_prefix', '{number}번. ', { number: num })}{currentQ[`option_${num}`] || ""}
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
                            <div style={{ fontWeight: '900', color: 'var(--wgs-blue)', marginBottom: '8px', fontSize: '16px' }}>
                                {t('explanation.title', '해설')}
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: '15px' }}>
                                {getWrittenExplanation(currentQ) || t('explanation.empty', '이 문제의 해설은 아직 준비 중입니다. 정답과 내 답안을 비교해 보세요.')}
                            </div>
                        </div>
                    )}

                    <div className="past-exam-action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '30px', gap: '15px' }}>
                        <button className="learning-secondary" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} style={{ padding: '12px 25px', background: currentIndex === 0 ? 'var(--wgs-border)' : 'var(--wgs-border)', color: 'white', border: 'none', borderRadius: '6px', cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t('buttons.prev', '이전')}</button>
                        
                        {!isSubmitted ? (
                            <button className="learning-primary" onClick={handleGradeExam} style={{ padding: '12px 30px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', flex: 1 }}>
                                {t('buttons.submit_grade', '제출 및 채점하기')}
                            </button>
                        ) : (
                            <div className="past-exam-action-row" style={{ display: 'flex', gap: '10px', flex: 1 }}>
                                <button onClick={() => setStep(3)} style={{ padding: '12px 10px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', flex: 1 }}>
                                    {t('buttons.go_result', '최종결과표로 이동')}
                                </button>
                                <button onClick={() => { setStep(1); }} style={{ padding: '12px 10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', flex: 1 }}>
                                    {t('buttons.exit_home', '종료 및 홈으로')}
                                </button>
                            </div>
                        )}

                        <button className="learning-secondary" onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))} disabled={currentIndex === questions.length - 1} style={{ padding: '12px 25px', background: currentIndex === questions.length - 1 ? 'var(--wgs-border)' : '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: currentIndex === questions.length - 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t('buttons.next', '다음')}</button>
                    </div>

                    <div style={{ marginTop: '20px' }}>
                        <button onClick={() => setShowDrawing(!showDrawing)} style={{ width: '100%', padding: '12px', background: 'var(--wgs-button-muted)', color: 'var(--wgs-title)', border: '1px solid #3b82f6', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', transition: '0.2s' }}>
                            {showDrawing ? t('buttons.close_drawing', '연습장 닫기') : t('buttons.open_drawing', '연습장 열기')}
                        </button>
                    </div>
                    {showDrawing && <DrawingBoard />}
                    
                </div>

                <div className="past-exam-omr-panel" style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
                    <div style={{ background: 'var(--wgs-card)', padding: '15px', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', borderBottom: '2px solid var(--wgs-border)', textAlign: 'center', zIndex: 10 }}>
                        <div style={{ fontSize: '14px', color: 'var(--wgs-title)', marginBottom: '5px', fontWeight: 'bold' }}>{t('omr.remaining_time_title', '남은 시간')}</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: timeLeft <= 600 ? '#ef4444' : '#10b981' }}>
                            {isSubmitted ? t('time.submitted_placeholder', '--시간 --분 --초') : formatTime(timeLeft)}
                        </div>
                    </div>
                    
                    <div style={{ background: 'var(--wgs-button-muted)', padding: '20px', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', overflowY: 'auto', flex: 1 }}>
                        <h4 style={{ textAlign: 'center', marginTop: 0, borderBottom: '1px solid var(--wgs-border)', paddingBottom: '10px', color: 'var(--wgs-text)' }}>{t('omr.title', '진행 현황 (OMR)')}</h4>
                        <div className="past-exam-omr-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                            {questions.map((q, idx) => {
                                const isAnswered = !!userAnswers[q.question_id];
                                const isCurrent = currentIndex === idx;
                                let bg = isAnswered ? 'var(--wgs-blue)' : 'var(--wgs-input-bg)';
                                
                                if (isSubmitted) {
                                     if (!isAnswered) bg = 'var(--wgs-border)'; 
                                     else if (String(userAnswers[q.question_id]) === String(q.correct_label)) bg = '#10b981'; 
                                     else bg = '#ef4444'; 
                                }

                                return (
                                    <button aria-current={isCurrent ? "step" : undefined} aria-label={`${idx + 1}번 문제, ${isAnswered ? "응답함" : "미응답"}`} key={q.question_id} onClick={() => setCurrentIndex(idx)}
                                        style={{ padding: '15px 0', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px', border: isCurrent ? '2px solid var(--wgs-text)' : '1px solid var(--wgs-border)', background: bg, color: isAnswered ? '#fff' : 'var(--wgs-text)' }}>
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
