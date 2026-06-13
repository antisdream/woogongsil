// 관리자 기능 모듈입니다: AdminMailModal
import React from 'react';

export default function AdminMailModal({
    mailModal,
    closeUserEmailModal,
    handleSendUserEmail,
    setMailModal,
}) {
    if (!mailModal.open) return null;

    return (
    <div className="admin-mail-backdrop" role="presentation" onClick={closeUserEmailModal}>
      <form className="admin-mail-modal" onSubmit={handleSendUserEmail} onClick={(event) => event.stopPropagation()}>
        <div className="admin-mail-modal-head">
          <div>
            <p>개인 이메일 전송</p>
            <h2>{mailModal.targetUser?.name || mailModal.targetUser?.id}님에게 메일 보내기</h2>
          </div>
          <button type="button" className="admin-mail-close" onClick={closeUserEmailModal} aria-label="메일 팝업 닫기">닫기</button>
        </div>
        <label>
          <span>받는 사람</span>
          <input value={mailModal.targetUser?.email || ''} readOnly />
        </label>
        <label>
          <span>메일 제목</span>
          <input value={mailModal.subject} onChange={(event) => setMailModal((prev) => ({ ...prev, subject: event.target.value, error: '' }))} placeholder="관리자가 보낼 이메일 제목을 입력해 주세요." autoFocus />
        </label>
        <label>
          <span>메일 내용</span>
          <textarea value={mailModal.message} onChange={(event) => setMailModal((prev) => ({ ...prev, message: event.target.value, error: '' }))} placeholder="안내사항, 공지사항 등 전달할 내용을 입력해 주세요." rows={10} />
        </label>
        {mailModal.error ? <p className="admin-mail-error">{mailModal.error}</p> : null}
        <div className="admin-mail-actions">
          <button type="button" className="admin-mail-cancel" onClick={closeUserEmailModal} disabled={mailModal.sending}>취소</button>
          <button type="submit" className="admin-mail-submit" disabled={mailModal.sending}>{mailModal.sending ? '전송중...' : '전송'}</button>
        </div>
      </form>
    </div>
    );
}
