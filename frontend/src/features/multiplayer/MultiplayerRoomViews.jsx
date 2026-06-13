// 멀티플레이 시험 기능 모듈입니다: MultiplayerRoomViews
import React from 'react';
import {
    agreeButtonCheckedStyle,
    agreeButtonStyle,
    agreeCheckBoxCheckedStyle,
    agreeCheckBoxStyle,
    agreeGridStyle,
    betweenStyle,
    buttonRowStyle,
    cardStyle,
    dangerBtn,
    descStyle,
    disabledBtnStyle,
    failResultStyle,
    memberCardStyle,
    memberGridStyle,
    passResultStyle,
    primaryBtn,
    readyMemberCardStyle,
    resultRoomInfoStyle,
    secondaryBtn,
    sectionTitleStyle,
    subjectCardStyle,
    subjectGridStyle,
    tableStyle,
    tableWrapStyle,
    waitingMemberCardStyle,
} from './multiplayerStyles.js';

export function MultiplayerWaitingRoom({ room, activeExamMeta, leaveWaitingRoom, isHost, kickMember, changePassword, startRoom, toggleReady, myMember }) {
    return (
        <section style={cardStyle}>
            <div style={betweenStyle}><h2 style={sectionTitleStyle}>대기방 #{room?.roomCode}</h2><button style={secondaryBtn} onClick={leaveWaitingRoom}>{activeExamMeta.lobbyText}</button></div>
            <p style={descStyle}>인증 비밀번호: <b>{room?.roomPassword || room?.password || '-'}</b> · 참여 {room?.participantCount || room?.members?.length || 0}/{room?.maxPlayers}</p>
            <div style={memberGridStyle}>{(room?.members || []).map((m) => (
                // 방장이 아닌 참여자는 준비 전 회색, 준비 완료 후 초록색으로 구분합니다.
                <div key={m.userId} style={{ ...memberCardStyle, ...(m.role !== 'HOST' && m.status === 'READY'? readyMemberCardStyle : waitingMemberCardStyle) }}>
                    <b>{m.userName}{m.role === 'HOST' ? ' (방장)' : ''}</b>
                    <p>{m.role === 'HOST'? '방장' : m.status === 'READY'? '준비완료' : '대기중'}</p>
                    {isHost && m.role !== 'HOST' && <button style={dangerBtn} onClick={() => kickMember(m.userId)}>내보내기</button>}
                </div>
            ))}</div>
            <div style={buttonRowStyle}>{isHost ? <><button style={secondaryBtn} onClick={changePassword}>비밀번호 변경</button><button style={primaryBtn} onClick={startRoom}>시험 시작</button></> : <button style={primaryBtn} onClick={toggleReady}>{myMember?.status === 'READY'? '준비 취소' : '준비완료'}</button>}</div>
        </section>
    );
}

export function MultiplayerGuide({ agreementLabels, agreements, setAgreements, allAgreed, loadQuestions }) {
    return (
        <section style={cardStyle}>
            <div style={betweenStyle}>
                <h2 style={sectionTitleStyle}>시험 가이드 및 응시 동의</h2>
                {/* 시험 시작 이후 안내 화면에서는 제출 전 이탈을 막기 위해 로비 이동 버튼을 숨깁니다. */}
            </div>
            <p style={descStyle}>실제 시험처럼 집중해서 응시할 수 있도록 아래 4개 안내를 하나씩 눌러 확인해 주세요. 모든 안내를 확인하면 시험을 시작할 수 있습니다.</p>

            {/* 안내 행 자체가 큰 동의 버튼입니다. 선택되면 연한 초록색으로 바뀝니다. */}
            <div style={agreeGridStyle}>
                {agreementLabels.map((a, idx) => {
                    const checked = agreements[idx];
                    return (
                        <button
                            key={a.title}
                            type="button" className={checked ? 'mp-agree-row mp-agree-row--checked' : 'mp-agree-row'}
                            onClick={() => setAgreements((prev) => prev.map((v, i) => (i === idx ? !v : v)))}
                            style={{ ...agreeButtonStyle, ...(checked ? agreeButtonCheckedStyle : {}) }}
                            aria-pressed={checked}
                        >
                            <span style={{ ...agreeCheckBoxStyle, ...(checked ? agreeCheckBoxCheckedStyle : {}) }}>{checked ? 'O' : ''}</span>
                            <b style={{ color: checked ? '#064e3b' : 'var(--mp-text)' }}>{a.title}</b>
                            <span style={{ color: checked ? '#047857' : 'var(--mp-muted)' }}>{a.desc}</span>
                        </button>
                    );
                })}
            </div>

            <div style={buttonRowStyle}>
                {/* 제출 없이 대기방으로 돌아가는 경로를 제거합니다. */}
                <button
                    style={{ ...primaryBtn, ...(!allAgreed ? disabledBtnStyle : {}) }}
                    disabled={!allAgreed}
                    onClick={loadQuestions}
                >
                    시험 시작
                </button>
            </div>
        </section>
    );
}

export function MultiplayerResultView({ result, room, resetToHome }) {
    return (
        <section style={cardStyle}>
            <h2 style={result?.isPass ? passResultStyle : failResultStyle}>최종 결과: {result?.isPass ? '합격' : '불합격'} · 평균 {result?.averageScore}점</h2>
            <p style={{ textAlign: 'center', fontSize: 20 }}>정답 {result?.correctCount} / {result?.totalCount}</p>
            <div style={resultRoomInfoStyle}><b>현재 방 번호</b> #{result?.roomCode || room?.roomCode || '-'} <span>·</span> <b>인증 비밀번호</b> {result?.roomPassword || room?.roomPassword || room?.password || '-'}</div>
            <div style={subjectGridStyle}>{(result?.subjectScores || []).map((s, i) => <div key={i} style={subjectCardStyle}><h3>{s.subjectName || `${i + 1}과목`}</h3><strong>{s.score}점</strong><p>{s.correctCount}/{s.totalCount || 20}</p></div>)}</div>
            <h3 style={sectionTitleStyle}>제출한 문제 상세 채점표</h3>
            <p style={descStyle}>방 전체 정답자/오답자 기록은 상단의 “시험 기록 확인하기”에서 방 번호와 인증 비밀번호를 입력해 확인합니다.</p>
            <div style={tableWrapStyle}><table style={tableStyle}><thead><tr><th>번호</th><th>출처</th><th>내 답</th><th>정답</th><th>결과</th></tr></thead><tbody>{(result?.questions || []).map((q) => <tr key={q.cbtNo}><td>{q.cbtNo}</td><td>{q.sourceLabel}</td><td>{q.selected_answer || q.selectedLabel || '-'}</td><td>{q.correct_label || q.correctLabel}</td><td>{q.is_correct || q.isCorrect ? 'O' : 'X'}</td></tr>)}</tbody></table></div>
            <div style={buttonRowStyle}><button style={primaryBtn} onClick={resetToHome}>로비로 이동</button></div>
        </section>
    );
}
