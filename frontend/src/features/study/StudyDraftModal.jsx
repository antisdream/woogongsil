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
                        <p>최근에 남긴 초안을 불러와 이어서 작성하세요. 문서 저장과 초안 보관은 구분됩니다.</p>
                    </div>
                    <button type="button" className="wgs-study-icon-button" onClick={onClose} title="닫기" aria-label="임시저장 목록 닫기">
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
                            <div className="wgs-study-empty" role="status">
                                <strong>{loadingDrafts ? '임시저장을 불러오는 중입니다.' : '저장된 임시저장이 없습니다.'}</strong>
                                {!loadingDrafts && <p>문서 편집 도구의 임시저장을 사용하면 이 목록에서 다시 불러올 수 있습니다.</p>}
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
