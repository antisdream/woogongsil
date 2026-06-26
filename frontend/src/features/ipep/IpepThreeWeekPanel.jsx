import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ErrorReportButton from '../../components/ErrorReportButton.jsx';
import DrawingBoard from '../../pages/DrawingBoard.jsx';
import IpepSpecialSymbolPad from './IpepSpecialSymbolPad.jsx';
import { mergeClientIpepGrade } from './ipepPracticeUtils.js';
import { IpepExplanationImage, IpepQuestionImages } from './IpepQuestionImages.jsx';
import {
    answerTextareaStyle,
    baseButtonStyle,
    badgeStyle,
    compactPanelStyle,
    compactSelectStyle,
    filterBarStyle,
    mutedTextStyle,
    questionCardStyle,
    questionTitleRowStyle,
    questionTitleStyle,
    studyHeaderStyle,
    studyTitleStyle,
} from './ipepPracticeStyles.js';

const API_BASE = '';

const orderOptions = [
    { value: 'section', label: '섹션순', description: 'Section 번호와 문제번호 오름차순' },
    { value: 'random', label: '랜덤', description: '전체 범위를 섞어서 풀기' },
];

const fallbackText = (key, fallback) => fallback;
const fallbackFormatText = (key, fallback, values = {}) => {
    let result = String(fallback || '');
    Object.entries(values).forEach(([name, value]) => {
        result = result.replaceAll(`{${name}}`, String(value ?? ''));
    });
    return result;
};

function splitChoiceText(value) {
    return String(value || '')
        .split('|')
        .map((line) => line.trim())
        .filter(Boolean);
}

function getQuestionKey(question, index) {
    return question?.sectionQuestionKey || question?.section_question_key || `${question?.sectionNo || '---'}-${index + 1}`;
}

export default function IpepThreeWeekPanel({
    openImageViewer,
    getText = fallbackText,
    formatText = fallbackFormatText,
    onWrongAnswer,
}) {
    const [overview, setOverview] = useState({ weeks: [], sections: [] });
    const [selectedWeek, setSelectedWeek] = useState(1);
    const [selectedSection, setSelectedSection] = useState('ALL');
    const [order, setOrder] = useState('section');
    const [questions, setQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState({});
    const [results, setResults] = useState({});
    const [loadingOverview, setLoadingOverview] = useState(false);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [checking, setChecking] = useState(false);
    const [isDrawingOpen, setIsDrawingOpen] = useState(false);
    const answerRef = useRef(null);

    const fetchOverview = useCallback(async () => {
        setLoadingOverview(true);
        try {
            const res = await axios.get(`${API_BASE}/api/ipep/three-week/overview`);
            setOverview(res.data?.data || { weeks: [], sections: [] });
        } catch (error) {
            console.error('3주 공략 개요 조회 실패:', error);
            setOverview({ weeks: [], sections: [] });
        } finally {
            setLoadingOverview(false);
        }
    }, []);

    const fetchQuestions = useCallback(async () => {
        setLoadingQuestions(true);
        try {
            const params = new URLSearchParams({
                weekNo: String(selectedWeek),
                sectionNo: selectedSection,
                order,
            });
            const res = await axios.get(`${API_BASE}/api/ipep/three-week/questions?${params.toString()}`);
            setQuestions(Array.isArray(res.data?.data) ? res.data.data : []);
            setCurrentIndex(0);
            setAnswers({});
            setResults({});
        } catch (error) {
            console.error('3주 공략 문제 조회 실패:', error);
            setQuestions([]);
        } finally {
            setLoadingQuestions(false);
        }
    }, [order, selectedSection, selectedWeek]);

    useEffect(() => {
        fetchOverview();
    }, [fetchOverview]);

    useEffect(() => {
        fetchQuestions();
    }, [fetchQuestions]);

    useEffect(() => {
        setSelectedSection('ALL');
    }, [selectedWeek]);

    const sectionsForWeek = useMemo(() => (
        Array.isArray(overview.sections)
            ? overview.sections.filter((section) => Number(section.weekNo) === Number(selectedWeek))
            : []
    ), [overview.sections, selectedWeek]);

    const currentQuestion = questions[currentIndex] || null;
    const currentAnswer = currentQuestion ? answers[currentQuestion.questionId] || '' : '';
    const currentResult = currentQuestion ? results[currentQuestion.questionId] : null;
    const solvedCount = Object.keys(results).length;
    const selectedOrder = orderOptions.find((option) => option.value === order) || orderOptions[0];
    const currentQuestionKey = currentQuestion ? getQuestionKey(currentQuestion, currentIndex) : '';

    async function checkCurrentAnswer() {
        if (!currentQuestion || checking) return;
        if (!String(currentAnswer || '').trim()) {
            alert(getText('three_week.need_answer', '답안을 먼저 입력해 주세요.'));
            return;
        }

        setChecking(true);
        try {
            const res = await axios.post(`${API_BASE}/api/ipep/check-answer`, {
                source: currentQuestion.source,
                questionId: currentQuestion.questionId,
                userAnswer: currentAnswer,
            });

            const rawResult = res.data || {};
            const gradedResult = rawResult.requiresSelfCheck
                ? {
                    ...rawResult,
                    isCorrect: null,
                    score: 0,
                    maxScore: Number(rawResult.maxScore || currentQuestion.score || 5),
                    correctAnswer: rawResult.correctAnswer || '',
                }
                : mergeClientIpepGrade(currentQuestion, rawResult, currentAnswer);

            setResults((prev) => ({
                ...prev,
                [currentQuestion.questionId]: gradedResult,
            }));

            if (!gradedResult.requiresSelfCheck && !gradedResult.isCorrect && typeof onWrongAnswer === 'function') {
                await onWrongAnswer({
                    question: currentQuestion,
                    userAnswer: currentAnswer,
                    result: gradedResult,
                });
            }
        } catch (error) {
            console.error('3주 공략 채점 실패:', error);
            alert(getText('three_week.check_failed', '채점 중 오류가 발생했습니다.'));
        } finally {
            setChecking(false);
        }
    }

    function applySelfCheck(isCorrect) {
        if (!currentQuestion || !currentResult?.requiresSelfCheck) return;
        const maxScore = Number(currentResult.maxScore || currentQuestion.score || 5);
        const nextResult = {
            ...currentResult,
            isCorrect,
            score: isCorrect ? maxScore : 0,
            maxScore,
        };
        setResults((prev) => ({
            ...prev,
            [currentQuestion.questionId]: nextResult,
        }));

        if (!isCorrect && typeof onWrongAnswer === 'function') {
            Promise.resolve(onWrongAnswer({
                question: currentQuestion,
                userAnswer: currentAnswer,
                result: nextResult,
            })).catch((error) => {
                console.warn('3주 공략 오답 저장 실패:', error);
            });
        }
    }

    const choiceLines = splitChoiceText(currentQuestion?.choiceText);

    return (
        <section style={compactPanelStyle}>
            <div style={studyHeaderStyle}>
                <div>
                    <h3 style={studyTitleStyle}>
                        {getText('three_week_title', '3주 공략')}
                    </h3>
                    <p style={{ ...mutedTextStyle, fontSize: '14px' }}>
                        {selectedWeek}주차 · {selectedSection === 'ALL' ? '전체 Section' : `Section ${selectedSection}`} · {selectedOrder.label}
                    </p>
                </div>
                <div style={{ color: 'var(--wgs-muted)', fontWeight: 800, alignSelf: 'center' }}>
                    {formatText('three_week_progress', '{solved} / {total}문제 확인', {
                        solved: solvedCount,
                        total: questions.length,
                    })}
                </div>
            </div>

            <div
                className="ipep-three-week-filters" style={{ ...filterBarStyle, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))', alignItems: 'end' }}
            >
                <label style={{ display: 'grid', gap: '8px', color: 'var(--wgs-muted)', fontSize: '13px', fontWeight: 900 }}>
                    주차
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                        {[1, 2, 3].map((weekNo) => {
                            const week = overview.weeks?.find((row) => Number(row.weekNo) === weekNo);
                            const questionCount = Number(week?.questionCount || 0);
                            return (
                                <button
                                    key={weekNo}
                                    type="button"
                                    onClick={() => setSelectedWeek(weekNo)}
                                    title={`${weekNo}주차 ${questionCount}문제`}
                                    style={{
                                        ...baseButtonStyle,
                                        minHeight: '42px',
                                        padding: '8px',
                                        background: selectedWeek === weekNo ? '#3b82f6' : 'var(--wgs-button-muted)',
                                        opacity: questionCount > 0 ? 1 : 0.72,
                                    }}
                                >
                                    {weekNo}주차
                                </button>
                            );
                        })}
                    </div>
                </label>

                <label style={{ display: 'grid', gap: '8px', color: 'var(--wgs-muted)', fontSize: '13px', fontWeight: 900 }} title={selectedOrder.description}>
                    정렬
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
                        {orderOptions.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                title={option.description}
                                onClick={() => setOrder(option.value)}
                                style={{
                                    ...baseButtonStyle,
                                    minHeight: '42px',
                                    padding: '8px',
                                    background: order === option.value ? '#10b981' : 'var(--wgs-button-muted)',
                                }}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </label>

                <label style={{ display: 'grid', gap: '8px', color: 'var(--wgs-muted)', fontSize: '13px', fontWeight: 900 }}>
                    Section
                    <select
                        value={selectedSection}
                        onChange={(event) => setSelectedSection(event.target.value)}
                        style={compactSelectStyle}
                    >
                        <option value="ALL">전체 Section</option>
                        {sectionsForWeek.map((section) => {
                            const questionCount = Number(section.questionCount || 0);
                            return (
                                <option key={section.sectionNo} value={section.sectionNo} disabled={questionCount === 0}>
                                    Section {section.sectionNo} ({questionCount})
                                </option>
                            );
                        })}
                    </select>
                </label>
            </div>

            <div style={questionCardStyle}>
                {loadingOverview || loadingQuestions ? (
                    <p style={{ color: 'var(--wgs-muted)', margin: 0 }}>문제를 불러오는 중입니다...</p>
                ) : !currentQuestion ? (
                    <div style={{ color: 'var(--wgs-muted)', lineHeight: 1.7 }}>
                        아직 이 범위의 3주 공략 문제가 준비되지 않았습니다.
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={badgeStyle}>3주 공략</span>
                                <span style={badgeStyle}>Section {currentQuestion.sectionNo}</span>
                                <span style={badgeStyle}>{currentQuestionKey}</span>
                                <span style={badgeStyle}>{currentQuestion.gradingPolicy}</span>
                            </div>
                            <span style={{ color: 'var(--wgs-muted)', fontWeight: 800 }}>{currentIndex + 1} / {questions.length}</span>
                        </div>

                        <div className="exam-question-title-row" style={questionTitleRowStyle}>
                            <h4 style={questionTitleStyle}>
                                {currentQuestion.questionText}
                            </h4>
                            <ErrorReportButton
                                examType="실기"
                                mode="3주 공략"
                                questionInfo={{
                                    sourceLabel: `3주 공략 ${selectedWeek}주차`,
                                    number: currentQuestionKey,
                                    subject: `Section ${currentQuestion.sectionNo}`,
                                    title: currentQuestion.questionText,
                                }}
                            />
                        </div>

                        {choiceLines.length > 0 && (
                            <div style={{ border: '1px solid var(--wgs-border)', borderRadius: '10px', padding: '14px', background: 'var(--wgs-input-bg)', marginBottom: '16px' }}>
                                <div style={{ color: 'var(--wgs-blue-soft)', fontWeight: 900, marginBottom: '8px' }}>보기</div>
                                <ul style={{ color: 'var(--wgs-text)', lineHeight: 1.8, margin: 0, paddingLeft: '20px' }}>
                                    {choiceLines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
                                </ul>
                            </div>
                        )}

                        <IpepQuestionImages
                            question={currentQuestion}
                            openImageViewer={openImageViewer}
                            choiceAlt="보기 이미지"
                            choiceViewerTitle="보기 이미지 크게 보기"
                            choiceButtonLabel="보기 이미지 크게 보기"
                        />

                        <textarea
                            ref={answerRef}
                            value={currentAnswer}
                            onChange={(event) => setAnswers((prev) => ({
                                ...prev,
                                [currentQuestion.questionId]: event.target.value,
                            }))}
                            placeholder="답안을 입력해 주세요. 대소문자, 띄어쓰기, 일부 문장부호 차이는 최대한 허용합니다."
                            style={answerTextareaStyle}
                        />

                        <IpepSpecialSymbolPad
                            textareaRef={answerRef}
                            value={currentAnswer}
                            onChange={(nextValue) => setAnswers((prev) => ({
                                ...prev,
                                [currentQuestion.questionId]: nextValue,
                            }))}
                        />

                        <button
                            type="button"
                            onClick={() => setIsDrawingOpen((prev) => !prev)}
                            style={{ ...baseButtonStyle, width: '100%', marginTop: '10px', background: 'var(--wgs-practice-toggle-bg)', border: '1px solid #3b82f6' }}
                        >
                            {isDrawingOpen ? '연습장 닫기' : '연습장 열기'}
                        </button>
                        {isDrawingOpen && <DrawingBoard />}

                        <div className="ipep-action-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
                            <button
                                type="button"
                                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                                disabled={currentIndex === 0}
                                style={{ ...baseButtonStyle, flex: '1 1 110px', background: 'var(--wgs-button-muted)', opacity: currentIndex === 0 ? 0.55 : 1 }}
                            >
                                이전
                            </button>
                            <button
                                type="button"
                                onClick={checkCurrentAnswer}
                                disabled={checking}
                                style={{ ...baseButtonStyle, background: '#3b82f6', flex: '2 1 180px' }}
                            >
                                {checking ? '채점 중...' : '정답 제출'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))}
                                disabled={currentIndex === questions.length - 1}
                                style={{ ...baseButtonStyle, flex: '1 1 110px', background: currentIndex === questions.length - 1 ? 'var(--wgs-button-muted)' : '#10b981', opacity: currentIndex === questions.length - 1 ? 0.55 : 1 }}
                            >
                                다음
                            </button>
                        </div>

                        {currentResult && (
                            <div style={{ marginTop: '16px', padding: '18px', borderRadius: '10px', background: currentResult.isCorrect ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)', border: `1px solid ${currentResult.isCorrect ? '#10b981' : '#ef4444'}` }}>
                                <h4 style={{ margin: '0 0 12px 0', color: currentResult.isCorrect ? '#10b981' : '#ef4444' }}>
                                    {currentResult.requiresSelfCheck && currentResult.isCorrect === null
                                        ? '정답 예시를 보고 직접 판단해 주세요.'
                                        : currentResult.isCorrect
                                            ? `정답입니다. ${currentResult.score} / ${currentResult.maxScore}`
                                            : `오답입니다. ${currentResult.score} / ${currentResult.maxScore}`}
                                </h4>
                                <div style={{ color: 'var(--wgs-muted)', fontSize: '14px', marginBottom: '8px' }}>정답</div>
                                <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--wgs-input-bg)', color: 'var(--wgs-text)', padding: '12px', borderRadius: '8px', margin: 0 }}>{currentResult.correctAnswer}</pre>

                                {currentResult.requiresSelfCheck && currentResult.isCorrect === null && (
                                    <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
                                        <button type="button" onClick={() => applySelfCheck(true)} style={{ ...baseButtonStyle, background: '#10b981' }}>맞음 처리</button>
                                        <button type="button" onClick={() => applySelfCheck(false)} style={{ ...baseButtonStyle, background: '#ef4444' }}>틀림 처리</button>
                                    </div>
                                )}

                                {currentResult.explanationText && (
                                    <div style={{ marginTop: '14px' }}>
                                        <div style={{ color: 'var(--wgs-muted)', fontSize: '14px', marginBottom: '8px' }}>해설</div>
                                        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--wgs-text)', background: 'var(--wgs-input-bg)', borderRadius: '8px', padding: '12px', lineHeight: 1.7 }}>
                                            {currentResult.explanationText}
                                        </div>
                                    </div>
                                )}

                                <IpepExplanationImage
                                    question={currentQuestion}
                                    openImageViewer={openImageViewer}
                                    explanationTitle="해설 이미지"
                                    explanationAlt="해설 이미지"
                                    explanationViewerTitle="해설 이미지 크게 보기"
                                    explanationButtonLabel="해설 이미지 크게 보기"
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {questions.length > 0 && (
                <details className="ipep-question-nav-details" style={{ marginTop: '12px', border: '1px solid var(--wgs-border)', borderRadius: '10px', background: 'var(--wgs-exam-card)', padding: '10px' }}>
                    <summary style={{ color: 'var(--wgs-blue-soft)', fontWeight: 900, cursor: 'pointer' }}>
                        문제 이동 {currentIndex + 1} / {questions.length}
                    </summary>
                    <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '8px' }}>
                        {questions.map((question, index) => {
                            const active = index === currentIndex;
                            const solved = Boolean(results[question.questionId]);
                            return (
                                <button
                                    key={question.questionId}
                                    type="button"
                                    title={getQuestionKey(question, index)}
                                    onClick={() => setCurrentIndex(index)}
                                    style={{
                                        minHeight: '38px',
                                        borderRadius: '7px',
                                        border: active ? '2px solid #fcd34d' : '1px solid var(--wgs-border)',
                                        background: solved ? '#10b981' : 'var(--wgs-input-bg)',
                                        color: 'var(--wgs-text)',
                                        fontWeight: 900,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {getQuestionKey(question, index)}
                                </button>
                            );
                        })}
                    </div>
                </details>
            )}
        </section>
    );
}
