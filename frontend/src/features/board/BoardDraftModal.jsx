function BoardDraftModal({ t, savedList, onClose, onLoad, onDelete }) {
    return (
        <div className="board-draft-overlay">
            <div className="board-draft-modal">
                <div className="board-draft-head">
                    <h3>{t('draft.modal_title', '임시저장 목록')}</h3>
                    <button type="button" className="board-button" onClick={onClose}>{t('draft.close_button', '닫기')}</button>
                </div>
                <div className="board-draft-list">
                    {savedList.map((item, idx) => (
                        <button type="button" key={idx} className="board-draft-item" onClick={() => onLoad(item)}>
                            <div>
                                <div><strong>{item.title || t('draft.no_title', '제목 없음')}</strong></div>
                                <small>{item.date}</small>
                            </div>
                            <span role="button" tabIndex={-1} className="board-button board-button-danger" onClick={(event) => { event.stopPropagation(); onDelete(idx); }}>{t('common.delete', '삭제')}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default BoardDraftModal;
