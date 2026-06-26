import BoardDraftModal from './BoardDraftModal.jsx';
import BoardBlockNoteEditor from './BoardBlockNoteEditor.jsx';
import './boardPage.css';

function BoardWriteView({
    t,
    formatSetting,
    isEditing,
    boardTab,
    getBoardLabel,
    title,
    content,
    contentJson,
    editorKey,
    uploadAuth,
    uploadUrl,
    onTitleChange,
    onEditorChange,
    onCreatePost,
    onUpdatePost,
    onCancelWrite,
    onOpenLoadModal,
    onManualSave,
    showLoadModal,
    savedList,
    onCloseLoadModal,
    onLoadDraft,
    onDeleteDraft,
}) {
    return (
        <div className="board-page board-detail-page wgs-typography-scope">
            <div className="board-topbar">
                <div className="board-title-wrap">
                    <h2 className="board-page-title">{isEditing ? t('write.edit_title', '게시글 수정') : formatSetting('write.create_title', '{board} 글 작성', { board: getBoardLabel(boardTab) })}</h2>
                </div>
                <div className="board-action-row">
                    <button type="button" className="board-button board-button-success" onClick={onOpenLoadModal}>{t('write.load_button', '불러오기')}</button>
                    <button type="button" className="board-button board-button-warning" onClick={onManualSave}>{t('write.temp_save_button', '임시저장')}</button>
                </div>
            </div>
            <form onSubmit={isEditing ? onUpdatePost : onCreatePost} className="board-write-form">
                <input type="text" className="board-title-input" value={title} onChange={onTitleChange} placeholder={t('write.title_placeholder', '제목을 입력하세요')} required />
                <BoardBlockNoteEditor
                    content={content}
                    contentJson={contentJson}
                    editorKey={editorKey}
                    uploadAuth={uploadAuth}
                    uploadUrl={uploadUrl}
                    onEditorChange={onEditorChange}
                />
                <div className="board-action-row board-write-actions">
                    <button type="button" className="board-button" onClick={onCancelWrite}>{t('common.cancel', '취소')}</button>
                    <button type="submit" className="board-button board-button-primary">{isEditing ? t('write.update_submit_button', '수정완료') : t('write.create_submit_button', '등록')}</button>
                </div>
            </form>

            {showLoadModal && (
                <BoardDraftModal
                    t={t}
                    savedList={savedList}
                    onClose={onCloseLoadModal}
                    onLoad={onLoadDraft}
                    onDelete={onDeleteDraft}
                />
            )}
        </div>
    );
}

export default BoardWriteView;
