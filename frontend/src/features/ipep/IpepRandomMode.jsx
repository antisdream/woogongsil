import React from 'react';
import ErrorReportButton from '../../components/ErrorReportButton.jsx';
import DrawingBoard from '../../pages/DrawingBoard.jsx';
import IpepSpecialSymbolPad from './IpepSpecialSymbolPad.jsx';
import { IpepExplanationImage, IpepQuestionImages } from './IpepQuestionImages.jsx';
import {
    answerTextareaStyle,
    baseButtonStyle,
    badgeStyle,
    compactPanelStyle,
    horizontalFilterBarStyle,
    mutedTextStyle,
    questionCardStyle,
    questionTitleRowStyle,
    questionTitleStyle,
    studyHeaderStyle,
    studyTitleStyle,
} from './ipepPracticeStyles.js';

export default function IpepRandomMode({
    subjects,
    selectedSubject,
    setSelectedSubject,
    randomLoading,
    randomQuestion,
    randomAnswer,
    setRandomAnswer,
    randomResult,
    randomAnswerRef,
    isDrawingOpen,
    setIsDrawingOpen,
    checkRandomAnswer,
    fetchRandomQuestion,
    openImageViewer,
    getText,
    formatText,
}) {
    const selectedSubjectName = selectedSubject === 'ALL'
        ? getText('random.all_subject_label', '전체 과목 섞기')
        : subjects.find((subject) => subject.subjectCode === selectedSubject)?.subjectName || selectedSubject;

    return (
        <section style={compactPanelStyle}>
            <div style={studyHeaderStyle}>
                <div>
                    <h3 style={studyTitleStyle}>{getText('random.title', ' 실기 문제은행')}</h3>
                    <p style={{ ...mutedTextStyle, fontSize: '14px' }}>
                        {selectedSubjectName}
                    </p>
                </div>
            </div>

            <div className="ipep-filter-strip" style={horizontalFilterBarStyle}>
                <button
                    type="button"
                    onClick={() => setSelectedSubject('ALL')}
                    style={{ ...baseButtonStyle, flex: '0 0 auto', minHeight: '40px', padding: '10px 14px', background: selectedSubject === 'ALL' ? '#3b82f6' : 'var(--wgs-button-muted)' }}
                >
                    {getText('random.all_subject_label', '전체 과목 섞기')}
                </button>
                {subjects.map((subject) => (
                    <button
                        key={subject.subjectCode}
                        type="button"
                        onClick={() => setSelectedSubject(subject.subjectCode)}
                        style={{ ...baseButtonStyle, flex: '0 0 auto', minHeight: '40px', padding: '10px 14px', background: selectedSubject === subject.subjectCode ? '#3b82f6' : 'var(--wgs-button-muted)' }}
                    >
                        {subject.subjectCode}. {subject.subjectName} ({subject.questionCount})
                    </button>
                ))}
            </div>

            <div style={questionCardStyle}>
                {randomLoading ? (
                    <p style={{ color: 'var(--wgs-muted)' }}>{getText('random.loading', '문제를 불러오는 중입니다...')}</p>
                ) : randomQuestion ? (
                    <>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                            <span style={badgeStyle}>{getText('random.badge', '문제은행')}</span>
                            <span style={badgeStyle}>{selectedSubjectName}</span>
                            <span style={badgeStyle}>{formatText('random.grading_policy_badge', '채점유형 {policy}', { policy: randomQuestion.gradingPolicy })}</span>
                        </div>

                        <div className="exam-question-title-row" style={questionTitleRowStyle}>
                            <h4 style={questionTitleStyle}>{randomQuestion.questionText}</h4>
                            <ErrorReportButton
                                examType={getText('report.exam_type', '실기')}
                                mode={getText('report.random_mode', '문제은행')}
                                questionInfo={{
                                    year: randomQuestion?.examYear,
                                    round: randomQuestion?.examSession,
                                    number: randomQuestion?.questionNo || randomQuestion?.questionId,
                                    subject: selectedSubjectName,
                                    title: randomQuestion?.questionText,
                                }}
                            />
                        </div>
                        <IpepQuestionImages
                            question={randomQuestion}
                            openImageViewer={openImageViewer}
                            choiceAlt={getText('image.choice_alt', '보기 이미지')}
                            choiceViewerTitle={getText('image.choice_viewer_title', '보기 이미지 크게 보기')}
                            choiceButtonLabel={getText('image.choice_button', ' 보기 이미지 크게 보기')}
                        />

                        <textarea
                            ref={randomAnswerRef}
                            value={randomAnswer}
                            onChange={(event) => setRandomAnswer(event.target.value)}
                            placeholder={getText('form.answer_placeholder', '여기에 실기 답안을 입력해 주세요. 대소문자, 띄어쓰기, 쉼표 유무 차이는 채점 시 최대한 허용됩니다.')}
                            style={answerTextareaStyle}
                        />

                        <IpepSpecialSymbolPad
                            textareaRef={randomAnswerRef}
                            value={randomAnswer}
                            onChange={setRandomAnswer}
                        />

                        <button
                            type="button"
                            onClick={() => setIsDrawingOpen((prev) => !prev)}
                            style={{ ...baseButtonStyle, width: '100%', marginTop: '10px', background: 'var(--wgs-practice-toggle-bg)', border: '1px solid #3b82f6' }}
                        >
                            {isDrawingOpen ? getText('buttons.close_drawing', '연습장 닫기') : getText('buttons.open_drawing', '연습장 열기')}
                        </button>
                        {isDrawingOpen && <DrawingBoard />}

                        <div className="ipep-action-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
                            <button type="button" onClick={checkRandomAnswer} style={{ ...baseButtonStyle, flex: '1 1 180px', background: '#3b82f6' }}>{getText('buttons.submit_answer', ' 정답 제출')}</button>
                            <button type="button" onClick={() => fetchRandomQuestion(selectedSubject)} style={{ ...baseButtonStyle, flex: '1 1 140px', background: 'var(--wgs-button-muted)' }}>{getText('buttons.next_random', ' 다른 문제')}</button>
                        </div>

                        {randomResult && (
                            <div style={{ marginTop: '16px', padding: '18px', borderRadius: '10px', background: randomResult.isCorrect ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.16)', border: `1px solid ${randomResult.isCorrect ? '#10b981' : '#ef4444'}` }}>
                                <h4 style={{ margin: '0 0 12px 0', color: randomResult.isCorrect ? '#10b981' : '#ef4444' }}>
                                    {randomResult.requiresSelfCheck
                                        ? getText('result.self_check_needed', '정답 예시 확인이 필요합니다.')
                                        : randomResult.isCorrect
                                            ? formatText('result.random_correct', ' 정답입니다! 획득 점수: {score} / {maxScore}', { score: randomResult.score, maxScore: randomResult.maxScore })
                                            : formatText('result.random_wrong', ' 오답입니다. 획득 점수: {score} / {maxScore}', { score: randomResult.score, maxScore: randomResult.maxScore })}
                                </h4>
                                <div style={{ color: 'var(--wgs-muted)', fontSize: '14px', marginBottom: '8px' }}>{getText('result.correct_answer_label', '정답:')}</div>
                                <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--wgs-input-bg)', color: 'var(--wgs-text)', padding: '12px', borderRadius: '8px', margin: 0 }}>{randomResult.correctAnswer}</pre>
                                <div style={{ color: 'var(--wgs-muted)', fontSize: '13px', marginTop: '10px' }}>{formatText('result.grading_policy_label', '채점 기준: {policy}', { policy: randomResult.detail?.compareMode || randomResult.gradingPolicy })}</div>
                                <IpepExplanationImage
                                    question={randomQuestion}
                                    openImageViewer={openImageViewer}
                                    explanationTitle={getText('image.explanation_title', ' 해설 이미지')}
                                    explanationAlt={getText('image.explanation_alt', '해설 이미지')}
                                    explanationViewerTitle={getText('image.explanation_viewer_title', '해설 이미지 크게 보기')}
                                    explanationButtonLabel={getText('image.explanation_button', ' 해설 이미지 확대해서 보기')}
                                />
                            </div>
                        )}
                    </>
                ) : (
                    <p style={{ color: 'var(--wgs-muted)' }}>{getText('random.empty', '표시할 문제가 없습니다.')}</p>
                )}
            </div>
        </section>
    );
}
