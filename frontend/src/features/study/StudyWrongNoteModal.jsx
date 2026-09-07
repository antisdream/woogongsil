import { FiRefreshCw, FiX } from 'react-icons/fi';

function StudyWrongNoteModal({
    wrongKind,
    wrongSearch,
    visibleWrongNotes,
    selectedWrongIds,
    selectedWrongCount,
    loadingWrongs,
    onClose,
    onKindChange,
    onSearchChange,
    onReload,
    onToggleWrong,
    onInsert,
}) {
    return (
        <div className="wgs-study-modal-backdrop" role="dialog" aria-modal="true" aria-label="오답노트 삽입">
            <div className="wgs-study-modal">
                <div className="wgs-study-modal-header">
                    <div>
                        <h2>오답노트 가져오기</h2>
                        <p>필기, 실기, 3주 공략, 멀티플레이 오답을 선택해서 현재 문서에 삽입합니다.</p>
                    </div>
                    <button type="button" className="wgs-study-icon-button" onClick={onClose} title="닫기">
                        <FiX aria-hidden="true" />
                    </button>
                </div>
                <div className="wgs-study-modal-body">
                    <div className="wgs-study-wrong-filters">
                        <select
                            className="wgs-study-select"
                            value={wrongKind}
                            onChange={(event) => onKindChange(event.target.value)}
                        >
                            <option value="all">전체 오답</option>
                            <option value="written">필기</option>
                            <option value="ipep">실기</option>
                            <option value="ipep_three_week">3주 공략</option>
                            <option value="multiplayer">멀티플레이</option>
                        </select>
                        <input
                            className="wgs-study-input"
                            value={wrongSearch}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="문제, 정답, 해설 검색"
                        />
                    </div>
                    <div className="wgs-study-toolbar" style={{ marginBottom: 12 }}>
                        <button type="button" className="wgs-study-button" onClick={onReload} disabled={loadingWrongs}>
                            <FiRefreshCw aria-hidden="true" /> 다시 불러오기
                        </button>
                        <span>선택 {selectedWrongCount}개 / 표시 {visibleWrongNotes.length}개</span>
                    </div>
                    <div className="wgs-study-wrong-list">
                        {visibleWrongNotes.map((wrong) => (
                            <label key={wrong.sourceId} className="wgs-study-wrong-card">
                                <input
                                    type="checkbox"
                                    checked={selectedWrongIds.has(wrong.sourceId)}
                                    onChange={() => onToggleWrong(wrong.sourceId)}
                                />
                                <span>
                                    <strong>{wrong.sourceTitle || wrong.sourceLabel || wrong.source}</strong>
                                    {wrong.sourceDetail && wrong.sourceDetail !== wrong.sourceTitle && (
                                        <p>{wrong.sourceDetail}</p>
                                    )}
                                    <p>{wrong.questionText || '문제 지문을 불러오지 못했습니다.'}</p>
                                    <p>내 답: {wrong.userAnswer || '기록 없음'} / 정답: {wrong.correctAnswer || '정답 정보 없음'}</p>
                                </span>
                            </label>
                        ))}
                        {!visibleWrongNotes.length && (
                            <div className="wgs-study-empty">
                                {loadingWrongs ? '오답을 불러오는 중입니다.' : '가져올 오답이 없습니다.'}
                            </div>
                        )}
                    </div>
                </div>
                <div className="wgs-study-modal-footer">
                    <button type="button" className="wgs-study-button" onClick={onClose}>
                        취소
                    </button>
                    <button type="button" className="wgs-study-button primary" onClick={onInsert}>
                        선택 삽입
                    </button>
                </div>
            </div>
        </div>
    );
}

export default StudyWrongNoteModal;
