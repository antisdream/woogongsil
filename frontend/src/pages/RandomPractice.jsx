import '../styles/app/learning-redesign.css';
// 필기 문제은행 라우트 페이지 컴포넌트입니다.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import DrawingBoard from './DrawingBoard'; 
import ErrorReportButton from '../components/ErrorReportButton';
import useScreenSettings from '../useScreenSettings';
import '../styles/app/mobile-practice.css';

const API_BASE = "";

const WRITTEN_RANDOM_HISTORY_KEY = 'wgs_written_random_history_v1';
const WRITTEN_RANDOM_ID_LIMIT = 120;
const WRITTEN_RANDOM_SUBJECT_LIMIT = 2;

const uniqueRecentList = (list, nextValue, limit) => {
    const normalized = String(nextValue ?? '').trim();
    if (!normalized) return Array.isArray(list) ? list.slice(0, limit) : [];
    return [normalized, ...(Array.isArray(list) ? list.filter((item) => String(item) !== normalized) : [])].slice(0, limit);
};

const readWrittenRandomHistory = () => {
    if (typeof window === 'undefined') return { ids: [], subjects: [] };
    try {
        const parsed = JSON.parse(window.localStorage.getItem(WRITTEN_RANDOM_HISTORY_KEY) || '{}');
        return {
            ids: Array.isArray(parsed.ids) ? parsed.ids.map(String).filter(Boolean).slice(0, WRITTEN_RANDOM_ID_LIMIT) : [],
            subjects: Array.isArray(parsed.subjects) ? parsed.subjects.map(String).filter(Boolean).slice(0, WRITTEN_RANDOM_SUBJECT_LIMIT) : [],
        };
    } catch {
        return { ids: [], subjects: [] };
    }
};

const rememberWrittenRandomQuestion = (nextQuestion) => {
    if (typeof window === 'undefined' || !nextQuestion) return;
    const history = readWrittenRandomHistory();
    const questionId = nextQuestion.question_id || nextQuestion.id;
    const subject = nextQuestion.subject_id || nextQuestion.subject;
    const nextHistory = {
        ids: uniqueRecentList(history.ids, questionId, WRITTEN_RANDOM_ID_LIMIT),
        subjects: uniqueRecentList(history.subjects, subject, WRITTEN_RANDOM_SUBJECT_LIMIT),
    };
    try {
        window.localStorage.setItem(WRITTEN_RANDOM_HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
        // localStorage가 막혀도 랜덤 문제 풀이는 계속 진행합니다.
    }
};

const buildWrittenRandomQuery = () => {
    const history = readWrittenRandomHistory();
    const params = new URLSearchParams();
    if (history.ids.length >0) params.set('excludeIds', history.ids.join(','));
    if (history.subjects.length >0) params.set('excludeSubjects', history.subjects.join(','));
    const query = params.toString();
    return query ? `?${query}` : '';
};


// 필기 해설 텍스트 추출 유틸
// ------------------------------------------------------------
// 백엔드 응답 이름이 화면마다 조금씩 다를 수 있어서
// explanation_text, explanationText, explanation 등을 모두 확인합니다.
// 기존 문제/정답/오답 로직은 변경하지 않고, 화면 출력용 값만 안전하게 꺼냅니다.
const getWrittenExplanation = (item) => {
    const raw = item?.explanation_text
        || item?.explanationText
        || item?.explanation
        || item?.answer_explanation
        || item?.answerExplanation
        || '';

    return String(raw || '').trim();
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

const replaceSettingTokens = (text, values = {}) => {
    let result = String(text || '');
    Object.entries(values).forEach(([key, value]) => {
        result = result.replaceAll(`{${key}}`, String(value ?? ''));
    });
    return result;
};

const RandomPractice = () => {
    const { getSetting } = useScreenSettings('random');
    const t = useCallback((key, fallback) => getSetting(key, fallback), [getSetting]);
    const formatSetting = useCallback((key, fallback, values = {}) => (
        replaceSettingTokens(t(key, fallback), values)
    ), [t]);

    // 필기 문제은행에서 필기 로비(/cert/ipe/written)로 돌아가기 위해 사용합니다.
    const navigate = useNavigate();
    const [question, setQuestion] = useState(null);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isCorrect, setIsCorrect] = useState(null);
    const [loadError, setLoadError] = useState(false);
    
    
    const [showDrawing, setShowDrawing] = useState(false); 

    const userId = sessionStorage.getItem('userId');
    const userName = sessionStorage.getItem('userName');
    const getSessionAuth = useCallback(() => ({
        id: sessionStorage.getItem('userId') || userId || '',
        userId: sessionStorage.getItem('userId') || userId || '',
        sessionToken: sessionStorage.getItem('sessionToken') || '',
        serverInstanceId: sessionStorage.getItem('wgsServerInstanceId') || localStorage.getItem('wgsServerInstanceId') || '',
    }), [userId]);
    
    const nextButtonRef = useRef(null);

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

    const fetchRandomQuestion = useCallback(async () => {
        try {
            setLoadError(false);
            const res = await axios.get(`${API_BASE}/api/random-question${buildWrittenRandomQuery()}`);
            
            if (!res.data || Object.keys(res.data).length === 0) {
                throw new Error("문제 데이터가 비어있습니다.");
            }
            
            setQuestion(res.data);
            rememberWrittenRandomQuestion(res.data);
            setSelectedAnswer(null);
            setIsSubmitted(false);
            setIsCorrect(null);
            setShowDrawing(false); 
        } catch (err) {
            console.error("문제 로딩 에러:", err);
            setLoadError(true);
        }
    }, []);

    useEffect(() => {
        fetchRandomQuestion();
     
    }, [fetchRandomQuestion]);

    const handleGrade = async () => {
        if (!selectedAnswer) return alert(t('messages.need_answer', '정답을 선택해주세요!'));
        
        setIsSubmitted(true);
        const correct = String(selectedAnswer) === String(question.correct_label);
        setIsCorrect(correct);

        if (!correct && userId) {
            try {
                //   오답 저장 시 year와 session을 명시적으로 넘겨주어 백엔드에서 null로 갱신하지 않게 방지합니다.
                await axios.post(`${API_BASE}/api/save-wrong`, { 
                    ...getSessionAuth(),
                    id: userId, 
                    source: 'random',
                    year: question.year,
                    session: question.session,
                    wrongQuestions: [question] 
                });
            } catch (err) { console.error("오답 저장 실패"); }
        }

        if (userId) {
            try {
                await axios.post(`${API_BASE}/api/practice-results`, {
                    ...getSessionAuth(),
                    userId, userName, questionId: question.question_id, isCorrect: correct
                });

            } catch (err) {
                console.error("개인 결과 저장 실패:", err);
                toast.error("결과 저장에 실패했습니다. 현재 채점 결과는 화면에서 확인할 수 있습니다.");
            }
        }

        setTimeout(() => {
            if (nextButtonRef.current) {
                nextButtonRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    };

    if (loadError) return <section className="learning-page learning-state" role="alert"><h1>문제를 불러오지 못했어요</h1><p>{t('messages.load_failed', '문제를 불러오는데 실패했습니다. 잠시 후 다시 시도해 주세요.')}</p><button className="learning-primary" onClick={fetchRandomQuestion}>다시 불러오기</button><button className="learning-secondary" onClick={() => navigate('/cert/ipe/written')}>필기 로비</button></section>;
    if (!question) return <section className="learning-page learning-state" role="status"><h1>필기 문제은행</h1><p>{t('messages.loading', '문제를 불러오는 중입니다...')}</p></section>;

    const hasOptionsArray = question.options && Array.isArray(question.options) && question.options.length >0;

    return (
        <div
            className="exam-page written-exam-page random-practice-page wgs-typography-scope mobile-practice-page learning-page learning-question-page" style={{ width: '100%', maxWidth: '800px', margin: '0 auto', color: 'var(--wgs-text)', paddingBottom: '50px', boxSizing: 'border-box' }}
        >
            {/* 실기 페이지와 구조를 맞추기 위해 필기 문제은행에도 필기 로비 이동 버튼을 추가했습니다. */}
            <div className="mobile-practice-back-row" style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '15px' }}>
                <button
                    className="mobile-practice-secondary-action"
                    onClick={() => navigate('/cert/ipe/written')}
                    style={{ padding: '10px 16px', background: '#475569', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    {t('buttons.written_lobby', '필기 로비')}
                </button>
            </div>

            <div className="mobile-practice-meta-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                {/*   문제은행 상단 뱃지에 연도, 회차, 문제 번호 출력 추가합니다. */}
                <div className="mobile-practice-meta-badge" style={{ background: '#3b82f6', color: 'var(--wgs-text)', padding: '6px 12px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px' }}>
                    {formatSetting('meta.question_badge', '[{year}년 {session}회차 {number}번] {subject}', {
                        year: question.year,
                        session: question.session,
                        number: question.info_id,
                        subject: getSubjectNameLabel(question.subject_id)
                    })}
                </div>
            </div>

            <div className="exam-question-title-row mobile-practice-title-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '2px solid var(--wgs-border)', paddingBottom: '10px' }}>
                {/* 문제은행 제목은 공통 섹션 제목 클래스 기준으로 통일합니다. */}
                <h1 className="wgs-section-title mobile-practice-heading learning-page-title" style={{ color: 'var(--wgs-blue)', margin: 0 }}>{t('page.title', '오늘의 문제은행')}</h1>
                {/* 현재 보고 있는 필기 문제은행 문항을 관리자에게 즉시 신고하는 버튼입니다. */}
                <ErrorReportButton
                    examType={t('report.exam_type', '필기')} mode={t('report.mode', '문제은행')} questionInfo={{
                        year: question?.year,
                        round: question?.session,
                        number: question?.info_id || question?.question_id || question?.id,
                        subject: getSubjectNameLabel(question?.subject_id),
                        title: question?.question_text,
                    }}
                />
            </div>

            <div className="mobile-practice-question" style={{ fontSize: '18px', lineHeight: '1.6', margin: '20px 0', padding: '20px', background: 'var(--wgs-input-bg)', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--wgs-blue)', marginRight: '10px' }}>{t('question.prefix', 'Q.')}</span>
                {question.question_text}
            </div>

            {question.question_img && (
                <div className="mobile-practice-image" style={{ textAlign: 'center', margin: '20px 0', width: '100%' }}>
                    <img 
                        src={`/question_image/${question.question_img}`} 
                        alt={t('image.question_alt', '문제 첨부 이미지')} style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '4px' }}
                        onError={(e) => { e.target.style.display = 'none'; }} 
                    />
                </div>
            )}

            <div role="group" aria-label="답안 선택" className="mobile-practice-options" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {hasOptionsArray ? (
                    question.options.map((opt) => (
                        <button className="mobile-practice-option learning-choice" aria-pressed={selectedAnswer === opt.label} aria-disabled={isSubmitted} key={opt.label} onClick={() => !isSubmitted && setSelectedAnswer(opt.label)}
                            style={{ padding: '15px', textAlign: 'left', borderRadius: '8px', background: selectedAnswer === opt.label ? '#3b82f6' : 'var(--wgs-input-bg)', border: `1px solid ${selectedAnswer === opt.label ? 'var(--wgs-blue)' : 'var(--wgs-border)'}`, color: 'white', cursor: isSubmitted ? 'default' : 'pointer', fontSize: '16px', transition: 'all 0.2s ease-in-out' }}>
                            <strong style={{ display: 'inline-block', width: '30px' }}>{opt.label}.</strong> {opt.option_text || opt.text}
                        </button>
                    ))
                ) : (
                    [1, 2, 3, 4].map(num => {
                        const optText = question[`option_${num}`] || question[`option${num}`];
                        if (!optText) return null;
                        return (
                            <button className="mobile-practice-option learning-choice" aria-pressed={selectedAnswer === num} aria-disabled={isSubmitted} key={num} onClick={() => !isSubmitted && setSelectedAnswer(num)}
                                style={{ padding: '15px', textAlign: 'left', borderRadius: '8px', background: selectedAnswer === num ? '#3b82f6' : 'var(--wgs-input-bg)', border: `1px solid ${selectedAnswer === num ? 'var(--wgs-blue)' : 'var(--wgs-border)'}`, color: 'white', cursor: isSubmitted ? 'default' : 'pointer', fontSize: '16px', transition: 'all 0.2s ease-in-out' }}>
                                <strong style={{ display: 'inline-block', width: '30px' }}>{num}.</strong> {optText}
                            </button>
                        );
                    })
                )}
            </div>

            <div className="mobile-practice-answer-area" style={{ marginTop: '30px', textAlign: 'center' }}>
                {!isSubmitted ? (
                    <>
                        <button className="mobile-practice-primary-action" onClick={handleGrade} style={{ padding: '15px 40px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', width: '100%', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                            {t('buttons.check_answer', '정답 확인하기')}
                        </button>
                        
                        <div style={{ marginTop: '15px' }}>
                            <button className="mobile-practice-secondary-action" onClick={() => setShowDrawing(!showDrawing)} style={{ width: '100%', padding: '12px', background: 'var(--wgs-button-muted)', color: 'var(--wgs-title)', border: '1px solid #3b82f6', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', transition: '0.2s' }}>
                                {showDrawing ? t('buttons.close_drawing', '연습장 닫기') : t('buttons.open_drawing', '연습장 열기')}
                            </button>
                        </div>
                        {showDrawing && <DrawingBoard />}
                    </>
                ) : (
                    <div style={{ animation: 'fadeIn 0.5s' }}>
                        <div role="status" className="mobile-practice-result" style={{ padding: '20px', background: isCorrect ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: `2px solid ${isCorrect ? '#10b981' : '#ef4444'}`, borderRadius: '8px', marginBottom: '18px' }}>
                            <h3 className="mobile-practice-result-title" style={{ color: isCorrect ? '#10b981' : '#ef4444', margin: '0 0 10px 0' }}>
                                {isCorrect ? t('result.correct_title', '정답입니다!') : t('result.wrong_title', '아쉽습니다, 다시 도전해보세요!')}
                            </h3>
                            {!isCorrect && <p className="mobile-practice-result-answer" style={{ margin: 0, fontSize: '16px', color: 'var(--wgs-text)' }}>{formatSetting('result.correct_answer_prefix', '정답은 ', {})}<strong style={{ color: '#10b981' }}>{formatSetting('result.correct_answer_value', '{label}번', { label: question.correct_label })}</strong>{formatSetting('result.correct_answer_suffix', ' 입니다.', {})}</p>}
                            {!isCorrect && userId && <p className="mobile-practice-result-notice" style={{ margin: '10px 0 0 0', color: 'var(--wgs-muted)', fontSize: '14px' }}>{t('result.wrong_saved_notice', '오답 저장 여부는 마이페이지의 오답노트에서 확인할 수 있습니다.')}</p>}
                        </div>

                        {/* ============================================================
                            필기 문제은행 해설 출력 영역
                            ------------------------------------------------------------
                            정답/오답 여부와 상관없이 제출 후 항상 보여줍니다.
                            정답/오답 결과 아래에 해설을 표시합니다.
                            ============================================================ */}
                        <div
                            className="written-explanation-box mobile-practice-explanation" style={{
                                margin: '0 0 20px 0',
                                padding: '18px 20px',
                                background: 'rgba(59, 130, 246, 0.08)',
                                border: '1px solid rgba(59, 130, 246, 0.45)',
                                borderRadius: '10px',
                                textAlign: 'left',
                                color: 'var(--wgs-title)',
                                lineHeight: 1.7,
                                boxSizing: 'border-box'
                            }}
                        >
                            <div style={{ fontWeight: '900', color: 'var(--wgs-blue)', marginBottom: '8px', fontSize: '16px' }}>
                                {t('explanation.title', '해설')}
                            </div>
                            <div className="mobile-practice-explanation-body" style={{ whiteSpace: 'pre-wrap', fontSize: '15px' }}>
                                {getWrittenExplanation(question) || t('explanation.empty', '이 문제의 해설은 아직 준비 중입니다. 정답을 확인한 뒤 다음 문제로 이어가세요.')}
                            </div>
                        </div>

                        <button className="mobile-practice-primary-action" ref={nextButtonRef} onClick={fetchRandomQuestion} style={{ padding: '15px 40px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', width: '100%', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                            {t('buttons.next_question', '다음 문제 풀기')}
                        </button>
                        
                        <div style={{ marginTop: '15px' }}>
                            <button className="mobile-practice-secondary-action" onClick={() => setShowDrawing(!showDrawing)} style={{ width: '100%', padding: '12px', background: 'var(--wgs-button-muted)', color: 'var(--wgs-title)', border: '1px dashed var(--wgs-border)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
                                {showDrawing ? t('buttons.close_drawing', '연습장 닫기') : t('buttons.open_drawing', '연습장 열기')}
                            </button>
                        </div>
                        {showDrawing && <DrawingBoard />}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RandomPractice;
