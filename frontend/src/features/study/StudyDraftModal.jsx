import { FiRefreshCw, FiX } from 'react-icons/fi';

function StudyDraftModal({
    drafts,
    draftTotal,
    draftPage,
    draftTotalPages,
    loadingDrafts,
    onClose,
    onRefresh,
    onLoadDraft,
    onDeleteDraft,
    onPageChange,
}) {
    return (
        <div className="wgs-study-modal-backdrop" role="dialog" aria-modal="true" aria-label="임시저장 목록">
            <div className="wgs-study-modal wgs-study-draft-modal">
                <div className="wgs-study-modal-header">
                    <div>
                        <h2>임시저장 목록</h2>
                        <p>계정에 저장된 임시저장을 최근 순서로 확인합니다.</p>
                    </div>
                    <button type="button" className="wgs-study-icon-button" onClick={onClose} title="닫기">
                        <FiX aria-hidden="true" />
                    </button>
                </div>
                <div className="wgs-study-modal-body">
                    <div className="wgs-study-draft-summary">
                        <span>전체 {draftTotal}개</span>
                        <button type="button" className="wgs-study-button" onClick={onRefresh} disabled={loadingDrafts}>
                            <FiRefreshCw aria-hidden="true" /> 새로고침
                        </button>
                    </div>
                    <div className="wgs-study-draft-list">
                        {drafts.map((draft) => (
                            <article key={draft.id} className="wgs-study-draft-row">
                                <div className="wgs-study-draft-main">
                                    <div className="wgs-study-draft-title-line">
                                        <strong>{draft.title || '제목 없음'}</strong>
                                        <span>{draft.saveReason === 'exit' ? '자동' : '수동'}</span>
                                    </div>
                                    <p>{draft.summary || '내용 없음'}</p>
                                    <time>{draft.savedAt || ''}</time>
                                </div>
                                <div className="wgs-study-draft-row-actions">
                                    <button type="button" className="wgs-study-button primary" onClick={() => onLoadDraft(draft.id)}>
                                        불러오기
                                    </button>
                                    <button type="button" className="wgs-study-button danger" onClick={() => onDeleteDraft(draft.id)}>
                                        삭제
                                    </button>
                                </div>
                            </article>
                        ))}
                        {!drafts.length && (
                            <div className="wgs-study-empty">
                                {loadingDrafts ? '임시저장을 불러오는 중입니다.' : '저장된 임시저장이 없습니다.'}
                            </div>
                        )}
                    </div>
                </div>
                <div className="wgs-study-modal-footer wgs-study-draft-footer">
                    <button
                        type="button"
                        className="wgs-study-button"
                        onClick={() => onPageChange(Math.max(1, draftPage - 1))}
                        disabled={draftPage <= 1 || loadingDrafts}
                    >
                        이전
                    </button>
                    <span>{draftPage} / {draftTotalPages}</span>
                    <button
                        type="button"
                        className="wgs-study-button"
                        onClick={() => onPageChange(Math.min(draftTotalPages, draftPage + 1))}
                        disabled={draftPage >= draftTotalPages || loadingDrafts}
                    >
                        다음
                    </button>
                </div>
            </div>
        </div>
    );
}

export default StudyDraftModal;
