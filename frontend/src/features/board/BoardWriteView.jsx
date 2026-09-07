import BoardDraftModal from './BoardDraftModal.jsx';
import BoardBlockNoteEditor from './BoardBlockNoteEditor.jsx';
import './boardPage.css';
import { FiEdit3 } from 'react-icons/fi';
import '../../styles/app/community-redesign.css';

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
        <div className="board-page board-detail-page wgs-typography-scope community-page community-board community-board-writing" data-board-type={boardTab}>
            <div className="board-topbar">
                <div className="board-title-wrap">
                    <p className="ui-eyebrow"><FiEdit3 aria-hidden="true" /> 커뮤니티 글쓰기</p>
                    <h1 className="board-page-title">{isEditing ? t('write.edit_title', '게시글 수정') : formatSetting('write.create_title', '{board} 글 작성', { board: getBoardLabel(boardTab) })}</h1>
                    <p className="ui-page-description">제목과 내용을 작성하고, 등록 전에 본문과 첨부 내용을 확인해주세요.</p>
                </div>
                <div className="board-action-row">
                    <button type="button" className="board-button board-button-success" onClick={onOpenLoadModal}>{t('write.load_button', '불러오기')}</button>
                    <button type="button" className="board-button board-button-warning" onClick={onManualSave}>{t('write.temp_save_button', '임시저장')}</button>
                </div>
            </div>
            <form onSubmit={isEditing ? onUpdatePost : onCreatePost} className="board-write-form">
                <label className="community-field-label" htmlFor="community-board-title">글 제목</label>
                <input id="community-board-title" type="text" className="board-title-input" value={title} onChange={onTitleChange} placeholder={t('write.title_placeholder', '제목을 입력하세요')} required />
                <BoardBlockNoteEditor
                    content={content}
                    contentJson={contentJson}
                    editorKey={editorKey}
                    uploadAuth={uploadAuth}
                    uploadUrl={uploadUrl}
                    onEditorChange={onEditorChange}
                />
                <div className="board-action-row board-write-actions">
                    <p className="community-save-hint">작성 중인 글은 임시저장으로 따로 보관할 수 있습니다.</p>
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
