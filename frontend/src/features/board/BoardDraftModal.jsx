function BoardDraftModal({ t, savedList, onClose, onLoad, onDelete }) {
    return (
        <div className="board-draft-overlay" role="dialog" aria-modal="true" aria-label={t('draft.modal_title', '임시저장 목록')}>
            <div className="board-draft-modal">
                <div className="board-draft-head">
                    <h3>{t('draft.modal_title', '임시저장 목록')}</h3>
                    <button type="button" className="board-button" onClick={onClose}>{t('draft.close_button', '닫기')}</button>
                </div>
                <p className="community-save-hint">불러올 글을 선택하세요. 삭제한 임시 글은 목록에서 제거됩니다.</p>
                <div className="board-draft-list">
                    {savedList.map((item, idx) => (
                        <div key={idx} className="board-draft-item">
                            <button type="button" className="community-draft-load" onClick={() => onLoad(item)}>
                                <div><strong>{item.title || t('draft.no_title', '제목 없음')}</strong></div>
                                <small>{item.date}</small>
                            </button>
                            <button type="button" className="board-button board-button-danger" onClick={(event) => { event.stopPropagation(); onDelete(idx); }}>{t('common.delete', '삭제')}</button>
                        </div>
                    ))}
                    {!savedList.length && <div className="ui-empty"><strong>임시저장한 글이 없습니다.</strong><p>글쓰기 화면의 임시저장을 이용하면 나중에 이어서 작성할 수 있습니다.</p></div>}
                </div>
            </div>
        </div>
    );
}

export default BoardDraftModal;
