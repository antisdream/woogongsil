// 멀티플레이 시험 기능 모듈입니다: MultiplayerHomeTabs
import React from 'react';
import DrawingBoard from '../../pages/DrawingBoard.jsx';
import {
    EXAM_TYPE_OPTIONS,
    getQuestionExplanationImageSrc,
    getQuestionExplanationText,
    isPracticalQuestion,
} from './multiplayerExamUtils.js';
import QuestionImageButton from './QuestionImageButton.jsx';
import {
    activeHomeTabStyle,
    badgeStyle,
    betweenStyle,
    cardStyle,
    correctOptionStyle,
    descStyle,
    explainBoxStyle,
    homeGridStyle,
    homeTabBarStyle,
    homeTabStyle,
    inputStyle,
    optionBtnStyle,
    primaryBtn,
    questionBoxStyle,
    recordFormStyle,
    secondaryBtn,
    sectionTitleStyle,
    selectedOptionStyle,
    tableStyle,
    tableWrapStyle,
    textAnswerStyle,
    wrongPracticeBoxStyle,
} from './multiplayerStyles.js';

export function MultiplayerHomeTabs({ activeTab, goMultiplayerTab }) {
    return (
        <div style={homeTabBarStyle}>
            <button type="button" onClick={() => goMultiplayerTab('play')} style={activeTab === 'play'? activeHomeTabStyle : homeTabStyle}>방 만들기 / 입장하기</button>
            <button type="button" onClick={() => goMultiplayerTab('records')} style={activeTab === 'records'? activeHomeTabStyle : homeTabStyle}>시험 기록 확인하기</button>
            <button type="button" onClick={() => goMultiplayerTab('wrongs')} style={activeTab === 'wrongs'? activeHomeTabStyle : homeTabStyle}>오답문제 풀러가기</button>
        </div>
    );
}

export function MultiplayerPlayTab({ createForm, setCreateForm, createRoom, loading, joinForm, setJoinForm, joinRoom }) {
    return (
        <>
            <div style={homeGridStyle}>
                <section style={cardStyle}>
                    <h2 style={sectionTitleStyle}>방 만들기</h2>
                    <p style={descStyle}>방장이 비밀번호와 정원을 정하면 대기방 번호가 생성됩니다.</p>
                    <select style={inputStyle} value={createForm.examType} onChange={(e) => setCreateForm((p) => ({ ...p, examType: e.target.value }))}>
                        {EXAM_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <input style={inputStyle} placeholder="인증 비밀번호" value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} />
                    <input style={inputStyle} type="number" min="1" max="10" value={createForm.maxPlayers} onChange={(e) => setCreateForm((p) => ({ ...p, maxPlayers: Number(e.target.value) }))} />
                    <button style={primaryBtn} onClick={createRoom} disabled={loading}>대기방 만들기</button>
                </section>
                <section style={cardStyle}>
                    <h2 style={sectionTitleStyle}>멀티플레이 입장하기</h2>
                    <p style={descStyle}>방장이 공유한 방 번호와 비밀번호를 입력합니다.</p>
                    <input style={inputStyle} placeholder="방 번호" value={joinForm.roomCode} onChange={(e) => setJoinForm((p) => ({ ...p, roomCode: e.target.value }))} />
                    <input style={inputStyle} placeholder="인증 비밀번호" value={joinForm.password} onChange={(e) => setJoinForm((p) => ({ ...p, password: e.target.value }))} />
                    <button style={primaryBtn} onClick={joinRoom} disabled={loading}>입장하기</button>
                </section>
            </div>
            {/* 관리자만 알면 되는 과목별 보유 문제/랜덤 추첨 규칙은 사용자 화면에서 숨겼습니다. */}
        </>
    );
}

export function MultiplayerRecordTab({
    recordForm,
    setRecordForm,
    loadRoomRecord,
    recordLoading,
    roomRecord,
    roomRecordExamMeta,
    roomRecordRowsForDisplay,
    roomRecordExamType,
    openRoomWrongHtml,
}) {
    return (
        <section style={cardStyle}>
            <h2 style={{ ...sectionTitleStyle, color: '#8b5cf6' }}>시험 기록 확인하기</h2>
            <p style={descStyle}>방 번호와 인증 비밀번호를 입력하면 모든 참여자가 제출한 뒤 방 전체 상세 채점표를 볼 수 있습니다.</p>
            <div style={recordFormStyle}>
                <input style={inputStyle} placeholder="방 번호" value={recordForm.roomCode} onChange={(e) => setRecordForm((p) => ({ ...p, roomCode: e.target.value }))} />
                <input style={inputStyle} placeholder="인증 비밀번호" value={recordForm.password} onChange={(e) => setRecordForm((p) => ({ ...p, password: e.target.value }))} />
                <button style={primaryBtn} onClick={loadRoomRecord} disabled={recordLoading}>{recordLoading ? '확인 중...' : '확인하기'}</button>
            </div>
            {roomRecord && (
                <div style={{ marginTop: 24 }}>
                    <div style={betweenStyle}>
                        <div><h2 style={{ color: '#8b5cf6' }}>{roomRecordExamMeta.resultTitle}</h2><p style={descStyle}>대기방 #{roomRecord.roomCode} · 제출 {roomRecord.submittedCount}/{roomRecord.totalMembers}</p></div>
                        <button
                            style={{ ...secondaryBtn, opacity: roomRecordRowsForDisplay.length ? 1 : 0.55, cursor: roomRecordRowsForDisplay.length ? 'pointer' : 'not-allowed' }}
                            onClick={openRoomWrongHtml}
                            disabled={!roomRecordRowsForDisplay.length}
                            title={roomRecordRowsForDisplay.length ? '전체 채점표 페이지를 새 창으로 엽니다.' : '출력할 채점표 문제가 없습니다.'}
                        >
                            전체 채점표 HTML/PDF용 열기
                        </button>
                    </div>
                    <div style={tableWrapStyle}>
                        <table style={tableStyle}>
                            <thead>
                                {roomRecordExamType === 'ipep'? (
                                    <tr><th>이름</th><th>실기 점수</th><th>시험결과</th><th>정리내용</th></tr>
                                ) : (
                                    <tr><th>이름</th><th>1과목</th><th>2과목</th><th>3과목</th><th>4과목</th><th>5과목</th><th>시험결과</th><th>정리내용</th></tr>
                                )}
                            </thead>
                            <tbody>{(roomRecord.participants || []).map((p) => <tr key={p.userId}><td>{p.name}{p.role === 'HOST' ? ' (방장)' : ''}</td>{(p.subjectScores || []).map((s, i) => { const score = Number(s.score || 0); const passLine = roomRecordExamType === 'ipep' ? 60 : 40; return <td key={i}>{score}점({score >= passLine ? 'P' : 'NP'})</td>; })}<td>{Number(p.averageScore || 0)}점({p.isPass ? 'P' : 'NP'})</td><td>{p.reason || ''}</td></tr>)}</tbody>
                        </table>
                    </div>
                    <div style={tableWrapStyle}>
                        {/* [Step5 기록 연동]
                            4번 화면에서 삭제 처리된 오답은 백엔드에서 wrongItems/rows에 내려오지 않습니다.
                            남아있는 오답이 없으면 빈 표 대신 안내 문구를 보여줍니다. */}
                        {roomRecordRowsForDisplay.length >0 ? (
                            <table style={tableStyle}>
                                <thead><tr><th>번호</th><th>문제 출처</th><th>정답자</th><th>오답자</th></tr></thead>
                                <tbody>{roomRecordRowsForDisplay.map((row) => <tr key={row.questionId}><td>{row.no}</td><td>{row.sourceLabel}</td><td>{(row.correctNames || []).join(', ') || '-'}</td><td>{(row.wrongNames || []).join(', ') || '-'}</td></tr>)}</tbody>
                            </table>
                        ) : (
                            <div style={{ padding: 22, textAlign: 'center', color: 'var(--mp-muted)', fontWeight: 800 }}>
                                현재 확인 가능한 오답 문제가 없습니다.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

export function MultiplayerWrongPracticeTab({
    wrongDate,
    setWrongDate,
    setWrongRoomId,
    wrongRoomId,
    uniqueWrongDates,
    filteredWrongTimes,
    loadMyWrongQuestions,
    loadWrongGroups,
    selectedWrongQuestion,
    wrongIndex,
    wrongQuestions,
    currentIndex,
    getScratchStorageKey,
    setImagePreview,
    wrongAnswerMap,
    setWrongAnswerMap,
    shouldShowWrongFeedback,
    wrongScratchVersion,
    deleteCurrentWrongQuestion,
    deleteAllWrongQuestions,
    setWrongIndex,
}) {
    return (
        <section style={cardStyle}>
            <h2 style={{ ...sectionTitleStyle, color: '#8b5cf6' }}>오답문제 풀러가기</h2>
            <p style={descStyle}>방 전체 기록이 아닌, 현재 로그인한 사용자가 틀린 멀티플레이 문제만 다시 풀어봅니다.</p>
            <div style={recordFormStyle}>
                <select style={inputStyle} value={wrongDate} onChange={(e) => { setWrongDate(e.target.value); setWrongRoomId(''); }}><option value="">응시 날짜</option>{uniqueWrongDates.map((date) => <option key={date} value={date}>{date}</option>)}</select>
                <select style={inputStyle} value={wrongRoomId} onChange={(e) => setWrongRoomId(e.target.value)}><option value="">응시 시간</option>{filteredWrongTimes.map((g) => <option key={`${g.roomId}-${g.time}`} value={g.roomId}>{g.time} · 방 #{g.roomCode}{g.roomPassword ? ` · 비밀번호 ${g.roomPassword}` : ''}</option>)}</select>
                <button style={primaryBtn} onClick={loadMyWrongQuestions}>오답 불러오기</button>
                <button style={secondaryBtn} onClick={loadWrongGroups}>목록 새로고침</button>
            </div>
            {selectedWrongQuestion && (
                <div style={wrongPracticeBoxStyle}>
                    <div style={betweenStyle}>
                        <span style={{ ...badgeStyle, background: '#8b5cf6' }}>멀티플레이</span>
                        <b>{wrongIndex + 1} / {wrongQuestions.length}</b>
                    </div>
                    <h3>{selectedWrongQuestion.sourceLabel}</h3>
                    <div style={questionBoxStyle}>Q. {selectedWrongQuestion.question_text}</div>
                    <QuestionImageButton question={selectedWrongQuestion} currentIndex={currentIndex} getScratchStorageKey={getScratchStorageKey} setImagePreview={setImagePreview} />

                    {isPracticalQuestion(selectedWrongQuestion) ? (
                        <div style={{ marginTop: 16 }}>
                            <label style={{ display: 'block', marginBottom: 8, fontWeight: 900 }}>실기 답안 입력</label>
                            <textarea
                                style={textAnswerStyle}
                                value={wrongAnswerMap[selectedWrongQuestion.question_id] || ''}
                                onChange={(e) => setWrongAnswerMap((p) => {
                                    // 실기 답안을 수정하면 이전 확인 상태를 해제해 다시 '정답 확인하기'를 누르게 합니다.
                                    const next = { ...p, [selectedWrongQuestion.question_id]: e.target.value };
                                    delete next[`checked_${selectedWrongQuestion.question_id}`];
                                    return next;
                                })}
                                placeholder="정답을 직접 입력해 주세요. 예: 데이터베이스, SQL, 30"
                            />
                            <button
                                type="button" style={{ ...secondaryBtn, marginTop: 8 }}
                                onClick={() => setWrongAnswerMap((p) => ({ ...p, [`checked_${selectedWrongQuestion.question_id}`]: true }))}
                            >
                                정답 확인하기
                            </button>
                        </div>
                    ) : (
                        (selectedWrongQuestion.options || []).filter((opt) => String(opt || '').trim() !== '').map((opt, idx) => {
                            const label = idx + 1;
                            const selected = wrongAnswerMap[selectedWrongQuestion.question_id] === label;
                            const correct = Number(selectedWrongQuestion.correct_label || selectedWrongQuestion.correctLabel) === label;
                            return (
                                <button
                                    key={label}
                                    style={{ ...optionBtnStyle, ...(selected ? selectedOptionStyle : {}), ...(selected && correct ? correctOptionStyle : {}) }}
                                    onClick={() => setWrongAnswerMap((p) => ({ ...p, [selectedWrongQuestion.question_id]: label }))}
                                >
                                    {label}. {opt}
                                </button>
                            );
                        })
                    )}

                    {shouldShowWrongFeedback(selectedWrongQuestion) && (
                        <div style={explainBoxStyle}>
                            <b>정답: {selectedWrongQuestion.correct_label || selectedWrongQuestion.correctLabel}{isPracticalQuestion(selectedWrongQuestion) ? '' : '번'}</b><br />
                            {getQuestionExplanationText(selectedWrongQuestion) || (!getQuestionExplanationImageSrc(selectedWrongQuestion) && '등록된 해설이 없습니다.')}
                            {getQuestionExplanationImageSrc(selectedWrongQuestion) && (
                                <div style={{ marginTop: 12 }}>
                                    <img src={getQuestionExplanationImageSrc(selectedWrongQuestion)} alt="해설 이미지" style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--mp-border)', background: '#fff' }} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* 오답 다시풀기에서도 시험 화면과 같은 연습장을 제공해 풀이 과정을 남길 수 있도록 합니다. */}
                    <div style={{ marginTop: 22 }}>
                        <h3 style={{ margin: '0 0 12px', color: 'var(--accent-color, #7c3aed)' }}>문제 풀이 연습장</h3>
                        <DrawingBoard
                            key={`wrong_${wrongScratchVersion}_${selectedWrongQuestion.question_id}`}
                            storageKey={`multi_wrong_${wrongRoomId}_${selectedWrongQuestion.question_id}`}
                            height={420}
                        />
                    </div>

                    <div style={{ ...betweenStyle, marginTop: 18 }}>
                        <button style={secondaryBtn} disabled={wrongIndex === 0} onClick={() => setWrongIndex((v) => Math.max(0, v - 1))}>이전</button>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button style={{ ...secondaryBtn, background: '#ef4444', color: '#fff' }} onClick={deleteCurrentWrongQuestion}>현재 오답 삭제</button>
                            <button style={{ ...secondaryBtn, background: '#991b1b', color: '#fff' }} onClick={deleteAllWrongQuestions}>전체 오답 삭제</button>
                        </div>
                        <button style={secondaryBtn} disabled={wrongIndex >= wrongQuestions.length - 1} onClick={() => setWrongIndex((v) => Math.min(wrongQuestions.length - 1, v + 1))}>다음</button>
                    </div>
                </div>
            )}
        </section>
    );
}
