// Practical-exam feature module for IpepPastViews.
import React from 'react';
import { formatDateTime, formatTime, getQuestionNo } from './ipepPracticeUtils.js';
import { IPEP_TOTAL_SECONDS, baseButtonStyle, panelStyle } from './ipepPracticeStyles.js';

export function IpepPastLobby({ catalog, selectedExam, setSelectedExam, startPastExam }) {
        return (
            <section style={panelStyle}>
                <h3 style={{ color: '#fcd34d', fontSize: '24px', margin: '0 0 12px 0' }}> 실기 기출문제</h3>
                <p style={{ color: 'var(--wgs-muted)', lineHeight: 1.7, marginBottom: '18px' }}>
                    정보처리기사 실기는 한 회차 20문제, 문제당 5점으로 구성됩니다. 총점 60점 이상이면 합격 기준으로 볼 수 있습니다.
                    아직 데이터가 준비되지 않은 회차는 오픈베타 안내 메시지가 표시됩니다.
                </p>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
                    {catalog.map(row => {
                        const isOpen = Number(row.isOpen) === 1;
                        const isSelected = selectedExam?.examYear === row.examYear && selectedExam?.examSession === row.examSession;

                        return (
                            <button
                                key={`${row.examYear}-${row.examSession}`}
                                onClick={() => {
                                    setSelectedExam(row);
                                    if (!isOpen) {
                                        alert(row.noticeMessage || '현재 오픈베타 테스트 중으로, 빠른 시일 내에 추가할 예정입니다.');
                                    }
                                }}
                                style={{ ...baseButtonStyle, background: isSelected ? '#ef4444' : isOpen ? 'var(--wgs-button-muted)' : 'var(--wgs-button-muted)', border: isSelected ? '2px solid #fca5a5' : '1px solid transparent', opacity: isOpen ? 1 : 0.75 }}
                            >
                                {isSelected ? '선택됨' : isOpen ? '응시 가능' : '잠김'} {row.examYear}년 {row.examSession}회차 ({row.questionCount}문제)
                            </button>
                        );
                    })}
                </div>

                <div style={{ ...panelStyle, background: 'var(--wgs-exam-card)' }}>
                    <h4 style={{ color: 'var(--wgs-blue-soft)', margin: '0 0 8px 0' }}>
                        현재 선택: {selectedExam ? `${selectedExam.examYear}년 ${selectedExam.examSession}회차` : '선택 없음'}
                    </h4>
                    <p style={{ color: 'var(--wgs-muted)', margin: '0 0 16px 0' }}>
                        응시 시작 후에는 정답이 바로 공개되지 않으며, 최종 제출 후 결과표에서 확인할 수 있습니다.
                    </p>
                    <button
                        onClick={() => startPastExam(selectedExam)}
                        style={{ ...baseButtonStyle, background: '#10b981', width: '100%', fontSize: '17px' }}
                    >
                        실기 기출 응시 시작
                    </button>
                </div>
            </section>
        );
    
}

export function IpepPastResult({
    pastSummary,
    userName,
    startTime,
    endTime,
    timeLeft,
    pastQuestions,
    pastResults,
    exportPastResultPDF,
    resetPastToLobby,
    startPastExam,
    selectedExam,
}) {
        return (
            <section style={{ ...panelStyle, textAlign: 'center' }}>
                <h3 style={{ color: '#fcd34d', fontSize: '26px', margin: '0 0 20px 0' }}>최종 결과표</h3>

                <div style={{ border: `2px solid ${pastSummary.isPass ? '#10b981' : '#ef4444'}`, background: pastSummary.isPass ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', borderRadius: '14px', padding: '28px', marginBottom: '24px' }}>
                    <h1 style={{ margin: '0 0 12px 0', color: pastSummary.isPass ? '#10b981' : '#ef4444', fontSize: '42px' }}>{pastSummary.totalScore}점</h1>
                    <h3 style={{ margin: 0, color: 'var(--wgs-text)' }}>
                        {pastSummary.isPass ? `${userName}님, 합격 기준을 넘겼습니다.` : `${userName}님, 불합격 기준입니다.`}
                    </h3>
                    <div style={{ marginTop: '18px', display: 'inline-block', textAlign: 'left', background: 'rgba(0,0,0,0.25)', padding: '14px 18px', borderRadius: '10px', color: 'var(--wgs-muted)' }}>
                        <div>시작 일시: <strong style={{ color: 'var(--wgs-text)' }}>{formatDateTime(startTime)}</strong></div>
                        <div>종료 일시: <strong style={{ color: 'var(--wgs-text)' }}>{formatDateTime(endTime)}</strong></div>
                        <div>실제 소요 시간: <strong style={{ color: 'var(--wgs-text)' }}>{formatTime(IPEP_TOTAL_SECONDS - timeLeft)}</strong></div>
                        <div>정답 처리: <strong style={{ color: 'var(--wgs-text)' }}>{pastSummary.fullCorrectCount} / {pastQuestions.length}문제</strong></div>
                    </div>
                </div>

                <div style={{ ...panelStyle, textAlign: 'left', overflowX: 'auto', marginBottom: '20px' }}>
                    <h4 style={{ color: 'var(--wgs-text)', margin: '0 0 14px 0' }}>제출한 문제 상세 채점표</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--wgs-text)', fontSize: '14px' }}>
                        <thead>
                            <tr style={{ background: 'var(--wgs-exam-card)' }}>
                                <th style={{ border: '1px solid var(--wgs-border)', padding: '10px' }}>문제 번호</th>
                                <th style={{ border: '1px solid var(--wgs-border)', padding: '10px' }}>내 답안</th>
                                <th style={{ border: '1px solid var(--wgs-border)', padding: '10px' }}>실제 정답</th>
                                <th style={{ border: '1px solid var(--wgs-border)', padding: '10px' }}>점수</th>
                                <th style={{ border: '1px solid var(--wgs-border)', padding: '10px' }}>결과</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pastResults.map((row, index) => {
                                const isFullCorrect = Number(row.score || 0) >= Number(row.maxScore || 5);
                                return (
                                    <tr key={row.question.questionId}>
                                        <td style={{ border: '1px solid var(--wgs-border)', padding: '10px', textAlign: 'center' }}>{getQuestionNo(row.question, index)}번</td>
                                        <td style={{ border: '1px solid var(--wgs-border)', padding: '10px', color: isFullCorrect ? '#10b981' : '#ef4444', whiteSpace: 'pre-wrap' }}>{row.userAnswer || '(미입력)'}</td>
                                        <td style={{ border: '1px solid var(--wgs-border)', padding: '10px', color: '#10b981', whiteSpace: 'pre-wrap' }}>{row.correctAnswer}</td>
                                        <td style={{ border: '1px solid var(--wgs-border)', padding: '10px', textAlign: 'center' }}>{row.score} / {row.maxScore}</td>
                                        <td style={{ border: '1px solid var(--wgs-border)', padding: '10px', textAlign: 'center', color: isFullCorrect ? '#10b981' : '#ef4444', fontWeight: '900' }}>{isFullCorrect ? 'O' : 'X'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="ipep-action-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={exportPastResultPDF} style={{ ...baseButtonStyle, background: '#10b981', flex: 1 }}>PDF로 추출</button>
                    <button onClick={resetPastToLobby} style={{ ...baseButtonStyle, background: 'var(--wgs-button-muted)', flex: 1 }}>실기 로비로 이동</button>
                    <button onClick={() => startPastExam(selectedExam)} style={{ ...baseButtonStyle, background: '#3b82f6', flex: 1 }}>다시 풀기</button>
                </div>
            </section>
        );
    
}
